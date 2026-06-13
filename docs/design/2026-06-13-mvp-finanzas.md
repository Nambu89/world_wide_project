---
version: alpha
name: mvp-finanzas
description: Diseño del MVP de la plataforma personal de inteligencia mundial restringido al dominio Finanzas — bootstrap del workspace pnpm + .venv Python reservado, persistencia time-series en libSQL local, scheduler server-side por volatilidad, tres conectores keyless patrón osiris (markets/gdelt/news), mapa MapLibre con config-array central de capas + un panel de Finanzas, router LLM con la rama claude activa + briefing diario cacheado, y un server.ts único que cablea connectors+scheduler+api con guardas de origen/CORS/rate-limit/SSRF. El motor de convergencia cross-domain queda explícitamente fuera (spike futuro). El bloque estructurado (Decisions, Interfaces, Do/Don't) es normativo; la prosa explica el porqué.
status: draft
date: 2026-06-13
owner: system-architect
---

## Overview

Este documento diseña el MVP de la plataforma personal de inteligencia mundial acotado a **un único dominio de decisión: Finanzas**. El problema que resuelve el MVP es doble: (1) demostrar el diferencial del proyecto frente a osiris/worldmonitor — **persistencia histórica time-series** que la UI consume desde una DB local en vez de hacer fetch a upstream — y (2) cerrar un flujo de punta a punta (ingesta → store → api → web → briefing IA) sobre el stack y las decisiones ya bloqueadas en los ADRs base del proyecto.

El resultado deseado es un único servidor Node (`server.ts`) que, a través de un scheduler server-side por volatilidad, cosecha tres fuentes **keyless** (markets, GDELT, RSS news), persiste cada snapshot con timestamp en libSQL local (`file:./data/world.db`), sirve una API que la web lee, pinta un mapa MapLibre con capas declaradas en un config-array central más un panel de Finanzas, y genera un briefing diario con la rama claude del router LLM (con caché para acotar coste). El diseño respeta como **no-negociables** los ADRs base y los cinco anti-patrones de `memory/feedback_*.md`. No es código: es la especificación que el PM convertirá en plan y pasará por `/check-plan` antes de implementar.

## Token-references (bloque canónico)

Cada token se define aquí como `leaf: valor`; las referencias entre llaves del resto del doc (de la forma namespace-punto-leaf) resuelven contra estas definiciones.

Paths del monorepo:

- store: `packages/store/` — referido como {pkg.store}
- scheduler: `packages/scheduler/` — referido como {pkg.scheduler}
- web: `packages/web/` — referido como {pkg.web}
- ai: `packages/core/ai/` — referido como {pkg.core.ai}
- markets: `packages/connectors/finance/markets.ts` — referido como {conn.markets} y como {connector.markets}
- gdelt: `packages/connectors/geo/gdelt.ts` — referido como {conn.gdelt}
- news: `packages/connectors/edu/news.ts` — referido como {conn.news}

Valores y decisiones compartidas:

- workspace: pnpm workspace (raíz `package.json` + `pnpm-workspace.yaml` + `tsconfig.base.json`) para todo el producto TS — referido como {env.workspace}
- python: `.venv` Python 3.12 reservado en `tools/py/`, vacío en el MVP — referido como {env.python}
- timeout: `AbortSignal.timeout(8000)` en todo fetch de conector — referido como {api.connector.timeout}
- chain: `['ollama','groq','claude']` (orden de la cadena del router) — referido como {router.chain}
- active: `'claude'`, única rama activa del router en el MVP — referido como {router.active}
- ts: columna `captured_at` (epoch ms, INTEGER) que marca el instante de captura de cada snapshot — referida como {schema.snapshot.ts}
- key: columna `source` (TEXT) que identifica la fuente de cada fila (`'markets'|'gdelt'|'news'`) — referida como {schema.source.key}
- tiers: tiers de frecuencia por volatilidad del scheduler (fast/medium/slow/daily) — referido como {sched.tiers}
- config: `packages/web/src/map/layers.config.ts`, el config-array central declarativo de capas MapLibre — referido como {web.layers.config}
- briefing: el artefacto "briefing financiero diario" producido por {pkg.core.ai} — referido como {ai.briefing}
- cache: la fila de briefing cacheada en el store con TTL para acotar coste Anthropic — referida como {ai.briefing.cache}
- etag: estrategia de cache/ETag condicional de los conectores + fallback al store — referida como {conn.cache.etag}

Variante de estado:

- `{connector.markets}-stale` = el último snapshot válido servido desde el store cuando {conn.markets} falla upstream (leaf `markets`, ya definido arriba).

## Goals

- **G-1**: Bootstrap reproducible del monorepo — `pnpm-workspace.yaml` + `package.json` raíz + `tsconfig.base.json` + tsconfig por paquete + el {env.python} reservado + `.gitignore` + `.env` derivado de `.env.example`, conforme a {env.workspace}.
- **G-2**: Schema libSQL time-series en {pkg.store} que persiste snapshots con timestamp para markets, eventos GDELT, items de news y briefings, con migraciones idempotentes y una estrategia de retención/consulta de histórico definida.
- **G-3**: Scheduler server-side en {pkg.scheduler} con tiers de frecuencia por volatilidad {sched.tiers}, sin fanout en el navegador, que invoca conectores y persiste cada resultado en el store antes de servirlo.
- **G-4**: Tres conectores keyless patrón osiris ({conn.markets}, {conn.gdelt}, {conn.news}), un fichero por fuente, cada uno con `fetch` + `User-Agent` + {api.connector.timeout} + fallback multinivel + retorno vacío gracioso + cache/ETag {conn.cache.etag}, y allowlist SSRF-safe para RSS.
- **G-5**: Web Vite+React+MapLibre en {pkg.web} con un config-array central de capas {web.layers.config} y un panel de Finanzas con estados explícitos loading/empty/error, que lee de la API local (nunca de upstream).
- **G-6**: Router LLM en {pkg.core.ai} con la cadena {router.chain} implementada íntegra (health-gating + fall-through por key ausente) pero con la rama activa {router.active} en el MVP, más un briefing diario {ai.briefing} con caché {ai.briefing.cache} para controlar coste.
- **G-7**: `server.ts` único que cablea connectors + scheduler + api con origin-check/CORS/rate-limit/SSRF-guard, exponiendo endpoints que la web consume.
- **G-8**: Trazabilidad de licencia y ToS — cero líneas de fuente AGPL de worldmonitor; metodología (router, futuros pesos) re-implementada; ToS de cada fuente registrado en este doc.

## Non-Goals

- **NG-1**: **Motor de convergencia cross-domain** (INVESTIGACION §9.1 / §6.5): la lógica de matching geográfico-temporal + scoring de señales que cruza finanzas+geopolítica+desastre. Razón: worldmonitor NO sirve esa lógica (corre en seed loops Railway, sólo parcialmente documentada), es la pieza más difícil y menos especificada, y requiere su propio spike Research→Plan→Check. Queda fuera del MVP.
- **NG-2**: Dominios **Educación y Política completos**. El MVP usa GDELT y RSS news sólo como **contexto del dominio Finanzas** (cruce evento→mercado en el briefing), no como dominios con sus propios paneles/scoring. Por eso los conectores `geo/gdelt` y `edu/news` aparecen aquí aunque el panel sea sólo de Finanzas.
- **NG-3**: **CII scoring** y la taxonomía de señales de convergencia (`packages/core/cii`, `packages/core/signals`). Razón: pertenecen a Política/correlación, fuera del dominio MVP.
- **NG-4**: Conectores con **key** — FRED, EIA, ACLED, UCDP, sanciones OFAC, Finnhub. Razón: zero-key-first restringe el MVP a fuentes sin key. La única excepción de key es la IA (Anthropic).
- **NG-5**: Ramas **ollama y groq activas**. Razón: los ADRs base las difieren a Fase 3 (riesgo toolchain Windows); se implementan como ramas inactivas del router, no se prueban como proveedores en el MVP.
- **NG-6**: **Turso remoto**, replicación o sync. Razón: el MVP fija libSQL local-file; migrar = cambiar la URL.
- **NG-7**: **ML cliente** (Transformers.js/ONNX), clustering Jaccard de noticias, empaquetado **Tauri**, servidor **MCP**, sistema de variantes multi-dominio. Razón: Fases 3-4.
- **NG-8**: Tests E2E Playwright y `ci.yml`. Razón: gates de proceso, los define el PM/plan; este doc especifica el qué, no el pipeline de verificación.

## Context / Constraints

- **Repo greenfield**: sólo andamiaje + blackboard. **NO hay código de producto ni fuente osiris/worldmonitor cosechada en el repo.** Se diseña desde la metodología documentada en `INVESTIGACION-FUSION.md` + los ADRs, no desde código existente.
- **Stack bloqueado**: TypeScript, monorepo pnpm, Vite, React + MapLibre GL, Node single-server (`server.ts`), router LLM {router.chain}.
- **Persistencia bloqueada**: `@libsql/client` con `url: file:./data/world.db`. **Prohibido `better-sqlite3`** (API divergente de Turso + build nativo Windows).
- **IA bloqueada**: router íntegro, rama activa {router.active} (key Anthropic en `.env`). ollama/groq inactivas.
- **Entorno bloqueado**: {env.workspace} para el producto TS + {env.python} reservado (vacío en MVP). `.venv/` y `node_modules/` → `.gitignore`.
- **Licencia (feedback_no_agpl_copy)**: osiris = MIT (copiar código libremente); worldmonitor = AGPL-3.0 (sólo metodología re-implementada, NUNCA copiar fuente).
- **Datos ≠ licencia (feedback_data_tos)**: cada fuente upstream tiene ToS propios; verificar antes de conectar; CC-BY exige atribución en UI; ToS no verificado → escalación al PM.
- **Zero-key-first (feedback_zero_key_first)**: los conectores del MVP son keyless; las keys (si las hubiera) degradan, no rompen. Única excepción: IA (Anthropic).
- **Secretos (feedback_secrets)**: keys sólo en `.env` (en `.gitignore`, nunca commiteado); el código lee de `process.env`; nunca secretos en strings de comandos.
- **Capas de mapa (feedback_central_layer_config)**: config-array central declarativo en {web.layers.config}; nunca imperativas dispersas en `map.on('load')`.
- **Entorno de ejecución**: Windows (win32). Riesgo toolchain nativo documentado (INVESTIGACION §9.2) para libSQL nativo, Anthropic SDK, MapLibre — ver Risks.
- **Plataforma de uso**: personal, no distribuida — la AGPL §13 no se activa mientras no se exponga por red; el diseño mantiene el código limpio para que esa puerta quede abierta.

## Decisions

> Las decisiones **bloqueadas** (no-negociables) heredan de los ADRs base y de `memory/feedback_*.md`; el ADR fuente se cita una sola vez en cada una. Las decisiones **internas abiertas** (numeradas desde el centenar) son recomendación del arquitecto; el PM decide (sus alternativas/tradeoffs están en Interfaces y en Known Gaps). Cada `D-NNN` aparece una única vez en este doc para mantener IDs únicos; el resto del doc se refiere a ellas por su contenido o por su token.

Bloqueadas (no-negociables):

- **D-001** (ADR-001/ADR-002): el cerebro (router LLM, futuros CII/señales) se **re-implementa** desde metodología documentada — porque copiar fuente AGPL de worldmonitor vuelve todo el programa obra derivada AGPL (§13). osiris (MIT) sí se copia.
- **D-002** (ADR-003): stack = Vite + React + MapLibre + Node single-server + router LLM {router.chain} — porque es lo mantenible por un solo dev y minimiza complejidad operativa frente a la topología multi-servicio de worldmonitor.
- **D-003** (ADR-004): el scheduler persiste snapshots; la UI lee de la DB local, nunca de upstream — porque desacopla la frescura de la pestaña abierta y habilita el histórico (el diferencial).
- **D-004** (ADR-005): router íntegro {router.chain} con health-gating + fall-through, rama activa {router.active} — porque da briefing de calidad desde el día 1 sin depender de Ollama en Windows; ollama/groq quedan inactivas hasta Fase 3.
- **D-005** (ADR-006): store = `@libsql/client` con `url: file:./data/world.db`; prohibido `better-sqlite3` — porque libSQL es SQLite con API idéntica a Turso (migrar = cambiar URL) y evita build nativo divergente en Windows.
- **D-006** (ADR-007): entorno = {env.workspace} + {env.python} reservado vacío — porque deja la estructura lista para ML futuro sin re-bootstrap, sin meter código Python en el MVP.
- **D-007** (feedback_zero_key_first): los tres conectores del MVP son **keyless**; la única key del MVP es Anthropic — porque el MVP debe funcionar sin ninguna key de datos y las keys deben degradar, no romper.
- **D-008** (feedback_central_layer_config): las capas MapLibre se declaran en {web.layers.config}, nunca imperativas — porque la mayor debilidad de osiris son sus ~40 layer-ids dispersos sin registro central.

Internas (recomendación del arquitecto; el PM decide):

- **D-100**: el store usa **una tabla wide de snapshots por dominio con columnas tipadas** (`market_snapshots`, `gdelt_events`, `news_items`) más una tabla `briefings`, en lugar de un EAV genérico — porque el dominio MVP es acotado y conocido, las consultas de tendencia son por-símbolo/por-tipo, y columnas tipadas dan índices y queries directas sin parsing JSON. Alternativas y tradeoffs en Interfaces y en Known Gaps OQ-1.
- **D-101**: cada fila lleva {schema.snapshot.ts} y {schema.source.key}; la **clave de tendencia** es `(source, symbol|event_id, captured_at)` — porque la consulta dominante es "serie temporal de un símbolo/evento", y un índice compuesto sobre esa tripleta la resuelve sin scan.
- **D-102**: la **retención** es por "downsampling perezoso": retención completa N días (recomendado 90) en tablas crudas + una tabla de agregados diarios para histórico largo, purgada por un job de mantenimiento del scheduler — porque la time-series cruda crece rápido y el valor a largo plazo es la tendencia agregada, no cada tick. Alternativas: retención infinita cruda (descartada por crecimiento) y TTL duro sin agregados (descartado porque pierde histórico). Ver Known Gaps OQ-2.
- **D-103**: {sched.tiers} = **tres tiers por volatilidad** — `fast` (markets, ~5 min), `medium` (gdelt, ~15 min), `slow` (news, ~30 min), más un tier `daily` (briefing + mantenimiento de retención, 1×/día) — porque refleja la volatilidad real de cada fuente y acota llamadas Anthropic a 1/día. Los intervalos son configurables, no hardcodeados en lógica. Alternativas: tier único fijo (descartado, ignora volatilidad) y cron expresivo por fuente (descartado, sobre-ingeniería para 3 fuentes). Ver Known Gaps OQ-3.
- **D-104**: {conn.cache.etag} = cada conector mantiene **cache condicional en memoria + fallback al último snapshot del store**: envía `If-None-Match`/`If-Modified-Since` cuando el upstream lo soporta (304 → reusa), y ante fallo total sirve `{connector.markets}-stale` desde el store — porque honra la regla "la DB es la fuente de verdad para la UI" y reduce carga/rate-limit upstream. Alternativa: sin ETag, siempre refetch (descartado, caro y rate-limit-prone, debilidad documentada de osiris `/api/markets`).
- **D-105**: {ai.briefing} se construye con el pipeline **serializeContext → persona → plantilla** (patrón osiris re-apuntado a Claude vía router): `serializeContext` compacta el último snapshot de markets + eventos GDELT relevantes desde el **store** (no upstream) en un contexto acotado; la persona es "analista financiero"; la plantilla produce secciones fijas (Qué se movió / Por qué / Qué vigilar) — porque el grounding desde el store es reproducible y barato, y la estructura fija facilita el render. Ver Known Gaps OQ-4 para la forma exacta de persona/plantilla.
- **D-106**: {ai.briefing.cache} = el briefing se persiste en la tabla `briefings` con `valid_until` (TTL recomendado 24 h, alineado con el tier `daily`); una nueva petición dentro de la ventana sirve el cacheado sin llamar a Anthropic — porque acota el coste Anthropic a ~1 llamada/día y hace el briefing reproducible/auditables.
- **D-107**: estructura monorepo = **paquetes pnpm planos bajo `packages/*` con un `server.ts` en la raíz** que importa los paquetes; cada paquete con su `package.json` + `tsconfig.json` que extiende `tsconfig.base.json`; nombres `@www/store`, `@www/scheduler`, `@www/connectors`, `@www/core-ai`, `@www/web` — porque coincide con los paths del CLAUDE.md y mantiene el wiring en un único `server.ts`. Alternativas: paquete monolítico (descartado, rompe la separación del CLAUDE.md) y nested workspaces (sobre-ingeniería). Ver Known Gaps OQ-5.
- **D-108**: el panel de Finanzas es un **panel lateral con lista de instrumentos + sparkline de tendencia (leída del store) + estados loading/empty/error explícitos**, y el mapa muestra una capa de eventos GDELT como contexto geográfico — porque cumple "un panel de Finanzas" y demuestra el histórico (sparkline) que es el diferencial. Alternativa: dashboard de grid full-screen (descartado, excede el MVP de un panel). Ver Known Gaps OQ-6.

## Interfaces / Data Contracts

> Firmas y schema **normativos**. Tipos en pseudo-TS; el implementador los traduce. Los nombres de columna son contractuales (referenciados por tokens).

Store — schema libSQL ({pkg.store}):

```sql
-- Snapshots de mercados (tier fast). Una fila por símbolo por captura.
CREATE TABLE IF NOT EXISTS market_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT    NOT NULL,            -- {schema.source.key}: 'markets'
  symbol      TEXT    NOT NULL,            -- ej. 'AAPL','BTC-USD','CL=F'
  asset_class TEXT    NOT NULL,            -- 'stock'|'crypto'|'commodity'|'index'
  price       REAL    NOT NULL,
  change_pct  REAL,
  captured_at INTEGER NOT NULL             -- {schema.snapshot.ts}: epoch ms
);
CREATE INDEX IF NOT EXISTS ix_market_trend
  ON market_snapshots (source, symbol, captured_at);   -- clave de tendencia (índice compuesto)

-- Eventos GDELT (tier medium). Contexto geopolítico para el briefing/mapa (NG-2).
CREATE TABLE IF NOT EXISTS gdelt_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT    NOT NULL,            -- 'gdelt'
  event_id    TEXT    NOT NULL,            -- id estable del evento upstream
  category    TEXT,                        -- 'unrest'|'conflict'|'political'
  severity    REAL,
  lat         REAL,
  lon         REAL,
  captured_at INTEGER NOT NULL,
  UNIQUE (event_id, captured_at)
);
CREATE INDEX IF NOT EXISTS ix_gdelt_trend
  ON gdelt_events (source, captured_at);

-- Items de noticias (tier slow). RSS curado, allowlist SSRF-safe.
CREATE TABLE IF NOT EXISTS news_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT    NOT NULL,           -- 'news'
  feed_domain  TEXT    NOT NULL,           -- dominio allowlisted de origen
  title        TEXT    NOT NULL,
  url          TEXT    NOT NULL,
  published_at INTEGER,
  captured_at  INTEGER NOT NULL,
  UNIQUE (url, captured_at)
);

-- Briefings cacheados (tier daily), con TTL.
CREATE TABLE IF NOT EXISTS briefings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain      TEXT    NOT NULL,            -- 'finance' en el MVP
  body_md     TEXT    NOT NULL,            -- briefing renderizado en Markdown
  model       TEXT    NOT NULL,            -- proveedor/modelo usado ({router.active})
  created_at  INTEGER NOT NULL,
  valid_until INTEGER NOT NULL             -- {ai.briefing.cache} TTL
);

-- Agregados diarios para histórico largo (downsampling de retención).
CREATE TABLE IF NOT EXISTS market_daily (
  symbol      TEXT    NOT NULL,
  day         INTEGER NOT NULL,            -- epoch ms truncado a día UTC
  open        REAL, high REAL, low REAL, close REAL,
  PRIMARY KEY (symbol, day)
);
```

**Migraciones**: ficheros SQL numerados (`001_init.sql`, `002_*.sql`) aplicados idempotentemente en arranque (tabla `_migrations` con los ids aplicados). API del paquete:

```ts
// {pkg.store}
export function getDb(): LibsqlClient;              // url: file:./data/world.db
export async function migrate(): Promise<void>;     // idempotente, corre al boot
export async function insertMarketSnapshots(rows: MarketSnapshot[]): Promise<void>;
export async function insertGdeltEvents(rows: GdeltEvent[]): Promise<void>;
export async function insertNewsItems(rows: NewsItem[]): Promise<void>;
export async function getLatestMarkets(): Promise<MarketSnapshot[]>;          // último por símbolo
export async function getMarketTrend(symbol: string, sinceMs: number): Promise<MarketSnapshot[]>;
export async function getCachedBriefing(domain: string, nowMs: number): Promise<Briefing | null>; // null si expiró
export async function saveBriefing(b: Briefing): Promise<void>;
export async function purgeAndDownsample(beforeMs: number): Promise<void>;    // tier daily
```

**Tradeoffs del schema (decisión interna del wide-tipado)**: *wide-tipado* (recomendado) vs *EAV genérico* `(source, key, value_json, ts)` vs *una tabla por símbolo*. Wide-tipado gana en consultas/índices directos para un dominio acotado; EAV gana flexibilidad pero pierde índices y obliga a parsear JSON; tabla-por-símbolo explota en nº de tablas. Recomendación: wide-tipado.

Scheduler ({pkg.scheduler}) — tiers {sched.tiers}:

```ts
type Tier = 'fast' | 'medium' | 'slow' | 'daily';
interface Job {
  name: string;
  tier: Tier;
  intervalMs: number;             // configurable, no hardcodeado en lógica
  run: () => Promise<void>;       // fetch conector -> persiste en store ANTES de servir
}
// Intervalos recomendados (configurables): fast=5min, medium=15min, slow=30min, daily=24h
export function createScheduler(jobs: Job[]): { start(): void; stop(): void };
```

Cada `run` sigue el invariante de persistir en store antes de exponer. El tier `daily` agrupa (a) generar+cachear el briefing y (b) `purgeAndDownsample`. Sin fanout en navegador.

Conectores — patrón osiris (keyless, cache {conn.cache.etag}) — contrato común:

```ts
interface ConnectorResult<T> {
  data: T[];          // vacío en fallo gracioso, nunca throw hacia el caller
  stale: boolean;     // true si se sirvió {connector.markets}-stale desde store
  fetchedAt: number;  // epoch ms
}
// Todo fetch usa {api.connector.timeout} + User-Agent custom.
export async function fetchMarkets(): Promise<ConnectorResult<MarketSnapshot>>; // {conn.markets}
export async function fetchGdelt():   Promise<ConnectorResult<GdeltEvent>>;     // {conn.gdelt}
export async function fetchNews():    Promise<ConnectorResult<NewsItem>>;       // {conn.news}
```

Fallback multinivel (ej. markets): Yahoo v8 → Yahoo v6 → último snapshot del store (`{connector.markets}-stale`) → vacío gracioso. {conn.news} valida cada URL contra una **allowlist de dominios** (SSRF-safe) antes de fetch.

**ToS por fuente (feedback_data_tos)** — registrado aquí; si alguno resulta no verificado en implementación → escalación al PM:

- markets (Yahoo Finance / CoinGecko keyless): ToS-gris, endpoints no documentados → válidos uso personal, marcar frágiles/degradables. **Verificar antes de conectar.**
- gdelt (GDELT 2.0): dato público, keyless. ToS permisivo.
- news (RSS curado): cada feed con su licencia; allowlist limita a dominios cuyo ToS de RSS personal se haya verificado. CC-BY (si aplica) → atribución en UI.

Router LLM + briefing ({pkg.core.ai}):

```ts
// {router.chain} = ['ollama','groq','claude']; {router.active} = 'claude'
type Provider = 'ollama' | 'groq' | 'claude';
interface ProviderState { provider: Provider; available: boolean; reason?: string } // health-gating
export function resolveChain(): ProviderState[];   // ollama/groq -> available:false (key ausente) en MVP
export async function complete(prompt: string, opts?: object): Promise<string>; // recorre la cadena, usa el 1º available

// {ai.briefing}: serializeContext (desde STORE, no upstream) -> persona -> plantilla
export function serializeContext(latest: MarketSnapshot[], events: GdeltEvent[]): string;
export async function generateDailyBriefing(): Promise<Briefing>; // respeta {ai.briefing.cache}
```

El briefing lee `getCachedBriefing` primero; si expiró, serializa contexto desde el store, llama `complete` (rama claude), persiste con `saveBriefing` y `valid_until = now + 24h`.

server.ts:

```ts
// Cablea: migrate() -> connectors -> scheduler.start() -> api (http)
// Middleware pipeline (orden normativo): origin-check -> CORS -> rate-limit -> SSRF-guard (sólo rutas que fetchean por dominio) -> route
// Endpoints que la web consume (sólo lectura del store):
GET /api/markets         -> getLatestMarkets()
GET /api/markets/:symbol -> getMarketTrend(symbol, since)   // sparkline del panel de Finanzas
GET /api/gdelt           -> eventos recientes para la capa de mapa
GET /api/briefing        -> getCachedBriefing('finance', now)  // nunca dispara Anthropic on-request
GET /api/health          -> estado de scheduler + store
```

Web ({pkg.web}) — config-array de capas {web.layers.config} + panel:

```ts
// {web.layers.config} = packages/web/src/map/layers.config.ts — declarativo, iterado por el render
interface LayerSpec {
  id: string;
  source: string;                 // id de la fuente GeoJSON
  type: 'circle' | 'symbol' | 'heatmap';
  paint?: Record<string, unknown>;
  visibleWhen: (active: Set<string>) => boolean;  // visibilidad por activeLayers
}
export const LAYERS: LayerSpec[] = [ /* gdelt-events, ... */ ];
// El componente de mapa ITERA LAYERS; añadir una capa = añadir una entrada (nunca map.on('load') imperativo).
```

El panel de Finanzas consume `/api/markets` y `/api/markets/:symbol`, con estados `loading | empty | error` explícitos, y un sparkline alimentado por el histórico del store.

## Do's and Don'ts

- **DO**: persiste cada snapshot/evento/item en el store **antes** de servirlo por la API — porque la UI lee de la DB local, no de upstream, y así el dato sobrevive a caídas de la fuente.
- **DO**: usa {api.connector.timeout} en **todo** fetch de conector — porque sin timeout un upstream colgado bloquea el scheduler y degrada todo el server.
- **DO**: declara toda capa MapLibre en {web.layers.config} y haz que el render itere el array — porque corrige la debilidad de osiris (capas dispersas) y el `verifier` comprueba este wiring (feedback_central_layer_config).
- **DO**: sirve `{connector.markets}-stale` desde el store ante fallo upstream y marca `stale:true` — porque un dato viejo etiquetado es mejor que un panel vacío, y la UI puede indicar la antigüedad.
- **DO**: lee keys desde `process.env` (cargadas por el runtime desde `.env`) — porque feedback_secrets prohíbe hardcodear secretos o pasarlos en strings de comandos.
- **DO**: registra el ToS de cada fuente en este doc y en el conector; si no está verificado → escala al PM — porque datos ≠ licencia del código (feedback_data_tos).
- **DON'T**: NO hagas fetch directo desde el frontend a una fuente upstream — porque expone rate limits del cliente, rompe el modelo local-first y contradice el invariante de leer del store.
- **DON'T**: NO copies fuente AGPL de worldmonitor (router, pesos, listas) — porque sólo la metodología es re-implementable; el código vuelve el programa obra derivada AGPL (feedback_no_agpl_copy).
- **DON'T**: NO uses `better-sqlite3` ni una API de DB distinta de `@libsql/client` — porque diverge de Turso (migrar dejaría de ser sólo cambiar la URL) y arrastra build nativo en Windows.
- **DON'T**: NO dispares Anthropic en cada request de `/api/briefing` — porque revienta el coste; sólo el tier `daily` regenera, el resto sirve {ai.briefing.cache}.
- **DON'T**: NO actives ramas ollama/groq ni añadas conectores con key en el MVP — porque los ADRs base y zero-key-first las difieren; deben quedar como ramas inactivas que degradan, no rompen.
- **DON'T**: NO escribas la lógica del scheduler con intervalos hardcodeados dentro de la función de fetch — porque {sched.tiers} debe ser configurable para ajustar volatilidad sin tocar la lógica.

## Risks

- **R-1 (toolchain Windows — libSQL nativo)**: `@libsql/client` puede arrastrar un binario nativo; en win32 (INVESTIGACION §9.2) el build/instalación puede fallar. **Mitigación**: validar `pnpm install` de `@libsql/client` en este Windows en la **tarea-1** (bootstrap) antes de avanzar; documentar versión que funciona. Si falla nativo → evaluar el cliente WASM de libSQL (sigue siendo `@libsql/client`/file, no rompe la decisión de persistencia).
- **R-2 (toolchain Windows — Anthropic SDK)**: el SDK Anthropic es JS puro (bajo riesgo nativo), pero la conectividad/proxy corporativo SVAN puede bloquear. **Mitigación**: el router debe degradar (no romper) si Anthropic no responde; el briefing entonces sirve el último cacheado o un estado "briefing no disponible".
- **R-3 (toolchain Windows — MapLibre/Vite)**: MapLibre GL es WebGL en navegador (bajo riesgo de build), pero `canvas`/WebGL en CI headless podría fallar. **Mitigación**: fuera del scope del MVP (NG-8), pero anotar para cuando se añada CI.
- **R-4 (endpoints no documentados de markets)**: Yahoo v8/v6 y CoinGecko keyless rompen en silencio (debilidad osiris). **Mitigación**: fallback multinivel + `stale` desde store + log explícito (no catch silencioso).
- **R-5 (coste Anthropic no medido)**: se asume ~1 llamada/día pero el coste real no está medido (INVESTIGACION §9.4). **Mitigación**: {ai.briefing.cache} con TTL 24h + tier `daily` único; medir consumo tras la primera semana.
- **R-6 (crecimiento time-series)**: la tabla cruda crece sin límite si no se purga. **Mitigación**: retención 90d + downsampling diario en tier daily. Riesgo residual: la política de retención es una recomendación, no validada con volumen real (Known Gaps OQ-2).
- **R-7 (SSRF en news)**: RSS acepta URLs arbitrarias → SSRF si no se valida. **Mitigación**: allowlist de dominios SSRF-safe en {conn.news} + SSRF-guard en `server.ts`.
- **R-8 (deriva AGPL accidental)**: un implementador podría pegar líneas de worldmonitor al re-implementar el router. **Mitigación**: feedback_no_agpl_copy; el `codebase-navigator` marca el código AGPL como sólo-referencia; revisión del `verifier`.

## Iteration Guide

- Trabaja **UNA pieza a la vez** (un paquete, un conector, una tabla, un panel). Cobertura parcial de un flujo es peor que un flujo cerrado de punta a punta.
- Refiere componentes y valores por su **token** ({schema.snapshot.ts}, {router.chain}, {web.layers.config}, {api.connector.timeout}) — no repitas el valor literal ni re-cites un `D-NNN` por su número (cada id se define una sola vez; refiérete a su contenido).
- Sigue el **orden de implementación sugerido** (abajo): el grafo de dependencias entre paquetes manda. No implementes un conector antes de que el store y su contrato existan.
- Añade variantes nuevas como **entradas separadas** (una nueva capa en {web.layers.config}, un nuevo `Job` en el scheduler, una nueva tabla con su migración), no reescribas las existentes.
- Tras cada edición de este doc, deja que `spec-validator.js` valide el schema (front-matter + secciones en orden + ≥1 Non-Goal + sin token colgante + IDs únicos).
- Cierra cada flujo de punta a punta antes de pasar al siguiente; el `verifier` comprueba wiring real (conector→store, scheduler→job, layer en config-array, panel importado, ruta en `server.ts`).
- Si una decisión interna entra en conflicto con un descubrimiento de implementación, **no la reescribas silenciosamente**: el implementador para y reporta; el cambio de decisión vuelve al PM (puede generar un nuevo ADR).

Secuencia de implementación sugerida (input del plan del PM — el PM escribe el plan, no este doc). Grafo de dependencias entre paquetes (→ = "depende de / debe existir antes"):

1. **Bootstrap entorno** ({env.workspace} + {env.python} + `.gitignore` + `.env`). Bloquea todo. Valida R-1 (libSQL install) aquí.
2. **{pkg.store}** (schema + migraciones + API). Depende de (1). Es la base: connectors, scheduler, core/ai y api leen/escriben aquí.
3. **Conectores** ({conn.markets}, {conn.gdelt}, {conn.news}). Dependen de (2) (sus tipos `MarketSnapshot`/`GdeltEvent`/`NewsItem` y del fallback-stale). Son **independientes entre sí** → paralelizables (un fichero por fuente).
4. **{pkg.scheduler}** (jobs + tiers). Depende de (2) y (3): orquesta conectores→store.
5. **{pkg.core.ai}** (router + briefing). Depende de (2): serializa contexto desde el store, cachea briefing.
6. **server.ts**: cablea (2)+(4)+(5) + middleware + endpoints. Depende de todo lo anterior. **Fichero de alto conflicto** → serializar sus toques (no paralelizar el wiring).
7. **{pkg.web}** ({web.layers.config} + panel). Depende de (6) (consume la API). El config-array y el panel pueden avanzar contra contratos mock mientras (6) madura, pero el cierre E2E requiere (6).

Orden serial seguro para un solo dev: 1 → 2 → (3 en paralelo) → 4 → 5 → 6 → 7. Ficheros de alto conflicto a serializar: `server.ts` (registro), {web.layers.config}, las migraciones del store.

Diagrama de flujo de datos (texto/ASCII):

```
                    upstream (keyless)
        Yahoo/CoinGecko   GDELT 2.0   RSS allowlist
              |               |              |
              v               v              v
        [conn.markets]  [conn.gdelt]   [conn.news]     <- {api.connector.timeout}, fallback multinivel,
              \              |              /              cache/ETag {conn.cache.etag}, retorno vacío gracioso
               \            |             /
                v           v            v
            +-------------------------------+
            |        {pkg.scheduler}        |  jobs por volatilidad {sched.tiers}
            |   fast / medium / slow / daily|  (server-side, NO fanout en navegador)
            +---------------+---------------+
                            | persiste ANTES de servir
                            v
            +-------------------------------+         +------------------------+
            |          {pkg.store}          |<--------| {pkg.core.ai}          |
            |  libSQL file:./data/world.db  |  lee    | serializeContext->     |
            |  market_snapshots, gdelt_..., |  store  | persona->plantilla->   |
            |  news_items, briefings,       |  escribe| {router.active}=claude |
            |  market_daily  (time-series)  | briefing| -> {ai.briefing.cache} |
            +---------------+---------------+         +------------------------+
                            ^ (stale fallback)
                            | sólo-lectura del store
                    +-------+-------------------------------+
                    |               server.ts              |  origin-check -> CORS -> rate-limit
                    |  /api/markets[/:symbol] /api/gdelt    |  -> SSRF-guard -> route
                    |  /api/briefing  /api/health          |
                    +-------+-------------------------------+
                            | HTTP (la web NUNCA llama upstream)
                            v
            +-------------------------------+
            |           {pkg.web}           |  MapLibre + {web.layers.config} (capa gdelt)
            |  Panel Finanzas: lista +      |  estados loading/empty/error
            |  sparkline (histórico store)  |
            +-------------------------------+
```

## Known Gaps / Open Questions

> Lo que este diseño NO resuelve y las decisiones internas que el PM debe ratificar. Evita confianza alucinada.

Fuera del MVP (con razón):

- **GAP-1 — Motor de convergencia cross-domain (INVESTIGACION §9.1)**: la lógica de matching geográfico-temporal + scoring que cruza finanzas+geopolítica+desastre **está FUERA del MVP** (ver NG-1). Razón: worldmonitor no la sirve (seed loops Railway, parcialmente documentada), es la pieza de mayor riesgo del plan completo, y exige su propio spike Research→Plan→Check. En el MVP, GDELT entra sólo como **contexto** del briefing/mapa, sin scoring de convergencia.
- **GAP-2 — `.env.example` no legible**: el fichero `.env.example` está denegado por permisos de lectura para este agente, así que el contrato exacto de variables no se ha podido confirmar carácter a carácter. Del contexto se deriva que **debe** incluir al menos `ANTHROPIC_API_KEY` y la URL de la DB (`file:./data/world.db`). El PM/implementador debe confirmar el set exacto contra `.env.example` y `.claude/SECRETS.md` en la tarea-1.

Open Questions (decisiones internas a ratificar por el PM):

- **OQ-1 (schema)**: ¿wide-tipado (recomendado por la decisión interna del wide-tipado en Decisions) vs EAV genérico? Recomendación: wide-tipado por consultas/índices directos en dominio acotado.
- **OQ-2 (retención)**: ¿retención 90d + downsampling diario (recomendado por la decisión de retención en Decisions) vs infinita cruda vs TTL duro? Falta validar el volumen real de market_snapshots para fijar los 90d. Recomendación: 90d + agregados, ajustable.
- **OQ-3 (tiers scheduler)**: ¿3 tiers fijos fast/medium/slow + daily (recomendado por la decisión de {sched.tiers} en Decisions) vs cron expresivo por fuente? Recomendación: 3 tiers, configurables.
- **OQ-4 (persona/plantilla briefing)**: la forma exacta de la persona "analista financiero" y las secciones de la plantilla de {ai.briefing} están esbozadas (Qué se movió/Por qué/Qué vigilar) pero no congeladas; conviene una iteración con el `intel-analyst`.
- **OQ-5 (estructura monorepo)**: ¿paquetes planos `@www/*` + `server.ts` raíz (recomendado por la decisión de estructura monorepo en Decisions) vs monolito vs nested? Recomendación: planos.
- **OQ-6 (layout panel)**: ¿panel lateral + sparkline (recomendado por la decisión del panel de Finanzas en Decisions) vs grid full-screen? Recomendación: panel lateral (cumple "un panel" del MVP y muestra el histórico).

Riesgos toolchain Windows a confirmar empíricamente (ver Risks R-1 .. R-3): instalación nativa de `@libsql/client`, conectividad del Anthropic SDK tras proxy corporativo, y build de MapLibre/Vite. Ninguno bloquea el diseño; todos se validan en bootstrap (tarea-1).

## PLANNING COMPLETE
