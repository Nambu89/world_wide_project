---
version: alpha
name: plan-geoeconomic-radar
description: Plan de implementación del Radar Geoeconómico Temático (Fase 2, rebanada 2, ADR-011) derivado del design-doc 2026-06-14-geoeconomic-radar. 6 tareas en 5 waves, lock por disjunción de files_modified, verify <60s por tarea. GKG backbone (conector gkg.ts) + tabla signals article-level + clasificador editorial sección→reglas + tendencia volumen/tono + endpoints /api/signals + RadarPanel atado al mapa. RSS temático DIFERIDO (OQ-8). Lecciones de la rebanada 1 horneadas (contrato web camelCase, rebuild dist cross-package, tsc consolidado del PM, smoke+browser-E2E). Pendiente de /check-plan.
status: draft
date: 2026-06-14
owner: pm-coordinator
---

# Plan de Implementación — Radar Geoeconómico Temático (Fase 2 · rebanada 2)

- **Fecha:** 2026-06-14
- **Autor:** PM Coordinator
- **Design-doc fuente:** [docs/design/2026-06-14-geoeconomic-radar.md](../docs/design/2026-06-14-geoeconomic-radar.md)
- **Estado:** Pendiente de `/check-plan` (gate PREVIO) → aprobación del usuario → implementación wave-a-wave
- **Decisiones bloqueadas:** ADR-002/003/004/006/009/010/011 ([plans/DECISIONS.md](DECISIONS.md)) + D-001..008 (bloqueadas) + D-200..207 (internas, design-doc §Decisions)
- **Cadencia (usuario):** wave a wave con checkpoint (igual que rebanadas previas).

## Goal (Objetivo)

Entregar la **dimensión temática económica** que pidió el usuario: ver TODO lo que afecta a la economía mundial más allá de finanzas — inestabilidad política (revueltas/manifestaciones/cambios de gobierno), materias primas&energía, tierras raras&minerales críticos, semiconductores/IA/tech, infraestructura digital&ciber, comercio&sanciones — como un **radar de 6 secciones** alimentado por **GDELT GKG** (artículos del mundo etiquetados por tema + tono + entidades + geo), persistido y servido localmente, y **atado al mapa** de eventos ya construido. Alcance = 2ª rebanada de Fase 2 (ADR-011). El motor de convergencia cross-tema y el CII NO se construyen aquí (Non-Goals).

## Decisiones internas ratificadas (OQ-1..8 del design-doc)

El PM ratifica las recomendaciones del architect:

- **OQ-1 → D-200:** modelo multi-sección = **tabla puente `signal_sections`** (sección indexable), no columna JSON.
- **OQ-2 → D-201:** título por **match simple de `PAGE_TITLE`** en V2ExtrasXML (sin fast-xml-parser).
- **OQ-3 → D-202:** dedup por **`GKGRECORDID`** (GKG) / url canónica (RSS).
- **OQ-4 → D-203/GAP-4:** el clasificador `sections.config.ts` arranca con el mapa verificado en vivo y **se calibra con datos reales tras la 1ª semana** (+ `intel-analyst`); no se pre-refina ahora.
- **OQ-5 → D-204:** job **`gkg→medium`**; retención de signals = misma ventana que events (acortar si el volumen lo exige).
- **OQ-6 → D-206:** **RadarPanel nuevo** (responsabilidad única), no pestañas dentro de EventsPanel.
- **OQ-7 → D-207:** capas **heatmap+circle por sección**; señales sin geo solo en el panel.
- **OQ-8 → DECISIÓN DEL USUARIO (2026-06-14): GKG primero, RSS después.** Los feeds RSS temáticos (G-8) **NO entran en esta rebanada** — no se verificaron sus ToS (guardrail feedback_data_tos). Se difieren a un incremento posterior con ToS verificado. El radar se entrega con backbone GKG (cobertura+tono+tendencia ya completos).

## Lecciones de la rebanada 1 horneadas (OBLIGATORIO aplicarlas)

> Cazadas en la capa de eventos; se aplican aquí para no repetirlas. Ver [memory/world-wide-dev-environment.md] y [memory/feedback_api_contract_camelcase.md].

- **L-1 — Contrato web = camelCase.** `@www/store` serializa `SignalRow` con campos **camelCase** directos vía `JSON.stringify` (sin transform). El cliente web (`packages/web/src/api/client.ts`) DEBE tipar el wire en **camelCase** (`signalId`, `occurredAt`, `capturedAt`, `rawJson`, `sections`), NO snake_case. (BUG-1 de la rebanada 1: snake_case → undefined → 0 puntos en el mapa; 257 tests + tsc + smoke-curl no lo vieron.)
- **L-2 — Rebuild dist cross-package.** Los `@www/*` resuelven tipos cross-package vía el **`dist` construido** (`types: ./dist/index.d.ts`), no `src`. Tras cambiar el API de un paquete, el PM hace `pnpm --filter @www/<pkg> build` ANTES del tsc consolidado del downstream.
- **L-3 — tsx per-file ≠ typecheck.** `node --import tsx --test` transpila, no typecheck cross-file. El PM corre SIEMPRE el **tsc consolidado** del paquete + global al cerrar cada wave.
- **L-4 — Barrel = PM.** `packages/connectors/index.ts` (barrel) lo actualiza el PM post-wave, no los agentes en paralelo (carrera del tsc del paquete compartido).
- **L-5 — Verde ≠ funciona.** El cierre exige **smoke EN VIVO** (server real + curl /api/signals + trend) **y browser E2E** (Playwright; el qa-tester o el PM si su Bash está bloqueado), no solo tests verdes + /verify estático.
- **L-6 — Subagentes mueren ~30 turnos / con `schema` forzado.** Dispatch directo texto-libre + prompts acotados (escribe-ficheros-primero) + verify del PM.

## Quality Gates (obligatorios)

- **PREVIO:** este plan NO se presenta al usuario sin `plan-checker = PASS`.
- **POSTERIOR:** ninguna wave se marca completada sin verificación propia del PM (git diff/salida real, no chat). Gate `/verify` (goal-backward) + smoke en vivo + browser E2E al cerrar la rebanada.
- **Frontera de integración:** solo el PM (con aprobación humana) hace commit/push.

---

## Tasks (Tareas)

> Front-matter por tarea con `depends_on` + `files_modified` (la disjunción es el lock). `verify_cmd` <60s. El agente devuelve `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED` + ficheros + salida-de-verify literal + Self-Report. Numeración T-15+ (continúa: rebanada 1 llegó a T-14).

### T-15 — `packages/store/` tabla `signals` + migración `003_signals.sql` + API

```yaml
id: T-15
description: Tabla signals + signal_sections (puente) + migración 003 + SignalRow/Section/SignalTrendPoint + upsertSignals/getSignals/getSignalTrend + extensión de purgeAndDownsample
agent: backend-architect
wave: A
depends_on: []
files_modified:
  - packages/store/migrations/003_signals.sql   # NUEVA: signals + signal_sections + índices
  - packages/store/src/types.ts                 # añade Section, SignalRow, SignalTrendPoint
  - packages/store/src/index.ts                  # añade upsertSignals/getSignals/getSignalTrend; EXTIENDE purgeAndDownsample (signals)
  - packages/store/test/store.test.ts            # extiende: upsert+dedup+signal_sections, getSignals filtros, getSignalTrend buckets, purge, migración idempotente
boundaries:
  - "NO toques events ni la API existente (events/markets/briefings se AÑADE, no se reescribe). NO toques otros paquetes."
constraints:
  - "ADR-006/D-004: @libsql/client file://. PROHIBIDO better-sqlite3."
  - "Schema normativo (design-doc §Interfaces): signals(id PK, source, signal_id, title, url, tone, themes, persons, organizations, lat, lon, country, occurred_at, captured_at NOT NULL, raw_json) + UNIQUE(source, signal_id); signal_sections(signal_id FK ON DELETE CASCADE, section, matched_by, PK(signal_id,section)). Índices: ix_signals_recent(captured_at), ix_signals_tone(tone), ix_signals_occ(occurred_at), ix_sigsec_section(section)."
  - "C-1 análoga: la migración es 003_signals.sql (002 fue events; runner lexicográfico ordena tras 002). Idempotente vía _migrations. NO toca events ni gdelt_events."
  - "HAZARD migrate-runner (plan-checker W-2, trampa de runtime): migrate.ts hace `sql.split(';')` y DESCARTA cualquier chunk cuyo `.trim()` empieza por `--`. ⇒ en 003_signals.sql NINGÚN comentario `--` debe preceder a un statement dentro del mismo chunk delimitado por `;` (pon los comentarios tras un `;`, o evita comentario pegado justo antes de CREATE/DROP) — si no, el CREATE TABLE se descarta SILENCIOSAMENTE en runtime. El test DEBE assertar `SELECT name FROM sqlite_master WHERE name IN ('signals','signal_sections')` (y los índices) para cazar el descarte."
  - "D-202: upsertSignals hace UPSERT por (source, signal_id) y REESCRIBE las filas de signal_sections del artículo (borra+inserta sus secciones). Section = union de 6: political_instability|commodities_energy|critical_minerals|semis_ai_tech|digital_infra_cyber|trade_sanctions."
  - "getSignals({section?, sinceMs?, limit?, minToneMag?}): join signals×signal_sections cuando section presente; minToneMag = |tone| mínimo; orden por captured_at DESC; limit default 500."
  - "getSignalTrend(section, {sinceMs?, bucketMs?}): SignalTrendPoint[] {bucketMs, volume, avgTone} agregando por bucket (default 1h) volumen + AvgTone medio (ignora tone null en el promedio, cuéntalo en volume)."
  - "purgeAndDownsample: EXTIENDE para borrar signals + signal_sections con COALESCE(occurred_at,captured_at) < beforeMs (mantén intacto market/events/news)."
acceptance:
  - "Exporta Section, SignalRow, SignalTrendPoint, upsertSignals, getSignals, getSignalTrend (re-exporta los tipos en index.ts — L-1: consumidores los importan de @www/store)."
  - "migrate() crea signals+signal_sections+índices, idempotente 3×, NO dropa ni toca events."
  - "upsertSignals: re-upsert del mismo signal_id actualiza tone/sections sin duplicar (test)."
  - "getSignals por sección/minToneMag/since/limit (test por filtro); getSignalTrend agrega volumen+avgTone por bucket (test)."
  - "purgeAndDownsample purga signals viejos sin tocar events (test)."
verify_cmd: "pnpm --filter @www/store exec tsc --noEmit && node --import tsx --test packages/store/test/*.ts"
```

### T-16 — Clasificador editorial `geo/sections.config.ts` (re-derivado, no-AGPL)

```yaml
id: T-16
description: Mapa declarativo sección→{themeCodes,keywords,entityHints} + classify() que asigna 0..N secciones con matchedBy; valores editoriales propios
agent: intel-analyst
wave: A
depends_on: []
files_modified:
  - packages/connectors/geo/sections.config.ts
  - packages/connectors/geo/sections.config.test.ts
boundaries:
  - "NO toques otros conectores, ni store, ni el barrel (lo cablea el PM). Función PURA: NO importes @www/store (mantén Section como union local de 6 literales, espejo del store — preserva el paralelismo de Wave A; el conector T-17 reconcilia). Como severity.ts en la rebanada 1."
constraints:
  - "ADR-002/D-004/D-008/feedback_no_agpl_copy: re-deriva en NUESTROS valores; NUNCA copies temas/keywords/texto editorial de worldmonitor (AGPL). Usa la metodología + el codebook GKG público como referencia."
  - "Invoca la skill `cii-scoring` como guía de criterios gradeables (no vibes)."
  - "SECTIONS: Record<Section, {themeCodes[], keywords[], entityHints[]}> con el mapa de partida del design-doc §Interfaces (theme-codes fuertes en política/commodities/comercio; keyword/entity en critical_minerals/semis/cyber). Documenta el criterio de cada bloque en comentarios."
  - "classify({themes[], title, organizations[], persons[]}): Array<{section, matchedBy:'theme'|'keyword'|'entity'}>. themeCodes hacen match exacto o por prefijo (ENV_*, ECON_*). keywords case-insensitive sobre title + themes-join. entityHints sobre organizations/persons. Un artículo puede caer en 0..N secciones; dedup de secciones repetidas (precedencia theme > keyword > entity para matchedBy)."
acceptance:
  - "SECTIONS cubre las 6 secciones; classify exportada y pura (sin import @www/store, sin dep nueva)."
  - "Un artículo con WB_2462_POLITICAL_VIOLENCE_AND_WAR → political_instability matchedBy='theme' (test)."
  - "Un artículo con title 'rare earth export ban' → critical_minerals matchedBy='keyword' (test)."
  - "Un artículo con organization 'TSMC' → semis_ai_tech matchedBy='entity' (test)."
  - "Un artículo sin match → [] (test)."
verify_cmd: "pnpm --filter @www/connectors exec tsc --noEmit && node --import tsx --test packages/connectors/geo/sections.config.test.ts"
```

### T-17 — Conector `geo/gkg.ts` + util ZIP compartida `geo/zip.ts`

```yaml
id: T-17
description: Conector keyless GKG (27 cols) patrón osiris → SignalRow usando classify(); extrae el helper ZIP a geo/zip.ts y refactoriza gdelt.ts para reusarlo
agent: data-connector-dev
wave: B
depends_on: [T-15, T-16]
files_modified:
  - packages/connectors/geo/zip.ts          # NUEVO: extractZipFirstEntry (extraído de gdelt.ts, zero-dep zlib)
  - packages/connectors/geo/gdelt.ts         # refactor: importa extractZipFirstEntry de ./zip.js (sin cambiar comportamiento)
  - packages/connectors/geo/gkg.ts           # NUEVO conector
  - packages/connectors/geo/gkg.test.ts      # NUEVO test (fixture GKG 27-col + zip)
boundaries:
  - "NO toques el barrel index.ts (PM post-wave B), ni store/scheduler/server.ts/package.json. Al refactorizar gdelt.ts, NO cambies su lógica — solo mueve extractZipFirstEntry a zip.ts e impórtalo; los tests de gdelt deben seguir verdes (regresión)."
constraints:
  - "Usa la skill `connector-pattern`. Patrón osiris: fetch + User-Agent + AbortSignal.timeout(8000) + fallback multinivel + retorno vacío gracioso + single-flight + serve-stale (igual que gdelt.ts)."
  - "L-1: importa Section + SignalRow de @www/store (camelCase). Reconcilia con el union local del classify() de sections.config.ts (estructuralmente iguales)."
  - "Fuente (verificada en vivo): GET http://data.gdeltproject.org/gdeltv2/lastupdate.txt con If-None-Match (ETag); 304 → serve-stale. parseLastupdateGkg(text) = línea que termina en '.gkg.csv.zip'. GET el zip; REUSA extractZipFirstEntry (zip.ts, mismo PKZIP-deflate)."
  - "parseGkgCsvRows(csvText, capturedAt): split \\n → por fila split \\t, VALIDA ==27 columnas (descarta+loggea las que no, no catch silencioso). Subdelimitadores: V1Themes(col8) ';'-sep; V2Locations(col10) 'tipo#nombre#cc#adm1#lat#lon#featureid' (preferir tipo 3/4 para lat/lon reales, sino null); V2Persons(col12)/V2Organizations(col13) ';'-sep; V2Tone(col16) coma-sep → tone=AvgTone (1er valor); título de col27 V2ExtrasXML por match simple de <PAGE_TITLE>...</PAGE_TITLE> (D-201); url=col5; occurred_at de col2 (YYYYMMDDHHMMSS→epoch ms)."
  - "Llama classify({themes, title, organizations, persons}) → sections[]; DESCARTA artículos con 0 secciones (D-203). raw_json = V2Tone completo + matchedBy (auditoría)."
  - "feedback_data_tos: GDELT uso libre con citación; atribución 'Source: The GDELT Project (gdeltproject.org)'. Regístralo en comentario."
  - "Devuelve ConnectorResult<SignalRow>; exporta parseLastupdateGkg + parseGkgCsvRows puras para test (como parseGdeltCsvRows)."
acceptance:
  - "Sin red / 304 → fetchGkg() degrada gracioso (vacío o stale) sin lanzar."
  - "Fixture GKG 27-col → SignalRow con tone, themes, sections (vía classify), geo best-effort, título de PAGE_TITLE (test)."
  - "Fila con !=27 columnas se descarta+loggea (test). Artículo con 0 secciones se descarta (test)."
  - "Extracción ZIP desde fixture .zip produce el CSV (test). Los tests de gdelt.ts SIGUEN verdes tras el refactor (regresión)."
verify_cmd: "pnpm --filter @www/connectors exec tsc --noEmit && node --import tsx --test packages/connectors/geo/gkg.test.ts packages/connectors/geo/gdelt.test.ts"
```

### T-18 — `packages/scheduler/` job `gkg→medium`

```yaml
id: T-18
description: Job gkg (tier medium) → upsertSignals antes de servir; extiende el purge diario a signals. NO toca el job gdelt (events)
agent: backend-architect
wave: C
depends_on: [T-15, T-17]
files_modified:
  - packages/scheduler/src/index.ts
  - packages/scheduler/test/scheduler.test.ts
boundaries:
  - "NO toques server.ts (mantén la firma defaultJobs(cfg?,deps?):Job[]), ni conectores, ni store internamente. NO toques los jobs existentes (markets/usgs/eonet/gdelt/news/daily) salvo añadir gkg."
constraints:
  - "ADR-004/D-003: server-side, sin fanout. El job gkg: fetchGkg() → si data.length>0 → upsertSignals(data) ANTES de servir."
  - "D-204: tier medium (15min). SchedulerDeps gana fetchGkg (ConnectorResult<SignalRow>) + upsertSignals; loadDefaultConnectors añade fetchGkg desde @www/connectors. defaultJobs añade el job 'gkg' (no reemplaza gdelt)."
  - "El job daily ya llama purgeAndDownsample (que en T-15 ya purga signals). Conserva boot-sequencing (no-daily→await→daily)."
acceptance:
  - "defaultJobs() incluye el job 'gkg' tier medium; llama upsertSignals con los datos del conector (mock que cuenta llamadas)."
  - "Los jobs existentes (incl. gdelt→events) intactos; start idempotente + parable; firma defaultJobs sin cambios."
verify_cmd: "pnpm --filter @www/scheduler exec tsc --noEmit && node --import tsx --test packages/scheduler/test/*.ts"
```

### T-19 — `server.ts` endpoints `/api/signals` + `/api/signals/trend`

```yaml
id: T-19
description: Endpoints solo-lectura GET /api/signals (filtros) y GET /api/signals/trend (tendencia por sección)
agent: backend-architect
wave: D
depends_on: [T-15]
files_modified:
  - server.ts
  - server.test.ts
boundaries:
  - "FICHERO DE ALTO CONFLICTO: server.ts en serie. NO reimplementes store: importa getSignals/getSignalTrend. NO toques el pipeline de middleware ni los endpoints existentes (solo AÑADE rutas antes del 404)."
constraints:
  - "D-007/ADR-004: solo-lectura del store; NUNCA dispara conectores on-request."
  - "GET /api/signals → getSignals({section?, sinceMs?(since), limit?, minToneMag?}) por querystring. 'section' inválida (no ∈ las 6) → 400."
  - "GET /api/signals/trend?section=&since=&bucket= → getSignalTrend(section, {sinceMs, bucketMs}); section requerida (400 si falta/ inválida)."
  - "Mismo patrón sendJson/GET-only/regex que /api/events. Coloca antes del 404."
acceptance:
  - "GET /api/signals devuelve señales del store; filtros section/minToneMag/since/limit funcionan (test con store sembrado vía upsertSignals)."
  - "GET /api/signals/trend?section=commodities_energy devuelve SignalTrendPoint[] (test). section inválida → 400 (test)."
  - "Endpoints de rebanadas previas (events/markets/briefing/health) siguen verdes."
verify_cmd: "pnpm -w exec tsc --noEmit && node --import tsx --test server.test.ts"
```

### T-20 — `packages/web/` RadarPanel + capas `signals` por sección + map-tie

```yaml
id: T-20
description: RadarPanel (6 secciones, titulares+tendencia+entidades+atribución) + capas signals por sección en el config-array + atado al mapa; cliente getSignals/getSignalTrend (camelCase, L-1)
agent: frontend-dev
wave: E
depends_on: [T-19]
files_modified:
  - packages/web/src/api/client.ts            # añade getSignals/getSignalTrend + tipos wire CAMELCASE (L-1)
  - packages/web/src/map/layers.config.ts     # añade SIGNAL_LAYERS por sección (source 'signals', filterExpr por section)
  - packages/web/src/map/MapView.tsx          # registra source 'signals'; sigue iterando LAYERS (no imperativo)
  - packages/web/src/panels/RadarPanel.tsx    # NUEVO: 6 secciones plegables + tendencia/tono + entidades + atribución
  - packages/web/src/App.tsx                  # monta RadarPanel (3ª pestaña) + estado activeSection (map-tie)
  - packages/web/src/styles.css               # estilos radar (responsive, breakpoints centrales)
boundaries:
  - "NO toques server.ts ni backend; consume solo /api/*. TODA capa en layers.config.ts (LAYERS iterado por MapView; PROHIBIDO addLayer imperativo fuera del loop)."
constraints:
  - "L-1 (CRÍTICO — BUG-1 de la rebanada 1): el wire de /api/signals es CAMELCASE (`signalId`, `occurredAt`, `capturedAt`, `rawJson`, `sections:[{section,matchedBy}]`, `tone`, `lat`, `lon`). Tipa el RawSignalRow en camelCase; NO snake_case. Verifícalo contra un curl real antes de dar por bueno."
  - "D-206: RadarPanel nuevo (no pestañas dentro de EventsPanel). 6 secciones; por sección: titulares rankeados (getSignals section), indicador de tendencia/tono (getSignalTrend), entidades top, estados loading/empty/error explícitos."
  - "D-207/D-006: SIGNAL_LAYERS = una capa por sección (source 'signals', filterExpr ['==',['get','section'],<section>], heatmap/circle, |tone|→opacidad). political_instability NO añade capa signals: reusa las capas evt-conflict/evt-protest (events geo-real). Señales sin lat/lon NO se pintan (solo panel)."
  - "HAZARD contrato mapa (plan-checker W-3, evita un 2º BUG-1): `SignalRow.sections` es un ARRAY `[{section,matchedBy}]`, NO un escalar — MapLibre `['get','section']` NO indexa arrays. El source GeoJSON 'signals' DEBE emitir UNA feature por (señal × sección CON geo), con `section` como property ESCALAR en cada feature (expandir el array antes del setData). Señales sin lat/lon no emiten feature (solo panel). Verifícalo en el browser E2E del cierre (puntos por sección visibles)."
  - "{web.map.tie}: seleccionar sección en RadarPanel → App.tsx setActiveSection → el mapa muestra la capa de esa sección (o events para political_instability). Estado compartido React, no imperativo."
  - "feedback_data_tos: atribución 'Source: The GDELT Project (gdeltproject.org)' visible en el RadarPanel."
  - "ADR-008: responsive mobile-first (375→1200), breakpoints centrales."
acceptance:
  - "pnpm --filter @www/web build OK. Añadir una sección = añadir entrada en layers.config.ts (render itera el array)."
  - "client.getSignals/getSignalTrend tipados en camelCase (L-1); RawSignalRow camelCase."
  - "RadarPanel maneja loading/empty/error; seleccionar sección filtra el mapa (map-tie); atribución visible; usable 375/1200px."
verify_cmd: "pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build"
```

---

## Wave Scheduler (paralelización segura)

Disjunción de `files_modified` = lock. Paralelo dentro de wave, secuencial entre waves. Checkpoint del PM al cerrar cada wave (verify + rebuild dist L-2 + tsc consolidado L-3 + agent-comms).

| Wave | Tareas (paralelas) | Agente(s) | Justificación lock |
|------|--------------------|-----------|--------------------|
| A | T-15 · T-16 | backend-architect + intel-analyst | store (packages/store) ∥ sections.config.ts (geo). Disjuntos. T-16 puro sin import store (Section local) → paralelo legítimo (precedente severity.ts). |
| B | T-17 | data-connector-dev | conector gkg + util zip.ts + refactor gdelt.ts. Depende T-15+T-16. Wave single-task (sin conflicto paralelo). Barrel lo cablea el PM post-wave (L-4). |
| C | T-18 | backend-architect | scheduler job gkg (necesita store + conector). |
| D | T-19 | backend-architect | server.ts (alto conflicto), serial. Necesita T-15. |
| E | T-20 | frontend-dev | web RadarPanel+capas (consume /api/signals de T-19). |

Orden serial seguro (1 dev): `A(15‖16) → B(17) → [PM: barrel + rebuild dist store/connectors] → C(18) → D(19) → E(20)`.
Ficheros de alto conflicto / reservados al PM: `server.ts`, `connectors/index.ts` (barrel), `layers.config.ts`, migraciones del store.

## Matriz de cobertura (Goal/decisión → tarea)

| Goal / Decisión | Tarea(s) |
|-----------------|----------|
| G-1 (conector gkg, reusa zip) | T-17 |
| G-2 · D-203 (clasificador editorial) | T-16 (+ uso en T-17) |
| G-3 · D-200/D-202 (tabla signals + migración 003) | T-15 |
| G-4 (API store signals + trend) | T-15 |
| G-5 · D-204 (job gkg→medium) | T-18 |
| G-6 (endpoints /api/signals + trend) | T-19 |
| G-7 · D-206/D-207 (RadarPanel + map-tie + capas) | T-20 |
| G-8 (RSS allowlist) | DIFERIDO (OQ-8, fuera de esta rebanada) |
| ADR-002/D-004/D-008 (no-AGPL clasificador) | T-16, T-17 |
| ADR-004/D-003 (persistir antes de servir; UI lee DB) | T-15, T-18, T-19, T-20 |
| ADR-006 (@libsql/client) | T-15 |
| D-001/conn.zip (reusa extractZipFirstEntry) | T-17 |
| L-1 (web camelCase, anti-BUG-1) | T-20 |
| feedback_data_tos (atribución GDELT) | T-17, T-20 |
| feedback_no_agpl_copy | T-16 |

## Risks (design-doc + de realidad → tarea que mitiga)

| Riesgo | Mitigación | Tarea |
|--------|-----------|-------|
| R-1/GAP-4 clasificador sin calibrar (falsos pos/neg, esp. semis/ciber) | mapa de partida verificado en vivo; matchedBy para auditar; calibrar tras 1ª semana (OQ-4) con intel-analyst | T-16 |
| GAP-3 cobertura débil semis/ciber/data-centers (keyword-dependiente) | keywords/entityHints curados; documentar cobertura honesta | T-16 |
| R-3/GAP-1 geo del artículo ≠ del suceso | pintar best-effort (V2Locations tipo 3/4); political_instability usa events geo-real; sin geo → solo panel | T-17, T-20 |
| GKG CSV 27-col frágil (subdelimitadores) | validar ==27 cols, descartar+loggear; constantes por índice; no catch silencioso | T-17 |
| Regresión al refactorizar gdelt.ts (zip.ts) | mover solo el helper sin cambiar lógica; re-correr tests de gdelt (verde obligatorio) | T-17 |
| L-1 contrato web camelCase (BUG-1 repetible) | tipar wire camelCase + verificar contra curl real; browser E2E en el cierre | T-20, cierre |
| GAP-2 sesgo anglófono/volumen GDELT | trend intra-sección (no cruzado); minToneMag para filtrar ruido; documentar | T-15, T-20 |
| R-5 crecimiento de signals (670/15min) | UPSERT (no append) + purge diario de signals (retención=events) | T-15, T-18 |

## Fuera de alcance (Non-Goals del design-doc — NO se implementan)

Motor de convergencia cross-tema (NG-1), CII (NG-2), ML cliente Transformers.js (NG-3), reverse-geocode de suceso (NG-4), GCAM completo (NG-5), GKG Mentions / re-ingesta de Events (NG-6), fuentes keyed UCDP/ACLED/ReliefWeb/FRED-temático (NG-7), Tauri/MCP/dominios completos (NG-8). **Feeds RSS temáticos (G-8): DIFERIDOS a incremento posterior (OQ-8, ToS no verificado).** Razón en design-doc §Non-Goals + OQ-8.

## Verificación final (tras todas las waves)

1. Artefactos en disco + git diff. Barrel `connectors/index.ts` exporta `fetchGkg`. Rebuild dist store/connectors (L-2).
2. `pnpm -w exec tsc --noEmit` global + suite completa de tests (L-3).
3. **Smoke EN VIVO** (L-5): arrancar `pnpm dev`, `curl /api/signals` (señales reales GKG con sección/tono/título), `/api/signals/trend?section=commodities_energy`. Verificar wire camelCase real (L-1).
4. **Browser E2E** (L-5): RadarPanel renderiza secciones con titulares, tendencia, entidades, atribución; map-tie filtra; responsive 375/1200; 0 errores consola/red (qa-tester o PM con Playwright, patrón `events-e2e.mjs`).
5. `/verify` (verifier, goal-backward): wiring real (conector→upsertSignals→store, job→scheduler, capas en config-array iteradas, RadarPanel importado, rutas en server.ts), sin stubs/TODO/catch-vacío, clasificador no-AGPL, contrato web camelCase.
6. Solo se reporta "Radar Geoeconómico (Fase 2 rebanada 2) completado" con verifier=VERIFIED + smoke + E2E PASS.
