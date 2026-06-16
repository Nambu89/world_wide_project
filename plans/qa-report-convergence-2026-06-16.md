# QA Report — Superficie UI de Convergencia (Fase 2 · rebanada 5)

- **Fecha:** 2026-06-16
- **Tester:** qa-tester (mcp_playwright) + PM (materializa este informe; el qa-tester truncó antes de escribirlo)
- **App:** web http://localhost:5173 (vite) + API :8787, con 11 señales de convergencia vivas
- **Veredicto: PASS (19/19 checks)** — confirmado por el PM con tsc+build + curl + revisión visual de screenshots

## Checks

| # | Check | Resultado |
|---|-------|-----------|
| 1 | Carga sin errores consola/red | PASS |
| 2 | 5ª pestaña "Convergence" → panel lista señales (~11), **país real, NO undefined** (anti-BUG-1) | PASS · badNames=0 |
| 3 | Orden por strength descendente | PASS |
| 4 | Toggle 'convergence' (apagado por defecto) → ON → **ANILLOS** en el mapa | PASS |
| 5 | Coexistencia anillo (convergencia) + círculo relleno (CII) con ambos toggles (R-5) | PASS |
| 6 | Map-tie: click en señal → flyTo al país | PASS |
| 7 | Estado 'ok' con datos (no empty/error indebido) | PASS |
| 8 | Responsive 375 (sin overflow, drawer) + 1200 (lateral) | PASS |

## Evidencia visual (PM revisó)
- `conv-02-panel-1200.png`: panel "Convergence Signals" con filas reales (país + badge "events + signals" + strength + atribución). Sin "undefined" → parser camelCase OK (anti-BUG-1).
- `conv-05-coexistence-1200.png`: anillos huecos (borde rojo/ámbar por strength) sobre Europa/Oriente Medio/África/Sur de Asia, coexistiendo con los puntos rellenos del CII (R-5 OK).
- Screenshots: `plans/screenshots/conv-0{1,2,4,5,6,8}-*.png`.

## Verificación de contrato (curl, PM)
`GET /api/convergence` → 11 señales, **0 keys snake_case** (camelCase end-to-end), lat/lon adjunto (Palestinian Territories 31.9/35.2 tras GAP-2; Cuba sin centroide → panel-only, R-1 esperado), componentsJson = ConvergenceObservation[] (GAP-1 topDimension derivable).

## Notas / follow-ups (no bloquean)
- **Cuba** (y otros países que el motor produzca sin centroide) → panel-only (R-1, gracioso por diseño D-400). La tabla de centroides es incompleta (mismo límite que el CII: parte de los países solo-panel). Follow-up: completar `COUNTRY_CENTROIDS` si se quiere cobertura total de mapa.
- Warning de build 500kB (MapLibre) pre-existente, no de esta rebanada.

`convergence-e2e.mjs` queda en repo (convención, como cii-e2e.mjs/radar-e2e.mjs).
