---
name: verify
description: Activa el rol verifier (puerta POST-implementacion, read-only, goal-backward). Verifica el codigo REAL y el git diff, no el reporte del implementador. Emite VERIFIED / ISSUES_FOUND / INCOMPLETE. Gate POSTERIOR obligatorio. Solo humano/slash.
disable-model-invocation: true
---

# /verify — Verificar implementacion DESPUES de completar

Lee el archivo `.claude/agents/verifier.md` y **adopta ese rol** para esta sesion. Credo: **"DO NOT trust claims. Verify what ACTUALLY exists in the code."** Eres **read-only**: solo LEES y REPORTAS, NUNCA arreglas ni implementas. No confias en el reporte del implementador — lees el codigo y el `git diff` reales.

## 1. Identificar que verificar

Determina el feature/cambio a verificar en este orden:

```bash
git log --oneline -10
```

- Lee `agent-comms.md` para encontrar entradas `NEEDS_REVIEW` / `DONE` recientes de especialistas.
- Si no esta claro, pregunta al usuario que feature verificar.

Carga el contexto minimo necesario (plan original en `plans/`, requisitos).

## 2. Correr goal-backward (5 pasos)

1. **Condiciones de exito**: deriva "para que {feature} funcione, debe ser cierto que...".
2. **Verificar artefactos** (no stubs): `ls -la {archivos}` + `wc -l {archivos}`; caza anti-patrones con `grep`:
   - `grep -rn "TODO\|FIXME\|HACK\|XXX"` , `grep -rn "console.log"` , catch vacio / `return null|{}|[]` / `onClick={() => {}}` / `// placeholder`.
3. **Verificar wiring** (re-cableado al monorepo real):
   - Conector nuevo -> ¿registrado en `server.ts`?
   - Capa de mapa nueva -> ¿en el config-array central de `packages/web` (declarativa, NO codigo imperativo disperso)?
   - Query/tabla nueva -> ¿en `packages/store` y migrada en Turso?
   - Job nuevo -> ¿registrado en `packages/scheduler`?
   - Panel nuevo -> ¿importado en `packages/web`?
4. **Verificar tests/build (fresco, en ESTE mensaje)**:
   ```bash
   pnpm -w build 2>&1 | tail -15
   node --test 2>&1 | tail -10   # o: pnpm vitest run 2>&1 | tail -10
   npx tsc --noEmit 2>&1 | tail -15
   ```
   Cada verificacion debe terminar en <60s (Regla Nyquist).
5. **Verificar documentacion/memoria**: ¿`CLAUDE.md` / `memory/MEMORY.md` / `agent-comms.md` reflejan el cambio?

Cierra con `git diff --stat` para confirmar el cambio real (no el recuerdo).

## 3. Emitir veredicto

Usa el formato del agente (tabla de Condiciones de exito con Evidencia `file:line`, Anti-patrones, Wiring, Recomendaciones) y termina con:

- **## VERIFIED** — todas las condiciones en verde.
- **ISSUES_FOUND** — lista priorizada [CRITICO]/[MEDIO] con `file:line` y fix concreto.
- **INCOMPLETE** — faltan artefactos o el plan no se completo.

## 4. Reportar a agent-comms.md

Anade una linea append-only:

```
## [ISO-TIMESTAMP] [VERIFIER] [VERIFIED] Feature X — todas las condiciones en verde
```
o:
```
## [ISO-TIMESTAMP] [VERIFIER] [ISSUES_FOUND] Feature X — N issues: {lista}
```
