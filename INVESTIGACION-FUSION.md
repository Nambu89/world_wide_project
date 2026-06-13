# Plataforma Personal de Inteligencia Mundial — Informe de Investigación y Plan de Fusión

> Documento semilla para `world_wide_project`. Lector: desarrollador solo, hispanohablante. Objetivo: fusionar lo mejor de **osiris** + **worldmonitor** en una plataforma personal de información mundial con IA para apoyar decisiones **financieras, educativas/de estudio y políticas/geopolíticas** — uso personal exclusivo. Construcción usando el sistema multi-agente de desarrollo de **TaxIA**.
> Estado del repo destino (`world_wide_project`): vacío, sin commits, solo un `.claude/settings.local.json`. Lienzo en blanco.

---

## 1. Resumen ejecutivo

- **TaxIA no es el producto que vamos a clonar; es la fábrica.** El valor portable de TaxIA es su sistema de desarrollo multi-agente sobre Claude Code: un PM-coordinator (opus) que orquesta especialistas (sonnet/haiku), dos puertas de calidad de solo-lectura (`plan-checker`, `verifier`), un workflow RPI (Research → Plan → Check → Implement → Verify) y una columna vertebral de coordinación basada en ficheros Markdown commiteados a git. Eso es agnóstico de dominio y se reutiliza tal cual.
- **osiris (MIT)** es la referencia de arquitectura de *ingesta y visualización*: ~50 route handlers Next.js (un fichero por fuente), un orquestador de polling cliente muy afinado, un motor MapLibre multicapa y un patrón de briefing IA (serializar contexto → persona analista → plantilla). Licencia permisiva: puedes copiar conectores y patrones sin fricción para uso personal.
- **worldmonitor (AGPL-3.0)** es la referencia de *síntesis y scoring*: el **Country Intelligence Index (CII)** con pesos documentados, un **router LLM multi-proveedor local-first** (Ollama → Groq → OpenRouter → genérico), una taxonomía de **señales de convergencia cross-source**, un radar financiero multi-señal y un blueprint de auto-hospedaje con Ollama y zero-config.
- **Ruta recomendada: base = worldmonitor (metodología, no necesariamente código), cosecha = osiris (conectores + UX de mapa).** worldmonitor gana en la capa de *cerebro* (IA, correlación, riesgo); osiris gana en la capa de *plomería* (conectores aislados, robustos, sin frameworks pesados) y de *cara* (mapa). Se justifica en la sección 5.
- **Cuidado con licencias.** Para uso **personal y no distribuido** la AGPL de worldmonitor no impone obligaciones. El momento en que expongas tu instancia por red a terceros (web pública, amigos) se activa la cláusula 13 (debes ofrecer el código completo bajo AGPL). Estrategia segura: **re-implementar la metodología CII** (las fórmulas/ideas no son copyrightables) en lugar de copiar fuente AGPL, y mantener cualquier componente derivado de worldmonitor tras una frontera de proceso. osiris (MIT) no tiene este problema.
- **El dato no hereda la licencia del código.** Cada fuente upstream tiene sus propios ToS: OpenSanctions (CC-BY, atribución), GDELT/USGS (público), pero Yahoo Finance, CoinGecko, OpenSky, Telegram-scraping son ToS-gris y/o endpoints no documentados — válidos para uso personal, frágiles para redistribución.
- **Stack propuesto pragmático:** monorepo TypeScript con Vite + un backend ligero de connectors (route handlers estilo osiris, desplegables como funciones o como servidor Node único), MapLibre para el mapa, una capa de scoring/correlación propia (CII re-implementado) y un router LLM local-first (Ollama por defecto, Groq/Claude opcional). Persistencia con SQLite/Turso para **histórico time-series** — el gran hueco de ambos repos (todo es in-memory/live).
- **Próximo paso inmediato:** NO empezar a codear. Lanzar una sesión `/brainstorming` (skill `superpowers:brainstorming`) para fijar alcance y MVP, luego sembrar `CLAUDE.md` + `ROADMAP.md` + `DECISIONS.md` + `agent-comms.md` en el repo vacío y arrancar el ciclo RPI. Detalle en secciones 7-8.

---

## 2. Sistema multi-agente de desarrollo de TaxIA

Este es el activo más reutilizable de todo lo investigado. No es código de producto: es un **andamiaje de desarrollo** que convierte a Claude Code en un equipo. Lo describo y marco qué es portable.

### 2.1 Orquestación hub-and-spoke

El centro es **`pm-coordinator`** (`/pm`, modelo **opus**, `maxTurns 30`, `permissionMode acceptEdits`, `memory: project`, skills `project-research` + `roadmap-manager`, herramientas incl. `Task` + `WebSearch`/`WebFetch`). Su regla dura está literalmente en el fichero: *"Nunca escribas codigo de produccion directamente"*. El PM investiga, planifica, delega, documenta y verifica — no implementa. Tiene una **Guardia Anti-Paralisis**: tras 3 rondas de análisis sin delegar/decidir/instruir, debe resumir, proponer una acción concreta y ejecutarla.

Alrededor giran los **especialistas implementadores** (escriben código, comparten plantilla de guardarraíles):
- **backend-architect** (`/backend`, sonnet, maxTurns 20) — FastAPI, multi-agente, DB, seguridad.
- **frontend-dev** (`/frontend`, sonnet, maxTurns 20) — React 18 + TS + Vite + PWA.
- **python-pro** (`/python`, sonnet, maxTurns 15) — async/perf/debugging.

Y los **especialistas de research/contenido**: `competitive-intel` (sonnet), `doc-crawler` (**haiku**, crawler de PDFs con anti-bloqueo), `doc-auditor` (**haiku**, sincroniza docs↔código).

### 2.2 Las dos puertas de calidad (el verdadero núcleo)

Son agentes **solo-lectura**: tienen `bypassPermissions` pero NO tienen `Write`/`Edit` en su lista de tools. La capacidad se restringe por la lista de herramientas, no solo por el prompt — separación de poderes real.

- **plan-checker** (`/check-plan`, **opus**, maxTurns 10) — puerta **PREVENTIVA**. Audita un plan en 5 dimensiones: D1 cobertura de requisitos, D2 completitud de tareas, D3 dependencias (incl. circulares), D4 scope (>15 ficheros o >3 áreas = WARNING), D5 riesgos (auth/JWT/rate-limiter/DB-schema). Emite `PASS` o `ISSUES_FOUND`. Principio: *"Plan completo ≠ Goal alcanzable."* Regla: el PM **nunca** muestra un plan al usuario hasta que pase `PASS`.
- **verifier** (`/verify`, **sonnet**, maxTurns 15) — puerta **POST-implementación**, *goal-backward*. Deriva las condiciones que deben ser ciertas y las verifica contra el código REAL: artefactos existen y no son stubs (detecta TODOs/catch vacíos/console.log), wiring (router en `main.py`, tool en `__init__.py`, componente importado en `App.tsx`), tests pasan, docs/memoria actualizadas. Emite `VERIFIED`/`ISSUES_FOUND`/`INCOMPLETE`. Credo: *"DO NOT trust claims, verify what ACTUALLY exists."* Regla: el PM **nunca** reporta "completado" sin `VERIFIED`.
- **qa-tester** (`/qa`, sonnet + Playwright MCP) — puerta E2E/UX complementaria, NO sustituto del verifier.

### 2.3 Workflow RPI y guardarraíles compartidos

El ciclo es **RPI = Research → Plan → Check → Implement → Verify** con Check y Verify como pasos NO opcionales. Cada implementador comparte un bloque de guardarraíles copy-paste:
- **Matriz Auto-Fix vs STOP** (6 reglas): auto-arregla bugs/faltantes-críticos/bloqueos sin preguntar, pero PARA ante cambios de arquitectura/scope/producto/UX.
- **Tope anti-thrash**: máximo 3 intentos de auto-fix sobre el mismo problema, luego STOP + documentar.
- **Anti-paralisis**: 5 lecturas consecutivas (Read/Grep/Glob) sin una escritura (Write/Edit/Bash) → STOP, justificar en una frase, actuar-o-reportar-bloqueado.
- **Protocolo de auto-verificación**: prohibido decir "hecho" sin ejecutar checks de existencia + tests/build + git-diff.

### 2.4 Coordinación y memoria basada en ficheros (el "blackboard")

No hay daemon ni bus de mensajes: **todo es Markdown commiteado a git**, lo que lo hace durable, greppeable y resistente a la compactación de contexto.
- **`agent-comms.md`** (raíz, append-only) — canal asíncrono. Formato `## [TIMESTAMP] [AGENT] [STATUS] — Mensaje` con vocabulario fijo: 🟢 `DONE` | 🟡 `IN_PROGRESS` | 🔴 `BLOCKED` | 📢 `NEEDS_REVIEW`. Contrato: leer al empezar, escribir al terminar.
- **`plans/DECISIONS.md`** — log ADR. Plantilla estricta (ADR-NNN / Fecha / Estado / Contexto / Opciones con pros-cons / Decisión / Consecuencias). Solo el PM escribe. *(Bug observado: dos ADR-007 duplicados — añadir un lint de IDs en nuestro repo).*
- **`plans/ROADMAP.md`** — log de completitud + BACKLOG (Alta/Media/Baja con checkboxes).
- **`memory/MEMORY.md`** — índice maestro + ~satélites por tema; incluye ficheros **`feedback_*.md`** que cristalizan anti-patrones permanentes ("nunca hardcodear corpus legal", "solo fuentes oficiales", "leer antes de arreglar").
- **`.claude/agent-memory/<agente>/MEMORY.md`** — scratchpad privado por agente (lore que NO debe contaminar el índice global).
- **`claude-progress.txt`** — log cronológico de sesiones.

### 2.5 Fresh-Context Delegation (anti context-rot)

Mecanismo explícito contra la degradación de contexto. Disparadores: tarea toca >5 ficheros, O >3 pasos secuenciales, O contexto >50% usado, O tarea independiente. Mecanismo: el PM escribe un brief MÍNIMO (máx 5 ficheros + patrón a seguir + restricciones + resultado esperado) y lanza el subagente vía `Task`, pasando SOLO lo necesario. Principio: *"Cada subagente recibe ~200k tokens limpios; el PM mantiene la visión global."*

### 2.6 Skills, commands, hooks

- **Skills reutilizables** (varias adaptadas de `github.com/obra/superpowers`): `systematic-debugging` (Iron Law: no fix sin root cause), `verification-before-completion` (IDENTIFY/RUN/READ/VERIFY/CLAIM), `dispatching-parallel-agents`, `subagent-driven-development` ("paste context, don't reference"), `git-worktree-isolation`, `project-research`, `roadmap-manager`, `playwright-testing`. **Todas portables.** Las skills de dominio de TaxIA (`irpf-calculation`, `stripe-integration`, `turso-patterns`, etc.) NO aplican aquí salvo como patrón.
- **Commands** (`.claude/commands/*.md`, todos `disable-model-invocation: true` = solo humano): patrón *command-as-shim* (`/pm`, `/qa`, `/verify`… leen el `.md` del agente y adoptan el rol) + runbooks (`/start` entorno, `/prime` contexto ligero pre-delegación, `/sync` git pull + leer comms, `/commit`, `/review`, `/test`, `/deploy`, `/drift-detect` auditor forkeado read-only).
- **Hooks/seguridad**: `bash-gate.js` (allowlist regex + DENY_RULES, pero **fail-open** — conviene voltear a default-deny), `quality-check.js` (tsc --noEmit en modo WARN, nunca bloquea), `parry-patterns.toml` (firmas de secretos/inyección — `sk_live_`, `gsk_`, JWT, frases de prompt-injection). El motor `parry` (ML) está documentado pero NO instalado (incompatible con Windows → necesitaría WSL2).

### 2.7 Qué es portable a `world_wide_project`

| Pieza | Portabilidad | Acción |
|---|---|---|
| Esqueleto PM + especialistas + doble puerta | **Total, agnóstico de dominio** | Copiar estructura, cambiar dominio |
| Guardarraíles (Auto-Fix/STOP, 3-intentos, 5-reads, auto-verif) | **Copy-paste** | Pegar en cada implementador |
| Tiering de modelos (opus orquesta/check, sonnet implementa/verifica, haiku crawl/docs) | **Total** | Reutilizar como estrategia de coste |
| Puertas read-only (sin Write/Edit + bypassPermissions) | **Total** | Reutilizar `plan-checker`/`verifier` casi tal cual |
| Blackboard de ficheros (comms/DECISIONS/ROADMAP/MEMORY) | **Total** | Reutilizar convención (no los nombres exactos) |
| Fresh-Context Delegation + RPI | **Total** | Reutilizar como política |
| Skills superpowers | **Total** | Copiar carpeta de skills genéricas |
| Skills de dominio TaxIA (IRPF/Stripe/Turso/Railway) | **No** (solo patrón) | Crear nuevas skills de dominio mundo |
| Agentes específicos TaxIA (`competitive-intel`, `doc-crawler`) | **Reescribir** | → ver sección 7 (nuevos agentes de dominio) |
| Carpetas vendored claude-flow (`swarm/`, `sparc/`, `v3/`…) | **Ignorar** | Boilerplate sin uso real; no portar |

**Por qué es bueno:** el sistema convierte el problema "Claude alucina/se desvía/dice hecho sin verificar" en un proceso con puertas mecánicas. Las puertas son agentes con contexto fresco e independiente que no confían en las afirmaciones del implementador. El blackboard de ficheros sobrevive a la compactación. El tiering de modelos controla coste. Todo eso aplica idéntico a construir una plataforma de inteligencia mundial.

---

## 3. osiris — análisis

**Repo:** `Nambu89/osiris` (fork de `simplifaisoul/osiris`), branch `master`, imagen Docker `ghcr.io/aiacos/osiris`. **Licencia: MIT.**

### 3.1 Propósito

OSIRIS ("Open Source Intelligence & Reconnaissance Integrated System") es un dashboard de inteligencia mundial en tiempo real. Agrega feeds públicos (vuelos, barcos, terremotos, incendios, clima, conflictos/protestas, CCTV, ciber, mercados, sanciones, noticias 24/7) sobre un mapa mundial MapLibre acelerado por GPU, con una capa de "daily intelligence briefing" generada por IA. **Es una referencia casi ideal** porque ya fusiona riesgo geopolítico (GDELT, country-risk, sanciones), financiero (defensa, petróleo, commodities, cripto, horarios de bolsas, alertas de supply-chain marítimo) y síntesis IA narrativa.

### 3.2 Stack

Next.js 16 (App Router + Turbopack), React 19, TypeScript 5, **MapLibre GL JS 5** + react-map-gl, Framer Motion, Tailwind 4, **@google/generative-ai (Gemini gemini-2.0-flash)**, rss-parser, ws (AIS), hls.js (CCTV), react-force-graph-2d (grafo de entidades), satellite.js, sharp. Microservicio Express opcional `intel/server.js` para RECON activo. Deploy: Vercel Edge + Docker (Node 22-Alpine, ~220MB).

### 3.3 Arquitectura (3 tiers)

1. **CLIENTE** — `src/app/page.tsx` es el orquestador. Motor de polling por prioridad y por capa: `dataRef.current` mutable acumula cada feed, `setDataVersion` dispara redraws SIN re-render por fetch, `layerFetchedRef` (Set) deduplica para fetchear cada endpoint una sola vez. Intervalos por volatilidad: barcos 10s, vuelos/radiación 5min, terremotos/mercados 15min, noticias 30min. Solo fetchea si la capa está activa (~75% menos requests).
2. **MAPA** — `src/components/OsirisMap.tsx`. Patrón: todas las fuentes se crean como GeoJSON vacíos en `map.on('load')`, cada tipo de dato tiene su `useEffect` que transforma `data` → features → `setData()`. Visibilidad por `activeLayers` vía `setLayoutProperty`. ~16 capas de usuario → ~40 layer ids internos (tríos glow/dots/label).
3. **API** — ~50 route handlers `src/app/api/*/route.ts`, **uno por fuente**. Patrón estándar: `fetch()` con User-Agent custom + `AbortSignal.timeout(8000)`, fallbacks multinivel (Yahoo v8→v6→estático), retorno vacío gracioso ante fallo, cache headers (`s-maxage` + `stale-while-revalidate`). La IA: `src/lib/ai-engine.ts` + `/api/ai/briefing` — `serializeContext()` compacta un `IntelligenceContext` en un prompt para Gemini con persona "elite intelligence analyst" → briefing estructurado (Executive Summary, PIRs, Compound Risk Scenarios). Libs transversales: `sanctions.ts` (cache OFAC in-memory single-flight + refresh 24h + serve-stale), `ssrf-guard.ts`, `stealthFetch.ts`.

### 3.4 Mejores partes reutilizables

- **Patrón de route-normalization** (`src/app/api/*/route.ts`): fetch + timeout(8000) + fallback multinivel + retorno vacío + cache headers. *Añadir una fuente = añadir un fichero aislado.* **Dificultad: baja.**
- **Conector de mercados** (`/api/markets`): Yahoo Finance + CoinGecko, **sin keys**, devuelve `{stocks,oil,commodities,crypto,indices,scm_alerts}`. Directo para FINANZAS.
- **Conector GDELT** (`/api/gdelt`): eventos geopolíticos geocodificados y categorizados (unrest/conflict/political), sin keys. Directo para POLÍTICA.
- **country-risk** (`/api/country-risk`): tabla de ~19 países (base 35-90) + boost por terremotos USGS live + horarios de 12 bolsas. Puente POLÍTICA↔FINANZAS.
- **Motor IA** (`ai-engine.ts`): `serializeContext` + persona + plantilla + rotación de 8 keys + rate-limit. **Re-apuntable a Claude/Ollama** fácilmente.
- **News** (`/api/news`): RSS + scraping Telegram con risk-scoring por keywords + geocoding por mapa estático.
- **sanctions.ts**: loader resiliente in-memory-cache-single-flight-stale-fallback. Reutilizable para cualquier dataset de referencia grande.
- **Orquestador de polling** (`page.tsx`) y **shell MapLibre** (`OsirisMap.tsx`).

### 3.5 Fuentes de datos

GDELT 2.0 (keyless), Yahoo Finance (keyless), CoinGecko (keyless), USGS earthquakes (keyless), NASA FIRMS (key), NASA EONET (keyless), OpenSky (OAuth2), aisstream.io (key), N2YO (key), OpenSanctions OFAC SDN (CC-BY), NVD/CVE, Shodan (key), ip-api.com (keyless), blockstream/Blockscout (keyless), Cloudflare Radar, RSS (BBC/AlJazeera/GDACS), Telegram web previews (scraped), CCTV nacionales, Gemini.

### 3.6 Licencia MIT — implicaciones

Máximamente permisiva: copiar, modificar, fusionar libremente en proyecto personal/comercial; única obligación es retener el aviso MIT en copias del código que **redistribuyas**. Para uso personal no distribuido, fricción cero. **Caveat:** MIT cubre el código, NO los datos — cada fuente mantiene sus ToS (Yahoo/CoinGecko/Telegram son ToS-gris y endpoints no documentados, frágiles para redistribución).

### 3.7 Debilidades

- Capas de mapa definidas **imperativamente y dispersas** en `map.on('load')` — sin registro central; refactorizar a config array antes de reusar pesado.
- Conectores dependen de endpoints no documentados/scraping (Yahoo v8/v6, Telegram) que rompen en silencio; catch silenciosos ocultan fallos.
- Geocoding y risk-scoring **naive** (lookup hardcodeado, keyword list fija +2/cap 10, anglocéntrico).
- country-risk es heurística estática (19 países, solo USGS live) — no es un modelo real.
- `/api/markets` con `no-store` + fetches síncronos multi-fuente → caro y rate-limit-prone a escala.
- IA cableada a Gemini (cambiar a Claude requiere reescribir `ai-engine.ts`, aunque el patrón transfiere limpio).
- Fanout pesado en cliente: `page.tsx` pollea ~14+ endpoints desde el navegador; la frescura depende de la pestaña abierta, no de un scheduler servidor.
- **Sin capa de persistencia/histórico** — todo es live in-memory; sin time-series no hay análisis de tendencias ni backtesting.
- RECON activo (port scans, Express `intel`) añade superficie legal/seguridad irrelevante — **omitir entero**.

---

## 4. worldmonitor — análisis

**Repo:** `Nambu89/worldmonitor`. **Licencia: AGPL-3.0-only** (copyleft fuerte con cláusula de uso en red; ofrecen licencia comercial separada).

### 4.1 Propósito

Dashboard de inteligencia mundial que agrega **500+ feeds curados** en 15 categorías + **65+ proveedores externos**, los sintetiza con IA en briefings, y los muestra en motores duales globo-3D/mapa-WebGL. Computa un **Country Intelligence Index (CII)** por país, detecta **convergencia cross-stream** (señales militares + económicas + desastre + escalada) y corre un radar financiero. Se distribuye como SPA web y apps **Tauri 2** de escritorio, con **6 variantes de sitio** (general, tech, finance, commodity, positive-news, energy) desde un solo codebase. Diseñado para correr con **cero keys obligatorias** usando datos públicos + IA local (**Ollama**). Alineadísimo con nuestro objetivo.

### 4.2 Stack

TypeScript vanilla (sin framework), Vite, **Three.js + globe.gl** (globo 3D), **deck.gl + MapLibre** (mapa plano, 56 tipos de capa), **Web Workers + Transformers.js/@xenova** (ONNX in-browser: embeddings, sentiment, NER), **Vercel Edge Functions** (60+ endpoints), relay Node.js (Railway, WS/AIS + seed loops), **Upstash Redis** (cache + rate-limit), Convex (forms), **Protocol Buffers** (276 schemas/34 servicios), **Tauri 2** (desktop + sidecar Node), Docker/supervisord, Biome, Playwright. LLM: **Ollama (local), Groq, OpenRouter, OpenAI-compatible; Anthropic para i18n/forecast**.

### 4.3 Arquitectura (4 capas)

1. **SPA browser** (`src/`): managers de orquestación, 86 subclases Panel + DeckGLMap/GlobeMap, config de variantes/paneles/capas, locales (24 idiomas incl. RTL), services, workers. **Sin librería de estado** — un único `AppContext` mutable; URL state bidireccional (`urlState.ts`, debounce 250ms). El sistema de variantes detecta hostname (`finance.worldmonitor.app`) para cambiar paneles/capas/intervalos/tema.
2. **Edge/API** (`api/`, `server/`): gateway factory (`server/gateway.ts`) con pipeline origin-check → CORS → API-key (orígenes browser exentos) → rate-limit sliding-window Upstash → route match → handler → ETag FNV-1a/304 → cache headers. Handlers en `server/worldmonitor/<domain>/v1/handler.ts` con `cachedFetchJson()` (coalescing).
3. **Ingesta**: `scripts/seed-*.mjs` fetchean upstream y `atomicPublish()` a Redis; un relay AIS Railway (`scripts/ais-relay.cjs`) corre loops continuos (market, aviation, positive-events, GPSJAM, **CII risk scores**, UCDP). El frontend hidrata vía `/api/bootstrap` (single batched Redis read) + smart-poll (backoff exponencial 4x, viewport-conditional, pausa con pestaña oculta).
4. **Desktop**: shell Tauri + sidecar Node (`local-api-server.mjs`) que carga los mismos handlers Edge, inyecta secretos del **keyring del SO**, fuerza IPv4; `installRuntimeFetchPatch()` redirige `/api/*` al sidecar con bearer de 5min, fallback al cloud. Caché de **4 capas** (bootstrap seed → in-memory → Upstash → upstream) con **6 niveles TTL** (fast 300s, medium 600s, slow 1800s, static 7200s, daily 86400s, no-store). Además ship un **servidor MCP** (`api/mcp/`) que expone la inteligencia como tools/resources a agentes LLM.

### 4.4 Mejores partes reutilizables

- **Metodología CII** (`server/worldmonitor/intelligence/v1/get-risk-scores.ts` + `shared/cii-weights.ts`): pesos documentados (event blend 0.25/0.30/0.20/0.25, composite = baseline·0.4 + event·0.6), normalización por señal, floors, time-decay ACLED. **Re-implementar las fórmulas** como capa de riesgo núcleo.
- **Router LLM multi-proveedor local-first** (`server/_shared/llm.ts`): `PROVIDER_CHAIN ['ollama','groq','openrouter','generic']`, health-gating, fall-through por key ausente, streaming + stripping de thinking-tags. **Ideal para síntesis IA privada y barata.**
- **Briefing "why it matters"** (`api/internal/brief-why-matters.ts`): ensamblado de contexto grounded, gating por política de categoría, hardening anti-prompt-injection, sampling determinista, cache 6h.
- Catálogo de **500+ RSS en 15 categorías** + **rss-proxy SSRF-safe con allowlist de dominios**.
- **Clustering de noticias cliente** (Jaccard) + ML ONNX in-browser (Transformers.js Web Workers) — coste servidor cero, privacy-preserving.
- **Taxonomía de señales cross-source** (`list-cross-source-signals.ts`): 21 tipos de convergencia agrupados por teatro/severidad. Esquema de la capa de correlación.
- **Radar de mercado** (`server/worldmonitor/market/v1/handler.ts`): Fear & Greed, COT, breadth, multi-asset, stablecoin peg.
- **Sistema de variantes** (`src/config/`) para vistas finanzas/política/educación desde un codebase.
- **Blueprint zero-config + Docker + Ollama** (`SELF_HOSTING.md`).
- **Caché 4-tier + request-coalescing** (`cachedFetchJson`, 6 TTL, bootstrap).
- Opcional: **servidor MCP** como referencia para exponer datos conversacionalmente a un asistente.

### 4.5 Fuentes de datos

Noticias (500+ RSS, Telegram MTProto, Reddit, GDELT, Brave, Exa, Firecrawl, ReliefWeb); conflicto (**ACLED, UCDP**, GDELT); finanzas (**Finnhub, Alpha Vantage**, Yahoo, **CoinGecko sin auth**, **Polymarket**); económico (**FRED, IMF SDMX, UN Comtrade, WTO**); energía (**EIA, GIE AGSI+, ENTSO-E**); aviación (OpenSky, AviationStack, ICAO, GPSJAM); marítimo (AISStream, CorridorRisk, Hormuz); clima (NASA FIRMS, OpenAQ/WAQI, sismología); ciber (AbuseIPDB, AlienVault OTX, URLhaus, Cloudflare Radar); humanitario (UNHCR); militar (PIZZINT/Supabase); LLM (Ollama/Groq/OpenRouter/Anthropic + Transformers.js).

### 4.6 Licencia AGPL-3.0 — implicaciones

El copyleft más fuerte. Para nuestro caso:
1. **Uso personal privado** (tu instancia, para ti, modificada, sin distribución ni servicio en red público) → **cero obligaciones**. Fork/modifica/usa libremente. **Este es el modo seguro y es exactamente nuestro caso.**
2. **Cláusula de red (§13) = la trampa**: en cuanto dejes que OTROS interactúen con tu instancia por red (web pública, amigos), DEBES ofrecerles el código fuente completo modificado bajo AGPL-3.0.
3. **Reusar CÓDIGO worldmonitor** (algoritmo CII, router LLM, listas de feeds) dentro de tu app la convierte en obra derivada que debe ser AGPL si la distribuyes o la expones por red. El copyleft es viral y no combina con código propietario en el mismo programa.
4. **Estrategias seguras si algún día la compartes**: (a) **re-implementar la METODOLOGÍA** (pesos/fórmulas están documentados; ideas/algoritmos no son copyrightables) en lugar de copiar fuente; (b) mantener el componente derivado de worldmonitor como servicio AGPL separado tras frontera de proceso/red; (c) comprar la licencia comercial.
5. Muchas fuentes tienen ToS propios (ACLED, UCDP, Finnhub, Reddit "pre-policy script apps only", Telegram) independientes de la AGPL.

> **Decisión recomendada (registrar como ADR):** para el cerebro (CII, correlación, router LLM) **re-implementar la metodología** leyendo `ARCHITECTURE.md` + código como referencia, NO copiar ficheros AGPL. Así nuestro código queda limpio y libre incluso si más adelante lo compartimos.

### 4.7 Debilidades

- **AGPL** limita severamente la reutilización si expones por red o construyes producto propietario (ver arriba).
- **Complejidad operativa** brutal para uno solo: Vercel Edge + Railway relay + Upstash + Convex + Cloudflare R2 + 276 protos/34 servicios + sidecar Tauri. El feature set completo asume topología multi-servicio cloud — overkill personal.
- Muchas features flagship **dependen de keys** (Finnhub, FRED, EIA, ACLED, AISStream, NASA FIRMS). Sin ellas muestran "credentials required" en vez de degradar — la experiencia zero-key es más delgada que lo marketeado.
- La lógica de **convergencia cross-stream** real (algoritmo, ventanas temporales, matching geográfico, scoring) **NO está en el handler servido** — corre en un seed loop Railway y está parcialmente documentada; reproducirla requiere reverse-engineering de los seed scripts.
- El "seven-signal market composite" vive en módulo no capturado; el market handler es capa fina de composición.
- Acoplamiento a vendors (Upstash, Convex, Clerk, Dodo, Sentry) tejido por toda la API.
- Stubs proto generados (`src/generated/`, DO NOT EDIT) hacen el contrato rígido; reusar un handler arrastra el toolchain proto.
- SPA vanilla con `AppContext` mutable + 86 Panel subclasses = bespoke, indocumentado como framework reutilizable. **La capa frontend es la menos reusable.**
- Pesos CII son "editoriales"/subjetivos; el README revela 3 vulnerabilidades de seguridad y no da benchmarks.

---

## 5. osiris vs worldmonitor

### 5.1 Tabla comparativa

| Dimensión | osiris | worldmonitor | Veredicto |
|---|---|---|---|
| **Licencia** | MIT (permisiva) | **AGPL-3.0** (viral en red) | osiris para copiar código; worldmonitor solo metodología |
| **Stack frontend** | Next.js 16 + React 19 (moderno, framework) | TS vanilla + 86 Panels (bespoke) | osiris más mantenible para solo-dev |
| **Mapa** | MapLibre (1 motor, capas imperativas) | globo 3D (Three/globe.gl) + deck.gl (56 capas) | worldmonitor más rico; osiris más simple |
| **Conectores** | ~50 routes **aislados, 1 fichero/fuente, sin keys** | 65+ proveedores, muchos **requieren keys** | **osiris**: ingesta más limpia y zero-key |
| **Robustez ingesta** | timeout + fallback + retorno vacío + cache headers | caché 4-tier + coalescing + bootstrap | Empate (patrones distintos, ambos buenos) |
| **Síntesis IA** | Gemini cableado, 1 plantilla briefing | **router multi-proveedor local-first** + brief grounded | **worldmonitor** (Ollama/Groq/Claude, privado) |
| **Scoring de riesgo** | country-risk heurístico (19 países) | **CII con pesos documentados + time-decay** | **worldmonitor** (metodología real) |
| **Correlación** | grafo de entidades simple | **taxonomía 21 señales convergencia** | **worldmonitor** (aunque el motor real no está servido) |
| **Radar financiero** | markets keyless básico | **multi-señal** (F&G, COT, breadth, peg) | worldmonitor más profundo; osiris más fácil de arrancar |
| **Histórico/persistencia** | ninguno | ninguno (todo live/Redis-cache) | **Ambos fallan** → lo añadimos nosotros |
| **Auto-hospedaje** | Docker + Vercel | **Docker + Ollama zero-config + Tauri desktop** | **worldmonitor** (blueprint privado) |
| **Complejidad operativa** | Media (1 app Next + microservicio opcional) | **Muy alta** (multi-servicio cloud) | osiris más asumible para uno |
| **OSINT/RECON** | rico (dns/whois/cve/sanciones/ip) | ciber (AbuseIPDB/OTX/URLhaus) | osiris para conectores OSINT puntuales (RECON activo: omitir) |

### 5.2 Recomendación: **base = metodología de worldmonitor, cosecha de código = osiris**

**Usar worldmonitor como la referencia de diseño del CEREBRO** (síntesis IA + correlación + risk scoring) pero **re-implementando la metodología** (limpio de AGPL), y **cosechar osiris para el cuerpo** (conectores aislados zero-key + UX de mapa MapLibre + patrón de polling).

**Justificación:**
1. **Donde worldmonitor es superior es justo lo que NO conviene copiar literal** (AGPL): CII, router LLM, taxonomía de convergencia. La buena noticia es que esas son *ideas y fórmulas documentadas* — re-implementarlas es legalmente limpio y técnicamente directo. Su valor es el *diseño*, no las 50.000 líneas de plomería multi-servicio que no queremos.
2. **Donde osiris es superior es justo lo que SÍ conviene copiar literal** (MIT): conectores `route.ts` de un fichero, sin keys, con timeout/fallback/cache; el orquestador de polling; el shell MapLibre. Copy-paste sin fricción legal.
3. **Complejidad operativa:** el stack completo de worldmonitor (Vercel Edge + Railway + Upstash + Convex + R2 + 276 protos + Tauri) es inviable de mantener para una persona. El de osiris (un Next + microservicio opcional) es asumible. Tomamos el *patrón* de caché 4-tier y bootstrap de worldmonitor sin su topología.
4. **El frontend de worldmonitor (vanilla + 86 Panels) es el menos reusable**; el de osiris (React moderno) es más sano como punto de partida — o partimos de Vite+React limpio.
5. **Ambos carecen de histórico** — añadimos persistencia SQLite/Turso como diferencial propio (clave para decisiones financieras: tendencias y backtesting).

> En una frase: **worldmonitor nos da el plano del cerebro; osiris nos da los músculos y la cara; nosotros añadimos la memoria (histórico) y la fábrica (TaxIA dev-system).**

---

## 6. Arquitectura propuesta: plataforma personal de decisiones

Organizada por **DOMINIOS DE DECISIÓN**, no por fuente técnica. Cada dominio tiene: fuentes → capa de normalización → capa de scoring/señales → síntesis IA → UI.

### 6.1 Principios de diseño

- **Connector-first, zero-key por defecto.** Patrón osiris `route.ts`: 1 fichero por fuente, timeout(8000) + fallback + retorno vacío + cache. Fuentes sin key primero; keys opcionales degradan, no rompen. **Regla de selección de fuentes:** preferir endpoints documentados y keyless; tratar endpoints scrapeados/no-documentados (Yahoo v8/v6, Telegram t.me/s) como degradables, aislados y marcados como frágiles.
- **Server-side scheduler + persistencia histórica.** Corregimos el fallo común: un scheduler Node (no el navegador) hace polling por volatilidad y persiste snapshots en **SQLite/Turso** (time-series). La UI lee de la DB local, no de upstream. Esto desacopla frescura de la pestaña abierta y habilita tendencias/backtesting.
- **Local-first AI.** Router LLM estilo worldmonitor: **Ollama por defecto** (privacidad + coste cero), **Groq** (rápido/barato para volumen), **Claude** (síntesis de alta calidad para el briefing diario), OpenAI-compatible genérico. Health-gating + fall-through.
- **Capa de scoring propia.** CII re-implementado + taxonomía de señales de convergencia como esquema propio.
- **Una UI, vistas por dominio.** Sistema de variantes estilo worldmonitor (Finanzas/Educación/Política) sobre un mapa MapLibre + paneles + brief diario.

### 6.2 Dominio FINANZAS

| Capa | Contenido |
|---|---|
| **Fuentes** | osiris `/api/markets` (Yahoo + CoinGecko, keyless) · worldmonitor market set (CoinGecko sin auth, Polymarket, Fear&Greed) · FRED (macro, key) · EIA/ENTSO-E (energía, key opcional) · OpenSanctions OFAC (`sanctions.ts`, CC-BY) para due-diligence |
| **Normalización** | route.ts por fuente → shape común `{symbol, price, change_pct, up, ts}`; snapshots a Turso |
| **Señales/Scoring** | Radar multi-señal (Fear&Greed, breadth, peg de stablecoins, COT si hay key) → **índice de régimen de mercado**; alertas de supply-chain marítimo (chokepoints) cruzadas con geopolítica |
| **Síntesis IA** | "Brief financiero diario": qué se movió, por qué (cruzando con eventos geopolíticos), qué vigilar — grounded, anti-injection, cache 6h |
| **Histórico** | Time-series Turso → gráficos de tendencia + comparativas (diferencial vs ambos repos) |

### 6.3 Dominio EDUCACIÓN / ESTUDIOS

| Capa | Contenido |
|---|---|
| **Fuentes** | Catálogo RSS curado estilo worldmonitor (ciencia, tech, economía) vía **rss-proxy SSRF-safe con allowlist** · GDELT topic timelines · feeds académicos/divulgación · NASA EONET/clima (contexto STEM) |
| **Normalización** | rss-parser + clustering Jaccard (dedup de noticias) cliente |
| **Señales/Scoring** | Clustering temático + **ML ONNX in-browser** (Transformers.js: embeddings/sentiment/NER) para agrupar y resumir sin coste servidor; ranking por relevancia/novedad |
| **Síntesis IA** | "Resumen de aprendizaje diario": temas emergentes, explicación "why it matters", lecturas recomendadas — persona tutor/analista |
| **Histórico** | Turso → seguimiento de temas a lo largo del tiempo, "qué he ido viendo sobre X" |

### 6.4 Dominio POLÍTICA / GEOPOLÍTICA

| Capa | Contenido |
|---|---|
| **Fuentes** | osiris `/api/gdelt` (eventos geocodificados, keyless) · ACLED/UCDP (conflicto, key) · osiris `/api/country-risk` · news con risk-scoring · Polymarket (prediction markets) · OpenSanctions |
| **Normalización** | route.ts por fuente → eventos geocodificados `{type, lat, lon, severity, ts}` |
| **Señales/Scoring** | **CII re-implementado** (composite = baseline·0.4 + event·0.6, time-decay) por país · **detector de convergencia** (taxonomía de ~21 señales: militar+económico+desastre+escalada en mismo teatro/ventana temporal) — esto es el motor que worldmonitor no sirve, lo construimos nosotros |
| **Síntesis IA** | "Briefing geopolítico diario" estilo osiris (Executive Summary + PIRs + Compound Risk Scenarios) — re-apuntado a Claude/Ollama |
| **Histórico** | Turso → evolución del CII por país, líneas temporales de eventos |

### 6.5 Capa transversal de correlación (el diferencial)

Sobre los tres dominios, un **motor de convergencia cross-domain**: detecta cuándo señales financieras + geopolíticas + de desastre coinciden geográfica y temporalmente (ej.: conflicto en chokepoint marítimo + subida de Brent + alerta supply-chain). Esquema = taxonomía de señales de worldmonitor; lógica = la construimos nosotros (la suya no está servida). Salida: **"decision signals"** rankeadas que alimentan el briefing diario unificado. **⚠️ Pieza más difícil y menos especificada del plan — ver §9.1; tratar como spike de investigación, no como tarea rutinaria.**

### 6.6 Stack tecnológico recomendado

| Capa | Elección | Razón |
|---|---|---|
| **Lenguaje** | TypeScript | Ambos repos; ecosistema connectors/map |
| **Build** | **Vite** | Ligero, ambos lo usan; sin el peso de Next salvo que queramos SSR |
| **Frontend** | **React 18/19 + Vite** | Más sano que vanilla+86Panels; reutiliza patrones osiris |
| **Mapa** | **MapLibre GL** (de osiris) + opcional globe.gl después | Empezar simple (MapLibre), refactorizar a **config-array de capas** desde el día 1 (corrige debilidad osiris) |
| **Backend connectors** | **Node + route handlers** (patrón osiris) corriendo como **servidor único** | Evita la topología multi-servicio de worldmonitor |
| **Scheduler** | Cron/loop Node server-side | Corrige el fanout-en-navegador; frescura desacoplada de la pestaña |
| **Persistencia** | **Turso/libSQL (SQLite)** | Histórico time-series + FTS5; el diferencial; conocido de TaxIA |
| **Caché** | In-memory + opcional Redis local | Patrón 4-tier de worldmonitor simplificado |
| **IA** | **Router local-first: Ollama → Groq → Claude** | Privacidad/coste por defecto; Claude para briefing de calidad |
| **ML cliente** | Transformers.js ONNX (Web Workers) | Clustering/sentiment sin coste servidor |
| **Desktop (fase tardía)** | Tauri 2 | Si se quiere app nativa privada |
| **Tests** | Playwright (E2E) + node:test + CI GitHub Actions | Reutiliza skill `playwright-testing` de TaxIA; ver §9.5 |

### 6.7 Layout de monorepo modular

```
world_wide_project/
├── CLAUDE.md                      # raíz: arquitectura, convenciones, quality gates
├── agent-comms.md                 # blackboard inter-agente (de TaxIA)
├── claude-progress.txt
├── plans/
│   ├── ROADMAP.md
│   └── DECISIONS.md               # ADR log (lint de IDs únicos)
├── memory/
│   ├── MEMORY.md                  # índice
│   └── feedback_*.md              # anti-patrones permanentes
├── .claude/
│   ├── agents/                    # PM + especialistas (de TaxIA, adaptados)
│   ├── commands/                  # /pm /check-plan /verify /qa /prime /sync ...
│   ├── skills/                    # superpowers + nuevas skills de dominio
│   └── settings.json / .local.json
├── packages/
│   ├── connectors/                # patrón osiris route.ts, 1 fichero/fuente
│   │   ├── finance/  (markets, fred, eia, sanctions)
│   │   ├── geo/      (gdelt, acled, country-risk, news)
│   │   └── edu/      (rss-proxy, topics)
│   ├── core/                      # scoring (CII), convergencia, normalización
│   │   ├── cii/                   # re-implementado (limpio de AGPL)
│   │   ├── signals/               # taxonomía de convergencia
│   │   └── ai/                    # router LLM local-first + serializeContext + personas
│   ├── store/                     # Turso schema, seeds, time-series queries
│   ├── scheduler/                 # cron server-side por volatilidad
│   └── web/                       # Vite+React, MapLibre (config-array), paneles, variantes
└── server.ts                      # backend único (connectors + scheduler + api)
```

### 6.8 Local-AI vs API — coste/privacidad

- **Ollama (local)** — **por defecto** para todo lo de alto volumen y privado: clustering, sentiment, resúmenes cortos, NER. Coste cero, datos no salen de tu máquina. Modelos tipo Llama/Qwen locales bastan para resumir y clasificar. **⚠️ Restricción Windows: ver §9.2** (Ollama nativo Windows OK; Tauri/ONNX-build pueden requerir toolchain/WSL2).
- **Groq** — para cuando Ollama va lento o quieres throughput (inferencia barata y rápida) en tareas de volumen.
- **Claude (Anthropic)** — para el **briefing diario de alta calidad** y razonamiento de convergencia complejo (1-2 llamadas/día, coste acotado). Aquí el patrón `serializeContext` + persona + plantilla rinde. *(Coste estimado, no verificado — validar precios reales; ver §9.4.)*
- **Patrón de router** (de worldmonitor): `PROVIDER_CHAIN` con health-gating y fall-through por key ausente. Configurable por tarea: `summarize → ollama`, `daily-brief → claude`, `bulk-classify → groq`. *(Nota: el chain original de worldmonitor es `['ollama','groq','openrouter','generic']`; Claude lo usaban aparte para i18n/forecast. Meter Claude en el chain es diseño NUESTRO, no copiado.)*

---

## 7. Cómo construirla con el sistema multi-agente de TaxIA

El repo destino está **vacío** (sin commits). Eso es ideal: sembramos el andamiaje TaxIA antes de escribir una línea de producto.

### 7.1 Roster de agentes para este proyecto

Copiar de TaxIA y adaptar (cambiar dominio, conservar guardarraíles + frontmatter):

| Agente | Origen TaxIA | Adaptación para world_wide_project |
|---|---|---|
| **pm-coordinator** (`/pm`, opus) | tal cual | Cambiar contexto de dominio; conserva RPI, gates, anti-paralisis |
| **plan-checker** (`/check-plan`, opus, read-only) | **tal cual** | Sin cambios (agnóstico) |
| **verifier** (`/verify`, sonnet, read-only) | **tal cual** | Cambiar comandos de verificación al stack nuevo (vite build, node:test) |
| **backend-architect** (`/backend`, sonnet) | adaptar | "Node connectors + scheduler + Turso" en vez de FastAPI |
| **frontend-dev** (`/frontend`, sonnet) | adaptar | "Vite+React+MapLibre" |
| **qa-tester** (`/qa`, sonnet+Playwright) | tal cual | Reutiliza skill `playwright-testing` |
| **data-connector-dev** (NUEVO, sonnet) | — | Especialista en escribir/mantener `route.ts` por fuente (patrón osiris): timeout/fallback/cache; sustituye a `doc-crawler` |
| **intel-analyst** (NUEVO, sonnet) | basado en `competitive-intel` | Diseña CII/señales/personas de briefing; conoce GDELT/ACLED/mercados |
| **python-pro** | opcional | Solo si algún connector/ML va en Python |

Mantener el **tiering**: opus para `/pm` y `/check-plan`; sonnet para implementación y `/verify`; haiku para tareas de alto volumen y bajo razonamiento (auditoría de docs).

### 7.2 Sembrado del repo (paso 0, antes de RPI)

Crear con el PM (o a mano) los ficheros del blackboard:
1. **`CLAUDE.md`** raíz: arquitectura por dominios (sección 6), convenciones (zero-key first, server-side scheduler, Turso histórico), **Quality Gates (OBLIGATORIO)** (no presentar plan sin `plan-checker=PASS`; no reportar completado sin `verifier=VERIFIED`), Post-Bugfix Protocol (triple doc).
2. **`plans/ROADMAP.md`**: backlog por fases (sección 8), Alta/Media/Baja.
3. **`plans/DECISIONS.md`**: ADR-001 = "Base worldmonitor (metodología) + cosecha osiris (código MIT)"; ADR-002 = "Re-implementar CII en vez de copiar fuente AGPL"; ADR-003 = "Stack Vite+React+MapLibre+Turso+router LLM local-first"; ADR-004 = "Server-side scheduler + persistencia histórica". *(Lint de IDs únicos para no repetir el bug ADR-007 de TaxIA.)*
4. **`agent-comms.md`**: cabecera + vocabulario de estado (DONE/IN_PROGRESS/BLOCKED/NEEDS_REVIEW).
5. **`memory/MEMORY.md`** + `feedback_*.md` iniciales: `feedback_zero_key_first.md`, `feedback_no_agpl_copy.md` (nunca copiar fuente AGPL de worldmonitor; solo metodología), `feedback_data_tos.md` (respetar ToS de cada fuente), `feedback_central_layer_config.md` (capas de mapa en config-array, no imperativas).
6. **`.claude/agents/`** + **`.claude/commands/`**: copiar de TaxIA los agnósticos y los adaptados; copiar skills superpowers. **Voltear `bash-gate.js` a default-deny** + convención `.env`/secretos (ver §9.3).

### 7.3 El ciclo RPI aplicado a la construcción

Por cada feature (ej.: "conector de mercados", "motor CII", "briefing geopolítico"):

1. **Research** — `/pm` investiga la fuente/lib (skill `project-research`), revisa el `route.ts` equivalente de osiris o la metodología de worldmonitor como referencia, registra un ADR si hay decisión.
2. **Plan** — `/pm` escribe un plan con brief mínimo (Fresh-Context: máx 5 ficheros, patrón a seguir, restricciones, resultado esperado).
3. **Check** — `/check-plan` audita en 5 dimensiones → loop hasta `PASS`. Solo entonces el PM presenta el plan al usuario.
4. **Implement** — el PM delega vía `Task` al especialista (`data-connector-dev` para conectores, `backend-architect` para scheduler/Turso, `frontend-dev` para mapa/paneles, `intel-analyst` para CII/señales). El implementador respeta sus guardarraíles (Auto-Fix/STOP, 3-intentos, 5-reads, auto-verif).
5. **Verify** — `/verify` (goal-backward) confirma artefactos no-stub + wiring (connector registrado en `server.ts`, capa en config-array, query Turso, panel importado) + tests pasan + docs/memoria actualizadas → loop hasta `VERIFIED`. Luego `/qa` (Playwright) para UX. Solo entonces el PM reporta "completado" y loguea a `agent-comms.md`.

Comandos de sesión: `/start` (entorno) al inicio del proyecto; `/prime` (contexto ligero) cada día y antes de delegar; `/sync` si corres varios Claude en paralelo; `/commit` + `/review` + `/test` antes de cerrar.

### 7.4 Paralelización segura

Los conectores son **independientes** (un fichero cada uno, sin estado compartido) → caso ideal para la skill `dispatching-parallel-agents` y `git-worktree-isolation`: lanzar varios `data-connector-dev` en worktrees `.worktrees/connector-<x>` simultáneos. El PM mantiene la lista de ficheros de alto conflicto (`server.ts` registro, config-array de capas, schema Turso) para serializar esos toques.

### 7.5 Plan por fases mapeado a agentes

- **Fase 0 (PM)**: sembrar blackboard + ADRs fundacionales + roster de agentes.
- **Fase 1 MVP (data-connector-dev + backend-architect + frontend-dev)**: 3 conectores keyless (markets, gdelt, news) + scheduler + Turso + mapa MapLibre con config-array + 1 panel. Gates: `/check-plan` → `/verify` → `/qa`.
- **Fase 2 Dominios (data-connector-dev + intel-analyst)**: completar Finanzas/Educación/Política; CII re-implementado; histórico.
- **Fase 3 Síntesis IA (intel-analyst + backend-architect)**: router LLM local-first + serializeContext + briefings por dominio + motor de convergencia.
- **Fase 4 Desktop (frontend-dev)**: empaquetado Tauri (opcional).

---

## 8. Roadmap por fases + próximos pasos

### Fase 0 — Fundación del andamiaje (sin código de producto)
1. Lanzar sesión **`/brainstorming`** (skill `superpowers:brainstorming`) para **fijar alcance del MVP**: cuántos dominios en v1, qué fuentes exactas, mapa vs solo dashboards, Ollama-only vs Claude para briefing. *(Esto es lo primero — no codear antes.)*
2. Sembrar `CLAUDE.md`, `ROADMAP.md`, `DECISIONS.md` (ADR-001..004), `agent-comms.md`, `memory/MEMORY.md` + `feedback_*.md`.
3. Copiar/adaptar agentes (`pm-coordinator`, `plan-checker`, `verifier`, `backend-architect`, `frontend-dev`, `qa-tester`) + crear `data-connector-dev` e `intel-analyst` + skills superpowers + commands. **Voltear `bash-gate.js` a default-deny** + convención de secretos.
4. `git init` ya hecho; primer commit del andamiaje (cuando el usuario lo pida). Añadir `.github/workflows/ci.yml` (ver §9.5).

### Fase 1 — MVP zero-key (1 servidor, 3 fuentes, persistencia, mapa)
5. Connectors keyless: `markets` (osiris), `gdelt` (osiris), `news` (RSS). Patrón route.ts + timeout/fallback/cache.
6. Scheduler server-side por volatilidad + schema Turso (time-series).
7. Mapa MapLibre con **config-array de capas** desde el día 1 + 1 panel + brief diario con **Ollama**.
8. Gates RPI completos en cada paso.

### Fase 2 — Dominios completos + scoring
9. Completar Finanzas (FRED/EIA/sanctions), Educación (rss-proxy SSRF-safe + clustering Jaccard + ONNX cliente), Política (ACLED/UCDP/country-risk).
10. **CII re-implementado** (limpio de AGPL) + histórico/tendencias.

### Fase 3 — Síntesis IA + correlación
11. **Router LLM local-first** (Ollama → Groq → Claude) con health-gating.
12. `serializeContext` + personas + plantillas de briefing por dominio (re-apuntadas a Claude/Ollama).
13. **Motor de convergencia cross-domain** (taxonomía de señales worldmonitor + lógica propia — la suya no está servida). **⚠️ Spike de investigación, no tarea rutinaria — ver §9.1.**

### Fase 4 — Pulido y desktop (opcional)
14. Sistema de variantes (Finanzas/Educación/Política).
15. Empaquetado Tauri 2 para app nativa privada.
16. Opcional: servidor MCP para consultar la inteligencia conversacionalmente desde un asistente. **⚠️ Si exponible por red + código derivado de worldmonitor detrás → AGPL §13; ver §9.6.**

### Aviso de licencias (recordatorio permanente — fijar en `feedback_no_agpl_copy.md`)
- **osiris = MIT**: copiar código libremente; retener aviso MIT si algún día redistribuyes.
- **worldmonitor = AGPL-3.0**: para uso personal privado **sin obligaciones**; **NO copiar fuente** dentro de tu app — **re-implementar metodología** (CII, router, señales). Si algún día expones por red a terceros, se activa §13 (abrir todo bajo AGPL) o frontera de proceso o licencia comercial.
- **Datos ≠ código**: respetar ToS de cada fuente (OpenSanctions CC-BY exige atribución; Yahoo/CoinGecko/Telegram son ToS-gris, OK personal, frágil redistribuido). Registrar en `feedback_data_tos.md`.

### Próximo paso inmediato
**Lanzar `/brainstorming` para cerrar el alcance del MVP antes de sembrar el repo.** Sin alcance fijado, el PM caería en su propia Guardia Anti-Paralisis. Tras el brainstorming: sembrar blackboard (Fase 0) y entrar al primer ciclo RPI con la Fase 1.

---

## 9. Riesgos y matices (revisión adversarial)

Puntos que un crítico adversarial marcó tras revisar el informe. No invalidan el plan; lo endurecen. Convertir cada uno en ADR o `feedback_*.md` al sembrar el repo.

### 9.1 El motor de convergencia es la pieza de mayor riesgo
La lógica real de convergencia cross-stream de worldmonitor (ventanas temporales, matching geográfico, scoring) **NO está en el handler servido** — corre en seed loops Railway y solo está parcialmente documentada. Igual ocurre con el "seven-signal market composite". Conclusión: construirlo desde cero es **lo más difícil y menos especificado** de todo el plan. Tratarlo como **spike de investigación dedicado** (con su propio Research → Plan → Check), NO como una línea de roadmap rutinaria. El radar financiero multi-señal tampoco es turnkey.

### 9.2 Restricción de entorno Windows (win32)
El hallazgo de hooks de TaxIA mostró que `parry` (seguridad ML) es **incompatible con Windows** (necesitaría WSL2). El mismo riesgo aplica a: **Ollama** local (el binario nativo Windows funciona, pero validar GPU/drivers), **Tauri 2** (toolchain Rust + WebView2) y **ONNX/Transformers.js** builds nativos. Antes de comprometer "Ollama-by-default" y "Tauri desktop", **verificar la toolchain nativa en este Windows** o decidir WSL2. Registrar como ADR de entorno.

### 9.3 Higiene de secretos para multi-fuente
TaxIA tuvo una fuga histórica: `settings.local.json` con secretos OAuth/passwords/PII embebidos en strings de comandos allowlisted, y `bash-gate.js` es **fail-open**. La nueva plataforma acumulará muchas keys (FRED, EIA, ACLED, AISStream, Finnhub, Gemini/Groq/Anthropic). Definir desde Fase 0: convención **`.env` + `.env.example`** (nunca commitear `.env`), `.gitignore` estricto, secretos fuera de strings de comandos, y `bash-gate.js` a **default-deny**. Registrar en `feedback_secrets.md`.

### 9.4 El modelo de coste LLM es estimación, no dato
"Coste cerca de cero" y "Claude 1-2 llamadas/día" son **supuestos de planificación razonables pero no verificados** (los hallazgos no contienen precios). Validar precios reales de Claude/Groq y medir consumo del briefing diario antes de tratarlos como hechos. Ver skill `claude-api` para ids/precios/params al implementar la capa IA.

### 9.5 Falta la capa CI (3ª máquina)
TaxIA usa `.github/workflows/ci.yml` con ~5 jobs paralelos (ruff/pytest/eslint/vite build/frontend test) con tolerancias documentadas — es parte integral del modelo de puertas en capas. El plan reusa `/qa` + Playwright + node:test pero **no propone CI**. Añadir `ci.yml` en Fase 0 (adaptado al stack TS: biome/eslint + vitest/node:test + vite build + playwright) para no quedarse solo en gates locales.

### 9.6 AGPL alcanza también al servidor MCP
Exponer la inteligencia agregada vía servidor MCP (Fase 4) es **exactamente "interacción por red"**: si hay código derivado de worldmonitor detrás, activa AGPL §13. La regla "re-implementar, no copiar" debe extenderse explícitamente al MCP y a cualquier endpoint accesible por terceros.

### 9.7 OSINT/RECON de osiris: relevancia limitada
Los conectores OSINT puntuales de osiris (sanciones, ip-geo) sí aportan a finanzas/política, pero el grueso de RECON activo (port scans, dns/whois/cve, microservicio Express `intel`) es **tangencial a decisiones financieras/educativas/políticas y de reuse-difficulty alto**: **omitir el RECON activo entero** (superficie legal/seguridad innecesaria). Conservar solo `sanctions.ts` y, si acaso, geolocalización IP.

---

### Ficheros de referencia clave (absolutos)

**Andamiaje TaxIA a portar:**
- `c:\Users\Fernando Prada\OneDrive - SVAN TRADING SL\Escritorio\Personal\Proyectos\TaxIA\.claude\agents\pm-coordinator.md`
- `c:\Users\Fernando Prada\OneDrive - SVAN TRADING SL\Escritorio\Personal\Proyectos\TaxIA\.claude\agents\plan-checker.md`
- `c:\Users\Fernando Prada\OneDrive - SVAN TRADING SL\Escritorio\Personal\Proyectos\TaxIA\.claude\agents\verifier.md`
- `c:\Users\Fernando Prada\OneDrive - SVAN TRADING SL\Escritorio\Personal\Proyectos\TaxIA\.claude\agents\backend-architect.md`
- `c:\Users\Fernando Prada\OneDrive - SVAN TRADING SL\Escritorio\Personal\Proyectos\TaxIA\.claude\agents\frontend-dev.md`
- `c:\Users\Fernando Prada\OneDrive - SVAN TRADING SL\Escritorio\Personal\Proyectos\TaxIA\.claude\commands\` (`prime.md`, `start.md`, `sync.md`, `check-plan.md`, `verify.md`, `qa.md`)
- `c:\Users\Fernando Prada\OneDrive - SVAN TRADING SL\Escritorio\Personal\Proyectos\TaxIA\.claude\skills\` (superpowers: `systematic-debugging`, `verification-before-completion`, `dispatching-parallel-agents`, `subagent-driven-development`, `git-worktree-isolation`, `project-research`, `roadmap-manager`, `playwright-testing`)

**Repo destino (vacío, listo para sembrar):**
- `c:\Users\Fernando Prada\OneDrive - SVAN TRADING SL\Escritorio\Personal\Proyectos\world_wide_project\` (solo `.git` + `.claude\settings.local.json`)

**Referencias externas:**
- osiris `https://github.com/Nambu89/osiris` (MIT) — copiar `src/app/api/markets/route.ts`, `/api/gdelt`, `/api/country-risk`, `src/lib/sanctions.ts`, `src/app/page.tsx` (polling), `src/components/OsirisMap.tsx`.
- worldmonitor `https://github.com/Nambu89/worldmonitor` (AGPL, **solo metodología, no copiar fuente**) — leer `shared/cii-weights.ts`, `server/_shared/llm.ts`, `list-cross-source-signals.ts`, `SELF_HOSTING.md`, `ARCHITECTURE.md`.

---

*Generado por investigación multi-agente (workflow `fusion-research`): 5 lectores deep-read del sistema TaxIA + 2 investigadores de repos + síntesis + crítico adversarial. Documento semilla — el siguiente paso es `/brainstorming` para fijar el alcance del MVP.*
