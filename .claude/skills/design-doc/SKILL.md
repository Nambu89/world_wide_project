---
name: design-doc
description: Use when escribes un documento de diseño o arquitectura ANTES de implementar (la fase Research+Design del RPI) — produce docs/design/YYYY-MM-DD-<topic>.md con formato de seccion-fija + front-matter + token-references {namespace.key} + Do/Don't-con-razon + Iteration Guide + Known Gaps + Non-Goals(>=1) + Decisions D-NNN. La consume system-architect; el hook spec-validator la valida.
---

# Skill: Design Doc

> Autoria de documentos de diseño/arquitectura con un formato fijo, parseable y verificable. Un design-doc es a la vez documentacion para el humano Y el prompt que un subagente consume directamente, sin traduccion.

Principio rector (design.md): **"Los tokens dan al agente los valores exactos; la prosa le dice POR QUE esos valores existen y como aplicarlos."** El bloque estructurado es normativo; la prosa da el porque.

## Cuando usar esta skill

- Antes de cualquier implementacion no trivial: el PM invoca a `system-architect` para producir el design-doc, que despues pasa por `plan-checker`.
- Cuando hay que decidir entre 2-3 enfoques arquitectonicos y dejar la decision por escrito y referenciable.
- Cuando el diseño toca el schema de Turso, el PROVIDER_CHAIN del router LLM, un nuevo job de scheduler o una nueva ruta en `server.ts` (cambios de Regla 4 que requieren diseño previo).

## Donde se escribe

`docs/design/YYYY-MM-DD-<topic>.md` — un fichero por topico, datado. Es el unico lugar donde escribe `system-architect`.

## Interrogacion antes de spec (gate previo)

Antes de redactar, haz exploracion silenciosa del codigo (no preguntes lo que el codigo ya revela) y clasifica los requisitos:

- **KNOWN**: lo que ya esta confirmado por el codigo/el usuario.
- **ASSUMED**: lo que asumes y debe validarse.
- **UNKNOWN**: lo que falta por decidir.

Despues, **una pregunta por mensaje** (multiple-choice con opcion recomendada), priorizando arquitectura > comportamiento > naming, con un tope de ~10 preguntas. Termina proponiendo **2-3 enfoques con pros/contras/esfuerzo/riesgo** y una recomendacion. Para el flujo de exploracion/brainstorm mas amplio, REFERENCIA `superpowers:brainstorming` — no lo recrees aqui.

## Front-matter obligatorio

Todo design-doc empieza con front-matter YAML:

```yaml
---
version: alpha            # alpha | beta | stable
name: <topic-kebab>
description: <una frase densa que captura la esencia/intencion en una lectura>
status: draft             # draft | approved | superseded
date: YYYY-MM-DD
owner: system-architect
---
```

## Secciones obligatorias y EN ORDEN

El validador (`spec-validator.js`) comprueba presencia y orden. Schema fijo:

1. **Overview** — que es, en 2-4 frases. El problema y el resultado deseado.
2. **Goals** — objetivos medibles (lista).
3. **Non-Goals** — **minimo 1**. Lo que este diseño NO cubre (combate el scope creep).
4. **Context / Constraints** — restricciones del stack (Node/TypeScript, Turso, MapLibre, router local-first), datos disponibles, ToS de fuentes.
5. **Decisions** — decisiones numeradas `D-NNN` con **rationale**. Cada una: `D-001: <decision> — porque <razon>`. Son referenciables desde el plan, el codigo y los commits. Las decisiones bloqueadas por el usuario se marcan y son no-negociables.
6. **Interfaces / Data Contracts** — firmas, tipos, schema Turso, formato de payloads. Usa token-references (abajo).
7. **Do's and Don'ts** — reglas con RAZON (ver patron abajo).
8. **Risks** — riesgos con mitigacion.
9. **Iteration Guide** — procedimiento para que un subagente edite el doc o el codigo asociado (ver abajo).
10. **Known Gaps / Open Questions** — lo que NO cubre y lo incierto. Obligatoria — evita la confianza alucinada.

Secciones desconocidas: se conservan con WARNING. Secciones duplicadas: se rechazan.

## Token-references

Refiere valores/decisiones compartidas por nombre simbolico en vez de repetir el valor: `{namespace.key}`. Define todos los tokens en un bloque canonico por doc; el validador comprueba que cada referencia resuelve (no hay `{token}` colgante).

Ejemplos para esta plataforma:
- `{schema.snapshot.ts}` — la columna timestamp de la time-series en Turso.
- `{router.chain}` — `['ollama','groq','claude']`.
- `{cii.weights.event}` — el blend de pesos del evento.
- `{api.connector.timeout}` — `AbortSignal.timeout(8000)`.

Variantes de estado: `{connector.markets}-stale` para referirse al fallback servido en stale.

## Patron Do's and Don'ts con razon

Cada regla lleva su porque (una regla con rationale es mas dificil de racionalizar para un implementador):

```markdown
- DO: persiste cada snapshot en Turso antes de servirlo — porque la UI lee de la DB local, no de upstream, y asi sobrevive a caidas de la fuente.
- DON'T: NO hagas fetch directo desde el frontend a la fuente upstream — porque expone rate limits del cliente y rompe el modelo local-first {router.chain}.
- DON'T: NO copies fuente AGPL de worldmonitor — porque solo la metodologia documentada es re-implementable; el codigo no.
```

## Iteration Guide (procedimiento embebido)

Incluye siempre una guia operativa para el siguiente agente:

```markdown
## Iteration Guide
- Trabaja UNA pieza a la vez (un conector, un panel, una tabla).
- Refiere componentes y tokens por nombre directamente ({schema.snapshot.ts}, {router.chain}).
- Anade variantes nuevas como entradas separadas, no reescribas las existentes.
- Tras cada edicion del doc, deja que spec-validator.js valide el schema.
- Cierra cada flujo de punta a punta antes de pasar al siguiente: cobertura parcial es peor que ninguna.
```

## Definition of Done del design-doc

- Front-matter presente y completo.
- Las 10 secciones presentes y en orden.
- `Non-Goals` con >= 1 entrada.
- Cada `D-NNN` con rationale; IDs unicos.
- Sin `{token.reference}` colgante.
- `Known Gaps` no vacia.
- Auto-revisado por el autor antes de pasarlo a `plan-checker`.

## Frontera
Esta skill produce SOLO el documento. NO implementa codigo. La generacion del plan ejecutable a partir del diseño aprobado vive en `superpowers:writing-plans` (REFERENCIA, no recrear). El gate previo a implementar es `plan-checker`.
