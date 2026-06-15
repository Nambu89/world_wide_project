/**
 * server.test.ts — node:test integration tests for server.ts
 *
 * Strategy:
 * - Use LIBSQL_URL=':memory:' (set before any @www/store import) so the DB
 *   is ephemeral and tests never touch disk or a real Turso instance.
 * - Start createApp({ startScheduler: false }) on port 0 (ephemeral) so tests
 *   never conflict with a running dev server.
 * - All reads go through the store (DB) — no upstream network calls.
 */

// Set env BEFORE any store import so @libsql/client picks up :memory:
process.env['LIBSQL_URL'] = ':memory:';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';

import { migrate, insertMarketSnapshots, upsertEvents, upsertSignals, insertCiiSnapshots, _resetDbForTesting } from '@www/store';
import type { EventRow, SignalRow, SignalTrendPoint, CiiSnapshotRow } from '@www/store';
import { createApp } from './server.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function get(server: http.Server, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 3001;

    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('server.ts integration', () => {
  let server: http.Server;

  before(async () => {
    // Reset singleton DB so each test run starts fresh (relevant for watch mode)
    _resetDbForTesting();

    // Run migrations on :memory: DB
    await migrate();

    // Seed 2 market snapshots
    const now = Date.now();
    await insertMarketSnapshots([
      {
        source: 'test',
        symbol: 'AAPL',
        asset_class: 'equity',
        price: 180.5,
        change_pct: 1.2,
        captured_at: now - 1000,
      },
      {
        source: 'test',
        symbol: 'BTC-USD',
        asset_class: 'crypto',
        price: 65000,
        change_pct: -0.5,
        captured_at: now,
      },
    ]);

    // Seed events for T-12 tests
    const seedEvents: EventRow[] = [
      {
        source: 'usgs',
        sourceEventId: 'usgs-test-001',
        eventType: 'earthquake',
        category: 'natural',
        severity: 72,
        lat: 34.5,
        lon: -118.2,
        country: 'US',
        title: 'M 4.5 - Southern California',
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/usgs-test-001',
        occurredAt: now - 3600_000,
        capturedAt: now - 1000,
        rawJson: JSON.stringify({ mag: 4.5, sig: 300, alert: null, tsunami: 0 }),
      },
      {
        source: 'eonet',
        sourceEventId: 'EONET_TEST_002',
        eventType: 'wildfire',
        category: 'natural',
        severity: 55,
        lat: 37.8,
        lon: -122.4,
        country: 'US',
        title: 'Wildfire near Oakland',
        url: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_TEST_002',
        occurredAt: now - 7200_000,
        capturedAt: now - 500,
        rawJson: JSON.stringify({ categories: ['wildfires'], closed: null }),
      },
      {
        source: 'gdelt',
        sourceEventId: 'gdelt-test-003',
        eventType: 'conflict',
        category: 'conflict',
        severity: 60,
        lat: 48.8,
        lon: 2.35,
        country: 'FR',
        title: 'Protest in Paris',
        url: 'https://gdeltproject.org/events/gdelt-test-003',
        occurredAt: now - 10_800_000,
        capturedAt: now - 200,
        rawJson: JSON.stringify({ quadClass: 3, goldstein: -5.0, avgTone: -3.2 }),
      },
      {
        source: 'usgs',
        sourceEventId: 'usgs-test-004',
        eventType: 'earthquake',
        category: 'natural',
        severity: 30,
        lat: 51.5,
        lon: -0.1,
        country: 'GB',
        title: 'M 2.1 - UK',
        url: null,
        occurredAt: now - 86_400_000, // 1 day ago — for sinceMs filter test
        capturedAt: now - 86_400_000,
        rawJson: null,
      },
    ];
    await upsertEvents(seedEvents);

    // Seed signals for T-19 tests
    const now2 = Date.now();
    const seedSignals: SignalRow[] = [
      {
        source: 'gkg',
        signalId: 'gkg-test-001',
        title: 'Oil prices surge amid supply concerns',
        url: 'https://example.com/oil-1',
        tone: -4.5,
        themes: 'ENV_OIL;ECON_MARKETS',
        persons: null,
        organizations: 'OPEC',
        lat: 25.0,
        lon: 55.0,
        country: 'AE',
        occurredAt: now2 - 3_600_000,
        capturedAt: now2 - 1000,
        rawJson: JSON.stringify({ v2tone: '-4.5,2.1,3.0' }),
        sections: [
          { section: 'commodities_energy', matchedBy: 'theme' },
        ],
      },
      {
        source: 'gkg',
        signalId: 'gkg-test-002',
        title: 'Semiconductor export controls tightened',
        url: 'https://example.com/semis-1',
        tone: -7.2,
        themes: 'ECON_SEMIS;SANCTIONS',
        persons: null,
        organizations: 'NVIDIA;TSMC',
        lat: 25.0,
        lon: 121.0,
        country: 'TW',
        occurredAt: now2 - 7_200_000,
        capturedAt: now2 - 500,
        rawJson: JSON.stringify({ v2tone: '-7.2,1.0,2.5' }),
        sections: [
          { section: 'semis_ai_tech', matchedBy: 'keyword' },
          { section: 'trade_sanctions', matchedBy: 'theme' },
        ],
      },
    ];
    await upsertSignals(seedSignals);

    // Seed CII snapshots for T-25 tests (≥2 countries; Japan has centroid, ZZZ does not)
    const now3 = Date.now();
    const seedCii: CiiSnapshotRow[] = [
      {
        country: 'Japan',
        composite: 42.5,
        baselineRisk: 30.0,
        eventScore: 12.5,
        dynamicScore: 2.1,
        trend: 'rising',
        methodologyVersion: '1.0.0',
        componentsJson: JSON.stringify({ baseline: 30.0, events: 12.5 }),
        capturedAt: now3 - 3_600_000,
      },
      {
        country: 'Japan',
        composite: 44.0,
        baselineRisk: 30.0,
        eventScore: 14.0,
        dynamicScore: 1.5,
        trend: 'rising',
        methodologyVersion: '1.0.0',
        componentsJson: JSON.stringify({ baseline: 30.0, events: 14.0 }),
        capturedAt: now3 - 1_800_000,
      },
      {
        country: 'Germany',
        composite: 28.0,
        baselineRisk: 20.0,
        eventScore: 8.0,
        dynamicScore: null,
        trend: 'stable',
        methodologyVersion: '1.0.0',
        componentsJson: JSON.stringify({ baseline: 20.0, events: 8.0 }),
        capturedAt: now3 - 900_000,
      },
      {
        // Country without centroid — lat/lon must be null in /api/cii response
        country: 'ZZZ-NoMap',
        composite: 55.0,
        baselineRisk: 45.0,
        eventScore: 10.0,
        dynamicScore: -1.0,
        trend: 'falling',
        methodologyVersion: '1.0.0',
        componentsJson: JSON.stringify({ baseline: 45.0, events: 10.0 }),
        capturedAt: now3 - 600_000,
      },
    ];
    await insertCiiSnapshots(seedCii);

    // Start server on ephemeral port (no scheduler)
    server = createApp({ startScheduler: false });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => {
    server.close();
  });

  // ── /api/health ────────────────────────────────────────────────────────────

  it('GET /api/health → 200', async () => {
    const { status, body } = await get(server, '/api/health');
    assert.equal(status, 200);
    const json = JSON.parse(body) as { status: string; ts: number };
    assert.equal(json.status, 'ok');
    assert.ok(typeof json.ts === 'number', 'ts should be a number');
  });

  // ── /api/markets ──────────────────────────────────────────────────────────

  it('GET /api/markets → 200 with seeded snapshots', async () => {
    const { status, body } = await get(server, '/api/markets');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ symbol: string; price: number }>;
    assert.ok(Array.isArray(rows), 'should be an array');
    assert.equal(rows.length, 2, 'should return 2 snapshots (1 per symbol)');

    const symbols = rows.map((r) => r.symbol).sort();
    assert.deepEqual(symbols, ['AAPL', 'BTC-USD']);

    const aapl = rows.find((r) => r.symbol === 'AAPL');
    assert.ok(aapl, 'AAPL should be present');
    assert.equal(aapl.price, 180.5);
  });

  it('GET /api/markets reads from DB not upstream (no network calls)', async () => {
    // Structural test: the endpoint calls getLatestMarkets() which only queries
    // the local SQLite store. There is no network-facing code in the route.
    // We verify by confirming the returned data exactly matches what we seeded.
    const { status, body } = await get(server, '/api/markets');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ source: string }>;
    for (const row of rows) {
      assert.equal(row.source, 'test', 'source should be the seeded test value');
    }
  });

  // ── /api/markets/:symbol ──────────────────────────────────────────────────

  it('GET /api/markets/AAPL → 200 with trend data', async () => {
    const since = Date.now() - 24 * 60 * 60 * 1000; // 1 day ago
    const { status, body } = await get(server, `/api/markets/AAPL?since=${since}`);
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ symbol: string }>;
    assert.ok(Array.isArray(rows), 'should be an array');
    assert.ok(rows.length >= 1, 'should have at least 1 AAPL snapshot');
    assert.ok(rows.every((r) => r.symbol === 'AAPL'), 'all rows should be AAPL');
  });

  // ── /api/gdelt ────────────────────────────────────────────────────────────

  it('GET /api/gdelt → 200 (empty array; no upstream call)', async () => {
    const { status, body } = await get(server, '/api/gdelt');
    assert.equal(status, 200);
    const rows = JSON.parse(body);
    assert.ok(Array.isArray(rows), 'should be an array');
  });

  // ── /api/briefing ─────────────────────────────────────────────────────────

  it('GET /api/briefing → 200 with { briefing: null } when no cache exists', async () => {
    const { status, body } = await get(server, '/api/briefing');
    assert.equal(status, 200);
    const json = JSON.parse(body) as { briefing: null | object };

    // Shape must be { briefing: null } — no Anthropic call was made.
    // If briefing is not null something incorrectly generated a briefing.
    assert.equal(json.briefing, null, 'briefing should be null — no Anthropic call on-request');
  });

  it('GET /api/briefing does NOT call Anthropic (structural: route only calls getCachedBriefing)', async () => {
    // Structural proof: getCachedBriefing queries the briefings table.
    // Since we never called generateDailyBriefing (scheduler is off),
    // the briefings table is empty → getCachedBriefing returns null.
    // A non-null response here would mean something called Anthropic on-request (bug).
    const { status, body } = await get(server, '/api/briefing');
    assert.equal(status, 200);
    const json = JSON.parse(body) as { briefing: unknown };
    assert.equal(json.briefing, null);
    // No further assertions needed: if null, Anthropic was NOT called.
  });

  // ── Misc ──────────────────────────────────────────────────────────────────

  it('GET /api/unknown → 404', async () => {
    const { status } = await get(server, '/api/unknown-route');
    assert.equal(status, 404);
  });

  it('Non-GET method → 405', async () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 3001;
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/api/health', method: 'POST' },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 405);
  });

  // ── /api/events (T-12) ────────────────────────────────────────────────────

  it('GET /api/events → 200 with seeded events', async () => {
    const { status, body } = await get(server, '/api/events');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as unknown[];
    assert.ok(Array.isArray(rows), 'should be an array');
    assert.ok(rows.length >= 4, 'should return all 4 seeded events');
  });

  it('GET /api/events?type=earthquake → filters by eventType', async () => {
    const { status, body } = await get(server, '/api/events?type=earthquake');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ eventType: string }>;
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 1, 'should have earthquake events');
    assert.ok(rows.every((r) => r.eventType === 'earthquake'), 'all rows should be earthquake');
  });

  it('GET /api/events?category=conflict → filters by category', async () => {
    const { status, body } = await get(server, '/api/events?category=conflict');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ category: string }>;
    assert.ok(Array.isArray(rows));
    assert.ok(rows.every((r) => r.category === 'conflict'), 'all rows should be conflict');
  });

  it('GET /api/events?category=natural → filters natural events', async () => {
    const { status, body } = await get(server, '/api/events?category=natural');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ category: string }>;
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 1, 'should have natural events');
    assert.ok(rows.every((r) => r.category === 'natural'), 'all rows should be natural');
  });

  it('GET /api/events?minSeverity=60 → filters by severity', async () => {
    const { status, body } = await get(server, '/api/events?minSeverity=60');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ severity: number }>;
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 1);
    // usgs-test-001 (72) and gdelt-test-003 (60) should appear; usgs-test-004 (30) and eonet (55) should not
    assert.ok(rows.every((r) => r.severity >= 60), 'all rows severity >= 60');
  });

  it('GET /api/events?since=<recent> → filters by capturedAt', async () => {
    const since = Date.now() - 60_000; // last 60 seconds — only recent captures qualify
    const { status, body } = await get(server, `/api/events?since=${since}`);
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ capturedAt: number }>;
    assert.ok(Array.isArray(rows));
    // The 3 recent events (capturedAt < 8s ago) qualify; usgs-test-004 (1 day ago) does not
    assert.ok(rows.every((r) => r.capturedAt >= since), 'all rows within sinceMs window');
    // usgs-test-004 (capturedAt = now-86400000) must NOT be in results
    const hasOld = rows.some((r) => r.capturedAt < since);
    assert.equal(hasOld, false, 'old event should be excluded');
  });

  it('GET /api/events?limit=2 → respects limit', async () => {
    const { status, body } = await get(server, '/api/events?limit=2');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as unknown[];
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 2, 'should return at most 2 rows');
  });

  it('GET /api/events?bbox=<bbox enclosing US West Coast> → filters by bbox', async () => {
    // bbox: minLon=-125, minLat=30, maxLon=-100, maxLat=50 — covers CA/OR/WA
    const { status, body } = await get(server, '/api/events?bbox=-125,30,-100,50');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ lat: number; lon: number; sourceEventId: string }>;
    assert.ok(Array.isArray(rows));
    // usgs-test-001 (lat=34.5, lon=-118.2) and eonet-002 (lat=37.8, lon=-122.4) are in bbox
    const ids = rows.map((r) => r.sourceEventId);
    assert.ok(ids.includes('usgs-test-001'), 'usgs-test-001 should be in bbox result');
    assert.ok(ids.includes('EONET_TEST_002'), 'EONET_TEST_002 should be in bbox result');
    // gdelt (lon=2.35) and usgs-004 (lon=-0.1) are outside — should NOT appear
    assert.ok(!ids.includes('gdelt-test-003'), 'gdelt-test-003 (Paris) should be outside bbox');
    assert.ok(!ids.includes('usgs-test-004'), 'usgs-test-004 (UK) should be outside bbox');
  });

  it('GET /api/events?bbox=<invalid> → ignores bad bbox, returns all events', async () => {
    // Malformed bbox (only 3 values) → silently ignored → returns all events
    const { status, body } = await get(server, '/api/events?bbox=1,2,3');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as unknown[];
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 4, 'bad bbox is ignored; all 4 events should be returned');
  });

  // ── /api/events/:source/:id (T-12) ────────────────────────────────────────

  it('GET /api/events/usgs/usgs-test-001 → 200 with event detail + parsed rawJson', async () => {
    const { status, body } = await get(server, '/api/events/usgs/usgs-test-001');
    assert.equal(status, 200);
    const event = JSON.parse(body) as {
      source: string;
      sourceEventId: string;
      eventType: string;
      rawJson: { mag?: number } | null;
    };
    assert.equal(event.source, 'usgs');
    assert.equal(event.sourceEventId, 'usgs-test-001');
    assert.equal(event.eventType, 'earthquake');
    // raw_json was stored as a JSON string; the endpoint parses it to an object
    assert.ok(event.rawJson !== null, 'rawJson should be present');
    assert.ok(typeof event.rawJson === 'object', 'rawJson should be parsed to object, not string');
    assert.equal((event.rawJson as { mag: number }).mag, 4.5);
  });

  it('GET /api/events/usgs/does-not-exist → 404', async () => {
    const { status, body } = await get(server, '/api/events/usgs/does-not-exist');
    assert.equal(status, 404);
    const json = JSON.parse(body) as { error: string };
    assert.equal(json.error, 'Not Found');
  });

  it('GET /api/events/eonet/EONET_TEST_002 → 200', async () => {
    const { status, body } = await get(server, '/api/events/eonet/EONET_TEST_002');
    assert.equal(status, 200);
    const event = JSON.parse(body) as { source: string; eventType: string };
    assert.equal(event.source, 'eonet');
    assert.equal(event.eventType, 'wildfire');
  });

  it('GET /api/events/usgs/usgs-test-004 → 200 with null rawJson', async () => {
    // Event seeded with rawJson: null
    const { status, body } = await get(server, '/api/events/usgs/usgs-test-004');
    assert.equal(status, 200);
    const event = JSON.parse(body) as { rawJson: null };
    assert.equal(event.rawJson, null);
  });

  // ── /api/gdelt retro-compat (T-12 acceptance) ─────────────────────────────

  it('GET /api/gdelt → 200 still reads events source=gdelt (retro-compat)', async () => {
    const { status, body } = await get(server, '/api/gdelt');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ source: string; event_id?: string }>;
    assert.ok(Array.isArray(rows), 'should be an array');
    // The seeded gdelt event should appear via getRecentGdeltEvents
    // (which reads events WHERE source='gdelt')
    assert.ok(rows.length >= 1, 'should return at least the seeded gdelt event');
    assert.ok(rows.every((r) => r.source === 'gdelt'), 'all rows should have source=gdelt');
  });

  // ── Fase 1 endpoints still green (regression guard) ──────────────────────

  it('GET /api/health still 200 after T-12 routes added', async () => {
    const { status } = await get(server, '/api/health');
    assert.equal(status, 200);
  });

  it('GET /api/markets still 200 after T-12 routes added', async () => {
    const { status } = await get(server, '/api/markets');
    assert.equal(status, 200);
  });

  it('GET /api/briefing still 200 after T-12 routes added', async () => {
    const { status } = await get(server, '/api/briefing');
    assert.equal(status, 200);
  });

  // ── /api/signals (T-19) ───────────────────────────────────────────────────

  it('GET /api/signals → 200 with all seeded signals', async () => {
    const { status, body } = await get(server, '/api/signals');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as SignalRow[];
    assert.ok(Array.isArray(rows), 'should be an array');
    assert.ok(rows.length >= 2, 'should return all seeded signals');
    // camelCase wire (L-1)
    assert.ok('signalId' in rows[0]!, 'should have signalId (camelCase)');
    assert.ok('capturedAt' in rows[0]!, 'should have capturedAt (camelCase)');
    assert.ok(Array.isArray(rows[0]?.sections), 'sections should be an array');
  });

  it('GET /api/signals?section=commodities_energy → filters by section', async () => {
    const { status, body } = await get(server, '/api/signals?section=commodities_energy');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as SignalRow[];
    assert.ok(Array.isArray(rows), 'should be an array');
    assert.ok(rows.length >= 1, 'should have at least 1 commodities_energy signal');
    const ids = rows.map((r) => r.signalId);
    assert.ok(ids.includes('gkg-test-001'), 'gkg-test-001 should be in commodities_energy');
    assert.ok(!ids.includes('gkg-test-002'), 'gkg-test-002 (semis/sanctions) should NOT appear');
  });

  it('GET /api/signals?section=semis_ai_tech → filters by section', async () => {
    const { status, body } = await get(server, '/api/signals?section=semis_ai_tech');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as SignalRow[];
    assert.ok(Array.isArray(rows));
    const ids = rows.map((r) => r.signalId);
    assert.ok(ids.includes('gkg-test-002'), 'gkg-test-002 should be in semis_ai_tech');
  });

  it('GET /api/signals?minToneMag=6 → filters by |tone| threshold', async () => {
    // gkg-test-001 tone=-4.5 (|tone|=4.5 < 6) → excluded
    // gkg-test-002 tone=-7.2 (|tone|=7.2 >= 6) → included
    const { status, body } = await get(server, '/api/signals?minToneMag=6');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as SignalRow[];
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 1, 'should have at least 1 high-magnitude signal');
    const ids = rows.map((r) => r.signalId);
    assert.ok(ids.includes('gkg-test-002'), 'gkg-test-002 (|tone|=7.2) should pass threshold');
    assert.ok(!ids.includes('gkg-test-001'), 'gkg-test-001 (|tone|=4.5) should be filtered out');
  });

  it('GET /api/signals?limit=1 → respects limit', async () => {
    const { status, body } = await get(server, '/api/signals?limit=1');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as unknown[];
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 1, 'should return exactly 1 row');
  });

  it('GET /api/signals?section=nope → 400 invalid section', async () => {
    const { status, body } = await get(server, '/api/signals?section=nope');
    assert.equal(status, 400);
    const json = JSON.parse(body) as { error: string };
    assert.ok(json.error.includes('section'), 'error message should mention section');
  });

  // ── /api/signals/trend (T-19) ─────────────────────────────────────────────

  it('GET /api/signals/trend?section=commodities_energy → 200 with SignalTrendPoint[]', async () => {
    const { status, body } = await get(server, '/api/signals/trend?section=commodities_energy');
    assert.equal(status, 200);
    const points = JSON.parse(body) as SignalTrendPoint[];
    assert.ok(Array.isArray(points), 'should be an array');
    assert.ok(points.length >= 1, 'should have at least 1 trend bucket');
    const p = points[0]!;
    assert.ok(typeof p.bucketMs === 'number', 'bucketMs should be a number');
    assert.ok(typeof p.volume === 'number', 'volume should be a number');
    assert.ok(p.avgTone === null || typeof p.avgTone === 'number', 'avgTone should be number|null');
    assert.ok(p.volume >= 1, 'volume should be >= 1');
  });

  it('GET /api/signals/trend without section → 400', async () => {
    const { status, body } = await get(server, '/api/signals/trend');
    assert.equal(status, 400);
    const json = JSON.parse(body) as { error: string };
    assert.ok(json.error.includes('section'), 'error message should mention section');
  });

  it('GET /api/signals/trend?section=nope → 400 invalid section', async () => {
    const { status, body } = await get(server, '/api/signals/trend?section=nope');
    assert.equal(status, 400);
    const json = JSON.parse(body) as { error: string };
    assert.ok(json.error.includes('section'), 'error message should mention section');
  });

  // ── Regression guard: previous endpoints still green after T-19 ───────────

  it('GET /api/health still 200 after T-19 routes added', async () => {
    const { status } = await get(server, '/api/health');
    assert.equal(status, 200);
  });

  it('GET /api/events still 200 after T-19 routes added', async () => {
    const { status } = await get(server, '/api/events');
    assert.equal(status, 200);
  });

  // ── /api/cii (T-25) ───────────────────────────────────────────────────────

  it('GET /api/cii → 200 with latest snapshot per country + centroids', async () => {
    const { status, body } = await get(server, '/api/cii');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{
      country: string;
      composite: number;
      lat: number | null;
      lon: number | null;
    }>;
    assert.ok(Array.isArray(rows), 'should be an array');
    // 3 countries seeded: Japan, Germany, ZZZ-NoMap
    assert.ok(rows.length >= 3, 'should return at least 3 country snapshots');
    // camelCase wire (L-1)
    const firstRow = rows[0]!;
    assert.ok('country' in firstRow, 'should have country');
    assert.ok('composite' in firstRow, 'should have composite (camelCase)');
    // lat/lon present on each row (may be null)
    assert.ok('lat' in firstRow, 'should have lat field');
    assert.ok('lon' in firstRow, 'should have lon field');
  });

  it('GET /api/cii → Japan row has non-null lat/lon (known centroid)', async () => {
    const { status, body } = await get(server, '/api/cii');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ country: string; lat: number | null; lon: number | null }>;
    const japan = rows.find((r) => r.country === 'Japan');
    assert.ok(japan !== undefined, 'Japan should be present');
    assert.ok(japan.lat !== null, 'Japan lat should not be null');
    assert.ok(japan.lon !== null, 'Japan lon should not be null');
    assert.ok(typeof japan.lat === 'number', 'Japan lat should be a number');
    assert.ok(typeof japan.lon === 'number', 'Japan lon should be a number');
  });

  it('GET /api/cii → ZZZ-NoMap row has lat/lon null (no centroid)', async () => {
    const { status, body } = await get(server, '/api/cii');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ country: string; lat: number | null; lon: number | null }>;
    const noMap = rows.find((r) => r.country === 'ZZZ-NoMap');
    assert.ok(noMap !== undefined, 'ZZZ-NoMap should be present');
    assert.equal(noMap.lat, null, 'unknown country lat should be null');
    assert.equal(noMap.lon, null, 'unknown country lon should be null');
  });

  it('GET /api/cii → returns only latest snapshot per country (not all rows)', async () => {
    // Japan has 2 snapshots; only the most recent (composite=44.0) should appear
    const { status, body } = await get(server, '/api/cii');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ country: string; composite: number }>;
    const japanRows = rows.filter((r) => r.country === 'Japan');
    assert.equal(japanRows.length, 1, 'only 1 Japan row (latest) should appear');
    assert.equal(japanRows[0]!.composite, 44.0, 'latest Japan composite should be 44.0');
  });

  // ── /api/cii/:country (T-25) ──────────────────────────────────────────────

  it('GET /api/cii/Japan → 200 with CII trend for Japan', async () => {
    const since = Date.now() - 24 * 60 * 60 * 1000; // 1 day ago — covers seeded rows
    const { status, body } = await get(server, `/api/cii/Japan?since=${since}`);
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ country: string; composite: number; capturedAt: number }>;
    assert.ok(Array.isArray(rows), 'should be an array');
    assert.ok(rows.length >= 2, 'Japan should have 2 seeded trend rows');
    assert.ok(rows.every((r) => r.country === 'Japan'), 'all rows should be Japan');
    // rows returned ASC by capturedAt
    assert.ok(rows[0]!.capturedAt <= rows[rows.length - 1]!.capturedAt, 'should be sorted ASC by capturedAt');
  });

  it('GET /api/cii/Germany → 200 with CII trend for Germany', async () => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const { status, body } = await get(server, `/api/cii/Germany?since=${since}`);
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ country: string; trend: string | null }>;
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 1, 'Germany should have 1 trend row');
    assert.equal(rows[0]!.country, 'Germany');
    assert.equal(rows[0]!.trend, 'stable');
  });

  it('GET /api/cii/Unknown-Country → 200 with empty array (no data, never 500)', async () => {
    const { status, body } = await get(server, '/api/cii/Unknown-Country');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as unknown[];
    assert.ok(Array.isArray(rows), 'should be an array');
    assert.equal(rows.length, 0, 'unknown country should return empty array, not 500');
  });

  it('GET /api/cii/:country is checked BEFORE /api/cii (routing order)', async () => {
    // If /api/cii matched first for /api/cii/Japan, it would 404.
    // A 200 here proves the :country route is checked first.
    const { status } = await get(server, '/api/cii/Japan');
    assert.equal(status, 200);
  });

  // ── Regression guard: previous endpoints still green after T-25 ──────────

  it('GET /api/health still 200 after T-25 routes added', async () => {
    const { status } = await get(server, '/api/health');
    assert.equal(status, 200);
  });

  it('GET /api/signals still 200 after T-25 routes added', async () => {
    const { status } = await get(server, '/api/signals');
    assert.equal(status, 200);
  });

  it('GET /api/events still 200 after T-25 routes added', async () => {
    const { status } = await get(server, '/api/events');
    assert.equal(status, 200);
  });
});
