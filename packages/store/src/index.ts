// packages/store/src/index.ts
// @www/store — normative public API (T-02)
// ADR-006: @libsql/client, url file:./data/world.db
// D-100: wide-typed schema; D-101: captured_at epoch ms + source; D-102: 90d retention + downsampling

import type { Client as LibsqlClient } from '@libsql/client';
import { getDb, _resetDbForTesting } from './db.js';
import { migrate as runMigrations } from './migrate.js';
import type { MarketSnapshot, GdeltEvent, NewsItem, Briefing, EventRow, EventFilter, SignalRow, SignalTrendPoint, Section, CiiSnapshotRow, ConvergenceSignalRow, SanctionRow } from './types.js';

// Re-export types so consumers don't need a separate import
export type { MarketSnapshot, GdeltEvent, NewsItem, Briefing, EventRow, EventFilter, SignalRow, SignalTrendPoint, Section, CiiSnapshotRow, ConvergenceSignalRow, SanctionRow } from './types.js';

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
 *
 * C-3 retro-compat: reads `events WHERE source='gdelt'` (gdelt_events was DROPped in
 * migration 002). Maps each EventRow back to the legacy GdeltEvent shape so that
 * server.ts (/api/gdelt) and briefing.ts (serializeContext) continue working unchanged.
 */
export async function getRecentGdeltEvents(sinceMs: number, limit = 500): Promise<GdeltEvent[]> {
  const client = getDb();
  const result = await client.execute({
    sql: `SELECT id, source, source_event_id, category, severity, lat, lon, captured_at
          FROM events
          WHERE source = 'gdelt' AND captured_at >= ?
          ORDER BY captured_at DESC
          LIMIT ?`,
    args: [sinceMs, limit],
  });

  return result.rows.map((r) => ({
    id: Number(r['id']),
    source: String(r['source']),
    // Legacy field name: event_id maps to source_event_id in the new schema
    event_id: String(r['source_event_id']),
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

// ─── Events API (T-08, ADR-010) ──────────────────────────────────────────────

/**
 * UPSERT events into the `events` table by (source, source_event_id).
 * D-104: ON CONFLICT updates severity/title/url/occurred_at/captured_at/raw_json.
 * This reflects event transitions (USGS automatic→reviewed, EONET open→closed).
 * No-op for empty arrays.
 */
export async function upsertEvents(rows: EventRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getDb();
  for (const row of rows) {
    await client.execute({
      sql: `INSERT INTO events
              (source, source_event_id, event_type, category, severity, lat, lon,
               country, title, url, occurred_at, captured_at, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (source, source_event_id) DO UPDATE SET
              severity    = excluded.severity,
              title       = excluded.title,
              url         = excluded.url,
              occurred_at = excluded.occurred_at,
              captured_at = excluded.captured_at,
              raw_json    = excluded.raw_json`,
      args: [
        row.source,
        row.sourceEventId,
        row.eventType,
        row.category,
        row.severity ?? null,
        row.lat ?? null,
        row.lon ?? null,
        row.country ?? null,
        row.title ?? null,
        row.url ?? null,
        row.occurredAt ?? null,
        row.capturedAt,
        row.rawJson ?? null,
      ],
    });
  }
}

/**
 * Returns events matching the given filter, ordered by captured_at DESC.
 * All filter fields are optional. Default limit = 500.
 * Resolves filters using the four indices (ix_events_recent/type/country/sev).
 */
export async function getEvents(filter: EventFilter): Promise<EventRow[]> {
  const client = getDb();

  const conditions: string[] = [];
  const args: (string | number | null)[] = [];

  if (filter.type !== undefined) {
    conditions.push('event_type = ?');
    args.push(filter.type);
  }
  if (filter.category !== undefined) {
    conditions.push('category = ?');
    args.push(filter.category);
  }
  if (filter.sinceMs !== undefined) {
    conditions.push('captured_at >= ?');
    args.push(filter.sinceMs);
  }
  if (filter.minSeverity !== undefined) {
    conditions.push('severity >= ?');
    args.push(filter.minSeverity);
  }
  if (filter.bbox !== undefined) {
    const [minLon, minLat, maxLon, maxLat] = filter.bbox;
    conditions.push('lon >= ? AND lon <= ? AND lat >= ? AND lat <= ?');
    args.push(minLon, maxLon, minLat, maxLat);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 500;

  const result = await client.execute({
    sql: `SELECT * FROM events ${where} ORDER BY captured_at DESC LIMIT ?`,
    args: [...args, limit],
  });

  return result.rows.map(rowToEventRow);
}

/**
 * Returns a single event by (source, source_event_id), or null if not found.
 * GET /api/events/:source/:id detail endpoint.
 */
export async function getEvent(source: string, sourceEventId: string): Promise<EventRow | null> {
  const client = getDb();
  const result = await client.execute({
    sql: 'SELECT * FROM events WHERE source = ? AND source_event_id = ? LIMIT 1',
    args: [source, sourceEventId],
  });
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  if (r === undefined) return null;
  return rowToEventRow(r);
}

/**
 * Returns all events since sinceMs grouped by country.
 * Used as the {cii.bridge} for the CII rebanada (D-108).
 * Events with null country are keyed under the empty string ''.
 */
export async function getEventsByCountry(sinceMs: number): Promise<Map<string, EventRow[]>> {
  const client = getDb();
  const result = await client.execute({
    sql: `SELECT * FROM events WHERE captured_at >= ? ORDER BY country ASC, captured_at DESC`,
    args: [sinceMs],
  });

  const map = new Map<string, EventRow[]>();
  for (const r of result.rows) {
    const country = r['country'] != null ? String(r['country']) : '';
    const row = rowToEventRow(r);
    const bucket = map.get(country);
    if (bucket !== undefined) {
      bucket.push(row);
    } else {
      map.set(country, [row]);
    }
  }
  return map;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToEventRow(r: Record<string, unknown>): EventRow {
  // exactOptionalPropertyTypes: don't include `id` in the spread when null/undefined
  const base: EventRow = {
    source: String(r['source']) as EventRow['source'],
    sourceEventId: String(r['source_event_id']),
    eventType: String(r['event_type']),
    category: String(r['category']) as EventRow['category'],
    severity: r['severity'] != null ? Number(r['severity']) : null,
    lat: r['lat'] != null ? Number(r['lat']) : null,
    lon: r['lon'] != null ? Number(r['lon']) : null,
    country: r['country'] != null ? String(r['country']) : null,
    title: r['title'] != null ? String(r['title']) : null,
    url: r['url'] != null ? String(r['url']) : null,
    occurredAt: r['occurred_at'] != null ? Number(r['occurred_at']) : null,
    capturedAt: Number(r['captured_at']),
    rawJson: r['raw_json'] != null ? String(r['raw_json']) : null,
  };
  if (r['id'] != null) {
    base.id = Number(r['id']);
  }
  return base;
}

// ─── Signals API (T-15, ADR-011) ─────────────────────────────────────────────

/**
 * UPSERT signals into the `signals` table by (source, signal_id).
 * On conflict, updates all mutable fields (tone, title, url, themes, persons,
 * organizations, lat, lon, country, occurred_at, captured_at, raw_json).
 * Then REWRITES the signal_sections bridge rows for each article:
 *   DELETE existing sections for this signal + INSERT the new set.
 * D-202: ensures re-ingested articles reflect updated classification without
 * duplicating section rows (PRIMARY KEY on signal_id, section guards anyway).
 */
export async function upsertSignals(rows: SignalRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getDb();

  for (const row of rows) {
    // UPSERT the signal row (D-202)
    await client.execute({
      sql: `INSERT INTO signals
              (source, signal_id, title, url, tone, themes, persons, organizations,
               lat, lon, country, occurred_at, captured_at, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (source, signal_id) DO UPDATE SET
              title         = excluded.title,
              url           = excluded.url,
              tone          = excluded.tone,
              themes        = excluded.themes,
              persons       = excluded.persons,
              organizations = excluded.organizations,
              lat           = excluded.lat,
              lon           = excluded.lon,
              country       = excluded.country,
              occurred_at   = excluded.occurred_at,
              captured_at   = excluded.captured_at,
              raw_json      = excluded.raw_json`,
      args: [
        row.source,
        row.signalId,
        row.title ?? null,
        row.url ?? null,
        row.tone ?? null,
        row.themes ?? null,
        row.persons ?? null,
        row.organizations ?? null,
        row.lat ?? null,
        row.lon ?? null,
        row.country ?? null,
        row.occurredAt ?? null,
        row.capturedAt,
        row.rawJson ?? null,
      ],
    });

    // Resolve the autoincrement PK for this signal to write signal_sections.
    // Always re-query by (source, signal_id) — libSQL sqlite3 may return lastInsertRowid=0
    // for the ON CONFLICT DO UPDATE branch (behavior varies by driver version), so we
    // unconditionally SELECT to get the stable PK. The UNIQUE index makes this fast.
    const idRow = await client.execute({
      sql: 'SELECT id FROM signals WHERE source = ? AND signal_id = ?',
      args: [row.source, row.signalId],
    });
    const firstIdRow = idRow.rows[0];
    if (firstIdRow === undefined) continue; // should never happen after a successful UPSERT
    const signalDbId = Number(firstIdRow['id']);

    // REWRITE signal_sections: delete old, insert new (D-202)
    await client.execute({
      sql: 'DELETE FROM signal_sections WHERE signal_id = ?',
      args: [signalDbId],
    });

    for (const sec of row.sections) {
      await client.execute({
        sql: `INSERT OR IGNORE INTO signal_sections (signal_id, section, matched_by)
              VALUES (?, ?, ?)`,
        args: [signalDbId, sec.section, sec.matchedBy],
      });
    }
  }
}

/**
 * Returns signals matching the given filter, ordered by captured_at DESC.
 * section: JOIN with signal_sections to filter by section (uses ix_sigsec_section).
 * minToneMag: |tone| >= minToneMag (signals with null tone excluded when this is set).
 * Default limit = 500 (consistent with getEvents).
 */
export async function getSignals(opts: {
  section?: Section;
  sinceMs?: number;
  limit?: number;
  minToneMag?: number;
}): Promise<SignalRow[]> {
  const client = getDb();

  const conditions: string[] = [];
  const args: (string | number | null)[] = [];

  if (opts.section !== undefined) {
    conditions.push('ss.section = ?');
    args.push(opts.section);
  }
  if (opts.sinceMs !== undefined) {
    conditions.push('s.captured_at >= ?');
    args.push(opts.sinceMs);
  }
  if (opts.minToneMag !== undefined) {
    conditions.push('s.tone IS NOT NULL AND ABS(s.tone) >= ?');
    args.push(opts.minToneMag);
  }

  const limit = opts.limit ?? 500;

  let sql: string;
  if (opts.section !== undefined) {
    // JOIN with signal_sections when filtering by section
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    sql = `SELECT DISTINCT s.*
           FROM signals s
           INNER JOIN signal_sections ss ON ss.signal_id = s.id
           ${where}
           ORDER BY s.captured_at DESC
           LIMIT ?`;
  } else {
    // No section filter — query signals directly (no join)
    const nonSectionConditions = conditions.filter((c) => !c.startsWith('ss.'));
    const where = nonSectionConditions.length > 0 ? `WHERE ${nonSectionConditions.join(' AND ')}` : '';
    sql = `SELECT * FROM signals s ${where} ORDER BY s.captured_at DESC LIMIT ?`;
  }

  const result = await client.execute({ sql, args: [...args, limit] });

  // For each signal row, fetch its sections from signal_sections
  const signals: SignalRow[] = [];
  for (const r of result.rows) {
    const dbId = Number(r['id']);
    const sectResult = await client.execute({
      sql: 'SELECT section, matched_by FROM signal_sections WHERE signal_id = ?',
      args: [dbId],
    });
    const sections = sectResult.rows.map((sr) => ({
      section: String(sr['section']) as Section,
      matchedBy: String(sr['matched_by']) as 'theme' | 'keyword' | 'entity',
    }));

    signals.push({
      source: String(r['source']) as SignalRow['source'],
      signalId: String(r['signal_id']),
      title: r['title'] != null ? String(r['title']) : null,
      url: r['url'] != null ? String(r['url']) : null,
      tone: r['tone'] != null ? Number(r['tone']) : null,
      themes: r['themes'] != null ? String(r['themes']) : null,
      persons: r['persons'] != null ? String(r['persons']) : null,
      organizations: r['organizations'] != null ? String(r['organizations']) : null,
      lat: r['lat'] != null ? Number(r['lat']) : null,
      lon: r['lon'] != null ? Number(r['lon']) : null,
      country: r['country'] != null ? String(r['country']) : null,
      occurredAt: r['occurred_at'] != null ? Number(r['occurred_at']) : null,
      capturedAt: Number(r['captured_at']),
      rawJson: r['raw_json'] != null ? String(r['raw_json']) : null,
      sections,
    });
  }

  return signals;
}

/**
 * Returns aggregated trend points for a given section.
 * Bucketed by bucketMs (default 1 hour = 3_600_000 ms) over captured_at.
 * volume: count of all signals in that bucket for the section.
 * avgTone: mean of non-null tone values; null if all tone values in bucket are null.
 * D-005: {sig.trend} = volumen + AvgTone medio por ventana temporal.
 */
export async function getSignalTrend(
  section: Section,
  opts: { sinceMs?: number; bucketMs?: number } = {}
): Promise<SignalTrendPoint[]> {
  const client = getDb();
  const bucketMs = opts.bucketMs ?? 3_600_000; // 1 hour default

  const conditions: string[] = ['ss.section = ?'];
  const args: (string | number)[] = [section];

  if (opts.sinceMs !== undefined) {
    conditions.push('s.captured_at >= ?');
    args.push(opts.sinceMs);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  // Compute bucket floor using explicit INTEGER cast to force integer division in libSQL.
  // libSQL passes JS numbers as REAL, so without CAST the division would be floating-point
  // and the bucket floor would be wrong (e.g. 1_000_000 / 3_600_000 = 0.277 not 0).
  // COUNT(*) for volume (includes null-tone rows); AVG ignores null in SQL natively.
  const result = await client.execute({
    sql: `SELECT
            (CAST(s.captured_at AS INTEGER) / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS bucket_ms,
            COUNT(*) AS volume,
            AVG(s.tone) AS avg_tone
          FROM signals s
          INNER JOIN signal_sections ss ON ss.signal_id = s.id
          ${where}
          GROUP BY bucket_ms
          ORDER BY bucket_ms ASC`,
    args: [bucketMs, bucketMs, ...args],
  });

  return result.rows.map((r) => ({
    bucketMs: Number(r['bucket_ms']),
    volume: Number(r['volume']),
    avgTone: r['avg_tone'] != null ? Number(r['avg_tone']) : null,
  }));
}

// ─── Retention + Downsampling (D-102) ────────────────────────────────────────

/**
 * D-102 retention policy:
 * 1. Downsample: aggregate market_snapshots older than beforeMs into market_daily OHLC rows.
 * 2. Purge: delete raw market_snapshots older than beforeMs once daily rows exist.
 * 3. Purge: delete events and news_items older than beforeMs (no downsampling needed).
 *
 * C-2 fix: gdelt_events was DROPped in migration 002; this function now purges the
 * unified `events` table by occurred_at (or captured_at for rows where occurred_at is null).
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

  // Step 3 — Purge events older than beforeMs (C-2: replaces deleted gdelt_events purge).
  // Use occurred_at when available (the event's real timestamp); fall back to captured_at
  // for rows where occurred_at is null so we never keep orphaned rows forever.
  await client.execute({
    sql: 'DELETE FROM events WHERE COALESCE(occurred_at, captured_at) < ?',
    args: [beforeMs],
  });

  // Step 4 — Purge news_items older than beforeMs
  await client.execute({
    sql: 'DELETE FROM news_items WHERE captured_at < ?',
    args: [beforeMs],
  });

  // Step 5 — Purge signals older than beforeMs (T-15, ADR-011).
  // Use COALESCE(occurred_at, captured_at) for the same reason as events (Step 3).
  // signal_sections are deleted automatically via ON DELETE CASCADE.
  await client.execute({
    sql: 'DELETE FROM signals WHERE COALESCE(occurred_at, captured_at) < ?',
    args: [beforeMs],
  });

  // Step 6 — Purge cii_snapshots older than beforeMs (T-21).
  await client.execute({
    sql: 'DELETE FROM cii_snapshots WHERE captured_at < ?',
    args: [beforeMs],
  });

  // Step 7 — Purge convergence_signals older than beforeMs (T-28).
  await client.execute({
    sql: 'DELETE FROM convergence_signals WHERE captured_at < ?',
    args: [beforeMs],
  });

  // Step 8 — Purge sanctions older than beforeMs (T-35).
  await client.execute({
    sql: 'DELETE FROM sanctions WHERE captured_at < ?',
    args: [beforeMs],
  });
}

// ─── CII Snapshots API (T-21) ─────────────────────────────────────────────────

/**
 * Appends CII snapshot rows — INSERT only (no upsert; cii_snapshots is a time-series).
 * Caller is responsible for computing dynamicScore and trend before calling.
 * No-op for empty arrays.
 */
export async function insertCiiSnapshots(rows: CiiSnapshotRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getDb();
  for (const row of rows) {
    await client.execute({
      sql: `INSERT INTO cii_snapshots
              (country, composite, baseline_risk, event_score, dynamic_score,
               trend, methodology_version, components_json, captured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        row.country,
        row.composite,
        row.baselineRisk,
        row.eventScore,
        row.dynamicScore ?? null,
        row.trend ?? null,
        row.methodologyVersion,
        row.componentsJson,
        row.capturedAt,
      ],
    });
  }
}

/**
 * Returns the most recent CII snapshot per country (1 row per country, MAX captured_at).
 * UI reads this for the current country-risk layer — never upstream (ADR-004/D-003).
 */
export async function getLatestCii(): Promise<CiiSnapshotRow[]> {
  const client = getDb();
  const result = await client.execute(`
    SELECT c.*
    FROM cii_snapshots c
    INNER JOIN (
      SELECT country, MAX(captured_at) AS max_ts
      FROM cii_snapshots
      GROUP BY country
    ) latest ON c.country = latest.country AND c.captured_at = latest.max_ts
    ORDER BY c.country
  `);
  return result.rows.map(rowToCiiSnapshotRow);
}

/**
 * Returns time-series CII snapshots for a country with captured_at >= sinceMs, ASC.
 * Used for trend charts in the UI.
 */
export async function getCiiTrend(country: string, sinceMs: number): Promise<CiiSnapshotRow[]> {
  const client = getDb();
  const result = await client.execute({
    sql: `SELECT * FROM cii_snapshots
          WHERE country = ? AND captured_at >= ?
          ORDER BY captured_at ASC`,
    args: [country, sinceMs],
  });
  return result.rows.map(rowToCiiSnapshotRow);
}

/**
 * Returns the CII snapshot for a country closest to (and at or before) aroundMs.
 * Used to compute dynamicScore (~24h prior snapshot for delta calculation).
 * Returns null if no snapshot exists for that country.
 */
export async function getPriorCii(country: string, aroundMs: number): Promise<CiiSnapshotRow | null> {
  const client = getDb();
  const result = await client.execute({
    sql: `SELECT * FROM cii_snapshots
          WHERE country = ? AND captured_at <= ?
          ORDER BY captured_at DESC
          LIMIT 1`,
    args: [country, aroundMs],
  });
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  if (r === undefined) return null;
  return rowToCiiSnapshotRow(r);
}

function rowToCiiSnapshotRow(r: Record<string, unknown>): CiiSnapshotRow {
  const trend = r['trend'];
  const base: CiiSnapshotRow = {
    country: String(r['country']),
    composite: Number(r['composite']),
    baselineRisk: Number(r['baseline_risk']),
    eventScore: Number(r['event_score']),
    dynamicScore: r['dynamic_score'] != null ? Number(r['dynamic_score']) : null,
    trend: trend === 'rising' || trend === 'falling' || trend === 'stable' ? trend : null,
    methodologyVersion: String(r['methodology_version']),
    componentsJson: String(r['components_json']),
    capturedAt: Number(r['captured_at']),
  };
  if (r['id'] != null) {
    base.id = Number(r['id']);
  }
  return base;
}

// ─── Convergence Signals API (T-28, rebanada 4) ──────────────────────────────

/**
 * Appends convergence signal rows — INSERT only (no upsert; convergence_signals is a
 * time-series, D-308). No-op for empty arrays.
 */
export async function insertConvergenceSignals(rows: ConvergenceSignalRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getDb();
  for (const row of rows) {
    await client.execute({
      sql: `INSERT INTO convergence_signals
              (country, families_json, dimensions_json, components_json,
               strength, source_count, dynamic_score, methodology_version,
               first_detected_at, captured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        row.country,
        row.familiesJson,
        row.dimensionsJson,
        row.componentsJson,
        row.strength,
        row.sourceCount,
        row.dynamicScore ?? null,
        row.methodologyVersion,
        row.firstDetectedAt,
        row.capturedAt,
      ],
    });
  }
}

/**
 * Returns the most recent convergence signal snapshot per (country, families_json).
 * Groups by (country, families_json) and selects the row with MAX(captured_at) in each group.
 * If a country has two active familysets (e.g. events×signals and events×markets), both
 * rows are returned. Ordered by country ASC, captured_at DESC.
 */
export async function getLatestConvergence(): Promise<ConvergenceSignalRow[]> {
  const client = getDb();
  const result = await client.execute(`
    SELECT c.*
    FROM convergence_signals c
    INNER JOIN (
      SELECT country, families_json, MAX(captured_at) AS max_ts
      FROM convergence_signals
      GROUP BY country, families_json
    ) latest
      ON c.country = latest.country
     AND c.families_json = latest.families_json
     AND c.captured_at = latest.max_ts
    ORDER BY c.country ASC, c.captured_at DESC
  `);
  return result.rows.map(rowToConvergenceSignalRow);
}

/**
 * Returns the convergence signal snapshot closest to (and at or before) aroundMs for a
 * given (country, families_json) pair. Used to compute dynamicScore and firstDetectedAt
 * for the next snapshot (D-309).
 * Returns null if no snapshot exists for that (country, familyset).
 */
export async function getPriorConvergence(
  country: string,
  familyset: string,
  aroundMs: number,
): Promise<ConvergenceSignalRow | null> {
  const client = getDb();
  const result = await client.execute({
    sql: `SELECT * FROM convergence_signals
          WHERE country = ? AND families_json = ? AND captured_at <= ?
          ORDER BY captured_at DESC
          LIMIT 1`,
    args: [country, familyset, aroundMs],
  });
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  if (r === undefined) return null;
  return rowToConvergenceSignalRow(r);
}

function rowToConvergenceSignalRow(r: Record<string, unknown>): ConvergenceSignalRow {
  const base: ConvergenceSignalRow = {
    country: String(r['country']),
    familiesJson: String(r['families_json']),
    dimensionsJson: String(r['dimensions_json']),
    componentsJson: String(r['components_json']),
    strength: Number(r['strength']),
    sourceCount: Number(r['source_count']),
    dynamicScore: r['dynamic_score'] != null ? Number(r['dynamic_score']) : null,
    methodologyVersion: String(r['methodology_version']),
    firstDetectedAt: Number(r['first_detected_at']),
    capturedAt: Number(r['captured_at']),
  };
  if (r['id'] != null) {
    base.id = Number(r['id']);
  }
  return base;
}

// ─── Sanctions API (T-35, OFAC Approach B) ───────────────────────────────────

/**
 * Appends sanctions snapshot rows — INSERT only (no upsert; sanctions is a time-series).
 * No-op for empty arrays.
 */
export async function insertSanctions(rows: SanctionRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getDb();
  for (const row of rows) {
    await client.execute({
      sql: `INSERT INTO sanctions (country, sanctioned_count, captured_at)
            VALUES (?, ?, ?)`,
      args: [row.country, row.sanctionedCount, row.capturedAt],
    });
  }
}

/**
 * Returns the most recent sanctions snapshot per country (1 row per country, MAX captured_at).
 * UI / briefing reads from the local DB — never from upstream (ADR-004/D-003).
 */
export async function getLatestSanctions(): Promise<SanctionRow[]> {
  const client = getDb();
  const result = await client.execute(`
    SELECT s.*
    FROM sanctions s
    INNER JOIN (
      SELECT country, MAX(captured_at) AS max_ts
      FROM sanctions
      GROUP BY country
    ) latest ON s.country = latest.country AND s.captured_at = latest.max_ts
    ORDER BY s.country
  `);
  return result.rows.map(rowToSanctionRow);
}

function rowToSanctionRow(r: Record<string, unknown>): SanctionRow {
  const base: SanctionRow = {
    country: String(r['country']),
    sanctionedCount: Number(r['sanctioned_count']),
    capturedAt: Number(r['captured_at']),
  };
  if (r['id'] != null) {
    base.id = Number(r['id']);
  }
  return base;
}

// Re-export LibsqlClient type for consumers that need it
export type { LibsqlClient };
