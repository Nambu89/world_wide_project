---
version: alpha
name: ui-redesign-command-center
description: Rediseño visual de la plataforma a una estética "command-center" futurista (referencias osiris/worldmonitor) que el usuario validó por mockups. NO toca backend/store/datos/motor — es PRESENTACIÓN pura (packages/web). Decisiones de look CERRADAS en brainstorming visual: globo 3D + chrome HUD cian + marcadores con glow + tipografía monospace en datos. Troceado en 2 slices: **Slice 1 (este doc, riesgo bajo) = chrome HUD + basemap dark vector + glow markers + fuentes, SIN tocar MapLibre**; **Slice 2 (outline) = globo (upgrade MapLibre v4→v5 + atmósfera/estrellas/rotación)**. Restricción dura: mantener verdes los gates de Slice D (E2E popup/Traducir, tsc, suite) sobre el nuevo look.
status: draft
date: 2026-06-19
owner: system-architect
---

## Overview

El usuario considera la UI actual "fea". Diagnóstico (sobre screenshots reales): (1) el **basemap raster de OSM** (mapa de calles desaturado) es el culpable nº1 — ruido de etiquetas/carreteras, look genérico; (2) **sopa de puntos** sin jerarquía; (3) tipografía system-font + cards densas; (4) pills de toggle gigantes. La referencia que el usuario quiere: **osiris** (mapa MapLibre con tríos glow/dots/label, marcadores brillantes sobre mapa oscuro) + **worldmonitor** (globo 3D) — "futurista, impactante, claro". worldmonitor es AGPL → **solo inspiración visual, NUNCA copiar fuente**; osiris es MIT → patrones copiables.

En un brainstorming visual (companion) el usuario validó por mockups: **globo 3D** (vs plano), **chrome HUD command-center** (vs glass), **acento cian hielo** (vs verde fósforo / neón dual), y aprobó el hero combinado. Alcance elegido: **2 slices**.

Esta rebanada (**Slice 1**) entrega el 80% del salto visual SIN el riesgo del globo: reskin completo a HUD command-center + basemap vector oscuro + marcadores con glow + tipografía. **Frontend-only**: cero cambios en `server.ts`, `@www/store`, conectores, scheduler, `@www/core-*`. No cambia ningún contrato de datos; reusa las capas y el wiring existentes. El globo (Slice 2) queda perfilado pero fuera de scope aquí (NG-1).

## Token-references

| Token | Definición |
|-------|-----------|
| `{basemap.dark}` | Estilo de mapa = CARTO **dark-matter** GL vector (keyless), `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`, con atribución CARTO + OSM. Reemplaza el `style` inline raster-OSM en `MapView.tsx` (D-1001). |
| `{basemap.attribution}` | Atribución requerida visible: "© OpenStreetMap · © CARTO" (ToS CARTO basemaps: uso no-comercial/limitado con atribución; uso personal OK — verificar en research, GAP-1). |
| `{glow.layer}` | Por cada circle-layer de datos, una capa "glow" gemela DEBAJO: mismo source/filter, `circle-blur` alto + radio mayor + opacidad baja, color = el del marcador. Patrón osiris glow/dots(/label). Vive en el config-array (`layers.config.ts`), iterada como el resto (D-1002). |
| `{glow.order}` | Orden de pintado: glow-layers primero (debajo), luego dots nítidos, luego labels opcionales. El `MapView` añade las glow antes que las crisp en el bucle (D-1002). |
| `{theme.tokens}` | CSS custom-props en `:root` (`styles.css`): `--bg #060a12`, `--panel #0a111c`, `--accent #22d3ee` (cian), `--accent-dim #1c3550`, severidad `--danger #ef4444`/`--warning #f59e0b`/`--success #22c55e` (semánticos, intactos), `--mono` stack. (D-1003) |
| `{chrome.hud}` | Skin "command-center": paneles sólidos `--panel` con **corchetes de esquina** (`::before/::after` con borde cian en 2 esquinas), borde `--accent-dim`, glow interior sutil. Pestañas mono-uppercase con subrayado cian en activa. Header `// SECCIÓN` mono + indicador LIVE. (D-1004) |
| `{chrome.intelcard}` | Tarjeta de insight HUD: barra de acento izq. con glow por severidad, badge de severidad (ALTA/MEDIA/BAJA) en mono, flecha cian `→` en consecuencias, chips de país/chokepoint con borde cian. (D-1005) |
| `{chrome.popup}` | Popup de mapa re-skineado: fondo `--panel`, 1 corchete de esquina cian, header `▸ NOMBRE` mono cian, filas `LABEL valor` mono. Sustituye el CSS `.maplibregl-popup-content`/`.map-popup` actual; **NO cambia `buildPopupNode`/`popupRows`** (mismo DOM, solo CSS) — preserva Slice D (D-1006). |
| `{type.body}` | Tipografía cuerpo = **Inter** (self-host vía `@fontsource/inter` o woff2 local; sin CDN runtime). Fallback al stack system actual. (D-1007) |
| `{type.mono}` | Números, labels, badges, headers HUD = stack monospace (`ui-monospace, 'Cascadia Code', Consolas, monospace`) — sin dep (D-1007). |
| `{toggles.restyle}` | Las pills de toggle de capa pasan a chips HUD compactos (mono, borde cian cuando activo) — mismo `toggleLayer`/estado, solo CSS/markup mínimo (D-1008). |
| `{ping.disrupted}` | Realce pulsante en chokepoints `status==='disrupted'`: capa `circle` extra con animación de radio/opacidad vía `requestAnimationFrame` que actualiza una paint-property (o symbol pulsante). Opcional/lean; si añade complejidad, se difiere a Slice 2 (D-1009, GAP-2). |
| `{preserve.sliced}` | Slice D (popup ES + Traducir + i18n + click handler) NO se reescribe — el reskin es CSS + config de capas; el JS de interacción queda intacto. Los gates de Slice D deben seguir verdes (D-1010). |
| `{license.clean}` | Sin código AGPL de worldmonitor. La estética (globo, glow, HUD) son ideas no-copyrightables; el CSS/markup es propio. osiris (MIT) = patrones copiables. |

## Goals

- G1: Reemplazar `{basemap.dark}` — fuera el raster-OSM; mapa vector oscuro limpio con atribución `{basemap.attribution}`.
- G2: `{glow.layer}` para todos los circle-layers (events/signals/cii/convergence/sanctions/chokepoints) vía el config-array central, respetando `{glow.order}` y sin `addLayer` imperativo.
- G3: Reskin completo a `{chrome.hud}` + `{chrome.intelcard}` + `{chrome.popup}` + `{toggles.restyle}` en `styles.css` con `{theme.tokens}`, tipografía `{type.body}`/`{type.mono}`.
- G4: **Preservar Slice D** (`{preserve.sliced}`): popup/Traducir/i18n/click intactos; suite + server tests + tsc + web build + **browser E2E** verdes sobre el nuevo look.
- G5: Mantener responsive (375/1200) y accesibilidad (contraste, aria-labels ES ya existentes).

## Non-Goals

- NG-1: **Sin globo en este slice.** El upgrade MapLibre v4→v5 + `projection: globe` + atmósfera/estrellas/rotación es **Slice 2** (riesgo concentrado: re-verificar click/popup/queryRenderedFeatures sobre globo). Aquí el mapa sigue **plano** con el nuevo skin. Si el diseño parece exigir tocar la versión de MapLibre → PARA, es Slice 2.
- NG-2: **Sin tocar backend/store/datos/motor.** Cero cambios en `server.ts`, `@www/store`, conectores, scheduler, `@www/core-{ai,cii,signals}`, migraciones. Es presentación pura.
- NG-3: **Sin cambiar la lógica de interacción de Slice D** (`buildPopupNode`, `popupRows`, `localizeCountry`, `translate`, el click handler, `INTERACTIVE_LAYER_IDS`). Solo CSS + estilo de capas. (`{preserve.sliced}`)
- NG-4: **Sin framework de animación nuevo** (no Framer Motion/GSAP). Transiciones = CSS; cualquier pulso de mapa = `requestAnimationFrame` mínimo o se difiere (NG vía D-1009).
- NG-5: **Sin reestructurar el layout** (sigue map + panel lateral/drawer). Es reskin, no rearquitectura de la app shell.
- NG-6: **Sin dependencias pesadas.** Inter self-host (1 paquete `@fontsource` o 1 woff2); nada de icon-libraries grandes ni UI kits. (escalera ponytail)

## Context / Constraints

- **Stack**: Vite + React + **MapLibre GL ^4.7.0** en `packages/web`. Capas en config-array central `layers.config.ts` (ADR-003/D-008), iteradas por `MapView.tsx` (NUNCA `addLayer` disperso). `styles.css` ~1320 líneas con design-tokens en `:root` (ya existe `--color-*`). Popups de Slice D: `map/popup.ts` (`buildPopupNode`/`popupRows`) + CSS `.map-popup*`.
- **El basemap actual** es un `style` inline con source raster OSM (`MapView.tsx`, `map.on('load')` registra nuestras sources sobre él). Cambiar a `{basemap.dark}` = pasar `style: '<url CARTO style.json>'` en el `new maplibregl.Map({...})`; nuestras sources/capas se siguen añadiendo en `map.on('load')` encima del estilo CARTO. Verificar que `load` dispara igual con style remoto (sí; añadir manejo de error de red → fallback al raster actual, graceful).
- **MapLibre v5 trae globo** (`projection: globe`, sin three.js) pero es Slice 2; este slice NO sube de versión (NG-1). circle-blur, queryRenderedFeatures, Popup — APIs estables en v4, no cambian aquí.
- **Slice D verificado** (ADR-018): el reskin debe preservarlo. El popup usa DOM imperativo con clases `.map-popup__*`; reskinear = reescribir esas reglas CSS, no el JS. El E2E `slice-d-e2e.mjs` valida pestañas ES + popup + Traducir → debe seguir pasando (las aserciones son por clase/texto, robustas a CSS; verificar selectores).
- **Severidad = semántica**: rojo/ámbar/verde codifican datos (no decoración). El acento cian es estructural (chrome). No colapsar ambos (el verde fósforo se descartó justo por chocar con "riesgo bajo").
- **License-clean** (`{license.clean}`): metodología/estética re-derivada; osiris MIT copiable, worldmonitor AGPL solo idea.
- **Zero-key**: `{basemap.dark}` CARTO es keyless (consistente con la regla zero-key-first); atribución obligatoria (ToS datos, [[feedback_data_tos]]).

## Decisions

Numeración `D-10xx` (slice-D = D-9xx; sin colisión). `D-0NN` bloqueadas heredadas.

- **D-001 (bloqueada, ADR-002)**: nada de fuente AGPL de worldmonitor — solo la idea visual (globo/HUD) es re-implementable.
- **D-008 (bloqueada, ADR-003)**: capas SOLO en el config-array central; `MapView` itera. Las `{glow.layer}` entran ahí, jamás `addLayer` suelto.
- **D-1001**: basemap = `{basemap.dark}` (CARTO dark-matter vector, keyless) reemplazando el raster-OSM — porque es el mayor culpable del look "feo" y el cambio de mayor ROI; vector oscuro = limpio, sin calles, base estándar de mapas de inteligencia. Fallback graceful al raster si la red del style falla.
- **D-1002**: glow = una capa gemela `circle` con `circle-blur`+radio mayor+opacidad baja DEBAJO de cada dot (`{glow.order}`), declarada en el config-array — porque replica el patrón osiris (glow/dots) con MapLibre nativo, sin canvas/dep; el blur da el halo barato. Color heredado del marcador (severidad/tipo).
- **D-1003**: `{theme.tokens}` en `:root` con `--accent #22d3ee` cian + severidad intacta — porque centraliza el reskin; cambiar el acento = 1 variable. El cian se eligió por legibilidad contra la severidad roja/ámbar.
- **D-1004**: chrome `{chrome.hud}` (paneles sólidos + corchetes de esquina + pestañas mono-uppercase + header `//`) — porque el usuario eligió HUD command-center sobre glass; máxima legibilidad de datos, "sala de mando".
- **D-1005**: intel-cards `{chrome.intelcard}` (acento-glow por severidad + badge mono + flecha cian + chips) — espejo visual del hero aprobado; el contenido (title/consequences/affected/countries/chokepoints) ya existe en `Insight`, solo cambia la presentación.
- **D-1006**: `{chrome.popup}` = SOLO CSS sobre el DOM existente de `buildPopupNode` — porque reescribir el JS del popup arriesgaría Slice D; las clases `.map-popup__heading/__row/__label/__title/__translate` se re-estilan, el botón Traducir y su lógica quedan idénticos (`{preserve.sliced}`).
- **D-1007**: tipografía `{type.body}` Inter self-host + `{type.mono}` stack del sistema — porque Inter es el polish estándar sin CDN runtime (1 dep `@fontsource` o 1 woff2); mono del sistema evita otra dep. (escalera: dep mínima solo donde aporta).
- **D-1008**: toggles `{toggles.restyle}` a chips HUD — mismo estado/handler, solo CSS+markup mínimo; las pills gigantes actuales son parte de lo "feo".
- **D-1009**: `{ping.disrupted}` pulso en chokepoints disrupted = opcional/lean vía `requestAnimationFrame` sobre una paint-property; si complica, se DIFIERE a Slice 2 (GAP-2) — porque el "wow" del ping es menor que el del reskin base y la animación de mapa es la parte más frágil.
- **D-1010**: `{preserve.sliced}` es invariante — los gates de Slice D (suite, server, tsc, web build, browser E2E) deben quedar verdes sobre el nuevo look antes de cerrar; si el reskin rompe un selector del E2E, se ajusta el E2E (no se degrada la feature).

## Interfaces / Data Contracts

Este slice no añade contratos de datos (NG-2). Las "interfaces" son visuales/config:

### Mapa — basemap (`MapView.tsx`)

```ts
// D-1001: style raster-OSM inline → CARTO dark-matter vector (keyless).
const map = new maplibregl.Map({
  container: containerRef.current,
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', // {basemap.dark}
  center: [0, 20], zoom: 2, minZoom: 1, maxZoom: 18,
  attributionControl: { compact: true },
});
// Nuestras sources/capas se siguen registrando en map.on('load') ENCIMA del estilo CARTO.
// Si el style remoto falla (red), error handler → fallback al objeto raster-OSM actual (graceful).
```

### Mapa — glow layers (`layers.config.ts`)

```ts
// D-1002 / {glow.layer}: helper que, dado un LayerSpec circle, deriva su gemela glow.
function glowOf(spec: LayerSpec): LayerSpec {
  return {
    ...spec,
    id: spec.id + '-glow',
    paint: {
      'circle-color': /* mismo color que spec */,
      'circle-blur': 1,                 // halo
      'circle-opacity': 0.5,
      'circle-radius': /* ~2.2× el radio del dot */,
    },
  };
}
// MapView itera [...glowLayers, ...crispLayers] para respetar {glow.order} (glow debajo).
// Los heatmap NO llevan glow gemela (ya son densidad).
```

### Chrome — `styles.css` (reskin con `{theme.tokens}`)

Reescritura de las secciones de panel/tabs/cards/popup/toggles a `{chrome.hud}`. `:root` añade `--accent`, `--accent-dim`, `--mono`, `--panel`, mantiene `--danger/--warning/--success`. Sin tocar el JSX salvo `{toggles.restyle}` (markup mínimo) y clases nuevas donde haga falta (p.ej. badge de severidad ya existe `.intel-card__severity`).

### Tipografía

`{type.body}` Inter vía `@fontsource/inter` (import en `main.tsx`) o `@font-face` woff2 local en `styles.css`; `--font-family` pasa a `'Inter', <stack actual>`. `{type.mono}` = `--mono` aplicado a `.*__num`, badges, headers HUD, pestañas.

## Do's and Don'ts

- **DO**: cambia el basemap por el `style` URL de CARTO y deja que `map.on('load')` registre nuestras capas encima — porque es el cambio de mayor impacto y mínima superficie (D-1001).
- **DO**: declara las glow-layers en el config-array y que `MapView` las itere DEBAJO de los dots — porque el `addLayer` disperso es justo lo que D-008 prohíbe; el orden da el halo correcto (D-1002).
- **DO**: re-skinea el popup SOLO por CSS sobre las clases existentes — porque el JS de Slice D está verificado; tocarlo reabre riesgo (D-1006/`{preserve.sliced}`).
- **DO**: corre el `slice-d-e2e.mjs` tras el reskin y ajusta selectores del E2E si una clase cambió — el feature no se degrada, el test se actualiza (D-1010).
- **DON'T**: NO subas MapLibre a v5 ni toques la proyección — eso es Slice 2 (NG-1). Si te ves editando `package.json` maplibre, PARA.
- **DON'T**: NO toques `server.ts`/store/conectores/scheduler/core-* (NG-2).
- **DON'T**: NO reescribas `buildPopupNode`/`popupRows`/`localizeCountry`/el click handler (NG-3).
- **DON'T**: NO uses el cian para datos de severidad ni el rojo/ámbar para chrome — acento estructural vs color semántico separados (D-1003).
- **DON'T**: NO añadas Framer Motion/GSAP/icon-kits — CSS + rAF mínimo (NG-4/NG-6).

## Risks

- **R-1 — basemap remoto falla / lento** (CARTO down o red) → mapa en blanco. *Mitigación*: error handler en el `Map` → fallback al `style` raster-OSM actual (graceful); el resto de la UI no depende del basemap (D-1001).
- **R-2 — el reskin rompe un selector del E2E de Slice D** (clase renombrada) → E2E rojo. *Mitigación*: el reskin reusa las clases existentes (`.map-popup__*`, `.intel-card__*`, `.panel-tab`); si alguna cambia, se actualiza el E2E (D-1010). Verificar lista de selectores que el E2E toca ANTES de renombrar.
- **R-3 — glow-layers duplican features y bajan FPS** con muchos puntos → lag. *Mitigación*: glow solo en circle-layers (no heatmap), opacidad/blur baratos; medir en smoke; si lag, limitar glow a las capas clave (cii/chokepoints) (D-1002).
- **R-4 — ToS de CARTO basemap** para uso (aunque personal). *Mitigación*: GAP-1, verificar en research; atribución visible obligatoria; alternativa keyless = estilo MapLibre demotiles o un style.json propio si CARTO no encaja.
- **R-5 — contraste/legibilidad** del texto secundario sobre el nuevo fondo muy oscuro (accesibilidad). *Mitigación*: tokens con contraste AA verificado; el smoke revisa 375/1200.
- **R-6 — Inter no carga** (woff2 mal referenciado) → cae al fallback system (no rompe, solo menos polish). *Mitigación*: fallback en `--font-family`; verificar en build.

## Iteration Guide

Dependencias: `{theme.tokens}` (`:root`, primero, desbloquea todo el CSS) → `{basemap.dark}` (MapView, independiente) → `{glow.layer}` (layers.config + MapView iter) → `{chrome.hud}`/`{chrome.intelcard}`/`{chrome.popup}`/`{toggles.restyle}` (styles.css + markup mínimo) → fuentes → verify.

Secuencia (UNA pieza verificable antes de la siguiente):

1. **Tokens + fuentes**: `:root` con `{theme.tokens}`, `--font-family` Inter, `--mono`. Build OK.
2. **Basemap**: `{basemap.dark}` en `MapView` + fallback graceful. Smoke: el mapa carga oscuro vector; capas de datos encima.
3. **Glow**: `glowOf` + iterar glow debajo en `MapView`. Smoke: halos visibles bajo los dots; FPS ok.
4. **Chrome**: reskin `styles.css` panel/tabs/intel-card/popup/toggles a HUD cian. Smoke visual 1200/375.
5. **Preservar Slice D**: correr `slice-d-e2e.mjs` + ajustar selectores si hace falta. Gates: tsc paquetes+raíz, suite, server test, web build.
6. **Cierre**: browser E2E del reskin (pestañas/cards/popup visibles + sin errores consola) + smoke vivo (click→popup HUD, Traducir).

Reglas de edición: refiere por token; cierra cada pieza con smoke EN VIVO ([[feedback-live-qa-vs-mocks]]); no degradar Slice D.

### Slice 2 (outline, NO en este plan)

Globo: subir MapLibre `^4.7.0`→`^5`, `map.setProjection({type:'globe'})` (o en el style), atmósfera (v5 nativa) + capa de estrellas (sky/canvas) + rotación lenta opcional con pausa al interactuar. **Re-verificar**: click/`queryRenderedFeatures`/popup/heatmap sobre globo; `{ping.disrupted}` si se difirió. Gates Slice D de nuevo. Doc/plan propios.

## Known Gaps / Open Questions

- **GAP-1**: ToS exacto de CARTO dark-matter basemap para uso personal no verificado nominalmente — el research del plan lo confirma; si no encaja keyless, alternativa = estilo demotiles de MapLibre o style.json propio mínimo (R-4).
- **GAP-2 / D-1009**: `{ping.disrupted}` (pulso animado) puede diferirse a Slice 2 si añade complejidad/fragilidad — decisión en implementación según coste real.
- **GAP-3**: lista exacta de selectores CSS que `slice-d-e2e.mjs` depende (clases del popup/pestañas) a confirmar antes de renombrar nada (R-2). El reskin debe reusar clases, no inventar.
- **GAP-4**: método final de carga de Inter (`@fontsource/inter` dep vs woff2 local) — el implementador elige el más lazy que funcione offline (D-1007).
- **OQ-1 (resuelta, usuario 2026-06-19)**: dirección visual = globo 3D + HUD command-center + cian + glow + mono (validada por mockups); alcance = 2 slices (este = Slice 1, sin globo).

## PLANNING COMPLETE
