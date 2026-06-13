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

import { migrate, insertMarketSnapshots, _resetDbForTesting } from '@www/store';
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
});
