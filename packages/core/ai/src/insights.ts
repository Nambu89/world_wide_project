// packages/core/ai/src/insights.ts
// AI insights engine (slice B) — relate hotspots → predict consequence chains.
// Mirrors the briefing pipeline (cache/degradation) but emits STRUCTURED JSON cards.
// Persistence reuses the `briefings` table with domain='intel' (D-703).

import {
  getCachedBriefing, saveBriefing, migrate,
  getLatestMarkets, getLatestCii, getLatestConvergence, getLatestSanctions,
  getLatestChokepointStatus,
} from '@www/store';
import { complete, pickProvider } from './router.js';
import { buildRiskContext, buildConvergenceContext, buildSanctionsContext } from './briefing.js';

/** Structured cause→consequence insight card (D-701). All text Spanish. */
export interface Insight {
  id: string;
  title: string;
  category: string;            // energia|comercio|geopolitica|conflicto|mercados|clima|otro
  triggers: string[];          // real signals this is based on
  consequences: string[];      // predicted chain
  affected: string[];          // economies / commodities
  severity: 'alta' | 'media' | 'baja';
  confidence: 'alta' | 'media' | 'baja';
}

const DOMAIN = 'intel';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — refreshes ~twice/day

export const INTEL_PERSONA =
  'Eres un analista de inteligencia geopolítica y económica de élite. ' +
  'Relacionas señales dispersas y predices sus consecuencias en cadena, sobre todo económicas ' +
  '(precios de energía, materias primas, inflación, suministro). Eres concreto y citas los ' +
  'disparadores reales del contexto. NUNCA inventas datos. Marcas la incertidumbre. Escribes en español.';

/** Chokepoint block — only disrupted/watch routes (id + status + score). */
export function buildChokepointContext(
  rows: Array<{ chokepointId: string; status: string; score: number }>,
): string {
  const active = rows
    .filter((r) => r.status === 'disrupted' || r.status === 'watch')
    .sort((a, b) => b.score - a.score);
  if (active.length === 0) return '';
  const lines = active.map((r) => `  - ${r.chokepointId}: ${r.status} (${r.score.toFixed(2)})`);
  return ['Rutas comerciales en disrupción/vigilancia:', ...lines].join('\n');
}

/** Assemble the hotspot context (top-signal only, D-702). */
export function buildIntelContext(
  cii: Parameters<typeof buildRiskContext>[0],
  convergence: Parameters<typeof buildConvergenceContext>[0],
  sanctions: Parameters<typeof buildSanctionsContext>[0],
  chokepoints: Array<{ chokepointId: string; status: string; score: number }>,
  markets: Array<{ symbol: string; change_pct: number | null }>,
): string {
  const blocks: string[] = [];
  const conv = buildConvergenceContext(convergence); if (conv) blocks.push(conv);
  const cp = buildChokepointContext(chokepoints); if (cp) blocks.push(cp);
  const risk = buildRiskContext(cii); if (risk) blocks.push(risk);
  const sanc = buildSanctionsContext(sanctions); if (sanc) blocks.push(sanc);
  // Market stress: symbols with |change_pct| >= 1%
  const moved = markets.filter((m) => m.change_pct != null && Math.abs(m.change_pct) >= 1);
  if (moved.length > 0) {
    blocks.push(
      'Mercados con movimiento notable: ' +
        moved
          .map((m) => `${m.symbol} ${(m.change_pct as number) >= 0 ? '+' : ''}${(m.change_pct as number).toFixed(2)}%`)
          .join(', '),
    );
  }
  return blocks.length > 0 ? blocks.join('\n\n') : '';
}

/** Build the strict-JSON prompt. */
export function buildInsightsPrompt(context: string): string {
  return [
    INTEL_PERSONA, '',
    '## Señales actuales (hotspots desde la base de datos local):',
    context, '',
    '## Tarea',
    'Identifica las 5-8 situaciones más relevantes y, para cada una, una tarjeta de inteligencia ' +
      'que RELACIONE las señales y PREDIGA sus consecuencias en cadena. Basa cada tarjeta SOLO en las ' +
      'señales anteriores; cita disparadores reales; marca las consecuencias como predicción.',
    '',
    'Sé conciso: máximo 3 consecuencias por tarjeta, frases breves (≤20 palabras).',
    'Responde SOLO con un array JSON (sin texto fuera del JSON), cada elemento:',
    '{"id":"slug-corto","title":"titular es","category":"energia|comercio|geopolitica|conflicto|mercados|clima|otro",' +
      '"triggers":["señal real 1","señal real 2"],"consequences":["consecuencia predicha 1","..."],' +
      '"affected":["UE","petróleo"],"severity":"alta|media|baja","confidence":"alta|media|baja"}',
  ].join('\n');
}

const SEV = new Set(['alta', 'media', 'baja']);

/**
 * Salvage top-level {...} objects from a possibly-truncated JSON string by scanning
 * brace depth. Lets a card-array that got cut off at maxTokens still yield its
 * complete cards (the incomplete trailing one is dropped). Brace-in-string is rare
 * in Spanish card text, so a depth scan is good enough.
 */
function salvageObjects(s: string): unknown[] {
  const objs: unknown[] = [];
  let depth = 0, start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { objs.push(JSON.parse(s.slice(start, i + 1))); } catch { /* skip */ } start = -1; } }
  }
  return objs;
}

/** Defensive parse: strip code fences, accept array or {insights:[]}, salvage truncated, drop malformed (D-704). */
export function parseInsights(text: string): Insight[] {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  let raw: unknown = null;
  try { raw = JSON.parse(s); } catch { /* fall through to salvage */ }
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>)['insights'])
      ? ((raw as Record<string, unknown>)['insights'] as unknown[])
      : salvageObjects(s); // raw was null (parse failed) or not array/wrapper → salvage objects
  const out: Insight[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = typeof o['title'] === 'string' ? o['title'].trim() : '';
    const consequences = Array.isArray(o['consequences'])
      ? o['consequences'].filter((x): x is string => typeof x === 'string')
      : [];
    if (!title || consequences.length === 0) continue; // required
    const sev = typeof o['severity'] === 'string' && SEV.has(o['severity']) ? (o['severity'] as Insight['severity']) : 'media';
    const conf = typeof o['confidence'] === 'string' && SEV.has(o['confidence']) ? (o['confidence'] as Insight['confidence']) : 'media';
    out.push({
      id: typeof o['id'] === 'string' && o['id'].trim() ? o['id'].trim() : title.toLowerCase().replace(/\s+/g, '-').slice(0, 40),
      title,
      category: typeof o['category'] === 'string' ? o['category'] : 'otro',
      triggers: Array.isArray(o['triggers']) ? o['triggers'].filter((x): x is string => typeof x === 'string') : [],
      consequences,
      affected: Array.isArray(o['affected']) ? o['affected'].filter((x): x is string => typeof x === 'string') : [],
      severity: sev,
      confidence: conf,
    });
  }
  return out;
}

/**
 * Generate (or serve cached) the intel insight batch. Mirrors generateDailyBriefing:
 * cache → assemble context → LLM → parse → persist (briefings domain='intel').
 * Returns the parsed cards. Graceful: LLM failure → stale cache or [].
 */
export async function generateInsights(): Promise<Insight[]> {
  await migrate();
  const now = Date.now();

  const cached = await getCachedBriefing(DOMAIN, now);
  if (cached !== null) return parseInsights(cached.body_md);

  let context = '';
  try {
    const [markets, cii, convergence, sanctions, chokepoints] = await Promise.all([
      getLatestMarkets(), getLatestCii(), getLatestConvergence(), getLatestSanctions(), getLatestChokepointStatus(),
    ]);
    context = buildIntelContext(cii, convergence, sanctions, chokepoints, markets);
  } catch {
    context = '';
  }
  if (context === '') return []; // nothing to reason about

  try {
    const provider = pickProvider();
    if (provider === null) throw new Error('no provider');
    // gpt-5.x reasoning models spend completion budget on hidden reasoning; a JSON
    // array of 5-8 cards needs generous headroom or it truncates mid-array (L-5).
    const text = await complete(buildInsightsPrompt(context), { temperature: 0.3, maxTokens: 6000 });
    const insights = parseInsights(text);
    if (insights.length === 0) {
      const stale = await getCachedBriefing(DOMAIN, 0);
      return stale ? parseInsights(stale.body_md) : [];
    }
    const model = provider === 'openai' ? `openai/${process.env['OPENAI_MODEL']}`
      : provider === 'claude' ? `claude/${process.env['ANTHROPIC_MODEL']}` : provider;
    try {
      await saveBriefing({ domain: DOMAIN, body_md: JSON.stringify(insights), model, created_at: now, valid_until: now + CACHE_TTL_MS });
    } catch { /* save failure non-fatal */ }
    return insights;
  } catch {
    const stale = await getCachedBriefing(DOMAIN, 0);
    return stale ? parseInsights(stale.body_md) : [];
  }
}
