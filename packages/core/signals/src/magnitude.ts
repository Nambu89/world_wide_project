/**
 * magnitude.ts — Mapeadores fuente → magnitud [0,1] PUROS.
 *
 * PURO: no importa @www/store ni @www/core-cii.
 * Recibe primitivas y devuelve números normalizados a [0, 1].
 *
 * Metodología: D-303/C-1 (docs/design/2026-06-15-convergence.md).
 * El estrés de markets se deriva ENTERAMENTE de market_snapshots (change_pct),
 * NO de market_daily (que solo contiene datos históricos purgados, C-1).
 */

import { DIMENSION_SCALE, MARKET_REF, RISKOFF_REF, VOL_REF } from './convergence.config.js';
import type { ConvergenceDimension } from './detect.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Clamp a [0, 1]. */
export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ---------------------------------------------------------------------------
// CII → magnitud
// ---------------------------------------------------------------------------

/**
 * Magnitud de un componente CII normalizada POR-DIMENSIÓN (D-303/GAP-2).
 *
 * magnitude = clamp01(score / DIMENSION_SCALE[dimension])
 *
 * Cada dimensión se normaliza por su propia escala observada porque los
 * componentes del CII viven en rangos MUY dispares (conflict 0..100,
 * economic/political 0..~8). Sin esto, la familia signals nunca alcanza
 * MIN_MAGNITUDE y el par events×signals jamás dispara (cazado por smoke L-5).
 * NO toca el CII (NG-6); la escala es editorial y refinable (GAP-2).
 *
 * @param score     Puntuación CII del componente (rango propio de la dimensión).
 * @param dimension Dimensión del componente (fija la escala de normalización).
 */
export function ciiMagnitude(score: number, dimension: ConvergenceDimension): number {
  return clamp01(score / DIMENSION_SCALE[dimension]);
}

// ---------------------------------------------------------------------------
// Markets → magnitud (estrés risk-off, C-1)
// ---------------------------------------------------------------------------

/**
 * Compuesto risk-off desde los últimos change_pct por símbolo.
 *
 * Fórmula: clamp01( sum_i( w_i * dir_i * changePct_i ) / RISKOFF_REF )
 *
 * Cada término es positivo cuando el símbolo se mueve en la dirección de estrés:
 *   dir=-1 (risk-on) → caída de precio = término positivo (w * -1 * negativo = positivo)
 *   dir=+1 (refugio) → subida de precio = término positivo (w * +1 * positivo = positivo)
 *
 * Símbolos no listados en MARKET_REF se ignoran.
 *
 * @param latest Array de { symbol, changePct } con los últimos datos por símbolo.
 */
export function marketRiskOff(latest: { symbol: string; changePct: number }[]): number {
  let composite = 0;
  for (const { symbol, changePct } of latest) {
    const ref = MARKET_REF[symbol];
    if (!ref) continue;
    composite += ref.w * ref.dir * changePct;
  }
  // Un compuesto >= RISKOFF_REF se considera estrés máximo
  return clamp01(composite / RISKOFF_REF);
}

/**
 * Proxy de volatilidad intra-ventana desde change_pct.
 *
 * Fórmula: clamp01( mean_i( dispersión(changePct_i) ) / VOL_REF )
 * donde dispersión = (max - min) de los change_pct del símbolo en la ventana.
 * Solo se usan símbolos de MARKET_REF con datos en la ventana.
 *
 * @param trendBySymbol Mapa símbolo → array de change_pct en la ventana temporal.
 */
export function marketVol(trendBySymbol: Record<string, number[]>): number {
  const dispersions: number[] = [];
  for (const symbol of Object.keys(MARKET_REF)) {
    const series = trendBySymbol[symbol];
    if (!series || series.length === 0) continue;
    const mn = Math.min(...series);
    const mx = Math.max(...series);
    dispersions.push(mx - mn);
  }
  if (dispersions.length === 0) return 0;
  const meanDisp = dispersions.reduce((a, b) => a + b, 0) / dispersions.length;
  return clamp01(meanDisp / VOL_REF);
}

/**
 * Estrés de markets: max(riskOff, vol) — representa el peor de los dos indicadores.
 *
 * Metodología propia (D-303/C-1): no usa market_daily (vacío en la ventana de 72h).
 *
 * @param latest       Últimos change_pct por símbolo (para riskOff).
 * @param trendBySymbol Serie de change_pct en la ventana (para vol).
 */
export function marketStress(
  latest: { symbol: string; changePct: number }[],
  trendBySymbol: Record<string, number[]>,
): number {
  return clamp01(Math.max(marketRiskOff(latest), marketVol(trendBySymbol)));
}
