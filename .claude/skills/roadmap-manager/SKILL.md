---
name: roadmap-manager
description: Use when necesitas leer, anadir, completar o repriorizar tareas del roadmap (plans/ROADMAP.md) o registrar/consultar decisiones arquitectonicas (plans/DECISIONS.md, ADR con IDs unicos), o generar un resumen de progreso con barra. Es la skill que gestiona el file-blackboard de planificacion.
---

# Skill: Roadmap Manager

> Habilidad para leer, actualizar y gestionar el roadmap del proyecto en `plans/ROADMAP.md` y el log de decisiones en `plans/DECISIONS.md`.

## Cuando usar esta skill

Cuando necesites:
- Ver el estado actual del roadmap.
- Anadir nuevas tareas o features al roadmap.
- Marcar tareas como completadas.
- Repriorizar tareas existentes.
- Registrar o consultar una decision arquitectonica (ADR).
- Generar un resumen de progreso.

## Archivos gestionados

### `plans/ROADMAP.md`
Fuente de verdad del roadmap. Estructura:

```markdown
# World Wide Project - Roadmap de Desarrollo

## Estado del Proyecto: [Mes Ano]

Progreso global: ████████░░ 80% (16/20 tareas)

### Completado
- [x] Feature A — descripcion breve — (YYYY-MM-DD)
- [x] Feature B — descripcion breve — (YYYY-MM-DD)

### En Progreso
- [ ] Feature C — [ALTA] [M] — descripcion — @agente

### Backlog (priorizado)
- [ ] Feature D — [ALTA] — descripcion
- [ ] Feature E — [MEDIA] — descripcion
- [ ] Feature F — [BAJA] — descripcion

### Mejoras Tecnicas
- [ ] Mejora X — descripcion

### Metricas
| Metrica | Valor |
|---------|-------|
| Conectores activos | N |
| Fuentes con ToS verificado | N |
| Cobertura de tests | N% |
```

### `plans/DECISIONS.md`
Log de decisiones arquitectonicas (ADR). Estructura:

```markdown
# World Wide Project - Decisions Log (ADR)

## ADR-001: [Titulo]
- **Fecha**: YYYY-MM-DD
- **Estado**: Propuesta | Aceptada | Rechazada | Superada por ADR-NNN
- **Contexto**: ...
- **Opciones**: ...
- **Decision**: ...
- **Consecuencias**: ...
```

ADR semilla recomendados (worldmonitor + osiris):
- **ADR-001**: base metodologia worldmonitor + cosecha de codigo osiris (MIT).
- **ADR-002**: re-implementar CII desde la metodologia documentada — **nunca copiar fuente AGPL de worldmonitor**.
- **ADR-003**: stack Vite + React + MapLibre + Turso + router LLM local-first.
- **ADR-004**: scheduler server-side + persistencia historica en Turso.

## Operaciones disponibles

### Ver roadmap
1. Leer `plans/ROADMAP.md`.
2. Presentar resumen al usuario con estado actual y barra de progreso.

### Anadir tarea
1. Determinar seccion (En Progreso / Backlog / Mejoras Tecnicas).
2. Asignar prioridad (ALTA / MEDIA / BAJA).
3. Estimar esfuerzo (S/M/L) si es posible.
4. Escribir la tarea en el formato del roadmap.
5. Registrar en `agent-comms.md` si afecta a otros agentes.

### Completar tarea
1. Mover la tarea de "En Progreso" / "Backlog" a "Completado".
2. Anadir fecha de completado.
3. Actualizar la barra de progreso y las metricas si aplica.
4. Registrar en `agent-comms.md` con `[STATUS] DONE`.

### Repriorizar
1. Leer roadmap actual.
2. Proponer nuevo orden al usuario con justificacion.
3. Aplicar cambios tras aprobacion.
4. Documentar la decision de repriorizar en `plans/DECISIONS.md` si es significativo.

### Registrar un ADR
1. **Lint de IDs unicos**: localiza el ultimo `ADR-NNN` y usa el siguiente numero. Nunca reutilices un numero (evita el bug del ADR duplicado).
2. Rellena el bloque ADR completo (fecha, estado, contexto, opciones, decision, consecuencias).
3. Si un ADR sustituye a otro, marca el viejo como `Superada por ADR-NNN` — nunca lo borres.

### Generar resumen de progreso
1. Contar tareas completadas vs pendientes.
2. Identificar bloqueadores en `agent-comms.md` (lineas `[BLOCKED]`).
3. Calcular velocidad de progreso (tareas/semana aprox).
4. Presentar resumen visual:

```
Progreso: ████████░░ 80% (16/20 tareas)
Bloqueadores: 1 (rate limit en conector GDELT)
Proxima entrega: panel de finanzas (markets)
```

## Reglas
- **Nunca borres tareas completadas** — son historial del proyecto.
- **Nunca reutilices un ID de ADR** — IDs estrictamente unicos.
- **Siempre justifica repriorizar** — documenta por que cambio el orden.
- **Consulta con el usuario** antes de cambiar prioridades ALTA.
- **Sincroniza con agent-comms.md** — cualquier cambio que afecte a agentes.
- **Solo el PM escribe en DECISIONS.md** — los especialistas proponen, el PM registra.
- **Actualiza la barra y las metricas** cuando se completen tareas significativas.
