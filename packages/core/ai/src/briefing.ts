// packages/core/ai/src/briefing.ts
// Pipeline de briefing diario financiero (D-105, D-106)
//
// Flujo:
//   1. getCachedBriefing() — si existe y no expiró, lo devuelve (NO llama al proveedor LLM).
//   2. serializeContext() — lee getLatestMarkets() y getEvents() del store (nunca upstream).
//   3. complete() via router — llama al proveedor activo (rama openai en MVP).
//   4. saveBriefing() — persiste con valid_until = now + 24h.
//
// Degradación (R-2): si el proveedor LLM no responde, sirve el último cacheado o
// devuelve un Briefing con estado "briefing no disponible".
//
// T-14: serializeContext acepta EventRow[] (tabla events unificada, todas las fuentes
// incl. GDELT raw CSV). Reemplaza el bloque GDELT-financiero legacy que leía GdeltEvent[].
// generateDailyBriefing alimenta el contexto vía getEvents({sinceMs, minSeverity, limit})
// en vez de getRecentGdeltEvents. Contrato D-106 (caché 24h) y degradación R-2 intactos.

import {
  getCachedBriefing,
  saveBriefing,
  getLatestMarkets,
  getEvents,
  migrate,
  type MarketSnapshot,
  type EventRow,
  type EventFilter,
  type Briefing,
} from '@www/store';
import { complete, pickProvider } from './router.js';
import { buildBriefingPrompt } from './persona.js';

// ─── Global risk context (T-14) ──────────────────────────────────────────────

/**
 * Construye un bloque de texto con los top-N eventos globales ordenados por
 * severity descendente (desempate: occurred_at / capturedAt DESC).
 *
 * Formato por línea:
 *   - [event_type] [country|—] sev=[severity] @ [occurred_at ISO | capturedAt ISO]
 *
 * Metodología: se seleccionan hasta TOP_N eventos; la función recibe la lista
 * ya filtrada por sinceMs/minSeverity desde el caller (generateDailyBriefing).
 * Severidad en escala 0-100 (D-103/T-09), redondeada a entero para compacidad.
 *
 * @returns '' si la lista está vacía (el bloque se omite en serializeContext).
 */
const TOP_N = 10;

export function buildGlobalRiskContext(events: EventRow[]): string {
  if (events.length === 0) return '';

  // Ordena por severity desc, luego por temporalidad desc como desempate
  const sorted = [...events].sort((a, b) => {
    const sevDiff = (b.severity ?? 0) - (a.severity ?? 0);
    if (sevDiff !== 0) return sevDiff;
    const aTs = a.occurredAt ?? a.capturedAt;
    const bTs = b.occurredAt ?? b.capturedAt;
    return bTs - aTs;
  });

  const top = sorted.slice(0, TOP_N);
  const lines = top.map((e) => {
    const sev = e.severity != null ? e.severity.toFixed(0) : 'n/d';
    const country = e.country ?? '—';
    const ts = e.occurredAt != null
      ? new Date(e.occurredAt).toISOString()
      : new Date(e.capturedAt).toISOString();
    return `  - [${e.eventType}] ${country} sev=${sev} @ ${ts}`;
  });

  return [`Riesgo global (top ${top.length} eventos, todas las fuentes):`, ...lines].join('\n');
}

// ─── Context serialization ────────────────────────────────────────────────────

/**
 * Serializa los datos del store a texto denso y eficiente en tokens.
 * Lee SÓLO de la base de datos local (D-105: nunca de upstream directo).
 *
 * T-14: el segundo argumento pasa de GdeltEvent[] a EventRow[] — la tabla events
 * unificada cubre todas las fuentes (GDELT conflict, USGS earthquake, EONET natural).
 * El bloque GDELT-financiero legacy se reemplaza por buildGlobalRiskContext(events).
 *
 * @param latest  - snapshots de mercado más recientes (de getLatestMarkets)
 * @param events  - eventos globales recientes de la tabla events (de getEvents)
 */
export function serializeContext(latest: MarketSnapshot[], events: EventRow[]): string {
  const now = new Date().toISOString();
  const lines: string[] = [`Fecha de generación: ${now}`];

  // Mercados
  if (latest.length === 0) {
    lines.push('Mercados: sin datos en la base de datos local.');
  } else {
    lines.push('Mercados (snapshot más reciente por símbolo):');
    for (const m of latest) {
      const pct = m.change_pct != null ? ` (${m.change_pct >= 0 ? '+' : ''}${m.change_pct.toFixed(2)}%)` : '';
      const ts = new Date(m.captured_at).toISOString();
      lines.push(`  ${m.symbol} [${m.asset_class}] = ${m.price}${pct} @ ${ts} (fuente: ${m.source})`);
    }
  }

  // Riesgo global (eventos unificados — reemplaza bloque GDELT-financiero legacy)
  const riskBlock = buildGlobalRiskContext(events);
  if (riskBlock !== '') {
    lines.push(riskBlock);
  } else {
    lines.push('Riesgo global: sin eventos recientes en la base de datos local.');
  }

  return lines.join('\n');
}

// ─── Briefing pipeline ────────────────────────────────────────────────────────

const DOMAIN = 'finance';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas (D-106)
const FALLBACK_MODEL = 'cache-fallback';

// Filtro de eventos para el contexto del briefing: últimas 48h, severity mínima 20
const EVENTS_FILTER: EventFilter = {
  sinceMs: 0, // se calcula dinámicamente en generateDailyBriefing
  minSeverity: 20,
  limit: 50,
};

/**
 * Genera (o sirve desde caché) el briefing financiero-global diario.
 *
 * Contrato D-106:
 *   - Primero getCachedBriefing(); si válido → devuelve sin llamar al proveedor LLM.
 *   - Si expirado → genera → guarda con valid_until = now + 24h.
 *
 * Degradación R-2:
 *   - Si el proveedor LLM falla, intenta servir el último cacheado (aunque esté expirado).
 *   - Si tampoco hay caché → devuelve Briefing con body_md "briefing no disponible".
 *
 * T-14: alimenta el contexto vía getEvents({sinceMs: now-48h, minSeverity:20, limit:50})
 * en vez de getRecentGdeltEvents. Sin cambios de proveedor (ADR-009) ni llamadas extra.
 */
export async function generateDailyBriefing(): Promise<Briefing> {
  // Aseguramos que el schema existe (idempotente)
  await migrate();

  const now = Date.now();

  // 1. Intento de caché (D-106: NO llamar al proveedor LLM si hay caché válida)
  const cached = await getCachedBriefing(DOMAIN, now);
  if (cached !== null) {
    return cached;
  }

  // 2. Sin caché válida: leer contexto del store
  let latest: MarketSnapshot[] = [];
  let events: EventRow[] = [];

  try {
    latest = await getLatestMarkets();
    // Eventos globales de todas las fuentes (GDELT, USGS, EONET) de las últimas 48h.
    // El scheduler (T-11) popula la tabla `events` independientemente;
    // aquí leemos lo que ya esté persistido (D-105: nunca upstream directo).
    events = await getEvents({
      ...EVENTS_FILTER,
      sinceMs: now - 48 * 60 * 60 * 1000, // 48h
    });
  } catch {
    // Si el store falla, degradamos con contexto vacío
    latest = [];
    events = [];
  }

  const ctx = serializeContext(latest, events);
  const prompt = buildBriefingPrompt(ctx);

  // 3. Generación LLM con degradación (R-2)
  let bodyMd: string;
  let modelUsed: string;

  try {
    const activeProvider = pickProvider();
    if (activeProvider === null) {
      throw new Error('no provider available');
    }
    bodyMd = await complete(prompt, { temperature: 0.3, maxTokens: 1024 });
    // Registra el modelo real usado según el proveedor activo (ADR-009).
    if (activeProvider === 'openai') {
      modelUsed = `openai/${process.env['OPENAI_MODEL']}`;
    } else if (activeProvider === 'claude') {
      modelUsed = `claude/${process.env['ANTHROPIC_MODEL']}`;
    } else {
      modelUsed = activeProvider;
    }
  } catch {
    // R-2: intenta servir caché expirada como último recurso
    const staleCached = await getStaleCache(DOMAIN);
    if (staleCached !== null) {
      return staleCached;
    }
    // Sin nada disponible: devuelve estado degradado
    const fallback: Briefing = {
      domain: DOMAIN,
      body_md: '**briefing no disponible**: ningún proveedor LLM activo en este momento.',
      model: FALLBACK_MODEL,
      created_at: now,
      valid_until: now, // expira inmediatamente (fuerza reintento en la próxima llamada)
    };
    return fallback;
  }

  // 4. Persistir con valid_until = now + 24h (D-106)
  const briefing: Briefing = {
    domain: DOMAIN,
    body_md: bodyMd,
    model: modelUsed,
    created_at: now,
    valid_until: now + CACHE_TTL_MS,
  };

  try {
    await saveBriefing(briefing);
  } catch {
    // Si falla el guardado, devolvemos el briefing igualmente (no rompe)
  }

  return briefing;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Recupera el briefing más reciente para el dominio, aunque esté expirado.
 * Usado como último recurso de degradación (R-2).
 */
async function getStaleCache(domain: string): Promise<Briefing | null> {
  // Pasamos 0 como nowMs para que valid_until > 0 devuelva incluso expirados
  // en el contexto de uso como fallback degradado.
  // Usamos una marca temporal muy antigua (0 = epoch) para saltarnos el filtro.
  return getCachedBriefing(domain, 0);
}
