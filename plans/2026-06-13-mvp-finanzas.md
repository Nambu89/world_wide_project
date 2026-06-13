---
version: alpha
name: plan-mvp-finanzas
description: Plan de implementación del MVP Finanzas (Fase 1) derivado del design-doc 2026-06-13-mvp-finanzas. 7 tareas en 6 waves, lock por disjunción de files_modified, verify <60s por tarea. Las referencias a ADR-NNN/D-NNN son trazabilidad de cobertura (no definiciones); cada decisión se DEFINE en plans/DECISIONS.md o en el design-doc. Pendiente de /check-plan.
status: draft
date: 2026-06-13
owner: pm-coordinator
---

# Plan de Implementación — MVP Finanzas

- **Fecha:** 2026-06-13
- **Autor:** PM Coordinator
- **Design-doc fuente:** [docs/design/2026-06-13-mvp-finanzas.md](../docs/design/2026-06-13-mvp-finanzas.md)
- **Estado:** Pendiente de `/check-plan` (gate PREVIO) → aprobación del usuario → implementación
- **Decisiones bloqueadas:** ADR-001..007 ([plans/DECISIONS.md](DECISIONS.md)) + D-001..008 + D-100..108 (design-doc §Decisions)

## Goal (Objetivo)

Cerrar un flujo de punta a punta del dominio **Finanzas**: ingesta keyless → persistencia time-series libSQL local → API sólo-lectura → web MapLibre + panel → briefing diario IA cacheado. Demostrar el diferencial del proyecto (histórico en DB local que la UI consume, no fetch a upstream). Alcance = Fase 1 del [ROADMAP](ROADMAP.md).

## Decisiones internas ratificadas (OQ-1..6 del design-doc)

El PM acepta las recomendaciones del architect:

- **OQ-1 → D-100:** schema **wide-tipado** (tablas por dominio con columnas tipadas), no EAV.
- **OQ-2 → D-102:** retención **90 días crudos + downsampling a agregados diarios**, purga en tier `daily`.
- **OQ-3 → D-103:** **4 tiers** `fast`/`medium`/`slow`/`daily`, intervalos configurables.
- **OQ-4 → D-105:** persona "analista financiero" + plantilla de secciones fijas (Qué se movió / Por qué / Qué vigilar); el `intel-analyst` congela su forma en T-05.
- **OQ-5 → D-107:** paquetes pnpm planos `@www/*` + `server.ts` raíz.
- **OQ-6 → D-108:** panel lateral + sparkline del histórico + capa de eventos GDELT en el mapa.

## Quality Gates (obligatorios)

- **PREVIO:** este plan NO se presenta al usuario sin `plan-checker = PASS`.
- **POSTERIOR:** ninguna tarea se marca completada sin `verifier = VERIFIED`; verificación contra `git diff`/salida real, no contra el chat.
- **Frontera de integración:** sólo el PM (con aprobación humana) hace commit/push. Los especialistas implementan, verifican y reportan.
- **Loop creator↔checker:** máx. 3 iteraciones por tarea; si los issues no decrecen, escala a gate humano.

---

## Tasks (Tareas)

> Cada tarea tiene front-matter con `depends_on` + `files_modified` (la disjunción de ficheros es el lock). `verify_cmd` debe terminar <60s (Nyquist). El agente devuelve `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED` + ficheros + salida-de-verify literal + Self-Report.

### T-01 — Bootstrap del entorno

```yaml
id: T-01
description: Workspace pnpm + tsconfig + skeletons de paquetes con sus deps + .venv Python reservado + .gitignore + .env
agent: backend-architect
wave: 1
depends_on: []
files_modified:
  - package.json                      # raíz, scripts -w + build
  - pnpm-workspace.yaml               # globs: 'packages/*', 'packages/core/*'
  - tsconfig.base.json
  - .gitignore                        # añade node_modules/, .venv/, data/, .env
  - packages/store/package.json       # dep: @libsql/client
  - packages/store/tsconfig.json
  - packages/connectors/package.json  # dep: fast-xml-parser (RSS de news)
  - packages/connectors/tsconfig.json
  - packages/scheduler/package.json
  - packages/scheduler/tsconfig.json
  - packages/core/ai/package.json     # dep: @anthropic-ai/sdk
  - packages/core/ai/tsconfig.json
  - packages/web/package.json         # deps: vite, react, react-dom, maplibre-gl
  - packages/web/tsconfig.json
  - tools/py/                         # .venv Python 3.12 reservado (vacío en MVP)
  - .env                              # derivado de .env.example (ANTHROPIC_API_KEY, DB url)
boundaries:
  - "NO escribas lógica de producto aún: solo skeletons (package.json + tsconfig + index.ts vacío exportable por paquete)."
  - "NO commitees .env ni .venv (van a .gitignore)."
constraints:
  - "ADR-007: workspace pnpm para el producto TS + .venv Python 3.12 en tools/py/ reservado (vacío)."
  - "ADR-006: la dep de DB es @libsql/client; PROHIBIDO better-sqlite3."
  - "ADR-005: la dep de IA es @anthropic-ai/sdk (rama claude activa del router)."
  - "feedback_secrets: keys solo en .env (en .gitignore); leer de process.env; nunca secretos en strings de comandos."
  - "GAP-2: confirma el set de variables de .env contra .env.example y .claude/SECRETS.md; debe incluir al menos ANTHROPIC_API_KEY y la URL libSQL (file:./data/world.db)."
  - "Subset .env aplicable al MVP: ANTHROPIC_API_KEY + LIBSQL_URL=file:./data/world.db. SECRETS.md lista además TURSO_DATABASE_URL/TURSO_AUTH_TOKEN (set canónico del proyecto, NO usados en MVP — migrar a Turso remoto = cambiar la URL, ADR-006). Documenta esta distinción en .env para no confundir al implementador."
  - "Cada package.json declara YA sus deps (arriba) para que las tareas posteriores no toquen package.json → locks de wave limpios."
  - "Nombres de paquete: @www/store, @www/connectors, @www/scheduler, @www/core-ai, @www/web."
acceptance:
  - "pnpm install resuelve el workspace sin error; los 5 paquetes aparecen en `pnpm -r list`."
  - "Valida R-1 (toolchain Windows): @libsql/client carga en este Windows; documenta la versión que funciona. Si el binario nativo falla → reporta NEEDS_CONTEXT con el error literal (opción: cliente WASM de libSQL, sigue siendo @libsql/client/file)."
  - "tsc base compila los skeletons sin error."
verify_cmd: "node -e \"require('@libsql/client'); require('@anthropic-ai/sdk')\" && pnpm -r exec tsc --noEmit"
```

### T-02 — `packages/store/` schema time-series + migraciones + API

```yaml
id: T-02
description: Schema libSQL wide-tipado (5 tablas) + migraciones idempotentes + API del paquete @www/store
agent: backend-architect
wave: 2
depends_on: [T-01]
files_modified:
  - packages/store/src/index.ts
  - packages/store/src/db.ts
  - packages/store/src/types.ts          # MarketSnapshot, GdeltEvent, NewsItem, Briefing
  - packages/store/src/migrate.ts
  - packages/store/migrations/001_init.sql
  - packages/store/test/store.test.ts
boundaries:
  - "NO toques otros paquetes ni server.ts."
constraints:
  - "ADR-006/D-005: @libsql/client con url file:./data/world.db. PROHIBIDO better-sqlite3."
  - "D-100 (wide-tipado): tablas market_snapshots, gdelt_events, news_items, briefings, market_daily (schema normativo en design-doc §Interfaces)."
  - "D-101: cada fila con captured_at (epoch ms) + source; índice compuesto ix_market_trend (source, symbol, captured_at)."
  - "D-102: API purgeAndDownsample(beforeMs) para retención 90d + agregados diarios."
  - "ADR-004/D-003: este paquete es la fuente de verdad de la UI; expone lecturas para histórico (getMarketTrend)."
  - "Migraciones idempotentes (tabla _migrations con ids aplicados); migrate() corre al boot sin duplicar."
acceptance:
  - "Exporta la API normativa del design-doc: getDb, migrate, insertMarketSnapshots/GdeltEvents/NewsItems, getLatestMarkets, getMarketTrend, getCachedBriefing, saveBriefing, purgeAndDownsample."
  - "migrate() es idempotente (correr 2× no falla ni duplica filas/tablas)."
  - "getCachedBriefing devuelve null si valid_until expiró."
verify_cmd: "pnpm --filter @www/store exec tsc --noEmit && node --test packages/store/test"
```

### T-03a — Conector `finance/markets`

```yaml
id: T-03a
description: Conector keyless de mercados (Yahoo/CoinGecko) patrón osiris con fallback multinivel + stale desde store
agent: data-connector-dev
wave: 3
depends_on: [T-02]
files_modified:
  - packages/connectors/finance/markets.ts
  - packages/connectors/finance/markets.test.ts
boundaries:
  - "NO toques otros conectores, ni store, ni scheduler, ni package.json (deps ya declaradas en T-01)."
constraints:
  - "Patrón osiris: fetch + User-Agent + AbortSignal.timeout(8000) + fallback multinivel + retorno vacío gracioso (nunca throw al caller)."
  - "D-104: fallback Yahoo v8 → Yahoo v6 → último snapshot del store (markets-stale) → vacío gracioso; cache condicional ETag/If-None-Match (304 reusa)."
  - "D-007/ADR zero-key: keyless; sin keys."
  - "feedback_data_tos: registra el ToS (Yahoo/CoinGecko keyless = ToS-gris, uso personal, marcar frágil). Si no verificable → escala al PM."
  - "Devuelve ConnectorResult<MarketSnapshot> { data, stale, fetchedAt }; importa el tipo de @www/store."
acceptance:
  - "Sin red, fetchMarkets() devuelve { data:[], stale:true|false, fetchedAt } sin lanzar."
  - "Log explícito en cada caída de nivel (no catch silencioso) — R-4."
verify_cmd: "pnpm --filter @www/connectors exec tsc --noEmit && node --test packages/connectors/finance"
```

### T-03b — Conector `geo/gdelt`

```yaml
id: T-03b
description: Conector keyless GDELT 2.0 patrón osiris (eventos como contexto del briefing/mapa)
agent: data-connector-dev
wave: 3
depends_on: [T-02]
files_modified:
  - packages/connectors/geo/gdelt.ts
  - packages/connectors/geo/gdelt.test.ts
boundaries:
  - "NO toques otros conectores, ni store, ni scheduler, ni package.json."
constraints:
  - "Patrón osiris (fetch + User-Agent + AbortSignal.timeout(8000) + fallback + retorno vacío gracioso)."
  - "NG-2: GDELT entra como CONTEXTO del dominio Finanzas (no dominio propio, sin scoring de convergencia — eso es GAP-1)."
  - "feedback_data_tos: GDELT 2.0 = dato público keyless, ToS permisivo; regístralo."
  - "Devuelve ConnectorResult<GdeltEvent>; importa el tipo de @www/store; campos lat/lon/category/severity para la capa de mapa."
acceptance:
  - "Sin red, fetchGdelt() devuelve resultado vacío gracioso sin lanzar."
verify_cmd: "pnpm --filter @www/connectors exec tsc --noEmit && node --test packages/connectors/geo"
```

### T-03c — Conector `edu/news`

```yaml
id: T-03c
description: Conector keyless RSS curado con allowlist SSRF-safe patrón osiris
agent: data-connector-dev
wave: 3
depends_on: [T-02]
files_modified:
  - packages/connectors/edu/news.ts
  - packages/connectors/edu/allowlist.ts
  - packages/connectors/edu/news.test.ts
boundaries:
  - "NO toques otros conectores, ni store, ni scheduler, ni package.json."
constraints:
  - "Patrón osiris (fetch + User-Agent + AbortSignal.timeout(8000) + fallback + retorno vacío gracioso)."
  - "R-7: valida CADA URL de feed contra una allowlist de dominios (SSRF-safe) ANTES de fetch."
  - "Usa fast-xml-parser (dep declarada en T-01) para el RSS."
  - "feedback_data_tos: cada feed con su licencia; allowlist limita a dominios con ToS de RSS personal verificado; CC-BY → atribución (anótalo para la UI)."
  - "Devuelve ConnectorResult<NewsItem>; importa el tipo de @www/store."
acceptance:
  - "Una URL fuera de la allowlist NO se fetchea (rechazo verificable en test)."
  - "Sin red, fetchNews() devuelve vacío gracioso sin lanzar."
verify_cmd: "pnpm --filter @www/connectors exec tsc --noEmit && node --test packages/connectors/edu"
```

### T-05 — `packages/core/ai/` router LLM + briefing diario

```yaml
id: T-05
description: Router LLM cadena íntegra (rama claude activa) + briefing diario cacheado, grounded desde el store
agent: intel-analyst
wave: 3
depends_on: [T-02]
files_modified:
  - packages/core/ai/src/index.ts
  - packages/core/ai/src/router.ts          # resolveChain, complete
  - packages/core/ai/src/briefing.ts        # serializeContext, generateDailyBriefing
  - packages/core/ai/src/persona.ts         # persona "analista financiero" + plantilla
  - packages/core/ai/test/ai.test.ts
boundaries:
  - "NO toques store (consúmelo por su API @www/store), ni connectors, ni server.ts."
constraints:
  - "ADR-002/D-001: re-implementa la metodología del PROVIDER_CHAIN; NUNCA copies fuente AGPL de worldmonitor."
  - "ADR-005/D-004: chain ['ollama','groq','claude'] implementada íntegra con health-gating + fall-through por key ausente; rama ACTIVA = claude (Anthropic SDK, key de process.env). ollama/groq → available:false por key ausente en MVP."
  - "D-105: briefing = serializeContext (desde el STORE via getLatestMarkets/getMarketTrend + eventos GDELT, NO upstream) → persona analista financiero → plantilla (Qué se movió / Por qué / Qué vigilar)."
  - "D-106: getCachedBriefing primero; si expiró → complete() → saveBriefing con valid_until = now + 24h. NO disparar Anthropic si hay caché válida."
  - "R-2: si Anthropic no responde, el router degrada (no rompe): sirve el último briefing cacheado o estado 'briefing no disponible'."
  - "OQ-4: congela la forma de persona/plantilla en este paquete."
acceptance:
  - "resolveChain() marca ollama/groq available:false (key ausente) y claude available según ANTHROPIC_API_KEY."
  - "generateDailyBriefing() con caché válida NO llama a Anthropic (verificable con un mock que cuenta llamadas)."
  - "serializeContext lee del store, no de upstream."
verify_cmd: "pnpm --filter @www/core-ai exec tsc --noEmit && node --test packages/core/ai/test"
```

### T-04 — `packages/scheduler/` loop server-side por volatilidad

```yaml
id: T-04
description: Scheduler server-side con 4 tiers por volatilidad; cada job persiste en store antes de servir
agent: backend-architect
wave: 4
depends_on: [T-02, T-03a, T-03b, T-03c]
files_modified:
  - packages/scheduler/src/index.ts
  - packages/scheduler/src/scheduler.ts
  - packages/scheduler/src/jobs.ts
  - packages/scheduler/test/scheduler.test.ts
boundaries:
  - "NO toques server.ts (el cableado es T-06), ni los conectores, ni el store internamente (consúmelos por su API)."
constraints:
  - "ADR-004/D-003: server-side, SIN fanout en el navegador. Cada job: fetch conector → persiste en store ANTES de exponer."
  - "D-103: 4 tiers fast(markets ~5min) / medium(gdelt ~15min) / slow(news ~30min) / daily(briefing + purgeAndDownsample, 24h). Intervalos CONFIGURABLES (no hardcodeados dentro del run)."
  - "El tier daily invoca generateDailyBriefing (@www/core-ai) y purgeAndDownsample (@www/store)."
  - "createScheduler(jobs) expone { start, stop }."
acceptance:
  - "Un job de test corre, persiste en store (mock o libSQL temporal) y es parable con stop()."
  - "Los intervalos se leen de config, no de literales dentro de run()."
  - "Un job del tier daily invoca generateDailyBriefing (@www/core-ai) Y purgeAndDownsample (@www/store) (verificable con mocks que cuentan llamadas)."
verify_cmd: "pnpm --filter @www/scheduler exec tsc --noEmit && node --test packages/scheduler/test"
```

### T-06 — `server.ts` cableado connectors + scheduler + api

```yaml
id: T-06
description: Servidor Node único que cablea migrate + scheduler + API sólo-lectura con pipeline de seguridad
agent: backend-architect
wave: 5
depends_on: [T-02, T-04, T-05]
files_modified:
  - server.ts          # MVP: todo el routing+middleware vive aquí (Node single-server, sin paquete api aparte)
  - server.test.ts
boundaries:
  - "FICHERO DE ALTO CONFLICTO: server.ts se toca en serie, nunca en paralelo con otra tarea."
  - "NO reimplementes lógica de store/scheduler/ai: impórtala y cabléala."
constraints:
  - "ADR-004/G-7: boot = migrate() → registra conectores → scheduler.start() → http api."
  - "Pipeline de middleware (orden normativo): origin-check → CORS → rate-limit → SSRF-guard (solo rutas que fetchean por dominio) → route."
  - "Endpoints SÓLO-LECTURA del store: GET /api/markets, /api/markets/:symbol (sparkline), /api/gdelt, /api/briefing, /api/health."
  - "D-106: /api/briefing devuelve getCachedBriefing — NUNCA dispara Anthropic on-request."
  - "R-7: SSRF-guard activo para cualquier ruta que resuelva dominios."
acceptance:
  - "GET /api/health responde 200 con estado de scheduler + store."
  - "GET /api/markets lee del store (no de upstream)."
  - "/api/briefing no provoca llamada a Anthropic (verificable)."
verify_cmd: "pnpm -w exec tsc --noEmit && node --test ./server.test.ts"
```

### T-07 — `packages/web/` MapLibre config-array + panel Finanzas

```yaml
id: T-07
description: Web Vite+React+MapLibre con config-array central de capas + panel lateral de Finanzas con sparkline
agent: frontend-dev
wave: 6
depends_on: [T-06]
files_modified:
  - packages/web/index.html
  - packages/web/vite.config.ts
  - packages/web/src/main.tsx
  - packages/web/src/App.tsx
  - packages/web/src/map/layers.config.ts     # config-array central declarativo
  - packages/web/src/map/MapView.tsx           # itera LAYERS, nunca map.on('load') imperativo
  - packages/web/src/panels/FinancePanel.tsx   # lista + sparkline + loading/empty/error
  - packages/web/src/api/client.ts             # consume /api/* local
boundaries:
  - "NO toques server.ts ni los paquetes backend; consume solo la API HTTP."
constraints:
  - "ADR-003/D-008/feedback_central_layer_config: TODA capa MapLibre declarada en layers.config.ts (LayerSpec[]); el componente ITERA el array. PROHIBIDO map.on('load') imperativo disperso."
  - "D-003/D-108: la web lee SOLO de /api/* (nunca upstream). Panel: lista de instrumentos + sparkline del histórico (de /api/markets/:symbol) + estados loading/empty/error explícitos. Capa de eventos GDELT en el mapa."
  - "El sparkline demuestra el histórico (el diferencial del proyecto)."
  - "ADR-008: UI responsive + mobile-first. Diseña primero ~375px y escala a ~1200px. En móvil el panel de Finanzas es drawer/colapsable sobre el mapa (que ocupa el viewport); en desktop es panel lateral. Breakpoints en el sistema de estilos central, NO inline dispersos."
acceptance:
  - "vite build compila sin error."
  - "Añadir una capa = añadir una entrada en layers.config.ts (verificable: el render itera el array)."
  - "El panel maneja los 3 estados (loading/empty/error) explícitamente."
  - "Usable a 375px (móvil) y 1200px (desktop): el panel colapsa/es drawer en móvil sin romper el mapa (verificable por el qa-tester con viewports 375/1200)."
verify_cmd: "pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build"
```

---

## Wave Scheduler (paralelización segura)

La disjunción de `files_modified` es el lock. Paralelo dentro de wave, secuencial entre waves.

| Wave | Tareas (paralelas) | Agente(s) | Justificación lock |
|------|--------------------|-----------|--------------------|
| 1 | T-01 | backend-architect | Bootstrap; bloquea todo. Crea skeletons + deps → locks limpios después. |
| 2 | T-02 | backend-architect | Store = base de connectors/scheduler/ai/api. |
| 3 | T-03a · T-03b · T-03c · T-05 | data-connector-dev ×3 + intel-analyst | Todas dependen solo de T-02; ficheros disjuntos (3 conectores distintos + packages/core/ai). |
| 4 | T-04 | backend-architect | Scheduler orquesta connectors→store (necesita los 3 conectores + store). |
| 5 | T-06 | backend-architect | server.ts (alto conflicto) cabléa store+scheduler+ai. Serial. |
| 6 | T-07 | frontend-dev | Web consume la API de T-06. |

Orden serial seguro (1 dev): `1 → 2 → (3a‖3b‖3c‖5) → 4 → 5 → 6`.
Ficheros de alto conflicto a serializar: `server.ts`, `layers.config.ts`, migraciones del store.

## Matriz de cobertura (decisión → tarea)

| Decisión | Tarea(s) |
|----------|----------|
| ADR-001/002 · D-001 (no AGPL, re-implementar) | T-05 (router) |
| ADR-003 · D-002 (stack) | T-01, T-06, T-07 |
| ADR-004 · D-003 (scheduler+store, UI lee DB) | T-02, T-04, T-06, T-07 |
| ADR-005 · D-004 (router íntegro, claude activo) | T-01 (dep), T-05 |
| ADR-006 · D-005 (@libsql/client file://) | T-01 (dep), T-02 |
| ADR-007 · D-006 (pnpm + .venv) | T-01 |
| D-007 (zero-key conectores) | T-03a, T-03b, T-03c |
| D-008/D-108 (config-array de capas) | T-07 |
| D-100/101 (wide-tipado + índice tendencia) | T-02 |
| D-102 (retención 90d + downsampling) | T-02, T-04 |
| D-103 (4 tiers) | T-04 |
| D-104 (cache ETag + stale) | T-03a |
| D-105/106 (briefing pipeline + caché 24h) | T-05, T-06 |
| D-107 (monorepo plano @www/*) | T-01 |
| feedback_data_tos | T-03a, T-03b, T-03c |
| feedback_secrets | T-01 |
| R-1 (libSQL Windows) | T-01 (validar) |
| R-7 (SSRF) | T-03c, T-06 |

## Risks (riesgos del design-doc → tarea que mitiga)

| Riesgo | Mitigación | Tarea |
|--------|-----------|-------|
| R-1 toolchain Windows: libSQL nativo puede fallar el build | Validar carga de `@libsql/client` en este Windows en bootstrap; fallback cliente WASM (sigue siendo `@libsql/client`/file) | T-01 |
| R-2 Anthropic SDK tras proxy SVAN | El router degrada (no rompe): sirve último briefing cacheado o "no disponible" | T-05 |
| R-4 endpoints markets no documentados rompen en silencio | Fallback multinivel + `stale` desde store + log explícito (no catch silencioso) | T-03a |
| R-5 coste Anthropic no medido | Caché 24h + tier `daily` único (≤1 llamada/día); medir tras 1ª semana | T-05, T-04 |
| R-6 crecimiento time-series | Retención 90d + downsampling diario | T-02, T-04 |
| R-7 SSRF en news | Allowlist de dominios + SSRF-guard en server.ts | T-03c, T-06 |
| R-8 deriva AGPL accidental al re-implementar router | feedback_no_agpl_copy; revisión del `verifier` | T-05 |

## Fuera de alcance (Non-Goals del design-doc — NO se implementan)

Convergencia cross-domain (GAP-1/§9.1), CII/señales, Educación/Política completas, conectores con key, ramas ollama/groq activas, Turso remoto, ML cliente, Tauri, MCP, CI/E2E Playwright. Razón en design-doc §Non-Goals.

## Verificación final (tras todas las tareas)

1. Confirmar artefactos en disco + `git diff` (no regexear el chat).
2. `pnpm -w exec tsc --noEmit` global en verde.
3. `/verify` (agente `verifier`, goal-backward): caza stubs/TODO/catch vacío; comprueba wiring real (conector→store, job→scheduler, capa en config-array, panel importado, ruta en server.ts); confirma que `/api/briefing` no dispara Anthropic.
4. Solo se reporta "MVP Fase 1 completado" con `verifier = VERIFIED`.
