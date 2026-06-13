/**
 * API client — reads ONLY from /api/* (never upstream directly).
 * All fetches use AbortSignal.timeout(8000) to prevent hangs.
 */

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
  eventCode: string;
  goldstein: number;
  tone: number;
  url: string;
  date: string;
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

export async function getMarkets(): Promise<MarketInstrument[]> {
  const data = await apiFetch<{ instruments: MarketInstrument[] } | MarketInstrument[]>(
    '/api/markets'
  );
  // Handle both wrapped {instruments:[]} and bare [] responses gracefully
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'instruments' in data) return data.instruments;
  return [];
}

export async function getMarketTrend(symbol: string): Promise<PricePoint[]> {
  const encoded = encodeURIComponent(symbol);
  const data = await apiFetch<{ history: PricePoint[] } | PricePoint[]>(
    `/api/markets/${encoded}`
  );
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'history' in data) return data.history;
  return [];
}

export async function getGdelt(): Promise<GdeltResponse> {
  const data = await apiFetch<GdeltResponse>('/api/gdelt');
  return data ?? { events: [], fetchedAt: new Date().toISOString() };
}

export async function getBriefing(domain = 'finance'): Promise<BriefingResponse> {
  const data = await apiFetch<BriefingResponse>(`/api/briefing?domain=${encodeURIComponent(domain)}`);
  return data;
}
