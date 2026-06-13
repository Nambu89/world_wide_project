---
name: cii-scoring
description: Use when implementas scoring de riesgo CII o señales de convergencia cross-source (packages/core/{cii,signals}) — re-implementacion limpia (no-AGPL) de la metodologia CII de worldmonitor: pesos documentados (event-blend 0.25/0.30/0.20/0.25, composite=baseline*0.4+event*0.6), normalizacion por señal, floors, time-decay ACLED, y la taxonomia de señales de convergencia. Criterios gradeables, no vibes. Solo metodologia documentada, jamas fuente AGPL.
---

# Skill: CII Scoring & Convergence Signals

> Re-implementacion limpia del Composite Instability Index (CII) y de la taxonomia de señales de convergencia cross-source, a partir de la metodologia documentada de worldmonitor. Criterios gradeables (no "se ve bien"); cada formula es verificable con un test.

## GUARDRAIL CRITICO — licencia

worldmonitor es AGPL. **Nunca copies su codigo fuente.** Las formulas, pesos y la taxonomia (la metodologia documentada) NO son copyrightables y se re-implementan limpiamente. Si tienes delante un fragmento de fuente AGPL -> no lo uses; deriva la implementacion de la descripcion de la metodologia.

## Cuando usar esta skill

- Implementas/ajustas el motor de scoring CII en `packages/core/cii`.
- Implementas la deteccion de señales de convergencia en `packages/core/signals`.
- Diseñas los criterios gradeables del scoring (no vibes).

## Modelo CII (metodologia re-implementada)

El CII combina un **baseline** estructural (lento, estable) con un **event score** (rapido, volatil), via un composite ponderado.

### Pesos documentados

```typescript
// packages/core/cii/weights.ts
// Pesos re-implementados desde la metodologia documentada (NO copiados de AGPL).

// Blend del event score a partir de sub-señales del evento.
export const EVENT_BLEND = {
  conflict: 0.25,   // intensidad de conflicto / violencia
  economic: 0.30,   // shocks economicos / financieros
  political: 0.20,  // inestabilidad politica / gobernanza
  social: 0.25,     // tension social / desplazamiento
} as const;
// suma = 1.00 (invariante verificable en test)

// Composite final: baseline estructural + evento volatil.
export const COMPOSITE = {
  baseline: 0.4,
  event: 0.6,
} as const;
// suma = 1.00 (invariante verificable en test)
```

### Normalizacion por señal + floors

Cada sub-señal se normaliza al rango `[0, 1]` antes de mezclar. Un **floor** evita que una señal ausente colapse a cero artificialmente (un pais sin datos de conflicto no es "0 riesgo de conflicto").

```typescript
// packages/core/cii/normalize.ts
export function normalize(value: number, min: number, max: number, floor = 0): number {
  if (max <= min) return floor;
  const n = (value - min) / (max - min);
  return Math.max(floor, Math.min(1, n)); // clamp a [floor, 1]
}
```

### Time-decay (estilo ACLED)

Los eventos pierden peso con el tiempo: un evento de hace 30 dias pesa menos que uno de hoy. Decaimiento exponencial con vida media configurable.

```typescript
// packages/core/cii/decay.ts
const HALF_LIFE_DAYS = 30;
export function timeDecay(ageDays: number, halfLife = HALF_LIFE_DAYS): number {
  return Math.pow(0.5, ageDays / halfLife); // 1.0 hoy -> 0.5 a los 30 dias
}
```

### Calculo del event score y del composite

```typescript
// packages/core/cii/score.ts
import { EVENT_BLEND, COMPOSITE } from "./weights";
import { normalize } from "./normalize";
import { timeDecay } from "./decay";

export interface SubSignals {
  conflict: number;   // ya normalizado [0,1]
  economic: number;
  political: number;
  social: number;
}

export function eventScore(s: SubSignals): number {
  return (
    s.conflict * EVENT_BLEND.conflict +
    s.economic * EVENT_BLEND.economic +
    s.political * EVENT_BLEND.political +
    s.social * EVENT_BLEND.social
  ); // [0,1]
}

export function compositeCII(baseline: number, event: number): number {
  return baseline * COMPOSITE.baseline + event * COMPOSITE.event; // [0,1]
}
```

## Señales de convergencia cross-source

Una **señal de convergencia** se dispara cuando >=2 fuentes independientes apuntan al mismo deterioro en la misma entidad/ventana temporal (mas fuerte que cualquier señal aislada). La taxonomia documentada cubre familias como: spike de conflicto + caida de mercado; sancion nueva + fuga de capital; tension politica + desplazamiento social; etc.

```typescript
// packages/core/signals/convergence.ts
export interface Observation {
  source: string;     // 'gdelt' | 'markets' | 'sanctions' | ...
  entity: string;     // pais / region
  dimension: keyof SubSignals;
  magnitude: number;  // [0,1] normalizado
  ts: number;
}

export interface ConvergenceSignal {
  entity: string;
  dimensions: string[];
  sources: string[];
  strength: number;   // [0,1]
  window: { from: number; to: number };
}

const WINDOW_MS = 72 * 60 * 60 * 1000; // 72h
const MIN_SOURCES = 2;
const MIN_MAGNITUDE = 0.5;

export function detectConvergence(obs: Observation[]): ConvergenceSignal[] {
  const byEntity = new Map<string, Observation[]>();
  for (const o of obs) {
    if (o.magnitude < MIN_MAGNITUDE) continue;
    (byEntity.get(o.entity) ?? byEntity.set(o.entity, []).get(o.entity)!).push(o);
  }
  const out: ConvergenceSignal[] = [];
  for (const [entity, list] of byEntity) {
    const sorted = [...list].sort((a, b) => a.ts - b.ts);
    // ventana deslizante: agrupa observaciones dentro de 72h
    for (let i = 0; i < sorted.length; i++) {
      const window = sorted.filter(
        (o) => o.ts >= sorted[i].ts && o.ts <= sorted[i].ts + WINDOW_MS,
      );
      const sources = [...new Set(window.map((o) => o.source))];
      if (sources.length < MIN_SOURCES) continue;
      const dimensions = [...new Set(window.map((o) => o.dimension))];
      // fuerza = magnitud media con decay aplicado al borde de la ventana
      const strength =
        window.reduce(
          (acc, o) => acc + o.magnitude * timeDecayWithinWindow(o.ts, sorted[i].ts),
          0,
        ) / window.length;
      out.push({
        entity,
        dimensions,
        sources,
        strength: Math.min(1, strength),
        window: { from: sorted[i].ts, to: sorted[i].ts + WINDOW_MS },
      });
    }
  }
  return dedupe(out);
}
```

(`timeDecayWithinWindow` y `dedupe` son helpers locales; aplica el mismo `timeDecay` de la familia CII y deduplica señales solapadas por entidad/ventana.)

## Criterios gradeables (no vibes)

Define el "correcto" con criterios verificables, no con sensaciones:

- "La suma de `EVENT_BLEND` es exactamente 1.00" (test de invariante).
- "La suma de `COMPOSITE` es exactamente 1.00" (test).
- "`normalize(min, min, max)` devuelve el floor, no NaN" (test de borde).
- "`timeDecay(0) === 1` y `timeDecay(30) === 0.5`" (test).
- "una señal con 1 sola fuente NO se reporta como convergencia" (test del `MIN_SOURCES`).
- "`compositeCII` siempre cae en `[0,1]`" (test de rango sobre inputs aleatorios).

## Do's and Don'ts (con razon)

- DO: documenta cada peso con su procedencia metodologica — porque debe ser auditable y defendible.
- DO: aplica floors — porque "sin datos" no es "sin riesgo"; un cero artificial sesga el composite.
- DON'T: NO copies fuente AGPL — solo re-implementa la metodologia.
- DON'T: NO ajustes pesos "a ojo" sin test/ADR — porque rompe la reproducibilidad del scoring.
- DON'T: NO cambies un peso publicado sin abrir un ADR (es decision arquitectonica, Regla 4 STOP).

## Definition of Done
- [ ] Pesos documentados con invariantes (suman 1.00) cubiertos por test.
- [ ] Normalizacion con floors y clamp `[0,1]`.
- [ ] Time-decay con vida media configurable.
- [ ] eventScore + compositeCII en rango `[0,1]`.
- [ ] detectConvergence respeta MIN_SOURCES y la ventana temporal.
- [ ] Verificacion `<60s`: `node --test` de `packages/core/cii` y `packages/core/signals`.

## Frontera
**Nunca commit/push/tag.** Cambiar pesos publicados = ADR (PM decide). Reporta status con la salida de verificacion literal. Para la rubrica gradeable de evaluacion mas amplia, alinea con la disciplina rubric-driven (criterios explicitos, no vibes).
