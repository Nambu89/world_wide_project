---
version: alpha
name: plan-ofac-sanctions
description: Completar Finanzas — señal de sanciones OFAC por-país (Approach B: conector keyless + persistencia + briefing, SIN UI). Conector OpenSanctions us_ofac_sdn simple.csv (keyless, CC BY-NC personal-OK) → agrega entidades sancionadas por país (ISO-2 vía Intl.DisplayNames + mini-alias) → tabla sanctions (migr 006) → bloque en el briefing. Diseño aprobado (brainstorming). ponytail: mínimo código, stdlib-first, sin UI (slice de superficie diferido). Pendiente de /check-plan.
status: draft
date: 2026-06-16
owner: pm-coordinator
---

# Plan — Sanciones OFAC por-país (Finanzas, Approach B)

- **Fecha:** 2026-06-16 · **Autor:** PM · **Diseño aprobado por el usuario** (brainstorming).
- **Enfoque:** B (conector + persistencia + briefing, SIN UI) — mismo patrón que el motor de convergencia (rebanada 4). ponytail.

## Goal
Señal autoritativa de **intensidad de sanciones OFAC por país** (nº de entidades en la SDN list por país), persistida + en el briefing. Distinta del GKG `trade_sanctions` (news). Keyless. SIN capa de mapa / API / panel (slice de superficie diferido, NG-1). License-clean: OpenSanctions CC BY-NC = **uso personal OK** + atribución.

## Realidad verificada EN VIVO (fuente, no asumida)
- **OpenSanctions `us_ofac_sdn`**: bulk **keyless** (solo la API es keyed). `targets.simple.csv` (~7 MB) en `https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv`.
- Columnas (header real): `id,schema,name,aliases,birth_date,countries,addresses,identifiers,sanctions,phones,emails,program_ids,dataset,first_seen,last_seen,last_change`. **`countries` = ISO-3166 alpha-2 minúscula, `;`-separado** (p.ej. `ke;ss`). CSV **entrecomillado** (comas dentro de quotes → parseo quote-aware, NO `split(',')`).
- **License = CC BY-NC 4.0** (NonCommercial; el seed decía CC-BY, corregido). Uso personal del proyecto = compatible + atribución requerida.

## Tasks (numeración T-35+, continúa tras T-34)

### T-35 — `packages/store/` migración 006 + SanctionRow + API
```yaml
id: T-35
agent: backend-architect
wave: A
depends_on: []
files_modified:
  - packages/store/migrations/006_sanctions.sql   # NUEVA: sanctions + índice
  - packages/store/src/types.ts                     # SanctionRow (camelCase)
  - packages/store/src/index.ts                     # insertSanctions/getLatestSanctions + purge
  - packages/store/test/store.test.ts
constraints:
  - "ADR-006 @libsql/client. Schema: sanctions(id PK AUTOINCREMENT, country TEXT NOT NULL, sanctioned_count INTEGER NOT NULL, captured_at INTEGER NOT NULL) + INDEX ix_sanctions_country_time(country, captured_at)."
  - "C-2/W-2: migración 006 (001..005 ya existen); idempotente vía _migrations; sin comentario '--' antes de un statement en el mismo chunk; el test assertea sqlite_master."
  - "L-1: SanctionRow camelCase {id?, country, sanctionedCount, capturedAt}. insertSanctions(rows) append; getLatestSanctions() = último por país (MAX(captured_at)); purgeAndDownsample extendido a sanctions."
acceptance: ["exporta SanctionRow+insert+getLatest", "migrate crea sanctions idempotente sin tocar otras tablas (sqlite_master)", "getLatestSanctions 1 fila/país (≥2 snapshots sembrados)", "purge sanctions sin tocar el resto"]
verify_cmd: "pnpm --filter @www/store exec tsc --noEmit && node --import tsx --test packages/store/test/*.ts"
```

### T-36 — `packages/connectors/finance/sanctions.ts` (conector keyless)
```yaml
id: T-36
agent: data-connector-dev
wave: B
depends_on: [T-35]
files_modified:
  - packages/connectors/finance/sanctions.ts       # NUEVO conector
  - packages/connectors/finance/sanctions.test.ts   # NUEVO
  - packages/connectors/index.ts                     # barrel: fetchSanctions
boundaries: ["SOLO packages/connectors. Importa SanctionRow + ConnectorResult de @www/store/../types (store dist YA reconstruido por el PM tras T-35). NO toques el scheduler/server (lo cabléa T-37/PM)."]
constraints:
  - "Patrón osiris (skill connector-pattern): fetch OpenSanctions latest/us_ofac_sdn/targets.simple.csv + User-Agent + AbortSignal.timeout(15000) (7MB) + single-flight + serve-stale (lastGood TTL ~25h, cambia lento) + retorno vacío gracioso (NUNCA throw) + log por caída."
  - "Parseo CSV QUOTE-AWARE (hand-roll ~20 líneas, sin dep nueva): respeta campos entrecomillados con comas; si detectas newline embebido en un campo (rompe el parseo línea-a-línea) → para y reporta NEEDS_CONTEXT/escala (no lo asumas resuelto)."
  - "Solo se usan las columnas `countries` (índice fijo) y opcionalmente `schema`. Agrega: por cada fila, split countries por ';' → por cada ISO-2, incrementa conteo. ISO-2 → nombre canónico vía `new Intl.DisplayNames(['en'],{type:'region'}).of(iso.toUpperCase())` (stdlib) + mini-mapa CANONICAL_ALIASES para divergencias con el set del proyecto (p.ej. 'Congo - Kinshasa'→'Congo (Kinshasa)', 'Palestine'→'Palestinian Territories', 'Czechia'→'Czech Republic', 'Myanmar (Burma)'→'Myanmar'). Nombre no resuelto/desconocido → drop gracioso."
  - "Devuelve ConnectorResult<SanctionRow> con SanctionRow {country, sanctionedCount, capturedAt}. Atribución en comentario + ToS: OpenSanctions CC BY-NC (uso personal), https://www.opensanctions.org/licensing/."
acceptance: ["fetchSanctions agrega por país desde un fixture CSV (quote-aware, comas dentro de quotes) → conteos correctos", "ISO-2→nombre vía Intl.DisplayNames + alias (ru→Russia, kp→North Korea, cd→Congo (Kinshasa)); ISO basura→drop", "nunca lanza (HTTP fail/timeout/CSV malo → vacío)", "barrel exporta fetchSanctions"]
verify_cmd: "pnpm --filter @www/connectors exec tsc --noEmit && node --import tsx --test packages/connectors/finance/sanctions.test.ts"
```

### T-37 — `packages/scheduler/` job `sanctions` (tier slow)
```yaml
id: T-37
agent: backend-architect
wave: C
depends_on: [T-35, T-36]
files_modified: [packages/scheduler/src/index.ts, packages/scheduler/test/scheduler.test.ts]
boundaries: ["NO toques server.ts (firma defaultJobs intacta) ni otros jobs. AÑADE job 'sanctions'."]
constraints:
  - "ADR-004 persiste-antes-de-servir. SchedulerDeps gana fetchSanctions (@www/connectors) + insertSanctions (@www/store); REAL_STORE_AI_DEPS + loadDefaultConnectors añaden lo necesario. defaultJobs AÑADE job 'sanctions' tier 'slow' (sanciones cambian lento): fetchSanctions → if data.length>0 insertSanctions. +@www/connectors ya es dep del scheduler."
acceptance: ["defaultJobs incluye 'sanctions' tier slow; ejecutarlo llama fetchSanctions+insertSanctions (mocks)", "jobs existentes intactos; firma defaultJobs sin cambios; tests de conteo/orden actualizados"]
verify_cmd: "pnpm --filter @www/scheduler exec tsc --noEmit && node --import tsx --test packages/scheduler/test/*.ts"
```

### T-38 — `packages/core/ai/` bloque de sanciones en el briefing
```yaml
id: T-38
agent: intel-analyst
wave: B
depends_on: [T-35]
files_modified: [packages/core/ai/src/briefing.ts, packages/core/ai/src/index.ts, packages/core/ai/test/ai.test.ts]
boundaries: ["NO toques router/proveedor (ADR-009) ni store/scheduler/connectors. Importa getLatestSanctions + SanctionRow de @www/store."]
constraints:
  - "D-005 sin LLM nuevo. buildSanctionsContext(latest: SanctionRow[]): string — top-N por sanctionedCount ('Países bajo más sanciones OFAC: <país> (<N>) …'); '' si vacío (patrón buildRiskContext/buildConvergenceContext). serializeContext gana un parámetro `sanctions` e inserta el bloque (omitido si ''); generateDailyBriefing lee getLatestSanctions() y lo pasa. Caché D-106 intacta."
acceptance: ["buildSanctionsContext bloque con datos sembrados; '' si vacío", "serializeContext incluye el bloque; sin proveedor nuevo; suite core-ai verde"]
verify_cmd: "pnpm --filter @www/core-ai exec tsc --noEmit && node --import tsx --test packages/core/ai/test/*.ts"
```

## Wave Scheduler
`A(T-35 store) → [PM: rebuild store dist] → B(T-36 connector ‖ T-38 briefing — paquetes disjuntos, ambos importan de @www/store) → [PM: rebuild connectors dist] → C(T-37 scheduler)`. PM corre tsc global + suite al cerrar.

## Non-Goals (ponytail)
Sin `/api/sanctions`, sin capa de mapa, sin panel (slice de superficie diferido — como convergencia NG-4). Sin lista SDN completa ni búsqueda de entidades. Sin top-programas por país (YAGNI; solo conteo). Sin FRED/EIA (keyed). NO tocar CII/convergencia.

## Riesgos
| Riesgo | Mitigación | Tarea |
|--------|-----------|-------|
| CSV con newline embebido en campo rompe parseo línea-a-línea | T-36 detecta y escala (no asume); fixture cubre comas-en-quotes | T-36 |
| 7MB en 8s timeout | timeout 15s + serve-stale + vacío gracioso | T-36 |
| ISO→nombre no casa con set del proyecto | Intl.DisplayNames + CANONICAL_ALIASES para divergencias; drop graceful (como FIPS) | T-36 |
| License CC BY-NC (no CC-BY) | uso personal del proyecto = OK + atribución; flag si comercializa | doc |
| Path con fecha | usar alias `latest/` | T-36 |

## Verificación final
1. Rebuild dist store+connectors+core-ai. Global tsc + suite completa.
2. **Smoke EN VIVO** (L-5): job sanctions real → tabla `sanctions` poblada con países reales (Russia/Iran/North Korea/Syria con conteos altos); `getLatestSanctions` devuelve por-país; briefing real incluye el bloque "Países bajo más sanciones OFAC". (Sin API/UI → smoke = DB + briefing, como convergencia motor.)
3. `/verify` goal-backward: conector keyless+gracioso, parseo quote-aware real, ISO→nombre, store append, job tier slow, bloque briefing sin LLM nuevo, atribución, sin stubs.
