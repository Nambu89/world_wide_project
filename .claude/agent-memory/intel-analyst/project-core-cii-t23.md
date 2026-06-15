---
name: project-core-cii-t23
description: T-23 @www/core-cii motor CII DONE. 86/86 tests green. score.ts (4 componentes + blend renormalizado + dynamic + orquestador). L-7 agrupación canónica JA(gdelt)+Japan(usgs)→Japan verificada.
metadata:
  type: project
---

T-23 @www/core-cii motor CII implementado en `packages/core/cii/src/score.ts`.

**Por qué:** el orquestador CII necesita los 4 componentes (conflict/social/economic/political), el blend renormalizado sobre presentes, el cálculo de dynamic/trend, y la agrupación canónica cross-source.

**Decisiones clave:**
- `computeConflictComponent`: time-decay por occurredAt (fallback capturedAt); sesgo GDELT via quadClass/goldstein (proporción high-intensity → factor 1.0..1.2).
- `computeSocialComponent`: mezcla SOCIAL_MIX (EVENTS_W=0.6 + GKG_W=0.4) + boosts EQ/fire acotados por BOOST caps.
- `computeEconomicComponent` / `computePoliticalComponent`: globalTemp/globalInfoTemp como piso suave D-202 (señales sin país → no se atribuyen, alimentan piso global).
- `computeCii`: renormalización de pesos sobre componentes con signalPresent=true (pesos efectivos siempre suman 1 sobre los presentes).
- `computeDynamic`: deadband ±1 → stable; ≥+2 → rising; ≤-2 → falling.
- `computeAllCountries`: ventana = DECAY_HALF_LIFE_MS; re-agrupación L-7 via normalizeCountryKey por evento (no por clave raw del Map).

**Verificación:** 86/86 tests green (46 T-22 + 40 T-23). tsc --noEmit limpio. duration_ms ~855ms < 60s Nyquist.

**How to apply:** El scheduler T-24+ llama `computeAllCountries(Date.now())` → obtiene `CiiScore[]` → llama `insertCiiSnapshots()`. El briefing T-14 puede leer desde `getLatestCii()`.
