---
version: alpha
name: convergence
description: Motor de convergencia cross-domain (rebanada 4, Fase 2). Dispara una señal cuando >=2 fuentes INDEPENDIENTES apuntan al mismo deterioro en la misma entidad-país dentro de una ventana 72h, con anti-doble-conteo por construccion (familias-de-dato disjuntas). El CII por-dimension es la capa de observacion canonica; markets es la unica fuente exogena. Re-implementacion de metodologia (no-AGPL). Vive en el paquete NUEVO @www/core-signals, persiste en convergence_signals (migracion 005) y enriquece el briefing; sin API/mapa propios en el MVP.
status: draft
date: 2026-06-15
owner: system-architect
---

## Overview

El proyecto ya produce tres capas de observacion por-pais cerradas+pusheadas (rebanadas 1/2/3 de Fase 2): la capa **events** (sucesos geo con severity 0..100), la capa **signals** (articulos GKG por seccion tematica con tono), y el **CII** (`@www/core-cii`), que las funde en un indice compuesto con cuatro componentes por-dimension `{conflict, economic, political, social}` por-pais. Cada capa, por separado, responde "que esta pasando en X". Ninguna responde la pregunta de orden superior que motiva la plataforma: **¿cuando varias señales independientes apuntan al MISMO deterioro en el MISMO pais a la vez?** — el patron que precede a una crisis real y que un humano monitoreando un solo dominio no ve.

Esta rebanada especifica el **motor de convergencia cross-domain**: un detector que recorre las observaciones por-dimension del CII (mas markets como unica fuente exogena), las normaliza a una magnitud comparable `[0,1]`, y dispara una **señal de convergencia** cuando **>=2 fuentes independientes** corroboran un deterioro en la **misma entidad (pais)** dentro de una **ventana de 72h**, con `strength` = magnitud media con time-decay. El resultado deseado es una tabla persistida de señales de convergencia activas, consumible por el briefing diario, que el resto del pipeline (mapa, alertas) podra explotar en rebanadas posteriores. El motor vive en un paquete **NUEVO** `packages/core/signals` (`@www/core-signals`), que aun no existe; este doc lo especifica para que el PM lo cree.

## Goals

- G1: Definir el contrato del paquete nuevo `@www/core-signals` con una funcion pura `detectConvergence(observations, nowMs) -> ConvergenceSignal[]` re-derivada de la metodologia documentada (no-AGPL), con los parametros {conv.params} (`MIN_SOURCES=2`, `MIN_MAGNITUDE=0.5`, ventana 72h).
- G2: Definir el modelo de **observacion canonica** {conv.observation} que entra a la ventana: como se deriva de los componentes del CII, de events crudos, de signals y de markets, y como se la **fecha** (granularidad temporal, Q2).
- G3: Definir el **mapeo fuente->magnitud `[0,1]`** {conv.magnitude} que hace comparables inputs heterogeneos (componente CII 0..100, severity de event 0..100, tono/volumen de signal, delta de markets) contra el umbral `MIN_MAGNITUDE=0.5` (Q3).
- G4: Definir la **regla de independencia** {conv.independence} = familias-de-dato disjuntas, con anti-doble-conteo **por construccion** (Q1 ratificada), incluyendo el tratamiento de markets como entidad sintetica GLOBAL exogena (Q4).
- G5: Definir la **persistencia** {conv.persistence} (tabla nueva `convergence_signals`, migracion 005), el campo `dynamicScore`/lifecycle, el **alcance de familias de convergencia del MVP** y el modo de servicio (solo briefing + persistencia) (Q5).
- G6: Cumplir clean-room: toda la metodologia es re-derivada de fuentes publicas documentadas, jamas copia de fuente AGPL de worldmonitor (D-001 heredada).

## Non-Goals

- NG-1: **Familias de convergencia avanzadas** quedan FUERA. El MVP cubre solo el conjunto {conv.families.mvp} (conflict x economic, political x economic, conflict x social). Triples (3+ familias simultaneas), convergencia tematica fina intra-economic (semis x minerals), y convergencia cross-pais (contagio regional) se difieren a una rebanada posterior.
- NG-2: **Sin ML / aprendizaje**: nada de clustering, embeddings, ni Transformers.js. La deteccion es regla determinista sobre umbrales editoriales re-derivados. (Coherente con NG-3 del radar y la frontera de esta rebanada.)
- NG-3: **Sin alertas push / notificaciones**: el motor persiste señales y enriquece el briefing; no hay canal de notificacion en tiempo real, ni webhooks, ni email. Se difiere.
- NG-4: **Sin API/ruta ni capa de mapa propias en esta rebanada**: `convergence_signals` se persiste y se consume desde el briefing; `GET /api/convergence` y una capa MapLibre de convergencia se difieren a una rebanada de superficie posterior (se nombran aqui como gap, no se construyen).
- NG-5: **Sin conectores keyed nuevos** (ACLED/UCDP/OFAC/FRED): la convergencia consume EXCLUSIVAMENTE las fuentes ya vivas en el store (events, signals, cii_snapshots, markets). No abre fuentes nuevas (heredado de NG-2 del CII).
- NG-6: **Sin re-derivar el CII**: el CII (`@www/core-cii`) es input INMUTABLE de esta rebanada. La convergencia LEE sus componentes; no los recalcula, ni cambia sus pesos, ni toca `cii_snapshots`.
- NG-7: **Sin reverse-geocode ni NER de pais propio**: la convergencia reusa la clave de pais canonica que ya producen events/signals/cii (`normalizeCountryKey`), no infiere geografia nueva (heredado de NG-4/NG-5 del CII).

## Context / Constraints

- **Stack**: TypeScript, monorepo pnpm. Paquete nuevo `packages/core/signals` (`@www/core-signals`), hermano de `@www/core-cii` y `@www/core-ai`. Backend unico `server.ts`; calculo server-side en el scheduler (ADR-004). Persistencia `@libsql/client` sobre `file:./data/world.db` (ADR-006).
- **License clean-room (DURA)**: la metodologia de convergencia de worldmonitor es **AGPL-3.0** -> solo metodologia documentada, **NUNCA copiar fuente** (ADR-002, D-001). Precedente vivo: `severity.ts`, `sections.config.ts`, y el motor CII ya son re-derivaciones propias. Los umbrales {conv.params} (`MIN_SOURCES`, `MIN_MAGNITUDE`, ventana 72h) son valores editoriales re-derivados, ajustables, no verbatim.
- **Inputs YA construidos (cerrados, NO se re-abren)**:
  - `@www/core-cii` (rebanada 3, commit c9e4cdf): `computeAllCountries(nowMs) -> Promise<CiiScore[]>`. Cada `CiiScore` lleva `components: CiiComponent[]` con `{ key: 'conflict'|'economic'|'political'|'social', score: 0..100, signalPresent, sources, detail }`, `composite`, `baselineRisk`, `eventScore`, `capturedAt`. Persiste en `cii_snapshots` (migracion 004) con `dynamic_score`.
  - **events** (tabla, migracion 002): USGS/GDELT-raw/EONET; `EventRow` con `severity` 0..100, `country`, `category`, `eventType`, `occurredAt`, `capturedAt`.
  - **signals** (tabla, migracion 003): GKG article-level, 6 secciones; `SignalRow` con `tone`, `country`, `section`, `occurredAt`, `capturedAt`.
  - **markets**: señal economica **global, SIN pais** (Yahoo/CoinGecko keyless, Fase 1). Store REAL (verificado por el PM): tabla `market_snapshots {source, symbol, asset_class, price, change_pct, captured_at}`, tabla `market_daily {symbol, day, open, high, low, close}`, 7 simbolos fijos (`SPY, QQQ, GLD, BTC-USD, ETH-USD, EURUSD=X, DX-Y.NYB`), helpers `getLatestMarkets()`/`getMarketTrend(symbol, sinceMs)`. **NO existe ningun indicador de regimen/volatilidad** -> la magnitud de estres se deriva de estos campos (D-303, {conv.market.stress}).
  - **Clave de pais canonica = nombre** (no FIPS). `normalizeCountryKey(raw, source)` unifica FIPS->nombre; events/signals/cii ya la comparten. La convergencia reusa esa clave conceptualmente (NG-7).
- **Q1 ratificada por el PM (premisa fija, no re-preguntar)**: el CII es la capa de observacion canonica por-dimension por-pais; markets = unica fuente exogena; independencia = **familias-de-dato disjuntas** (conflict/social vienen de events; economic/political de signals; markets aparte) + se exige >=2 corroborantes con >=1 fuente no-CII **o** dos componentes CII de origen disjunto. Anti-doble-conteo por construccion.
- **Granularidad temporal de los inputs**: el CII corre en tier `medium` del scheduler; cada `cii_snapshots` lleva `captured_at` (epoch ms). events/signals llevan `occurredAt` (suceso) con fallback `capturedAt`. markets lleva su propio snapshot timestamp.
- **Numeracion**: ADR base hasta ADR-011; D-0xx bloqueadas heredadas; D-2xx = CII (hasta D-213). Esta rebanada usa **D-3xx** para no colisionar.

## Decisions

> Las decisiones **bloqueadas** (no-negociables) heredan de los ADRs base, de `memory/feedback_*.md` y de la **Q1 ya ratificada por el PM**. Las decisiones **internas** (numeradas desde D-300) son recomendacion del arquitecto; el PM ratifica las marcadas con OQ. Cada `D-NNN` aparece una sola vez.

Bloqueadas (no-negociables, heredadas):

- **D-001** (ADR-002 / feedback_no_agpl_copy): el motor de convergencia, los umbrales {conv.params}, el mapeo {conv.magnitude} y la regla {conv.independence} se **re-implementan desde metodologia documentada en nuestras palabras** — porque copiar fuente o texto del modelo de convergencia de worldmonitor (AGPL-3.0) convierte el programa en obra derivada AGPL (§13). Las formulas/ideas no son copyrightables; el codigo y el texto si. Precedente vivo: `severity.ts`, `sections.config.ts`, motor CII.
- **D-002** (ADR-004): la deteccion de convergencia corre **server-side en el scheduler**, persiste señales y la UI/briefing lee del store, nunca recalcula en el navegador — porque desacopla el motor de la pestaña abierta y habilita el historico (el diferencial del proyecto).
- **D-003** (ADR-006): la persistencia usa `@libsql/client` sobre `file:./data/world.db` con el patron time-series ({schema.snapshot.ts} epoch ms) — porque libSQL es Turso (migrar = cambiar URL) y mantiene un unico motor de persistencia.
- **D-005** (ADR-009): la convergencia **no introduce un proveedor LLM nuevo**; enriquece el briefing existente via {ai.briefing.ctx} usando la rama activa openai — porque esta rebanada no es el lugar para cambiar proveedor.
- **D-300** (Q1, **RATIFICADA por el PM — premisa fija**): la **fuente de verdad de las observaciones es el CII por-dimension por-pais** {conv.observation}; **markets es la unica fuente exogena**; la **independencia** {conv.independence} se define como **familias-de-dato disjuntas** y una señal exige **>=2 corroborantes** con **>=1 fuente no-CII** (markets, o un event/signal crudo) **o** **dos componentes CII de origen de-dato disjunto** (p.ej. `conflict` que viene de events **x** `economic` que viene de signals) — porque dos vistas de la misma familia-de-dato no son corroboracion independiente, son el mismo dato contado dos veces; la disjuncion por construccion es el anti-doble-conteo (ver D-306). No re-negociable.

Internas (recomendacion del arquitecto; el PM ratifica las marcadas OQ):

- **D-301** (paquete nuevo + API pura, **OQ-A RATIFICADA por el PM**): el motor vive en **`packages/core/signals` (`@www/core-signals`)**, hermano de `@www/core-cii`. Expone una funcion **pura** `detectConvergence(observations: ConvergenceObservation[], nowMs: number): ConvergenceSignal[]` {conv.detect} (sin IO; recibe observaciones ya cargadas), mas un orquestador con IO `detectAllConvergence(nowMs): Promise<ConvergenceSignal[]>` que arma las observaciones desde el store y delega en la funcion pura — porque separar la regla determinista (testeable sin DB, mismo patron que `classify()` de sections.config y `computeCii`) del IO es el invariante de honestidad de este codebase. **OQ-A RATIFICADA por el PM: nombre de paquete `@www/core-signals` (coincide con `packages/core/signals/` del CLAUDE.md) y firmas `detectConvergence`/`detectAllConvergence`.**
- **D-302** (granularidad temporal de la observacion, **Q2 / OQ-B**): cada {conv.observation} se **fecha por el timestamp del dato que la origina, no por el ciclo del motor** {conv.obs.ts}:
  - observacion derivada de un **componente CII** -> se fecha con `CiiScore.capturedAt` del snapshot que la produjo (el componente CII ya agrega events/signals con su propio time-decay de 30d internamente; para convergencia, el snapshot es el "latido" del estado por-dimension).
  - observacion derivada de un **event crudo** (cuando se usa como corroborante no-CII) -> se fecha con `EventRow.occurredAt ?? capturedAt`.
  - observacion derivada de una **signal cruda** -> se fecha con `SignalRow.occurredAt ?? capturedAt`.
  - observacion de **markets** -> se fecha con el snapshot timestamp de markets.
  La **ventana 72h** {conv.params} filtra observaciones con `ts >= nowMs - 72h`. Recomendacion: la columna canonica de la observacion es **el CII snapshot** (granularidad: cada corrida `medium` del scheduler produce un punto por-pais por-dimension), y los events/signals crudos solo entran como **evidencia de corroboracion no-CII** dentro de la misma ventana — porque mezclar la cadencia lenta del CII con la rapida de events crudos en pie de igualdad desincroniza la ventana; anclar al snapshot CII da una rejilla temporal coherente y el crudo aporta el "se vio con otros ojos". **OQ-B RATIFICADA por el PM: anclar-al-snapshot-CII** (descartado: tratar cada event/signal crudo como observacion de primera clase). Tradeoff (resuelto): anclar-al-snapshot = ventana coherente, menos ruido, depende de la cadencia del job CII (perdida de granularidad sub-snapshot); crudo-primera-clase = maxima reactividad, pero requiere de-duplicar contra lo que el CII ya absorbio (riesgo de doble-conteo intra-familia que D-306 debe blindar).
- **D-303** (mapeo fuente->magnitud `[0,1]`, **Q3 / OQ-C RATIFICADA por el PM: lineal-simple + refs en config**): cada input se normaliza a una **magnitud de deterioro** {conv.magnitude} comparable contra `MIN_MAGNITUDE=0.5`:
  - **componente CII** (`score` 0..100) -> `magnitude = score / 100`. Directo: el CII ya es un score de inestabilidad creciente 0..100.
  - **severity de event** (0..100) -> `magnitude = severity / 100`. Directo (misma escala que el CII por diseño de `severity.ts`).
  - **tono/volumen de signal** -> `magnitude = clamp01( 0.5*toneStress + 0.5*volumeStress )`, donde `toneStress = min(1, |min(0, avgTone)| / 10)` (solo tono NEGATIVO indica estres; ~-10 satura) y `volumeStress = min(1, count / VOLUME_REF)` (`VOLUME_REF` editorial, p.ej. 20 articulos/ventana). Recomendacion: este blend tono+volumen evita que un unico articulo muy negativo dispare, y que un volumen alto neutro pase desapercibido.
  - **estres de markets** {conv.market.stress} -> **magnitud de estres risk-off derivada de los campos que EXISTEN en el store** (verificado por el PM: tabla `market_snapshots {source, symbol, asset_class, price, change_pct, captured_at}`, tabla `market_daily {symbol, day, open, high, low, close}`, helpers `getLatestMarkets()`/`getMarketTrend(symbol, sinceMs)`; **NO existe ningun indicador de "regimen/volatilidad" — GAP-1 cerrado**). Receta clean-room re-derivada (D-001), en `convergence.config.ts`:
    - Los 7 simbolos fijos (markets.ts) se etiquetan editorialmente por **direccion risk-off** en `MARKET_REF`: `SPY, QQQ, BTC-USD, ETH-USD` son **risk-on** (su caida = estres -> contribuye con `-change_pct`), `GLD, DX-Y.NYB` son **refugio** (su subida = estres -> contribuye con `+change_pct`), `EURUSD=X` es **risk-on-proxy** (caida del euro = fortaleza del dolar = estres -> contribuye con `-change_pct`).
    - Componente direccional risk-off por snapshot: `riskOff = clamp01( ( sum_i w_i * sign_i * change_pct_i ) / RISKOFF_REF )`, sobre `getLatestMarkets()`, donde `sign_i` es +1 para refugio y -1 para risk-on (de modo que cada termino es positivo cuando el simbolo se mueve en direccion de estres), `w_i` son los pesos por simbolo en `MARKET_REF` (recomendado de partida: equities `SPY=0.20, QQQ=0.15`, crypto `BTC-USD=0.15, ETH-USD=0.10`, refugio `GLD=0.15, DX-Y.NYB=0.15`, fx `EURUSD=X=0.10`; suman 1.0), y `RISKOFF_REF` es el % de move-ponderado que satura a estres pleno (editorial, recomendado `3.0` = ~3% de movimiento risk-off ponderado en un dia ya es estres alto).
    - Componente de volatilidad (proxy, opcional pero recomendado) desde `market_daily` OHLC via `getMarketTrend(symbol, sinceMs)`: `vol = clamp01( mean_i( (high_i - low_i) / close_i ) / VOL_REF )` sobre el rango intradia normalizado de los mismos 7 simbolos en la ventana, con `VOL_REF` editorial (recomendado `0.04` = rango medio del 4% satura).
    - **Magnitud final de markets**: `magnitude = clamp01( max( riskOff, vol ) )` — el `max` (no la media) porque tanto un movimiento direccional risk-off como un pico de volatilidad sin direccion clara son, cada uno por separado, una señal de estres de mercado; exigir ambos a la vez perderia regimenes de panico-sin-tendencia. markets aporta MAGNITUD de estres macro, no direccion por-pais (ver D-305).
  Todos los refs (`VOLUME_REF`, `MARKET_REF` (pesos+direcciones por simbolo), `RISKOFF_REF`, `VOL_REF`, saturacion de tono) viven en un `convergence.config.ts` re-derivado (no-AGPL), ajustable. **OQ-C RATIFICADA por el PM: normalizacion lineal-simple con refs en config.** Tradeoff (resuelto a favor de lineal-simple): lineal-simple (ratificada, inspeccionable, calibrable, no lee distribucion historica) vs percentil/z-score contra la distribucion historica del store (mas robusta a outliers, pero requiere leer historia y complica el clean-room/calibracion — diferida a GAP-2).
- **D-304** (deterioro = direccion, no solo magnitud, **OQ-C2 RATIFICADA por el PM**): convergencia exige **mismo DETERIORO**, no solo coincidencia de magnitud. Una observacion entra a la ventana solo si representa **estres creciente o sostenido-alto** {conv.deterioro}: para CII/event/signal la magnitud ya es monotona-con-el-riesgo (mayor = peor), asi que `magnitude >= MIN_MAGNITUDE` basta; adicionalmente se exige que el componente CII tenga `signalPresent=true` (no un floor sin datos) para contar como corroborante CII — porque un floor estructural (baseline sin eventos nuevos) no es "deterioro observado esta ventana", es suelo; convergir sobre floors generaria señales fantasma en paises de alto baseline sin novedad. **OQ-C2 RATIFICADA por el PM: se exige `signalPresent=true` para corroborantes CII.**
- **D-305** (entidad para markets-global, **Q4 / OQ-D RATIFICADA por el PM: markets ENTRA al MVP como corroborante-transversal**): markets no tiene pais. **El usuario decide que markets ENTRA al MVP** (no se difiere). Se modela como **fuente de corroboracion exogena transversal** {conv.markets}: NO crea una entidad sintetica GLOBAL con sus propias señales de convergencia, y NO se difunde geograficamente a cada pais inventando atribucion. En su lugar, markets actua como un **corroborante exogeno que puede sumar al recuento de fuentes independientes de CUALQUIER pais cuyo deterioro economico-CII este activo en la ventana**, cuando su **magnitud de estres** {conv.market.stress} (D-303, derivada de los campos REALES `market_snapshots`/`market_daily`, NO de un "regimeDelta" inexistente) supera `MIN_MAGNITUDE` — porque markets es macro/global (un shock de mercado es contexto comun a todos los paises bajo estres economico), y atribuirlo a un pais concreto inventaria geografia (mismo principio que GKG-sin-pais en D-202 del CII y news-sin-pais en NG-4 del CII). Asi, markets-en-estres funciona como el "+1 fuente no-CII exogena" que D-300 admite. **OQ-D RATIFICADA: markets como corroborante-transversal** (descartadas: entidad GLOBAL propia y difusion por-pais). Tradeoff (resuelto): corroborante-transversal = no inventa geografia, refuerza señales economicas reales, simple; entidad GLOBAL propia = añade una "fila" de convergencia global potencialmente util pero semanticamente distinta (señal-de-sistema, no de-pais), se difiere a NG-1; difusion-por-pais = descartada (inventa atribucion).
- **D-306** (anti-doble-conteo POR CONSTRUCCION, **derivada de Q1, NO negociable en su principio**): un pais **no puede convergir consigo mismo via dos vistas de la misma familia de dato** {conv.antidouble}. Implementacion: a cada observacion se le asigna una etiqueta `dataFamily` {conv.family} ∈ `{ events, signals, markets }` (NO la dimension CII, sino la FAMILIA-DE-DATO de origen: `conflict` y `social` -> `events`; `economic` y `political` -> `signals`; markets -> `markets`). El detector cuenta **fuentes independientes = numero de `dataFamily` DISTINTAS** que superan `MIN_MAGNITUDE` para ese pais en la ventana, NO el numero de componentes/observaciones — porque conflict-CII y social-CII ambos derivan de la familia `events`: contarlos como dos seria doble-conteo del mismo flujo de dato. Una señal valida exige `>=MIN_SOURCES` familias distintas (D-300). Caso limite: economic-CII (familia `signals`) x markets (familia `markets`) = 2 familias disjuntas = valido; conflict-CII x social-CII = 1 familia (`events`) = NO valido por si solo (necesita una tercera familia). El `strength` promedia las magnitudes de las observaciones contribuyentes (una por familia, la de mayor magnitud dentro de la familia) con time-decay sobre la ventana 72h.
- **D-307** (strength con time-decay, **OQ-E RATIFICADA por el PM: `HALF_LIFE_72H = 36h`**): {conv.strength} = **magnitud media de las observaciones contribuyentes (una por familia) ponderada por time-decay** sobre la ventana 72h: `strength = sum(mag_i * w_i) / sum(w_i)`, `w_i = 0.5 ^ (ageMs_i / HALF_LIFE_72H)` con `HALF_LIFE_72H = 36h` (media-vida = mitad de la ventana, asi un corroborante a 72h pesa ~1/4) — porque la convergencia mas reciente es mas accionable y el decay suave evita el cliff de la ventana dura. Distinto del decay 30d del CII (D-206): la convergencia es un evento de coincidencia de corto plazo (72h), no un estado estructural (30d). **OQ-E RATIFICADA por el PM: `HALF_LIFE_72H = 36h`.**
- **D-308** (persistencia: tabla nueva + lifecycle, **Q5a / OQ-F**): tabla nueva **`convergence_signals`** (migracion `005_convergence.sql`) {conv.persistence}, wide-tipada: `id`, `country`, `families_json` (las `dataFamily` que dispararon, TEXT JSON), `components_json` (detalle de observaciones contribuyentes con su magnitud y ts, TEXT JSON), `strength` REAL, `source_count` INTEGER, `methodology_version` TEXT, `first_detected_at` INTEGER, `captured_at` INTEGER ({schema.snapshot.ts}) — porque las columnas tipadas (`country`, `strength`, `source_count`, ts) dan indices/queries directos y el desglose de evidencia es de forma variable -> JSON (mismo patron que `cii_snapshots.components_json`). Lifecycle: cada corrida del job **inserta una fila-snapshot** de las señales activas en la ventana (append-only, como cii_snapshots), NO un upsert con estado mutable — porque el patron time-series del store es append + leer-el-ultimo, y un lifecycle activo/cerrado mutable seria una desviacion que se difiere. `first_detected_at` se calcula buscando si la misma `(country, familyset)` ya aparecio en una ventana previa (continuidad de la señal). **OQ-F RATIFICADA por el PM: append-snapshot** (descartado: upsert-con-estado mutable).
- **D-309** (dynamicScore de la convergencia, **Q5b / OQ-G RATIFICADA por el PM: SI entra al MVP**): {conv.dynamic} = delta de `strength` de la señal vs su aparicion mas reciente previa para el mismo `(country, familyset)`: `dynamicScore = strength_now - strength_prev` (**0 en la primera ventana**, sin prior). Reusa conceptualmente el patron `computeDynamic` del CII (D-209) pero sobre `strength`, no sobre composite — porque una convergencia que se INTENSIFICA (mas fuentes, mayor magnitud) es la señal mas accionable; el delta lo captura. **OQ-G RATIFICADA por el PM: `dynamicScore` ENTRA al MVP** (0 en la primera ventana — es barato de calcular y consistente con como el CII ya expone su `dynamicScore`, asi evita una asimetria de contrato entre las dos capas).
- **D-310** (familias de convergencia del MVP, **Q5c / OQ-H**): el MVP detecta solo {conv.families.mvp} = **conflict x economic**, **political x economic**, **conflict x social** (expresadas como pares de `dataFamily` disjuntas tras el mapeo D-306: `events x signals`, `signals x signals`... — OJO: `political x economic` son ambas familia `signals`, ver nota), con markets como corroborante exogeno transversal (D-305). **NOTA CRITICA derivada de D-306**: como `political` y `economic` mapean ambos a la familia `signals`, el par "political x economic" **NO es independiente por si solo** bajo el anti-doble-conteo; requiere una tercera familia (events o markets) para validar. Por tanto las familias REALMENTE detectables como par-disjunto en el MVP son: **conflict/social (events) x economic/political (signals)** y **cualquier dimension x markets**. Esto se documenta explicitamente como consecuencia de D-300/D-306, no como contradiccion. **OQ-H RATIFICADA por el PM: se ACEPTA el set MVP y la consecuencia de que "political x economic" no es par independiente por si solo** (requiere una tercera familia events o markets). Lo demas (triples, intra-familia fina, cross-pais) -> NG-1.
- **D-311** (modo de servicio del MVP, **Q5d RATIFICADA por el PM: superficie = SOLO briefing + persistencia**): en esta rebanada la convergencia se **persiste** en `convergence_signals` y se **consume desde el briefing** via {ai.briefing.ctx} (un bloque "señales de convergencia activas" en el contexto, leyendo `convergence_signals` del store, sin LLM nuevo D-005). **NO** expone `GET /api/convergence` ni capa de mapa propia en el MVP (NG-4) — porque cerrar persistencia+briefing de punta a punta primero (el diferencial del proyecto: el store y el briefing) es mas valioso que una superficie de UI a medio cablear; API y mapa son una rebanada de superficie posterior bien acotada. **RATIFICADA por el PM: la superficie del MVP es exclusivamente briefing + persistencia (sin `/api/convergence`, sin capa de mapa en esta rebanada).**
- **D-312** (tier del job, **OQ-I RATIFICADA por el PM: `medium` encadenado tras CII**): el job de convergencia corre en el tier **`medium`** del scheduler, **encadenado DESPUES del job CII** (lee `cii_snapshots` recien escritos + events/signals/markets) — porque la observacion canonica es el snapshot CII (D-302); correr antes leeria CII rancio. Alternativa: tier propio independiente (descartada, desincroniza con el latido CII). **OQ-I RATIFICADA por el PM: tier `medium` encadenado tras CII.**

## Interfaces / Data Contracts

### Token-references canonicas

| Token | Resuelve a |
|-------|-----------|
| `{conv.params}` | `MIN_SOURCES = 2`, `MIN_MAGNITUDE = 0.5`, `WINDOW_MS = 72 * 3600 * 1000` (72h). Valores editoriales re-derivados (D-001), ajustables en `convergence.config.ts`. |
| `{conv.observation}` | La unidad que entra a la ventana: `ConvergenceObservation` (ver tipo abajo). Origen canonico = componente CII (D-300/D-302). |
| `{conv.obs.ts}` | Timestamp de la observacion = ts del dato de origen (snapshot CII / event.occurredAt / signal.occurredAt / markets snapshot), NO el ciclo del motor (D-302). |
| `{conv.magnitude}` | Mapeo fuente->`[0,1]` de deterioro (D-303). |
| `{conv.market.stress}` | Magnitud de estres de mercado `[0,1]` = `max(riskOff, vol)` sobre los 7 simbolos fijos, derivada de los campos REALES `market_snapshots.change_pct` (compuesto risk-off ponderado por `MARKET_REF`/`RISKOFF_REF`) y `market_daily` OHLC (proxy de volatilidad `VOL_REF`). NO usa "regimeDelta" (no existe en el store). Receta re-derivada clean-room en `convergence.config.ts` (D-303/D-305, GAP-1 cerrado). |
| `{conv.deterioro}` | Condicion de "mismo deterioro": magnitud monotona-con-riesgo `>= MIN_MAGNITUDE`, corroborante CII con `signalPresent=true` (D-304). |
| `{conv.independence}` | Independencia = familias-de-dato disjuntas + `>=1` no-CII o dos componentes CII de origen disjunto (D-300). |
| `{conv.family}` | `dataFamily ∈ { events, signals, markets }`; mapeo dimension->familia (D-306). |
| `{conv.antidouble}` | Anti-doble-conteo: fuentes-independientes = nº de `dataFamily` DISTINTAS sobre umbral, no nº de componentes (D-306). |
| `{conv.markets}` | markets = corroborante exogeno transversal, sin entidad GLOBAL ni difusion por-pais (D-305). |
| `{conv.strength}` | Magnitud media (una por familia) con time-decay 72h (D-307). |
| `{conv.dynamic}` | Delta de `strength` vs aparicion previa del mismo `(country, familyset)` (D-309). |
| `{conv.families.mvp}` | Set MVP: conflict x economic, political x economic, conflict x social — sujeto a la consecuencia de independencia de D-310. |
| `{conv.persistence}` | Tabla `convergence_signals`, migracion `005_convergence.sql`, append-snapshot (D-308). |
| `{conv.detect}` | `detectConvergence(observations, nowMs): ConvergenceSignal[]` — funcion pura (D-301). |
| `{schema.snapshot.ts}` | Columna `captured_at INTEGER NOT NULL` (epoch ms) — patron time-series del store, igual que events/signals/cii. |
| `{ai.briefing.ctx}` | El builder de contexto del briefing en `@www/core-ai` (`buildRiskContext`/`buildGlobalRiskContext`); se le añade un bloque de convergencia leyendo `convergence_signals` (D-311). |

### Tipos publicos de `@www/core-signals` (propuestos; el implementador fija detalles)

```ts
// Familia-de-dato de origen (anti-doble-conteo, {conv.family})
export type DataFamily = 'events' | 'signals' | 'markets';

// Dimension de deterioro observada (alineada con CiiComponentKey + markets)
export type ConvergenceDimension =
  | 'conflict' | 'economic' | 'political' | 'social' | 'market';

// Una observacion normalizada que entra a la ventana ({conv.observation})
export interface ConvergenceObservation {
  country: string;            // clave canonica (normalizeCountryKey); '' / 'GLOBAL' para markets (ver D-305)
  dimension: ConvergenceDimension;
  dataFamily: DataFamily;     // {conv.family} — usado por el anti-doble-conteo
  magnitude: number;          // [0,1], {conv.magnitude}
  ts: number;                 // {conv.obs.ts} epoch ms
  signalPresent: boolean;     // true si proviene de dato real (no floor CII), {conv.deterioro}
  source: string;             // 'cii:conflict' | 'event:gdelt' | 'signal:trade_sanctions' | 'markets:stress' ...
}

export interface ConvergenceSignal {
  country: string;
  families: DataFamily[];     // familias disjuntas que dispararon (length >= MIN_SOURCES)
  dimensions: ConvergenceDimension[]; // dimensiones contribuyentes (auditoria)
  sourceCount: number;        // = families.length (anti-doble-conteo, D-306)
  strength: number;           // [0,1], {conv.strength}
  dynamicScore: number;       // {conv.dynamic} (0 si nueva)
  observations: ConvergenceObservation[]; // evidencia (una por familia contribuyente)
  methodologyVersion: string; // 'conv-core-1'
  firstDetectedAt: number;
  capturedAt: number;         // {schema.snapshot.ts}
}

// Funcion pura — sin IO ({conv.detect}, D-301)
export function detectConvergence(
  observations: ConvergenceObservation[],
  nowMs: number,
): ConvergenceSignal[];

// Orquestador con IO — arma observaciones desde el store y delega (D-301)
export function detectAllConvergence(nowMs: number): Promise<ConvergenceSignal[]>;
```

### Schema Turso (migracion `005_convergence.sql`, {conv.persistence})

```sql
CREATE TABLE IF NOT EXISTS convergence_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  families_json TEXT NOT NULL,      -- JSON: DataFamily[] que dispararon
  dimensions_json TEXT NOT NULL,    -- JSON: ConvergenceDimension[] (auditoria)
  components_json TEXT NOT NULL,    -- JSON: ConvergenceObservation[] (evidencia)
  strength REAL NOT NULL,           -- [0,1]
  source_count INTEGER NOT NULL,    -- = families.length
  dynamic_score REAL,               -- {conv.dynamic}, NULL si nueva
  methodology_version TEXT NOT NULL,
  first_detected_at INTEGER NOT NULL,
  captured_at INTEGER NOT NULL      -- {schema.snapshot.ts}
);
CREATE INDEX IF NOT EXISTS ix_conv_country_time ON convergence_signals (country, captured_at);
```

### Wire / consumo

- El briefing lee `convergence_signals` (ultimo `captured_at` por `country`) y serializa un bloque "convergencia activa" en {ai.briefing.ctx}. camelCase en wire (coherente con `feedback_api_contract_camelcase`: el store serializa camelCase sin transform).
- NO hay ruta `/api/convergence` en el MVP (NG-4); cuando se añada en una rebanada posterior, devolvera el ultimo snapshot por pais (patron solo-lectura D-212 del CII).

## Do's and Don'ts

- DO: cuenta fuentes independientes por **`dataFamily` distintas** ({conv.antidouble}), nunca por nº de componentes — porque conflict-CII y social-CII comparten la familia `events`; contarlos como dos infla el `sourceCount` y dispara señales falsas (el anti-doble-conteo de D-306 es el corazon de la honestidad de esta rebanada).
- DO: exige `signalPresent=true` a un corroborante CII ({conv.deterioro}) — porque un floor estructural (baseline sin novedad) no es deterioro observado; convergir sobre floors generaria señales fantasma en paises de alto baseline.
- DO: ancla la ventana 72h al timestamp del DATO ({conv.obs.ts}), no al ciclo del motor — porque fechar por el ciclo desincroniza la corroboracion (un dato viejo reentraria como nuevo cada corrida).
- DO: persiste cada snapshot de convergencia en el store antes de servirlo al briefing (D-002/D-003) — porque la UI/briefing lee de la DB local, no recalcula, y asi el historico de convergencia (el diferencial) sobrevive a caidas de fuente.
- DON'T: NO trates markets como un pais ni lo difundas geograficamente ({conv.markets}) — porque markets es macro/global; atribuirlo a un pais concreto inventa geografia (mismo principio que GKG/news sin pais en el CII).
- DON'T: NO recalcules ni modifiques el CII desde esta rebanada (NG-6) — porque el CII es input inmutable; tocarlo acopla dos motores y rompe la separacion de responsabilidades.
- DON'T: NO abras conectores keyed nuevos ni fuentes upstream (NG-5) — porque la convergencia consume solo el store ya vivo; añadir fuentes es otra rebanada con ToS verificado (feedback_data_tos).
- DON'T: NO copies fuente AGPL de worldmonitor para el modelo de convergencia (D-001) — porque solo la metodologia documentada es re-implementable; el codigo y el texto editorial no. Los umbrales {conv.params} son re-derivados, no verbatim.
- DON'T: NO hagas la deteccion en el navegador (D-002) — porque expone el modelo a la cadencia de la pestaña y rompe el local-first; corre en el job `medium` encadenado tras CII (D-312).

## Risks

- R1 (**doble-conteo enmascarado**): si el implementador cuenta componentes en vez de `dataFamily`, el `sourceCount` se infla y aparecen señales falsas. Mitigacion: D-306 lo blinda por construccion + un test unitario que verifique que `conflict-CII x social-CII` (misma familia `events`) NO dispara por si solo.
- R2 (**familias del MVP colapsan a 1 par util**): por D-310, "political x economic" comparten familia `signals` y no son par independiente; el set realmente detectable se reduce a `events x signals` y `cualquiera x markets`. Mitigacion: documentado explicitamente (D-310 nota critica); el PM ACEPTA el set (OQ-H ratificada). **Riesgo de MVP-vacio DESCARTADO por verificacion del PM contra la DB viva (`data/world.db`, GAP-4 cerrado): 63/109 paises del ultimo `cii_snapshots` tienen solapamiento events-family x signals-family elegible.** El matiz vivo: el disparo real aun depende de superar `MIN_MAGNITUDE` por ventana, asi que "elegible" no es "dispara" — la calibracion de umbrales (GAP-2) modula cuantas de esas 63 se materializan.
- R3 (**calibracion de magnitud/umbrales sin ground-truth**): `MIN_MAGNITUDE=0.5`, `VOLUME_REF`, `MARKET_REF`, `HALF_LIFE_72H` son editoriales sin datos historicos de validacion; pueden disparar demasiado o demasiado poco. Mitigacion: todos en `convergence.config.ts` ajustable; calibracion con intel-analyst diferida (gap), `methodology_version` versiona los cambios.
- R4 (**cadencia CII vs reactividad**): anclar al snapshot CII (D-302) hereda la latencia del job `medium`; un deterioro intra-snapshot no se ve hasta la siguiente corrida. Mitigacion: aceptable para un detector de coincidencia de 72h; OQ-B permite al PM elegir crudo-primera-clase si quiere mas reactividad (a costa de mas riesgo de doble-conteo).
- R5 (**markets: derivacion de estres CERRADA, calibracion de refs pendiente**): GAP-1 verificado por el PM contra el codigo real -> **NO existe ningun `regimeDelta`/indicador de regimen en el store**; D-303 ya no lo asume. La magnitud de estres {conv.market.stress} se deriva de los campos que SI existen (`market_snapshots.change_pct` + `market_daily` OHLC) con receta clean-room fijada en `convergence.config.ts`. Riesgo residual: los refs `MARKET_REF` (pesos+direcciones por simbolo), `RISKOFF_REF=3.0` y `VOL_REF=0.04` son editoriales de partida sin ground-truth. Mitigacion: ajustables en config + calibracion diferida (GAP-2); `methodology_version` versiona los cambios. **Ya NO es un riesgo de contrato (campo inexistente) — es un riesgo de calibracion como R3.**
- R6 (**clave de pais heterogenea entre familias**): events/signals/cii comparten `normalizeCountryKey`, pero si una familia usa una variante distinta, el cruce por-pais falla silenciosamente (un pais no converge porque sus observaciones tienen claves distintas). Mitigacion: reusar `normalizeCountryKey` en TODAS las observaciones (NG-7) + un test de cruce con claves conocidas.

## Iteration Guide

- Trabaja UNA pieza a la vez: primero `convergence.config.ts` (umbrales + refs), luego la funcion pura `detectConvergence` con tests (sin DB), luego el armado de observaciones desde el store (`detectAllConvergence`), luego la migracion 005, luego el job `medium` encadenado, por ultimo el bloque de briefing.
- Refiere componentes y tokens por nombre directamente ({conv.params}, {conv.antidouble}, {conv.detect}, {schema.snapshot.ts}).
- Añade familias/dimensiones nuevas como entradas separadas en `convergence.config.ts`, no reescribas las existentes.
- Empieza por la funcion PURA y sus tests (incluyendo el caso anti-doble-conteo R1) antes de tocar IO/DB — es el invariante de honestidad y el unico testeable sin store.
- Tras cada edicion del doc, deja que `spec-validator.js` valide el schema.
- Cierra el flujo persistencia->briefing de punta a punta antes de pensar en API/mapa (NG-4): cobertura parcial es peor que ninguna.

## Known Gaps / Open Questions

> Todas las Open Questions de diseño han sido RATIFICADAS por el PM (ver abajo). Quedan abiertos solo los GAP de **calibracion diferida** (sin ground-truth), no bloqueantes para implementar. `plan-checker` puede auditar el plan derivado.

**Open Questions — RATIFICADAS por el PM (cerradas):**

- **OQ-A** (D-301) — RATIFICADA: paquete `@www/core-signals` (= `packages/core/signals`) + firmas `detectConvergence`/`detectAllConvergence`.
- **OQ-B** (D-302) — RATIFICADA: anclar la observacion al snapshot CII (descartado crudo-primera-clase).
- **OQ-C** (D-303) — RATIFICADA: magnitud lineal-simple con refs en `convergence.config.ts` (descartado percentil/z-score historico).
- **OQ-C2** (D-304) — RATIFICADA: se exige `signalPresent=true` a corroborantes CII.
- **OQ-D** (D-305) — RATIFICADA: **markets ENTRA al MVP** como corroborante-transversal (descartadas entidad GLOBAL propia y difusion por-pais).
- **OQ-E** (D-307) — RATIFICADA: `HALF_LIFE_72H = 36h`.
- **OQ-F** (D-308) — RATIFICADA: append-snapshot (descartado upsert-con-estado mutable).
- **OQ-G** (D-309) — RATIFICADA: `dynamicScore` ENTRA al MVP (0 en la primera ventana — barato y consistente con el contrato del CII).
- **OQ-H** (D-310) — RATIFICADA: set MVP = `events x signals` + `cualquier-dimension x markets`; se ACEPTA la consecuencia de que "political x economic" no es par independiente por si solo (ambas familia `signals`; requiere tercera familia).
- **OQ-I** (D-312) — RATIFICADA: tier `medium` encadenado tras el job CII.

**GAPs abiertos (calibracion diferida — NO bloqueantes):**

- **GAP-1** (R5) — **CERRADO por verificacion de codigo del PM**: NO existe ningun indicador de "regimen/volatilidad" ni `regimeDelta` en el store. Verificado lo que SI existe: `market_snapshots {source, symbol, asset_class, price, change_pct, captured_at}`, `market_daily {symbol, day, open, high, low, close}`, 7 simbolos fijos, helpers `getLatestMarkets()`/`getMarketTrend()`. D-303 ya especifica la **derivacion de la magnitud de estres {conv.market.stress}** a partir de estos campos (compuesto risk-off sobre `change_pct` + proxy de volatilidad OHLC, refs en `convergence.config.ts`). Residual -> calibracion de `MARKET_REF`/`RISKOFF_REF`/`VOL_REF` = GAP-2.
- **GAP-2** (R3, R5): calibracion de umbrales y refs (`MIN_MAGNITUDE`, `VOLUME_REF`, `MARKET_REF`, `RISKOFF_REF`, `VOL_REF`, `HALF_LIFE_72H`) sin ground-truth historico; se difiere a iteracion con intel-analyst (NG-7 del CII). El MVP arranca con valores editoriales de partida; `methodology_version` versiona los cambios.
- **GAP-3**: la idempotencia de `first_detected_at` (continuidad de la misma señal a traves de ventanas) asume una busqueda por `(country, familyset)` en `convergence_signals`; el detalle del query lo fija el implementador. No bloqueante.
- **GAP-4** (R2) — **ACTUALIZADO: viabilidad del MVP VERIFICADA por el PM contra la DB viva (`data/world.db`)**: sondeo del ultimo `cii_snapshots` = **109 paises, de los cuales 63 tienen solapamiento events-family x signals-family** (>=1 componente conflict/social con `signalPresent=true` Y >=1 economic/political con `signalPresent=true`); 45 solo-events, 1 solo-signals, 0 ninguno. **Riesgo de MVP-vacio DESCARTADO**: el MVP `events x signals` es viable, no queda vacio. Matiz vivo: el disparo real de cada par elegible aun depende de superar `MIN_MAGNITUDE` en la ventana 72h (modulado por GAP-2), por lo que "63 elegibles" es cota superior de paises que pueden emitir señal, no recuento garantizado.
