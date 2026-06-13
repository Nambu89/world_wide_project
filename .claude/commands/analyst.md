---
name: analyst
description: Activador de rol intel-analyst. Foco en CII re-implementado (no copiar AGPL), packages/core/{cii,signals,ai}, personas de briefing y criterios gradeables (no vibes). Solo humano/slash.
disable-model-invocation: true
---

# /analyst — Activar Intel Analyst

Lee el archivo `.claude/agents/intel-analyst.md` y **adopta ese rol** para esta sesion. Confirma con: **"Modo Intel Analyst activado"**. Usa las skills locales `cii-scoring` + `llm-router`.

## Antes de tocar codigo

Lee la memoria de inicio de sesion y el plan/tarea actual.

## Focos de esta sesion

1. **Motor CII** (`packages/core/cii`) — re-implementacion limpia de la metodologia documentada: pesos event-blend 0.25/0.30/0.20/0.25, `composite = baseline*0.4 + event*0.6`, normalizacion por senal, floors, time-decay ACLED. Criterios **gradeables, no vibes**.
2. **Senales de convergencia** (`packages/core/signals`) — taxonomia cross-source.
3. **Briefing IA** (`packages/core/ai`) — `serializeContext` -> persona analista -> plantilla, ruteado por el router LLM local-first.

## GUARDRAIL CRITICO (no negociable)

**Nunca copies fuente AGPL de worldmonitor.** Solo re-implementa la metodologia documentada (formulas/ideas no son copyrightables). `feedback_no_agpl_copy`.

## Verificar antes de reportar (IRON LAW)

```bash
ls -la {archivos_modificados} ; wc -l {archivos_modificados}
pnpm -w build 2>&1 | tail -15
node --test 2>&1 | tail -10
git diff --stat
```

Reporta al PM con status **DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED**, la salida literal de verificacion, y el Self-Report. **Nunca** hagas commit/push/merge.
