---
version: alpha
name: global-events
description: Diseño de la capa de eventos globales multi-fuente de Fase 2 (ADR-010) — el núcleo del proyecto: información de eventos de todo el mundo que afectan economía y seguridad, geo-localizados, severity-scored y persistidos como time-series. Define un MODELO DE EVENTO UNIFICADO (una tabla `events` general con id estable, source, event_type/category, severity normalizada 0..100 en escala común, lat/lon, country, occurred_at/captured_at, title/url y raw_json para lo específico) que reemplaza la tabla `gdelt_events` financiera de Fase 1 vía migración con retro-compat. Aterriza SOLO las fuentes que la verificación en vivo marcó keyless+geo-real+ligeras para el MVP de esta capa — USGS earthquakes, NASA EONET (13 categorías de desastre natural) y GDELT 2.0 raw Events CSV (reemplazo de la GEO API muerta, conflicto/político con coords reales del suceso) — y difiere a fases posteriores las keyed/gated (ReliefWeb appname-gated, UCDP/ACLED key+ToS) con su razón. Propone el mapeo de severity entre fuentes heterogéneas (magnitud sísmica vs categoría de incendio vs Goldstein/QuadClass de conflicto → 0..100), persistencia time-series reusando el patrón de ADR-004, tiers de scheduler por volatilidad (terremotos rápido, desastres medio, conflicto medio), capas MapLibre por TIPO de evento en el config-array central coherente con D-008, endpoints solo-lectura `/api/events`, enriquecimiento del briefing con contexto de riesgo global, y el mapeo de esta capa a los componentes Conflict/Security/Unrest + boosts earthquake/fire del CII (que se reordena DESPUÉS). El motor de convergencia cross-domain sigue siendo Non-Goal. El bloque estructurado (Decisions, Interfaces, Do/Don't) es normativo; la prosa explica el porqué.
status: draft
date: 2026-06-13
owner: system-architect
---

## Overview

Este documento diseña la **capa de eventos globales multi-fuente**, primera rebanada de Fase 2 según ADR-010. El problema que resuelve es entregar la **función núcleo del proyecto**: información de eventos de todo el mundo que afectan economía y seguridad — conflicto/político (disturbios, revueltas, guerras, manifestaciones) y natural/humanitario (terremotos, inundaciones, incendios, tormentas) — geo-localizada con coordenadas reales del suceso, puntuada con una severidad comparable entre tipos heterogéneos, y persistida como time-series para que la UI lea del store local (el diferencial del proyecto, ADR-004). Resuelve también el problema estructural heredado de Fase 1: la tabla `gdelt_events` es financiera y geocodea por país-fuente (centroide del medio que publica), y la GDELT GEO API que daría coords reales por evento murió; esta capa la sustituye por un modelo de evento general alimentado por GDELT 2.0 raw Events CSV (coords del suceso).

El resultado deseado es: (1) un **modelo de evento unificado** —una tabla `events` con id estable por fuente, `source`, `event_type`, `category`, `severity` normalizada `0..100`, `lat/lon`, `country`, `occurred_at`/`captured_at`, `title/url` y `raw_json` para lo específico de cada fuente— que reemplaza `gdelt_events` mediante migración; (2) **tres conectores keyless patrón osiris** que la verificación en vivo validó como aptos para esta rebanada —USGS earthquakes (`packages/connectors/geo/usgs.ts`), NASA EONET (`packages/connectors/geo/eonet.ts`) y GDELT raw Events CSV (refactor de `packages/connectors/geo/gdelt.ts`)— cada uno con su **normalizador de severity** a la escala común; (3) persistencia time-series con dedup por evento y retención reusando ADR-004; (4) **tiers de scheduler por volatilidad** para las nuevas fuentes; (5) **capas MapLibre por tipo de evento** declaradas en el config-array central (D-008); (6) endpoints `GET /api/events` de solo-lectura del store + enriquecimiento del briefing con contexto de riesgo global; y (7) el **mapeo de esta capa a los componentes Conflict/Security/Unrest y boosts earthquake/fire del CII**, que se reordena después y consume esta capa. El motor de convergencia cross-domain sigue siendo Non-Goal. No es código: es la especificación que el PM convierte en plan y pasa por `/check-plan` antes de implementar.

## Token-references (bloque canónico)

Cada token se define aquí como `leaf: valor`; las referencias entre llaves del resto del doc (de la forma namespace-punto-leaf) resuelven contra estas definiciones.

Paths del monorepo (existentes y nuevos):

- store: `packages/store/` — referido como {pkg.store}
- scheduler: `packages/scheduler/` — referido como {pkg.scheduler}
- web: `packages/web/` — referido como {pkg.web}
- ai: `packages/core/ai/` — referido como {pkg.core.ai}
- cii: `packages/core/cii/` (rebanada POSTERIOR; aquí solo se referencia como consumidor del bridge) — referido como {pkg.core.cii}
- usgs: `packages/connectors/geo/usgs.ts` (conector nuevo) — referido como {conn.usgs}
- eonet: `packages/connectors/geo/eonet.ts` (conector nuevo) — referido como {conn.eonet}
- gdelt: `packages/connectors/geo/gdelt.ts` (refactor de Fase 1 a raw Events CSV) — referido como {conn.gdelt}
- centroids: `packages/connectors/geo/country-centroids.ts` (existente, ~65 países) — referido como {geo.centroids}
- severity: `packages/connectors/geo/severity.ts` (mapeo de severity por fuente a {evt.severity}) — referido como {evt.severity.map}
- layers: `packages/web/src/map/layers.config.ts` (config-array central existente) — referido como {web.layers.config}

Valores y decisiones compartidas:

- table: tabla `events` time-series general que reemplaza `gdelt_events` — referida como {evt.table}
- evtid: clave de evento estable `(source, source_event_id)` que identifica un evento upstream a través de capturas — referida como {evt.id}
- source: columna `source` (TEXT) `'usgs'|'eonet'|'gdelt'` que identifica la fuente — referida como {evt.source}
- type: columna `event_type` (TEXT) en taxonomía propia unificada (`earthquake|wildfire|flood|storm|volcano|conflict|protest|...`) — referida como {evt.type}
- category: columna `category` (TEXT) de dos valores `'natural'|'conflict'` (familia macro del evento) — referida como {evt.category}
- severity: columna `severity` (REAL `0..100`, clamp duro) — severidad normalizada comparable entre fuentes — referida como {evt.severity}
- occurred: columna `occurred_at` (epoch ms) = instante en que ocurrió el evento upstream — referida como {evt.occurred}
- ts: columna `captured_at` (epoch ms, INTEGER) = instante de captura del snapshot (patrón ADR-004) — referida como {schema.snapshot.ts}
- raw: columna `raw_json` (TEXT) con el payload específico de fuente que no cabe en columnas comunes — referida como {evt.raw}
- timeout: `AbortSignal.timeout(8000)` en todo fetch de conector — referida como {api.connector.timeout}
- etag: cache condicional (`If-None-Match`/`If-Modified-Since`) + fallback al store, patrón de Fase 1 — referida como {conn.cache.etag}
- tiers: tiers de frecuencia por volatilidad del scheduler (fast/medium/slow/daily) reusados de Fase 1 — referida como {sched.tiers}
- attribution: el bloque de atribución de fuentes (USGS/NASA/GDELT) requerido por sus ToS, mostrado en la UI — referido como {evt.attribution}
- briefingctx: el bloque "contexto de riesgo de eventos globales" que esta capa aporta a `serializeContext` del briefing — referido como {ai.briefing.ctx}
- ciibridge: el contrato por el que esta capa alimenta los componentes Conflict/Security/Unrest y boosts earthquake/fire del CII — referido como {cii.bridge}

Variante de estado:

- `{evt.table}-stale` = los últimos eventos válidos servidos desde {evt.table} cuando un conector falla upstream (leaf `table`, ya definido arriba).

## Goals

- **G-1**: Modelo de evento **unificado** en {pkg.store} ({evt.table}) que persiste eventos heterogéneos (sísmicos, desastres naturales, conflicto/político) con columnas comunes ({evt.id}, {evt.source}, {evt.type}, {evt.category}, {evt.severity}, lat, lon, country, {evt.occurred}, {schema.snapshot.ts}, title, url, {evt.raw}) y reemplaza `gdelt_events` vía migración con retro-compat de las queries de Fase 1.
- **G-2**: Tres conectores **keyless** patrón osiris que la verificación en vivo validó: {conn.usgs} (earthquakes, geo exacto por epicentro), {conn.eonet} (13 categorías de desastre natural, geo por evento) y {conn.gdelt} refactorizado a **GDELT 2.0 raw Events CSV** (conflicto/político con coords del suceso, reemplazo de la GEO API muerta), cada uno con {api.connector.timeout} + {conn.cache.etag} + fallback {evt.table}-stale + retorno vacío gracioso.
- **G-3**: **Normalización de severity** {evt.severity.map} — un mapeo documentado de la métrica nativa de cada fuente (magnitud/`sig`/`alert` PAGER sísmico; `magnitudeValue`+categoría EONET; `GoldsteinScale`/`QuadClass`/`AvgTone` GDELT) a la escala común {evt.severity} `0..100`, comparable entre tipos.
- **G-4**: Persistencia time-series de eventos con **dedup por {evt.id}** (UNIQUE), índices para "eventos recientes", "por tipo" y "por país", y retención reusando el patrón de ADR-004 (purge/downsample del tier daily extendido a {evt.table}).
- **G-5**: **Tiers de scheduler por volatilidad** {sched.tiers} para las nuevas fuentes (USGS rápido por su `max-age=60`, EONET y GDELT medio), sin fanout en navegador, persistiendo cada captura ANTES de servir.
- **G-6**: **Capas MapLibre por tipo de evento** declaradas como entradas en {web.layers.config} (terremotos / incendios / inundaciones / tormentas / conflicto / protesta …) con toggles por capa, coherente con D-008, responsive mobile-first (ADR-008), iteradas por el render (nunca imperativas).
- **G-7**: Endpoints `GET /api/events` (+ filtros por tipo/categoría/bbox/since) de **solo-lectura del store** que la web consume, y {evt.attribution} mostrado en la UI según los ToS de cada fuente.
- **G-8**: Enriquecimiento del briefing — {pkg.core.ai} consume {ai.briefing.ctx} (eventos de mayor severidad/recencia desde el store) para grounding del bloque de riesgo global, sin añadir proveedor LLM nuevo (ADR-009).
- **G-9**: **Contrato {cii.bridge}** que mapea esta capa a los componentes Conflict/Security/Unrest y boosts earthquake/fire del CII —documentado aquí, consumido por la rebanada CII posterior— de modo que activar un componente del CII sea consumir {evt.table}, no reescribir el motor.

## Non-Goals

- **NG-1**: **Motor de convergencia cross-domain** (INVESTIGACION §9.1 / §6.5): el matching geográfico-temporal + scoring de señales que cruza finanzas+geopolítica+desastre. Razón: worldmonitor NO sirve esa lógica (seed loops Railway, parcialmente documentada), es la pieza de mayor riesgo del plan y exige su propio spike Research→Plan→Check. Esta capa es **input** de la convergencia (eventos geo+severity+time), no la convergencia.
- **NG-2**: **Re-implementación del motor CII** (`packages/core/cii`). Razón: el CII se reordena DESPUÉS de esta capa (ADR-010) y tiene su propio design-doc (`2026-06-13-cii-scoring.md`). Aquí solo se define el **contrato {cii.bridge}** que el CII consumirá; el scoring CII no se construye en esta rebanada.
- **NG-3**: **ReliefWeb (UN OCHA) disasters**. Razón: la verificación en vivo confirmó que desde 2025-11-01 exige un `appname` **pre-aprobado por OCHA** (registro editorial manual, 3-5 días) → no es keyless, bloquea el MVP de esta capa; además NO da lat/lon por evento (solo `country.iso3` = mismo nivel que centroides). Candidata a fase posterior una vez solicitado el appname (cobertura de epidemias/inundaciones/sequías + CC BY 4.0 es excelente). Marcada para reactivación en Known Gaps GAP-1.
- **NG-4**: **UCDP y ACLED (conflicto armado keyed)**. Razón: UCDP requiere token gratuito por email (3-5 días) — no keyless; ACLED no resolvió DNS desde esta máquina y sus **ToS no fueron verificables** (PDFs 404) → GUARDRAIL de datos activo (feedback_data_tos: ToS no verificado = no conectar). Son la mejor fuente para el componente Conflict/Unrest del CII, pero su activación es una rebanada keyed posterior con acción manual del usuario (registro) + verificación de ToS. Ver GAP-2.
- **NG-5**: **GDELT GKG (Global Knowledge Graph)** (`gkg.csv.zip`, 1.86 MB) y **Mentions** (`mentions.CSV.zip`). Razón: la verificación marcó el GKG como pesado (1.86 MB/15min) frente al `export.CSV.zip` de Events (26 KB); para eventos geo+severity solo se necesita el Events export. El GKG (grafo de temas/tono) es una rebanada distinta si se quisiera análisis temático.
- **NG-6**: **PAGER detail / datos de muertes y daño económico por evento** (endpoint USGS separado por evento; campos `deaths`/`affected` de fuentes humanitarias). Razón: requieren un fetch adicional por evento (N+1) o fuentes gated; para esta rebanada `mag`+`alert`(PAGER)+`sig` son proxy suficiente de impacto. El detalle por evento es una rebanada de enriquecimiento posterior.
- **NG-7**: **Reverse-geocode preciso de evento → país por point-in-polygon**. Razón: USGS/EONET dan `place`/coords pero no ISO país; GDELT da `ActionGeo_CountryCode`. La columna `country` se rellena con el código que la fuente ya provee (GDELT) o se deriva por nearest-centroid contra {geo.centroids} (USGS/EONET) — point-in-polygon con polígonos de país es una mejora de la rebanada de geocodificación, no de esta.
- **NG-8**: **ML cliente** (Transformers.js/ONNX clasificación de eventos), empaquetado Tauri, servidor MCP, y nuevos dominios completos (Educación/Política con paneles propios). Razón: Fases 3-4 (alineado con NG-7 del MVP).

## Context / Constraints

- **Hechos verificados EN VIVO de las fuentes (2026-06-14)** — restricción dominante; se diseña sobre esto, no sobre suposiciones (lección ADR-010: la GDELT GEO API murió por asumir):
  - **USGS earthquakes** (`earthquake.usgs.gov/.../feed/v1.0/summary/*.geojson`): HTTP 200, **keyless total**, CORS abierto, **Public Domain** (atribución `"U.S. Geological Survey"`). GeoJSON `Point` con coords reales del epicentro (lon, lat, depth). Campos clave: `mag`, `sig` (0..1000+), `alert` (PAGER green/yellow/orange/red), `tsunami`, `felt`, `mmi`, `cdi`, `place`, `time` (epoch ms), `status` (`automatic`/`reviewed`). Dos feeds: `all_day` (~210 eventos, 150 KB) y `significant_week` (4 eventos, 3.4 KB). `Cache-Control: max-age=60` → no pedir >1/min.
  - **NASA EONET v3** (`eonet.gsfc.nasa.gov/api/v3/events`): HTTP 200 keyless (503 transitorio con `limit=50`; estable con `limit<=20`). **Dominio público** (17 U.S.C. §105), disclaimer "visualization only". JSON nativo + endpoint `/geojson`. 13 categorías (wildfires, volcanoes, severeStorms, floods, earthquakes, drought, landslides, seaLakeIce, tempExtremes, dustHaze, snow, waterColor, manmade). Campos: `id`, `title`, `categories[].id`, `geometry[].coordinates [lon,lat]`, `geometry[].date`, `magnitudeValue`+`magnitudeUnit` (varían por categoría: acres, hectáreas, mb…), `closed` (null=abierto). Sin severity normalizada ni muertes. Payload ligero (~3.6 KB/5 eventos). Atribución: `"Data: NASA EONET"`.
  - **GDELT 2.0 raw Events CSV** (`data.gdeltproject.org/gdeltv2/lastupdate.txt` → URL del último `export.CSV.zip`): HTTP 200 **keyless**, **uso libre con citación** a GDELT + enlace. **Coords reales del suceso** (`ActionGeo_Lat` col 56, `ActionGeo_Long` col 57 — NO centroide país-fuente). CSV **tab-separated, 61 columnas, SIN header** (codebook por índice fijo). Campos: `GlobalEventID` (col 0), `SQLDATE` (col 1), `Actor1Name/CountryCode` (6/7), `EventCode` (26), `QuadClass` (29: 1 verbal-coop, 2 material-coop, 3 verbal-conf, 4 material-conf), `GoldsteinScale` (30: -10..+10), `AvgTone` (34), `ActionGeo_FullName` (52), `ActionGeo_CountryCode` (53), `SOURCEURL` (60). ~415 registros/batch, 26 KB comprimido, `Cache-Control: max-age=3600` + `ETag` (descargas condicionales). Cadencia natural 15 min.
  - **ReliefWeb**: API v1 = **410 Gone**; v2 = **403** sin `appname` pre-aprobado (registro editorial desde 2025-11-01). Sin lat/lon por evento. CC BY 4.0. → DIFERIDA (NG-3).
  - **UCDP**: HTTP **401**, token gratuito por email (3-5 días), CC BY 4.0, geo real + muertes, solo conflicto armado (no protestas). **ACLED**: DNS no resuelve, **ToS no verificable** → GUARDRAIL. → DIFERIDAS (NG-4).
- **Estado real del store tras Fase 1** (verificado en código, 2026-06-13): tablas `market_snapshots`, `gdelt_events`, `news_items`, `briefings`, `market_daily`, `_migrations`. `gdelt_events` es **financiero** (query economy/market/finance), geocodea por **país-fuente** (centroide del medio, no del suceso), `category` = dominio del medio, `severity` = siempre null. Esta capa **lo reemplaza** por {evt.table} general (D-100).
- **Stack bloqueado** (ADR-003): TypeScript, monorepo pnpm `@www/*`, Vite, React + MapLibre GL, Node single-server (`server.ts`), router LLM. Conectores patrón osiris: 1 fichero/fuente, fetch + {api.connector.timeout} + fallback + retorno vacío gracioso + cache/ETag.
- **Persistencia bloqueada** (ADR-006): `@libsql/client`, `url: file:./data/world.db`. Prohibido `better-sqlite3`. La UI lee del store, nunca de upstream (ADR-004).
- **IA bloqueada** (ADR-009): proveedor activo del router = **openai** (`OPENAI_API_KEY`/`OPENAI_MODEL`); claude/groq/ollama como ramas inactivas. Esta capa enriquece el briefing existente, no añade modelo.
- **Licencia** (ADR-002, feedback_no_agpl_copy): worldmonitor = AGPL-3.0; solo metodología re-implementada en nuestras palabras (taxonomía de eventos, mapeo de severity, bridge al CII), NUNCA copiar fuente. osiris = MIT (copiable).
- **Datos ≠ licencia** (feedback_data_tos): USGS/NASA = dominio público (atribución requerida); GDELT = libre con citación; ReliefWeb/UCDP/ACLED gated o no-verificados (diferidos). La atribución {evt.attribution} se muestra en la UI.
- **Zero-key-first** (feedback_zero_key_first): los tres conectores de esta rebanada son keyless; las fuentes con key (UCDP/ACLED) degradan, no rompen — se difieren a rebanadas keyed posteriores.
- **Capas de mapa** (ADR-008 / feedback_central_layer_config): config-array central {web.layers.config}; UI responsive mobile-first.
- **Entorno**: Windows (win32). Los conectores son TypeScript puro (fetch + parse); riesgo toolchain bajo. Dependen del `@libsql/client` ya validado en Fase 1. El parser CSV de GDELT no requiere dependencia nativa (split por tab + índice fijo).

## Decisions

> Las decisiones **bloqueadas** (no-negociables) heredan de los ADRs base y de `memory/feedback_*.md`; el ADR fuente se cita una vez. Las decisiones **internas abiertas** (numeradas desde el centenar) son recomendación del arquitecto; el PM decide (alternativas/tradeoffs en Interfaces y Known Gaps). Cada `D-NNN` aparece una sola vez; el resto del doc refiere por contenido o token.

Bloqueadas (no-negociables):

- **D-001** (ADR-010): la 1ª rebanada de Fase 2 es la **capa de eventos globales multi-fuente** (conflicto/político + natural/humanitario), geo-localizada + severity-scored + time-series, con **modelo de evento unificado** que alimenta mapa + briefing + CII — porque es la función núcleo del proyecto y desbloquea los componentes data-starved del CII; el CII se reordena después.
- **D-002** (ADR-010 / feedback_data_tos): cada fuente se **verifica EN VIVO antes de diseñar**; solo entran las **keyless + geo-real + ligeras** (USGS, EONET, GDELT raw CSV); las keyed/gated (ReliefWeb, UCDP, ACLED) se difieren — porque la lección de la GDELT GEO API muerta es no asumir, y zero-key-first restringe el MVP de la capa a fuentes sin key con ToS verificado.
- **D-003** (ADR-004): los conectores corren server-side en el scheduler, persisten cada captura en {evt.table} y la UI lee del store, nunca de upstream — porque desacopla la frescura de la pestaña y habilita el histórico de eventos (el diferencial).
- **D-004** (ADR-006): la persistencia usa `@libsql/client` sobre `file:./data/world.db` con el patrón time-series ({schema.snapshot.ts} epoch ms) — porque libSQL es Turso (migrar = cambiar URL) y mantiene un único motor de persistencia.
- **D-005** (ADR-003 / feedback_central_layer_config): las capas de evento del mapa se declaran como entradas en {web.layers.config}, iteradas por el render, nunca `map.on('load')` imperativo — porque corrige la debilidad de osiris (capas dispersas) y el `verifier` comprueba este wiring.
- **D-006** (ADR-002 / feedback_no_agpl_copy): la taxonomía de eventos {evt.type}, el mapeo de severity {evt.severity.map} y el bridge {cii.bridge} se **re-derivan en nuestras palabras** — porque las ideas/fórmulas no son copyrightables pero el código y el texto editorial de worldmonitor (AGPL) sí; se re-implementa, no se copia.
- **D-007** (ADR-009): esta capa **no introduce proveedor LLM nuevo**; enriquece el briefing existente vía {ai.briefing.ctx} con la rama activa openai — porque el router es multi-proveedor pero esta rebanada no es el lugar para cambiar proveedor.

Internas (recomendación del arquitecto; el PM decide):

- **D-100**: el modelo de evento es **una tabla `events` general unificada** {evt.table} con columnas comunes tipadas + `raw_json` {evt.raw} para lo específico de fuente, que **reemplaza** `gdelt_events` — porque eventos heterogéneos (sísmico/desastre/conflicto) comparten un núcleo (qué, dónde, cuándo, cuán severo) y diseñar una tabla por fuente explotaría el nº de tablas y rompería las queries unificadas del mapa/briefing/CII; el `raw_json` absorbe los campos idiosincrásicos sin migrar el schema por cada fuente. Alternativas: tabla-por-fuente (descartada: query del mapa tendría que unir N tablas) y EAV genérico (descartado: pierde índices por tipo/país). Ver Interfaces y OQ-1.
- **D-101**: la migración a {evt.table} es **`003_events.sql`** que **crea `events`, migra las filas de `gdelt_events` que tengan geo válido al nuevo schema (mapeando a `event_type='news_finance'`, `category='conflict'` provisional, severity por AvgTone si disponible) y deja `gdelt_events` como vista o la dropa tras migrar** — porque ADR-010 dice "posible refactor de `gdelt_events`" y el dato financiero de Fase 1 no debe perderse, pero la tabla nueva es la fuente de verdad. Recomendación: migrar filas + DROP de la tabla vieja + actualizar las queries de Fase 1 (`getGdeltEvents`) a leer de {evt.table} filtrando por source. Alternativas: mantener ambas tablas en paralelo (descartado: duplica la capa de eventos) y dropear sin migrar (descartado: pierde histórico financiero). Ver OQ-2.
- **D-102**: la **taxonomía {evt.type}** es propia, dos niveles: {evt.category} macro (`'natural'|'conflict'`) + {evt.type} específico (`earthquake|wildfire|flood|storm|volcano|landslide|drought|tempExtreme|conflict|protest|assault|coercion|threat|...`) mapeada desde la fuente — porque un mapa con toggles por tipo y un CII que distingue Conflict de boosts-de-desastre necesitan un tipo discreto estable, y derivarlo de los campos nativos (EONET `categories[].id`, GDELT `EventCode`/`RootCode`/`QuadClass`) en el conector mantiene el resto del sistema agnóstico a la fuente. Ver Interfaces para el mapeo y OQ-3.
- **D-103**: la **severity {evt.severity} es `0..100` con clamp duro**, normalizada por fuente en {evt.severity.map}, con esta re-derivación editorial propia (no copiada): **USGS** = combinación de `mag` y `alert` PAGER — `sig`/10 acotado, con piso por `alert` (green→+0, yellow→≥40, orange→≥65, red→≥85) y `tsunami=1`→+10; **EONET** = por categoría con normalización log de `magnitudeValue` dentro de su unidad (p.ej. wildfire acres, storm mb) a una banda por tipo, ya que las unidades no son comparables crudas; **GDELT** = función de `QuadClass` (material-conflict domina) + `|GoldsteinScale|` negativo + `AvgTone` negativo, mapeada a `0..100` — porque la severidad debe ser **comparable entre tipos** para ordenar el briefing y alimentar el CII, y cada fuente tiene una métrica nativa incomparable cruda; la normalización a una escala común es la decisión central de esta capa. Alternativa: dejar la métrica nativa sin normalizar (descartada: imposible comparar un M5.0 con una protesta o un incendio de 8000 acres). Ver Interfaces (tabla de mapeo) y OQ-4.
- **D-104**: la **clave de dedup {evt.id}** es `(source, source_event_id)` con UNIQUE; `source_event_id` = `id` USGS (`hv74978947`), `id` EONET (`EONET_20442`) o `GlobalEventID` GDELT (`1308902050`) — porque cada captura del scheduler re-trae eventos ya vistos; deduplicar por id estable de fuente evita filas duplicadas y permite **UPSERT** (actualizar severity/status cuando un evento USGS pasa de `automatic` a `reviewed`, o un EONET de abierto a `closed`). La columna {schema.snapshot.ts} registra la última captura; {evt.occurred} el instante real del evento. Alternativa: append puro con `(id, captured_at)` UNIQUE (descartado: infla la tabla con N copias del mismo terremoto). Ver OQ-5.
- **D-105**: los **tiers de scheduler** {sched.tiers} para esta capa: **USGS → `fast`** (~5 min, respeta su `max-age=60`), **EONET → `medium`** (~15-30 min, eventos de días/semanas), **GDELT → `medium`** (15 min, cadencia natural del export + `ETag`) — porque la volatilidad real difiere: terremotos aparecen en minutos, desastres EONET evolucionan en días, GDELT publica cada 15 min; reusa los tiers ya existentes de Fase 1 sin inventar tier nuevo. El tier `daily` extiende su purge/downsample a {evt.table}. Alternativa: tier propio por fuente (descartado: sobre-ingeniería; 3 fuentes caben en los tiers existentes). Ver OQ-6.
- **D-106**: las **capas del mapa** se declaran como **una entrada por tipo de evento** en {web.layers.config} (terremotos, incendios, inundaciones, tormentas, volcanes, conflicto, protesta…), cada una con su `visibleWhen` por toggle y su geometría (`circle`/`heatmap` por punto, color/tamaño por {evt.severity}) — porque D-008 exige el config-array central y el usuario quiere toggles por tipo; iterar el array para pintar una capa por tipo mantiene el render agnóstico y permite añadir un tipo = añadir una entrada. La capa lee `/api/events` filtrado por tipo. Alternativa: una sola capa con todos los eventos coloreados por tipo (descartado: pierde el toggle independiente por tipo que el usuario pidió). Ver OQ-7.
- **D-107**: `GET /api/events` devuelve **eventos del store filtrables por `type`/`category`/`bbox`/`since`/`minSeverity`**; nunca dispara conectores on-request — porque honra "la API es solo-lectura del store" (ADR-004) y el fetch vive solo en el scheduler; los filtros se resuelven con los índices de {evt.table}. Un endpoint `GET /api/events/:source/:id` devuelve el detalle ({evt.raw} parseado) de un evento. Alternativa: endpoint que recalcula/refetcha (descartado: rompe ADR-004). Ver Interfaces.
- **D-108**: el **contrato {cii.bridge}** se documenta aquí como **funciones de lectura de {evt.table} agrupadas por país** que el CII consumirá: `conflict` ← eventos GDELT {evt.type} de conflicto/protesta/asalto por país (QuadClass material) → componente Conflict/Unrest; `earthquakeBoost` ← eventos USGS por país con `alert`≥yellow → boost de severidad; `fireBoost` ← eventos EONET wildfire por país → boost — porque ADR-010 dice que esta capa "desbloquea los componentes Conflict/Security/Unrest del CII" y el design-doc CII los dejó como `unlockedBy` de conectores keyed; ahora el bridge concreta **qué query de {evt.table} activa cada uno**, de modo que la rebanada CII solo cambie `signalPresent=true` y consuma estas funciones. **Security** sigue degradado (requiere datos militares/aviación/GPS-jam que ninguna de estas 3 fuentes aporta — ver GAP-3). Ver Interfaces y OQ-8.

## Interfaces / Data Contracts

> Firmas y schema **normativos**. Tipos en pseudo-TS; el implementador los traduce. Los nombres de columna son contractuales (referenciados por tokens). Ningún valor, peso o texto procede de fuente AGPL: todo re-derivado.

Store — modelo de evento unificado ({pkg.store}, migración `003_events.sql`):

```sql
-- Eventos globales (time-series, dedup por evento). Reemplaza gdelt_events (D-100/D-101).
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT    NOT NULL,         -- {evt.source}: 'usgs'|'eonet'|'gdelt'
  source_event_id TEXT    NOT NULL,         -- id estable upstream (parte de {evt.id})
  event_type      TEXT    NOT NULL,         -- {evt.type}: 'earthquake'|'wildfire'|'conflict'|...
  category        TEXT    NOT NULL,         -- {evt.category}: 'natural'|'conflict'
  severity        REAL,                     -- {evt.severity} 0..100 (clamp duro); null si no calculable
  lat             REAL,                     -- coords reales del suceso (no centroide país-fuente)
  lon             REAL,
  country         TEXT,                     -- ISO/nombre de la fuente o nearest-centroid (NG-7); null si desconocido
  title           TEXT,                     -- 'M 4.7 - 23 km E of Papaikou' / título EONET / Actor+EventCode GDELT
  url             TEXT,                     -- SOURCEURL GDELT / link EONET / detalle USGS
  occurred_at     INTEGER,                  -- {evt.occurred} epoch ms (time/date/SQLDATE de la fuente)
  captured_at     INTEGER NOT NULL,         -- {schema.snapshot.ts} epoch ms (última captura)
  raw_json        TEXT,                     -- {evt.raw}: campos específicos de fuente
  UNIQUE (source, source_event_id)          -- {evt.id}: dedup + UPSERT (D-104)
);
CREATE INDEX IF NOT EXISTS ix_events_recent  ON events (captured_at);
CREATE INDEX IF NOT EXISTS ix_events_type    ON events (event_type, occurred_at);
CREATE INDEX IF NOT EXISTS ix_events_country ON events (country, occurred_at);
CREATE INDEX IF NOT EXISTS ix_events_sev     ON events (severity);
```

**Migración `003_events.sql` (D-101)**: (a) crea `events` + índices; (b) copia las filas de `gdelt_events` con `lat/lon` no-null a `events` (`source='gdelt'`, `source_event_id=event_id`, `event_type='news_finance'`, `category='conflict'`, `severity` derivada o null, `occurred_at` desde el dato de Fase 1); (c) DROP `gdelt_events`; (d) las queries de Fase 1 que leían `gdelt_events` (mapa/briefing) pasan a leer `events` filtrando `source='gdelt'`. Idempotente vía `_migrations`.

Store — API nueva ({pkg.store}, añade a `index.ts`, NO reescribe lo existente):

```ts
interface EventRow {
  source: 'usgs' | 'eonet' | 'gdelt';
  sourceEventId: string;
  eventType: string;        // {evt.type}
  category: 'natural' | 'conflict';
  severity: number | null;  // {evt.severity} 0..100
  lat: number | null; lon: number | null;
  country: string | null;
  title: string | null; url: string | null;
  occurredAt: number | null;   // {evt.occurred}
  capturedAt: number;          // {schema.snapshot.ts}
  rawJson: string | null;      // {evt.raw}
}
export async function upsertEvents(rows: EventRow[]): Promise<void>;            // UPSERT por {evt.id} (D-104)
export async function getEvents(filter: EventFilter): Promise<EventRow[]>;       // type/category/bbox/since/minSeverity
export async function getEvent(source: string, id: string): Promise<EventRow | null>;
export async function getEventsByCountry(sinceMs: number): Promise<Map<string, EventRow[]>>; // para {cii.bridge}
// purgeAndDownsample (existente) se EXTIENDE para purgar events > retención (D-105, patrón ADR-004).

interface EventFilter {
  type?: string; category?: 'natural' | 'conflict';
  bbox?: [number, number, number, number]; // [minLon,minLat,maxLon,maxLat]
  sinceMs?: number; minSeverity?: number; limit?: number;
}
```

Conectores — patrón osiris (keyless), contrato común (igual que Fase 1):

```ts
interface ConnectorResult<T> {
  data: T[];          // vacío en fallo gracioso, nunca throw hacia el caller
  stale: boolean;     // true si se sirvió {evt.table}-stale desde el store
  fetchedAt: number;  // epoch ms
}
// Todo fetch usa {api.connector.timeout} + User-Agent custom + {conn.cache.etag}.
export async function fetchUsgs():  Promise<ConnectorResult<EventRow>>;  // {conn.usgs}
export async function fetchEonet(): Promise<ConnectorResult<EventRow>>;  // {conn.eonet}
export async function fetchGdelt(): Promise<ConnectorResult<EventRow>>;  // {conn.gdelt} (raw Events CSV)
```

- **{conn.usgs}**: fetch `significant_week.geojson` (impacto) + `all_day.geojson` (volumen); parse GeoJSON `features`; mapea cada Feature a `EventRow` (`event_type='earthquake'`, `category='natural'`, severity por {evt.severity.map}, `occurred_at=properties.time`, `lat/lon` de `geometry.coordinates`, `raw_json` con `alert/sig/mmi/tsunami/depth`). Respeta `max-age=60` (tier fast no pide >1/min).
- **{conn.eonet}**: fetch `/api/v3/events/geojson?status=open&limit=20` (limit≤20 por el 503 con 50); mapea `categories[].id` → {evt.type} (D-102), `category='natural'`, severity por {evt.severity.map} (normalización log por categoría), `occurred_at` de `geometry[].date`. Eventos `closed!=null` se UPSERT con estado cerrado.
- **{conn.gdelt}** (refactor): poll `lastupdate.txt` → URL del `export.CSV.zip`; con `ETag`/`If-None-Match` (304 → reusa); descomprime ZIP; parsea **CSV tab-separated, 61 cols, SIN header, por índice fijo del codebook**; filtra registros con `ActionGeo_Lat/Long` no-null; mapea `EventCode`/`RootCode`/`QuadClass` → {evt.type} (D-102), `category='conflict'`, severity por {evt.severity.map}, `lat/lon`=ActionGeo (coords del suceso), `country`=ActionGeo_CountryCode, `url`=SOURCEURL, `source_event_id`=GlobalEventID, `occurred_at` desde SQLDATE.

Normalización de severity {evt.severity.map} (`packages/connectors/geo/severity.ts`) — **mapeo re-derivado propio, NO copiado** (D-103):

```ts
// Todas las funciones devuelven 0..100 con clamp duro. Valores editoriales propios, ajustables.
export function severityUsgs(p: { mag?: number; sig?: number; alert?: string; tsunami?: number }): number;
//   base = clamp(0,90, (sig ?? mag*100) / 11);  piso por alert: yellow>=40, orange>=65, red>=85; +10 si tsunami=1.
export function severityEonet(eventType: string, magnitudeValue?: number, magnitudeUnit?: string): number;
//   por categoría: banda base por tipo (volcano/severeStorm altos, dustHaze/snow bajos) + componente log del
//   magnitudeValue normalizado DENTRO de su unidad (acres, mb, hectáreas) — las unidades no se comparan crudas.
export function severityGdelt(p: { quadClass?: number; goldstein?: number; avgTone?: number }): number;
//   base por QuadClass (1->10, 2->20, 3->50, 4->75) + (|goldstein<0|)*2 + (|avgTone<0|) ; clamp 0..100.
```

| Fuente | Métrica nativa | → {evt.severity} 0..100 (re-derivado) |
|---|---|---|
| USGS | `mag`, `sig` (0..1000+), `alert` PAGER, `tsunami` | `sig`/11 con piso por `alert` (yellow≥40/orange≥65/red≥85) + tsunami +10 |
| EONET | `magnitudeValue`+`magnitudeUnit` por categoría | banda base por tipo + log(magnitudeValue) normalizado dentro de su unidad |
| GDELT | `QuadClass`, `GoldsteinScale`, `AvgTone` | base por QuadClass (material-conflict domina) + Goldstein negativo + AvgTone negativo |

Scheduler ({pkg.scheduler}) — jobs nuevos en tiers existentes {sched.tiers} (D-105):

```ts
// Tres Jobs nuevos (patrón Fase 1). Invariante: upsert en {evt.table} ANTES de servir (ADR-004).
//   { name:'usgs',  tier:'fast'   } -> fetchUsgs()  -> upsertEvents()
//   { name:'eonet', tier:'medium' } -> fetchEonet() -> upsertEvents()
//   { name:'gdelt', tier:'medium' } -> fetchGdelt() -> upsertEvents()
// El job 'gdelt' de Fase 1 (financiero) se REEMPLAZA por este. No fanout en navegador.
// El tier 'daily' extiende purgeAndDownsample para purgar events > retención.
```

server.ts — endpoints nuevos (solo-lectura del store, D-107):

```ts
GET /api/events                 -> getEvents(filter)   // ?type=&category=&bbox=&since=&minSeverity=&limit=
GET /api/events/:source/:id     -> getEvent(source,id) // detalle (raw_json parseado)
// El endpoint /api/gdelt de Fase 1 pasa a leer events filtrando source='gdelt' (retro-compat, D-101).
// Mismo pipeline de middleware existente (origin-check -> CORS -> rate-limit -> SSRF-guard -> route).
// NUNCA dispara conectores on-request.
```

Web ({pkg.web}) — capas por tipo en {web.layers.config} (D-106):

```ts
// Entradas NUEVAS en el config-array existente. El render itera LAYERS; añadir un tipo = añadir entrada.
// Geometría por punto (lat/lon reales); color/tamaño por {evt.severity}; toggle por tipo.
const EVENT_LAYERS: LayerSpec[] = [
  { id:'evt-earthquake', source:'events', type:'circle',  paint:{/* color/radius por severity */}, visibleWhen:(a)=>a.has('earthquake') },
  { id:'evt-wildfire',   source:'events', type:'heatmap', paint:{/* por severity */},              visibleWhen:(a)=>a.has('wildfire') },
  { id:'evt-flood',      source:'events', type:'circle',  paint:{},                                visibleWhen:(a)=>a.has('flood') },
  { id:'evt-storm',      source:'events', type:'circle',  paint:{},                                visibleWhen:(a)=>a.has('storm') },
  { id:'evt-conflict',   source:'events', type:'circle',  paint:{/* rojo por severity */},         visibleWhen:(a)=>a.has('conflict') },
  { id:'evt-protest',    source:'events', type:'circle',  paint:{},                                visibleWhen:(a)=>a.has('protest') },
  // ... una entrada por {evt.type}; toggles agrupados por {evt.category} en el panel
];
// El panel de eventos (responsive, ADR-008) lista eventos por severidad/recencia + toggles por tipo + {evt.attribution}.
// {evt.attribution} (ToS): "U.S. Geological Survey" · "Data: NASA EONET" · "Source: The GDELT Project (gdeltproject.org)".
```

Briefing — enriquecimiento {ai.briefing.ctx} ({pkg.core.ai}, D-007):

```ts
// serializeContext (existente) gana un bloque de riesgo global construido desde el STORE (getEvents):
//   "Top N eventos por severidad/recencia (tipo, país, severity, occurred_at) en las últimas 24-48h."
// Contexto grounded para el briefing existente; NO añade llamada LLM ni cambia proveedor (ADR-009).
// Si events está vacío, el bloque se omite.
export function buildGlobalRiskContext(events: EventRow[]): string; // '' si vacío
```

Contrato {cii.bridge} ({pkg.store}/{pkg.core.cii} futuro, documentado aquí — D-108):

```ts
// Lo que la rebanada CII consumirá de esta capa (no se implementa el CII aquí, solo el contrato):
//   conflict/unrest ← getEventsByCountry filtrado category='conflict' (GDELT) -> componente Conflict/Unrest
//   earthquakeBoost ← events source='usgs' por país con alert>=yellow (severity>=40) -> boost de severidad
//   fireBoost       ← events source='eonet' event_type='wildfire' por país        -> boost de severidad
//   security        ← SIGUE DEGRADADO (ninguna de las 3 fuentes da militar/aviación/GPS-jam — GAP-3)
// La rebanada CII pone signalPresent=true en Conflict/Unrest y registra estos boosts cuando consuma {evt.table}.
```

## Do's and Don'ts

- **DO**: persiste (UPSERT) cada evento en {evt.table} ANTES de servirlo por la API — porque la UI lee de la DB local (ADR-004) y un evento debe sobrevivir a caídas de la fuente y a reinicios; sirve {evt.table}-stale ante fallo upstream.
- **DO**: normaliza la severidad de cada fuente a {evt.severity} `0..100` en {evt.severity.map} con clamp duro — porque sin una escala común no se puede ordenar un terremoto frente a una protesta o un incendio en el briefing ni alimentar el CII; la métrica nativa cruda es incomparable (D-103).
- **DO**: parsea el GDELT raw CSV por **índice fijo del codebook de 61 columnas** (sin header, tab-separated) y descarta filas sin `ActionGeo_Lat/Long` — porque el CSV no tiene cabecera y la verificación confirmó que el layout es posicional; usar coords del suceso (no centroide país-fuente) es el punto de la migración.
- **DO**: deduplica por {evt.id} `(source, source_event_id)` y haz UPSERT — porque el scheduler re-trae eventos ya vistos y un terremoto que pasa de `automatic` a `reviewed` (o un EONET de abierto a cerrado) debe actualizarse, no duplicarse (D-104).
- **DO**: declara una capa por tipo de evento en {web.layers.config} con toggle, e itera el array en el render — porque D-008/feedback_central_layer_config y el `verifier` comprueban este wiring; el usuario pidió toggles por tipo.
- **DO**: muestra {evt.attribution} en la UI (USGS Public Domain, NASA EONET, GDELT con citación) — porque datos≠licencia: USGS/NASA/GDELT exigen atribución pese a ser libres (feedback_data_tos).
- **DO**: respeta `Cache-Control: max-age=60` de USGS (tier fast no pide >1/min) y el `ETag` de GDELT (If-None-Match, 304→reusa) — porque los ToS recomiendan honrar el TTL y el ETag reduce carga/rate-limit upstream ({conn.cache.etag}).
- **DON'T**: NO añadas ReliefWeb, UCDP ni ACLED en esta rebanada — porque ReliefWeb es appname-gated (no keyless) y sin lat/lon; UCDP es key+3-5 días; ACLED tiene ToS no verificable (GUARDRAIL feedback_data_tos). Son rebanadas keyed posteriores (NG-3/NG-4).
- **DON'T**: NO uses el GDELT GKG (1.86 MB) ni Mentions en esta rebanada — porque para eventos geo+severity solo se necesita el `export.CSV.zip` (26 KB); el GKG es pesado y temático (NG-5).
- **DON'T**: NO copies fuente, taxonomía verbatim, pesos ni texto editorial de worldmonitor para la severity o el bridge — porque es AGPL-3.0; re-deriva en nuestros valores (D-006/D-103).
- **DON'T**: NO hagas fetch directo desde el frontend a USGS/EONET/GDELT — porque expone rate limits del cliente y rompe el modelo local-first; la web solo lee `/api/events` del store.
- **DON'T**: NO dispares conectores en cada request de `/api/events` — porque el fetch vive solo en el scheduler; la API es solo-lectura del store (D-107, ADR-004).
- **DON'T**: NO atribuyas un evento a un país inventando geografía — usa el `country` que la fuente provee (GDELT ActionGeo) o nearest-centroid contra {geo.centroids}; si no es derivable, `country=null` (NG-7).
- **DON'T**: NO mantengas `gdelt_events` y `events` en paralelo — porque {evt.table} es la fuente de verdad; la migración copia el histórico financiero y dropa la tabla vieja (D-101).

## Risks

- **R-1 (severity normalizada subjetiva)**: el mapeo {evt.severity.map} es editorial re-derivado; comparar un M5.0 con una protesta es intrínsecamente aproximado. **Mitigación**: valores en un único fichero {evt.severity.map}, ajustables; `raw_json` conserva la métrica nativa para re-derivar; documentar el porqué de cada banda. Riesgo residual: la calibración entre tipos necesita iteración con datos reales (OQ-4).
- **R-2 (sesgo de cobertura/volumen)**: USGS `all_day` trae mag 0.x (ruido sísmico); GDELT infla EE.UU./UK (medios anglófonos prolíficos). **Mitigación**: `minSeverity` en `/api/events` y en las capas; USGS prioriza `significant_week` para impacto; GDELT usa coords del suceso (no país-fuente), reduciendo el sesgo de Fase 1. Documentar en {evt.attribution}/detalle.
- **R-3 (GDELT CSV layout frágil)**: el parser depende del orden posicional de 61 columnas sin header; un cambio del codebook rompería el mapeo silenciosamente. **Mitigación**: validar nº de columnas por fila (==61) y descartar/loggear las que no cuadren; constantes nombradas por índice (`COL_ACTIONGEO_LAT=56`); no catch silencioso.
- **R-4 (EONET 503 transitorio)**: la verificación vio 503 con `limit=50`. **Mitigación**: `limit<=20` + retorno vacío gracioso + fallback {evt.table}-stale (no rompe el scheduler).
- **R-5 (crecimiento de events)**: USGS `all_day` ~210 eventos + GDELT ~415/15min crece rápido. **Mitigación**: dedup por {evt.id} (UPSERT, no append) limita el crecimiento a eventos únicos; purge/downsample del tier daily (ADR-004) con retención por antigüedad de `occurred_at`. Validar volumen real tras la primera semana.
- **R-6 (migración con pérdida)**: `003_events.sql` migra `gdelt_events`→`events` y dropa la vieja; un error perdería el histórico financiero. **Mitigación**: migración idempotente vía `_migrations`; copiar antes de DROP; el implementador prueba la migración sobre una copia de `world.db` antes de aplicarla en limpio. Ver OQ-2.
- **R-7 (deriva AGPL)**: re-derivar severity/taxonomía/bridge podría tentar a copiar el doc editorial de worldmonitor. **Mitigación**: D-006/Do-Don't; valores propios y ajustables; el `codebase-navigator` marca material AGPL como solo-referencia; el `verifier` revisa.
- **R-8 (country por nearest-centroid impreciso)**: USGS/EONET no dan ISO país; nearest-centroid contra ~65 centroides puede errar en fronteras o asignar océanos. **Mitigación**: aceptable para esta rebanada (el mapa usa lat/lon reales, no el país); `country=null` cuando el nearest está lejos; point-in-polygon es mejora posterior (NG-7).

## Iteration Guide

- Trabaja **UNA pieza a la vez** (la migración, un conector, el normalizador de severity, el job, el endpoint, una capa, el briefing). Cobertura parcial de un flujo es peor que un flujo cerrado de punta a punta.
- Refiere componentes y valores por su **token** ({evt.table}, {evt.severity}, {evt.id}, {web.layers.config}, {schema.snapshot.ts}) — no repitas el valor literal ni re-cites un `D-NNN` por número (cada id se define una vez; refiérete a su contenido).
- Sigue el **orden de implementación sugerido** (abajo): el modelo de evento no puede persistir sin la migración; los conectores no normalizan sin {evt.severity.map}; la capa no pinta sin la API.
- Añade variantes nuevas como **entradas separadas**: una fuente nueva = un conector + su normalizador en {evt.severity.map} + un Job; un tipo nuevo = una entrada en {web.layers.config} y un valor en la taxonomía {evt.type} (NO reescribir lo existente).
- Tras cada edición de este doc, deja que `spec-validator.js` valide el schema (front-matter + secciones en orden + ≥1 Non-Goal + sin token colgante + IDs únicos).
- Cierra cada flujo de punta a punta antes de pasar al siguiente; el `verifier` comprueba wiring real (conector→store, job→scheduler, capa en config-array, panel importado, ruta en `server.ts`, bloque de riesgo en el briefing).
- Si una decisión interna entra en conflicto con un descubrimiento de implementación (ej. el GDELT codebook cambió de columnas), **no la reescribas silenciosamente**: el implementador para y reporta; el cambio vuelve al PM (puede generar un ADR).

Secuencia de implementación sugerida (input del plan del PM — el PM escribe el plan). Grafo de dependencias (→ = "depende de / debe existir antes"):

1. **Migración `003_events.sql` + tipos + API del store** ({pkg.store}): tabla {evt.table}, índices, migración de `gdelt_events`, `EventRow`, `upsertEvents`/`getEvents`/`getEvent`/`getEventsByCountry`, extensión de `purgeAndDownsample`. **Bloquea todo lo demás** (conectores, job, API, bridge leen/escriben aquí). Prueba la migración sobre copia de `world.db` (R-6).
2. **Normalizador de severity {evt.severity.map}** (`severity.ts`): `severityUsgs`/`severityEonet`/`severityGdelt` con valores propios. Independiente; puede ir en paralelo a (1). Lo consumen los tres conectores.
3. **Conectores** ({conn.usgs}, {conn.eonet}, {conn.gdelt}): mapean su payload a `EventRow` usando (2). Dependen de (1) (tipos) y (2) (severity). **{conn.gdelt} es refactor** del de Fase 1 (financiero → raw Events CSV) — alto cuidado: retro-compat de `/api/gdelt`. Los tres son **independientes entre sí** → paralelizables (un fichero/fuente).
4. **Jobs del scheduler** ({pkg.scheduler}) en los tiers existentes: usgs→fast, eonet/gdelt→medium; reemplaza el job gdelt financiero. Depende de (1) y (3).
5. **Endpoints en `server.ts`**: `/api/events`, `/api/events/:source/:id`; `/api/gdelt` retro-compat. Dependen de (1). **Fichero de alto conflicto** → serializar el toque del registro de rutas.
6. **Capas por tipo {web.layers.config} + panel de eventos + {evt.attribution}** ({pkg.web}): entradas por tipo + panel responsive con toggles. Depende de (5) (consume la API); puede avanzar contra mock mientras (5) madura.
7. **Enriquecimiento del briefing** ({ai.briefing.ctx} en {pkg.core.ai}): `buildGlobalRiskContext` + inserción en `serializeContext`. Depende de (1) (lee getEvents). Independiente de (6).

Orden serial seguro para un solo dev: 1 → 2 (paralelo) → 3 (paralelo entre fuentes) → 4 → 5 → (6 y 7 en paralelo). Ficheros de alto conflicto a serializar: `server.ts`, {web.layers.config}, las migraciones del store, el `index.ts` del store.

Diagrama de flujo de datos (texto/ASCII):

```
              upstream (keyless, geo real, verificado en vivo)
   USGS GeoJSON        NASA EONET v3         GDELT 2.0 raw Events CSV
   (epicentro)         (13 categorías)       (coords del suceso, no país-fuente)
        |                    |                        |
        v                    v                        v
   [conn.usgs]          [conn.eonet]             [conn.gdelt]      <- {api.connector.timeout}, {conn.cache.etag},
        \                    |                       /                fallback {evt.table}-stale, retorno vacío
         \                   |                      /
          v                  v                     v
        +---------------------------------------------+
        |   {evt.severity.map} (severity.ts)          |  normaliza métrica nativa -> {evt.severity} 0..100 (D-103)
        +----------------------+----------------------+
                               |  EventRow[] (tipo/severity/lat/lon/país/raw)
                               v
        +---------------------------------------------+
        |              {pkg.scheduler}                |  usgs->fast, eonet/gdelt->medium {sched.tiers}
        |   upsert ANTES de servir (server-side)      |  (NO fanout en navegador)
        +----------------------+----------------------+
                               | dedup por {evt.id} (UPSERT)
                               v
        +---------------------------------------------+        +----------------------------+
        |                {pkg.store}                  |<-------| {pkg.core.ai}              |
        |  events (time-series, ix por recent/type/  | getE.. | buildGlobalRiskContext ->  |
        |  country/severity). Reemplaza gdelt_events  | store  | serializeContext (ADR-009) |
        +----------------------+----------------------+        +----------------------------+
            |  solo-lectura (D-107)        \  getEventsByCountry
            v                               v  {cii.bridge} (D-108, consumido por rebanada CII posterior)
        +----------------------+        +--------------------------------+
        |      server.ts       |        | (futuro) {pkg.core.cii}        |
        |  GET /api/events     |        |  Conflict/Unrest <- GDELT      |
        |  /api/events/:s/:id  |        |  earthquakeBoost <- USGS       |
        +---------+------------+        |  fireBoost <- EONET            |
                  | HTTP (web NUNCA       |  Security: DEGRADADO (GAP-3) |
                  v  llama upstream)      +--------------------------------+
        +---------------------------------------------+
        |                 {pkg.web}                   |  capas por TIPO en {web.layers.config} (D-106)
        |  panel de eventos (responsive, toggles):    |  color/tamaño por {evt.severity}; {evt.attribution}
        |  terremotos/incendios/conflicto/protesta... |  estados loading/empty/error
        +---------------------------------------------+
```

## Known Gaps / Open Questions

> Lo que este diseño NO resuelve y las decisiones internas que el PM debe ratificar. Evita confianza alucinada.

Fuera de esta rebanada (con razón) — fuentes diferidas y por qué (basado en la verificación en vivo):

- **GAP-1 — ReliefWeb (UN OCHA)**: cobertura excelente (epidemias, inundaciones, sequías, complex emergencies) + CC BY 4.0, pero **appname pre-aprobado** desde 2025-11-01 (registro editorial 3-5 días) y **sin lat/lon por evento** (solo `country.iso3`). Reactivación: el usuario solicita el appname; entonces entra como fuente humanitaria por-país (mismo nivel geo que centroides). Fuera del MVP de la capa (NG-3).
- **GAP-2 — UCDP + ACLED (conflicto armado/protestas keyed)**: la mejor señal para Conflict/Unrest del CII (geo real + muertes + protestas), pero **UCDP** = token gratuito por email (3-5 días, CC BY 4.0, verificar versión activa 26.1 no 24.1) y **ACLED** = DNS no resolvió + **ToS no verificable** (GUARDRAIL feedback_data_tos). Reactivación: usuario registra UCDP (rápido) y/o verifica ToS+registro ACLED en entorno con acceso; entonces es rebanada keyed que activa los componentes Conflict/Unrest reales del CII. Hoy {cii.bridge} alimenta Conflict/Unrest con GDELT (proxy de conflicto por QuadClass material), que es más débil que ACLED pero keyless. (NG-4).
- **GAP-3 — Componente Security del CII sigue degradado**: ninguna de las 3 fuentes de esta capa (USGS/EONET/GDELT) aporta datos militares/aviación/GPS-jam. {cii.bridge} deja Security con `signalPresent=false` hasta que aterrice su conector (rebanada posterior). Coherente con el design-doc CII (GAP-2 de ese doc).
- **GAP-4 — PAGER detail / muertes / daño económico por evento**: requiere fetch adicional por evento (USGS PAGER) o fuentes gated (ReliefWeb deaths/affected). `mag`+`alert`+`sig` son proxy de impacto suficiente para esta rebanada (NG-6); el detalle es enriquecimiento posterior.
- **GAP-5 — Geocodificación por point-in-polygon**: `country` se rellena por el campo de la fuente (GDELT) o nearest-centroid (USGS/EONET, ~65 países), no por point-in-polygon con polígonos de país (R-8/NG-7). Mejora posterior si el CII exige país preciso fuera de los ~65 centroides.
- **GAP-6 — Motor de convergencia cross-domain (INVESTIGACION §9.1)**: esta capa es su **input** (eventos geo+severity+time), pero el matching geográfico-temporal + scoring de señales NO se construye aquí (NG-1). Sigue siendo el spike de mayor riesgo, pendiente de su propio Research→Plan→Check.
- **GAP-7 — Acceso al doc editorial de worldmonitor**: el mapeo de severity y el bridge al CII se re-derivan de la metodología documentada + INVESTIGACION-FUSION; el doc completo de worldmonitor NO se consulta en esta sesión para evitar contaminación AGPL (D-006). Si el PM quiere validar curvas/floors de severity, hágalo como **referencia de metodología** (nunca copiar texto).

Open Questions (decisiones internas a ratificar por el PM):

- **OQ-1 (modelo unificado)**: ¿tabla `events` general con `raw_json` (recomendado, D-100) vs tabla-por-fuente vs EAV? Recomendación: tabla general (query unificada para mapa/briefing/CII, índices por tipo/país). Bloquea el schema.
- **OQ-2 (migración de gdelt_events)**: ¿migrar histórico financiero a `events` + DROP (recomendado, D-101) vs mantener ambas vs DROP sin migrar? Recomendación: migrar + DROP + retro-compat de `/api/gdelt`. Confirmar que el histórico financiero de Fase 1 debe conservarse (si no aporta valor, DROP sin migrar simplifica).
- **OQ-3 (taxonomía {evt.type})**: el set exacto de valores de tipo (¿cuántos tipos de conflicto GDELT exponer: solo conflict/protest, o también assault/coercion/threat?) está esbozado, no congelado. Conviene una iteración con `intel-analyst` para fijar el mapeo `EventCode/RootCode/QuadClass`→{evt.type}.
- **OQ-4 (calibración de severity)**: las bandas de {evt.severity.map} (pisos PAGER, log por categoría EONET, base por QuadClass) son un punto de partida editorial; la **calibración entre tipos** (¿un M6.0 = una guerra material = un incendio de 50k acres?) necesita iteración con datos reales y posiblemente `intel-analyst`. Recomendación: arrancar con las bandas propuestas, ajustar tras la primera semana.
- **OQ-5 (dedup/UPSERT)**: ¿UPSERT por {evt.id} (recomendado, D-104) vs append por `(id, captured_at)`? Recomendación: UPSERT (limita crecimiento, refleja transiciones automatic→reviewed / open→closed). Si se quisiera histórico de cómo cambió un evento, append sería necesario (descartado por crecimiento).
- **OQ-6 (tiers)**: ¿usgs→fast, eonet/gdelt→medium (recomendado, D-105) vs tier propio por fuente? Recomendación: reusar tiers existentes. Reconsiderar si USGS `all_day` genera demasiado volumen en fast (subir a medium).
- **OQ-7 (geometría de capas)**: ¿circle por punto + heatmap para wildfire (recomendado, D-106) vs solo circle uniforme? Recomendación: circle por defecto, heatmap para densidad (wildfire/conflict). Afecta a las entradas de {web.layers.config}.
- **OQ-8 ({cii.bridge} alcance)**: ¿GDELT como proxy de Conflict/Unrest del CII hoy (recomendado, D-108, keyless) o esperar a ACLED/UCDP (GAP-2) para activar esos componentes? Recomendación: activar Conflict/Unrest con GDELT como proxy honesto (documentado como proxy en `detail`), y mejorar a ACLED/UCDP cuando aterricen. Decisión del PM al planificar la rebanada CII.

## PLANNING COMPLETE
