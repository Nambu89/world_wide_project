---
version: alpha
name: plan-convergence-surface
description: Plan de implementación de la superficie UI de convergencia — Fase 2 rebanada 5, espejo estricto de la superficie CII (rebanada 3). GET /api/convergence solo-lectura (getLatestConvergence + centroides) + CONVERGENCE_LAYERS (anillo por strength, toggle independiente) + ConvergencePanel + 5ª pestaña con map-tie + getConvergence/RawConvergenceRow camelCase. NO toca el motor (rebanada 4 cerrada). 2 tareas (T-33 server+centroide ‖ T-34 web). Pendiente de /check-plan.
status: draft
date: 2026-06-16
owner: pm-coordinator
---

# Plan de Implementación — Superficie UI de Convergencia (Fase 2 · rebanada 5)

- **Fecha:** 2026-06-16
- **Autor:** PM Coordinator
- **Design-doc fuente:** [docs/design/2026-06-16-convergence-surface.md](../docs/design/2026-06-16-convergence-surface.md)
- **Estado:** Pendiente de `/check-plan` (gate PREVIO) → aprobación → implementación
- **Decisiones bloqueadas:** ADR-001..013 ([plans/DECISIONS.md](DECISIONS.md)) + D-001/D-002 + D-400..409 (design-doc §Decisions)
- **Cadencia (usuario):** ronda a ronda con checkpoint.

## Goal (Objetivo)

Dar **superficie de lectura** al motor de convergencia (rebanada 4): que las señales de `convergence_signals` se VEAN en el mapa (capa `CONVERGENCE_LAYERS`, glifo anillo) y en un `ConvergencePanel` (lista por strength + map-tie), vía una ruta `GET /api/convergence` solo-lectura espejo de `/api/cii`. Cierra las 5 lecturas de la plataforma: Finance · Events · Radar · Risk · **Convergence**. **NO toca el motor** (NG-1): solo AÑADE superficie. camelCase de punta a punta (L-1).

## Decisiones ratificadas (OQ-1..3 + gaps) — el PM ya las cerró

- **OQ-1 → D-407 DIFERIDO:** NO se construye `/api/convergence/:country` (trend por-país) en esta rebanada (con ~10 señales + `firstDetectedAt` en la lista aporta poco; difiere a follow-up). Solo `GET /api/convergence` (lista).
- **OQ-2 → D-402:** el anillo se colorea por **strength** (rampa ámbar→rojo); `topDimension` = solo tooltip/secundario.
- **OQ-3 → D-403:** la capa de convergencia entra con **toggle propio, apagado por defecto**; abrir la pestaña NO fuerza la capa.
- **GAP-1 CERRADO (verificado en código):** `componentsJson` = `JSON.stringify(ConvergenceObservation[])` donde cada obs = `{country, dimension, dataFamily, magnitude, ts, signalPresent, source}` (ver `packages/core/signals/src/observe.ts`). `topDimension` = `dimension` de la obs con mayor `magnitude`; fallback `dimensions[0]`.
- **GAP-2 CERRADO (verificado en `country-centroids.ts`):** 9/10 países vivos tienen centroide; **falta "Palestinian Territories"** → se AÑADE en T-33 (mejora también el CII). Tras añadirlo, los 10 aparecen en el mapa.
- **R-2 (map-tie):** el `flyTo` actual de `MapView` busca centroide en `ciiDataRef`. Toda señal de convergencia viene de un país con snapshot CII (las observaciones SON componentes CII), así que en la práctica `ciiDataRef` los cubre — PERO el implementador NO debe asumirlo: mantiene un `convergenceDataRef` propio y el `flyTo` busca el centroide en el dato de la señal (que YA lleva lat/lon del server) o en ambos refs.

## Lecciones horneadas (OBLIGATORIO)

- **L-1 — camelCase (anti-BUG-1):** `/api/convergence` serializa `ConvergenceSignalRow` camelCase directo (sin transform). `RawConvergenceRow` en `client.ts` tipa camelCase, NUNCA snake_case. BUG-1 histórico (snake_case) dejó el mapa a cero puntos. Verificar con `curl` real al cierre.
- **L-2 — rebuild dist:** si T-33 toca `country-centroids.ts` (en `@www/connectors`) y `server.ts` importa los centroides vía dist de `@www/connectors`, el PM rebuildea connectors dist antes del tsc consolidado. (Verificar cómo importa `/api/cii` los centroides y replicar.)
- **L-3 — tsx ≠ typecheck:** PM corre el tsc global + build al cerrar.
- **L-5 — verde ≠ funciona:** cierre exige **smoke EN VIVO** (`curl /api/convergence` camelCase con lat/lon de los 10 países) + **browser E2E** (capa anillo + panel + map-tie + responsive 375/1200 + empty-state) — patrón `cii-e2e.mjs` → `convergence-e2e.mjs`.
- **L-6 — agentes truncan/mueren:** dispatch directo, prompts acotados, escribe-ficheros-primero; el PM remata (en la rebanada 4, T-30/T-31 los escribió el PM). Prevé Bash denegado.

## Quality Gates

- **PREVIO:** este plan NO se presenta sin `plan-checker = PASS`.
- **POSTERIOR:** verify propio del PM por ronda; gate `/verify` + smoke EN VIVO + browser E2E al cierre.
- **NO tocar el motor (NG-1):** ni `@www/core-signals`, ni el job del scheduler, ni `005_convergence.sql`, ni el tipo `ConvergenceSignalRow`. Solo superficie de lectura.
- **Config-array central (D-008):** la capa SOLO en `layers.config.ts`, iterada por `MapView`; PROHIBIDO `addLayer` imperativo.

---

## Tasks

> Numeración T-33+ (rebanada 4 llegó a T-32). `verify_cmd` <60s. El agente devuelve estado + ficheros + salida-de-verify literal (o "Bash denegado") + Self-Report.

### T-33 — `server.ts` `GET /api/convergence` + centroide Palestinian Territories

```yaml
id: T-33
description: Ruta solo-lectura GET /api/convergence (getLatestConvergence + lat/lon por centroide, espejo de /api/cii) + añadir "Palestinian Territories" a COUNTRY_CENTROIDS (GAP-2)
agent: backend-architect
wave: A
depends_on: []
files_modified:
  - server.ts                                          # añade GET /api/convergence
  - server.test.ts                                     # tests de la ruta
  - packages/connectors/geo/country-centroids.ts       # añade Palestinian Territories (GAP-2)
boundaries:
  - "NO toques @www/core-signals, el scheduler, la migración, ni el tipo ConvergenceSignalRow (NG-1). NO toques el pipeline middleware ni otras rutas (solo AÑADE GET /api/convergence antes del 404). NO toques el motor."
constraints:
  - "D-400/D-401/ADR-004: SOLO-LECTURA. GET /api/convergence = `await getLatestConvergence()` (de @www/store, YA existe) → map a payload adjuntando lat/lon: `const c = COUNTRY_CENTROIDS[row.country]; return { ...row, lat: c?.lat ?? null, lon: c?.lon ?? null }`. NUNCA dispara el motor. Mismo patrón EXACTO que el handler de /api/cii — cópialo y sustituye getLatestCii→getLatestConvergence, CiiSnapshotRow→ConvergenceSignalRow. Importa COUNTRY_CENTROIDS igual que /api/cii (verifica la línea de import existente y replícala)."
  - "L-1: wire camelCase directo (JSON.stringify de ConvergenceSignalRow + lat/lon). familiesJson/dimensionsJson/componentsJson se devuelven CRUDOS como JSON string (el cliente parsea, espejo de cómo /api/cii devuelve componentsJson)."
  - "GAP-2: añade `'Palestinian Territories': { lat: 31.9, lon: 35.2 }` (o coords equivalentes) a COUNTRY_CENTROIDS en country-centroids.ts — para que la 10ª señal viva aparezca en el mapa. NO toques otras entradas."
  - "Ruta colocada como las demás (literal `pathname === '/api/convergence'`). NO se añade `/api/convergence/:country` (OQ-1 diferido)."
acceptance:
  - "GET /api/convergence devuelve array camelCase de señales con lat/lon adjunto (test con store sembrado vía insertConvergenceSignals + un país con centroide → lat/lon no-null, y uno sin centroide → null)."
  - "La ruta NO llama a detectAllConvergence ni a nada de @www/core-signals (solo-lectura)."
  - "Rutas previas (cii/events/signals/markets/briefing/health) siguen verdes."
  - "country-centroids.ts exporta Palestinian Territories con lat/lon válidos."
verify_cmd: "node --import tsx --test server.test.ts"
```

### T-34 — `packages/web/` capa de convergencia (anillo) + ConvergencePanel + 5ª pestaña + map-tie

```yaml
id: T-34
description: Cliente getConvergence (camelCase) + CONVERGENCE_LAYERS (anillo por strength) en el config-array + convergenceToGeoJSON + ConvergencePanel + 5ª pestaña con map-tie
agent: frontend-dev
wave: A
depends_on: []
files_modified:
  - packages/web/src/api/client.ts                # RawConvergenceRow camelCase + adaptConvergenceRow + getConvergence + view-model ConvergenceCountry
  - packages/web/src/map/layers.config.ts         # CONVERGENCE_LAYERS (anillo) + extiende LAYER_SOURCES/TOGGLE_KEYS
  - packages/web/src/map/MapView.tsx              # convergenceToGeoJSON + source 'convergence-countries' + convergenceDataRef + flyTo (R-2)
  - packages/web/src/panels/ConvergencePanel.tsx  # NUEVO: lista por strength + estados loading/empty/error + map-tie
  - packages/web/src/App.tsx                      # 5ª pestaña 'convergence' + render con activeCountry/handleCountrySelect existentes
  - packages/web/src/styles.css                   # estilos del panel + tab (responsive)
boundaries:
  - "NO toques server.ts ni backend (consume solo /api/convergence). TODA capa en layers.config.ts (iterada por MapView; PROHIBIDO addLayer imperativo, D-008). NO toques el motor. Espejo del trabajo CII (T-26): client.getCii/RiskPanel/CII_LAYER/ciiToGeoJSON son el patrón EXACTO."
constraints:
  - "L-1 (anti-BUG-1): RawConvergenceRow CAMELCASE (country, familiesJson, dimensionsJson, componentsJson, strength, sourceCount, dynamicScore, methodologyVersion, firstDetectedAt, capturedAt, lat, lon). adaptConvergenceRow parsea familiesJson/dimensionsJson/componentsJson con try/catch→[] (D-409). View-model ConvergenceCountry: {country, families[], dimensions[], topDimension, strength, sourceCount, dynamicScore, trend (signo de dynamicScore: >0 rising/<0 falling/else stable), firstDetectedAt(ISO), capturedAt(ISO), lat, lon}."
  - "GAP-1: topDimension = parsear componentsJson (ConvergenceObservation[]) y tomar la `dimension` de la obs con mayor `magnitude`; fallback dimensions[0]; null si vacío."
  - "D-402/D-404: CONVERGENCE_LAYERS = 1 capa type:'circle' con RELLENO transparente ('circle-color':'rgba(0,0,0,0)') + circle-stroke grueso → ANILLO; radio y stroke-width/opacity interpolados por strength; stroke-color rampa ámbar→rojo por strength (DISTINTA de la rampa de relleno del CII). source 'convergence-countries'. convergenceToGeoJSON: 1 Feature por señal CON lat/lon (descarta lat/lon null), props ESCALARES {country, strength, sourceCount, families:string('events+signals'), topDimension} (W-3: MapLibre no indexa arrays)."
  - "D-403/OQ-3: toggleKey 'convergence' INDEPENDIENTE; la capa entra APAGADA por defecto (no en el set de toggles activos inicial). D-405: 5ª pestaña al final (Finance·Events·Radar·Risk·Convergence)."
  - "D-406/R-2: map-tie reusa activeCountry + handleCountrySelect existentes; ConvergencePanel recibe {activeCountry, onCountrySelect} (mismas props que RiskPanel). Mantén un convergenceDataRef para que el flyTo encuentre el centroide del país de la señal aunque no esté en ciiDataRef (usa el lat/lon que ya trae la señal)."
  - "D-408: empty-state de PRIMERA CLASE — '0 señales' = caso ESPERADO con copy informativo ('Sin convergencias activas — requiere ≥2 fuentes coincidiendo'), distinto del estado error. ADR-008 responsive 375/1200."
acceptance:
  - "pnpm --filter @www/web build OK. client.getConvergence camelCase (RawConvergenceRow camelCase, parse defensivo)."
  - "CONVERGENCE_LAYERS en el config-array (MapView itera; sin addLayer imperativo); anillo (circle-color transparent + stroke). toggle independiente apagado por defecto."
  - "ConvergencePanel: estados loading/empty/error explícitos (empty informativo); orden por strength; map-tie llama onCountrySelect. 5ª pestaña montada."
verify_cmd: "pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build"
```

---

## Wave Scheduler

| Ronda | Tareas (paralelas) | Agente | Lock |
|-------|--------------------|--------|------|
| **A** | T-33 · T-34 | backend-architect + frontend-dev | server.ts + connectors/geo ∥ packages/web. Ficheros disjuntos. T-34 codifica contra el contrato documentado (RawConvergenceRow); no necesita el server vivo para tsc/build (sí para el smoke final). |

Orden serial seguro: `A(33‖34) → [PM: rebuild connectors dist si T-33 tocó centroides+server importa vía dist (L-2); global tsc; smoke EN VIVO + browser E2E]`.
Ficheros de alto conflicto / reservados al PM: ninguno cruzado (server.ts solo T-33, web solo T-34).

## Matriz de cobertura (Goal/Decisión → tarea)

| Goal / Decisión | Tarea |
|-----------------|-------|
| G1 /api/convergence solo-lectura + centroides (D-400/D-401) | T-33 |
| G2 CONVERGENCE_LAYERS anillo en config-array (D-402/D-404) | T-34 |
| G3 ConvergencePanel por strength + estados + empty (D-408) | T-34 |
| G4 5ª pestaña + map-tie (D-405/D-406) | T-34 |
| G5 camelCase end-to-end (D-409/L-1) | T-33 (wire) + T-34 (cliente) |
| GAP-2 Palestinian Territories centroide | T-33 |
| GAP-1 topDimension desde componentsJson | T-34 |
| OQ-3 capa apagada por defecto (D-403) | T-34 |
| D-008 config-array (no imperativo) | T-34 |
| ADR-004 solo-lectura (no re-dispara motor) | T-33 |

## Risks (→ tarea)

| Riesgo | Mitigación | Tarea |
|--------|-----------|-------|
| R-1 país sin centroide → panel-only | D-400 (lat/lon null gracioso) + GAP-2 añade Palestinian Territories | T-33 |
| R-2 map-tie de país sin snapshot CII | convergenceDataRef + flyTo usa lat/lon de la señal (ya en el wire) | T-34 |
| R-3 empty confundido con error | D-408 separa empty (esperado, informativo) de error (catch) | T-34 |
| R-4 camelCase/snake_case (BUG-1 reincidente) | RawConvergenceRow camelCase + curl real + browser E2E al cierre | T-33, T-34, cierre |
| R-5 anillo tapa/tapado por círculo CII | anillo transparente + radio MAYOR que el círculo CII; verificar con ambos toggles en el E2E | T-34 |
| L-6 agente trunca/muere | dispatch acotado + el PM remata (precedente T-30/T-31) | ambas |

## Fuera de alcance (Non-Goals — design-doc)

`/api/convergence/:country` trend por-país (OQ-1 diferido, D-407); filtros server-side minStrength/family/bbox (NG-4); alertas push (NG-5); overlay narrativo LLM en el panel (NG-6); cualquier cambio al motor/calibración (NG-1/NG-3, rebanada 4 cerrada).

## Verificación final (tras Ronda A)

1. Artefactos en disco + git diff. Rebuild connectors dist si T-33 tocó centroides (L-2). Global `pnpm -w exec tsc --noEmit` + suite completa.
2. **Smoke EN VIVO** (L-5): `pnpm dev` → `curl http://localhost:8787/api/convergence` → array camelCase con las ~10 señales, **lat/lon no-null en los 10** (incl. Palestinian Territories tras GAP-2), familiesJson/strength/dynamicScore presentes. Verificar que NO hay snake_case (clase BUG-1).
3. **Browser E2E** (L-5, `convergence-e2e.mjs` espejo de `cii-e2e.mjs`): pestaña Convergencia → panel lista las señales por strength (badNames=0, parser camelCase OK); toggle de capa ON → anillos en el mapa (10 países); map-tie (click señal → flyTo); coexistencia anillo+círculo CII con ambos toggles; **empty-state** (forzar 0 señales o verificar el copy); responsive 375/1200; 0 errores consola/red.
4. `/verify` (verifier, goal-backward): ruta solo-lectura (no toca motor), config-array iterado (no addLayer imperativo), camelCase, empty-state de primera clase, anillo distinto del CII, centroide añadido, sin stubs/TODO.
5. Solo se reporta "Superficie de convergencia (Fase 2 rebanada 5) completada" con verifier=VERIFIED + smoke + E2E PASS.
```

