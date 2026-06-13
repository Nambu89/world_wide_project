# ROADMAP — world_wide_project

Progreso global: `██████░░░░ 62% (10/16)` — **Fase 1 (MVP Finanzas) COMPLETA y VERIFIED** (waves 1-6, gate /verify pasado). 99 tests verdes. Pendiente integración: commit (aprobación humana) + `.env` del usuario. Siguiente fase: 2 (dominios completos + CII).

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
- [ ] **Media** — Completar Finanzas (FRED/EIA/sanctions), Educación (rss-proxy + clustering ONNX), Política (ACLED/UCDP/country-risk)
- [ ] **Media** — `packages/core/cii/` CII re-implementado + histórico/tendencias

## Fase 3 — Síntesis IA + correlación
- [ ] **Media** — Router completo `ollama → groq → claude` + personas/plantillas de briefing por dominio
- [ ] **Media** — `packages/core/signals/` motor de convergencia cross-domain *(⚠️ spike: lógica no servida por worldmonitor — ver INVESTIGACION-FUSION.md §9.1)*

## Fase 4 — Pulido (opcional)
- [ ] **Baja** — Sistema de variantes (Finanzas/Educación/Política)
- [ ] **Baja** — Empaquetado Tauri 2 (app nativa) *(⚠️ verificar toolchain Windows)*
