---
version: alpha
name: geoeconomic-radar
description: Diseño de la 2ª rebanada de Fase 2 (ADR-011) — un RADAR GEOECONÓMICO TEMÁTICO de 6 secciones (inestabilidad política · materias primas&energía · tierras raras&minerales críticos · semiconductores/IA/tech · infra digital&ciber · comercio&sanciones) que añade la dimensión temática-económica sobre la capa de eventos geo de la rebanada 1 (ADR-010, `2026-06-13-global-events.md`). El backbone es un CONECTOR NUEVO `gkg.ts` sobre el GDELT 2.0 Global Knowledge Graph (keyless, ToS "unlimited and unrestricted use" + citación, verificado EN VIVO 2026-06-14: 670 artículos/15min, 2.75 MB zip PKZIP-deflate, ETag, 27 columnas TAB sin cabecera con subdelimitadores `;`/`#`/`,`) que REUSA el `extractZipFirstEntry` zero-dep ya existente. La señal article-level (temas+tono+entidades+geo-best-effort+título) se persiste en una TABLA NUEVA `signals` (migración `003_signals.sql`), SEPARADA de `events` (que es geo-event), con dedup por GKGRECORDID. El corazón del diseño es el CLASIFICADOR EDITORIAL `sections.config.ts` — un mapa sección→{themeCodes[], keywords[], entityHints[]} re-derivado en nuestras palabras (no-AGPL) que asigna cada artículo a 0..N de las 6 secciones, combinando theme-codes GKG (fuertes en política/commodities/comercio) con reglas keyword/entidad (necesarias en semis/ciber/data-centers, débiles en theme-codes). La tendencia/calor por sección = volumen + AvgTone medio por ventana temporal. El radar va ATADO AL MAPA: seleccionar una sección filtra simultáneamente events (geo-reales de la rebanada 1) y signals. Amplía la allowlist SSRF-safe de news con feeds RSS temáticos (los feeds concretos quedan como Open Question pendiente de verificar ToS si no se confirman). La síntesis/convergencia cross-tema sigue siendo Non-Goal (es el spike de mayor riesgo, con su propio Research→Plan→Check). El bloque estructurado (Decisions, Interfaces, Do/Don't) es normativo; la prosa explica el porqué.
status: draft
date: 2026-06-14
owner: system-architect
---

## Overview

Este documento diseña el **radar geoeconómico temático**, segunda rebanada de Fase 2 según ADR-011. El problema que resuelve: la rebanada 1 (capa de eventos globales, ADR-010) entrega el **QUÉ-DÓNDE-CUÁNDO-cuán-severo** geo-localizado de sucesos discretos (terremotos, incendios, conflicto, protestas), pero **no** la **dimensión temática-económica** que el usuario quiere ver — todo lo que afecta a la economía mundial más allá de finanzas: revueltas/cambios de gobierno, materias primas y energía, tierras raras y minerales críticos, semiconductores/IA/tech, infraestructura digital y ciberataques, y comercio/sanciones. El resultado deseado es un **radar de 6 secciones temáticas** alimentado por el **GDELT 2.0 Global Knowledge Graph (GKG)** como backbone (article-level: temas + tono + entidades + geo best-effort) más **news RSS temática curada**, atado al mapa, con titulares rankeados, indicador de tendencia/tono por sección y entidades top.

La pieza central de esta rebanada NO es la ingesta (ya hay patrón osiris para eso) sino el **clasificador editorial** `sections.config.ts`: un mapa declarativo `sección → {themeCodes[], keywords[], entityHints[]}` re-derivado en nuestras palabras (no-AGPL) que asigna cada artículo GKG/RSS a **0..N** secciones. Lo construido reusa el monorepo existente sin reescribirlo: el conector nuevo `gkg.ts` **reusa** el `extractZipFirstEntry` zero-dep de `gdelt.ts`; la tabla nueva `signals` **reusa** el patrón de migración numerada + UPSERT por clave estable + índices de `events`; el panel Radar **reusa** el patrón panel+config-array de `EventsPanel` + `layers.config.ts`; la ampliación de feeds **reusa** la allowlist SSRF-safe de `edu/allowlist.ts`. La tabla `signals` es **article-level y separada de `events`** (que es geo-event): forzar GKG en `events` se rechazó (ADR-011) porque un artículo no es un suceso geo-localizado. Atado al mapa: seleccionar una sección filtra simultáneamente los `events` geo-reales de la rebanada 1 (para "inestabilidad política") y las `signals` temáticas (para las otras 5). La **síntesis/convergencia cross-tema sigue siendo Non-Goal**. No es código: es la especificación que el PM convierte en plan y pasa por `/check-plan` antes de implementar.

## Token-references (bloque canónico)

Cada token se define aquí como `leaf: valor`; las referencias entre llaves del resto del doc (de la forma namespace-punto-leaf) resuelven contra estas definiciones.

Paths del monorepo (existentes y nuevos):

- store: `packages/store/` — referido como {pkg.store}
- scheduler: `packages/scheduler/` — referido como {pkg.scheduler}
- web: `packages/web/` — referido como {pkg.web}
- ai: `packages/core/ai/` — referido como {pkg.core.ai}
- gkg: `packages/connectors/geo/gkg.ts` (conector NUEVO, backbone del radar) — referido como {conn.gkg}
- gdelt: `packages/connectors/geo/gdelt.ts` (existente; rebanada 1; fuente del `extractZipFirstEntry` reusado y de los events de inestabilidad política) — referido como {conn.gdelt}
- ziputil: el `extractZipFirstEntry(buf)` zero-dep exportado por {conn.gdelt} (PKZIP deflate/stored) que {conn.gkg} REUSA — referido como {conn.zip}
- severity: `packages/connectors/geo/severity.ts` (existente; precedente de config editorial re-derivada no-AGPL — patrón, no se modifica aquí) — referido como {sig.severity.precedent}
- sections: `packages/connectors/geo/sections.config.ts` (clasificador editorial NUEVO — el corazón) — referido como {sig.sections.config}
- newsallow: `packages/connectors/edu/allowlist.ts` (allowlist SSRF-safe existente, se AMPLÍA con feeds temáticos) — referido como {conn.news.allowlist}
- news: `packages/connectors/edu/news.ts` (conector RSS existente, consume {conn.news.allowlist}) — referido como {conn.news}
- layers: `packages/web/src/map/layers.config.ts` (config-array central existente) — referido como {web.layers.config}
- radarpanel: `packages/web/src/panels/RadarPanel.tsx` (panel NUEVO, patrón de `EventsPanel.tsx`) — referido como {web.radar.panel}

Valores y decisiones compartidas:

- table: tabla `signals` (article-level, NUEVA, separada de `events`) que persiste señales temáticas del GKG/RSS — referida como {sig.table}
- sigid: clave de dedup estable de la señal = `GKGRECORDID` del GKG (`YYYYMMDDHHMMSS-N`) o, para RSS, `url` canónica — referida como {sig.id}
- sectionset: las **6 secciones** del radar (`political_instability`, `commodities_energy`, `critical_minerals`, `semis_ai_tech`, `digital_infra_cyber`, `trade_sanctions`) — referido como {sig.sections}
- tone: el `AvgTone` del GKG (col16 V2Tone, `-100..+100`) persistido por señal y promediado por sección/ventana — referido como {sig.tone}
- trend: la métrica de tendencia/calor por sección = **volumen** (nº señales por ventana) + **AvgTone medio** por ventana — referida como {sig.trend}
- themes: los theme-codes GKG (`WB_*`/`ENV_*`/`ECON_*`/`PROTEST`/`EPU_*`/…) de col8 V1Themes + col9 V2EnhancedThemes que el clasificador matchea — referido como {sig.themes}
- entities: las entidades top por sección = personas (col12 V2Persons) + organizaciones (col13 V2Organizations) más frecuentes — referido como {sig.entities}
- geo: lat/lon best-effort de la señal, derivado SOLO de V2Locations (col10) tipo 3/4 (coords de ciudad reales del **artículo**, NO del suceso) — referido como {sig.geo}
- ts: columna `captured_at` (epoch ms, INTEGER) = instante de captura del snapshot (patrón ADR-004) — referida como {schema.snapshot.ts}
- timeout: `AbortSignal.timeout(8000)` en todo fetch de conector — referida como {api.connector.timeout}
- etag: cache condicional (`If-None-Match`) sobre `lastupdate.txt` + fallback al store, patrón de la rebanada 1 — referida como {conn.cache.etag}
- tiers: tiers de frecuencia por volatilidad del scheduler (fast/medium/slow/daily) reusados — referida como {sched.tiers}
- attribution: el bloque de atribución GKG/GDELT ("Source: The GDELT Project (gdeltproject.org)") + feeds RSS, mostrado en la UI — referido como {sig.attribution}
- maptie: el contrato por el que seleccionar una sección del radar filtra a la vez `events` (geo-real, rebanada 1) y {sig.table} — referido como {web.map.tie}

Variante de estado:

- `{sig.table}-stale` = las últimas señales válidas servidas desde {sig.table} cuando {conn.gkg} falla upstream (leaf `table`, ya definido arriba).

## Goals

- **G-1**: **Conector nuevo {conn.gkg}** patrón osiris (keyless) que descubre el último `.gkg.csv.zip` vía `lastupdate.txt`, **REUSA {conn.zip}** para descomprimir, parsea el CSV **27 columnas TAB sin cabecera con subdelimitadores `;`/`#`/`,`** por índice fijo del codebook, y mapea cada artículo a `SignalRow` (temas, {sig.tone}, {sig.entities}, {sig.geo} best-effort, título de V2ExtrasXML), con {api.connector.timeout} + {conn.cache.etag} + fallback {sig.table}-stale + retorno vacío gracioso.
- **G-2**: **Clasificador editorial {sig.sections.config}** — el corazón: un mapa declarativo `sección → {themeCodes[], keywords[], entityHints[]}` re-derivado en nuestras palabras (no-AGPL) que asigna cada artículo a **0..N** de las {sig.sections}, combinando {sig.themes} (fuertes en política/commodities/comercio) con reglas keyword/entidad (necesarias en semis/ciber/data-centers).
- **G-3**: **Tabla nueva {sig.table}** + migración `003_signals.sql`, **article-level y separada de `events`**, con dedup por {sig.id} (UNIQUE), columnas de sección(es) derivadas, {sig.tone}, {sig.entities}, {sig.geo}, e índices por sección/fecha/tono — reusando el patrón de migración numerada + UPSERT de la rebanada 1.
- **G-4**: **API del store nueva** ({pkg.store}, AÑADE a `index.ts`, no reescribe events): `upsertSignals(rows)`, `getSignals(section, since, limit, minToneMag)`, `getSignalTrend(section)` ({sig.trend} = volumen + AvgTone medio por ventana).
- **G-5**: **Job de scheduler** {conn.gkg} → tier **medium** (cadencia natural GKG 15 min, ETag), que `upsertSignals` ANTES de servir (ADR-004), sin fanout en navegador.
- **G-6**: **Endpoints solo-lectura** en `server.ts`: `GET /api/signals` (filtrable por sección/since/limit/minToneMag) y `GET /api/signals/trend` (tendencia/tono por sección), que nunca disparan conectores on-request.
- **G-7**: **Panel Radar {web.radar.panel}** (6 secciones; por sección: titulares rankeados + indicador de tendencia/{sig.tone} + {sig.entities} top + {sig.attribution}) responsive mobile-first (ADR-008), **atado al mapa** vía {web.map.tie}: seleccionar una sección filtra a la vez `events` (geo-real) y {sig.table}.
- **G-8**: **Ampliación de {conn.news.allowlist}** con feeds RSS temáticos verificados (ToS personal-use), reusando el mecanismo SSRF-safe de hostname-exacto+https; las señales RSS entran a {sig.table} clasificadas por {sig.sections.config} (keyword/entidad sobre título). Los feeds concretos pendientes de verificar ToS quedan en Known Gaps (OQ-8).

## Non-Goals

- **NG-1**: **Motor de convergencia / síntesis cross-tema** (INVESTIGACION §9.1 / §6.5; ADR-011): cruzar señales entre las 6 secciones (p.ej. "sanciones a tierras raras + protesta en país minero → señal de cadena de suministro"). Razón: es la pieza de mayor riesgo del plan, no la sirve worldmonitor de forma reutilizable, y exige su propio spike Research→Plan→Check. Esta rebanada produce **señales por sección independientes**; cruzarlas es trabajo posterior. {sig.table} es **input** de esa convergencia.
- **NG-2**: **Re-implementación del motor CII** (`packages/core/cii`). Razón: el CII se reordenó DESPUÉS de la capa de eventos (ADR-010) y tiene su propio design-doc (`2026-06-13-cii-scoring.md`). Esta rebanada no construye scoring CII; a lo sumo {sig.table} y su tono/volumen serán un input adicional cuando el CII aterrice (no se define aquí ningún bridge CII nuevo).
- **NG-3**: **ML cliente** (Transformers.js/ONNX) para clasificar artículos. Razón: la clasificación de esta rebanada es **determinista por reglas** ({sig.sections.config}: theme-codes + keyword/entidad), auditable y zero-dependency; el clasificador ML (embeddings/zero-shot) es Fase 3-4 y se difiere para no introducir Web Workers ni modelos ONNX ahora.
- **NG-4**: **Reverse-geocode preciso** del artículo a país por point-in-polygon, y uso de la geo del GKG como geo del **suceso**. Razón: la geo del GKG (V2Locations) es del **artículo/entidad mencionada** (74% con lat/lon), NO del suceso; {sig.geo} es best-effort para pintar la señal aproximadamente, pero la geo de verdad de "inestabilidad política" la aportan los `events` GDELT de la rebanada 1 (coords del suceso). No se construye geocodificación nueva.
- **NG-5**: **GKG GCAM completo** (col18, >2300 dimensiones de cómputo emocional/temático). Razón: usar solo **V2Tone** (col16: AvgTone) — y `EPU_*` (Economic Policy Uncertainty) como theme-code si aporta señal a comercio/sanciones — es suficiente para tendencia/tono; el GCAM completo es pesado y de valor incremental dudoso para esta rebanada.
- **NG-6**: **GKG Mentions** y el **export.CSV de Events** como nueva fuente de esta rebanada. Razón: los `events` (conflicto/protesta geo-real) ya los ingiere {conn.gdelt} en la rebanada 1; esta rebanada los **reusa** para "inestabilidad política", no los re-ingiere. El GKG (`.gkg.csv.zip`) es la fuente NUEVA de esta rebanada.
- **NG-7**: **Fuentes keyed/gated** (UCDP, ACLED, ReliefWeb, FRED-temático, EIA por commodity). Razón: GKG es keyless + ToS verificado; las keyed siguen diferidas por su registro/ToS (coherente con la rebanada 1, NG-3/NG-4 de ese doc) y no son necesarias para un radar temático de titulares+tono. Candidatas a enriquecer secciones concretas en rebanadas posteriores.
- **NG-8**: **Empaquetado Tauri, servidor MCP, y nuevos dominios completos** (Educación/Política con paneles propios). Razón: Fases 3-4.

## Context / Constraints

- **Hechos GKG verificados EN VIVO (`wf_e68c43c8-11c`, 2026-06-14)** — restricción dominante; se diseña sobre ESTO, no sobre suposiciones (lección ADR-010):
  - **GDELT 2.0 GKG v2** (`http://data.gdeltproject.org/gdeltv2/lastupdate.txt` → línea cuya URL termina en `.gkg.csv.zip`): HTTP 200 **keyless**, ToS "unlimited and unrestricted use" para cualquier propósito + citación requerida ("Source: The GDELT Project (gdeltproject.org)"). ZIP **PKZIP deflate** (reusa {conn.zip}). **2.75 MB zip / 8.46 MB CSV**, **670 artículos/15min**, `Cache-Control: max-age=3600` + **ETag** (`If-None-Match`). Cadencia natural 15 min.
  - **Layout CSV**: **27 columnas TAB-separated, SIN cabecera, subdelimitadores `;` `#` `,`** (codebook por índice fijo). Columnas clave (1-indexed en la verificación → 0-indexed en el código): col2=`DATE` (YYYYMMDDHHMMSS), col5=`DocumentIdentifier` (SOURCEURL), col8=`V1Themes` (`;`-sep), col9=`V2EnhancedThemes` (`tema,charoffset` repetido), col10=`V2Locations` (`tipo#nombre#cc#adm1#lat#lon#featureid`; **tipo 3/4 = coords de ciudad reales**, 1/2 = centroide), col12=`V2Persons`, col13=`V2Organizations`, col16=`V2Tone` (`AvgTone,PosTone,NegTone,Polarity,ActivityDensity,SelfDens,WordCount`), col18=`GCAM`, col27=`V2ExtrasXML` (contiene `PAGE_TITLE` → título del artículo).
  - **Geo**: 74% de registros con lat/lon, pero del **artículo/entidad mencionada, NO del suceso** (vs Events CSV 97.6% del suceso). Por eso {sig.geo} es best-effort y la geo de verdad de "inestabilidad política" la dan los `events`.
  - **Cobertura por sección** (confirmada en vivo; punto de partida del clasificador, refinable con el GKG theme lookup `LOOKUP-GKGTHEMES.TXT` / codebook): **fuerte por theme-code** en inestabilidad política (`WB_2433_CONFLICT_AND_VIOLENCE`, `WB_2432_FRAGILITY_CONFLICT_AND_VIOLENCE`, `WB_2462_POLITICAL_VIOLENCE_AND_WAR`, `WB_2465_REVOLUTIONARY_VIOLENCE`, `PROTEST`, `GENERAL_GOVERNMENT`, `SLFID_DICTATORSHIP`, `EPU_POLICY`), materias primas&energía (`ENV_OIL`, `ENV_NATURALGAS`, `ENV_METALS`, `ENV_MINING`, `ENV_SOLAR`, `WB_507_ENERGY_AND_EXTRACTIVES`, `WB_2936_GOLD`, `WB_2937_SILVER`, `WB_1699_METAL_ORE_MINING`, `ECON_*`), comercio&sanciones (`WB_698_TRADE`, `WB_439_MACROECONOMIC_AND_STRUCTURAL_POLICIES`, `ECON_*`); **débil en theme-code → keyword-dependiente** en tierras raras&minerales críticos (theme-codes mineros + keyword: rare earth, lithium, cobalt, nickel, neodymium, critical minerals), semis/IA/tech (keyword/entidad: semiconductor, chip, fab, TSMC, ASML, Nvidia, GPU, AI model, export control), infra digital&ciber (keyword/entidad: data center, submarine cable, ransomware, cyberattack, DDoS).
- **Apoyo en la rebanada 1** (ADR-010, `2026-06-13-global-events.md`): la tabla `events` ya existe (migración `002_events.sql`), con `event_type` `conflict`/`protest` geo-reales del GDELT raw Events CSV. La sección "inestabilidad política" del radar **reusa** esos `events` para el mapa; el resto de secciones son señales temáticas de {sig.table}. NO se reescribe `events` ni `gdelt.ts`.
- **Stack bloqueado** (ADR-003): TypeScript, monorepo pnpm `@www/*`, Vite, React + MapLibre GL, Node single-server (`server.ts`), router LLM. Conectores patrón osiris: 1 fichero/fuente, fetch + {api.connector.timeout} + fallback + retorno vacío gracioso + cache/ETag.
- **Persistencia bloqueada** (ADR-006): `@libsql/client`, `url: file:./data/world.db`. Prohibido `better-sqlite3`. Migraciones numeradas `NNN_*.sql` aplicadas idempotentemente vía `_migrations` (runner lexicográfico existente). La UI lee del store, nunca de upstream (ADR-004).
- **Sin zod en connectors** (memory project-connectors-no-zod): `@www/connectors` solo tiene `fast-xml-parser` + `@www/store`; parse-don't-validate con type guards manuales (igual que {conn.gdelt} y {conn.news}).
- **Licencia** (ADR-002, feedback_no_agpl_copy): worldmonitor = AGPL-3.0; solo metodología re-implementada en nuestras palabras (el mapa sección→themes/keywords, la métrica de tendencia), NUNCA copiar fuente ni texto editorial. osiris = MIT. {sig.severity.precedent} es el precedente de cómo se documenta una config editorial re-derivada.
- **Datos ≠ licencia** (feedback_data_tos): GKG = libre con citación; los feeds RSS nuevos heredan la regla de {conn.news.allowlist} (uso personal, atribución en UI, ToS verificado ANTES de añadir). {sig.attribution} se muestra en la UI.
- **Zero-key-first** (feedback_zero_key_first): GKG y los RSS son keyless. Esta rebanada no introduce ninguna key.
- **Capas de mapa** (ADR-008 / feedback_central_layer_config): config-array central {web.layers.config}; UI responsive mobile-first.
- **Entorno**: Windows (win32). El conector es TypeScript puro (fetch + parse + {conn.zip} reusado, basado en `node:zlib` ya validado). Riesgo toolchain bajo. El CSV GKG NO requiere dependencia nativa (split por TAB + subdelimitadores + índice fijo).

## Decisions

> Las decisiones **bloqueadas** (no-negociables) heredan de los ADRs base y de `memory/feedback_*.md`; el ADR fuente se cita una vez. Las decisiones **internas abiertas** (numeradas desde el doscientos para no colisionar con la rebanada 1) son recomendación del arquitecto; el PM decide (alternativas/tradeoffs en Interfaces y Known Gaps). Cada `D-NNN` aparece una sola vez; el resto del doc refiere por contenido o token.

Bloqueadas (no-negociables):

- **D-001** (ADR-011): la 2ª rebanada de Fase 2 es un **radar geoeconómico temático de 6 secciones** {sig.sections}, alimentado por **GKG backbone + news RSS temática curada**, atado al mapa — porque añade la dimensión temática-económica (núcleo de la visión del usuario) que la capa de eventos geo no da. La síntesis cross-tema sigue Non-Goal (NG-1).
- **D-002** (ADR-011): la fuente backbone es el **GDELT 2.0 GKG** vía conector NUEVO {conn.gkg}, que **REUSA {conn.zip}** de {conn.gdelt} para descomprimir el ZIP — porque GKG es keyless + ToS verificado + da temas/tono/entidades/geo por artículo, y el ZIP es PKZIP-deflate idéntico al de Events; reimplementar el descompresor sería duplicación.
- **D-003** (ADR-011): la señal article-level vive en una **tabla NUEVA {sig.table}, separada de `events`** — porque un artículo (con N temas, tono, entidades, geo-del-artículo) NO es un suceso geo-localizado discreto; forzarlo en `events` mezclaría dos modelos (geo-event vs article-signal) y rompería las queries del mapa de la rebanada 1. NO se reescribe `events`.
- **D-004** (ADR-011): la **clasificación es theme-codes GKG + reglas keyword/entidad** (editorial re-derivado, no-AGPL) en {sig.sections.config} — porque los theme-codes cubren bien política/commodities/comercio pero dejan vacíos semis/ciber/data-centers, que solo se capturan por keyword/entidad. NO ML cliente (NG-3).
- **D-005** (ADR-011): la **tendencia/calor por sección** {sig.trend} = **volumen + AvgTone medio por ventana** — porque es la métrica que el GKG sirve directamente (col16 V2Tone) sin GCAM completo (NG-5) y captura "cuánto se habla" + "con qué tono" de cada tema a lo largo del tiempo (el diferencial time-series del proyecto).
- **D-006** (ADR-010): el radar va **atado al mapa** {web.map.tie}: "inestabilidad política" reusa los `events` geo-reales de la rebanada 1; las otras 5 secciones pintan {sig.geo} best-effort — porque la geo del suceso solo la dan los `events` (GKG es geo-del-artículo), y el usuario pidió el radar atado al mapa.
- **D-007** (ADR-004): {conn.gkg} corre server-side en el scheduler, `upsertSignals` ANTES de servir, y la UI lee {sig.table} vía API, nunca de upstream — porque desacopla la frescura de la pestaña y habilita el histórico de señales (el diferencial).
- **D-008** (ADR-002 / feedback_no_agpl_copy): el mapa sección→{themeCodes,keywords,entityHints} y la métrica {sig.trend} se **re-derivan en nuestras palabras** — porque las ideas no son copyrightables pero el texto/código de worldmonitor (AGPL) sí; se documenta el criterio de cada banda, como hace {sig.severity.precedent}.

Internas (recomendación del arquitecto; el PM decide):

- **D-200**: el **schema de {sig.table}** persiste la sección como **multi-sección en una tabla puente `signal_sections`** (1 fila `signals` por artículo + N filas `signal_sections(signal_id, section)`), en vez de una columna `sections` CSV o N columnas booleanas — porque un artículo cae en 0..N secciones (D-004) y `getSignals(section)` + `getSignalTrend(section)` deben filtrar por sección con índice; una tabla puente da `WHERE section=?` indexable y normaliza el many-to-many. Alternativa: columna `sections TEXT` con CSV (descartada: no indexable, `LIKE '%x%'` frágil); N columnas booleanas (descartada: añadir una sección = migración de schema). Si el PM prefiere simplicidad sobre normalización, una columna `sections TEXT` JSON-array es el fallback aceptable (filtrado en memoria tras `getSignals`). Ver Interfaces y OQ-1.
- **D-201**: el **parser GKG** valida **exactamente 27 columnas por fila** (descarta+loggea las que no cuadren, igual que el `EXPECTED_COLUMNS=61` de {conn.gdelt}), parsea subdelimitadores en orden `TAB → ;`(V1Themes)`/ ,`(V2EnhancedThemes pares tema,offset)`/ #`(V2Locations campos) y extrae el título de **`PAGE_TITLE` dentro de V2ExtrasXML (col27)** con un match de etiqueta simple (no XML parser pesado) — porque el layout es posicional sin cabecera y un cambio de codebook debe fallar ruidoso, no silencioso (R-3 de la rebanada 1). Constantes nombradas por índice (`COL_V1THEMES`, `COL_V2TONE`, …). Ver Interfaces y OQ-2.
- **D-202**: la **clave de dedup {sig.id}** es el **`GKGRECORDID`** del GKG (col1, formato `YYYYMMDDHHMMSS-N`, único por artículo en el batch) con UNIQUE; para señales RSS, la `url` canónica — porque el scheduler re-trae batches y artículos ya vistos deben deduplicarse; UPSERT actualiza tono/secciones/entidades si el artículo reaparece enriquecido. Alternativa: hash de la URL del documento (descartada: GKGRECORDID es el id estable nativo del GKG). Ver OQ-3.
- **D-203**: el **clasificador {sig.sections.config}** asigna secciones con **prioridad theme-code, refuerzo keyword/entidad**: un artículo entra en una sección si matchea ≥1 themeCode de esa sección O ≥1 keyword (sobre título+temas) O ≥1 entityHint (sobre V2Organizations/V2Persons); cada match registra su **razón** (`matchedBy: 'theme'|'keyword'|'entity'`) en el `raw_json` para auditoría/calibración — porque la mezcla theme+keyword es la decisión central (D-004) y la trazabilidad del match es lo que permite calibrar sin adivinar. Un artículo en 0 secciones NO se persiste (ruido). Ver Interfaces, R-1 y OQ-4.
- **D-204**: el **tier de scheduler** de {conn.gkg} es **medium** (15 min, cadencia natural del GKG + ETag) — porque el GKG publica cada 15 min y el volumen (670 art/15min, 2.75 MB) no justifica `fast`; reusa los {sched.tiers} existentes sin inventar tier nuevo. Alternativa: slow (descartada: perdería frescura temática que es el valor del radar). Ver OQ-5.
- **D-205**: las **señales RSS temáticas** entran a {sig.table} con `source` específico (p.ej. `'rss-thematic'`) y se clasifican por {sig.sections.config} aplicando **solo keyword/entityHint sobre el título** (el RSS no trae theme-codes GKG) — porque amplían cobertura de las secciones keyword-dependientes (semis/ciber) con titulares curados, pero su clasificación es más pobre que la del GKG (sin temas estructurados). El tono de las señales RSS es `null` (no hay V2Tone) y no contribuyen a {sig.trend} salvo por volumen. Ver OQ-8.
- **D-206**: el **panel Radar {web.radar.panel}** es un panel NUEVO (no se sobrecarga `EventsPanel`), con una sección plegable por cada {sig.sections}; seleccionar una sección actualiza un estado compartido en `App.tsx` que el mapa lee para {web.map.tie} (filtra `events` para political_instability y una nueva capa de signals para el resto) — porque el radar y los eventos son dos vistas distintas y mezclarlas en un panel rompería la responsabilidad única; reusa el patrón loading/empty/error/responsive de `EventsPanel`. Ver Interfaces y OQ-6.
- **D-207**: el **mapa pinta las señales** mediante **una capa nueva `signals` por sección** en {web.layers.config} (geometría `circle`/`heatmap` por {sig.geo}, color por sección, opacidad/peso por |{sig.tone}|), con `filterExpr` por `section` — coherente con D-006 de la rebanada 1 (config-array central, una entrada por tipo) — porque añadir el radar al mapa = añadir entradas al array, nunca capas imperativas. Las señales sin {sig.geo} no se pintan (solo aparecen en el panel). Ver Interfaces y OQ-7.

## Interfaces / Data Contracts

> Firmas y schema **normativos**. Tipos en pseudo-TS; el implementador los traduce. Los nombres de columna son contractuales (referenciados por tokens). Ningún valor, peso o texto procede de fuente AGPL: todo re-derivado.

Store — tabla de señales article-level ({pkg.store}, migración `003_signals.sql`):

```sql
-- Señales temáticas article-level (GKG/RSS). SEPARADA de events (D-003).
CREATE TABLE IF NOT EXISTS signals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT    NOT NULL,         -- 'gkg' | 'rss-thematic'
  signal_id       TEXT    NOT NULL,         -- {sig.id}: GKGRECORDID o url canónica
  title           TEXT,                     -- PAGE_TITLE (V2ExtrasXML col27) / título RSS
  url             TEXT,                     -- DocumentIdentifier (SOURCEURL col5) / link RSS
  tone            REAL,                     -- {sig.tone}: AvgTone -100..+100; null para RSS
  themes          TEXT,                     -- {sig.themes}: V1Themes (;-join) tal cual, para auditoría
  persons         TEXT,                     -- V2Persons (;-join) — base de {sig.entities}
  organizations   TEXT,                     -- V2Organizations (;-join) — base de {sig.entities}
  lat             REAL,                     -- {sig.geo} best-effort (V2Locations tipo 3/4); del ARTÍCULO
  lon             REAL,
  country         TEXT,                     -- cc de V2Locations si disponible; null si no
  occurred_at     INTEGER,                  -- DATE col2 (YYYYMMDDHHMMSS) → epoch ms; pubDate para RSS
  captured_at     INTEGER NOT NULL,         -- {schema.snapshot.ts} epoch ms
  raw_json        TEXT,                     -- V2Tone completo + matchedBy + EPU si aplica (auditoría)
  UNIQUE (source, signal_id)                -- {sig.id}: dedup + UPSERT (D-202)
);

-- Puente many-to-many artículo↔sección (D-200): un artículo en 0..N secciones.
CREATE TABLE IF NOT EXISTS signal_sections (
  signal_id  INTEGER NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  section    TEXT    NOT NULL,              -- una de {sig.sections}
  matched_by TEXT,                          -- 'theme'|'keyword'|'entity' (D-203, auditoría)
  PRIMARY KEY (signal_id, section)
);

CREATE INDEX IF NOT EXISTS ix_signals_recent  ON signals (captured_at);
CREATE INDEX IF NOT EXISTS ix_signals_tone    ON signals (tone);
CREATE INDEX IF NOT EXISTS ix_signals_occ     ON signals (occurred_at);
CREATE INDEX IF NOT EXISTS ix_sigsec_section  ON signal_sections (section);
```

**Migración `003_signals.sql` (D-200)**: crea `signals` + `signal_sections` + índices. Idempotente vía `_migrations` (runner lexicográfico existente; `003_` ordena tras `002_events.sql`). NO toca `events` ni `gdelt_events`. Si el PM elige el fallback (columna `sections TEXT` JSON, OQ-1), se omite `signal_sections` y se añade `sections TEXT` a `signals`.

Store — API nueva ({pkg.store}, AÑADE a `index.ts`, NO reescribe events):

```ts
type Section =
  | 'political_instability' | 'commodities_energy' | 'critical_minerals'
  | 'semis_ai_tech' | 'digital_infra_cyber' | 'trade_sanctions';   // {sig.sections}

interface SignalRow {
  source: 'gkg' | 'rss-thematic';
  signalId: string;                 // {sig.id}
  title: string | null;
  url: string | null;
  tone: number | null;              // {sig.tone}
  themes: string | null;            // {sig.themes} raw (;-join)
  persons: string | null;
  organizations: string | null;
  lat: number | null; lon: number | null;   // {sig.geo}
  country: string | null;
  occurredAt: number | null;
  capturedAt: number;               // {schema.snapshot.ts}
  rawJson: string | null;
  sections: Array<{ section: Section; matchedBy: 'theme' | 'keyword' | 'entity' }>; // D-203
}

interface SignalTrendPoint { bucketMs: number; volume: number; avgTone: number | null; } // {sig.trend}

export async function upsertSignals(rows: SignalRow[]): Promise<void>;   // UPSERT por {sig.id}; reescribe signal_sections del artículo
export async function getSignals(opts: {
  section?: Section; sinceMs?: number; limit?: number; minToneMag?: number;  // minToneMag = |tone| mínimo
}): Promise<SignalRow[]>;
export async function getSignalTrend(section: Section, opts?: {
  sinceMs?: number; bucketMs?: number;   // bucket por defecto = 1h
}): Promise<SignalTrendPoint[]>;          // {sig.trend}: volumen + AvgTone medio por bucket
// purgeAndDownsample (existente) se EXTIENDE para purgar signals/signal_sections > retención (patrón ADR-004).
```

Conector — patrón osiris (keyless), contrato común (igual que rebanada 1):

```ts
interface ConnectorResult<T> { data: T[]; stale: boolean; fetchedAt: number; }
// Todo fetch usa {api.connector.timeout} + User-Agent custom + {conn.cache.etag}.
export async function fetchGkg(): Promise<ConnectorResult<SignalRow>>;   // {conn.gkg}
// Funciones puras exportadas para test (igual que parseGdeltCsvRows / parseLastupdateTxt):
export function parseLastupdateGkg(text: string): string | null;        // línea que termina en '.gkg.csv.zip'
export function parseGkgCsvRows(csvText: string, capturedAt: number): SignalRow[];
```

- **{conn.gkg}**: (1) GET `lastupdate.txt` con `If-None-Match` ({conn.cache.etag}); 304 → {sig.table}-stale. (2) `parseLastupdateGkg` busca la línea `.gkg.csv.zip`. (3) GET el zip; **REUSA {conn.zip}** (`extractZipFirstEntry` de {conn.gdelt}) para descomprimir (PKZIP deflate). (4) `parseGkgCsvRows`: split por `\n`, por fila split por `\t`, **valida 27 columnas** (D-201), parsea subdelimitadores, deriva {sig.tone}/{sig.themes}/{sig.entities}/{sig.geo}/título, llama a `classify()` de {sig.sections.config} para las `sections[]`, descarta artículos con 0 secciones (D-203). NUNCA lanza; single-flight + serve-stale como {conn.gdelt}.

Clasificador editorial {sig.sections.config} (`sections.config.ts`) — **mapa re-derivado propio, NO copiado** (D-004/D-008):

```ts
// El CORAZÓN de la rebanada. Mapa declarativo sección → reglas. Valores editoriales propios,
// documentados con su criterio (como severity.ts). Refinable con LOOKUP-GKGTHEMES.TXT (OQ-4).
interface SectionRules {
  themeCodes: string[];   // {sig.themes} exactos/prefijo (p.ej. 'WB_2433_CONFLICT_AND_VIOLENCE', 'ENV_*')
  keywords: string[];     // sobre título + V1Themes, case-insensitive (p.ej. 'rare earth', 'semiconductor')
  entityHints: string[];  // sobre V2Organizations/V2Persons (p.ej. 'TSMC', 'ASML', 'Nvidia')
}
export const SECTIONS: Record<Section, SectionRules>;   // las 6 secciones {sig.sections}

// classify devuelve 0..N secciones con la razón del match (D-203).
export function classify(input: {
  themes: string[]; title: string | null; organizations: string[]; persons: string[];
}): Array<{ section: Section; matchedBy: 'theme' | 'keyword' | 'entity' }>;
```

Punto de partida del mapa (verificado en vivo; refinar con el codebook):

| Sección {sig.sections} | themeCodes (fuertes) | keywords/entityHints (necesarios) |
|---|---|---|
| `political_instability` | `WB_2433_CONFLICT_AND_VIOLENCE`, `WB_2432_FRAGILITY_CONFLICT_AND_VIOLENCE`, `WB_2462_POLITICAL_VIOLENCE_AND_WAR`, `WB_2465_REVOLUTIONARY_VIOLENCE`, `PROTEST`, `GENERAL_GOVERNMENT`, `SLFID_DICTATORSHIP`, `EPU_POLICY` | coup, uprising, election crisis |
| `commodities_energy` | `ENV_OIL`, `ENV_NATURALGAS`, `ENV_METALS`, `ENV_MINING`, `ENV_SOLAR`, `WB_507_ENERGY_AND_EXTRACTIVES`, `WB_2936_GOLD`, `WB_2937_SILVER`, `WB_1699_METAL_ORE_MINING`, `ECON_*` | OPEC, LNG, crude, refinery |
| `critical_minerals` | `WB_895_MINING_SYSTEMS`, `WB_1699_METAL_ORE_MINING`, `ENV_MINING`, `ENV_METALS` | rare earth, lithium, cobalt, nickel, neodymium, critical minerals |
| `semis_ai_tech` | (débil) | semiconductor, chip, fab, TSMC, ASML, Nvidia, GPU, AI model, export control |
| `digital_infra_cyber` | (débil) | data center, submarine cable, ransomware, cyberattack, DDoS |
| `trade_sanctions` | `WB_698_TRADE`, `WB_439_MACROECONOMIC_AND_STRUCTURAL_POLICIES`, `ECON_*` | sanctions, tariff, embargo, export control |

server.ts — endpoints nuevos (solo-lectura del store, G-6):

```ts
GET /api/signals          -> getSignals({ section?, sinceMs?, limit?, minToneMag? }) // ?section=&since=&limit=&minToneMag=
GET /api/signals/trend    -> getSignalTrend(section, { sinceMs?, bucketMs? })        // ?section=&since=&bucket=
// Mismo pipeline de middleware existente (origin-check -> CORS -> rate-limit -> SSRF-guard -> route).
// NUNCA dispara conectores on-request (D-007, ADR-004). 'section' inválida -> 400.
```

Scheduler ({pkg.scheduler}) — job nuevo en tier existente {sched.tiers} (D-204):

```ts
// Un Job nuevo (patrón rebanada 1). Invariante: upsertSignals ANTES de servir (ADR-004).
//   { name:'gkg', tier:'medium' } -> fetchGkg() -> upsertSignals()
// No reemplaza ni toca el job 'gdelt' de la rebanada 1 (sigue alimentando events). No fanout en navegador.
// El tier 'daily' extiende purgeAndDownsample para purgar signals/signal_sections > retención.
```

Web ({pkg.web}) — radar atado al mapa (D-206/D-207, {web.map.tie}):

```ts
// 1) Capas NUEVAS en {web.layers.config} (config-array central; añadir sección = añadir entrada):
//    una capa 'signals' por sección, filterExpr por section, color por sección, |tone| -> opacidad/peso.
//    political_instability NO añade capa de signals: reusa las capas evt-conflict/evt-protest (events geo-real, D-006).
const SIGNAL_LAYERS: LayerSpec[] = [
  { id:'sig-commodities', source:'signals', type:'heatmap', filterExpr:['==',['get','section'],'commodities_energy'], /* ... */ },
  { id:'sig-minerals',    source:'signals', type:'circle',  filterExpr:['==',['get','section'],'critical_minerals'],  /* ... */ },
  { id:'sig-semis',       source:'signals', type:'circle',  filterExpr:['==',['get','section'],'semis_ai_tech'],      /* ... */ },
  { id:'sig-cyber',       source:'signals', type:'circle',  filterExpr:['==',['get','section'],'digital_infra_cyber'],/* ... */ },
  { id:'sig-trade',       source:'signals', type:'circle',  filterExpr:['==',['get','section'],'trade_sanctions'],    /* ... */ },
  // las señales sin lat/lon NO se pintan (solo en el panel, D-207)
];
// 2) Panel Radar {web.radar.panel}: 6 secciones plegables; por sección: titulares rankeados (getSignals),
//    indicador de tendencia/tono (getSignalTrend), entidades top, {sig.attribution}. Responsive (ADR-008).
// 3) {web.map.tie}: seleccionar una sección -> App.tsx setActiveSection -> el mapa muestra la capa de esa sección
//    (signals) o, para political_instability, las capas de events. Estado compartido, no imperativo.
// {sig.attribution}: "Source: The GDELT Project (gdeltproject.org)" + atribución de cada feed RSS añadido.
```

News allowlist — ampliación ({conn.news.allowlist}, G-8/D-205):

```ts
// AÑADE entradas a FEED_ALLOWLIST (no reescribe el mecanismo SSRF-safe: hostname exacto + https + sin credenciales).
// Cada feed nuevo: { domain, url, license } con ToS verificado (uso personal) ANTES de añadir.
// Feeds candidatos por sección (PENDIENTE verificar ToS — OQ-8): p.ej. energía/commodities, tech/semis, ciber.
// Las señales RSS entran a signals con source='rss-thematic', clasificadas por keyword/entity sobre el título (D-205).
```

## Do's and Don'ts

- **DO**: REUSA {conn.zip} (`extractZipFirstEntry` de {conn.gdelt}) para descomprimir el `.gkg.csv.zip` — porque es el mismo PKZIP-deflate ya validado en vivo; reimplementar el descompresor duplicaría código y superficie de bug (D-002).
- **DO**: persiste (UPSERT) cada señal en {sig.table} ANTES de servirla por la API — porque la UI lee de la DB local (ADR-004) y la señal debe sobrevivir a caídas de GKG y a reinicios; sirve {sig.table}-stale ante fallo upstream (D-007).
- **DO**: parsea el GKG CSV por **índice fijo de 27 columnas** (sin cabecera, TAB-separated) y valida el conteo de columnas por fila, descartando+loggeando las que no cuadren — porque el layout es posicional y un cambio de codebook debe fallar ruidoso, no corromper señales en silencio (D-201, R-2).
- **DO**: registra el `matchedBy` ('theme'|'keyword'|'entity') de cada match en {sig.table} — porque la calibración del clasificador (R-1) es imposible sin saber POR QUÉ un artículo entró en una sección; la trazabilidad es lo que evita adivinar (D-203).
- **DO**: usa {sig.geo} (V2Locations tipo 3/4) SOLO para pintar la señal de forma aproximada, y deja la geo del suceso a los `events` de la rebanada 1 — porque la geo del GKG es del ARTÍCULO, no del suceso; tratarla como geo del suceso engañaría al usuario (NG-4, D-006).
- **DO**: muestra {sig.attribution} en la UI (GKG con citación + cada feed RSS) — porque datos≠licencia: GKG exige citación pese a ser libre, y los feeds RSS exigen atribución de uso personal (feedback_data_tos).
- **DO**: respeta el `ETag`/`If-None-Match` y el `max-age=3600` del GKG (304 → reusa {sig.table}-stale) — porque el ToS recomienda honrar el TTL y el ETag reduce 2.75 MB de descarga inútil por ciclo ({conn.cache.etag}).
- **DON'T**: NO metas las señales GKG en la tabla `events` — porque un artículo no es un suceso geo-localizado; {sig.table} es separada (D-003) y mezclarlas rompería las queries del mapa de la rebanada 1.
- **DON'T**: NO reescribas {conn.gdelt}, `events`, ni el job 'gdelt' — porque la rebanada 1 sigue alimentando los `events` geo-reales que "inestabilidad política" reusa; esta rebanada AÑADE, no refactoriza (NG-6, D-003).
- **DON'T**: NO copies texto editorial, taxonomía de temas verbatim, ni la lógica de scoring de worldmonitor para {sig.sections.config} o {sig.trend} — porque es AGPL-3.0; re-deriva el mapa sección→reglas y la métrica en nuestros valores documentados (D-008, como {sig.severity.precedent}).
- **DON'T**: NO hagas fetch directo desde el frontend a GKG ni a los feeds RSS — porque expone rate limits del cliente y rompe el modelo local-first; la web solo lee `/api/signals` y `/api/signals/trend` del store.
- **DON'T**: NO dispares {conn.gkg} en cada request de `/api/signals` — porque el fetch vive solo en el scheduler; la API es solo-lectura del store (D-007, ADR-004).
- **DON'T**: NO añadas un feed RSS a {conn.news.allowlist} sin verificar su ToS (uso personal) y su hostname exacto — porque el mecanismo SSRF-safe depende del hostname exacto y el guardrail de datos exige ToS verificado ANTES de conectar (feedback_data_tos, OQ-8).
- **DON'T**: NO uses el GCAM completo (col18) ni Mentions ni un XML parser pesado para V2ExtrasXML — porque V2Tone + un match de etiqueta `PAGE_TITLE` bastan; el GCAM es pesado y de valor incremental dudoso aquí (NG-5, D-201).

## Risks

- **R-1 (clasificador editorial impreciso)**: {sig.sections.config} es reglas keyword/theme re-derivadas; semis/ciber/data-centers son keyword-dependientes y propensos a falsos positivos/negativos (p.ej. "chip" en contexto culinario). **Mitigación**: `matchedBy` por match (D-203) para auditar; `themes`/`title` crudos en {sig.table} para re-clasificar offline; calibración con datos reales tras la primera semana; refinar con `LOOKUP-GKGTHEMES.TXT`. Riesgo residual: necesita iteración (OQ-4) — posiblemente con `intel-analyst`.
- **R-2 (GKG CSV layout frágil)**: el parser depende del orden posicional de 27 columnas sin cabecera y de subdelimitadores `;`/`#`/`,`; un cambio del codebook o un campo con delimitador embebido rompería el mapeo. **Mitigación**: validar nº de columnas por fila (==27) y descartar/loggear (D-201); constantes nombradas por índice; no catch silencioso; `raw_json` conserva el material para re-parsear.
- **R-3 (geo del artículo ≠ geo del suceso)**: pintar {sig.geo} en el mapa puede sugerir que la señal "ocurre" donde la menciona el artículo (74% con lat/lon, del artículo). **Mitigación**: las señales geo se pintan con estilo/etiqueta que las distingue de los `events` geo-reales; el panel es la vista primaria; political_instability usa events, no signals (D-006/NG-4); documentar en {sig.attribution}/leyenda.
- **R-4 (sesgo anglófono + volumen GDELT)**: el GKG infla cobertura de medios anglófonos (EE.UU./UK) y temas muy mediáticos; secciones nicho (critical_minerals) tendrán menos volumen que política. **Mitigación**: {sig.trend} es relativo a la propia sección (tendencia intra-sección, no comparación cruzada); `minToneMag` filtra ruido de bajo tono; documentar el sesgo en la UI. Conocido (GAP-2).
- **R-5 (crecimiento de signals)**: 670 art/15min ≈ 64k/día antes de filtrar por sección; tras filtrar 0-secciones y dedup baja, pero crece rápido. **Mitigación**: descartar artículos con 0 secciones en el conector (D-203); dedup por {sig.id} (UPSERT, no append); purge del tier daily (ADR-004) por `occurred_at`; `signal_sections ON DELETE CASCADE`. Validar volumen real tras la primera semana (OQ-5).
- **R-6 (deriva AGPL)**: re-derivar el mapa sección→reglas podría tentar a copiar la taxonomía temática de worldmonitor. **Mitigación**: D-008/Do-Don't; valores propios documentados con criterio (como {sig.severity.precedent}); `codebase-navigator` marca material AGPL como solo-referencia; el `verifier` revisa.
- **R-7 (SSRF en feeds nuevos)**: añadir feeds a {conn.news.allowlist} amplía la superficie. **Mitigación**: el mecanismo SSRF-safe (hostname exacto + https + sin credenciales) NO se toca; cada feed se valida con `isAllowedFeedUrl` ANTES de fetch; ToS verificado antes de añadir (D-205/OQ-8).
- **R-8 (descubrimiento de la URL .gkg.csv.zip)**: `lastupdate.txt` lista varias líneas (export/mentions/gkg); seleccionar la equivocada traería el dataset erróneo. **Mitigación**: `parseLastupdateGkg` matchea explícitamente la línea que termina en `.gkg.csv.zip` (no `export`/`mentions`), con test unitario sobre un `lastupdate.txt` de muestra (igual que `parseLastupdateTxt`).

## Iteration Guide

- Trabaja **UNA pieza a la vez** (la migración, el clasificador, el conector, la API del store, el job, los endpoints, las capas, el panel, la ampliación de feeds). Cobertura parcial de un flujo es peor que un flujo cerrado de punta a punta.
- Refiere componentes y valores por su **token** ({sig.table}, {sig.sections.config}, {conn.zip}, {sig.trend}, {sig.geo}, {schema.snapshot.ts}) — no repitas el valor literal ni re-cites un `D-NNN` por número (cada id se define una vez; refiérete a su contenido).
- Sigue el **orden de implementación sugerido** (abajo): el store no persiste sin la migración; el conector no clasifica sin {sig.sections.config}; el panel no pinta sin la API y las capas.
- Añade variantes nuevas como **entradas separadas**: una sección nueva = una clave en {sig.sections.config} + una entrada en {web.layers.config} + un valor en el tipo `Section` (NO reescribir las existentes). Un feed nuevo = una entrada en {conn.news.allowlist} con ToS verificado.
- Tras cada edición de este doc, deja que `spec-validator.js` valide el schema (front-matter + secciones en orden + ≥1 Non-Goal + sin token colgante + IDs únicos).
- Cierra cada flujo de punta a punta antes de pasar al siguiente; el `verifier` comprueba wiring real (conector→store, job→scheduler, capa en config-array, panel importado, ruta en `server.ts`).
- Si una decisión interna entra en conflicto con un descubrimiento de implementación (ej. el GKG codebook cambió de columnas), **no la reescribas silenciosamente**: el implementador para y reporta; el cambio vuelve al PM (puede generar un ADR).

Secuencia de implementación sugerida (input del plan del PM — el PM escribe el plan). Grafo de dependencias (→ = "depende de / debe existir antes"):

1. **Migración `003_signals.sql` + tipos + API del store** ({pkg.store}): `signals` + `signal_sections` + índices, `SignalRow`/`Section`/`SignalTrendPoint`, `upsertSignals`/`getSignals`/`getSignalTrend`, extensión de `purgeAndDownsample`. **Bloquea todo lo demás**. Prueba la migración sobre copia de `world.db`.
2. **Clasificador {sig.sections.config}** (`sections.config.ts`): `SECTIONS` + `classify()` con valores propios documentados. Independiente; puede ir en paralelo a (1). Lo consume el conector. Tests unitarios sobre artículos de muestra por sección.
3. **Conector {conn.gkg}** (`gkg.ts`): `parseLastupdateGkg`, `parseGkgCsvRows` (REUSA {conn.zip} importado de {conn.gdelt}), `fetchGkg`. Depende de (1) (tipos) y (2) (classify). Tests sobre un `.gkg.csv` de muestra (27 cols) + `lastupdate.txt` de muestra (R-8).
4. **Job del scheduler** ({pkg.scheduler}) en tier medium: gkg→medium; NO toca el job gdelt. Depende de (1) y (3).
5. **Endpoints en `server.ts`**: `/api/signals`, `/api/signals/trend`. Dependen de (1). **Fichero de alto conflicto** → serializar el toque del registro de rutas.
6. **Capas por sección {web.layers.config} + panel Radar {web.radar.panel} + {web.map.tie}** ({pkg.web}): entradas por sección + panel responsive + estado compartido en App.tsx. Depende de (5) (consume la API); puede avanzar contra mock mientras (5) madura.
7. **Ampliación de feeds {conn.news.allowlist}** (+ ruta de las señales RSS a {sig.table}): AÑADE feeds verificados; las señales RSS se clasifican por keyword/entidad (D-205). Depende de (1) y (2). Bloqueada por OQ-8 (ToS de feeds) — puede diferirse si no se verifican feeds a tiempo.

Orden serial seguro para un solo dev: 1 → 2 (paralelo) → 3 → 4 → 5 → 6 → 7. Ficheros de alto conflicto a serializar: `server.ts`, {web.layers.config}, las migraciones del store, el `index.ts` del store.

Diagrama de flujo de datos (texto/ASCII):

```
        upstream (keyless, verificado en vivo 2026-06-14)
   GDELT 2.0 GKG (.gkg.csv.zip)            feeds RSS temáticos (allowlist)
   670 art/15min, 2.75 MB, ETag            (SSRF-safe, ToS uso personal)
   27 cols TAB, geo DEL ARTÍCULO                     |
        |                                            |
        v                                            v
   [conn.gkg] --REUSA--> {conn.zip} (extractZipFirstEntry de gdelt.ts)   [conn.news]
        |                                            |
        |  parseGkgCsvRows: temas/tono/entidades/geo/título              |
        v                                            v
        +--------------------------------------------------------+
        |   {sig.sections.config} classify()  (sections.config.ts)|  theme + keyword + entity -> 0..N secciones (D-203)
        +-----------------------------+--------------------------+
                                      |  SignalRow[] (+ sections[] con matchedBy)
                                      v
        +--------------------------------------------------------+
        |                 {pkg.scheduler}                        |  gkg -> medium {sched.tiers}
        |   upsertSignals ANTES de servir (server-side)          |  (NO fanout en navegador)
        +-----------------------------+--------------------------+
                                      | dedup por {sig.id} (UPSERT)
                                      v
        +--------------------------------------------------------+
        |                     {pkg.store}                        |
        |  signals + signal_sections (article-level, SEPARADA    |
        |  de events). ix por recent/tone/occ/section.           |
        +-----------------------------+--------------------------+
            | getSignals / getSignalTrend (solo-lectura, ADR-004)
            v
        +----------------------+
        |      server.ts       |   GET /api/signals
        |  /api/signals/trend  |   (NUNCA llama upstream)
        +---------+------------+
                  | HTTP (web NUNCA llama upstream)
                  v
        +--------------------------------------------------------+        +--------------------------+
        |                      {pkg.web}                         |        |  events (rebanada 1)     |
        |  Panel Radar (6 secciones, titulares+tendencia+tono    |<--tie--|  conflict/protest geo    |
        |  +entidades) {web.map.tie}: sección -> filtra mapa     |        |  REAL del suceso (D-006) |
        |  capas signals por sección en {web.layers.config}      |        +--------------------------+
        |  political_instability reusa capas de events           |
        +--------------------------------------------------------+
```

## Known Gaps / Open Questions

> Lo que este diseño NO resuelve y las decisiones internas que el PM debe ratificar. Evita confianza alucinada.

Known Gaps (limitaciones aceptadas de esta rebanada):

- **GAP-1 — Geo del artículo ≠ geo del suceso**: {sig.geo} (V2Locations del GKG, 74% con lat/lon) es del **artículo/entidad mencionada**, NO del suceso (R-3/NG-4). El mapa pinta las señales aproximadamente; la geo del suceso solo la dan los `events` de la rebanada 1 (97.6% del suceso). No se construye geocodificación de suceso para señales en esta rebanada.
- **GAP-2 — Sesgo anglófono y de volumen del GDELT**: el GKG infla medios anglófonos y temas mediáticos; secciones nicho (critical_minerals, digital_infra_cyber) tendrán menos volumen que política/commodities (R-4). {sig.trend} es intra-sección (no comparación cruzada). Mitigable parcialmente añadiendo feeds RSS especializados (G-8) y, en el futuro, fuentes keyed (NG-7).
- **GAP-3 — Cobertura débil de semis/ciber/data-centers**: estas 3 áreas son **keyword-dependientes** (theme-codes GKG pobres); la cobertura depende de la calidad de la lista de keywords/entityHints en {sig.sections.config} y de los feeds RSS especializados (R-1). Es el área de mayor incertidumbre de cobertura del radar.
- **GAP-4 — Calibración del clasificador {sig.sections.config}**: el mapa sección→reglas es un punto de partida editorial verificado en vivo, NO calibrado con datos reales; falsos positivos/negativos (esp. semis/ciber) necesitan iteración tras observar señales reales (R-1, OQ-4), posiblemente con `intel-analyst` y el `LOOKUP-GKGTHEMES.TXT`.
- **GAP-5 — Tono solo del GKG**: las señales RSS no traen V2Tone, así que su {sig.tone} es null y no contribuyen a la parte de tono de {sig.trend}, solo al volumen (D-205). La tendencia de tono de una sección refleja solo sus señales GKG.
- **GAP-6 — Convergencia cross-tema sigue Non-Goal**: {sig.table}+`events` son el **input** de la síntesis cross-tema, pero cruzar las 6 secciones entre sí (y con finanzas/CII) NO se construye aquí (NG-1). Sigue siendo el spike de mayor riesgo, pendiente de su propio Research→Plan→Check.
- **GAP-7 — Acceso al doc editorial de worldmonitor**: el mapa sección→reglas y {sig.trend} se re-derivan de la cobertura verificada en vivo + el codebook GKG público; el doc de worldmonitor NO se consulta para evitar contaminación AGPL (D-008). Validar criterios = referencia de metodología, nunca copiar texto.

Open Questions (decisiones internas a ratificar por el PM):

- **OQ-1 (modelo multi-sección)**: ¿tabla puente `signal_sections` (recomendado, D-200, sección indexable) vs columna `sections TEXT` JSON (filtrado en memoria, más simple)? Recomendación: tabla puente (`getSignals(section)` con índice). Bloquea el schema de `003_signals.sql`.
- **OQ-2 (parseo de V2ExtrasXML)**: ¿match de etiqueta `PAGE_TITLE` simple (recomendado, D-201, sin dep) vs fast-xml-parser (ya disponible en @www/connectors)? Recomendación: match simple (V2ExtrasXML es un blob grande; un parser completo es overkill para un campo). Si el título sale sucio, reconsiderar fast-xml-parser.
- **OQ-3 (clave de dedup {sig.id})**: ¿GKGRECORDID (recomendado, D-202, id nativo) vs hash de SOURCEURL? Recomendación: GKGRECORDID para GKG, url canónica para RSS. Confirmar que GKGRECORDID es único y estable entre batches (verificación lo sugiere, no exhaustiva).
- **OQ-4 (calibración del clasificador)**: el mapa de {sig.sections.config} es punto de partida; ¿arrancar con él y calibrar tras la 1ª semana (recomendado) o pre-refinar con `LOOKUP-GKGTHEMES.TXT` antes de implementar? Recomendación: arrancar + iterar con datos reales y `intel-analyst`. Afecta a la calidad percibida del radar (R-1/GAP-4).
- **OQ-5 (tier y retención)**: ¿gkg→medium (recomendado, D-204) vs slow? ¿retención de signals = misma ventana que events o más corta (más volumen)? Recomendación: medium + retención igual a events de inicio, acortar si el volumen (R-5) lo exige tras medir.
- **OQ-6 (panel separado vs integrado)**: ¿RadarPanel nuevo (recomendado, D-206) vs ampliar EventsPanel con pestañas? Recomendación: panel nuevo (responsabilidad única; events y radar son vistas distintas). Decisión de UX del PM.
- **OQ-7 (geometría de capas signals)**: ¿heatmap para densidad + circle (recomendado, D-207) vs solo circle? ¿señales sin geo solo en panel (recomendado) o un marcador agregado por país? Recomendación: heatmap+circle por sección; señales sin geo solo en panel.
- **OQ-8 (feeds RSS temáticos concretos)**: **los feeds RSS por sección NO están verificados en esta sesión** (ToS + hostname). G-8/D-205 define el mecanismo (ampliar {conn.news.allowlist}), pero los feeds concretos (energía/commodities, tech/semis, ciber) requieren verificación de ToS (uso personal) ANTES de añadirse (feedback_data_tos, R-7). El PM debe ratificar: (a) qué feeds investigar/verificar, o (b) diferir la sub-tarea (7) de feeds RSS a una iteración posterior y entregar el radar solo con backbone GKG en esta rebanada. Recomendación: entregar el radar con GKG primero; añadir feeds verificados en una iteración incremental.

## PLANNING COMPLETE
