---
name: convergence-fase2
description: Motor de convergencia cross-domain (rebanada 4, design-doc 2026-06-15-convergence.md). Consume CII+events+signals+markets, dispara señal cuando >=2 familias-de-dato disjuntas corroboran deterioro en mismo país/72h. Paquete NUEVO @www/core-signals. Crítico para cualquier scoring que cruce dominios o para la rebanada de superficie (API/mapa de convergencia).
metadata:
  type: project
---

Diseño del motor de convergencia cross-domain (4ª rebanada Fase 2). Doc: `docs/design/2026-06-15-convergence.md` (version alpha). Numeración D-3xx (sin colisión: D-0xx bloqueadas, D-2xx = CII hasta D-213, ADR último = ADR-011).

**Why:** es la pregunta de orden superior de la plataforma — cuándo varias señales INDEPENDIENTES apuntan al MISMO deterioro en el MISMO país a la vez (el patrón pre-crisis que un humano mono-dominio no ve). El CII (rebanada 3) y events/signals (1/2) responden "qué pasa en X"; convergencia responde "qué coincide".

**How to apply:** al planificar/implementar convergencia, o al diseñar la rebanada de superficie (API/mapa) o cualquier scoring cross-dominio, recuerda:
- **Premisa FIJA (D-300, Q1 ratificada por PM, NO re-negociable)**: CII por-dimensión por-país = capa de observación canónica; markets = ÚNICA fuente exógena; **independencia = familias-de-dato DISJUNTAS** + ≥2 corroborantes con ≥1 no-CII **o** dos componentes CII de origen disjunto.
- **Anti-doble-conteo POR CONSTRUCCIÓN (D-306, el corazón)**: cuenta fuentes-independientes = nº de `dataFamily` DISTINTAS sobre umbral, NUNCA nº de componentes. Mapeo dimensión→familia: `conflict`+`social`→`events`; `economic`+`political`→`signals`; markets→`markets`. **Consecuencia crítica (D-310/OQ-H, mayor impacto)**: "political × economic" comparten familia `signals` → NO son par independiente; el set realmente detectable se reduce a `events × signals` y `cualquiera × markets`. El PM debe aceptar esto.
- **Paquete NUEVO `@www/core-signals`** = `packages/core/signals/` (AÚN NO EXISTE, lo crea el PM tras /check-plan). Función PURA `detectConvergence(observations, nowMs)` + orquestador IO `detectAllConvergence` (D-301). Empezar por la pura + test anti-doble-conteo R1.
- **Parámetros {conv.params}** re-derivados (no-AGPL, D-001): `MIN_SOURCES=2`, `MIN_MAGNITUDE=0.5`, ventana 72h. `strength` = magnitud media (una por familia) con time-decay 72h, half-life recomendado 36h (D-307, distinto del decay 30d del CII).
- **Magnitud [0,1] (D-303)**: CII score/100; severity/100; signal = blend tono-negativo+volumen (refs `VOLUME_REF`/`MARKET_REF` editoriales en `convergence.config.ts`); markets = |regimeDelta|/MARKET_REF. Corroborante CII exige `signalPresent=true` (D-304, no floors fantasma).
- **markets (D-305, OQ-D)**: corroborante exógeno TRANSVERSAL, NO entidad GLOBAL propia, NO difusión por-país (inventaría geografía). Es el "+1 no-CII" de D-300 para países en deterioro económico.
- **Granularidad temporal (D-302/OQ-B)**: anclar observación al snapshot CII (`capturedAt`), events/signals crudos solo como evidencia de corroboración. Ventana filtra `ts >= now-72h`.
- **Persistencia (D-308)**: tabla NUEVA `convergence_signals` migración **`005_convergence.sql`** (001 init, 002 events, 003 signals, 004 cii existen). Wide-tipada + `families_json`/`components_json`/`dimensions_json`. Append-snapshot (NO upsert mutable), patrón time-series del store. `dynamic_score` = delta strength (D-309).
- **Alcance MVP (D-310/D-311)**: solo persiste + enriquece briefing (D-005, sin LLM nuevo). **NO API `/api/convergence` ni capa mapa (NG-4)** → rebanada de superficie posterior. Job tier `medium` ENCADENADO tras CII (D-312, lee snapshots frescos).
- **NON-GOALS firmes**: familias avanzadas/triples/cross-país (NG-1), ML (NG-2), alertas push (NG-3), API+mapa (NG-4), conectores keyed nuevos (NG-5), re-derivar CII = input INMUTABLE (NG-6), reverse-geocode/NER (NG-7).
- **GAPs que el PM ratifica antes de planificar**: GAP-1 (contrato de la señal de markets en store Fase 1 NO verificado esta sesión — el implementador confirma que hay indicador de régimen/volatilidad o markets degrada/se difiere); GAP-4 (solapamiento por-país events×signals en ventana 72h no medido — riesgo de que el MVP emita pocas señales). OQ-H = la de mayor impacto.

Ver [[cii-scoring-fase2]], [[events-layer-fase2]], [[geoeconomic-radar-fase2]], [[data-reality-fase1]], [[design-doc-pattern]].
