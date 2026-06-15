---
name: gdelt-gkg-v2-verified
description: GDELT GKG v2 fact-checked en vivo (2026-06-14): layout 27 cols, radar tematico keyless, geo 74%, NOT reemplaza Events CSV para coords de suceso.
metadata:
  type: project
---

Verificacion en vivo del GDELT Global Knowledge Graph (GKG) v2 — batch 20260614204500.

**Metricas medidas:**
- HTTP: 200 OK keyless
- ZIP comprimido: 2.75 MB (2,882,809 bytes)
- CSV descomprimido: 8.46 MB (8,875,028 bytes)
- Registros en 15min: 670 articulos
- Cadencia: 15 minutos (igual que Events CSV, misma URL de lastupdate.txt)
- Cache-Control: `public, max-age=3600`
- ETag: presente y soportado (If-None-Match funciona para conditional GET)

**ToS verificado:** https://www.gdeltproject.org/about.html
"all datasets released by the GDELT Project are available for unlimited and unrestricted use for any academic, commercial, or governmental use of any kind without fee."
Atribucion requerida: citar "The GDELT Project" + link gdeltproject.org. Zero-key.

**Layout columnas (27 TAB-separados, SIN header):**
| Col | Nombre | Descripcion |
|-----|--------|-------------|
| 1 | GKGRECORDID | ID unico formato `TIMESTAMP-N` |
| 2 | DATE | YYYYMMDDHHMMSS |
| 3 | SourceCollectionIdentifier | 1=WEB, 2=CITATIONGRAPH |
| 4 | SourceCommonName | Dominio fuente |
| 5 | DocumentIdentifier | URL del articulo (SOURCEURL) |
| 6 | V1Counts | Recuentos de menciones (tipo#num#...) |
| 7 | V2Counts | V2 enhanced counts con char offsets |
| 8 | V1Themes | Temas separados por ; |
| 9 | V2EnhancedThemes | Temas con char offsets (tema,offset;...) |
| 10 | V2Locations | Geos: tipo#nombre#cc#adm1#lat#lon#featureid (;sep) |
| 11 | V2EnhancedLocations | Idem con char offsets |
| 12 | V2Persons | Personas mencionadas (;sep, lowercase) |
| 13 | V2Organizations | Organizaciones (;sep, lowercase) |
| 14 | V2EnhancedOrganizations | Orgs con char offsets |
| 15 | V2Tone | (ausente/vacio en algunos) |
| 16 | V2Tone | 7 floats: AvgTone,PosTone,NegTone,Polarity,ActivityDensity,SelfDens,WordCount |
| 17 | V2EnhancedDates | Fechas mencionadas en texto |
| 18 | V2GCAM | GCAM: diccionario de dimensiones psicologicas/economicas (clave:valor,) |
| 19-27 | V2SharingImage, V2RelatedImages, V2SocialImageEmbeds, V2SocialVideoEmbeds, V2Quotations, V2AllNames, V2Amounts, V2TranslationInfo, V2ExtrasXML | Campos multimedia/extras |

**Cobertura geo (V2Locations, col 10):** 497/670 = 74.2% tienen lat/lon
- Formato interno: `tipo#nombre#cc#adm1#lat#lon#featureid`
- tipo: 1=Country, 2=USState, 3=USCity, 4=WorldCity
- Para el conector: extraer el primer token con lat/lon real (tipos 3,4)

**V2Tone (col 16) — 7 valores reales:**
- AvgTone: tono medio del articulo (negativo = negativo)
- PositiveTone, NegativeTone, Polarity, ActivityDensity, SelfDensification, WordCount
- Ejemplo real: `3.33,5.92,2.58,8.49,21.09,2.96,950`

**GCAM (col 18):** Dictionaries de psicologia computacional, macro-economics, EPU. Clave=`cX.Y:valor`. Muy denso (~2000 chars/registro). Para radar simple, no es necesario parsear completo.

**V2Themes reales observados en batch:**
- Conflicto/seguridad: `WB_2433_CONFLICT_AND_VIOLENCE`, `WB_2462_POLITICAL_VIOLENCE_AND_WAR`, `WB_2465_REVOLUTIONARY_VIOLENCE`, `SLFID_DICTATORSHIP`
- Economia: `ECON_STOCKMARKET`, `EPU_CATS_TAXES`, `WB_445_FISCAL_POLICY`, `WB_698_TRADE`, `TAX_ECON_PRICE`
- Migracion/social: `EPU_CATS_MIGRATION_FEAR_FEAR`, `SOC_GENERALCRIME`, `WB_697_SOCIAL_PROTECTION_AND_LABOR`
- Energia/medio ambiente: `ENV_OIL`, `ENV_CLIMATECHANGE`, `ENV_METALS`, `WB_507_ENERGY_AND_EXTRACTIVES`
- Desastres: `MANMADE_DISASTER_IMPLIED`, `NATURAL_DISASTER_FLOODED`, `NATURAL_DISASTER_ICE`
- Crisislex: `CRISISLEX_C03_WELLBEING_HEALTH`, `CRISISLEX_C07_SAFETY`, `CRISISLEX_CRISISLEXREC`
- EPU: `EPU_POLICY`, `EPU_CATS_HEALTHCARE`

**DIFERENCIA CLAVE vs GDELT raw Events CSV:**
- GKG = 1 fila por ARTICULO; Events CSV = 1 fila por EVENTO DIADICO (actor1 → accion → actor2)
- GKG geo 74% (a nivel articulo, puede ser pais de publicacion); Events CSV geo 97.6% (del suceso)
- GKG es mas rico en temas/entidades/tono; Events CSV es mas rico en evento-accion
- Son COMPLEMENTARIOS, no intercambiables

**Veredicto para radar tematico:**
GKG v2 es VIABLE y RECOMENDADO si el objetivo es:
- Clasificacion tematica (economia, conflicto, medio ambiente) por pais/region
- Tono editorial por tema o pais
- Extraccion de personas/organizaciones mencionadas
- Correlacion GCAM (psicologia computacional, EPU)

Si el objetivo es "donde ocurrio el suceso fisico" -> usar Events CSV (ActionGeo_Lat/Long).

**Complejidad de parseo vs Events CSV:**
- Mismo mecanismo ZIP (zlib.inflateRawSync, extractZipFirstEntry ya implementado en gdelt.ts)
- CSV TAB-sep sin header; pero subcampos usan delimitadores mixtos (#, ;, ,)
- Para uso en produccion: extraer col5 (URL), col8 (temas), col10 (primera geo con lat), col12 (personas), col16 (tono)
- GCAM solo si se necesita EPU u otras dimensiones computacionales

**Why:** GKG verifica si es viable antes de escribir el conector.
**How to apply:** Si se pide un conector GKG, reusar extractZipFirstEntry de gdelt.ts. La logica de parseo de subdelimitadores es nueva (es distinta a los 61 cols del Events CSV).
