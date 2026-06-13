---
name: false-positive-id-dup
description: El linter spec-validator marca "IDs ADR/D duplicados" en planes de implementacion; es un falso positivo conocido
metadata:
  type: project
---

El hook `spec-validator.js` aplica el schema de *design-doc* (que exige IDs `ADR-NNN`/`D-NNN` unicos, definidos una sola vez) a los *planes de implementacion*. Un plan REFERENCIA las mismas decisiones varias veces a proposito (en `constraints` de cada tarea y en la matriz de cobertura) = trazabilidad de cobertura, no re-definicion.

**Why:** Las decisiones se DEFINEN una vez en `plans/DECISIONS.md` (ADR) o en el design-doc `§Decisions`; el plan solo las cita para atar tarea→decision.

**How to apply:** Al auditar un plan, NO cuentes los IDs repetidos como issue. Solo es issue si dos referencias al mismo id se CONTRADICEN en contenido (p.ej. una tarea dice "claude activo" y otra "ollama-only" citando el mismo D-004). Verificar contra [[env-vars-canonical]] cuando la contradiccion sea sobre config.
