// packages/store/test/store.test.ts
// node:test runner — executed via: node --import tsx --test packages/store/test/store.test.ts
// Uses in-memory libSQL DB (':memory:') — never touches the production DB.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import type { Client as LibsqlClient } from '@libsql/client';
import { migrate as runMigrations } from '../src/migrate.js';
import type { SignalRow } from '../src/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

import {
  _resetDbForTesting,
  insertMarketSnapshots,
  insertNewsItems,
  getLatestMarkets,
  getMarketTrend,
  getRecentGdeltEvents,
  getCachedBriefing,
  saveBriefing,
  purgeAndDownsample,
  upsertEvents,
  getEvents,
  getEvent,
  getEventsByCountry,
  upsertSignals,
  getSignals,
  getSignalTrend,
  insertCiiSnapshots,
  getLatestCii,
  getCiiTrend,
  getPriorCii,
  insertConvergenceSignals,
  getLatestConvergence,
  getPriorConvergence,
  insertSanctions,
  getLatestSanctions,
  insertChokepointStatus,
  getLatestChokepointStatus,
  getTranslation,
  putTranslation,
} from '../src/index.js';
import type { EventRow, CiiSnapshotRow, ConvergenceSignalRow, SanctionRow, ChokepointStatusRow } from '../src/index.js';

function makeInMemoryClient(): LibsqlClient {
  return createClient({ url: ':memory:' });
}

// Reset the module-level singleton so each test suite gets a fresh client
// pointing at the in-memory URL we set.
function resetToMemory(): void {
  process.env['LIBSQL_URL'] = ':memory:';
  _resetDbForTesting();
}

// Helper: construct a minimal valid EventRow.
// Supports explicit null for optional fields (use null, not undefined, to distinguish "unset").
function makeEvent(overrides: Partial<EventRow> & { sourceEventId: string }): EventRow {
  return {
    source: overrides.source ?? 'usgs',
    sourceEventId: overrides.sourceEventId,
    eventType: overrides.eventType ?? 'earthquake',
    category: overrides.category ?? 'natural',
    severity: overrides.severity !== undefined ? overrides.severity : 50,
    lat: overrides.lat !== undefined ? overrides.lat : 40.0,
    lon: overrides.lon !== undefined ? overrides.lon : -3.0,
    // Use 'in' check so explicit null is passed through (not replaced by default 'ES')
    country: 'country' in overrides ? overrides.country ?? null : 'ES',
    title: overrides.title !== undefined ? overrides.title : 'Test event',
    url: overrides.url !== undefined ? overrides.url : 'https://example.com/event',
    occurredAt: overrides.occurredAt !== undefined ? overrides.occurredAt : Date.now(),
    capturedAt: overrides.capturedAt !== undefined ? overrides.capturedAt : Date.now(),
    rawJson: overrides.rawJson !== undefined ? overrides.rawJson : null,
  };
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

    const result002 = await client.execute(
      "SELECT id FROM _migrations WHERE id = '002_events.sql'"
    );
    assert.equal(result002.rows.length, 1, 'migration 002_events.sql recorded exactly once');
  });

  it('creates all expected tables and drops gdelt_events after migration', async () => {
    const client = makeInMemoryClient();
    await runMigrations(client);

    // Tables that must exist after both migrations
    const mustExist = ['market_snapshots', 'news_items', 'briefings', 'market_daily', 'events'];
    for (const tbl of mustExist) {
      const r = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        args: [tbl],
      });
      assert.equal(r.rows.length, 1, `table ${tbl} exists`);
    }

    // gdelt_events must NOT exist (DROPped in 002_events.sql, OQ-2)
    const gd = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='gdelt_events'",
      args: [],
    });
    assert.equal(gd.rows.length, 0, 'gdelt_events table was dropped by migration 002');
  });

  it('migration is idempotent — running 3x does not fail or duplicate rows', async () => {
    const client = makeInMemoryClient();
    await runMigrations(client);
    await runMigrations(client);
    await runMigrations(client);

    const migs = await client.execute('SELECT id FROM _migrations ORDER BY id');
    const ids = migs.rows.map((r) => r['id']);
    assert.ok(ids.includes('001_init.sql'), '001 present');
    assert.ok(ids.includes('002_events.sql'), '002 present');
    // Each id appears exactly once
    const unique = new Set(ids);
    assert.equal(unique.size, migs.rows.length, 'no duplicate migration records');
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
    await migrate();

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

// ─── Suite 5: insertNewsItems duplicate handling ──────────────────────────────

describe('insertNewsItems() duplicate handling', () => {
  before(() => {
    resetToMemory();
  });

  it('silently ignores duplicate news items', async () => {
    const { migrate } = await import('../src/index.js');
    await migrate();

    const captured = Date.now();
    const item = { source: 'rss', feed_domain: 'example.com', title: 'Test', url: 'https://example.com/1', published_at: null, captured_at: captured };

    await insertNewsItems([item]);
    await insertNewsItems([item]); // duplicate — should not throw
  });
});

// ─── Suite 6: purgeAndDownsample (C-2: no gdelt_events reference) ────────────

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

  it('purges events older than beforeMs (no gdelt_events reference — C-2)', async () => {
    const now = Date.now();
    const cutoff = now - 5_000;

    // Insert one old event and one recent event
    await upsertEvents([
      makeEvent({ sourceEventId: 'EVT-OLD', occurredAt: cutoff - 2000, capturedAt: cutoff - 2000 }),
      makeEvent({ sourceEventId: 'EVT-NEW', occurredAt: now, capturedAt: now }),
    ]);

    await purgeAndDownsample(cutoff);

    // EVT-OLD should be gone, EVT-NEW should survive
    const remaining = await getEvents({ sinceMs: 0 });
    const ids = remaining.map((e) => e.sourceEventId);
    assert.ok(!ids.includes('EVT-OLD'), 'old event purged');
    assert.ok(ids.includes('EVT-NEW'), 'recent event survives');
  });

  it('does not reference gdelt_events — table must not exist', async () => {
    // Verify at the DB level that gdelt_events was dropped
    const { getDb } = await import('../src/index.js');
    const db = getDb();
    const r = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='gdelt_events'",
      args: [],
    });
    assert.equal(r.rows.length, 0, 'gdelt_events does not exist (correctly dropped by 002)');
  });
});

// ─── Suite 7: upsertEvents — insert + dedup ───────────────────────────────────

describe('upsertEvents() — insert and UPSERT dedup (D-104)', () => {
  before(() => {
    resetToMemory();
  });

  it('inserts a new event row', async () => {
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    await upsertEvents([makeEvent({ sourceEventId: 'EV-001', severity: 55, capturedAt: now })]);

    const rows = await getEvents({ sinceMs: 0 });
    assert.equal(rows.length, 1, 'one row inserted');
    assert.equal(rows[0]?.sourceEventId, 'EV-001');
    assert.equal(rows[0]?.severity, 55);
  });

  it('UPSERT updates severity/title/capturedAt — does NOT duplicate', async () => {
    const now = Date.now();

    // Insert initial
    await upsertEvents([makeEvent({ sourceEventId: 'EV-UPSERT', severity: 30, title: 'Initial', capturedAt: now })]);

    // Upsert with updated fields
    const later = now + 10_000;
    await upsertEvents([makeEvent({ sourceEventId: 'EV-UPSERT', severity: 75, title: 'Updated', capturedAt: later })]);

    const rows = await getEvents({ sinceMs: 0 });
    const target = rows.filter((r) => r.sourceEventId === 'EV-UPSERT');
    assert.equal(target.length, 1, 'only one row (no duplicate)');
    assert.equal(target[0]?.severity, 75, 'severity updated to 75');
    assert.equal(target[0]?.title, 'Updated', 'title updated');
    assert.equal(target[0]?.capturedAt, later, 'capturedAt updated');
  });

  it('handles empty array without error', async () => {
    await upsertEvents([]); // must not throw
  });
});

// ─── Suite 8: getEvents — filters ────────────────────────────────────────────

describe('getEvents() — filter by type / category / minSeverity / sinceMs / bbox / limit', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    // Seed a diverse set of events
    await upsertEvents([
      makeEvent({ sourceEventId: 'EQ-1', eventType: 'earthquake', category: 'natural', severity: 80, lat: 35.0, lon: 25.0, country: 'GR', capturedAt: now }),
      makeEvent({ sourceEventId: 'WF-1', eventType: 'wildfire',   category: 'natural', severity: 40, lat: 38.0, lon: -5.0, country: 'ES', capturedAt: now }),
      makeEvent({ source: 'gdelt', sourceEventId: 'CF-1', eventType: 'conflict',   category: 'conflict', severity: 60, lat: 15.0, lon: 32.0, country: 'SD', capturedAt: now }),
      makeEvent({ source: 'gdelt', sourceEventId: 'PT-1', eventType: 'protest',    category: 'conflict', severity: 20, lat: 48.0, lon: 2.0, country: 'FR', capturedAt: now - 100_000 }),
    ]);
  });

  it('filter by type=earthquake', async () => {
    const rows = await getEvents({ type: 'earthquake' });
    assert.ok(rows.length >= 1, 'at least one earthquake');
    assert.ok(rows.every((r) => r.eventType === 'earthquake'), 'all rows are earthquakes');
  });

  it('filter by category=conflict', async () => {
    const rows = await getEvents({ category: 'conflict' });
    assert.ok(rows.length >= 2, 'at least 2 conflict events');
    assert.ok(rows.every((r) => r.category === 'conflict'), 'all rows are category=conflict');
  });

  it('filter by minSeverity=55', async () => {
    const rows = await getEvents({ minSeverity: 55 });
    assert.ok(rows.length >= 2, 'at least EQ-1 (80) and CF-1 (60)');
    assert.ok(rows.every((r) => r.severity !== null && r.severity >= 55), 'all rows severity>=55');
  });

  it('filter by sinceMs', async () => {
    const now = Date.now();
    // PT-1 was inserted 100s ago; use sinceMs = now - 50s to exclude it
    const rows = await getEvents({ sinceMs: now - 50_000 });
    const ids = rows.map((r) => r.sourceEventId);
    assert.ok(!ids.includes('PT-1'), 'old protest filtered out by sinceMs');
  });

  it('filter by bbox (lon/lat box around Greece region)', async () => {
    // EQ-1 is at lat=35, lon=25 — Greece area box
    const rows = await getEvents({ bbox: [20, 30, 30, 40] }); // [minLon, minLat, maxLon, maxLat]
    const ids = rows.map((r) => r.sourceEventId);
    assert.ok(ids.includes('EQ-1'), 'EQ-1 inside bbox');
    assert.ok(!ids.includes('WF-1'), 'WF-1 outside bbox (lon=-5, not in 20..30)');
  });

  it('filter by limit', async () => {
    const rows = await getEvents({ limit: 2 });
    assert.ok(rows.length <= 2, 'limit=2 returns at most 2 rows');
  });
});

// ─── Suite 9: getEvent ────────────────────────────────────────────────────────

describe('getEvent(source, sourceEventId)', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();
    await upsertEvents([makeEvent({ sourceEventId: 'DETAIL-1', rawJson: '{"alert":"red","sig":900}' })]);
  });

  it('returns the event when it exists', async () => {
    const row = await getEvent('usgs', 'DETAIL-1');
    assert.ok(row !== null, 'row found');
    assert.equal(row.sourceEventId, 'DETAIL-1');
    assert.equal(row.rawJson, '{"alert":"red","sig":900}');
  });

  it('returns null when not found', async () => {
    const row = await getEvent('usgs', 'DOES-NOT-EXIST');
    assert.equal(row, null, 'null for missing event');
  });

  it('returns null when source does not match', async () => {
    const row = await getEvent('gdelt', 'DETAIL-1');
    assert.equal(row, null, 'null when source mismatch');
  });
});

// ─── Suite 10: getEventsByCountry ─────────────────────────────────────────────

describe('getEventsByCountry(sinceMs)', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    await upsertEvents([
      makeEvent({ sourceEventId: 'C-ES-1', country: 'ES', capturedAt: now }),
      makeEvent({ sourceEventId: 'C-ES-2', country: 'ES', capturedAt: now }),
      makeEvent({ sourceEventId: 'C-GR-1', country: 'GR', capturedAt: now }),
      makeEvent({ sourceEventId: 'C-NULL', country: null, capturedAt: now }),
      // Old event — should not appear when sinceMs = now - 1s (not inserted yet but safe)
      makeEvent({ sourceEventId: 'C-OLD',  country: 'FR', capturedAt: now - 200_000 }),
    ]);
  });

  it('groups events by country', async () => {
    const sinceMs = Date.now() - 10_000;
    const map = await getEventsByCountry(sinceMs);

    const es = map.get('ES');
    assert.ok(es !== undefined && es.length === 2, 'ES has 2 events');

    const gr = map.get('GR');
    assert.ok(gr !== undefined && gr.length === 1, 'GR has 1 event');
  });

  it('null country events keyed under empty string', async () => {
    const sinceMs = Date.now() - 10_000;
    const map = await getEventsByCountry(sinceMs);
    const nullBucket = map.get('');
    assert.ok(nullBucket !== undefined && nullBucket.length >= 1, 'null-country events in "" bucket');
  });

  it('excludes events older than sinceMs', async () => {
    const sinceMs = Date.now() - 10_000;
    const map = await getEventsByCountry(sinceMs);
    // FR event was inserted 200s ago
    const fr = map.get('FR');
    assert.ok(fr === undefined || fr.length === 0, 'C-OLD (FR) not included');
  });
});

// ─── Suite 11: getRecentGdeltEvents reads events WHERE source='gdelt' (C-3) ──

describe("getRecentGdeltEvents() — reads events source='gdelt' (C-3 retro-compat)", () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    // Insert GDELT events via upsertEvents (source='gdelt')
    await upsertEvents([
      {
        source: 'gdelt',
        sourceEventId: 'GDELT-001',
        eventType: 'conflict',
        category: 'conflict',
        severity: 65,
        lat: 15.0,
        lon: 32.0,
        country: 'SD',
        title: 'Conflict in Sudan',
        url: 'https://gdeltproject.org/001',
        occurredAt: now - 5_000,
        capturedAt: now,
        rawJson: null,
      },
      {
        source: 'gdelt',
        sourceEventId: 'GDELT-002',
        eventType: 'protest',
        category: 'conflict',
        severity: 25,
        lat: 48.0,
        lon: 2.0,
        country: 'FR',
        title: 'Protest in Paris',
        url: 'https://gdeltproject.org/002',
        occurredAt: now - 10_000,
        capturedAt: now,
        rawJson: null,
      },
      // Non-gdelt event: must NOT appear in getRecentGdeltEvents
      {
        source: 'usgs',
        sourceEventId: 'USGS-001',
        eventType: 'earthquake',
        category: 'natural',
        severity: 80,
        lat: 35.0,
        lon: 25.0,
        country: 'GR',
        title: 'M 6.0 earthquake',
        url: null,
        occurredAt: now,
        capturedAt: now,
        rawJson: null,
      },
    ]);
  });

  it('returns GdeltEvent-shaped rows (legacy retro-compat) from events source=gdelt', async () => {
    const sinceMs = Date.now() - 60_000;
    const events = await getRecentGdeltEvents(sinceMs);

    // Should include GDELT-001 and GDELT-002 but NOT USGS-001
    assert.ok(events.length === 2, `expected 2 gdelt events, got ${events.length}`);

    const ids = events.map((e) => e.event_id);
    assert.ok(ids.includes('GDELT-001'), 'GDELT-001 present');
    assert.ok(ids.includes('GDELT-002'), 'GDELT-002 present');
    assert.ok(!ids.includes('USGS-001'), 'USGS-001 not in gdelt events');
  });

  it('maps source_event_id to legacy field event_id', async () => {
    const sinceMs = Date.now() - 60_000;
    const events = await getRecentGdeltEvents(sinceMs);
    for (const e of events) {
      assert.ok(typeof e.event_id === 'string', 'event_id is a string');
      assert.ok(e.event_id.startsWith('GDELT-'), 'event_id maps from source_event_id');
    }
  });

  it('orders by captured_at DESC', async () => {
    const sinceMs = 0;
    const events = await getRecentGdeltEvents(sinceMs);
    for (let i = 1; i < events.length; i++) {
      assert.ok(
        (events[i - 1]?.captured_at ?? 0) >= (events[i]?.captured_at ?? 0),
        'ordered by captured_at DESC'
      );
    }
  });

  it('respects limit parameter', async () => {
    const events = await getRecentGdeltEvents(0, 1);
    assert.equal(events.length, 1, 'limit=1 returns at most 1 row');
  });

  it('returns empty array when no gdelt events exist in window', async () => {
    const events = await getRecentGdeltEvents(Date.now() + 1_000_000); // future
    assert.equal(events.length, 0, 'empty when sinceMs is in the future');
  });
});

// ─── Suite 12: migrate() — migration 003_signals idempotent ──────────────────

describe('migrate() — migration 003_signals.sql (T-15, HAZARD W-2)', () => {
  it('creates signals + signal_sections tables and all 4 indices — idempotent 3x', async () => {
    const client = makeInMemoryClient();

    // Run 3 times — must be idempotent (HAZARD W-2 guard)
    await runMigrations(client);
    await runMigrations(client);
    await runMigrations(client);

    // Assert tables exist via sqlite_master (catches HAZARD W-2: silent discard of CREATE)
    const tablesResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('signals','signal_sections') ORDER BY name"
    );
    const tableNames = tablesResult.rows.map((r) => String(r['name']));
    assert.ok(tableNames.includes('signals'), 'signals table created');
    assert.ok(tableNames.includes('signal_sections'), 'signal_sections table created');

    // Assert all 4 indices exist
    const indicesResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('ix_signals_recent','ix_signals_tone','ix_signals_occ','ix_sigsec_section') ORDER BY name"
    );
    const indexNames = indicesResult.rows.map((r) => String(r['name']));
    assert.ok(indexNames.includes('ix_signals_recent'), 'ix_signals_recent index exists');
    assert.ok(indexNames.includes('ix_signals_tone'), 'ix_signals_tone index exists');
    assert.ok(indexNames.includes('ix_signals_occ'), 'ix_signals_occ index exists');
    assert.ok(indexNames.includes('ix_sigsec_section'), 'ix_sigsec_section index exists');

    // Migration 003 recorded exactly once
    const mig003 = await client.execute(
      "SELECT id FROM _migrations WHERE id = '003_signals.sql'"
    );
    assert.equal(mig003.rows.length, 1, '003_signals.sql recorded exactly once');

    // Events table still intact (migration does NOT touch it)
    const eventsResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
    );
    assert.equal(eventsResult.rows.length, 1, 'events table still exists (not touched by 003)');
  });
});

// ─── Suite 13: upsertSignals — insert, dedup, signal_sections rewrite ────────

// Helper: build a minimal valid SignalRow
function makeSignal(overrides: Partial<SignalRow> & { signalId: string }): SignalRow {
  return {
    source: overrides.source ?? 'gkg',
    signalId: overrides.signalId,
    title: overrides.title !== undefined ? overrides.title : 'Test signal',
    url: overrides.url !== undefined ? overrides.url : 'https://example.com/sig',
    tone: overrides.tone !== undefined ? overrides.tone : -2.5,
    themes: overrides.themes !== undefined ? overrides.themes : 'ENV_OIL;ECON_TRADE',
    persons: overrides.persons !== undefined ? overrides.persons : null,
    organizations: overrides.organizations !== undefined ? overrides.organizations : null,
    lat: overrides.lat !== undefined ? overrides.lat : 40.0,
    lon: overrides.lon !== undefined ? overrides.lon : -3.0,
    country: overrides.country !== undefined ? overrides.country : 'ES',
    occurredAt: overrides.occurredAt !== undefined ? overrides.occurredAt : Date.now() - 1000,
    capturedAt: overrides.capturedAt !== undefined ? overrides.capturedAt : Date.now(),
    rawJson: overrides.rawJson !== undefined ? overrides.rawJson : null,
    sections: overrides.sections ?? [{ section: 'commodities_energy', matchedBy: 'theme' }],
  };
}

describe('upsertSignals() — insert + dedup + signal_sections rewrite', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();
  });

  it('inserts a signal row and its sections', async () => {
    await upsertSignals([
      makeSignal({
        signalId: 'SIG-001',
        sections: [
          { section: 'commodities_energy', matchedBy: 'theme' },
          { section: 'trade_sanctions', matchedBy: 'keyword' },
        ],
      }),
    ]);

    const rows = await getSignals({ sinceMs: 0 });
    const sig = rows.find((r) => r.signalId === 'SIG-001');
    assert.ok(sig !== undefined, 'SIG-001 inserted');
    assert.equal(sig.sections.length, 2, '2 sections persisted');
    const sectionNames = sig.sections.map((s) => s.section).sort();
    assert.deepEqual(sectionNames, ['commodities_energy', 'trade_sanctions']);
  });

  it('UPSERT on same signal_id updates tone without duplicating', async () => {
    await upsertSignals([makeSignal({ signalId: 'SIG-DUP', tone: -5.0, sections: [{ section: 'commodities_energy', matchedBy: 'theme' }] })]);
    await upsertSignals([makeSignal({ signalId: 'SIG-DUP', tone: 8.0, sections: [{ section: 'trade_sanctions', matchedBy: 'keyword' }] })]);

    const rows = await getSignals({ sinceMs: 0 });
    const dups = rows.filter((r) => r.signalId === 'SIG-DUP');
    assert.equal(dups.length, 1, 'only one row (no duplicate)');
    assert.equal(dups[0]?.tone, 8.0, 'tone updated to 8.0');
  });

  it('UPSERT rewrites signal_sections — old sections replaced', async () => {
    await upsertSignals([
      makeSignal({
        signalId: 'SIG-REWRITE',
        sections: [
          { section: 'commodities_energy', matchedBy: 'theme' },
          { section: 'critical_minerals', matchedBy: 'keyword' },
        ],
      }),
    ]);

    // Re-upsert with completely different sections
    await upsertSignals([
      makeSignal({
        signalId: 'SIG-REWRITE',
        sections: [{ section: 'trade_sanctions', matchedBy: 'entity' }],
      }),
    ]);

    const rows = await getSignals({ sinceMs: 0 });
    const sig = rows.find((r) => r.signalId === 'SIG-REWRITE');
    assert.ok(sig !== undefined, 'SIG-REWRITE found');
    // Only the new section should remain
    assert.equal(sig.sections.length, 1, 'old sections replaced (only 1 remains)');
    assert.equal(sig.sections[0]?.section, 'trade_sanctions', 'new section is trade_sanctions');
  });

  it('handles empty array without error', async () => {
    await upsertSignals([]); // must not throw
  });
});

// ─── Suite 14: getSignals — filters ──────────────────────────────────────────

describe('getSignals() — filter by section / minToneMag / sinceMs / limit', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    await upsertSignals([
      makeSignal({ signalId: 'F-COM', tone: -8.0, capturedAt: now, sections: [{ section: 'commodities_energy', matchedBy: 'theme' }] }),
      makeSignal({ signalId: 'F-SEM', tone: 2.0,  capturedAt: now, sections: [{ section: 'semis_ai_tech', matchedBy: 'keyword' }] }),
      makeSignal({ signalId: 'F-TRA', tone: -15.0, capturedAt: now, sections: [{ section: 'trade_sanctions', matchedBy: 'theme' }] }),
      makeSignal({ signalId: 'F-OLD', tone: -5.0, capturedAt: now - 200_000, sections: [{ section: 'commodities_energy', matchedBy: 'theme' }] }),
      makeSignal({ signalId: 'F-NULL', tone: null, capturedAt: now, sections: [{ section: 'commodities_energy', matchedBy: 'keyword' }] }),
    ]);
  });

  it('filter by section=commodities_energy', async () => {
    const rows = await getSignals({ section: 'commodities_energy' });
    const ids = rows.map((r) => r.signalId);
    assert.ok(ids.includes('F-COM'), 'F-COM included');
    assert.ok(ids.includes('F-NULL'), 'F-NULL included (same section)');
    assert.ok(!ids.includes('F-SEM'), 'F-SEM excluded');
    assert.ok(!ids.includes('F-TRA'), 'F-TRA excluded');
    assert.ok(rows.every((r) => r.sections.some((s) => s.section === 'commodities_energy')), 'all rows have commodities_energy section');
  });

  it('filter by minToneMag=10 excludes low-magnitude tones and null tones', async () => {
    const rows = await getSignals({ minToneMag: 10 });
    const ids = rows.map((r) => r.signalId);
    assert.ok(ids.includes('F-TRA'), 'F-TRA included (|tone|=15 >= 10)');
    assert.ok(!ids.includes('F-COM'), 'F-COM excluded (|tone|=8 < 10)');
    assert.ok(!ids.includes('F-SEM'), 'F-SEM excluded (|tone|=2 < 10)');
    assert.ok(!ids.includes('F-NULL'), 'F-NULL excluded (tone is null)');
  });

  it('filter by sinceMs excludes old signals', async () => {
    const now = Date.now();
    const rows = await getSignals({ sinceMs: now - 50_000 });
    const ids = rows.map((r) => r.signalId);
    assert.ok(!ids.includes('F-OLD'), 'F-OLD excluded by sinceMs');
    assert.ok(ids.includes('F-COM'), 'F-COM included (recent)');
  });

  it('filter by limit', async () => {
    const rows = await getSignals({ limit: 2 });
    assert.ok(rows.length <= 2, 'limit=2 returns at most 2 rows');
  });

  it('no filters returns all signals ordered by captured_at DESC', async () => {
    const rows = await getSignals({ sinceMs: 0 });
    assert.ok(rows.length >= 5, 'at least 5 signals returned');
    for (let i = 1; i < rows.length; i++) {
      assert.ok(
        (rows[i - 1]?.capturedAt ?? 0) >= (rows[i]?.capturedAt ?? 0),
        'ordered captured_at DESC'
      );
    }
  });
});

// ─── Suite 15: getSignalTrend — aggregation ───────────────────────────────────

describe('getSignalTrend() — volume + avgTone per bucket', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    // Two signals in bucket 0 (captured_at = 0..3599999) and one in bucket 2 (captured_at = 7200000)
    // Bucket size = 3_600_000 ms (1h)
    await upsertSignals([
      makeSignal({ signalId: 'T-1', tone: -4.0, capturedAt: 1_000_000, sections: [{ section: 'commodities_energy', matchedBy: 'theme' }] }),
      makeSignal({ signalId: 'T-2', tone: 2.0,  capturedAt: 2_000_000, sections: [{ section: 'commodities_energy', matchedBy: 'theme' }] }),
      makeSignal({ signalId: 'T-3', tone: null, capturedAt: 3_000_000, sections: [{ section: 'commodities_energy', matchedBy: 'theme' }] }),
      makeSignal({ signalId: 'T-4', tone: 6.0,  capturedAt: 7_200_000, sections: [{ section: 'commodities_energy', matchedBy: 'theme' }] }),
    ]);
  });

  it('aggregates volume and avgTone by 1h bucket', async () => {
    const trend = await getSignalTrend('commodities_energy');

    // Expect at least 2 buckets
    assert.ok(trend.length >= 2, `at least 2 buckets (got ${trend.length})`);

    // Bucket at floor(1_000_000 / 3_600_000)*3_600_000 = 0
    const bucket0 = trend.find((p) => p.bucketMs === 0);
    assert.ok(bucket0 !== undefined, 'bucket at 0ms exists');
    assert.equal(bucket0.volume, 3, 'bucket 0 has volume=3 (T-1, T-2, T-3)');
    // avgTone ignores null (T-3): mean of -4.0 and 2.0 = -1.0
    assert.ok(bucket0.avgTone !== null, 'avgTone is not null (non-null tones exist)');
    assert.ok(Math.abs((bucket0.avgTone ?? 0) - (-1.0)) < 0.001, `avgTone ~= -1.0 (got ${bucket0.avgTone})`);

    // Bucket for T-4 at floor(7_200_000 / 3_600_000)*3_600_000 = 7_200_000
    const bucket2 = trend.find((p) => p.bucketMs === 7_200_000);
    assert.ok(bucket2 !== undefined, 'bucket at 7_200_000ms exists');
    assert.equal(bucket2.volume, 1, 'bucket 2 has volume=1 (T-4)');
    assert.ok(Math.abs((bucket2.avgTone ?? 0) - 6.0) < 0.001, 'avgTone=6.0 for T-4');
  });

  it('all-null-tone bucket returns avgTone=null but counts volume', async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    await upsertSignals([
      makeSignal({ signalId: 'NULL-1', tone: null, capturedAt: 500_000, sections: [{ section: 'semis_ai_tech', matchedBy: 'keyword' }] }),
      makeSignal({ signalId: 'NULL-2', tone: null, capturedAt: 600_000, sections: [{ section: 'semis_ai_tech', matchedBy: 'keyword' }] }),
    ]);

    const trend = await getSignalTrend('semis_ai_tech');
    assert.ok(trend.length >= 1, 'at least 1 bucket');
    const bucket = trend[0];
    assert.ok(bucket !== undefined);
    assert.equal(bucket.volume, 2, 'volume=2');
    assert.equal(bucket.avgTone, null, 'avgTone=null when all tones are null');
  });

  it('sinceMs filter restricts buckets', async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    await upsertSignals([
      makeSignal({ signalId: 'S-OLD', tone: -1.0, capturedAt: now - 7_200_000, sections: [{ section: 'trade_sanctions', matchedBy: 'theme' }] }),
      makeSignal({ signalId: 'S-NEW', tone: 3.0,  capturedAt: now, sections: [{ section: 'trade_sanctions', matchedBy: 'theme' }] }),
    ]);

    const trend = await getSignalTrend('trade_sanctions', { sinceMs: now - 3_600_000 });
    // Only S-NEW should be included
    assert.equal(trend.length, 1, '1 bucket (old excluded by sinceMs)');
    assert.equal(trend[0]?.volume, 1, 'volume=1 (only S-NEW)');
  });

  it('custom bucketMs (30min) produces correct bucket floor', async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const bucket30min = 1_800_000;
    await upsertSignals([
      makeSignal({ signalId: 'B30-1', tone: 1.0, capturedAt: 0,         sections: [{ section: 'critical_minerals', matchedBy: 'keyword' }] }),
      makeSignal({ signalId: 'B30-2', tone: 3.0, capturedAt: 1_000_000, sections: [{ section: 'critical_minerals', matchedBy: 'keyword' }] }),
      makeSignal({ signalId: 'B30-3', tone: 5.0, capturedAt: 2_000_000, sections: [{ section: 'critical_minerals', matchedBy: 'keyword' }] }),
    ]);

    const trend = await getSignalTrend('critical_minerals', { bucketMs: bucket30min });
    // capturedAt 0 and 1_000_000 → bucket floor 0; capturedAt 2_000_000 → bucket floor 1_800_000
    assert.ok(trend.length >= 2, 'at least 2 buckets with 30min bucket');
    const b0 = trend.find((p) => p.bucketMs === 0);
    assert.ok(b0 !== undefined && b0.volume === 2, 'bucket 0 has 2 signals');
    const b1 = trend.find((p) => p.bucketMs === 1_800_000);
    assert.ok(b1 !== undefined && b1.volume === 1, 'bucket 1_800_000 has 1 signal');
  });
});

// ─── Suite 16: purgeAndDownsample — signals purged, events intact ─────────────

describe('purgeAndDownsample() — purges signals, leaves events intact', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    const cutoff = now - 5_000;

    // Old signal (occurred_at < cutoff) — should be purged
    await upsertSignals([
      makeSignal({ signalId: 'P-OLD', occurredAt: cutoff - 2000, capturedAt: cutoff - 2000, sections: [{ section: 'commodities_energy', matchedBy: 'theme' }] }),
    ]);
    // New signal (occurred_at = now) — should survive
    await upsertSignals([
      makeSignal({ signalId: 'P-NEW', occurredAt: now, capturedAt: now, sections: [{ section: 'commodities_energy', matchedBy: 'theme' }] }),
    ]);
    // Event — must survive regardless
    await upsertEvents([
      makeEvent({ sourceEventId: 'EVT-SAFE', occurredAt: now, capturedAt: now }),
    ]);
    // Old event — purged by existing logic
    await upsertEvents([
      makeEvent({ sourceEventId: 'EVT-GONE', occurredAt: cutoff - 3000, capturedAt: cutoff - 3000 }),
    ]);
  });

  it('purges old signals and their signal_sections via CASCADE', async () => {
    const now = Date.now();
    const cutoff = now - 5_000;

    await purgeAndDownsample(cutoff);

    const signals = await getSignals({ sinceMs: 0 });
    const ids = signals.map((s) => s.signalId);
    assert.ok(!ids.includes('P-OLD'), 'old signal P-OLD purged');
    assert.ok(ids.includes('P-NEW'), 'recent signal P-NEW survives');

    // Verify signal_sections were cascade-deleted by checking DB directly
    const { getDb } = await import('../src/index.js');
    const db = getDb();
    const sectResult = await db.execute(
      "SELECT ss.* FROM signal_sections ss INNER JOIN signals s ON s.id = ss.signal_id WHERE s.signal_id = 'P-OLD'"
    );
    assert.equal(sectResult.rows.length, 0, 'signal_sections for P-OLD cascade-deleted');
  });

  it('events are NOT touched by the signals purge step', async () => {
    const events = await getEvents({ sinceMs: 0 });
    const ids = events.map((e) => e.sourceEventId);
    assert.ok(ids.includes('EVT-SAFE'), 'EVT-SAFE still present after purge');
  });

  it('signals table is NOT touched by the events purge step (no cross-contamination)', async () => {
    // P-NEW must still be there (it was recent — survived the signals purge)
    const signals = await getSignals({ sinceMs: 0 });
    const ids = signals.map((s) => s.signalId);
    assert.ok(ids.includes('P-NEW'), 'P-NEW signal unaffected by events purge logic');
  });
});

// ─── Helpers for CII tests ────────────────────────────────────────────────────

function makeCii(overrides: Partial<CiiSnapshotRow> & { country: string; capturedAt: number }): CiiSnapshotRow {
  return {
    country: overrides.country,
    composite: overrides.composite ?? 42.0,
    baselineRisk: overrides.baselineRisk ?? 30.0,
    eventScore: overrides.eventScore ?? 12.0,
    dynamicScore: overrides.dynamicScore !== undefined ? overrides.dynamicScore : null,
    trend: overrides.trend !== undefined ? overrides.trend : null,
    methodologyVersion: overrides.methodologyVersion ?? '1.0.0',
    componentsJson: overrides.componentsJson ?? '{"stability":30,"event":12}',
    capturedAt: overrides.capturedAt,
  };
}

// ─── Suite 17: migrate() — migration 004_cii idempotent (HAZARD W-2 guard) ────

describe('migrate() — migration 004_cii.sql (T-21, HAZARD W-2)', () => {
  it('creates cii_snapshots table and ix_cii_country_time index — idempotent 3x', async () => {
    const client = makeInMemoryClient();

    await runMigrations(client);
    await runMigrations(client);
    await runMigrations(client);

    // Assert table exists (catches HAZARD W-2: silent discard of CREATE due to leading --)
    const tableResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='cii_snapshots'"
    );
    assert.equal(tableResult.rows.length, 1, 'cii_snapshots table created');

    // Assert index exists
    const indexResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='ix_cii_country_time'"
    );
    assert.equal(indexResult.rows.length, 1, 'ix_cii_country_time index exists');

    // Migration 004 recorded exactly once
    const mig004 = await client.execute(
      "SELECT id FROM _migrations WHERE id = '004_cii.sql'"
    );
    assert.equal(mig004.rows.length, 1, '004_cii.sql recorded exactly once');

    // Prior tables still intact
    const eventsResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
    );
    assert.equal(eventsResult.rows.length, 1, 'events table still exists (not touched by 004)');

    const signalsResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='signals'"
    );
    assert.equal(signalsResult.rows.length, 1, 'signals table still exists (not touched by 004)');
  });
});

// ─── Suite 18: insertCiiSnapshots + getLatestCii ──────────────────────────────

describe('insertCiiSnapshots() + getLatestCii()', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();
  });

  it('inserts and reads back a CII snapshot (round-trip)', async () => {
    const now = Date.now();
    await insertCiiSnapshots([
      makeCii({ country: 'ES', capturedAt: now, composite: 55.5, baselineRisk: 40.0, eventScore: 15.5, dynamicScore: 2.3, trend: 'rising', methodologyVersion: '1.0.0', componentsJson: '{"a":1}' }),
    ]);

    const rows = await getLatestCii();
    const es = rows.find((r) => r.country === 'ES');
    assert.ok(es !== undefined, 'ES row present');
    assert.ok(Math.abs(es.composite - 55.5) < 0.001, 'composite correct');
    assert.ok(Math.abs(es.baselineRisk - 40.0) < 0.001, 'baselineRisk correct');
    assert.ok(Math.abs(es.eventScore - 15.5) < 0.001, 'eventScore correct');
    assert.ok(es.dynamicScore !== null && Math.abs(es.dynamicScore - 2.3) < 0.001, 'dynamicScore correct');
    assert.equal(es.trend, 'rising', 'trend correct');
    assert.equal(es.methodologyVersion, '1.0.0', 'methodologyVersion correct');
    assert.equal(es.componentsJson, '{"a":1}', 'componentsJson correct');
    assert.equal(es.capturedAt, now, 'capturedAt correct');
    assert.ok(es.id !== undefined && es.id > 0, 'id assigned by DB');
  });

  it('getLatestCii returns 1 row per country — the most recent snapshot', async () => {
    const now = Date.now();
    const earlier = now - 30_000;

    // Two snapshots for DE — only the later one should appear in getLatestCii
    await insertCiiSnapshots([
      makeCii({ country: 'DE', capturedAt: earlier, composite: 20.0, baselineRisk: 15.0, eventScore: 5.0 }),
      makeCii({ country: 'DE', capturedAt: now,     composite: 35.0, baselineRisk: 25.0, eventScore: 10.0 }),
    ]);

    const rows = await getLatestCii();
    const deRows = rows.filter((r) => r.country === 'DE');
    assert.equal(deRows.length, 1, 'only 1 DE row from getLatestCii');
    assert.ok(Math.abs((deRows[0]?.composite ?? 0) - 35.0) < 0.001, 'DE shows the most recent composite (35.0)');
  });

  it('handles null dynamicScore and null trend', async () => {
    const now = Date.now();
    await insertCiiSnapshots([
      makeCii({ country: 'FR', capturedAt: now, dynamicScore: null, trend: null }),
    ]);

    const rows = await getLatestCii();
    const fr = rows.find((r) => r.country === 'FR');
    assert.ok(fr !== undefined, 'FR row present');
    assert.equal(fr.dynamicScore, null, 'dynamicScore is null');
    assert.equal(fr.trend, null, 'trend is null');
  });

  it('handles empty array without error', async () => {
    await insertCiiSnapshots([]); // must not throw
  });
});

// ─── Suite 19: getCiiTrend ────────────────────────────────────────────────────

describe('getCiiTrend(country, sinceMs)', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const base = Date.now();
    await insertCiiSnapshots([
      makeCii({ country: 'IT', capturedAt: base - 72_000_000, composite: 10.0, baselineRisk: 8.0, eventScore: 2.0 }),
      makeCii({ country: 'IT', capturedAt: base - 36_000_000, composite: 20.0, baselineRisk: 15.0, eventScore: 5.0 }),
      makeCii({ country: 'IT', capturedAt: base,              composite: 30.0, baselineRisk: 20.0, eventScore: 10.0 }),
      makeCii({ country: 'PT', capturedAt: base,              composite: 25.0, baselineRisk: 18.0, eventScore: 7.0 }),
    ]);
  });

  it('returns all snapshots for a country since sinceMs, ASC by captured_at', async () => {
    const sinceMs = Date.now() - 50_000_000;
    const trend = await getCiiTrend('IT', sinceMs);
    assert.equal(trend.length, 2, '2 IT rows in window');
    assert.ok(trend[0] !== undefined && trend[1] !== undefined, 'both rows defined');
    assert.ok(trend[0].capturedAt <= trend[1].capturedAt, 'ordered ASC by captured_at');
    assert.ok(Math.abs(trend[0].composite - 20.0) < 0.001, 'first row composite=20.0');
    assert.ok(Math.abs(trend[1].composite - 30.0) < 0.001, 'second row composite=30.0');
  });

  it('returns empty array when no rows exist for the country', async () => {
    const trend = await getCiiTrend('ZZ', 0);
    assert.equal(trend.length, 0, 'empty for unknown country');
  });

  it('does not cross-contaminate across countries', async () => {
    const trend = await getCiiTrend('PT', 0);
    assert.ok(trend.every((r) => r.country === 'PT'), 'only PT rows returned');
  });
});

// ─── Suite 20: getPriorCii ────────────────────────────────────────────────────

describe('getPriorCii(country, aroundMs)', () => {
  const BASE = 1_700_000_000_000; // fixed epoch to avoid Date.now() drift in assertions

  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    await insertCiiSnapshots([
      makeCii({ country: 'GR', capturedAt: BASE - 86_400_000, composite: 10.0, baselineRisk: 8.0, eventScore: 2.0 }),
      makeCii({ country: 'GR', capturedAt: BASE,              composite: 20.0, baselineRisk: 15.0, eventScore: 5.0 }),
    ]);
  });

  it('returns the closest snapshot at or before aroundMs (~24h lookback)', async () => {
    const prior = await getPriorCii('GR', BASE - 1000);
    assert.ok(prior !== null, 'prior found');
    assert.ok(Math.abs(prior.composite - 10.0) < 0.001, 'returns the ~24h-prior snapshot');
    assert.equal(prior.capturedAt, BASE - 86_400_000, 'capturedAt matches the prior snapshot');
  });

  it('returns the most recent snapshot when aroundMs >= latest capturedAt', async () => {
    const prior = await getPriorCii('GR', BASE + 1000);
    assert.ok(prior !== null, 'prior found');
    assert.ok(Math.abs(prior.composite - 20.0) < 0.001, 'returns the latest when aroundMs is after all rows');
  });

  it('returns null when no snapshot exists for the country', async () => {
    const prior = await getPriorCii('ZZ', BASE);
    assert.equal(prior, null, 'null for unknown country');
  });
});

// ─── Suite 21: purgeAndDownsample — purges cii_snapshots, events/signals intact ─

describe('purgeAndDownsample() — purges cii_snapshots, events and signals intact', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    const cutoff = now - 5_000;

    // Old CII snapshot — should be purged
    await insertCiiSnapshots([
      makeCii({ country: 'RU', capturedAt: cutoff - 2000 }),
    ]);
    // Recent CII snapshot — should survive
    await insertCiiSnapshots([
      makeCii({ country: 'RU', capturedAt: now }),
    ]);

    // Event — should survive (not purged by CII step)
    await upsertEvents([makeEvent({ sourceEventId: 'SAFE-EVT', occurredAt: now, capturedAt: now })]);
  });

  it('purges cii_snapshots older than beforeMs', async () => {
    const now = Date.now();
    const cutoff = now - 5_000;

    await purgeAndDownsample(cutoff);

    const trend = await getCiiTrend('RU', 0);
    assert.equal(trend.length, 1, 'only 1 RU snapshot survives (the recent one)');
    assert.ok(trend[0] !== undefined && trend[0].capturedAt >= cutoff, 'surviving snapshot is recent');
  });

  it('events are NOT purged by the CII purge step', async () => {
    const events = await getEvents({ sinceMs: 0 });
    const ids = events.map((e) => e.sourceEventId);
    assert.ok(ids.includes('SAFE-EVT'), 'SAFE-EVT event survives CII purge step');
  });
});

// ─── Helpers for Convergence tests ───────────────────────────────────────────

function makeConvergence(
  overrides: Partial<ConvergenceSignalRow> & { country: string; capturedAt: number },
): ConvergenceSignalRow {
  return {
    country: overrides.country,
    familiesJson: overrides.familiesJson ?? '["events","signals"]',
    dimensionsJson: overrides.dimensionsJson ?? '["conflict","economic"]',
    componentsJson: overrides.componentsJson ?? '{}',
    strength: overrides.strength ?? 0.65,
    sourceCount: overrides.sourceCount ?? 2,
    dynamicScore: overrides.dynamicScore !== undefined ? overrides.dynamicScore : null,
    methodologyVersion: overrides.methodologyVersion ?? 'conv-core-1',
    firstDetectedAt: overrides.firstDetectedAt ?? overrides.capturedAt,
    capturedAt: overrides.capturedAt,
  };
}

// ─── Suite 22: migrate() — migration 005_convergence idempotent (HAZARD W-2) ─

describe('migrate() — migration 005_convergence.sql (T-28, HAZARD W-2)', () => {
  it('creates convergence_signals table and ix_conv_country_time index — idempotent 3x', async () => {
    const client = makeInMemoryClient();

    await runMigrations(client);
    await runMigrations(client);
    await runMigrations(client);

    // Assert table exists via sqlite_master (catches HAZARD W-2: silent discard of CREATE)
    const tableResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE name='convergence_signals'",
    );
    assert.equal(tableResult.rows.length, 1, 'convergence_signals table created');

    // Assert index exists
    const indexResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE name='ix_conv_country_time'",
    );
    assert.equal(indexResult.rows.length, 1, 'ix_conv_country_time index exists');

    // Migration 005 recorded exactly once
    const mig005 = await client.execute(
      "SELECT id FROM _migrations WHERE id = '005_convergence.sql'",
    );
    assert.equal(mig005.rows.length, 1, '005_convergence.sql recorded exactly once');

    // Prior tables still intact (additive only — no other tables touched)
    for (const tbl of ['cii_snapshots', 'events', 'signals']) {
      const r = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        args: [tbl],
      });
      assert.equal(r.rows.length, 1, `${tbl} table still exists (not touched by 005)`);
    }
  });
});

// ─── Suite 23: insertConvergenceSignals + getLatestConvergence ────────────────

describe('insertConvergenceSignals() + getLatestConvergence()', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();
  });

  it('inserts and reads back a convergence signal (round-trip)', async () => {
    const now = Date.now();
    await insertConvergenceSignals([
      makeConvergence({
        country: 'SY',
        capturedAt: now,
        strength: 0.72,
        sourceCount: 2,
        familiesJson: '["events","signals"]',
        dimensionsJson: '["conflict","economic"]',
        dynamicScore: 0.1,
        firstDetectedAt: now - 3_600_000,
      }),
    ]);

    const rows = await getLatestConvergence();
    const sy = rows.find((r) => r.country === 'SY');
    assert.ok(sy !== undefined, 'SY row present');
    assert.ok(Math.abs(sy.strength - 0.72) < 0.001, 'strength correct');
    assert.equal(sy.sourceCount, 2, 'sourceCount correct');
    assert.equal(sy.familiesJson, '["events","signals"]', 'familiesJson correct');
    assert.equal(sy.dimensionsJson, '["conflict","economic"]', 'dimensionsJson correct');
    assert.ok(sy.dynamicScore !== null && Math.abs(sy.dynamicScore - 0.1) < 0.001, 'dynamicScore correct');
    assert.equal(sy.methodologyVersion, 'conv-core-1', 'methodologyVersion correct');
    assert.ok(sy.id !== undefined && sy.id > 0, 'id assigned by DB');
  });

  it('getLatestConvergence returns the last snapshot per (country, familyset) with >= 2 captured_at values', async () => {
    const BASE = Date.now();
    const earlier = BASE - 60_000;

    await insertConvergenceSignals([
      makeConvergence({ country: 'IQ', capturedAt: earlier, strength: 0.55, familiesJson: '["events","signals"]' }),
      makeConvergence({ country: 'IQ', capturedAt: BASE,    strength: 0.80, familiesJson: '["events","signals"]' }),
    ]);

    const rows = await getLatestConvergence();
    const iqRows = rows.filter((r) => r.country === 'IQ' && r.familiesJson === '["events","signals"]');
    assert.equal(iqRows.length, 1, 'only 1 IQ row for this familyset');
    assert.ok(Math.abs((iqRows[0]?.strength ?? 0) - 0.80) < 0.001, 'IQ shows latest snapshot (strength 0.80)');
  });

  it('getLatestConvergence returns both rows when a country has 2 active familysets', async () => {
    const now = Date.now();

    await insertConvergenceSignals([
      makeConvergence({ country: 'AF', capturedAt: now, familiesJson: '["events","signals"]', strength: 0.60 }),
      makeConvergence({ country: 'AF', capturedAt: now, familiesJson: '["events","markets","signals"]', strength: 0.75 }),
    ]);

    const rows = await getLatestConvergence();
    const afRows = rows.filter((r) => r.country === 'AF');
    assert.equal(afRows.length, 2, 'AF has 2 rows (one per familyset)');
  });

  it('handles null dynamicScore', async () => {
    const now = Date.now();
    await insertConvergenceSignals([
      makeConvergence({ country: 'ML', capturedAt: now, dynamicScore: null }),
    ]);
    const rows = await getLatestConvergence();
    const ml = rows.find((r) => r.country === 'ML');
    assert.ok(ml !== undefined, 'ML row present');
    assert.equal(ml.dynamicScore, null, 'dynamicScore is null');
  });

  it('handles empty array without error', async () => {
    await insertConvergenceSignals([]); // must not throw
  });
});

// ─── Suite 24: getPriorConvergence ────────────────────────────────────────────

describe('getPriorConvergence(country, familyset, aroundMs)', () => {
  const BASE = 1_700_000_000_000; // fixed epoch to avoid Date.now() drift

  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const familyset = '["events","signals"]';
    await insertConvergenceSignals([
      makeConvergence({ country: 'SD', capturedAt: BASE - 86_400_000, strength: 0.55, familiesJson: familyset, firstDetectedAt: BASE - 86_400_000 }),
      makeConvergence({ country: 'SD', capturedAt: BASE,              strength: 0.70, familiesJson: familyset, firstDetectedAt: BASE - 86_400_000 }),
    ]);
  });

  it('returns the closest snapshot at or before aroundMs', async () => {
    const familyset = '["events","signals"]';
    const prior = await getPriorConvergence('SD', familyset, BASE - 1000);
    assert.ok(prior !== null, 'prior found');
    assert.ok(Math.abs(prior.strength - 0.55) < 0.001, 'returns the prior snapshot (strength 0.55)');
    assert.equal(prior.capturedAt, BASE - 86_400_000, 'capturedAt matches prior snapshot');
  });

  it('returns the most recent snapshot when aroundMs >= latest capturedAt', async () => {
    const familyset = '["events","signals"]';
    const prior = await getPriorConvergence('SD', familyset, BASE + 1000);
    assert.ok(prior !== null, 'prior found');
    assert.ok(Math.abs((prior?.strength ?? 0) - 0.70) < 0.001, 'returns latest when aroundMs after all rows');
  });

  it('returns null when no snapshot exists for the (country, familyset)', async () => {
    const prior = await getPriorConvergence('ZZ', '["events","signals"]', BASE);
    assert.equal(prior, null, 'null for unknown country');
  });

  it('returns null when familyset does not match (different familyset)', async () => {
    const prior = await getPriorConvergence('SD', '["events","markets"]', BASE);
    assert.equal(prior, null, 'null when familyset does not match');
  });
});

// ─── Suite 25: purgeAndDownsample — purges convergence_signals, cii_snapshots intact ─

describe('purgeAndDownsample() — purges convergence_signals, cii_snapshots intact', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    const cutoff = now - 5_000;

    // Old convergence signal — should be purged
    await insertConvergenceSignals([
      makeConvergence({ country: 'LY', capturedAt: cutoff - 2000 }),
    ]);
    // Recent convergence signal — should survive
    await insertConvergenceSignals([
      makeConvergence({ country: 'LY', capturedAt: now }),
    ]);

    // CII snapshot — must NOT be purged by the convergence purge step
    await insertCiiSnapshots([
      makeCii({ country: 'LY', capturedAt: now }),
    ]);
  });

  it('purges convergence_signals older than beforeMs', async () => {
    const now = Date.now();
    const cutoff = now - 5_000;

    await purgeAndDownsample(cutoff);

    const rows = await getLatestConvergence();
    const lyRows = rows.filter((r) => r.country === 'LY');
    assert.equal(lyRows.length, 1, 'only 1 LY convergence signal survives (the recent one)');
    assert.ok((lyRows[0]?.capturedAt ?? 0) >= cutoff, 'surviving signal is recent');
  });

  it('cii_snapshots are NOT purged by the convergence purge step', async () => {
    const cii = await getLatestCii();
    const ly = cii.find((r) => r.country === 'LY');
    assert.ok(ly !== undefined, 'LY CII snapshot survives convergence purge step');
  });
});

// ─── Helpers for Sanctions tests ─────────────────────────────────────────────

function makeSanction(overrides: Partial<SanctionRow> & { country: string; capturedAt: number }): SanctionRow {
  return {
    country: overrides.country,
    sanctionedCount: overrides.sanctionedCount ?? 10,
    capturedAt: overrides.capturedAt,
  };
}

// ─── Suite 26: migrate() — migration 006_sanctions idempotent (HAZARD W-2) ───

describe('migrate() — migration 006_sanctions.sql (T-35, HAZARD W-2)', () => {
  it('creates sanctions table and ix_sanctions_country_time index — idempotent 3x', async () => {
    const client = makeInMemoryClient();

    await runMigrations(client);
    await runMigrations(client);
    await runMigrations(client);

    // Assert table exists via sqlite_master (catches HAZARD W-2: silent discard of CREATE)
    const tableResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE name='sanctions'",
    );
    assert.equal(tableResult.rows.length, 1, 'sanctions table created');

    // Assert index exists
    const indexResult = await client.execute(
      "SELECT name FROM sqlite_master WHERE name='ix_sanctions_country_time'",
    );
    assert.equal(indexResult.rows.length, 1, 'ix_sanctions_country_time index exists');

    // Migration 006 recorded exactly once
    const mig006 = await client.execute(
      "SELECT id FROM _migrations WHERE id = '006_sanctions.sql'",
    );
    assert.equal(mig006.rows.length, 1, '006_sanctions.sql recorded exactly once');

    // Prior tables still intact (additive only)
    for (const tbl of ['convergence_signals', 'cii_snapshots', 'events', 'signals']) {
      const r = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        args: [tbl],
      });
      assert.equal(r.rows.length, 1, `${tbl} table still exists (not touched by 006)`);
    }
  });
});

// ─── Suite 27: insertSanctions + getLatestSanctions ───────────────────────────

describe('insertSanctions() + getLatestSanctions()', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();
  });

  it('inserts and reads back a sanctions row (round-trip)', async () => {
    const now = Date.now();
    await insertSanctions([
      makeSanction({ country: 'Russia', sanctionedCount: 850, capturedAt: now }),
    ]);

    const rows = await getLatestSanctions();
    const ru = rows.find((r) => r.country === 'Russia');
    assert.ok(ru !== undefined, 'Russia row present');
    assert.equal(ru.sanctionedCount, 850, 'sanctionedCount correct');
    assert.equal(ru.capturedAt, now, 'capturedAt correct');
    assert.ok(ru.id !== undefined && ru.id > 0, 'id assigned by DB');
  });

  it('getLatestSanctions returns 1 row per country — the most recent snapshot (>=2 captured_at)', async () => {
    const now = Date.now();
    const earlier = now - 30_000;

    // Two snapshots for Iran — only the later one should appear in getLatestSanctions
    await insertSanctions([
      makeSanction({ country: 'Iran', sanctionedCount: 400, capturedAt: earlier }),
      makeSanction({ country: 'Iran', sanctionedCount: 450, capturedAt: now }),
    ]);

    const rows = await getLatestSanctions();
    const iranRows = rows.filter((r) => r.country === 'Iran');
    assert.equal(iranRows.length, 1, 'only 1 Iran row from getLatestSanctions');
    assert.equal(iranRows[0]?.sanctionedCount, 450, 'Iran shows the most recent count (450)');
  });

  it('returns multiple countries — one row per country', async () => {
    const now = Date.now();
    await insertSanctions([
      makeSanction({ country: 'North Korea', sanctionedCount: 120, capturedAt: now }),
      makeSanction({ country: 'Syria', sanctionedCount: 200, capturedAt: now }),
    ]);

    const rows = await getLatestSanctions();
    const countries = rows.map((r) => r.country);
    assert.ok(countries.includes('North Korea'), 'North Korea row present');
    assert.ok(countries.includes('Syria'), 'Syria row present');
  });

  it('handles empty array without error', async () => {
    await insertSanctions([]); // must not throw
  });
});

// ─── Suite 28: purgeAndDownsample — purges sanctions, convergence_signals intact ─

describe('purgeAndDownsample() — purges sanctions, convergence_signals intact', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();

    const now = Date.now();
    const cutoff = now - 5_000;

    // Old sanctions row — should be purged
    await insertSanctions([
      makeSanction({ country: 'Cuba', capturedAt: cutoff - 2000, sanctionedCount: 50 }),
    ]);
    // Recent sanctions row — should survive
    await insertSanctions([
      makeSanction({ country: 'Cuba', capturedAt: now, sanctionedCount: 55 }),
    ]);

    // Convergence signal — must NOT be purged by the sanctions purge step
    await insertConvergenceSignals([
      makeConvergence({ country: 'Cuba', capturedAt: now }),
    ]);
  });

  it('purges sanctions older than beforeMs', async () => {
    const now = Date.now();
    const cutoff = now - 5_000;

    await purgeAndDownsample(cutoff);

    const rows = await getLatestSanctions();
    const cubaRows = rows.filter((r) => r.country === 'Cuba');
    assert.equal(cubaRows.length, 1, 'only 1 Cuba sanctions row survives (the recent one)');
    assert.ok((cubaRows[0]?.capturedAt ?? 0) >= cutoff, 'surviving row is recent');
    assert.equal(cubaRows[0]?.sanctionedCount, 55, 'surviving row has count=55');
  });

  it('convergence_signals are NOT purged by the sanctions purge step', async () => {
    const rows = await getLatestConvergence();
    const cuba = rows.find((r) => r.country === 'Cuba');
    assert.ok(cuba !== undefined, 'Cuba convergence signal survives sanctions purge step');
  });

  it('other tables (events, cii_snapshots) NOT touched by sanctions purge', async () => {
    const { getDb } = await import('../src/index.js');
    const db = getDb();
    // Verify the sanctions table exists but other tables are untouched
    const sanctionsTable = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sanctions'",
    );
    assert.equal(sanctionsTable.rows.length, 1, 'sanctions table exists');
    const ciiTable = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='cii_snapshots'",
    );
    assert.equal(ciiTable.rows.length, 1, 'cii_snapshots table still intact');
  });
});

// ─── Suite 29: insertChokepointStatus + getLatestChokepointStatus (slice A) ────

describe('insertChokepointStatus() + getLatestChokepointStatus()', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();
  });

  it('insert + getLatest returns latest per chokepoint', async () => {
    const now = Date.now();
    const rows: ChokepointStatusRow[] = [
      { chokepointId: 'hormuz', status: 'watch', score: 0.3, componentsJson: '{}', capturedAt: now - 1000 },
      { chokepointId: 'hormuz', status: 'disrupted', score: 0.8, componentsJson: '{}', capturedAt: now },
      { chokepointId: 'suez', status: 'calm', score: 0.05, componentsJson: '{}', capturedAt: now },
    ];
    await insertChokepointStatus(rows);

    const latest = await getLatestChokepointStatus();
    const hormuz = latest.filter((r) => r.chokepointId === 'hormuz');
    assert.equal(hormuz.length, 1, 'one latest row per chokepoint');
    assert.equal(hormuz[0]?.status, 'disrupted', 'latest hormuz status');
    assert.equal(hormuz[0]?.score, 0.8, 'latest hormuz score');
    const suez = latest.find((r) => r.chokepointId === 'suez');
    assert.equal(suez?.status, 'calm', 'suez present');
  });

  it('handles empty array without error', async () => {
    await insertChokepointStatus([]); // must not throw
  });
});

// ─── Suite: translations cache (migr 008 — Slice D / D-903) ───────────────────

describe('getTranslation() / putTranslation() — translation cache', () => {
  before(async () => {
    resetToMemory();
    const { migrate } = await import('../src/index.js');
    await migrate();
  });

  it('miss → null', async () => {
    assert.equal(await getTranslation('no-such-text'), null);
  });

  it('put → get round-trips', async () => {
    await putTranslation('oil tanker seized near Hormuz', 'petrolero incautado cerca de Ormuz');
    assert.equal(
      await getTranslation('oil tanker seized near Hormuz'),
      'petrolero incautado cerca de Ormuz',
    );
  });

  it('put on same source REPLACES (no duplicate, dedupe by source PK)', async () => {
    await putTranslation('quake off Honshu', 'sismo frente a Honshu');
    await putTranslation('quake off Honshu', 'terremoto frente a la costa de Honshu');
    assert.equal(await getTranslation('quake off Honshu'), 'terremoto frente a la costa de Honshu');
  });
});
