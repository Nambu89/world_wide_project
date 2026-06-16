# Verificación del Plan — Superficie UI de Convergencia (Fase 2 · rebanada 5)

- **Plan:** `plans/2026-06-16-convergence-surface.md` (T-33 server+centroide ‖ T-34 web, 1 ronda)
- **Design-doc:** `docs/design/2026-06-16-convergence-surface.md` (D-400..409)
- **Verificador:** plan-checker (read-only) · **Fecha:** 2026-06-16
- **Materializado por:** PM (el plan-checker es read-only; este informe transcribe su veredicto)

## Veredicto: PASS — 0 bloqueantes · 3 warnings no-bloqueantes

Las afirmaciones load-bearing verificadas en código real: handler `/api/cii` espejado existe (`server.ts:432`); `getLatestConvergence()` existe y devuelve `ConvergenceSignalRow[]` camelCase sin transform (`@www/store` index.ts:788 / types.ts:156-168); **"Palestinian Territories" efectivamente FALTA** en `country-centroids.ts` (los otros 9 países vivos están → GAP-2 real, T-33 lo cubre); patrones cliente (`RawCiiRow`/`adaptCiiRow`/`getCii`) + config-array (`CII_LAYERS` iterado en el spread de `MapView`, sin addLayer imperativo) existen como espejo. Ningún Goal/D-NN sin tarea; `files_modified` disjuntos T-33/T-34; ambos verify_cmd <60s; 6 Non-Goals respetados; sin erosión de scope.

### Cobertura: G1-G5 + GAP-1/GAP-2 + OQ-3 todos con tarea. OK.
### Dependencias: disjunción real (server.ts+connectors/geo ∥ packages/web), sin ciclo; T-34 codifica contra el contrato (no necesita server vivo para tsc/build). OK.
### Scope: 9 ficheros, adición pura, sin breaking. Non-Goals respetados. OK.
### Fidelidad bloqueadas: D-001 (no aplica copia), D-002/ADR-004 (solo-lectura en acceptance), NG-1 (boundaries prohíben tocar el motor). OK.

### Auditorías específicas (todas OK)
- Solo-lectura (D-401): T-33 acceptance #2 exige que la ruta NO llame detectAllConvergence.
- camelCase (D-409/L-1): wire camelCase nativo verificado; R-4 con curl + E2E.
- Config-array (D-008): `MapView.tsx:192` itera el spread; T-34 prohíbe addLayer.
- Empty-state (D-408): estado empty separado de error con copy.
- Glifo anillo (D-402): circle-color transparent + stroke, rampa distinta, radio mayor (R-5).
- R-2 (map-tie): verificado que `flyTo` (`MapView.tsx:373-390`) busca solo en `ciiDataRef` → la mitigación (`convergenceDataRef` + lat/lon de la señal) es necesaria y está en files_modified de T-34.

### Warnings (no bloquean)
1. **L-2 condicional:** server.ts importa centroides por **path relativo** (`./packages/connectors/geo/country-centroids.js`, `server.ts:43`), NO vía dist → el rebuild de connectors dist probablemente NO es necesario para el server. El PM confirma en el cierre cómo resuelve `packages/web`/otros consumidores el import antes de decidir rebuild.
2. **GAP-1 (topDimension):** depende de la forma real de `componentsJson`; el fallback `dimensions[0]` hace la tarea segura aunque difiera. Sin acción.
3. **Smoke "10 países lat/lon non-null":** 9/10 presentes + Palestinian Territories añadido por T-33; un país pequeño futuro sin centroide quedaría panel-only (R-1, aceptable). Sin acción previa.

### Recomendaciones
1. En el cierre, verificar empíricamente el import de centroides desde packages/web antes del tsc global (server.ts ya confirmado path-relativo).
2. Orden de rutas: OQ-1 diferido → no hay regex `:country`, sin riesgo de precedencia.

**PASS — listo para implementar.**
