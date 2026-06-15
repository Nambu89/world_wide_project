// packages/core/cii/src/index.ts
// @www/core-cii — public API (T-22 + T-23)
//
// Re-exporta la configuración editorial del blend CII, los coeficientes por país,
// la normalización de claves de país (T-22) y el motor de scoring completo (T-23).

// Tipos locales + configuración del blend
export type { CiiComponentKey, Section } from './blend.config.js';
export {
  EVENT_WEIGHTS,
  FLOOR_FACTORS,
  COMPOSITE,
  DECAY_HALF_LIFE_MS,
  decayWeight,
  BOOST,
  ECONOMIC_SECTIONS,
  SOCIAL_MIX,
} from './blend.config.js';

// Coeficientes estructurales por país
export type { CountryCoeff, ComponentRegistryEntry } from './coefficients.js';
export {
  COUNTRY_COEFFS,
  DEFAULT_COEFF,
  COMPONENT_REGISTRY,
} from './coefficients.js';

// Normalización de clave de país
export { normalizeCountryKey } from './country-key.js';

// Motor de scoring CII (T-23)
export type { CiiComponent, CiiScore, CiiDynamic } from './score.js';
export {
  computeConflictComponent,
  computeSocialComponent,
  computeEconomicComponent,
  computePoliticalComponent,
  computeCii,
  computeDynamic,
  computeAllCountries,
} from './score.js';
