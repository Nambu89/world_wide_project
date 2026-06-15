---
version: alpha
name: plan-convergence
description: Plan de implementación del Motor de Convergencia cross-domain — Fase 2 rebanada 4, derivado del design-doc 2026-06-15-convergence. Paquete NUEVO clean-room (no-AGPL) @www/core-signals con detectConvergence pura (≥2 familias-de-dato disjuntas / ventana 72h / magnitud≥0.5), observación canónica desde los componentes CII + markets exógeno (estrés risk-off derivado de change_pct REAL, NO de un regimeDelta inexistente), anti-doble-conteo por dataFamily, convergence_signals time-series (migración 005) + dynamicScore, job medium encadenado tras CII, bloque de convergencia en el briefing. SIN API/mapa (diferido NG-4). 5 tareas (T-28..T-32) en 3 rondas paralelas dep-optimizadas. Pendiente de /check-plan.
status: draft
date: 2026-06-15
owner: pm-coordinator
---

# Plan de Implementación — Convergencia cross-domain (Fase 2 · rebanada 4)

- **Fecha:** 2026-06-15
- **Autor:** PM Coordinator
- **Design-doc fuente:** [docs/design/2026-06-15-convergence.md](../docs/design/2026-06-15-convergence.md)
- **Estado:** Pendiente de `/check-plan` (gate PREVIO) → aprobación del usuario → implementación ronda a ronda
- **Decisiones bloqueadas:** ADR-001..012 ([plans/DECISIONS.md](DECISIONS.md)) + D-001..005 + D-300 (Q1, premisa fija) + D-301..312 (internas RATIFICADAS por el PM, design-doc §Decisions)
- **Cadencia (usuario):** ronda a ronda con checkpoint (igual que rebanadas previas).

## Goal (Objetivo)

Entregar el **último diferencial** del proyecto: un **motor de convergencia cross-domain** en el paquete NUEVO `packages/core/signals` (`@www/core-signals`), re-implementado clean-room de AGPL, que dispara una **señal de convergencia** cuando **≥2 familias-de-dato DISJUNTAS** (`events` / `signals` / `markets`) superan `MIN_MAGNITUDE=0.5` para el mismo país dentro de una **ventana de 72h**, con `strength` = magnitud media time-decayed y anti-doble-conteo **por construcción** (se cuentan familias, no componentes). Las observaciones canónicas salen de los **componentes del CII** (rebanada 3, input inmutable) mapeados a familia (conflict/social→events, economic/political→signals); **markets** entra como corroborante exógeno transversal, con su magnitud de estrés derivada de los campos REALES del store (`change_pct`). Se persiste como serie temporal (`convergence_signals`, migración 005) con `dynamicScore`, y se consume desde el **briefing diario**. Alcance = 4ª rebanada de Fase 2. **Superficie = SOLO briefing + persistencia** (decisión del usuario): `/api/convergence` y la capa de mapa son **Non-Goal** de esta rebanada (NG-4, rebanada de superficie posterior).

## Decisiones internas ratificadas (OQ-A..I del design-doc) + 2 decisiones de usuario

El PM verificó EN VIVO dos gaps y el usuario decidió dos cuestiones de producto; las 10 OQs quedan ratificadas:

- **Usuario-1 → D-305 (OQ-D):** **markets ENTRA al MVP** como corroborante exógeno transversal (NO entidad GLOBAL, NO difusión por-país). Verificación PM (GAP-1, código real): **NO existe `regimeDelta`/indicador de régimen** en el store; solo `market_snapshots {symbol, price, change_pct, captured_at}` + `market_daily` OHLC. La magnitud de estrés {conv.market.stress} se deriva clean-room de `change_pct` (compuesto risk-off) — ver **C-1**.
- **Usuario-2 → D-311 (OQ-?):** **superficie = SOLO briefing + persistencia**. SIN `/api/convergence` ni capa de mapa en esta rebanada (NG-4). Por eso NO hay tarea de server.ts ni de web.
- **OQ-A → D-301:** paquete `@www/core-signals`, función PURA `detectConvergence(observations, nowMs): ConvergenceSignal[]` + orquestador IO `detectAllConvergence(nowMs): Promise<ConvergenceSignal[]>`.
- **OQ-B → D-302:** la observación se ancla al **snapshot CII** (`CiiScore.capturedAt`); events/signals crudos NO entran como observación de 1ª clase (el CII ya los agrega). Ventana 72h filtra `ts >= nowMs - 72h`.
- **OQ-C → D-303:** magnitud **lineal-simple** con refs en `convergence.config.ts` (componente CII `score/100`; estrés markets risk-off; tono/volumen de signal NO se usa directo en el MVP porque las observaciones salen del CII, no de signals crudos — ver nota T-30).
- **OQ-C2 → D-304:** un corroborante CII exige `signalPresent=true` (no floors fantasma).
- **OQ-E → D-307:** `strength` = magnitud media (una por familia) time-decayed, `HALF_LIFE_72H=36h`.
- **OQ-F → D-308:** persistencia **append-snapshot** (como cii_snapshots), NO upsert mutable.
- **OQ-G → D-309:** `dynamicScore` (delta de strength vs aparición previa del mismo `(country, familyset)`) **SÍ entra al MVP**, 0 en la 1ª ventana.
- **OQ-H → D-310:** set MVP = **`events×signals` + `cualquier-dimensión×markets`**; se ACEPTA que `political×economic` NO es par independiente por sí solo (ambas familia `signals` → requiere 3ª familia). Verificado viable: **63/109 países** con solapamiento events×signals en `data/world.db`.
- **OQ-I → D-312:** convergencia corre en el tier **`medium`** ANCLADA al snapshot CII. **Mecanismo corregido tras /check-plan (C-4/ISSUE-1):** NO como job hermano "tras cii" (el scheduler corre los jobs de un tier en paralelo, sin orden), sino **encadenada DENTRO del `run()` del job `cii`** (tras `insertCiiSnapshots`) → lee los `cii_snapshots` recién escritos de la MISMA corrida, orden por construcción.
- **Reconciliación D-305↔D-310 (markets):** D-310 enmarca "cualquier-dimensión×markets", pero D-305 (decisión específica de la entidad markets) precisa que markets corrobora **solo países con deterioro economic-CII activo** (un shock de mercado es contexto económico, no evidencia sobre conflicto). **El plan sigue D-305** (la regla específica manda sobre el encuadre general): `markets` añade +1 familia únicamente a países con una observación `economic`(familia signals) en la ventana. Documentado explícito en T-29/T-30 para que el verifier no lo lea como contradicción.

## Correcciones de realidad (verificadas en disco/DB — OBLIGATORIAS)

- **C-1 — markets: estrés derivado de `market_snapshots`, NO de `market_daily`.** Verificado: `market_daily` SOLO lo puebla `purgeAndDownsample` (downsample de snapshots ya purgados/viejos a OHLC diario) → la ventana reciente de 72h NO tiene filas `market_daily`. Por tanto el "proxy de volatilidad desde OHLC" del design-doc (D-303) NO tiene datos para la ventana. **El estrés de markets {conv.market.stress} se deriva ENTERAMENTE de `market_snapshots`**: (a) compuesto **risk-off** desde `getLatestMarkets()` (último `change_pct` por símbolo, ponderado/direccionado por `MARKET_REF`/`RISKOFF_REF`); (b) proxy de **volatilidad** desde `getMarketTrend(symbol, now-72h)` = dispersión intra-ventana de `change_pct` (o rango `(max-min)/|mean|` de `price`) por símbolo, normalizada por `VOL_REF`. `magnitude = clamp01(max(riskOff, vol))`. **NO se usa `market_daily` ni se añade getter nuevo de markets** (getLatestMarkets + getMarketTrend bastan).
- **C-2 — migración = `005_convergence.sql`.** Ya existen 001 init, 002 events, 003 signals, 004 cii; el runner lexicográfico ordena tras 004. Idempotente vía `_migrations`. **HAZARD migrate-runner (W-2):** `migrate.ts` hace `sql.split(';')` y DESCARTA chunks cuyo `.trim()` empieza por `--` ⇒ en `005_convergence.sql` ningún comentario `--` precede a un statement en el mismo chunk; el test DEBE assertar `SELECT name FROM sqlite_master WHERE name='convergence_signals'` (+ índice).
- **C-3 — la clave de país de las observaciones CII YA viene normalizada.** `cii_snapshots.country` se persistió con el nombre canónico (rebanada 3, `normalizeCountryKey`). `observe.ts` lee `getLatestCii()` y usa `country` tal cual; **NO re-normaliza** (evita R6 del design-doc). markets es transversal (sin país).
- **C-4 — el scheduler corre los jobs de un tier en PARALELO, no por orden de array.** Verificado en `scheduler/src/index.ts:112-118` (`await Promise.all(nonDailyJobs.map(runJob))`) + `:106-109` (un `setInterval` independiente por job) + test `scheduler.test.ts:364` ("re-orders by tier, not position"). Por tanto **un job `convergence` hermano "tras cii" NO garantizaría leer los `cii_snapshots` de la corrida actual** (en el 1er boot con store frío, `getLatestCii()` saldría vacío → `convergence_signals` no se puebla; contradice la verificación final §3). **Solución (T-31):** la convergencia se encadena DENTRO del `run()` del job `cii` (awaits secuenciales tras `insertCiiSnapshots`) → orden garantizado por construcción. (D-302/D-312 satisfechas de verdad; el job sigue llamándose `cii` y hace `cii→convergence`.)

## Lecciones de rebanadas previas horneadas (OBLIGATORIO)

- **L-1 — Contrato web camelCase.** N/A para la web (sin UI esta rebanada), PERO el wire interno del store sigue camelCase: `ConvergenceSignalRow` se serializa camelCase directo (`sourceCount`, `familiesJson`, `dynamicScore`, `firstDetectedAt`, `capturedAt`). El briefing (core-ai) lee la forma camelCase.
- **L-2 — Rebuild dist cross-package.** Tras cambiar el API de `@www/store`, el PM hace `pnpm --filter @www/store build` ANTES del downstream. **NUEVO paquete `@www/core-signals`**: el PM verifica workspace + deps (`@www/store`, `@www/core-cii`) + `pnpm install` + `build` (dist), ANTES de que T-30/T-31 lo consuman.
- **L-3 — tsx per-file ≠ typecheck.** El PM corre el tsc consolidado del paquete + global al cerrar cada ronda. Los agentes en paralelo NO corren `pnpm -w exec tsc` (carrera shared-tree); self-verify package-scoped.
- **L-4 — Barrel/wiring = PM.** workspace entry, deps del package.json del paquete nuevo, tsconfig refs y dist los cabléa el PM post-ronda.
- **L-5 — Verde ≠ funciona.** Cierre exige **smoke EN VIVO** (server real, job `convergence` tras `cii` en boot → `convergence_signals` poblada + el briefing real incluye el bloque de convergencia). SIN browser E2E (no hay UI esta rebanada); el smoke valida la cadena persistencia→briefing de punta a punta.
- **L-6 — Dispatch directo, prompts acotados, escribe-ficheros-primero.** Los especialistas truncan ~30 turnos; el PM remata el verify. SIN schema forzado. Prevé que algún agente tenga Bash DENEGADO (en la rebanada 3, T-27 → lo hizo el PM).
- **L-7 — Verificar la clave de país antes de agrupar.** Resuelta por C-3 (las observaciones CII ya están normalizadas; observe NO re-agrupa).

## Quality Gates (obligatorios)

- **PREVIO:** este plan NO se presenta al usuario sin `plan-checker = PASS`.
- **POSTERIOR:** ninguna ronda se marca completada sin verificación propia del PM (git diff/salida real). Gate `/verify` (goal-backward) + smoke en vivo (persistencia + briefing) al cerrar la rebanada.
- **Frontera de integración:** solo el PM (con aprobación humana) hace commit/push.
- **No-AGPL (D-001):** todo umbral/peso/curva/dirección re-derivado en `convergence.config.ts` (espejo de `severity.ts`/`sections.config.ts`/`blend.config.ts`); el `verifier` revisa; NUNCA copiar fuente/texto/umbrales verbatim de worldmonitor.

---

## Tasks (Tareas)

> Front-matter por tarea con `depends_on` + `files_modified` (disjunción = lock). `verify_cmd` <60s. El agente devuelve `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED` + ficheros + salida-de-verify literal + Self-Report. Numeración T-28+ (continúa: rebanada 3 llegó a T-27).

### T-28 — `packages/store/` migración `005_convergence.sql` + tipos + API convergencia

```yaml
id: T-28
description: Tabla convergence_signals + migración 005 + ConvergenceSignalRow (camelCase) + insertConvergenceSignals/getLatestConvergence/getPriorConvergence + extensión de purgeAndDownsample
agent: backend-architect
wave: A
depends_on: []
files_modified:
  - packages/store/migrations/005_convergence.sql   # NUEVA: convergence_signals + índice
  - packages/store/src/types.ts                      # añade ConvergenceSignalRow
  - packages/store/src/index.ts                      # añade insert/getLatest/getPrior; EXTIENDE purgeAndDownsample
  - packages/store/test/store.test.ts                # extiende: insert+getLatest(último por country+familyset)+getPrior+purge+migración idempotente
boundaries:
  - "NO toques events/signals/markets/news/briefings/cii_snapshots ni su API (se AÑADE). NO toques otros paquetes."
constraints:
  - "ADR-006/D-003: @libsql/client file://. PROHIBIDO better-sqlite3."
  - "Schema normativo (design-doc §Interfaces): convergence_signals(id PK AUTOINCREMENT, country TEXT NOT NULL, families_json TEXT NOT NULL, dimensions_json TEXT NOT NULL, components_json TEXT NOT NULL, strength REAL NOT NULL, source_count INTEGER NOT NULL, dynamic_score REAL, methodology_version TEXT NOT NULL, first_detected_at INTEGER NOT NULL, captured_at INTEGER NOT NULL) + INDEX ix_conv_country_time(country, captured_at)."
  - "C-2: migración = 005_convergence.sql (001..004 ya existen; runner lexicográfico ordena tras 004). Idempotente vía _migrations. HAZARD W-2: ningún comentario '--' precede a un statement en el mismo chunk; el test asserta sqlite_master('convergence_signals') + el índice."
  - "L-1: ConvergenceSignalRow serializa camelCase (country, familiesJson, dimensionsJson, componentsJson, strength, sourceCount, dynamicScore, methodologyVersion, firstDetectedAt, capturedAt). Re-exporta el tipo en index.ts."
  - "insertConvergenceSignals(rows): inserta (append, NO upsert — serie temporal, D-308). getLatestConvergence(): último snapshot por (country, familiesJson) — MAX(captured_at) agrupado por country+familyset (el briefing lee el último por país; si un país tiene 2 familysets distintos activos, devuelve ambos). getPriorConvergence(country, familyset: string, aroundMs): el snapshot más cercano <= aroundMs para ese (country, familiesJson) — para dynamicScore + firstDetectedAt (D-309)."
  - "purgeAndDownsample: EXTIENDE para purgar convergence_signals con captured_at < beforeMs (mantén intacto markets/events/signals/news/cii)."
acceptance:
  - "Exporta ConvergenceSignalRow, insertConvergenceSignals, getLatestConvergence, getPriorConvergence (re-exporta tipo)."
  - "migrate() crea convergence_signals + índice, idempotente 3×, NO toca cii_snapshots/events/signals (test asserta sqlite_master)."
  - "getLatestConvergence devuelve el último por (country, familyset) con ≥2 snapshots sembrados de distinta captured_at (test)."
  - "getPriorConvergence encuentra el snapshot previo del mismo (country, familyset) (test)."
  - "purgeAndDownsample purga convergence_signals viejos sin tocar cii_snapshots (test)."
verify_cmd: "pnpm --filter @www/store exec tsc --noEmit && node --import tsx --test packages/store/test/*.ts"
```

### T-29 — `packages/core/signals/` skeleton + config + magnitud (pura) + detectConvergence (pura)

```yaml
id: T-29
description: Scaffolding del paquete @www/core-signals + convergence.config.ts (params + mapeo familia + MARKET_REF) + magnitude.ts (mapeadores fuente→[0,1] PUROS, incl. estrés markets) + detect.ts (detectConvergence PURA + tipos) + index barrel
agent: intel-analyst
wave: A
depends_on: []
files_modified:
  - packages/core/signals/package.json              # NUEVO @www/core-signals (espejo @www/core-cii; deps @www/store + @www/core-cii declaradas para que el PM las linke L-4, AUNQUE el código de T-29 NO las importe)
  - packages/core/signals/tsconfig.json             # NUEVO (espejo)
  - packages/core/signals/src/index.ts              # barrel (re-exporta config + tipos + detectConvergence; detectAllConvergence lo añade T-30)
  - packages/core/signals/src/convergence.config.ts # NUEVO config editorial
  - packages/core/signals/src/magnitude.ts          # NUEVO mapeadores puros (incl. marketStress)
  - packages/core/signals/src/detect.ts             # NUEVO detectConvergence (pura) + tipos
  - packages/core/signals/test/detect.test.ts       # NUEVO: anti-doble-conteo (R1), umbral, ≥2 familias, strength decay
  - packages/core/signals/test/magnitude.test.ts    # NUEVO: rangos [0,1], risk-off direccional, clamp
boundaries:
  - "Función PURA: el código de T-29 NO importa @www/store ni @www/core-cii (define DataFamily/ConvergenceDimension/ConvergenceObservation/ConvergenceSignal LOCALES; magnitude recibe primitivas; detect recibe ConvergenceObservation[]). Esto preserva el paralelismo Wave A con T-28 (precedente: T-22/T-29-CII puros). T-30 reconcilia con los tipos del store al cablear el IO. NO toques otros paquetes ni pnpm-workspace.yaml (PM, L-4)."
constraints:
  - "ADR-002/D-001/feedback_no_agpl_copy: re-deriva en NUESTROS valores; invoca la skill cii-scoring (taxonomía de convergencia, criterios gradeables). NUNCA copies umbrales/texto verbatim de worldmonitor."
  - "convergence.config.ts (design-doc §Interfaces/Decisions): MIN_SOURCES=2, MIN_MAGNITUDE=0.5, WINDOW_MS=72*3600*1000, HALF_LIFE_72H=36*3600*1000 (D-307). FAMILY_OF: Record<ConvergenceDimension,DataFamily> = {conflict:'events', social:'events', economic:'signals', political:'signals', market:'markets'} (D-306). MARKET_REF: pesos+dirección por símbolo (D-303/C-1): {SPY:{w:0.20,dir:-1}, QQQ:{w:0.15,dir:-1}, 'BTC-USD':{w:0.15,dir:-1}, 'ETH-USD':{w:0.10,dir:-1}, GLD:{w:0.15,dir:+1}, 'DX-Y.NYB':{w:0.15,dir:+1}, 'EURUSD=X':{w:0.10,dir:-1}} (suman 1.0; dir=+1 refugio, -1 risk-on). RISKOFF_REF=3.0, VOL_REF (dispersión de change_pct, p.ej. 2.0). METHODOLOGY_VERSION='conv-core-1'. Todo editorial, ajustable."
  - "magnitude.ts (PURO, D-303/C-1): ciiMagnitude(score0_100)=clamp01(score/100). marketRiskOff(latest: {symbol,changePct}[])=clamp01( sum(w_i*dir_i*changePct_i) / RISKOFF_REF ) usando MARKET_REF (símbolos no listados se ignoran). marketVol(trendBySymbol: Record<string, number[]>)=clamp01( mean_i(dispersión(changePct_i)) / VOL_REF ) donde dispersión = stdev o (max-min). marketStress(latest, trendBySymbol)=clamp01(max(marketRiskOff, marketVol)). clamp01 helper."
  - "detect.ts (PURO, D-301/D-306/D-307): detectConvergence(observations: ConvergenceObservation[], nowMs): ConvergenceSignal[]. (1) filtra ventana ts>=nowMs-WINDOW_MS y magnitude>=MIN_MAGNITUDE y (corroborante CII ⇒ signalPresent===true, D-304). (2) agrupa por country. (3) por país, mapea cada obs a su dataFamily (FAMILY_OF); cuenta familias DISTINTAS; si #familias>=MIN_SOURCES → señal. (4) markets (dataFamily 'markets', country sintético: ver T-30) corrobora un país SOLO si ese país tiene deterioro economic activo en la ventana (D-305) — en la función pura esto se modela: una obs de markets lleva country='' (transversal) y detect la inyecta como +1 familia a los países con una obs economic(signals) presente. (5) strength = sum(mag_i*w_i)/sum(w_i), w_i=0.5^((nowMs-ts_i)/HALF_LIFE_72H), una obs por familia (la de mayor magnitud dentro de la familia). (6) sourceCount=#familias; dimensions=dims contribuyentes; firstDetectedAt/dynamicScore los fija el IO (T-30) — la función pura los deja en capturedAt=nowMs, firstDetectedAt=nowMs, dynamicScore=0."
  - "Tipos LOCALES (design-doc §Interfaces): DataFamily='events'|'signals'|'markets'; ConvergenceDimension='conflict'|'economic'|'political'|'social'|'market'; ConvergenceObservation{country,dimension,dataFamily,magnitude,ts,signalPresent,source}; ConvergenceSignal{country,families,dimensions,sourceCount,strength,dynamicScore,observations,methodologyVersion,firstDetectedAt,capturedAt}."
acceptance:
  - "@www/core-signals existe, type-checks aislado, exporta config + magnitude + detectConvergence + tipos."
  - "R1 anti-doble-conteo (test): obs conflict-CII(magnitude 0.8, family events) + social-CII(0.8, family events) para el MISMO país = 1 familia → NO dispara. Añadir economic-CII(0.8, family signals) → 2 familias → SÍ dispara, sourceCount=2."
  - "Umbral (test): obs con magnitude<MIN_MAGNITUDE NO cuenta; corroborante CII con signalPresent=false NO cuenta (D-304)."
  - "marketRiskOff direccional (test): SPY -3% (dir -1) y GLD +3% (dir +1) → riskOff alto; SPY +3% / GLD -3% → riskOff ~0. marketStress en [0,1]."
  - "strength decay (test): dos obs de igual magnitud, una a ts=now y otra a ts=now-72h → strength < magnitud (la vieja pesa ~1/4)."
verify_cmd: "pnpm --filter @www/core-signals exec tsc --noEmit && node --import tsx --test packages/core/signals/test/*.ts"
```

### T-30 — `packages/core/signals/` orquestador IO `detectAllConvergence`

```yaml
id: T-30
description: observe.ts — arma ConvergenceObservation[] desde el store (CII components + markets) y delega en detectConvergence; calcula firstDetectedAt + dynamicScore vs getPriorConvergence
agent: intel-analyst
wave: B
depends_on: [T-28, T-29]
files_modified:
  - packages/core/signals/src/observe.ts            # NUEVO orquestador IO
  - packages/core/signals/src/index.ts              # re-exporta detectAllConvergence (añade a lo de T-29)
  - packages/core/signals/test/observe.test.ts      # NUEVO: armado de observaciones, markets transversal, firstDetectedAt/dynamicScore
boundaries:
  - "NO toques scheduler/server/web/core-ai (los cablea T-31/T-32). Importa de @www/store: getLatestCii, getLatestMarkets, getMarketTrend, getLatestConvergence, getPriorConvergence (store dist YA reconstruido por el PM tras T-28, L-2). Importa de ./detect.js + ./magnitude.js + ./convergence.config.js (T-29). NO importa @www/core-cii en runtime (las observaciones salen de cii_snapshots vía el store, C-3); puede importar tipos si los necesita."
constraints:
  - "D-300/D-302/C-3: detectAllConvergence(nowMs): Promise<ConvergenceSignal[]>. (1) getLatestCii() → por cada CiiSnapshotRow, parsea componentsJson; por cada componente con signalPresent===true emite ConvergenceObservation{country: row.country (YA normalizado, NO re-normalizar C-3), dimension: comp.key, dataFamily: FAMILY_OF[comp.key], magnitude: ciiMagnitude(comp.score), ts: row.capturedAt, signalPresent: true, source: 'cii:'+comp.key}."
  - "D-305/C-1 markets transversal. OJO TIPO: MarketSnapshot es el tipo LEGACY Fase 1 con campos SNAKE_CASE (`change_pct`, `captured_at`, `asset_class`) — NO camelCase como CiiSnapshotRow/EventRow. latest=getLatestMarkets(); trendBySymbol = para cada símbolo de MARKET_REF, getMarketTrend(symbol, nowMs-WINDOW_MS).map(s=>s.change_pct); stress=marketStress(latest.map(s=>({symbol:s.symbol, changePct:s.change_pct})), trendBySymbol) (observe adapta snake→el param `changePct` de la función pura de T-29). Si stress>=MIN_MAGNITUDE → emite UNA obs markets transversal {country:'', dimension:'market', dataFamily:'markets', magnitude:stress, ts: max(s.captured_at) de latest, signalPresent:true, source:'markets:stress'}. detectConvergence la inyecta a los países con deterioro economic (D-305)."
  - "D-308/D-309 lifecycle: tras detectConvergence, para cada señal: familyset = JSON de families ordenado; prior = await getPriorConvergence(country, familyset, nowMs-1); firstDetectedAt = prior ? prior.firstDetectedAt : nowMs; dynamicScore = prior ? clamp(-1,1, strength - prior.strength) : 0; capturedAt = nowMs. Devuelve las señales enriquecidas (listas para insertConvergenceSignals)."
  - "Retorno gracioso: si getLatestCii() vacío → []. NUNCA lanza (patrón store-read)."
acceptance:
  - "detectAllConvergence arma obs desde un store sembrado (cii_snapshots con componentsJson + market_snapshots) y devuelve ConvergenceSignal[] (test con :memory: + reset, patrón core-ai)."
  - "País con conflict-CII(signalPresent, score 70) + economic-CII(signalPresent, score 70) → 1 señal sourceCount=2 (events+signals) (test)."
  - "markets en estrés (change_pct risk-off) añade familia 'markets' a un país con economic activo (test); país sin economic NO recibe markets."
  - "firstDetectedAt persiste a través de ventanas; dynamicScore=0 si no hay prior, delta si lo hay (test con getPriorConvergence sembrado)."
verify_cmd: "pnpm --filter @www/core-signals exec tsc --noEmit && node --import tsx --test packages/core/signals/test/*.ts"
```

### T-31 — `packages/scheduler/` convergencia encadenada DENTRO del job `cii` (orden por construcción)

```yaml
id: T-31
description: Encadena detectAllConvergence → insertConvergenceSignals al FINAL del run() del job cii existente (justo tras insertCiiSnapshots), garantizando que convergence lee los cii_snapshots recién escritos en la MISMA corrida. NO añade job hermano (ver C-4 / ISSUE-1).
agent: backend-architect
wave: C
depends_on: [T-28, T-30]
files_modified:
  - packages/scheduler/src/index.ts
  - packages/scheduler/test/scheduler.test.ts
boundaries:
  - "NO toques server.ts (firma defaultJobs intacta) ni conectores ni store internamente. SOLO modifica el job 'cii' (su run() + las deps que necesita) y añade las 2 deps a SchedulerDeps/REAL_STORE_AI_DEPS; NO toques los demás jobs (markets/usgs/eonet/gdelt/gkg/news/daily)."
constraints:
  - "RAZÓN DEL CAMBIO (ISSUE-1 plan-checker / C-4, código real scheduler/src/index.ts:112-118 + test :364): el boot corre los jobs non-daily con Promise.all (PARALELO) y cada job tiene su propio setInterval — NO hay orden entre jobs del MISMO tier ('scheduler re-orders by tier, not position'). Un job 'convergence' hermano NO garantizaría leer los cii_snapshots de la corrida actual de 'cii' (en el 1er boot getLatestCii() saldría vacío → convergence_signals no se puebla). Solución: encadenar DENTRO del run() del job cii (awaits secuenciales) → orden por construcción (D-302/D-312)."
  - "ADR-004/D-002: persiste ANTES de servir. SchedulerDeps gana detectAllConvergence: (nowMs:number)=>Promise<ConvergenceSignal[]> (de @www/core-signals) + insertConvergenceSignals: (rows:ConvergenceSignalRow[])=>Promise<void> (de @www/store). REAL_STORE_AI_DEPS añade ambas. Importa el tipo ConvergenceSignal de @www/core-signals + ConvergenceSignalRow de @www/store (observe.ts ya devuelve la forma persistible; si difieren, observe expone un mapeo a ConvergenceSignalRow)."
  - "En el run() del ciiJob, JUSTO DESPUÉS de `await storeAi.insertCiiSnapshots(rows)`: `const convSignals = await (deps?.detectAllConvergence ?? storeAi.detectAllConvergence)(now); if (convSignals.length > 0) { await storeAi.insertConvergenceSignals(convSignals); console.log(\`[scheduler] cii→convergence: persisted ${convSignals.length} signals\`); }`. Usa el MISMO `now` que el cii (los snapshots recién escritos tienen capturedAt≈now → entran en la ventana 72h de detectAllConvergence). El job sigue llamándose 'cii' (documenta en comentario que ahora hace cii→convergence). Conserva el early-return si allScores.length===0 (sin cii no hay convergencia: correcto)."
  - "El job daily (purgeAndDownsample) ya purga convergence_signals tras T-28. Boot-sequencing y demás jobs intactos."
acceptance:
  - "El run() del job cii llama detectAllConvergence + insertConvergenceSignals DESPUÉS de insertCiiSnapshots (test con mocks que registran el ORDEN de llamada en un array compartido: assert que el índice de insertCiiSnapshots < índice de detectAllConvergence). Esto prueba el ORDEN REAL, no la posición en el array (la prueba que ISSUE-1 exige)."
  - "Si detectAllConvergence devuelve [] → NO llama insertConvergenceSignals (test). Si allScores vacío → ni cii ni convergence persisten (early-return, test)."
  - "defaultJobs sigue devolviendo 8 jobs (sin job nuevo); firma intacta; start idempotente+parable. Jobs existentes intactos (test)."
verify_cmd: "pnpm --filter @www/scheduler exec tsc --noEmit && node --import tsx --test packages/scheduler/test/*.ts"
```

### T-32 — `packages/core/ai/` enriquecimiento del briefing con convergencia

```yaml
id: T-32
description: buildConvergenceContext(latest) + inserción en serializeContext (señales de convergencia activas: país + familias + strength + dynamic); sin proveedor LLM nuevo
agent: intel-analyst
wave: B
depends_on: [T-28]
files_modified:
  - packages/core/ai/src/briefing.ts          # buildConvergenceContext + serializeContext (gana 4º arg convergencia) + generateDailyBriefing alimenta desde getLatestConvergence
  - packages/core/ai/src/index.ts             # re-exporta buildConvergenceContext
  - packages/core/ai/test/ai.test.ts          # test: bloque con datos; '' si vacío; sin proveedor nuevo
boundaries:
  - "NO toques el router ni el proveedor (ADR-009 openai). NO toques store/scheduler/server/web/core-signals. Importa getLatestConvergence + ConvergenceSignalRow de @www/store (store dist reconstruido por el PM tras T-28). Patrón existente: buildRiskContext/serializeContext ya viven en briefing.ts (líneas ~92/139); serializeContext hoy es serializeContext(latest, events, cii) → gana un 4º arg convergence."
constraints:
  - "D-005/D-311: SIN proveedor LLM nuevo ni 2ª llamada. buildConvergenceContext(latest: ConvergenceSignalRow[]): string — 'Señales de convergencia activas: <país> (<familias>, strength <0.xx>, <↑/↓/→ según dynamicScore>)', top por strength; '' si vacío (mismo patrón que buildRiskContext). serializeContext gana un 4º parámetro `convergence: ConvergenceSignalRow[]` e inserta el bloque (omitido si ''); generateDailyBriefing lee `getLatestConvergence()` y lo pasa a serializeContext (igual que ya hace con getLatestCii para el bloque de riesgo). Contrato caché del briefing (D-106) intacto."
  - "L-1: lee la forma camelCase de ConvergenceSignalRow (familiesJson parseado, strength, dynamicScore)."
acceptance:
  - "buildConvergenceContext devuelve bloque legible con datos sembrados; '' si vacío (test)."
  - "serializeContext incluye el bloque de convergencia; sin proveedor nuevo (test). Suite core-ai verde."
verify_cmd: "pnpm --filter @www/core-ai exec tsc --noEmit && node --import tsx --test packages/core/ai/test/*.ts"
```

---

## Wave Scheduler (paralelización dep-optimizada)

Disjunción de `files_modified` = lock. Paralelo dentro de ronda, secuencial entre rondas. Checkpoint del PM al cerrar cada ronda (verify + rebuild dist L-2 + tsc consolidado L-3 + agent-comms).

| Ronda | Tareas (paralelas) | Agente(s) | Lock |
|-------|--------------------|-----------|------|
| **A** | T-28 · T-29 | backend-architect + intel-analyst | store (packages/store) ∥ core-signals puro (packages/core/signals, SIN import store). Disjuntos, precedente T-21‖T-22. |
| **B** | T-30 · T-32 | intel-analyst (×1, secuencial entre sí si es el mismo agente) + intel-analyst | core-signals IO (packages/core/signals) ∥ core-ai (packages/core/ai). Paquetes disjuntos. T-30 dep T-28+T-29; T-32 dep T-28. **Nota:** ambos son `intel-analyst` — si el orquestador no puede correr 2 instancias, ejecútalos en serie dentro de la ronda (siguen sin pisarse: paquetes distintos). |
| **C** | T-31 | backend-architect | scheduler (packages/scheduler). T-31 dep T-28+T-30. |

Orden serial seguro: `A(28‖29) → [PM: workspace+deps(@www/store,@www/core-cii)+tsconfig refs de @www/core-signals, pnpm install, rebuild dist store+core-signals] → B(30‖32) → [PM: rebuild dist core-signals+core-ai, global tsc] → C(31)`.
Ficheros de alto conflicto / reservados al PM: migraciones del store, `pnpm-workspace.yaml`/tsconfig refs del nuevo paquete, el `package.json` de `@www/core-signals` (deps).

## Setup del nuevo paquete @www/core-signals (PM, antes de Ronda B)

Tras Ronda A, el PM verifica/cabléa (L-4): `@www/core-signals` en el workspace (pnpm-workspace.yaml ya cubre `packages/core/*`), **añade deps `@www/store` + `@www/core-cii`** a su `package.json` (T-29 las declara; el PM confirma + linka), `pnpm install` (symlinks), tsconfig refs (que scheduler/core-ai puedan resolver `@www/core-signals` vía dist), y `pnpm --filter @www/core-signals build` (genera dist/index.d.ts). Sin esto, T-30/T-31 no resuelven tipos cross-package (L-2). (En la rebanada 3 esto se olvidó al principio y rompió la resolución — no repetir.)

## Matriz de cobertura (Goal/decisión → tarea)

| Goal / Decisión | Tarea(s) |
|-----------------|----------|
| G-1 paquete clean-room @www/core-signals + detectConvergence pura | T-29 |
| G-2 observación canónica desde CII components (familias) | T-29 (FAMILY_OF) + T-30 (armado) |
| G-3 mapeo fuente→magnitud [0,1] lineal | T-29 (magnitude) |
| G-4 anti-doble-conteo por dataFamily (D-306) | T-29 (detect) + test R1 |
| G-5 estrés markets desde change_pct REAL (no regimeDelta) | T-29 (marketStress) + T-30 (lectura store) + C-1 |
| G-6 convergence_signals migración 005 + dynamicScore + firstDetectedAt | T-28 + T-30 |
| G-7 convergencia encadenada DENTRO del run del job cii, orden por construcción (D-312/C-4) | T-31 |
| G-8 bloque de convergencia en el briefing (sin LLM nuevo, D-311) | T-32 |
| G-9 familias MVP events×signals + cualquiera×markets (D-310) | T-29 (detect) + T-30 |
| OQ-G dynamicScore en MVP | T-28 (getPrior) + T-30 (delta) |
| OQ-F append-snapshot | T-28 |
| D-001 no-AGPL | T-29 (verifier) |
| D-002/004 persiste-antes-de-servir | T-31 |
| C-1 markets sin market_daily | T-29, T-30 |
| C-3 país ya normalizado (no re-agrupa) | T-30 |

## Risks (→ tarea que mitiga)

| Riesgo | Mitigación | Tarea |
|--------|-----------|-------|
| R1 doble-conteo enmascarado (contar componentes, no familias) | detect cuenta dataFamily DISTINTAS (D-306) + test R1 (conflict×social same-family NO dispara) | T-29 |
| C-1 market_daily vacío en la ventana (proxy OHLC sin datos) — VERIFICADO | estrés markets desde market_snapshots (getLatestMarkets+getMarketTrend), NO market_daily | T-29, T-30 |
| GAP-1 no existe regimeDelta — VERIFICADO | magnitud risk-off derivada de change_pct real, refs en config | T-29, T-30 |
| GAP-2/R3 calibración sin ground-truth (MIN_MAGNITUDE/MARKET_REF/RISKOFF_REF/VOL_REF/HALF_LIFE) | todos en convergence.config.ts ajustables; methodology_version versiona; calibración diferida (intel-analyst, NG) | T-29 |
| R2 MVP pocas señales si markets rara vez supera umbral | 63/109 overlap events×signals verificado → el MVP no depende SOLO de markets; markets es +1 corroborante | T-30 |
| Nuevo paquete @www/core-signals no resuelve cross-package | PM cabléa workspace+deps+tsconfig refs+build dist antes de Ronda B (L-2/L-4) | setup PM |
| C-4 scheduler corre jobs de un tier en paralelo (job hermano leería CII rancio/vacío) — VERIFICADO | encadenar convergence DENTRO del run() del job cii tras insertCiiSnapshots (orden por construcción) + test que asserta el ORDEN real de llamada | T-31 |
| R5 serie arranca vacía (dynamic neutro, sin prior) | dynamicScore=0 / firstDetectedAt=now en la 1ª ventana (D-309) | T-30 |
| Crecimiento convergence_signals (tier medium) | purgeAndDownsample purga convergence_signals | T-28, T-31 |
| Mismo agente intel-analyst en 2 tareas de Ronda B | paquetes disjuntos → si no hay 2 instancias, serie dentro de la ronda | wave scheduler |

## Fuera de alcance (Non-Goals del design-doc — NO se implementan)

`/api/convergence` + capa de mapa de convergencia (NG-4, decisión del usuario: superficie posterior); familias avanzadas — triples, intra-economic fina semis×minerals, cross-país/contagio (NG-1); ML/clustering/embeddings (NG-2); alertas push/notificaciones (NG-3); conectores keyed nuevos ACLED/UCDP/OFAC/FRED (NG-5); re-derivar/modificar el CII (NG-6, input inmutable); reverse-geocode/NER propio (NG-7); calibración cuantitativa fina con intel-analyst (GAP-2, tras ≥semanas de snapshots). Razón en design-doc §Non-Goals.

## Verificación final (tras todas las rondas)

1. Artefactos en disco + git diff. @www/core-signals en workspace + deps (@www/store, @www/core-cii) + dist construido (L-2/L-4). Rebuild dist store/core-signals/core-ai/scheduler.
2. `pnpm -w exec tsc --noEmit` global + suite completa de tests (L-3). (Suite previa = 454; esta rebanada AÑADE store + core-signals + scheduler + core-ai.)
3. **Smoke EN VIVO** (L-5): arrancar `pnpm dev`; en boot el job `cii` (medium) puebla cii_snapshots y **al final de su MISMA corrida** (encadenado dentro del run, C-4) corre detectAllConvergence → poblar `convergence_signals` EN EL MISMO BOOT (prueba directa de que ISSUE-1 quedó resuelto). Verificar contra la DB (`data/world.db`): `convergence_signals` tiene filas con `source_count>=2`, `families_json` con ≥2 familias DISTINTAS, `strength` en [0,1]; comprobar el caso anti-doble-conteo (ningún país con `source_count` inflado por 2 componentes de la misma familia). Confirmar el bloque de convergencia EN el briefing real (generateDailyBriefing → body_md incluye "convergencia activa" cuando hay señales; model=openai/gpt-5.4).
4. (SIN browser E2E — no hay UI esta rebanada; NG-4.)
5. `/verify` (verifier, goal-backward): wiring real (detect pura testeable sin DB; detectAllConvergence→store; job→scheduler tier medium tras cii; bloque convergencia en briefing desde getLatestConvergence), sin stubs/TODO/catch-vacío, config no-AGPL re-derivada, anti-doble-conteo por familia, markets desde change_pct (no market_daily, no regimeDelta), contrato camelCase.
6. Solo se reporta "Convergencia (Fase 2 rebanada 4) completado" con verifier=VERIFIED + smoke en vivo (convergence_signals poblada + briefing con bloque) PASS.
```

