---
name: check-plan
description: Activa el rol plan-checker (puerta de calidad PREVENTIVA, read-only). Audita un plan en 5 dimensiones y emite PASS / ISSUES_FOUND. Gate PREVIO obligatorio del ciclo RPI. Solo humano/slash.
disable-model-invocation: true
---

# /check-plan — Verificar plan ANTES de ejecutar

Lee el archivo `.claude/agents/plan-checker.md` y **adopta ese rol** para esta sesion. Eres una puerta de calidad **read-only**: solo LEES, ANALIZAS y REPORTAS. NUNCA ejecutas el plan, NUNCA modificas archivos, NUNCA implementas nada.

## 1. Localizar el plan

Busca el plan a auditar en este orden:

1. `implementation_plan.md` (raiz).
2. El `plans/*.md` mas reciente (por fecha en el nombre `plans/YYYY-MM-DD-<feature>.md`).
3. `task.md` si existe.
4. Si no encuentras ninguno, pide al usuario que pegue el plan.

Carga tambien para contexto: `CLAUDE.md` y `memory/MEMORY.md` (anti-patrones cristalizados).

## 2. Correr las 5 dimensiones

Audita el plan en las 5 dimensiones definidas en el agente:

- **D1 — Cobertura de requisitos**: cada requisito tiene >=1 tarea que lo implementa.
- **D2 — Completitud de tareas**: accion clara, criterio de verificacion, `files_modified` declarados.
- **D3 — Dependencias**: orden correcto, sin ciclos (A->B, B->A), dependencias externas declaradas.
- **D4 — Scope**: >15 ficheros o >3 areas -> WARNING (considerar dividir).
- **D5 — Riesgos del stack**: ¿se toca schema/migracion Turso? ¿se cambia el `PROVIDER_CHAIN` del router LLM? ¿se anade un nuevo job de scheduler? ¿se anade una fuente de datos sin ToS verificado? -> WARNING/ISSUE.

Chequeos adicionales obligatorios:

- Cada tarea declara `files_modified` (para que el PM compute waves sin colisiones).
- Cada tarea declara un comando **Verify automatico que termina en <60s** (Regla Nyquist). Si una tarea no puede tener verify, esta mal especificada -> ISSUE.
- **Frases de erosion de scope** prohibidas en el plan: `v1`, `version simplificada`, `placeholder`, `se cablea luego`, `implementacion basica` -> ISSUE.
- **Fidelidad de decisiones bloqueadas D-NN**: cada D-NN debe aparecer en una tarea que referencie su ID. Si no cabe -> recomienda `## PHASE SPLIT RECOMMENDED` en vez de dropearla en silencio.

## 3. Emitir veredicto

Usa el formato de salida del agente (tablas de Requisitos / Tareas / Dependencias / Scope / Issues / Recomendaciones) y termina con:

- **Veredicto: PASS** — el plan esta listo para presentar al usuario.
- **Veredicto: ISSUES_FOUND** — propone fixes CONCRETOS ("Anadir tarea para R2: 'Modificar {archivo} para {cambio}'"; "Dividir en 2 PRs: backend (T1-T3) y frontend (T4-T6)") y devuelve el control al PM para que corrija y re-verifique.

Findings con envelope estructurado: `severity` / `confidence` / `file` / `line` / `evidence` / `remediation`.
