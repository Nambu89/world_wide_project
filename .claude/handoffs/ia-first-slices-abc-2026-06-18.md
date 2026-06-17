---
name: ia-first-slices-abc-2026-06-18
date: 2026-06-18
project: world_wide_project
branch: main
summary: Visión IA-first — slices A (chokepoints) + B (motor insights IA) + C (app IA-first) CERRADOS y VERIFIED; falta slice D (mapa interactivo + español).
---

## Resume here — read this first
- La visión "IA-first" del usuario (la app abre mostrando inteligencia IA, no datos crudos) se troceó en 4 slices: **A chokepoints · B motor insights · C app IA-first · D mapa interactivo+español**. A/B/C están CERRADOS+VERIFIED+commiteados. **Empieza por el Slice D** (lo único que queda).
- **Slice D** = el usuario quiere: click en CUALQUIER punto del mapa → popup con su info **en castellano** (la IA traduce el texto libre) + **españolizar nombres** de países/provincias/ciudades. Arranca por brainstorming (proceso RPI: brainstorm→diseño→plan→/check-plan PASS→implementar→/verify).
- NO toques el motor de A/B/C ni los gates ya verdes; D es aditivo (interacción de mapa + i18n).

## Goal
Plataforma personal de inteligencia mundial; la fase actual (Fase 5 "IA-first") reorienta la app a abrir mostrando inteligencia sintetizada por IA (relacionar eventos→predecir consecuencias, chokepoints, etc.) con los datos crudos detrás del menú, mapa interactivo y UI en español.

## Key findings (this session)
- **Slice A — Chokepoints** (ADR-015, commit `2e5dfae`): dataset estático 12 estrechos `packages/core/signals/src/chokepoints.config.ts` (geometría+aliases+commodities+economías+`impactEs` documentado, NO conector) + `chokepoints.ts` (`haversineKm`, `scoreChokepoints` puro, `detectAllChokepoints` IO). Tabla `chokepoint_status` (migr **007**) + job medium (sibling de cii) + `GET /api/chokepoints` (status×config merge) + `CHOKEPOINT_LAYERS` círculo por status (ON default) + `ChokepointsPanel` (pestaña "Rutas") + map-tie `activeChokepoint`. server.ts ganó dep `@www/core-signals`.
- **Slice B — Motor insights IA** (ADR-016, commit `a1c8a9e`): `packages/core/ai/src/insights.ts` clona el pipeline del briefing → tarjetas estructuradas causa→efecto. **Reúsa la tabla `briefings` con `domain='intel'`, body_md=JSON** (sin migración). `buildIntelContext`/`buildInsightsPrompt`/`parseInsights`/`generateInsights`. Job daily llama generateInsights tras el briefing; `GET /api/insights` solo-lee la última tanda; `IntelPanel` (pestaña "Inteligencia").
- **Slice C — App IA-first** (ADR-017, commit `f6c4518`): "Inteligencia" 1ª pestaña + `activeTab` default `'intel'`. Schema `Insight` +`countries[]`(nombres inglés=claves CII)+`chokepoints[]`(ids), **emitidos por el LLM**; tarjetas clicables → `handleInsightSelect` (prioriza chokepoint, si no país) → map-tie. SIN cambio server/store (D-804).
- Patrón de gate cada slice: plan en `plans/` → plan-checker (dispatch con "escribe veredicto a disco PRIMERO" para esquivar truncado L-6) → implementar inline wave-by-wave → suite+tsc+web build+**smoke vivo**+**browser E2E**.

## Gotchas
- **L-5 "verde≠funciona" se materializó 2 veces más** (van 6): (A) 1er smoke chokepoints = 10/12 disrupted falsos — proximidad GDELT dominada por densidad de POBLACIÓN (Dover→Londres) + substring "dover"→"Andover" → fix: pesos name-primario + suelo severidad 50 + match por límite-de-palabra + aliases curados + **gate de naming para el rojo** (`nameScore>0`). (B) 1er smoke insights = 0 tarjetas — **gpt-5.x (reasoning) gasta presupuesto de completion en razonamiento oculto; `maxTokens=2000` TRUNCABA el JSON** → fix: 6000 + **salvage** (escaneo de llaves recupera tarjetas completas de array cortado). El smoke vivo lo cazó; los tests verdes no.
- **plan-checker truncaba por turnos (L-6)** hasta que se le instruyó "escribe el veredicto a disco PRIMERO, luego resumen ≤15 líneas" — desde entonces termina limpio.
- **`getEvents`/`getSignals` default `LIMIT 500`** (`packages/store/src/index.ts`) — para escaneos sobre toda la ventana hay que pasar límite explícito alto (chokepoints usa 20000). Lo cazó el plan-checker (B-1).
- **Scripts de smoke/debug deben vivir EN EL REPO**, no en /tmp — los workspace packages `@www/*` no resuelven desde /tmp. (Crea `._foo.mjs` en la raíz y bórralo después.)
- El **daily job** que genera insights corre tras `Promise.all(nonDaily)` en el boot; gpt-5.4 es lento y `markets` puede tardar → en el boot puede no haber disparado aún. Para smoke directo: `generateInsights()` contra la DB viva (el wiring del job está unit-tested).
- La caché de insights es 12h (`domain='intel'`); tras cambiar el schema de la tarjeta, el batch viejo cacheado no tiene los campos nuevos hasta regenerar (parseInsights re-parsea viejo→`[]` gracioso).
- Modelo LLM SIEMPRE por env (`OPENAI_MODEL`, gpt-5.4), NUNCA hardcodeado ([[never-assume-llm-model]]). Sin key → feeds IA vacíos graciosos.

## How to test & validate
```bash
# desde la raíz del repo
pnpm -r exec tsc --noEmit                      # paquetes
npx tsc --noEmit -p tsconfig.json              # raíz (server.ts)
pnpm test                                      # suite paquetes (338/0-fail)
node --import tsx --test server.test.ts        # server (66/66)
pnpm --filter @www/web build                   # web build
```
Pasa si: tsc paquetes+raíz EXIT 0, suite 338/0-fail, server 66/66, web build OK.
Smoke vivo (necesita `.env` con OPENAI_API_KEY+OPENAI_MODEL): `node --env-file-if-exists=.env --import tsx server.ts` (8787) + `cd packages/web && pnpm exec vite --port 5173`; abrir http://localhost:5173 (abre en "Inteligencia"). E2E: `node packages/web/{chokepoints,intel}-e2e.mjs` (con ambos servers arriba).

## Repo state
- Working tree LIMPIO (todo commiteado). Último commit: **`f6c4518`** (slice C) en `main`. Cadena: `2e5dfae` (A) → `a1c8a9e` (B) → `f6c4518` (C). NO pusheado (origin = github.com/Nambu89/world_wide_project).
- Migraciones: hasta **007_chokepoints.sql** aplicada. NO hay migración nueva pendiente (B reúsa briefings; C no toca store).
- Memorias auto actualizadas: `world-wide-project-goal.md`, `world-wide-data-feeds-state.md`, `MEMORY.md` (índice). Blackboard repo: `plans/ROADMAP.md` (Fase 5 A/B/C ✅), `plans/DECISIONS.md` (ADR-014..017), `claude-progress.txt`.

## Open threads / TODO
- [ ] (ALTA) **Slice D — mapa interactivo + español**: click en punto del mapa → popup info en castellano (IA traduce texto libre de eventos/señales) + `Intl.DisplayNames('es')` para países + españolizar provincias/ciudades. Brainstorming primero. ÚLTIMA pieza de la visión IA-first.
- [ ] (MEDIA, opcional) Anillo de highlight dedicado al hacer click en tarjeta de insight (hoy = flyTo + glifo + fila activa; diferido en C/D-803).
- [ ] (MEDIA) Pulir el daily-job boot: investigar por qué `markets` no logueó este boot y si bloquea el Promise.all(nonDaily) que retrasa la generación de insights.
- [ ] (DIFERIDO) Calibración fina chokepoints (umbrales/radios) y DIMENSION_SCALE convergencia (GAP-2) — tras ≥semanas de datos.
- [ ] (DIFERIDO, keyed) ACLED/UCDP (Política) + FRED/EIA (Finanzas macro) — necesitan API keys del usuario.
- [ ] (PENDIENTE usuario) `git push` de los 3 commits A/B/C a origin cuando quiera.

## Recent transcript (last ~10 turns)
Sesión retomó "Sigamos" → UI sanciones OFAC (ADR-014, `7a32f1e`) → usuario pidió visión grande "IA-first" (relacionar→predecir, chokepoints tipo Ormuz, mapa interactivo+español, noticias tras menú) → troceada en A/B/C/D → A chokepoints (smoke cazó 10/12 falsos rojos, recalibrado) commit+probado → B motor insights (smoke cazó 0 tarjetas por truncado gpt-5.x, fix maxTokens+salvage, 8 tarjetas reales) commit+probado → C app IA-first (Inteligencia 1ª+landing, tarjetas clicables map-tie, 7/8 con entidades) commit+probado → usuario: "actualiza todas las memorias y lo dejamos por hoy" → memorias+handoff. Siguiente sesión: Slice D.
