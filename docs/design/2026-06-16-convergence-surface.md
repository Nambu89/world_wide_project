---
version: alpha
name: convergence-surface
description: Superficie UI de lectura para el motor de convergencia cross-domain (rebanada 5, ESPEJO de la superficie CII de rebanada 3). Construye lo que la rebanada 4 dejó FUERA a propósito (NG-4 del motor): la ruta solo-lectura GET /api/convergence (getLatestConvergence + adjunta lat/lon por centroide de país, igual que /api/cii), una capa MapLibre CONVERGENCE_LAYER en el config-array central (un anillo/halo por país, glifo deliberadamente DISTINTO del círculo CII para que el ojo distinga "señal de convergencia ≥2 fuentes coinciden" de "score CII de un país"), un ConvergencePanel.tsx (señales activas ordenadas por strength, con familias contribuyentes, flecha dynamicScore y primera-detección) y una 5ª pestaña Convergencia con map-tie reusando el activeCountry ya existente. NO toca el motor (@www/core-signals, el job, la migración 005 están cerrados+verificados): solo AÑADE superficie de lectura. camelCase en el wire (L-1, anti-BUG-1). Empty-state es el caso esperado (la calibración puede no disparar) y debe ser informativo, no roto.
status: draft
date: 2026-06-16
owner: system-architect
---

## Overview

El **motor** de convergencia (rebanada 4, commit `be40fa5`) ya corre en el scheduler, persiste en la tabla `convergence_signals` (migración 005) y enriquece el briefing. Pero dejó FUERA, a propósito (su NG-4), toda **superficie de lectura**: no hay `/api/convergence`, ni capa de mapa, ni panel. Hoy las ~10 señales reales en vivo (Iraq, Israel, Pakistan, Russia, Ukraine, Palestinian Territories, Poland, Kenya, Norway, South Africa) sólo existen en la DB y en el briefing.

Esta rebanada construye esa superficie como un **espejo estricto de la superficie CII** (rebanada 3): la misma arquitectura solo-lectura (`server.ts` ruta regex + centroides), la misma config-array central de capas (`layers.config.ts`), el mismo patrón de `client.ts` (Raw\*Row camelCase + adaptador), el mismo patrón de panel con estados explícitos, y el mismo map-tie por `activeCountry`. El resultado deseado: poder VER en el mapa y en un panel **dónde ≥2 fuentes de dato independientes coinciden en deterioro a la vez** — la pregunta de orden superior que el CII (qué pasa en X) no responde por sí solo.

## Token-references

Bloque canónico. Cada token-reference del doc (`namespace.key` entre llaves) resuelve a una fila de esta tabla.

| Token | Definición |
|-------|-----------|
| `{api.route.convergence}` | `GET /api/convergence` — lista, último snapshot por `(country, familyset)` con lat/lon adjunto (D-400). |
| `{api.route.convergence-country}` | `GET /api/convergence/:country` — trend histórico de una señal de país (D-407). |
| `{api.readonly}` | La ruta NUNCA dispara el motor; sólo lee `convergence_signals` vía `getLatestConvergence()` (D-401, hereda ADR-004/D-002). |
| `{api.centroid.lookup}` | `COUNTRY_CENTROIDS[row.country]` en `packages/connectors/geo/country-centroids.ts` (solo-lectura); país sin centroide → `lat:null, lon:null` (panel-only). Mismo patrón que `/api/cii`. |
| `{wire.camelcase}` | El payload se serializa camelCase tal cual desde `ConvergenceSignalRow`; el cliente tipa camelCase, NUNCA snake_case (L-1, anti-BUG-1). |
| `{store.helper.latest}` | `getLatestConvergence(): Promise<ConvergenceSignalRow[]>` — EXISTE en `@www/store` (rebanada 4). Devuelve 1 fila por `(country, families_json)`. |
| `{store.helper.trend}` | `getPriorConvergence(country, familyset, aroundMs)` EXISTE; el trend por-país lo sirve una consulta análoga (ver D-407 / GAP-3). |
| `{store.row}` | `ConvergenceSignalRow = { id?, country, familiesJson, dimensionsJson, componentsJson, strength, sourceCount, dynamicScore, methodologyVersion, firstDetectedAt, capturedAt }` (camelCase, `@www/store`). |
| `{conv.families}` | `familiesJson` parseado → `DataFamily[]`, `DataFamily ∈ {events, signals, markets}`. En vivo hoy: siempre `["events","signals"]`. |
| `{conv.dimensions}` | `dimensionsJson` parseado → `ConvergenceDimension[]`, `∈ {conflict, economic, political, social}` (auditoría: qué dimensiones contribuyeron). |
| `{conv.strength}` | `strength ∈ [0,1]` — magnitud media con time-decay 72h. En vivo hoy: 0.72–0.91. Es el ordenador principal del panel y el driver del tamaño del glifo. |
| `{conv.dynamic}` | `dynamicScore` = delta de `strength` vs aparición previa del mismo `(country, familyset)`; `null` en primera detección → flecha "sin tendencia aún". |
| `{conv.first-detected}` | `firstDetectedAt` (epoch ms) — primera vez que se detectó esta convergencia; el panel lo muestra como "desde hace N". |
| `{map.glyph.ring}` | Glifo de convergencia = **anillo/halo** (`circle` relleno transparente + `circle-stroke` grueso) en el centroide del país, radio y opacidad del trazo por `{conv.strength}` (D-402). Deliberadamente distinto del círculo RELLENO del CII. |
| `{map.layer.id}` | id de capa `convergence-countries`; source `convergence-countries`; `toggleKey: 'convergence'` (D-403, toggle independiente del de CII). |
| `{map.source.geojson}` | `convergenceToGeoJSON(signals)` — 1 Feature por señal CON lat/lon; props escalares `{country, strength, sourceCount, families (string), topDimension}` (D-404). |
| `{panel.maptie}` | Reusa el `activeCountry` + `onCountrySelect` YA existentes en `App.tsx`/`MapView`; seleccionar señal → `flyTo` país. NO crea un canal de selección nuevo (D-406). |
| `{ui.tab}` | 5ª pestaña `convergence` en el switcher `PanelTab` de `App.tsx`; orden: Finance · Events · Radar · Risk · Convergence (D-405). |
| `{ui.responsive}` | Mobile-first 375px → desktop 1200px (ADR-008), idéntico a los paneles existentes. |
| `{ui.empty}` | Empty-state informativo: "Sin convergencias activas" + explicación de que requiere ≥2 fuentes coincidiendo (D-408). Caso ESPERADO, no error. |
| `{license.clean}` | Sin código AGPL de worldmonitor; sólo metodología (ADR-001/ADR-002, D-001 heredada). |

## Goals

- G1: Exponer `{api.route.convergence}` solo-lectura que devuelva el último snapshot por país (familias/dimensiones parseados o crudos + lat/lon), espejo exacto de `/api/cii` incluyendo el lookup de centroides `{api.centroid.lookup}`.
- G2: Añadir `{map.layer.id}` al config-array central (`LAYERS`/`SIGNAL_LAYERS`/`CII_LAYERS` → nuevo `CONVERGENCE_LAYERS`) con un glifo `{map.glyph.ring}` visualmente distinguible de la capa CII, toggle independiente, NUNCA `addLayer` imperativo.
- G3: Construir `ConvergencePanel.tsx` que liste señales activas ordenadas por `{conv.strength}` desc, mostrando por señal: país, `{conv.families}` contribuyentes, strength, flecha `{conv.dynamic}` y `{conv.first-detected}`, con estados explícitos loading / **empty (esperado)** / error.
- G4: Añadir la 5ª pestaña `{ui.tab}` con map-tie `{panel.maptie}` reutilizando el `activeCountry` existente, sin tocar el contrato de selección.
- G5: Mantener `{wire.camelcase}` de punta a punta: `getConvergence()` + `RawConvergenceRow` camelCase + `adaptConvergenceRow` en `client.ts`.

## Non-Goals

- NG-1: **No se toca el motor.** `@www/core-signals` (`detectConvergence`/`detectAllConvergence`), el job del scheduler y la migración `005_convergence.sql` están cerrados+verificados (rebanada 4). Esta rebanada SÓLO añade superficie de lectura. Si el diseño parece exigir cambiar el motor → PARA y escala.
- NG-2: **La ruta NO dispara el motor** (`{api.readonly}`): no recalcula convergencia on-request, no abre conectores, no escribe en la DB. Lee `convergence_signals` y adjunta centroides. Hereda ADR-004/D-002.
- NG-3: **Sin nuevos tipos de convergencia ni nueva calibración.** El panel/mapa muestran lo que el motor ya produjo. Re-derivar magnitudes, ventanas, half-life, o el set de familias detectables es del motor (NG del doc de rebanada 4), no de la superficie.
- NG-4: **Sin filtros de query avanzados** en `{api.route.convergence}` para el MVP (no `minStrength`, no `family=`, no `bbox`). El volumen es ~10 señales; el panel filtra/ordena en cliente. Se añaden como entradas separadas si hace falta (Iteration Guide).
- NG-5: **Sin alertas push / notificaciones / sonido.** Heredado de NG-3 del motor. La superficie es de lectura pasiva.
- NG-6: **Sin overlay narrativo LLM nuevo en el panel.** El briefing ya enriquecido (D-005 del motor) es el canal de narrativa; el panel es datos estructurados. No se añade llamada LLM.

## Context / Constraints

- **Stack**: Node single-server `server.ts` (regex routing manual, `sendJson`), Turso/libSQL vía `@www/store`, Vite + React + MapLibre GL en `packages/web`. Router LLM no interviene aquí.
- **El motor ya dejó listos los helpers de store**: `{store.helper.latest}` y `{store.helper.trend}` existen y están testeados (`packages/store/test/store.test.ts`, suite 23). El tipo `{store.row}` está exportado. NO se añade helper de store nuevo salvo el de trend por-país si el PM activa D-407 (ver GAP-3).
- **Centroides**: `packages/connectors/geo/country-centroids.ts` con `COUNTRY_CENTROIDS` — el mismo módulo que `/api/cii` ya importa en `server.ts`. La convergencia usa `country` ya normalizado a nombre canónico (mismo dominio de claves que CII), por lo que el match de centroide es directo.
- **camelCase obligatorio** (`{wire.camelcase}`, [[feedback_api_contract_camelcase]]): `@www/store` serializa `ConvergenceSignalRow` (campos camelCase) directo vía `JSON.stringify` sin transform. BUG-1 histórico: un cliente snake_case dejó el mapa con cero puntos. El cliente tipa camelCase SIEMPRE.
- **Config-array central** (ADR-003/D-008/[[feedback_central_layer_config]]): `MapView` itera `[...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS]` para registrar source + capa. La convergencia entra como `CONVERGENCE_LAYERS` añadido a ese spread; jamás `map.addLayer` fuera del bucle.
- **Datos en vivo (hoy)**: ~10 señales, todas `families=["events","signals"]`, `sourceCount=2`, `strength 0.72–0.91`. La consecuencia de independencia del motor (D-310/OQ-H: `political×economic` comparten familia `signals` → no son par independiente) significa que en la práctica casi todo es `events×signals`. El glifo/panel NO deben asumir más de 2 familias, pero deben funcionar si llegan 3.
- **Empty es el caso esperado**: si la calibración no dispara en una ventana, `getLatestConvergence()` devuelve `[]`. La superficie debe degradar a `{ui.empty}` informativo, nunca a un panel roto o un mapa en blanco sin explicación.
- **License-clean** (`{license.clean}`): metodología re-derivada, sin copiar fuente AGPL.

## Decisions

Numeración `D-4xx` (CII = D-2xx hasta D-213; motor convergencia = D-3xx hasta D-312; sin colisión). Las `D-0NN` son bloqueadas heredadas de ADR.

- **D-001 (bloqueada, ADR-002)**: re-implementar metodología, NUNCA copiar fuente AGPL de worldmonitor — porque sólo la metodología documentada es re-implementable; el código no.
- **D-002 (bloqueada, ADR-004)**: la UI lee de la DB local (`{api.readonly}`), no de upstream — porque el histórico/serie es el diferencial y la superficie debe sobrevivir a caídas de fuente y NO re-disparar cómputo.
- **D-400**: `{api.route.convergence}` devuelve `getLatestConvergence()` + adjunta `lat/lon` por `{api.centroid.lookup}`; país sin centroide → `lat:null, lon:null` (panel-only) — porque es el espejo EXACTO de `/api/cii` (T-25): mínima superficie nueva, comportamiento ya probado, una señal sin centroide igual debe verse en el panel.
- **D-401**: la ruta es estrictamente solo-lectura sobre `convergence_signals` — porque dispararla on-request violaría ADR-004 (el motor corre en el scheduler) y rompería el modelo local-first.
- **D-402**: el glifo del mapa es un **anillo/halo** (`{map.glyph.ring}`: relleno transparente + `circle-stroke` grueso) en el centroide, con radio y grosor/opacidad del trazo por `{conv.strength}` — porque la capa CII ya usa un círculo RELLENO por composite; un anillo es el contraste visual mínimo y semánticamente honesto ("convergencia = algo rodea/refuerza el país", no un score nuevo). Permite además que un anillo de convergencia y un círculo CII coexistan sobre el mismo centroide sin taparse.
- **D-403**: `{map.layer.id}` tiene `toggleKey: 'convergence'` INDEPENDIENTE del toggle `'cii'` — porque convergencia y CII son lecturas distintas; el usuario debe poder ver convergencia sola, CII solo, ambos, o ninguno. El config-array ya soporta toggles por capa.
- **D-404**: `convergenceToGeoJSON(signals)` emite 1 Feature por señal CON `lat/lon`, con props **escalares** `{country, strength, sourceCount, families: string, topDimension: string}` — porque MapLibre `['get', ...]` no indexa arrays (mismo W-3 hazard que signals); `families` se serializa como string legible (p.ej. `"events+signals"`) y `topDimension` = la dimensión de mayor contribución para tooltip/color secundario.
- **D-405**: 5ª pestaña `{ui.tab}` `'convergence'` al final del switcher (Finance · Events · Radar · Risk · Convergence) — porque es la lectura de orden superior (depende conceptualmente de las anteriores); va última y no reordena las existentes.
- **D-406**: el map-tie reusa `activeCountry` + `onCountrySelect` ya existentes (`{panel.maptie}`) — porque la convergencia es por-país igual que el CII; `activeCountry` ya alimenta el `flyTo` de `MapView` vía `ciiDataRef`. El `ConvergencePanel` llama el MISMO `onCountrySelect`. (Ver GAP-2: si el país de la señal no tiene snapshot CII vivo, el `flyTo` actual no encuentra centroide → mitigación en Risks/R-2.)
- **D-407 (condicional, PM ratifica — ver OQ-1)**: `{api.route.convergence-country}` (`GET /api/convergence/:country`) sirve el trend histórico de una señal, espejo de `/api/cii/:country`. Para el MVP es **opcional**: el panel funciona sólo con la lista. Se incluye si el PM quiere paridad total con CII; si no, se difiere (GAP-3).
- **D-408**: `{ui.empty}` es un estado de primera clase con copy informativo ("Sin convergencias activas — requiere ≥2 fuentes de dato coincidiendo en deterioro en el mismo país") — porque empty es el caso ESPERADO (calibración puede no disparar); un panel vacío sin explicación se leería como bug.
- **D-409**: `getConvergence()` + `RawConvergenceRow` (camelCase) + `adaptConvergenceRow` en `client.ts`, parseando `familiesJson`/`dimensionsJson`/`componentsJson` con `try/catch` → `[]` en fallo — porque es el patrón EXACTO de `adaptCiiRow` (parse defensivo de `componentsJson`); un JSON malformado no debe romper el panel.

## Interfaces / Data Contracts

### Backend — `{api.route.convergence}` (server.ts, espejo de /api/cii)

```ts
// GET /api/convergence — SOLO-LECTURA. Latest snapshot per (country, familyset)
// + lat/lon from COUNTRY_CENTROIDS. Country without centroid → lat/lon null.
// NEVER fires the engine ({api.readonly} / D-401 / ADR-004).
if (pathname === '/api/convergence') {
  const rows = await getLatestConvergence();           // {store.helper.latest}
  const payload = rows.map((row: ConvergenceSignalRow) => {
    const centroid = COUNTRY_CENTROIDS[row.country];   // {api.centroid.lookup}
    return {
      ...row,                                           // {wire.camelcase} — sin transform
      lat: centroid !== undefined ? centroid.lat : null,
      lon: centroid !== undefined ? centroid.lon : null,
    };
  });
  sendJson(res, 200, payload);
  return;
}
```

Regla de orden de rutas: si se activa D-407, el match regex `^\/api\/convergence\/([^/]+)$` se comprueba ANTES del literal `=== '/api/convergence'` (más específico primero), igual que `/api/cii/:country` precede a `/api/cii`.

**Payload de `{api.route.convergence}`** (camelCase, bare array): cada elemento = `{store.row}` + `{ lat: number|null, lon: number|null }`. `familiesJson`/`dimensionsJson`/`componentsJson` se devuelven **crudos como JSON string** (el cliente parsea), espejando cómo `/api/cii` devuelve `componentsJson` crudo. Decisión cerrada en D-404/D-409: parseo en el cliente, no en el wire.

### Cliente — `client.ts` (espejo de RawCiiRow/adaptCiiRow)

```ts
// WIRE = camelCase ({wire.camelcase}, L-1 — misma disciplina BUG-1 que RawCiiRow).
interface RawConvergenceRow {
  country: string;
  familiesJson: string;       // JSON string of DataFamily[]
  dimensionsJson: string;     // JSON string of ConvergenceDimension[]
  componentsJson: string;     // JSON string of evidencia por-componente
  strength: number;           // {conv.strength} 0..1
  sourceCount: number;
  dynamicScore: number | null;// {conv.dynamic}
  methodologyVersion: string;
  firstDetectedAt: number;    // epoch ms {conv.first-detected}
  capturedAt: number;         // epoch ms
  lat: number | null;
  lon: number | null;
}

// View-model público (consumido por ConvergencePanel + MapView)
export interface ConvergenceCountry {
  country: string;
  families: string[];         // {conv.families} parseado (['events','signals'])
  dimensions: string[];       // {conv.dimensions} parseado
  topDimension: string | null;// mayor contribución (para color/tooltip); null si vacío
  strength: number;
  sourceCount: number;
  dynamicScore: number | null;
  trend: 'rising' | 'falling' | 'stable' | null; // derivado de dynamicScore (>0 rising, <0 falling, ==0/null stable)
  methodologyVersion: string;
  firstDetectedAt: string;    // ISO string
  capturedAt: string;         // ISO string
  lat: number | null;         // null → panel-only, sin Feature en mapa
  lon: number | null;
}

export async function getConvergence(): Promise<ConvergenceCountry[]> {
  const raw = await apiFetch<RawConvergenceRow[]>('/api/convergence');
  if (!Array.isArray(raw)) return [];
  return raw.map(adaptConvergenceRow);
}
```

`adaptConvergenceRow` parsea `familiesJson`/`dimensionsJson` con `try/catch` → `[]` en fallo (D-409); `trend` se deriva del signo de `dynamicScore`; `topDimension` se extrae de `componentsJson` (la dimensión con mayor magnitud) o `dimensions[0]` como fallback. Si el PM activa D-407, se añade `getConvergenceTrend(country, since?)` espejo de `getCiiTrend`.

### Mapa — `layers.config.ts` (config-array central, NUNCA imperativo)

```ts
// CONVERGENCE_LAYERS — un anillo/halo por país, glifo distinto del círculo CII (D-402).
// Source: 'convergence-countries' (1 Feature/señal con lat/lon).
// Stroke por strength: trazo grueso/opaco = convergencia fuerte.
export const CONVERGENCE_LAYERS: LayerSpec[] = [{
  id: 'convergence-countries',
  source: 'convergence-countries',
  type: 'circle',
  label: 'Convergence (≥2 sources)',
  toggleKey: 'convergence',                       // {map.layer.id} / D-403 (independiente de 'cii')
  visibleWhen: (active) => active.has('convergence'),
  paint: {
    'circle-color': 'rgba(0,0,0,0)',              // relleno transparente → ANILLO (D-402)
    'circle-radius': /* interpolate por zoom × strength, p.ej. 10..28px */,
    'circle-stroke-width': /* interpolate por strength: 1.5..5px */,
    'circle-stroke-color': /* ramp por strength: ámbar→rojo, distinto de la rampa CII de relleno */,
    'circle-stroke-opacity': /* interpolate por strength: 0.5..1 */,
  },
}];
// LAYER_SOURCES y TOGGLE_KEYS extienden el spread con CONVERGENCE_LAYERS.
```

`MapView` añade `CONVERGENCE_LAYERS` al spread de registro de source + capa (`[...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS]`), añade `convergenceToGeoJSON` (`{map.source.geojson}`) y un `useEffect` de carga que llama `getConvergence()` e inyecta `source.setData(...)` en `'convergence-countries'` — mirror 1:1 del `useEffect` de CII. El `flyTo` de map-tie reusa el efecto de `activeCountry` ya existente; se mantiene un `convergenceDataRef` para que el `flyTo` encuentre el centroide aunque la señal no tenga snapshot CII (mitiga R-2).

### Panel — `ConvergencePanel.tsx` (espejo de RiskPanel)

Props: `{ activeCountry: string | null; onCountrySelect: (country: string) => void }` — idénticas a `RiskPanel` (`{panel.maptie}`). Estados `idle | loading | error | empty | ok`. Orden: por `{conv.strength}` desc. Por señal: nombre de país, badge de `{conv.families}` (p.ej. "events + signals"), barra de strength (0..1 → 0..100%), flecha `{conv.dynamic}` (▲/▼/–), `{conv.first-detected}` ("desde hace N"), y `sourceCount`. Empty-state `{ui.empty}` con copy de D-408. Atribución al pie: "Convergencia propia · datos: USGS/NASA EONET/GDELT/GKG" (mismo footer que RiskPanel).

### App — `App.tsx`

`PanelTab` añade `'convergence'`; nuevo botón de tab tras Risk (D-405). El render condicional es el espejo del de Risk: cuando `activeTab` vale `convergence`, monta `<ConvergencePanel ... />` pasándole el prop `activeCountry` y cableando `onCountrySelect` al handler `handleCountrySelect`. Reusa `activeCountry` y `handleCountrySelect` existentes (D-406) — no se añade estado de selección nuevo.

## Do's and Don'ts

- **DO**: copia el handler de `/api/cii` literalmente y sustituye `getLatestCii`→`getLatestConvergence`, `CiiSnapshotRow`→`ConvergenceSignalRow` — porque la superficie ya está probada en vivo (109 países CII); divergir sin razón reintroduce riesgo resuelto.
- **DO**: tipa `RawConvergenceRow` en camelCase y parsea `*Json` en el cliente — porque `@www/store` serializa camelCase sin transform; un cliente snake_case dejó el mapa a cero puntos en BUG-1 ([[feedback_api_contract_camelcase]]).
- **DO**: registra `{map.layer.id}` SÓLO en el config-array y deja que `MapView` lo itere — porque el `addLayer` imperativo disperso es exactamente lo que la config-array central existe para impedir (D-008).
- **DO**: trata `{ui.empty}` como estado de primera clase con copy informativo — porque 0 señales es el resultado ESPERADO de una ventana sin convergencia, no un fallo.
- **DON'T**: NO llames a `detectConvergence`/`detectAllConvergence` ni a ningún código de `@www/core-signals` desde la ruta o el panel — porque el motor corre en el scheduler ({api.readonly}/ADR-004); la superficie sólo LEE `convergence_signals`.
- **DON'T**: NO modifiques `005_convergence.sql`, el job del scheduler, ni el tipo `ConvergenceSignalRow` — porque la rebanada 4 está cerrada+verificada; cualquier cambio ahí es fuera de scope (NG-1) y debe escalar al PM.
- **DON'T**: NO reuses el círculo RELLENO ni la rampa de color del CII para el glifo de convergencia — porque el usuario debe distinguir de un vistazo "score de país" (relleno) de "convergencia de fuentes" (anillo); colapsar ambos glifos destruye la señal visual (D-402).
- **DON'T**: NO añadas filtros de query server-side en el MVP (`minStrength`, `family=`) — porque con ~10 señales el filtrado en cliente basta (NG-4); añadirlos prematuramente es superficie sin uso.
- **DON'T**: NO asumas exactamente 2 familias en glifo/panel — porque la independencia del motor permite 3+ en teoría (hoy siempre 2); renderiza `families.length` genéricamente.

## Risks

- **R-1 — `country` de convergencia sin entrada en `COUNTRY_CENTROIDS`** → `lat/lon null` → la señal NO aparece en el mapa (sólo panel). *Mitigación*: D-400 ya lo contempla (panel-only); el panel SIEMPRE muestra todas las señales. En vivo los 10 países son grandes y conocidos → riesgo bajo, pero "Palestinian Territories" debe verificarse en la tabla de centroides (GAP-2).
- **R-2 — map-tie roto para país sin snapshot CII vivo**: el `flyTo` actual de `MapView` busca el centroide en `ciiDataRef` (datos del CII). Si una señal de convergencia es de un país que NO está en `getLatestCii()`, el `flyTo` no encontraría centroide. *Mitigación*: mantener un `convergenceDataRef` propio y que el efecto de `activeCountry` busque el centroide en AMBOS refs (o directamente en el centroide adjunto a la señal). El implementador debe NO asumir que `ciiDataRef` cubre todos los países de convergencia.
- **R-3 — empty-state confundido con error**: si `getConvergence()` lanza, el panel muestra `error`; si devuelve `[]`, muestra `empty`. *Mitigación*: D-408 separa los dos estados con copy distinto; el `catch` del `useEffect` de mapa deja la source vacía sin romper (espejo del CII).
- **R-4 — desincronización camelCase/snake_case** (BUG-1 reincidente). *Mitigación*: `RawConvergenceRow` tipado camelCase + verificación en vivo con `curl /api/convergence` antes de dar por buena la capa (igual que el smoke que descubrió BUG-1 — [[feedback-live-qa-vs-mocks]]).
- **R-5 — glifo de convergencia tapa/es tapado por el círculo CII** sobre el mismo centroide. *Mitigación*: D-402 (anillo transparente con radio MAYOR que el círculo CII) hace que coexistan; verificar visualmente con ambos toggles activos en el smoke.

## Iteration Guide

Dependencias: `client.ts` (sin deps nuevas) → `layers.config.ts` (sin deps) → `MapView.tsx` (depende de client + layers) → `ConvergencePanel.tsx` (depende de client) → `App.tsx` (depende de panel). `server.ts` es independiente y va primero (desbloquea el smoke con `curl`).

Flujo de datos:

```
scheduler (rebanada 4, NO TOCAR)
  └─> convergence_signals (Turso, migración 005)
        └─> getLatestConvergence()  [@www/store, EXISTE]
              └─> GET /api/convergence  [server.ts — AÑADIR, solo-lectura + centroides]
                    └─> getConvergence() / RawConvergenceRow  [client.ts — AÑADIR, camelCase]
                          ├─> ConvergencePanel.tsx  [lista por strength + map-tie]
                          └─> MapView: convergenceToGeoJSON → source 'convergence-countries'
                                └─> CONVERGENCE_LAYERS (anillo)  [layers.config.ts — config-array]
```

Secuencia de implementación (UNA pieza de punta a punta antes de la siguiente):

1. `server.ts`: añadir handler `{api.route.convergence}` (copiar el de `/api/cii`, sustituir helper+tipo). Smoke: `curl localhost:PORT/api/convergence` → array camelCase con lat/lon. (Si D-407 ratificado: añadir `:country` ANTES del literal.)
2. `client.ts`: `RawConvergenceRow` + `adaptConvergenceRow` + `getConvergence()` + view-model `ConvergenceCountry`.
3. `layers.config.ts`: `CONVERGENCE_LAYERS` + extender `LAYER_SOURCES`/`TOGGLE_KEYS`.
4. `MapView.tsx`: `convergenceToGeoJSON` + `useEffect` de carga + `convergenceDataRef` + extender el spread de iteración y el efecto de `flyTo` (R-2).
5. `ConvergencePanel.tsx`: panel con estados + orden por strength + atribución.
6. `App.tsx`: 5ª pestaña + render con `activeCountry`/`handleCountrySelect` existentes.

Reglas de edición del doc: añade variantes nuevas (p.ej. activar D-407, añadir un filtro de NG-4) como entradas separadas, no reescribas las existentes. Refiere por token (`{map.glyph.ring}`, `{api.readonly}`), no re-cites el número de D. Tras cada edición, deja que `spec-validator.js` valide. Cierra cada pieza con smoke EN VIVO (`curl` + Playwright), no sólo tests verdes ([[feedback-live-qa-vs-mocks]]).

## Known Gaps / Open Questions

Fuera de scope con razón (GAP-N) y open questions que el PM ratifica (OQ-N):

- **GAP-1**: el contenido EXACTO de `componentsJson` (la evidencia por-componente que produce el motor) no se inspeccionó campo-a-campo en esta sesión — sólo se sabe que es JSON string. `adaptConvergenceRow` extrae `topDimension` de él defensivamente; si su forma no permite derivar `topDimension`, el fallback es `dimensions[0]`. El implementador debe inspeccionar una fila real (`curl` o DB) antes de codificar la extracción.
- **GAP-2**: cobertura de `COUNTRY_CENTROIDS` para los 10 países en vivo NO verificada nominalmente esta sesión (en especial "Palestinian Territories" y nombres compuestos). El implementador confirma con un `curl /api/convergence` que cada país tiene lat/lon no-null; los que falten quedan panel-only (R-1) — aceptable, pero conviene saberlo.
- **GAP-3 / OQ-1 (PM ratifica)**: ¿se incluye `{api.route.convergence-country}` (D-407, trend histórico por señal) en el MVP de esta rebanada, o se difiere? Recomendación: **diferir** — con ~10 señales y `firstDetectedAt` ya en la lista, el trend por-señal aporta poco valor inmediato y añade una ruta + un `getConvergenceTrend` + una consulta de store nueva. Si el PM quiere paridad 1:1 con CII, se activa; el coste es S.
- **OQ-2 (PM ratifica)**: ¿el glifo `{map.glyph.ring}` debe colorear el trazo por `strength` (intensidad de convergencia) o por `topDimension` (qué domina: conflict=rojo, economic=ámbar, etc.)? Recomendación: **por strength** para el MVP (consistente con que strength es el ordenador del panel); `topDimension` como color secundario/tooltip. Color por dimensión se difiere si el usuario lo pide.
- **OQ-3 (PM ratifica)**: ¿la 5ª pestaña debe poder co-mostrarse con la capa CII activada por defecto, o entrar con su propio toggle apagado? Recomendación: **toggle propio, apagado por defecto** (D-403); activar la pestaña Convergencia NO fuerza la capa de mapa (igual que Risk no auto-activa nada hasta seleccionar país). El usuario controla las capas.
- **GAP-4**: rendimiento/visual con SOLO ~10 señales no se ha validado en 375px (mobile). El panel hereda el CSS responsive de RiskPanel; se asume paridad pero debe confirmarse en el smoke (ADR-008).

## PLANNING COMPLETE
