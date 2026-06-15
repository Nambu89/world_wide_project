---
name: cii-scoring-fase2
description: Diseño REFRESCADO del CII (docs/design/2026-06-15-cii-scoring.md). Supersede el doc data-starved 2026-06-13. Premisa invertida: events+signals dan fuente real keyless a 4 componentes. Crítico para la convergencia (su input).
metadata:
  type: project
---

Diseño del CII por país, **REFRESCADO** 2026-06-15 (`docs/design/2026-06-15-cii-scoring.md`, version beta). **Supersede** `docs/design/2026-06-13-cii-scoring.md` (data-starved, OBSOLETO).

**Why:** la premisa central del doc viejo (R-1 "solo Information tiene señal; GDELT=atención mediática financiera por país-FUENTE; severity null; ~5 tablas") MURIÓ tras las rebanadas 1/2 de Fase 2. El store ahora tiene DOS capas nuevas verificadas en vivo que dan fuente real keyless a casi todos los componentes.

**How to apply:** al diseñar la convergencia (NG-1, el CII es su INPUT), una rebanada keyed (ACLED/UCDP/OFAC), o cualquier scoring que consuma el CII, recuerda:
- **Componentes nuevos = {conflict, economic, political, social}** (ya NO {information, unrest, conflict, security}). EVENT_BLEND propio re-derivado `{ conflict 0.25, economic 0.30, political 0.20, social 0.25 }` (suma 1, invariante testeable). COMPOSITE = `baseline*0.4 + eventScore*0.6`.
- **Mapeo sub-señal→fuente del store (D-201, OQ-1 a ratificar PM)**: conflict ← `getEventsByCountry` events `category='conflict'` (severity 0..100 real + Goldstein de rawJson); social ← events `eventType='protest'` + GKG `political_instability` (mix 0.6/0.4); economic ← GKG `commodities_energy`+`trade_sanctions`+`critical_minerals` × AvgTone (semis/cyber FUERA, cobertura débil); political ← GKG `political_instability` + info-temp global.
- **Bridge YA construido**: `getEventsByCountry(sinceMs): Promise<Map<string, EventRow[]>>` (clave = `EventRow.country` real del suceso). El CII usa esa clave DIRECTA — NO hace reverse-geocode (R-2/NG-5 del doc viejo MUEREN).
- **Boosts vivos keyless (D-208)**: earthquakeBoost ← USGS severity (eventType=earthquake), fireBoost ← EONET wildfire severity. Aplicados a social (riesgo humanitario), caps +15/+15, combinado +25.
- **FLOORS por componente (D-205)** = ausencia de dato ≠ 0 riesgo; floor = `baselineRisk * floorFactor`. Distinto de `signalPresent=false` (renorm): floor = presente-sin-datos; renorm = sin presencia estructural. **timeDecay EXPONENCIAL vida-media 30d** (D-206), ventana 30d (NO 24h del doc viejo: Conflict persiste semanas).
- **Tier MEDIUM (D-211, cambia vs doc viejo que decía daily)**: Conflict ahora es volátil (GDELT 15min). Migración corregida a **`004_cii.sql`** (001 init, 002 events, 003 signals existen; el doc viejo decía 002_cii = error).
- **MANTENIDO**: clean-room no-AGPL (D-001), persiste-antes-de-servir (D-002), @libsql/client (D-003), capa en config-array (D-004), sin LLM nuevo enriquece briefing (D-005), motor N-componentes signalPresent+renorm (D-200, antes D-100), methodology_version='cii-core-1', `cii_snapshots` time-series + dynamicScore + deadband, /api/cii solo-lectura, capa MapLibre por país, camelCase wire (feedback_api_contract_camelcase).
- **NON-GOALS firmes**: convergencia cross-domain (NG-1, spike de mayor riesgo, el CII es su input), conectores keyed nuevos ACLED/UCDP/OFAC/FRED (NG-2, REFINAN fuentes existentes vía COMPONENT_REGISTRY.refinedBy, NO añaden componentes), Security sin fuente (NG-3, se añade como 5º componente cuando llegue), NER de país (NG-4), reverse-geocode propio (NG-5), calibración fina con intel-analyst (NG-7).
- **Open Questions que el PM ratifica**: OQ-1 (mapeo+pesos intra-componente y por-país-estricto vs piso-global), OQ-2 (clave país: EventRow.country directo vs ISO-3166; R-2 nuevo = heterogeneidad FIPS/ISO entre fuentes), OQ-3 (4 componentes presentes vs conservador), OQ-4 (floorFactors + decay 30d), OQ-5 (tier medium vs daily), OQ-6 (fill coroplético vs circle centroide).

Ver [[events-layer-fase2]], [[geoeconomic-radar-fase2]], [[data-reality-fase1]], [[design-doc-pattern]].
