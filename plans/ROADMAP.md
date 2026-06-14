# ROADMAP — world_wide_project

Progreso global: `███████░░░ 69% (11/16)` — **Fase 1 (MVP Finanzas) CERRADA** + **Fase 2 rebanada 1 (Capa de eventos globales) CERRADA**: /verify VERIFIED + smoke en vivo + browser E2E PASS (30 eventos render, 0 errores consola/red). USGS+GDELT-raw-CSV+EONET → tabla `events` + /api/events + capas por tipo. Siguiente: completar dominios (Finanzas/Educación) + rebanada CII (consume `events`).

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
- [ ] **Media** — Completar Finanzas (FRED/EIA/sanctions), Educación (rss-proxy + clustering ONNX), Política (ACLED/UCDP/country-risk)
- [ ] **Media** — `packages/core/cii/` CII re-implementado + histórico/tendencias *(design-doc ✅ `docs/design/2026-06-13-cii-scoring.md`; PHASE-SPLIT: solo componente Information activo hoy, resto se desbloquea con conectores keyed; pendiente ratificar OQs → plan → /check-plan)*

## Fase 3 — Síntesis IA + correlación
- [ ] **Media** — Router completo `ollama → groq → claude` + personas/plantillas de briefing por dominio
- [ ] **Media** — `packages/core/signals/` motor de convergencia cross-domain *(⚠️ spike: lógica no servida por worldmonitor — ver INVESTIGACION-FUSION.md §9.1)*

## Fase 4 — Pulido (opcional)
- [ ] **Baja** — Sistema de variantes (Finanzas/Educación/Política)
- [ ] **Baja** — Empaquetado Tauri 2 (app nativa) *(⚠️ verificar toolchain Windows)*
