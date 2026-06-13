---
name: sync
description: git pull --rebase, lee agent-comms.md + claude-progress.txt, reporta conflictos / agentes BLOCKED / tareas NEEDS_REVIEW / cambios recientes que afectan el trabajo actual. Para workflows multi-Claude. Solo humano/slash.
disable-model-invocation: true
---

# /sync — Sincronizar con el equipo (multi-Claude)

Runbook para sincronizar el workspace cuando varios Claude/agentes trabajan en paralelo.

## 1. Traer cambios

```bash
git pull --rebase 2>&1 | tail -20
```

Si hay **conflictos de rebase**, NO los resuelvas a ciegas: reporta los ficheros en conflicto y DETENTE para decidir con el usuario. PROHIBIDO `git clean -fdx` y resets en bloque (pueden destruir trabajo de un agente hermano en otro worktree).

## 2. Leer el blackboard

```bash
cat agent-comms.md 2>/dev/null | tail -80
cat claude-progress.txt 2>/dev/null | tail -40
```

## 3. Reportar

Emite un resumen orientado a coordinacion:

- **Conflictos git**: {ficheros, o "ninguno"}.
- **Agentes BLOCKED**: {de agent-comms — quien, por que}.
- **Tareas NEEDS_REVIEW**: {pendientes de verificar}.
- **Cambios recientes que afectan tu trabajo actual**: {commits/ficheros que tocan lo que estas haciendo}.
- **Siguiente paso sugerido**.
