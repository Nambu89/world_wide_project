/**
 * index.ts — Barrel de @www/core-signals (T-29).
 *
 * Re-exporta: config + tipos + magnitude + detectConvergence.
 * detectAllConvergence (orquestador IO) lo añade T-30 (observe.ts).
 */

// Configuración editorial
export {
  DIMENSION_SCALE,
  FAMILY_OF,
  HALF_LIFE_72H,
  MARKET_REF,
  METHODOLOGY_VERSION,
  MIN_MAGNITUDE,
  MIN_SOURCES,
  RISKOFF_REF,
  VOL_REF,
  WINDOW_MS,
} from './convergence.config.js';
export type { MarketRef } from './convergence.config.js';

// Tipos locales y función pura
export type {
  ConvergenceDimension,
  ConvergenceObservation,
  ConvergenceSignal,
  DataFamily,
} from './detect.js';
export { detectConvergence } from './detect.js';

// Mapeadores de magnitud
export { ciiMagnitude, clamp01, marketRiskOff, marketStress, marketVol } from './magnitude.js';

// Orquestador IO (T-30) — arma observaciones desde el store y delega en la función pura
export { detectAllConvergence } from './observe.js';

// Chokepoints (slice A) — dataset + scorer + orquestador IO
export {
  CHOKEPOINTS,
  DEFAULT_RADIUS_KM,
  CHOKEPOINT_WINDOW_MS,
  CHOKEPOINT_WEIGHTS,
  CHOKEPOINT_SAT,
  CHOKEPOINT_BANDS,
  type ChokepointConfig,
} from './chokepoints.config.js';
export { scoreChokepoints, detectAllChokepoints, haversineKm } from './chokepoints.js';
