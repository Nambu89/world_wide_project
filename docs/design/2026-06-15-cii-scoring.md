---
version: beta
name: cii-scoring
description: Refresco del diseño del Composite Instability Index (CII) por país (packages/core/cii), re-implementado clean-room de AGPL, ahora que el store tiene DOS capas nuevas construidas y verificadas en vivo en Fase 2 — la tabla `events` (USGS/EONET/GDELT, severity 0..100 real, lat/lon y country REALES del suceso, eventType conflict/protest/earthquake/wildfire) expuesta por `getEventsByCountry(sinceMs)` como bridge ya hecho, y la tabla `signals` (GKG, 6 secciones temáticas + AvgTone) expuesta por `getSignals`/`getSignalTrend`. El refresco mata la premisa "data-starved" del doc 2026-06-13 (solo Information con señal): hoy Conflict (events category=conflict + severity + Goldstein), Unrest/social (eventType=protest + sección political_instability de GKG), economic (commodities_energy+trade_sanctions+critical_minerals de GKG, modulado por AvgTone) y political (political_instability GKG + Information legacy) tienen fuente real y keyless. Mantiene el motor de N componentes con signalPresent + renormalización (D-100), pero ahora con varios componentes PRESENTES y mapeados explícitamente a su fuente del store. Re-deriva el EVENT_BLEND propio { conflict 0.25, economic 0.30, political 0.20, social 0.25 } (suma 1, invariante testeable), COMPOSITE { baseline 0.4, event 0.6 }, normalize [0,1] con FLOORS por componente (ausencia de dato != 0 riesgo) y timeDecay exponencial de vida-media 30d. Conserva methodology_version='cii-core-1', la tabla `cii_snapshots` time-series + dynamicScore + deadband, /api/cii + /api/cii/:country solo-lectura, la capa MapLibre en config-array central y el enriquecimiento del briefing. El motor de convergencia cross-domain (packages/core/signals) sigue siendo Non-Goal (el CII es su INPUT); los conectores keyed nuevos (ACLED/UCDP/OFAC/FRED) siguen Non-Goal (esta rebanada CONSUME events+signals+markets+news ya persistidos). Migración corregida a 004_cii.sql. El bloque estructurado (Decisions, Interfaces, Do/Don't) es normativo; la prosa explica el porqué.
status: draft
date: 2026-06-15
owner: system-architect
---

## Overview

Este documento **refresca** el diseño del **Composite Instability Index (CII) por país** en `packages/core/cii/`, re-implementado clean-room de AGPL (ADR-001/ADR-002). Supersede a `docs/design/2026-06-13-cii-scoring.md`, cuya premisa central —R-1 "CII data-starved: solo el componente Information tiene señal; GDELT = atención mediática financiera por país-fuente; severity siempre null; ~5 tablas"— **ya no es cierta**. Tras las rebanadas 1 (capa de eventos, ADR-010) y 2 (radar geoeconómico, ADR-011) de Fase 2, el store contiene dos capas nuevas construidas y verificadas en vivo: la tabla **`events`** (USGS/EONET/GDELT con `severity` 0..100 real, `lat/lon` y `country` REALES del suceso, `eventType` ∈ {earthquake, wildfire, conflict, protest, ...}) expuesta por **`getEventsByCountry(sinceMs)`** —el bridge al CII ya construido—, y la tabla **`signals`** (GKG article-level con 6 secciones temáticas + `tone` AvgTone) expuesta por `getSignals`/`getSignalTrend`.

El resultado deseado es el **mismo motor CII clean-room** —blend ponderado de N componentes con presencia-de-señal explícita {cii.presence} y renormalización {cii.renorm}, persistencia time-series, `dynamicScore` con deadband, `/api/cii` de solo-lectura, capa en config-array central, enriquecimiento del briefing— pero con la realidad de datos invertida: **varios componentes pasan de degradados a PRESENTES con fuente real keyless**. El refresco (1) re-deriva el blend a un EVENT_BLEND editorial propio de 4 sub-señales {cii.event.weights} = `{ conflict 0.25, economic 0.30, political 0.20, social 0.25 }` (suma 1, invariante testeable); (2) **mapea explícitamente cada sub-señal a su fuente del store** (conflict ← events category=conflict + severity + Goldstein; social ← events eventType=protest + GKG political_instability; economic ← GKG commodities_energy+trade_sanctions+critical_minerals modulado por AvgTone; political ← GKG political_instability + atención informativa legacy); (3) añade **FLOORS por componente** (ausencia de dato ≠ 0 riesgo) y **timeDecay exponencial de vida-media 30d**; (4) reintroduce los **boosts** earthquakeBoost (USGS severity) y fireBoost (EONET wildfire) ahora que sus fuentes viven en `events`. Conserva intactos: clean-room no-AGPL (D-001), persiste-antes-de-servir (D-002), `@libsql/client` (D-003), capa en config-array (D-004), sin proveedor LLM nuevo (D-005), motor N-componentes `signalPresent`+renorm (D-100), `methodology_version='cii-core-1'`, `cii_snapshots` + `dynamicScore` + deadband, `/api/cii`. No es código: es la especificación que el PM convierte en plan y pasa por `/check-plan` antes de implementar.

## Token-references (bloque canónico)

Cada token se define aquí como `leaf: valor`; las referencias entre llaves del resto del doc (de la forma namespace-punto-leaf) resuelven contra estas definiciones.

Paths del monorepo (existentes y nuevos):

- cii: `packages/core/cii/` — paquete nuevo del motor CII — referido como {pkg.core.cii}
- store: `packages/store/` — referido como {pkg.store}
- scheduler: `packages/scheduler/` — referido como {pkg.scheduler}
- ai: `packages/core/ai/` — referido como {pkg.core.ai}
- web: `packages/web/` — referido como {pkg.web}
- coeffs: `packages/core/cii/coefficients.ts` — tabla editorial propia baselineRisk/eventMultiplier + registro de componentes — referida como {cii.coeffs}
- blendcfg: `packages/core/cii/blend.config.ts` — config editorial propia del EVENT_BLEND, FLOORS, decay y composite (re-derivada, no-AGPL, espejo del patrón de `sections.config.ts`/`severity.ts`) — referida como {cii.blend.config}
- layers: `packages/web/src/map/layers.config.ts` (config-array central existente) — referido como {web.layers.config}

Fuentes del store (capas nuevas Fase 2 — el CII LEE de aquí, no de upstream):

- bridge: `getEventsByCountry(sinceMs): Promise<Map<string, EventRow[]>>` ({pkg.store}) — el bridge al CII ya construido; clave del Map = `EventRow.country` (ISO/nombre real del suceso) — referido como {cii.bridge}
- events: tabla `events` (migración 002) — `EventRow` { source usgs|eonet|gdelt, eventType, category natural|conflict, severity 0..100|null, lat/lon REALES, country real, occurredAt, rawJson con QuadClass/Goldstein/CAMEO/AvgTone para gdelt } — referida como {store.events}
- signals: tabla `signals` (migración 003, GKG) — `SignalRow` { tone AvgTone|null, sections[{section,matchedBy}], lat/lon best-effort, country, occurredAt } via `getSignals({section?,sinceMs?,limit?,minToneMag?})` / `getSignalTrend(section,{sinceMs?,bucketMs?})` — referida como {store.signals}
- sections: las 6 secciones del radar `Section` ∈ { political_instability, commodities_energy, critical_minerals, semis_ai_tech, digital_infra_cyber, trade_sanctions } — referida como {store.sections}

Valores y decisiones compartidas (CII):

- version: `methodology_version = 'cii-core-1'`, etiqueta de versión editorial propia que viaja con cada score — referida como {cii.methodology.version}
- scale: escala `0..100` (clamp duro) de todo componente y del compuesto — referida como {cii.scale}
- components: conjunto registrado `{ conflict, economic, political, social }` (todos con fuente real keyless hoy; ver presence) — referido como {cii.components}
- event.weights: EVENT_BLEND editorial propio `{ conflict 0.25, economic 0.30, political 0.20, social 0.25 }` (suma 1, invariante testeable) — referido como {cii.event.weights}
- presence: bandera `signalPresent` por componente — si falsa (ningún dato real en la ventana), el componente se excluye del blend y se renormalizan los pesos — referida como {cii.presence}
- renorm: renormalización de {cii.event.weights} sobre los componentes con `signalPresent=true` (los pesos suman 1 sobre presentes) — referida como {cii.renorm}
- floors: FLOORS editoriales por componente — piso mínimo del subscore cuando hay AUSENCIA de dato pero el componente sigue presente estructuralmente; ausencia de dato ≠ 0 riesgo — referido como {cii.floors}
- decay: time-decay EXPONENCIAL de la contribución de cada evento/señal por recencia, **vida-media 30 días** (`weight = 0.5 ^ (ageMs / halfLifeMs)`, halfLife = 30d) — referido como {cii.decay}
- window: ventana de cálculo = últimos **30 días** de `captured_at` en el store (alineada con la vida-media del decay; los eventos más viejos pesan <0.5) — referida como {cii.window}
- composite: `composite = clamp0_100( baselineRisk*B_W + eventScore*E_W )` con coeficientes editoriales propios **B_W=0.4, E_W=0.6** — referida como {cii.composite}
- boost: boosts severity-weighted aditivos sobre el subscore del componente conflict/social, ahora vivos keyless — earthquakeBoost ← USGS `severity` (eventType=earthquake), fireBoost ← EONET `severity` (eventType=wildfire) — referido como {cii.boost}
- dynamic: `dynamicScore` = delta firmado `-100..100` del composite vs el snapshot CII de ~24h antes — referida como {cii.dynamic}
- deadband: banda muerta de ±1 punto para etiquetar tendencia (|d|≤1=stable, ≥+2=rising, ≤-2=falling) — referida como {cii.deadband}
- countrykey: clave de país canónica = `EventRow.country` tal como lo persiste la capa events (ISO/nombre real del suceso, ya NO el centroide del medio) — referida como {cii.countrykey}
- ts: columna `captured_at` (epoch ms, INTEGER) común a las tablas time-series del store (patrón ADR-004) — referida como {schema.snapshot.ts}
- tier: tier del scheduler donde corre el cálculo CII (ver D-211 / OQ-5) — referido como {sched.tier}
- briefingctx: el bloque "contexto de riesgo geopolítico" que el CII aporta a `serializeContext` del briefing — referido como {ai.briefing.ctx}
- maplayer: capa MapLibre del CII (por país) declarada en {web.layers.config} — referida como {web.cii.layer}

Variante de estado:

- `{cii.components}-degraded` = un componente registrado en {cii.components} cuyo `signalPresent=false` porque NO hay ningún dato real en {cii.window} para él; se reporta en el snapshot a su {cii.floors} pero NO entra en el blend ponderado (renormaliza {cii.renorm}). A diferencia del doc viejo, hoy el motivo NO es "conector keyed ausente" (todos los componentes tienen fuente) sino "ventana sin datos" — un estado transitorio, no estructural (leaf `components`, ya definido arriba).

## Goals

- **G-1**: Motor CII clean-room en {pkg.core.cii} que calcula un score {cii.scale} por país desde el store ({cii.bridge} + {store.signals}), modelado como {cii.composite} sobre un EVENT_BLEND {cii.event.weights} de N componentes {cii.components} con presencia-de-señal {cii.presence}, renormalización {cii.renorm} y FLOORS {cii.floors}, sin una sola línea de fuente AGPL.
- **G-2**: **Componente Conflict operativo hoy** desde {store.events}: agrega eventos `category='conflict'` por país (via {cii.bridge}), ponderando por `severity` (0..100 real) y por la magnitud de conflicto en `rawJson` (Goldstein negativo / QuadClass), con time-decay {cii.decay}. Señal real keyless (NG-2 del doc viejo MUERE para Conflict).
- **G-3**: **Componente Social/Unrest operativo hoy**: combina `eventType='protest'` de {store.events} (via {cii.bridge}) con la sección `political_instability` de {store.signals} (volumen + AvgTone), con decay {cii.decay}. Señal real keyless.
- **G-4**: **Componente Economic operativo hoy** desde {store.signals}: agrega las secciones `commodities_energy`, `trade_sanctions` y `critical_minerals` (volumen via `getSignals`/`getSignalTrend`) moduladas por `tone` (AvgTone como señal de estrés: tono negativo eleva el subscore). Atribución por país best-effort (ver D-202 / OQ-1).
- **G-5**: **Componente Political operativo hoy**: sección `political_instability` de {store.signals} (la dimensión informativa de presión política) + el residuo de atención informativa de markets/news como modulador suave; con decay {cii.decay}.
- **G-6**: **Boosts severity-weighted vivos keyless** {cii.boost}: earthquakeBoost ← USGS `severity` (`eventType='earthquake'`) y fireBoost ← EONET `severity` (`eventType='wildfire'`), ambos ya en {store.events}, como aditivos acotados sobre el subscore del componente afectado (NG-3 del doc viejo MUERE parcialmente: estos dos boosts ya tienen fuente).
- **G-7**: Config editorial **propia** del blend {cii.blend.config} (EVENT_BLEND, FLOORS, decay, composite, boosts) + tabla {cii.coeffs} (baselineRisk/eventMultiplier por país + registro de componentes), re-derivadas y documentadas en nuestras palabras, etiquetadas con {cii.methodology.version}; nunca copiadas de worldmonitor. Espejo del patrón de `severity.ts`/`sections.config.ts` (config editorial re-derivada testeable).
- **G-8**: Persistencia time-series de snapshots CII en {pkg.store} (tabla nueva `cii_snapshots`, migración **`004_cii.sql`**, patrón ADR-004 con {schema.snapshot.ts}) + queries "último por país", "tendencia por país" y "prior ~24h".
- **G-9**: `dynamicScore` {cii.dynamic} (delta firmado vs snapshot de ~24h) + etiqueta de tendencia con deadband {cii.deadband}, calculados al persistir cada snapshot.
- **G-10**: Cálculo CII integrado como job del scheduler en el tier {sched.tier} (lee store → calcula → persiste ANTES de servir, sin fanout en navegador), endpoints `GET /api/cii` (+ `GET /api/cii/:country`) de solo-lectura del store, capa {web.cii.layer} declarada en {web.layers.config}, y enriquecimiento del briefing {ai.briefing.ctx}.
- **G-11**: Modelo extensible: el `signalPresent` por componente {cii.presence} hace que activar/desactivar una sub-señal sea cambiar una bandera (no reescribir el motor); el registro de componentes documenta la fuente del store de cada uno. Cuando aterricen conectores keyed (ACLED/UCDP → mejor Conflict; OFAC → economic), refinan la fuente existente, no añaden componentes.

## Non-Goals

- **NG-1**: **Motor de convergencia cross-domain** (`packages/core/signals`, INVESTIGACION §9.1 / §6.5): el matching geográfico-temporal ≥2-fuentes/72h + scoring de señales que cruza finanzas+geopolítica+desastre. Razón: es la pieza de mayor riesgo del plan y exige su propio spike Research→Plan→Check; worldmonitor no la sirve copiable. **El CII es INPUT de la convergencia, pero la convergencia NO se construye aquí.** Sigue firme.
- **NG-2**: **Conectores nuevos con key** (ACLED, UCDP, OFAC, FRED, EIA, militar/aviación/GPS-jam). Razón: zero-key-first; esta rebanada **CONSUME lo ya persistido** (events + signals + markets + news), NO añade fuentes upstream ni ToS nuevos. ACLED/UCDP (mejor Conflict/Unrest) y OFAC (sanciones reales) son rebanadas keyed posteriores que **refinan** las fuentes de los componentes ya presentes, sin cambiar el motor.
- **NG-3**: **Componente Security con señal real**. Razón: ninguna de las 3 fuentes de {store.events} (USGS/EONET/GDELT) da militar/aviación/GPS-jam; el radar GKG tampoco lo segrega. Security se **funde** en este refresco: NO es uno de los 4 componentes del {cii.event.weights} (que son conflict/economic/political/social). Si en una rebanada futura aterriza una fuente de seguridad dura, se añade como 5º componente con su peso y `signalPresent`. Hoy no existe → no se modela.
- **NG-4**: **NER de país sobre news/títulos**. Razón: `news_items` (legacy) no tiene país y atribuirlo por NER requiere ML/ONNX (Fase 3-4). Las news legacy entran solo como **temperatura informativa global** que modula el componente political (no como señal por-país). El GKG sí trae `country` best-effort por artículo y se usa tal cual (no se hace NER nuevo).
- **NG-5**: **Reverse-geocode / point-in-polygon propio en el motor CII**. Razón: la capa events YA persiste `country` real del suceso (la geocodificación es trabajo del conector, no del motor); el motor usa `EventRow.country` directamente via {cii.bridge}. R-2 (sesgo país-fuente) y el reverse-geocode del doc viejo **mueren** para la capa events.
- **NG-6**: **Backfill histórico de CII anterior a la primera ejecución**. Razón: el CII se calcula desde snapshots; la serie empieza vacía y crece desde el primer job. El `dynamicScore` queda neutro hasta tener ≥2 snapshots separados ~24h (D-209).
- **NG-7**: **Calibración cuantitativa fina de pesos/floors/decay con `intel-analyst`**. Razón: este doc fija la **forma** del modelo y valores editoriales de partida razonados; la calibración numérica precisa (qué floor por país, qué peso intra-componente entre GKG-sections) es una iteración de afinado posterior con datos reales acumulados, no un bloqueo de esta rebanada. Los valores de partida son honestos pero ajustables en un único fichero {cii.blend.config}.

## Context / Constraints

- **Datos reales del store (verificado en código a 2026-06-15)** — la restricción dominante, ahora INVERTIDA respecto al doc viejo:
  - Tablas: `market_snapshots`, `news_items`, `briefings`, `market_daily`, **`events`** (migración 002), **`signals`** + `signal_sections` (migración 003). La vieja `gdelt_events` ya **NO existe** (la reemplazó `events`).
  - **`events`** ({store.events}): `EventRow` con `eventType` ∈ {earthquake, wildfire, volcano, storm, flood, conflict, protest, ...}, `category` ∈ {natural, conflict}, `severity` 0..100 (real, normalizada en `severity.ts`; null si incalculable), `lat`/`lon` REALES del suceso, `country` real (ISO del ActionGeo para GDELT, del payload para USGS/EONET), `occurredAt`, `rawJson`. Los eventos GDELT llevan en `rawJson`: `quadClass`, `goldstein`, `eventCode` (CAMEO), `avgTone`, `actor1/2`. Bridge: `getEventsByCountry(sinceMs)` agrupa por `country`.
  - **`signals`** ({store.signals}): `SignalRow` GKG con `tone` (AvgTone -100..+100; null para RSS), `sections` (0..N de {store.sections} con `matchedBy`), `lat`/`lon`/`country` best-effort (geo del ARTÍCULO, ~74% con coords), `occurredAt`. Queries: `getSignals({section?,sinceMs?,limit?,minToneMag?})`, `getSignalTrend(section,{sinceMs?,bucketMs?})`.
  - `news_items` (legacy): `feed_domain`, `title`, `url`, `published_at`. Sin país ni sección → solo temperatura global (NG-4).
  - **Sesgo país-fuente y reverse-geocode (R-2/NG-5 del doc viejo) NO aplican** a la capa events: GDELT events traen coords y país REALES del suceso (ActionGeo), no el centroide del medio.
- **Stack bloqueado** (ADR-003): TypeScript, monorepo pnpm, Vite, React + MapLibre GL, Node single-server (`server.ts`), router LLM.
- **Persistencia bloqueada** (ADR-006): `@libsql/client`, `url: file:./data/world.db`. Prohibido `better-sqlite3`. La UI lee del store, nunca de upstream (ADR-004).
- **IA bloqueada** (ADR-009): proveedor activo del router = **openai** (`OPENAI_API_KEY`/`OPENAI_MODEL`). El CII enriquece el briefing existente, no añade un modelo nuevo.
- **Licencia (ADR-002, feedback_no_agpl_copy)**: worldmonitor = AGPL-3.0; sólo metodología re-implementada en nuestras palabras, NUNCA copiar fuente, pesos verbatim ni texto del doc editorial. osiris = MIT. Los pesos/floors/curvas de este doc son **propios y ajustables** (espejo de `severity.ts`/`sections.config.ts`, ya re-derivados en esta misma Fase 2).
- **Datos ≠ licencia (feedback_data_tos)**: el CII NO añade fuentes upstream → no añade ToS nuevos. Las fuentes ya gobernadas: USGS (público), EONET (público), GDELT (libre+citación), GKG (unlimited+citación). Verificadas en vivo en las rebanadas 1 y 2.
- **Capas de mapa (feedback_central_layer_config / ADR-008)**: capas declaradas en {web.layers.config}; UI responsive mobile-first.
- **Entorno**: Windows (win32). El CII es TypeScript puro sobre el store (sin binarios nativos nuevos) → riesgo toolchain bajo; depende del `@libsql/client` ya validado.
- **Migraciones existentes**: `001_init.sql`, `002_events.sql`, `003_signals.sql`. La migración CII es **`004_cii.sql`** (el doc viejo decía `002_cii` — error; corregido).
- **Naturaleza editorial del índice**: el CII es un índice **editorial e inspeccionable** (coeficientes visibles, cada score explicable componente a componente), NO académico validado. Cada score lleva su {cii.methodology.version}. Con varios componentes ahora presentes, la inspeccionabilidad cambia de "evitar que el índice mienta sobre su cobertura" a "documentar qué fuente alimenta cada sub-señal" — el `detail` por componente reporta la fuente y el conteo.

## Decisions

> Las decisiones **bloqueadas** (no-negociables) heredan de los ADRs base y de `memory/feedback_*.md`; el ADR fuente se cita una vez. Las decisiones **internas** (numeradas desde el doscientos en este refresco, para no colisionar con las D-1xx del doc viejo) son recomendación del arquitecto; el PM ratifica las marcadas con OQ. Cada `D-NNN` aparece una sola vez.

Bloqueadas (no-negociables, heredadas):

- **D-001** (ADR-002 / feedback_no_agpl_copy): el motor CII, el blend {cii.event.weights}, los FLOORS {cii.floors}, el decay {cii.decay}, la config {cii.blend.config} y la tabla {cii.coeffs} se **re-implementan desde metodología documentada en nuestras palabras** — porque copiar fuente, pesos verbatim o texto del doc editorial de worldmonitor (AGPL-3.0) convierte el programa en obra derivada AGPL (§13). Las fórmulas/ideas no son copyrightables; el código y el texto sí. Precedente vivo en esta Fase 2: `severity.ts` y `sections.config.ts` ya son config editorial re-derivada.
- **D-002** (ADR-004): el cálculo CII corre **server-side en el scheduler**, persiste snapshots y la UI lee del store, nunca recalcula en el navegador — porque desacopla el índice de la pestaña abierta y habilita el histórico (el diferencial del proyecto).
- **D-003** (ADR-006): la persistencia CII usa `@libsql/client` sobre `file:./data/world.db` con el mismo patrón time-series ({schema.snapshot.ts} epoch ms) — porque libSQL es Turso (migrar = cambiar URL) y mantiene un único motor de persistencia.
- **D-004** (ADR-003 / feedback_central_layer_config): la capa CII {web.cii.layer} se declara como entrada en {web.layers.config}, iterada por el render, nunca `map.on('load')` imperativo — porque corrige la debilidad de osiris (capas dispersas) y el `verifier` comprueba este wiring. Coherente con las capas events/signals ya declaradas ahí.
- **D-005** (ADR-009): el CII **no introduce un proveedor LLM nuevo**; enriquece el briefing existente vía {ai.briefing.ctx} usando la rama activa openai — porque la rebanada CII no es el lugar para cambiar proveedor.

Internas (recomendación del arquitecto; el PM ratifica las marcadas OQ):

- **D-200**: el CII se mantiene como **motor de N componentes con registro explícito** {cii.components}, cada uno con `signalPresent` {cii.presence}; el blend {cii.event.weights} se **renormaliza** {cii.renorm} sobre los componentes presentes — porque conserva el invariante de honestidad (un componente sin dato en la ventana NO se inventa) heredado de D-100, pero hoy la diferencia es que **los 4 componentes tienen fuente real** y normalmente estarán presentes; `signalPresent=false` pasa a ser un estado transitorio (ventana sin datos), no estructural (sin conector). El invariante "los pesos suman 1 sobre presentes" es testeable. Reemplaza el conjunto de componentes del doc viejo {information, unrest, conflict, security} por {conflict, economic, political, social}.
- **D-201** (mapeo sub-señal→fuente, **OQ-1**): cada componente se calcula de una fuente explícita del store:
  - **conflict** ← {cii.bridge} eventos `category='conflict'` (incluye `eventType` conflict y protest material): subscore = media time-decayed {cii.decay} de `severity` por país, sesgada por la magnitud de conflicto de `rawJson` (`goldstein` negativo eleva, QuadClass 4 > 3). Floor {cii.floors} si el país tiene baseline pero 0 eventos en la ventana.
  - **social** ← {cii.bridge} eventos `eventType='protest'` (recuento + severity time-decayed) **+** {store.signals} sección `political_instability` (volumen via `getSignalTrend`, AvgTone como intensidad). Mezcla intra-componente recomendada 0.6 events / 0.4 GKG (protesta geo-real pesa más que atención informativa).
  - **economic** ← {store.signals} secciones `commodities_energy` + `trade_sanctions` + `critical_minerals`: subscore = volumen time-decayed agregado de las 3 secciones, **modulado por AvgTone** (tono medio negativo eleva el subscore: estrés económico). `semis_ai_tech` y `digital_infra_cyber` quedan FUERA de economic en esta rebanada (cobertura GKG débil/keyword-dependiente, R-1 del radar; reconsiderar tras calibración). Mezcla intra-sección por volumen ponderado.
  - **political** ← {store.signals} sección `political_instability` (dimensión informativa de presión política) + residuo de atención informativa legacy (markets/news) como modulador global suave. Distinto de social: political = presión narrativa/incertidumbre política; social = disturbio en la calle (protesta/violencia).
  — porque cada sub-señal debe atarse a un dato real y auditable del store (no a un proxy genérico); el `detail` de cada componente reporta la fuente y el conteo. **El PM ratifica el mapeo exacto y los pesos intra-componente (OQ-1).** Alternativa descartada: un único "eventScore" plano sobre todos los eventos sin separar sub-señales (pierde inspeccionabilidad y el blend editorial).
- **D-202** (atribución de país para GKG sin país, **OQ-1b**): las secciones GKG que alimentan economic/political usan `SignalRow.country` cuando existe (best-effort, ~74% con geo); las señales GKG **sin** país contribuyen como **temperatura temática global** que modula por igual a todos los países (un multiplicador suave del subscore económico/político global), NO se atribuyen a un país concreto — porque atribuir un artículo sin país a un país inventaría geografía (mismo principio que news legacy, NG-4). **El PM ratifica si economic/political deben ser estrictamente por-país (descartar señales sin país) o por-país-con-piso-global (recomendado).**
- **D-203** (clave de país, **OQ-2**): {cii.countrykey} = **`EventRow.country` tal como lo persiste la capa events** (ISO/nombre real del suceso), usado directamente como clave del Map de {cii.bridge} — porque la capa events ya produce un país real y canónico por suceso; reusar esa clave elimina el reverse-geocode del doc viejo (NG-5) y unifica events↔signals↔cii bajo la misma clave. **El PM ratifica: usar `EventRow.country` directamente (recomendado) vs normalizar a un esquema ISO-3166 explícito** (si GDELT da FIPS y USGS/EONET dan ISO, puede haber heterogeneidad de claves entre fuentes — ver R-3 y OQ-2). Recomendación: usar la clave tal cual hoy y añadir una normalización ligera solo si R-3 se materializa.
- **D-204** (componentes presentes hoy, **OQ-3**): se declaran con `signalPresent=true` por presencia de datos en {cii.window}: **conflict** (events conflict, seguro), **social** (events protest + GKG political_instability), **economic** (GKG commodities/trade/minerals), **political** (GKG political_instability). El componente Information legacy del doc viejo se **absorbe** en political (atención informativa = presión política/incertidumbre). `signalPresent` se evalúa en runtime: si la ventana no tiene NINGÚN dato real para un componente, cae a `signalPresent=false` y renormaliza (D-200) — porque la presencia es dato, no supuesto; un componente sin datos hoy (p.ej. economic en un país sin cobertura GKG) no debe inventar señal. **El PM ratifica qué componentes arrancan declarados presentes (recomendado: los 4) vs un arranque conservador conflict+political.**
- **D-205** (FLOORS por componente, **OQ-4**): cada componente presente tiene un **floor editorial** {cii.floors} en {cii.blend.config} = el subscore mínimo cuando el componente está presente estructuralmente (el país tiene baseline) pero la ventana no aporta eventos/señales — porque **ausencia de dato ≠ 0 riesgo**: un país con `baselineRisk` alto y 0 eventos GDELT esta semana no es "riesgo cero de conflicto", es "sin señal nueva sobre un suelo estructural". El floor se aplica al subscore del componente (no al composite). Valores de partida recomendados (ajustables): conflict floor 0, economic floor 0, political floor 0, social floor 0 escalados por `baselineRisk` del país (floor efectivo = `baselineRisk * floorFactor`, `floorFactor` por componente). **El PM ratifica los floorFactor (OQ-4).** Distinción con D-200: el floor aplica a componente PRESENTE-sin-datos; `signalPresent=false` (renorm) aplica a componente sin presencia estructural — son casos distintos.
- **D-206** (time-decay exponencial, **OQ-4b**): {cii.decay} = exponencial con **vida-media 30 días**: `weight(ageMs) = 0.5 ^ (ageMs / (30*24*3600*1000))`, donde `ageMs = nowMs - occurredAt` (fallback `capturedAt` si `occurredAt` null). La ventana {cii.window} = últimos 30 días — porque un evento de hace 30 días debe pesar la mitad que uno de hoy (la inestabilidad decae pero no desaparece), y el exponencial es suave (sin cliff). Alternativa descartada: ventana dura de 24h del doc viejo (demasiado corta para Conflict, que persiste días/semanas; el doc viejo usaba 24h porque solo medía atención mediática, ahora medimos eventos con duración). **El PM ratifica la vida-media de 30d (OQ-4b).**
- **D-207** (EVENT_BLEND propio): {cii.event.weights} = `{ conflict 0.25, economic 0.30, political 0.20, social 0.25 }`, **suma = 1.0** (invariante testeable con un test de igualdad exacta) — porque refleja editorialmente que economic es el dominio de mayor cobertura de datos hoy (3 secciones GKG fuertes) y conflict+social juntos (0.50) capturan la inestabilidad dura; political (0.20) pondera la presión narrativa. Re-derivado, NO copiado. Ajustable en {cii.blend.config}. El invariante de suma-1 vive en un test unitario.
- **D-208** (composite + boosts): {cii.composite} = `clamp0_100( baselineRisk*0.4 + eventScore*0.6 )` con `eventScore` = blend renormalizado {cii.renorm} de los componentes presentes; los {cii.boost} (earthquakeBoost ← USGS severity, fireBoost ← EONET wildfire severity) se aplican como **aditivos acotados sobre el subscore del componente social** (un desastre natural amplifica el riesgo de inestabilidad social/humanitaria) ANTES de la renormalización, con cap propio (p.ej. +15 cada uno, cap combinado +25) — porque mantiene la idea "suelo estructural (0.4) + capa de eventos dominante (0.6)" del doc viejo y reintroduce los boosts ahora que USGS/EONET viven en {store.events}; aplicarlos a social (no a conflict) refleja que terremoto/incendio elevan riesgo humanitario, no conflicto armado. Alternativa descartada: boost al composite directamente (pierde la atribución por componente). Valores ajustables.
- **D-209** ({cii.dynamic} + deadband): `dynamicScore = clamp(-100,100, composite_now - composite_~24h)` buscando el snapshot del mismo país más cercano a `now - 24h`; si no existe (serie nueva) `dynamicScore=0`/`trend='stable'`. Tendencia {cii.deadband}: `|d|≤1 → stable`, `d≥+2 → rising`, `d≤-2 → falling` — porque replica el delta-firmado-vs-24h re-derivado y el deadband evita parpadeo por ruido de ±1 punto; el caso "serie nueva" debe ser neutro (NG-6), no un falso movimiento.
- **D-210** (persistencia): tabla nueva **`cii_snapshots`** (migración `004_cii.sql`), wide-tipada (una fila por país por cálculo) + columna JSON `components_json` con el desglose `CiiComponent[]` — porque las columnas tipadas (`country`, `composite`, `baseline_risk`, `event_score`, `dynamic_score`, `trend`, {schema.snapshot.ts}) dan índices/queries directos y el desglose por componente es de forma variable → JSON. Coherente con el patrón wide-tipado del store (events/signals).
- **D-211** (tier del job, **OQ-5**): el cálculo CII corre en el tier **`medium`** del scheduler (no `daily`) — porque el componente **Conflict es ahora más volátil** (eventos GDELT se refrescan cada 15min y un brote de conflicto/protesta cambia el índice intra-día); un cálculo 1×/día perdería la reactividad que la presencia de Conflict habilita. El coste sigue siendo leer el store (barato). Alternativa: daily (recomendación del doc viejo, válida cuando solo había atención mediática lenta; descartada ahora que Conflict es volátil). **El PM ratifica medium vs daily (OQ-5).** Cambia respecto al doc viejo (que recomendaba daily).
- **D-212** (API solo-lectura): `GET /api/cii` devuelve el último snapshot por país (no recalcula on-request); `GET /api/cii/:country` devuelve la tendencia del país desde el store — porque honra "la API es solo-lectura del store" (ADR-004); el cálculo vive solo en el job del scheduler. La capa del mapa consume `/api/cii`.
- **D-213** (geometría de la capa, **OQ-6**): {web.cii.layer} se declara en {web.layers.config} como capa por país coloreada por banda de composite; geometría recomendada = **`fill` coroplético con GeoJSON de países** si el proyecto ya carga un GeoJSON de países para otras capas, o **`circle` por centroide** si no — porque la coroplética comunica mejor un índice por país que puntos, pero no debe forzar una dependencia GeoJSON nueva si no existe ya. **El PM ratifica fill-coroplético vs circle-centroide (OQ-6)** según lo que {web.layers.config} ya tenga disponible. Bandas de render editoriales: `0-24 bajo`, `25-49 moderado`, `50-69 elevado`, `70-100 alto` (render, no un segundo índice).

## Interfaces / Data Contracts

> Firmas y schema **normativos**. Tipos en pseudo-TS; el implementador los traduce. Los nombres de columna son contractuales (referenciados por tokens). Ningún valor, peso o texto procede de fuente AGPL: todo re-derivado.

Tipos del dominio CII ({pkg.core.cii}):

```ts
// {cii.scale} = 0..100 con clamp duro en todo punto.
type CiiComponentKey = 'conflict' | 'economic' | 'political' | 'social'; // {cii.components}

interface CiiComponent {
  key: CiiComponentKey;
  score: number;            // 0..100; floor {cii.floors} si presente-sin-datos; renorm si !signalPresent
  signalPresent: boolean;   // {cii.presence}; false => excluido del blend, renormaliza {cii.renorm}
  weight: number;           // peso EDITORIAL nominal de {cii.event.weights} antes de renormalizar
  sources: string[];        // fuentes del store que alimentaron el componente (D-201), p.ej.
                            //   ['events:conflict'] / ['events:protest','signals:political_instability']
  detail?: string;          // explicación inspeccionable corta (ej. "23 eventos conflict, decay-mean sev 41, +earthquakeBoost 8")
}

interface CiiScore {
  country: string;          // {cii.countrykey}: EventRow.country (real del suceso)
  composite: number;        // {cii.scale}, resultado de {cii.composite}
  baselineRisk: number;     // de {cii.coeffs}
  eventScore: number;       // blend renormalizado {cii.renorm} de componentes presentes (0..100)
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

Config editorial del blend {cii.blend.config} (`packages/core/cii/blend.config.ts`) — config PROPIA, re-derivada (espejo de `severity.ts`/`sections.config.ts`):

```ts
// EVENT_BLEND {cii.event.weights}: suma === 1.0 (invariante testeable, D-207).
export const EVENT_WEIGHTS: Record<CiiComponentKey, number>;
//   { conflict: 0.25, economic: 0.30, political: 0.20, social: 0.25 }

// FLOORS {cii.floors} (D-205): floorFactor por componente; floor efectivo = baselineRisk * floorFactor.
export const FLOOR_FACTORS: Record<CiiComponentKey, number>; // valores 0..1, ajustables (OQ-4)

// COMPOSITE {cii.composite} (D-208): coeficientes baseline/event.
export const COMPOSITE = { BASELINE_W: 0.4, EVENT_W: 0.6 } as const;

// DECAY {cii.decay} (D-206): exponencial, vida-media 30 días.
export const DECAY_HALF_LIFE_MS = 30 * 24 * 3_600_000; // OQ-4b
export function decayWeight(ageMs: number): number;     // 0.5 ^ (ageMs / DECAY_HALF_LIFE_MS), clamp [0,1]

// BOOSTS {cii.boost} (D-208): caps re-derivados, aplicados a social.
export const BOOST = { EARTHQUAKE_CAP: 15, FIRE_CAP: 15, COMBINED_CAP: 25 } as const;

// Qué secciones GKG alimentan economic (D-201) — declarativo, ajustable.
export const ECONOMIC_SECTIONS: Section[]; // ['commodities_energy','trade_sanctions','critical_minerals']
// Mezcla intra-componente social (D-201): events vs GKG.
export const SOCIAL_MIX = { EVENTS_W: 0.6, GKG_W: 0.4 } as const;
```

Coeficientes editoriales propios {cii.coeffs} (`packages/core/cii/coefficients.ts`):

```ts
// Tabla PROPIA, re-derivada (NO copiada de worldmonitor). Inspeccionable/ajustable.
interface CountryCoeff {
  baselineRisk: number;     // 0..100, suelo estructural editorial del país
  eventMultiplier: number;  // factor sobre la contribución de eventos del país (default 1.0)
}
export const COUNTRY_COEFFS: Record<string, CountryCoeff>;  // claves = {cii.countrykey}
export const DEFAULT_COEFF: CountryCoeff;                   // { baselineRisk: 30, eventMultiplier: 1.0 }

// Registro de componentes: pesos nominales + fuente del store de cada uno (D-201/D-204).
// A diferencia del doc viejo, unlockedBy ya NO es "conector keyed ausente": los 4 componentes
// tienen fuente. El campo documenta la fuente del store (auditable) y futuras mejoras keyed.
export const COMPONENT_REGISTRY: Array<{
  key: CiiComponentKey;
  weight: number;                 // {cii.event.weights} nominal; renormaliza {cii.renorm}
  storeSource: string;            // fuente real hoy, p.ej. 'events:category=conflict'
  refinedBy: string | null;       // conector keyed FUTURO que mejora (no desbloquea) la fuente,
                                  //   p.ej. 'connectors/geo/acled.ts' para conflict; null si no aplica
}>;
```

Motor de cálculo ({pkg.core.cii}, API pública). Lee del STORE via {cii.bridge}/{store.signals}, no de upstream:

```ts
// {cii.window} = últimos 30 días; {cii.decay} = peso exponencial por recencia (vida-media 30d).

// Componente conflict (D-201) desde events category=conflict:
export function computeConflictComponent(events: EventRow[], coeff: CountryCoeff, nowMs: number): CiiComponent;

// Componente social (D-201): events protest + GKG political_instability:
export function computeSocialComponent(
  protestEvents: EventRow[], gkgPolitical: SignalRow[],
  boosts: { earthquakeSeverity: number; fireSeverity: number }, // de events natural del país (D-208)
  coeff: CountryCoeff, nowMs: number,
): CiiComponent;

// Componente economic (D-201/D-202): GKG commodities/trade/minerals + tono:
export function computeEconomicComponent(gkgEconomic: SignalRow[], globalTemp: number, coeff: CountryCoeff, nowMs: number): CiiComponent;

// Componente political (D-201): GKG political_instability + atención informativa legacy:
export function computePoliticalComponent(gkgPolitical: SignalRow[], globalInfoTemp: number, coeff: CountryCoeff, nowMs: number): CiiComponent;

// Blend + baseline + renormalización (D-207/D-208/D-200):
export function computeCii(
  country: string, components: CiiComponent[], coeff: CountryCoeff,
  methodologyVersion: string, capturedAt: number,
): CiiScore;

// Orquestador del job: lee store ({cii.bridge} + getSignals por sección), agrupa por país,
// calcula los 4 componentes + boosts, blendea, devuelve snapshots a persistir:
export async function computeAllCountries(nowMs: number): Promise<CiiScore[]>;

// dynamicScore + trend (D-209) contra el snapshot ~24h previo del store:
export function computeDynamic(current: CiiScore, prior: CiiScore | null): CiiDynamic;
```

Store — nuevas estructuras time-series ({pkg.store}, migración `004_cii.sql`):

```sql
-- Snapshots de CII. Una fila por país por cálculo. Patrón ADR-004. (NO '002_cii' — error del doc viejo.)
CREATE TABLE IF NOT EXISTS cii_snapshots (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  country             TEXT    NOT NULL,        -- {cii.countrykey} = EventRow.country
  composite           REAL    NOT NULL,        -- {cii.scale}
  baseline_risk       REAL    NOT NULL,
  event_score         REAL    NOT NULL,
  dynamic_score       REAL,                    -- {cii.dynamic}; null en serie nueva (D-209)
  trend               TEXT,                    -- 'rising'|'falling'|'stable' {cii.deadband}
  methodology_version TEXT    NOT NULL,        -- {cii.methodology.version}
  components_json     TEXT    NOT NULL,        -- desglose CiiComponent[] inspeccionable (D-210)
  captured_at         INTEGER NOT NULL         -- {schema.snapshot.ts} epoch ms
);
CREATE INDEX IF NOT EXISTS ix_cii_country_time
  ON cii_snapshots (country, captured_at);     -- "último por país" + "tendencia por país"
```

Store — API nueva ({pkg.store}, añade a `index.ts`, NO reescribe lo existente):

```ts
export async function insertCiiSnapshots(rows: CiiSnapshotRow[]): Promise<void>;
export async function getLatestCii(): Promise<CiiSnapshotRow[]>;                 // último por país
export async function getCiiTrend(country: string, sinceMs: number): Promise<CiiSnapshotRow[]>;
export async function getPriorCii(country: string, aroundMs: number): Promise<CiiSnapshotRow | null>; // ~24h antes (D-209)
// purgeAndDownsample (existente) se EXTIENDE para purgar cii_snapshots > retención (sigue ADR-004).
// CiiSnapshotRow serializa en camelCase (L-1: el wire de la web es camelCase — feedback_api_contract_camelcase).
```

Scheduler ({pkg.scheduler}) — job CII en el tier {sched.tier}:

```ts
// Nuevo Job tier 'medium' (D-211; OQ-5). Invariante: persiste ANTES de servir (ADR-004).
// run(): computeAllCountries(now) -> por país computeDynamic(current, getPriorCii) -> insertCiiSnapshots
// Se registra junto a los jobs medium existentes (eonet/gdelt/gkg). No fanout en navegador.
```

server.ts — endpoints nuevos (solo-lectura del store, D-212):

```ts
GET /api/cii            -> getLatestCii()              // alimenta la capa del mapa
GET /api/cii/:country   -> getCiiTrend(country, since) // serie histórica para panel/sparkline
// Mismo pipeline de middleware existente. NUNCA dispara el motor CII on-request.
```

Web ({pkg.web}) — capa {web.cii.layer} en {web.layers.config}:

```ts
// Entrada NUEVA en el config-array existente (D-004). El render itera LAYERS; añadir capa = añadir entrada.
// Geometría D-213 (OQ-6): 'fill' coroplético si hay GeoJSON de países, o 'circle' por centroide si no.
// Bandas editoriales (render, no índice): 0-24 bajo, 25-49 moderado, 50-69 elevado, 70-100 alto.
{
  id: 'cii-by-country',
  source: 'cii-countries',
  type: 'fill',                       // o 'circle' por centroide (D-213/OQ-6)
  paint: { /* color por step de composite; bandas arriba */ },
  visibleWhen: (active) => active.has('cii'),
}
// Panel de riesgo (responsive, ADR-008): top países por composite + flecha de trend {cii.dynamic},
// con estados loading/empty/error; lee /api/cii y /api/cii/:country (camelCase, feedback_api_contract_camelcase).
```

Briefing — enriquecimiento {ai.briefing.ctx} ({pkg.core.ai}):

```ts
// serializeContext (existente) gana un bloque de riesgo construido desde el STORE (getLatestCii):
//   "Top N países por CII (composite) y sus movimientos de 24h (dynamicScore/trend),
//    con el componente dominante de cada uno (conflict/economic/political/social)."
// Contexto grounded para el briefing existente; NO añade una llamada LLM ni cambia de proveedor (D-005).
// Si cii_snapshots está vacío (serie nueva), el bloque se omite.
export function buildRiskContext(latest: CiiSnapshotRow[]): string; // '' si vacío
```

## Do's and Don'ts

- **DO**: alimenta cada componente {cii.components} desde su fuente real del store (D-201) y reporta esa fuente en `CiiComponent.sources`/`detail` — porque el índice es editorial e inspeccionable: cada score debe poder explicarse hasta el evento/sección que lo causó.
- **DO**: usa `EventRow.country` de {cii.bridge} como clave de país {cii.countrykey} directamente — porque la capa events ya geocodifica el suceso real; el motor CII NO hace reverse-geocode (NG-5, R-2/NG-5 del doc viejo mueren).
- **DO**: marca `signalPresent=false` y renormaliza {cii.renorm} cuando un componente NO tiene NINGÚN dato en {cii.window}; y aplica el floor {cii.floors} cuando el componente está presente pero sin eventos esta ventana — porque ausencia de dato ≠ 0 riesgo (D-205) pero tampoco riesgo inventado: son dos casos distintos y deben tratarse distinto.
- **DO**: aplica el decay exponencial {cii.decay} (vida-media 30d) a cada evento/señal por su `occurredAt` — porque la inestabilidad decae con el tiempo pero no desaparece; un evento de hace un mes pesa la mitad, no cero.
- **DO**: re-deriva todos los pesos {cii.event.weights}, floors {cii.floors}, caps {cii.boost} y umbrales {cii.deadband} en valores propios documentados en {cii.blend.config}/{cii.coeffs} — porque feedback_no_agpl_copy; mismo patrón que `severity.ts`/`sections.config.ts` ya re-derivados en esta Fase 2.
- **DO**: mantén el invariante `sum(EVENT_WEIGHTS) === 1.0` en un test unitario — porque es la garantía testeable de que el blend está bien formado (D-207).
- **DO**: serializa `CiiSnapshotRow` en camelCase en el wire de la API — porque feedback_api_contract_camelcase: snake_case en el cliente rompe los filtros de capas (incidente T-13 con events).
- **DON'T**: NO copies fuente, pesos verbatim ni texto del doc editorial de worldmonitor (CII v8) — porque es AGPL-3.0 y volvería el programa obra derivada (§13); re-implementa en nuestras palabras (D-001).
- **DON'T**: NO modeles un componente Security con datos inventados — porque ninguna fuente del store da militar/aviación/GPS-jam (NG-3); Security NO es uno de los 4 componentes hoy. Si llega una fuente, se añade como 5º componente con su peso.
- **DON'T**: NO atribuyas señales GKG sin país (ni news legacy sin país) a un país concreto — porque inventaría geografía; entran como temperatura temática/informativa global que modula el subscore (D-202/NG-4).
- **DON'T**: NO dispares el motor CII en cada request de `/api/cii` — porque el cálculo vive solo en el job del scheduler; la API es solo-lectura del store (D-212). Un request que recalcula rompe ADR-004.
- **DON'T**: NO introduzcas un proveedor LLM nuevo ni una segunda llamada en el briefing por el CII — porque D-005: el CII solo añade contexto grounded al briefing existente con la rama activa openai.
- **DON'T**: NO añadas conectores con key en esta rebanada — porque NG-2/zero-key-first: esta rebanada solo consume lo persistido; ACLED/UCDP/OFAC son rebanadas independientes que REFINAN las fuentes existentes, no este motor.
- **DON'T**: NO construyas el matching de convergencia cross-domain aquí — porque NG-1: el CII es input de la convergencia, que es su propio spike Research→Plan→Check.

## Risks

- **R-1 (calibración de pesos/floors/decay sin datos acumulados — el riesgo central ahora)**: con varios componentes presentes, el riesgo se desplaza de "data-starved" (muerto) a "calibración": los pesos {cii.event.weights}, floors {cii.floors}, mezclas intra-componente y caps de boost son editoriales razonados pero NO validados contra histórico (la serie arranca vacía). **Mitigación**: todos los valores viven en {cii.blend.config}/{cii.coeffs} ajustables en un único punto; el `detail` por componente hace cada score auditable; la calibración fina es iteración posterior con `intel-analyst` (NG-7). Riesgo residual: un índice mal ponderado al principio. Reduce el riesgo del doc viejo (R-1 data-starved) pero introduce este.
- **R-2 (heterogeneidad de la clave de país entre fuentes)**: {store.events} puede persistir `country` en esquemas distintos según la fuente (GDELT ActionGeo_CountryCode = FIPS; USGS/EONET = ISO o nombre del payload), de modo que el mismo país podría aparecer con dos claves y partir el score. **Mitigación**: D-203 recomienda una normalización ligera solo si se materializa; el bridge {cii.bridge} ya agrupa por la clave que persiste el conector (la heterogeneidad es trabajo del conector si aparece). **OQ-2 lo eleva al PM.** Sustituye al R-2 del doc viejo (sesgo país-fuente, muerto).
- **R-3 (cobertura desigual del GKG en economic)**: el radar tiene cobertura fuerte por theme-code en commodities/trade/political pero débil/keyword-dependiente en critical_minerals/semis/cyber (R-1 del radar). El componente economic usa solo las 3 secciones fuertes (D-201); aun así el conteo por país puede ser ruidoso. **Mitigación**: AvgTone como modulador atenúa el ruido de volumen; semis/cyber quedan fuera de economic hasta calibrar; el subscore reporta su conteo en `detail`.
- **R-4 (GKG geo del artículo, no del suceso)**: las secciones GKG traen `country` del artículo (~74%), no necesariamente del país afectado por la noticia económica. **Mitigación**: D-202 trata las señales sin país como temperatura global; las con país se atribuyen best-effort y se documenta el sesgo. La señal geo-dura (conflict/protest/boosts) viene de {store.events} (suceso real), no de GKG.
- **R-5 (serie histórica arranca vacía)**: `dynamicScore`/trend neutros hasta tener ≥2 snapshots separados ~24h (NG-6). **Mitigación**: D-209 fuerza `dynamicScore=0`/`trend='stable'` en serie nueva; la UI muestra "sin tendencia aún". Con tier medium (D-211) la serie crece más rápido que con daily.
- **R-6 (crecimiento de cii_snapshots con tier medium)**: tier medium (D-211) genera más filas que daily (varios cálculos/día × ~N países). Sigue siendo órdenes de magnitud menor que events/signals. **Mitigación**: extender `purgeAndDownsample` para purgar/downsamplear `cii_snapshots` con la retención ADR-004; reconsiderar downsampling diario si el volumen crece.
- **R-7 (deriva AGPL al re-derivar pesos)**: un implementador podría copiar pesos o texto del doc editorial de worldmonitor. **Mitigación**: D-001/Do-Don't; los pesos de este doc son propios (espejo de `severity.ts`/`sections.config.ts` ya re-derivados); el `verifier` revisa; el `codebase-navigator` marca material AGPL como solo-referencia.
- **R-8 (boost mal atribuido)**: aplicar earthquakeBoost/fireBoost a social (D-208) es una decisión editorial; un desastre podría leerse como riesgo económico también. **Mitigación**: la decisión es explícita y acotada por caps; el `detail` reporta el boost; reconsiderable en calibración (NG-7).

## Iteration Guide

- Trabaja **UNA pieza a la vez** (la migración del store, la config del blend, un componente, el job, el endpoint, la capa, el briefing). Cobertura parcial de un flujo es peor que un flujo cerrado.
- Refiere componentes y valores por su **token** ({cii.event.weights}, {cii.bridge}, {cii.floors}, {web.layers.config}, {schema.snapshot.ts}) — no repitas el valor literal ni re-cites un `D-NNN` por número (cada id se define una vez; refiérete a su contenido).
- Sigue el **orden de implementación sugerido** (abajo): el motor no persiste sin la tabla; la API no sirve sin la tabla; la capa no pinta sin la API; cada componente es testeable aislado con datos del store sembrados.
- Añade variantes nuevas como **entradas separadas**: un componente nuevo (p.ej. Security cuando llegue su fuente) = una entrada en `COMPONENT_REGISTRY` + su peso en `EVENT_WEIGHTS` (re-normalizando la suma a 1) + su `compute*Component`; una capa nueva = una entrada en {web.layers.config}; una query nueva = una función nueva en {pkg.store} (NO reescribir las existentes).
- Tras cada edición de este doc, deja que `spec-validator.js` valide el schema (front-matter + secciones en orden + ≥1 Non-Goal + sin token colgante + IDs únicos).
- Cierra cada flujo de punta a punta antes de pasar al siguiente; el `verifier` comprueba wiring real (motor→store, job→scheduler tier medium, capa en config-array, panel importado, ruta en `server.ts`, bloque de riesgo en el briefing).
- Si una decisión interna entra en conflicto con un descubrimiento de implementación (ej. la clave de país resulta heterogénea, R-2/OQ-2), **no la reescribas silenciosamente**: el implementador para y reporta; el cambio vuelve al PM (puede generar un ADR).

Secuencia de implementación sugerida (input del plan del PM — el PM escribe el plan). Grafo de dependencias (→ = "depende de / debe existir antes"):

1. **Migración `004_cii.sql` + tipos + API del store** ({pkg.store}): tabla `cii_snapshots`, `CiiSnapshotRow` (camelCase wire), `insertCiiSnapshots`/`getLatestCii`/`getCiiTrend`/`getPriorCii`, extensión de `purgeAndDownsample`. Bloquea todo lo demás.
2. **Config editorial {cii.blend.config} + coeficientes {cii.coeffs}** (`blend.config.ts`, `coefficients.ts`): `EVENT_WEIGHTS` (suma 1 + test), `FLOOR_FACTORS`, `COMPOSITE`, `decayWeight`, `BOOST`, `ECONOMIC_SECTIONS`, `SOCIAL_MIX`, `COUNTRY_COEFFS`, `DEFAULT_COEFF`, `COMPONENT_REGISTRY`. Independiente; puede ir en paralelo a (1). Aquí se materializa el mapeo sub-señal→fuente (D-201).
3. **Motor {pkg.core.cii}**: `compute{Conflict,Social,Economic,Political}Component`, `computeCii`, `computeDynamic`, `computeAllCountries`. Depende de (1) (lee {cii.bridge}/{store.signals}, tipos) y (2) (config/coeficientes). Núcleo; testeable con events+signals sembrados.
4. **Job del scheduler** ({pkg.scheduler}) en el tier medium {sched.tier}: orquesta (3)→(1). Depende de (1) y (3). Se registra junto a eonet/gdelt/gkg.
5. **Endpoints en `server.ts`**: `/api/cii`, `/api/cii/:country`. Dependen de (1). **Fichero de alto conflicto** → serializar el toque del registro de rutas.
6. **Capa {web.cii.layer} + panel de riesgo** ({pkg.web}): entrada en {web.layers.config} (D-213/OQ-6) + panel responsive (camelCase). Depende de (5); puede avanzar contra mock mientras (5) madura.
7. **Enriquecimiento del briefing** ({ai.briefing.ctx} en {pkg.core.ai}): `buildRiskContext` + inserción en `serializeContext`. Depende de (1) (lee getLatestCii). Independiente de (6).

Orden serial seguro para un solo dev: 1 → 2 (paralelo) → 3 → 4 → 5 → (6 y 7 en paralelo). Ficheros de alto conflicto a serializar: `server.ts`, {web.layers.config}, las migraciones del store, el `index.ts` del store.

Diagrama de flujo de datos (texto/ASCII):

```
        store (poblado por Fase 1 + rebanadas 1/2 de Fase 2)
   events (USGS/EONET/GDELT)        signals (GKG)            news_items / markets
   country+severity REALES          sections + AvgTone        (temperatura global)
   eventType conflict/protest/        |                          |
    earthquake/wildfire               |                          |
        | getEventsByCountry({cii.bridge})   getSignals(section) |
        v                             v                          v
   +-------------------------------------------------------------------+
   |                        {pkg.core.cii}                             |
   |  conflict  <- events:conflict (sev + Goldstein, decay 30d)        |  {cii.decay} vida-media 30d
   |  social    <- events:protest + GKG:political_instability + boosts |  {cii.boost} EQ/fire (USGS/EONET)
   |  economic  <- GKG:commodities+trade+minerals (vol x AvgTone)      |  {cii.floors} ausencia != 0
   |  political <- GKG:political_instability + info-temp global        |  {cii.presence}+{cii.renorm}
   |  computeCii: {cii.composite} = baseline*0.4 + eventScore*0.6      |  EVENT_BLEND suma 1 (D-207)
   |  computeDynamic vs ~24h  -> {cii.dynamic} + {cii.deadband}        |  methodologyVersion='cii-core-1'
   +--------------------------------+----------------------------------+
                                    | persiste ANTES de servir (ADR-004)
                                    v
   +----------------------------------+
   |          {pkg.store}             |  cii_snapshots (004_cii.sql, ix_cii_country_time)
   |  insertCiiSnapshots / getLatest  |  <-- corre en tier MEDIUM {sched.tier} junto a
   |  getCiiTrend / getPriorCii       |      eonet/gdelt/gkg (D-211)
   +----------------+-----------------+
        |  solo-lectura del store          \  getLatestCii
        v  (D-212)                          v
   +------------------------+        +--------------------------+
   |       server.ts        |        |     {pkg.core.ai}        |
   |  GET /api/cii          |        |  buildRiskContext ->     |
   |  GET /api/cii/:country |        |  serializeContext (D-005)|
   +-----------+------------+        +--------------------------+
               | HTTP (la web NUNCA recalcula)
               v
   +----------------------------------+
   |            {pkg.web}             |  {web.cii.layer} por país en {web.layers.config} (D-213)
   |  panel de riesgo (responsive):   |  bandas 0-24/25-49/50-69/70-100 (render)
   |  top países + flecha de trend    |  estados loading/empty/error (camelCase wire)
   +----------------------------------+
```

## Known Gaps / Open Questions

> Lo que este diseño NO resuelve y las decisiones internas que el PM debe ratificar. Evita confianza alucinada.

Fuera de esta rebanada (con razón):

- **GAP-1 — Componente Security**: ninguna fuente del store da militar/aviación/GPS-jam (NG-3). NO se modela hoy; se añade como 5º componente cuando aterrice su fuente (re-normalizando `EVENT_WEIGHTS` a suma 1).
- **GAP-2 — Mejora keyed de Conflict/Unrest (ACLED/UCDP) y economic (OFAC)**: ACLED/UCDP darían eventos de conflicto/protesta con muertes y mejores floors; OFAC daría sanciones reales. Son rebanadas keyed posteriores que **refinan** las fuentes de los componentes ya presentes (`COMPONENT_REGISTRY.refinedBy`), sin reescribir el motor (NG-2).
- **GAP-3 — Cobertura GKG en semis/cyber para economic**: `semis_ai_tech` y `digital_infra_cyber` quedan fuera de economic (cobertura keyword-débil, R-3). Reincorporarlos a economic (o crear un componente tech) es trabajo de calibración posterior.
- **GAP-4 — Motor de convergencia cross-domain (INVESTIGACION §9.1)**: el CII es **input** de la convergencia; el matching ≥2-fuentes/72h NO se construye aquí (NG-1). Sigue siendo el spike de mayor riesgo, pendiente de su propio Research→Plan→Check.
- **GAP-5 — Calibración cuantitativa con `intel-analyst`**: los valores de partida (pesos, floors, decay, mezclas, caps) son editoriales razonados, no validados contra histórico (R-1/NG-7). Sesión de calibración pendiente cuando se acumulen ≥semanas de snapshots.

Open Questions (decisiones internas a ratificar por el PM):

- **OQ-1 (mapeo sub-señal→fuente y pesos intra-componente)**: ¿el mapeo de D-201 (conflict←events:conflict; social←events:protest+GKG:political_instability 0.6/0.4; economic←GKG:commodities+trade+minerals×AvgTone; political←GKG:political_instability+info-temp) y los pesos intra-componente son correctos? Recomendación: como en D-201. Bloquea la forma de los `compute*Component`. **OQ-1b**: ¿economic/political estrictamente por-país (descartar GKG sin país) o por-país-con-piso-global (recomendado, D-202)?
- **OQ-2 (clave de país)**: ¿`EventRow.country` directo (recomendado, D-203) vs normalizar a ISO-3166 explícito? Recomendación: directo hoy; normalizar solo si R-2 (heterogeneidad GDELT-FIPS vs USGS/EONET-ISO) se materializa. Afecta a todas las queries, al bridge y a la capa del mapa.
- **OQ-3 (componentes presentes hoy)**: ¿declarar los 4 componentes presentes (recomendado, D-204) vs arranque conservador conflict+political? Recomendación: los 4 (todos tienen fuente real); `signalPresent` se evalúa en runtime por presencia de datos en la ventana.
- **OQ-4 (FLOORS por componente)**: ¿los `floorFactor` por componente (D-205) y su escalado por `baselineRisk`? Recomendación: floors suaves escalados por baseline; valores concretos en calibración (GAP-5). **OQ-4b (decay)**: ¿vida-media 30d (recomendado, D-206) vs otra? Recomendación: 30d (Conflict persiste semanas).
- **OQ-5 (tier del job)**: ¿tier **medium** (recomendado, D-211, cambia respecto al doc viejo) vs daily? Recomendación: medium, porque Conflict es ahora volátil (GDELT 15min). Afecta a la frecuencia del cálculo y al crecimiento de `cii_snapshots`.
- **OQ-6 (geometría de la capa)**: ¿`fill` coroplético con GeoJSON de países (recomendado si ya existe el GeoJSON) vs `circle` por centroide (D-213)? Recomendación: lo que {web.layers.config} ya tenga disponible; no forzar dependencia GeoJSON nueva. Afecta a la entrada en {web.layers.config}.

## PLANNING COMPLETE
