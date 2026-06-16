// packages/connectors/finance/sanctions.ts
//
// Data: OpenSanctions (CC BY-NC 4.0) — https://www.opensanctions.org/licensing/
// ToS: CC BY-NC 4.0, uso personal = OK, atribución requerida. Zero-key (bulk keyless).
// Fuente: https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv
//
// Conector OFAC SDN list → conteo de entidades sancionadas POR PAÍS.
// Patrón osiris (connector-pattern): single-flight + serve-stale + retorno vacío gracioso.
// NUNCA lanza hacia arriba.

import type { SanctionRow } from '@www/store';
import type { ConnectorResult } from '../types.js';

const SOURCE_URL =
  'https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv';
const USER_AGENT = 'world-wide-project/1.0 sanctions (+fernandopradagorge@gmail.com)';
const TIMEOUT_MS = 15_000; // 7 MB — timeout extendido
const STALE_TTL_MS = 25 * 60 * 60 * 1000; // ~25h — sanciones cambian lento

// ─── Canónico de divergencias ISO→nombre del proyecto ─────────────────────────
// Solo las divergencias reales entre Intl.DisplayNames y el conjunto del proyecto.
const CANONICAL_ALIASES: Record<string, string> = {
  'Congo - Kinshasa': 'Congo (Kinshasa)',
  'Congo - Brazzaville': 'Congo (Brazzaville)',
  'Palestine': 'Palestinian Territories',
  'Czechia': 'Czech Republic',
  'Myanmar (Burma)': 'Myanmar',
  'Türkiye': 'Turkey',                 // smoke en vivo: Intl.DisplayNames usa el endónimo
  'Hong Kong SAR China': 'Hong Kong',  // smoke en vivo: alinear con COUNTRY_CENTROIDS/CII
};

// ─── Single-flight + serve-stale ──────────────────────────────────────────────
let inFlight: Promise<ConnectorResult<SanctionRow>> | null = null;
let lastGood: { data: SanctionRow[]; ts: number } | null = null;

// Instancia de Intl.DisplayNames cacheada (stdlib, zero-dep).
// ponytail: Node 12+; upgrade-path = tabla ISO manual si el entorno no soporta Intl.
const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** Convierte un ISO-2 a nombre canónico del proyecto. Devuelve null si inválido. */
function isoToName(iso2: string): string | null {
  const code = iso2.trim().toUpperCase();
  if (code.length !== 2) return null;
  let name: string | undefined;
  try {
    name = displayNames.of(code);
  } catch {
    return null; // ISO inválido que Intl rechaza
  }
  // Intl devolvió el propio código (ISO inválido silencioso) o una cadena genérica de fallback.
  if (!name || name === code || name === 'Unknown Region') return null;
  return CANONICAL_ALIASES[name] ?? name;
}

// ─── Parseo CSV quote-aware (hand-roll, zero-dep) ─────────────────────────────
// Soporta campos entrecomillados con comas internas.
// ponytail: no maneja saltos de línea DENTRO de un campo entrecomillado
//   (rompe el modelo línea-a-línea). La muestra del PM no mostraba newlines
//   embebidos; si se detectan en producción → reportar NEEDS_CONTEXT al PM
//   para evaluar si añadir dep de parseo CSV completa.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Campo entrecomillado: consume hasta la comilla de cierre (doble-comilla = escape).
      let field = '';
      i++; // salta la comilla de apertura
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // salta la comilla de cierre
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ',') i++; // salta el delimitador siguiente
    } else {
      // Campo sin comillas: consume hasta la próxima coma o fin de línea.
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

/** Agrega conteos por país desde el cuerpo CSV crudo (texto). */
function aggregateFromCsv(csv: string, capturedAt: number): SanctionRow[] {
  const lines = csv.split('\n');
  if (lines.length === 0) return [];

  // W3: deriva el índice de `countries` leyendo el header (no hardcodeado).
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headerFields = parseCsvLine(headerLine.trim());
  const countriesIdx = headerFields.indexOf('countries');
  if (countriesIdx === -1) {
    console.warn('[sanctions] columna "countries" no encontrada en el header — CSV inesperado');
    return [];
  }

  const counts = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    const line = rawLine.trim();
    if (!line) continue;

    const fields = parseCsvLine(line);
    const countriesRaw = fields[countriesIdx] ?? '';
    if (!countriesRaw) continue;

    for (const iso2 of countriesRaw.split(';')) {
      const name = isoToName(iso2);
      if (!name) continue; // drop gracioso — ISO inválido o vacío
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const rows: SanctionRow[] = [];
  for (const [country, sanctionedCount] of counts) {
    rows.push({ country, sanctionedCount, capturedAt });
  }
  return rows;
}

/** Realiza el fetch real y devuelve ConnectorResult. */
async function doFetch(): Promise<ConnectorResult<SanctionRow>> {
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv,text/plain,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[sanctions] upstream HTTP ${res.status} — retorno vacío gracioso`);
      return emptyGraceful(`upstream ${res.status}`);
    }

    const text = await res.text();
    const capturedAt = Date.now();
    const data = aggregateFromCsv(text, capturedAt);

    if (data.length === 0) {
      console.warn('[sanctions] CSV parseado sin filas válidas — retorno vacío gracioso');
    } else {
      console.info(`[sanctions] ${data.length} países con entidades sancionadas capturadas`);
    }

    return { data, stale: false, fetchedAt: capturedAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[sanctions] fallo de upstream: ${msg} — retorno vacío gracioso`);
    return emptyGraceful(msg);
  }
}

function emptyGraceful(reason: string): ConnectorResult<SanctionRow> {
  void reason; // usado solo para logging antes de llamar esta función
  return { data: [], stale: false, fetchedAt: Date.now() };
}

/**
 * fetchSanctions — single-flight + serve-stale.
 * Si hay una petición en vuelo, coalesce. Si falla pero hay datos recientes (< 25h),
 * sirve el último resultado bueno marcado como stale.
 */
export async function fetchSanctions(): Promise<ConnectorResult<SanctionRow>> {
  // Single-flight: una sola petición en vuelo a la vez.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const result = await doFetch();
    inFlight = null;

    if (result.data.length > 0) {
      lastGood = { data: result.data, ts: result.fetchedAt };
      return result;
    }

    // Serve-stale: fallo pero hay copia buena dentro del TTL.
    if (lastGood && Date.now() - lastGood.ts < STALE_TTL_MS) {
      console.info('[sanctions] sirviendo datos stale del último fetch exitoso');
      return { data: lastGood.data, stale: true, fetchedAt: lastGood.ts };
    }

    return result; // vacío gracioso (no hay stale disponible)
  })();

  return inFlight;
}

// ─── Exports internos para tests ──────────────────────────────────────────────
// ponytail: exportados para testability; no forman parte del contrato público.
export { parseCsvLine, aggregateFromCsv, isoToName };
