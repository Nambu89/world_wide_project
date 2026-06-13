// packages/scheduler/src/index.ts
// @www/scheduler — T-04 implementation
//
// ADR-004/D-003: scheduler server-side; fetch connector → persist in store BEFORE serving.
// D-103: 4 tiers by volatility. Intervals are CONFIGURABLE (passed via cfg / Job.intervalMs),
//         never hardcoded inside run().

import {
  insertMarketSnapshots,
  insertGdeltEvents,
  insertNewsItems,
  purgeAndDownsample,
  type MarketSnapshot,
  type GdeltEvent,
  type NewsItem,
} from '@www/store';

import { generateDailyBriefing } from '@www/core-ai';
import type { Briefing } from '@www/store';

// ─── ConnectorResult contract (T-03a/b/c types) ──────────────────────────────
// The connectors package is still a stub; we define the structural contract
// here so the scheduler compiles and the real connectors can satisfy it.

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
 * - start() begins all jobs (first run happens immediately, then repeats on intervalMs).
 * - stop()  clears all intervals; no more executions fire after stop().
 * - A job that throws does NOT crash the scheduler — error is logged and the next
 *   interval fires as normal.
 */
export function createScheduler(jobs: Job[]): SchedulerHandle {
  const handles: ReturnType<typeof setInterval>[] = [];
  let running = false;

  return {
    start() {
      if (running) return;
      running = true;

      for (const job of jobs) {
        // Run once immediately, then on interval
        void runJob(job);
        const h = setInterval(() => void runJob(job), job.intervalMs);
        handles.push(h);
      }
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
  fast:   5  * 60 * 1000,       // 5 min  — markets
  medium: 15 * 60 * 1000,       // 15 min — gdelt
  slow:   30 * 60 * 1000,       // 30 min — news
  daily:  24 * 60 * 60 * 1000,  // 24 h   — briefing + maintenance
};

/** Retention window for purgeAndDownsample (90 days in ms, D-102) */
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// ─── Connector + store + ai dependencies (injected so tests can mock them) ────

export interface SchedulerDeps {
  // Connector fetchers (T-03a/b/c)
  fetchMarkets: () => Promise<ConnectorResult<MarketSnapshot>>;
  fetchGdelt: () => Promise<ConnectorResult<GdeltEvent>>;
  fetchNews: () => Promise<ConnectorResult<NewsItem>>;

  // Store writes (@www/store) — defaults to real implementations
  insertMarketSnapshots: (rows: MarketSnapshot[]) => Promise<void>;
  insertGdeltEvents: (rows: GdeltEvent[]) => Promise<void>;
  insertNewsItems: (rows: NewsItem[]) => Promise<void>;
  purgeAndDownsample: (beforeMs: number) => Promise<void>;

  // AI pipeline (@www/core-ai) — defaults to real implementation
  generateDailyBriefing: () => Promise<Briefing>;
}

// Keep the old ConnectorDeps name as a type alias for backwards compat
export type ConnectorDeps = Pick<
  SchedulerDeps,
  'fetchMarkets' | 'fetchGdelt' | 'fetchNews'
>;

/**
 * Real (production) implementations of store + ai deps.
 */
const REAL_STORE_AI_DEPS: Pick<
  SchedulerDeps,
  | 'insertMarketSnapshots'
  | 'insertGdeltEvents'
  | 'insertNewsItems'
  | 'purgeAndDownsample'
  | 'generateDailyBriefing'
> = {
  insertMarketSnapshots,
  insertGdeltEvents,
  insertNewsItems,
  purgeAndDownsample,
  generateDailyBriefing,
};

/**
 * Default connector implementations — dynamic imports so the scheduler compiles
 * even while @www/connectors is a stub. The real exports will be present at
 * runtime once T-03a/b/c land.
 */
async function loadDefaultConnectors(): Promise<ConnectorDeps> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('@www/connectors') as any;
  return {
    fetchMarkets: mod.fetchMarkets as ConnectorDeps['fetchMarkets'],
    fetchGdelt: mod.fetchGdelt as ConnectorDeps['fetchGdelt'],
    fetchNews: mod.fetchNews as ConnectorDeps['fetchNews'],
  };
}

// ─── Default jobs factory ─────────────────────────────────────────────────────

/**
 * Builds the MVP jobs (markets / gdelt / news / daily) with configurable intervals.
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

  // ── gdelt job (medium tier) ───────────────────────────────────────────────
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
        await storeAi.insertGdeltEvents(result.data);
        console.log(
          `[scheduler] gdelt: persisted ${result.data.length} events (stale=${result.stale})`,
        );
      } else {
        console.warn('[scheduler] gdelt: connector returned empty data — skipping insert');
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
      const beforeMs = Date.now() - RETENTION_MS;
      await storeAi.purgeAndDownsample(beforeMs);
      console.log(
        `[scheduler] daily: purgeAndDownsample before ${new Date(beforeMs).toISOString()} complete`,
      );
    },
  };

  return [marketsJob, gdeltJob, newsJob, dailyJob];
}
