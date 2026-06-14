---
name: usgs-connector-t10a
description: T-10a DONE — conector USGS earthquakes (usgs.ts + usgs.test.ts), 15/15 tests verde, keyless, U.S. Public Domain
metadata:
  type: project
---

T-10a completada. Conector USGS earthquakes implementado y verificado.

**Why:** Fase 2 Wave B — capa de eventos globales. USGS es la fuente sísmica canónica, keyless, U.S. Public Domain (17 U.S.C. §105).

**How to apply:** Al trabajar en Wave B/C, el conector ya existe en `packages/connectors/geo/usgs.ts`. Exporta `fetchUsgs(): Promise<ConnectorResult<EventRow>>`. El barrel `packages/connectors/index.ts` lo cablea el PM post-wave B (no tocarlo). El scheduler (T-11) lo registra en tier `fast`.

Detalles de implementación:
- Dos feeds: `significant_week.geojson` (impacto) + `all_day.geojson` (volumen), en paralelo.
- Dedup por `feature.id` (los feeds solapan eventos).
- `If-Modified-Since` / `Last-Modified` para cache condicional (respeta `Cache-Control: max-age=60`).
- Single-flight + serve-stale (STALE_TTL_MS=10min).
- `ConnectorResult<EventRow>` con `{ data, stale, fetchedAt }` — igual que gdelt.ts.
- `EventRow` importado de `@www/store` (camelCase: `sourceEventId`, `eventType`, `occurredAt`, `capturedAt`, `rawJson`).
- `severityUsgs` importado de `./severity.js`.
- `nearestCountry` contra `COUNTRY_CENTROIDS` con MAX_CENTROID_DISTANCE_DEG=9 (null si lejos).
- ToS: U.S. Public Domain, atribución "U.S. Geological Survey".
