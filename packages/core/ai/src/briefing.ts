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
  getLatestCii,
  getLatestConvergence,
  migrate,
  type MarketSnapshot,
  type EventRow,
  type EventFilter,
  type CiiSnapshotRow,
  type ConvergenceSignalRow,
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

// ─── CII risk context (T-27) ──────────────────────────────────────────────────

const CII_TOP_N = 8;

/**
 * Construye un bloque de texto con los top-N países por CII (composite) más alto,
 * su movimiento de 24h (dynamicScore/trend) y el componente dominante.
 *
 * El componente dominante se deriva parseando componentsJson (CiiComponent[]) y
 * tomando el de mayor score; si el parseo falla, se omite el dominante de esa línea.
 *
 * Formato por línea (ej.):
 *   - Japan: CII 62 (↑+4 rising) — dominante: conflict
 *
 * @returns '' si la lista está vacía (serie nueva → el bloque se omite). D-005/D-202.
 */
export function buildRiskContext(latest: CiiSnapshotRow[]): string {
  if (latest.length === 0) return '';

  const sorted = [...latest].sort((a, b) => b.composite - a.composite);
  const top = sorted.slice(0, CII_TOP_N);

  const lines = top.map((c) => {
    // Movimiento de 24h: flecha + delta + trend (omitido si serie nueva)
    let move = '';
    if (c.dynamicScore != null && c.trend != null) {
      const arrow = c.trend === 'rising' ? '↑' : c.trend === 'falling' ? '↓' : '→';
      const sign = c.dynamicScore >= 0 ? '+' : '';
      move = ` (${arrow}${sign}${c.dynamicScore.toFixed(0)} ${c.trend})`;
    }

    // Componente dominante (mayor score) desde componentsJson
    let dominant = '';
    try {
      const components = JSON.parse(c.componentsJson) as Array<{ key: string; score: number }>;
      if (Array.isArray(components) && components.length > 0) {
        const best = components.reduce((a, b) => (b.score > a.score ? b : a));
        dominant = ` — dominante: ${best.key}`;
      }
    } catch {
      // componentsJson inválido → omite el dominante (no rompe la línea)
    }

    return `  - ${c.country}: CII ${c.composite.toFixed(0)}${move}${dominant}`;
  });

  return [`Riesgo por país (top ${top.length} por CII):`, ...lines].join('\n');
}

// ─── Convergence context (T-32) ───────────────────────────────────────────────

const CONV_TOP_N = 8;

/**
 * Construye un bloque de texto con las top-N señales de convergencia activas
 * ordenadas por strength descendente.
 *
 * Formato por línea (ej.):
 *   - Japan (conflict+economic, strength 0.82, ↑)
 *
 * La flecha refleja el dynamicScore: ↑ si >0, ↓ si <0, → si =0 o null.
 * Las familias se leen de familiesJson (array de strings); si el parseo falla
 * se omite la lista de familias pero la línea se produce igualmente.
 *
 * @returns '' si la lista está vacía (el bloque se omite en serializeContext). D-311.
 */
export function buildConvergenceContext(latest: ConvergenceSignalRow[]): string {
  if (latest.length === 0) return '';

  const sorted = [...latest].sort((a, b) => b.strength - a.strength);
  const top = sorted.slice(0, CONV_TOP_N);

  const lines = top.map((c) => {
    // Familias desde familiesJson
    let familiesPart = '';
    try {
      const families = JSON.parse(c.familiesJson) as string[];
      if (Array.isArray(families) && families.length > 0) {
        familiesPart = families.join('+');
      }
    } catch {
      // JSON inválido → omite familias pero no rompe
    }

    // Flecha según dynamicScore
    let arrow = '→';
    if (c.dynamicScore != null) {
      if (c.dynamicScore > 0) arrow = '↑';
      else if (c.dynamicScore < 0) arrow = '↓';
    }

    const familiesLabel = familiesPart ? `${familiesPart}, ` : '';
    return `  - ${c.country} (${familiesLabel}strength ${c.strength.toFixed(2)}, ${arrow})`;
  });

  return [`Señales de convergencia activas (top ${top.length}):`, ...lines].join('\n');
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
 * @param latest       - snapshots de mercado más recientes (de getLatestMarkets)
 * @param events       - eventos globales recientes de la tabla events (de getEvents)
 * @param cii          - últimos snapshots CII por país (de getLatestCii); T-27, opcional
 * @param convergence  - señales de convergencia activas (de getLatestConvergence); T-32, opcional
 */
export function serializeContext(
  latest: MarketSnapshot[],
  events: EventRow[],
  cii: CiiSnapshotRow[] = [],
  convergence: ConvergenceSignalRow[] = [],
): string {
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

  // Riesgo por país (CII) — T-27. Se omite si la serie CII está vacía (serie nueva).
  const ciiBlock = buildRiskContext(cii);
  if (ciiBlock !== '') {
    lines.push(ciiBlock);
  }

  // Señales de convergencia activas — T-32. Se omite si la lista está vacía.
  const convBlock = buildConvergenceContext(convergence);
  if (convBlock !== '') {
    lines.push(convBlock);
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
  let cii: CiiSnapshotRow[] = [];
  let convergence: ConvergenceSignalRow[] = [];

  try {
    latest = await getLatestMarkets();
    // Eventos globales de todas las fuentes (GDELT, USGS, EONET) de las últimas 48h.
    // El scheduler (T-11) popula la tabla `events` independientemente;
    // aquí leemos lo que ya esté persistido (D-105: nunca upstream directo).
    events = await getEvents({
      ...EVENTS_FILTER,
      sinceMs: now - 48 * 60 * 60 * 1000, // 48h
    });
    // CII por país (T-27): último snapshot por país. El job `cii` (tier medium)
    // lo popula; aquí solo leemos (D-105). Vacío → el bloque se omite (serie nueva).
    cii = await getLatestCii();
    // Señales de convergencia activas (T-32): último estado por país.
    // El job de convergencia lo popula; aquí solo leemos (D-105).
    // Vacío → el bloque se omite hasta que haya datos.
    convergence = await getLatestConvergence();
  } catch {
    // Si el store falla, degradamos con contexto vacío
    latest = [];
    events = [];
    cii = [];
    convergence = [];
  }

  const ctx = serializeContext(latest, events, cii, convergence);
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
