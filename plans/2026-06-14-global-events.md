---
version: alpha
name: plan-global-events
description: Plan de implementación de la capa de eventos globales multi-fuente (Fase 2, 1ª rebanada, ADR-010) derivado del design-doc 2026-06-13-global-events. 8 tareas en 5 waves, lock por disjunción de files_modified, verify <60s por tarea. 3 conectores keyless (USGS earthquakes, NASA EONET, GDELT raw Events CSV) + tabla `events` unificada que reemplaza `gdelt_events` + normalizador de severity 0..100 + jobs scheduler por volatilidad + endpoints /api/events + capas MapLibre por tipo + enriquecimiento del briefing. Las referencias a ADR-NNN/D-NNN/G-NNN son trazabilidad de cobertura; cada decisión se DEFINE en plans/DECISIONS.md o en el design-doc. Pendiente de /check-plan.
status: draft
date: 2026-06-14
owner: pm-coordinator
---

# Plan de Implementación — Capa de Eventos Globales (Fase 2 · rebanada 1)

- **Fecha:** 2026-06-14
- **Autor:** PM Coordinator
- **Design-doc fuente:** [docs/design/2026-06-13-global-events.md](../docs/design/2026-06-13-global-events.md)
- **Estado:** Pendiente de `/check-plan` (gate PREVIO) → aprobación del usuario → implementación wave-a-wave
- **Decisiones bloqueadas:** ADR-002/003/004/006/009/010 ([plans/DECISIONS.md](DECISIONS.md)) + D-001..007 (bloqueadas) + D-100..108 (internas, design-doc §Decisions)
- **Cadencia elegida (usuario):** wave a wave con checkpoint (igual que Fase 1).

## Goal (Objetivo)

Entregar la **función núcleo del proyecto**: información de eventos de TODO el mundo que afectan economía y seguridad — conflicto/político (GDELT) + natural/humanitario (terremotos USGS, desastres NASA EONET) — **geo-localizada con coords reales del suceso**, puntuada con una **severity comparable entre tipos (0..100)** y **persistida como time-series** para que la UI lea del store local (el diferencial, ADR-004). Cierra el flujo de punta a punta: 3 conectores keyless → tabla `events` unificada (reemplaza `gdelt_events` financiero) → scheduler por volatilidad → API solo-lectura → capas MapLibre por tipo + panel → enriquecimiento del briefing. Alcance = la 1ª rebanada de la Fase 2 del [ROADMAP](ROADMAP.md) (ADR-010). El motor de convergencia cross-domain y el motor CII NO se implementan aquí (Non-Goals).

## Decisiones internas ratificadas (OQ-1..8 del design-doc)

El PM ratifica las recomendaciones del architect, salvo OQ-2 (decidido por el usuario):

- **OQ-1 → D-100:** modelo de evento = **tabla `events` general unificada** con `raw_json` para lo idiosincrásico (no tabla-por-fuente, no EAV).
- **OQ-2 → DROP sin migrar (DECISIÓN DEL USUARIO, 2026-06-14):** la migración **NO copia** el histórico de `gdelt_events` (dato financiero trivial: severity null, geo = centroide del medio). Crea `events` + índices y **DROP `gdelt_events`**. Esto **simplifica D-101** (sin copia de filas) y **elimina R-6** (riesgo de pérdida en migración). El nuevo GDELT raw CSV reemplaza ese dato con coords reales del suceso. Retro-compat: `getRecentGdeltEvents` y `/api/gdelt` pasan a leer `events` filtrando `source='gdelt'`.
- **OQ-3 → D-102:** taxonomía {evt.type} de dos niveles (`category` macro `natural|conflict` + `event_type` específico). Set inicial: `earthquake, wildfire, volcano, storm, flood, landslide, drought, tempExtreme` (natural) + `conflict, protest` (GDELT QuadClass material/verbal-conflict). `assault/coercion/threat` quedan FUERA del set inicial (se añaden como entradas nuevas si se necesitan, sin reescribir). El `intel-analyst` congela el mapeo `EventCode/QuadClass`→{evt.type} en T-10c y las categorías EONET en T-10b.
- **OQ-4 → D-103:** las bandas de severity son un **punto de partida editorial propio**; calibración fina entre tipos se difiere a "tras 1ª semana con datos reales" (no bloquea). `raw_json` conserva la métrica nativa para re-derivar.
- **OQ-5 → D-104:** **UPSERT por {evt.id} `(source, source_event_id)`** (no append) — limita crecimiento y refleja transiciones (USGS automatic→reviewed, EONET open→closed).
- **OQ-6 → D-105:** tiers reusados: **USGS→fast, EONET→medium, GDELT→medium**. Riesgo de volumen de USGS `all_day` en fast → mitigado priorizando `significant_week` + `minSeverity` (R-2); reconsiderar a medium si infla.
- **OQ-7 → D-106:** geometría de capas = **circle por defecto + heatmap para densidad** (wildfire/conflict). Color/tamaño por {evt.severity}.
- **OQ-8 → D-108:** el {cii.bridge} se **documenta como contrato** (funciones de lectura por país); el motor CII NO se construye en esta rebanada (NG-2). GDELT como proxy honesto de Conflict/Unrest se decide al planificar la rebanada CII posterior.

## Correcciones de realidad (design-doc ↔ código actual) — verificadas en disco 2026-06-14

> El design-doc se escribió cuando el slice CII era la 1ª rebanada; el reorden (ADR-010) cambia hechos que el plan ajusta SIN reescribir el design-doc silenciosamente (Iteration Guide): se documentan aquí.

- **C-1 — La migración es `002_events.sql`, NO `003`.** Solo existe `packages/store/migrations/001_init.sql`. El `002` que el design-doc CII reservó (`cii_snapshots`) **nunca se construyó** (CII reordenado después). La migración de eventos es la **2ª** del proyecto. (Afecta D-101 → renombrar a `002_events.sql`.)
- **C-2 — `purgeAndDownsample` borra de `gdelt_events`** (`packages/store/src/index.ts:234-237`). Tras DROP de `gdelt_events`, esa sentencia rompería en runtime → T-08 la **repunta a `events`** (purga por `occurred_at`/`captured_at` > retención).
- **C-3 — `getRecentGdeltEvents` lee `gdelt_events`** (`index.ts:74-94`) y la consumen `server.ts` (`/api/gdelt`) y `briefing.ts` (`serializeContext`). T-08 la **re-cablea a `events WHERE source='gdelt'`** mapeando filas a la forma `GdeltEvent` legacy → mantiene `server.ts` y `briefing.ts` compilando/funcionando SIN tocarlos (retro-compat; el upgrade del briefing es T-14).
- **C-4 — GDELT `export.CSV.zip` es un contenedor ZIP** (no gzip); Node no trae lector ZIP. T-10c lo extrae con **`zlib.inflateRawSync` + parse manual del local-file-header** (1 entrada, offsets deterministas del codebook PKZIP) → **zero-dep** (no toca `package.json`, coherente con la convención connectors-min-deps). Fallback si frágil: dep pura-JS `fflate` (MIT) — requiere ADR/aprobación del PM (R-3).
- **C-5 — `ConnectorResult<T>` se exporta desde `finance/markets.ts`** y `geo/gdelt.ts` define su propia copia local. Los conectores nuevos (usgs/eonet) y el gdelt refactor usan `ConnectorResult<EventRow>` importando `EventRow` de `@www/store`. El barrel `packages/connectors/index.ts` es **fichero compartido de alto conflicto** → lo actualiza el PM post-wave B (lección Fase 1), no los agentes en paralelo.

## Quality Gates (obligatorios)

- **PREVIO:** este plan NO se presenta al usuario sin `plan-checker = PASS`.
- **POSTERIOR:** ninguna tarea/wave se marca completada sin verificación; el PM verifica contra `git diff`/salida real, no contra el chat. Gate `/verify` (verifier, goal-backward) al cerrar la rebanada.
- **Frontera de integración:** solo el PM (con aprobación humana) hace commit/push. Los especialistas implementan, verifican y reportan.
- **Lección de proceso (Fase 1):** dispatch directo de texto libre + prompts acotados (escribe-ficheros-primero) + verify del PM; NO `schema` forzado en Workflow ni prompts largos (matan a los subagentes por límite de turnos).

---

## Tasks (Tareas)

> Cada tarea tiene front-matter con `depends_on` + `files_modified` (la disjunción de ficheros es el lock). `verify_cmd` termina <60s. El agente devuelve `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED` + ficheros + salida-de-verify literal + Self-Report. Numeración T-08+ (continúa la de Fase 1, que llegó a T-07).

### T-08 — `packages/store/` modelo de evento unificado + migración `002_events.sql`

```yaml
id: T-08
description: Tabla events unificada (reemplaza gdelt_events) + migración 002 (DROP sin migrar) + EventRow + API upsert/get + repunte de purgeAndDownsample y getRecentGdeltEvents a events
agent: backend-architect
wave: A
depends_on: []
files_modified:
  - packages/store/migrations/002_events.sql   # NUEVA (C-1): crea events + índices, DROP gdelt_events
  - packages/store/src/types.ts                # añade EventRow + EventFilter; conserva GdeltEvent (legacy retro-compat)
  - packages/store/src/index.ts                # añade upsertEvents/getEvents/getEvent/getEventsByCountry; repunta purgeAndDownsample (C-2) y getRecentGdeltEvents (C-3)
  - packages/store/test/store.test.ts          # extiende: events upsert/dedup/filtros + getRecentGdeltEvents lee events + migración idempotente
boundaries:
  - "NO toques otros paquetes, ni server.ts, ni scheduler, ni connectors. La API se AÑADE; no reescribas la API de mercados/briefings existente."
  - "NO copies el histórico de gdelt_events (OQ-2 = DROP sin migrar). La migración solo crea events + índices y dropa gdelt_events."
constraints:
  - "ADR-006/D-004: @libsql/client sobre file:./data/world.db. PROHIBIDO better-sqlite3."
  - "C-1: el fichero de migración es 002_events.sql (solo existe 001_init.sql; el 002 del CII nunca se construyó)."
  - "D-100 (schema normativo §Interfaces): events(id PK AUTOINCREMENT, source, source_event_id, event_type, category, severity REAL 0..100, lat, lon, country, title, url, occurred_at, captured_at NOT NULL, raw_json) + UNIQUE(source, source_event_id)."
  - "Índices: ix_events_recent(captured_at), ix_events_type(event_type, occurred_at), ix_events_country(country, occurred_at), ix_events_sev(severity)."
  - "D-104: upsertEvents hace UPSERT por (source, source_event_id) — ON CONFLICT actualiza severity/title/url/occurred_at/captured_at/raw_json (transiciones automatic→reviewed / open→closed). NO append."
  - "C-2: purgeAndDownsample deja de borrar gdelt_events (tabla dropada) y purga events más viejos que beforeMs. Mantiene la lógica de market_snapshots/news_items/market_daily intacta."
  - "C-3 (retro-compat): getRecentGdeltEvents lee `events WHERE source='gdelt' AND captured_at>=? ORDER BY captured_at DESC LIMIT ?` y mapea cada fila a la forma GdeltEvent legacy (event_id=source_event_id, category, severity, lat, lon, captured_at) → server.ts y briefing.ts siguen funcionando sin tocarse."
  - "Migración idempotente vía _migrations (correr 2× no falla)."
  - "EventFilter: { type?, category?, bbox?:[minLon,minLat,maxLon,maxLat], sinceMs?, minSeverity?, limit? }. getEvents resuelve filtros con los índices."
  - "getEventsByCountry(sinceMs): Map<string, EventRow[]> agrupado por country (para {cii.bridge}, consumido por rebanada CII posterior)."
acceptance:
  - "Exporta: EventRow, EventFilter, upsertEvents, getEvents, getEvent, getEventsByCountry (además de la API existente intacta)."
  - "migrate() crea events + índices, dropa gdelt_events, y es idempotente (2× sin error)."
  - "upsertEvents inserta y, ante el mismo (source, source_event_id), ACTUALIZA en vez de duplicar (test con UPSERT verificable)."
  - "getEvents respeta type/category/minSeverity/sinceMs/bbox/limit (test por filtro)."
  - "getRecentGdeltEvents devuelve filas de events con source='gdelt' en forma GdeltEvent (test)."
  - "purgeAndDownsample no referencia gdelt_events y purga events > beforeMs (test)."
verify_cmd: "pnpm --filter @www/store exec tsc --noEmit && node --import tsx --test packages/store/test/*.ts"
```

### T-09 — Normalizador de severity `geo/severity.ts` (re-derivado, no-AGPL)

```yaml
id: T-09
description: Mapeo de la métrica nativa de cada fuente a severity 0..100 comparable, valores editoriales propios (no copiados de worldmonitor)
agent: intel-analyst
wave: A
depends_on: []
files_modified:
  - packages/connectors/geo/severity.ts
  - packages/connectors/geo/severity.test.ts
boundaries:
  - "NO toques otros conectores, ni store, ni el barrel index.ts (lo actualiza el PM). Funciones puras: primitivas → number."
constraints:
  - "ADR-002/D-006/feedback_no_agpl_copy: re-deriva en NUESTROS valores; NUNCA copies pesos/curvas/texto editorial de worldmonitor (AGPL). Usa la metodología documentada como referencia, no la fuente."
  - "Usa la skill `cii-scoring` como guía de metodología de normalización (criterios gradeables, no vibes)."
  - "D-103: todas devuelven 0..100 con CLAMP DURO. severityUsgs({mag,sig,alert,tsunami}) = base por sig/mag con piso por alert PAGER (yellow≥40, orange≥65, red≥85) + tsunami +10. severityEonet(eventType, magnitudeValue?, magnitudeUnit?) = banda base por categoría + componente log del magnitudeValue normalizado DENTRO de su unidad (acres/mb/hectáreas no comparables crudas). severityGdelt({quadClass,goldstein,avgTone}) = base por QuadClass (1→10,2→20,3→50,4→75) + Goldstein negativo + AvgTone negativo."
  - "Documenta el porqué de cada banda en comentarios (R-1: severity entre tipos es aproximada y ajustable). Valores en este único fichero."
acceptance:
  - "severityUsgs/severityEonet/severityGdelt exportadas; toda salida ∈ [0,100] (test con inputs extremos: clamp verificado)."
  - "Un M-grande con alert='red'+tsunami da severity alta; ruido sísmico (mag 0.x, sin alert) da baja (test)."
  - "GDELT QuadClass=4 (material-conflict) da más severity que QuadClass=1 (verbal-coop) (test)."
  - "Sin dependencia nueva en package.json; sin import de @www/store (funciones puras)."
verify_cmd: "pnpm --filter @www/connectors exec tsc --noEmit && node --import tsx --test packages/connectors/geo/severity.test.ts"
```

### T-10a — Conector `geo/usgs.ts` (terremotos)

```yaml
id: T-10a
description: Conector keyless USGS earthquakes patrón osiris → EventRow con coords reales del epicentro + severity USGS
agent: data-connector-dev
wave: B
depends_on: [T-08, T-09]
files_modified:
  - packages/connectors/geo/usgs.ts
  - packages/connectors/geo/usgs.test.ts
boundaries:
  - "NO toques otros conectores, ni store, ni scheduler, ni el barrel index.ts (lo actualiza el PM post-wave B), ni package.json."
constraints:
  - "Usa la skill `connector-pattern`. Patrón osiris: fetch + User-Agent + AbortSignal.timeout(8000) + fallback multinivel + retorno vacío gracioso (NUNCA throw al caller) + cache condicional."
  - "Fuentes (verificadas en vivo): summary/significant_week.geojson (impacto) + summary/all_day.geojson (volumen). Keyless. Respeta Cache-Control: max-age=60 (no pedir >1/min). Soporta If-Modified-Since (Last-Modified, sin ETag)."
  - "Mapea cada Feature GeoJSON a EventRow: source='usgs', source_event_id=feature.id, event_type='earthquake', category='natural', severity=severityUsgs(properties), lat/lon de geometry.coordinates, occurred_at=properties.time (epoch ms), title=properties.place, url=properties.url, raw_json con {alert,sig,mmi,cdi,tsunami,depth,status}."
  - "country: nearest-centroid contra COUNTRY_CENTROIDS (geo/country-centroids.ts); si el nearest está lejos → null (NG-7/R-8). NO inventes país."
  - "feedback_data_tos: USGS = U.S. Public Domain; atribución 'U.S. Geological Survey'. Regístralo en comentario para la UI ({evt.attribution})."
  - "Devuelve ConnectorResult<EventRow> { data, stale, fetchedAt }; importa EventRow de @www/store; fallback stale desde el último good en memoria (patrón gdelt actual)."
acceptance:
  - "Sin red, fetchUsgs() devuelve { data:[], stale, fetchedAt } sin lanzar."
  - "Log explícito en cada caída de nivel (no catch silencioso)."
  - "Cada EventRow tiene event_type='earthquake', category='natural', severity ∈ [0,100], lat/lon del epicentro (test con fixture GeoJSON)."
verify_cmd: "pnpm --filter @www/connectors exec tsc --noEmit && node --import tsx --test packages/connectors/geo/usgs.test.ts"
```

### T-10b — Conector `geo/eonet.ts` (desastres naturales NASA)

```yaml
id: T-10b
description: Conector keyless NASA EONET v3 patrón osiris → EventRow (13 categorías de desastre natural) + severity EONET por categoría
agent: data-connector-dev
wave: B
depends_on: [T-08, T-09]
files_modified:
  - packages/connectors/geo/eonet.ts
  - packages/connectors/geo/eonet.test.ts
boundaries:
  - "NO toques otros conectores, ni store, ni scheduler, ni el barrel index.ts (PM post-wave B), ni package.json."
constraints:
  - "Usa la skill `connector-pattern`. Patrón osiris (fetch + User-Agent + AbortSignal.timeout(8000) + fallback + retorno vacío gracioso + cache)."
  - "Endpoint (verificado en vivo): /api/v3/events/geojson?status=open&limit=20. R-4: limit<=20 (con 50 dio 503 transitorio). Keyless. Dominio público (17 U.S.C. §105)."
  - "Mapea categories[].id → event_type (D-102: wildfires→wildfire, volcanoes→volcano, severeStorms→storm, floods→flood, landslides→landslide, drought→drought, tempExtremes→tempExtreme; earthquakes EONET se DESCARTA — USGS es la fuente sísmica). category='natural'. severity=severityEonet(eventType, magnitudeValue, magnitudeUnit). occurred_at de geometry[].date. lat/lon de geometry[].coordinates [lon,lat]. source_event_id=id (p.ej. EONET_20442). raw_json con {categories, magnitudeValue, magnitudeUnit, closed}."
  - "Eventos closed!=null se UPSERT con estado cerrado en raw_json (no se borran)."
  - "country: nearest-centroid (geo/country-centroids.ts) o null (NG-7)."
  - "feedback_data_tos: atribución 'Data: NASA EONET'. Disclaimer 'visualization only'. Regístralo en comentario."
  - "Devuelve ConnectorResult<EventRow>; importa EventRow de @www/store; fallback stale en memoria."
acceptance:
  - "Sin red, fetchEonet() devuelve vacío gracioso sin lanzar."
  - "Mapea cada categoría EONET soportada a su event_type; earthquakes EONET se descarta (test)."
  - "severity ∈ [0,100]; eventos abiertos y cerrados se mapean (test con fixture)."
verify_cmd: "pnpm --filter @www/connectors exec tsc --noEmit && node --import tsx --test packages/connectors/geo/eonet.test.ts"
```

### T-10c — Conector `geo/gdelt.ts` REFACTOR (raw Events CSV, coords reales)

```yaml
id: T-10c
description: Refactor del conector gdelt de DOC artlist (financiero, centroide-país) a GDELT 2.0 raw Events CSV (conflicto/político con coords del suceso) → EventRow + severity GDELT
agent: data-connector-dev
wave: B
depends_on: [T-08, T-09]
files_modified:
  - packages/connectors/geo/gdelt.ts        # REESCRIBE el cuerpo: DOC artlist → raw Events CSV
  - packages/connectors/geo/gdelt.test.ts   # REESCRIBE: fixture CSV tab-separated 61 cols
boundaries:
  - "ALTO CUIDADO (retro-compat): cambia el tipo de retorno de ConnectorResult<GdeltEvent> a ConnectorResult<EventRow>. NO toques server.ts/briefing.ts — la retro-compat la da getRecentGdeltEvents en T-08 (C-3). NO toques otros conectores, ni store, ni el barrel (PM post-wave B), ni package.json."
constraints:
  - "Usa la skill `connector-pattern`. Patrón osiris + single-flight + serve-stale (ya presente)."
  - "Fuente (verificada en vivo): poll data.gdeltproject.org/gdeltv2/lastupdate.txt → URL del último export.CSV.zip. Keyless. ETag + If-None-Match (304 → reusa). Cache-Control max-age=3600. Cadencia natural 15min."
  - "C-4 (ZIP zero-dep): export.CSV.zip es contenedor PKZIP. Extrae con zlib.inflateRawSync tras parsear el local-file-header (firma PK\\x03\\x04, método=8 deflate, filename-len@26, extra-len@28, datos@30+n+m, compressed-size@18). NO añadas dependencia. Si el parse manual resulta frágil → PARA y reporta al PM (opción fflate MIT, requiere ADR)."
  - "Parsea CSV TAB-separated, 61 columnas, SIN header, por ÍNDICE FIJO del codebook. Constantes nombradas: COL_GLOBALEVENTID=0, COL_SQLDATE=1, COL_EVENTCODE=26, COL_QUADCLASS=29, COL_GOLDSTEIN=30, COL_AVGTONE=34, COL_ACTIONGEO_COUNTRYCODE=53, COL_ACTIONGEO_LAT=56, COL_ACTIONGEO_LONG=57, COL_SOURCEURL=60. R-3: valida nº de columnas == 61 por fila; descarta+loggea las que no cuadren (no catch silencioso)."
  - "Filtra filas sin ActionGeo_Lat/Long. Mapea a EventRow: source='gdelt', source_event_id=GlobalEventID, event_type por QuadClass/EventCode (D-102: QuadClass 3/4 con código de protesta CAMEO 14x→'protest', resto material/verbal-conflict→'conflict'), category='conflict', severity=severityGdelt({quadClass,goldstein,avgTone}), lat/lon=ActionGeo (coords del SUCESO, no centroide-país), country=ActionGeo_CountryCode, title=Actor1+EventCode legible, url=SOURCEURL, occurred_at desde SQLDATE, raw_json con {eventCode, quadClass, goldstein, avgTone, actor1, actor2, actionGeoFullName}."
  - "feedback_data_tos: GDELT = uso libre con citación; atribución 'Source: The GDELT Project (gdeltproject.org)'. Regístralo."
  - "Devuelve ConnectorResult<EventRow>; importa EventRow de @www/store. country-centroids.ts ya NO se usa para gdelt (GDELT da coords reales); déjalo (lo usan usgs/eonet)."
acceptance:
  - "Sin red / HTTP no-OK / 304, fetchGdelt() degrada gracioso (vacío o stale) sin lanzar."
  - "Parsea un fixture CSV de 61 cols y produce EventRow con lat/lon de ActionGeo (no centroide), severity ∈ [0,100], event_type ∈ {conflict, protest} (test)."
  - "Una fila con != 61 columnas se descarta y loggea (test)."
  - "La extracción ZIP (zlib.inflateRawSync) produce el CSV correcto desde un fixture .zip pequeño (test)."
verify_cmd: "pnpm --filter @www/connectors exec tsc --noEmit && node --import tsx --test packages/connectors/geo/gdelt.test.ts"
```

### T-11 — `packages/scheduler/` jobs de eventos (usgs/eonet/gdelt → upsertEvents)

```yaml
id: T-11
description: Reescribe defaultJobs — añade usgs(fast)/eonet(medium)/gdelt(medium) que persisten en events vía upsertEvents; reemplaza el job gdelt financiero; daily purga events
agent: backend-architect
wave: C
depends_on: [T-08, T-10a, T-10b, T-10c]
files_modified:
  - packages/scheduler/src/index.ts
  - packages/scheduler/test/scheduler.test.ts
boundaries:
  - "NO toques server.ts (importa createScheduler/defaultJobs; mantén su firma defaultJobs(cfg?, deps?): Job[]), ni los conectores, ni el store internamente (consúmelo por su API)."
constraints:
  - "ADR-004/D-003: server-side, SIN fanout en navegador. Cada job: fetch conector → upsertEvents ANTES de exponer."
  - "D-105: jobs nuevos en tiers EXISTENTES — usgs→fast, eonet→medium, gdelt→medium. NO inventes tier nuevo. El job 'gdelt' financiero (insertGdeltEvents) se REEMPLAZA por el de eventos (upsertEvents). markets/news/daily intactos."
  - "SchedulerDeps gana fetchUsgs/fetchEonet (ConnectorResult<EventRow>) + upsertEvents; fetchGdelt cambia a ConnectorResult<EventRow>; insertGdeltEvents deja de usarse (elimínalo de REAL deps). Mantén deps inyectables para tests (mocks que cuentan llamadas)."
  - "El tier daily extiende su mantenimiento: generateDailyBriefing (intacto) + purgeAndDownsample (que en T-08 ya purga events). Conserva el boot-sequencing (no-daily → await → daily, fix cold-start de Fase 1)."
acceptance:
  - "defaultJobs() devuelve jobs markets/usgs/eonet/gdelt/news/daily con sus tiers; usgs en fast, eonet/gdelt en medium (test)."
  - "Cada job de eventos llama upsertEvents con los datos del conector (mock que cuenta llamadas)."
  - "start() sigue idempotente y parable con stop(); intervalos configurables vía cfg (test)."
  - "No queda referencia a insertGdeltEvents en la ruta de producción."
verify_cmd: "pnpm --filter @www/scheduler exec tsc --noEmit && node --import tsx --test packages/scheduler/test/*.ts"
```

### T-12 — `server.ts` endpoints `/api/events` (+ retro-compat `/api/gdelt`)

```yaml
id: T-12
description: Endpoints solo-lectura GET /api/events (filtros) y GET /api/events/:source/:id; /api/gdelt sigue funcionando vía getRecentGdeltEvents (events source='gdelt')
agent: backend-architect
wave: D
depends_on: [T-08]
files_modified:
  - server.ts
  - server.test.ts
boundaries:
  - "FICHERO DE ALTO CONFLICTO: server.ts se toca en SERIE, nunca en paralelo. NO reimplementes lógica de store: impórtala (getEvents/getEvent ya existen tras T-08). Mantén el pipeline de middleware existente intacto (origin-check → CORS → rate-limit → SSRF-guard → route)."
constraints:
  - "D-107/ADR-004: SOLO-LECTURA del store; NUNCA dispara conectores on-request. Importa getEvents/getEvent de @www/store."
  - "GET /api/events → getEvents(filter) con querystring ?type=&category=&bbox=minLon,minLat,maxLon,maxLat&since=&minSeverity=&limit=. Parsea/valida los params (bbox = 4 floats; since/minSeverity/limit numéricos; ignora los ausentes)."
  - "GET /api/events/:source/:id → getEvent(source, id) (raw_json parseado en la respuesta); 404 si null. Patrón de match por regex como /api/markets/:symbol."
  - "/api/gdelt se mantiene (retro-compat OQ-2/C-3): ya lee getRecentGdeltEvents, que tras T-08 consulta events source='gdelt'. No requiere cambio salvo confirmar que sigue verde."
  - "Coloca las rutas nuevas ANTES del 404; respeta sendJson/método GET-only."
acceptance:
  - "GET /api/events devuelve eventos del store; los filtros type/category/minSeverity/since/limit/bbox funcionan (test con store sembrado)."
  - "GET /api/events/usgs/:id devuelve el detalle con raw_json parseado; 404 si no existe (test)."
  - "GET /api/gdelt sigue 200 leyendo events source='gdelt' (test)."
  - "El pipeline de middleware y los endpoints de Fase 1 (markets/briefing/health) siguen verdes."
verify_cmd: "pnpm -w exec tsc --noEmit && node --import tsx --test server.test.ts"
```

### T-13 — `packages/web/` capas por tipo + panel de eventos

```yaml
id: T-13
description: Capas MapLibre por tipo de evento en el config-array central + panel de eventos responsive con toggles + atribución; el cliente consume /api/events
agent: frontend-dev
wave: E
depends_on: [T-12]
files_modified:
  - packages/web/src/map/layers.config.ts      # entradas nuevas por tipo (source 'events')
  - packages/web/src/api/client.ts             # añade getEvents() → /api/events
  - packages/web/src/panels/EventsPanel.tsx    # NUEVO: lista por severidad/recencia + toggles por tipo + atribución
  - packages/web/src/App.tsx                   # monta EventsPanel + fuente 'events' del mapa
  - packages/web/src/map/MapView.tsx           # registra la source 'events' (datos de /api/events); sigue ITERANDO LAYERS (sin imperativo)
boundaries:
  - "NO toques server.ts ni los paquetes backend; consume solo la API HTTP /api/*. NO añadas capas imperativas: TODA capa en layers.config.ts (LAYERS iterado)."
constraints:
  - "ADR-003/D-005/D-008/feedback_central_layer_config: una entrada LayerSpec por tipo de evento (evt-earthquake, evt-wildfire, evt-volcano, evt-storm, evt-flood, evt-conflict, evt-protest…) con source 'events', toggleKey por tipo, visibleWhen por toggle, label legible. D-106/OQ-7: circle por defecto + heatmap para densidad (wildfire/conflict); color/tamaño por severity. Las capas legacy gdelt-events (source 'gdelt-events') se SUSTITUYEN por evt-conflict (el dato gdelt ahora vive en events)."
  - "D-003: la web lee SOLO /api/events (nunca upstream). client.ts gana getEvents(filter?) tipado."
  - "EventsPanel: lista de eventos top por severidad/recencia (de /api/events?minSeverity=&limit=) + toggles agrupados por category (natural/conflict) + estados loading/empty/error explícitos."
  - "feedback_data_tos: muestra {evt.attribution} en la UI: 'U.S. Geological Survey' · 'Data: NASA EONET' · 'Source: The GDELT Project (gdeltproject.org)'."
  - "ADR-008: responsive + mobile-first (375px → 1200px); el panel es drawer/colapsable en móvil sobre el mapa, lateral en desktop. Breakpoints en el sistema de estilos central, no inline dispersos."
acceptance:
  - "pnpm --filter @www/web build compila sin error."
  - "Añadir un tipo = añadir una entrada en layers.config.ts (el render itera el array; verificable)."
  - "EventsPanel maneja loading/empty/error; toggles por tipo encienden/apagan su capa."
  - "Atribución de las 3 fuentes visible. Usable a 375px y 1200px (verificable por qa-tester)."
verify_cmd: "pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build"
```

### T-14 — `packages/core/ai/` enriquecimiento del briefing con riesgo global

```yaml
id: T-14
description: serializeContext gana un bloque de riesgo de eventos globales construido desde events (todas las fuentes); no añade proveedor LLM ni llamada extra
agent: intel-analyst
wave: E
depends_on: [T-08]
files_modified:
  - packages/core/ai/src/briefing.ts
  - packages/core/ai/test/ai.test.ts
boundaries:
  - "NO toques store (consúmelo por su API @www/store: getEvents), ni connectors, ni server.ts, ni el router. NO añadas proveedor LLM (ADR-009)."
constraints:
  - "Usa la skill `llm-router` como referencia del pipeline (sin tocar el router). D-007/G-8: enriquece el briefing EXISTENTE; no cambia proveedor ni añade llamada LLM."
  - "Añade buildGlobalRiskContext(events: EventRow[]): string — Top-N eventos por severity/recencia (tipo, país, severity, occurred_at) en 24-48h; '' si vacío (el bloque se omite)."
  - "serializeContext incorpora el bloque global: lee getEvents({sinceMs: now-48h, minSeverity, limit}) (todas las fuentes, incl. conflicto GDELT). El bloque GDELT-financiero legacy se REEMPLAZA por este bloque unificado (gdelt ahora vive en events). generateDailyBriefing pasa a alimentar el contexto vía getEvents en vez de getRecentGdeltEvents."
  - "Mantén el contrato D-106 intacto: getCachedBriefing primero; NO dispara LLM si hay caché válida; degradación R-2 sin cambios."
acceptance:
  - "buildGlobalRiskContext('' si events vacío; bloque con tipo/país/severity si hay eventos (test)."
  - "serializeContext incluye el bloque de riesgo global desde getEvents (test con store sembrado de eventos multi-fuente)."
  - "generateDailyBriefing con caché válida NO llama al proveedor (test con mock que cuenta llamadas) — contrato D-106 preservado."
verify_cmd: "pnpm --filter @www/core-ai exec tsc --noEmit && node --import tsx --test packages/core/ai/test/*.ts"
```

---

## Wave Scheduler (paralelización segura)

La disjunción de `files_modified` es el lock. Paralelo dentro de wave, secuencial entre waves. Cadencia: **checkpoint del PM al cerrar cada wave** (verify + agent-comms) antes de la siguiente.

| Wave | Tareas (paralelas) | Agente(s) | Justificación lock |
|------|--------------------|-----------|--------------------|
| A | T-08 · T-09 | backend-architect + intel-analyst | T-08 = packages/store; T-09 = geo/severity.ts. Ficheros disjuntos. Ambas son fundacionales (bloquean conectores). T-09 no depende de EventRow (funciones puras). |
| B | T-10a · T-10b · T-10c | data-connector-dev ×3 | 3 ficheros de fuente disjuntos (usgs/eonet/gdelt). Todas dependen de T-08 (EventRow) + T-09 (severity). **El barrel index.ts lo actualiza el PM al cerrar la wave** (C-5, evita carrera del tsc del paquete compartido). |
| C | T-11 | backend-architect | Scheduler orquesta los 3 conectores → upsertEvents (necesita T-08 + T-10*). |
| D | T-12 | backend-architect | server.ts (alto conflicto) cabléa /api/events. Serial. Necesita T-08. |
| E | T-13 · T-14 | frontend-dev + intel-analyst | T-13 = packages/web; T-14 = packages/core/ai. Disjuntos. T-13 consume /api/events (T-12); T-14 lee getEvents (T-08). |

Orden serial seguro (1 dev): `A(08→09) → B(10a‖10b‖10c) → [PM: barrel] → C(11) → D(12) → E(13‖14)`.
Ficheros de alto conflicto a serializar / reservar al PM: `server.ts`, `packages/connectors/index.ts` (barrel), `packages/web/src/map/layers.config.ts`, las migraciones del store.

## Matriz de cobertura (Goal/decisión → tarea)

| Goal / Decisión | Tarea(s) |
|-----------------|----------|
| G-1 · D-100/D-101 (modelo unificado + migración, DROP sin migrar) | T-08 |
| G-2 · D-002 (3 conectores keyless verificados) | T-10a, T-10b, T-10c |
| G-3 · D-103 (severity 0..100 comparable) | T-09 (+ consumo en T-10a/b/c) |
| G-4 · D-104 (dedup UPSERT + índices + retención) | T-08 |
| G-5 · D-105 (tiers por volatilidad) | T-11 |
| G-6 · D-005/D-006/D-008 (capas por tipo en config-array) | T-13 |
| G-7 · D-107 (/api/events solo-lectura + atribución) | T-12, T-13 |
| G-8 · D-007 (briefing enriquecido, sin proveedor nuevo) | T-14 |
| G-9 · D-108 ({cii.bridge} documentado, getEventsByCountry) | T-08 (contrato; CII = rebanada posterior) |
| ADR-002/D-006 (no AGPL: severity/taxonomía re-derivadas) | T-09, T-10c |
| ADR-004/D-003 (scheduler persiste antes de servir; UI lee DB) | T-08, T-11, T-12, T-13 |
| ADR-006/D-004 (@libsql/client file://) | T-08 |
| ADR-009/D-007 (proveedor activo openai; sin nuevo) | T-14 |
| feedback_data_tos ({evt.attribution}) | T-10a, T-10b, T-10c, T-13 |
| feedback_zero_key_first (3 conectores keyless) | T-10a, T-10b, T-10c |
| C-1 (migración 002) | T-08 |
| C-2 (purgeAndDownsample → events) | T-08 |
| C-3 (getRecentGdeltEvents retro-compat) | T-08 (+ verifica T-12) |
| C-4 (ZIP zero-dep) | T-10c |
| C-5 (barrel = PM) | Wave B (post) |

## Risks (riesgos del design-doc + de realidad → tarea que mitiga)

| Riesgo | Mitigación | Tarea |
|--------|-----------|-------|
| R-1 severity normalizada subjetiva entre tipos | Valores en un único fichero ajustable; raw_json conserva métrica nativa; calibrar tras 1ª semana (OQ-4) | T-09 |
| R-2 sesgo de cobertura/volumen (USGS all_day ruido, GDELT infla anglófonos) | minSeverity en /api/events y capas; priorizar significant_week; coords del suceso reducen sesgo país-fuente | T-10a, T-10c, T-12, T-13 |
| R-3 GDELT CSV layout frágil (61 cols sin header) | Validar nº de columnas==61, descartar+loggear; constantes nombradas por índice; no catch silencioso | T-10c |
| R-4 EONET 503 con limit=50 | limit<=20 + retorno vacío gracioso + stale | T-10b |
| R-5 crecimiento de events | UPSERT (no append) limita a únicos; purge/downsample del tier daily; validar volumen 1ª semana | T-08, T-11 |
| R-3-zip (C-4) extracción ZIP sin dep | zlib.inflateRawSync + parse manual de local-file-header; si frágil → PARA y reporta al PM (fflate como fallback con ADR) | T-10c |
| R-7 deriva AGPL al re-derivar severity/taxonomía | feedback_no_agpl_copy; valores propios; verifier revisa | T-09, T-10c |
| R-8 country por nearest-centroid impreciso | country=null si el nearest está lejos; el mapa usa lat/lon reales, no el país (NG-7) | T-10a, T-10b |
| R-retrocompat (server/briefing rompen tras DROP) | getRecentGdeltEvents re-cableado a events source='gdelt' en T-08 mantiene server.ts/briefing.ts verdes hasta T-12/T-14 | T-08 |

## Fuera de alcance (Non-Goals del design-doc — NO se implementan)

Motor de convergencia cross-domain (NG-1/§9.1), motor CII (NG-2; aquí solo el contrato {cii.bridge}), ReliefWeb (NG-3, appname-gated), UCDP/ACLED (NG-4, key + ToS no verificable), GDELT GKG/Mentions (NG-5, pesado), PAGER detail/muertes por evento (NG-6), reverse-geocode point-in-polygon (NG-7), ML cliente/Tauri/MCP/dominios completos Educación-Política (NG-8). Razón en design-doc §Non-Goals.

## Verificación final (tras todas las waves)

1. Confirmar artefactos en disco + `git diff` (no regexear el chat). Barrel `connectors/index.ts` exporta fetchUsgs/fetchEonet/fetchGdelt(EventRow).
2. `pnpm -w exec tsc --noEmit` global en verde + suite de tests completa.
3. **Smoke EN VIVO** (lección Fase 1: verde ≠ funciona): arrancar `pnpm dev`, `curl /api/events` (eventos reales USGS/EONET/GDELT con coords), `/api/events/:source/:id`, `/api/gdelt` (retro-compat). Mapa con capas por tipo (qa-tester, 375/1200px).
4. `/verify` (agente `verifier`, goal-backward): caza stubs/TODO/catch vacío; wiring real (conector→upsertEvents→store, job→scheduler, capa en config-array iterada, panel importado, ruta en server.ts, bloque de riesgo en briefing); confirma DROP de gdelt_events + retro-compat; sin copia AGPL en severity/taxonomía.
5. Solo se reporta "Capa de eventos globales (Fase 2 rebanada 1) completada" con `verifier = VERIFIED`.
