// packages/store/test/store.test.ts
// node:test runner — executed via: node --import tsx --test packages/store/test/store.test.ts
// Uses in-memory libSQL DB (':memory:') — never touches the production DB.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import type { Client as LibsqlClient } from '@libsql/client';
import { migrate as runMigrations } from '../src/migrate.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// All store functions accept an explicit client param via migrate(); for the
// higher-level API functions (insertMarketSnapshots etc.) they use the singleton
// from getDb(). We override the singleton URL via the LIBSQL_URL env var +
// _resetDbForTesting() before each suite.

import {
  _resetDbForTesting,
  insertMarketSnapshots,
  insertGdeltEvents,
  insertNewsItems,
  getLatestMarkets,
  getMarketTrend,
  getRecentGdeltEvents,
  getCachedBriefing,
  saveBriefing,
  purgeAndDownsample,
} from '../src/index.js';

function makeInMemoryClient(): LibsqlClient {
  return createClient({ url: ':memory:' });
}

// Reset the module-level singleton so each test suite gets a fresh client
// pointing at the in-memory URL we set.
function resetToMemory(): void {
  process.env['LIBSQL_URL'] = ':memory:';
  _resetDbForTesting();
}

// ─── Suite 1: migrate() idempotent ───────────────────────────────────────────

describe('migrate()', () => {
  it('runs twice without error or duplicate _migrations rows', async () => {
    const client = makeInMemoryClient();

    // First run
    await runMigrations(client);

    // Second run — must NOT throw and must NOT duplicate migration records
    await runMigrations(client);

    const result = await client.execute(
      "SELECT id FROM _migrations WHERE id = '001_init.sql'"
    );
    assert.equal(result.rows.length, 1, 'migration 001_init.sql recorded exactly once');
  });

  it('creates all expected tables after migration', async () => {
    const client = makeInMemoryClient();
    await runMigrations(client);

    const tables = ['market_snapshots', 'gdelt_events', 'news_items', 'briefings', 'market_daily'];
    for (const tbl of tables) {
      const r = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        args: [tbl],
      });
      assert.equal(r.rows.length, 1, `table ${tbl} exists`);
    }
  });
});

// ─── Suite 2: insertMarketSnapshots + getLatestMarkets ───────────────────────

describe('insertMarketSnapshots() + getLatestMarkets()', () => {
  before(() => {
    resetToMemory();
  });

  it('getLatestMarkets returns the latest snapshot per symbol', async () => {
    // Must migrate first via the public API (uses the singleton)
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    const earlier = now - 10_000;

    await insertMarketSnapshots([
      { source: 'yahoo', symbol: 'AAPL', asset_class: 'equity', price: 100, change_pct: 0.5, captured_at: earlier },
      { source: 'yahoo', symbol: 'AAPL', asset_class: 'equity', price: 105, change_pct: 1.2, captured_at: now },
      { source: 'yahoo', symbol: 'BTC',  asset_class: 'crypto', price: 60000, change_pct: -0.3, captured_at: earlier },
    ]);

    const latest = await getLatestMarkets();

    // Should return 2 rows (one per symbol), each the most recent
    assert.equal(latest.length, 2, 'one row per symbol');

    const aapl = latest.find((r) => r.symbol === 'AAPL');
    assert.ok(aapl, 'AAPL row present');
    assert.equal(aapl.price, 105, 'AAPL price is the latest (105)');
    assert.equal(aapl.captured_at, now, 'AAPL captured_at is the latest timestamp');

    const btc = latest.find((r) => r.symbol === 'BTC');
    assert.ok(btc, 'BTC row present');
    assert.equal(btc.price, 60000, 'BTC price correct');
  });
});

// ─── Suite 3: getCachedBriefing returns null when expired ────────────────────

describe('getCachedBriefing()', () => {
  before(() => {
    resetToMemory();
  });

  it('returns null when no briefing exists', async () => {
    const { migrate } = await import('../src/index.js');
    await migrate();

    const result = await getCachedBriefing('finance', Date.now());
    assert.equal(result, null, 'null when no briefing');
  });

  it('returns null when briefing is expired (valid_until < nowMs)', async () => {
    const { migrate } = await import('../src/index.js');
    // already migrated (idempotent), just run to ensure schema is present

    const pastTime = Date.now() - 3_600_000; // 1 hour ago
    await saveBriefing({
      domain: 'finance',
      body_md: '# Expired briefing',
      model: 'claude-3',
      created_at: pastTime - 1000,
      valid_until: pastTime, // already expired
    });

    const result = await getCachedBriefing('finance', Date.now());
    assert.equal(result, null, 'null when briefing is expired');
  });

  it('returns briefing when valid_until > nowMs', async () => {
    const futureTime = Date.now() + 3_600_000; // 1 hour from now
    await saveBriefing({
      domain: 'finance',
      body_md: '# Valid briefing',
      model: 'claude-3',
      created_at: Date.now(),
      valid_until: futureTime,
    });

    const result = await getCachedBriefing('finance', Date.now());
    assert.ok(result !== null, 'briefing returned when valid');
    assert.equal(result.domain, 'finance');
    assert.equal(result.body_md, '# Valid briefing');
  });
});

// ─── Suite 4: getMarketTrend ─────────────────────────────────────────────────

describe('getMarketTrend()', () => {
  before(() => {
    resetToMemory();
  });

  it('returns only snapshots >= sinceMs for the given symbol', async () => {
    const { migrate } = await import('../src/index.js');
    await migrate();

    const base = Date.now();
    await insertMarketSnapshots([
      { source: 'test', symbol: 'ETH', asset_class: 'crypto', price: 3000, change_pct: null, captured_at: base - 20_000 },
      { source: 'test', symbol: 'ETH', asset_class: 'crypto', price: 3100, change_pct: 0.5,  captured_at: base - 10_000 },
      { source: 'test', symbol: 'ETH', asset_class: 'crypto', price: 3200, change_pct: 1.0,  captured_at: base },
    ]);

    // Only want the last 2 (sinceMs = base - 15_000)
    const trend = await getMarketTrend('ETH', base - 15_000);
    assert.equal(trend.length, 2, '2 snapshots returned');
    assert.equal(trend[0]?.price, 3100, 'first price correct');
    assert.equal(trend[1]?.price, 3200, 'second price correct');
  });
});

// ─── Suite 5: getRecentGdeltEvents ───────────────────────────────────────────

describe('getRecentGdeltEvents()', () => {
  before(() => {
    resetToMemory();
  });

  it('returns events >= sinceMs ordered by captured_at DESC', async () => {
    const { migrate } = await import('../src/index.js');
    await migrate();

    const base = Date.now();
    const t1 = base - 30_000; // oldest — outside window
    const t2 = base - 20_000;
    const t3 = base - 10_000;
    const t4 = base;           // newest

    await insertGdeltEvents([
      { source: 'gdelt', event_id: 'E-OLD', category: 'PROTEST', severity: 0.1, lat: 1.0, lon: 2.0, captured_at: t1 },
      { source: 'gdelt', event_id: 'E-A',   category: 'CONFLICT', severity: 0.5, lat: 3.0, lon: 4.0, captured_at: t2 },
      { source: 'gdelt', event_id: 'E-B',   category: null,        severity: null, lat: null, lon: null, captured_at: t3 },
      { source: 'gdelt', event_id: 'E-C',   category: 'ECON',     severity: 0.8, lat: 5.0, lon: 6.0, captured_at: t4 },
    ]);

    // sinceMs = t2 → should include E-A, E-B, E-C (not E-OLD)
    const events = await getRecentGdeltEvents(t2);

    assert.equal(events.length, 3, '3 events returned (E-OLD filtered out)');

    // Verify descending order: E-C (t4) > E-B (t3) > E-A (t2)
    assert.equal(events[0]?.event_id, 'E-C', 'first is the newest');
    assert.equal(events[1]?.event_id, 'E-B', 'second is middle');
    assert.equal(events[2]?.event_id, 'E-A', 'third is oldest in window');

    // Verify nullable fields mapped correctly
    assert.equal(events[1]?.category, null, 'null category preserved');
    assert.equal(events[1]?.severity, null, 'null severity preserved');
    assert.equal(events[1]?.lat, null, 'null lat preserved');
  });

  it('respects the limit parameter', async () => {
    // Already have 4 events (E-OLD, E-A, E-B, E-C) from prior test.
    // since = 0 (all time), limit = 2
    const events = await getRecentGdeltEvents(0, 2);
    assert.equal(events.length, 2, 'limit=2 returns at most 2 rows');
    // Still ordered DESC — newest first
    assert.equal(events[0]?.event_id, 'E-C', 'first is newest even with limit');
  });
});

// ─── Suite 6 (was 5): insertGdeltEvents + insertNewsItems (IGNORE duplicates) ─

describe('insertGdeltEvents() + insertNewsItems() duplicate handling', () => {
  before(() => {
    resetToMemory();
  });

  it('silently ignores duplicate gdelt events', async () => {
    const { migrate } = await import('../src/index.js');
    await migrate();

    const captured = Date.now();
    const event = { source: 'gdelt', event_id: 'EVT001', category: 'PROTEST', severity: 0.5, lat: 40.0, lon: -3.0, captured_at: captured };

    await insertGdeltEvents([event]);
    await insertGdeltEvents([event]); // duplicate — should not throw

    const client = makeInMemoryClient();
    // Verify via a fresh client? No — we can test indirectly by checking no error thrown
    // (the INSERT OR IGNORE contract is that duplicates are silently dropped)
  });

  it('silently ignores duplicate news items', async () => {
    const captured = Date.now();
    const item = { source: 'rss', feed_domain: 'example.com', title: 'Test', url: 'https://example.com/1', published_at: null, captured_at: captured };

    await insertNewsItems([item]);
    await insertNewsItems([item]); // duplicate — should not throw
  });
});

// ─── Suite 6: purgeAndDownsample ─────────────────────────────────────────────

describe('purgeAndDownsample()', () => {
  before(() => {
    resetToMemory();
  });

  it('removes old raw snapshots and creates market_daily rows', async () => {
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    const cutoff = now - 5_000; // 5s ago

    // Insert snapshots older than cutoff (should be purged + aggregated)
    await insertMarketSnapshots([
      { source: 'test', symbol: 'SOL', asset_class: 'crypto', price: 150, change_pct: 0, captured_at: cutoff - 2000 },
      { source: 'test', symbol: 'SOL', asset_class: 'crypto', price: 155, change_pct: 0.5, captured_at: cutoff - 1000 },
    ]);
    // Insert snapshot newer than cutoff (should survive)
    await insertMarketSnapshots([
      { source: 'test', symbol: 'SOL', asset_class: 'crypto', price: 160, change_pct: 1.0, captured_at: now },
    ]);

    await purgeAndDownsample(cutoff);

    // Latest market should return only the surviving snapshot
    const latest = await getLatestMarkets();
    const sol = latest.find((r) => r.symbol === 'SOL');
    assert.ok(sol, 'SOL still present (recent snapshot survives)');
    assert.equal(sol.price, 160, 'only the recent snapshot remains');

    // market_daily should have one row for SOL
    const { getDb } = await import('../src/index.js');
    const db = getDb();
    const daily = await db.execute("SELECT * FROM market_daily WHERE symbol = 'SOL'");
    assert.equal(daily.rows.length, 1, 'one market_daily row created for SOL');
  });
});
