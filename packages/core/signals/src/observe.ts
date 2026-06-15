/**
 * observe.ts — Orquestador IO de convergencia (T-30).
 *
 * detectAllConvergence: arma ConvergenceObservation[] desde el store
 * (componentes CII + estrés markets transversal), delega en detectConvergence
 * (pura), enriquece cada señal con firstDetectedAt/dynamicScore vs
 * getPriorConvergence, y devuelve ConvergenceSignalRow[] listas para
 * insertConvergenceSignals (sin mapeo extra en el scheduler).
 *
 * Metodología: D-300/D-302/D-305/D-308/D-309 + correcciones C-1/C-3
 * (docs/design/2026-06-15-convergence.md, plans/2026-06-15-convergence.md).
 */

import {
  getLatestCii,
  getLatestMarkets,
  getMarketTrend,
  getPriorConvergence,
  type ConvergenceSignalRow,
} from '@www/store';

import {
  detectConvergence,
  type ConvergenceDimension,
  type ConvergenceObservation,
} from './detect.js';
import {
  FAMILY_OF,
  MARKET_REF,
  METHODOLOGY_VERSION,
  MIN_MAGNITUDE,
  WINDOW_MS,
} from './convergence.config.js';
import { ciiMagnitude, marketStress } from './magnitude.js';

/**
 * Forma mínima de un componente CII tal como se serializa en
 * `cii_snapshots.componentsJson` (rebanada 3, @www/core-cii score.ts).
 * Solo consumimos key/score/signalPresent.
 */
interface CiiComponentLite {
  key: ConvergenceDimension;
  score: number;
  signalPresent: boolean;
}

/** Dimensiones que produce el CII (excluye 'market', que es exclusivo de markets). */
const CII_DIMENSIONS: ReadonlySet<string> = new Set([
  'conflict',
  'economic',
  'political',
  'social',
]);

/** Clamp a [min, max]. */
function clamp(min: number, max: number, x: number): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Detecta las señales de convergencia activas y las devuelve en forma persistible.
 *
 * Lee el store (CII canónico + markets exógeno), corre la detección pura,
 * y enriquece dynamicScore/firstDetectedAt contra la aparición previa del mismo
 * (country, familyset). Gracioso: si no hay CII, devuelve [] (NUNCA lanza por
 * lógica propia).
 *
 * @param nowMs Timestamp de referencia (epoch ms). El job cii usa su mismo `now`.
 * @returns ConvergenceSignalRow[] listas para insertConvergenceSignals.
 */
export async function detectAllConvergence(nowMs: number): Promise<ConvergenceSignalRow[]> {
  const ciiRows = await getLatestCii();
  if (ciiRows.length === 0) return [];

  const observations: ConvergenceObservation[] = [];

  // ── 1. Observaciones canónicas desde los componentes CII (D-300/D-302/C-3) ──
  for (const row of ciiRows) {
    let components: CiiComponentLite[];
    try {
      components = JSON.parse(row.componentsJson) as CiiComponentLite[];
    } catch {
      continue; // componentsJson corrupto → saltar este país, no romper la corrida
    }
    if (!Array.isArray(components)) continue;

    for (const comp of components) {
      if (!comp || comp.signalPresent !== true) continue; // D-304: floor sin datos no cuenta
      if (!CII_DIMENSIONS.has(comp.key)) continue;
      observations.push({
        country: row.country, // ya normalizado en cii_snapshots (C-3, NO re-normalizar)
        dimension: comp.key,
        dataFamily: FAMILY_OF[comp.key],
        magnitude: ciiMagnitude(comp.score, comp.key), // normalizada por-dimensión (GAP-2)
        ts: row.capturedAt,
        signalPresent: true,
        source: `cii:${comp.key}`,
      });
    }
  }

  // ── 2. Observación markets transversal (D-305/C-1) ──
  // Estrés derivado SOLO de market_snapshots (change_pct), nunca de market_daily.
  const latest = await getLatestMarkets();
  if (latest.length > 0) {
    const trendBySymbol: Record<string, number[]> = {};
    for (const symbol of Object.keys(MARKET_REF)) {
      const series = await getMarketTrend(symbol, nowMs - WINDOW_MS);
      trendBySymbol[symbol] = series
        .map((s) => s.change_pct)
        .filter((v): v is number => v !== null);
    }
    const stress = marketStress(
      latest.map((s) => ({ symbol: s.symbol, changePct: s.change_pct ?? 0 })),
      trendBySymbol,
    );
    if (stress >= MIN_MAGNITUDE) {
      const tsMarket = Math.max(...latest.map((s) => s.captured_at));
      observations.push({
        country: '', // transversal — sin país (D-305)
        dimension: 'market',
        dataFamily: 'markets',
        magnitude: stress,
        ts: tsMarket,
        signalPresent: true,
        source: 'markets:stress',
      });
    }
  }

  // ── 3. Detección pura (anti-doble-conteo por familia + markets a economic-activos) ──
  const signals = detectConvergence(observations, nowMs);

  // ── 4. Enriquecer (D-308/D-309) y mapear a ConvergenceSignalRow ──
  const rows: ConvergenceSignalRow[] = [];
  for (const sig of signals) {
    const familyset = JSON.stringify(sig.families); // families ya vienen ordenadas de detect
    const prior = await getPriorConvergence(sig.country, familyset, nowMs - 1);
    const firstDetectedAt = prior ? prior.firstDetectedAt : nowMs;
    const dynamicScore = prior ? clamp(-1, 1, sig.strength - prior.strength) : 0;

    rows.push({
      country: sig.country,
      familiesJson: familyset,
      dimensionsJson: JSON.stringify(sig.dimensions),
      componentsJson: JSON.stringify(sig.observations),
      strength: sig.strength,
      sourceCount: sig.sourceCount,
      dynamicScore,
      methodologyVersion: METHODOLOGY_VERSION,
      firstDetectedAt,
      capturedAt: nowMs,
    });
  }

  return rows;
}
