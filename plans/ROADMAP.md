# ROADMAP — world_wide_project

Progreso global: `█████████░ 88% (14/16)` — **Fase 1 (MVP Finanzas) CERRADA** + **Fase 2: rebanadas 1 (eventos) + 2 (radar) + 3 (CII) CERRADAS** + **rebanada 4 (motor de convergencia cross-domain, el último diferencial) CERRADA**. Convergencia: paquete clean-room `@www/core-signals`, ≥2 familias-de-dato disjuntas/72h/magnitud≥0.5, anti-doble-conteo por dataFamily, observaciones desde CII + markets exógeno, `convergence_signals` (migr 005) + dynamicScore, encadenado dentro del job cii (orden por construcción), bloque en el briefing; calibración por-dimensión `conv-core-2`; suite 541/541 + global tsc + smoke EN VIVO 10 señales reales (anti-doble-conteo OK). SIN UI (NG-4, briefing+persistencia). Siguiente: **rebanada-superficie UI de convergencia** (/api + mapa + panel) o completar dominios (Finanzas FRED/EIA, Educación ONNX).

> Prioridad: **Alta** = MVP, **Media** = dominios completos, **Baja** = pulido. Marca `[x]` al completar (con `verifier` = VERIFIED).

---

## Fase 0 — Fundación ✅
- [x] Andamiaje de desarrollo en `.claude/` (11 agentes, 17 comandos, 7 skills, 5 hooks)
- [x] Blackboard sembrado (CLAUDE.md, ROADMAP, DECISIONS, agent-comms, memory/feedback)
- [x] **Alta** — Fijar alcance del MVP → `docs/design/2026-06-13-mvp-finanzas.md` (system-architect, RPI Research+Design) ✅

## Fase 1 — MVP Finanzas (alcance fijado 2026-06-13 · ADR-005/006/007)
*1 dominio (Finanzas) · MapLibre + 1 panel · IA = Anthropic Claude (rama activa del router) · 3 conectores keyless · persistencia SQLite local (`@libsql/client file://`).*
- [x] **Alta** — Bootstrap entorno: workspace pnpm + tsconfig + `.venv` Python reservado + `.gitignore` (ADR-007) ✅ R-1 (libsql Windows) superado
- [x] **Alta** — `packages/store/` schema libSQL local (`file://`) series temporales + migraciones (ADR-006) ✅ 10 tests
- [x] **Alta** — `packages/scheduler/` loop server-side por volatilidad ✅ 4 tiers, 15 tests, deps inyectables
- [x] **Alta** — Conectores keyless: `finance/markets`, `geo/gdelt`, `edu/news` (patrón osiris) ✅ 46 tests, keyless, SSRF-allowlist
- [x] **Alta** — `packages/web/` MapLibre con config-array de capas + 1 panel Finanzas (responsive + mobile-first, ADR-008) ✅ vite build OK
- [x] **Alta** — `packages/core/ai/` router LLM (rama `claude` activa) + briefing diario (ADR-005) ✅ 16 tests, AGPL-clean
- [x] **Alta** — `server.ts` cableado connectors + scheduler + api ✅ pipeline seguridad + 5 endpoints, 9 tests

## Fase 2 — Dominios + scoring
- [x] **Alta** — **Capa de eventos globales multi-fuente** (ADR-010, 1ª rebanada) ✅ **CERRADA** — plan `plans/2026-06-14-global-events.md` → /check-plan PASS → 8 tareas/5 waves → /verify VERIFIED + smoke en vivo + browser E2E PASS. USGS terremotos (live 245) + NASA EONET (live 0 transitorio) + GDELT raw Events CSV (live 650, coords reales del suceso). Tabla `events` unificada (migración 002, dropó gdelt_events) + severity 0..100 + /api/events + capas mapa por tipo + briefing enriquecido. Follow-ups: EONET re-check, ruido GDELT QuadClass1/2 (minSeverity). Diferidas: ReliefWeb/UCDP/ACLED (key/gated). BUG cazado por qa-tester (contrato camelCase client.ts) → fixeado + verificado en navegador.
- [x] **Alta** — **Radar Geoeconómico Temático** (ADR-011, 2ª rebanada) ✅ **CERRADA** — plan `plans/2026-06-14-geoeconomic-radar.md` → /check-plan PASS → 6 tareas (T-15..T-20)/5 waves → global tsc + suite 338/338 + smoke en vivo + browser E2E PASS. Conector GKG keyless (`gkg.ts`, 27-col, reusa `zip.ts`) + tabla `signals`+`signal_sections` (migración 003, SEPARADA de events) + clasificador editorial 6 secciones (`sections.config.ts`, no-AGPL) + job `gkg→medium` + `/api/signals`+`/api/signals/trend` + `RadarPanel` (6 secciones, headlines+tendencia+entidades) + capas `signals` por sección (config-array, W-3 feature escalar) + map-tie. Live: 471 signals (pol 405/commodities 224/trade 222/minerals 39/semis 4/cyber 7), geo 90%. Follow-ups: gkg timeout 8s en boot por concurrencia (red real 224ms; transitorio, degrada gracioso); calibración clasificador semis/cyber (OQ-4, 1ª semana). RSS temático DIFERIDO (OQ-8, ToS no verificado).
- [ ] **Media** — Completar Finanzas (FRED/EIA/sanctions), Educación (rss-proxy + clustering ONNX), Política (ACLED/UCDP/country-risk)
- [x] **Alta** — **`packages/core/cii/` CII re-implementado + histórico/tendencias** ✅ **CERRADA** (rebanada 3, ADR aplicado design-doc refrescado `2026-06-15-cii-scoring.md`). Motor clean-room N-componentes {conflict,economic,political,social} con fuente real keyless (events:conflict/protest + GKG secciones + boosts EQ/fire), EVENT_BLEND propio {0.25/0.30/0.20/0.25} + COMPOSITE {0.4/0.6} + FLOORS + decay-30d, `normalizeCountryKey` FIPS→nombre (OQ-2, ~110 códigos, hotspots incl Syria/Afghanistan/Lebanon), `cii_snapshots` (migración 004) + dynamicScore + deadband, job `cii`→medium, `/api/cii` + `/api/cii/:country`, `RiskPanel` + capa por país + map-tie, briefing `buildRiskContext`. Verificado: suite 454/454 + smoke vivo (109 países, Japan unificado) + browser E2E PASS. Convergencia cross-domain sigue Non-Goal. Follow-ups: calibración baselineRisk (NG-7), ~134 FIPS-territorios diminutos drop.

## Fase 3 — Síntesis IA + correlación
- [ ] **Media** — Router completo `ollama → groq → claude` + personas/plantillas de briefing por dominio
- [x] **Media** — **`packages/core/signals/` motor de convergencia cross-domain** ✅ **CERRADA** (rebanada 4, ADR-012). Paquete clean-room `@www/core-signals`: `detectConvergence` pura (≥2 familias-de-dato DISJUNTAS events/signals/markets / ventana 72h / magnitud≥0.5, anti-doble-conteo por `dataFamily` D-306) + `detectAllConvergence` (observaciones desde componentes CII + markets exógeno, estrés risk-off desde `change_pct` REAL — no `regimeDelta`, C-1) + `convergence_signals` (migr. 005, append + dynamicScore D-309) + job encadenado DENTRO del run() del job cii (orden por construcción, C-4: el scheduler corre el tier en paralelo) + bloque en el briefing (sin LLM nuevo). **Calibración por-dimensión** `DIMENSION_SCALE` (signals corre 0..8 vs events 0..100 → normaliza sin tocar CII NG-6, `conv-core-2`). Verificado: suite 541/541 + global tsc + **smoke EN VIVO 10 señales reales** (Iraq/Israel/Pakistan/Russia/Ukraine…, anti-doble-conteo OK). SIN API/mapa (NG-4, decisión usuario = briefing+persistencia). Follow-ups: calibración fina DIMENSION_SCALE (GAP-2), markets change_pct null. **Siguiente diferido: rebanada-superficie UI** (/api/convergence + capa mapa + ConvergencePanel + map-tie).

## Fase 4 — Pulido (opcional)
- [ ] **Baja** — Sistema de variantes (Finanzas/Educación/Política)
- [ ] **Baja** — Empaquetado Tauri 2 (app nativa) *(⚠️ verificar toolchain Windows)*
