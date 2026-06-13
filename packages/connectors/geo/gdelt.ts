// packages/connectors/geo/gdelt.ts
//
// Source: GDELT 2.0 GEO API  |  ToS: https://www.gdeltproject.org/about.html
// GDELT data is open/public-domain, keyless, permissive for programmatic access.
// Rate limits: reasonable use; no explicit limit documented, be polite.
// Key: zero-key (no API key required)
//
// NG-2: GDELT is FINANCIAL CONTEXT data — no convergence scoring here.
// Devuelve datos normalizados o resultado vacio gracioso. NUNCA lanza hacia arriba.

import type { GdeltEvent } from "@www/store";

const GEO_API_URL =
  "https://api.gdeltproject.org/api/v2/geo/geo?query=(economy%20OR%20market%20OR%20finance)&format=GeoJSON";
const USER_AGENT = "world-wide-project/1.0 (+fernandopradagorge@gmail.com)";
const TIMEOUT_MS = 8000;

// --- Type guards manuales: parse-don't-validate en el borde (sin zod) ----------
// Mismo patron que packages/connectors/finance/markets.ts (isObject, toFiniteNumber, etc.)

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (isFinite(n)) return n;
  }
  return null;
}

// Tipos locales que describen la forma esperada del GeoJSON de GDELT
interface GdeltFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    name?: string;
    count?: number;
  };
}

/**
 * Valida que `v` tiene la forma de un GdeltFeature (Feature con Point geometry).
 * Retorna false ante cualquier desviacion de forma — no lanza.
 */
function isGdeltFeature(v: unknown): v is GdeltFeature {
  if (!isObject(v)) return false;
  if (v["type"] !== "Feature") return false;

  const geometry = v["geometry"];
  if (!isObject(geometry)) return false;
  if (geometry["type"] !== "Point") return false;

  const coords = geometry["coordinates"];
  if (!Array.isArray(coords) || coords.length < 2) return false;
  if (toFiniteNumber(coords[0]) === null || toFiniteNumber(coords[1]) === null) return false;

  const props = v["properties"];
  if (!isObject(props) && props !== null && props !== undefined) return false;

  return true;
}

/**
 * Valida que `v` es un GeoJSON FeatureCollection con array de features.
 * Retorna null si la forma no coincide — no lanza.
 */
function parseGeoJsonResponse(v: unknown): GdeltFeature[] | null {
  if (!isObject(v)) return null;
  if (v["type"] !== "FeatureCollection") return null;
  const features = v["features"];
  if (!Array.isArray(features)) return null;
  // Filtra features invalidas en lugar de abortar todo el payload
  return features.filter(isGdeltFeature);
}

// --- Result type matching connector contract ---

export interface ConnectorResult<T> {
  data: T[];
  stale: boolean;
  fetchedAt: number;
}

// --- Single-flight + serve-stale ---

let inFlight: Promise<ConnectorResult<GdeltEvent>> | null = null;
let lastGood: { data: GdeltEvent[]; ts: number } | null = null;
const STALE_TTL_MS = 60 * 60 * 1000; // 1h

// --- Mapping helpers ---

function deriveEventId(name: string | undefined, lon: number, lat: number): string {
  const safeName = (name ?? "unknown").replace(/\s+/g, "_").toLowerCase();
  return `gdelt_${safeName}_${lon.toFixed(4)}_${lat.toFixed(4)}`;
}

function deriveCategory(_name: string | undefined): string | null {
  // GDELT GEO API queries economics/market terms — default category
  return "economic";
}

function mapFeatureToEvent(feature: GdeltFeature, now: number): GdeltEvent {
  const lon = feature.geometry.coordinates[0];
  const lat = feature.geometry.coordinates[1]; // GDELT: [lon, lat]
  const name = typeof feature.properties["name"] === "string"
    ? feature.properties["name"]
    : undefined;
  const rawCount = feature.properties["count"];
  const count = toFiniteNumber(rawCount);

  return {
    source: "gdelt",
    event_id: deriveEventId(name, lon, lat),
    category: deriveCategory(name),
    severity: count !== null ? count : 0,
    lat,
    lon,
    captured_at: now,
  };
}

// --- Core fetch (exported for testing) ---

export async function fetchGdelt(): Promise<ConnectorResult<GdeltEvent>> {
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
    const res = await fetch(GEO_API_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Fallback nivel 1: status no-OK
    if (!res.ok) {
      console.error(`[gdelt] upstream HTTP ${res.status} ${res.statusText}`);
      return serveStaleOrEmpty(now);
    }

    const json: unknown = await res.json();

    // parse-don't-validate: shape inesperado -> vacio gracioso
    const features = parseGeoJsonResponse(json);
    if (features === null) {
      console.error("[gdelt] schema mismatch: response is not a valid FeatureCollection");
      return serveStaleOrEmpty(now);
    }

    const data: GdeltEvent[] = features.map((f) => mapFeatureToEvent(f, now));

    lastGood = { data, ts: now };
    return { data, stale: false, fetchedAt: now };
  } catch (err) {
    // Fallback nivel 2: timeout / red / abort
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
