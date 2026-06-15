---
name: geoeconomic-radar-fase2
description: Radar geoeconómico temático (ADR-011, design-doc 2026-06-14-geoeconomic-radar.md) — 2ª rebanada Fase 2. Tabla NUEVA `signals` (article-level, separada de events) + clasificador editorial sections.config.ts. Crítico para la rebanada CII y para cualquier scoring temático.
metadata:
  type: project
---

Diseño del radar geoeconómico temático (2ª rebanada Fase 2, ADR-011). Doc: `docs/design/2026-06-14-geoeconomic-radar.md`.

**Why:** la capa de eventos (rebanada 1, [[events-layer-fase2]]) da el QUÉ-DÓNDE-CUÁNDO-severo geo de sucesos discretos, pero NO la dimensión temática-económica que el usuario quiere (commodities, tierras raras, semis/IA, ciber/data-centers, comercio/sanciones, inestabilidad política). El radar la añade vía GKG backbone + news RSS curada, atado al mapa.

**How to apply:** al diseñar el CII, la convergencia, o cualquier scoring que consuma señales temáticas, recuerda:
- **Fuente backbone = GDELT 2.0 GKG** (keyless, ToS "unlimited unrestricted use" + citación, verificado en vivo `wf_e68c43c8-11c` 2026-06-14: 670 art/15min, 2.75 MB zip, ETag, **27 cols TAB sin cabecera + subdelimitadores `;`/`#`/`,`**). Conector NUEVO `gkg.ts` que **REUSA `extractZipFirstEntry`** de `gdelt.ts` (mismo PKZIP-deflate). Cols clave: col2=DATE, col5=SOURCEURL, col8=V1Themes(`;`), col9=V2EnhancedThemes(`tema,offset`), col10=V2Locations(`#`-sep; tipo 3/4=coords ciudad reales), col12=V2Persons, col13=V2Organizations, col16=V2Tone(AvgTone…), col27=V2ExtrasXML(PAGE_TITLE=título).
- **Tabla NUEVA `signals` (article-level), SEPARADA de `events`** (D-003): un artículo NO es un suceso geo. Migración `003_signals.sql`. Multi-sección vía tabla puente `signal_sections(signal_id, section, matched_by)` (D-200, recomendado; alternativa = columna `sections TEXT` JSON — es OQ-1, decisión del PM). Dedup por **GKGRECORDID** (col1, `YYYYMMDDHHMMSS-N`) / url RSS. API: `upsertSignals`/`getSignals(section,since,limit,minToneMag)`/`getSignalTrend(section)`.
- **6 secciones {sig.sections}**: `political_instability`, `commodities_energy`, `critical_minerals`, `semis_ai_tech`, `digital_infra_cyber`, `trade_sanctions`.
- **El corazón = clasificador editorial `sections.config.ts`** (D-004/D-008, re-derivado no-AGPL como `severity.ts`): mapa sección→{themeCodes[], keywords[], entityHints[]}; `classify()`→0..N secciones con `matchedBy:'theme'|'keyword'|'entity'` para auditoría. **Cobertura GKG desigual**: fuerte por theme-code en política/commodities/comercio (`WB_*`/`ENV_*`/`ECON_*`/`PROTEST`/`EPU_*`); **débil → keyword/entidad** en tierras-raras/semis/ciber/data-centers (R-1/GAP-3, área de mayor incertidumbre). Calibración pendiente con intel-analyst (OQ-4/GAP-4).
- **Tendencia/calor {sig.trend} = volumen + AvgTone medio por ventana** (D-005; usa solo V2Tone, NO GCAM completo NG-5). Señales RSS tienen tone=null → solo aportan volumen (D-205/GAP-5).
- **Geo del GKG = del ARTÍCULO, no del suceso** (74% lat/lon). Por eso "inestabilidad política" REUSA los `events` geo-reales de la rebanada 1; las otras 5 secciones pintan {sig.geo} best-effort (R-3/GAP-1/NG-4). Atado al mapa {web.map.tie}: seleccionar sección filtra events+signals.
- **Job gkg→medium** (D-204); NO toca el job gdelt ni reescribe events (NG-6). Panel Radar NUEVO (no sobrecarga EventsPanel, D-206). Capas signals por sección en `layers.config.ts` (config-array, D-207).
- **NON-GOALS firmes**: convergencia cross-tema (NG-1, spike de mayor riesgo), CII (NG-2), ML cliente Transformers.js (NG-3), GCAM completo (NG-5), reverse-geocode preciso (NG-4).
- **OQ-8 (feeds RSS): NO verificados en esta sesión** — recomendé entregar el radar con GKG backbone primero y diferir los feeds RSS a iteración incremental con ToS verificado (feedback_data_tos). El PM ratifica.

Ver [[events-layer-fase2]], [[data-reality-fase1]], [[design-doc-pattern]].
