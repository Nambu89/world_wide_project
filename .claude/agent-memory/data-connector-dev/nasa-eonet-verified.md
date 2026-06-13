---
name: nasa-eonet-verified
description: NASA EONET v3 API verification result — keyless, real lat/lon GeoJSON, 13 event categories, open-government data, RECOMENDADA para MVP capa eventos naturales.
metadata:
  type: project
---

NASA EONET v3 verificada en vivo el 2026-06-14. Keyless, sin registro. Endpoint GeoJSON real: https://eonet.gsfc.nasa.gov/api/v3/events/geojson. ToS: NASA open-government data, uso libre sin restricciones comerciales documentadas; disclaimer que los datos son "for visualization and general information purposes only, not official". 13 categorias: wildfires, volcanoes, severeStorms, floods, earthquakes, drought, landslides, seaLakeIce, snow, tempExtremes, dustHaze, waterColor, manmade.

**Why:** Fuente zero-key con coords reales por evento (Point GeoJSON), ligera (~3.6KB por 5 eventos), lat/lon exactas, magnitud en unidades propias (acres para fuego, etc.).

**How to apply:** Usar endpoint /api/v3/events/geojson para conectores geo. Filtrar por category y status=open. Registrar como packages/connectors/geo/eonet.ts. Citar fuente NASA EONET en cabecera del conector. ToS URL de referencia: https://eonet.gsfc.nasa.gov/what-is-eonet#disclaimer
