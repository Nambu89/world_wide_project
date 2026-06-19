---
version: alpha
name: ui-redesign-slice2-globe
description: Slice 2 del rediseño command-center (Fase 6, ADR-020) — convierte el mapa plano en un GLOBO 3D (el "wow" tipo worldmonitor que el usuario validó por mockups). Sube MapLibre v4→v5 (globo nativo, sin three.js), activa `projection: globe`, añade atmósfera (sky) y rotación lenta con pausa-al-interactuar. Frontend-only, NO toca backend/store/motor. Riesgo concentrado = el upgrade v5: re-verificar que Slice D (click→popup, queryRenderedFeatures) y Slice 1 (glow, chrome) siguen verdes sobre el globo. Estrellas = best-effort/diferible. Ping pulsante (D-1009) sigue diferido.
status: draft
date: 2026-06-19
owner: system-architect
---

## Overview

En el brainstorming visual del rediseño (Fase 6) el usuario eligió **globo 3D** (sobre mapa plano) como el factor "impactante" de referencia worldmonitor. **Slice 1** (ADR-019, cerrado) entregó el reskin sin riesgo (chrome HUD + basemap dark + glow) manteniendo el mapa **plano** sobre MapLibre v4. **Slice 2** (este) entrega el globo.

MapLibre GL JS **v5** trae proyección **globo nativa** (sin three.js/globe.gl): `map.setProjection({ type: 'globe' })`. El upgrade v4→v5 es el **único riesgo real** y por eso se aisló en su propio slice. Breaking changes v4→v5 relevantes para esta app: prácticamente ninguno — `addSource`/`addLayer`/`queryRenderedFeatures`/`Popup`/`on('click')`/`setData` son estables; no usamos `queryTerrainElevation` (el cambio de semántica de v5). El trabajo es: subir la dep, activar el globo tras `style.load`, añadir atmósfera (`setSky`), y una rotación lenta con pausa-al-interactuar. **Frontend-only**: cero cambios en `server.ts`, `@www/store`, conectores, scheduler, `@www/core-*`.

La restricción dura: **re-verificar Slice D + Slice 1 sobre el globo** — el click→popup, el `queryRenderedFeatures` (la proyección de pantalla cambia con el globo), las capas glow y el chrome HUD deben seguir verdes (gates + E2E). El config-array central de capas NO cambia (las capas se pintan igual sobre globo o plano).

## Token-references

| Token | Definición |
|-------|-----------|
| `{dep.v5}` | `maplibre-gl` `^4.7.0` → `^5` (latest 5.24.x) en `packages/web/package.json`. Requiere `pnpm install` (gotcha esbuild allowBuilds, [[world-wide-dev-environment]]) (D-1100). |
| `{globe.enable}` | `map.setProjection({ type: 'globe' })` dentro de `map.on('style.load', …)` — DEBE ser tras cargar el style (llamarlo antes lanza error). Coexiste con el registro de capas en `map.on('load')` (D-1101). |
| `{globe.sky}` | Atmósfera vía `map.setSky({ 'atmosphere-blend': ['interpolate',['linear'],['zoom'], 0,1, 5,1, 7,0] })` tras `style.load` — halo atmosférico que se desvanece al hacer zoom. Si `setSky` no está / falla → se omite graciosa (el globo renderiza igual) (D-1102). |
| `{globe.rotate}` | Auto-rotación lenta vía `requestAnimationFrame` que incrementa `center.lng` ~3-5°/s; **pausa** en interacción del usuario (`mousedown`/`dragstart`/`zoomstart`/`wheel`/click) y cuando `document.hidden`; **reanuda** tras ~4s de inactividad. También pausa durante un `flyTo` de map-tie (D-1103). |
| `{globe.stars}` | Estrellas = best-effort. MapLibre v5 sky no expone starfield claro y el canvas del globo no es transparente fuera de la esfera (no sirve CSS detrás) → **DIFERIDO** salvo que `setSky` exponga `star-intensity` (a confirmar en research del plan); la atmósfera es el efecto principal (D-1104, GAP-1). |
| `{preserve.prior}` | Slice D (`buildPopupNode`/`popupRows`/click/`INTERACTIVE_LAYER_IDS`/i18n/translate) + Slice 1 (glow, chrome, basemap) NO se reescriben. El globo es un cambio de proyección; las capas y la interacción se mantienen. Gates + E2E verdes obligatorios (D-1105). |
| `{license.clean}` | Globo nativo de MapLibre (BSD) — sin three.js, sin código AGPL de worldmonitor (solo la idea visual). |

## Goals

- G1: `{dep.v5}` — subir MapLibre a v5, build + tsc verdes (caza cambios de tipo).
- G2: `{globe.enable}` — el mapa abre como globo 3D; las capas de datos (glow + dots) se pintan sobre la esfera.
- G3: `{globe.sky}` — atmósfera/halo alrededor del globo (graceful si la API no está).
- G4: `{globe.rotate}` — auto-rotación lenta con pausa-al-interactuar + reanudar-tras-inactividad + pausa durante flyTo.
- G5: `{preserve.prior}` — Slice D + Slice 1 intactos sobre el globo: suite + server + tsc + web build + **slice-d-e2e** + **redesign-e2e** verdes; click→popup funciona sobre globo.

## Non-Goals

- NG-1: **Sin tocar backend/store/datos/motor** (`server.ts`, `@www/store`, conectores, scheduler, `@www/core-*`, migraciones). Presentación pura.
- NG-2: **Sin reescribir Slice D / Slice 1** (`{preserve.prior}`): el config-array de capas, `buildPopupNode`, el click handler, el glow y el chrome NO cambian su lógica. Solo se añade proyección + sky + rotación en `MapView`.
- NG-3: **Sin three.js / globe.gl / deck.gl** — el globo es nativo de MapLibre v5 (NG license-clean + escalera ponytail: no dep pesada).
- NG-4: **Sin ping pulsante** en chokepoints (D-1009 sigue diferido) ni otras animaciones de marcador en este slice.
- NG-5: **Sin starfield** si MapLibre no lo da barato (D-1104/GAP-1) — la atmósfera basta.
- NG-6: **Sin cambiar el layout/app-shell** ni añadir un toggle globo/plano en el MVP (el globo es el modo por defecto; un toggle se añade después si se pide).

## Context / Constraints

- **Stack**: Vite + React + MapLibre GL (sube a v5) en `packages/web`. `MapView.tsx` crea el `Map` con `style: DARK_STYLE_URL` (CARTO, Slice 1), registra sources/capas en `map.on('load')`, tiene el click handler de Slice D y el spread con `GLOW_LAYERS` de Slice 1. El globo se activa en `map.on('style.load')` (distinto de `load`).
- **CARTO dark-matter es un style externo** — no lo editamos; por eso `setProjection`/`setSky` se llaman **programáticamente** tras `style.load`, no en el JSON del style.
- **`queryRenderedFeatures` sobre globo**: v5 lo soporta; la proyección de `e.point`→features la maneja MapLibre. El click handler de Slice D no cambia, pero **debe re-verificarse en vivo** (R-1).
- **Rotación vs map-tie**: cuando una selección de panel hace `flyTo` (Slice D/C), la rotación debe pausar para no pelear con la cámara (D-1103).
- **Upgrade dep en Windows**: `pnpm install` con el hook `allowBuilds` (esbuild) — [[world-wide-dev-environment]]. El plan corre install + build para cazar incompatibilidades.
- **`window.__wwMap`** (hook DEV de Slice D para E2E) se mantiene — el E2E proyecta coords con `m.project()`, que en globo devuelve el píxel correcto.
- **License-clean** (`{license.clean}`): globo nativo MapLibre, sin AGPL.

## Decisions

Numeración `D-11xx` (Slice 1 = D-10xx; sin colisión).

- **D-1100**: subir `maplibre-gl` a `^5` (`{dep.v5}`) — porque el globo nativo solo existe en v5; v5 es estable (5.24.x) y sus breaking changes no afectan nuestra superficie (no usamos terrain/queryTerrainElevation). El upgrade se aísla en este slice precisamente por ser el único riesgo.
- **D-1101**: activar globo con `map.setProjection({ type: 'globe' })` en `map.on('style.load')` (`{globe.enable}`) — porque llamarlo antes de cargar el style lanza error; `style.load` es el punto correcto y coexiste con el registro de capas en `load`. Programático (no en el JSON) porque el style CARTO es externo.
- **D-1102**: atmósfera con `map.setSky({ 'atmosphere-blend': … })` (`{globe.sky}`), graceful si la API no está — porque el halo atmosférico es la mitad del "wow" del globo; pero no debe romper si la versión/API difiere (try/catch → globo sin atmósfera, aún válido).
- **D-1103**: auto-rotación rAF con pausa-al-interactuar + reanudar-tras-inactividad + pausa-en-flyTo (`{globe.rotate}`) — porque el usuario eligió "auto-spin + pausa al tocar"; girar mientras explora o durante un map-tie pelearía con él. La rotación se implementa en `MapView` con un ref + listeners, limpiada en el unmount.
- **D-1104**: estrellas DIFERIDAS salvo `star-intensity` barato (`{globe.stars}`/NG-5) — porque el canvas del globo no es transparente fuera de la esfera (CSS-detrás no sirve) y MapLibre no expone starfield claro; la atmósfera es el efecto principal. Se reabre si el research del plan encuentra una vía barata.
- **D-1105**: `{preserve.prior}` invariante — Slice D + Slice 1 verdes sobre el globo antes de cerrar; si el globo rompe el click/popup o el E2E, se arregla (no se degrada la feature). El config-array de capas NO cambia.

## Interfaces / Data Contracts

Sin contratos de datos nuevos (NG-1). Cambios en `MapView.tsx`:

```ts
// D-1101/D-1102: activar globo + atmósfera tras cargar el style (NO antes).
map.on('style.load', () => {
  try { map.setProjection({ type: 'globe' }); } catch (e) { console.warn('[globe] projection unavailable', e); }
  try {
    (map as unknown as { setSky?: (s: unknown) => void }).setSky?.({
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    });
  } catch { /* sky optional — globe still renders */ }
});

// D-1103: auto-rotation with pause-on-interact + resume-after-idle.
// (ref-based; lives in the init useEffect, cleaned up on unmount.)
const spinRef = useRef<{ raf: number; paused: boolean; idleAt: number }>(...);
function spin() {
  if (!spinRef.current.paused) {
    const c = map.getCenter();
    map.setCenter([c.lng + ROTATE_DEG_PER_FRAME, c.lat]);  // ~3-5°/s at 60fps
  } else if (performance-style idle elapsed) { spinRef.current.paused = false; } // resume after ~4s
  spinRef.current.raf = requestAnimationFrame(spin);
}
// pause on: mousedown / dragstart / zoomstart / wheel / click / document hidden / during flyTo.
// NOTE: time source — rAF callback receives a timestamp; use it (no Date.now()).
```

`ROTATE_DEG_PER_FRAME` ≈ 0.05–0.08 (≈3-5°/s). La rotación NO usa `Date.now()`; usa el timestamp del callback de `requestAnimationFrame` para medir el idle (determinista + sin depender de relojes). El map-tie de Slice D/C (efecto `activeCountry`/`activeChokepoint` → `flyTo`) marca `paused=true` al empezar y programa reanudar tras el `moveend`.

## Do's and Don'ts

- **DO**: activa el globo en `map.on('style.load')`, NUNCA antes de cargar el style — llamarlo antes lanza error (D-1101).
- **DO**: envuelve `setProjection`/`setSky` en try/catch → degradan graciosos si la API difiere (D-1102).
- **DO**: pausa la rotación en interacción Y durante el `flyTo` de map-tie; reanuda tras inactividad; limpia el rAF en el unmount (D-1103).
- **DO**: corre `slice-d-e2e` + `redesign-e2e` sobre el globo y verifica el click→popup EN VIVO (la proyección cambió) (D-1105).
- **DON'T**: NO añadas three.js/globe.gl/deck.gl — globo nativo v5 (NG-3).
- **DON'T**: NO toques el config-array de capas, `buildPopupNode`, el click handler, el glow ni el chrome (NG-2/`{preserve.prior}`).
- **DON'T**: NO toques backend/store/motor (NG-1).
- **DON'T**: NO uses `Date.now()`/`Math.random()` en el loop de rotación — usa el timestamp del rAF (determinismo + regla del entorno).
- **DON'T**: NO bloquees el cierre por las estrellas — son diferibles (NG-5/D-1104).

## Risks

- **R-1 — el upgrade v5 rompe el click/popup o `queryRenderedFeatures` sobre globo**. *Mitigación*: tsc caza cambios de tipo; `slice-d-e2e` (click→popup) + smoke EN VIVO sobre el globo lo confirman; si `e.point` se proyecta distinto, ajustar el handler (no degradar). El click handler ya pasa `{ layers }` a `queryRenderedFeatures`, soportado en globo.
- **R-2 — `setSky`/`setProjection` con nombre/firma distinta en 5.24**. *Mitigación*: try/catch graceful (D-1102) + el research del plan confirma la firma exacta contra la versión instalada (D-1100).
- **R-3 — rotación pelea con el usuario o con el map-tie** (cámara saltando). *Mitigación*: pausa en interacción + durante flyTo + reanudar-tras-idle (D-1103); verificar en smoke que seleccionar un país no "lucha" con el spin.
- **R-4 — FPS del globo + glow + rotación** en equipos modestos. *Mitigación*: smoke FPS; si lag, bajar la tasa de rotación o el nº de glow-layers (R-3 de Slice 1).
- **R-5 — el upgrade v5 cambia algún default visual** (fog, luz) que afea el basemap. *Mitigación*: smoke visual 1200/375; ajustar `setSky`/`light` si hace falta.
- **R-6 — `pnpm install` falla en Windows** (native/esbuild). *Mitigación*: el hook `allowBuilds` ya resuelve esbuild ([[world-wide-dev-environment]]); si v5 añade dep nativa, evaluar.

## Iteration Guide

Secuencia (cada pieza verificable):

1. **Upgrade dep**: `maplibre-gl` → `^5` en `package.json` + `pnpm install`. tsc paquetes+raíz + web build verdes (caza breaking changes de tipo). Smoke: la app sigue cargando como **mapa plano** (aún sin globo) sin errores.
2. **Globo**: `map.on('style.load')` → `setProjection({type:'globe'})`. Smoke: el mapa abre como globo; las capas glow+dots se pintan sobre la esfera. **Verificar click→popup EN VIVO sobre el globo** (R-1).
3. **Atmósfera**: `setSky({atmosphere-blend…})` (try/catch). Smoke: halo atmosférico alrededor del globo.
4. **Rotación**: rAF spin + pausa-al-interactuar + reanudar-idle + pausa-en-flyTo + cleanup. Smoke: gira lento; al arrastrar/seleccionar país se para; reanuda tras soltar.
5. **Preservar + verify**: `slice-d-e2e` + `redesign-e2e` (PASS sobre globo) + suite + server + tsc + web build. ADR-020 + ROADMAP Slice 2.

Reglas: cierra cada pieza con smoke EN VIVO ([[feedback-live-qa-vs-mocks]]) — el upgrade v5 + globo es exactamente el tipo de cambio que los tests verdes no garantizan.

## Known Gaps / Open Questions

- **GAP-1 / D-1104**: ¿MapLibre 5.24 expone `star-intensity` (u otra vía barata de estrellas) en `setSky`? El research del plan lo confirma contra la versión instalada; si no, estrellas DIFERIDAS (la atmósfera basta).
- **GAP-2**: la firma exacta de `setProjection`/`setSky` en 5.24 (tipos TS) — el plan la confirma tras `pnpm install` (tsc la valida).
- **GAP-3**: comportamiento exacto de `queryRenderedFeatures` con `e.point` cerca del limbo del globo (bordes) — el click en el centro funciona; clicks en el borde extremo pueden fallar (aceptable; la mayoría de hotspots están en la cara visible). Verificar en smoke.
- **OQ-1 (resuelta, usuario 2026-06-19)**: rotación = **auto-spin lento + pausa al interactuar + reanudar tras inactividad**.

## PLANNING COMPLETE
