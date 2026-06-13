---
name: events-layer-fase2
description: Capa de eventos globales (ADR-010, design-doc 2026-06-13-global-events.md) — qué fuentes entran/se difieren y el modelo de evento unificado que reemplaza gdelt_events. Crítico para la rebanada CII.
metadata:
  type: project
---

Diseño de la capa de eventos globales multi-fuente (1ª rebanada Fase 2, ADR-010). Doc: `docs/design/2026-06-13-global-events.md`.

**Why:** es la función núcleo del proyecto y desbloquea los componentes data-starved del CII. Sustituye la `gdelt_events` financiera de Fase 1 (que geocodea por país-FUENTE, no por suceso, y cuya GEO API murió).

**How to apply:** al diseñar el CII o cualquier scoring que consuma eventos, recuerda:
- **Modelo unificado**: tabla `events` general (no tabla-por-fuente) con columnas comunes (source, source_event_id, event_type, category natural|conflict, severity 0..100 normalizada, lat/lon REALES del suceso, country, occurred_at, captured_at, title/url) + `raw_json` para lo específico. UNIQUE (source, source_event_id) → dedup + UPSERT. Migración `003_events.sql` migra gdelt_events→events y dropa la vieja.
- **Fuentes que ENTRAN (keyless + geo real + ligeras, verificadas en vivo 2026-06-14)**: USGS earthquakes (Public Domain, coords epicentro, alert PAGER), NASA EONET v3 (dominio público, 13 categorías desastre natural, limit<=20 por 503), GDELT 2.0 raw Events CSV (libre+citación, coords del SUCESO no país-fuente, CSV 61 cols sin header por índice fijo, ETag).
- **Fuentes DIFERIDAS (con razón)**: ReliefWeb (appname pre-aprobado desde 2025-11-01, no keyless, sin lat/lon); UCDP (token email 3-5 días); ACLED (DNS no resuelve + ToS NO verificable = GUARDRAIL feedback_data_tos). Las dos últimas son la mejor señal de Conflict/Unrest del CII pero son rebanada keyed posterior con acción manual del usuario.
- **Severity normalizada**: cada fuente normaliza su métrica nativa incomparable (mag/sig/alert sísmico; magnitudeValue por categoría EONET; QuadClass/Goldstein/AvgTone GDELT) a 0..100 común en `severity.ts`. Valores re-derivados propios (no AGPL). Calibración entre tipos necesita iteración (OQ-4).
- **Bridge al CII (D-108)**: GDELT category=conflict → Conflict/Unrest (proxy honesto, keyless, hasta ACLED/UCDP); USGS alert>=yellow → earthquakeBoost; EONET wildfire → fireBoost. **Security sigue DEGRADADO** (ninguna de las 3 fuentes da militar/aviación/GPS-jam).
- Tiers: usgs→fast (max-age=60), eonet/gdelt→medium. Capas por TIPO en layers.config.ts con toggles (D-106). Atribución en UI (USGS/NASA/GDELT). Ver [[data-reality-fase1]] y [[design-doc-pattern]].
