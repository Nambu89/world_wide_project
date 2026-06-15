# ROADMAP — world_wide_project

Progreso global: `████████░░ 81% (13/16)` — **Fase 1 (MVP Finanzas) CERRADA** + **Fase 2: rebanada 1 (eventos globales) + rebanada 2 (radar geoeconómico) + rebanada 3 (CII scoring) CERRADAS**. CII: motor clean-room {conflict,economic,political,social} desde events+signals, normalizeCountryKey FIPS→nombre (109 países en vivo, hotspots incl), /api/cii + RiskPanel + map-tie + briefing; suite 454/454 + smoke vivo + browser E2E PASS. Siguiente: completar dominios (Finanzas FRED/EIA, Educación ONNX) o motor de convergencia cross-domain (spike).

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
- [ ] **Media** — `packages/core/signals/` motor de convergencia cross-domain *(⚠️ spike: lógica no servida por worldmonitor — ver INVESTIGACION-FUSION.md §9.1)*

## Fase 4 — Pulido (opcional)
- [ ] **Baja** — Sistema de variantes (Finanzas/Educación/Política)
- [ ] **Baja** — Empaquetado Tauri 2 (app nativa) *(⚠️ verificar toolchain Windows)*
