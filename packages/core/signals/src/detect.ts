/**
 * detect.ts — Función pura detectConvergence + tipos locales del motor de convergencia.
 *
 * PURO: no importa @www/store ni @www/core-cii.
 * Los tipos son locales (DataFamily, ConvergenceDimension, ConvergenceObservation,
 * ConvergenceSignal) — el orquestador IO (T-30/observe.ts) adapta los tipos del store.
 *
 * Metodología: D-301/D-304/D-305/D-306/D-307 (docs/design/2026-06-15-convergence.md).
 */

import {
  FAMILY_OF,
  HALF_LIFE_72H,
  METHODOLOGY_VERSION,
  MIN_MAGNITUDE,
  MIN_SOURCES,
  WINDOW_MS,
} from './convergence.config.js';

// ---------------------------------------------------------------------------
// Tipos locales (design-doc §Interfaces)
// ---------------------------------------------------------------------------

/** Familia de dato: fuente de la observación (anti-doble-conteo por construcción D-306). */
export type DataFamily = 'events' | 'signals' | 'markets';

/** Dimensión temática de la observación (input del componente CII o del corroborante markets). */
export type ConvergenceDimension = 'conflict' | 'economic' | 'political' | 'social' | 'market';

/**
 * Observación canónica — un punto de dato normalizado de una fuente para un país.
 *
 * Para observaciones CII: country = nombre canónico (ya normalizado, C-3).
 * Para observaciones markets transversales: country = '' (sin país).
 * signalPresent: si false en una obs CII, la obs NO cuenta (D-304).
 */
export interface ConvergenceObservation {
  country: string;
  dimension: ConvergenceDimension;
  dataFamily: DataFamily;
  magnitude: number;      // [0, 1]
  ts: number;             // epoch ms
  signalPresent: boolean; // D-304: corroborante CII solo cuenta si signalPresent === true
  source: string;         // 'cii:conflict' | 'cii:economic' | 'markets:stress' | …
}

/**
 * Señal de convergencia emitida cuando ≥MIN_SOURCES familias disjuntas
 * superan MIN_MAGNITUDE para el mismo país en la ventana WINDOW_MS.
 *
 * capturedAt / firstDetectedAt / dynamicScore los fija el orquestador IO (T-30).
 * La función pura los inicializa a nowMs / nowMs / 0.
 */
export interface ConvergenceSignal {
  country: string;
  families: DataFamily[];                    // familias contribuyentes (ordenadas)
  dimensions: ConvergenceDimension[];        // dims contribuyentes
  sourceCount: number;                       // == families.length
  strength: number;                          // [0, 1] magnitud media time-decayed (D-307)
  dynamicScore: number;                      // 0 hasta que el IO calcule delta vs prior (D-309)
  observations: ConvergenceObservation[];    // una por familia (la de mayor magnitud)
  methodologyVersion: string;
  firstDetectedAt: number;                   // epoch ms (el IO lo persiste via getPriorConvergence)
  capturedAt: number;                        // epoch ms
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Peso time-decay para una observación dado su timestamp vs el instante de referencia.
 * w = 0.5 ^ (edad_en_ms / HALF_LIFE_72H)  — D-307, estilo ACLED.
 */
function decayWeight(ts: number, nowMs: number): number {
  const ageMs = Math.max(0, nowMs - ts);
  return Math.pow(0.5, ageMs / HALF_LIFE_72H);
}

// ---------------------------------------------------------------------------
// detectConvergence — función pura
// ---------------------------------------------------------------------------

/**
 * Detecta señales de convergencia cross-domain a partir de observaciones normalizadas.
 *
 * Algoritmo (D-301/D-306/D-307):
 *  1. Filtra: ventana temporal + magnitude >= MIN_MAGNITUDE + signalPresent si no-markets.
 *  2. Separa observaciones markets (country='') del resto.
 *  3. Agrupa por country. Por país: identifica familias DISJUNTAS (anti-doble-conteo D-306).
 *  4. Markets transversal (D-305): añade la familia 'markets' solo a los países
 *     que tienen una obs economic (familia 'signals') en la ventana.
 *  5. Si #familias >= MIN_SOURCES → emite señal.
 *  6. strength = media ponderada por decay de la obs representativa de cada familia.
 *
 * @param observations  Array de ConvergenceObservation (CII components + markets opt.)
 * @param nowMs         Timestamp de referencia (epoch ms). Parametrizable para tests.
 */
export function detectConvergence(
  observations: ConvergenceObservation[],
  nowMs: number,
): ConvergenceSignal[] {
  const windowStart = nowMs - WINDOW_MS;

  // ---------- 1. Filtrar obs válidas ----------
  const valid = observations.filter((o) => {
    if (o.ts < windowStart) return false;
    if (o.magnitude < MIN_MAGNITUDE) return false;
    // D-304: una obs que no sea markets requiere signalPresent=true
    if (o.dataFamily !== 'markets' && !o.signalPresent) return false;
    return true;
  });

  // ---------- 2. Separar markets transversal ----------
  const marketObs = valid.filter((o) => o.dataFamily === 'markets');
  const countryObs = valid.filter((o) => o.dataFamily !== 'markets');

  // ---------- 3. Agrupar por country ----------
  const byCountry = new Map<string, ConvergenceObservation[]>();
  for (const o of countryObs) {
    const arr = byCountry.get(o.country) ?? [];
    arr.push(o);
    byCountry.set(o.country, arr);
  }

  // ---------- 4. Aplicar markets transversal (D-305) ----------
  // Markets entra como +1 familia solo a países con una obs economic (familia 'signals').
  const hasEconomicByCountry = new Set<string>();
  for (const [country, obs] of byCountry) {
    if (obs.some((o) => FAMILY_OF['economic'] === o.dataFamily)) {
      hasEconomicByCountry.add(country);
    }
  }

  // Si hay obs de markets, elegimos la de mayor magnitud como representante
  const topMarketObs: ConvergenceObservation | undefined = marketObs.reduce<
    ConvergenceObservation | undefined
  >((best, o) => (!best || o.magnitude > best.magnitude ? o : best), undefined);

  // ---------- 5 & 6. Por país: familias disjuntas → strength → señal ----------
  const signals: ConvergenceSignal[] = [];

  for (const [country, obs] of byCountry) {
    // Mapa familia → obs representativa (mayor magnitud)
    const familyBest = new Map<DataFamily, ConvergenceObservation>();
    for (const o of obs) {
      const current = familyBest.get(o.dataFamily);
      if (!current || o.magnitude > current.magnitude) {
        familyBest.set(o.dataFamily, o);
      }
    }

    // Añadir markets si este país tiene economic (D-305)
    if (topMarketObs && hasEconomicByCountry.has(country)) {
      const currentMarket = familyBest.get('markets');
      if (!currentMarket || topMarketObs.magnitude > currentMarket.magnitude) {
        familyBest.set('markets', topMarketObs);
      }
    }

    if (familyBest.size < MIN_SOURCES) continue;

    // Observaciones representativas (una por familia)
    const repObs = [...familyBest.values()];

    // strength = media ponderada por decay (D-307), una obs por familia
    const totalW = repObs.reduce((s, o) => s + decayWeight(o.ts, nowMs), 0);
    const strength =
      totalW > 0
        ? repObs.reduce((s, o) => s + o.magnitude * decayWeight(o.ts, nowMs), 0) / totalW
        : 0;

    // Familias y dimensiones contribuyentes
    const families = [...familyBest.keys()].sort() as DataFamily[];
    const dimensions = [
      ...new Set(repObs.map((o) => o.dimension)),
    ].sort() as ConvergenceDimension[];

    signals.push({
      country,
      families,
      dimensions,
      sourceCount: families.length,
      strength: Math.min(1, Math.max(0, strength)),
      dynamicScore: 0,       // el IO (T-30) calcula el delta vs prior (D-309)
      observations: repObs,
      methodologyVersion: METHODOLOGY_VERSION,
      firstDetectedAt: nowMs, // el IO actualiza con getPriorConvergence (D-309)
      capturedAt: nowMs,
    });
  }

  return signals;
}
