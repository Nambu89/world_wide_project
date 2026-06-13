---
version: alpha
name: cii-scoring
description: Diseño de la primera rebanada de Fase 2 — un Composite Instability Index (CII) por país re-implementado limpio de AGPL en packages/core/cii, calculado desde el store local sobre los datos que Fase 1 realmente persiste. Re-define el blend de 4 componentes editoriales (Unrest, Conflict, Security, Information) de worldmonitor a un motor de N componentes ponderados con presencia-de-señal explícita: hoy SOLO el componente Information tiene fuente real (atención mediática financiera de gdelt_events + volumen de news_items), por lo que el CII arranca como un índice de "presión informativa por país" honesto y degradado, no como un CII-full simulado. Aporta una tabla de coeficientes editoriales PROPIA (baselineRisk/eventMultiplier re-derivada, nunca copiada), methodology_version propio (cii-core-1), persistencia time-series de snapshots CII reutilizando el patrón de ADR-004, dynamicScore (delta firmado vs snapshot de ~24h antes con deadband), endpoint /api/cii de solo-lectura del store, una capa MapLibre coroplética por-país en el config-array central, y enriquecimiento del briefing con contexto de riesgo. El motor de convergencia cross-domain sigue siendo Non-Goal (el CII es su input, no se construye aquí). Los componentes Conflict/Security/Unrest reales son phase-split detrás de los conectores keyed (ACLED/UCDP/militar) que aún no existen. El bloque estructurado (Decisions, Interfaces, Do/Don't) es normativo; la prosa explica el porqué.
status: draft
date: 2026-06-13
owner: system-architect
---

## Overview

Este documento diseña la **primera rebanada de Fase 2: CII scoring + histórico**. El problema que resuelve es dar a la plataforma su capa de **riesgo por país** —el "cerebro" de scoring que worldmonitor aporta como metodología (ADR-001)— sin copiar una sola línea de su fuente AGPL (ADR-002), y haciéndolo honesto frente a la realidad de datos: tras Fase 1 el store **solo** contiene `market_snapshots`, `gdelt_events`, `news_items`, `briefings` y `market_daily`. No hay ACLED, UCDP, sanciones, datos militares, sísmicos ni de incendios. Un "CII-full" estilo worldmonitor sobre estos datos sería un índice simulado con tres de sus cuatro componentes inventados — exactamente lo que un índice "editorial e inspeccionable" no debe hacer.

El resultado deseado es un **motor CII clean-room** en `packages/core/cii/` que (1) calcula un índice 0–100 por país desde el store, modelado como blend ponderado de N componentes con **presencia-de-señal explícita** —cada componente declara si tiene fuente o está degradado—; (2) arranca con el único componente que tiene señal real hoy, **Information** (presión informativa por país: volumen y recencia de `gdelt_events` financieros + `news_items`), dejando Unrest/Conflict/Security como componentes registrados-pero-degradados que se activan cuando aterricen sus conectores keyed; (3) persiste snapshots CII en una tabla time-series nueva reutilizando el patrón de ADR-004, con `dynamicScore` (delta firmado vs ~24h) y tendencia con deadband; (4) se expone vía `GET /api/cii` de solo-lectura del store y se pinta como **capa coroplética por país** en el config-array central de MapLibre; y (5) enriquece el briefing con un bloque de contexto de riesgo. Aporta además una **tabla de coeficientes editoriales propia** (`baselineRisk`/`eventMultiplier` re-derivada, con `methodology_version = cii-core-1`). No es código: es la especificación que el PM convierte en plan y pasa por `/check-plan` antes de implementar.

## Token-references (bloque canónico)

Cada token se define aquí como `leaf: valor`; las referencias entre llaves del resto del doc (de la forma namespace-punto-leaf) resuelven contra estas definiciones.

Paths del monorepo (existentes y nuevos):

- cii: `packages/core/cii/` — paquete nuevo del motor CII — referido como {pkg.core.cii}
- store: `packages/store/` — referido como {pkg.store}
- scheduler: `packages/scheduler/` — referido como {pkg.scheduler}
- ai: `packages/core/ai/` — referido como {pkg.core.ai}
- web: `packages/web/` — referido como {pkg.web}
- gdelt: `packages/connectors/geo/gdelt.ts` (existente) — referido como {conn.gdelt}
- news: `packages/connectors/edu/news.ts` (existente) — referido como {conn.news}
- centroids: `packages/connectors/geo/country-centroids.ts` (existente, ~65 países) — referido como {geo.centroids}
- coeffs: `packages/core/cii/coefficients.ts` — tabla editorial propia baselineRisk/eventMultiplier — referida como {cii.coeffs}
- layers: `packages/web/src/map/layers.config.ts` (config-array central existente) — referido como {web.layers.config}

Valores y decisiones compartidas:

- version: `methodology_version = 'cii-core-1'`, etiqueta de versión editorial propia que viaja con cada score — referida como {cii.methodology.version}
- scale: escala `0..100` (clamp duro) de todo componente y del compuesto — referida como {cii.scale}
- components: conjunto registrado `{ information, unrest, conflict, security }` (Information con señal hoy; resto degradado) — referido como {cii.components}
- weights: blend de pesos por componente, re-derivado y editorial — referido como {cii.weights}
- blend: fórmula compuesta `composite = baselineRisk*B_W + eventScore*E_W`, coeficientes editoriales propios — referida como {cii.blend}
- presence: bandera `signalPresent` por componente — si falsa, el componente se excluye del blend y se renormalizan los pesos — referida como {cii.presence}
- renorm: renormalización de pesos sobre los componentes con `signalPresent=true` (los pesos suman 1 sobre presentes) — referida como {cii.renorm}
- decay: time-decay de la contribución de eventos por recencia dentro de la ventana de cálculo — referida como {cii.decay}
- window: ventana de cálculo del eventScore = últimas 24h de `captured_at` en el store — referida como {cii.window}
- dynamic: `dynamicScore` = delta firmado `-100..100` del composite vs el snapshot CII de ~24h antes — referida como {cii.dynamic}
- deadband: banda muerta de ±1 punto para etiquetar tendencia (±1=stable, ≥+2=rising, ≤-2=falling) — referida como {cii.deadband}
- countrykey: clave de país canónica = nombre de país tal como aparece en {geo.centroids} (ej. `'United States'`) — referida como {cii.countrykey}
- ts: columna `captured_at` (epoch ms, INTEGER) común a las tablas time-series del store (patrón ADR-004) — referida como {schema.snapshot.ts}
- tier: tier `daily` del scheduler donde corre el cálculo CII (1×/día, junto al briefing y la retención) — referido como {sched.tier}
- timeout: `AbortSignal.timeout(8000)` patrón de conector (no aplica al CII, que lee del store; se referencia para contraste en Do/Don't) — referida como {api.connector.timeout}
- briefingctx: el bloque "contexto de riesgo geopolítico" que el CII aporta a `serializeContext` del briefing — referido como {ai.briefing.ctx}
- coroplethic: capa MapLibre `fill` por país coloreada por banda de CII, declarada en {web.layers.config} — referida como {web.cii.layer}

Variante de estado:

- `{cii.components}-degraded` = un componente registrado en {cii.components} cuyo `signalPresent=false` porque su conector keyed aún no existe (Unrest/Conflict/Security hoy); se reporta en el snapshot pero NO entra en el blend (leaf `components`, ya definido arriba).

## Goals

- **G-1**: Motor CII clean-room en {pkg.core.cii} que calcula un score {cii.scale} por país desde el store, modelado como blend {cii.blend} de N componentes {cii.components} con presencia-de-señal {cii.presence} y renormalización {cii.renorm}, sin una sola línea de fuente AGPL de worldmonitor.
- **G-2**: Componente **Information operativo hoy** desde datos reales: presión informativa por país agregando `gdelt_events` (volumen + recencia, geocode por país vía {geo.centroids}) y `news_items` (volumen + recencia) dentro de {cii.window}, con time-decay {cii.decay}.
- **G-3**: Tabla de coeficientes editoriales **propia** {cii.coeffs} (baselineRisk por país + eventMultiplier por país), re-derivada y documentada en nuestras palabras, etiquetada con {cii.methodology.version}; nunca copiada de worldmonitor.
- **G-4**: Persistencia time-series de snapshots CII en {pkg.store} (tabla nueva `cii_snapshots` reutilizando el patrón ADR-004 con {schema.snapshot.ts}), con queries de "último por país" y "tendencia por país".
- **G-5**: `dynamicScore` {cii.dynamic} (delta firmado vs snapshot de ~24h) + etiqueta de tendencia con deadband {cii.deadband}, calculados al persistir cada snapshot.
- **G-6**: Cálculo CII integrado como job del tier {sched.tier} del scheduler (lee store → calcula → persiste snapshots ANTES de servir), sin fanout en navegador.
- **G-7**: Endpoint `GET /api/cii` (+ `GET /api/cii/:country`) de **solo-lectura del store** que la web consume, y capa coroplética {web.cii.layer} declarada en {web.layers.config} (nunca imperativa).
- **G-8**: Enriquecimiento del briefing — {pkg.core.ai} consume {ai.briefing.ctx} (top países por CII + movimientos de {cii.dynamic}) desde el store para grounding del bloque de riesgo.
- **G-9**: Phase-split explícito y registrado — cada componente {cii.components}-degraded documenta qué conector keyed lo desbloquea, de modo que activarlo sea añadir una entrada, no reescribir el motor.

## Non-Goals

- **NG-1**: **Motor de convergencia cross-domain** (INVESTIGACION §9.1 / §6.5): el matching geográfico-temporal + scoring de ~21 señales que cruza finanzas+geopolítica+desastre. Razón: worldmonitor NO sirve esa lógica (corre en seed loops Railway, sólo parcialmente documentada), es la pieza de mayor riesgo del plan y exige su propio spike Research→Plan→Check. El CII es **input** de la convergencia, pero la convergencia NO se construye aquí. Confirmado como NG ya en el MVP.
- **NG-2**: **Componentes Conflict, Security y Unrest con señal real**. Razón: requieren conectores keyed que el store aún NO tiene (Conflict→ACLED/UCDP; Security→datos militares/aviación/GPS-jam; Unrest→ACLED protest events / displacement). Se diseñan como componentes registrados-pero-degradados {cii.components}-degraded; su activación es phase-split (ver Decisions D-110 y Known Gaps).
- **NG-3**: **Boosts severity-weighted de worldmonitor** (earthquakeBoost, sanctionsBoost, cyberBoost, fireBoost, AIS-disruption, displacement log-ramp). Razón: ninguna de esas fuentes existe en el store (no hay USGS, OFAC, FIRMS, AIS). Diseñar los boosts ahora sería especular sobre fuentes ausentes; se difieren a las rebanadas que aterricen cada fuente.
- **NG-4**: **Strategic Risk roll-up / bandas estratégicas derivadas** como artefacto separado. Razón: el roll-up de worldmonitor presupone el CII-full con sus 4 componentes activos; con un solo componente activo el roll-up no añade información sobre el propio CII. Las **bandas de color** del mapa sí se definen aquí (son render, no un segundo índice).
- **NG-5**: **Reverse-geocode preciso de eventos GDELT a país por coordenada**. Razón: `gdelt_events` ya guarda el centroide del país-fuente (`sourcecountry`), no la coordenada real del evento; el país se deriva del centroide/sourcecountry, no de un point-in-polygon. Mejorar la geocodificación pertenece a la rebanada del conector, no al motor CII.
- **NG-6**: **Conectores nuevos con key** (ACLED, UCDP, OFAC, FRED, EIA, militar). Razón: zero-key-first; esta rebanada NO añade conectores, solo consume lo ya persistido. Los conectores keyed son rebanadas Fase 2 posteriores e independientes.
- **NG-7**: **Backfill histórico de CII anterior a la primera ejecución**. Razón: el CII se calcula desde snapshots del store; no existe histórico GDELT/news previo a Fase 1. La serie CII empieza vacía y crece desde el primer job; el `dynamicScore` queda neutro hasta tener ≥2 snapshots separados ~24h.

## Context / Constraints

- **Datos reales del store (verificado en código a 2026-06-13)** — restricción dominante de este diseño:
  - Tablas existentes: `market_snapshots`, `gdelt_events`, `news_items`, `briefings`, `market_daily`, `_migrations`. Nada más.
  - `gdelt_events` **NO tiene columna country**; tiene `lat/lon` = **centroide del país-fuente** (`sourcecountry`, el país del MEDIO que publica), geocodeado vía {geo.centroids} (~65 países). El país se re-deriva del centroide/sourcecountry, no de la coordenada del evento.
  - `gdelt_events.category` en la práctica = `domain` del medio (ej. "reuters.com") o `sourcecountry` como fallback. **NO es taxonomía unrest/conflict/political** pese al comentario del schema.
  - `gdelt_events.severity` = **siempre null** (la DOC 2.0 artlist no da tono/Goldstein).
  - El query GDELT es **financiero** (economy/market/finance/inflation/"central bank"), 24h, ≤75 artículos. Es **señal de atención mediática financiera por país-fuente**, NO señal de conflicto.
  - `news_items` tiene `feed_domain`, `title`, `url`, `published_at`, `captured_at`. Sin país ni categoría.
- **Stack bloqueado** (ADR-003): TypeScript, monorepo pnpm, Vite, React + MapLibre GL, Node single-server (`server.ts`), router LLM.
- **Persistencia bloqueada** (ADR-006): `@libsql/client`, `url: file:./data/world.db`. Prohibido `better-sqlite3`. La UI lee del store, nunca de upstream (ADR-004).
- **IA bloqueada** (ADR-009): proveedor activo del router = **openai** (`OPENAI_API_KEY`/`OPENAI_MODEL`); claude/groq/ollama como ramas inactivas. El CII enriquece el briefing existente, no añade un nuevo modelo.
- **Licencia (ADR-002, feedback_no_agpl_copy)**: worldmonitor = AGPL-3.0; sólo metodología re-implementada en nuestras palabras, NUNCA copiar fuente, pesos verbatim, ni texto del doc editorial. osiris = MIT (copiable).
- **Datos ≠ licencia (feedback_data_tos)**: GDELT = público/keyless (ToS permisivo); cada RSS con su licencia (ya gobernado en la rebanada news). El CII no añade fuentes upstream → no añade ToS nuevos.
- **Capas de mapa (feedback_central_layer_config / ADR-008)**: capas declaradas en {web.layers.config}; UI responsive mobile-first.
- **Entorno**: Windows (win32). El CII es TypeScript puro sobre el store (sin binarios nativos nuevos) → riesgo toolchain bajo; depende del `@libsql/client` ya validado en Fase 1.
- **Naturaleza editorial del índice (de la metodología worldmonitor)**: el CII es un índice **editorial e inspeccionable** (opiniones razonadas con coeficientes visibles), NO un índice académico validado. Cada score debe ser explicable componente a componente y llevar su {cii.methodology.version}. Con un solo componente activo, esta inspeccionabilidad es lo que evita que el índice mienta sobre su propia cobertura.

## Decisions

> Las decisiones **bloqueadas** (no-negociables) heredan de los ADRs base y de `memory/feedback_*.md`; el ADR fuente se cita una vez. Las decisiones **internas abiertas** (numeradas desde el centenar) son recomendación del arquitecto; el PM decide (alternativas/tradeoffs en Interfaces y Known Gaps). Cada `D-NNN` aparece una sola vez; el resto del doc se refiere por contenido o token.

Bloqueadas (no-negociables):

- **D-001** (ADR-002 / feedback_no_agpl_copy): el motor CII, sus pesos {cii.weights}, la tabla {cii.coeffs} y la fórmula {cii.blend} se **re-implementan desde metodología documentada en nuestras palabras** — porque copiar fuente, pesos verbatim o texto del doc editorial de worldmonitor (AGPL-3.0) convierte el programa en obra derivada AGPL (§13). Las fórmulas/ideas no son copyrightables; el código y el texto sí.
- **D-002** (ADR-004): el cálculo CII corre **server-side en el scheduler**, persiste snapshots en el store y la UI lee del store, nunca recalcula en el navegador — porque desacopla el índice de la pestaña abierta y habilita el histórico (el diferencial del proyecto).
- **D-003** (ADR-006): la persistencia CII usa `@libsql/client` sobre `file:./data/world.db` con el mismo patrón time-series ({schema.snapshot.ts} epoch ms) — porque libSQL es Turso (migrar = cambiar URL) y mantiene un único motor de persistencia.
- **D-004** (ADR-003 / feedback_central_layer_config): la capa CII del mapa {web.cii.layer} se declara como entrada en {web.layers.config}, iterada por el render, nunca `map.on('load')` imperativo — porque corrige la debilidad de osiris (capas dispersas) y el `verifier` comprueba este wiring.
- **D-005** (ADR-009): el CII **no introduce un proveedor LLM nuevo**; enriquece el briefing existente vía {ai.briefing.ctx} usando la rama activa openai del router — porque el router es multi-proveedor pero la rebanada CII no es el lugar para cambiar proveedor.

Internas (recomendación del arquitecto; el PM decide):

- **D-100**: el CII se modela como **motor de N componentes con registro explícito** {cii.components}, cada uno con `signalPresent` {cii.presence}; los pesos {cii.weights} se **renormalizan** {cii.renorm} sobre los componentes presentes — porque la realidad de datos (solo Information tiene fuente) exige un índice que NO simule componentes ausentes: un CII de 1 componente presente es un CII de Information renormalizado a 100%, honesto e inspeccionable, y añadir Conflict mañana es poner `signalPresent=true` sin reescribir el blend. Alternativa: hardcodear el blend 4-componentes worldmonitor y rellenar los ausentes con baselineRisk constante (descartada: inventa señal y hace el índice no-inspeccionable). Ver Known Gaps OQ-1.
- **D-101**: {cii.methodology.version} = **`'cii-core-1'`**, versión editorial propia distinta de la `v8` de worldmonitor — porque señala que es nuestra re-implementación con nuestra cobertura (1 componente activo), no una copia de su v8 (4 componentes), y permite versionar cuando activemos componentes. Cada fila de `cii_snapshots` la lleva.
- **D-102**: la **clave de país** {cii.countrykey} es el nombre de país de {geo.centroids} (ej. `'United States'`) — porque es la única clave de país que el store ya produce (GDELT geocodea por `sourcecountry` contra ese mapa) y evita introducir un esquema ISO-3166 nuevo en esta rebanada. Alternativa: ISO alpha-2/3 (descartada aquí: obligaría a mapear sourcecountry→ISO, trabajo del conector, no del motor). Ver Known Gaps OQ-2.
- **D-103**: el **componente Information** se calcula como `informationScore = clamp0_100( gdeltSubscore*GW + newsSubscore*NW )` donde `gdeltSubscore` es función log-escalada del **conteo time-decayed** de `gdelt_events` por país en {cii.window}, y `newsSubscore` ídem de `news_items` (global, sin país — ver D-104) — porque el único dato real es **volumen y recencia de atención mediática**; modelarlo como "presión informativa" es honesto (no pretende medir conflicto). La log-escala evita que un país muy cubierto sature; el time-decay {cii.decay} prioriza eventos recientes dentro de la ventana. Ver Interfaces para la forma exacta y Known Gaps OQ-3 para GW/NW.
- **D-104**: `news_items` **no tiene país** → su subscore contribuye como **señal global de "temperatura informativa financiera"** que modula el baseline de todos los países por igual (un multiplicador suave), NO como señal por-país — porque atribuir noticias sin país a un país concreto sería inventar geografía. Alternativa: NER de país sobre `title` (descartada en esta rebanada: requiere ML/ONNX que es Fase 3-4 y añade dependencia). Ver Known Gaps OQ-4.
- **D-105**: {cii.blend} = `composite = clamp0_100( baselineRisk*B_W + eventScore*E_W )` con coeficientes editoriales propios **B_W=0.4, E_W=0.6** y `eventScore` = blend renormalizado {cii.renorm} de los componentes presentes — porque refleja la idea metodológica (un suelo estructural por país + una capa dinámica de eventos que pesa más) re-derivada en nuestros propios coeficientes, y mantiene el índice estable cuando no hay eventos (cae a `baselineRisk*0.4` + el evento renormalizado). Alternativa: 0.5/0.5 (descartada: queremos que el movimiento de eventos domine para que el índice sea reactivo). Ver Known Gaps OQ-5.
- **D-106**: {cii.coeffs} = una tabla **propia y pequeña** `{ [country]: { baselineRisk, eventMultiplier } }` re-derivada por nosotros para los ~65 países de {geo.centroids}, con un **default editorial** `{ baselineRisk: 30, eventMultiplier: 1.0 }` para países sin entrada — porque worldmonitor usa una tabla editorial análoga (no copiable) y necesitamos coeficientes propios; el default evita que un país desconocido rompa el cálculo. Los valores son inspeccionables y ajustables en un único fichero. Ver Known Gaps OQ-6 para la derivación de valores.
- **D-107**: la persistencia CII usa una tabla nueva **`cii_snapshots`** (wide-tipada, una fila por país por cálculo) más una columna JSON `components_json` con el desglose por componente — porque las columnas tipadas (`country`, `composite`, `dynamic_score`, `trend`, {schema.snapshot.ts}) dan índices/queries directos para "último por país" y "tendencia", y el desglose por componente es de forma variable (crece al activar componentes) → JSON es el sitio correcto para él sin migrar el schema cada vez. Coherente con el patrón wide-tipado del MVP (la excepción JSON es solo el desglose explicativo). Ver Interfaces.
- **D-108**: {cii.dynamic} se calcula al persistir: `dynamicScore = clamp(-100,100, composite_now - composite_~24h)`, buscando el snapshot CII del mismo país más cercano a `now - 24h`; si no existe (serie nueva) `dynamicScore = 0` y `trend = 'stable'` — porque replica la metodología del delta-firmado-vs-24h de forma re-derivada, y el caso "serie nueva" debe ser neutro (NG-7), no un falso movimiento.
- **D-109**: la **tendencia** {cii.deadband} se etiqueta con banda muerta: `|dynamic| <= 1 → 'stable'`, `dynamic >= +2 → 'rising'`, `dynamic <= -2 → 'falling'` (el rango (1,2) se trata como el primer escalón de rising/falling) — porque un deadband evita parpadeo de etiqueta por ruido de ±1 punto, re-implementando la idea del deadband editorial en nuestros umbrales.
- **D-110**: cada componente {cii.components}-degraded lleva en {cii.coeffs}/el registro de componentes un campo **`unlockedBy`** (texto: el conector keyed que lo activará, ej. `'connectors/geo/acled.ts'`) y arranca con `signalPresent=false` — porque hace el phase-split **dato del propio código** (auto-documentado) en vez de una nota suelta: activar Conflict = aterrizar su conector y poner `signalPresent=true`, sin tocar el blend.
- **D-111**: el cálculo CII corre en el tier {sched.tier} (`daily`, 1×/día) junto al briefing y la retención — porque la señal informativa por país no cambia a escala de minutos, el coste es leer el store (barato) y agruparlo con el briefing mantiene un único job pesado diario. Alternativa: tier propio `medium` (descartada: sobre-frecuencia para una señal diaria; reconsiderable al activar Conflict, que sí es más volátil). Ver Known Gaps OQ-7.
- **D-112**: `GET /api/cii` devuelve **el último snapshot por país** (no recalcula on-request); `GET /api/cii/:country` devuelve la **tendencia** del país desde el store — porque honra "la API es solo-lectura del store" (ADR-004) y el cálculo vive solo en el job del scheduler; un request nunca dispara el motor. La capa del mapa consume `/api/cii`.

## Interfaces / Data Contracts

> Firmas y schema **normativos**. Tipos en pseudo-TS; el implementador los traduce. Los nombres de columna son contractuales (referenciados por tokens). Ningún valor, peso o texto procede de fuente AGPL: todo es re-derivado.

Tipos del dominio CII ({pkg.core.cii}):

```ts
// {cii.scale} = 0..100 con clamp duro en todo punto.
type CiiComponentKey = 'information' | 'unrest' | 'conflict' | 'security'; // {cii.components}

interface CiiComponent {
  key: CiiComponentKey;
  score: number;            // 0..100; 0 si !signalPresent
  signalPresent: boolean;   // {cii.presence}; false => excluido del blend, renormaliza {cii.renorm}
  weight: number;           // peso EDITORIAL nominal antes de renormalizar ({cii.weights})
  unlockedBy: string | null;// {cii.components}-degraded: conector keyed que lo activará (D-110)
  detail?: string;          // explicación inspeccionable corta (ej. "23 eventos, recencia 0.7")
}

interface CiiScore {
  country: string;          // {cii.countrykey}: nombre de país de {geo.centroids}
  composite: number;        // {cii.scale}, resultado de {cii.blend}
  baselineRisk: number;     // de {cii.coeffs}
  eventScore: number;       // blend renormalizado de componentes presentes (0..100)
  components: CiiComponent[];// desglose inspeccionable -> serializado a components_json
  methodologyVersion: string;// {cii.methodology.version} = 'cii-core-1'
  capturedAt: number;       // {schema.snapshot.ts} epoch ms
}

interface CiiDynamic {
  country: string;
  dynamicScore: number;     // {cii.dynamic} -100..100
  trend: 'rising' | 'falling' | 'stable'; // {cii.deadband}
}
```

Coeficientes editoriales propios {cii.coeffs} (`packages/core/cii/coefficients.ts`):

```ts
// Tabla PROPIA, re-derivada (NO copiada de worldmonitor). Valores inspeccionables/ajustables.
interface CountryCoeff {
  baselineRisk: number;     // 0..100, suelo estructural editorial del país
  eventMultiplier: number;  // factor sobre la contribución de eventos del país (default 1.0)
}
export const COUNTRY_COEFFS: Record<string, CountryCoeff>;        // ~65 países de {geo.centroids}
export const DEFAULT_COEFF: CountryCoeff;                         // { baselineRisk: 30, eventMultiplier: 1.0 } (D-106)

// Registro de componentes: pesos editoriales nominales + phase-split (D-110).
// Information ACTIVO hoy; resto degradado (signalPresent se decide en runtime por presencia de datos).
export const COMPONENT_REGISTRY: Array<{
  key: CiiComponentKey;
  weight: number;           // {cii.weights} nominal; renormaliza {cii.renorm} sobre presentes
  unlockedBy: string | null;// null si activo hoy (information); path del conector keyed si degraded
}>;
// Ejemplo de pesos nominales editoriales propios (ajustables): information 0.25, unrest 0.25,
// conflict 0.30, security 0.20. Con solo information presente -> renormaliza a 1.0 (D-100).
```

Motor de cálculo ({pkg.core.cii}, API pública):

```ts
// Lee del STORE (no de upstream). Puro respecto a I/O salvo las lecturas del store inyectadas.
// {cii.window} = últimas 24h; {cii.decay} = peso por recencia dentro de la ventana.

// Information operativo (D-103/D-104):
export function computeInformationComponent(
  gdeltByCountry: Map<string, GdeltEvent[]>,  // agrupado por {cii.countrykey} desde {geo.centroids}
  globalNewsTemp: number,                      // 0..1 temperatura informativa global (D-104)
): Map<string, CiiComponent>;

// Blend + baseline + renormalización (D-105/D-100):
export function computeCii(
  country: string,
  components: CiiComponent[],
  coeff: CountryCoeff,
  methodologyVersion: string,
  capturedAt: number,
): CiiScore;

// Orquestador del job (lee store, agrupa, calcula, devuelve snapshots a persistir):
export async function computeAllCountries(nowMs: number): Promise<CiiScore[]>;

// dynamicScore + trend (D-108/D-109), calculado contra el snapshot ~24h previo del store:
export function computeDynamic(current: CiiScore, prior: CiiScore | null): CiiDynamic;
```

Agrupación por país (helper, deriva país desde el centroide ya guardado — NG-5):

```ts
// gdelt_events guarda lat/lon = centroide de {geo.centroids}. Invertir centroide->país por
// igualdad exacta de (lat,lon) contra {geo.centroids}, o re-derivar de sourcecountry si se
// reintroduce. Eventos sin país (lat/lon null) se descartan del CII (no atribuibles).
export function groupGdeltByCountry(events: GdeltEvent[]): Map<string, GdeltEvent[]>;
```

Store — nuevas estructuras time-series ({pkg.store}, migración `002_cii.sql`):

```sql
-- Snapshots de CII (tier daily). Una fila por país por cálculo. Patrón ADR-004.
CREATE TABLE IF NOT EXISTS cii_snapshots (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  country            TEXT    NOT NULL,        -- {cii.countrykey}
  composite          REAL    NOT NULL,        -- {cii.scale}
  baseline_risk      REAL    NOT NULL,
  event_score        REAL    NOT NULL,
  dynamic_score      REAL,                    -- {cii.dynamic}; null en serie nueva (D-108)
  trend              TEXT,                    -- 'rising'|'falling'|'stable' {cii.deadband}
  methodology_version TEXT   NOT NULL,        -- {cii.methodology.version}
  components_json    TEXT    NOT NULL,        -- desglose CiiComponent[] inspeccionable (D-107)
  captured_at        INTEGER NOT NULL         -- {schema.snapshot.ts} epoch ms
);
CREATE INDEX IF NOT EXISTS ix_cii_trend
  ON cii_snapshots (country, captured_at);    -- "último por país" + "tendencia por país"
```

Store — API nueva ({pkg.store}, añade a `index.ts`, NO reescribe lo existente):

```ts
export async function insertCiiSnapshots(rows: CiiSnapshotRow[]): Promise<void>;
export async function getLatestCii(): Promise<CiiSnapshotRow[]>;                 // último por país
export async function getCiiTrend(country: string, sinceMs: number): Promise<CiiSnapshotRow[]>;
export async function getPriorCii(country: string, aroundMs: number): Promise<CiiSnapshotRow | null>; // ~24h antes (D-108)
// purgeAndDownsample (existente) se EXTIENDE para purgar cii_snapshots > retención (D-107 sigue ADR-004).
```

Scheduler ({pkg.scheduler}) — job CII en el tier daily {sched.tier}:

```ts
// Nuevo Job tier 'daily' (D-111). Invariante: persiste ANTES de servir (ADR-004).
// run(): computeAllCountries(now) -> por país computeDynamic(current, getPriorCii) -> insertCiiSnapshots
// Se registra junto a los jobs daily existentes (briefing + purgeAndDownsample). No fanout en navegador.
```

server.ts — endpoints nuevos (solo-lectura del store, D-112):

```ts
GET /api/cii            -> getLatestCii()              // alimenta la capa coroplética del mapa
GET /api/cii/:country   -> getCiiTrend(country, since) // serie histórica para panel/sparkline
// Mismo pipeline de middleware existente (origin-check -> CORS -> rate-limit -> route).
// NUNCA dispara el motor CII on-request (el cálculo vive solo en el job daily).
```

Web ({pkg.web}) — capa coroplética {web.cii.layer} en {web.layers.config}:

```ts
// Entrada NUEVA en el config-array existente (D-004). El render itera LAYERS; añadir capa = añadir entrada.
// Fuente: GeoJSON de países (o markers por centroide de {geo.centroids} si no hay polígonos) coloreado
// por banda de composite. Bandas editoriales propias (NG-4: render, no índice):
//   0-24 bajo, 25-49 moderado, 50-69 elevado, 70-100 alto.
{
  id: 'cii-choropleth',
  source: 'cii-countries',
  type: 'fill',                       // 'circle' por centroide si no hay polígonos de país
  paint: { /* fill-color por step de composite; bandas arriba */ },
  visibleWhen: (active) => active.has('cii'),
}
// El panel de riesgo (responsive, ADR-008) lista top países por composite + flecha de trend {cii.dynamic},
// con estados loading/empty/error; lee /api/cii y /api/cii/:country del store.
```

Briefing — enriquecimiento {ai.briefing.ctx} ({pkg.core.ai}):

```ts
// serializeContext (existente) gana un bloque de riesgo construido desde el STORE (getLatestCii):
//   "Top N países por CII (composite) y sus movimientos de 24h (dynamicScore/trend)."
// El bloque es contexto grounded para el briefing existente; NO añade una llamada LLM nueva ni
// cambia de proveedor (D-005). Si cii_snapshots está vacío (serie nueva), el bloque se omite.
export function buildRiskContext(latest: CiiSnapshotRow[]): string; // '' si vacío
```

## Do's and Don'ts

- **DO**: calcula el CII en el job del scheduler y persiste cada `cii_snapshots` ANTES de exponerlo por la API — porque la UI lee de la DB local (ADR-004) y el índice debe sobrevivir a reinicios y a fuentes caídas.
- **DO**: marca `signalPresent=false` y renormaliza {cii.renorm} cuando un componente no tiene fuente, y reporta su `unlockedBy` — porque un índice editorial debe ser honesto sobre su cobertura; un componente ausente NUNCA se rellena con un valor inventado.
- **DO**: re-deriva todos los pesos {cii.weights}, coeficientes {cii.coeffs} y umbrales {cii.deadband} en nuestros propios valores y documenta el porqué en {cii.coeffs} — porque feedback_no_agpl_copy: la metodología es re-implementable, los pesos verbatim y el texto del doc de worldmonitor no.
- **DO**: etiqueta cada score con {cii.methodology.version} = 'cii-core-1' — porque el índice es editorial y versionado; cuando se active un componente, sube la versión y la serie histórica sigue siendo interpretable.
- **DO**: declara la capa CII como una entrada en {web.layers.config} y haz que el render la itere — porque feedback_central_layer_config y el `verifier` comprueban este wiring (no `map.on('load')` imperativo).
- **DO**: deriva el país desde el centroide ya guardado en `gdelt_events` (igualdad contra {geo.centroids}); descarta eventos sin país (lat/lon null) del CII — porque atribuir un evento sin país a un país concreto inventaría geografía (NG-5).
- **DON'T**: NO copies fuente, pesos verbatim ni texto del doc editorial de worldmonitor (CII v8) — porque es AGPL-3.0 y volvería el programa obra derivada (§13); re-implementa en nuestras palabras (D-001).
- **DON'T**: NO modeles Conflict/Security/Unrest con datos inventados ni con el GDELT financiero actual como si fuera señal de conflicto — porque el GDELT actual es atención mediática financiera por país-fuente, NO conflicto (Context); usarlo así produciría un CII que miente. Esos componentes quedan degradados hasta su conector keyed (NG-2, D-110).
- **DON'T**: NO dispares el motor CII en cada request de `/api/cii` — porque el cálculo vive solo en el job daily; la API es solo-lectura del store (D-112). Un request que recalcula rompe el invariante de ADR-004.
- **DON'T**: NO atribuyas `news_items` (sin país) a un país concreto — porque no tienen geografía; entran como temperatura informativa global que modula el baseline (D-104), no como señal por-país.
- **DON'T**: NO introduzcas un proveedor LLM nuevo ni una segunda llamada en el briefing por el CII — porque D-005: el CII solo añade contexto grounded al briefing existente con la rama activa openai.
- **DON'T**: NO añadas conectores con key en esta rebanada — porque NG-6/zero-key-first: esta rebanada solo consume lo persistido; ACLED/UCDP/OFAC son rebanadas independientes posteriores.

## Risks

- **R-1 (CII data-starved — el riesgo central)**: con un solo componente activo (Information), el CII es esencialmente un índice de presión mediática financiera por país, no un índice de inestabilidad real. **Mitigación**: el diseño lo hace explícito (`signalPresent`, `unlockedBy`, {cii.methodology.version}='cii-core-1', `detail` por componente, bandas de render honestas); la UI y el briefing deben presentar el CII como "presión informativa" hasta activar Conflict/Security/Unrest. Riesgo residual: que un consumidor lo interprete como CII-full. Ver Known Gaps.
- **R-2 (sesgo de país-fuente en GDELT)**: el "país" del evento es el país del MEDIO (`sourcecountry`), no el país del suceso → EE.UU./Reino Unido (medios anglófonos prolíficos) saldrán inflados. **Mitigación**: la log-escala {cii.decay}/D-103 amortigua el volumen; `eventMultiplier` por país en {cii.coeffs} puede corregir editorialmente; documentar el sesgo en `detail`. Corrección real = geocodificación por evento, que es phase-split del conector (NG-5).
- **R-3 (cobertura de países limitada)**: {geo.centroids} tiene ~65 países; eventos de países fuera del mapa ya llegan con lat/lon null y se descartan del CII. **Mitigación**: aceptable para esta rebanada (los ~65 cubren las economías relevantes); ampliar el mapa es trabajo del conector. Países sin coeficiente usan DEFAULT_COEFF (D-106).
- **R-4 (serie histórica arranca vacía)**: `dynamicScore`/trend son neutros hasta tener ≥2 snapshots separados ~24h (NG-7). **Mitigación**: D-108 fuerza `dynamicScore=0`/`trend='stable'` en serie nueva; la UI muestra "sin tendencia aún" en vez de un falso 0-movimiento. Tras ~2 días la tendencia es real.
- **R-5 (crecimiento de cii_snapshots)**: una fila por país por día (~65/día) es pequeño, pero crece sin purga. **Mitigación**: extender `purgeAndDownsample` para purgar `cii_snapshots` con la misma retención ADR-004; el volumen diario es órdenes de magnitud menor que market_snapshots.
- **R-6 (deriva AGPL al re-derivar coeficientes)**: un implementador podría copiar los pesos 0.25/0.30/0.20/0.25 o el texto del doc editorial de worldmonitor. **Mitigación**: D-001/Do-Don't; los pesos de este doc son **propios y ajustables** (información-céntricos, no los de v8); el `codebase-navigator` marca el material AGPL como solo-referencia; el `verifier` revisa.
- **R-7 (geocode inverso frágil por igualdad de coordenadas)**: agrupar por país comparando (lat,lon) exactos contra {geo.centroids} es frágil si el conector cambia la precisión de los centroides. **Mitigación**: preferir re-derivar el país desde `sourcecountry` si el conector lo expone; si no, igualdad exacta funciona porque el conector usa los MISMOS centroides. Anotado como acoplamiento conector↔CII en Known Gaps.

## Iteration Guide

- Trabaja **UNA pieza a la vez** (la migración del store, el motor, el job, el endpoint, la capa, el briefing). Cobertura parcial de un flujo es peor que un flujo cerrado.
- Refiere componentes y valores por su **token** ({cii.blend}, {cii.components}, {web.layers.config}, {schema.snapshot.ts}) — no repitas el valor literal ni re-cites un `D-NNN` por número (cada id se define una vez; refiérete a su contenido).
- Sigue el **orden de implementación sugerido** (abajo): el motor no puede persistir sin la tabla; la API no sirve sin la tabla; la capa no pinta sin la API.
- Añade variantes nuevas como **entradas separadas**: un componente nuevo = una entrada en `COMPONENT_REGISTRY` con su `unlockedBy` + poner `signalPresent=true`; una capa nueva = una entrada en {web.layers.config}; una query nueva = una función nueva en {pkg.store} (NO reescribir las existentes).
- Tras cada edición de este doc, deja que `spec-validator.js` valide el schema (front-matter + secciones en orden + ≥1 Non-Goal + sin token colgante + IDs únicos).
- Cierra cada flujo de punta a punta antes de pasar al siguiente; el `verifier` comprueba wiring real (motor→store, job→scheduler, capa en config-array, panel importado, ruta en `server.ts`, bloque de riesgo en el briefing).
- Si una decisión interna entra en conflicto con un descubrimiento de implementación (ej. el geocode inverso no funciona), **no la reescribas silenciosamente**: el implementador para y reporta; el cambio vuelve al PM (puede generar un ADR).

Secuencia de implementación sugerida (input del plan del PM — el PM escribe el plan). Grafo de dependencias (→ = "depende de / debe existir antes"):

1. **Migración `002_cii.sql` + tipos + API del store** ({pkg.store}): tabla `cii_snapshots`, `CiiSnapshotRow`, `insertCiiSnapshots`/`getLatestCii`/`getCiiTrend`/`getPriorCii`, extensión de `purgeAndDownsample`. Bloquea todo lo demás (motor, job, API leen/escriben aquí).
2. **Tabla de coeficientes {cii.coeffs}** (`coefficients.ts`): `COUNTRY_COEFFS` propios, `DEFAULT_COEFF`, `COMPONENT_REGISTRY` con `unlockedBy`. Independiente; puede ir en paralelo a (1). Es donde se materializa el phase-split (D-110).
3. **Motor {pkg.core.cii}**: `groupGdeltByCountry`, `computeInformationComponent`, `computeCii`, `computeDynamic`, `computeAllCountries`. Depende de (1) (lee store, tipos) y (2) (coeficientes). Es el núcleo; testeable con datos del store sembrados.
4. **Job del scheduler** ({pkg.scheduler}) en el tier daily: orquesta (3)→(1). Depende de (1) y (3).
5. **Endpoints en `server.ts`**: `/api/cii`, `/api/cii/:country`. Dependen de (1). **Fichero de alto conflicto** → serializar el toque del registro de rutas.
6. **Capa coroplética {web.cii.layer} + panel de riesgo** ({pkg.web}): entrada en {web.layers.config} + panel responsive. Depende de (5) (consume la API); puede avanzar contra mock mientras (5) madura.
7. **Enriquecimiento del briefing** ({ai.briefing.ctx} en {pkg.core.ai}): `buildRiskContext` + inserción en `serializeContext`. Depende de (1) (lee getLatestCii). Independiente de (6).

Orden serial seguro para un solo dev: 1 → 2 (paralelo) → 3 → 4 → 5 → (6 y 7 en paralelo). Ficheros de alto conflicto a serializar: `server.ts`, {web.layers.config}, las migraciones del store, el `index.ts` del store.

Diagrama de flujo de datos (texto/ASCII):

```
        store (ya poblado por Fase 1)
   gdelt_events    news_items    market_snapshots
   (centroide       (sin país)     (contexto, no CII)
    país-fuente)        |
        |               |
        v               v
   groupGdeltByCountry  globalNewsTemp        <- {cii.window} (24h) + {cii.decay} (recencia)
        |               |
        v               v
   +----------------------------------+
   |        {pkg.core.cii}            |   computeInformationComponent (D-103/104)
   |  components[] + signalPresent    |   -> {cii.renorm} sobre presentes (D-100)
   |  computeCii: {cii.blend}         |   composite = baselineRisk*0.4 + eventScore*0.6 (D-105)
   |  + {cii.coeffs} (propios)        |   methodologyVersion = 'cii-core-1' (D-101)
   |  computeDynamic vs ~24h          |   {cii.dynamic} + {cii.deadband} (D-108/109)
   +----------------+-----------------+
                    | persiste ANTES de servir (ADR-004)
                    v
   +----------------------------------+
   |          {pkg.store}             |  cii_snapshots (time-series, ix_cii_trend)
   |  insertCiiSnapshots / getLatest  |  <-- corre en tier daily {sched.tier} junto a
   |  getCiiTrend / getPriorCii       |      briefing + purgeAndDownsample (D-111)
   +----------------+-----------------+
        |  solo-lectura del store          \  getLatestCii
        v  (D-112)                          v
   +------------------------+        +--------------------------+
   |       server.ts        |        |     {pkg.core.ai}        |
   |  GET /api/cii          |        |  buildRiskContext ->     |
   |  GET /api/cii/:country |        |  serializeContext (D-005)|
   +-----------+------------+        +--------------------------+
               | HTTP (la web NUNCA recalcula)
               v
   +----------------------------------+
   |            {pkg.web}             |  {web.cii.layer} coroplética en {web.layers.config}
   |  panel de riesgo (responsive):   |  bandas 0-24/25-49/50-69/70-100 (render, NG-4)
   |  top países + flecha de trend    |  estados loading/empty/error
   +----------------------------------+
```

## Known Gaps / Open Questions

> Lo que este diseño NO resuelve y las decisiones internas que el PM debe ratificar. Evita confianza alucinada.

Fuera de esta rebanada (con razón) y **phase-split por datos** (qué fuente desbloquea qué componente):

- **GAP-1 — Componente Conflict**: requiere **ACLED y/o UCDP** (eventos de conflicto geocodificados + muertes). Desbloquea floors UCDP (war ≥1000 muertes o >100 eventos/2 años → floor editorial; minor >10 eventos → floor menor), curva log-escalada con cap y pivot, y time-decay ACLED. Marcado `unlockedBy='connectors/geo/acled.ts'` / `ucdp.ts`. **Fuera hasta que esos conectores keyed existan** (NG-2/NG-6).
- **GAP-2 — Componente Security**: requiere **datos militares/aviación/GPS-jam** (vuelos/buques militares, disrupciones de aviación, jamming GPS). No hay fuente en el store. Marcado `unlockedBy` = conector(es) correspondiente(s). Fuera hasta entonces.
- **GAP-3 — Componente Unrest**: requiere señal de **protesta/disturbios/displacement** (ACLED protest events; displacement). El GDELT financiero actual NO sirve para esto (Context). Fuera hasta su conector.
- **GAP-4 — Boosts severity-weighted**: earthquake (USGS), sanctions (OFAC/OpenSanctions), cyber, fire (NASA FIRMS), AIS-disruption, displacement log-ramp. Ninguna fuente existe. Cada boost es phase-split de la rebanada que aterrice su fuente (NG-3).
- **GAP-5 — Motor de convergencia cross-domain (INVESTIGACION §9.1)**: el CII es **input** de la convergencia, pero el matching geográfico-temporal + scoring de señales NO se construye aquí (NG-1). Sigue siendo el spike de mayor riesgo, pendiente de su propio Research→Plan→Check.
- **GAP-6 — Geocodificación por evento en GDELT**: hoy el país es el del medio (`sourcecountry`), no el del suceso (R-2/NG-5). Corregirlo (point-in-polygon o NER de localización) es trabajo del conector GDELT, no del motor CII.
- **GAP-7 — Acceso al doc editorial de worldmonitor**: el resumen de metodología de partida es license-clean; el doc completo (`cii-risk-scores.mdx`) NO se ha consultado en esta sesión para evitar contaminación AGPL accidental y porque el resumen + INVESTIGACION-FUSION bastan para re-derivar el motor. Si el PM quiere validar curvas/floors exactos para GAP-1, hágalo como **referencia de metodología** (nunca copiar texto) en la rebanada de Conflict, no aquí.

Open Questions (decisiones internas a ratificar por el PM):

- **OQ-1 (modelo N-componentes)**: ¿motor N-componentes con presencia+renormalización (recomendado, D-100) vs blend 4-componentes fijo con ausentes rellenados? Recomendación: N-componentes (honesto, extensible). Bloquea la forma del motor.
- **OQ-2 (clave de país)**: ¿nombre de país de {geo.centroids} (recomendado, D-102) vs ISO-3166? Recomendación: nombre de país por ahora; migrar a ISO cuando un conector keyed lo imponga. Afecta a todas las queries y a la capa del mapa.
- **OQ-3 (pesos gdelt vs news en Information, GW/NW)**: la mezcla exacta del subscore gdelt y news dentro de Information (D-103) está esbozada, no congelada. Conviene una iteración con `intel-analyst` para fijar GW/NW y la forma de la log-escala/decay.
- **OQ-4 (news sin país)**: ¿news como temperatura global que modula baseline (recomendado, D-104) vs intentar NER de país? Recomendación: temperatura global; NER es Fase 3-4 (ONNX).
- **OQ-5 (coeficientes del blend B_W/E_W)**: ¿0.4/0.6 (recomendado, D-105) vs 0.5/0.5? Recomendación: 0.4/0.6 (más reactivo a eventos). Ajustable en un único punto.
- **OQ-6 (derivación de baselineRisk/eventMultiplier por país)**: los valores concretos de {cii.coeffs} para ~65 países deben **derivarse editorialmente por nosotros** (no copiarse). Falta la sesión de derivación (candidata para `intel-analyst`): qué señales públicas (estabilidad histórica, etc.) informan el baseline, documentadas en {cii.coeffs}. Hasta entonces, un baseline plano + DEFAULT_COEFF es un punto de partida honesto pero plano.
- **OQ-7 (tier del job CII)**: ¿tier daily (recomendado, D-111) vs medium? Recomendación: daily ahora; reconsiderar a medium cuando se active Conflict (más volátil).
- **OQ-8 (geometría de la capa)**: ¿fill coroplético con GeoJSON de polígonos de país vs círculos por centroide de {geo.centroids}? Recomendación: empezar por círculos por centroide (los centroides ya existen, cero dependencia GeoJSON) y migrar a polígonos si se quiere relleno coroplético real. Afecta a la entrada en {web.layers.config}.

## PLANNING COMPLETE
