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
 *   /api/cii          → CiiRow[]           (T-26, bare array, camelCase — L-1 critical)
 *   /api/cii/:country → CiiRow[]           (T-26, trend array for a country)
 *   /api/convergence  → ConvergenceRow[]   (T-34, bare array, camelCase — L-1 critical)
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
 * Raw CII row from /api/cii and /api/cii/:country.
 * WIRE FORMAT = camelCase (L-1 critical — same BUG-1 discipline as EventRow/SignalRow).
 * lat/lon may be null for countries without a centroid; componentsJson is a JSON string.
 */
interface RawCiiRow {
  country: string;
  composite: number;
  baselineRisk: number;
  eventScore: number;
  dynamicScore: number | null;
  trend: 'rising' | 'falling' | 'stable' | null;
  methodologyVersion: string;
  componentsJson: string;       // JSON string of CiiComponent[]
  capturedAt: number;           // epoch ms
  lat: number | null;
  lon: number | null;
}

/**
 * Raw convergence signal row from /api/convergence.
 * WIRE FORMAT = camelCase (L-1 critical — anti-BUG-1, same discipline as EventRow/CiiRow).
 * familiesJson/dimensionsJson/componentsJson are JSON strings; the client parses them.
 * lat/lon may be null for countries without a centroid.
 */
interface RawConvergenceRow {
  country: string;
  familiesJson: string;       // JSON string of string[]
  dimensionsJson: string;     // JSON string of string[]
  componentsJson: string;     // JSON string of ConvergenceObservation[]
  strength: number;
  sourceCount: number;
  dynamicScore: number | null;
  methodologyVersion: string;
  firstDetectedAt: number;    // epoch ms
  capturedAt: number;         // epoch ms
  lat: number | null;
  lon: number | null;
}

/**
 * Raw sanctions row from /api/sanctions.
 * WIRE FORMAT = camelCase (D-505 / L-1 — anti-BUG-1, same discipline as CiiRow).
 * lat/lon null for countries without a centroid.
 */
interface RawSanctionRow {
  country: string;
  sanctionedCount: number;
  capturedAt: number;   // epoch ms
  lat: number | null;
  lon: number | null;
}

/**
 * Shape of a single observation in componentsJson (from @www/core-signals observe.ts).
 * Used locally to extract topDimension (GAP-1).
 */
interface ConvergenceObservation {
  country: string;
  dimension: string;
  dataFamily: string;
  magnitude: number;
  ts: number;
  signalPresent: boolean;
  source: string;
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

/**
 * One component of a CII score — parsed from componentsJson.
 * Typed locally; web never imports @www/store (boundary rule).
 */
export interface CiiComponent {
  key: 'conflict' | 'economic' | 'political' | 'social';
  score: number;
  signalPresent: boolean;
  weight: number;
  sources: string[];
  detail?: string;
}

/**
 * Risk band for CII composite score (0-100).
 *   0-24  → low
 *  25-49  → moderate
 *  50-69  → elevated
 *  70-100 → high
 */
export type CiiBand = 'low' | 'moderate' | 'elevated' | 'high';

/**
 * View-model for a country CII row consumed by RiskPanel + MapView.
 * dominantComponent is derived from componentsJson — the component with the highest score.
 * Countries without lat/lon are included (panel uses all); MapView discards no-coord rows.
 */
export interface CiiCountry {
  country: string;
  composite: number;
  band: CiiBand;
  baselineRisk: number;
  eventScore: number;
  dynamicScore: number | null;
  trend: 'rising' | 'falling' | 'stable' | null;
  methodologyVersion: string;
  components: CiiComponent[];
  /** Component with highest score — null when componentsJson is empty/invalid */
  dominantComponent: CiiComponent | null;
  /** lat/lon present when country has a centroid; null → panel only, no map feature */
  lat: number | null;
  lon: number | null;
  capturedAt: string;   // ISO string
}

/**
 * View-model for a convergence signal consumed by ConvergencePanel + MapView (T-34).
 * topDimension = the dimension from componentsJson with the highest magnitude (GAP-1).
 * trend = sign of dynamicScore (>0 rising, <0 falling, else stable or null if no dynamicScore).
 * lat/lon null → panel only (no map feature emitted).
 */
export interface ConvergenceCountry {
  country: string;
  families: string[];
  dimensions: string[];
  /** Dimension with the highest magnitude in componentsJson (GAP-1); null if empty */
  topDimension: string | null;
  strength: number;
  sourceCount: number;
  dynamicScore: number | null;
  /** Trend derived from dynamicScore sign */
  trend: 'rising' | 'falling' | 'stable' | null;
  methodologyVersion: string;
  firstDetectedAt: string;   // ISO string
  capturedAt: string;        // ISO string
  lat: number | null;
  lon: number | null;
}

/**
 * View-model for an OFAC sanctions row consumed by FinancePanel + MapView.
 * lat/lon null → panel only (no map feature emitted).
 */
export interface SanctionCountry {
  country: string;
  sanctionedCount: number;
  capturedAt: string;   // ISO string
  lat: number | null;
  lon: number | null;
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

/** Derive the CII band from a composite score (0-100). */
function ciiBandFromScore(composite: number): CiiBand {
  if (composite < 25) return 'low';
  if (composite < 50) return 'moderate';
  if (composite < 70) return 'elevated';
  return 'high';
}

function adaptCiiRow(r: RawCiiRow): CiiCountry {
  let components: CiiComponent[] = [];
  try {
    const parsed: unknown = JSON.parse(r.componentsJson);
    if (Array.isArray(parsed)) {
      components = parsed as CiiComponent[];
    }
  } catch {
    // componentsJson malformed — treat as no components
  }

  // Dominant = highest score component (reduce sin init: seguro porque length>0)
  const dominantComponent: CiiComponent | null =
    components.length > 0
      ? components.reduce((best, c) => (c.score > best.score ? c : best))
      : null;

  return {
    country: r.country,
    composite: r.composite,
    band: ciiBandFromScore(r.composite),
    baselineRisk: r.baselineRisk,
    eventScore: r.eventScore,
    dynamicScore: r.dynamicScore,
    trend: r.trend,
    methodologyVersion: r.methodologyVersion,
    components,
    dominantComponent,
    lat: r.lat,
    lon: r.lon,
    capturedAt: new Date(r.capturedAt).toISOString(),
  };
}

/** Derive trend from dynamicScore sign. */
function trendFromDynamicScore(
  dynamicScore: number | null
): 'rising' | 'falling' | 'stable' | null {
  if (dynamicScore == null) return null;
  if (dynamicScore > 0) return 'rising';
  if (dynamicScore < 0) return 'falling';
  return 'stable';
}

/**
 * Extract the topDimension from componentsJson (GAP-1).
 * componentsJson = JSON of ConvergenceObservation[].
 * topDimension = dimension of the obs with highest magnitude; fallback to dimensions[0]; null if empty.
 */
function topDimensionFromComponents(
  componentsJson: string,
  dimensions: string[]
): string | null {
  try {
    const parsed: unknown = JSON.parse(componentsJson);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return dimensions[0] ?? null;
    }
    const obs = parsed as ConvergenceObservation[];
    const best = obs.reduce((a, b) => (b.magnitude > a.magnitude ? b : a));
    return best.dimension ?? dimensions[0] ?? null;
  } catch {
    return dimensions[0] ?? null;
  }
}

function adaptConvergenceRow(r: RawConvergenceRow): ConvergenceCountry {
  let families: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.familiesJson);
    if (Array.isArray(parsed)) families = parsed as string[];
  } catch {
    // D-409: parse failure → empty array
  }

  let dimensions: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.dimensionsJson);
    if (Array.isArray(parsed)) dimensions = parsed as string[];
  } catch {
    // D-409: parse failure → empty array
  }

  const topDimension = topDimensionFromComponents(r.componentsJson, dimensions);

  return {
    country: r.country,
    families,
    dimensions,
    topDimension,
    strength: r.strength,
    sourceCount: r.sourceCount,
    dynamicScore: r.dynamicScore,
    trend: trendFromDynamicScore(r.dynamicScore),
    methodologyVersion: r.methodologyVersion,
    firstDetectedAt: new Date(r.firstDetectedAt).toISOString(),
    capturedAt: new Date(r.capturedAt).toISOString(),
    lat: r.lat,
    lon: r.lon,
  };
}

function adaptSanctionRow(r: RawSanctionRow): SanctionCountry {
  return {
    country: r.country,
    sanctionedCount: r.sanctionedCount,
    capturedAt: new Date(r.capturedAt).toISOString(),
    lat: r.lat,
    lon: r.lon,
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

/**
 * Fetch CII scores for all countries from /api/cii.
 * All rows are returned (no lat/lon filtering — panel uses all).
 *
 * Attribution: CII propio · datos: USGS/NASA EONET/GDELT/GKG
 */
export async function getCii(): Promise<CiiCountry[]> {
  const raw = await apiFetch<RawCiiRow[]>('/api/cii');
  if (!Array.isArray(raw)) return [];
  return raw.map(adaptCiiRow);
}

/**
 * Fetch CII trend (historical rows) for a single country from /api/cii/:country.
 *
 * @param country  ISO-2 or name string — URL-encoded.
 * @param since    Optional epoch ms lower bound.
 */
export async function getCiiTrend(country: string, since?: number): Promise<CiiCountry[]> {
  const encoded = encodeURIComponent(country);
  const params = new URLSearchParams();
  if (since !== undefined) params.set('since', String(since));
  const qs = params.toString();
  const path = qs ? `/api/cii/${encoded}?${qs}` : `/api/cii/${encoded}`;
  const raw = await apiFetch<RawCiiRow[]>(path);
  if (!Array.isArray(raw)) return [];
  return raw.map(adaptCiiRow);
}

/**
 * Fetch convergence signals for all countries from /api/convergence (T-34).
 *
 * All rows are returned (no lat/lon filtering — panel uses all).
 * Rows without lat/lon are included; MapView discards them when building GeoJSON features.
 *
 * Wire format: camelCase (L-1 critical — anti-BUG-1).
 * familiesJson/dimensionsJson/componentsJson are parsed defensively (D-409).
 *
 * Attribution: motor de convergencia propio · datos: USGS/NASA EONET/GDELT/GKG
 */
export async function getConvergence(): Promise<ConvergenceCountry[]> {
  const raw = await apiFetch<RawConvergenceRow[]>('/api/convergence');
  if (!Array.isArray(raw)) return [];
  return raw.map(adaptConvergenceRow);
}

/**
 * Fetch latest OFAC sanctions count per country from /api/sanctions.
 * All rows returned (no lat/lon filter — panel uses all); MapView discards no-coord rows.
 * Wire format: camelCase (D-505 / L-1).
 *
 * Attribution: OpenSanctions (us_ofac_sdn, CC BY-NC) · OFAC SDN list
 */
export async function getSanctions(): Promise<SanctionCountry[]> {
  const raw = await apiFetch<RawSanctionRow[]>('/api/sanctions');
  if (!Array.isArray(raw)) return [];
  return raw.map(adaptSanctionRow);
}

// ---------------------------------------------------------------------------
// Chokepoints (slice A) — trade routes + disruption status + documented impact
// ---------------------------------------------------------------------------

/** Raw chokepoint row from /api/chokepoints. WIRE FORMAT = camelCase (D-606 / L-1). */
interface RawChokepointRow {
  id: string;
  name: string;
  nameEs: string;
  lat: number;
  lon: number;
  commodities: string[];
  worldShare: string;
  dependentEconomies: string[];
  impactEs: string;
  status: 'calm' | 'watch' | 'disrupted';
  score: number;
  capturedAt: number | null;
}

/** View-model for a chokepoint consumed by ChokepointsPanel + MapView. */
export interface Chokepoint {
  id: string;
  name: string;
  nameEs: string;
  lat: number;
  lon: number;
  commodities: string[];
  worldShare: string;
  dependentEconomies: string[];
  impactEs: string;
  status: 'calm' | 'watch' | 'disrupted';
  score: number;
  capturedAt: string | null;   // ISO or null
}

function adaptChokepoint(r: RawChokepointRow): Chokepoint {
  return {
    id: r.id, name: r.name, nameEs: r.nameEs, lat: r.lat, lon: r.lon,
    commodities: Array.isArray(r.commodities) ? r.commodities : [],
    worldShare: r.worldShare,
    dependentEconomies: Array.isArray(r.dependentEconomies) ? r.dependentEconomies : [],
    impactEs: r.impactEs, status: r.status, score: r.score,
    capturedAt: r.capturedAt != null ? new Date(r.capturedAt).toISOString() : null,
  };
}

/**
 * Fetch chokepoints (geometry + documented impact + live disruption status) from /api/chokepoints.
 * Attribution: rutas comerciales (datos propios) · disrupción derivada de GDELT/USGS/GKG.
 */
export async function getChokepoints(): Promise<Chokepoint[]> {
  const raw = await apiFetch<RawChokepointRow[]>('/api/chokepoints');
  if (!Array.isArray(raw)) return [];
  return raw.map(adaptChokepoint);
}

// ---------------------------------------------------------------------------
// AI Insights (slice B) — relate hotspots → predicted consequence chains
// ---------------------------------------------------------------------------

/** A cause→consequence insight card. WIRE FORMAT = camelCase (already plain). */
export interface Insight {
  id: string;
  title: string;
  category: string;
  triggers: string[];
  consequences: string[];
  affected: string[];
  severity: 'alta' | 'media' | 'baja';
  confidence: 'alta' | 'media' | 'baja';
}

interface RawInsightsResponse {
  insights: Insight[];
  generatedAt: number | null;
  model: string | null;
}

export interface InsightsResult {
  insights: Insight[];
  generatedAt: string | null;   // ISO or null
  model: string | null;
}

/**
 * Fetch the latest AI insight batch from /api/insights.
 * Empty array if no batch generated yet (LLM key missing or daily job not run) — graceful.
 */
export async function getInsights(): Promise<InsightsResult> {
  const raw = await apiFetch<RawInsightsResponse>('/api/insights');
  const insights = Array.isArray(raw?.insights) ? raw.insights : [];
  return {
    insights,
    generatedAt: raw?.generatedAt != null ? new Date(raw.generatedAt).toISOString() : null,
    model: raw?.model ?? null,
  };
}
