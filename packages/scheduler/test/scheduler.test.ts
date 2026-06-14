// packages/scheduler/test/scheduler.test.ts
// node:test — no real network, no real DB, no real LLM.
//
// T-11: tests updated to cover usgs(fast)/eonet(medium)/gdelt(medium) jobs
// that persist via upsertEvents; verify insertGdeltEvents is GONE from all paths.
//
// Run via:
//   node --import tsx --test packages/scheduler/test/scheduler.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createScheduler,
  defaultJobs,
  type Job,
  type SchedulerDeps,
  type ConnectorResult,
} from '../src/index.js';

import type { MarketSnapshot, NewsItem, Briefing, EventRow } from '@www/store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Fixture EventRow factory ──────────────────────────────────────────────────

function makeEventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    source:        overrides.source        ?? 'usgs',
    sourceEventId: overrides.sourceEventId ?? 'EV-001',
    eventType:     overrides.eventType     ?? 'earthquake',
    category:      overrides.category      ?? 'natural',
    severity:      overrides.severity      ?? 55,
    lat:           overrides.lat           ?? 37.5,
    lon:           overrides.lon           ?? -122.1,
    country:       overrides.country       ?? 'us',
    title:         overrides.title         ?? '5.0 km S of test city',
    url:           overrides.url           ?? 'https://earthquake.usgs.gov/test',
    occurredAt:    overrides.occurredAt    ?? Date.now() - 3_600_000,
    capturedAt:    overrides.capturedAt    ?? Date.now(),
    rawJson:       overrides.rawJson       ?? '{}',
  };
}

// ─── Mock factory ─────────────────────────────────────────────────────────────

interface MockOptions {
  emptyMarkets?: boolean;
  throwOnMarkets?: boolean;
  emptyUsgs?: boolean;
  emptyEonet?: boolean;
  emptyGdelt?: boolean;
}

interface TrackingDeps extends SchedulerDeps {
  // tracking counters
  fetchMarketsCalled: number;
  fetchUsgsCalled:    number;
  fetchEonetCalled:   number;
  fetchGdeltCalled:   number;
  fetchNewsCalled:    number;
  insertedMarkets:    MarketSnapshot[];
  upsertedEvents:     EventRow[];
  insertedNews:       NewsItem[];
  briefingCalled:     number;
  purgeCalled:        number;
  purgeCalledWithMs:  number[];
}

function makeDeps(opts: MockOptions = {}): TrackingDeps {
  const tracking: TrackingDeps = {
    // ── Tracking state ────────────────────────────────────────────────────
    fetchMarketsCalled: 0,
    fetchUsgsCalled:    0,
    fetchEonetCalled:   0,
    fetchGdeltCalled:   0,
    fetchNewsCalled:    0,
    insertedMarkets:    [],
    upsertedEvents:     [],
    insertedNews:       [],
    briefingCalled:     0,
    purgeCalled:        0,
    purgeCalledWithMs:  [],

    // ── Connector mocks ───────────────────────────────────────────────────
    async fetchMarkets(): Promise<ConnectorResult<MarketSnapshot>> {
      tracking.fetchMarketsCalled++;
      if (opts.throwOnMarkets) throw new Error('mock connector error');
      if (opts.emptyMarkets) {
        return { data: [], stale: false, fetchedAt: Date.now() };
      }
      return {
        data: [
          {
            source:      'mock',
            symbol:      'BTC',
            asset_class: 'crypto',
            price:       60_000,
            change_pct:  1.5,
            captured_at: Date.now(),
          },
        ],
        stale:     false,
        fetchedAt: Date.now(),
      };
    },

    async fetchUsgs(): Promise<ConnectorResult<EventRow>> {
      tracking.fetchUsgsCalled++;
      if (opts.emptyUsgs) return { data: [], stale: false, fetchedAt: Date.now() };
      return {
        data:      [makeEventRow({ source: 'usgs', sourceEventId: 'usgs-001', eventType: 'earthquake' })],
        stale:     false,
        fetchedAt: Date.now(),
      };
    },

    async fetchEonet(): Promise<ConnectorResult<EventRow>> {
      tracking.fetchEonetCalled++;
      if (opts.emptyEonet) return { data: [], stale: false, fetchedAt: Date.now() };
      return {
        data:      [makeEventRow({ source: 'eonet', sourceEventId: 'EONET_20442', eventType: 'wildfire' })],
        stale:     false,
        fetchedAt: Date.now(),
      };
    },

    async fetchGdelt(): Promise<ConnectorResult<EventRow>> {
      tracking.fetchGdeltCalled++;
      if (opts.emptyGdelt) return { data: [], stale: false, fetchedAt: Date.now() };
      return {
        data:      [makeEventRow({ source: 'gdelt', sourceEventId: 'gdelt-900000001', eventType: 'conflict', category: 'conflict' })],
        stale:     false,
        fetchedAt: Date.now(),
      };
    },

    async fetchNews(): Promise<ConnectorResult<NewsItem>> {
      tracking.fetchNewsCalled++;
      return {
        data: [
          {
            source:       'rss',
            feed_domain:  'example.com',
            title:        'Test headline',
            url:          'https://example.com/news/1',
            published_at: Date.now() - 3_600_000,
            captured_at:  Date.now(),
          },
        ],
        stale:     false,
        fetchedAt: Date.now(),
      };
    },

    // ── Store mocks ───────────────────────────────────────────────────────
    async insertMarketSnapshots(rows: MarketSnapshot[]): Promise<void> {
      tracking.insertedMarkets.push(...rows);
    },

    async upsertEvents(rows: EventRow[]): Promise<void> {
      tracking.upsertedEvents.push(...rows);
    },

    async insertNewsItems(rows: NewsItem[]): Promise<void> {
      tracking.insertedNews.push(...rows);
    },

    async purgeAndDownsample(beforeMs: number): Promise<void> {
      tracking.purgeCalled++;
      tracking.purgeCalledWithMs.push(beforeMs);
    },

    // ── AI mock ───────────────────────────────────────────────────────────
    async generateDailyBriefing(): Promise<Briefing> {
      tracking.briefingCalled++;
      const now = Date.now();
      return {
        domain:      'finance',
        body_md:     'Mock briefing body.',
        model:       'mock-model',
        created_at:  now,
        valid_until: now + 86_400_000,
      };
    },
  };

  return tracking;
}

// ─── Test suite: createScheduler ──────────────────────────────────────────────

describe('createScheduler', () => {
  it('calls run() on start and fires on subsequent intervals', async () => {
    let callCount = 0;

    const job: Job = {
      name:      'test-job',
      tier:      'fast',
      intervalMs: 15,
      async run() { callCount++; },
    };

    const scheduler = createScheduler([job]);
    scheduler.start();
    await sleep(55);
    scheduler.stop();

    // immediate + at least 2 intervals within 55ms at 15ms each
    assert.ok(callCount >= 2, `Expected >= 2 calls, got ${callCount}`);
  });

  it('stop() prevents further executions', async () => {
    let callCount = 0;

    const job: Job = {
      name:      'stop-test',
      tier:      'slow',
      intervalMs: 20,
      async run() { callCount++; },
    };

    const scheduler = createScheduler([job]);
    scheduler.start();
    await sleep(10);   // let the immediate run fire
    scheduler.stop();
    const countAtStop = callCount;

    await sleep(60);   // well past one extra interval
    assert.equal(callCount, countAtStop, 'No executions should fire after stop()');
  });

  it('a failing job does not crash the scheduler or other jobs', async () => {
    let goodCount = 0;
    let badCount  = 0;

    const badJob: Job = {
      name:      'bad-job',
      tier:      'fast',
      intervalMs: 15,
      async run() {
        badCount++;
        throw new Error('intentional failure');
      },
    };

    const goodJob: Job = {
      name:      'good-job',
      tier:      'fast',
      intervalMs: 15,
      async run() { goodCount++; },
    };

    const scheduler = createScheduler([badJob, goodJob]);
    scheduler.start();
    await sleep(50);
    scheduler.stop();

    assert.ok(badCount  >= 1, `Bad job should still have run (count=${badCount})`);
    assert.ok(goodCount >= 1, `Good job should have run despite failing neighbor (count=${goodCount})`);
  });

  it('start() is idempotent — calling twice does not duplicate intervals', async () => {
    let callCount = 0;

    const job: Job = {
      name:      'idempotent-test',
      tier:      'fast',
      intervalMs: 20,
      async run() { callCount++; },
    };

    const scheduler = createScheduler([job]);
    scheduler.start();
    scheduler.start(); // second call must be a no-op

    await sleep(55);
    scheduler.stop();

    // single start: immediate + ~2 intervals = ~3 calls in 55ms
    // double start (broken): would double those, so ~6
    assert.ok(callCount <= 4, `Expected <= 4 with idempotent start, got ${callCount}`);
  });

  it('intervals are read from Job.intervalMs — fast fires more often than slow', async () => {
    let fastCount = 0;
    let slowCount = 0;

    const fastJob: Job = {
      name:      'fast-cfg',
      tier:      'fast',
      intervalMs: 12,
      async run() { fastCount++; },
    };

    const slowJob: Job = {
      name:      'slow-cfg',
      tier:      'slow',
      intervalMs: 30,
      async run() { slowCount++; },
    };

    const scheduler = createScheduler([fastJob, slowJob]);
    scheduler.start();
    await sleep(70);
    scheduler.stop();

    assert.ok(
      fastCount > slowCount,
      `fast (${fastCount}) should fire more often than slow (${slowCount})`,
    );
  });

  it('boot order: daily job first-run fires AFTER all non-daily jobs complete', async () => {
    const completionOrder: string[] = [];

    const fastJob: Job = {
      name:      'boot-fast',
      tier:      'fast',
      intervalMs: 60_000,
      async run() { completionOrder.push('fast'); },
    };

    const mediumJob: Job = {
      name:      'boot-medium',
      tier:      'medium',
      intervalMs: 60_000,
      async run() { completionOrder.push('medium'); },
    };

    const slowJob: Job = {
      name:      'boot-slow',
      tier:      'slow',
      intervalMs: 60_000,
      async run() { completionOrder.push('slow'); },
    };

    const dailyJob: Job = {
      name:      'boot-daily',
      tier:      'daily',
      intervalMs: 60_000,
      async run() { completionOrder.push('daily'); },
    };

    // Intentionally pass daily FIRST to prove scheduler re-orders by tier, not position.
    const scheduler = createScheduler([dailyJob, fastJob, mediumJob, slowJob]);
    scheduler.start();

    await sleep(100);
    scheduler.stop();

    assert.equal(completionOrder.length, 4, `Expected 4 boot runs, got ${completionOrder.length}: ${completionOrder.join(',')}`);

    // daily must be the LAST entry.
    assert.equal(
      completionOrder[completionOrder.length - 1],
      'daily',
      `daily must run last during boot; order was: ${completionOrder.join(' -> ')}`,
    );

    // All non-daily jobs must appear BEFORE daily.
    const dailyIndex = completionOrder.indexOf('daily');
    const nonDailyNames = ['fast', 'medium', 'slow'];
    for (const name of nonDailyNames) {
      const idx = completionOrder.indexOf(name);
      assert.ok(idx !== -1, `${name} job did not run during boot`);
      assert.ok(
        idx < dailyIndex,
        `${name} (index ${idx}) must complete before daily (index ${dailyIndex}); order: ${completionOrder.join(' -> ')}`,
      );
    }
  });
});

// ─── Test suite: defaultJobs ──────────────────────────────────────────────────

describe('defaultJobs', () => {
  // T-11: now 6 jobs (markets/usgs/eonet/gdelt/news/daily)
  it('returns exactly 6 jobs: markets/usgs/eonet/gdelt/news/daily', () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    assert.equal(jobs.length, 6, `Expected 6 jobs, got ${jobs.length}: ${jobs.map((j) => j.name).join(',')}`);

    const names = jobs.map((j) => j.name);
    assert.ok(names.includes('markets'), 'should include markets job');
    assert.ok(names.includes('usgs'),    'should include usgs job');
    assert.ok(names.includes('eonet'),   'should include eonet job');
    assert.ok(names.includes('gdelt'),   'should include gdelt job');
    assert.ok(names.includes('news'),    'should include news job');
    assert.ok(names.includes('daily'),   'should include daily job');
  });

  // T-11: verify tier assignments per D-105
  it('usgs=fast, eonet=medium, gdelt=medium per D-105', () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);

    const byName = Object.fromEntries(jobs.map((j) => [j.name, j]));

    assert.equal(byName['usgs']?.tier,    'fast',   'usgs must be fast tier (D-105)');
    assert.equal(byName['eonet']?.tier,   'medium', 'eonet must be medium tier (D-105)');
    assert.equal(byName['gdelt']?.tier,   'medium', 'gdelt must be medium tier (D-105)');
    assert.equal(byName['markets']?.tier, 'fast',   'markets must be fast tier');
    assert.equal(byName['news']?.tier,    'slow',   'news must be slow tier');
    assert.equal(byName['daily']?.tier,   'daily',  'daily must be daily tier');
  });

  // T-11: return order must be [markets, usgs, eonet, gdelt, news, daily]
  it('job order is [markets, usgs, eonet, gdelt, news, daily]', () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    const order = jobs.map((j) => j.name);
    assert.deepEqual(order, ['markets', 'usgs', 'eonet', 'gdelt', 'news', 'daily']);
  });

  it('uses custom intervals from cfg', () => {
    const deps = makeDeps();
    const cfg = { fast: 1111, medium: 2222, slow: 3333, daily: 4444 };
    const jobs = defaultJobs(cfg, deps);

    for (const job of jobs) {
      assert.equal(
        job.intervalMs,
        cfg[job.tier],
        `${job.name}: expected intervalMs=${cfg[job.tier]}, got ${job.intervalMs}`,
      );
    }
  });

  it('markets job: fetchMarkets() called → snapshots inserted into store', async () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    const marketsJob = jobs.find((j) => j.name === 'markets');
    assert.ok(marketsJob, 'markets job not found');

    await marketsJob.run();

    assert.equal(deps.fetchMarketsCalled,    1,     'fetchMarkets called once');
    assert.equal(deps.insertedMarkets.length, 1,    '1 market snapshot inserted');
    assert.equal(deps.insertedMarkets[0]?.symbol, 'BTC');
  });

  // T-11: usgs job calls upsertEvents, NOT insertGdeltEvents
  it('usgs job: fetchUsgs() called → upsertEvents called with EventRow data', async () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    const usgsJob = jobs.find((j) => j.name === 'usgs');
    assert.ok(usgsJob, 'usgs job not found');

    await usgsJob.run();

    assert.equal(deps.fetchUsgsCalled,     1, 'fetchUsgs called once');
    assert.equal(deps.upsertedEvents.length, 1, '1 event upserted');
    assert.equal(deps.upsertedEvents[0]?.source,    'usgs');
    assert.equal(deps.upsertedEvents[0]?.eventType, 'earthquake');
  });

  // T-11: eonet job calls upsertEvents
  it('eonet job: fetchEonet() called → upsertEvents called with EventRow data', async () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    const eonetJob = jobs.find((j) => j.name === 'eonet');
    assert.ok(eonetJob, 'eonet job not found');

    await eonetJob.run();

    assert.equal(deps.fetchEonetCalled,    1, 'fetchEonet called once');
    assert.equal(deps.upsertedEvents.length, 1, '1 event upserted');
    assert.equal(deps.upsertedEvents[0]?.source,    'eonet');
    assert.equal(deps.upsertedEvents[0]?.eventType, 'wildfire');
  });

  // T-11: gdelt job now calls upsertEvents (EventRow), NOT insertGdeltEvents (GdeltEvent)
  it('gdelt job: fetchGdelt() returns EventRow → upsertEvents called (NOT insertGdeltEvents)', async () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    const gdeltJob = jobs.find((j) => j.name === 'gdelt');
    assert.ok(gdeltJob, 'gdelt job not found');

    await gdeltJob.run();

    assert.equal(deps.fetchGdeltCalled,    1, 'fetchGdelt called once');
    assert.equal(deps.upsertedEvents.length, 1, '1 event upserted via upsertEvents');
    assert.equal(deps.upsertedEvents[0]?.source,    'gdelt');
    assert.equal(deps.upsertedEvents[0]?.eventType, 'conflict');

    // Verify no reference to insertGdeltEvents in SchedulerDeps (type-level; runtime confirms there is no such property)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.ok(!('insertGdeltEvents' in deps), 'insertGdeltEvents must not be part of SchedulerDeps');
  });

  // T-11: multiple event jobs accumulate to upsertEvents (all share the same dep)
  it('usgs + eonet + gdelt all accumulate via shared upsertEvents dep', async () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);

    const usgsJob  = jobs.find((j) => j.name === 'usgs')!;
    const eonetJob = jobs.find((j) => j.name === 'eonet')!;
    const gdeltJob = jobs.find((j) => j.name === 'gdelt')!;

    await usgsJob.run();
    await eonetJob.run();
    await gdeltJob.run();

    assert.equal(deps.upsertedEvents.length, 3, 'All 3 event jobs call upsertEvents (1 row each)');
    const sources = deps.upsertedEvents.map((e) => e.source);
    assert.ok(sources.includes('usgs'),  'usgs event persisted');
    assert.ok(sources.includes('eonet'), 'eonet event persisted');
    assert.ok(sources.includes('gdelt'), 'gdelt event persisted');
  });

  it('news job: fetchNews() called → items inserted into store', async () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    const newsJob = jobs.find((j) => j.name === 'news');
    assert.ok(newsJob, 'news job not found');

    await newsJob.run();

    assert.equal(deps.fetchNewsCalled,    1, 'fetchNews called once');
    assert.equal(deps.insertedNews.length, 1, '1 news item inserted');
    assert.equal(deps.insertedNews[0]?.feed_domain, 'example.com');
  });

  it('markets job: skips insert when connector returns empty data', async () => {
    const deps = makeDeps({ emptyMarkets: true });
    const jobs = defaultJobs(undefined, deps);
    const marketsJob = jobs.find((j) => j.name === 'markets')!;

    await marketsJob.run();

    assert.equal(deps.insertedMarkets.length, 0, 'no insert when connector returns empty');
    assert.equal(deps.fetchMarketsCalled, 1, 'connector still called even if empty');
  });

  it('usgs job: skips upsert when connector returns empty data', async () => {
    const deps = makeDeps({ emptyUsgs: true });
    const jobs = defaultJobs(undefined, deps);
    const usgsJob = jobs.find((j) => j.name === 'usgs')!;

    await usgsJob.run();

    assert.equal(deps.upsertedEvents.length, 0, 'no upsert when usgs returns empty');
    assert.equal(deps.fetchUsgsCalled, 1, 'fetchUsgs still called even if empty');
  });

  it('eonet job: skips upsert when connector returns empty data', async () => {
    const deps = makeDeps({ emptyEonet: true });
    const jobs = defaultJobs(undefined, deps);
    const eonetJob = jobs.find((j) => j.name === 'eonet')!;

    await eonetJob.run();

    assert.equal(deps.upsertedEvents.length, 0, 'no upsert when eonet returns empty');
    assert.equal(deps.fetchEonetCalled, 1, 'fetchEonet still called even if empty');
  });

  it('gdelt job: skips upsert when connector returns empty data', async () => {
    const deps = makeDeps({ emptyGdelt: true });
    const jobs = defaultJobs(undefined, deps);
    const gdeltJob = jobs.find((j) => j.name === 'gdelt')!;

    await gdeltJob.run();

    assert.equal(deps.upsertedEvents.length, 0, 'no upsert when gdelt returns empty');
    assert.equal(deps.fetchGdeltCalled, 1, 'fetchGdelt still called even if empty');
  });

  it('markets job: throws when connector throws (scheduler wraps this)', async () => {
    const deps = makeDeps({ throwOnMarkets: true });
    const jobs = defaultJobs(undefined, deps);
    const marketsJob = jobs.find((j) => j.name === 'markets')!;

    await assert.rejects(() => marketsJob.run(), /mock connector error/);
  });

  it('daily job: calls generateDailyBriefing and purgeAndDownsample', async () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    const dailyJob = jobs.find((j) => j.name === 'daily')!;

    await dailyJob.run();

    assert.equal(deps.briefingCalled, 1, 'generateDailyBriefing called once');
    assert.equal(deps.purgeCalled,    1, 'purgeAndDownsample called once');
  });

  it('daily job: purgeAndDownsample receives beforeMs = now - 90 days (approx)', async () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    const dailyJob = jobs.find((j) => j.name === 'daily')!;

    const before = Date.now();
    await dailyJob.run();
    const after = Date.now();

    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const purgeMs = deps.purgeCalledWithMs[0];
    assert.ok(purgeMs !== undefined, 'purgeAndDownsample should have been called');
    // beforeMs should be approximately (now - 90d) — allow 5s slack
    assert.ok(purgeMs >= before - NINETY_DAYS_MS - 5_000, 'purgeMs not too old');
    assert.ok(purgeMs <= after  - NINETY_DAYS_MS + 5_000, 'purgeMs not in the future');
  });

  it('a failing daily job inside scheduler does not stop other jobs', async () => {
    let goodCount = 0;

    const failingDaily: Job = {
      name:      'daily',
      tier:      'daily',
      intervalMs: 15,
      async run() { throw new Error('daily boom'); },
    };

    const goodJob: Job = {
      name:      'good',
      tier:      'fast',
      intervalMs: 15,
      async run() { goodCount++; },
    };

    const scheduler = createScheduler([failingDaily, goodJob]);
    scheduler.start();
    await sleep(50);
    scheduler.stop();

    assert.ok(goodCount >= 1, `good job ran ${goodCount} times even with failing daily job`);
  });
});
