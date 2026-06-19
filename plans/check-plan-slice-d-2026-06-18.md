# Verificación del Plan — Slice D (Mapa interactivo + español)

- **Plan:** `plans/2026-06-18-slice-d-interactive-map-spanish.md`
- **Design-doc:** `docs/design/2026-06-18-slice-d-interactive-map-spanish.md` (ADR-018, D-900..D-908)
- **Fecha auditoría:** 2026-06-18
- **Auditor:** plan-checker (read-only)

## Veredicto: PASS (con 5 WARNINGS, 0 ISSUES bloqueantes)

El plan está completo, fiel a las decisiones bloqueadas, sin scope-creep ni frases de erosión, y cada
pieza cierra con verificación real (test/curl/E2E). Los gotchas declarados se han comprobado contra el
código real del repo y son correctos. Los hallazgos abiertos son WARNINGS (precisiones para el
implementador), ninguno bloquea el PASS.

---

## D1 — Cobertura de requisitos

| Requisito | Cubierto por | Estado |
|-----------|--------------|--------|
| G1 Mapa interactivo (click→popup cualquier punto) | T4 (popup.ts + MapView click handler + INTERACTIVE_LAYER_IDS) | OK |
| G2 Traducción on-demand (botón → POST cache-first) | T1 store + T2 server + T3 client + T4 botón | OK |
| G3 Cache de traducciones (migr 008 + dedupe) | T1 (008_translations.sql + get/put) | OK |
| G4 Países en español (localizeCountry + aplicación) | T3 (i18n/countries.ts) + T5 (aplicación en paneles) | OK |
| G5 UI español (5 pestañas + 7 paneles + aria) | T5 | OK |
| G6 Smoke EN VIVO + browser E2E | T6 | OK |

Las **3 piezas** de la consigna están cubiertas con verificación:
- **D1 click→popup+traducción:** T4 (popup) + curl T6 + E2E T6 step 3(a-c).
- **D2 países ES:** T3 (test unit Japan→Japón/Russia→Rusia/fallback) + smoke T6 (caza mismatches → COUNTRY_ALIASES).
- **D3 UI español:** T5 + E2E T6 step 3(d) ("la 2ª pestaña dice Finanzas").

Requisitos implícitos cubiertos: degradado graceful sin LLM (D-907), guard de longitud (D-902),
cache-first anti-doble-coste (D-903). Sin requisitos huérfanos.

## D2 — Completitud de tareas

| Tarea | Acción clara | Verify <60s | files_modified | Estado |
|-------|--------------|-------------|----------------|--------|
| T1 Store cache | Sí (CREATE TABLE + 2 helpers con código) | Sí (`pnpm --filter @www/store test`) | Sí | OK |
| T2 POST /api/translate | Sí (readJsonBody + ruta + guard + CORS, con código) | Sí (`node --import tsx --test server.test.ts`) | Sí | OK |
| T3 Client + i18n | Sí (apiFetch+init, translate, localizeCountry) | Sí (`tsc --noEmit` + countries.test) | Sí | OK |
| T4 Popup + MapView | Sí (buildPopupNode + click handler + cursor) | Sí (`tsc --noEmit && build`) | Sí | OK |
| T5 UI español | Sí (pestañas + 7 paneles + aria, literal in-place) | Sí (`tsc --noEmit && build`) | Sí | OK |
| T6 Verify + smoke + E2E | Sí (gates + curl + Playwright + ADR) | Sí (suite + E2E) | Sí | OK |

Todos los verify son comandos reales del stack que terminan <60s (la suite y los builds por paquete son
rápidos; el E2E vivo de T6 es el cierre obligatorio L-5, no un gate de <60s sino la red de seguridad).
`files_modified` declarado en el bloque "File Structure" + per-task headers.

## D3 — Dependencias

Orden declarado: store (T1, indep) → server (T2, dep store+core-ai) → client+i18n (T3) → popup+MapView
(T4, dep client+i18n) → UI español (T5, indep/paralelizable) → verify (T6). **Sin ciclos.** El grafo es
correcto y respeta el flujo de datos popup→client→server→store/core-ai. Dependencia externa
(OPENAI_API_KEY) tratada explícitamente: sin key, T2 caso (a) y E2E aceptan `{translated:null}` 200
(degradado D-907) — no bloquea.

## D4 — Scope

- **Archivos:** ~15 (3 store, 2 server, 3 client/i18n, 4 map, App+7 paneles+css, e2e, ADR/ROADMAP).
  El conteo de ficheros tocados de producto es ~13-14; está en el límite WARNING (>15) pero no lo supera.
  El grueso de T5 son cambios de strings (bajo riesgo).
- **Áreas:** store + server + web. 3 áreas → en el umbral, no lo supera.
- **Breaking en contratos entre packages:** No. `apiFetch` se extiende con `init?` opcional
  (retrocompatible: todas las llamadas GET existentes siguen válidas). El nuevo payload `{translated}`
  es aditivo. Migr 008 es nueva tabla, no altera 001-007.

## D5 — Riesgos

| Riesgo | ¿Aplica? | Tratamiento |
|--------|----------|-------------|
| Turso schema/migración | **Sí** (migr 008 NUEVA) | Aditiva, idempotente (`CREATE TABLE IF NOT EXISTS`); no toca 001-007. WARNING-1 abajo. |
| PROVIDER_CHAIN router LLM | No | No se toca `@www/core-ai`; solo se LLAMA `complete()` existente. |
| Fuente de datos sin ToS | No | No hay fuente nueva; el prompt es propio (license.clean). |
| Job de scheduler nuevo | No | NG-5: el job NO cambia. Verificado. |
| Ruta nueva en server.ts | **Sí** (POST /api/translate) | WARNING-2/3 abajo (wiring guard + CORS + preflight). |
| Código de seguridad (CORS/guard/rate-limit) | **Sí** (guard método + CORS methods) | R-3 cubierto por server test; WARNING-3 (preflight). |

---

## Auditoría: Fidelidad a decisiones bloqueadas (D-900..D-908 + ADR-018)

| D-NN | Tarea que la implementa | Estado |
|------|-------------------------|--------|
| D-900 (1 click + queryRenderedFeatures sobre INTERACTIVE_LAYER_IDS, heatmap excluido) | T4 step 3 | OK — `type!=='heatmap'` real (hay `evt-wildfire-heat`/`evt-conflict-heat`) |
| D-901 (buildPopupNode ramifica por capa, botón solo eventos/señales) | T4 step 1 | OK |
| D-902 / ADR-018 (POST /api/translate única excepción, cache-first, guard 1..500, tras pipeline) | T2 steps 2-3 + T6 step 5 (ADR) | OK |
| D-903 (tabla translations source PK, dedupe, sin lang) | T1 step 1 | OK |
| D-904 (localizeCountry en→ISO2→es, fallback + ALIASES, capa presentación) | T3 step 2 | OK |
| D-905 (UI literal in-place sin framework i18n) | T5 | OK |
| D-906 (provincias/ciudades vía traducción del titular, sin gazetteer) | NG-3 + T4 botón | OK |
| D-907 (temp 0, maxTokens 800, sin LLM → {translated:null} 200) | T2 step 3 + T3 step 1 | OK |
| D-908 (popup DOM imperativo contenido, sin dep nueva) | T4 step 1 | OK |

**Read-only preservado en todo lo demás:** verificado contra `server.ts` — los 14 endpoints GET existentes
(`/api/markets`, `/api/events`, `/api/cii`, `/api/convergence`, `/api/sanctions`, `/api/chokepoints`,
`/api/insights`, etc.) siguen SOLO-LECTURA. `POST /api/translate` es la **única** excepción, registrada
como ADR-018, justificada (user-initiated, cache-first, acotada). El intent de D-002 (no disparar IA pesada
por page-load) NO se viola: es un botón explícito de 1 frase.

## Auditoría: No-scope-creep (NG-1)

Verificado fichero a fichero en "File Structure" y per-task: **NINGUNA tarea modifica**
`@www/core-signals`, `@www/core-ai` (motor insights/briefing/router), `@www/scheduler`, ni migraciones
001-007. `complete()` se IMPORTA y se LLAMA (no se edita). El job diario no se toca (NG-5). Confirmado: la
única escritura a `@www/core-ai` sería un import en `server.ts`, no un cambio de código del paquete. PASS.

## Auditoría: Frases de erosión de scope

Grep del plan: **0 coincidencias** de `v1`, `versión simplificada`, `se cablea después`, `will be wired
later`, `implementación básica`, `mejora futura`.
- Aparece la palabra "placeholder" implícitamente como "esqueletos a rellenar" (Self-Review/GAP-1/GAP-2):
  NO es erosión — son la lista ISO2 completa y los campos de `buildPopupNode`, marcados como GAP explícitos
  con su red (confirmar props con MapView + smoke caza alias). Cada pieza cierra con su test/curl/E2E. No
  hay stub que pase como hecho.

---

## Verificación de GOTCHAS declarados (contra código real)

| Gotcha | Claim del plan | Verificado | Veredicto |
|--------|----------------|------------|-----------|
| (a) migrate.ts descarta chunks `--` | 008 SIN comentario inicial | `migrate.ts:55-58` parte por `;`, `.filter(s => !s.startsWith('--'))`. Migr 007 real empieza por `CREATE TABLE` (sin comentario). | **CORRECTO** — 008 debe empezar por `CREATE TABLE`, exactamente como en el plan. |
| (b) guard `method !== 'GET'` | permitir EXACTAMENTE POST /api/translate | `server.ts:204-207` rechaza todo no-GET. El parche del plan permite solo `POST && pathname==='/api/translate'`. | **CORRECTO** — el test existente `server.test.ts:396` (POST /api/health → 405) sigue válido tras el cambio. |
| (c) CORS añade POST | `'GET, POST, OPTIONS'` | `server.ts:558` hoy `'GET, OPTIONS'`. | **CORRECTO** |
| (d) apiFetch GET-only → init | extender con `init?: RequestInit` | `client.ts:595` es GET-only sin init. El parche es retrocompatible. | **CORRECTO** |
| Modelo LLM por env | nunca hardcode | `complete()` usa `OPENAI_MODEL` (router.ts). | **CORRECTO** |
| maxTokens 800 por reasoning gpt-5.x | holgura | gotcha real de slice B; `complete(prompt, {temperature, maxTokens})` acepta ambos (router.ts:104-105). | **CORRECTO** |

**Gotchas adicionales / precisiones que el plan NO menciona explícitamente (→ WARNINGS):**

- **WARNING-3 (CORS preflight):** un `fetch` POST con `Content-Type: application/json` desde el navegador
  dispara un **preflight OPTIONS**. `server.ts:562` responde OPTIONS→204 ANTES del guard de método y del
  rate-limit, y `server.ts:559` ya envía `Access-Control-Allow-Headers: Content-Type`. Esto significa que
  el preflight FUNCIONA una vez se añada POST a `Allow-Methods` (gotcha c). El plan no lo explicita pero el
  resultado es correcto. **Recomendación:** añadir un caso al server test que valide
  `OPTIONS /api/translate` con `Origin` permitido → 204 con `Access-Control-Allow-Methods` conteniendo POST.

## Auditoría de riesgos del design-doc (R-1..R-6)

- **R-1 (mismatch nombre-país):** mitigado — `COUNTRY_ALIASES` + fallback al inglés (nunca rompe) + el
  smoke recorre países reales y caza mismatches (mismo patrón que cazó Türkiye→Turkey en sanciones). OK.
- **R-2 (gpt-5.x trunca):** mitigado — maxTokens 800 + vacío→null. OK.
- **R-3 (guard mal reescrito):** mitigado — server test cubre 200/400/405 + GET intactos. OK.
  Confirmado: el test existente `Non-GET → 405` (POST /api/health) sigue verde, garantizando que solo
  /api/translate queda exento.
- **R-4 (abuso botón):** mitigado — cache-first + disable + rate-limit (120/min ya existe). OK.
- **R-5 (fuga listeners):** mitigado — 1 instancia popup reusada + setDOMContent reemplaza nodo. OK.
- **R-6 (features de capas ocultas):** mitigado — `{layers}` filtra; MapLibre no devuelve features de
  `visibility:'none'`. El plan además filtra `INTERACTIVE_LAYER_IDS.filter(id => map.getLayer(id))` en T4
  step 3, robusto si una capa aún no está registrada. OK.

---

## WARNINGS (no bloquean PASS)

1. **[WARNING] Migración 008 — comentario inline interno.** El gotcha `--` se aplica a chunks que
   EMPIEZAN por `--` tras el split por `;`. La tabla `translations` del plan (Task 1) ya va sin comentario
   inicial (CORRECTO). PERO en el design-doc (Interfaces, líneas 93-98) el snippet SQL lleva comentarios
   `-- ...` al final de línea (`source TEXT PRIMARY KEY, -- texto fuente`). Esos comentarios inline DENTRO
   de un único statement (no separados por `;`) son inofensivos (el statement entero no empieza por `--`).
   *Remediación:* el implementador debe usar el snippet de **Task 1 del plan** (sin comentarios), no el del
   design-doc, o asegurar que ningún comentario quede como chunk independiente. Sin riesgo real, pero
   conviene fijar el snippet del plan como fuente de verdad.

2. **[WARNING] Discrepancia de snippet store: `db` vs `getDb()`.** El design-doc (líneas 103-113) usa
   `db.execute(...)` directo; el código real de `@www/store/src/index.ts` usa `getDb().execute(...)`
   (singleton lazy). El **plan (Task 1 step 2) ya corrige esto** usando `getDb()`. *Remediación:* seguir el
   snippet del plan, no el del design-doc.

3. **[WARNING] CORS preflight OPTIONS /api/translate no testeado explícitamente.** Funciona por
   construcción (OPTIONS→204 antes del guard, Allow-Headers ya incluye Content-Type), pero el plan no añade
   un test de preflight. *Remediación:* añadir al server test un caso OPTIONS con Origin permitido → 204 +
   `Access-Control-Allow-Methods` con POST. Bajo coste, cierra R-3 del lado navegador.

4. **[WARNING] Test de `countries.ts` / `popup.ts` — runner de web sin confirmar.** El plan reconoce el
   gap (Task 3 step 3 nota; Task 4 step 2) y lo defiere a "decidir en Task 6". El repo usa node:test+tsx
   sobre `.ts`; los tests de store/server corren así. *Remediación:* colocar `countries.test.ts` y
   `popup.test.ts` bajo el mismo runner node:test+tsx (o, para popup, testear una función pura de "modelo
   de filas ES" si no hay jsdom y dejar el ensamblado DOM al E2E). No bloquea — el plan ya lo prevé.

5. **[WARNING] localizeCountry sobre nombres ya en español / no-país.** El popup de chokepoints usa
   `nameEs` (ya español) y NO debe pasar por `localizeCountry`; el plan lo respeta (rama chokepoints sin
   traducción). En paneles, aplicar `localizeCountry` solo donde el valor es una clave-país inglesa, nunca
   sobre símbolos/instrumentos (T5 step 2 ya lo indica). *Remediación:* mantener la disciplina "presentación
   only, nunca sobre claves de lookup/map-tie" (D-904 DO/DON'T) — ya documentada.

## ISSUES

Ninguno bloqueante.

---

## Reporte a agent-comms.md (línea exacta para el PM)

```
## 2026-06-18T00:00:00Z [PLAN-CHECKER] [DONE] — Plan slice-d-interactive-map-spanish: PASS (0 issues, 5 warnings)
```

## Recomendaciones finales

1. Fijar los snippets del **plan** (no del design-doc) como fuente de verdad para migr 008 (sin comentario)
   y helpers store (`getDb()` no `db`).
2. Añadir el test de preflight `OPTIONS /api/translate` (cierra R-3 del lado navegador, bajo coste).
3. Confirmar el runner de los tests de web (`countries.test.ts`/`popup.test.ts`) en node:test+tsx antes de
   T3/T4, no en T6, para no descubrir tarde que falta jsdom.
