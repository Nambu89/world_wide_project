---
name: llm-router
description: Use when implementas o ajustas la sintesis IA o el router de proveedores LLM (packages/core/ai) — patron local-first multi-proveedor con PROVIDER_CHAIN ['ollama','groq','claude'], health-gating, fall-through por key ausente, streaming + stripping de thinking-tags, ruteo por tarea (summarize->ollama, bulk-classify->groq, daily-brief->claude), serializeContext + persona + plantilla. Metodologia re-implementada de worldmonitor, NUNCA codigo AGPL copiado.
---

# Skill: LLM Router (local-first)

> Router de LLM multi-proveedor con estrategia local-first. Prioriza coste cero y privacidad (Ollama local), cae a velocidad barata (Groq), y reserva la alta calidad (Claude) para el briefing diario y el razonamiento de convergencia (1-2 llamadas/dia).

## GUARDRAIL CRITICO — licencia

La metodologia de worldmonitor (orden de la cadena, health-gating, gateway pipeline) es **re-implementable** porque las ideas/formulas no son copyrightables. La **fuente AGPL de worldmonitor NO se copia**. Re-implementa desde la metodologia documentada, no desde el codigo. Si dudas de la procedencia de un fragmento -> no lo uses.

## Cuando usar esta skill

- Implementas o ajustas el router en `packages/core/ai`.
- Anades ruteo por tipo de tarea (summarize / bulk-classify / daily-brief).
- Integras serializeContext + persona + plantilla de briefing (ver osiris ai-engine.ts re-apuntado).

## PROVIDER_CHAIN local-first

```typescript
// packages/core/ai/router.ts
export const PROVIDER_CHAIN = ["ollama", "groq", "claude"] as const;
export type Provider = (typeof PROVIDER_CHAIN)[number];
```

Orden y razon:
- **ollama** (local): primero. Coste cero, privacidad. Para summarize y tareas de alto volumen.
- **groq** (cloud barato/rapido): segundo. Para bulk-classify cuando ollama no esta o es muy lento.
- **claude** (alta calidad): ultimo. Reservado para el briefing diario y razonamiento de convergencia. Es una RAMA del PROVIDER_CHAIN, no un tier de agente de desarrollo.

> Para model ids / pricing / params de Claude, REFERENCIA la skill global `claude-api`. No dupliques esos datos aqui (cambian).

## Health-gating + fall-through por key ausente

Antes de usar un proveedor, comprueba que esta disponible. Si la key no existe o el health-check falla, **cae al siguiente de la cadena** sin lanzar.

```typescript
interface ProviderState {
  available: boolean;     // health-check OK
  hasKey: boolean;        // env var presente (ollama no necesita key)
}

async function probe(p: Provider): Promise<ProviderState> {
  switch (p) {
    case "ollama":
      // local: ping al daemon; no requiere key
      return { available: await pingOllama(), hasKey: true };
    case "groq":
      return { available: !!process.env.GROQ_API_KEY, hasKey: !!process.env.GROQ_API_KEY };
    case "claude":
      return { available: !!process.env.ANTHROPIC_API_KEY, hasKey: !!process.env.ANTHROPIC_API_KEY };
  }
}

async function pickProvider(preferred?: Provider): Promise<Provider | null> {
  const order = preferred
    ? [preferred, ...PROVIDER_CHAIN.filter((p) => p !== preferred)]
    : [...PROVIDER_CHAIN];
  for (const p of order) {
    const st = await probe(p);
    if (st.available && st.hasKey) return p;
  }
  return null; // ninguno disponible -> degradar gracioso (sin sintesis IA esta ronda)
}
```

## Ruteo por tarea

```typescript
export type AiTask = "summarize" | "bulk-classify" | "daily-brief";

const TASK_PREFERENCE: Record<AiTask, Provider> = {
  "summarize": "ollama",     // alto volumen, bajo coste -> local
  "bulk-classify": "groq",   // throughput barato
  "daily-brief": "claude",   // 1-2/dia, calidad maxima -> razonamiento de convergencia
};

export async function route(task: AiTask): Promise<Provider | null> {
  return pickProvider(TASK_PREFERENCE[task]);
}
```

## Streaming + stripping de thinking-tags

Al hacer streaming, elimina los bloques de "pensamiento" del proveedor antes de mostrarlos al usuario (algunos modelos emiten `<think>...</think>`).

```typescript
const THINK_RE = /<think>[\s\S]*?<\/think>/g;
export function stripThinking(chunk: string): string {
  return chunk.replace(THINK_RE, "");
}
```

## serializeContext + persona + plantilla (osiris ai-engine.ts, re-apuntado)

El pipeline de sintesis: serializar el contexto del dominio -> aplicar una persona de analista -> rellenar una plantilla -> enviar al proveedor ruteado.

```typescript
// packages/core/ai/brief.ts
function serializeContext(snapshot: WorldSnapshot): string {
  // Compacta el estado actual (CII, señales, top eventos) a texto denso y barato en tokens.
  return [
    `Fecha: ${snapshot.date}`,
    `Top riesgos CII: ${snapshot.topCII.map((c) => `${c.country}:${c.score}`).join(", ")}`,
    `Señales de convergencia: ${snapshot.signals.join("; ")}`,
  ].join("\n");
}

const ANALYST_PERSONA =
  "Eres un analista de inteligencia geopolitico-financiera senior. " +
  "Eres conciso, citas evidencia, distingues señal de ruido y nunca inventas datos.";

const BRIEF_TEMPLATE = (ctx: string) =>
  `${ANALYST_PERSONA}\n\nContexto:\n${ctx}\n\n` +
  `Tarea: produce el briefing diario en <=200 palabras: 3 puntos de mayor convergencia ` +
  `y 1 riesgo emergente. Marca incertidumbre explicitamente.`;

export async function dailyBrief(snapshot: WorldSnapshot): Promise<string> {
  const provider = await route("daily-brief");
  if (!provider) return "(briefing no disponible: ningun proveedor LLM activo)";
  const ctx = serializeContext(snapshot);
  return callProvider(provider, BRIEF_TEMPLATE(ctx)); // callProvider hace streaming + stripThinking
}
```

## Do's and Don'ts (con razon)

- DO: prueba `pickProvider` con TODAS las keys ausentes -> debe devolver `null` y degradar gracioso, no lanzar — porque la plataforma debe funcionar sin IA.
- DO: rutea `daily-brief` a claude solo — porque es el unico punto donde la calidad justifica el coste (1-2 llamadas/dia).
- DON'T: NO anadas un proveedor nuevo al PROVIDER_CHAIN sin pasar por el PM — es un cambio arquitectonico (Regla 4, STOP).
- DON'T: NO copies fuente AGPL de worldmonitor — solo metodologia.
- DON'T: NO muestres thinking-tags al usuario — usa `stripThinking`.

## Definition of Done
- [ ] PROVIDER_CHAIN + health-gating + fall-through por key ausente.
- [ ] Ruteo por tarea (summarize/bulk-classify/daily-brief).
- [ ] Streaming con stripping de thinking-tags.
- [ ] serializeContext + persona + plantilla.
- [ ] Degrada gracioso a `null`/mensaje cuando no hay proveedor.
- [ ] Verificacion `<60s`: `pnpm -w build` + `node --test` del router (con keys mockeadas/ausentes).

## Frontera
**Nunca commit/push/tag.** Anadir un proveedor al chain es decision del PM (STOP y pregunta). Reporta `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED` con la salida de verificacion literal.
