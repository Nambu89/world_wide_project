---
name: start
description: Onboarding de ENTORNO. Instala deps, lee progreso/log/README, corre la suite del stack (node --test / pnpm build) y reporta rama/cambios/estado-tests/problemas. Incluye estrategia de compactacion. Solo humano/slash.
disable-model-invocation: true
---

# /start — Onboarding de entorno

Runbook para arrancar a trabajar en **world_wide_project**. Comprueba el ENTORNO (para cargar solo CONTEXTO usa `/prime`).

## 1. Instalar dependencias

```bash
pnpm install
```

Si falla, reporta el error exacto (version de Node, lockfile desincronizado, etc.) y DETENTE — no improvises instalaciones globales.

## 2. Leer progreso y log

```bash
cat claude-progress.txt 2>/dev/null | tail -40
git log --oneline -10
git rev-parse --abbrev-ref HEAD
git status --short
```

## 3. Primera vez

Si es la primera vez en el repo, lee `README.md` y `CLAUDE.md` (y los `CLAUDE.md` de cada package si existen) para entender el contrato, la arquitectura del monorepo (`packages/{connectors,core,store,scheduler,web}` + `server.ts`) y las house-rules.

## 4. Correr la suite del stack

```bash
pnpm -w build 2>&1 | tail -15
node --test 2>&1 | tail -10        # o: pnpm vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -15
```

## 5. Reportar estado

Emite un resumen: **rama** / **cambios sin commitear** / **estado de tests (verde/rojo)** / **problemas detectados**. Si la suite esta en rojo en baseline, repórtalo y NO continues en silencio.

## 6. Estrategia de compactacion

Si el contexto se comprime durante la sesion, re-lee en este orden para recuperar el estado:

1. `CLAUDE.md` (+ el descendiente relevante).
2. `memory/MEMORY.md`.
3. `agent-comms.md` (ultimas entradas).
4. `claude-progress.txt`.

Luego pregunta al usuario que tarea abordar.
