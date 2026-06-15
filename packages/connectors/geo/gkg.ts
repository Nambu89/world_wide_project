// packages/connectors/geo/gkg.ts
//
// Source: GDELT 2.0 Global Knowledge Graph (GKG v2)
// ToS: https://www.gdeltproject.org/about.html
//   "The GDELT Project is an open platform for research and analysis of global society
//    and thus all datasets released by the GDELT Project are available for unlimited
//    and unrestricted use for any academic, commercial, or governmental purpose."
//   Atribución requerida: "Source: The GDELT Project (gdeltproject.org)"
//   Uso programático permitido; cadencia natural: 1 archivo nuevo cada 15 min.
//   Rate limit implícito: 1 req/15min con ETag — OK.
// License: Open / public domain (con citación requerida).
// Key: zero-key (no API key required).
//
// Conector keyless GKG — backbone del Radar Geoeconómico Temático (T-17, ADR-011).
// Flujo:
//   1. GET lastupdate.txt con If-None-Match (ETag); 304 → serve-stale.
//   2. parseLastupdateGkg(text) → URL de la línea que termina en '.gkg.csv.zip'.
//   3. GET el zip; REUSA extractZipFirstEntry (zip.ts, mismo PKZIP-deflate verificado en vivo).
//   4. parseGkgCsvRows(csv, capturedAt) → SignalRow[] (27 cols TAB, subdelimitadores ;/#/,).
//
// Layout CSV verificado EN VIVO 2026-06-14:
//   27 columnas TAB-separated, SIN cabecera, subdelimitadores ; # ,
//   col1(0): GKGRECORDID — clave de dedup {sig.id}
//   col2(1): DATE YYYYMMDDHHMMSS → occurredAt epoch ms
//   col5(4): DocumentIdentifier = SOURCEURL
//   col8(7): V1Themes — ';'-sep
//   col10(9): V2Locations — entradas 'tipo#nombre#cc#adm1#lat#lon#featureid' sep ';'
//   col12(11): V2Persons — ';'-sep
//   col13(12): V2Organizations — ';'-sep
//   col16(15): V2Tone — coma-sep: AvgTone,PosTone,NegTone,Polarity,ActivityDensity,SelfDens,WordCount
//   col27(26): V2ExtrasXML — título via match simple <PAGE_TITLE>...</PAGE_TITLE> (D-201)
//
// Patrón osiris: single-flight + serve-stale + fallback multinivel + retorno vacío gracioso.
// NUNCA lanza hacia arriba. Sin zod (project-connectors-no-zod memory).
// Importa Section + SignalRow de @www/store (L-1: camelCase).

import type { SignalRow, Section } from "@www/store";
import { extractZipFirstEntry } from "./zip.js";
import { classify } from "./sections.config.js";

// ─── Endpoints ───────────────────────────────────────────────────────────────

const LASTUPDATE_URL = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const USER_AGENT = "world-wide-project/1.0 (+fernandopradagorge@gmail.com)";
const TIMEOUT_MS = 8000;
const STALE_TTL_MS = 60 * 60 * 1000; // 1h

// ─── Índices de columnas CSV GKG v2 (0-indexed) ──────────────────────────────
// 27 columnas TAB-separated, SIN cabecera, por ÍNDICE FIJO.
// Ref: https://www.gdeltproject.org/data/documentation/GDELT-Event_Codebook-V2.0.pdf
// Verificado EN VIVO 2026-06-14.

const COL_GKGRECORDID    = 0;   // col1: GKGRECORDID (clave de dedup)
const COL_DATE           = 1;   // col2: DATE YYYYMMDDHHMMSS → occurredAt
// col3(2) = SourceCollectionIdentifier, col4(3) = SourceCommonName
const COL_SOURCEURL      = 4;   // col5: DocumentIdentifier = SOURCEURL
// col6(5) = V1Counts, col7(6) = V2Counts
const COL_V1THEMES       = 7;   // col8: V1Themes, ';'-sep
// col9(8) = V2EnhancedThemes
const COL_V2LOCATIONS    = 9;   // col10: V2Locations, entradas sep ';', campos sep '#'
// col11(10) = V2EnhancedLocations
const COL_V2PERSONS      = 11;  // col12: V2Persons, ';'-sep
const COL_V2ORGANIZATIONS = 12; // col13: V2Organizations, ';'-sep
// col14(13) = V2EnhancedOrganizations, col15(14) = V1Counts (alt)
const COL_V2TONE         = 15;  // col16: V2Tone, coma-sep: AvgTone,Pos,Neg,...
// col17(16) = V2EnhancedDates, col18(17) = V2GCAM
// col19(18) = V2SharingImage, col20(19) = V2RelatedImages
// col21(20) = V2SocialImageEmbeds, col22(21) = V2SocialVideoEmbeds
// col23(22) = V2Quotations, col24(23) = V2AllNames
// col25(24) = V2Amounts, col26(25) = V2TranslationInfo
const COL_V2EXTRASXML    = 26;  // col27: V2ExtrasXML (contiene PAGE_TITLE)

const EXPECTED_COLUMNS = 27; // D-201: cada fila DEBE tener exactamente 27 columnas

// ─── Tipo ConnectorResult (compatible con gdelt.ts y usgs.ts) ─────────────────

export interface ConnectorResult<T> {
  data: T[];
  stale: boolean;
  fetchedAt: number;
}

// ─── Single-flight + serve-stale ─────────────────────────────────────────────

let inFlight: Promise<ConnectorResult<SignalRow>> | null = null;
let lastGood: { data: SignalRow[]; ts: number } | null = null;

// Cache de ETag para lastupdate.txt (evita re-fetches si no cambió)
let lastEtag: string | null = null;

// ─── Helpers de parseo ───────────────────────────────────────────────────────

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v !== "string" || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// ─── parseLastupdateGkg ───────────────────────────────────────────────────────
//
// lastupdate.txt formato: "<size> <md5> <url>" por línea.
// Buscamos la línea cuya URL termina en ".gkg.csv.zip" (R-8).

export function parseLastupdateGkg(text: string): string | null {
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3) {
      const url = parts[parts.length - 1]!;
      if (url.endsWith(".gkg.csv.zip")) {
        return url;
      }
    }
  }
  return null;
}

// ─── parseGkgLocation — extrae lat/lon best-effort de V2Locations ─────────────
//
// Formato de cada entrada: "tipo#nombre#cc#adm1#lat#lon#featureid"
// tipo 3/4 = coords de ciudad reales (preferidos); 1/2 = centroide de país/región.
// Devuelve { lat, lon, country } del primer tipo 3/4 encontrado; sino null/null.

function parseGkgLocation(locationsRaw: string): {
  lat: number | null;
  lon: number | null;
  country: string | null;
} {
  if (!locationsRaw) return { lat: null, lon: null, country: null };

  const entries = locationsRaw.split(";").filter((s) => s.length > 0);

  // Primera pasada: preferir tipo 3 o 4 (coords de ciudad reales)
  for (const entry of entries) {
    const fields = entry.split("#");
    if (fields.length < 7) continue;
    const type = parseInt(fields[0] ?? "", 10);
    if (type === 3 || type === 4) {
      const lat = toNumberOrNull(fields[4] ?? null);
      const lon = toNumberOrNull(fields[5] ?? null);
      const country = toStringOrNull(fields[2] ?? null);
      if (lat !== null && lon !== null) {
        return { lat, lon, country };
      }
    }
  }

  // Segunda pasada: cualquier tipo con lat/lon válido
  for (const entry of entries) {
    const fields = entry.split("#");
    if (fields.length < 7) continue;
    const lat = toNumberOrNull(fields[4] ?? null);
    const lon = toNumberOrNull(fields[5] ?? null);
    const country = toStringOrNull(fields[2] ?? null);
    if (lat !== null && lon !== null) {
      return { lat, lon, country };
    }
  }

  return { lat: null, lon: null, country: null };
}

// ─── parsePageTitle — extrae PAGE_TITLE de V2ExtrasXML (D-201) ───────────────
//
// Match simple de etiqueta <PAGE_TITLE>...</PAGE_TITLE> (sin XML parser pesado).
// Devuelve null si no encontrado.

function parsePageTitle(extrasXml: string): string | null {
  if (!extrasXml) return null;
  const match = extrasXml.match(/<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/);
  return match ? (match[1]?.trim() ?? null) : null;
}

// ─── parseDate YYYYMMDDHHMMSS → epoch ms ─────────────────────────────────────

function parseDateToEpoch(dateStr: string): number | null {
  if (dateStr.length !== 14) return null;
  const year  = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10) - 1; // 0-based
  const day   = parseInt(dateStr.slice(6, 8), 10);
  const hour  = parseInt(dateStr.slice(8, 10), 10);
  const min   = parseInt(dateStr.slice(10, 12), 10);
  const sec   = parseInt(dateStr.slice(12, 14), 10);
  const ts = Date.UTC(year, month, day, hour, min, sec);
  return isFinite(ts) ? ts : null;
}

// ─── parseGkgCsvRows ─────────────────────────────────────────────────────────
//
// Parsea el CSV GKG (27 cols TAB) en SignalRow[].
// - Valida exactamente 27 columnas por fila; descarta+loggea las que no cuadren (D-201).
// - Llama classify() para asignar secciones; descarta artículos con 0 secciones (D-203).
// - Devuelve array vacío si csvText está vacío o todas las filas son descartadas.
//
// @param csvText   - Texto CSV descomprimido del .gkg.csv.zip
// @param capturedAt - epoch ms del momento de captura del snapshot

export function parseGkgCsvRows(csvText: string, capturedAt: number): SignalRow[] {
  const rows: SignalRow[] = [];
  const lines = csvText.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const cols = line.split("\t");

    // D-201: valida exactamente 27 columnas; descarta+loggea las que no cuadren
    if (cols.length !== EXPECTED_COLUMNS) {
      console.warn(
        `[gkg] fila descartada: ${cols.length} columnas (esperadas ${EXPECTED_COLUMNS}). ` +
          `GKGRECORDID inicio: "${line.slice(0, 40)}"`
      );
      continue;
    }

    const gkgRecordId = toStringOrNull(cols[COL_GKGRECORDID] ?? null);
    if (!gkgRecordId) continue; // sin ID no hay dedup posible

    // occurred_at: DATE col2 YYYYMMDDHHMMSS → epoch ms
    const dateStr = cols[COL_DATE] ?? "";
    const occurredAt = parseDateToEpoch(dateStr);

    // url: SOURCEURL col5
    const url = toStringOrNull(cols[COL_SOURCEURL] ?? null);

    // V1Themes col8: ';'-sep → array de theme-codes
    const themesRaw = cols[COL_V1THEMES] ?? "";
    const themes = themesRaw.length > 0
      ? themesRaw.split(";").map((t) => t.trim()).filter((t) => t.length > 0)
      : [];

    // V2Locations col10: geo best-effort (tipo 3/4 preferido)
    const locationsRaw = cols[COL_V2LOCATIONS] ?? "";
    const { lat, lon, country } = parseGkgLocation(locationsRaw);

    // V2Persons col12: ';'-sep
    const personsRaw = cols[COL_V2PERSONS] ?? "";
    const persons = personsRaw.length > 0
      ? personsRaw.split(";").map((p) => p.trim()).filter((p) => p.length > 0)
      : [];

    // V2Organizations col13: ';'-sep
    const orgsRaw = cols[COL_V2ORGANIZATIONS] ?? "";
    const organizations = orgsRaw.length > 0
      ? orgsRaw.split(";").map((o) => o.trim()).filter((o) => o.length > 0)
      : [];

    // V2Tone col16: coma-sep → tone = AvgTone (1er valor)
    const toneRaw = cols[COL_V2TONE] ?? "";
    let tone: number | null = null;
    const toneParts = toneRaw.split(",");
    if (toneParts.length > 0) {
      tone = toNumberOrNull(toneParts[0] ?? null);
    }

    // V2ExtrasXML col27: título via PAGE_TITLE match simple (D-201)
    const extrasXml = cols[COL_V2EXTRASXML] ?? "";
    const title = parsePageTitle(extrasXml);

    // Clasificador: assign 0..N secciones; descartar artículos con 0 (D-203)
    const sectionMatches = classify({ themes, title, organizations, persons });
    if (sectionMatches.length === 0) {
      // Artículo sin sección → descartado silenciosamente (no es error, es filtro)
      continue;
    }

    // raw_json: V2Tone completo + matchedBy para auditoría (D-203)
    const rawJson = JSON.stringify({
      v2Tone: toneRaw,
      matchedBy: sectionMatches.map((m) => ({
        section: m.section,
        matchedBy: m.matchedBy,
      })),
    });

    const sections: Array<{ section: Section; matchedBy: "theme" | "keyword" | "entity" }> =
      sectionMatches.map((m) => ({
        section: m.section as Section,
        matchedBy: m.matchedBy,
      }));

    const row: SignalRow = {
      source: "gkg",
      signalId: gkgRecordId,
      title,
      url,
      tone,
      themes: themesRaw.length > 0 ? themesRaw : null,
      persons: personsRaw.length > 0 ? personsRaw : null,
      organizations: orgsRaw.length > 0 ? orgsRaw : null,
      lat,
      lon,
      country,
      occurredAt,
      capturedAt,
      rawJson,
      sections,
    };

    rows.push(row);
  }

  return rows;
}

// ─── Core fetch ──────────────────────────────────────────────────────────────

export async function fetchGkg(): Promise<ConnectorResult<SignalRow>> {
  // Single-flight: una sola petición concurrente en vuelo a la vez
  if (inFlight) return inFlight;

  inFlight = _doFetch().then((result) => {
    inFlight = null;
    return result;
  });

  return inFlight;
}

async function _doFetch(): Promise<ConnectorResult<SignalRow>> {
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
      console.info("[gkg] lastupdate.txt: 304 Not Modified — sirviendo stale");
      return serveStaleOrEmpty(now);
    }

    if (!lastupdateRes.ok) {
      console.error(
        `[gkg] lastupdate.txt HTTP ${lastupdateRes.status} ${lastupdateRes.statusText}`
      );
      return serveStaleOrEmpty(now);
    }

    // Guarda ETag para la próxima petición
    const newEtag = lastupdateRes.headers.get("ETag");
    if (newEtag) lastEtag = newEtag;

    const lastupdateText = await lastupdateRes.text();
    const zipUrl = parseLastupdateGkg(lastupdateText);

    if (!zipUrl) {
      console.error("[gkg] no se encontró URL de .gkg.csv.zip en lastupdate.txt");
      return serveStaleOrEmpty(now);
    }

    // ── Paso 2: Descarga el .zip ──────────────────────────────────────────────
    const zipRes = await fetch(zipUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!zipRes.ok) {
      console.error(`[gkg] GKG ZIP HTTP ${zipRes.status} ${zipRes.statusText}`);
      return serveStaleOrEmpty(now);
    }

    const zipArrayBuffer = await zipRes.arrayBuffer();
    const zipBuffer = Buffer.from(zipArrayBuffer);

    // ── Paso 3: Extracción ZIP — REUSA extractZipFirstEntry (zip.ts) ─────────
    const csvBuffer = extractZipFirstEntry(zipBuffer);
    if (!csvBuffer) {
      // extractZipFirstEntry ya loggeó el error específico
      return serveStaleOrEmpty(now);
    }

    const csvText = csvBuffer.toString("utf-8");

    // ── Paso 4: Parseo GKG CSV → SignalRow[] ────────────────────────────────
    const data = parseGkgCsvRows(csvText, now);

    lastGood = { data, ts: now };
    return { data, stale: false, fetchedAt: now };
  } catch (err) {
    // Fallback nivel 2: timeout / red / abort → vacío gracioso
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[gkg] fetch failed: ${message}`);
    return serveStaleOrEmpty(now);
  }
}

function serveStaleOrEmpty(now: number): ConnectorResult<SignalRow> {
  if (lastGood && now - lastGood.ts < STALE_TTL_MS) {
    console.info(`[gkg] sirviendo stale data (age: ${now - lastGood.ts}ms)`);
    return { data: lastGood.data, stale: true, fetchedAt: lastGood.ts };
  }
  return { data: [], stale: false, fetchedAt: now };
}
