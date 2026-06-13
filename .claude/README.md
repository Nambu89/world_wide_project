# world_wide_project — Sistema Multi-Agente de Desarrollo

> Single source of truth de la guia de agentes. Si una regla aqui choca con
> un fichero de agente, **gana esta**. Todas las rutas son relativas a la raiz
> del repo salvo que se indique lo contrario.

Plataforma personal de **world-intelligence** (finanzas / educacion / politica):
conectores de fuentes -> scheduler server-side -> persistencia historica en
Turso -> motor CII + señales de convergencia + briefing IA -> mapa MapLibre.

Stack: **Node + TypeScript** monorepo (pnpm workspaces) — `packages/{connectors,core,store,scheduler,web}` + `server.ts` (backend unico que cablea connectors + scheduler + api). Frontend: **Vite + React + MapLibre GL**. DB: **Turso (@libsql/client)**. Router LLM local-first: **ollama -> groq -> claude**.

---

## 1. Filosofia (gobierna todo el sistema)

- **El PM orquesta, los especialistas implementan, las puertas verifican.** Una sola capa de delegacion: el PM despacha especialistas + gates; los especialistas **nunca** lanzan subagentes.
- **Orquestador delgado, trabajadores frescos.** El PM gasta ~15% de su ventana (descubrir -> wave -> despachar -> agregar). Cada subagente recibe una ventana fresca ~100%. No se cambia de modelo a mitad de sesion: se hace via subagente.
- **Coordinacion por artefactos en disco (file-blackboard), no por memoria de chat.** Los hilos comparten el filesystem pero **no** el historial de conversacion. No asumas contexto compartido.
- **Puertas de calidad deterministas mandan; el juicio LLM solo aconseja.** Tests/build/lint/scan deciden si una afirmacion esta probada.
- **Optimiza para wall-clock + nº de tool-calls, no para coste en tokens.**
- **Frontera de integracion dura:** solo el PM (con aprobacion humana) hace commit/push/merge/publish/tag. Un especialista hace el trabajo, lo verifica y lo reporta.

---

## 2. Roster de agentes (`.claude/agents/`)

| Agente | Modelo | Read-only | Rol |
|--------|--------|-----------|-----|
| **pm-coordinator** | opus | no | Orquestador THIN hub-and-spoke. Investiga, planifica, delega, documenta, verifica. **Nunca implementa.** Aplica RPI + quality gates obligatorios; computa waves. Mantiene el blackboard y los D-NN. |
| **plan-checker** | opus | **SI** | Puerta PREVENTIVA. Audita el plan en 5 dimensiones. Emite `PASS` / `ISSUES_FOUND`. |
| **verifier** | sonnet | **SI** | Puerta POST-implementacion goal-backward. Emite `VERIFIED` / `ISSUES_FOUND` / `INCOMPLETE`. No confia en el reporte del implementador: lee codigo + `git diff` reales. |
| **system-architect** | opus | no (solo docs) | Autor de design-docs (fase Research+Design del RPI). Unico que escribe en `docs/design/`. No implementa codigo. |
| **backend-architect** | sonnet | no | `server.ts` wiring, schema/time-series Turso, scheduler, seguridad, router LLM. |
| **frontend-dev** | sonnet | no | `packages/web` (Vite+React+MapLibre). Capas en config-array central. |
| **data-connector-dev** | sonnet | no | Un fichero por fuente en `packages/connectors/{finance,geo,edu}/`. Patron timeout/fallback/cache/empty-graceful. Verifica ToS. |
| **intel-analyst** | sonnet | no | Motor CII (`packages/core/cii`), señales (`packages/core/signals`), personas de briefing (`packages/core/ai`). Re-implementa metodologia, nunca copia AGPL. |
| **codebase-navigator** | haiku | **SI** | Mapea codigo cosechado (osiris MIT / worldmonitor AGPL-referencia) + el monorepo. Responde "donde esta X / quien llama Y" con `file:line`. |
| **qa-tester** | sonnet | no | E2E/UX via Playwright. Detecta, no arregla. Reporta a `plans/qa-report-YYYY-MM-DD.md`. |

**Read-only se garantiza por la LISTA DE TOOLS** (los gates omiten Write/Edit/MultiEdit), **no solo por prosa**. El hook `block-read-gate.js` lo refuerza estructuralmente.

---

## 3. Tiering de modelos

- **opus** — razonamiento pesado / orquestacion: `pm-coordinator`, `plan-checker`, `system-architect`.
- **sonnet** — implementacion + verificacion: `backend-architect`, `frontend-dev`, `data-connector-dev`, `intel-analyst`, `verifier`, `qa-tester`.
- **haiku** — alto volumen / bajo razonamiento / consulta read-only: `codebase-navigator`.

Nota de producto (no es un tier de agente): dentro del PRODUCTO, **Claude** se reserva para el briefing diario y el razonamiento de convergencia (1-2 llamadas/dia) como rama final del `PROVIDER_CHAIN` del router LLM (`ollama -> groq -> claude`).

---

## 4. El ciclo RPI (Research -> Plan -> Check -> Implement -> Verify)

Para features no triviales, el PM sigue RPI con **dos quality gates obligatorios**:

```
Design (system-architect)        -> docs/design/YYYY-MM-DD-<topic>.md
   |
Plan (PM / writing-plans)        -> plans/YYYY-MM-DD-<feature>.md
   |
CHECK (plan-checker)  ==GATE==>   PASS  (si ISSUES_FOUND: corrige y re-checkea)
   |
Aprobacion humana
   |
Implement (especialistas, en waves)
   |
VERIFY (verifier)     ==GATE==>   VERIFIED  (si ISSUES_FOUND: corrige y re-verifica)
   |
Completado  (opcional: /qa para E2E)
```

**Reglas duras:**
- El PM **NUNCA** presenta un plan al usuario sin `plan-checker = PASS`.
- El PM **NUNCA** reporta "completado" sin `verifier = VERIFIED`.
- Cada tarea declara `files_modified` (para computar waves) y un comando **Verify automatico que termina en <60s** (Regla Nyquist). Si no puedes escribir el check, la tarea esta mal especificada.

### Waves (paralelismo seguro)
`wave = 1` si `depends_on` esta vacio, si no `max(waves de deps) + 1`. Si un fichero aparece en 2+ planes, el plan posterior se sube a la siguiente wave. **La disjuncion de `files_modified` es el lock** — nunca dos agentes editan el mismo fichero en paralelo.

---

## 5. Quality gates: spec-then-quality

- **plan-checker (PREVIO):** 5 dimensiones — D1 cobertura de requisitos, D2 completitud de tareas, D3 dependencias (incl. circulares), D4 scope (>15 ficheros / >3 areas), D5 riesgos (schema Turso, PROVIDER_CHAIN del router, jobs de scheduler, ToS de datos). Audita fidelidad de las decisiones bloqueadas `D-NN` y frases de erosion de scope prohibidas.
- **verifier (POSTERIOR):** goal-backward en 5 pasos — condiciones de exito -> artefactos reales (no stubs; caza TODO/FIXME/`catch {}`/`console.log`) -> wiring -> tests/build -> docs/memoria. Wiring real del monorepo: conector registrado en `server.ts`, capa en el config-array de `packages/web`, query/tabla en `packages/store` migrada en Turso, job en `packages/scheduler`, panel importado en `packages/web`.
- **review (two-stage):** Stage 1 spec-compliance, Stage 2 code-quality. **El revisor lee el `git diff BASE..HEAD` real, nunca el reporte del implementador.** Stage 1 SIEMPRE antes que Stage 2.

Las skills globales `superpowers:*` (brainstorming, test-driven-development, systematic-debugging, verification-before-completion, dispatching-parallel-agents, subagent-driven-development, using-git-worktrees, requesting/receiving-code-review, writing-plans, writing-skills) **se REFERENCIAN por su namespace** — NO se recrean localmente. Las skills locales son solo de dominio: `connector-pattern`, `llm-router`, `cii-scoring`, `design-doc`, `write-handoff`, `project-research`, `roadmap-manager`.

---

## 6. File-blackboard (committeado a git, durable, greppable)

| Fichero | Quien escribe | Formato |
|---------|---------------|---------|
| `agent-comms.md` (raiz) | todos (append-only) | `## [ISO-TIMESTAMP] [AGENT] [STATUS] — msg` con vocab `DONE/IN_PROGRESS/BLOCKED/NEEDS_REVIEW` |
| `plans/DECISIONS.md` | **solo PM** | ADR `ADR-NNN` con lint de IDs unicos |
| `plans/ROADMAP.md` | PM (skill roadmap-manager) | fases Alta/Media/Baja con checkboxes + barra de progreso |
| `memory/MEMORY.md` (+ `memory/feedback_*.md`) | PM / especialistas | aprendizajes y cristalizaciones de anti-patrones |
| `claude-progress.txt` (raiz) | `/commit`, `/start` | log cronologico de sesion |

**Artefactos RPI:** design docs -> `docs/design/YYYY-MM-DD-<topic>.md`; planes -> `plans/YYYY-MM-DD-<feature>.md` (o `implementation_plan.md`); handoffs -> `.claude/handoffs/<slug>-YYYY-MM-DD.md`; QA -> `plans/qa-report-YYYY-MM-DD.md`.

---

## 7. Fresh-Context Delegation

Cuando una tarea es compleja (>5 ficheros, >3 pasos, contexto >50% usado, o independiente del trabajo en curso), el PM delega a un subagente con **contexto limpio**:

1. Escribe el **scope-payload YAML** (ver `AGENT-CONTRACTS.md`): `task`, `files`, `boundaries`, `constraints`, `contexts`, `gate`.
2. **PEGA el contexto relevante** (max 5 ficheros + lineas concretas + patron a seguir), NO digas "lee el fichero X".
3. Invoca al especialista apropiado; recoge resultados; verifica con `/verify`.
4. Registra en `agent-comms.md`.

Contrato de status que TODO especialista devuelve al PM: **`DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`** + ficheros modificados + salida literal de verificacion + Self-Report (`real | aspirational | stub | failing | invented | hallucinated`). El PM **rechaza** marcar DONE si el self-report no es `real` + verificacion en verde.

**Escalacion:** maximo **2 reintentos por etapa**, luego `BLOCKED` + STOP (nunca loop en silencio; nunca el mismo enfoque mas de 2 veces). Al reportar BLOCKED entrega `{que fallo, que intentaste, opciones (re-planificar / saltar / accion manual)}`.

---

## 8. Comandos (`.claude/commands/`, slash-only)

Todos llevan `disable-model-invocation: true` (solo humano/slash). Los activadores de rol siguen el patron command-as-shim: "Lee `.claude/agents/<role>.md` y adopta ese rol".

| Comando | Que hace |
|---------|----------|
| `/pm` | Activa pm-coordinator: carga CLAUDE.md + ROADMAP + DECISIONS + agent-comms + MEMORY, corre `git status`, genera Dashboard; modos Dashboard/Research/Roadmap/Delegate/Decision/Plan/Status/Blockers/Sync. |
| `/check-plan` | Activa plan-checker: localiza el plan, corre las 5 dimensiones, emite PASS/ISSUES_FOUND. **Gate PREVIO.** |
| `/verify` | Activa verifier: identifica que verificar (agent-comms + git log), corre goal-backward, emite VERIFIED/ISSUES_FOUND/INCOMPLETE, reporta a agent-comms. **Gate POSTERIOR.** |
| `/qa` | Activa qa-tester: prereq checks, E2E Playwright, escribe qa-report y loguea. |
| `/design` | Activa system-architect: interrogacion-antes-de-spec + escribe design-doc. Fase Research+Design, previa a `/check-plan`. |
| `/navigate` | Activa codebase-navigator: responde "donde esta X" con `file:line`. Usar antes de delegar. |
| `/backend` `/frontend` `/connector` `/analyst` | Activadores de rol (shim) de los especialistas. |
| `/start` | Onboarding de ENTORNO: install, progress, git log, suite de tests. |
| `/prime` | Cargador de CONTEXTO ligero (mas liviano que /start). Usar antes de delegar. |
| `/sync` | `git pull --rebase` + lee agent-comms/progress; reporta conflictos/BLOCKED/NEEDS_REVIEW. Multi-Claude. |
| `/commit` | `git add` + conventional-commit basado en el diff real + Co-Authored-By + actualiza progress. **Solo PM/usuario integra.** |
| `/review` | Two-stage review sobre `git diff BASE..HEAD` (spec luego quality). |
| `/test` | Corre la suite: `pnpm -w build`, `node --test`/`vitest run`, `tsc --noEmit`. |
| `/handoff` | Invoca skill write-handoff: escribe `.claude/handoffs/<slug>-YYYY-MM-DD.md`. |

---

## 9. Hooks (`.claude/hooks/`, Node — wired en `settings.json`)

Node v22.22 confirmado. Sin dependencias externas. (Windows-friendly: Node `.js`, no bash — parry no es compatible con Windows.)

| Hook | Evento | Matcher | Modo | Que hace |
|------|--------|---------|------|----------|
| `bash-gate.js` | PreToolUse | `Bash` | **DEFAULT-DENY** | DENY_RULES primero (`rm -rf /`, escritura de secretos, `git clean -fdx`, resets en bloque, force-push/publish, install global, `curl\|sh`) -> SAFE_COMMANDS allow-list -> **default DENY** + **catch DENY** (fail-closed, no fail-open). |
| `block-read-gate.js` | PreToolUse | `Read`, `Edit\|Write\|MultiEdit` | deny | Si la sesion activa es un gate read-only (plan-checker/verifier/codebase-navigator), deniega mutaciones (Write/Edit, o Bash mutante). Defense-in-depth sobre la lista de tools. |
| `workflow-guard.js` | PreToolUse | `Edit\|Write\|MultiEdit` | **soft** | Avisa (no bloquea, fail-silent) cuando se edita codigo de produccion sin plan activo; nudge hacia /pm + gates. |
| `quality-check.js` | PostToolUse | `Write\|Edit\|MultiEdit` | **WARN** | Tras editar `.ts/.tsx` bajo `packages/web/src`, corre `tsc --noEmit`; cache SHA256 de tsconfig; filtra errores al fichero editado. exit 0 siempre. |
| `spec-validator.js` | PostToolUse | `Write\|Edit\|MultiEdit` | **WARN** | Tras editar `docs/design/*.md` o `plans/*.md`: front-matter, secciones obligatorias en orden, Non-Goals>=1, tokens `{ns.key}` sin colgar, IDs ADR/D-NN unicos. |

> El hook `bash-gate.js` esta activo a nivel de proyecto: tambien intercepta los Bash del operador. Para probar comandos peligrosos sin disparar el gate, ejecuta el script de test via la herramienta PowerShell (el matcher es `Bash`, no PowerShell).

**Como flipar a bloqueante:** `quality-check.js` y `spec-validator.js` arrancan en WARN. Cambia el `process.exit(0)` de su rama de error a `process.exit(2)` cuando la metodologia madure.

---

## 10. Settings y permisos

- `settings.json` (versionado): allow-list minima de permisos (Read/Glob/Grep + tooling del stack), `deny` de lectura/escritura de ficheros `.env`/secretos, y el wiring de los 5 hooks. **Sin secretos, sin PII, sin el stack claude-flow, sin modelPreferences stale.**
- `settings.local.json` (gitignored): overrides de maquina (allow-list por host de WebFetch, MCP playwright). **NUNCA secretos** — los secretos van a variables de entorno.

---

## 11. Secretos (esto arregla la fuga de TaxIA)

- **NUNCA** committees secretos. Ni en `.env`, ni en `settings.json`, ni en strings de comandos de la allow-list (ese fue el bug de TaxIA: client IDs/secrets/passwords filtrados en entradas `Bash(...)`).
- Documenta las variables requeridas en `.env.example` (solo nombres + comentario, **valores vacios o placeholder**). El `.env` real esta gitignored y nunca se commitea.
- `bash-gate.js` bloquea cualquier escritura a `.env`/ficheros de secretos. `settings.json` deniega su lectura.
- En produccion, los secretos van en variables de entorno del hosting, no en ficheros del repo.

Variables tipicas (ver `.env.example`): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GROQ_API_KEY`, `OLLAMA_BASE_URL`, `ANTHROPIC_API_KEY`, y las API keys opcionales por conector (zero-key-first: la mayoria de fuentes funcionan sin clave).

---

## 12. Quickstart

```
# 1. Onboarding del entorno
/start

# 2. Diseñar una feature (RPI Research+Design)
/design

# 3. Verificar el plan ANTES de implementar (gate previo)
/check-plan

# 4. Orquestar la implementacion en waves
/pm   (modo Delegate)

# 5. Verificar la implementacion (gate posterior)
/verify

# 6. (opcional) E2E
/qa

# 7. Integrar (solo PM, con aprobacion humana)
/commit
```

Ver `AGENT-CONTRACTS.md` para los artefactos producidos/consumidos por cada agente, los completion markers, y el scope-payload YAML exacto.
