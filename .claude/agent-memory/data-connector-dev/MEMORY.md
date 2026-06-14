# Memory Index — data-connector-dev

- [nasa-eonet-verified](nasa-eonet-verified.md) — NASA EONET v3 API: keyless, GeoJSON real coords, 13 categories (wildfires/volcanoes/storms/etc.), NASA open-government ToS, RECOMENDADA para MVP capa de eventos naturales.
- [usgs-connector-t10a](usgs-connector-t10a.md) — T-10a DONE: usgs.ts + usgs.test.ts, 15/15 verde, keyless, U.S. Public Domain, fetchUsgs() → ConnectorResult<EventRow>.
- [gdelt-connector-t10c](gdelt-connector-t10c.md) — T-10c DONE: gdelt.ts REFACTOR DOC artlist→raw Events CSV, 35/35 verde, keyless, ZIP zero-dep (inflateRawSync+método 0), fetchGdelt() → ConnectorResult<EventRow>.
