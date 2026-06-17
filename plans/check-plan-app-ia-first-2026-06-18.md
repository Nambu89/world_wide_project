# /check-plan — App vista IA-first (Slice C) (2026-06-18)

**Plan:** `plans/2026-06-18-app-ia-first.md`
**Veredicto:** PASS — 0 ISSUES (bloqueantes), 4 WARNINGs (no bloquean)

Wiring verificado contra el código vivo (`insights.ts`, `client.ts`, `IntelPanel.tsx`,
`App.tsx`, `server.ts`, `MapView.tsx`, `chokepoints.config.ts`, `insights.test.ts`). El plan
es fiel a D-801..D-804, reúsa los handlers de map-tie existentes y NO toca server/store.
Ningún `ISSUE` abierto. Los 4 WARNINGs son flags de ejecución que el worker debe heedear pero
no bloquean el gate.

---

## Verificación contra el código real (claims del plan confirmados)

- **`/api/insights` ya pasa por `parseInsights` y NO dispara LLM** — CONFIRMADO
  (`server.ts:265-278`): `getCachedBriefing('intel', 0)` + `parseInsights(cached.body_md)`,
  solo-lectura, sirve la última aunque stale (`nowMs=0`). Cuando T1 añade `countries`/
  `chokepoints` a `parseInsights`, el endpoint los devuelve **sin tocar `server.ts`** — D-804
  se sostiene por construcción (el endpoint nunca enumera campos; reexpide lo que parsea).
- **El schema `Insight` en core-ai NO tiene hoy countries/chokepoints** — CONFIRMADO
  (`insights.ts:15-24`: 8 campos). T1 Step 1 los inserta tras `affected` — diff válido.
- **`parseInsights` ya filtra arrays string defensivamente** — CONFIRMADO (`insights.ts:138-140`
  patrón `Array.isArray(o['x']) ? o['x'].filter(...) : []`). T1 Step 3 replica EXACTO ese patrón
  para los dos campos nuevos → default `[]` retrocompatible (D-802). Tarjetas viejas cacheadas
  (sin los campos) → `[]`, sin romper el parser.
- **Web tiene DOS `Insight`** — el plan lo dice "mirror core-ai" (T2 Step 1) pero solo hay UN
  `Insight` real en web: `client.ts:854-863` (8 campos, "WIRE FORMAT = camelCase (already
  plain)"). `IntelPanel.tsx:14` lo importa de `../api/client`, NO de core-ai. Añadir
  `countries`/`chokepoints` ahí es el único punto de edición del view-model. CONFIRMADO: web
  **nunca importa core-ai** (boundary), así que la extensión del `Insight` de core-ai no llega
  a web salvo por la edición espejo manual de T2 Step 1. Correcto.
- **`IntelPanel` hoy NO recibe props** — CONFIRMADO (`IntelPanel.tsx:30` `export default
  function IntelPanel()`). T2 Step 2 añade `{ onSelect?, activeId? }` — diff válido. El render
  actual usa `<li key={c.id} className="intel-card">` (`:88`) sin botón; T2 envuelve en
  `<button>`. La cabecera del fichero declara "Map-tie ... DEFERRED to slice C" — este slice
  es justamente esa C.
- **`handleCountrySelect(name)` y `handleChokepointSelect(id)` existen y reúsables** —
  CONFIRMADO (`App.tsx:121-129` y `:131-139`). `handleInsightSelect` de T2 Step 3
  (`chokepoints[0]` primero, si no `countries[0]`) cumple D-803 (chokepoint-first) y enruta a
  los handlers correctos. Los `!` non-null tras `.length > 0` son seguros.
- **`activeTab` default hoy = `'events'`** — CONFIRMADO (`App.tsx:69`). T2 Step 3 lo cambia a
  `'intel'` (D-801 landing).
- **`PanelTab` ya incluye `'intel'` y `panelTitle` ya mapea `'intel'→'Inteligencia'`** —
  CONFIRMADO (`App.tsx:60` y `:153-160`). El botón "Inteligencia" existe pero es el ÚLTIMO
  (`:267-276`); T2 Step 3 lo mueve a 1º (D-801). Reorder puro de JSX, sin lógica nueva.
- **Los 12 chokepoint ids del prompt = los ids reales del config** — CONFIRMADO uno-a-uno
  contra `chokepoints.config.ts`: hormuz, suez, bab-el-mandeb, malacca, panama, bosphorus,
  gibraltar, dover, danish-straits, taiwan, good-hope, magellan (`:52,63,74,85,96,107,118,129,
  140,151,162,173`). El prompt de T1 Step 2 los enumera EXACTOS → el LLM tiene la lista cerrada,
  baja el riesgo de id inventado. (Coherencia con `chokepointsDataRef.id`.)
- **flyTo no-op gracioso si el id/nombre no casa** — CONFIRMADO: chokepoint
  `chokepointsDataRef.current.find(c=>c.id===activeChokepoint); if(!cp) return;`
  (`MapView.tsx:629-630`); country cae a `ciiDataRef.find(...); if(!country) return;`
  (`:612-615`, tras probar convergence+sanctions). Un nombre/id que el LLM emita mal
  simplemente no vuela — sin throw. Cumple el requisito 3 del usuario.
- **El test cache-short-circuit YA existe** (resuelto en el check de B) — CONFIRMADO
  (`insights.test.ts:65-78`). El plan dice "→ all PASS (10)": hoy hay 9 tests; T1 Step 4 añade
  el de countries/chokepoints = 10. Conteo correcto.

---

## 5 Dimensiones

1. **Cobertura de requisitos** — PASS. Schema+prompt+parser (T1) · landing-reorder + cards
   clicables + map-tie (T2) · verify+smoke+E2E (T3). Requisito implícito retrocompat (tarjetas
   viejas → `[]`) cubierto por el default `[]` del parser + flyTo no-op. Requisito implícito
   "el map-tie enciende la capa destino": el de país reúsa `handleCountrySelect` (enciende
   `cii`+`sanctions`, `App.tsx:121-129`); el de chokepoint reúsa `handleChokepointSelect`
   (enciende `chokepoints`, `:131-139`). Cubierto por reúso — ver W-2 sobre la capa CII/landing.
2. **Completitud de tareas** — PASS con WARNINGs. Cada task tiene **Files:** explícitos
   (files_modified declarado) y verify <60s del stack: T1 `node --import tsx --test
   .../insights.test.ts` + `pnpm --filter @www/core-ai build`; T2 `tsc --noEmit && build`
   (filter web); T3 `pnpm -r exec tsc --noEmit` + raíz + `pnpm test` + `server.test.ts` + E2E.
   Pasos con código real (diffs concretos, no prosa). W-1/W-3/W-4 abajo.
3. **Dependencias** — PASS. Orden correcto: core-ai (T1) → web (T2) → verify+E2E (T3). Sin
   ciclos. T2 espeja a mano el `Insight` de web (boundary: web no importa core-ai), así que T2
   no depende del build de T1 para compilar, pero sí lo necesita en vivo para que las tarjetas
   lleven entidades — orden T1→T2 lo respeta. Sin dependencias externas nuevas (la key LLM ya
   existía en B).
4. **Scope** — PASS. ~8 ficheros, 2 áreas de código (core-ai, web) + plans/docs. Muy bajo el
   umbral de 15. Sin migración, sin nueva store-API, sin connector, sin cambio en
   PROVIDER_CHAIN, sin ruta server nueva. Sin breaking en contratos públicos (ver §Retrocompat).
5. **Riesgos (D5)** — PASS. Turso schema: **NO** (reúsa `briefings` domain='intel', D-804).
   PROVIDER_CHAIN: **NO**. Fuente sin ToS: **NO** (sin fuente nueva). Scheduler job nuevo:
   **NO** (la generación ya corre en el daily job de B; este slice no añade jobs). server.ts
   ruta nueva: **NO** (D-804, `/api/insights` ya existe). Seguridad (CORS/SSRF/rate-limit):
   sin cambios.

---

## Retrocompatibilidad — ¿rompe algún consumidor? (req. usuario 2)

- **Endpoint `/api/insights`** — NO rompe. Reexpide `parseInsights(body)`; los campos nuevos
  viajan como propiedades extra del JSON. Tarjetas cacheadas viejas (12h, sin los campos) →
  `parseInsights` les pone `countries:[]`/`chokepoints:[]` → map-tie no-op. **Gestionado** (es
  el comportamiento por construcción del patrón `Array.isArray(...) ? ... : []`).
- **View-model web `Insight`** (`client.ts:854`) — añadir dos `string[]` es additivo. El único
  consumidor (`IntelPanel`) se actualiza en el mismo slice (T2). `getInsights` (`:881-889`)
  pasa `raw.insights` directo sin transformar campos → los nuevos llegan sin cambios al
  adapter. NO rompe.
- **`RawInsightsResponse`/`InsightsResult`** (`client.ts:865-875`) — referencian `Insight[]`,
  heredan los campos nuevos automáticamente. NO rompe.
- El plan documenta explícitamente la retrocompat en D-802 y en el bloque **Risk** del
  Self-Review ("old cached cards → [], no map-tie until regenerated"). **El plan lo gestiona.**

---

## Coherencia de tipos / nombres / ids (req. usuario 3)

- **country names del LLM ↔ claves CII** — el prompt de T1 Step 2 pide "nombres en inglés tal
  como aparecen en el contexto, p.ej. Iraq, Russia". El contexto se arma con `buildRiskContext`
  desde `getLatestCii()`, cuyas claves SON los nombres-inglés de `ciiDataRef.country`. Coherente
  POR ORIGEN (el LLM ve los mismos nombres que `ciiDataRef` usará para el `.find`). Si el LLM
  re-escribe un nombre, flyTo no-op (graceful). OK.
- **chokepoint ids del LLM ↔ `chokepointsDataRef.id`** — prompt enumera la lista cerrada
  exacta de los 12 ids; `find(c=>c.id===...)` casa contra esos mismos ids. OK.
- **flyTo no-op si no casa** — CONFIRMADO en `MapView.tsx` (ver arriba). OK.
- `Insight` consistente core-ai (T1, 10 campos) ↔ web (T2, 10 campos). El view-model no
  transforma `countries`/`chokepoints` (pasan directo). OK.

---

## Cableado — ¿falta algo? (req. usuario 4)

- App: reorder tab 1º + default `'intel'` + `handleInsightSelect` + `activeInsightId` →
  todo enumerado en T2 Step 3. OK.
- IntelPanel: props `onSelect`/`activeId` + card `<button>` + clase `active` → T2 Step 2. OK.
- client: `Insight` +campos → T2 Step 1. OK.
- **Encendido de capas en el map-tie**: el de chokepoint reúsa `handleChokepointSelect` que
  hace `next.add('chokepoints')` — y la capa chokepoints está ON por defecto (no se borra en
  `buildInitialActive`, `App.tsx:47-54`), así que es no-op benigno (correcto). El de país
  reúsa `handleCountrySelect` que enciende `cii`+`sanctions` (ambas; `sanctions` arranca OFF,
  `:52`). Cubierto por reúso. **Único hueco menor → W-2** (la capa CII al aterrizar en landing).

---

## Fidelidad de decisiones bloqueadas (D-801..D-804)

| D-NN | Tarea / evidencia | Estado |
|------|-------------------|--------|
| D-801 Inteligencia 1ª pestaña + landing por defecto | T2 Step 3 (mover botón a 1º + `useState('intel')`) | OK |
| D-802 schema +countries[](nombres inglés=claves CII)+chokepoints[](ids), LLM-emitidos, parse opcional default [] retrocompat | T1 Steps 1-3 (interface + prompt + parser patrón `Array.isArray?...:[]`) | OK |
| D-803 click prioriza chokepoint, si no país; reúsa handleChokepointSelect/handleCountrySelect; highlight=flyTo+glifo, anillo dedicado DIFERIDO | T2 Step 3 `handleInsightSelect` (chokepoints[0] antes que countries[0]) + flyTo existente | OK |
| D-804 sin cambio server/store (/api/insights ya pasa parseInsights) | Verificado `server.ts:265-278` — no se toca; reexpide los campos nuevos por construcción | OK |

**Frases de erosión de scope:** ninguna prohibida (`v1`/`versión simplificada`/`placeholder`/
`se cablea después`/`will be wired later`/`implementación básica`/`mejora futura` NO aparecen).
"highlight ring DEFERRED" / "map-tie deferred" son diferimientos de decisión documentados
(D-803, anillo dedicado), NO erosión del entregable de ESTE slice — el slice SÍ entrega flyTo +
glifo + fila activa. Aceptable.

**NUNCA modelo hardcodeado:** sin cambios en la cadena de modelo (heredado de B, etiquetado por
`process.env['OPENAI_MODEL']`). Cumple [[never-assume-llm-model]].

---

## WARNINGs (no bloquean)

- **W-1 (smoke timing / caché 12h sin entidades, heredado de B):** El propio plan (T3 Step 2)
  admite que el batch live puede estar cacheado 12h SIN los campos nuevos → `generateInsights()`
  devuelve el batch stale sin entidades, y el map-tie del smoke no encuentra nada que volar. La
  nota del plan ("force regen ... against a fresh DB OR accept the NEXT generation carries
  entities. Document which occurred") es honesta pero ambigua sobre QUÉ hará el worker.
  **Remediación sugerida:** para el smoke determinista, regenerar contra una DB efímera
  (`LIBSQL_URL=':memory:'` o expirar el batch intel) para forzar una llamada LLM fresca que SÍ
  emita countries/chokepoints; y que el E2E de T3 Step 3 mantenga la tolerancia data-O-empty
  (L-5). No es fallo: el endpoint/panel degradan a vacío y el map-tie no-op es gracioso por
  diseño. Documentar en el reporte de `/verify` cuál de los dos casos ocurrió.
- **W-2 (landing en 'intel' + capa CII OFF de inicio):** Al aterrizar en Inteligencia (D-801),
  si el usuario clica una tarjeta de PAÍS, `handleCountrySelect` enciende `cii`+`sanctions` y
  vuela — OK. Pero antes de clicar, el mapa de fondo NO muestra CII (la capa cii arranca ON en
  `buildInitialActive`, así que en realidad sí está ON — re-confirmado `App.tsx:47-54`: solo se
  borran `convergence` y `sanctions`). Por tanto el riesgo es nulo para CII; el matiz real es:
  el primer clic en una tarjeta de PAÍS enciende `sanctions` (glifo extra) aunque el usuario no
  lo pidiera — comportamiento heredado de `handleCountrySelect`, consistente y aceptable, pero
  conviene que el E2E/`/verify` confirme que el flyTo de país funciona con la capa cii ya
  visible. Informativo, no bloquea.
- **W-3 (IntelPanel `<button>` y a11y/estilo):** T2 Step 2 ofrece un sketch ("Wrap each card's
  content in a `<button>`"), no el componente completo reescrito. Envolver el contenido actual
  (header+meta+triggers+consequences+affected) en un `<button>` requiere mover el padding y
  cuidar que los `<ul>`/`<li>` internos no queden dentro de un `<button>` interactivo anidado
  (HTML inválido: un `<button>` no puede contener `<ul>` con elementos interactivos, aunque
  aquí son estáticos → válido pero vigilar). El worker debe leer el render actual
  (`IntelPanel.tsx:85-124`) y completar; tsc+build+E2E lo cazan si rompe. Flag explícito,
  aceptable (mismo patrón aprobado en checks previos).
- **W-4 (`activeInsightId` no se limpia):** `handleInsightSelect` setea `activeInsightId` pero
  ninguna tarea lo resetea al cambiar de tab o recargar el feed. No es bug (la fila resaltada
  persiste hasta otro clic), pero si el feed se recarga y el id ya no existe, la clase `active`
  simplemente no casa (no-op). Informativo. Si se quiere pulcritud, limpiar en el cambio de tab
  — opcional, no bloquea.

---

## Task 3 verificación suficiente (req. usuario 5)

PASS: tsc global (`pnpm -r exec tsc --noEmit`) + raíz (`npx tsc --noEmit -p tsconfig.json`) +
suite (`pnpm test` + `server.test.ts`) + build web + smoke vivo regenerando insights con
entidades + browser E2E (landing por defecto + primer tab "Inteligencia" + clic de tarjeta con
entidades → `.intel-card.active` + canvas presente). Cubre todos los gates del repo. La nota
honesta sobre la caché 12h está presente (W-1). Cubre el goal: app abre en Inteligencia y el
clic vuela el mapa. Suficiente — con la salvedad de W-1 (forzar regen para que el smoke vea
entidades, o documentar que no las vio).

---

## Recomendaciones (no bloqueantes)

1. **W-1:** En T3 Step 2, decidir explícitamente: regenerar el smoke contra DB efímera/expirada
   para forzar una tarjeta fresca con countries/chokepoints, y documentar en `/verify` cuál
   caso ocurrió (fresco vs stale).
2. **W-3:** Al completar IntelPanel, verificar HTML válido del `<button>` envolvente y que el
   foco/teclado siga funcionando (a11y); confirmar que T2 Step 5 tsc+build pasa.
3. **W-4 (opcional):** limpiar `activeInsightId` al cambiar de pestaña para evitar estado
   resaltado huérfano.
4. Confirmar el conteo de tests: hoy `insights.test.ts` tiene 9 → con T1 Step 4 = 10 (el plan
   ya dice "10"). OK.

## Línea para agent-comms.md

`## 2026-06-18T00:00:00Z [PLAN-CHECKER] [DONE] — Plan app-ia-first (Slice C): PASS, 0 issues, 4 warnings (W-1 smoke caché 12h, W-2 capa CII landing, W-3 button a11y IntelPanel, W-4 activeInsightId sin reset)`
