// packages/store/src/types.ts
// Domain types — map 1:1 to DB columns (D-100: wide-typed, no EAV)

// ─── Events (T-08, ADR-010) ──────────────────────────────────────────────────

/**
 * Unified event row — persisted in the `events` table.
 * Replaces gdelt_events (Fase 1) with a general multi-source model.
 * camelCase to match TypeScript conventions; SQL columns are snake_case.
 */
export interface EventRow {
  id?: number;                              // autoincrement PK (absent before insert)
  source: 'usgs' | 'eonet' | 'gdelt';      // which upstream produced this event
  sourceEventId: string;                    // stable upstream id (part of UNIQUE key)
  eventType: string;                        // 'earthquake'|'wildfire'|'conflict'|'protest'|...
  category: 'natural' | 'conflict';         // macro family
  severity: number | null;                  // 0..100, clamp duro; null if uncalculable
  lat: number | null;                       // real coords of the event (not country centroid)
  lon: number | null;
  country: string | null;                   // ISO from source or nearest-centroid; null if unknown
  title: string | null;
  url: string | null;
  occurredAt: number | null;                // epoch ms when the event happened upstream
  capturedAt: number;                       // epoch ms of the scheduler snapshot (schema.snapshot.ts)
  rawJson: string | null;                   // source-specific payload as JSON string
}

/**
 * Filter for getEvents().
 * All fields optional — absent fields are ignored (no filter applied for that dimension).
 */
export interface EventFilter {
  type?: string;                                    // filter by event_type
  category?: 'natural' | 'conflict';               // filter by category
  bbox?: [number, number, number, number];          // [minLon, minLat, maxLon, maxLat]
  sinceMs?: number;                                 // captured_at >= sinceMs
  minSeverity?: number;                             // severity >= minSeverity
  limit?: number;                                   // max rows (default 500)
}

// ─── Legacy types (Fase 1 — retained for retro-compat) ───────────────────────

export interface MarketSnapshot {
  id?: number;
  source: string;
  symbol: string;
  asset_class: string;
  price: number;
  change_pct: number | null;
  captured_at: number; // epoch ms INTEGER (D-101)
}

export interface GdeltEvent {
  id?: number;
  source: string;
  event_id: string;
  category: string | null;
  severity: number | null;
  lat: number | null;
  lon: number | null;
  captured_at: number; // epoch ms INTEGER (D-101)
}

export interface NewsItem {
  id?: number;
  source: string;
  feed_domain: string;
  title: string;
  url: string;
  published_at: number | null;
  captured_at: number; // epoch ms INTEGER (D-101)
}

export interface Briefing {
  id?: number;
  domain: string;
  body_md: string;
  model: string;
  created_at: number;  // epoch ms
  valid_until: number; // epoch ms — getCachedBriefing checks this
}

export interface MarketDaily {
  symbol: string;
  day: number; // epoch ms of the day (midnight UTC)
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}
