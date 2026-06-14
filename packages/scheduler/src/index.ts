// packages/scheduler/src/index.ts
// @www/scheduler — T-11 implementation (Wave C, Fase 2 global-events)
//
// ADR-004/D-003: scheduler server-side; fetch connector → persist in store BEFORE serving.
// D-105: 4 tiers by volatility. Intervals are CONFIGURABLE (passed via cfg / Job.intervalMs),
//         never hardcoded inside run().
// T-11 changes vs T-04:
//   - SchedulerDeps: adds fetchUsgs/fetchEonet/fetchGdelt (EventRow), upsertEvents;
//     removes insertGdeltEvents (gdelt_events table dropped in T-08 migration 002).
//   - defaultJobs: replaces gdelt-financial job (insertGdeltEvents) with gdelt-events job
//     (upsertEvents); adds usgs (fast) + eonet (medium) jobs.
//   - Return order: [markets, usgs, eonet, gdelt, news, daily].

import {
  insertMarketSnapshots,
  insertNewsItems,
  upsertEvents,
  purgeAndDownsample,
  type MarketSnapshot,
  type NewsItem,
  type EventRow,
} from '@www/store';

import { generateDailyBriefing } from '@www/core-ai';
import type { Briefing } from '@www/store';

// ─── ConnectorResult contract ─────────────────────────────────────────────────
// Mirrors the structural type exported by @www/connectors (finance/markets.ts).
// Defined here so the scheduler compiles independently if the connectors package
// is temporarily unavailable (e.g. clean build ordering).

export interface ConnectorResult<T> {
  data: T[];
  stale: boolean;
  fetchedAt: number; // epoch ms
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type Tier = 'fast' | 'medium' | 'slow' | 'daily';

export interface Job {
  name: string;
  tier: Tier;
  /** Interval in milliseconds between runs. Must be set externally — never hardcoded in run(). */
  intervalMs: number;
  run: () => Promise<void>;
}

// ─── Scheduler core ───────────────────────────────────────────────────────────

interface SchedulerHandle {
  start(): void;
  stop(): void;
}

/**
 * Creates a scheduler that runs each job on its own interval.
 *
 * Boot sequencing (cold-start fix):
 *   1. All non-daily jobs run their first execution in parallel and are AWAITED.
 *   2. Only after ALL non-daily first runs complete (success or fail) does the
 *      daily job run its first execution.
 *   3. setInterval for EVERY job is registered right away so interval timing
 *      begins from boot — the sequencing only affects the immediate first run.
 *
 * - start() is idempotent — calling twice is a no-op.
 * - stop()  clears all intervals; no more executions fire after stop().
 * - A job that throws does NOT crash the scheduler — error is logged and the
 *   next interval fires as normal.
 */
export function createScheduler(jobs: Job[]): SchedulerHandle {
  const handles: ReturnType<typeof setInterval>[] = [];
  let running = false;

  return {
    start() {
      if (running) return;
      running = true;

      const nonDailyJobs = jobs.filter((j) => j.tier !== 'daily');
      const dailyJobs    = jobs.filter((j) => j.tier === 'daily');

      // Register all intervals immediately so timing starts from boot.
      for (const job of jobs) {
        const h = setInterval(() => void runJob(job), job.intervalMs);
        handles.push(h);
      }

      // Boot sequencing: non-daily → await → daily (fire-and-forget outer async).
      void (async () => {
        // Step 1: run all non-daily jobs in parallel; wait for ALL to finish.
        await Promise.all(nonDailyJobs.map((j) => runJob(j)));

        // Step 2: only now run daily jobs (briefing reads a populated store).
        await Promise.all(dailyJobs.map((j) => runJob(j)));
      })();
    },

    stop() {
      running = false;
      for (const h of handles) {
        clearInterval(h);
      }
      handles.length = 0;
    },
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function runJob(job: Job): Promise<void> {
  const start = Date.now();
  try {
    await job.run();
    console.log(`[scheduler] [${job.tier}] ${job.name} completed in ${Date.now() - start}ms`);
  } catch (err) {
    console.error(
      `[scheduler] [${job.tier}] ${job.name} FAILED (${Date.now() - start}ms):`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ─── Default intervals (ms) — override via cfg ────────────────────────────────

const DEFAULT_INTERVALS: Record<Tier, number> = {
  fast:   5  * 60 * 1000,       // 5 min  — markets + usgs (earthquake)
  medium: 15 * 60 * 1000,       // 15 min — eonet + gdelt (events)
  slow:   30 * 60 * 1000,       // 30 min — news
  daily:  24 * 60 * 60 * 1000,  // 24 h   — briefing + maintenance
};

/** Retention window for purgeAndDownsample (90 days in ms, D-102) */
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// ─── Connector + store + ai dependencies (injected so tests can mock them) ────

/**
 * T-11: SchedulerDeps now carries the three geo-event connectors (all returning
 * ConnectorResult<EventRow>) and upsertEvents from @www/store.
 * insertGdeltEvents is removed — gdelt_events table was DROPped in migration 002.
 */
export interface SchedulerDeps {
  // Connector fetchers
  fetchMarkets: () => Promise<ConnectorResult<MarketSnapshot>>;
  fetchUsgs:    () => Promise<ConnectorResult<EventRow>>;
  fetchEonet:   () => Promise<ConnectorResult<EventRow>>;
  fetchGdelt:   () => Promise<ConnectorResult<EventRow>>;
  fetchNews:    () => Promise<ConnectorResult<NewsItem>>;

  // Store writes (@www/store) — defaults to real implementations
  insertMarketSnapshots: (rows: MarketSnapshot[]) => Promise<void>;
  upsertEvents:          (rows: EventRow[])        => Promise<void>;
  insertNewsItems:       (rows: NewsItem[])         => Promise<void>;
  purgeAndDownsample:    (beforeMs: number)         => Promise<void>;

  // AI pipeline (@www/core-ai) — defaults to real implementation
  generateDailyBriefing: () => Promise<Briefing>;
}

// ConnectorDeps type alias (backwards compat — server.ts uses SchedulerDeps directly)
export type ConnectorDeps = Pick<
  SchedulerDeps,
  'fetchMarkets' | 'fetchUsgs' | 'fetchEonet' | 'fetchGdelt' | 'fetchNews'
>;

/**
 * Real (production) implementations of store + ai deps.
 * insertGdeltEvents intentionally omitted — no longer in SchedulerDeps (T-11).
 */
const REAL_STORE_AI_DEPS: Pick<
  SchedulerDeps,
  | 'insertMarketSnapshots'
  | 'upsertEvents'
  | 'insertNewsItems'
  | 'purgeAndDownsample'
  | 'generateDailyBriefing'
> = {
  insertMarketSnapshots,
  upsertEvents,
  insertNewsItems,
  purgeAndDownsample,
  generateDailyBriefing,
};

/**
 * Default connector implementations — dynamic imports so the scheduler compiles
 * even while @www/connectors is a stub. The real exports will be present at
 * runtime once the connectors land.
 */
async function loadDefaultConnectors(): Promise<ConnectorDeps> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('@www/connectors') as any;
  return {
    fetchMarkets: mod.fetchMarkets as ConnectorDeps['fetchMarkets'],
    fetchUsgs:    mod.fetchUsgs    as ConnectorDeps['fetchUsgs'],
    fetchEonet:   mod.fetchEonet   as ConnectorDeps['fetchEonet'],
    fetchGdelt:   mod.fetchGdelt   as ConnectorDeps['fetchGdelt'],
    fetchNews:    mod.fetchNews    as ConnectorDeps['fetchNews'],
  };
}

// ─── Default jobs factory ─────────────────────────────────────────────────────

/**
 * Builds the production jobs:
 *   markets (fast) · usgs (fast) · eonet (medium) · gdelt (medium) · news (slow) · daily
 *
 * T-11: gdelt-financial job (insertGdeltEvents → gdelt_events) REPLACED by gdelt-events
 * job (upsertEvents → events). usgs + eonet jobs ADDED. Order: [markets, usgs, eonet,
 * gdelt, news, daily]. Mantiene la firma defaultJobs(cfg?, deps?): Job[] que usa server.ts.
 *
 * @param cfg  - override any tier's interval in ms.
 * @param deps - inject mocks for testing (optional; defaults load from @www/connectors + real store/ai).
 */
export function defaultJobs(
  cfg?: Partial<Record<Tier, number>>,
  deps?: Partial<SchedulerDeps>,
): Job[] {
  const intervals: Record<Tier, number> = {
    fast:   cfg?.fast   ?? DEFAULT_INTERVALS.fast,
    medium: cfg?.medium ?? DEFAULT_INTERVALS.medium,
    slow:   cfg?.slow   ?? DEFAULT_INTERVALS.slow,
    daily:  cfg?.daily  ?? DEFAULT_INTERVALS.daily,
  };

  // Merge injected deps with production defaults
  const storeAi = { ...REAL_STORE_AI_DEPS, ...deps };

  // ── markets job (fast tier) ────────────────────────────────────────────────
  const marketsJob: Job = {
    name: 'markets',
    tier: 'fast',
    intervalMs: intervals.fast,
    async run() {
      const connectors = deps?.fetchMarkets
        ? { fetchMarkets: deps.fetchMarkets }
        : await loadDefaultConnectors();
      const result = await connectors.fetchMarkets();
      if (result.data.length > 0) {
        await storeAi.insertMarketSnapshots(result.data);
        console.log(
          `[scheduler] markets: persisted ${result.data.length} snapshots (stale=${result.stale})`,
        );
      } else {
        console.warn('[scheduler] markets: connector returned empty data — skipping insert');
      }
    },
  };

  // ── usgs job (fast tier) — D-105: earthquakes are high-frequency ──────────
  const usgsJob: Job = {
    name: 'usgs',
    tier: 'fast',
    intervalMs: intervals.fast,
    async run() {
      const connectors = deps?.fetchUsgs
        ? { fetchUsgs: deps.fetchUsgs }
        : await loadDefaultConnectors();
      const result = await connectors.fetchUsgs();
      if (result.data.length > 0) {
        // ADR-004: persist BEFORE serving (upsertEvents, not append)
        await storeAi.upsertEvents(result.data);
        console.log(
          `[scheduler] usgs: persisted ${result.data.length} events (stale=${result.stale})`,
        );
      } else {
        console.warn('[scheduler] usgs: connector returned empty data — skipping upsert');
      }
    },
  };

  // ── eonet job (medium tier) — D-105: natural disasters less frequent ───────
  const eonetJob: Job = {
    name: 'eonet',
    tier: 'medium',
    intervalMs: intervals.medium,
    async run() {
      const connectors = deps?.fetchEonet
        ? { fetchEonet: deps.fetchEonet }
        : await loadDefaultConnectors();
      const result = await connectors.fetchEonet();
      if (result.data.length > 0) {
        // ADR-004: persist BEFORE serving
        await storeAi.upsertEvents(result.data);
        console.log(
          `[scheduler] eonet: persisted ${result.data.length} events (stale=${result.stale})`,
        );
      } else {
        console.warn('[scheduler] eonet: connector returned empty data — skipping upsert');
      }
    },
  };

  // ── gdelt job (medium tier) — replaces the old gdelt-financial job ─────────
  // T-11: the old job called insertGdeltEvents(GdeltEvent[]) into gdelt_events.
  // That table was DROPped in migration 002 (T-08). This job now calls
  // upsertEvents(EventRow[]) into the unified `events` table. The connector
  // fetchGdelt now returns ConnectorResult<EventRow> (refactored in T-10c).
  const gdeltJob: Job = {
    name: 'gdelt',
    tier: 'medium',
    intervalMs: intervals.medium,
    async run() {
      const connectors = deps?.fetchGdelt
        ? { fetchGdelt: deps.fetchGdelt }
        : await loadDefaultConnectors();
      const result = await connectors.fetchGdelt();
      if (result.data.length > 0) {
        // ADR-004: persist BEFORE serving
        await storeAi.upsertEvents(result.data);
        console.log(
          `[scheduler] gdelt: persisted ${result.data.length} events (stale=${result.stale})`,
        );
      } else {
        console.warn('[scheduler] gdelt: connector returned empty data — skipping upsert');
      }
    },
  };

  // ── news job (slow tier) ──────────────────────────────────────────────────
  const newsJob: Job = {
    name: 'news',
    tier: 'slow',
    intervalMs: intervals.slow,
    async run() {
      const connectors = deps?.fetchNews
        ? { fetchNews: deps.fetchNews }
        : await loadDefaultConnectors();
      const result = await connectors.fetchNews();
      if (result.data.length > 0) {
        await storeAi.insertNewsItems(result.data);
        console.log(
          `[scheduler] news: persisted ${result.data.length} items (stale=${result.stale})`,
        );
      } else {
        console.warn('[scheduler] news: connector returned empty data — skipping insert');
      }
    },
  };

  // ── daily job (daily tier) ────────────────────────────────────────────────
  // Boot sequencing (cold-start fix, Fase 1): daily runs AFTER all non-daily
  // jobs complete their first run so the store is populated before the briefing.
  // purgeAndDownsample in T-08 already purges `events` (not gdelt_events).
  const dailyJob: Job = {
    name: 'daily',
    tier: 'daily',
    intervalMs: intervals.daily,
    async run() {
      // 1. Generate (or serve cached) briefing
      const briefing = await storeAi.generateDailyBriefing();
      console.log(
        `[scheduler] daily: briefing generated (model=${briefing.model}, ` +
          `valid_until=${new Date(briefing.valid_until).toISOString()})`,
      );

      // 2. Purge + downsample data older than retention window
      // purgeAndDownsample after T-08 purges events + market_snapshots + news_items
      const beforeMs = Date.now() - RETENTION_MS;
      await storeAi.purgeAndDownsample(beforeMs);
      console.log(
        `[scheduler] daily: purgeAndDownsample before ${new Date(beforeMs).toISOString()} complete`,
      );
    },
  };

  // T-11 order: markets · usgs · eonet · gdelt · news · daily
  return [marketsJob, usgsJob, eonetJob, gdeltJob, newsJob, dailyJob];
}
