---
name: project-core-signals-t29
description: T-29 @www/core-signals scaffolding DONE. 52/52 tests green. convergence.config, detect (pura, tipos locales), magnitude (marketStress risk-off), barrel.
metadata:
  type: project
---

T-29 @www/core-signals COMPLETADO. 52/52 tests verdes. tsc limpio.

**Why:** Paquete NUEVO clean-room (ADR-002/D-001 no-AGPL). Ola A de la rebanada 4 (convergencia). Función pura sin import @www/store ni @www/core-cii — el IO (T-30/observe.ts) adaptará los tipos del store.

**How to apply:** El PM debe cablear el workspace+deps+dist antes de que T-30 (observe.ts) pueda consumirlo (L-4). Los tipos son LOCALES en detect.ts — T-30 los adapta desde los tipos del store.

**Decisiones de scoring documentadas:**
- FAMILY_OF: conflict/social→events, economic/political→signals, market→markets (D-306, anti-doble-conteo)
- MARKET_REF: 7 símbolos, pesos suman 1.0, dir±1 editorial propio (D-303/C-1)
- RISKOFF_REF=3.0, VOL_REF=2.0 (editorial, ajustable)
- marketStress = clamp01(max(riskOff, vol)) — estrés desde market_snapshots change_pct SOLO (no market_daily, C-1)
- strength = media ponderada decay w=0.5^(age_ms/HALF_LIFE_72H), una obs/familia (D-307)
- dynamicScore=0 / firstDetectedAt=nowMs en la función pura; el IO (T-30) los recalcula

**Ficheros creados:**
- packages/core/signals/package.json
- packages/core/signals/tsconfig.json
- packages/core/signals/src/convergence.config.ts
- packages/core/signals/src/detect.ts
- packages/core/signals/src/magnitude.ts
- packages/core/signals/src/index.ts
- packages/core/signals/test/detect.test.ts
- packages/core/signals/test/magnitude.test.ts

**Verify output:** 52/52 pass, 0 fail, tsc EXIT 0 (<60s). [[project-core-cii-t22]]
