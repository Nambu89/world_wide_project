// packages/connectors/edu/news.ts
//
// Conector RSS de noticias — dominio edu.
// Zero-key: sin API keys requeridas.
//
// Fuentes y licencias (ver allowlist.ts para detalles):
//   - BBC Business RSS  (feeds.bbci.co.uk)  — BBC RSS personal use
//   - CNBC RSS          (www.cnbc.com)       — CNBC RSS personal use
//
// Patrón osiris (connector-pattern):
//   - fetch + User-Agent identificable + AbortSignal.timeout(8000)
//   - Validación SSRF-safe con isAllowedFeedUrl() ANTES de todo fetch (R-7, CRÍTICO)
//   - Fallback multinivel por feed: fallo individual no cancela los demás feeds
//   - Retorno vacío gracioso ante fallo total — NUNCA lanza hacia arriba
//   - Log explícito en cada fallo (NO catch silencioso)
//   - serve-stale: si hay una copia reciente en memoria, se sirve mientras se refresca
//   - single-flight: una sola petición en vuelo a la vez
//
// NOTA ATRIBUCIÓN: BBC y CNBC requieren atribución en la UI al mostrar sus titulares.

import { XMLParser } from 'fast-xml-parser';
import type { NewsItem } from '@www/store';
import { isAllowedFeedUrl, FEED_ALLOWLIST } from './allowlist.js';

// ─── Contrato público ────────────────────────────────────────────────────────

import type { ConnectorResult } from '../types.js';

// ─── Constantes ──────────────────────────────────────────────────────────────

const USER_AGENT =
  'world-wide-project/1.0 (personal use; fernandopradagorge@gmail.com)';
const TIMEOUT_MS = 8000;
const SOURCE_LABEL = 'edu-rss';

// ─── Single-flight + serve-stale ─────────────────────────────────────────────

let _inFlight: Promise<ConnectorResult<NewsItem>> | null = null;
let _lastGood: ConnectorResult<NewsItem> | null = null;
const STALE_TTL_MS = 30 * 60 * 1000; // 30 min — scheduler típico cada 15-20 min

/**
 * Obtiene noticias de todos los feeds de la allowlist.
 *
 * Garantías:
 *   - NUNCA lanza hacia arriba.
 *   - Si todos los feeds fallan, retorna { data: [], stale: false, fetchedAt }.
 *   - Si hay un resultado reciente en memoria, lo sirve con stale:true mientras refresca.
 *   - Single-flight: peticiones concurrentes comparten el mismo in-flight.
 */
export async function fetchNews(): Promise<ConnectorResult<NewsItem>> {
  // Serve-stale inmediato si hay copia buena y hay un in-flight en curso
  if (_inFlight !== null) {
    if (_lastGood !== null && Date.now() - _lastGood.fetchedAt < STALE_TTL_MS) {
      return { ..._lastGood, stale: true, fetchedAt: Date.now() };
    }
    return _inFlight;
  }

  _inFlight = _fetchNewsInternal();
  try {
    const result = await _inFlight;
    return result;
  } finally {
    _inFlight = null;
  }
}

// ─── Implementación interna ───────────────────────────────────────────────────

async function _fetchNewsInternal(): Promise<ConnectorResult<NewsItem>> {
  const now = Date.now();
  const items: NewsItem[] = [];
  let anyFeedFailed = false;

  for (const feed of FEED_ALLOWLIST) {
    // R-7 SSRF: validar ANTES de fetch — si no pasa, skip con log
    if (!isAllowedFeedUrl(feed.url)) {
      console.warn(
        `[news] SSRF guard: URL descartada (no en allowlist o protocolo inseguro): ${feed.url}`,
      );
      continue;
    }

    const { items: feedItems, failed } = await _fetchFeedWithStatus(feed.url, feed.domain, now);
    items.push(...feedItems);
    if (failed) anyFeedFailed = true;
  }

  const result: ConnectorResult<NewsItem> = {
    data: items,
    stale: false,
    fetchedAt: now,
  };

  if (items.length > 0) {
    // Al menos un feed produjo items — actualizamos lastGood y devolvemos resultado fresco
    _lastGood = result;
  } else if (anyFeedFailed && _lastGood !== null && now - _lastGood.fetchedAt < STALE_TTL_MS) {
    // Todos los feeds fallaron por error (no por feed genuinamente vacio) y hay copia reciente
    // — serve-stale. Solo en caso de fallo de upstream, no cuando el RSS esta vacio pero OK.
    console.warn(
      `[news] Todos los feeds fallaron — sirviendo ${_lastGood.data.length} items stale de memoria`,
    );
    return { ..._lastGood, stale: true, fetchedAt: now };
  } else if (items.length === 0 && !anyFeedFailed) {
    // Feeds respondieron OK pero sin items — retorno vacio gracioso (no serve-stale)
    console.warn('[news] Todos los feeds respondieron OK pero sin items — retornando vacio gracioso');
  } else {
    // Vacío gracioso por fallo sin copia stale
    console.error('[news] Todos los feeds fallaron y no hay copia stale — retornando vacío gracioso');
  }

  return result;
}

// ─── Fetch + parse de un feed individual ─────────────────────────────────────

interface FeedResult {
  items: NewsItem[];
  /** true si el feed fallo por error de red o HTTP no-OK (no si simplemente estaba vacio) */
  failed: boolean;
}

async function _fetchFeedWithStatus(
  url: string,
  feedDomain: string,
  now: number,
): Promise<FeedResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[news] fetch error for ${feedDomain}: ${msg}`);
    return { items: [], failed: true };
  }

  if (!res.ok) {
    console.error(`[news] HTTP ${res.status} for ${feedDomain}`);
    return { items: [], failed: true };
  }

  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    console.error(`[news] text read error for ${feedDomain}: ${err}`);
    return { items: [], failed: true };
  }

  // El feed respondio OK — parseamos. Si el RSS esta vacio, items=[] pero failed=false.
  const items = _parseRss(text, feedDomain, now);
  return { items, failed: false };
}

// ─── Parser RSS (fast-xml-parser) ────────────────────────────────────────────

const _xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/**
 * Parsea XML RSS y extrae NewsItems.
 * Acepta RSS 2.0. Retorna [] si el shape no coincide — parse-don't-validate.
 */
function _parseRss(xml: string, feedDomain: string, capturedAt: number): NewsItem[] {
  let parsed: unknown;
  try {
    parsed = _xmlParser.parse(xml);
  } catch (err) {
    console.error(`[news] XML parse error for ${feedDomain}: ${err}`);
    return [];
  }

  // Shape: { rss: { channel: { item: [...] | {} } } }
  if (!_isObject(parsed)) return [];
  const rss = parsed['rss'];
  if (!_isObject(rss)) return [];
  const channel = rss['channel'];
  if (!_isObject(channel)) return [];

  // fast-xml-parser colapsa un único <item> a objeto, varios a array
  const rawItems = channel['item'];
  const itemArray: unknown[] = Array.isArray(rawItems)
    ? rawItems
    : rawItems !== undefined && rawItems !== null
      ? [rawItems]
      : [];

  const result: NewsItem[] = [];

  for (const raw of itemArray) {
    if (!_isObject(raw)) continue;

    const title = _asString(raw['title']);
    const link = _asString(raw['link']);
    if (title === null || link === null) continue;

    // published_at: intenta parsear pubDate — si falla, usa capturedAt
    const pubDateStr = _asString(raw['pubDate']);
    let publishedAt: number;
    if (pubDateStr !== null) {
      const ts = Date.parse(pubDateStr);
      publishedAt = isFinite(ts) ? ts : capturedAt;
    } else {
      publishedAt = capturedAt;
    }

    result.push({
      source: SOURCE_LABEL,
      feed_domain: feedDomain,
      title: title.trim(),
      url: link.trim(),
      published_at: publishedAt,
      captured_at: capturedAt,
    });
  }

  return result;
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

function _isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function _asString(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}
