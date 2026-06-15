/**
 * API client — reads ONLY from /api/* (never upstream directly).
 * All fetches use AbortSignal.timeout(8000) to prevent hangs.
 *
 * Adapter layer: maps raw backend snapshots to view-models.
 * Real backend shapes (confirmed via curl 2026-06-13):
 *   /api/markets      → MarketSnapshot[]   (bare array)
 *   /api/markets/:sym → MarketSnapshot[]   (bare array, ordered = trend)
 *   /api/gdelt        → RawGdeltEvent[]    (bare array, may be empty)
 *   /api/briefing     → { briefing: RawBriefing | null }
 *   /api/events       → EventRow[]         (T-13 / T-12, bare array)
 *   /api/signals      → SignalRow[]         (T-20, bare array, camelCase — BUG-1 L-1)
 *   /api/signals/trend → SignalTrendPoint[] (T-20, bare array)
 */

// ---------------------------------------------------------------------------
// Raw backend shapes (never exposed outside this module)
// ---------------------------------------------------------------------------

interface MarketSnapshot {
  id: number;
  source: string;
  symbol: string;
  asset_class: string;
  price: number;
  change_pct: number | null;
  captured_at: number; // epoch ms
}

interface RawGdeltEvent {
  id: number;
  source: string;
  event_id: string;
  category: string;
  severity: number | null;
  lat: number | null;
  lon: number | null;
  captured_at: number; // epoch ms
}

interface RawBriefing {
  id: number;
  domain: string;
  body_md: string;
  model: string;
  created_at: number; // epoch ms
  valid_until: number; // epoch ms
}

interface RawBriefingResponse {
  briefing: RawBriefing | null;
}

/**
 * Raw event row from /api/events — matches EventRow in @www/store (T-08).
 * Typed locally so web never imports @www/store (boundary rule).
 *
 * WIRE FORMAT = camelCase. @www/store serializes EventRow (camelCase TS fields)
 * directly via JSON.stringify with NO snake_case transform — verified via curl:
 * `{"source":"usgs","sourceEventId":"us7000srb1","eventType":"earthquake","capturedAt":...}`.
 * (Distinto de MarketSnapshot/RawGdeltEvent, que SÍ son snake_case porque esas
 * columnas del store se exponen tal cual.) BUG-1 fix (qa-tester 2026-06-14).
 */
interface RawEventRow {
  id: number;
  source: string;                  // 'usgs' | 'eonet' | 'gdelt'
  sourceEventId: string;
  eventType: string;               // 'earthquake' | 'wildfire' | 'volcano' | 'storm' | 'flood' | 'conflict' | 'protest' | ...
  category: string;                // 'natural' | 'conflict'
  severity: number | null;         // 0..100 (may be null for legacy rows)
  lat: number | null;
  lon: number | null;
  country: string | null;
  title: string | null;
  url: string | null;
  occurredAt: number | null;       // epoch ms
  capturedAt: number;              // epoch ms
  rawJson: string | null;          // stringified JSON with source-specific fields
}

/**
 * Raw signal row from /api/signals — mirrors SignalRow in @www/store (T-16/T-20).
 * Typed locally: web NEVER imports @www/store (boundary rule).
 *
 * WIRE FORMAT = camelCase. @www/store serializes SignalRow fields directly via
 * JSON.stringify with NO snake_case transform — same BUG-1 pattern as EventRow.
 * (L-1 critical: snake_case client here would cause all map layers to show zero
 * points because section/tone/lat/lon would be undefined at runtime.)
 */
interface RawSignalRow {
  source: string;
  signalId: string;
  title: string | null;
  url: string | null;
  tone: number | null;           // GDELT GKG GlobalEventTone (negative = bad)
  themes: string | null;         // pipe-separated list
  persons: string | null;        // pipe-separated list
  organizations: string | null;  // pipe-separated list
  lat: number | null;
  lon: number | null;
  country: string | null;
  occurredAt: number | null;     // epoch ms
  capturedAt: number;            // epoch ms
  rawJson: string | null;
  sections: Array<{ section: string; matchedBy: string }>;
}

/**
 * Raw signal trend point from /api/signals/trend.
 * camelCase — same wire discipline.
 */
interface RawSignalTrendPoint {
  bucketMs: number;
  volume: number;
  avgTone: number | null;
}

// ---------------------------------------------------------------------------
// View-models (public contract for components)
// ---------------------------------------------------------------------------

export interface MarketInstrument {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  timestamp: string;
}

export interface PricePoint {
  timestamp: string;
  price: number;
}

export interface GdeltEvent {
  eventId: string;
  lat: number;
  lng: number;
  category: string;
  severity: number;
}

export interface GdeltResponse {
  events: GdeltEvent[];
  fetchedAt: string;
}

export interface BriefingResponse {
  briefing: string;
  generatedAt: string;
  domain: string;
}

/**
 * View-model for a global event consumed by EventsPanel + MapView.
 * Derived from RawEventRow; always has valid lat/lon (rows without coords are dropped).
 */
export interface GlobalEvent {
  /** Unique key: `{source}:{source_event_id}` */
  key: string;
  source: string;
  sourceEventId: string;
  eventType: string;        // 'earthquake' | 'wildfire' | 'volcano' | 'storm' | 'flood' | 'conflict' | 'protest'
  category: string;         // 'natural' | 'conflict'
  severity: number;         // 0..100 (defaulted to 0 when null)
  lat: number;
  lng: number;
  country: string | null;
  title: string;
  url: string | null;
  occurredAt: string | null;   // ISO string or null
  capturedAt: string;          // ISO string
}

/**
 * Filter params for /api/events.
 * All fields are optional; absent fields are not sent in the querystring.
 */
export interface EventFilter {
  type?: string;
  category?: string;
  minSeverity?: number;
  since?: number;    // epoch ms
  limit?: number;
  bbox?: [number, number, number, number];  // [minLon, minLat, maxLon, maxLat]
}

export interface EventsResponse {
  events: GlobalEvent[];
  fetchedAt: string;
}

/**
 * View-model for a radar signal consumed by RadarPanel + MapView.
 *
 * W-3 HAZARD: `sections` is an array on the wire but MapLibre ['get','section']
 * cannot index arrays. MapView MUST expand: one Feature per (signal × section)
 * with `section` as a scalar property.
 *
 * Signals without lat/lon are kept in the view-model (used by RadarPanel list)
 * but MUST NOT emit a GeoJSON feature (no coords = cannot be plotted).
 */
export interface RadarSignal {
  /** Unique key: `{source}:{signalId}` */
  key: string;
  source: string;
  signalId: string;
  title: string;
  url: string | null;
  tone: number | null;
  themes: string[];
  persons: string[];
  organizations: string[];
  lat: number | null;
  lon: number | null;
  country: string | null;
  occurredAt: string | null;    // ISO string or null
  capturedAt: string;           // ISO string
  /** Sections this signal matches (may be multiple) */
  sections: Array<{ section: string; matchedBy: string }>;
}

export interface SignalTrendPoint {
  bucketMs: number;
  volume: number;
  avgTone: number | null;
}

export interface SignalFilter {
  section?: string;
  since?: number;     // epoch ms
  limit?: number;
  minToneMag?: number;
}

// ---------------------------------------------------------------------------
// Adapter helpers
// ---------------------------------------------------------------------------

/** Derive a display currency from asset_class. */
function currencyFromAssetClass(assetClass: string): string {
  if (assetClass === 'fx') return 'EUR'; // e.g. EURUSD=X — show base leg
  return 'USD';
}

function adaptSnapshot(s: MarketSnapshot): MarketInstrument {
  return {
    symbol: s.symbol,
    name: s.symbol, // no name field in API; symbol is the display identifier
    price: s.price,
    change: 0, // no absolute change in API
    changePercent: s.change_pct ?? 0, // null → 0 (safe for .toFixed())
    currency: currencyFromAssetClass(s.asset_class),
    timestamp: new Date(s.captured_at).toISOString(),
  };
}

function adaptGdeltEvent(e: RawGdeltEvent): GdeltEvent | null {
  // Discard events without coordinates — they cannot be plotted on the map
  if (e.lat == null || e.lon == null) return null;
  return {
    eventId: e.event_id,
    lat: e.lat,
    lng: e.lon,
    category: e.category,
    severity: e.severity ?? 0,
  };
}

function adaptEventRow(e: RawEventRow): GlobalEvent | null {
  // Rows without coordinates cannot be plotted — discard silently
  if (e.lat == null || e.lon == null) return null;
  return {
    key: `${e.source}:${e.sourceEventId}`,
    source: e.source,
    sourceEventId: e.sourceEventId,
    eventType: e.eventType,
    category: e.category,
    severity: e.severity ?? 0,
    lat: e.lat,
    lng: e.lon,
    country: e.country,
    title: e.title ?? e.eventType,
    url: e.url,
    occurredAt: e.occurredAt != null ? new Date(e.occurredAt).toISOString() : null,
    capturedAt: new Date(e.capturedAt).toISOString(),
  };
}

/** Split a pipe-separated nullable string into a clean array. */
function splitPipe(s: string | null): string[] {
  if (!s || s.trim() === '') return [];
  return s.split(';').flatMap((part) => part.split(',')).map((p) => p.trim()).filter(Boolean);
}

function adaptSignalRow(r: RawSignalRow): RadarSignal {
  return {
    key: `${r.source}:${r.signalId}`,
    source: r.source,
    signalId: r.signalId,
    title: r.title ?? r.signalId,
    url: r.url,
    tone: r.tone,
    themes: splitPipe(r.themes),
    persons: splitPipe(r.persons),
    organizations: splitPipe(r.organizations),
    lat: r.lat,
    lon: r.lon,
    country: r.country,
    occurredAt: r.occurredAt != null ? new Date(r.occurredAt).toISOString() : null,
    capturedAt: new Date(r.capturedAt).toISOString(),
    sections: Array.isArray(r.sections) ? r.sections : [],
  };
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 8000;

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`API ${path} returned ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

export async function getMarkets(): Promise<MarketInstrument[]> {
  const raw = await apiFetch<MarketSnapshot[]>('/api/markets');
  if (!Array.isArray(raw)) return [];
  return raw.map(adaptSnapshot);
}

export async function getMarketTrend(symbol: string): Promise<PricePoint[]> {
  const encoded = encodeURIComponent(symbol);
  const raw = await apiFetch<MarketSnapshot[]>(`/api/markets/${encoded}`);
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => ({
    timestamp: new Date(s.captured_at).toISOString(),
    price: s.price,
  }));
}

export async function getGdelt(): Promise<GdeltResponse> {
  const raw = await apiFetch<RawGdeltEvent[]>('/api/gdelt');
  const events: GdeltEvent[] = Array.isArray(raw)
    ? (raw.map(adaptGdeltEvent).filter((e): e is GdeltEvent => e !== null))
    : [];
  return {
    events,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getBriefing(domain = 'finance'): Promise<BriefingResponse> {
  const raw = await apiFetch<RawBriefingResponse>(
    `/api/briefing?domain=${encodeURIComponent(domain)}`
  );
  return {
    briefing: raw.briefing?.body_md ?? 'Briefing no disponible.',
    generatedAt: raw.briefing ? new Date(raw.briefing.created_at).toISOString() : '',
    domain: raw.briefing?.domain ?? domain,
  };
}

/**
 * Fetch global events from /api/events with optional filters.
 * Rows without lat/lon are discarded (cannot be plotted).
 *
 * Attribution (D-107 / feedback_data_tos):
 *  - USGS: "U.S. Geological Survey" (public domain)
 *  - EONET: "Data: NASA EONET" (public domain)
 *  - GDELT: "Source: The GDELT Project (gdeltproject.org)"
 */
export async function getEvents(filter?: EventFilter): Promise<EventsResponse> {
  const params = new URLSearchParams();

  if (filter) {
    if (filter.type !== undefined) params.set('type', filter.type);
    if (filter.category !== undefined) params.set('category', filter.category);
    if (filter.minSeverity !== undefined) params.set('minSeverity', String(filter.minSeverity));
    if (filter.since !== undefined) params.set('since', String(filter.since));
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.bbox !== undefined) params.set('bbox', filter.bbox.join(','));
  }

  const qs = params.toString();
  const path = qs ? `/api/events?${qs}` : '/api/events';
  const raw = await apiFetch<RawEventRow[]>(path);
  const events: GlobalEvent[] = Array.isArray(raw)
    ? raw.map(adaptEventRow).filter((e): e is GlobalEvent => e !== null)
    : [];

  return {
    events,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch radar signals from /api/signals with optional filters.
 *
 * Note: signals WITHOUT lat/lon are included in the result (panel needs them).
 * MapView discards no-coord rows when building GeoJSON features (W-3).
 *
 * Attribution (feedback_data_tos):
 *   "Source: The GDELT Project (gdeltproject.org)"
 */
export async function getSignals(filter?: SignalFilter): Promise<RadarSignal[]> {
  const params = new URLSearchParams();

  if (filter) {
    if (filter.section !== undefined) params.set('section', filter.section);
    if (filter.since !== undefined) params.set('since', String(filter.since));
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.minToneMag !== undefined) params.set('minToneMag', String(filter.minToneMag));
  }

  const qs = params.toString();
  const path = qs ? `/api/signals?${qs}` : '/api/signals';
  const raw = await apiFetch<RawSignalRow[]>(path);
  if (!Array.isArray(raw)) return [];
  return raw.map(adaptSignalRow);
}

/**
 * Fetch signal trend data for a section from /api/signals/trend.
 *
 * @param section  One of the 6 radar section literals.
 * @param opts     Optional: `since` (epoch ms), `bucket` (ms bucket size).
 */
export async function getSignalTrend(
  section: string,
  opts?: { since?: number; bucket?: number }
): Promise<SignalTrendPoint[]> {
  const params = new URLSearchParams({ section });
  if (opts?.since !== undefined) params.set('since', String(opts.since));
  if (opts?.bucket !== undefined) params.set('bucket', String(opts.bucket));

  const raw = await apiFetch<RawSignalTrendPoint[]>(`/api/signals/trend?${params.toString()}`);
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    bucketMs: p.bucketMs,
    volume: p.volume,
    avgTone: p.avgTone,
  }));
}
