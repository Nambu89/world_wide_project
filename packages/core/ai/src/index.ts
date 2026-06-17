// packages/core/ai/src/index.ts
// @www/core-ai — public API (T-05)
//
// Re-exporta los contratos públicos del paquete. Los consumidores
// (server.ts, scheduler) importan desde '@www/core-ai'.

// Router LLM
export {
  PROVIDER_CHAIN,
  type Provider,
  type ProviderState,
  type CompleteOptions,
  resolveChain,
  pickProvider,
  complete,
} from './router.js';

// Persona + plantilla de briefing
export {
  FINANCIAL_ANALYST_PERSONA,
  buildBriefingPrompt,
} from './persona.js';

// Pipeline de briefing diario
export {
  serializeContext,
  generateDailyBriefing,
  buildGlobalRiskContext,
  buildRiskContext,
  buildConvergenceContext,
  buildSanctionsContext,
} from './briefing.js';

// Motor de insights IA (slice B) — relaciona hotspots → predice consecuencias
export {
  INTEL_PERSONA,
  buildChokepointContext,
  buildIntelContext,
  buildInsightsPrompt,
  parseInsights,
  generateInsights,
  type Insight,
} from './insights.js';
