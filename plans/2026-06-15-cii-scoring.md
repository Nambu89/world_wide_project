---
version: alpha
name: plan-cii-scoring
description: Plan de implementación del Composite Instability Index (CII) por país — Fase 2 rebanada 3, derivado del design-doc refrescado 2026-06-15-cii-scoring. Motor clean-room (no-AGPL) de N componentes {conflict, economic, political, social} con fuentes REALES del store (events getEventsByCountry + signals GKG), EVENT_BLEND propio, FLOORS, decay-30d, boosts EQ/fire, cii_snapshots time-series + dynamicScore, /api/cii, capa por país + panel, enriquecimiento del briefing. 7 tareas (T-21..T-27) en 3 rondas paralelas dep-optimizadas. Convergencia cross-domain y conectores keyed = Non-Goal. Pendiente de /check-plan.
status: draft
date: 2026-06-15
owner: pm-coordinator
---

# Plan de Implementación — CII Scoring (Fase 2 · rebanada 3)

- **Fecha:** 2026-06-15
- **Autor:** PM Coordinator
- **Design-doc fuente:** [docs/design/2026-06-15-cii-scoring.md](../docs/design/2026-06-15-cii-scoring.md) (refresco; supersede 2026-06-13)
- **Estado:** Pendiente de `/check-plan` (gate PREVIO) → aprobación del usuario → implementación ronda a ronda
- **Decisiones bloqueadas:** ADR-001..011 ([plans/DECISIONS.md](DECISIONS.md)) + D-001..005 (bloqueadas) + D-200..213 (internas, design-doc §Decisions)
- **Cadencia (usuario):** ronda a ronda con checkpoint (igual que rebanadas previas).

## Goal (Objetivo)

Entregar el **cerebro de scoring** del proyecto — el diferencial: un **Composite Instability Index (CII) por país** re-implementado clean-room de AGPL en `packages/core/cii`, calculado **server-side** desde el store sobre las capas reales ya construidas (events + signals), persistido como serie temporal con `dynamicScore`/tendencia, servido por `/api/cii` solo-lectura, pintado como capa por país + panel de riesgo, y usado para enriquecer el briefing. Motor de N componentes {conflict, economic, political, social} con fuente real keyless cada uno, presencia-de-señal + renormalización, FLOORS y decay-30d. Alcance = 3ª rebanada de Fase 2. El **motor de convergencia cross-domain** (`packages/core/signals`) y los **conectores keyed** (ACLED/UCDP/OFAC/FRED) son Non-Goals (el CII es input de la convergencia; consume lo persistido, no añade fuentes).

## Decisiones internas ratificadas (OQ-1..6 del design-doc)

El PM ratifica las recomendaciones del architect, **con una excepción crítica verificada en datos (OQ-2)**:

- **OQ-1 → D-201:** mapeo sub-señal→fuente RATIFICADO. conflict←events `category='conflict'` (severity + Goldstein); social←events `eventType='protest'` + GKG `political_instability` (mix 0.6 events / 0.4 GKG); economic←GKG `commodities_energy`+`trade_sanctions`+`critical_minerals` × AvgTone (semis/cyber FUERA, R-3/GAP-3); political←GKG `political_instability` + info-temp global.
- **OQ-1b → D-202:** RATIFICADO **por-país-con-piso-global**: señales GKG con `country` se atribuyen al país; las SIN país entran como temperatura temática global que modula el subscore (no se inventa geografía).
- **OQ-2 → D-203 RE-RATIFICADA = NORMALIZAR (el architect recomendó "usar tal cual"; los DATOS lo refutan).** **Verificación PM en `data/world.db` (smoke 2026-06-15):** la clave `EventRow.country` es **heterogénea entre fuentes** — GDELT persiste **FIPS 10-4** (115 claves de 2 letras: `JA`=Japón, `MX`=México, `CI`=Chile…), USGS persiste **nombres** (`Japan`, `Mexico`, `Chile`…). Usar la clave tal cual partiría cada país en 2 filas CII (los boosts EQ/fire de USGS nunca se sumarían al conflict de GDELT) → **índice roto**. R-2 del design-doc MATERIALIZADO. **Ratificación:** el motor CII incluye `normalizeCountryKey(rawCountry, source) → nombre canónico` (tabla FIPS→nombre para GDELT; identidad para USGS/EONET que ya dan nombre); la clave canónica = **nombre de país** (encaja con `connectors/geo/country-centroids.ts`, que es nombre→centroide → habilita los centroides de la capa, OQ-6). Esto NO toca los conectores (la capa events queda intacta; el CII normaliza al consumir — coherente con NG-2 "consume lo persistido").
- **OQ-3 → D-204:** RATIFICADO arranque con los **4 componentes presentes** (todos tienen fuente real); `signalPresent` se evalúa en runtime por presencia de datos en la ventana (si 0 datos → false + renormaliza).
- **OQ-4 → D-205:** RATIFICADOS **floors suaves escalados por baseline** (`floorEfectivo = baselineRisk * floorFactor`); `floorFactor` de partida por componente (p.ej. 0.10 conflict/social, 0.08 economic/political) en `blend.config.ts`, ajustables (calibración = GAP-5/NG-7). **OQ-4b → D-206:** RATIFICADO decay exponencial **vida-media 30d** + ventana 30d.
- **OQ-5 → D-211:** RATIFICADO tier **medium** (Conflict volátil, GDELT 15min) — cambia respecto al doc viejo (daily).
- **OQ-6 → D-213:** RATIFICADO **circle por centroide** (verificado: `layers.config.ts` NO carga GeoJSON de países; las sources son data-driven 'events'/'signals'). Centroide desde `country-centroids.ts` (nombre→[lat,lon]), keyed por el nombre canónico de OQ-2. El server `/api/cii` adjunta `lat/lon` por país (lookup de centroide) para que la web sea solo-store (no importe conectores); país sin centroide → solo panel, no mapa. Bandas render: 0-24/25-49/50-69/70-100.

## Lecciones de rebanadas previas horneadas (OBLIGATORIO)

- **L-1 — Contrato web camelCase.** `CiiSnapshotRow` se serializa camelCase directo; el cliente web tipa el wire en camelCase (`dynamicScore`, `eventScore`, `baselineRisk`, `capturedAt`, `componentsJson`/`components`). (Anti-BUG-1.)
- **L-2 — Rebuild dist cross-package.** Tras cambiar el API de un paquete, el PM hace `pnpm --filter @www/<pkg> build` ANTES del tsc consolidado del downstream. **NUEVO paquete `@www/core-cii`**: el PM verifica que entra en el workspace + tsconfig refs + se construye, ANTES de que scheduler/server lo consuman.
- **L-3 — tsx per-file ≠ typecheck.** El PM corre SIEMPRE el tsc consolidado del paquete + global al cerrar cada ronda. Los agentes en paralelo NO corren `pnpm -w exec tsc` (carrera shared-tree); su self-verify es package-scoped, el PM hace el global.
- **L-4 — Barrel/wiring = PM.** El workspace entry, los tsconfig refs y cualquier barrel los cabléa el PM post-ronda.
- **L-5 — Verde ≠ funciona.** Cierre exige smoke EN VIVO (server real + curl /api/cii + /api/cii/:country, con la DB poblada por el job medium) **y** browser E2E (capa por país + panel + map-tie + responsive).
- **L-6 — Dispatch directo, prompts acotados, escribe-ficheros-primero.** Los especialistas truncan ~30 turnos; el PM remata el verify. SIN schema forzado.
- **L-7 (NUEVA) — Verificar la clave de país antes de agrupar.** La heterogeneidad FIPS/nombre (OQ-2) se cazó verificando `data/world.db`, no asumiendo. El motor DEBE normalizar; un test asserta que `normalizeCountryKey('JA','gdelt') === normalizeCountryKey('Japan','usgs')`.

## Quality Gates (obligatorios)

- **PREVIO:** este plan NO se presenta al usuario sin `plan-checker = PASS`.
- **POSTERIOR:** ninguna ronda se marca completada sin verificación propia del PM (git diff/salida real). Gate `/verify` (goal-backward) + smoke en vivo + browser E2E al cerrar la rebanada.
- **Frontera de integración:** solo el PM (con aprobación humana) hace commit/push.
- **No-AGPL (D-001):** todo peso/floor/curva re-derivado en `blend.config.ts`/`coefficients.ts` (espejo de `severity.ts`/`sections.config.ts`); el `verifier` revisa; NUNCA copiar fuente/pesos verbatim/texto de worldmonitor.

---

## Tasks (Tareas)

> Front-matter por tarea con `depends_on` + `files_modified` (disjunción = lock). `verify_cmd` <60s. El agente devuelve `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED` + ficheros + salida-de-verify literal + Self-Report. Numeración T-21+ (continúa: rebanada 2 llegó a T-20).

### T-21 — `packages/store/` migración `004_cii.sql` + tipos + API CII

```yaml
id: T-21
description: Tabla cii_snapshots + migración 004 + CiiSnapshotRow (camelCase) + insertCiiSnapshots/getLatestCii/getCiiTrend/getPriorCii + extensión de purgeAndDownsample
agent: backend-architect
wave: A
depends_on: []
files_modified:
  - packages/store/migrations/004_cii.sql      # NUEVA: cii_snapshots + índice
  - packages/store/src/types.ts                # añade CiiSnapshotRow
  - packages/store/src/index.ts                # añade insert/getLatest/getTrend/getPrior; EXTIENDE purgeAndDownsample
  - packages/store/test/store.test.ts          # extiende: insert+getLatest(último por país)+getTrend+getPrior(~24h)+purge+migración idempotente
boundaries:
  - "NO toques events/signals/markets/news/briefings ni su API (se AÑADE). NO toques otros paquetes."
constraints:
  - "ADR-006/D-003: @libsql/client file://. PROHIBIDO better-sqlite3."
  - "Schema normativo (design-doc §Interfaces): cii_snapshots(id PK, country NOT NULL, composite REAL NOT NULL, baseline_risk REAL NOT NULL, event_score REAL NOT NULL, dynamic_score REAL, trend TEXT, methodology_version TEXT NOT NULL, components_json TEXT NOT NULL, captured_at INTEGER NOT NULL) + INDEX ix_cii_country_time(country, captured_at)."
  - "C-1 análoga: migración = 004_cii.sql (001 init, 002 events, 003 signals ya existen; runner lexicográfico ordena tras 003). Idempotente vía _migrations."
  - "HAZARD migrate-runner (W-2 de rebanada 2): migrate.ts hace sql.split(';') y DESCARTA chunks cuyo .trim() empieza por '--'. ⇒ en 004_cii.sql ningún comentario '--' precede a un statement en el mismo chunk. El test DEBE assertar SELECT name FROM sqlite_master WHERE name='cii_snapshots' (y el índice)."
  - "L-1: CiiSnapshotRow serializa camelCase (country, composite, baselineRisk, eventScore, dynamicScore, trend, methodologyVersion, componentsJson, capturedAt). Re-exporta el tipo en index.ts."
  - "getLatestCii(): último snapshot por país (MAX(captured_at) por country). getCiiTrend(country, sinceMs): serie ASC. getPriorCii(country, aroundMs): el más cercano a aroundMs (para dynamicScore ~24h, D-209). insertCiiSnapshots(rows): inserta (append, NO upsert — es serie temporal)."
  - "purgeAndDownsample: EXTIENDE para purgar cii_snapshots con COALESCE(captured_at) < beforeMs (mantén intacto markets/events/signals/news)."
acceptance:
  - "Exporta CiiSnapshotRow, insertCiiSnapshots, getLatestCii, getCiiTrend, getPriorCii (re-exporta tipo)."
  - "migrate() crea cii_snapshots + índice, idempotente 3×, NO toca events/signals."
  - "getLatestCii devuelve 1 fila por país (la más reciente) con ≥2 snapshots sembrados (test)."
  - "getCiiTrend ASC por país; getPriorCii encuentra el snapshot ~24h antes (test)."
  - "purgeAndDownsample purga cii_snapshots viejos sin tocar events/signals (test)."
verify_cmd: "pnpm --filter @www/store exec tsc --noEmit && node --import tsx --test packages/store/test/*.ts"
```

### T-22 — `packages/core/cii/` skeleton + config editorial + coeficientes + normalización de país

```yaml
id: T-22
description: Scaffolding del paquete @www/core-cii + blend.config.ts (EVENT_WEIGHTS/FLOOR_FACTORS/COMPOSITE/decayWeight/BOOST/ECONOMIC_SECTIONS/SOCIAL_MIX) + coefficients.ts (COUNTRY_COEFFS/DEFAULT_COEFF/COMPONENT_REGISTRY) + country-key.ts (normalizeCountryKey FIPS→nombre, OQ-2)
agent: intel-analyst
wave: A
depends_on: []
files_modified:
  - packages/core/cii/package.json             # NUEVO @www/core-cii (espejo de @www/core-ai)
  - packages/core/cii/tsconfig.json            # NUEVO (espejo)
  - packages/core/cii/src/index.ts             # barrel del paquete (re-exporta config + tipos)
  - packages/core/cii/src/blend.config.ts      # NUEVO config editorial
  - packages/core/cii/src/coefficients.ts      # NUEVO tabla país + registro componentes
  - packages/core/cii/src/country-key.ts       # NUEVO normalizeCountryKey (FIPS→nombre)
  - packages/core/cii/test/cii-config.test.ts  # NUEVO: invariante suma EVENT_WEIGHTS===1, decay(0)=1/decay(30d)=0.5, normalize FIPS≡nombre
boundaries:
  - "Función PURA de config: NO importes @www/store (define CiiComponentKey local + Section como union local de 6, espejo del store — preserva paralelismo Wave A con T-21, precedente sections.config.ts). El motor T-23 reconcilia con los tipos del store. NO toques otros paquetes ni el workspace yaml (lo cabléa el PM, L-4)."
constraints:
  - "ADR-002/D-001/D-008/feedback_no_agpl_copy: re-deriva en NUESTROS valores; invoca la skill cii-scoring (criterios gradeables). NUNCA copies pesos verbatim ni texto de worldmonitor."
  - "blend.config.ts (design-doc §Interfaces): EVENT_WEIGHTS: Record<CiiComponentKey,number> = {conflict:0.25, economic:0.30, political:0.20, social:0.25} (SUMA EXACTA 1.0 — invariante con test de igualdad). FLOOR_FACTORS: Record<CiiComponentKey,number> (0..1, valores de partida conflict/social 0.10, economic/political 0.08). COMPOSITE={BASELINE_W:0.4, EVENT_W:0.6}. DECAY_HALF_LIFE_MS=30*24*3_600_000; decayWeight(ageMs)=0.5^(ageMs/halfLife) clamp[0,1]. BOOST={EARTHQUAKE_CAP:15, FIRE_CAP:15, COMBINED_CAP:25}. ECONOMIC_SECTIONS=['commodities_energy','trade_sanctions','critical_minerals']. SOCIAL_MIX={EVENTS_W:0.6, GKG_W:0.4}."
  - "coefficients.ts: COUNTRY_COEFFS: Record<string,{baselineRisk:number, eventMultiplier:number}> con clave=NOMBRE de país canónico (mismo espacio que country-centroids.ts), valores editoriales propios para los ~65 países; DEFAULT_COEFF={baselineRisk:30, eventMultiplier:1.0}. COMPONENT_REGISTRY: Array<{key, weight, storeSource, refinedBy}> (storeSource='events:category=conflict' etc.; refinedBy='connectors/geo/acled.ts'|null)."
  - "country-key.ts (OQ-2, CRÍTICO): normalizeCountryKey(raw: string, source: 'gdelt'|'usgs'|'eonet'): string → nombre canónico. GDELT da FIPS 10-4 de 2 letras (JA=Japan, MX=Mexico, CI=Chile, UP=Ukraine, US=United States...) → tabla FIPS_TO_NAME (cubre al menos los ~65 de country-centroids + los FIPS vistos en vivo). USGS/EONET ya dan nombre → identidad (trim). Raw vacío/desconocido → '' (descartado por el motor). Documenta la fuente FIPS (codebook público GDELT)."
acceptance:
  - "@www/core-cii existe, type-checks aislado, exporta config + coefficients + normalizeCountryKey."
  - "Test invariante: sum(Object.values(EVENT_WEIGHTS)) === 1.0 (igualdad exacta)."
  - "Test decay: decayWeight(0)===1; decayWeight(30*24*3.6e6) aprox 0.5 (tolerancia)."
  - "Test normalización (L-7): normalizeCountryKey('JA','gdelt') === normalizeCountryKey('Japan','usgs') (= 'Japan'); FIPS desconocido o '' → '' ."
verify_cmd: "pnpm --filter @www/core-cii exec tsc --noEmit && node --import tsx --test packages/core/cii/test/*.ts"
```

### T-23 — `packages/core/cii/` motor (4 componentes + blend + dynamic)

```yaml
id: T-23
description: compute{Conflict,Social,Economic,Political}Component + computeCii (blend+renorm+floors) + computeDynamic + computeAllCountries (orquestador que lee el store)
agent: intel-analyst
wave: B
depends_on: [T-21, T-22]
files_modified:
  - packages/core/cii/src/score.ts             # NUEVO motor
  - packages/core/cii/src/index.ts             # re-exporta el motor (añade a lo de T-22)
  - packages/core/cii/test/score.test.ts       # NUEVO: componentes, renorm, floors, decay aplicado, composite rango [0,100], dynamic+deadband, normalización al agrupar
boundaries:
  - "NO toques scheduler/server/web (los cablean T-24/25/26). Importa de @www/store los tipos EventRow/SignalRow/Section + getEventsByCountry/getSignals/getSignalTrend (store dist YA reconstruido por el PM tras T-21). Importa la config de ./blend.config.js + ./coefficients.js + ./country-key.js (T-22). Reconcilia el Section local de T-22 con el de @www/store (estructuralmente iguales)."
constraints:
  - "Invoca la skill cii-scoring. D-201 mapeo: computeConflictComponent(events category=conflict) — media time-decayed de severity sesgada por goldstein/quadClass de rawJson; computeSocialComponent(protest events + GKG political_instability, mix SOCIAL_MIX, + boosts EQ/fire de events natural del país, caps BOOST aplicados a social); computeEconomicComponent(GKG ECONOMIC_SECTIONS × AvgTone + globalTemp); computePoliticalComponent(GKG political_instability + globalInfoTemp)."
  - "computeCii (D-200/D-207/D-208): eventScore = blend EVENT_WEIGHTS renormalizado sobre componentes signalPresent=true; composite = clamp0_100(baselineRisk*0.4 + eventScore*0.6); methodologyVersion='cii-core-1'. Floors D-205: componente presente-sin-datos → score=floorEfectivo (baselineRisk*floorFactor); componente sin presencia → signalPresent=false + renormaliza."
  - "computeAllCountries(nowMs): getEventsByCountry(now-30d) + getSignals por ECONOMIC_SECTIONS y political_instability (now-30d); **agrupa aplicando normalizeCountryKey (OQ-2/L-7)** para unificar FIPS(gdelt)↔nombre(usgs/eonet); por país calcula los 4 componentes; devuelve CiiScore[]. computeDynamic(current, prior): dynamicScore=clamp(-100,100, composite-prior.composite) o 0 si prior null; trend deadband D-209."
  - "Clamp duro [0,100] en todo subscore y composite (test de rango). decay por occurredAt (fallback capturedAt)."
acceptance:
  - "Los 4 compute*Component devuelven CiiComponent con score [0,100], signalPresent, sources, detail (test cada uno con datos sembrados)."
  - "computeCii: renormalización sobre presentes (suma de pesos efectivos=1); composite siempre [0,100] (test rango con inputs aleatorios)."
  - "Floors: componente presente sin eventos → score=baselineRisk*floorFactor (test). Componente sin datos → signalPresent=false + renorm (test)."
  - "computeAllCountries agrupa Japan(usgs)+JA(gdelt) en UNA fila 'Japan' (test L-7, datos mixtos). computeDynamic: serie nueva→0/stable; con prior→delta+trend (test)."
verify_cmd: "pnpm --filter @www/core-cii exec tsc --noEmit && node --import tsx --test packages/core/cii/test/*.ts"
```

### T-24 — `packages/scheduler/` job `cii→medium`

```yaml
id: T-24
description: Job cii (tier medium) → computeAllCountries → computeDynamic vs getPriorCii → insertCiiSnapshots, ANTES de servir. NO toca otros jobs
agent: backend-architect
wave: C
depends_on: [T-21, T-23]
files_modified:
  - packages/scheduler/src/index.ts
  - packages/scheduler/test/scheduler.test.ts
boundaries:
  - "NO toques server.ts (firma defaultJobs intacta) ni conectores ni store internamente. NO toques jobs existentes (markets/usgs/eonet/gdelt/gkg/news/daily) salvo añadir cii."
constraints:
  - "ADR-004/D-002: server-side, persiste ANTES de servir. SchedulerDeps gana computeAllCountries (de @www/core-cii) + insertCiiSnapshots + getPriorCii (de @www/store). loadDefaultConnectors/REAL_STORE_AI_DEPS añaden lo necesario. defaultJobs añade job 'cii' tier 'medium' (junto a eonet/gdelt/gkg)."
  - "D-211 tier medium. El job: snapshots = await computeAllCountries(now); por cada uno computeDynamic(current, await getPriorCii(country, now-24h)) → fusiona dynamic; insertCiiSnapshots(rows). Conserva boot-sequencing (no-daily→await→daily) y el job daily (purgeAndDownsample ya purga cii_snapshots tras T-21)."
acceptance:
  - "defaultJobs() incluye job 'cii' tier medium; ejecutarlo llama computeAllCountries + insertCiiSnapshots (mock que cuenta)."
  - "Jobs existentes intactos; firma defaultJobs sin cambios; start idempotente+parable."
verify_cmd: "pnpm --filter @www/scheduler exec tsc --noEmit && node --import tsx --test packages/scheduler/test/*.ts"
```

### T-25 — `server.ts` endpoints `/api/cii` + `/api/cii/:country`

```yaml
id: T-25
description: Endpoints solo-lectura GET /api/cii (último por país + centroide adjunto) y GET /api/cii/:country (tendencia)
agent: backend-architect
wave: B
depends_on: [T-21]
files_modified:
  - server.ts
  - server.test.ts
boundaries:
  - "FICHERO DE ALTO CONFLICTO (serial). NO reimplementes store: importa getLatestCii/getCiiTrend. NO toques pipeline middleware ni endpoints existentes (solo AÑADE rutas antes del 404)."
constraints:
  - "D-212/ADR-004: solo-lectura; NUNCA dispara el motor on-request. GET /api/cii → getLatestCii(); ADJUNTA lat/lon por país desde country-centroids.ts (import de @www/connectors si lo exporta, o de la ruta del fichero; OQ-6) para que la web no importe conectores; país sin centroide → lat/lon null (panel only). GET /api/cii/:country → getCiiTrend(country, since (querystring, default now-30d))."
  - "Wire camelCase L-1 (CiiSnapshotRow ya camelCase). Mismo patrón sendJson/GET-only/regex que /api/events|/api/signals. /api/cii/:country (regex) ANTES de /api/cii."
acceptance:
  - "GET /api/cii devuelve último por país con lat/lon adjunto (test con store sembrado vía insertCiiSnapshots)."
  - "GET /api/cii/:country devuelve tendencia (test). País sin datos → [] (no 500)."
  - "Endpoints previos (events/signals/markets/briefing/health) siguen verdes."
verify_cmd: "node --import tsx --test server.test.ts"
```

### T-26 — `packages/web/` capa CII por país + RiskPanel + map-tie

```yaml
id: T-26
description: Capa cii-by-country (circle por centroide) en el config-array + RiskPanel (top países por composite + trend + componente dominante) + cliente getCii/getCiiTrend (camelCase L-1)
agent: frontend-dev
wave: C
depends_on: [T-25]
files_modified:
  - packages/web/src/api/client.ts            # añade getCii/getCiiTrend + RawCiiRow CAMELCASE (L-1)
  - packages/web/src/map/layers.config.ts     # añade CII_LAYER (source 'cii-countries', circle por centroide, color por banda composite)
  - packages/web/src/map/MapView.tsx          # registra source 'cii-countries'; ciiToGeoJSON (lat/lon del centroide adjunto); itera LAYERS (no imperativo)
  - packages/web/src/panels/RiskPanel.tsx     # NUEVO: top países por composite, flecha trend, componente dominante, bandas, estados loading/empty/error
  - packages/web/src/App.tsx                  # monta RiskPanel (4ª pestaña) + toggle capa cii
  - packages/web/src/styles.css               # estilos panel riesgo (responsive)
boundaries:
  - "NO toques server.ts ni backend; consume solo /api/cii*. TODA capa en layers.config.ts (iterada por MapView; PROHIBIDO addLayer imperativo)."
constraints:
  - "L-1 (anti-BUG-1): el wire de /api/cii es CAMELCASE (composite, baselineRisk, eventScore, dynamicScore, trend, methodologyVersion, components/componentsJson, country, lat, lon, capturedAt). Tipa RawCiiRow camelCase; verifica contra curl real."
  - "D-213/OQ-6: CII_LAYER = circle por centroide (lat/lon adjunto por el server), color por step de composite (bandas 0-24/25-49/50-69/70-100), source 'cii-countries'. ciiToGeoJSON: 1 feature por país CON lat/lon; países sin centroide → solo panel. RiskPanel: parsea components_json/components para el componente dominante; estados explícitos; atribución de fuentes (USGS/EONET/GDELT/GKG). map-tie: seleccionar país en RiskPanel → centra/resalta (estado React)."
  - "ADR-008 responsive mobile-first 375→1200."
acceptance:
  - "pnpm --filter @www/web build OK. client.getCii/getCiiTrend camelCase (RawCiiRow camelCase)."
  - "CII_LAYER en config-array (render itera); RiskPanel maneja loading/empty/error; responsive."
verify_cmd: "pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build"
```

### T-27 — `packages/core/ai/` enriquecimiento del briefing con CII

```yaml
id: T-27
description: buildRiskContext(latest) + inserción en serializeContext (top países por CII + dynamic + componente dominante); sin proveedor LLM nuevo
agent: intel-analyst
wave: C
depends_on: [T-21]
files_modified:
  - packages/core/ai/src/*.ts                 # buildRiskContext + serializeContext (bloque riesgo desde getLatestCii)
  - packages/core/ai/test/*.ts                # test: bloque con datos; '' si vacío; sin proveedor nuevo
boundaries:
  - "NO toques el router ni el proveedor (ADR-009 openai). NO toques store/scheduler/server/web. Importa getLatestCii de @www/store."
constraints:
  - "D-005: SIN proveedor LLM nuevo ni 2ª llamada. buildRiskContext(latest: CiiSnapshotRow[]): string — 'Top N países por composite + dynamicScore/trend + componente dominante'; '' si vacío (serie nueva). serializeContext gana el bloque desde getLatestCii. Contrato caché del briefing intacto."
acceptance:
  - "buildRiskContext devuelve bloque con datos sembrados; '' si vacío (test)."
  - "serializeContext incluye el bloque; sin proveedor nuevo (test). Suite core-ai verde."
verify_cmd: "pnpm --filter @www/core-ai exec tsc --noEmit && node --import tsx --test packages/core/ai/test/*.ts"
```

---

## Wave Scheduler (paralelización dep-optimizada)

Disjunción de `files_modified` = lock. Paralelo dentro de ronda, secuencial entre rondas. Checkpoint del PM al cerrar cada ronda (verify + rebuild dist L-2 + tsc consolidado L-3 + agent-comms). **Optimización (como rebanada 2): T-25 server depende solo de T-21, no del motor → corre con T-23.**

| Ronda | Tareas (paralelas) | Agente(s) | Lock |
|-------|--------------------|-----------|------|
| **A** | T-21 · T-22 | backend-architect + intel-analyst | store (packages/store) ∥ core-cii config (packages/core/cii, SIN import store). Disjuntos, precedente T-15‖T-16. |
| **B** | T-23 · T-25 | intel-analyst + backend-architect | core-cii motor (packages/core/cii) ∥ server.ts. T-23 dep T-21+T-22; T-25 dep solo T-21. Disjuntos. T-25 self-verify package-scoped (PM hace global tsc, L-3). |
| **C** | T-24 · T-26 · T-27 | backend-architect + frontend-dev + intel-analyst | scheduler ∥ web ∥ core-ai. T-24 dep T-23; T-26 dep T-25; T-27 dep T-21. Tres paquetes disjuntos. |

Orden serial seguro: `A(21‖22) → [PM: workspace+tsconfig refs de @www/core-cii, rebuild dist store+core-cii] → B(23‖25) → [PM: rebuild dist core-cii, global tsc] → C(24‖26‖27)`.
Ficheros de alto conflicto / reservados al PM: `server.ts`, `layers.config.ts`, migraciones del store, `pnpm-workspace.yaml`/tsconfig refs del nuevo paquete.

## Setup del nuevo paquete @www/core-cii (PM, antes de Ronda B)

Tras Ronda A, el PM verifica/cabléa (L-4): `@www/core-cii` en el workspace (pnpm-workspace.yaml ya cubre `packages/*`), tsconfig refs (que scheduler/server/core-ai puedan resolver `@www/core-cii` vía dist), `pnpm install` si hace falta el symlink, y `pnpm --filter @www/core-cii build` (genera dist/index.d.ts). Sin esto, T-23/T-24 no resuelven tipos cross-package (L-2).

## Matriz de cobertura (Goal/decisión → tarea)

| Goal / Decisión | Tarea(s) |
|-----------------|----------|
| G-1 motor clean-room N-componentes | T-22 (config) + T-23 (motor) |
| G-2 conflict (events:conflict + severity + Goldstein) | T-23 |
| G-3 social (protest + GKG political_instability + boosts) | T-23 |
| G-4 economic (GKG commodities/trade/minerals × tone) | T-23 |
| G-5 political (GKG political_instability + info-temp) | T-23 |
| G-6 boosts EQ/fire (USGS/EONET severity) | T-22 (caps) + T-23 |
| G-7 config+coeffs propios no-AGPL | T-22 |
| G-8 cii_snapshots + migración 004 + API | T-21 |
| G-9 dynamicScore + deadband | T-21 (getPrior) + T-23 (computeDynamic) |
| G-10 job medium + /api/cii + capa + briefing | T-24, T-25, T-26, T-27 |
| G-11 extensible (signalPresent/registry) | T-22, T-23 |
| OQ-2 normalización país (L-7) | T-22 (normalizeCountryKey) + T-23 (agrupa) |
| OQ-6 capa circle+centroide | T-25 (adjunta lat/lon) + T-26 (capa) |
| L-1 camelCase | T-21, T-26 |
| D-001 no-AGPL | T-22, T-23 (verifier) |
| D-002/004 persiste-antes-de-servir, config-array | T-24, T-25, T-26 |

## Risks (→ tarea que mitiga)

| Riesgo | Mitigación | Tarea |
|--------|-----------|-------|
| R-2 clave país heterogénea (FIPS/nombre) — VERIFICADO real | normalizeCountryKey FIPS→nombre + test L-7 que asserta JA≡Japan | T-22, T-23 |
| R-1 calibración sin histórico | valores en blend.config/coefficients ajustables 1 punto; detail auditable; calibración posterior (GAP-5) | T-22 |
| R-3 cobertura GKG economic (semis/cyber fuera) | solo 3 secciones fuertes; AvgTone atenúa; detail reporta conteo | T-22, T-23 |
| Nuevo paquete @www/core-cii no resuelve cross-package | PM cabléa workspace+tsconfig refs + build dist antes de Ronda B (L-2/L-4) | setup PM |
| R-5 serie arranca vacía (dynamic neutro) | D-209 fuerza 0/stable; UI 'sin tendencia aún' | T-23, T-26 |
| R-6 crecimiento cii_snapshots (tier medium) | purgeAndDownsample purga cii_snapshots | T-21, T-24 |
| L-1 camelCase repetible | wire camelCase + verificar curl real + browser E2E | T-26, cierre |
| boost mal atribuido (a social) | decisión explícita + caps + detail; reconsiderable calibración | T-23 |

## Fuera de alcance (Non-Goals del design-doc — NO se implementan)

Motor de convergencia cross-domain `packages/core/signals` (NG-1), conectores keyed ACLED/UCDP/OFAC/FRED (NG-2), componente Security (NG-3, sin fuente), NER de país sobre news (NG-4), reverse-geocode propio (NG-5), backfill histórico (NG-6), calibración cuantitativa fina con intel-analyst (NG-7). Razón en design-doc §Non-Goals.

## Verificación final (tras todas las rondas)

1. Artefactos en disco + git diff. @www/core-cii en workspace + dist construido (L-2). Rebuild dist store/core-cii/core-ai.
2. `pnpm -w exec tsc --noEmit` global + suite completa de tests (L-3).
3. **Smoke EN VIVO** (L-5): arrancar `pnpm dev`, esperar el job cii (tier medium, boot) → poblar cii_snapshots; `curl /api/cii` (último por país con lat/lon + composite + dynamicScore + components), `/api/cii/:country`. **Verificar OQ-2 en vivo**: que Japan/JA estén UNIFICADOS en una fila (no duplicado). Wire camelCase (L-1).
4. **Browser E2E** (L-5): capa cii por país pinta círculos por banda; RiskPanel top países + trend + componente dominante + estados; map-tie; responsive 375/1200; 0 errores consola/red (patrón radar-e2e.mjs → cii-e2e.mjs).
5. `/verify` (verifier, goal-backward): wiring real (motor→store, job→scheduler tier medium, capa en config-array iterada, RiskPanel importado, rutas server.ts, bloque riesgo en briefing), sin stubs/TODO/catch-vacío, config no-AGPL, normalización país aplicada, contrato camelCase.
6. Solo se reporta "CII Scoring (Fase 2 rebanada 3) completado" con verifier=VERIFIED + smoke (incl. unificación país) + E2E PASS.
```
