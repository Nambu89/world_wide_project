// packages/connectors/geo/gdelt.ts
//
// Source: GDELT DOC 2.0 API  |  ToS: https://www.gdeltproject.org/about.html
// GDELT data is open/public-domain, keyless, permissive for programmatic access.
// Rate limits: ≤1 req/5s (scheduler runs every ~15min → 1 req/cycle, OK).
// Key: zero-key (no API key required)
//
// MIGRATION NOTE (2026-06-13):
//   La GDELT GEO 2.0 API (api/v2/geo/geo) devuelve HTTP 404 upstream — servicio deprecado/
//   caído confirmado. El repo osiris tiene el mismo endpoint roto. Migrado a DOC 2.0 API
//   (api/v2/doc/doc?mode=artlist) que SÍ funciona. La DOC API no proporciona lat/lon por
//   artículo, por lo que se geocodifica por `sourcecountry` usando centroides aproximados
//   a nivel país (country-centroids.ts). Si el país no está en el mapa o falta
//   sourcecountry, lat/lon = null (el evento se persiste igual; el mapa no lo pinta).
//
// Devuelve datos normalizados o resultado vacío gracioso. NUNCA lanza hacia arriba.

import type { GdeltEvent } from "@www/store";
import { COUNTRY_CENTROIDS } from "./country-centroids.js";

// DOC 2.0 API — artlist mode, finanzas/mercados, últimas 24h, hasta 75 artículos
const DOC_API_URL =
  "https://api.gdeltproject.org/api/v2/doc/doc" +
  "?query=(economy%20OR%20market%20OR%20finance%20OR%20inflation%20OR%20%22central%20bank%22)" +
  "&mode=artlist&format=json&maxrecords=75&timespan=24h&sort=hybridrel";

const USER_AGENT = "world-wide-project/1.0 (+fernandopradagorge@gmail.com)";
const TIMEOUT_MS = 8000;

// --- Type guards manuales: parse-don't-validate en el borde ---
// No confiamos en la forma del payload externo; ningún campo es obligatorio.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Forma esperada de cada artículo en el array `articles` de la DOC API.
// Todos los campos son opcionales — la API puede omitirlos sin avisar.
interface DocArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

function isDocArticle(v: unknown): v is DocArticle {
  // Solo exige que sea un objeto; los campos individuales se leen con toStringOrNull.
  return isObject(v);
}

function parseDocResponse(v: unknown): DocArticle[] | null {
  if (!isObject(v)) return null;
  const articles = v["articles"];
  if (!Array.isArray(articles)) return null;
  // Filtra entradas que no son objetos; las válidas pasan como DocArticle.
  return articles.filter(isDocArticle);
}

// --- Geocode por país ---

function getCentroid(sourcecountry: string | null): { lat: number | null; lon: number | null } {
  if (!sourcecountry) return { lat: null, lon: null };
  const entry = COUNTRY_CENTROIDS[sourcecountry];
  if (!entry) return { lat: null, lon: null };
  return { lat: entry.lat, lon: entry.lon };
}

// --- event_id estable derivado del URL ---
// Usa el URL directamente como ID único (estable entre runs para el mismo artículo).
// Si no hay URL, genera un fallback basado en título + seendate.

function deriveEventId(article: DocArticle): string {
  const url = toStringOrNull(article.url ?? null);
  if (url) {
    // Prefijo "gdelt_" + URL (URL ya es suficientemente único y estable)
    return "gdelt_" + url;
  }
  const title = toStringOrNull(article.title ?? null) ?? "unknown";
  const date = toStringOrNull(article.seendate ?? null) ?? String(Date.now());
  return `gdelt_${title.slice(0, 40).replace(/\s+/g, "_")}_${date}`;
}

// --- Result type ---

export interface ConnectorResult<T> {
  data: T[];
  stale: boolean;
  fetchedAt: number;
}

// --- Single-flight + serve-stale ---

let inFlight: Promise<ConnectorResult<GdeltEvent>> | null = null;
let lastGood: { data: GdeltEvent[]; ts: number } | null = null;
const STALE_TTL_MS = 60 * 60 * 1000; // 1h

// --- Mapping helper ---

function mapArticleToEvent(article: DocArticle, now: number): GdeltEvent {
  const sourcecountry = toStringOrNull(article.sourcecountry ?? null);
  const domain = toStringOrNull(article.domain ?? null);
  const { lat, lon } = getCentroid(sourcecountry);

  // category: domain si existe, fallback a sourcecountry, fallback a null
  const category = domain ?? sourcecountry;

  return {
    source: "gdelt",
    event_id: deriveEventId(article),
    category,
    severity: null, // artlist no proporciona tono/severidad numérica
    lat,
    lon,
    captured_at: now,
  };
}

// --- Core fetch (exported for testing) ---

export async function fetchGdelt(): Promise<ConnectorResult<GdeltEvent>> {
  // Single-flight: una sola petición concurrente en vuelo a la vez
  if (inFlight) return inFlight;

  inFlight = _doFetch().then((result) => {
    inFlight = null;
    return result;
  });

  return inFlight;
}

async function _doFetch(): Promise<ConnectorResult<GdeltEvent>> {
  const now = Date.now();

  try {
    const res = await fetch(DOC_API_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Fallback nivel 1: HTTP no-OK → vacío gracioso (o stale si hay copia reciente)
    if (!res.ok) {
      console.error(`[gdelt] upstream HTTP ${res.status} ${res.statusText}`);
      return serveStaleOrEmpty(now);
    }

    const json: unknown = await res.json();

    // parse-don't-validate: shape inesperado → vacío gracioso
    const articles = parseDocResponse(json);
    if (articles === null) {
      console.error("[gdelt] schema mismatch: response missing articles array");
      return serveStaleOrEmpty(now);
    }

    const data: GdeltEvent[] = articles.map((a) => mapArticleToEvent(a, now));

    lastGood = { data, ts: now };
    return { data, stale: false, fetchedAt: now };
  } catch (err) {
    // Fallback nivel 2: timeout / red / abort → vacío gracioso
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[gdelt] fetch failed: ${message}`);
    return serveStaleOrEmpty(now);
  }
}

function serveStaleOrEmpty(now: number): ConnectorResult<GdeltEvent> {
  if (lastGood && now - lastGood.ts < STALE_TTL_MS) {
    return { data: lastGood.data, stale: true, fetchedAt: lastGood.ts };
  }
  return { data: [], stale: false, fetchedAt: now };
}
