# Check-Plan — UI Redesign Slice 1 (command-center reskin)
## Fecha: 2026-06-19
## Veredicto: PASS (0 bloqueantes; 1 issue de diseño resuelto en el plan)

> Nota: el agente `plan-checker` truncó por turnos (L-6) antes de escribir su veredicto a disco; lo consolida el PM con sus hallazgos sustantivos + resolución.

## Dimensiones

| Dim | Resultado | Nota |
|-----|-----------|------|
| D1 Cobertura de requisitos | OK | basemap (T2/G1), glow (T3/G2), chrome+tipografía (T1,T4/G3), preservar Slice D (T5/G4), responsive (T4/T5/G5). Slice 2 globo explícitamente fuera (NG-1). |
| D2 Completitud de tareas | OK | tokens→basemap→glow→chrome→verify, cada una con verificación real (build/E2E; `glowOf` unit-test). Sin stubs. |
| D3 Dependencias | OK | orden sin ciclos; tokens primero. `glowOf`/`GLOW_LAYERS` consistentes config↔MapView↔test. |
| D4 Scope | OK | frontend-only; NO toca backend/store/motor/migraciones (NG-2), NO sube MapLibre v4 (NG-1), NO toca popup.ts/i18n/click (NG-3). 5 tareas, 1 área (web). Sin frases de erosión. |
| D5 Riesgos | OK (1 resuelto) | ver abajo. |

## Hallazgos del plan-checker (interim, antes de truncar) — todos no-bloqueantes

1. **Test wiring de `glow.test.ts`** ✓ correcto: el root `test` script globa `packages/*/test/**/*.ts` → recoge `packages/web/test/` (igual que `popup.test.ts`/`countries.test.ts`). El "+2" del plan cuadra (2 `test()`).
2. **`glowOf` radio**: `evt-earthquake` tiene `circle-radius` = `['interpolate',...]` (array) → rama `['*', r, GLOW_SCALE]`. El test solo asserta `!== undefined` → pasa. ✓
3. **Fidelidad a decisiones D-1001..D-1010 + NG-1/2/3** ✓ — ninguna tarea las viola.

## Issue real levantado → RESUELTO en el plan

- **Fallback de basemap (Task 2 original)**: el plan proponía `map.on('error')→setStyle(RASTER_FALLBACK)→registerLayers`. PROBLEMA: `setStyle()` elimina TODAS las sources/capas y NO re-inyecta los datos ya fetchados (los `useEffect` de datos hicieron `source.setData(...)` una vez); re-registrar dejaría sources vacíos + riesgo de doble-bind del click handler.
- **Resolución (ponytail)**: se DESCARTA el auto-fallback. Task 2 ahora = `style: DARK_STYLE_URL` + `.map-container { background: var(--bg) }` (un basemap caído se ve oscuro, no roto) + `map.on('error')` solo loguea. NO se toca el `map.on('load')` (registro de capas + click de Slice D intactos). Hard raster-fallback diferido (la app necesita conectividad para datos/LLM de todos modos). Design-doc R-1/D-1001 actualizado para coincidir.

## Veredicto

**PASS.** El plan es fiel al design-doc, se mantiene en presentación sin tocar lo verificado, preserva Slice D por construcción (reskin = CSS + config de capas), y el único issue (fallback frágil) está resuelto simplificando. Listo para implementar.
