// packages/core/ai/src/briefing.ts
// Pipeline de briefing diario financiero (D-105, D-106)
//
// Flujo:
//   1. getCachedBriefing() — si existe y no expiró, lo devuelve (NO llama Anthropic).
//   2. serializeContext() — lee getLatestMarkets() y GDELT events del store (nunca upstream).
//   3. complete() via router — llama al proveedor activo (rama claude en MVP).
//   4. saveBriefing() — persiste con valid_until = now + 24h.
//
// Degradación (R-2): si Anthropic no responde, sirve el último cacheado o
// devuelve un Briefing con estado "briefing no disponible".

import {
  getCachedBriefing,
  saveBriefing,
  getLatestMarkets,
  getRecentGdeltEvents,
  migrate,
  type MarketSnapshot,
  type GdeltEvent,
  type Briefing,
} from '@www/store';
import { complete, pickProvider } from './router.js';
import { buildBriefingPrompt } from './persona.js';

// ─── Context serialization ────────────────────────────────────────────────────

/**
 * Serializa los datos del store a texto denso y eficiente en tokens.
 * Lee SÓLO de la base de datos local (D-105: nunca de upstream directo).
 *
 * @param latest - snapshots de mercado más recientes (de getLatestMarkets)
 * @param events - eventos GDELT recientes (de insertGdeltEvents / query externa)
 */
export function serializeContext(latest: MarketSnapshot[], events: GdeltEvent[]): string {
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

  // Eventos GDELT
  if (events.length === 0) {
    lines.push('Eventos geopolíticos GDELT: sin datos recientes.');
  } else {
    lines.push(`Eventos geopolíticos GDELT (${events.length} recientes):`);
    // Limitamos a 10 eventos para no saturar el contexto
    const top = events.slice(0, 10);
    for (const e of top) {
      const sevStr = e.severity != null ? ` [severidad: ${e.severity.toFixed(2)}]` : '';
      const catStr = e.category ? ` [${e.category}]` : '';
      const loc = e.lat != null && e.lon != null ? ` (lat:${e.lat.toFixed(2)},lon:${e.lon.toFixed(2)})` : '';
      lines.push(`  - ${e.event_id}${catStr}${sevStr}${loc}`);
    }
  }

  return lines.join('\n');
}

// ─── Briefing pipeline ────────────────────────────────────────────────────────

const DOMAIN = 'finance';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas (D-106)
const FALLBACK_MODEL = 'cache-fallback';

/**
 * Genera (o sirve desde caché) el briefing financiero diario.
 *
 * Contrato D-106:
 *   - Primero getCachedBriefing(); si válido → devuelve sin llamar a Anthropic.
 *   - Si expirado → genera → guarda con valid_until = now + 24h.
 *
 * Degradación R-2:
 *   - Si el proveedor LLM falla, intenta servir el último cacheado (aunque esté expirado).
 *   - Si tampoco hay caché → devuelve Briefing con body_md "briefing no disponible".
 */
export async function generateDailyBriefing(): Promise<Briefing> {
  // Aseguramos que el schema existe (idempotente)
  await migrate();

  const now = Date.now();

  // 1. Intento de caché (D-106: NO llamar a Anthropic si hay caché válida)
  const cached = await getCachedBriefing(DOMAIN, now);
  if (cached !== null) {
    return cached;
  }

  // 2. Sin caché válida: leer contexto del store
  let latest: MarketSnapshot[] = [];
  let events: GdeltEvent[] = [];

  try {
    latest = await getLatestMarkets();
    // Eventos GDELT de las últimas 24h almacenados en la DB local.
    // El conector GDELT (T-03b) popula la tabla independientemente;
    // aquí leemos lo que ya esté persistido (D-105: nunca upstream directo).
    events = await getRecentGdeltEvents(now - 24 * 60 * 60 * 1000);
  } catch {
    // Si el store falla, intentamos degradar con contexto vacío
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
      modelUsed = 'claude-opus-4-5';
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
