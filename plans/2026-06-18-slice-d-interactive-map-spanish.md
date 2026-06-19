# Slice D — Mapa interactivo + español — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Clic en cualquier punto del mapa → popup en castellano (con botón "Traducir" en texto libre, vía IA cacheada) + nombres de país en español + UI 100% en español. Última pieza de la visión IA-first (ADR-015/016/017).

**Design doc:** `docs/design/2026-06-18-slice-d-interactive-map-spanish.md` (ADR-018, D-900..D-908).

**Architecture:** Aditiva, NO toca motor A/B/C (NG-1). (1) Migración 008 `translations` (cache) + 2 helpers store. (2) `POST /api/translate` cache-first = ÚNICA excepción a read-only (ADR-018), tras el pipeline de seguridad, degrada graciosa. (3) `MapView`: 1 click handler + `queryRenderedFeatures` sobre circle layers + `buildPopupNode` (popup.ts) con botón Traducir solo en eventos/señales. (4) `localizeCountry` (i18n/countries.ts) vía `Intl.DisplayNames('es')` reverse-map + alias. (5) UI español literal in-place (App + 7 paneles).

**Tech Stack:** `@www/store` (libSQL), `server.ts` (node http), `@www/core-ai` `complete()`, React/MapLibre (`packages/web`), node:test+tsx, Playwright.

**Decisions locked (ADR-018, design-doc):**
- D-900: 1 `map.on('click')` + `queryRenderedFeatures({layers: INTERACTIVE_LAYER_IDS})`; `INTERACTIVE_LAYER_IDS` DERIVADO del config-array filtrando `type!=='heatmap'`.
- D-901: `buildPopupNode` ramifica por capa, campos en español; botón "Traducir" SOLO en eventos/señales (texto libre).
- D-902 (ADR-018): `POST /api/translate` = única excepción a no-LLM-on-request; cache-first; guard longitud (1..500); tras pipeline seguridad.
- D-903: tabla `translations(source PK, target, created_at)` migr 008; dedupe por texto; sin columna lang (YAGNI).
- D-904: `localizeCountry` en→ISO2→es vía `Intl.DisplayNames`; fallback original + `COUNTRY_ALIASES`; capa presentación (NUNCA sobre claves de lookup).
- D-905: UI español literal in-place, sin framework i18n.
- D-906: provincias/ciudades solo vía traducción del titular (sin gazetteer).
- D-907: `complete()` temp 0, maxTokens 800; sin LLM/fallo → `{translated:null}` 200 graciosa.
- D-908: popup DOM imperativo de MapLibre contenido en `buildPopupNode`; sin dep nueva.

**GOTCHAS conocidos:**
- `migrate.ts` parte el SQL por `;` y DESCARTA chunks que empiezan por `--` → **008 SIN comentario inicial** (solo el `CREATE TABLE`), o el statement se salta.
- CORS hoy expone `Access-Control-Allow-Methods: 'GET, OPTIONS'` → añadir `POST`.
- El guard `method !== 'GET'` en `route()` rechaza todo no-GET → permitir EXACTAMENTE `POST /api/translate`.
- `apiFetch<T>(path)` es GET-only → extender con `init?: RequestInit`.
- gpt-5.x (reasoning) consume completion en razonamiento → maxTokens holgado (800) aunque el output sea 1 frase (gotcha slice B).
- Modelo LLM por env (`OPENAI_MODEL`), NUNCA hardcode ([[never-assume-llm-model]]).

---

## File Structure
- `packages/store/migrations/008_translations.sql` — NUEVO (sin comentario inicial).
- `packages/store/src/index.ts` — `getTranslation`/`putTranslation`.
- `packages/store/test/store.test.ts` — test cache hit/miss/replace.
- `server.ts` — `readJsonBody` + `POST /api/translate` + ajuste guard método + CORS POST.
- `server.test.ts` — POST translate 200/400; otro no-GET → 405; GET intactos.
- `packages/web/src/api/client.ts` — `apiFetch` con `init` + `translate(text)`.
- `packages/web/src/i18n/countries.ts` — NUEVO `localizeCountry` + `COUNTRY_ALIASES`.
- `packages/web/src/i18n/countries.test.ts` (o test colocado) — Japan→Japón, alias, fallback.
- `packages/web/src/map/popup.ts` — NUEVO `buildPopupNode(feature, onTranslate)`.
- `packages/web/src/map/popup.test.ts` — rama por tipo → nodo con campos ES.
- `packages/web/src/map/MapView.tsx` — `INTERACTIVE_LAYER_IDS` + click handler + cursor.
- `packages/web/src/App.tsx` + 7 paneles — UI español ({i18n.ui}).
- `packages/web/src/styles.css` — estilos del popup.
- `packages/web/slice-d-e2e.mjs` — NUEVO E2E.
- `plans/DECISIONS.md` (ADR-018), `plans/ROADMAP.md`.

---

## Task 1: Store — cache de traducciones

**Files:** `packages/store/migrations/008_translations.sql`, `packages/store/src/index.ts`, `packages/store/test/store.test.ts`

- [ ] **Step 1:** Crear `008_translations.sql` (SIN comentario inicial — gotcha migrate split):

```sql
CREATE TABLE IF NOT EXISTS translations (
  source TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL
)
```

- [ ] **Step 2:** En `index.ts` añadir helpers (usa `getDb()`, patrón existente):

```ts
export async function getTranslation(source: string): Promise<string | null> {
  const rs = await getDb().execute({ sql: 'SELECT target FROM translations WHERE source = ?', args: [source] });
  const row = rs.rows[0];
  return row ? String(row['target']) : null;
}
export async function putTranslation(source: string, target: string): Promise<void> {
  await getDb().execute({
    sql: 'INSERT OR REPLACE INTO translations (source, target, created_at) VALUES (?, ?, ?)',
    args: [source, target, Date.now()],
  });
}
```

- [ ] **Step 3:** Test en `store.test.ts` (patrón `:memory:` + `migrate()` + `_resetDbForTesting`):

```ts
test('translations: put → get; replace; miss → null', async () => {
  assert.equal(await getTranslation('no-existe'), null);
  await putTranslation('oil tanker seized', 'petrolero incautado');
  assert.equal(await getTranslation('oil tanker seized'), 'petrolero incautado');
  await putTranslation('oil tanker seized', 'buque petrolero incautado'); // REPLACE
  assert.equal(await getTranslation('oil tanker seized'), 'buque petrolero incautado');
});
```

- [ ] **Step 4:** `pnpm --filter @www/store test` → PASS. `pnpm --filter @www/store build`.
- [ ] **Step 5:** Commit — `feat(store): translations cache table (migr 008) + get/put helpers`

---

## Task 2: Server — POST /api/translate (cache-first + IA)

**Files:** `server.ts`, `server.test.ts`

- [ ] **Step 1:** Helper `readJsonBody` (tope de bytes, parse defensivo):

```ts
function readJsonBody(req: http.IncomingMessage, maxBytes = 4096): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}
```

- [ ] **Step 2:** Ajustar el guard de método en `route()`. Hoy:

```ts
  if (method !== 'GET') { sendJson(res, 405, { error: 'Method Not Allowed' }); return; }
```

→ permitir el POST concreto:

```ts
  if (method !== 'GET' && !(method === 'POST' && pathname === '/api/translate')) {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }
```

- [ ] **Step 3:** Añadir la ruta (importar `complete` de `@www/core-ai` y `getTranslation`/`putTranslation` de `@www/store`):

```ts
// POST /api/translate — ADR-018 / D-902. ÚNICA excepción a no-LLM-on-request.
// Cache-first; dispara IA solo en miss; degrada graciosa (D-907).
if (pathname === '/api/translate' && method === 'POST') {
  const body = await readJsonBody(req);
  const text = typeof body?.['text'] === 'string' ? (body['text'] as string).trim() : '';
  if (!text || text.length > 500) { sendJson(res, 400, { error: 'text required (1..500 chars)' }); return; }
  const cached = await getTranslation(text);
  if (cached !== null) { sendJson(res, 200, { translated: cached }); return; }
  try {
    const prompt = `Traduce al español. Devuelve SOLO la traducción, sin comillas, sin preámbulo:\n\n${text}`;
    const out = (await complete(prompt, { temperature: 0, maxTokens: 800 })).trim();
    if (out) await putTranslation(text, out);
    sendJson(res, 200, { translated: out || null });
  } catch { sendJson(res, 200, { translated: null }); }
  return;
}
```

- [ ] **Step 4:** CORS — añadir POST a methods:

```ts
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
```

- [ ] **Step 5:** Tests en `server.test.ts`: (a) `POST /api/translate {text:'hello'}` → 200 `{translated}` (mockear/saltar IA si no hay key: aceptar `translated` string|null); (b) `POST /api/translate {text:''}` → 400; (c) `POST /api/translate` con texto >500 → 400; (d) `POST /api/markets` → 405; (e) un `GET /api/health` sigue 200; (f) **W1 plan-checker — preflight**: `OPTIONS /api/translate` (con Origin permitido) → 204 y `Access-Control-Allow-Methods` incluye POST. Nota: sin OPENAI_API_KEY el caso (a) devuelve `{translated:null}` 200 (degradado D-907) — el test acepta ambos.
- [ ] **Step 6:** `node --import tsx --test server.test.ts` → PASS. `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 7:** Commit — `feat(server): POST /api/translate cache-first (ADR-018) + body helper`

---

## Task 3: Client + i18n de países

**Files:** `packages/web/src/api/client.ts`, `packages/web/src/i18n/countries.ts`, `packages/web/src/i18n/countries.test.ts`

- [ ] **Step 1:** `client.ts` — extender `apiFetch` para aceptar init y añadir `translate`:

```ts
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) throw new Error(`API ${path} returned ${response.status}: ${response.statusText}`);
  return response.json() as Promise<T>;
}

export async function translate(text: string): Promise<string | null> {
  try {
    const res = await apiFetch<{ translated: string | null }>('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return res?.translated ?? null;
  } catch { return null; } // graceful — el popup muestra "no disponible"
}
```

- [ ] **Step 2:** Crear `i18n/countries.ts` (D-904). Lista ISO 3166-1 alpha-2 COMPLETA (~250 códigos) + reverse map + alias:

```ts
const ISO2 = ['AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR', /* … set ISO completo … */ 'ZW'];
const enDisplay = new Intl.DisplayNames(['en'], { type: 'region' });
const esDisplay = new Intl.DisplayNames(['es'], { type: 'region' });
const EN_TO_CODE = new Map<string, string>();
for (const code of ISO2) { const en = enDisplay.of(code); if (en) EN_TO_CODE.set(en, code); }

// Claves CII que NO coinciden con el display inglés de Intl (se completan con el smoke, R-1).
const COUNTRY_ALIASES: Record<string, string> = {
  'Russia': 'RU', 'South Korea': 'KR', 'North Korea': 'KP', 'United States': 'US',
  'Iran': 'IR', 'Syria': 'SY', 'Vietnam': 'VN', 'Laos': 'LA', 'Moldova': 'MD',
  'Bolivia': 'BO', 'Venezuela': 'VE', 'Tanzania': 'TZ', 'Czech Republic': 'CZ',
  // … añadir mismatches que cace el smoke en vivo …
};

export function localizeCountry(en: string): string {
  if (!en) return en;
  const code = COUNTRY_ALIASES[en] ?? EN_TO_CODE.get(en);
  if (!code) return en;
  return esDisplay.of(code) ?? en;
}
```

- [ ] **Step 3:** Test en **`packages/web/test/countries.test.ts`** (W3 plan-checker: el root `test` script globa `packages/*/test/**/*.ts` — web NO tenía dir `test/`; crearlo. `countries.ts` debe ser **import-free** (solo `Intl`) para correr bajo node:test+tsx sin chocar con la resolución bundler del resto de web):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localizeCountry } from '../src/i18n/countries.ts';
test('localizeCountry: known → ES', () => { assert.equal(localizeCountry('Japan'), 'Japón'); });
test('localizeCountry: alias → ES', () => { assert.equal(localizeCountry('Russia'), 'Rusia'); });
test('localizeCountry: unknown → fallback', () => { assert.equal(localizeCountry('Wakanda'), 'Wakanda'); });
test('localizeCountry: empty → empty', () => { assert.equal(localizeCountry(''), ''); });
```

(Confirmar que `pnpm test` recoge el nuevo `packages/web/test/`. Si el glob no lo captura, ajustar el patrón del script root o correrlo explícito.)

- [ ] **Step 4:** `pnpm --filter @www/web exec tsc --noEmit`. Commit — `feat(web): translate() client + localizeCountry i18n (ES)`

---

## Task 4: Popup + click handler en MapView

**Files:** `packages/web/src/map/popup.ts`, `packages/web/src/map/popup.test.ts`, `packages/web/src/map/MapView.tsx`, `packages/web/src/styles.css`

- [ ] **Step 1:** Crear `map/popup.ts` — `buildPopupNode(feature, onTranslate)` (D-901/D-908). Ramifica por `feature.layer.id` (prefijos `evt-`,`sig-`,`cii-`,`convergence-`,`sanctions-`,`chokepoints`). Confirmar nombres de prop con `eventsToGeoJSON`/`signalsToGeoJSON`/etc. de `MapView` (GAP-2). Estructura:

```ts
import { localizeCountry } from '../i18n/countries';
import type { MapGeoJSONFeature } from 'maplibre-gl';

const TYPE_ES: Record<string, string> = { earthquake:'Terremoto', wildfire:'Incendio', volcano:'Volcán',
  storm:'Tormenta', flood:'Inundación', conflict:'Conflicto', protest:'Protesta' };

function row(label: string, value: string): HTMLElement { /* <div><b>label:</b> value</div> */ }

export function buildPopupNode(
  feature: MapGeoJSONFeature,
  onTranslate: (text: string) => Promise<string | null>,
): HTMLElement {
  const p = feature.properties ?? {};
  const layerId = feature.layer.id;
  const el = document.createElement('div');
  el.className = 'map-popup';
  if (layerId.startsWith('evt-')) {
    // título, tipo (TYPE_ES), severidad, país (localizeCountry), fecha (toLocaleDateString('es')), fuente
    // + botón Traducir sobre p.title
  } else if (layerId.startsWith('sig-')) {
    // sección, tono, país, fecha, fuente, título + botón Traducir
  } else if (layerId.startsWith('cii')) {
    // país, banda, composite, dominante  (sin botón)
  } else if (layerId.startsWith('convergence')) {
    // país, fuerza, familias, dimensión  (sin botón)
  } else if (layerId.startsWith('sanctions')) {
    // país, nº sancionados  (sin botón)
  } else if (layerId.startsWith('chokepoints')) {
    // nameEs, estado, score  (sin botón; ya en español)
  }
  return el;
}
```

  Botón Traducir: crea `<button>Traducir</button>` + un `<span>` para el resultado; `onclick` → `btn.disabled=true; btn.textContent='Traduciendo…'`; `const t = await onTranslate(title)`; si `t` → reemplaza el nodo del titular por `t` y marca "(traducido)"; si `null` → `btn.textContent='Traducción no disponible'`. Sin titular (texto libre vacío) → no añade botón.

- [ ] **Step 2:** **(W3 plan-checker — decidido)** `buildPopupNode` usa `document.*` (DOM) y web no tiene jsdom; añadir jsdom por un popup = dep injustificada (escalera rung 4). → **NO test unit DOM**; el popup se cubre por **E2E** (Task 6, navegador real). Para mantener algo testeable barato: extraer la lógica de *qué filas en español* produce cada tipo a una función pura `popupRows(props, layerId): {label,value}[]` (sin DOM) y testearla en `packages/web/test/popup.test.ts` (assert: evento→incluye "Terremoto" + país ES; CII→banda y sin fila de titular). `buildPopupNode` solo ensambla esas filas + el botón en DOM.

- [ ] **Step 3:** `MapView.tsx` — derivar ids + click handler:

```ts
import { translate } from '../api/client';
import { buildPopupNode } from './popup';

const INTERACTIVE_LAYER_IDS = [
  ...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS, ...CHOKEPOINT_LAYERS,
].filter((l) => l.type !== 'heatmap').map((l) => l.id);
```

  En `map.on('load')` tras añadir capas (o al final del init effect): crear una instancia `const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' })` (guardar en ref), y:

```ts
map.on('click', (e) => {
  const feats = map.queryRenderedFeatures(e.point, { layers: INTERACTIVE_LAYER_IDS.filter((id) => map.getLayer(id)) });
  const f = feats[0];
  if (!f) { popup.remove(); return; }
  const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
  popup.setLngLat(coords).setDOMContent(buildPopupNode(f, translate)).addTo(map);
});
map.on('mouseenter', INTERACTIVE_LAYER_IDS, () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', INTERACTIVE_LAYER_IDS, () => { map.getCanvas().style.cursor = ''; });
```

  (Si la firma de `mouseenter` con array no está soportada en esta versión de MapLibre, registrar por id en un bucle.)

- [ ] **Step 4:** `styles.css` — `.map-popup` (color de texto, font-size, gap), `.map-popup button` (botón Traducir), respetar tema oscuro. Asegurar legibilidad sobre el popup blanco por defecto de MapLibre (o estilar `.maplibregl-popup-content`).

- [ ] **Step 5:** `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`.
- [ ] **Step 6:** Commit — `feat(web): map click → popup ES + on-demand translate (D-900..D-908)`

---

## Task 5: UI en español ({i18n.ui} / D-905)

**Files:** `packages/web/src/App.tsx` + `panels/{Finance,Events,Radar,Risk,Convergence,Chokepoints,Intel}Panel.tsx`

- [ ] **Step 1:** `App.tsx` — pestañas: Finance→**Finanzas**, Events→**Eventos**, Radar→**Radar**, Risk→**Riesgo**, Convergence→**Convergencia** (Inteligencia/Rutas ya ES). `panelTitle` map al español. aria-labels (`Toggle … layer`, `Data panel`, `Collapse/Expand panel`, `Domain panels`) → español.
- [ ] **Step 2:** Cada panel: traducir título, labels de campo, botones, y estados `loading/empty/error`. Aplicar `localizeCountry` donde se muestre `country` (RiskPanel, ConvergencePanel, FinancePanel sanciones, EventsPanel, RadarPanel). Mantener nombres propios de instrumentos/símbolos sin traducir.
- [ ] **Step 3:** Revisar copy hardcoded en inglés (grep `>[A-Z][a-z]* ` sospechosos, textos de empty-state). No tocar lógica, solo strings + `localizeCountry` en presentación.
- [ ] **Step 4:** `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`.
- [ ] **Step 5:** Commit — `feat(web): UI en español (pestañas + 7 paneles) + países localizados`

---

## Task 6: Verify + smoke EN VIVO + E2E + ADR

**Files:** `packages/web/slice-d-e2e.mjs`, `plans/DECISIONS.md`, `plans/ROADMAP.md`

- [ ] **Step 1:** Gates: `pnpm -r exec tsc --noEmit && npx tsc --noEmit -p tsconfig.json` · `pnpm test` · `node --import tsx --test server.test.ts` · `pnpm --filter @www/web build`. Todo verde.
- [ ] **Step 2:** Smoke EN VIVO (lección L-5, [[feedback-live-qa-vs-mocks]]). Backend (`node --env-file-if-exists=.env --import tsx server.ts`, 8787) + vite (5173):
  - `curl -XPOST localhost:8787/api/translate -H 'Content-Type: application/json' -d '{"text":"oil tanker seized near Strait of Hormuz"}'` → `{translated:"…español…"}` no vacío.
  - Repetir el MISMO curl → idéntico, **cache hit** (sin nueva llamada IA; confirmar en logs del server que no llamó al provider).
  - `curl -XPOST … -d '{"text":""}'` → 400.
  - Abrir http://localhost:5173 → click en un punto de evento → popup en español con país localizado → botón "Traducir" → texto cambia a español. 2º click mismo punto → traducción instantánea (cache).
  - Verificar pestañas en español y un país en español en RiskPanel (caza mismatches → poblar `COUNTRY_ALIASES`, R-1).
- [ ] **Step 3:** `slice-d-e2e.mjs` (Playwright, patrón de los e2e existentes): (a) click en canvas sobre un punto conocido → `.maplibregl-popup` visible; (b) popup contiene texto español; (c) si hay botón Traducir → click → el contenido cambia (tolerante a `null` si no hay key: aceptar "no disponible"); (d) la 2ª pestaña dice "Finanzas"; (e) sin errores de consola. Tolerante a data-vacía como los e2e previos.
- [ ] **Step 4:** Correr E2E (ambos servers) → VERDICT PASS. Guardar resumen.
- [ ] **Step 5:** `plans/DECISIONS.md` — ADR-018 (excepción translate + D-900..D-908). `plans/ROADMAP.md` — Slice D ✅, Fase 5 COMPLETA (4/4). Actualizar progreso global.
- [ ] **Step 6:** Commit — `test(web): Slice D smoke+E2E + ADR-018; Fase 5 IA-first COMPLETA`

---

## Self-Review

**Coverage de requisitos:** D1 click→popup (T4) · traducción on-demand cacheada (T1 store + T2 server + T3 client + T4 botón) · D2 países ES (T3 i18n + T5 aplicación) · D3 UI español (T5). Smoke+E2E (T6). Las 3 piezas de la visión cubiertas.

**Type consistency:** `translate(): Promise<string|null>` consistente client↔server (`{translated:string|null}`). `getTranslation/putTranslation` tipados en store. `localizeCountry(string):string` puro. `INTERACTIVE_LAYER_IDS` derivado del mismo `LayerSpec[]` que itera MapView (sin lista paralela).

**Dependencias / orden:** store (T1, indep) → server (T2, dep store+core-ai) → client+i18n (T3) → popup+MapView (T4, dep client+i18n) → UI español (T5, indep, paralelizable) → verify (T6). Sin ciclos.

**Scope:** NO toca `@www/core-signals`/`@www/core-ai`/scheduler/migraciones 001–007 (NG-1). Solo añade migr 008 + 1 ruta POST + click handler + i18n + copy. Sin framework i18n (NG-2). Sin gazetteer (NG-3). DB queda en inglés (NG-4). Job intacto (NG-5).

**Placeholders:** la lista ISO2 completa y `buildPopupNode` por-rama son esqueletos a rellenar con campos reales (GAP-1/GAP-2) — el implementador confirma props con `MapView` y caza alias con el smoke. No hay stubs que pasen como hechos: cada pieza cierra con su test/curl.

**Riesgos (del design-doc):** R-1 mismatch nombre-país → fallback inglés + alias vía smoke. R-2 gpt-5.x trunca → maxTokens 800 + degradado null. R-3 guard método mal → server test cubre 405/200/400 + GET intactos. R-4 abuso botón → cache-first + disable + rate-limit. R-5 fuga listeners → 1 popup reusado. R-6 features de capas ocultas → `{layers}` + visibilidad MapLibre.

**Gotchas verificados:** migrate split por `;`/`--` → 008 sin comentario. CORS +POST. guard método +excepción. apiFetch +init. Modelo por env.
