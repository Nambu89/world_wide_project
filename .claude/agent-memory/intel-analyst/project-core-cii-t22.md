---
name: project-core-cii-t22
description: T-22 @www/core-cii scaffolding DONE. Paquete puro ESM sin deps, 46/46 tests green. FIPS 10-4 table, blend weights, coefficients editorial, country-key normalize.
metadata:
  type: project
---

T-22 @www/core-cii scaffolding completado (2026-06-15).

**Why:** Fase 2 Wave A — motor de scoring CII necesita paquete puro sin deps de @www/store para desacoplamiento de Wave A.

**How to apply:** El motor T-23 importa desde `@www/core-cii`. El PM cablea el workspace (`pnpm-workspace.yaml`) e instala. Este paquete NO tiene ninguna dependencia externa — funciones puras.

Archivos creados:
- `packages/core/cii/package.json` — espejo de @www/core-ai (type:module, build:tsc)
- `packages/core/cii/tsconfig.json` — extends tsconfig.base.json
- `packages/core/cii/src/blend.config.ts` — EVENT_WEIGHTS {conflict:0.25, economic:0.30, political:0.20, social:0.25}, COMPOSITE {BASELINE_W:0.4, EVENT_W:0.6}, FLOOR_FACTORS, DECAY_HALF_LIFE_MS, decayWeight(), BOOST, ECONOMIC_SECTIONS, SOCIAL_MIX
- `packages/core/cii/src/coefficients.ts` — COUNTRY_COEFFS (64 países canónicos), DEFAULT_COEFF, COMPONENT_REGISTRY (4 entradas con storeSource/refinedBy)
- `packages/core/cii/src/country-key.ts` — FIPS_TO_NAME (tabla FIPS 10-4), NAME_ALIASES, normalizeCountryKey()
- `packages/core/cii/src/index.ts` — barrel de re-exports
- `packages/core/cii/test/cii-config.test.ts` — 46 tests, 8 suites

Verificación: `npx tsc -p packages/core/cii/tsconfig.json --noEmit` = limpio; `node --import tsx --test packages/core/cii/test/cii-config.test.ts` = 46 pass / 0 fail.

Trampas FIPS documentadas y testeadas: CH=China (no Suiza), SZ=Switzerland, AS=Australia (no Austria), AU=Austria (no Australia), UK=United Kingdom, JA=Japan, RS=Russia, etc.
