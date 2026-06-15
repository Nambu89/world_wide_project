# Memory Index — data-connector-dev

- [nasa-eonet-verified](nasa-eonet-verified.md) — NASA EONET v3 API: keyless, GeoJSON real coords, 13 categories (wildfires/volcanoes/storms/etc.), NASA open-government ToS, RECOMENDADA para MVP capa de eventos naturales.
- [usgs-connector-t10a](usgs-connector-t10a.md) — T-10a DONE: usgs.ts + usgs.test.ts, 15/15 verde, keyless, U.S. Public Domain, fetchUsgs() → ConnectorResult<EventRow>.
- [gdelt-connector-t10c](gdelt-connector-t10c.md) — T-10c DONE: gdelt.ts REFACTOR DOC artlist→raw Events CSV, 35/35 verde, keyless, ZIP zero-dep (inflateRawSync+método 0), fetchGdelt() → ConnectorResult<EventRow>.
- [gdelt-gkg-v2-verified](gdelt-gkg-v2-verified.md) — GKG v2 fact-checked en vivo: 2.75MB/8.46MB/670 registros/15min, 27 cols TAB, geo 74%, temas+tono+entidades+GCAM, keyless ToS libre. RADAR TEMATICO viable; complementa (no reemplaza) Events CSV para coords de suceso.
