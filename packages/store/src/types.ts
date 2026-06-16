// packages/store/src/types.ts
// Domain types — map 1:1 to DB columns (D-100: wide-typed, no EAV)

// ─── Signals — Radar Geoeconómico Temático (T-15, ADR-011) ──────────────────

/**
 * The 6 thematic sections of the geoeconómic radar.
 * D-200/D-003: article-level signals, separate from events (geo-event).
 */
export type Section =
  | 'political_instability'
  | 'commodities_energy'
  | 'critical_minerals'
  | 'semis_ai_tech'
  | 'digital_infra_cyber'
  | 'trade_sanctions';

/**
 * Article-level signal row — camelCase (L-1: web wire is camelCase).
 * Persisted in `signals` + `signal_sections` tables (migration 003).
 * source: 'gkg' = GDELT GKG; 'rss-thematic' = curated RSS feed.
 * tone: AvgTone -100..+100 from GKG V2Tone col16; null for RSS.
 * sections: many-to-many via signal_sections bridge table (D-200).
 */
export interface SignalRow {
  source: 'gkg' | 'rss-thematic';
  signalId: string;                   // {sig.id}: GKGRECORDID or canonical url
  title: string | null;
  url: string | null;
  tone: number | null;                // {sig.tone}: AvgTone; null for RSS
  themes: string | null;              // V1Themes ;-joined, raw (auditing)
  persons: string | null;             // V2Persons ;-joined
  organizations: string | null;       // V2Organizations ;-joined
  lat: number | null;                 // {sig.geo} best-effort (V2Locations type 3/4)
  lon: number | null;
  country: string | null;
  occurredAt: number | null;          // epoch ms from col2 DATE; pubDate for RSS
  capturedAt: number;                 // {schema.snapshot.ts} epoch ms
  rawJson: string | null;             // V2Tone full + matchedBy (audit)
  sections: Array<{ section: Section; matchedBy: 'theme' | 'keyword' | 'entity' }>;
}

/**
 * Aggregated trend point for a section — volume + average tone per time bucket.
 * {sig.trend}: volume counts all signals; avgTone averages non-null tones only.
 */
export interface SignalTrendPoint {
  bucketMs: number;           // epoch ms floor of the time bucket
  volume: number;             // count of signals in this bucket
  avgTone: number | null;     // mean AvgTone of signals with non-null tone; null if all null
}

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

// ─── Convergence Signals (T-28, rebanada 4) ──────────────────────────────────

/**
 * Convergence signal snapshot row — camelCase (L-1: web wire is camelCase).
 * Persisted as a time-series append in `convergence_signals` (migration 005).
 * families: JSON-serialized sorted array of DataFamily strings ('events'|'signals'|'markets').
 * dimensions: JSON-serialized sorted array of contributing ConvergenceDimension strings.
 * components: JSON-serialized breakdown of contributing observations for audit.
 * strength: mean time-decayed magnitude [0,1] across contributing families.
 * sourceCount: number of distinct data families contributing (>= MIN_SOURCES = 2).
 * dynamicScore: delta vs prior snapshot for the same (country, familyset); null on first detection.
 * methodologyVersion: identifies the scoring formula version ('conv-core-1').
 * firstDetectedAt: epoch ms of the first ever detection for this (country, familyset).
 * capturedAt: epoch ms of this snapshot.
 */
export interface ConvergenceSignalRow {
  id?: number;
  country: string;
  familiesJson: string;
  dimensionsJson: string;
  componentsJson: string;
  strength: number;
  sourceCount: number;
  dynamicScore: number | null;
  methodologyVersion: string;
  firstDetectedAt: number;
  capturedAt: number;
}

// ─── Sanctions (T-35, OFAC Approach B) ───────────────────────────────────────

/**
 * OFAC sanctions snapshot row — camelCase (L-1: web wire is camelCase).
 * Persisted as a time-series append in `sanctions` (migration 006).
 * sanctionedCount: number of SDN-list entities linked to this country.
 * capturedAt: epoch ms of the scheduler snapshot.
 */
export interface SanctionRow {
  id?: number;
  country: string;
  sanctionedCount: number;
  capturedAt: number;
}

// ─── CII Snapshots (T-21, ADR-CII) ───────────────────────────────────────────

/**
 * Country Instability Index snapshot row — camelCase (L-1: web wire is camelCase).
 * Persisted as a time-series append in `cii_snapshots` (migration 004).
 * composite: 0..100 combined score.
 * baselineRisk: static/slow-moving structural risk component.
 * eventScore: dynamic component derived from recent events.
 * dynamicScore: optional ~24h delta vs prior snapshot; null if no prior exists.
 * trend: 'rising'|'falling'|'stable'|null — computed from dynamicScore or prior diff.
 * methodologyVersion: semver string identifying the scoring formula version.
 * componentsJson: JSON-serialized breakdown of sub-scores for audit/debug.
 * capturedAt: epoch ms of the scheduler snapshot.
 */
export interface CiiSnapshotRow {
  id?: number;
  country: string;
  composite: number;
  baselineRisk: number;
  eventScore: number;
  dynamicScore: number | null;
  trend: 'rising' | 'falling' | 'stable' | null;
  methodologyVersion: string;
  componentsJson: string;
  capturedAt: number;
}
