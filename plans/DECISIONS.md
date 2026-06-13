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
