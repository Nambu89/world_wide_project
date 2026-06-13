// packages/store/src/index.ts
// @www/store — normative public API (T-02)
// ADR-006: @libsql/client, url file:./data/world.db
// D-100: wide-typed schema; D-101: captured_at epoch ms + source; D-102: 90d retention + downsampling

import type { Client as LibsqlClient } from '@libsql/client';
import { getDb, _resetDbForTesting } from './db.js';
import { migrate as runMigrations } from './migrate.js';
import type { MarketSnapshot, GdeltEvent, NewsItem, Briefing } from './types.js';

// Re-export types so consumers don't need a separate import
export type { MarketSnapshot, GdeltEvent, NewsItem, Briefing } from './types.js';

// ─── DB singleton ────────────────────────────────────────────────────────────

export { getDb, _resetDbForTesting };

// ─── Migrations ──────────────────────────────────────────────────────────────

/**
 * Idempotent migration runner. Safe to call on every server startup.
 */
export async function migrate(): Promise<void> {
  return runMigrations(getDb());
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function insertMarketSnapshots(rows: MarketSnapshot[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getDb();
  for (const row of rows) {
    await client.execute({
      sql: `INSERT INTO market_snapshots (source, symbol, asset_class, price, change_pct, captured_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [row.source, row.symbol, row.asset_class, row.price, row.change_pct ?? null, row.captured_at],
    });
  }
}

export async function insertGdeltEvents(rows: GdeltEvent[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getDb();
  for (const row of rows) {
    // UNIQUE(event_id, captured_at) — ignore duplicates
    await client.execute({
      sql: `INSERT OR IGNORE INTO gdelt_events (source, event_id, category, severity, lat, lon, captured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [row.source, row.event_id, row.category ?? null, row.severity ?? null,
             row.lat ?? null, row.lon ?? null, row.captured_at],
    });
  }
}

export async function insertNewsItems(rows: NewsItem[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getDb();
  for (const row of rows) {
    // UNIQUE(url, captured_at) — ignore duplicates
    await client.execute({
      sql: `INSERT OR IGNORE INTO news_items (source, feed_domain, title, url, published_at, captured_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [row.source, row.feed_domain, row.title, row.url, row.published_at ?? null, row.captured_at],
    });
  }
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * Returns GDELT events captured >= sinceMs, ordered by captured_at DESC.
 * Default limit 500 to keep response sizes bounded.
 */
export async function getRecentGdeltEvents(sinceMs: number, limit = 500): Promise<GdeltEvent[]> {
  const client = getDb();
  const result = await client.execute({
    sql: `SELECT * FROM gdelt_events
          WHERE captured_at >= ?
          ORDER BY captured_at DESC
          LIMIT ?`,
    args: [sinceMs, limit],
  });

  return result.rows.map((r) => ({
    id: Number(r['id']),
    source: String(r['source']),
    event_id: String(r['event_id']),
    category: r['category'] != null ? String(r['category']) : null,
    severity: r['severity'] != null ? Number(r['severity']) : null,
    lat: r['lat'] != null ? Number(r['lat']) : null,
    lon: r['lon'] != null ? Number(r['lon']) : null,
    captured_at: Number(r['captured_at']),
  }));
}

/**
 * Returns the most recent snapshot for each symbol.
 * UI reads from the local DB — never from upstream (ADR-004/D-003).
 */
export async function getLatestMarkets(): Promise<MarketSnapshot[]> {
  const client = getDb();
  const result = await client.execute(`
    SELECT ms.*
    FROM market_snapshots ms
    INNER JOIN (
      SELECT symbol, MAX(captured_at) AS max_ts
      FROM market_snapshots
      GROUP BY symbol
    ) latest ON ms.symbol = latest.symbol AND ms.captured_at = latest.max_ts
    ORDER BY ms.symbol
  `);

  return result.rows.map((r) => ({
    id: Number(r['id']),
    source: String(r['source']),
    symbol: String(r['symbol']),
    asset_class: String(r['asset_class']),
    price: Number(r['price']),
    change_pct: r['change_pct'] != null ? Number(r['change_pct']) : null,
    captured_at: Number(r['captured_at']),
  }));
}

/**
 * Returns time-series snapshots for a symbol since sinceMs (epoch ms).
 * Uses ix_market_trend index (source, symbol, captured_at).
 */
export async function getMarketTrend(symbol: string, sinceMs: number): Promise<MarketSnapshot[]> {
  const client = getDb();
  const result = await client.execute({
    sql: `SELECT * FROM market_snapshots
          WHERE symbol = ? AND captured_at >= ?
          ORDER BY captured_at ASC`,
    args: [symbol, sinceMs],
  });

  return result.rows.map((r) => ({
    id: Number(r['id']),
    source: String(r['source']),
    symbol: String(r['symbol']),
    asset_class: String(r['asset_class']),
    price: Number(r['price']),
    change_pct: r['change_pct'] != null ? Number(r['change_pct']) : null,
    captured_at: Number(r['captured_at']),
  }));
}

/**
 * Returns the most recent non-expired briefing for the given domain.
 * Returns null if no valid briefing exists (expired or absent).
 */
export async function getCachedBriefing(domain: string, nowMs: number): Promise<Briefing | null> {
  const client = getDb();
  const result = await client.execute({
    sql: `SELECT * FROM briefings
          WHERE domain = ? AND valid_until > ?
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [domain, nowMs],
  });

  if (result.rows.length === 0) return null;

  const r = result.rows[0];
  if (r === undefined) return null;

  return {
    id: Number(r['id']),
    domain: String(r['domain']),
    body_md: String(r['body_md']),
    model: String(r['model']),
    created_at: Number(r['created_at']),
    valid_until: Number(r['valid_until']),
  };
}

/**
 * Persists a new briefing (upsert by replacing older ones for the same domain is
 * intentionally NOT done — callers may want to keep history; cache logic uses valid_until).
 */
export async function saveBriefing(b: Briefing): Promise<void> {
  const client = getDb();
  await client.execute({
    sql: `INSERT INTO briefings (domain, body_md, model, created_at, valid_until)
          VALUES (?, ?, ?, ?, ?)`,
    args: [b.domain, b.body_md, b.model, b.created_at, b.valid_until],
  });
}

// ─── Retention + Downsampling (D-102) ────────────────────────────────────────

/**
 * D-102 retention policy:
 * 1. Downsample: aggregate market_snapshots older than beforeMs into market_daily OHLC rows.
 * 2. Purge: delete raw market_snapshots older than beforeMs once daily rows exist.
 * 3. Purge: delete gdelt_events and news_items older than beforeMs (no downsampling needed).
 *
 * Safe to call repeatedly — INSERT OR IGNORE on market_daily prevents duplicate day rows.
 */
export async function purgeAndDownsample(beforeMs: number): Promise<void> {
  const client = getDb();

  // Step 1 — Compute OHLC per symbol per day for rows older than beforeMs.
  // Day bucket: floor to midnight UTC (86400000 ms per day).
  await client.execute({
    sql: `INSERT OR IGNORE INTO market_daily (symbol, day, open, high, low, close)
          SELECT
            symbol,
            (captured_at / 86400000) * 86400000 AS day,
            -- OHLC approximation: first price = open, last = close, min/max for low/high
            MIN(CASE WHEN row_n = 1 THEN price END)   AS open,
            MAX(price)                                 AS high,
            MIN(price)                                 AS low,
            MIN(CASE WHEN row_n = row_cnt THEN price END) AS close
          FROM (
            SELECT
              symbol, price, captured_at,
              ROW_NUMBER() OVER (PARTITION BY symbol, (captured_at / 86400000) ORDER BY captured_at ASC)  AS row_n,
              COUNT(*)     OVER (PARTITION BY symbol, (captured_at / 86400000))                           AS row_cnt
            FROM market_snapshots
            WHERE captured_at < ?
          ) sub
          GROUP BY symbol, day`,
    args: [beforeMs],
  });

  // Step 2 — Purge raw snapshots older than beforeMs
  await client.execute({
    sql: 'DELETE FROM market_snapshots WHERE captured_at < ?',
    args: [beforeMs],
  });

  // Step 3 — Purge gdelt_events and news_items (no downsampling for these)
  await client.execute({
    sql: 'DELETE FROM gdelt_events WHERE captured_at < ?',
    args: [beforeMs],
  });

  await client.execute({
    sql: 'DELETE FROM news_items WHERE captured_at < ?',
    args: [beforeMs],
  });
}

// Re-export LibsqlClient type for consumers that need it
export type { LibsqlClient };
