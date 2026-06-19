# UI Redesign — Slice 2 (globo 3D) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox (`- [ ]`).

**Goal:** Convertir el mapa plano en un GLOBO 3D (MapLibre v5 nativo) con atmósfera y rotación lenta pausada-al-interactuar, sin tocar backend/store/motor, preservando Slice D + Slice 1.

**Architecture:** Frontend-only, casi todo en `MapView.tsx`. Subir `maplibre-gl` v4→v5; activar `projection: globe` + atmósfera (`setSky`) en `map.on('style.load')`; auto-rotación rAF con pausa-al-interactuar y auto-pausa durante `flyTo` (`map.isEasing()`). El config-array de capas, el glow, el chrome y la interacción de Slice D NO cambian.

**Tech Stack:** Vite + React + **MapLibre GL ^5** (sube desde ^4.7.0), node:test+tsx, Playwright.

**Design doc:** `docs/design/2026-06-19-ui-redesign-slice2-globe.md` (ADR-020, D-1100..D-1105).

## Global Constraints

- **NO tocar** `server.ts`, `@www/store`, `packages/connectors`, `packages/scheduler`, `@www/core-*`, migraciones (NG-1).
- **NO reescribir** Slice D (`map/popup.ts`, click handler, `INTERACTIVE_LAYER_IDS`, i18n, translate) ni Slice 1 (glow en `layers.config.ts`, chrome en `styles.css`) (NG-2 / D-1105). El globo SOLO añade proyección + sky + rotación en `MapView`.
- **NO three.js/globe.gl/deck.gl** — globo nativo v5 (NG-3).
- **NO `Date.now()`/`Math.random()`/`new Date()`** (entorno los bloquea) — la rotación usa rAF + `setTimeout` (D-1103).
- **Activar globo SOLO tras `style.load`** (antes lanza error) (D-1101).
- **Gates verdes obligatorios** al cierre: tsc paquetes+raíz, suite (351/0), server (72/0), web build, **slice-d-e2e** (Slice D sobre globo), **redesign-e2e**. Si el globo rompe algo del E2E → arreglar, no degradar (D-1105).

---

## Task 1: Upgrade MapLibre v4 → v5

**Files:** Modify `packages/web/package.json` (dep `maplibre-gl`)

- [ ] **Step 1:** En `packages/web/package.json`, cambiar `"maplibre-gl": "^4.7.0"` → `"maplibre-gl": "^5.24.0"`.
- [ ] **Step 2:** `pnpm install` (raíz). Expected: instala maplibre-gl 5.24.x (hook allowBuilds resuelve esbuild si aplica, [[world-wide-dev-environment]]).
- [ ] **Step 3:** Typecheck — `pnpm --filter @www/web exec tsc --noEmit`. Expected: EXIT 0. **Si v5 cambió algún tipo** que usamos (p.ej. `StyleSpecification`, `LayerSpecification`, eventos), arreglar el casteo mínimo en `MapView`/`layers.config` (los castes `as unknown as ...` ya existen y absorben la mayoría).
- [ ] **Step 4:** Build — `pnpm --filter @www/web build`. Expected: OK.
- [ ] **Step 5:** Smoke (servers arriba): la app carga como **mapa plano** (aún sin globo) sin errores de consola — confirma que el upgrade no rompió nada antes de añadir el globo.
- [ ] **Step 6:** Commit — `git add packages/web/package.json pnpm-lock.yaml && git commit -m "build(web): upgrade maplibre-gl v4 -> v5 (globe-capable)"`

---

## Task 2: Activar el globo

**Files:** Modify `packages/web/src/map/MapView.tsx` (init effect, tras crear el map)

**Interfaces:** Consumes: `map` (MapLibreMap v5). Produces: globo activo en `style.load`.

- [ ] **Step 1:** Tras el `map.on('error', …)` (Slice 1) y antes de `mapRef.current = map`, añadir:

```ts
// D-1101: enable the 3D globe once the style has loaded (calling it earlier throws).
map.on('style.load', () => {
  try {
    map.setProjection({ type: 'globe' });
  } catch (err) {
    console.warn('[globe] projection unavailable:', err);
  }
});
```

- [ ] **Step 2:** Typecheck + build — `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`. Expected: EXIT 0 + OK. (Si `setProjection` no está en los tipos v5, castear `(map as unknown as { setProjection: (p: { type: string }) => void }).setProjection({ type: 'globe' })` — confirmar el nombre real contra los tipos instalados.)
- [ ] **Step 3:** Smoke EN VIVO (R-1, crítico): la app abre como **globo 3D**; las capas glow+dots se pintan sobre la esfera; **click en un punto → popup HUD** funciona sobre el globo (la proyección cambió). Verificar con `slice-d-e2e` en Task 5, pero hacer un click manual aquí.
- [ ] **Step 4:** Commit — `git add packages/web/src/map/MapView.tsx && git commit -m "feat(web): enable MapLibre v5 globe projection (Slice 2)"`

---

## Task 3: Atmósfera (sky)

**Files:** Modify `packages/web/src/map/MapView.tsx` (mismo `style.load` handler)

- [ ] **Step 1:** Dentro del `map.on('style.load', …)`, tras `setProjection`, añadir (graceful, D-1102):

```ts
  // D-1102: atmospheric halo around the globe. Optional — globe renders fine without it.
  try {
    (map as unknown as { setSky?: (s: unknown) => void }).setSky?.({
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    });
  } catch (err) {
    console.warn('[globe] sky unavailable:', err);
  }
```

- [ ] **Step 2:** Confirmar contra los tipos v5 instalados si `setSky` existe y su firma (research: `map.setSky(sky: SkySpecification)`); si el nombre/forma difiere, ajustar. El try/catch evita romper si no está.
- [ ] **Step 3:** tsc + build. Expected: EXIT 0 + OK.
- [ ] **Step 4:** Smoke EN VIVO: halo atmosférico visible alrededor del globo (se desvanece al hacer zoom).
- [ ] **Step 5:** Commit — `git add packages/web/src/map/MapView.tsx && git commit -m "feat(web): globe atmosphere (setSky atmosphere-blend)"`

---

## Task 4: Auto-rotación con pausa-al-interactuar

**Files:** Modify `packages/web/src/map/MapView.tsx` (init effect + cleanup)

**Interfaces:** Produces: rotación rAF; limpia rAF + timers en el unmount.

- [ ] **Step 1:** En el init `useEffect`, tras registrar el map y el globo, añadir el bucle de rotación. Declarar arriba de `MapView` la constante:

```ts
const ROTATE_DEG_PER_FRAME = 0.06;   // ~3.5°/s a 60fps (D-1103)
const SPIN_RESUME_MS = 4000;         // reanuda 4s tras la última interacción
```

Dentro del effect (antes del `return` de cleanup):

```ts
// D-1103: slow auto-rotation; pauses on user gesture + during map-tie flyTo (isEasing),
// resumes after idle. No Date.now()/Math.random() — uses setTimeout + the rAF loop.
let spinPaused = false;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;
const pauseSpin = () => {
  spinPaused = true;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => { spinPaused = false; }, SPIN_RESUME_MS);
};
const gestures = ['mousedown', 'dragstart', 'zoomstart', 'wheel', 'click'] as const;
for (const ev of gestures) map.on(ev, pauseSpin);

let rafId = 0;
const spin = () => {
  // Skip while a user gesture paused us, while a programmatic flyTo eases (map-tie),
  // or when the tab is hidden. Our own setCenter is instantaneous (not "easing").
  if (!spinPaused && !map.isEasing() && !document.hidden) {
    const c = map.getCenter();
    map.setCenter([c.lng + ROTATE_DEG_PER_FRAME, c.lat]);
  }
  rafId = requestAnimationFrame(spin);
};
rafId = requestAnimationFrame(spin);
```

- [ ] **Step 2:** En el `return () => { … }` de cleanup del effect (donde ya hace `map.remove()`), añadir ANTES de `map.remove()`:

```ts
      cancelAnimationFrame(rafId);
      clearTimeout(resumeTimer);
```

(Nota: `rafId`/`resumeTimer` están en el scope del effect — accesibles en el cleanup.)

- [ ] **Step 3:** tsc + build. Expected: EXIT 0 + OK.
- [ ] **Step 4:** Smoke EN VIVO: el globo gira lento; al arrastrar/zoom/click se para; reanuda ~4s tras soltar; **seleccionar un país en un panel (flyTo) NO pelea con el spin** (la rotación pausa durante el vuelo por `isEasing()`).
- [ ] **Step 5:** Commit — `git add packages/web/src/map/MapView.tsx && git commit -m "feat(web): slow globe auto-rotation (pause on interact + flyTo)"`

---

## Task 5: Preservar Slice D/1 + verify + E2E + ADR

**Files:** Modify (si hace falta) `packages/web/slice-d-e2e.mjs` / `redesign-e2e.mjs`; `plans/DECISIONS.md` (ADR-020), `plans/ROADMAP.md`

- [ ] **Step 1:** Gates: `pnpm -r exec tsc --noEmit` (EXIT 0) · `npx tsc --noEmit -p tsconfig.json` (EXIT 0) · `pnpm test` (351/0, glow.test sigue) · `node --import tsx --test server.test.ts` (72/0, sin cambios) · `pnpm --filter @www/web build` (OK).
- [ ] **Step 2:** `slice-d-e2e.mjs` sobre el globo (backend+vite) → **PASS**. El click→popup usa `window.__wwMap.project()` que en globo devuelve el píxel correcto; si un click cerca del limbo falla, el E2E elige features in-bounds (ya lo hace). Si algo rompe, ajustar selector/posición — NO degradar Slice D (D-1105).
- [ ] **Step 3:** `redesign-e2e.mjs` sobre el globo → **PASS** (canvas presente, tabs mono, popup HUD cian, 375px). Añadir, si es barato, un check de que `window.__wwMap.getProjection().type === 'globe'`.
- [ ] **Step 4:** Smoke EN VIVO final: globo + atmósfera + glow + chrome HUD + rotación; click→popup HUD ES; Traducir (Slice D); seleccionar país→flyTo pausa el spin. Screenshot.
- [ ] **Step 5:** `plans/DECISIONS.md` ADR-020 (D-1100..D-1105). `plans/ROADMAP.md`: Fase 6 Slice 2 ✅ (rediseño UI completo 2/2).
- [ ] **Step 6:** Commit — `git add packages/web/*-e2e.mjs plans/ && git commit -m "test(web): globe E2E + Slice D/1 preserved + ADR-020 (Slice 2 done)"`

---

## Self-Review

**Cobertura del spec:** upgrade v5 (T1/G1) · globo (T2/G2) · atmósfera (T3/G3) · rotación pausada (T4/G4) · preservar+verify (T5/G5). Estrellas DIFERIDAS (NG-5/D-1104). Ping DIFERIDO (D-1009).

**Placeholders:** ninguno — código concreto para upgrade, setProjection, setSky (graceful), rotación rAF con pausa/resume/flyTo. Los `as unknown as {...}` cubren tipos v5 inciertos (confirmar nombres reales tras install, T2/T3 step 2).

**Invariantes:** NO toca backend/store/motor (NG-1); NO reescribe Slice D/1 (NG-2, solo añade en MapView); globo nativo sin three.js (NG-3); sin Date.now/Math.random en rotación (rAF+setTimeout); globo solo tras style.load.

**Riesgos:** R-1 v5 rompe click/popup→slice-d-e2e+smoke vivo. R-2 setSky/setProjection firma→try/catch+confirmar tipos. R-3 rotación pelea→pausa interact+isEasing(flyTo). R-4 FPS→smoke; bajar tasa/glow. R-6 install Windows→allowBuilds.

**Gotchas:** globo en `style.load` (no `load` ni antes); `isEasing()` auto-pausa el spin durante flyTo; cleanup cancela rAF+timer; `setProjection`/`setSky` quizá necesiten casteo según tipos v5.
