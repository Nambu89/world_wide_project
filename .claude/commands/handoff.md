---
name: handoff
description: Invoca la skill write-handoff. Escribe .claude/handoffs/<slug>-YYYY-MM-DD.md con front-matter + secciones de orden fijo para handoff PM->especialista y supervivencia a reset de contexto. Solo humano/slash.
disable-model-invocation: true
---

# /handoff — Escribir checkpoint-and-resume

Invoca la skill local `write-handoff` para producir un documento de handoff que sobreviva a un reset de contexto o sirva de PM->especialista.

## 1. Recopilar el estado real

Antes de escribir, captura el estado verificado (no recordado):

```bash
git rev-parse --abbrev-ref HEAD
git log -1 --oneline
git status --short
```

## 2. Escribir el handoff

Escribe `.claude/handoffs/<slug>-YYYY-MM-DD.md` siguiendo el formato de la skill `write-handoff`:

- **Front-matter**: `name`, `date`, `project`, `branch`, `summary` (el pivote en una linea).
- **Secciones en orden fijo**:
  1. **Resume here — read this first** — primer paso concreto para retomar.
  2. **Goal** — objetivo de la tarea.
  3. **Key findings** — hallazgos de esta sesion.
  4. **Gotchas** — trampas/cuidados.
  5. **How to test & validate** — comandos exactos + criterio de PASS.
  6. **Repo state** — ficheros sin commitear (M/??), ultimo commit (hash), rama.
  7. **Open threads / TODO** — checkboxes ordenados por prioridad.
  8. **Recent transcript** — ultimos ~10 turnos relevantes.

## 3. Entregar el path

Optimiza para re-entrada rapida, no para pulido. Devuelve el path del handoff escrito.
