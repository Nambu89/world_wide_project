// packages/scheduler/src/index.ts
// @www/scheduler — T-11 implementation (Wave C, Fase 2 global-events)
//                  T-18: gkg job (medium tier) — signals pipeline
//                  T-24: cii job (medium tier) — CII scoring pipeline
//                  T-37: sanctions job (slow tier) — OFAC sanctions pipeline
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
// T-18 changes:
//   - SchedulerDeps: adds fetchGkg (SignalRow) + upsertSignals.
//   - ConnectorDeps: adds 'fetchGkg'.
//   - REAL_STORE_AI_DEPS: adds upsertSignals.
//   - loadDefaultConnectors: adds fetchGkg.
//   - defaultJobs: adds gkg (medium) job after gdelt.
//   - Return order: [markets, usgs, eonet, gdelt, gkg, news, daily].
// T-24 changes:
//   - SchedulerDeps: adds computeAllCountries, getPriorCii, insertCiiSnapshots.
//   - REAL_STORE_AI_DEPS: adds getPriorCii + insertCiiSnapshots.
//   - defaultJobs: adds cii (medium) job after gkg.
//   - Return order: [markets, usgs, eonet, gdelt, gkg, cii, news, daily].
// T-37 changes:
//   - SchedulerDeps: adds fetchSanctions (SanctionRow) + insertSanctions.
//   - ConnectorDeps: adds 'fetchSanctions'.
//   - REAL_STORE_AI_DEPS: adds insertSanctions.
//   - loadDefaultConnectors: adds fetchSanctions.
//   - defaultJobs: adds sanctions (slow) job after news.
//   - Return order: [markets, usgs, eonet, gdelt, gkg, cii, news, sanctions, daily].

import {
  insertMarketSnapshots,
  insertNewsItems,
  upsertEvents,
  upsertSignals,
  insertCiiSnapshots,
  getPriorCii,
  insertConvergenceSignals,
  insertSanctions,
  purgeAndDownsample,
  type MarketSnapshot,
  type NewsItem,
  type EventRow,
  type SignalRow,
  type CiiSnapshotRow,
  type ConvergenceSignalRow,
  type SanctionRow,
} from '@www/store';

import { generateDailyBriefing } from '@www/core-ai';
import type { Briefing } from '@www/store';

import { computeAllCountries, computeDynamic, type CiiScore } from '@www/core-cii';

// T-31: convergencia encadenada DENTRO del job cii (orden por construcción, C-4/D-312).
import { detectAllConvergence } from '@www/core-signals';

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
 * T-18: adds fetchGkg (ConnectorResult<SignalRow>) + upsertSignals.
 * T-24: adds computeAllCountries (@www/core-cii), getPriorCii + insertCiiSnapshots (@www/store).
 */
export interface SchedulerDeps {
  // Connector fetchers
  fetchMarkets: () => Promise<ConnectorResult<MarketSnapshot>>;
  fetchUsgs:    () => Promise<ConnectorResult<EventRow>>;
  fetchEonet:   () => Promise<ConnectorResult<EventRow>>;
  fetchGdelt:   () => Promise<ConnectorResult<EventRow>>;
  fetchGkg:        () => Promise<ConnectorResult<SignalRow>>;
  fetchSanctions:  () => Promise<ConnectorResult<SanctionRow>>;
  fetchNews:       () => Promise<ConnectorResult<NewsItem>>;

  // Store writes (@www/store) — defaults to real implementations
  insertMarketSnapshots: (rows: MarketSnapshot[])    => Promise<void>;
  upsertEvents:          (rows: EventRow[])           => Promise<void>;
  upsertSignals:         (rows: SignalRow[])           => Promise<void>;
  insertNewsItems:       (rows: NewsItem[])            => Promise<void>;
  insertSanctions:       (rows: SanctionRow[])         => Promise<void>;
  purgeAndDownsample:    (beforeMs: number)            => Promise<void>;

  // CII pipeline (@www/core-cii + @www/store) — T-24
  computeAllCountries: (nowMs: number) => Promise<CiiScore[]>;
  getPriorCii:         (country: string, aroundMs: number) => Promise<CiiSnapshotRow | null>;
  insertCiiSnapshots:  (rows: CiiSnapshotRow[]) => Promise<void>;

  // Convergence pipeline (@www/core-signals + @www/store) — T-31
  // Encadenada dentro del job cii (orden por construcción, C-4/D-312).
  detectAllConvergence:     (nowMs: number) => Promise<ConvergenceSignalRow[]>;
  insertConvergenceSignals: (rows: ConvergenceSignalRow[]) => Promise<void>;

  // AI pipeline (@www/core-ai) — defaults to real implementation
  generateDailyBriefing: () => Promise<Briefing>;
}

// ConnectorDeps type alias (backwards compat — server.ts uses SchedulerDeps directly)
export type ConnectorDeps = Pick<
  SchedulerDeps,
  'fetchMarkets' | 'fetchUsgs' | 'fetchEonet' | 'fetchGdelt' | 'fetchGkg' | 'fetchSanctions' | 'fetchNews'
>;

/**
 * Real (production) implementations of store + ai deps.
 * insertGdeltEvents intentionally omitted — no longer in SchedulerDeps (T-11).
 * T-18: upsertSignals added.
 * T-24: computeAllCountries + getPriorCii + insertCiiSnapshots added.
 */
const REAL_STORE_AI_DEPS: Pick<
  SchedulerDeps,
  | 'insertMarketSnapshots'
  | 'upsertEvents'
  | 'upsertSignals'
  | 'insertNewsItems'
  | 'insertSanctions'
  | 'purgeAndDownsample'
  | 'computeAllCountries'
  | 'getPriorCii'
  | 'insertCiiSnapshots'
  | 'detectAllConvergence'
  | 'insertConvergenceSignals'
  | 'generateDailyBriefing'
> = {
  insertMarketSnapshots,
  upsertEvents,
  upsertSignals,
  insertNewsItems,
  insertSanctions,
  purgeAndDownsample,
  computeAllCountries,
  getPriorCii,
  insertCiiSnapshots,
  detectAllConvergence,
  insertConvergenceSignals,
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
    fetchMarkets:    mod.fetchMarkets    as ConnectorDeps['fetchMarkets'],
    fetchUsgs:       mod.fetchUsgs       as ConnectorDeps['fetchUsgs'],
    fetchEonet:      mod.fetchEonet      as ConnectorDeps['fetchEonet'],
    fetchGdelt:      mod.fetchGdelt      as ConnectorDeps['fetchGdelt'],
    fetchGkg:        mod.fetchGkg        as ConnectorDeps['fetchGkg'],
    fetchSanctions:  mod.fetchSanctions  as ConnectorDeps['fetchSanctions'],
    fetchNews:       mod.fetchNews       as ConnectorDeps['fetchNews'],
  };
}

// ─── Default jobs factory ─────────────────────────────────────────────────────

/**
 * Builds the production jobs:
 *   markets (fast) · usgs (fast) · eonet (medium) · gdelt (medium) · gkg (medium) · cii (medium) · news (slow) · sanctions (slow) · daily
 *
 * T-11: gdelt-financial job (insertGdeltEvents → gdelt_events) REPLACED by gdelt-events
 * job (upsertEvents → events). usgs + eonet jobs ADDED. Order: [markets, usgs, eonet,
 * gdelt, news, daily]. Mantiene la firma defaultJobs(cfg?, deps?): Job[] que usa server.ts.
 * T-18: gkg job (medium tier, upsertSignals) ADDED after gdelt.
 * Order: [markets, usgs, eonet, gdelt, gkg, news, daily].
 * T-24: cii job (medium tier, insertCiiSnapshots) ADDED after gkg (D-211).
 * Order: [markets, usgs, eonet, gdelt, gkg, cii, news, daily].
 * T-37: sanctions job (slow tier, insertSanctions) ADDED after news.
 * Order: [markets, usgs, eonet, gdelt, gkg, cii, news, sanctions, daily].
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

  // ── gkg job (medium tier) — T-18: GKG signals pipeline ───────────────────
  // D-204: tier medium (same as gdelt). Persists SignalRow[] via upsertSignals.
  // ADR-004: persist BEFORE serving.
  const gkgJob: Job = {
    name: 'gkg',
    tier: 'medium',
    intervalMs: intervals.medium,
    async run() {
      const connectors = deps?.fetchGkg
        ? { fetchGkg: deps.fetchGkg }
        : await loadDefaultConnectors();
      const result = await connectors.fetchGkg();
      if (result.data.length > 0) {
        await storeAi.upsertSignals(result.data);
        console.log(
          `[scheduler] gkg: persisted ${result.data.length} signals (stale=${result.stale})`,
        );
      } else {
        console.warn('[scheduler] gkg: connector returned empty data — skipping upsert');
      }
    },
  };

  // ── cii job (medium tier) — T-24: CII scoring pipeline + T-31: convergencia ─
  // D-211: tier medium (same as gkg/gdelt). Reads store internally via computeAllCountries.
  // ADR-004/D-002: persist snapshots BEFORE serving — insertCiiSnapshots before any read.
  // T-31 (C-4/D-312): la convergencia se encadena AL FINAL de este run() — NO como job
  // hermano — porque el scheduler corre los jobs de un tier en paralelo (Promise.all boot)
  // sin orden garantizado; encadenar aquí asegura que detectAllConvergence lee los
  // cii_snapshots recién escritos de ESTA misma corrida.
  const ciiJob: Job = {
    name: 'cii',
    tier: 'medium',
    intervalMs: intervals.medium,
    async run() {
      const now = Date.now();

      // computeAllCountries reads @www/store internally (getEventsByCountry + getSignals).
      // Inject via deps for testability; fall back to real implementation.
      const allScores = await (deps?.computeAllCountries ?? storeAi.computeAllCountries)(now);

      if (allScores.length === 0) {
        console.warn('[scheduler] cii: computeAllCountries returned 0 scores — skipping insert');
        return;
      }

      // Build CiiSnapshotRow[] — one per country.
      // getPriorCii returns CiiSnapshotRow|null; computeDynamic needs CiiScore|null.
      // Only composite is consumed by computeDynamic, so we construct a minimal adapter.
      const rows: CiiSnapshotRow[] = [];
      for (const s of allScores) {
        const priorRow = await storeAi.getPriorCii(s.country, now - 24 * 3600 * 1000);
        // Adapt CiiSnapshotRow → minimal CiiScore shape for computeDynamic
        const priorScore: CiiScore | null = priorRow
          ? {
              country:            priorRow.country,
              composite:          priorRow.composite,
              baselineRisk:       priorRow.baselineRisk,
              eventScore:         priorRow.eventScore,
              components:         [],
              methodologyVersion: priorRow.methodologyVersion,
              capturedAt:         priorRow.capturedAt,
            }
          : null;

        const dyn = computeDynamic(s, priorScore);

        rows.push({
          country:            s.country,
          composite:          s.composite,
          baselineRisk:       s.baselineRisk,
          eventScore:         s.eventScore,
          dynamicScore:       dyn.dynamicScore,
          trend:              dyn.trend,
          methodologyVersion: s.methodologyVersion,
          componentsJson:     JSON.stringify(s.components),
          capturedAt:         s.capturedAt,
        });
      }

      await storeAi.insertCiiSnapshots(rows);
      console.log(`[scheduler] cii: persisted ${rows.length} CII snapshots`);

      // ── T-31: convergencia encadenada (orden por construcción, C-4/D-312) ──
      // Lee los cii_snapshots recién escritos arriba (mismo `now`, misma corrida).
      const convSignals = await (deps?.detectAllConvergence ?? storeAi.detectAllConvergence)(now);
      if (convSignals.length > 0) {
        await storeAi.insertConvergenceSignals(convSignals);
        console.log(`[scheduler] cii→convergence: persisted ${convSignals.length} signals`);
      }
    },
  };

  // ── sanctions job (slow tier) — T-37: OFAC sanctions pipeline ───────────
  // D-105: sanctions change slowly; slow tier (30 min) matches news.
  // ADR-004: persist BEFORE serving — insertSanctions before any read.
  const sanctionsJob: Job = {
    name: 'sanctions',
    tier: 'slow',
    intervalMs: intervals.slow,
    async run() {
      const connectors = deps?.fetchSanctions
        ? { fetchSanctions: deps.fetchSanctions }
        : await loadDefaultConnectors();
      const result = await connectors.fetchSanctions();
      if (result.data.length > 0) {
        await storeAi.insertSanctions(result.data);
        console.log(
          `[scheduler] sanctions: persisted ${result.data.length} rows (stale=${result.stale})`,
        );
      } else {
        console.warn('[scheduler] sanctions: connector returned empty data — skipping insert');
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
  // T-18 order: markets · usgs · eonet · gdelt · gkg · news · daily
  // T-24 order: markets · usgs · eonet · gdelt · gkg · cii · news · daily
  // T-37 order: markets · usgs · eonet · gdelt · gkg · cii · news · sanctions · daily
  return [marketsJob, usgsJob, eonetJob, gdeltJob, gkgJob, ciiJob, newsJob, sanctionsJob, dailyJob];
}
