// packages/connectors/geo/eonet.ts
//
// Fuente: NASA EONET v3 API  |  ToS: https://eonet.gsfc.nasa.gov/docs/v3
// Dominio público según 17 U.S.C. §105 (obras del Gobierno Federal de EE.UU.).
// Uso programático permitido sin clave; sin límite de tasa documentado — cadencia
// scheduler medium (~15 min) + limit<=20 (R-4: con limit=50 se observaron 503 transitorios).
// Key: zero-key (no API key required).
//
// Atribución requerida en UI: "Data: NASA EONET"
// Disclaimer: "for visualization only"
//
// Devuelve datos normalizados o resultado vacío gracioso. NUNCA lanza hacia arriba.

import type { EventRow } from "@www/store";
import { severityEonet } from "./severity.js";
import { COUNTRY_CENTROIDS } from "./country-centroids.js";

// ─── Constantes ───────────────────────────────────────────────────────────────

const EONET_URL =
  "https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=20";

const USER_AGENT = "world-wide-project/1.0 (+fernandopradagorge@gmail.com)";
const TIMEOUT_MS = 8000;
const STALE_TTL_MS = 60 * 60 * 1000; // 1 hora

// ─── Mapeo de categories[].id → event_type (D-102) ───────────────────────────
//
// Solo se incluyen las categorías que queremos persistir.
// "earthquakes" se DESCARTA: USGS es la fuente sísmica canónica (D-102 / T-10b).

const CATEGORY_MAP: Record<string, string> = {
  wildfires: "wildfire",
  volcanoes: "volcano",
  severeStorms: "storm",
  floods: "flood",
  landslides: "landslide",
  drought: "drought",
  tempExtremes: "tempExtreme",
};

// Categorías explícitamente descartadas (no se loggean como desconocidas)
const DISCARDED_CATEGORIES = new Set(["earthquakes"]);

// ─── Type guards manuales — parse-don't-validate en el borde ──────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

// Forma de una geometría individual dentro de geometries[]
interface EonetGeometry {
  type: string;
  coordinates: unknown;
  date?: string;
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
}

function isEonetGeometry(v: unknown): v is EonetGeometry {
  return isObject(v) && typeof v["type"] === "string";
}

// Forma de una categoría dentro de categories[]
interface EonetCategory {
  id: string;
  title?: string;
}

function isEonetCategory(v: unknown): v is EonetCategory {
  return isObject(v) && typeof v["id"] === "string";
}

// Forma de un link/source dentro de sources[]
interface EonetSource {
  id?: string;
  url?: string;
}

function isEonetSource(v: unknown): v is EonetSource {
  return isObject(v);
}

// Forma de una Feature EONET en el GeoJSON
interface EonetFeature {
  id: string;
  title?: string;
  categories: EonetCategory[];
  sources?: EonetSource[];
  geometry: {
    type: string;
    geometries?: EonetGeometry[];
    coordinates?: unknown;
    date?: string;
    magnitudeValue?: number | null;
    magnitudeUnit?: string | null;
  };
  closed?: string | null;
}

function isEonetFeature(v: unknown): v is EonetFeature {
  if (!isObject(v)) return false;
  if (typeof v["id"] !== "string") return false;
  if (!Array.isArray(v["categories"])) return false;
  if (!isObject(v["geometry"])) return false;
  return true;
}

// Forma de la respuesta GeoJSON raíz
interface EonetGeoJson {
  type: string;
  features: EonetFeature[];
}

function parseEonetResponse(v: unknown): EonetGeoJson | null {
  if (!isObject(v)) return null;
  if (!Array.isArray(v["features"])) return null;
  return {
    type: typeof v["type"] === "string" ? v["type"] : "FeatureCollection",
    features: (v["features"] as unknown[]).filter(isEonetFeature),
  };
}

// ─── Nearest-centroid (R-8 / NG-7) ───────────────────────────────────────────
//
// Aproximación: distancia euclidiana en grados (suficiente para asignación de país).
// Si el nearest está a más de 20° (~2200 km) se devuelve null (R-8).

const MAX_CENTROID_DIST_DEG = 20;

function nearestCountry(lat: number, lon: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;

  for (const [country, centroid] of Object.entries(COUNTRY_CENTROIDS)) {
    const dlat = lat - centroid.lat;
    const dlon = lon - centroid.lon;
    const dist = Math.sqrt(dlat * dlat + dlon * dlon);
    if (dist < bestDist) {
      bestDist = dist;
      best = country;
    }
  }

  return bestDist <= MAX_CENTROID_DIST_DEG ? best : null;
}

// ─── Result type (compatible con ConnectorResult exportado por gdelt.ts) ──────

export interface ConnectorResult<T> {
  data: T[];
  stale: boolean;
  fetchedAt: number;
}

// ─── Single-flight + serve-stale ─────────────────────────────────────────────

let inFlight: Promise<ConnectorResult<EventRow>> | null = null;
let lastGood: { data: EventRow[]; ts: number } | null = null;

// ─── Mapping helper ───────────────────────────────────────────────────────────

function mapFeatureToRows(feature: EonetFeature, capturedAt: number): EventRow[] {
  // Determina el event_type desde la primera categoría reconocida
  let eventType: string | null = null;
  for (const cat of feature.categories) {
    if (!isEonetCategory(cat)) continue;
    const catId = cat.id;

    // Descarte explícito: earthquakes (USGS es la fuente sísmica)
    if (DISCARDED_CATEGORIES.has(catId)) {
      return [];
    }

    const mapped = CATEGORY_MAP[catId];
    if (mapped) {
      eventType = mapped;
      break;
    }
  }

  // Categoría desconocida y no descartada → loggear y descartar
  if (eventType === null) {
    const catIds = feature.categories.map((c) => c.id).join(",");
    console.warn(`[eonet] categoría no reconocida para evento ${feature.id}: [${catIds}] — descartado`);
    return [];
  }

  // Extrae las geometrías (GeometryCollection o geometría única)
  const geom = feature.geometry;
  const geometries: EonetGeometry[] = [];

  if (geom.type === "GeometryCollection" && Array.isArray(geom.geometries)) {
    for (const g of geom.geometries) {
      if (isEonetGeometry(g)) geometries.push(g);
    }
  } else if (isEonetGeometry(geom)) {
    // geometría simple (Point directo)
    geometries.push(geom as EonetGeometry);
  }

  if (geometries.length === 0) {
    // Sin geometría utilizable: producimos una fila sin coords
    geometries.push({ type: "Unknown", coordinates: null });
  }

  // Usamos la primera geometría para la fila principal
  // (EONET puede tener varias geometrías = historial de posiciones del evento)
  const g = geometries[0]!;

  // Coordenadas [lon, lat] según GeoJSON
  let lat: number | null = null;
  let lon: number | null = null;
  if (Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    lon = toNumberOrNull(g.coordinates[0]);
    lat = toNumberOrNull(g.coordinates[1]);
  }

  // occurred_at desde la fecha de la geometría (ISO string → epoch ms)
  let occurredAt: number | null = null;
  const dateStr = toStringOrNull(g.date ?? null);
  if (dateStr) {
    const parsed = Date.parse(dateStr);
    if (!isNaN(parsed)) occurredAt = parsed;
  }

  // magnitude
  const magnitudeValue = toNumberOrNull(g.magnitudeValue ?? null) ?? undefined;
  const magnitudeUnit = toStringOrNull(g.magnitudeUnit ?? null) ?? undefined;

  const severity = severityEonet(eventType, magnitudeValue, magnitudeUnit);

  // URL desde sources[]
  let url: string | null = null;
  if (Array.isArray(feature.sources)) {
    for (const s of feature.sources) {
      if (isEonetSource(s) && s.url) {
        url = toStringOrNull(s.url) ?? null;
        break;
      }
    }
  }

  // country por nearest-centroid
  const country =
    lat !== null && lon !== null ? nearestCountry(lat, lon) : null;

  // raw_json
  const rawJson = JSON.stringify({
    categories: feature.categories.map((c) => c.id),
    magnitudeValue: magnitudeValue ?? null,
    magnitudeUnit: magnitudeUnit ?? null,
    closed: feature.closed ?? null,
  });

  const row: EventRow = {
    source: "eonet",
    sourceEventId: feature.id,
    eventType,
    category: "natural",
    severity,
    lat,
    lon,
    country,
    title: toStringOrNull(feature.title ?? null),
    url,
    occurredAt,
    capturedAt,
    rawJson,
  };

  return [row];
}

// ─── Core fetch (exported for testing) ───────────────────────────────────────

export async function fetchEonet(): Promise<ConnectorResult<EventRow>> {
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
    const res = await fetch(EONET_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Fallback nivel 1: HTTP no-OK → vacío gracioso (o stale si hay copia reciente)
    if (!res.ok) {
      console.error(`[eonet] upstream HTTP ${res.status} ${res.statusText}`);
      return serveStaleOrEmpty(now);
    }

    const json: unknown = await res.json();

    // parse-don't-validate: shape inesperado → vacío gracioso
    const parsed = parseEonetResponse(json);
    if (parsed === null) {
      console.error("[eonet] schema mismatch: respuesta no tiene features array");
      return serveStaleOrEmpty(now);
    }

    const data: EventRow[] = [];
    for (const feature of parsed.features) {
      const rows = mapFeatureToRows(feature, now);
      data.push(...rows);
    }

    lastGood = { data, ts: now };
    return { data, stale: false, fetchedAt: now };
  } catch (err) {
    // Fallback nivel 2: timeout / red / abort → vacío gracioso
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[eonet] fetch failed: ${message}`);
    return serveStaleOrEmpty(now);
  }
}

function serveStaleOrEmpty(now: number): ConnectorResult<EventRow> {
  if (lastGood && now - lastGood.ts < STALE_TTL_MS) {
    return { data: lastGood.data, stale: true, fetchedAt: lastGood.ts };
  }
  return { data: [], stale: false, fetchedAt: now };
}

// ─── Exported for testing (reset stale cache) ─────────────────────────────────

export function _resetCache(): void {
  inFlight = null;
  lastGood = null;
}
