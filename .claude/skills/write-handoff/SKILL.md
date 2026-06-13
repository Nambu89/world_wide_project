---
name: write-handoff
description: Use when terminas una fase, el contexto se acerca al limite, o el PM va a pasar el trabajo a un especialista — escribe .claude/handoffs/<slug>-YYYY-MM-DD.md con front-matter (name/date/project/branch/summary) y secciones de orden fijo (Resume-here / Goal / Key-findings / Gotchas / How-to-test / Repo-state / Open-threads / Recent-transcript). Optimizado para re-entrada rapida tras reset de contexto o handoff PM->especialista.
---

# Skill: Write Handoff

> Protocolo checkpoint-and-resume (de codegraph). Un handoff es un fichero datado que permite a una sesion fresca (o a otro agente) retomar el trabajo en marcha sin perder contexto. Optimiza la re-entrada rapida sobre el pulido.

## Cuando usar esta skill

- Terminas una fase de trabajo (aunque no este "completa").
- El contexto se acerca al limite de la ventana (riesgo de context rot).
- El PM va a delegar a un especialista y quiere pasarle contexto fresco curado.
- Antes de un `/clear` o de una compactacion previsible.

## Donde se escribe

`.claude/handoffs/<slug>-YYYY-MM-DD.md` — un fichero por handoff, con slug descriptivo y fecha. Committeado a git (durable, greppable).

## Front-matter obligatorio

```yaml
---
name: <slug-descriptivo>-YYYY-MM-DD
date: YYYY-MM-DD HH:MM
project: world_wide_project
branch: <rama-git-actual>
summary: <el punto de pivote / estado en una linea>
---
```

## Secciones de ORDEN FIJO

Escribe siempre estas secciones, en este orden:

### 1. Resume here — read this first
Lo primero que el siguiente agente debe hacer, en 1-3 bullets imperativos. "Empieza por X. El bloqueo actual es Y. No toques Z."

### 2. Goal
Que se intenta conseguir (el objetivo de la fase), no como.

### 3. Key findings (this session)
Lo que se descubrio: decisiones tomadas (con sus `D-NNN` si aplica), hechos del codigo (`packages/.../file.ts:line`), resultados de investigacion.

### 4. Gotchas
Trampas y sorpresas: rate limits descubiertos, fuentes fragiles, tipos que no encajan, comportamientos no obvios. Lo que te habria ahorrado tiempo saber antes.

### 5. How to test & validate
Los comandos EXACTOS para validar el estado, con el criterio de exito. Regla Nyquist (<60s):

```bash
pnpm -w build
node --test packages/connectors/finance
tsc --noEmit
git diff --stat
```

"Pasa si: build verde, los N tests del conector en verde, sin errores de tsc."

### 6. Repo state
Estado del repo en este instante:
- Ficheros sin commitear con marca `M` (modificado) / `??` (nuevo).
- Hash del ultimo commit + rama.
- Tablas Turso tocadas / migraciones pendientes (si aplica).

### 7. Open threads / TODO
Checkboxes ordenados por prioridad. Lo que queda, lo que se difirio (con razon), y los `BLOCKED` con `{que fallo, que se intento, opciones}`.

```markdown
- [ ] (ALTA) Registrar conector markets en server.ts
- [ ] (MEDIA) Anadir job de scheduler 15m
- [ ] (DIFERIDO) Cache ETag — la fuente no envia ETag estable (deferido con razon)
- [ ] (BLOCKED) Migracion Turso de la tabla snapshots — falta decision de schema (D-NNN pendiente)
```

### 8. Recent transcript (last ~10 turns)
Resumen de los ultimos ~10 turnos de conversacion relevantes, para que el siguiente agente entienda como se llego aqui. No literal; comprimido a lo que importa.

## Plantilla completa

```markdown
---
name: markets-connector-2026-06-08
date: 2026-06-08 17:30
project: world_wide_project
branch: feat/finance-connectors
summary: Conector markets implementado y verificado; falta wiring en server.ts y job de scheduler.
---

## Resume here — read this first
- Empieza registrando `getMarketsSingleFlight` en server.ts.
- El conector ya pasa sus tests; el bloqueo es la decision de intervalo del scheduler.

## Goal
Conectar la fuente de mercados (keyless) y persistir snapshots en Turso.

## Key findings (this session)
- Fuente keyless confirmada, ToS permite uso programatico (D-005, ToS verificado).
- Patron single-flight + serve-stale aplicado (dataset moderado).

## Gotchas
- La fuente devuelve 429 si superas ~30 req/min; el job a 15m esta muy por debajo.

## How to test & validate
\`\`\`bash
pnpm -w build
node --test packages/connectors/finance
\`\`\`
Pasa si: build verde + 4 tests del conector en verde.

## Repo state
- M packages/connectors/finance/markets.ts
- ?? packages/connectors/finance/markets.test.ts
- Ultimo commit: a1b2c3d en feat/finance-connectors

## Open threads / TODO
- [ ] (ALTA) Wiring en server.ts
- [ ] (MEDIA) Job scheduler 15m + saveSnapshot
- [ ] (BLOCKED) Schema de la tabla snapshots (D-NNN pendiente del PM)

## Recent transcript (last ~10 turns)
PM delego el conector markets -> investigue ToS -> implemente patron osiris ->
añadi single-flight -> escribi tests -> verifique en verde -> handoff aqui.
```

## Reglas
- Optimiza re-entrada rapida sobre pulido: prefiere bullets concretos a prosa.
- Pega comandos EXACTOS y criterios de exito, no "corre los tests".
- Nunca borres handoffs antiguos: son historial.
- El handoff complementa el file-blackboard (`agent-comms.md`, `claude-progress.txt`); no lo sustituye.

## Frontera
**Nunca commit/push/tag** como parte del handoff (salvo que el PM lo pida explicitamente). Escribes el handoff y reportas; el PM integra.
