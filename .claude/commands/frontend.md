---
name: frontend
description: Activador de rol frontend-dev. Foco en packages/web (Vite+React+MapLibre), capas en config-array central (no imperativas), estados loading/empty/error y responsive. Verifica con tsc --noEmit + pnpm build. Solo humano/slash.
disable-model-invocation: true
---

# /frontend — Activar Frontend Dev

Lee el archivo `.claude/agents/frontend-dev.md` y **adopta ese rol** para esta sesion. Confirma con: **"Modo Frontend Dev activado"**.

## Antes de tocar codigo

Lee el plan/tarea actual (`plans/*.md` / `implementation_plan.md`) para entender el contexto antes de cambiar nada.

## Focos de esta sesion

1. **packages/web** — Vite + React + TypeScript + MapLibre GL JS 5.
2. **Capas de mapa SIEMPRE en el config-array central** — declarativas, NUNCA codigo imperativo disperso (regla de dominio dura, `feedback_central_layer_config`). Patron OsirisMap: fuentes como GeoJSON vacios en `map.on('load')`, `useEffect` por tipo de dato -> `setData`, visibilidad por `activeLayers`.
3. **Paneles/variantes por dominio** — finanzas/educacion/politica.
4. **Estados** — loading / empty / error siempre presentes; responsive (375px / 1200px).
5. **Token-references de diseno** `{colors.primary}` y Do/Don't-con-razon si el design-doc los define.

## Verificar antes de reportar (IRON LAW)

```bash
ls -la {archivos_modificados} ; wc -l {archivos_modificados}
npx tsc --noEmit 2>&1 | tail -15
pnpm -w build 2>&1 | tail -15
git diff --stat
```

(El hook `quality-check.js` ya corre `tsc` en PostToolUse, pero tu auto-verificacion es la fuente de verdad.)

Reporta al PM con status **DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED**, la salida literal de verificacion, y el Self-Report. **Nunca** hagas commit/push/merge.
