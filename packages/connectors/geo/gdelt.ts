// packages/connectors/geo/gdelt.ts
//
// Source: GDELT 2.0 Event Database (raw Events CSV)
// ToS: https://www.gdeltproject.org/about.html
//   "The GDELT Project is an open platform for research and analysis of global society
//    and thus all datasets released by the GDELT Project are available for unlimited
//    and unrestricted use for any academic, commercial, or governmental purpose."
//   Atribución requerida: "Source: The GDELT Project (gdeltproject.org)"
//   Uso programático permitido; rate limit implícito: archivos se actualizan c/15min.
//   Cadencia del scheduler: 1 req/15min — OK.
// License: Open / public domain (con citación requerida).
// Key: zero-key (no API key required).
//
// GDELT 2.0 Event Database — raw Events CSV (conflicto/político, coords reales del suceso).
// Flujo:
//   1. Poll lastupdate.txt → URL del último export.CSV.zip.
//   2. Descarga el .zip → extrae con zlib.inflateRawSync (PKZIP local-file-header).
//   3. Parsea CSV TAB-separated 61 columnas sin header → filtra conflicto/protesta.
//   4. Mapea a EventRow con coords ActionGeo (coords del SUCESO, no centroide-país).
//
// C-4 ZIP zero-dep: parse manual del local-file-header (offsets PKZIP codebook).
// Si el método de compresión no es deflate (8) → PARA y devuelve vacío gracioso
// (nunca lanza; el PM evalúa dep fflate MIT si se confirma el problema).
//
// Patrón osiris: single-flight + serve-stale + fallback multinivel.
// NUNCA lanza hacia arriba. country-centroids.ts NO se usa aquí (GDELT da coords reales).
//
// Devuelve datos normalizados o resultado vacío gracioso. NUNCA lanza hacia arriba.

import { inflateRawSync } from "node:zlib";
import type { EventRow } from "@www/store";
import { severityGdelt } from "./severity.js";

// ─── Endpoints ───────────────────────────────────────────────────────────────

const LASTUPDATE_URL = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const USER_AGENT = "world-wide-project/1.0 (+fernandopradagorge@gmail.com)";
const TIMEOUT_MS = 8000;
const STALE_TTL_MS = 60 * 60 * 1000; // 1h

// ─── Índices de columnas CSV (GDELT 2.0 Event Codebook) ──────────────────────
// TAB-separated, 61 columnas, SIN header, por ÍNDICE FIJO.
// Ref: https://www.gdeltproject.org/data/documentation/GDELT-Event_Codebook-V2.0.pdf

const COL_GLOBALEVENTID = 0;
const COL_SQLDATE = 1;
const COL_ACTOR1NAME = 6;
// Actor2Name está en índice 16 — se incluye en raw_json
const COL_ACTOR2NAME = 16;
const COL_EVENTCODE = 26;
const COL_QUADCLASS = 29;
const COL_GOLDSTEIN = 30;
const COL_AVGTONE = 34;
const COL_ACTIONGEO_FULLNAME = 52;
const COL_ACTIONGEO_COUNTRYCODE = 53;
const COL_ACTIONGEO_LAT = 56;
const COL_ACTIONGEO_LONG = 57;
const COL_SOURCEURL = 60;

const EXPECTED_COLUMNS = 61; // R-3: cada fila DEBE tener exactamente 61 columnas

// ─── Tipo ConnectorResult (local, igual al de usgs.ts) ───────────────────────

export interface ConnectorResult<T> {
  data: T[];
  stale: boolean;
  fetchedAt: number;
}

// ─── Single-flight + serve-stale ─────────────────────────────────────────────

let inFlight: Promise<ConnectorResult<EventRow>> | null = null;
let lastGood: { data: EventRow[]; ts: number } | null = null;

// Cache de ETag para lastupdate.txt (evita re-fetches si no cambió)
let lastEtag: string | null = null;

// ─── Type guards manuales — parse-don't-validate en el borde ─────────────────

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  const n = Number(v);
  return isFinite(n) && v !== "" && v !== null && v !== undefined ? n : null;
}

// ─── Parseo de lastupdate.txt ─────────────────────────────────────────────────
//
// Formato de cada línea: "<size> <md5> <url>"
// Ejemplo:
//   123456789 abc123def456 http://data.gdeltproject.org/gdeltv2/20240614120000.export.CSV.zip
//   789012345 def789ghi012 http://data.gdeltproject.org/gdeltv2/20240614120000.mentions.CSV.zip
//   ...
// Buscamos la línea cuya URL termina en "export.CSV.zip".

export function parseLastupdateTxt(text: string): string | null {
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3) {
      const url = parts[parts.length - 1]!;
      if (url.endsWith("export.CSV.zip")) {
        return url;
      }
    }
  }
  return null;
}

// ─── Extracción ZIP zero-dep (C-4) ───────────────────────────────────────────
//
// PKZIP local-file-header layout (offsets en el buffer):
//   Offset 0:  4 bytes — firma "PK\x03\x04"
//   Offset 8:  2 bytes uint16 LE — método de compresión (8 = deflate)
//   Offset 18: 4 bytes uint32 LE — compressed size
//   Offset 26: 2 bytes uint16 LE — filename length
//   Offset 28: 2 bytes uint16 LE — extra field length
//   Offset 30: <filename_len> bytes — filename
//   Offset 30 + filename_len: <extra_len> bytes — extra field
//   Offset 30 + filename_len + extra_len: <compressed_size> bytes — datos comprimidos
//
// Validamos firma y método antes de inflar. Si algo no cuadra → null (BLOCKED gracioso).

export function extractZipFirstEntry(buf: Buffer): Buffer | null {
  // Necesitamos al menos 30 bytes para el header fijo
  if (buf.length < 30) {
    console.error("[gdelt] ZIP demasiado pequeño para tener local-file-header");
    return null;
  }

  // Validar firma PK\x03\x04
  if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    console.error("[gdelt] ZIP: firma inválida — no es PKZIP local-file-header");
    return null;
  }

  // Método de compresión @offset 8, uint16 LE
  const method = buf.readUInt16LE(8);
  if (method !== 8) {
    // método 0 = almacenado (sin compresión), también manejable
    if (method === 0) {
      // Stored: los datos van directos, compressed_size == uncompressed_size
      const compressedSize = buf.readUInt32LE(18);
      const filenameLen = buf.readUInt16LE(26);
      const extraLen = buf.readUInt16LE(28);
      const dataOffset = 30 + filenameLen + extraLen;
      if (dataOffset + compressedSize > buf.length) {
        console.error("[gdelt] ZIP stored: buffer insuficiente para los datos");
        return null;
      }
      return buf.subarray(dataOffset, dataOffset + compressedSize);
    }
    // Método desconocido → ESCOTILLA (C-4): reportar y devolver null
    console.error(
      `[gdelt] ZIP: método de compresión desconocido ${method} (esperado 8=deflate o 0=stored). ` +
        "BLOCKED: dep fflate MIT requiere ADR del PM — no se añade automáticamente."
    );
    return null;
  }

  // Método 8 = deflate
  const compressedSize = buf.readUInt32LE(18);
  const filenameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const dataOffset = 30 + filenameLen + extraLen;

  if (dataOffset + compressedSize > buf.length) {
    console.error("[gdelt] ZIP: buffer insuficiente para los datos comprimidos");
    return null;
  }

  const compressedData = buf.subarray(dataOffset, dataOffset + compressedSize);

  try {
    return inflateRawSync(compressedData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[gdelt] inflateRawSync falló: ${msg}`);
    return null;
  }
}

// ─── Parseo CSV TAB-separated ─────────────────────────────────────────────────
//
// D-102: taxonomía de event_type:
//   - EventCode CAMEO empieza por '14' (protestas) → 'protest'
//     (p.ej. 140=Protest, 141=Demonstrate, 145=Hunger strike, etc.)
//   - QuadClass 3 (verbal-conflict) o 4 (material-conflict) → 'conflict'
//   - QuadClass 1 (verbal-coop) o 2 (material-coop) → 'conflict' de baja severity
//     (no se descartan; la baja severity los filtra si el caller usa minSeverity).
//     Justificación: preservamos todos los eventos geo-referenciados para que el
//     scheduler decida qué persiste vía minSeverity. El descarte aquí sería
//     irreversible y eliminaría señal útil para el motor CII posterior.

export function parseGdeltCsvRows(csvText: string, capturedAt: number): EventRow[] {
  const rows: EventRow[] = [];
  const lines = csvText.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const cols = line.split("\t");

    // R-3: valida exactamente 61 columnas; descarta+loggea las que no cuadren
    if (cols.length !== EXPECTED_COLUMNS) {
      console.warn(
        `[gdelt] fila descartada: ${cols.length} columnas (esperadas ${EXPECTED_COLUMNS}). ` +
          `Inicio: "${line.slice(0, 80)}"`
      );
      continue;
    }

    const globalEventId = toStringOrNull(cols[COL_GLOBALEVENTID] ?? null);
    const sqlDate = toStringOrNull(cols[COL_SQLDATE] ?? null);
    const actor1Name = toStringOrNull(cols[COL_ACTOR1NAME] ?? null);
    const actor2Name = toStringOrNull(cols[COL_ACTOR2NAME] ?? null);
    const eventCode = toStringOrNull(cols[COL_EVENTCODE] ?? null);
    const quadClassRaw = toNumberOrNull(cols[COL_QUADCLASS] ?? null);
    const goldsteinRaw = toNumberOrNull(cols[COL_GOLDSTEIN] ?? null);
    const avgToneRaw = toNumberOrNull(cols[COL_AVGTONE] ?? null);
    const actionGeoFullName = toStringOrNull(cols[COL_ACTIONGEO_FULLNAME] ?? null);
    const actionGeoCountryCode = toStringOrNull(cols[COL_ACTIONGEO_COUNTRYCODE] ?? null);
    const actionGeoLat = toNumberOrNull(cols[COL_ACTIONGEO_LAT] ?? null);
    const actionGeoLon = toNumberOrNull(cols[COL_ACTIONGEO_LONG] ?? null);
    const sourceUrl = toStringOrNull(cols[COL_SOURCEURL] ?? null);

    // Filtrar filas sin ActionGeo_Lat/Long (no podemos geo-pintar el evento)
    if (actionGeoLat === null || actionGeoLon === null) continue;

    if (!globalEventId) continue;

    // D-102: event_type por EventCode CAMEO + QuadClass
    const quadClass = quadClassRaw ?? 0;
    let eventType: string;
    if (eventCode && eventCode.startsWith("14")) {
      eventType = "protest";
    } else if (quadClass === 3 || quadClass === 4) {
      eventType = "conflict";
    } else {
      // QuadClass 1/2 (cooperación): marcamos como 'conflict' de baja severity
      // (el motivo está documentado arriba en el bloque D-102)
      eventType = "conflict";
    }

    // SQLDATE formato YYYYMMDD → epoch ms (medianoche UTC)
    let occurredAt: number | null = null;
    if (sqlDate && sqlDate.length === 8) {
      const year = parseInt(sqlDate.slice(0, 4), 10);
      const month = parseInt(sqlDate.slice(4, 6), 10) - 1; // 0-based
      const day = parseInt(sqlDate.slice(6, 8), 10);
      const parsed = Date.UTC(year, month, day);
      if (isFinite(parsed)) occurredAt = parsed;
    }

    // severity: severityGdelt (funciones puras, clampeadas a [0,100])
    const severity = severityGdelt({
      quadClass,
      goldstein: goldsteinRaw ?? undefined,
      avgTone: avgToneRaw ?? undefined,
    });

    // title legible: "<Actor1> <EventCode>"
    const titleParts: string[] = [];
    if (actor1Name) titleParts.push(actor1Name);
    if (eventCode) titleParts.push(eventCode);
    const title = titleParts.length > 0 ? titleParts.join(" ") : null;

    // raw_json: conserva métrica nativa para recalibración (D-103)
    const rawJson = JSON.stringify({
      eventCode,
      quadClass,
      goldstein: goldsteinRaw,
      avgTone: avgToneRaw,
      actor1: actor1Name,
      actor2: actor2Name,
      actionGeoFullName,
    });

    const row: EventRow = {
      source: "gdelt",
      sourceEventId: globalEventId,
      eventType,
      category: "conflict",
      severity,
      lat: actionGeoLat,
      lon: actionGeoLon,
      country: actionGeoCountryCode,
      title,
      url: sourceUrl,
      occurredAt,
      capturedAt,
      rawJson,
    };

    rows.push(row);
  }

  return rows;
}

// ─── Core fetch (exported for testing) ───────────────────────────────────────

export async function fetchGdelt(): Promise<ConnectorResult<EventRow>> {
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
    // ── Paso 1: Poll lastupdate.txt con ETag/If-None-Match ───────────────────
    const lastupdateHeaders: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "text/plain",
    };
    if (lastEtag) {
      lastupdateHeaders["If-None-Match"] = lastEtag;
    }

    const lastupdateRes = await fetch(LASTUPDATE_URL, {
      headers: lastupdateHeaders,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // 304 Not Modified → el archivo zip no ha cambiado, servir stale
    if (lastupdateRes.status === 304) {
      console.info("[gdelt] lastupdate.txt: 304 Not Modified — sirviendo stale");
      return serveStaleOrEmpty(now);
    }

    if (!lastupdateRes.ok) {
      console.error(
        `[gdelt] lastupdate.txt HTTP ${lastupdateRes.status} ${lastupdateRes.statusText}`
      );
      return serveStaleOrEmpty(now);
    }

    // Guarda ETag para la próxima petición
    const newEtag = lastupdateRes.headers.get("ETag");
    if (newEtag) lastEtag = newEtag;

    const lastupdateText = await lastupdateRes.text();
    const zipUrl = parseLastupdateTxt(lastupdateText);

    if (!zipUrl) {
      console.error("[gdelt] no se encontró URL de export.CSV.zip en lastupdate.txt");
      return serveStaleOrEmpty(now);
    }

    // ── Paso 2: Descarga el .zip ──────────────────────────────────────────────
    const zipRes = await fetch(zipUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!zipRes.ok) {
      console.error(`[gdelt] export ZIP HTTP ${zipRes.status} ${zipRes.statusText}`);
      return serveStaleOrEmpty(now);
    }

    const zipArrayBuffer = await zipRes.arrayBuffer();
    const zipBuffer = Buffer.from(zipArrayBuffer);

    // ── Paso 3: Extracción ZIP zero-dep (C-4) ────────────────────────────────
    const csvBuffer = extractZipFirstEntry(zipBuffer);
    if (!csvBuffer) {
      // extractZipFirstEntry ya loggeó el error específico
      // ESCOTILLA: si el método ZIP no es soportado, devolvemos stale/vacío
      // El PM evalúa dep fflate MIT si se confirma el problema (R-3-zip)
      return serveStaleOrEmpty(now);
    }

    const csvText = csvBuffer.toString("utf-8");

    // ── Paso 4: Parseo CSV → EventRow[] ─────────────────────────────────────
    const data = parseGdeltCsvRows(csvText, now);

    lastGood = { data, ts: now };
    return { data, stale: false, fetchedAt: now };
  } catch (err) {
    // Fallback nivel 2: timeout / red / abort → vacío gracioso
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[gdelt] fetch failed: ${message}`);
    return serveStaleOrEmpty(now);
  }
}

function serveStaleOrEmpty(now: number): ConnectorResult<EventRow> {
  if (lastGood && now - lastGood.ts < STALE_TTL_MS) {
    console.info(`[gdelt] sirviendo stale data (age: ${now - lastGood.ts}ms)`);
    return { data: lastGood.data, stale: true, fetchedAt: lastGood.ts };
  }
  return { data: [], stale: false, fetchedAt: now };
}
