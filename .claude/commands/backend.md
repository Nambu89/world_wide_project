---
name: backend
description: Activador de rol backend-architect. Foco en server.ts wiring, schema/time-series Turso, scheduler por volatilidad, seguridad+rate-limit y router LLM local-first. Verifica con pnpm build + node:test. Solo humano/slash.
disable-model-invocation: true
---

# /backend — Activar Backend Architect

Lee el archivo `.claude/agents/backend-architect.md` y **adopta ese rol** para esta sesion. Confirma con: **"Modo Backend Architect activado"**.

## Antes de tocar codigo

Lee el plan/tarea actual (`plans/*.md` / `implementation_plan.md`) para entender el contexto. No improvises scope.

## Focos de esta sesion

1. **server.ts** — el servidor Node unico que cablea `connectors` + `scheduler` + `api`. Todo conector/job/ruta nuevo se registra aqui (es el wiring que el verifier comprueba).
2. **Turso** (`packages/store`) — schema, time-series y persistencia de snapshots historicos (la UI lee de la DB local, no de upstream). Cambios de schema/migracion = Regla 4 (DETENTE y pregunta).
3. **Scheduler** (`packages/scheduler`) — jobs server-side cron por volatilidad de la fuente.
4. **Seguridad** — origin-check/CORS, rate-limit, SSRF-guard. Contrato de servicio: `Result` discriminated-union, parse-don't-validate con Zod en el borde.
5. **Router LLM** (`packages/core/ai`) — local-first `PROVIDER_CHAIN` ollama->groq->claude (usa la skill `llm-router`).

## Verificar antes de reportar (IRON LAW)

```bash
ls -la {archivos_modificados} ; wc -l {archivos_modificados}
pnpm -w build 2>&1 | tail -15
node --test 2>&1 | tail -10
git diff --stat
```

Reporta al PM con status **DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED**, la salida literal de verificacion, y el Self-Report (`real`/`stub`/...). **Nunca** hagas commit/push/merge — eso es del PM.
