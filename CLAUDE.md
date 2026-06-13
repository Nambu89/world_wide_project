# CLAUDE.md — world_wide_project

Plataforma personal de **inteligencia mundial** con IA para apoyar decisiones **financieras, educativas y políticas/geopolíticas**. Uso personal. Fusiona lo mejor de **osiris** (MIT, código) + **worldmonitor** (AGPL, solo metodología), con persistencia histórica propia.

> Documento semilla de la investigación: [INVESTIGACION-FUSION.md](INVESTIGACION-FUSION.md).
> Sistema de desarrollo multi-agente: [.claude/README.md](.claude/README.md) y [.claude/AGENT-CONTRACTS.md](.claude/AGENT-CONTRACTS.md).

## Stack

- **Lenguaje**: TypeScript. **Monorepo** `pnpm`. **Build**: Vite.
- **Frontend**: React + **MapLibre GL** (capas en **config-array central**, NUNCA imperativas dispersas).
- **Backend**: **Node single-server** (`server.ts`) que cablea connectors + scheduler + api. Sin topología multi-servicio.
- **Connectors**: patrón osiris — 1 fichero por fuente, `fetch` + `AbortSignal.timeout(8000)` + fallback multinivel + retorno vacío gracioso + cache/ETag.
- **Scheduler**: server-side por volatilidad (NO fanout en el navegador).
- **Persistencia**: **Turso / libSQL (SQLite)** — series temporales (el diferencial; la UI lee de la DB local, no de upstream).
- **IA**: router local-first **`ollama → groq → claude`** (health-gating, fall-through por key ausente). ML cliente: Transformers.js ONNX en Web Workers.

## Monorepo

```
packages/
  connectors/{finance,geo,edu}/<source>.ts   # patrón osiris, 1 fichero/fuente
  core/{cii,signals,ai}/                      # scoring CII, señales convergencia, router LLM + briefing
  store/                                      # schema Turso + series temporales
  scheduler/                                  # jobs server-side por volatilidad
  web/                                        # Vite + React + MapLibre (config-array de capas)
server.ts                                     # backend único
docs/design/                                  # design-docs (los escribe system-architect)
plans/                                        # ROADMAP.md + DECISIONS.md (ADR)
```

## Dominios de decisión

- **Finanzas**: markets (Yahoo/CoinGecko keyless), FRED/EIA, sanciones OFAC → radar multi-señal + régimen de mercado.
- **Educación**: RSS curado (SSRF-safe allowlist) + clustering + ML ONNX → resumen de aprendizaje.
- **Política**: GDELT/ACLED/UCDP + country-risk → **CII re-implementado** + motor de convergencia.

## Quality Gates (OBLIGATORIO)

- **NUNCA** se presenta un plan al usuario sin `/check-plan` = **PASS** (agente `plan-checker`).
- **NUNCA** se reporta "completado" sin `/verify` = **VERIFIED** (agente `verifier`).
- Ciclo **RPI**: Research+Design (`/design` → `system-architect`) → Plan → Check → Implement → Verify. Detalle: [.claude/README.md](.claude/README.md).
- Gates de entrega = **fail-closed**. Sync externo = fail-open.

## Reglas duras (license & datos)

- **osiris = MIT**: copiar código libremente.
- **worldmonitor = AGPL-3.0**: **solo metodología, NUNCA copiar fuente**. Ver [memory/feedback_no_agpl_copy.md](memory/feedback_no_agpl_copy.md).
- **Datos ≠ código**: respetar ToS de cada fuente. Ver [memory/feedback_data_tos.md](memory/feedback_data_tos.md).
- **Secretos**: `.env` (nunca commiteado), jamás en strings de comandos. Ver [.claude/SECRETS.md](.claude/SECRETS.md).
- **Zero-key first**: fuentes sin key primero; las keys degradan, no rompen. Ver [memory/feedback_zero_key_first.md](memory/feedback_zero_key_first.md).

## Blackboard (committed a git)

`agent-comms.md` (canal inter-agente) · `plans/ROADMAP.md` · `plans/DECISIONS.md` (ADR, solo PM escribe) · `memory/MEMORY.md` (+ `feedback_*.md`) · `claude-progress.txt`.

## Estado

Andamiaje de desarrollo instalado (`.claude/`, 11 agentes). Blackboard sembrado. **Código de producto: no empezado.** Siguiente: fijar alcance del MVP (`/design` o brainstorming) y arrancar Fase 1.
