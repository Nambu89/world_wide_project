---
name: project-core-ai-t32
description: T-32 @www/core-ai briefing enriquecido con bloque de convergencia. 45/45 tests verdes.
metadata:
  type: project
---

T-32 @www/core-ai — bloque de convergencia en el briefing. DONE.

**Why:** La rebanada 4 (convergencia) necesita que el briefing diario incluya las señales de convergencia detectadas por core-signals, sin añadir ninguna llamada LLM extra (ADR-009) ni romper el caché D-106.

**How to apply:** `buildConvergenceContext(ConvergenceSignalRow[]): string` devuelve '' si vacío (el bloque se omite en serializeContext, igual que buildRiskContext). `serializeContext` tiene 4 args: `(markets, events, cii=[], convergence=[])`. `generateDailyBriefing` lee `getLatestConvergence()` del store y lo pasa como 4º arg. Patrón idéntico al de getLatestCii/buildRiskContext.

Ficheros tocados:
- `packages/core/ai/src/briefing.ts` — buildConvergenceContext + 4º arg serializeContext + generateDailyBriefing
- `packages/core/ai/src/index.ts` — re-exporta buildConvergenceContext (+ buildGlobalRiskContext + buildRiskContext)
- `packages/core/ai/test/ai.test.ts` — Suite 7 (10 tests buildConvergenceContext) + Suite 8 (4 tests serializeContext con convergencia)

Verify: `pnpm --filter @www/core-ai exec tsc --noEmit` EXIT 0 + `node --import tsx --test` → 45/45 pass 0 fail.
