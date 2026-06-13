---
name: prime
description: Cargador de CONTEXTO ligero (mas liviano que /start). git log/status/diff, lee CLAUDE.md->memory/MEMORY.md, tail agent-comms.md + claude-progress.txt, tests/build solo si hay cambios sin commitear. Usar antes de delegar. Solo humano/slash.
disable-model-invocation: true
---

# /prime — Cargar contexto (ligero)

Cargador de CONTEXTO para productividad diaria y **antes de delegar a un subagente** (extraer contexto fresco). Mas liviano que `/start`: NO reinstala ni corre la suite completa salvo que haya cambios sin commitear.

Distincion: **`/start` comprueba el ENTORNO** (onboarding), **`/prime` carga el CONTEXTO** (dia a dia).

## 1. Estado de git

```bash
git log --oneline -10
git status --short
git diff --stat HEAD~1 2>/dev/null
```

## 2. Leer documentacion y memoria

Lee en orden: `CLAUDE.md` -> los `CLAUDE.md` descendientes relevantes (por package) -> `memory/MEMORY.md`.

## 3. Estado del blackboard

```bash
tail -60 agent-comms.md 2>/dev/null
tail -30 claude-progress.txt 2>/dev/null
```

Identifica tareas **IN_PROGRESS** / **BLOCKED** / **NEEDS_REVIEW** pendientes.

## 4. Tests/build SOLO si hay cambios

Si `git status` muestra cambios sin commitear, corre una verificacion rapida:

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Si no hay cambios, salta este paso.

## 5. Reporte "Contexto cargado"

Emite un resumen fijo:

```
# Contexto cargado
- Rama: {rama} | Ultimo commit: {hash} {msg}
- Cambios sin commitear: {N} ({lista corta})
- En progreso: {de agent-comms}
- Blockers: {de agent-comms, o "ninguno"}
- Ultima sesion (progress): {1 linea}
```
