---
name: sanctions-connector-t36
description: T-36 DONE — conector OFAC sanctions.ts (OpenSanctions CC BY-NC, keyless), 29/29 tests, parseo CSV quote-aware hand-roll, ISO-2 Intl.DisplayNames + CANONICAL_ALIASES, single-flight + serve-stale TTL 25h
metadata:
  type: project
---

T-36 completado. Conector OFAC sanctions por país.

**Why:** Señal autoritativa de intensidad de sanciones OFAC por país (nº entidades SDN list por país), persistida en tabla `sanctions` (migration 006, T-35). Fuente keyless CC BY-NC 4.0 OpenSanctions.

**How to apply:** Conector en `packages/connectors/finance/sanctions.ts`. Exportado desde barrel `packages/connectors/index.ts` como `fetchSanctions`. Retorna `ConnectorResult<SanctionRow>`.

Detalles clave:
- Fuente: `https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv` (~7 MB, keyless).
- `AbortSignal.timeout(15000)` (7 MB necesita más que 8s).
- Single-flight (`inFlight`) + serve-stale (`lastGood`, TTL 25h).
- Parseo CSV quote-aware hand-roll (`parseCsvLine`): respeta comas dentro de `"..."`, doble-comilla como escape. **LIMITACION `// ponytail:`**: no maneja newlines embebidos en un campo — si aparecen en prod, escalar NEEDS_CONTEXT al PM.
- W3: índice de columna `countries` derivado del header (no hardcodeado).
- `isoToName(iso2)`: `Intl.DisplayNames(['en'],{type:'region'})` + CANONICAL_ALIASES para divergencias del proyecto (cd, ps, cz, mm, cg). ISO inválido / 'Unknown Region' → null (drop gracioso).
- 29/29 tests verdes (6 suites: parseCsvLine, isoToName, aggregateFromCsv, fetchSanctions).
- ToS: CC BY-NC 4.0, uso personal OK, atribución en cabecera del fichero.

Pendiente (wave C): T-37 scheduler (backend-architect) cablea fetchSanctions + insertSanctions en job tier slow.

[[gdelt-connector-t10c]]
