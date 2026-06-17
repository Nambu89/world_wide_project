# /check-plan — AI Insights Slice B (2026-06-17)

**Plan:** `plans/2026-06-17-ai-insights.md`
**Verdict:** ISSUES_FOUND — 1 ISSUE (blocking), 4 WARNINGs (non-blocking)
**Resolution (PM, 2026-06-17):** I-1 FIXED — added the `generateInsights` cache short-circuit test (8th, seeds intel briefing in :memory: + asserts no-LLM path) + `LIBSQL_URL=':memory:'` header. W-3 FIXED — removed dead `FALLBACK_MODEL`. W-4 already satisfied (barrel exports `generateInsights`). W-1/W-2 acknowledged (non-blocking). → Gate now **PASS**.

Wiring verified against the live codebase (router/briefing/store/scheduler/server/web). The
architecture is faithful to D-701..D-707 and the briefing pipeline it mirrors. One real
coverage gap blocks PASS; the rest are warnings the worker should heed but that do not block.

---

## Verificacion contra el codigo real (claims del plan confirmados)

- **Root `package.json` ya depende de `@www/core-ai`** — CONFIRMADO (`package.json:21` `"@www/core-ai": "workspace:*"`). El `import { parseInsights } from '@www/core-ai'` de Task 3 resuelve.
- **`@www/store` exporta todo lo que insights.ts importa** — CONFIRMADO: `getCachedBriefing`, `saveBriefing`, `migrate`, `getLatestMarkets`, `getLatestCii`, `getLatestConvergence`, `getLatestSanctions`, `getLatestChokepointStatus`, `type Briefing` (todos en `packages/store/src/index.ts`).
- **`./router.js` exporta `complete` + `pickProvider`** — CONFIRMADO (`router.ts:70,97`). El patron pickProvider→null→throw que usa generateInsights replica briefing.ts:348-351 exactamente.
- **`./briefing.js` exporta `buildRiskContext`/`buildConvergenceContext`/`buildSanctionsContext`** — CONFIRMADO (barrel `index.ts:25-32`). Las firmas `Parameters<typeof build*Context>[0]` que usa `buildIntelContext` son validas (cada una toma `CiiSnapshotRow[]`/`ConvergenceSignalRow[]`/`SanctionRow[]`).
- **Contratos de tipo store ↔ engine** — CONFIRMADO: `ChokepointStatusRow = {chokepointId, status:'calm'|'watch'|'disrupted', score, ...}` (`types.ts:193`) coincide con la firma de `buildChokepointContext`; `MarketSnapshot.change_pct: number|null` (`types.ts:98`) coincide con el filtro `buildIntelContext` (`m.change_pct != null && |..|>=1`).
- **`getCachedBriefing(domain, 0)` = sirve la ultima aunque stale** — CONFIRMADO: SQL `valid_until > ?` con `?=0` pasa todas las filas (`valid_until` siempre epoch>0), `ORDER BY created_at DESC LIMIT 1` (`index.ts:158-181`). Identico al `getStaleCache` de briefing.ts:402-407. El reuso `domain='intel'` es consistente save (T1 `saveBriefing`) ↔ read (T3 endpoint + T1 short-circuit).
- **Scheduler engancha donde dice el plan** — CONFIRMADO: `SchedulerDeps` (`scheduler/src/index.ts:185`), `REAL_STORE_AI_DEPS` (Pick union + object literal, `:233-264`), `dailyJob.run()` hace briefing→purge (`:572-587`). El plan inserta `generateInsights` despues — orden correcto (contexto poblado por jobs non-daily ya awaited en boot, `:130-136`).
- **server.ts patron de ruta** — CONFIRMADO: `if (pathname === '/api/xxx') { ...; return; }` + `getCachedBriefing('finance', Date.now())` ya en uso (`server.ts:252-254`). El endpoint NO dispara LLM (solo `getCachedBriefing('intel', 0)` + `parseInsights`) — cumple ADR-004.
- **Web: 6 tabs existentes, 7a = intel** — CONFIRMADO (`App.tsx:59` PanelTab union; tabs finance/events/radar/risk/convergence/chokepoints). "Rutas" = chokepoints tab; "Inteligencia" va despues. Harness E2E base existe (`chokepoints-e2e.mjs`).

---

## ISSUE (bloqueante)

- **I-1 (cobertura de test de `generateInsights` cache-short-circuit FALTA):**
  La File Structure (linea 25) y el Self-Review (linea 456) AFIRMAN que `insights.test.ts`
  cubre el "cache short-circuit", y el check item 4 lo exige explicitamente. Pero el listado
  real de tests de **Task 1 Step 3** (lineas 231-277) solo cubre `parseInsights` (5 casos),
  `buildChokepointContext` (1) y `buildIntelContext` empty (1) = 7 tests. **No hay ningun test
  de `generateInsights`** que pruebe el short-circuit (`getCachedBriefing(DOMAIN, now)!==null →
  parseInsights(cached.body_md)` sin LLM, insights.ts:176-177). Es el unico camino de
  `generateInsights` testeable de forma determinista sin key (la rama LLM no es exigible).
  **Evidencia:** `insights.test.ts` declarado en File Structure como "cache short-circuit"
  pero Step 3 no lo implementa; Step 4 dice "→ 7 PASS" (cuenta solo los 7 puros).
  **Remediacion:** anadir a Task 1 Step 3 un test que inyecte/seedee un briefing
  `domain='intel'` con `valid_until>now` en una DB `:memory:` (reset entre tests, patron
  [[project_core_ai_t05]]) y verifique que `generateInsights()` devuelve las tarjetas
  parseadas SIN proveedor (sin `OPENAI_API_KEY`). Subir el conteo a "→ 8 PASS" y Step 1 de
  Task 5 a "core-ai +8". Si el worker prefiere no tocar la DB en core-ai, al menos corregir
  la File Structure y el Self-Review para NO afirmar una cobertura que no existe (afirmacion
  de cobertura superficial — burden of proof).

---

## 5 Dimensiones

1. **Cobertura de requisitos** — PASS con I-1. Engine+parser (T1) · daily-job generation (T2) · endpoint solo-lectura (T3) · panel+7a tab (T4) · verify+smoke+E2E (T5). Requisito implicito anti-alucinacion (D-704) cubierto en codigo (temp 0.3, contexto=senales reales, parseo defensivo). Gap: el test del short-circuit afirmado no se implementa (I-1).
2. **Completitud de tareas** — PASS con WARNINGs. Pasos TDD con codigo real ejecutable; cada task tiene verify <60s del stack (`node --import tsx --test ...`, `pnpm --filter ... build`, `tsc --noEmit`). `files_modified` declarados por task (header **Files:**). Web usa tsc+build+E2E (convencion repo correcta). W-2/W-3 abajo.
3. **Dependencias** — PASS. Orden correcto: core-ai (T1) → scheduler (T2) → server (T3) → web (T4) → verify (T5). Sin ciclos. `@www/core-ai` ya en root deps (no hace falta tocar package.json). D-707 respetado: insights.ts importa solo `@www/store` (`getLatestChokepointStatus` id+status+score) — NO `@www/core-signals` ni el config de chokepoints.
4. **Scope** — PASS. ~12 ficheros, 5 areas (core-ai, scheduler, server, web, plans) — bajo el umbral de 15. Sin migracion, sin nueva store-API (D-703 reuso `briefings`), sin connector nuevo, sin cambio en PROVIDER_CHAIN. Sin breaking en contratos publicos.
5. **Riesgos (D5)** — PASS con WARNINGs. Turso schema: NO (reuso `briefings`). PROVIDER_CHAIN: NO. Fuente sin ToS: NO (no hay fuente nueva; el LLM ya es ADR-009). Scheduler job nuevo: NO (extiende `dailyJob` existente). server.ts ruta nueva: SI (`/api/insights`, solo-lectura — wiring verificado). Seguridad: sin cambios.

---

## Fidelidad de decisiones bloqueadas (D-701..D-707)

| D-NN | Tarea / evidencia | Estado |
|------|-------------------|--------|
| D-701 tarjetas causa→efecto `{id,title,category,triggers,consequences,affected,severity,confidence}` ES | T1 `interface Insight` (insights.ts:60-69) + prompt JSON (`:113-128`) | OK |
| D-702 input=hotspots, 1 llamada LLM, 5-8 tarjetas, coste acotado | T1 `buildIntelContext` (top-signal) + `complete(..., {maxTokens:2000})` 1 sola llamada + prompt "5-8" | OK |
| D-703 reusa `briefings` domain='intel', body_md=JSON, NO migracion/store-API | T1 `saveBriefing({domain:'intel', body_md:JSON.stringify})` + T3 `getCachedBriefing('intel',0)` | OK |
| D-704 anti-alucinacion (contexto real, citar disparadores, temp 0.3, parseo defensivo) | T1 INTEL_PERSONA + prompt + `temperature:0.3` + `parseInsights` descarta malformadas | OK |
| D-705 modelo por env, sin key→vacio gracioso | T1 `process.env['OPENAI_MODEL']` (nunca hardcodeado) + `pickProvider()===null→[]` + endpoint/panel/E2E gestionan vacio | OK |
| D-706 7a tab "Inteligencia", map-tie DIFERIDO a slice C | T4 Step 3 ("No new map state, map-tie deferred to C") | OK |
| D-707 core-ai NO depende de core-signals (chokepoints solo id+status via getLatestChokepointStatus) | T1 import solo `@www/store` — verificado contra el codigo | OK |

**NUNCA modelo hardcodeado:** CONFIRMADO. `generateInsights` etiqueta el modelo via
`openai/${process.env['OPENAI_MODEL']}` / `claude/${process.env['ANTHROPIC_MODEL']}`
(insights.ts:199-200), identico a briefing.ts:354-359. El router falla claro si falta
`OPENAI_MODEL` (router.ts:113-116). Cumple [[never-assume-llm-model]].

**Frases de erosion de scope:** ninguna (`v1`/`placeholder`/`se cablea despues`/`will be wired
later`/`implementacion basica` NO aparecen). "DEFERRED to slice C" es un diferimiento de
decision documentado (D-706), no erosion del entregable de este slice.

---

## WARNINGs (no bloquean)

- **W-1 (smoke timing / sin key, heredado):** insights requieren key LLM + que el daily job
  haya corrido. Endpoint+panel degradan a vacio (D-705); E2E acepta data O empty-state como
  PASS (L-5). Documentado en T5 Step 2/3. No es fallo.
- **W-2 (scaffolding IntelPanel.tsx no entregado como codigo completo):** T4 Step 2 da estados
  + clases + un sketch, no el componente entero ("Full component follows ChokepointsPanel
  scaffolding"). Es flag explicito y aceptable (mismo patron aprobado en el check de
  chokepoints, T7). El worker debe leer `ChokepointsPanel.tsx` y completar; tsc+build+E2E
  (T4 Step 5 / T5) lo cazan si queda incompleto.
- **W-3 (`FALLBACK_MODEL` const sin uso):** insights.ts:73 declara `FALLBACK_MODEL` y la nota
  (linea 212) admite que es dead code "for parity". Con `tsc` estricto del repo
  (`noUnusedLocals` probable) puede romper el build. Remediacion: el worker debe borrarlo
  (la nota ya lo indica) — confirmar que Task 1 Step 5 build pasa.
- **W-4 (`migrate` doble-import en scheduler):** Task 2 dice "Import `generateInsights` from
  `@www/core-ai` (add to that import)". `@www/core-ai` debe exportar `generateInsights` por el
  barrel (T1 Step 2 lo hace). Confirmar que el barrel re-exporta `generateInsights` ademas de
  `parseInsights`/`type Insight` (T1 Step 2 los lista los tres) — OK por construccion, pero es
  el unico punto donde un olvido del barrel rompe T2 y T3 a la vez.

---

## Coherencia de tipos / ids

- `Insight` definido en T1 (core-ai, 8 campos) y re-tipado en T4 (web `RawInsight`/`Insight`,
  mismos 8 campos) — consistente. El view-model web transforma solo `generatedAt`
  (number→ISO string), el resto pasa directo. OK.
- `domain='intel'` consistente: T1 `const DOMAIN='intel'` (save) ↔ T3 `getCachedBriefing('intel',0)`
  (read) ↔ T3 seed test. OK.
- `parseInsights` compartido: definido T1, exportado por barrel, usado por T3 (server) y T1
  (short-circuit). Un solo parser, sin duplicacion. OK.

## Riesgos especificos (check item 4)

- **Parseo JSON del LLM defensivo:** SI — `parseInsights` strip de fences ```` ```json ````,
  acepta array O `{insights:[]}` wrapper, `try/catch JSON.parse → []`, descarta tarjetas sin
  title o sin consequences, defaults para severity/confidence/category/id. Robusto.
- **Coste:** 1 llamada, `maxTokens:2000`. Acotado (D-702). OK.
- **Sin LLM key → vacio gracioso:** endpoint (`cached?…:[]`), panel (empty-state copy), E2E
  (acepta empty) — triple cobertura. OK.
- **Reuso de `briefings` para JSON:** documentado (D-703, comentarios en codigo). Abuso
  aceptable y explicito (evita migracion/YAGNI). OK.
- **`generateInsights` testeable sin LLM:** parser SI (puro, bien cubierto); **cache
  short-circuit NO testeado** → ver **I-1**.

## Task 5 verificacion suficiente

PASS: tsc global (`pnpm -r exec tsc --noEmit`) + raiz (`npx tsc --noEmit -p tsconfig.json`) +
suite (`pnpm test` + `server.test.ts`) + build (filter web) + smoke vivo con `OPENAI_MODEL` +
browser E2E que acepta data-O-empty-state (L-5). Cubre todos los gates del repo. (Ajustar el
conteo "core-ai +7" a "+8" si se aplica la remediacion de I-1.)

---

## Recomendaciones

1. **Resolver I-1:** anadir el test de short-circuit de `generateInsights` (seed briefing
   intel en `:memory:` + assert sin proveedor) — o corregir File Structure/Self-Review para no
   afirmar una cobertura inexistente. Es lo unico que separa este plan de PASS.
2. Borrar `FALLBACK_MODEL` (W-3) antes del build de Task 1 Step 5.
3. Verificar que el barrel (T1 Step 2) exporta `generateInsights` (lo consumen T2 y T3).

## Linea para agent-comms.md

`## 2026-06-17T00:00:00Z [PLAN-CHECKER] [DONE] — Plan ai-insights (Slice B): ISSUES_FOUND, 1 issue (I-1 test cache-short-circuit falta), 4 warnings`
