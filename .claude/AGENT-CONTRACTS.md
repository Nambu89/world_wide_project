# AGENT-CONTRACTS — world_wide_project

> Contrato compacto entre el PM y cada agente: que artefacto produce/consume,
> los completion markers, el scope-payload que el PM pasa a cada subagente
> fresco, y el status vocabulary de vuelta. El PM confirma completitud
> **chequeando artefacto + git state**, NO regexeando el chat.

---

## 1. Status vocabulary (subagente -> PM, en el return payload)

Todo especialista termina SIEMPRE con uno de:

| Status | Significado | Accion del PM |
|--------|-------------|---------------|
| `DONE` | Tarea completa, verificacion en verde, self-report = `real`. | Marca DONE; avanza la wave. |
| `DONE_WITH_CONCERNS` | Hecho pero con deuda/observaciones (documentadas). | Acepta + abre seguimiento en ROADMAP; no bloquea. |
| `NEEDS_CONTEXT` | Falta info/spec para continuar. | Completa el scope-payload y re-despacha. |
| `BLOCKED` | 2 reintentos fallidos o dependencia dura. | Aplica protocolo de escalacion (re-planificar / saltar / accion manual). |

El payload de vuelta incluye SIEMPRE: **archivos modificados**, **salida literal de verificacion** (pegada, no resumida), y el **Self-Report** (`real | aspirational | stub | failing | invented | hallucinated`). El PM **rechaza** DONE si el self-report no es `real` con verificacion verde.

---

## 2. Completion markers (all-caps H2 en los artefactos)

Los agentes señalan estado con un marker H2 en su artefacto (verificable, no efimero):

- `## PLANNING COMPLETE` — el plan esta listo para `/check-plan`.
- `## VERIFIED` — verifier confirma que el codigo cumple las condiciones de exito.
- `## ISSUES_FOUND` — gate (plan-checker o verifier) encontro problemas; lista incluida.
- `## PHASE SPLIT RECOMMENDED` — el scope no cabe; el plan debe dividirse en fases (en vez de erosionar el scope silenciosamente).
- `## ESCALATE` — requiere juicio humano (loops agotados, decision arquitectonica, ToS no verificado).

---

## 3. Scope-payload YAML (PM -> cada subagente fresco)

El PM pasa esto a cada especialista. **Pega contexto como rutas + lineas concretas, no "lee el fichero X".**

```yaml
task: <id-tarea>                    # ej. T-03.1
description: <una linea>
agent: <backend-architect|frontend-dev|data-connector-dev|intel-analyst|system-architect>
scope:
  files: ["<ruta1>", "<ruta2>"]     # los ficheros que el agente PUEDE tocar (max ~5)
  boundaries:                       # fronteras duras
    - "NO modifiques server.ts wiring sin aprobacion (Regla 4)"
    - "NO toques .claude/hooks/"
constraints:
  - "Sigue el patron de <ref-file:line>"
  - "TDD: los tests de la fase RED son INMUTABLES"
  - "AbortSignal.timeout(8000) en todo fetch de conector"
contexts:                           # rutas que el agente leera bajo demanda
  domain: ["packages/connectors/finance/markets.ts"]
  shared: [".claude/README.md", ".claude/AGENT-CONTRACTS.md"]
locked_decisions: ["D-01", "D-03"]  # decisiones bloqueadas que DEBE respetar
gate:
  verify: ["pnpm -w build", "node --test packages/<pkg>"]  # comando <60s (Regla Nyquist)
  files_modified: ["<rutas que tocara>"]                   # para que el PM compute waves
```

Reglas del payload:
- `files_modified` es **obligatorio** (la disjuncion entre planes de la misma wave es el lock).
- `gate.verify` debe terminar en **<60s** (Regla Nyquist). Si no se puede escribir el check, la tarea esta mal especificada.
- `locked_decisions` referencia `D-NN` de `plans/DECISIONS.md`; el agente no puede contradecirlas.

---

## 4. Tabla de produce / consume por agente

| Agente | Consume | Produce | Marker / Status terminal |
|--------|---------|---------|--------------------------|
| **pm-coordinator** | todo el blackboard, git state | scope-payloads, `plans/DECISIONS.md` (ADR), `plans/ROADMAP.md`, entradas en `agent-comms.md` | orquesta; no marca markers propios |
| **system-architect** | brief del PM, `/navigate` output | `docs/design/YYYY-MM-DD-<topic>.md` | `## PLANNING COMPLETE` o `## ESCALATE` |
| **plan-checker** | `plans/*.md` / `implementation_plan.md` | veredicto en pantalla + nota en agent-comms | `## VERIFIED`(PASS) / `## ISSUES_FOUND` |
| **backend-architect** | scope-payload, design-doc | codigo en `server.ts`, `packages/{store,scheduler,core/ai}` + verificacion | `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` |
| **frontend-dev** | scope-payload | codigo en `packages/web` + verificacion | `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` |
| **data-connector-dev** | scope-payload, ToS del upstream | conector en `packages/connectors/<dominio>/<source>.ts` + registro en `server.ts` | `DONE` / `BLOCKED` (ToS no verificado -> `## ESCALATE`) |
| **intel-analyst** | scope-payload, metodologia documentada | `packages/core/{cii,signals,ai}` + verificacion | `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` |
| **verifier** | `agent-comms.md`, `git log`, codigo + `git diff` reales | veredicto + nota `[VERIFIER]` en agent-comms | `## VERIFIED` / `## ISSUES_FOUND` / `INCOMPLETE` |
| **codebase-navigator** | pregunta del PM | respuesta directa `file:line` | (no escribe; responde en linea) |
| **qa-tester** | app corriendo | `plans/qa-report-YYYY-MM-DD.md` + nota en agent-comms | `DONE` (bugs criticos -> `[BLOCKED]` para backend/frontend) |

---

## 5. Loop creator <-> checker (cap 3, stall detection)

Producer <-> gate hasta **3 iteraciones**. Las issues del gate se pasan VERBATIM al producer dentro de `<checker_issues>`. Si el **nº de issues no decrece estrictamente** entre iteraciones consecutivas, el producer esta atascado -> declara stall -> gate humano (`Proceder igualmente` / `Ajustar enfoque`). Nunca loop infinito.

---

## 6. Gate taxonomy (que puerta aplicar)

| Tipo | Cuando | Efecto |
|------|--------|--------|
| **Pre-flight** | Faltan precondiciones (no hay design-doc, no hay REQUIREMENTS). | Bloquea la entrada. |
| **Revision** | Artefacto generado tiene fallos corregibles. | Devuelve el trabajo con feedback. |
| **Escalation** | Loops agotados / decision arquitectonica / ToS no verificado. | Pausa para juicio humano. |
| **Abort** | Continuar arriesga daño (destruir trabajo, datos). | Para y preserva el estado. |

Elige la puerta mas ligera que encaje. Gates de entrega/gobernanza = **fail-closed**. Sync externo (issues/board) = **fail-open** (no debe bloquear la ejecucion local; reconcilia luego).

---

## 7. ADR seed (`plans/DECISIONS.md`)

Decisiones base ya tomadas (lint de IDs unicos — un id ADR jamas se repite):

- **ADR-001** — Base: metodologia de worldmonitor + cosecha de osiris (MIT).
- **ADR-002** — Re-implementar CII (NO copiar fuente AGPL; las formulas/ideas no son copyrightables, la fuente si).
- **ADR-003** — Stack: Vite + React + MapLibre + Turso + router LLM local-first (`ollama -> groq -> claude`).
- **ADR-004** — Scheduler server-side + persistencia historica en Turso (la UI lee de la DB local, no del upstream).

---

## 8. Frases de erosion de scope PROHIBIDAS (plan-checker las marca como ISSUE)

`v1`, `version simplificada`, `placeholder`, `se cableara despues` / `will be wired later`, `implementacion basica`, `future enhancement`. Si no cabe -> `## PHASE SPLIT RECOMMENDED`, nunca dropear silenciosamente una decision bloqueada.
