# Verificación del Plan — Convergencia cross-domain (Fase 2 · rebanada 4)

- **Plan auditado:** `plans/2026-06-15-convergence.md` (T-28..T-32, 3 rondas A/B/C)
- **Design-doc fuente:** `docs/design/2026-06-15-convergence.md` (D-300..312, 7 Non-Goals)
- **Decisiones bloqueadas:** `plans/DECISIONS.md` ADR-001..012 + D-001..005 + D-300
- **Verificador:** plan-checker (read-only) · **Fecha:** 2026-06-15

## Veredicto: PASS (tras fix de ISSUE-1 — ver §Re-verificación al final)

> Veredicto inicial = ISSUES_FOUND (1 bloqueante + 3 warnings). El PM aplicó el fix (opción 1) + warning-1; re-verificación = **PASS**. Quedan 2 warnings no-bloqueantes.

**Inicial: 1 issue bloqueante · 3 warnings no-bloqueantes.**

El plan es de calidad excepcional: matriz de cobertura completa, correcciones de realidad (C-1/C-2/C-3) verificadas en disco por el PM y re-confirmadas por mí, fidelidad total a las decisiones bloqueadas, anti-doble-conteo blindado por construcción con test R1, y disjunción de ficheros real por ronda. **Un único hueco bloquea el PASS:** la premisa de encadenamiento `cii → convergence` (D-302/D-312) no se sostiene contra el mecanismo REAL del scheduler, que ejecuta los jobs de un mismo tier en paralelo, no en orden de array. Ninguna tarea corrige eso.

---

### Requisitos (Goals G-1..G-9 + decisiones)

| Goal / Decisión | Cubierto por | Estado |
|-----------------|-------------|--------|
| G-1 paquete clean-room @www/core-signals + detectConvergence pura | T-29 | OK |
| G-2 observación canónica desde CII components | T-29 (FAMILY_OF) + T-30 | OK |
| G-3 mapeo fuente→magnitud [0,1] lineal | T-29 (magnitude.ts) | OK |
| G-4 anti-doble-conteo por dataFamily (D-306) | T-29 detect + test R1 | OK |
| G-5 estrés markets desde change_pct REAL (no regimeDelta) | T-29 marketStress + T-30 + C-1 | OK |
| G-6 convergence_signals migración 005 + dynamicScore + firstDetectedAt | T-28 + T-30 | OK |
| G-7 job convergence medium encadenado tras cii (D-312) | T-31 | **PARCIAL — ver ISSUE-1** |
| G-8 bloque convergencia en briefing (sin LLM nuevo, D-311) | T-32 | OK |
| G-9 familias MVP events×signals + cualquiera×markets (D-310) | T-29 + T-30 | OK |
| D-306 anti-doble-conteo (test conflict×social misma-familia NO dispara) | T-29 acceptance R1 | OK |
| D-309 dynamicScore (getPrior) | T-28 getPriorConvergence + T-30 delta | OK |
| D-311 briefing-only (sin server/web indebido) | T-32; NO hay tarea server/web | OK |
| D-305 markets-transversal | T-29 + T-30 (reconciliación D-305↔D-310 documentada) | OK |

Todos los Goals tienen tarea con acción concreta y criterio de verificación. **G-7 es la única cobertura incompleta**: la tarea existe (T-31) pero su acción ("colocar convergence TRAS cii en el array") no produce el efecto que el requisito exige (leer cii_snapshots recién escritos).

### Tareas

| Tarea | Acción clara | Verify <60s | files_modified | Estado |
|-------|-------------|-------------|----------------|--------|
| T-28 store migración 005 + API | Sí | Sí (tsc + tsx test) | Sí (disjuntos) | OK |
| T-29 core-signals puro (config+magnitude+detect) | Sí | Sí | Sí (disjuntos) | OK |
| T-30 observe.ts orquestador IO | Sí | Sí | Sí (disjuntos) | OK |
| T-31 job convergence scheduler | Sí (pero premisa de orden inválida) | Sí | Sí | ISSUE |
| T-32 briefing core-ai | Sí | Sí | Sí (glob `src/*.ts`) | OK (warn menor) |

Todas las `verify_cmd` son package-scoped (`tsc --noEmit` + `tsx --test`), terminan muy por debajo de 60s. Todas declaran `files_modified`. La función pura `detectConvergence` es testeable SIN DB (T-29 define tipos LOCALES y no importa @www/store) — invariante de honestidad respetado.

### Dependencias

Grafo: `A(T-28 ∥ T-29) → B(T-30 ∥ T-32) → C(T-31)`.

- **Acíclico:** OK. T-30 dep [T-28,T-29]; T-31 dep [T-28,T-30]; T-32 dep [T-28]. Sin ciclos.
- **Disjunción por ronda:** REAL. Ronda A: `packages/store` ∥ `packages/core/signals` (T-29 NO importa store, precedente T-21‖T-22 verificado). Ronda B: `packages/core/signals` ∥ `packages/core/ai`, paquetes distintos. Ronda C: `packages/scheduler` solo.
- **Cableado del paquete nuevo:** el setup PM (workspace + deps `@www/store`+`@www/core-cii` + tsconfig refs + `build` dist) está explícito ANTES de Ronda B. Verificado contra `@www/core-cii/package.json` (espejo correcto: deps `@www/store`, build `tsc --build`). `pnpm-workspace.yaml` ya cubre `packages/core/*`. OK.
- **Ronda B, mismo agente intel-analyst en T-30 y T-32:** contemplado explícitamente (wave scheduler + tabla de riesgos): si no hay 2 instancias → serie dentro de la ronda, sin pisarse (paquetes disjuntos). NO es un problema.
- **Dependencia externa:** ninguna nueva (no API keys, no servicios). Solo migración Turso local 005 (interna). OK.

### Scope

- **Archivos:** ~16 ficheros tocados (4 T-28 + 8 T-29 + 3 T-30 + 2 T-31 + glob T-32). Bajo el umbral de 15 "de cambio funcional"; el conteo se infla por los scaffolds del paquete nuevo (package.json/tsconfig/barrel). No preocupa.
- **Áreas:** store + core/signals(nuevo) + core/ai + scheduler = 4 áreas. WARNING leve (>3), pero secuenciado en rondas con locks disjuntos — gestionado.
- **Breaking changes:** ninguno. Todo es aditivo (`AÑADE`/`EXTIENDE`); firmas `defaultJobs`/`purgeAndDownsample`/store-API intactas. Sin plan de migración de contratos necesario.
- **Non-Goals:** NO se cuela nada. Sin /api/convergence, sin capa de mapa, sin ML, sin familias avanzadas, sin conectores keyed. NG respetados.
- **Erosión de scope:** grep limpio. "opcional pero recomendado" (vol component) y "calibración diferida" remiten a GAP-2/NG ratificados, no eroden la entrega de esta rebanada. Sin `v1`/`placeholder`/`se cablea después`/`TODO`.

### Riesgos (D5)

- **Turso schema:** SÍ — migración 005_convergence.sql. Mitigado: append-snapshot D-308, idempotente vía `_migrations`, purga en purgeAndDownsample. Hazard W-2 (split(';') descarta chunks `--`) VERIFICADO real en `migrate.ts:55-58` y documentado en T-28 con assert sqlite_master. OK.
- **PROVIDER_CHAIN router LLM:** NO se toca (D-005 explícito, T-32 no toca router). OK.
- **Fuente sin ToS:** NO — consume solo store ya vivo (NG-5). OK.
- **Scheduler job nuevo:** SÍ (convergence/medium). WARNING estándar + **ISSUE-1 de encadenamiento** (abajo).
- **server.ts:** NO se toca (D-311, sin /api/convergence). OK.
- **Seguridad (CORS/SSRF/rate-limit):** NO se toca. OK.
- **Paquete nuevo cross-package:** mitigado por setup PM (L-2/L-4). OK.

### Decisiones bloqueadas (D-NN)

| D-NN | Tarea que la implementa / cita | Estado |
|------|-------------------------------|--------|
| D-001 no-AGPL (todo re-derivado en convergence.config.ts) | T-29 constraints + verify §5 | OK |
| D-002/D-004 persiste-antes-de-servir | T-31 constraints (insertConvergenceSignals antes de servir) | OK |
| D-005 sin LLM nuevo | T-32 constraints (sin proveedor/2ª llamada) | OK |
| D-300 Q1 premisa fija (CII canónico, markets exógena, familias disjuntas) | T-29 detect + T-30 observe | OK |
| ADR-006 @libsql/client file:// | T-28 constraints (PROHIBIDO better-sqlite3) | OK |

Todas las D-NN bloqueadas están citadas por ID en al menos una tarea. Verificado contra código: no existe `regimeDelta`/`regime` en el store (grep limpio) → C-1 correcta; `MarketSnapshot` es snake_case (`change_pct`,`captured_at`) → T-30 adapta bien; `getLatestCii`/`getPriorCii`/`CiiSnapshotRow.componentsJson` existen → input de T-30 real; componente CII tiene `key`+`signalPresent` (score.ts:45-50) → D-304/D-306 implementables.

---

### Issues

#### ISSUE-1 (BLOQUEANTE) — D-312/D-302: el "encadenamiento tras CII" no existe en el scheduler real

- **Tarea afectada:** T-31 (`packages/scheduler/src/index.ts`), línea de plan 168-181; premisa repetida en Goal (línea 21, 37), C-3, y verificación §3 (línea 267).
- **Evidencia (código real):**
  - `packages/scheduler/src/index.ts:112-118` — el boot ejecuta `await Promise.all(nonDailyJobs.map((j) => runJob(j)))`: **todos los jobs non-daily corren en PARALELO**, sin orden entre sí.
  - `packages/scheduler/src/index.ts:106-109` — cada job registra su propio `setInterval` independiente; en cada intervalo dispara solo, sin esperar a otro job.
  - `packages/scheduler/src/index.ts:63-69` — el `interface Job` NO tiene campo de dependencia/orden (`dependsOn`/`after`).
  - `packages/scheduler/test/scheduler.test.ts:364,395,408` — test existente afirma EXPLÍCITAMENTE: *"scheduler re-orders by tier, not position"*. La única garantía de orden es **tier-level** (non-daily antes que daily); dentro de un tier no hay orden.
- **Por qué es bloqueante:** D-302/D-312 son la premisa central de corrección del motor ("la observación canónica es el snapshot CII; correr antes leería CII rancio"). Colocar `convergence` después de `cii` en el array `defaultJobs` (lo único que hace T-31) **NO** garantiza que `cii` haya escrito `cii_snapshots` antes de que `convergence` los lea: ambos arrancan a la vez en `Promise.all` y luego disparan en intervalos independientes. En la PRIMERA ventana (boot, store frío de cii_snapshots) `detectAllConvergence` leería un `getLatestCii()` vacío o de una corrida previa → `[]` → `convergence_signals` no se puebla en el smoke en vivo, contradiciendo la verificación §3 (línea 267) que exige `convergence_signals` con filas tras el boot. El CII actual no sufre esto porque NO depende de la corrida de gkg/gdelt de su mismo tier (lee lo que ya hay); convergence SÍ declara depender del cii_snapshots *de esta misma corrida*.
- **Corrección sugerida (elegir una, debe quedar en T-31 + reflejarse en su acceptance/test):**
  1. **Job compuesto (mínimo cambio):** que el job `cii` existente, al final de su `run()`, invoque `detectAllConvergence`+`insertConvergenceSignals` (o un wrapper que encadene `await ciiRun(); await convergenceRun();`). Garantiza orden por construcción dentro de un solo `run`. T-31 pasa a modificar el job cii en vez de añadir un job hermano "tras cii".
  2. **Campo de orden en el scheduler:** añadir a `Job` un `dependsOn?: string[]` o un sub-tier secuencial dentro de medium, y que el boot/intervalo respete el orden. Mayor alcance (toca el motor del scheduler + su test de boot-order) — probablemente sobre-ingeniería para un solo par.
  3. **Aceptar lag de 1 ventana explícitamente:** si se acepta que convergence corre sobre el cii_snapshots de la corrida ANTERIOR, hay que (a) reescribir D-302/D-312 y el Goal para no afirmar "recién escritos", y (b) ajustar la verificación §3 para no exigir convergence_signals poblada en el primer boot. Esto degrada la premisa de diseño — la opción 1 es preferible.
- **Acción para el PM:** elegir mecanismo (recomiendo opción 1), actualizar T-31 (`files_modified` ya incluye scheduler/src + test; ampliar boundaries para permitir tocar el job cii si se elige la opción 1, que hoy las boundaries de T-31 PROHÍBEN: *"NO toques jobs existentes ... salvo añadir convergence DESPUÉS de cii"*), y añadir un test que pruebe el orden REAL de ejecución (no solo la posición en el array — el test propuesto "convergence aparece y su tier es medium" NO captura el bug).

### Warnings (no bloquean)

1. **[WARNING] T-32 `files_modified` con glob (`packages/core/ai/src/*.ts`, `test/*.ts`).** Imposibilita al PM computar colisiones a nivel de fichero exacto para waves. En esta rebanada T-32 está aislado en su paquete (sin co-tarea en core/ai), así que no hay colisión real — pero conviene nombrar los ficheros concretos que toca (p.ej. el builder de contexto + su test) para fidelidad del lock. No bloqueante.
2. **[WARNING] Scope: 4 áreas tocadas** (store, core/signals nuevo, core/ai, scheduler). Gestionado por rondas con locks disjuntos y setup PM del paquete nuevo; se anota por completitud (D4 >3 áreas).
3. **[WARNING] Calibración sin ground-truth (GAP-2/R3):** `MIN_MAGNITUDE`, `MARKET_REF`, `RISKOFF_REF`, `VOL_REF`, `HALF_LIFE_72H` son editoriales de partida. Mitigado: todos en `convergence.config.ts` ajustable + `methodology_version` versiona. Diferimiento a Non-Goal ratificado (no es erosión de scope). El MVP puede arrancar; la calidad de las señales se afina después.

### Recomendaciones

1. **Resolver ISSUE-1 antes de presentar el plan al usuario** (opción 1: encadenar convergence dentro del `run()` del job cii, o un wrapper secuencial). Ampliar boundaries de T-31 en consecuencia y añadir un test que verifique el ORDEN de ejecución real, no la posición en el array.
2. T-32: sustituir los globs por la lista de ficheros concretos de core/ai que se tocan.
3. (Opcional) Documentar en la verificación §3 que el smoke en vivo debe comprobar que `convergence_signals` se puebla EN EL MISMO BOOT en que corre cii — es la prueba directa de que ISSUE-1 quedó resuelto.

---

## Línea para agent-comms.md (la registra el PM)

`## [2026-06-15T00:00:00Z] [PLAN-CHECKER] [DONE] — Plan convergence (rebanada 4): ISSUES_FOUND, 1 issue bloqueante (D-312 encadenamiento cii→convergence no existe en el scheduler real, T-31), 3 warnings`

---

## Re-verificación (fix ISSUE-1) — Veredicto: PASS

Re-auditoría focalizada sobre el fix de ISSUE-1 (opción 1) + warning-1, verificada contra el código real en disco. No se re-litigan decisiones ratificadas ni warnings 2/3.

**ISSUE-1 — RESUELTO.** T-31 reescrita: ya NO añade job hermano; encadena `detectAllConvergence`+`insertConvergenceSignals` DENTRO del `run()` del job cii, tras `insertCiiSnapshots` (scheduler/src/index.ts:443), mismo `now` (:398), awaits secuenciales → orden POR CONSTRUCCIÓN, inmune al `Promise.all` paralelo del boot (:112-118) y a los `setInterval` independientes (:106-109). Acceptance prueba el ORDEN real (mocks que registran orden de llamada, assert índice insertCiiSnapshots < índice detectAllConvergence), no la posición en el array. boundaries ya permiten tocar el job cii; siguen 8 jobs + firma `defaultJobs` intacta; deps aditivas (patrón T-18/T-24). C-4 documenta la realidad con evidencia citada.

**Warning-1 — RESUELTO.** T-32 nombra ficheros concretos (`briefing.ts`/`index.ts`/`test/ai.test.ts`), confirmados en disco (`buildRiskContext`:92, `serializeContext`:139).

**Sin regresiones de coherencia.** dep `[T-28, T-30]` intacta; grafo acíclico A→B→C; contrato `ConvergenceSignal`→`ConvergenceSignalRow` asignado a T-30 (observe) y guardado por `tsc --noEmit` de T-31 (no es hueco silencioso); §3/G-7/C-4/D-312 reflejan el mecanismo nuevo.

**Warnings remanentes (no bloquean):** 4 áreas tocadas; calibración GAP-2 diferida (Non-Goal ratificado).

**PASS — el plan está listo para presentarse al usuario.**
