---
version: alpha
name: slice-d-interactive-map-spanish
description: Slice D (última pieza de la visión IA-first, ADR-015/016/017). Hace el mapa INTERACTIVO (click en cualquier punto → popup en castellano) y españoliza la UI. Tres piezas aditivas que NO tocan el motor A/B/C ni los gates ya verdes — (D1) un único click handler en MapView + queryRenderedFeatures sobre los circle layers + un renderer de popup que ramifica por capa, con botón "Traducir" SOLO en texto libre (eventos/señales) que llama POST /api/translate (la ÚNICA excepción deliberada a "no LLM on-request", cache-first, ADR-018) respaldado por una tabla translations (migración 008) que dedupe por texto fuente; (D2) localizeCountry en web vía Intl.DisplayNames('es') reverse-map + alias, capa de presentación (la DB queda en inglés); (D3) UI 100% español, literales in-place, sin i18n framework (1 idioma → YAGNI). Provincias/ciudades NO se localizan por separado (van en la traducción IA del titular). Cierra con smoke EN VIVO (click real + Traducir + cache hit) + browser E2E, lección L-5 "verde≠funciona" (van 6).
status: draft
date: 2026-06-18
owner: system-architect
---

## Overview

La visión "IA-first" (Fase 5) se troceó en 4 slices: **A chokepoints · B motor insights · C app IA-first · D mapa interactivo + español**. A/B/C están CERRADOS+VERIFIED+commiteados (`2e5dfae`→`a1c8a9e`→`f6c4518`). Esta es la **última pieza**.

Hoy el mapa es **pasivo**: muestra puntos (eventos, señales, CII, convergencia, sanciones, chokepoints) pero clicarlos no hace nada — la única interacción es el map-tie desde los paneles (`flyTo`). Y la UI está **mezclada**: pestañas "Inteligencia"/"Rutas" en español, pero "Finance/Events/Radar/Risk/Convergence" + todo el copy interno de 7 paneles en inglés; los nombres de país se muestran en inglés (claves CII).

Slice D entrega: (1) **click en cualquier punto del mapa → popup en castellano** con la info de ese punto; los puntos de texto libre (eventos/señales, titulares GDELT/news en inglés) llevan un botón **"Traducir"** que traduce ese titular vía IA, cacheado; (2) **nombres de país españolizados** en popups y paneles; (3) **UI 100% en español**. El resultado: la app se siente nativa en castellano y el mapa es explorable directamente, no solo vía paneles.

Es estrictamente **aditiva**: no toca `@www/core-signals`, `@www/core-ai`, el scheduler, ni las migraciones 001–007. Añade una migración 008 (cache de traducciones), una ruta POST, un click handler + popup en `MapView`, un helper de i18n en web, y reescribe copy de UI a español.

## Token-references

Bloque canónico. Cada token-reference del doc (`namespace.key` entre llaves) resuelve a una fila de esta tabla.

| Token | Definición |
|-------|-----------|
| `{map.click}` | Un único `map.on('click', handler)` en `MapView` → `map.queryRenderedFeatures(e.point, { layers: INTERACTIVE_LAYER_IDS })`; si hay feature → abre popup en su coordenada (D-900). |
| `{map.interactive-ids}` | `INTERACTIVE_LAYER_IDS` = todos los layer ids de `[...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS, ...CHOKEPOINT_LAYERS]` con `type !== 'heatmap'` (los heatmap no tienen features puntuales clicables) (D-900). |
| `{map.popup}` | `new maplibregl.Popup({ closeButton: true, maxWidth: '320px' }).setLngLat(coord).setDOMContent(node).addTo(map)`; una sola instancia reutilizada/cerrada por click (D-908). |
| `{popup.builder}` | `buildPopupNode(feature, onTranslate)` — función pura-de-DOM que ramifica por `feature.layer.id` (o por presencia de props) y devuelve un `HTMLElement` con los campos estructurados en español (D-901). |
| `{popup.fields}` | Campos del popup por tipo: eventos→{tipo, severidad, país-ES, fecha, fuente, titular}; señales→{sección, tono, país-ES, fecha, fuente, titular}; CII→{país-ES, banda, composite, dominante}; convergencia→{país-ES, fuerza, familias, dimensión}; sanciones→{país-ES, nº sancionados}; chokepoint→{nombreEs, estado, score, impactoEs} (D-901). |
| `{popup.translate}` | Botón "Traducir" presente SOLO en popups de texto libre (eventos/señales). Click → `translate(titular)` → reemplaza el titular crudo por el traducido + marca "traducido"; deshabilitado mientras carga; error → mensaje inline, no rompe (D-901/D-907). |
| `{api.route.translate}` | `POST /api/translate` body `{ text: string }` → `{ translated: string }`. Cache-first: si `getTranslation(text)` existe → devuelve sin IA; si no → `complete(prompt)` + `putTranslation(...)` (D-902/D-907). |
| `{api.translate.exception}` | `{api.route.translate}` es la ÚNICA excepción deliberada a "no LLM on-request" (ADR-004/D-002). Justificada: iniciada por usuario (botón), 1 string corto, cache-first (repetir=0 IA), coste acotado (guard de longitud + `maxTokens` bajo), tras el pipeline de seguridad existente. Registrada como **ADR-018** (D-902). |
| `{store.translations}` | Tabla `translations(source TEXT PRIMARY KEY, target TEXT NOT NULL, created_at INTEGER NOT NULL)` — migración **008**. Dedupe por texto fuente (titulares repetidos = 0 tokens) (D-903). |
| `{store.helpers}` | `getTranslation(source): Promise<string \| null>` y `putTranslation(source, target): Promise<void>` en `@www/store` (D-903). |
| `{llm.complete}` | `complete(prompt, { temperature: 0, maxTokens: N })` de `@www/core-ai` (router existente; OpenAI gpt-5.x activo). Sin proveedor disponible → lanza `LLM_UNAVAILABLE` → la ruta degrada graciosa (D-907). |
| `{i18n.country}` | `localizeCountry(en: string): string` en `packages/web/src/i18n/countries.ts` — `en→ISO2` vía `Intl.DisplayNames('en',{type:'region'})` sobre lista estática de códigos alpha-2, luego `ISO2→es` vía `Intl.DisplayNames('es')`; build-once en módulo; fallback al original + `COUNTRY_ALIASES` para mismatches (D-904). |
| `{i18n.ui}` | Strings de UI traducidos a español **literal in-place** (sin framework i18n; 1 idioma → YAGNI). Cubre pestañas + copy interno de los 7 paneles + estados loading/empty/error (D-905). |
| `{security.pipeline}` | El handler HTTP ya pasa por origin-check + CORS + rate-limit antes de enrutar (`server.ts`). `{api.route.translate}` hereda esa protección; añade parseo de body con límite de tamaño (D-902). |
| `{license.clean}` | Sin código AGPL de worldmonitor; metodología propia (ADR-001/ADR-002). El prompt de traducción es trivial y propio. |

## Goals

- G1: **Mapa interactivo** — `{map.click}` único en `MapView` que abre `{map.popup}` para cualquier feature de `{map.interactive-ids}`, con contenido `{popup.builder}` ramificado por tipo de capa y campos `{popup.fields}` en español.
- G2: **Traducción on-demand** — botón `{popup.translate}` en popups de texto libre → `{api.route.translate}` (cache-first), con el resultado reemplazando el titular crudo, estados loading/error explícitos.
- G3: **Cache de traducciones** — `{store.translations}` (migración 008) + `{store.helpers}`, dedupe por texto fuente; la ruta NUNCA re-traduce un texto ya cacheado.
- G4: **Nombres de país en español** — `{i18n.country}` aplicado en popups y en los paneles donde se muestra `country`, con fallback robusto al nombre original.
- G5: **UI en español** — `{i18n.ui}`: las 5 pestañas restantes + copy interno de los 7 paneles, manteniendo accesibilidad (aria-labels traducidos).
- G6: Cierre con **smoke EN VIVO** (click real → popup → Traducir → cache hit en 2º click) + **browser E2E**, no solo tests verdes ([[feedback-live-qa-vs-mocks]]).

## Non-Goals

- NG-1: **No se toca el motor ni la IA de A/B/C.** `@www/core-signals`, `@www/core-ai` (insights/briefing), el scheduler y las migraciones 001–007 están cerrados+verificados. Slice D SOLO añade interacción de mapa + i18n + ruta de traducción. Si el diseño parece exigir cambiar el motor → PARA y escala.
- NG-2: **Sin framework i18n / multi-idioma.** Un solo idioma (español) → strings literales in-place (`{i18n.ui}`); introducir `react-i18next`/`FormatJS` para 1 idioma es complejidad especulativa (YAGNI). Si algún día se quiere bilingüe, se extrae entonces.
- NG-3: **Sin traducir provincias/ciudades por separado.** No hay campo estructurado de provincia/ciudad; esos topónimos viven dentro del texto libre del titular y se traducen vía `{popup.translate}` (D-906). No se construye un gazetteer.
- NG-4: **Sin traducir los datos crudos persistidos.** La DB y los feeds quedan en inglés; la traducción es una **capa de presentación** + cache (`{store.translations}`). No se reescriben filas de `events`/`signals`.
- NG-5: **Sin auto-traducir todo en el job diario.** Pre-traducir cientos de titulares por run = tokens masivos; la traducción es on-demand (elección del usuario). El job NO cambia.
- NG-6: **Sin streaming de la traducción.** `complete()` devuelve el texto completo; el popup muestra spinner→resultado. Streaming token-a-token en un popup es superficie sin valor para 1 frase.
- NG-7: **Sin localización de fechas/números más allá de `toLocaleDateString('es')`.** No se introduce `date-fns`/`Intl.NumberFormat` configurado por dominio; `toLocaleString('es')` de stdlib basta.

## Context / Constraints

- **Stack**: Node single-server `server.ts` (routing regex manual + `sendJson`; hoy `method !== 'GET'` → 405), Turso/libSQL vía `@www/store`, Vite + React + MapLibre GL en `packages/web`. Router LLM en `@www/core-ai` (`complete()`), OpenAI gpt-5.x activo por env ([[never-assume-llm-model]]).
- **El server es read-only por diseño** (ADR-004/D-002): los endpoints solo LEEN cache; la IA pesada (briefing/insights) corre en el scheduler. `{api.route.translate}` es la **excepción explícita** (D-902/ADR-018) — un POST user-initiated, cache-first, acotado. El intent de la regla (no disparar la IA pesada por page-load) NO se viola por un botón explícito de 1 frase.
- **gpt-5.x (reasoning) gasta presupuesto de completion en razonamiento oculto** (gotcha de slice B: `maxTokens=2000` truncó el JSON de insights). Para una traducción de 1 frase, dar `maxTokens` con holgura (≈800) evita truncado; output real ~30 tokens pero el reasoning consume parte (D-907).
- **camelCase en el wire** ([[feedback_api_contract_camelcase]], BUG-1): cualquier payload nuevo se tipa camelCase en el cliente. `{api.route.translate}` devuelve `{ translated }` (trivial, sin filas).
- **Config-array central** (ADR-003/D-008): las capas viven en `layers.config.ts`; `MapView` las itera. `INTERACTIVE_LAYER_IDS` se DERIVA de esos mismos arrays (no se hardcodea una lista paralela que se desincronice).
- **Popups de MapLibre son imperativos por naturaleza** (`new Popup().setDOMContent`). No hay forma declarativa-React limpia sin una dep extra (`react-map-gl`). Se acepta DOM imperativo **contenido** en `{popup.builder}` (D-908) — es el patrón estándar de MapLibre, no `addLayer` disperso.
- **Nombres de país = claves CII en inglés** (p.ej. "Japan", "Russia", "United States"). `Intl.DisplayNames` mapea ISO-2→nombre, no inglés→español; por eso `{i18n.country}` construye el reverse `en→ISO2` y luego `ISO2→es`. El conector de sanciones ya resolvió ISO2→nombre + `CANONICAL_ALIASES` (mismo patrón de alias reutilizable conceptualmente).
- **License-clean** (`{license.clean}`): nada de fuente AGPL; el prompt de traducción es propio y trivial.

## Decisions

Numeración `D-9xx` (CII=D-2xx, convergencia=D-3xx, conv-surface=D-4xx, sanciones=D-5xx, chokepoints=D-6xx, insights=D-7xx, app-ia-first=D-8xx; sin colisión). Las `D-0NN` son bloqueadas heredadas de ADR.

- **D-001 (bloqueada, ADR-002)**: re-implementar metodología, NUNCA copiar fuente AGPL — solo la metodología es re-implementable; el código no.
- **D-002 (bloqueada, ADR-004)**: la UI lee de la DB local; la IA pesada corre en el scheduler — el histórico es el diferencial y la app debe sobrevivir a caídas de fuente sin re-disparar cómputo. `{api.translate.exception}` es la excepción acotada y justificada a esta regla (D-902).
- **D-900**: un único `{map.click}` + `queryRenderedFeatures` sobre `{map.interactive-ids}` (circle layers, NO heatmap) — porque un handler por capa multiplicaría código; `queryRenderedFeatures` con la lista de ids cubre "cualquier punto" en una llamada. Los heatmap se excluyen porque no exponen features puntuales clicables de forma fiable.
- **D-901**: `{popup.builder}` ramifica por capa y muestra `{popup.fields}` en español; el botón `{popup.translate}` aparece SOLO en eventos/señales (texto libre) — porque CII/convergencia/sanciones/chokepoint ya son datos estructurados (no hay texto inglés que traducir); poner "Traducir" ahí sería un botón muerto.
- **D-902 (ADR-018)**: `{api.route.translate}` es un `POST` que dispara la IA on-request, **única excepción** a D-002, cache-first, tras `{security.pipeline}` + guard de longitud (rechaza `text` > ~500 chars o vacío) — porque la UX elegida ("traduce ESE titular ahora") exige IA on-request la 1ª vez; el cache + el guard + el origin-check acotan el coste y el abuso. Se registra como ADR para que la excepción sea explícita y auditable, no erosión silenciosa.
- **D-903**: cache `{store.translations}` con `source` (texto) como PRIMARY KEY, sin hash — porque SQLite indexa TEXT PK directo; el dedupe por texto fuente hace que titulares repetidos (GDELT repite mucho) cuesten 0 tokens. Sin columna `lang` (1 idioma destino → YAGNI; se añade si algún día hay multi-idioma).
- **D-904**: `{i18n.country}` construye `en→ISO2→es` con `Intl.DisplayNames` (stdlib) sobre una lista estática de códigos alpha-2, fallback al original + `COUNTRY_ALIASES` para mismatches — porque evita un mapa hand-curado de ~110 países (mantenimiento) usando stdlib; es **capa de presentación** (la clave de datos sigue siendo el nombre inglés, no se rompe ningún match interno).
- **D-905**: `{i18n.ui}` = strings español **literales in-place**, sin framework — porque para 1 idioma un framework i18n es complejidad especulativa (NG-2); el copy se traduce donde está. aria-labels también al español (accesibilidad, no se simplifica).
- **D-906**: provincias/ciudades NO se localizan por separado; van en `{popup.translate}` del titular — porque no existe campo estructurado para ellas y construir un gazetteer es desproporcionado; la traducción IA del titular ya las cubre en contexto.
- **D-907**: `{api.route.translate}` usa `{llm.complete}` con `temperature: 0` (traducción determinista) y `maxTokens≈800` (holgura por el reasoning de gpt-5.x); sin proveedor → responde `{ translated: null }` 200 graciosa (el botón muestra "traducción no disponible"), NUNCA 500 — porque la traducción es un extra, no debe romper el popup; espejo del degradado graceful de los feeds IA.
- **D-908**: el popup es DOM imperativo de MapLibre **contenido** en `{popup.builder}` + `{map.popup}` (una instancia reusada) — porque MapLibre popups son imperativos por diseño y añadir `react-map-gl` para evitarlo es una dep grande por un popup (rung 4 de la escalera: no añadir dep para lo que unas líneas resuelven). El listener del botón Traducir se cablea con `addEventListener` sobre el nodo antes de `setDOMContent`.

## Interfaces / Data Contracts

### Store — migración 008 + helpers (`@www/store`)

```sql
-- packages/store/migrations/008_translations.sql
CREATE TABLE IF NOT EXISTS translations (
  source     TEXT PRIMARY KEY,   -- texto fuente (titular en inglés) — dedupe natural (D-903)
  target     TEXT NOT NULL,      -- traducción al español
  created_at INTEGER NOT NULL    -- epoch ms
);
```

```ts
// packages/store/src/index.ts — 2 helpers nuevos ({store.helpers})
export async function getTranslation(source: string): Promise<string | null> {
  const rs = await db.execute({ sql: 'SELECT target FROM translations WHERE source = ?', args: [source] });
  const row = rs.rows[0];
  return row ? String(row.target) : null;
}
export async function putTranslation(source: string, target: string): Promise<void> {
  await db.execute({
    sql: 'INSERT OR REPLACE INTO translations (source, target, created_at) VALUES (?, ?, ?)',
    args: [source, target, Date.now()],
  });
}
```

### Backend — `{api.route.translate}` (server.ts)

```ts
// Antes del guard `method !== 'GET'`: permitir POST a /api/translate.
// (El guard global se ajusta para no rechazar este POST concreto.)

// POST /api/translate — {api.translate.exception} / D-902 / ADR-018.
// Cache-first; dispara la IA solo en miss. Guard de longitud. Degrada graciosa.
if (pathname === '/api/translate' && method === 'POST') {
  const body = await readJsonBody(req, 4096);             // límite de tamaño ({security.pipeline})
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 500) {                       // guard (D-902)
    sendJson(res, 400, { error: 'text required (1..500 chars)' });
    return;
  }
  const cached = await getTranslation(text);              // cache-first (D-903)
  if (cached !== null) { sendJson(res, 200, { translated: cached }); return; }
  try {
    const prompt = `Traduce al español, solo el texto traducido sin comillas ni explicación:\n\n${text}`;
    const translated = (await complete(prompt, { temperature: 0, maxTokens: 800 })).trim(); // D-907
    if (translated) await putTranslation(text, translated);
    sendJson(res, 200, { translated: translated || null });
  } catch {
    sendJson(res, 200, { translated: null });             // sin LLM → no rompe (D-907)
  }
  return;
}
```

`readJsonBody(req, maxBytes)` = helper nuevo en `server.ts`: acumula chunks con tope de bytes (aborta si excede), `JSON.parse` defensivo → `null` en fallo. Es la primera ruta POST; el guard `method !== 'GET'` se reescribe para permitir `POST /api/translate` y seguir rechazando el resto.

### Cliente — `client.ts`

```ts
export async function translate(text: string): Promise<string | null> {
  const res = await apiFetch<{ translated: string | null }>('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return res?.translated ?? null;
}
```

(Si `apiFetch` actual solo hace GET, se extiende para aceptar `init?: RequestInit`.)

### i18n — `packages/web/src/i18n/countries.ts`

```ts
// {i18n.country} / D-904 — en→ISO2→es, build-once, fallback al original.
const ISO2 = ['AF','AL','DZ', /* …lista estática de códigos alpha-2… */ 'ZW'];
const enDisplay = new Intl.DisplayNames(['en'], { type: 'region' });
const esDisplay = new Intl.DisplayNames(['es'], { type: 'region' });
const EN_TO_CODE = new Map<string, string>();
for (const code of ISO2) { const en = enDisplay.of(code); if (en) EN_TO_CODE.set(en, code); }

// Alias para nombres que NO coinciden con el display inglés de Intl (claves CII ≠ Intl).
const COUNTRY_ALIASES: Record<string, string> = {
  'Russia': 'RU', 'South Korea': 'KR', 'North Korea': 'KP', 'United States': 'US',
  'Iran': 'IR', 'Syria': 'SY', /* …se completa con los mismatches que cace el smoke… */
};

export function localizeCountry(en: string): string {
  if (!en) return en;
  const code = COUNTRY_ALIASES[en] ?? EN_TO_CODE.get(en);
  if (!code) return en;                 // fallback robusto (D-904)
  return esDisplay.of(code) ?? en;
}
```

### Mapa — `MapView.tsx` (click handler + popup)

```ts
// Derivado del config-array central (NO lista paralela) — {map.interactive-ids} / D-900.
const INTERACTIVE_LAYER_IDS = [
  ...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS, ...CHOKEPOINT_LAYERS,
].filter((l) => l.type !== 'heatmap').map((l) => l.id);

// En map.on('load') (o tras registrar capas): un único click handler.
const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' });
map.on('click', (e) => {
  const feats = map.queryRenderedFeatures(e.point, { layers: INTERACTIVE_LAYER_IDS });
  const f = feats[0];
  if (!f) { popup.remove(); return; }
  const node = buildPopupNode(f, (text) => translate(text)); // {popup.builder} / D-901
  popup.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
       .setDOMContent(node).addTo(map);
});
// Cursor pointer sobre capas interactivas (UX): map.on('mouseenter'/'mouseleave', id, …) por id.
```

`buildPopupNode(feature, onTranslate)` vive en un módulo propio (`packages/web/src/map/popup.ts`) — pura-de-DOM, ramifica por `feature.layer.id` (prefijo `evt-`/`sig-`/`cii-`/`convergence-`/`sanctions-`/`chokepoints`), aplica `localizeCountry` al campo país, formatea fecha con `toLocaleDateString('es')`, y para eventos/señales añade el botón "Traducir" cuyo `click` llama `onTranslate(titular)` y al resolver reemplaza el texto del nodo del titular (estado loading/error inline, D-901/D-907).

### UI español — `App.tsx` + 7 paneles

`{i18n.ui}` / D-905: pestañas `Finance→Finanzas`, `Events→Eventos`, `Radar→Radar`, `Risk→Riesgo`, `Convergence→Convergencia` (Inteligencia/Rutas ya en ES); `panelTitle` y aria-labels al español. En cada panel (`FinancePanel`, `EventsPanel`, `RadarPanel`, `RiskPanel`, `ConvergencePanel`, `ChokepointsPanel`, `IntelPanel`): títulos, labels de campo, botones, y estados `loading/empty/error` traducidos. Sin extraer a catálogo (literales in-place).

## Do's and Don'ts

- **DO**: deriva `INTERACTIVE_LAYER_IDS` del mismo spread de arrays que `MapView` ya itera — porque una lista paralela hardcodeada se desincroniza cuando se añade una capa (D-900/D-008).
- **DO**: cache-first en `{api.route.translate}` (consulta `getTranslation` ANTES de `complete`) — porque GDELT repite titulares; sin cache se re-pagaría IA por el mismo texto (D-903).
- **DO**: degrada `{api.route.translate}` a `{ translated: null }` 200 cuando no hay LLM o falla — porque la traducción es un extra; un 500 rompería el popup (D-907).
- **DO**: aplica `localizeCountry` SOLO en presentación (popup/panel), nunca sobre la clave usada para lookups/map-tie — porque el match interno (centroides, `activeCountry`) usa el nombre inglés; traducir la clave rompería el `flyTo` (D-904).
- **DO**: registra la excepción de IA-on-request como ADR-018 — porque hacerla explícita evita que se lea como erosión de la regla read-only (D-902).
- **DON'T**: NO añadas `react-map-gl` ni otra dep para el popup — MapLibre `Popup` nativo + DOM contenido basta (D-908, escalera rung 4).
- **DON'T**: NO introduzcas un framework i18n para 1 idioma — literales in-place (NG-2/D-905).
- **DON'T**: NO pre-traduzcas titulares en el job ni toques `@www/core-ai`/`core-signals`/scheduler — Slice D es aditiva (NG-1/NG-5).
- **DON'T**: NO traduzcas el botón "Traducir" sobre datos estructurados (CII/sanciones/etc.) — no hay texto libre que traducir ahí (D-901).
- **DON'T**: NO asumas que `Intl.DisplayNames('en').of(code)` coincide con la clave CII — varios no coinciden ("Russia", "South Korea"); el smoke debe cazar los mismatches y poblarlos en `COUNTRY_ALIASES` (D-904, lección L-5).

## Risks

- **R-1 — mismatch nombre-inglés ↔ clave CII** deja países sin españolizar (fallback al inglés). *Mitigación*: `COUNTRY_ALIASES` + el smoke EN VIVO recorre los países reales en paneles y caza los que sigan en inglés (mismo patrón que cazó Türkiye→Turkey en sanciones). Fallback nunca rompe (muestra el inglés).
- **R-2 — gpt-5.x trunca/agota tokens** y devuelve traducción vacía. *Mitigación*: `maxTokens≈800` holgado (D-907); vacío → `{ translated: null }` → "no disponible". El smoke verifica una traducción real no vacía.
- **R-3 — el guard `method !== 'GET'` mal reescrito** rompe los GET existentes o deja pasar POST no deseados. *Mitigación*: el ajuste permite EXACTAMENTE `POST /api/translate`; todo otro no-GET sigue → 405. Cubrir con server test (POST translate 200/400; POST a otra ruta → 405; GET intactos).
- **R-4 — el botón Traducir dispara IA repetidamente** (coste/abuso). *Mitigación*: cache-first (2º click = 0 IA, D-903); deshabilitar el botón mientras carga y tras éxito; guard de longitud + rate-limit del pipeline (D-902).
- **R-5 — popup imperativo fuga listeners** al re-clicar. *Mitigación*: una sola instancia `popup` reusada; `setDOMContent` reemplaza el nodo (y sus listeners) cada click; `popup.remove()` cuando no hay feature (D-908).
- **R-6 — `queryRenderedFeatures` devuelve features de capas ocultas** (toggle OFF). *Mitigación*: pasar `{ layers: INTERACTIVE_LAYER_IDS }` solo consulta esas capas; MapLibre ya filtra por visibilidad de capa (las `visibility:'none'` no devuelven features). Verificar en smoke con una capa apagada.

## Iteration Guide

Dependencias: `store` (migración + helpers, independiente, va 1º) → `server.ts` (ruta + body helper, depende de store + core-ai, desbloquea smoke `curl`) → `client.ts` (`translate`) → `i18n/countries.ts` (independiente) → `map/popup.ts` (`buildPopupNode`, depende de client + i18n) → `MapView.tsx` (click handler, depende de popup) → `App.tsx` + paneles (`{i18n.ui}`, independiente del resto, puede ir en paralelo).

Flujo de datos (traducción):

```
popup "Traducir" (MapView/popup.ts)
  └─> translate(text) [client.ts]
        └─> POST /api/translate [server.ts — AÑADIR, cache-first + IA]
              ├─> getTranslation(text) [@www/store — AÑADIR] ──hit──> { translated }
              └─miss─> complete(prompt) [@www/core-ai, EXISTE] ─> putTranslation ─> { translated }
```

Secuencia de implementación (UNA pieza de punta a punta antes de la siguiente):

1. **Store**: migración `008_translations.sql` + `getTranslation`/`putTranslation` + test (insert→get, replace, miss→null). `pnpm --filter @www/store test`.
2. **Server**: `readJsonBody` + rama `POST /api/translate` + reescritura del guard de método. Smoke: `curl -XPOST localhost:8787/api/translate -d '{"text":"oil tanker seized near Hormuz"}'` → `{translated:"..."}`; 2º curl mismo texto → cache hit (mismo resultado, sin log de IA). Server test: 200/400/405.
3. **Client**: `translate(text)` + extender `apiFetch` a POST si hace falta.
4. **i18n**: `countries.ts` con `localizeCountry` + test (Japan→Japón, Russia→Rusia vía alias, desconocido→fallback).
5. **Popup**: `map/popup.ts` `buildPopupNode` (ramas por tipo + botón Traducir) + test de la rama (dado un feature mock → nodo con los campos ES esperados).
6. **MapView**: `INTERACTIVE_LAYER_IDS` derivado + `map.on('click')` + cursor pointer.
7. **UI español**: `App.tsx` pestañas/aria + los 7 paneles. (Independiente; puede solaparse con 1–6.)
8. **Cierre**: tsc paquetes+raíz · suite · server test · web build · **smoke EN VIVO** (click real → popup ES → Traducir → texto español → 2º click cache) · **browser E2E** (Playwright: click en punto → popup visible → botón Traducir → texto cambia; pestañas en español; país en español en panel).

Reglas de edición del doc: añade variantes nuevas como entradas separadas; refiere por token; tras cada edición deja que `spec-validator.js` valide; cierra cada pieza con smoke EN VIVO ([[feedback-live-qa-vs-mocks]]).

## Known Gaps / Open Questions

- **GAP-1**: la lista estática de códigos ISO alpha-2 en `countries.ts` debe ser completa (~250) para no dejar países fuera; se incluye el set ISO 3166-1 estándar. Los nombres que `Intl.DisplayNames('en')` produce y que NO coinciden con las claves CII se descubren en el smoke (R-1) y se añaden a `COUNTRY_ALIASES`. No se enumeran todos a priori — el smoke es la red.
- **GAP-2**: el contenido exacto de `feature.properties` por capa (nombres de campo) se conoce de `MapView` (`eventsToGeoJSON` etc.) pero el implementador debe confirmar campo-a-campo al escribir `buildPopupNode` (p.ej. eventos exponen `event_type`/`severity`/`country`/`source`/`occurred_at`; señales `section`/`tone`/`title`; CII `composite`/`band`/`dominantComponent`).
- **GAP-3**: el prompt de traducción es un baseline (`"Traduce al español…"`); si gpt-5.x devuelve preámbulos ("Claro, aquí está:") pese al "solo el texto traducido", se endurece el prompt o se hace strip de la 1ª línea. El smoke lo valida (lección L-5).
- **OQ-1 (resuelta por el usuario, 2026-06-18)**: popup translate = **on-demand cacheado** (botón, no auto); clicables = **todos los puntos** (1 handler); UI español = **completa** (pestañas + paneles). Confirmado en brainstorming.
- **OQ-2 (resuelta por el usuario, 2026-06-18)**: la excepción `POST /api/translate` a la regla read-only = **aceptada** (ADR-018), frente a la alternativa de pre-traducir en el job (que rompía el "traduce ahora").
- **GAP-4**: responsive del popup en 375px (mobile) no validado a priori; `maxWidth:'320px'` cabe en 375 pero el botón + spinner deben verificarse en el smoke mobile (ADR-008).

## PLANNING COMPLETE
