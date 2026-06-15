# DECISIONS — ADR log (world_wide_project)

> Solo el **PM** escribe aquí. Lint de IDs únicos: `grep -oE "ADR-[0-9]+" plans/DECISIONS.md | sort | uniq -d` debe estar vacío. Un número de ADR jamás se repite.

---

## ADR-001: Base = metodología de worldmonitor + cosecha de código de osiris
- **Fecha:** 2026-06-13
- **Estado:** Aceptado
- **Contexto:** Fusionar dos repos para una plataforma personal de inteligencia mundial. osiris (MIT) destaca en ingesta/visualización; worldmonitor (AGPL) en síntesis IA/scoring/correlación.
- **Decisión:** Usar worldmonitor como **referencia de diseño del cerebro** (re-implementado) y osiris como **fuente de código** (connectors + mapa + polling).
- **Consecuencias:** Cuerpo limpio MIT; cerebro re-implementado sin atarse a AGPL. Hay que reconstruir la lógica de convergencia (no servida por worldmonitor).
- **Alternativas:** Clonar uno entero (rechazado: osiris carece de cerebro; worldmonitor arrastra topología multi-servicio inviable para una persona).

## ADR-002: Re-implementar CII y router LLM — NUNCA copiar fuente AGPL
- **Fecha:** 2026-06-13
- **Estado:** Aceptado
- **Contexto:** El código de worldmonitor es AGPL-3.0 (copyleft de red). Las fórmulas/ideas no son copyrightables; el código sí.
- **Decisión:** Re-implementar la metodología (pesos CII, PROVIDER_CHAIN, taxonomía de señales) leyendo docs/código como referencia, sin copiar fuente.
- **Consecuencias:** Código propio libre incluso si algún día se comparte. Si se expone por red con código derivado de worldmonitor → AGPL §13.
- **Alternativas:** Copiar fuente (rechazado: contamina todo el programa con AGPL). Licencia comercial (innecesaria para uso personal).

## ADR-003: Stack Vite + React + MapLibre + Turso + router LLM local-first
- **Fecha:** 2026-06-13
- **Estado:** Aceptado
- **Contexto:** Solo-dev; hay que minimizar complejidad operativa y coste de IA, maximizar privacidad.
- **Decisión:** Monorepo TS (pnpm) · Vite+React+MapLibre · Node single-server · Turso (SQLite) · router LLM `ollama → groq → claude`.
- **Consecuencias:** Mantenible por una persona; IA gratis/privada por defecto, Claude solo para briefing de calidad. Riesgo toolchain Windows (Ollama/Tauri/ONNX) — ver feedback.
- **Alternativas:** Next.js (más peso); vanilla+86 Panels de worldmonitor (menos mantenible); multi-servicio cloud (overkill).

## ADR-004: Scheduler server-side + persistencia histórica en Turso
- **Fecha:** 2026-06-13
- **Estado:** Aceptado
- **Contexto:** Ambos repos hacen polling live in-memory (osiris desde el navegador) y carecen de histórico → sin tendencias ni backtesting.
- **Decisión:** Un scheduler Node server-side hace polling por volatilidad y persiste snapshots en Turso; la UI lee de la DB local.
- **Consecuencias:** Frescura desacoplada de la pestaña; habilita series temporales (diferencial del proyecto). Más infra que un cliente puro.
- **Alternativas:** Fanout en el navegador (rechazado: frágil, sin histórico).

## ADR-005: MVP — proveedor IA activo = Anthropic Claude (router intacto)
- **Fecha:** 2026-06-13
- **Estado:** Aceptado (matiza ADR-003: proveedor activo del router en el MVP)
- **Contexto:** La propuesta del usuario contradecía "Ollama-only" con "usar la API Key de Anthropic". El toolchain de Ollama en Windows es un riesgo documentado (feedback). ADR-003 fija el router local-first como **arquitectura**, no como obligación de proveedor en cada fase.
- **Decisión:** El MVP activa la rama `claude` del router en `packages/core/ai/` (API key Anthropic en `.env`). La **arquitectura** del router (`ollama → groq → claude`, health-gating, fall-through por key ausente) se implementa íntegra; `ollama`/`groq` quedan como ramas inactivas hasta Fase 3. Se re-implementa la metodología, **nunca se copia fuente AGPL** (ADR-002).
- **Consecuencias:** Briefing de calidad desde el día 1 sin depender de Ollama en Windows. Coste: llamadas Anthropic de pago (no zero-key) — mitigado con caché de briefing + control de frecuencia del scheduler. `zero-key-first` (feedback) se respeta en los **conectores** (markets/gdelt/news keyless); la IA es la única excepción.
- **Alternativas:** Ollama-only (rechazado: riesgo toolchain Windows, sin calidad de briefing); híbrido ollama→claude en MVP (rechazado: duplica la superficie a probar; se difiere a Fase 3).

## ADR-006: MVP — persistencia = @libsql/client local file (Turso-compatible)
- **Fecha:** 2026-06-13
- **Estado:** Aceptado (matiza ADR-003/004: cliente y ubicación de la DB en el MVP)
- **Contexto:** El usuario quiere "probar SQLite antes que Turso". ADR-003/004 fijan Turso; Turso = libSQL = fork de SQLite, misma API de cliente.
- **Decisión:** `packages/store/` usa `@libsql/client` con `url: file:./data/world.db` (SQLite local embebido). Schema + series temporales idénticos al diseño Turso. Migrar a Turso remoto = cambiar la URL (cero reescritura).
- **Consecuencias:** Dev local sin cuenta cloud; honra ADR-003/004 (libSQL es SQLite). No se introduce `better-sqlite3` (evita API divergente de Turso + build nativo en Windows).
- **Alternativas:** `better-sqlite3` (rechazado: API distinta a Turso, build nativo Windows); Turso remoto directo (diferido: el usuario quiere probar local primero).

## ADR-007: Dev environment = pnpm workspace + .venv Python reservado
- **Fecha:** 2026-06-13
- **Estado:** Aceptado
- **Contexto:** El usuario pidió "crear y activar el entorno virtual" y eligió "Ambos". El stack del producto es Node/TS+pnpm; "venv" es un concepto Python.
- **Decisión:** Entorno primario = **workspace pnpm** (Node) para todo el producto TS. Adicionalmente se crea un **`.venv` Python 3.12** (en `tools/py/`) reservado para futuros scripts ML/data-science (excepción `python-pro`). En el MVP el `.venv` queda mínimo/vacío (aún no hay código Python). `.venv/` y `node_modules/` → `.gitignore`.
- **Consecuencias:** Estructura lista para ML futuro sin re-bootstrap; coste: 2 toolchains conviviendo. Bootstrap es la **tarea-1** del plan de implementación (tras `/check-plan` PASS), no se ejecuta antes de los gates.
- **Alternativas:** Solo pnpm (rechazado por el usuario); solo Python (no aplica: el stack es Node).

## ADR-008: UI responsive + mobile-first (principio de plataforma)
- **Fecha:** 2026-06-13
- **Estado:** Aceptado
- **Contexto:** El usuario requiere que la app sea usable en móvil, no solo en desktop. Es un principio transversal: aplica a todos los paneles/dominios futuros (Finanzas/Educación/Política), no solo al panel del MVP.
- **Decisión:** Toda la UI de `packages/web/` es **responsive y mobile-first**: se diseña primero para viewport estrecho (~375px) y se escala a desktop (~1200px). El mapa MapLibre ocupa el viewport; los paneles se adaptan (drawer/colapsable en móvil, lateral en desktop). Breakpoints en el sistema de estilos central, nunca inline dispersos (coherente con el principio de config central, [feedback_central_layer_config](../memory/feedback_central_layer_config.md)).
- **Consecuencias:** Más trabajo de layout en el frontend; mayor alcance de uso real. El `qa-tester` valida en 375px y 1200px (su contrato E2E ya lo contempla).
- **Alternativas:** Desktop-only (rechazado por el usuario); responsive-pero-no-mobile-first (rechazado: en móvil el mapa+panel necesitan el orden de prioridad invertido, mejor diseñarlo desde el viewport estrecho).

## ADR-009: MVP — proveedor IA activo = OpenAI (sustituye la rama activa de ADR-005)
- **Fecha:** 2026-06-13
- **Estado:** Aceptado (reemplaza el **proveedor activo** de ADR-005; la arquitectura multi-proveedor del router de ADR-003/005 sigue vigente)
- **Contexto:** El usuario tiene crédito/API key de **OpenAI**. Los créditos de claude.ai NO sirven para la API programática, y la API de Anthropic Console exige saldo aparte (verificado). Para no bloquear el briefing, se usa OpenAI.
- **Decisión:** El router (`packages/core/ai`) gana un proveedor **`openai`** (SDK `openai`, var `OPENAI_API_KEY`, modelo configurable `OPENAI_MODEL`). Rama **ACTIVA del MVP = openai** (disponible cuando `OPENAI_API_KEY` presente). `claude`/`groq`/`ollama` quedan como ramas inactivas (key/daemon ausente) — arquitectura multi-proveedor intacta (ADR-003). Cambia la variable de entorno: `ANTHROPIC_API_KEY` → **`OPENAI_API_KEY`**.
- **Consecuencias:** Briefing real con el crédito OpenAI del usuario. `@anthropic-ai/sdk` se mantiene como rama inactiva (no se borra; el router es multi-proveedor). `zero-key-first` sigue en los conectores; la IA es la excepción de pago (ahora OpenAI en vez de Anthropic).
- **Alternativas:** Anthropic Console prepago (rechazado: el usuario prefiere su crédito OpenAI); pool programático de la suscripción (no aplica a llamadas Messages con API key).

## ADR-010: Fase 2 prioriza la CAPA DE EVENTOS GLOBALES multi-fuente (antes que CII)
- **Fecha:** 2026-06-13
- **Estado:** Aceptado (reordena Fase 2; el design-doc CII `2026-06-13-cii-scoring.md` queda como rebanada POSTERIOR)
- **Contexto:** El núcleo del proyecto (confirmado por el usuario) es "información de eventos de TODO el mundo que afecten economía y seguridad": disturbios, revueltas, guerras, manifestaciones + desastres naturales (terremotos, inundaciones, incendios, tormentas…), estilo osiris/Palantir/worldmonitor. Fase 1 (MVP) solo cubre Finanzas; el conector gdelt actual es financiero/país-fuente (la GEO API real murió). El CII diseñado está **data-starved** sin esta capa (phase-split del design-doc CII).
- **Decisión:** la 1ª rebanada de Fase 2 pasa a ser la **capa de eventos globales multi-fuente**, geo-localizada + severity-scored + time-series: conflicto/político (GDELT raw Events, ACLED/UCDP) + natural/humanitario (USGS terremotos, NASA EONET, ReliefWeb). **Modelo de evento unificado** que alimenta mapa (capas por tipo en el config-array) + briefing + CII. CII se reordena DESPUÉS (se apoya en esta capa). Keyless-first; las fuentes con key (ACLED) degradan, no rompen. Cada fuente se **verifica EN VIVO antes de diseñar** (lección: GDELT GEO API muerta por asumir).
- **Consecuencias:** entrega la función núcleo del proyecto + desbloquea los componentes Conflict/Security/Unrest del CII. Más conectores + un schema de eventos general (posible refactor de `gdelt_events`).
- **Alternativas:** CII-first (rechazado: data-starved); seguir solo con GDELT financiero (rechazado: no es "eventos globales").

## ADR-011: Fase 2 rebanada 2 = Radar geoeconómico temático (GKG-backed)
- **Fecha:** 2026-06-14
- **Estado:** Aceptado (2ª rebanada de Fase 2; se apoya en la capa de eventos de ADR-010)
- **Contexto:** El usuario quiere ver **todo lo que afecte a la economía mundial** más allá de finanzas: revueltas/manifestaciones/cambios de gobierno, materias primas, tierras raras, IA/tech, semiconductores, ataques a centros de datos, comercio/sanciones. La capa de eventos (rebanada 1) da el QUÉ-DÓNDE-CUÁNDO-severo geo, pero no la dimensión **temática económica**. Brainstorming fijó: **radar dedicado por tema, atado al mapa**, fuente **GKG backbone + news curada**, 6 secciones. Verificación EN VIVO (`wf_e68c43c8-11c`, 2026-06-14): GDELT **GKG v2 es keyless** (ToS "unlimited unrestricted use"), da **temas+tono+entidades+geo por artículo** (670/15min, 2.75 MB zip, ETag, cadencia 15min, reusa `extractZipFirstEntry`); cubre **bien** política/commodities/energía/comercio por código `WB_*`/`ENV_*`/`ECON_*`, **débil** tierras-raras/semis/data-centers/ciber (derivar por keyword/entidad); geo del GKG = del **artículo** (74%), NO del suceso.
- **Decisión:** la 2ª rebanada de Fase 2 = **radar geoeconómico temático de 6 secciones** (inestabilidad política · materias primas&energía · tierras raras&minerales críticos · semiconductores/IA/tech · infra digital&ciber · comercio&sanciones), alimentado por **GKG (backbone) + news RSS temática curada**. **Conector NUEVO `gkg.ts`** (27 cols TAB, reusa el ZIP zero-dep). **Tabla NUEVA `signals`** article-level (themes/tone/entities/geo/sección derivada), **separada de `events`** (que es geo-event). **Clasificación = theme-codes GKG + reglas keyword/entidad** (corazón editorial re-derivado, no-AGPL). **Tendencia/calor por sección** = volumen+AvgTone por ventana. **Atado al mapa**: "inestabilidad política" reusa los `events` geo-reales; el resto = señales temáticas. La **síntesis cross-tema (convergencia) sigue Non-Goal**.
- **Consecuencias:** entrega la dimensión temática económica (núcleo de la visión del usuario). Más datos (GKG 2.75 MB/15min) + un clasificador editorial que mantener/calibrar. El motor de convergencia/CII se apoyará en `signals`+`events` después.
- **Alternativas:** forzar GKG en la tabla `events` (rechazado: GKG es article-level, no geo-event); solo theme-codes sin keywords (rechazado: deja tierras-raras/semis/ciber vacíos); solo news RSS (rechazado: poca cobertura, sin tono/tendencia); ML classifier Transformers.js (diferido: NG ML cliente).

## ADR-012: Fase 2 rebanada 4 = Motor de convergencia cross-domain (el último diferencial)
- **Fecha:** 2026-06-15
- **Estado:** Aceptado (4ª rebanada de Fase 2; consume las capas events/signals/CII/markets ya construidas. Detalle de diseño en `docs/design/2026-06-15-convergence.md`, D-300..312)
- **Contexto:** Las rebanadas 1-3 construyeron tres capas de observación por-país (events, signals GKG, CII). Ninguna responde la pregunta de orden superior que motiva la plataforma: **¿cuándo varias señales independientes apuntan al MISMO deterioro en el MISMO país a la vez?** — el patrón que precede a una crisis y que un humano de un solo dominio no ve. La metodología de convergencia de worldmonitor es AGPL → se re-implementa clean-room (ADR-002). El problema central de diseño = **anti-doble-conteo**: el CII ya agrega events+signals, así que "≥2 fuentes independientes" debe definirse sin contar el mismo dato dos veces.
- **Decisión:** la 4ª rebanada = **motor de convergencia** en un paquete NUEVO `packages/core/signals` (`@www/core-signals`), función pura `detectConvergence(observations, nowMs)` + orquestador IO `detectAllConvergence`. Dispara una señal cuando **≥2 familias-de-dato DISJUNTAS** (`events` / `signals` / `markets`) superan `MIN_MAGNITUDE=0.5` para el mismo país en una **ventana 72h**. **Q1 ratificada (premisa fija):** el CII por-dimensión es la capa de observación canónica; markets = única fuente exógena; independencia = familias-de-dato disjuntas (conflict/social→events; economic/political→signals; markets aparte). **Anti-doble-conteo POR CONSTRUCCIÓN** = contar `dataFamily` distintas, no componentes (D-306). **Decisiones de usuario de esta sesión:** (1) **markets ENTRA al MVP** como corroborante exógeno transversal (no entidad GLOBAL, no difusión por-país); como NO existe `regimeDelta` en el store (verificado), su magnitud de estrés se deriva clean-room de `market_snapshots.change_pct` (compuesto risk-off) + `market_daily` OHLC (proxy volatilidad), `magnitude=max(riskOff,vol)`, refs en `convergence.config.ts`. (2) **superficie = SOLO briefing + persistencia** (tabla `convergence_signals` migración 005, append-snapshot; bloque en el briefing); `/api/convergence` + capa de mapa se DIFIEREN a una rebanada de superficie posterior. `dynamicScore` (delta de strength) SÍ entra. Job tier `medium` encadenado tras CII. **Familias MVP = `events×signals` + `cualquiera×markets`** (`political×economic` no es par independiente por sí solo: ambas familia `signals` → requiere tercera familia). Verificado en vivo: 63/109 países con solapamiento events×signals (MVP no-vacío).
- **Consecuencias:** entrega el último diferencial (el "cerebro" de correlación que ningún repo origen servía). El histórico de convergencia (series temporales de coincidencias de deterioro) habilita backtesting futuro. Coste: umbrales/refs editoriales sin ground-truth (calibración diferida a intel-analyst, GAP-2). markets añade una receta de estrés que mantener/calibrar. La superficie UI (API+mapa) queda como deuda explícita de una rebanada posterior (NG-4).
- **Alternativas:** events+signals+markets crudos ignorando el CII (rechazado: re-haría la normalización por-dimensión que el CII ya hace, y reintroduciría el doble-conteo); híbrido con grafo de independencia explícito (rechazado: complejidad sin beneficio sobre familias-disjuntas para el MVP); diferir markets (rechazado por el usuario: lo quiere como corroborante exógeno desde el día 1); exponer API+mapa ya (diferido: cerrar persistencia→briefing de punta a punta primero es más valioso que una superficie a medio cablear).
