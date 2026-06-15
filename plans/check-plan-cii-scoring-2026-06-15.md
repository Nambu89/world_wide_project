# Check-Plan — CII Scoring (Fase 2 · rebanada 3)

**Plan:** `plans/2026-06-15-cii-scoring.md` · **Design-doc:** `docs/design/2026-06-15-cii-scoring.md` · **Auditor:** plan-checker (read-only) · **Fecha:** 2026-06-15
**Registrado por el PM** (plan-checker es read-only, sin herramienta de escritura).

## Veredicto: **PASS** (0 issues bloqueantes, 5 warnings no-bloqueantes)

### 5 dimensiones — limpias
1. **Cobertura**: G-1..G-11 + 6 OQ ratificadas + setup paquete @www/core-cii → todas con tarea. Ninguna Interface/firma del design-doc sin asignar (motor compute*Component/computeCii/computeAllCountries/computeDynamic→T-23; config EVENT_WEIGHTS/FLOORS/decay/BOOST/SECTIONS/MIX/COEFFS/REGISTRY→T-22; schema 004+API→T-21; endpoints→T-25; capa+panel→T-26; briefing→T-27).
2. **Completitud**: cada tarea con boundaries+constraints+acceptance verificable+verify_cmd<60s package-scoped (global tsc = PM, L-3).
3. **Dependencias**: grafo acíclico (T-21←[], T-22←[], T-23←[21,22], T-24←[21,23], T-25←[21], T-26←[25], T-27←[21]). Disjunción REAL por ronda verificada fichero a fichero: A(store∥core-cii) · B(core-cii∥server.ts; T-25 solo dep T-21, no prematuro) · C(scheduler∥web∥core-ai). `core/cii/index.ts` lo tocan T-22 y T-23 pero en rondas DISTINTAS (no colisión).
4. **Scope**: sin frases de erosión (grep negativo: sin v1/placeholder/se-cablea-después/mientras-estamos/de-paso). Non-Goals respetados: convergencia packages/core/signals NO aparece como tarea; Security excluido (4 claves CiiComponentKey); conectores keyed ausentes.
5. **Riesgos**: cada riesgo con dueño+mitigación+tarea (R-2 país heterogéneo VERIFICADO, nuevo-paquete cross-package, R-1 calibración, R-5 serie vacía, L-1 camelCase, boost-atribución).

### Fidelidad decisiones bloqueadas — CONFIRMADA (no erosionadas)
D-001 no-AGPL (config re-derivada, verifier) · D-002 persiste-antes-de-servir + API solo-lectura (motor NUNCA on-request) · D-003 @libsql/client (no better-sqlite3) · D-004 capa config-array iterada · D-005 sin proveedor LLM nuevo.

### OQ-2 (re-ratificación a NORMALIZAR) — COHERENTE, SIN HUECO
Anticipada por D-203 ("normalizar si R-2 se materializa") + Iteration Guide §371 (implementador para y reporta → PM). R-2 MATERIALIZADO (smoke data/world.db: GDELT=FIPS, USGS=nombre). country-centroids.ts keyed por nombre → clave canónica=nombre encaja (resuelve OQ-6). Cableado sin hueco en T-22 (normalizeCountryKey) + T-23 (agrupa) + test L-7 (JA≡Japan) + smoke en vivo (verificar unificación).

### 5 Warnings no-bloqueantes
1. **D4 scope-áreas (6)**: mitigado por waving estricto; sostener disciplina rebuild-dist L-2 entre rondas (el nuevo @www/core-cii no resuelve cross-package sin dist construido antes de Ronda B/C).
2. **D4 scope-archivos (~24)**: aceptable por scaffold del paquete nuevo; ya rebanado en 3 rondas.
3. **Cobertura FIPS_TO_NAME**: ~64 centroides; un país en events ausente de FIPS_TO_NAME quedaría sin normalizar → recomendación: log de claves FIPS no mapeadas (implícito en "FIPS desconocido → ''").
4. **server.ts (T-25, alto conflicto)**: correctamente serializado; registrar wiring en /verify.
5. **L-1 camelCase repetible** (BUG-1/T-13): cubierto por T-21/T-26 + curl real + browser E2E al cierre.
