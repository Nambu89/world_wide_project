// packages/scheduler/test/scheduler.test.ts
// node:test — no real network, no real DB, no real LLM.
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

import type { MarketSnapshot, GdeltEvent, NewsItem, Briefing } from '@www/store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Mock factory ─────────────────────────────────────────────────────────────

interface MockOptions {
  emptyMarkets?: boolean;
  throwOnMarkets?: boolean;
}

interface TrackingDeps extends SchedulerDeps {
  // tracking counters
  fetchMarketsCalled: number;
  fetchGdeltCalled: number;
  fetchNewsCalled: number;
  insertedMarkets: MarketSnapshot[];
  insertedGdelt: GdeltEvent[];
  insertedNews: NewsItem[];
  briefingCalled: number;
  purgeCalled: number;
  purgeCalledWithMs: number[];
}

function makeDeps(opts: MockOptions = {}): TrackingDeps {
  const tracking: TrackingDeps = {
    // ── Tracking state ────────────────────────────────────────────────────
    fetchMarketsCalled: 0,
    fetchGdeltCalled: 0,
    fetchNewsCalled: 0,
    insertedMarkets: [],
    insertedGdelt: [],
    insertedNews: [],
    briefingCalled: 0,
    purgeCalled: 0,
    purgeCalledWithMs: [],

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
            source: 'mock',
            symbol: 'BTC',
            asset_class: 'crypto',
            price: 60_000,
            change_pct: 1.5,
            captured_at: Date.now(),
          },
        ],
        stale: false,
        fetchedAt: Date.now(),
      };
    },

    async fetchGdelt(): Promise<ConnectorResult<GdeltEvent>> {
      tracking.fetchGdeltCalled++;
      return {
        data: [
          {
            source: 'gdelt',
            event_id: 'EV001',
            category: 'conflict',
            severity: 0.7,
            lat: 40.4,
            lon: -3.7,
            captured_at: Date.now(),
          },
        ],
        stale: false,
        fetchedAt: Date.now(),
      };
    },

    async fetchNews(): Promise<ConnectorResult<NewsItem>> {
      tracking.fetchNewsCalled++;
      return {
        data: [
          {
            source: 'rss',
            feed_domain: 'example.com',
            title: 'Test headline',
            url: 'https://example.com/news/1',
            published_at: Date.now() - 3_600_000,
            captured_at: Date.now(),
          },
        ],
        stale: false,
        fetchedAt: Date.now(),
      };
    },

    // ── Store mocks ───────────────────────────────────────────────────────
    async insertMarketSnapshots(rows: MarketSnapshot[]): Promise<void> {
      tracking.insertedMarkets.push(...rows);
    },

    async insertGdeltEvents(rows: GdeltEvent[]): Promise<void> {
      tracking.insertedGdelt.push(...rows);
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
        domain: 'finance',
        body_md: 'Mock briefing body.',
        model: 'mock-model',
        created_at: now,
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
      name: 'test-job',
      tier: 'fast',
      intervalMs: 15,
      async run() { callCount++; },
    };

    const scheduler = createScheduler([job]);
    scheduler.start();
    await sleep(55);
    scheduler.stop();

    // immediate + at least 2 intervals within 55ms at 15ms each
    assert.ok(callCount >= 2, `Expected ≥ 2 calls, got ${callCount}`);
  });

  it('stop() prevents further executions', async () => {
    let callCount = 0;

    const job: Job = {
      name: 'stop-test',
      tier: 'slow',
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
    let badCount = 0;

    const badJob: Job = {
      name: 'bad-job',
      tier: 'fast',
      intervalMs: 15,
      async run() {
        badCount++;
        throw new Error('intentional failure');
      },
    };

    const goodJob: Job = {
      name: 'good-job',
      tier: 'fast',
      intervalMs: 15,
      async run() { goodCount++; },
    };

    const scheduler = createScheduler([badJob, goodJob]);
    scheduler.start();
    await sleep(50);
    scheduler.stop();

    assert.ok(badCount >= 1, `Bad job should still have run (count=${badCount})`);
    assert.ok(goodCount >= 1, `Good job should have run despite failing neighbor (count=${goodCount})`);
  });

  it('start() is idempotent — calling twice does not duplicate intervals', async () => {
    let callCount = 0;

    const job: Job = {
      name: 'idempotent-test',
      tier: 'fast',
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
    assert.ok(callCount <= 4, `Expected ≤ 4 with idempotent start, got ${callCount}`);
  });

  it('intervals are read from Job.intervalMs — fast fires more often than slow', async () => {
    let fastCount = 0;
    let slowCount = 0;

    const fastJob: Job = {
      name: 'fast-cfg',
      tier: 'fast',
      intervalMs: 12,
      async run() { fastCount++; },
    };

    const slowJob: Job = {
      name: 'slow-cfg',
      tier: 'slow',
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
    // Record the wall-clock order in which each job COMPLETES its first run.
    const completionOrder: string[] = [];

    // Non-daily jobs resolve immediately; daily resolves after a tiny delay
    // (just to make the ordering assertion meaningful even if JS is fast).
    const fastJob: Job = {
      name: 'boot-fast',
      tier: 'fast',
      // Long interval so the interval callback never fires during the test.
      intervalMs: 60_000,
      async run() {
        completionOrder.push('fast');
      },
    };

    const mediumJob: Job = {
      name: 'boot-medium',
      tier: 'medium',
      intervalMs: 60_000,
      async run() {
        completionOrder.push('medium');
      },
    };

    const slowJob: Job = {
      name: 'boot-slow',
      tier: 'slow',
      intervalMs: 60_000,
      async run() {
        completionOrder.push('slow');
      },
    };

    const dailyJob: Job = {
      name: 'boot-daily',
      tier: 'daily',
      intervalMs: 60_000,
      async run() {
        completionOrder.push('daily');
      },
    };

    // Intentionally pass daily FIRST in the array to prove the scheduler
    // re-orders by tier, not by array position.
    const scheduler = createScheduler([dailyJob, fastJob, mediumJob, slowJob]);
    scheduler.start();

    // Give enough time for the async boot sequence to complete.
    await sleep(100);
    scheduler.stop();

    // All 4 jobs must have run exactly once during boot.
    assert.equal(completionOrder.length, 4, `Expected 4 boot runs, got ${completionOrder.length}: ${completionOrder.join(',')}`);

    // daily must be the LAST entry.
    assert.equal(
      completionOrder[completionOrder.length - 1],
      'daily',
      `daily must run last during boot; order was: ${completionOrder.join(' → ')}`,
    );

    // All non-daily jobs must appear BEFORE daily.
    const dailyIndex = completionOrder.indexOf('daily');
    const nonDailyNames = ['fast', 'medium', 'slow'];
    for (const name of nonDailyNames) {
      const idx = completionOrder.indexOf(name);
      assert.ok(idx !== -1, `${name} job did not run during boot`);
      assert.ok(
        idx < dailyIndex,
        `${name} (index ${idx}) must complete before daily (index ${dailyIndex}); order: ${completionOrder.join(' → ')}`,
      );
    }
  });
});

// ─── Test suite: defaultJobs ──────────────────────────────────────────────────

describe('defaultJobs', () => {
  it('returns exactly 4 jobs covering all tiers', () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    assert.equal(jobs.length, 4);

    const tiers = new Set(jobs.map((j) => j.tier));
    assert.ok(tiers.has('fast'),   'should have fast tier');
    assert.ok(tiers.has('medium'), 'should have medium tier');
    assert.ok(tiers.has('slow'),   'should have slow tier');
    assert.ok(tiers.has('daily'),  'should have daily tier');
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

    assert.equal(deps.fetchMarketsCalled, 1, 'fetchMarkets called once');
    assert.equal(deps.insertedMarkets.length, 1, '1 market snapshot inserted');
    assert.equal(deps.insertedMarkets[0]?.symbol, 'BTC');
  });

  it('gdelt job: fetchGdelt() called → events inserted into store', async () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    const gdeltJob = jobs.find((j) => j.name === 'gdelt');
    assert.ok(gdeltJob, 'gdelt job not found');

    await gdeltJob.run();

    assert.equal(deps.fetchGdeltCalled, 1, 'fetchGdelt called once');
    assert.equal(deps.insertedGdelt.length, 1, '1 gdelt event inserted');
    assert.equal(deps.insertedGdelt[0]?.event_id, 'EV001');
  });

  it('news job: fetchNews() called → items inserted into store', async () => {
    const deps = makeDeps();
    const jobs = defaultJobs(undefined, deps);
    const newsJob = jobs.find((j) => j.name === 'news');
    assert.ok(newsJob, 'news job not found');

    await newsJob.run();

    assert.equal(deps.fetchNewsCalled, 1, 'fetchNews called once');
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
    assert.equal(deps.purgeCalled, 1, 'purgeAndDownsample called once');
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
    assert.ok(purgeMs <= after - NINETY_DAYS_MS + 5_000, 'purgeMs not in the future');
  });

  it('a failing daily job inside scheduler does not stop other jobs', async () => {
    let goodCount = 0;

    const failingDaily: Job = {
      name: 'daily',
      tier: 'daily',
      intervalMs: 15,
      async run() { throw new Error('daily boom'); },
    };

    const goodJob: Job = {
      name: 'good',
      tier: 'fast',
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
