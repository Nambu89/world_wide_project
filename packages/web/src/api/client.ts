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
