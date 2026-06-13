---
name: test
description: Corre la suite del stack (pnpm -w build, node --test / vitest run, tsc --noEmit), analiza fallos o actualiza claude-progress.txt al pasar. Cobertura opcional. Solo humano/slash.
disable-model-invocation: true
---

# /test — Correr la suite del stack

Runbook de testing/build para el monorepo.

## 1. Build + tests + typecheck

```bash
pnpm -w build 2>&1 | tail -20
node --test 2>&1 | tail -15        # o: pnpm vitest run 2>&1 | tail -15
npx tsc --noEmit 2>&1 | tail -20
```

Cada verificacion debe terminar en <60s (Regla Nyquist). Si una tarea no tiene check automatico, esta mal especificada.

## 2. Analizar resultados

- **En verde**: anade una linea a `claude-progress.txt` con fecha ISO y "suite OK ({N} tests)".
- **En rojo**: NO declares "arreglado" sin re-correr. Analiza el fallo, identifica root cause (no parches), arregla respetando las Reglas de Desviacion, y re-corre la verificacion en ESTE mismo mensaje. Tras 2 intentos fallidos sobre el mismo problema -> BLOCKED.

## 3. Cobertura (opcional)

Si el usuario lo pide:

```bash
pnpm vitest run --coverage 2>&1 | tail -25
```

Reporta los modulos con baja cobertura sin inventar numeros.
