// packages/connectors/finance/markets.ts
//
// Fuente primaria:   Yahoo Finance v8  (keyless, sin API key)
// Fuente secundaria: Yahoo Finance v6  (keyless, fallback)
// Fuente terciaria:  @www/store getLatestMarkets (stale, DB local)
// Fallback final:    retorno vacío gracioso
//
// ToS Yahoo Finance:
//   https://legal.yahoo.com/us/en/yahoo/terms/product-atos/fin/index.html
//   Uso personal / no-comercial sin redistribución de datos: permitido.
//   Rate limit implícito — respetar ETag + frecuencia razonable (scheduler ≥15 min).
//   FRÁGIL: Yahoo puede cambiar sus endpoints sin aviso. Marcar como fuente frágil.
//   Zero-key: SIN API key (D-007).
//
// Patrón osiris (connector-pattern): fetch + User-Agent + AbortSignal.timeout(8000)
//   + fallback multinivel + retorno vacío gracioso (NUNCA throw al caller)
//   + log explícito en cada caída de nivel (NO catch silencioso)
//   + cache condicional ETag/If-None-Match + single-flight + serve-stale

import { getLatestMarkets } from '@www/store';
import type { MarketSnapshot } from '@www/store';

// ─── Contrato público ────────────────────────────────────────────────────────

export interface ConnectorResult<T> {
  data: T[];
  stale: boolean;
  fetchedAt: number;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const USER_AGENT = 'world-wide-project/1.0 (personal use; fernandopradagorge@gmail.com)';
const TIMEOUT_MS = 8000;

/**
 * Symbols a obtener. Lista pequeña y estable — stocks principales + crypto (CoinGecko no
 * necesario para este subset; Yahoo cubre todo keyless).
 */
const SYMBOLS = ['SPY', 'QQQ', 'GLD', 'BTC-USD', 'ETH-USD', 'EURUSD=X', 'DX-Y.NYB'];

// Yahoo Finance v8 (chart endpoint — más estable que v7/v10)
const YAHOO_V8_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart';
// Yahoo Finance v6 (spark endpoint — datos básicos, alternativa)
const YAHOO_V6_BASE = 'https://query2.finance.yahoo.com/v6/finance/quote';

// ─── Cache ETag ──────────────────────────────────────────────────────────────

// Una entrada por símbolo para v8; entrada global para v6 (bulk)
const etagCache: Map<string, string> = new Map();

// ─── Single-flight + serve-stale ─────────────────────────────────────────────

let inFlight: Promise<ConnectorResult<MarketSnapshot>> | null = null;
let lastGood: ConnectorResult<MarketSnapshot> | null = null;
const STALE_TTL_MS = 20 * 60 * 1000; // 20 min — scheduler corre cada 15 min

export async function fetchMarkets(): Promise<ConnectorResult<MarketSnapshot>> {
  // Single-flight: si ya hay una petición en vuelo, espera al mismo resultado
  if (inFlight !== null) return inFlight;

  inFlight = _fetchMarketsInternal();
  try {
    const result = await inFlight;
    return result;
  } finally {
    inFlight = null;
  }
}

// ─── Implementación interna ───────────────────────────────────────────────────

async function _fetchMarketsInternal(): Promise<ConnectorResult<MarketSnapshot>> {
  const now = Date.now();

  // ── Nivel 1: Yahoo v8 ──────────────────────────────────────────────────────
  const v8Result = await tryYahooV8(SYMBOLS, now);
  if (v8Result !== null) {
    lastGood = v8Result;
    return v8Result;
  }

  // ── Nivel 2: Yahoo v6 (fallback) ──────────────────────────────────────────
  console.warn('[markets] Yahoo v8 failed — trying Yahoo v6 fallback');
  const v6Result = await tryYahooV6(SYMBOLS, now);
  if (v6Result !== null) {
    lastGood = v6Result;
    return v6Result;
  }

  // ── Nivel 3: store stale — último snapshot de la DB local ─────────────────
  console.warn('[markets] Yahoo v6 failed — trying store stale fallback');
  const storeResult = await tryStoreFallback(now);
  if (storeResult !== null) {
    // serve-stale también desde lastGood en memoria si es más fresco
    if (lastGood !== null && lastGood.fetchedAt > now - STALE_TTL_MS) {
      console.warn('[markets] Serving in-memory stale (more recent than DB)');
      return { ...lastGood, stale: true, fetchedAt: now };
    }
    return storeResult;
  }

  // serve-stale en memoria como último recurso antes del vacío
  if (lastGood !== null && lastGood.fetchedAt > now - STALE_TTL_MS) {
    console.warn('[markets] All upstreams failed — serving in-memory stale');
    return { ...lastGood, stale: true, fetchedAt: now };
  }

  // ── Nivel 4: vacío gracioso ────────────────────────────────────────────────
  console.error('[markets] All fallback levels exhausted — returning empty graceful');
  return { data: [], stale: false, fetchedAt: now };
}

// ─── Yahoo v8: chart endpoint (un símbolo a la vez, más confiable) ────────────

async function tryYahooV8(
  symbols: string[],
  now: number,
): Promise<ConnectorResult<MarketSnapshot> | null> {
  const snapshots: MarketSnapshot[] = [];

  for (const symbol of symbols) {
    const url = `${YAHOO_V8_BASE}/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const etag = etagCache.get(`v8:${symbol}`);
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    };
    if (etag !== undefined) headers['If-None-Match'] = etag;

    let res: Response;
    try {
      res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[markets] v8 fetch error for ${symbol}: ${msg}`);
      return null; // fallo de red — nivel completo abandona
    }

    // 304 Not Modified — el snapshot para este símbolo no cambió
    if (res.status === 304) {
      // No tenemos datos frescos del símbolo aquí — skip, usa lo que tenga el store
      continue;
    }

    if (!res.ok) {
      console.error(`[markets] v8 non-OK for ${symbol}: HTTP ${res.status}`);
      return null; // cualquier HTTP error en v8 dispara fallback a v6
    }

    // Guardar ETag para la próxima ronda
    const newEtag = res.headers.get('etag');
    if (newEtag !== null) etagCache.set(`v8:${symbol}`, newEtag);

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      console.error(`[markets] v8 JSON parse error for ${symbol}: ${err}`);
      return null;
    }

    const snap = parseYahooV8Response(json, symbol, now);
    if (snap === null) {
      console.error(`[markets] v8 schema mismatch for ${symbol}`);
      return null;
    }
    snapshots.push(snap);
  }

  // Si no obtuvimos ningún snapshot (todos fueron 304 o lista vacía) — retorna null
  if (snapshots.length === 0) return null;

  return { data: snapshots, stale: false, fetchedAt: now };
}

// ─── Yahoo v6: quote endpoint (bulk, menos fiable que v8 pero más simple) ────

async function tryYahooV6(
  symbols: string[],
  now: number,
): Promise<ConnectorResult<MarketSnapshot> | null> {
  const symbolsParam = symbols.map(encodeURIComponent).join(',');
  const url = `${YAHOO_V6_BASE}?symbols=${symbolsParam}&fields=regularMarketPrice,regularMarketChangePercent,quoteType`;
  const etag = etagCache.get('v6:bulk');
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json',
  };
  if (etag !== undefined) headers['If-None-Match'] = etag;

  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[markets] v6 fetch error: ${msg}`);
    return null;
  }

  if (res.status === 304) {
    // Sin datos nuevos — el caller intentará el nivel siguiente
    console.warn('[markets] v6 304 Not Modified — no fresh data');
    return null;
  }

  if (!res.ok) {
    console.error(`[markets] v6 non-OK: HTTP ${res.status}`);
    return null;
  }

  const newEtag = res.headers.get('etag');
  if (newEtag !== null) etagCache.set('v6:bulk', newEtag);

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    console.error(`[markets] v6 JSON parse error: ${err}`);
    return null;
  }

  const snapshots = parseYahooV6Response(json, now);
  if (snapshots === null) {
    console.error('[markets] v6 schema mismatch');
    return null;
  }
  if (snapshots.length === 0) return null;

  return { data: snapshots, stale: false, fetchedAt: now };
}

// ─── Fallback DB local ────────────────────────────────────────────────────────

async function tryStoreFallback(
  now: number,
): Promise<ConnectorResult<MarketSnapshot> | null> {
  try {
    const rows = await getLatestMarkets();
    if (rows.length === 0) {
      console.warn('[markets] Store fallback: DB empty');
      return null;
    }
    console.warn(`[markets] Store fallback: serving ${rows.length} stale rows from DB`);
    return { data: rows, stale: true, fetchedAt: now };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[markets] Store fallback error: ${msg}`);
    return null;
  }
}

// ─── Parsers manuales (parse-don't-validate, sin Zod — no en deps) ────────────

/**
 * Yahoo v8 chart response shape (simplificado para precio actual):
 * { chart: { result: [{ meta: { symbol, regularMarketPrice, instrumentType }, ... }] } }
 */
function parseYahooV8Response(
  raw: unknown,
  symbol: string,
  capturedAt: number,
): MarketSnapshot | null {
  if (!isObject(raw)) return null;
  const chart = raw['chart'];
  if (!isObject(chart)) return null;
  const result = chart['result'];
  if (!Array.isArray(result) || result.length === 0) return null;
  const first = result[0];
  if (!isObject(first)) return null;
  const meta = first['meta'];
  if (!isObject(meta)) return null;

  const price = toFiniteNumber(meta['regularMarketPrice']);
  if (price === null) return null;

  const changePct = toFiniteNumber(meta['regularMarketChangePercent']) ?? null;
  const instrumentType = typeof meta['instrumentType'] === 'string'
    ? meta['instrumentType']
    : 'UNKNOWN';

  return {
    source: 'yahoo-v8',
    symbol,
    asset_class: normalizeAssetClass(instrumentType, symbol),
    price,
    change_pct: changePct,
    captured_at: capturedAt,
  };
}

/**
 * Yahoo v6 quoteResponse shape:
 * { quoteResponse: { result: [{ symbol, regularMarketPrice, regularMarketChangePercent, quoteType }] } }
 */
function parseYahooV6Response(
  raw: unknown,
  capturedAt: number,
): MarketSnapshot[] | null {
  if (!isObject(raw)) return null;
  const qr = raw['quoteResponse'];
  if (!isObject(qr)) return null;
  const result = qr['result'];
  if (!Array.isArray(result)) return null;

  const snapshots: MarketSnapshot[] = [];
  for (const item of result) {
    if (!isObject(item)) continue;
    const symbol = typeof item['symbol'] === 'string' ? item['symbol'] : null;
    if (symbol === null) continue;
    const price = toFiniteNumber(item['regularMarketPrice']);
    if (price === null) continue;
    const changePct = toFiniteNumber(item['regularMarketChangePercent']) ?? null;
    const quoteType = typeof item['quoteType'] === 'string' ? item['quoteType'] : 'UNKNOWN';

    snapshots.push({
      source: 'yahoo-v6',
      symbol,
      asset_class: normalizeAssetClass(quoteType, symbol),
      price,
      change_pct: changePct,
      captured_at: capturedAt,
    });
  }
  return snapshots;
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (isFinite(n)) return n;
  }
  return null;
}

/**
 * Normaliza el tipo de instrumento de Yahoo a un asset_class canónico del proyecto.
 * Yahoo usa: EQUITY, ETF, CRYPTOCURRENCY, CURRENCY, INDEX, FUTURE, MUTUALFUND.
 */
function normalizeAssetClass(yahooType: string, symbol: string): string {
  const t = yahooType.toUpperCase();
  if (t === 'CRYPTOCURRENCY') return 'crypto';
  if (t === 'CURRENCY' || symbol.endsWith('=X')) return 'fx';
  if (t === 'ETF') return 'etf';
  if (t === 'INDEX' || symbol.endsWith('.NYB') || symbol.startsWith('^')) return 'index';
  if (t === 'EQUITY') return 'equity';
  if (t === 'FUTURE') return 'future';
  return 'other';
}
