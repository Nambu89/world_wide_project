/**
 * convergence.config.ts — Parámetros editoriales del motor de convergencia cross-domain.
 *
 * Metodología re-implementada clean-room (ADR-002/D-001).
 * Todos los umbrales son ajustables; la versión de metodología los versiona (D-309).
 *
 * Fuentes metodológicas:
 *  - ACLED: ventana temporal de 72h / decay exponencial con vida-media configurable
 *    (https://acleddata.com/resources/general-guides/)
 *  - Diseño interno: D-301..D-312 en docs/design/2026-06-15-convergence.md
 */

import type { ConvergenceDimension, DataFamily } from './detect.js';

// ---------------------------------------------------------------------------
// Parámetros de disparo (gradeables — cubiertos por tests de invariante)
// ---------------------------------------------------------------------------

/** Número mínimo de familias de dato DISJUNTAS para emitir una señal. */
export const MIN_SOURCES = 2;

/** Magnitud mínima (escala [0,1]) para que una observación sea considerada. */
export const MIN_MAGNITUDE = 0.5;

/** Ventana temporal en ms. Una observación fuera de ella se descarta. */
export const WINDOW_MS = 72 * 3600 * 1000; // 72 horas

/**
 * Vida media para el decay time-weighted del strength (D-307).
 * A ts = now - HALF_LIFE_72H el peso cae a 0.5.
 * Derivado de la vida media ACLED (decay en ventanas de 72h).
 */
export const HALF_LIFE_72H = 36 * 3600 * 1000; // 36 horas → peso 0.5 a las 36h dentro de la ventana

/** Versión de la metodología — cualquier cambio de parámetro incrementa esto (D-309). */
export const METHODOLOGY_VERSION = 'conv-core-2';

// ---------------------------------------------------------------------------
// Mapeo dimensión → familia de dato (D-306)
//
// La familia determina la fuente de datos que aporta la observación.
// Anti-doble-conteo: conflict+social comparten familia 'events' → cuentan como 1.
// economic+political comparten familia 'signals' → cuentan como 1.
// market solo existe como familia 'markets'.
// ---------------------------------------------------------------------------

export const FAMILY_OF: Record<ConvergenceDimension, DataFamily> = {
  conflict:  'events',
  social:    'events',
  economic:  'signals',
  political: 'signals',
  market:    'markets',
};

// ---------------------------------------------------------------------------
// Escala de magnitud POR-DIMENSIÓN (calibración, D-303/GAP-2)
//
// PROBLEMA (cazado por el smoke EN VIVO 2026-06-16, L-5): los componentes del CII
// (rebanada 3) viven en escalas MUY dispares — conflict/social (events) llegan a
// 0..100, pero economic/political (signals = GKG secciones × AvgTone) producen
// scores diminutos 0..~8. Con una magnitud lineal score/100, la familia signals
// JAMÁS alcanza MIN_MAGNITUDE → el par primario events×signals nunca dispara.
//
// FIX clean-room (NO toca el CII, NG-6): se normaliza cada dimensión por SU PROPIA
// escala observada, de modo que MIN_MAGNITUDE=0.5 signifique "alto PARA ESA
// dimensión". Valores derivados de la distribución real (snapshot 2026-06-16):
//   conflict  max=100 p90=56  → escala 80  (mag 0.5 ≈ score 40, ~top cuartil)
//   social    max=51  p90=41  → escala 50
//   economic  max=7.6 p90=6.5 → escala 7.6 (su máximo real)
//   political max=7.6 p90=7.0 → escala 7.6
// Calibración INICIAL — refinable con ≥semanas de snapshots (intel-analyst, GAP-2);
// methodology_version='conv-core-2' versiona el cambio. 'market' no usa esta escala
// (su magnitud sale de marketStress, ya en [0,1]); se incluye con 1 por totalidad.
// ---------------------------------------------------------------------------

export const DIMENSION_SCALE: Record<ConvergenceDimension, number> = {
  conflict:  80,
  social:    50,
  economic:  7.6,
  political: 7.6,
  market:    1,
};

// ---------------------------------------------------------------------------
// Referencias de mercado para el estrés risk-off (D-303/C-1)
//
// dir = +1 → refugio (subida = estrés), dir = -1 → risk-on (caída = estrés).
// Los pesos suman 1.0 (invariante verificable en test).
//
// Derivación editorial (no copiada de AGPL):
//   - Renta variable (SPY/QQQ): caída = huida de riesgo.
//   - Crypto (BTC/ETH): caída = huida de riesgo.
//   - Oro (GLD): subida = refugio.
//   - DXY (DX-Y.NYB): subida = refugio en USD.
//   - EURUSD (EURUSD=X): caída = fortaleza USD = refugio.
// ---------------------------------------------------------------------------

export interface MarketRef {
  w: number;     // peso relativo (todos suman 1.0)
  dir: 1 | -1;  // +1 refugio (subida = estrés), -1 risk-on (caída = estrés)
}

export const MARKET_REF: Record<string, MarketRef> = {
  'SPY':       { w: 0.20, dir: -1 },
  'QQQ':       { w: 0.15, dir: -1 },
  'BTC-USD':   { w: 0.15, dir: -1 },
  'ETH-USD':   { w: 0.10, dir: -1 },
  'GLD':       { w: 0.15, dir:  1 },
  'DX-Y.NYB':  { w: 0.15, dir:  1 },
  'EURUSD=X':  { w: 0.10, dir: -1 },
};
// Invariante: sum(w) === 1.0 — verificado en tests

/**
 * Ref de normalización del compuesto risk-off (en puntos de change_pct ponderados).
 * Un movimiento compuesto de ~3 puntos representa un día de estrés notable.
 * Derivación editorial propia (D-303).
 */
export const RISKOFF_REF = 3.0;

/**
 * Ref de normalización de la volatilidad intra-ventana (dispersión de change_pct).
 * Una dispersión media de ~2 puntos representa alta volatilidad intra-día.
 * Derivación editorial propia (D-303).
 */
export const VOL_REF = 2.0;
