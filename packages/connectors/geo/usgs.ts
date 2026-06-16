// packages/connectors/geo/usgs.ts
//
// Source: USGS Earthquake Hazards Program
// ToS: https://www.usgs.gov/information/copyright-and-credits
// Attribution: "U.S. Geological Survey" (required by USGS open-government policy)
// License: U.S. Public Domain (17 U.S.C. §105 — works of the U.S. government)
// API docs: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
// Rate limit: Cache-Control max-age=60 (respect; scheduler runs every ~5min → ok)
// Key: zero-key (no API key required)
//
// Feeds used:
//   - significant_week: M≥4.5 or PAGER yellow/orange/red — impacto
//   - all_day: all magnitudes in the last day — volumen
// Both feeds are de-duped by feature.id before returning.
//
// Devuelve datos normalizados o resultado vacío gracioso. NUNCA lanza hacia arriba.
// Si-Modified-Since vía Last-Modified para evitar re-fetches innecesarios (Cache-Control max-age=60).

import type { EventRow } from "@www/store";
import { severityUsgs } from "./severity.js";
import { COUNTRY_CENTROIDS } from "./country-centroids.js";

// ─── URLs de los feeds ────────────────────────────────────────────────────────

const FEED_SIGNIFICANT_WEEK =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson";
const FEED_ALL_DAY =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

const USER_AGENT = "world-wide-project/1.0 (+fernandopradagorge@gmail.com)";
const TIMEOUT_MS = 8000;

// Threshold de distancia para nearest-centroid (grados, aprox 1000 km).
// Si el país más cercano está a más de esta distancia, devolvemos null.
const MAX_CENTROID_DISTANCE_DEG = 9;

// ─── Tipo ConnectorResult (local, igual que gdelt.ts) ────────────────────────

import type { ConnectorResult } from '../types.js';

// ─── Single-flight + serve-stale ─────────────────────────────────────────────

let inFlight: Promise<ConnectorResult<EventRow>> | null = null;
let lastGood: { data: EventRow[]; ts: number } | null = null;
const STALE_TTL_MS = 10 * 60 * 1000; // 10 min (feeds se actualizan ~5min)

// Cache condicional: Last-Modified por feed URL
const lastModifiedCache: Record<string, string> = {};

// ─── Type guards manuales — parse-don't-validate en el borde ─────────────────
// No confiamos en la forma del payload externo; ningún campo es obligatorio.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  return null;
}

// Estructura esperada de un Feature GeoJSON de USGS.
// Todos los campos son opcionales — la API puede cambiar shape sin avisar.
interface UsgsFeature {
  id?: unknown;
  properties?: {
    place?: unknown;
    time?: unknown;
    mag?: unknown;
    sig?: unknown;
    alert?: unknown;
    tsunami?: unknown;
    url?: unknown;
    status?: unknown;
    mmi?: unknown;
    cdi?: unknown;
  };
  geometry?: {
    coordinates?: unknown;
  };
}

function parseGeoJsonFeatures(raw: unknown): UsgsFeature[] {
  if (!isObject(raw)) return [];
  const features = raw["features"];
  if (!Array.isArray(features)) return [];
  // Acepta cualquier objeto — las propiedades individuales se leen con guards
  return features.filter(isObject) as UsgsFeature[];
}

// ─── Nearest-centroid para country ───────────────────────────────────────────

function nearestCountry(lat: number, lon: number): string | null {
  let bestKey: string | null = null;
  let bestDist = Infinity;

  for (const [key, centroid] of Object.entries(COUNTRY_CENTROIDS)) {
    const dLat = lat - centroid.lat;
    const dLon = lon - centroid.lon;
    // Distancia euclidiana en grados (aproximación suficiente para nearest-country)
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = key;
    }
  }

  // Si el más cercano está demasiado lejos → null (NG-7/R-8)
  if (bestDist > MAX_CENTROID_DISTANCE_DEG) return null;
  return bestKey;
}

// ─── Mapper Feature → EventRow ───────────────────────────────────────────────

function mapFeatureToEventRow(feature: UsgsFeature, capturedAt: number): EventRow | null {
  // source_event_id: feature.id (string estable de USGS, p.ej. "us7000abc1")
  const sourceEventId = toStringOrNull(feature.id);
  if (!sourceEventId) return null; // sin ID no podemos dedup → descartar

  const props = isObject(feature.properties) ? feature.properties : {};
  const geo = isObject(feature.geometry) ? feature.geometry : {};

  // Coordenadas: GeoJSON USGS = [lon, lat, depth]
  const coords = Array.isArray(geo["coordinates"]) ? geo["coordinates"] : [];
  const lon = toNumberOrNull(coords[0]);
  const lat = toNumberOrNull(coords[1]);
  const depth = toNumberOrNull(coords[2]);

  const mag = toNumberOrNull(props["mag"]);
  const sig = toNumberOrNull(props["sig"]);
  const alert = toStringOrNull(props["alert"]);
  const tsunami = toNumberOrNull(props["tsunami"]);
  const place = toStringOrNull(props["place"]);
  const time = toNumberOrNull(props["time"]);
  const url = toStringOrNull(props["url"]);
  const status = toStringOrNull(props["status"]);
  const mmi = toNumberOrNull(props["mmi"]);
  const cdi = toNumberOrNull(props["cdi"]);

  // severity (funciones puras, clampeadas a [0,100])
  const severity = severityUsgs({
    mag: mag ?? undefined,
    sig: sig ?? undefined,
    alert: alert ?? undefined,
    tsunami: tsunami ?? undefined,
  });

  // country: nearest-centroid o null
  const country =
    lat !== null && lon !== null ? nearestCountry(lat, lon) : null;

  // raw_json: campos nativos para recalibración (D-103)
  const rawJson = JSON.stringify({
    alert,
    sig,
    mmi,
    cdi,
    tsunami,
    depth,
    status,
  });

  const row: EventRow = {
    source: "usgs",
    sourceEventId,
    eventType: "earthquake",
    category: "natural",
    severity,
    lat,
    lon,
    country,
    title: place,
    url,
    occurredAt: time,
    capturedAt,
    rawJson,
  };

  return row;
}

// ─── Fetch de un feed individual con If-Modified-Since ───────────────────────

async function fetchFeed(url: string): Promise<UsgsFeature[]> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };

  // Cache condicional: envía If-Modified-Since si tenemos Last-Modified previo
  if (lastModifiedCache[url]) {
    headers["If-Modified-Since"] = lastModifiedCache[url]!;
  }

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // 304 Not Modified → usar caché (el caller maneja esto retornando lastGood)
  if (res.status === 304) {
    console.info(`[usgs] 304 Not Modified for ${url} — using cached data`);
    return []; // señal de "sin cambios"; el caller usa lastGood
  }

  if (!res.ok) {
    console.error(`[usgs] upstream HTTP ${res.status} ${res.statusText} for ${url}`);
    return [];
  }

  // Guarda Last-Modified para la próxima petición
  const lastMod = res.headers.get("Last-Modified");
  if (lastMod) {
    lastModifiedCache[url] = lastMod;
  }

  const raw: unknown = await res.json();
  return parseGeoJsonFeatures(raw);
}

// ─── Core fetch (exported for testing) ───────────────────────────────────────

export async function fetchUsgs(): Promise<ConnectorResult<EventRow>> {
  // Single-flight: una sola petición concurrente en vuelo a la vez
  if (inFlight) return inFlight;

  inFlight = _doFetch().then((result) => {
    inFlight = null;
    return result;
  });

  return inFlight;
}

async function _doFetch(): Promise<ConnectorResult<EventRow>> {
  const now = Date.now();

  try {
    // Fetch en paralelo de los dos feeds
    const [featuresSignificant, featuresAllDay] = await Promise.all([
      fetchFeed(FEED_SIGNIFICANT_WEEK).catch((err) => {
        console.error(`[usgs] significant_week fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        return [] as UsgsFeature[];
      }),
      fetchFeed(FEED_ALL_DAY).catch((err) => {
        console.error(`[usgs] all_day fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        return [] as UsgsFeature[];
      }),
    ]);

    // Si ambos devuelven vacío porque la red está caída, servir stale
    if (featuresSignificant.length === 0 && featuresAllDay.length === 0) {
      // Podría ser 304 o error de red — servir stale si disponible
      return serveStaleOrEmpty(now);
    }

    // Dedup por feature.id (significant_week y all_day solapan eventos)
    const seen = new Set<string>();
    const allFeatures: UsgsFeature[] = [];

    // Primero significant_week (mayor impacto), luego all_day
    for (const f of [...featuresSignificant, ...featuresAllDay]) {
      const id = toStringOrNull(f.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      allFeatures.push(f);
    }

    // Mapear a EventRow (descarta features sin id)
    const data: EventRow[] = allFeatures
      .map((f) => mapFeatureToEventRow(f, now))
      .filter((r): r is EventRow => r !== null);

    lastGood = { data, ts: now };
    return { data, stale: false, fetchedAt: now };
  } catch (err) {
    // Fallback nivel 2: error inesperado → vacío gracioso
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[usgs] unexpected error: ${message}`);
    return serveStaleOrEmpty(now);
  }
}

function serveStaleOrEmpty(now: number): ConnectorResult<EventRow> {
  if (lastGood && now - lastGood.ts < STALE_TTL_MS) {
    console.info(`[usgs] serving stale data (age: ${now - lastGood.ts}ms)`);
    return { data: lastGood.data, stale: true, fetchedAt: lastGood.ts };
  }
  return { data: [], stale: false, fetchedAt: now };
}
