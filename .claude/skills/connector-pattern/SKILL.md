---
name: connector-pattern
description: Use when anades o mantienes un conector de fuente de datos (packages/connectors/{finance,geo,edu}/<source>.ts) — aplica el patron osiris de route-normalization (fetch + User-Agent + AbortSignal.timeout(8000) + fallback multinivel + retorno vacio gracioso + cache/ETag), single-flight + serve-stale para datasets grandes, zero-key-first, checklist de ToS, y registro en server.ts.
---

# Skill: Connector Pattern

> Plantilla canonica para un conector de fuente de datos. Un fichero aislado por fuente. Cada conector es robusto, no tira nunca el servidor, y respeta los ToS de la fuente.

Contrato de error (typed-service-contracts): los conectores **nunca lanzan hacia arriba**. Devuelven datos o un resultado vacio gracioso. La UI lee de Turso (la DB local), no de upstream.

## Cuando usar esta skill

- Anades una fuente nueva en `packages/connectors/{finance,geo,edu}/<source>.ts`.
- Mantienes/arreglas un conector existente (timeout, fallback, cache).
- Revisas que un conector cumple el patron antes de registrarlo en `server.ts`.

## GUARDRAIL CRITICO — ToS antes de codigo

**Anadir una fuente cuyos Terms of Service NO estan verificados es Regla 6 (STOP).** Antes de escribir el conector:

1. Localiza la pagina de ToS / API policy / license de la fuente.
2. Confirma que el uso programatico esta permitido y bajo que rate limit.
3. Prefiere **zero-key-first**: fuentes sin API key cuando existan (GDELT keyless, markets keyless, country-risk publico).
4. Documenta el ToS verificado en el ADR (`plans/DECISIONS.md`) y en un comentario de cabecera del conector.

Si no puedes verificar el ToS -> DETENTE y reporta al PM. No conectes a ciegas.

## Patron canonico (osiris route-normalization)

```typescript
// packages/connectors/finance/markets.ts
//
// Fuente: <nombre>  |  ToS verificado: <url>  |  Key: zero-key
// Devuelve datos normalizados o un resultado vacio gracioso. NUNCA lanza hacia arriba.

import { z } from "zod";

const SOURCE_URL = "https://example.org/api/v1/quotes";
const USER_AGENT = "world-wide-project/1.0 (+contacto)";
const TIMEOUT_MS = 8000;

// Schema del payload upstream — parse-don't-validate en el borde.
const UpstreamSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  ts: z.number(),
});
const UpstreamArray = z.array(UpstreamSchema);

export interface MarketQuote {
  symbol: string;
  price: number;
  ts: number;
}

// Result discriminated-union: el caller ramifica sin try/catch.
export type ConnectorResult<T> =
  | { ok: true; data: T; stale: boolean }
  | { ok: false; data: T; error: { code: string; message: string } };

export async function fetchMarkets(): Promise<ConnectorResult<MarketQuote[]>> {
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Fallback nivel 1: status no-OK -> resultado vacio gracioso.
    if (!res.ok) {
      return emptyGraceful(`upstream ${res.status}`);
    }

    const json: unknown = await res.json();

    // parse-don't-validate: si el shape cambia, no explotamos.
    const parsed = UpstreamArray.safeParse(json);
    if (!parsed.success) {
      return emptyGraceful("schema mismatch");
    }

    const data: MarketQuote[] = parsed.data.map((q) => ({
      symbol: q.symbol,
      price: q.price,
      ts: q.ts,
    }));
    return { ok: true, data, stale: false };
  } catch (err) {
    // Fallback nivel 2: timeout/red/abort -> resultado vacio gracioso.
    const message = err instanceof Error ? err.message : "unknown";
    return emptyGraceful(message);
  }
}

function emptyGraceful(reason: string): ConnectorResult<MarketQuote[]> {
  return { ok: false, data: [], error: { code: "UPSTREAM_UNAVAILABLE", message: reason } };
}
```

### Reglas del patron (Do / Don't con razon)

- DO: `AbortSignal.timeout(8000)` en todo fetch — porque una fuente lenta no puede colgar el servidor ni el scheduler.
- DO: `User-Agent` identificable — porque muchas fuentes bloquean clientes anonimos y es buena ciudadania.
- DO: parse con Zod en el borde — porque un cambio de shape upstream debe degradar a vacio, no romper tipos aguas abajo.
- DO: retorno vacio gracioso (`data: []`) ante cualquier fallo — porque la app lee de Turso; un conector caido solo significa "sin datos nuevos esta ronda".
- DON'T: NO lances la excepcion hacia arriba — porque tumbaria el job del scheduler y/o el endpoint.
- DON'T: NO hagas el fetch desde el frontend — porque expone rate limits del cliente y rompe el modelo local-first.

## Single-flight + serve-stale (datasets grandes, estilo sanctions.ts)

Para fuentes pesadas o lentas (listas de sanciones, datasets geo grandes): coalesce peticiones concurrentes en una sola in-flight y sirve la ultima copia buena mientras refrescas.

```typescript
let inFlight: Promise<ConnectorResult<MarketQuote[]>> | null = null;
let lastGood: { data: MarketQuote[]; ts: number } | null = null;
const STALE_TTL_MS = 60 * 60 * 1000; // 1h

export async function getMarketsSingleFlight(): Promise<ConnectorResult<MarketQuote[]>> {
  if (inFlight) return inFlight; // single-flight: una sola peticion concurrente
  inFlight = (async () => {
    const r = await fetchMarkets();
    if (r.ok) lastGood = { data: r.data, ts: Date.now() };
    inFlight = null;
    // serve-stale: si fallo pero hay copia buena reciente, sirvela marcada stale
    if (!r.ok && lastGood && Date.now() - lastGood.ts < STALE_TTL_MS) {
      return { ok: true, data: lastGood.data, stale: true };
    }
    return r;
  })();
  return inFlight;
}
```

## Cache / ETag (opcional, fuentes que lo soportan)

Guarda el `ETag` / `Last-Modified` de la ultima respuesta y reenvialo en `If-None-Match` / `If-Modified-Since`. Un `304 Not Modified` -> reutiliza `lastGood` (ahorra ancho de banda y respeta el rate limit de la fuente).

## Registro en server.ts (wiring que el verifier comprueba)

Un conector no esta "hecho" hasta estar registrado en `server.ts` (cableado de connectors + scheduler + api). El verifier comprueba exactamente esto.

```typescript
// server.ts (extracto)
import { getMarketsSingleFlight } from "./packages/connectors/finance/markets";

connectors.register("finance.markets", getMarketsSingleFlight);
// y/o un job de scheduler por volatilidad:
scheduler.every("15m", "finance.markets", async () => {
  const r = await getMarketsSingleFlight();
  if (r.ok) await store.saveSnapshot("finance.markets", r.data); // time-series en Turso
});
```

## Checklist de Definition of Done

- [ ] ToS verificado y documentado (cabecera + ADR).
- [ ] `AbortSignal.timeout(8000)` + `User-Agent`.
- [ ] Parse con Zod en el borde.
- [ ] Fallback multinivel + retorno vacio gracioso (nunca lanza).
- [ ] Single-flight + serve-stale si el dataset es grande/lento.
- [ ] Registrado en `server.ts` (y job de scheduler si aplica).
- [ ] Persiste snapshot en Turso (la UI lee de la DB local).
- [ ] Verificacion `<60s`: `pnpm -w build` + `node --test` del conector.

## Frontera
**Nunca hagas commit, push ni tag.** Haces el trabajo, lo verificas y lo reportas; solo el PM integra. Si no llegas a un estado que pasa la verificacion en 2 intentos -> reporta `BLOCKED`. La disciplina de TDD esta en `superpowers:test-driven-development` (REFERENCIA).
