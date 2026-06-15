# System Architect — Memory Index

- [design-doc-pattern](design-doc-pattern.md) — formato sección-fija y convenciones que sigue este proyecto para los design-docs.
- [data-reality-fase1](data-reality-fase1.md) — qué hay REALMENTE en el store tras Fase 1 (crítico para diseñar scoring/CII).
- [events-layer-fase2](events-layer-fase2.md) — capa de eventos globales (ADR-010): modelo unificado `events`, fuentes que entran/se difieren, bridge al CII.
- [geoeconomic-radar-fase2](geoeconomic-radar-fase2.md) — radar geoeconómico temático (ADR-011): tabla NUEVA `signals` (article-level, separada de events) + clasificador editorial GKG. 6 secciones.
- [cii-scoring-fase2](cii-scoring-fase2.md) — CII REFRESCADO (doc 2026-06-15, supersede el data-starved 2026-06-13). Premisa invertida: events+signals dan fuente real keyless a 4 componentes {conflict,economic,political,social}.
