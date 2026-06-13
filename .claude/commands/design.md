---
name: design
description: Activa el rol system-architect (fase Research+Design del RPI). Corre interrogacion-antes-de-spec y escribe docs/design/YYYY-MM-DD-<topic>.md con formato de seccion-fija. Previo a /check-plan. Solo humano/slash.
disable-model-invocation: true
---

# /design — Autoria de documento de diseno (fase Research+Design del RPI)

Lee el archivo `.claude/agents/system-architect.md` y **adopta ese rol** para esta sesion. Eres el unico que escribe en `docs/design/`. **NO implementas codigo** (frontera dura: solo docs). Usa la skill local `design-doc`.

## 1. Interrogacion-antes-de-spec (exploracion silenciosa primero)

Antes de preguntar nada, explora el contexto en silencio (lee CLAUDE.md, el codigo cosechado relevante via `codebase-navigator` si hace falta, los ADR existentes). **No preguntes lo que el codigo ya revela.**

Clasifica los requisitos en:

- **KNOWN** — lo que el codigo/contexto ya deja claro.
- **ASSUMED** — lo que asumes y debe confirmarse.
- **UNKNOWN** — lo que hay que preguntar.

Luego haz **UNA pregunta por mensaje** (multiple-choice con opcion recomendada), priorizando arquitectura > comportamiento > naming, hasta ~10 preguntas. Cuando tengas suficiente, propone **2-3 enfoques con tradeoffs** (pros/contras/esfuerzo/riesgo) + una recomendacion.

## 2. Escribir el design-doc

Tras aprobacion explicita del enfoque, escribe `docs/design/YYYY-MM-DD-<topic>.md` con el formato de seccion-fija de la skill `design-doc`:

- **Front-matter**: `version`, `name`, `description` (one-paragraph denso que captura la esencia).
- **Secciones obligatorias en orden**: Overview > Goals > Non-Goals (>=1) > Decisions (D-NNN con razon) > Interfaces/Data Contracts > Do's and Don'ts (con razon) > Risks > Iteration Guide > Known Gaps.
- **Token-references** `{namespace.key}` para decisiones/valores compartidos (cada referencia debe resolver a una definicion en el doc).

## 3. Auto-revision

Antes de entregar, auto-revisa el doc contra el schema (front-matter presente, todas las secciones en orden, >=1 Non-Goal, sin `{token}` colgante, IDs D-NNN unicos). El hook `spec-validator.js` lo validara tambien al guardar.

## 4. Entregar al PM

Devuelve el path del doc al PM. El siguiente paso del RPI es `/check-plan` (sobre el plan derivado del diseno), nunca implementacion directa.
