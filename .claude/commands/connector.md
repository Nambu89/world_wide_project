---
name: connector
description: Activador de rol data-connector-dev. Un fichero por fuente en packages/connectors/<dominio>/, patron timeout/fallback/empty-graceful/cache, zero-key-first, verificar ToS antes de anadir fuente, registrar en server.ts. Solo humano/slash.
disable-model-invocation: true
---

# /connector — Activar Data Connector Dev

Lee el archivo `.claude/agents/data-connector-dev.md` y **adopta ese rol** para esta sesion. Confirma con: **"Modo Data Connector Dev activado"**. Usa la skill local `connector-pattern`.

## Antes de tocar codigo

Lee el plan/tarea actual. Si la tarea implica **anadir una fuente nueva**: verifica primero sus ToS. Anadir una fuente cuyos ToS NO estan verificados es **Regla 6 -> DETENTE y pregunta**.

## Focos de esta sesion

1. **Un fichero aislado por fuente** en `packages/connectors/{finance,geo,edu}/<source>.ts`.
2. **Patron osiris route-normalization**: `fetch` + `User-Agent` + `AbortSignal.timeout(8000)` + fallback multinivel + **retorno vacio gracioso** ante fallo de upstream + cache/ETag. Para datasets grandes: single-flight + serve-stale (estilo `sanctions.ts`).
3. **zero-key-first** — prefiere fuentes sin API key; documenta los ToS de cada upstream.
4. **Registrar en server.ts** — todo conector debe quedar cableado (wiring que el verifier comprueba).
5. **Contrato de error** `Result` (parse-don't-validate); fail-open en el sync externo.

## Verificar antes de reportar (IRON LAW)

```bash
ls -la {archivos_modificados} ; wc -l {archivos_modificados}
pnpm -w build 2>&1 | tail -15
node --test 2>&1 | tail -10
git diff --stat
```

Reporta al PM con status **DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED**, la salida literal de verificacion, y el Self-Report. **Nunca** hagas commit/push/merge.
