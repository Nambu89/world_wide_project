---
name: cii-done-convergence-design-started-2026-06-15
date: 2026-06-15 23:30
project: world_wide_project
branch: main
summary: Fase 2 rebanada 3 (CII scoring) CERRADA+VERIFIED+PUSHEADA (c9e4cdf). Rebanada 4 (convergencia cross-domain) = Research iniciada, design-doc PENDIENTE; architect paró en Q1 (PM ratificó opción A).
---

## Resume here — read this first
- **Re-dispatch system-architect** para `docs/design/2026-06-15-convergence.md` con la **Q1 YA ratificada = opción (A)** (no la re-preguntes): el CII es la capa de observación canónica por-dimensión por-país; markets = única fuente exógena; independencia de fuentes = **familias-de-dato disjuntas** (conflict/social vienen de events; economic/political de signals; markets aparte) + exige ≥2 corroborantes con ≥1 fuente no-CII o dos componentes CII de origen disjunto. Anti-doble-conteo por construcción.
- El architect aún debe completar Q2-5 (esperadas: granularidad temporal de las observaciones, mapeo fuente→magnitud[0,1], entidad para markets-global, persistencia/dynamic, alcance MVP de familias de convergencia) → escribir el doc → `/check-plan` → implementar.
- **NO hay código de producto de convergencia.** No toques `packages/core/signals` (aún no existe). La rebanada 3 (CII) está cerrada y pusheada — no la re-abras.

## Goal
Construir el **motor de convergencia cross-domain** (`packages/core/signals`, era NG-1 en todas las rebanadas previas) — el último diferencial. Una señal de convergencia se dispara cuando ≥2 fuentes INDEPENDIENTES apuntan al mismo deterioro en la misma entidad (país) dentro de una ventana 72h (metodología skill `cii-scoring`: detectConvergence, MIN_SOURCES=2, MIN_MAGNITUDE=0.5, strength=magnitud media con decay). El CII (rebanada 3) es su INPUT, ya construido. License-clean (no-AGPL, D-001).

## Key findings (this session)
- **Rebanada 3 (CII) cerrada+verified+pusheada** (`c9e4cdf`): `@www/core-cii` motor N-componentes {conflict,economic,political,social} desde events+signals; EVENT_BLEND {0.25/0.30/0.20/0.25}, COMPOSITE {0.4/0.6}, FLOORS, decay-30d, boosts EQ/fire; `cii_snapshots` (migr. 004) + dynamicScore; job cii→medium; /api/cii + /api/cii/:country; RiskPanel + capa por país + map-tie; briefing buildRiskContext. Suite 454/454.
- **OQ-2 (clave de país) — verificar-no-asumir cazó landmine**: GDELT persiste FIPS 10-4 (`JA`), USGS persiste nombres (`Japan`) → mismo país, 2 claves → índice partido. Fix: `normalizeCountryKey(raw,source)` FIPS→nombre canónico (`packages/core/cii/src/country-key.ts`). Clave canónica = nombre (encaja con `country-centroids.ts`).
- **Hallazgo del smoke EN VIVO (L-5, verde≠funciona)**: la `FIPS_TO_NAME` inicial cubría ~64 países; ~50 códigos FIPS reales de GDELT faltaban → hotspots de conflicto (Syria/Afghanistan/Lebanon/Somalia/Sudan…) se DESCARTABAN. Expandida (~110 cód, vía tabla FIPS 10-4 autoritativa) + bug corregido (`TC`=Turks&Caicos no UAE; UAE=`AE`). Re-smoke: 109 países, hotspots presentes, Japan=1 (0 fugas FIPS).
- **Convergencia — Q1 ratificada (A)** por el PM (ver Resume here). El CII componentsJson YA da observaciones por-dimensión 0..100 por país — es el insight central.

## Gotchas
- **Nuevo paquete = wiring del PM (L-2/L-4)**: al crear `@www/core-signals`, añádelo al workspace (`pnpm-workspace.yaml` ya cubre `packages/core/*`), añade sus deps `@www/store`/`@www/core-cii` a su `package.json`, `pnpm install`, y `pnpm --filter @www/core-signals build` ANTES de que downstream (scheduler/server) lo consuma. (En la rebanada CII esto se olvidó al principio y rompió la resolución cross-package.)
- **Los subagentes truncan ~30 turnos (L-6)**: 4 de los 7 agentes de la rebanada CII truncaron mid-verify; el PM remató cada uno. Dispatch directo texto-libre + prompts acotados + verify del PM. El `intel-analyst` tuvo **Bash DENEGADO** en un contexto (T-27) → no pudo verificar; el PM hizo la tarea. Prevé que algún agente no pueda correr Bash.
- **migrate.ts trampa (W-2)**: `sql.split(';')` descarta chunks que empiezan por `--`. En `005_*.sql` ningún comentario `--` precede a un statement en el mismo chunk; el test debe assertar `sqlite_master`.
- **Contrato web camelCase (L-1)**: el wire de las APIs es camelCase directo (JSON.stringify, sin transform). El cliente web tipa camelCase, NUNCA snake_case (BUG-1 histórico).
- **Verde ≠ funciona (L-5, 3 veces ya)**: el smoke EN VIVO (server real + curl) + browser E2E cazan lo que tests+tsc+/check-plan no ven. Obligatorio al cierre de cada rebanada.
- **markets sin país**: es señal económica global; en convergencia se mapea a una entidad sintética GLOBAL o se difunde (decisión Q-pendiente del architect).

## How to test & validate
```
cd "C:\Users\Fernando Prada\OneDrive - SVAN TRADING SL\Escritorio\Personal\Proyectos\world_wide_project"
pnpm -w exec tsc --noEmit
node --import tsx --test packages/store/test/*.ts packages/connectors/**/*.test.ts packages/scheduler/test/*.ts packages/core/ai/test/*.ts packages/core/cii/test/*.ts server.test.ts
```
Pasa si: global tsc EXIT 0 + **suite 454/454 / 0 fail**.
Smoke CII en vivo (opcional, confirma el estado): `pnpm dev` → esperar job `cii` (tier medium) en boot → `curl http://localhost:8787/api/cii` debe devolver ~100+ países camelCase con composite/dynamicScore; verificar que NO hay claves de 2 letras (fuga FIPS) y Japan aparece 1 vez.

## Repo state
- Último commit: `c9e4cdf` (`feat(cii): ...rebanada 3`) en `main`, pusheado a origin (`github.com/Nambu89/world_wide_project`).
- Sin commitear: `M agent-comms.md` (entrada de convergencia in-progress — committear con la próxima sesión o ahora si se desea).
- Migraciones: 001 init, 002 events, 003 signals, **004 cii**. La de convergencia será **005**.
- Memorias del harness actualizadas (fuera del repo): `world-wide-project-goal.md`, `world-wide-data-feeds-state.md`, `MEMORY.md`.
- DB local `data/world.db` poblada (events/signals/cii_snapshots reales del último smoke) — útil para tests en vivo de convergencia sin esperar el scheduler.

## Open threads / TODO
- [ ] (ALTA) Re-dispatch system-architect: convergencia, Q1=(A) ratificado → completar interrogación Q2-5 → `docs/design/2026-06-15-convergence.md` → spec-validator.
- [ ] (ALTA) Tras el design: PM ratifica OQs → plan `plans/2026-06-15-convergence.md` → `/check-plan` = PASS → implementar ronda a ronda.
- [ ] (MEDIA) Commit de `agent-comms.md` (entrada convergencia) — pendiente, no urgente.
- [ ] (DIFERIDO) Calibración cuantitativa baselineRisk/pesos CII con intel-analyst (NG-7, tras ≥semanas de snapshots).
- [ ] (DIFERIDO) Completar dominios: Finanzas FRED/EIA + OFAC, Educación rss-ampliado + clustering ONNX. (Media prioridad; alternativa a convergencia si el usuario reprioriza.)
- [ ] (DIFERIDO) Conectores keyed ACLED/UCDP (mejor Conflict CII) — requieren registro/key.
- [ ] (FOLLOW-UP) ~134 warnings FIPS = territorios diminutos (OC/OS/Antártida/Guernsey/Nauru) — drop aceptable; mapear si se quiere silenciar.

## Recent transcript (last ~10 turns)
Sesión retomó "wave B" → resultó que la rebanada 2 (radar) estaba a medias (Wave B sin test/barrel) → PM la cerró + corrió rondas paralelas C/D/E → gate (smoke+E2E) → cerrada+commit+push. Usuario eligió CII como siguiente rebanada → architect refrescó el CII design-doc (premisa vieja "data-starved" muerta; componentes → {conflict,economic,political,social} con fuente real) → PM verificó la DB y cazó la heterogeneidad FIPS/nombre (OQ-2=normalizar) → plan → /check-plan PASS → implementación en 3 rondas paralelas dep-optimizadas (T-21..T-27; varios agentes truncaron, PM remató) → gate final: el smoke en vivo cazó la cobertura FIPS incompleta (hotspots descartados) → PM expandió la tabla (WebFetch FIPS 10-4) → re-smoke 109 países + browser E2E PASS → commit `c9e4cdf` + push. Usuario "sigue" → PM arrancó la RPI de convergencia (architect) → architect paró en Q1 (independencia de fuentes) → PM ratificó (A) → usuario pidió actualizar memorias y cerrar por hoy → este handoff.
