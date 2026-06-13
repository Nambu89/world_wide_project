---
name: data-reality-fase1
description: Qué datos hay REALMENTE en el store tras Fase 1 — crítico para diseñar cualquier scoring (CII, convergencia). El GDELT actual NO es señal de conflicto.
metadata:
  type: project
---

Estado real del store tras Fase 1 (verificado en código `packages/store/migrations/001_init.sql`, `packages/connectors/geo/gdelt.ts`, `country-centroids.ts` a 2026-06-13).

**Why:** el resumen de la metodología CII de worldmonitor asume fuentes (ACLED/UCDP/conflicto geocodificado por evento) que NO tenemos. Diseñar un CII "full" sobre los datos actuales sería data-starved y engañoso.

**How to apply:** antes de diseñar cualquier scoring por-país o convergencia, recuerda estas limitaciones reales:
- Tablas existentes: `market_snapshots`, `gdelt_events`, `news_items`, `briefings`, `market_daily` (+ `_migrations`). NADA más.
- `gdelt_events` NO tiene columna `country`. Solo `lat/lon` = **centroide del país-FUENTE** (`sourcecountry`, el país del MEDIO que publica), NO el país del evento. Geocode por nombre vía `COUNTRY_CENTROIDS` (~65 países). Para agrupar por país hay que invertir centroide→país o re-derivar desde sourcecountry.
- `gdelt_events.category` en la práctica = `domain` del medio (ej. "reuters.com") o `sourcecountry` como fallback. **NO es taxonomía de tipo de evento** (unrest/conflict/political). El campo existe en el schema pero no lleva ese significado.
- `gdelt_events.severity` = **siempre null** (la DOC 2.0 artlist no da tono/Goldstein).
- El query GDELT es **financiero** (economy OR market OR finance OR inflation OR "central bank"), timespan 24h, maxrecords 75. Es **señal de volumen/atención mediática financiera por país-fuente**, NO señal de inestabilidad política/conflicto.
- NO hay: ACLED, UCDP, sanciones OFAC, datos militares/aviación/GPS-jam, earthquake, fire, cyber, displacement. Son conectores keyed de fases posteriores.
- IA activa del router = **openai** (ADR-009), no claude. Var `OPENAI_API_KEY` / `OPENAI_MODEL`.
- Persistencia: `@libsql/client` url `file:./data/world.db`. Prohibido `better-sqlite3`.
- Implicación de diseño: cualquier CII hoy solo puede nutrir **Information** (parcial, vía atención mediática financiera) y un proxy débil de actividad; **Unrest/Conflict/Security reales requieren los conectores keyed primero** → phase-split obligatorio. Ver [[design-doc-pattern]].
