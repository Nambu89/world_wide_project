# UI Redesign — Slice 1 (command-center reskin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox (`- [ ]`).

**Goal:** Reskin visual de `packages/web` a estética "command-center" (HUD cian + basemap dark vector + marcadores glow + tipografía), SIN tocar MapLibre v4 (mapa sigue plano), sin tocar backend/store/datos/motor, preservando Slice D.

**Architecture:** Frontend-only. Tres cambios: (1) basemap raster-OSM → CARTO dark-matter vector (`MapView.tsx`); (2) capas glow gemelas (`circle-blur`) por cada circle-layer vía el config-array (`layers.config.ts` + iter en `MapView`); (3) reskin completo de `styles.css` a HUD cian con tokens en `:root` + Inter + monospace. El JS de interacción de Slice D (popup/Traducir/i18n/click) NO se toca — reskin = CSS + config de capas.

**Tech Stack:** Vite + React + MapLibre GL ^4.7.0 (NO subir versión), CSS, node:test+tsx, Playwright.

**Design doc:** `docs/design/2026-06-19-ui-redesign-command-center.md` (ADR-019, D-1001..D-1010).

## Global Constraints

- **NO subir MapLibre** de `^4.7.0` (el globo + v5 es Slice 2, NG-1). Si te ves editando la versión de maplibre → PARA.
- **NO tocar** `server.ts`, `@www/store`, `packages/connectors`, `packages/scheduler`, `@www/core-*`, migraciones (NG-2).
- **NO tocar** `map/popup.ts` (`buildPopupNode`/`popupRows`), `i18n/countries.ts`, `client.ts` `translate()`, el click handler ni `INTERACTIVE_LAYER_IDS` salvo excluir `-glow` (NG-3 / D-1010).
- **Capas SOLO en el config-array** central; `MapView` itera. NUNCA `addLayer` disperso (D-008).
- **Acento cian = chrome estructural**; rojo/ámbar/verde = severidad semántica. No mezclar (D-1003).
- **Severidad intacta**: `--danger #ef4444`, `--warning #f59e0b`, `--success #22c55e`.
- **Gates verdes obligatorios** al cierre: tsc paquetes+raíz, suite, server test (72/0, no debe cambiar), web build, **browser E2E Slice D**. Si un selector del E2E cambia por el reskin, se ajusta el E2E, NO se degrada la feature (D-1010).
- **Zero-key**: CARTO dark-matter es keyless; atribución visible obligatoria ([[feedback_data_tos]]).

---

## Task 1: Design tokens + tipografía (`:root` + fuentes)

**Files:**
- Modify: `packages/web/src/styles.css:4-35` (bloque `:root`) + cabecera (import fuente)

**Interfaces:**
- Produces: CSS custom-props `--accent`, `--accent-dim`, `--accent-glow`, `--panel`, `--bg`, `--mono`; `--font-family` con Inter. Consumidas por todas las tareas de chrome.

- [ ] **Step 1:** Al inicio de `styles.css` (antes de `:root`) añadir Inter vía `@import` (lazy, fallback system; D-1007/GAP-4):

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
```

- [ ] **Step 2:** En `:root` añadir/ajustar tokens (mantener los `--color-*` existentes que usan los paneles; AÑADIR los nuevos del HUD):

```css
  /* command-center reskin (D-1003) */
  --bg: #060a12;
  --panel: #0a111c;
  --accent: #22d3ee;          /* cian estructural */
  --accent-dim: #1c3550;
  --accent-glow: rgba(34,211,238,.22);
  --mono: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
  --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  /* re-mapear las superficies base al nuevo fondo */
  --color-bg-primary: #060a12;
  --color-bg-surface: #0a111c;
  --color-bg-elevated: #0c1422;
  --color-border: #1c3550;
  --color-accent: #22d3ee;
  --color-accent-hover: #38bdf8;
```

(Las severidades `--color-success/#22c55e`, `--color-warning/#f59e0b`, `--color-danger/#ef4444` se mantienen.)

- [ ] **Step 3:** Build — `pnpm --filter @www/web build`. Expected: OK.
- [ ] **Step 4:** Commit — `git add packages/web/src/styles.css && git commit -m "style(web): command-center design tokens + Inter (reskin slice 1)"`

---

## Task 2: Basemap dark vector (CARTO)

**Files:**
- Modify: `packages/web/src/map/MapView.tsx` (el `style` del `new maplibregl.Map({...})` + un error-log)
- Modify: `packages/web/src/styles.css` (`.map-container` fondo oscuro)

**Interfaces:**
- Consumes: nada nuevo. Produces: `DARK_STYLE_URL` const.

> **Decisión (resuelve issue del plan-checker):** se DESCARTA el auto-fallback `setStyle(raster)` — `setStyle()` elimina todas las sources/capas y NO re-inyecta los datos ya fetchados (re-registro + re-inyección = doble-bind y plumbing frágil). La app necesita conectividad para sus datos/LLM/tiles de todos modos, así que un fallback solo-basemap aporta poco. Mitigación lean: **fondo de contenedor oscuro** (un basemap caído se ve oscuro, no roto/blanco) + log de error. Hard raster-fallback diferido (actualiza R-1/D-1001 del design-doc).

- [ ] **Step 1:** Añadir constante arriba de `MapView` (tras imports):

```ts
// D-1001: basemap vector oscuro keyless (reemplaza el raster-OSM).
const DARK_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
```

- [ ] **Step 2:** Cambiar el `style` del `new maplibregl.Map({...})` del objeto raster inline a `style: DARK_STYLE_URL`. Mantener `center/zoom/minZoom/maxZoom/attributionControl`. NO tocar el `map.on('load', ...)` (registro de sources/capas + click handler de Slice D quedan idénticos — CARTO carga rápido, 'load' dispara igual).

- [ ] **Step 3:** Tras crear el map, log graceful (sin re-style):

```ts
// ponytail: basemap caído → fondo oscuro (CSS) + log; la app sigue (datos/paneles independientes).
map.on('error', (e) => { console.warn('[map] style/source error:', e?.error?.message ?? e); });
```

- [ ] **Step 4:** En `styles.css`, `.map-container` (línea ~91) fondo oscuro para que un basemap ausente no se vea roto:

```css
.map-container { background: var(--bg); }
```

- [ ] **Step 5:** Typecheck + build — `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`. Expected: EXIT 0 + OK.
- [ ] **Step 6:** Smoke visual (servers arriba, ver "How to test"): el mapa carga **oscuro vector** (sin calles), los dots de datos aparecen encima. Atribución "CARTO/OSM" visible (la trae el style.json de CARTO).
- [ ] **Step 7:** Commit — `git add packages/web/src/map/MapView.tsx packages/web/src/styles.css && git commit -m "feat(web): dark vector basemap (CARTO dark-matter)"`

---

## Task 3: Marcadores con glow (config-array)

**Files:**
- Modify: `packages/web/src/map/layers.config.ts` (añadir `glowOf` + `GLOW_LAYERS`)
- Modify: `packages/web/src/map/MapView.tsx` (iterar glow debajo; excluir `-glow` de `INTERACTIVE_LAYER_IDS`)
- Test: `packages/web/test/glow.test.ts`

**Interfaces:**
- Produces: `export function glowOf(spec: LayerSpec): LayerSpec` y `export const GLOW_LAYERS: LayerSpec[]`.

- [ ] **Step 1 (test primero):** `packages/web/test/glow.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glowOf, GLOW_LAYERS, LAYERS } from '../src/map/layers.config.ts';

test('glowOf: id sufijo -glow + circle-blur + radio escalado', () => {
  const base = LAYERS.find((l) => l.id === 'evt-earthquake')!;
  const g = glowOf(base);
  assert.equal(g.id, 'evt-earthquake-glow');
  assert.equal(g.type, 'circle');
  assert.equal((g.paint as Record<string, unknown>)['circle-blur'], 1);
  assert.ok((g.paint as Record<string, unknown>)['circle-radius'] !== undefined);
  assert.equal(g.toggleKey, base.toggleKey); // togglea con su padre
});
test('GLOW_LAYERS: solo circle (no heatmap), todas -glow', () => {
  assert.ok(GLOW_LAYERS.length > 0);
  assert.ok(GLOW_LAYERS.every((l) => l.id.endsWith('-glow') && l.type === 'circle'));
});
```

- [ ] **Step 2:** Correr → FAIL (`glowOf is not exported`). `node --import tsx --test packages/web/test/glow.test.ts`.

- [ ] **Step 3:** En `layers.config.ts` añadir (antes de `LAYER_SOURCES`):

```ts
/** D-1002: deriva una capa "glow" gemela (halo difuso) de un circle-layer.
 *  Reusa color y source; radio ~2.2× (envuelve la expresión si es array). */
const GLOW_SCALE = 2.2;
export function glowOf(spec: LayerSpec): LayerSpec {
  const r = (spec.paint?.['circle-radius'] ?? 6) as unknown;
  const radius = Array.isArray(r) ? ['*', r, GLOW_SCALE] : (typeof r === 'number' ? r * GLOW_SCALE : 14);
  return {
    ...spec,
    id: spec.id + '-glow',
    paint: {
      'circle-color': spec.paint?.['circle-color'] ?? '#22d3ee',
      'circle-blur': 1,
      'circle-opacity': 0.45,
      'circle-radius': radius,
    },
  };
}
/** Glow gemelo de cada circle-layer (heatmap excluido — ya es densidad). */
export const GLOW_LAYERS: LayerSpec[] = [
  ...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS, ...CHOKEPOINT_LAYERS,
].filter((l) => l.type === 'circle').map(glowOf);
```

- [ ] **Step 4:** Correr test → PASS.

- [ ] **Step 5:** En `MapView.tsx`:
  - Importar `GLOW_LAYERS` de `./layers.config`.
  - En el bucle de `addLayer` (dentro de `registerLayers`), iterar **GLOW primero**: cambiar el spread a `[...GLOW_LAYERS, ...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS, ...CHOKEPOINT_LAYERS]` (glow se añade antes → queda DEBAJO; D-1002/{glow.order}).
  - En el effect de visibilidad, usar el MISMO spread con GLOW_LAYERS para que togglen con su padre.
  - **Excluir glow de interacción**: en `INTERACTIVE_LAYER_IDS`, cambiar el filtro a `.filter((l) => l.type !== 'heatmap' && !l.id.endsWith('-glow'))` (el click pega en el dot nítido, no en el halo; D-1002).

- [ ] **Step 6:** tsc + build — `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`. Expected: EXIT 0 + OK.
- [ ] **Step 7:** Smoke visual: halos difusos bajo los dots; FPS fluido (R-3 — si lag con muchos puntos, limitar glow a cii/chokepoints; documentar).
- [ ] **Step 8:** Commit — `git add packages/web/src/map/layers.config.ts packages/web/src/map/MapView.tsx packages/web/test/glow.test.ts && git commit -m "feat(web): glow marker layers (osiris pattern) via config-array"`

---

## Task 4: Chrome HUD cian (reskin styles.css)

**Files:**
- Modify: `packages/web/src/styles.css` (bloques `.panel-wrapper` :101, `.panel-handle` :121, `.panel-tabs/.panel-tab` :718-747, `.intel-card*` :585-718, `.layer-toggle*` :201-220, popup `.maplibregl-popup-content`/`.map-popup*` al final)
- Modify (markup mínimo): `packages/web/src/App.tsx` (header HUD `//` + indicador LIVE — opcional, solo si aporta)

**Interfaces:** consume `{theme.tokens}` de Task 1.

- [ ] **Step 1 — Panel + corchetes HUD (D-1004):** reskin `.panel-wrapper`/`.panel-content` a `background:var(--panel)`, borde `var(--accent-dim)`, y añadir corchetes de esquina:

```css
.panel-wrapper { background: var(--panel); border-color: var(--accent-dim); box-shadow: inset 0 0 40px #0ea5e90d; position: relative; }
.panel-wrapper::before, .panel-wrapper::after { content:''; position:absolute; width:14px; height:14px; border:2px solid var(--accent); pointer-events:none; z-index:2; }
.panel-wrapper::before { top:6px; left:6px; border-right:0; border-bottom:0; }
.panel-wrapper::after { bottom:6px; right:6px; border-left:0; border-top:0; }
```

- [ ] **Step 2 — Pestañas mono-uppercase (D-1004):**

```css
.panel-tab { font-family: var(--mono); text-transform: uppercase; letter-spacing:.08em; font-size:11px; color:#5f7b96; background:transparent; border:0; border-bottom:2px solid transparent; }
.panel-tab.active { color:#eaf2f9; border-bottom-color: var(--accent); text-shadow:0 0 10px var(--accent-glow); }
.panel-tab:hover:not(.active) { color:#9fb3c8; }
```

- [ ] **Step 3 — Intel-cards HUD (D-1005):** acento-glow por severidad (la tarjeta ya tiene `.intel-card__severity`; añadir barra de acento + chips):

```css
.intel-card { position:relative; background:#0b1422; border:1px solid var(--accent-dim); border-radius:6px; overflow:hidden; }
.intel-card::before { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; background: var(--color-warning); box-shadow:0 0 12px 2px var(--color-warning); }
.intel-card[data-sev="alta"]::before { background: var(--color-danger); box-shadow:0 0 12px 2px var(--color-danger); }
.intel-card__severity { font-family: var(--mono); font-size:9px; text-transform:uppercase; }
.intel-card__chip { font-family: var(--mono); font-size:9px; border:1px solid var(--accent-dim); color:#7dd3fc; padding:3px 6px; background:transparent; }
.intel-card__consequence::before { color: var(--accent); }   /* flecha cian */
```

(El `data-sev` lo emite `IntelPanel` — ver Step 6.)

- [ ] **Step 4 — Toggles → chips HUD (D-1008):**

```css
.layer-toggle-btn { font-family: var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.06em; border:1px solid var(--accent-dim); background:#0c1422; color:#7b8aa0; border-radius:4px; }
.layer-toggle-btn.active { color:#a5f3fc; border-color: var(--accent); box-shadow:0 0 12px var(--accent-glow); }
```

- [ ] **Step 5 — Popup HUD (D-1006, SOLO CSS, no toca popup.ts):** reemplazar el bloque popup actual:

```css
.maplibregl-popup-content { background: var(--panel); color:#e6edf3; border:1px solid var(--accent); border-radius:0; padding:11px 13px; box-shadow:0 0 0 1px #060b14,0 10px 30px #000a; position:relative; }
.maplibregl-popup-content::before { content:''; position:absolute; top:4px; left:4px; width:10px; height:10px; border:2px solid var(--accent); border-right:0; border-bottom:0; }
.map-popup__heading { font-family: var(--mono); letter-spacing:.16em; text-transform:uppercase; color: var(--accent); text-shadow:0 0 8px var(--accent-glow); }
.map-popup__label { font-family: var(--mono); color:#5f7b96; }
.map-popup__row { font-family: var(--mono); font-size:11px; color:#aebfd0; }
.map-popup__translate { background: var(--accent); color:#06121a; font-family: var(--mono); text-transform:uppercase; font-size:10px; border-radius:0; }
.maplibregl-popup-anchor-top .maplibregl-popup-tip { border-bottom-color: var(--accent); }
.maplibregl-popup-anchor-bottom .maplibregl-popup-tip { border-top-color: var(--accent); }
```

- [ ] **Step 6 — `data-sev` en IntelPanel (markup mínimo):** en `IntelPanel.tsx`, añadir `data-sev={c.severity}` al `<li className="intel-card...">` para que el CSS del Step 3 coloree el acento. (No cambia lógica.)

- [ ] **Step 7 — Header HUD opcional:** en `App.tsx`, el `.panel-handle-title`/header de panel → prefijo `//` + clase mono. Si añade fricción, omitir (D-1004 lo permite mínimo).

- [ ] **Step 8:** tsc + build — `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`. Expected: EXIT 0 + OK.
- [ ] **Step 9:** Smoke visual 1200px + 375px: paneles HUD, pestañas mono, intel-cards con acento, popup HUD, toggles chips. Contraste legible (R-5).
- [ ] **Step 10:** Commit — `git add packages/web/src && git commit -m "style(web): HUD command-center chrome (panels/tabs/cards/popup/toggles)"`

---

## Task 5: Preservar Slice D + verify + E2E + ADR

**Files:**
- Modify (si hace falta): `packages/web/slice-d-e2e.mjs` (ajustar selectores si el reskin renombró clases — NO debería; reusa clases existentes)
- Create: `packages/web/redesign-e2e.mjs` (E2E del reskin)
- Modify: `plans/DECISIONS.md` (ADR-019), `plans/ROADMAP.md`

- [ ] **Step 1:** Gates: `pnpm -r exec tsc --noEmit` (EXIT 0) · `npx tsc --noEmit -p tsconfig.json` (EXIT 0) · `pnpm test` (espera **+2** vs 349 por glow.test = ~351/0) · `node --import tsx --test server.test.ts` (72/0, sin cambios) · `pnpm --filter @www/web build` (OK).
- [ ] **Step 2:** Correr `slice-d-e2e.mjs` (backend+vite arriba) → **VERDICT PASS** (D-1010). El reskin reusó las clases `.map-popup__*`/`.panel-tab`/`.intel-card`, así que debería pasar sin tocar; si una aserción falla por una clase cambiada, ajustar el selector en el E2E (no degradar la feature).
- [ ] **Step 3:** `redesign-e2e.mjs` (Playwright): (a) carga sin errores consola; (b) `.maplibregl-popup-content` tiene `border-color` ≈ cian al abrir un popup; (c) `.panel-tab.active` usa font monospace; (d) basemap canvas presente (no raster-OSM: comprobar que NO hay request a `tile.openstreetmap.org` salvo en fallback) — opcional/tolerante; (e) 375px sin overflow horizontal.
- [ ] **Step 4:** Correr `redesign-e2e.mjs` → PASS.
- [ ] **Step 5:** Smoke vivo: abrir 5173, ver mapa oscuro + glow + chrome HUD; click en punto → popup HUD ES; botón Traducir → traduce (Slice D intacto).
- [ ] **Step 6:** `plans/DECISIONS.md` ADR-019 (D-1001..D-1010, Slice 1; Slice 2 globo perfilado). `plans/ROADMAP.md`: entrada "Fase 6 — Rediseño UI" Slice 1 ✅.
- [ ] **Step 7:** Commit — `git add packages/web/*-e2e.mjs plans/ && git commit -m "test(web): redesign E2E + Slice D preserved + ADR-019 (UI redesign slice 1)"`

---

## Self-Review

**Cobertura del spec (Slice 1):** basemap (T2/G1) · glow (T3/G2) · chrome HUD+cards+popup+toggles+tipografía (T1,T4/G3) · preservar Slice D (T5/G4) · responsive (T4 step 9, T5 step 3/G5). Slice 2 (globo) explícitamente fuera (NG-1). ✓

**Placeholders:** ninguno — tokens, `glowOf` (con test), basemap+fallback, y reglas CSS concretas por elemento. El reskin CSS se extiende a selectores hermanos de los mismos bloques listados (no es placeholder: cada elemento visual tiene su regla real).

**Type consistency:** `glowOf(spec: LayerSpec): LayerSpec` y `GLOW_LAYERS: LayerSpec[]` consistentes config↔MapView↔test. `INTERACTIVE_LAYER_IDS` excluye `-glow` (coherente con que glow no es clicable).

**Invariantes:** NO sube maplibre (v4), NO toca backend/store/motor (NG-2), NO toca popup.ts/i18n/click (NG-3, reskin = CSS), NO toca el `map.on('load')` (registro de capas + click Slice D intactos). Severidad semántica intacta; cian estructural.

**Riesgos:** R-1 basemap caído→fondo oscuro + log; hard raster-fallback DIFERIDO (T2, resuelve issue del plan-checker: setStyle re-creaba sources vacíos). R-2 selector E2E→ajustar test (T5 step2). R-3 glow FPS→medir/limitar (T3 step7). R-5 contraste→smoke 375/1200. R-6 Inter→fallback system.

**Gotchas:** glow añadido ANTES (debajo) de los dots; `-glow` fuera de interacción; `registerLayers` idempotente para el fallback; `@import` de Inter con fallback (sin dep nueva).
