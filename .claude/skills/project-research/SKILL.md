---
name: project-research
description: Use when necesitas investigar una libreria, framework, API o fuente de datos antes de adoptarla, comparar alternativas tecnologicas, verificar precios/limites/ToS de un servicio externo, o buscar mejores practicas — produce una tabla de alternativas y documenta la decision como ADR en plans/DECISIONS.md.
---

# Skill: Project Research

> Habilidad para investigar features, librerias, APIs, fuentes de datos y mejores practicas via web, y cerrar con una decision documentada (ADR).

## Cuando usar esta skill

Cuando el PM Coordinator (o cualquier agente con acceso web) necesite:

- Investigar una nueva libreria o framework antes de adoptarlo (ej: MapLibre GL JS 5 vs Mapbox GL).
- Comparar alternativas tecnologicas (ej: Turso vs SQLite-en-fichero vs Postgres; Ollama vs llama.cpp local).
- Buscar mejores practicas para implementar una feature (ej: time-series en SQLite, scheduler cron en Node).
- Investigar APIs/fuentes de datos de terceros (GDELT, ACLED, World Bank, Yahoo Finance/markets, sanctions lists).
- **Verificar precios, limites de rate y — CRITICO — los Terms of Service de cada fuente upstream** antes de conectarla.
- Buscar documentacion oficial de herramientas del stack.

## Workflow de investigacion (5 pasos)

### 1. Definir el objetivo
Antes de buscar, clarificar en una frase:
- Que problema queremos resolver.
- Que restricciones tenemos (stack Node/TypeScript, presupuesto local-first, un solo dev).
- Que criterios de evaluacion usaremos (zero-key-first, ToS permisivos, mantenimiento activo).

### 2. Buscar informacion
Usar `WebSearch` para encontrar, en este orden de preferencia:
- Documentacion oficial de la fuente/libreria.
- Articulos comparativos recientes (preferir 2025-2026; descartar lo anterior a 2023 salvo specs estables).
- Repositorios GitHub con estrellas y commits recientes (mantenimiento activo).
- Opiniones de la comunidad (Reddit, HN, Stack Overflow) como senal secundaria.

Para fuentes de datos: localiza explicitamente la pagina de **Terms of Service / API policy / license** y la pagina de **rate limits**. Si no encuentras ToS claros, eso es por si mismo un hallazgo (riesgo).

### 3. Analizar alternativas
Para cada alternativa, rellenar la tabla:

| Criterio | Alternativa A | Alternativa B | Alternativa C |
|----------|---------------|---------------|---------------|
| Pros | ... | ... | ... |
| Contras | ... | ... | ... |
| Precio / Free tier | ... | ... | ... |
| Requiere API key? | si/no | si/no | si/no |
| Rate limit | ... | ... | ... |
| ToS / licencia | ... | ... | ... |
| Complejidad integracion | baja/media/alta | ... | ... |
| Mantenimiento (ultimo release) | ... | ... | ... |
| Compatibilidad con stack | ... | ... | ... |

### 4. Recomendar
Proponer la mejor opcion con justificacion clara:
- Por que es la mejor para nuestro caso (zero-key-first y ToS permisivos pesan mucho).
- Que riesgos tiene (rate limits, fragilidad de la fuente, cambios de ToS).
- Como se integraria en el monorepo (que paquete, que conector, que job de scheduler).
- Estimacion de esfuerzo (S/M/L).

### 5. Documentar
Guardar los hallazgos en `plans/DECISIONS.md` como un ADR. **Antes de escribir, comprueba el ultimo ADR-NNN existente y usa el siguiente numero (IDs unicos — nunca reutilices un numero).**

```markdown
## ADR-NNN: Eleccion de {tecnologia/fuente} para {proposito}
- **Fecha**: YYYY-MM-DD
- **Estado**: Propuesta
- **Contexto**: [problema a resolver]
- **Opciones**:
  1. {Opcion A} — [pros/contras]
  2. {Opcion B} — [pros/contras]
- **Decision**: {opcion elegida} porque {justificacion}
- **ToS verificado**: si/no — [url]
- **Consecuencias**: {que implica para el monorepo}
```

## Herramientas disponibles
- **WebSearch**: Busquedas web generales.
- **WebFetch**: Leer contenido de URLs especificas (docs, ToS, paginas de pricing).
- **Read**: Leer archivos del proyecto para contexto.

## Contexto del proyecto (stack actual)
Al investigar, ten en cuenta el stack de la plataforma de world-intelligence:
- **Backend**: Node + TypeScript, servidor unico `server.ts` (cablea connectors + scheduler + api).
- **Persistencia**: Turso (`@libsql/client`), incluyendo time-series historica (la UI lee de la DB local, no de upstream).
- **Conectores**: `packages/connectors/{finance,geo,edu}/<source>.ts` — patron fetch + timeout + fallback + retorno vacio gracioso.
- **Scheduler**: jobs cron server-side por volatilidad (`packages/scheduler/`).
- **Core**: CII scoring, señales de convergencia y router LLM (`packages/core/{cii,signals,ai}`).
- **Frontend**: Vite + React + TypeScript + MapLibre GL (`packages/web/`).
- **Router LLM**: local-first `ollama -> groq -> claude`.
- **Presupuesto**: proyecto personal, preferir zero-key / free tier / local-first.
- **Equipo**: 1 desarrollador + agentes IA.

## Regla anti-duplicacion
La metodologia de investigacion exploratoria mas amplia y la fase de diseño viven en `superpowers:brainstorming` y en la skill local `design-doc`. Esta skill es el paso concreto **investigar opcion -> tabla -> ADR**; no recrees aqui un flujo de brainstorming completo.
