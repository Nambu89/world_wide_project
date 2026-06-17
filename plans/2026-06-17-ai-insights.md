# AI Insights — relate events + predict consequences (Slice B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** An LLM engine that reads the current high-signal hotspots (convergence + chokepoints + CII + market stress + sanctions) and produces a feed of structured cause→consequence **insight cards** (Spanish), surfaced in a new "Inteligencia" tab.

**Architecture:** New `@www/core-ai/insights.ts` mirrors the briefing pipeline: assemble a denser "hotspot" context (reusing the existing `build*Context` helpers + a small chokepoint block), prompt the LLM for STRICT JSON cards, parse defensively, persist by reusing the `briefings` table with `domain='intel'` (NO new table/migration). Read-only `GET /api/insights` serves the last batch. Scheduler daily job generates after the briefing. Web adds `IntelPanel` (7th tab).

**Tech Stack:** `@www/core-ai` (router `complete`, openai active, model via `OPENAI_MODEL`), `@www/store` (briefings table reuse), `@www/scheduler`, React, node:test+tsx, Playwright.

**Decisions locked (ADR-016):**
- D-701: Output = structured cause→consequence cards (not prose). Card = `{id,title,category,triggers[],consequences[],affected[],severity,confidence}`, all Spanish.
- D-702: Input = top-signal hotspots only (top convergence + disrupted/watch chokepoints + top CII + market stress + top sanctions). 1 LLM call, ~5-8 cards. Bounded cost.
- D-703: Persistence reuses `briefings` table, `domain='intel'`, `body_md` = JSON array string. NO migration, NO new store API (ponytail). `getCachedBriefing('intel', 0)` serves the latest batch even if stale.
- D-704: Anti-hallucination — context = real signals only; prompt requires citing real triggers + marking consequences as prediction; temp 0.3; defensive JSON parse drops malformed cards.
- D-705: Model via `OPENAI_MODEL` env (never hardcoded). No LLM key → empty feed, graceful.
- D-706: 7th tab "Inteligencia" (IntelPanel). Map-tie of cards (click → highlight involved countries/chokepoints) DEFERRED to slice C (portada integration). Prose narrative rejected (cards chosen).
- D-707: core-ai does NOT depend on core-signals — chokepoint context uses `getLatestChokepointStatus()` (id+status) only, no config import.

---

## File Structure
- `packages/core/ai/src/insights.ts` — `buildChokepointContext`, `buildIntelContext`, `buildInsightsPrompt`, `parseInsights`, `generateInsights`, `INTEL_PERSONA`, `type Insight`.
- `packages/core/ai/src/index.ts` — barrel exports.
- `packages/core/ai/test/insights.test.ts` — pure tests (context + parser + cache short-circuit).
- `packages/scheduler/src/index.ts` — daily job calls `generateInsights` + dep wiring.
- `server.ts` — `GET /api/insights`.
- `server.test.ts` — `/api/insights` test (seed briefings domain='intel').
- `packages/web/src/api/client.ts` — `getInsights` + `Insight` view-model.
- `packages/web/src/panels/IntelPanel.tsx` — feed of cards.
- `packages/web/src/App.tsx` — 7th "Inteligencia" tab.
- `packages/web/src/styles.css` — intel card styles.
- `packages/web/intel-e2e.mjs` — browser E2E.
- `plans/DECISIONS.md`, `plans/ROADMAP.md`.

---

## Task 1: core-ai insights engine

**Files:** Create `packages/core/ai/src/insights.ts`; modify `packages/core/ai/src/index.ts`; test `packages/core/ai/test/insights.test.ts`

- [ ] **Step 1: Write the engine `insights.ts`**

```ts
// packages/core/ai/src/insights.ts
// AI insights engine (slice B) — relate hotspots → predict consequence chains.
// Mirrors the briefing pipeline (cache/degradation) but emits STRUCTURED JSON cards.
// Persistence reuses the `briefings` table with domain='intel' (D-703).

import {
  getCachedBriefing, saveBriefing, migrate,
  getLatestMarkets, getLatestCii, getLatestConvergence, getLatestSanctions,
  getLatestChokepointStatus,
  type Briefing,
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
export function buildChokepointContext(rows: Array<{ chokepointId: string; status: string; score: number }>): string {
  const active = rows.filter((r) => r.status === 'disrupted' || r.status === 'watch')
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
    blocks.push('Mercados con movimiento notable: ' +
      moved.map((m) => `${m.symbol} ${(m.change_pct as number) >= 0 ? '+' : ''}${(m.change_pct as number).toFixed(2)}%`).join(', '));
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
    'Responde SOLO con un array JSON (sin texto fuera del JSON), cada elemento:',
    '{"id":"slug-corto","title":"titular es","category":"energia|comercio|geopolitica|conflicto|mercados|clima|otro",' +
    '"triggers":["señal real 1","señal real 2"],"consequences":["consecuencia predicha 1","..."],' +
    '"affected":["UE","petróleo"],"severity":"alta|media|baja","confidence":"alta|media|baja"}',
  ].join('\n');
}

const SEV = new Set(['alta', 'media', 'baja']);

/** Defensive parse: strip code fences, accept array or {insights:[]}, drop malformed (D-704). */
export function parseInsights(text: string): Insight[] {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  let raw: unknown;
  try { raw = JSON.parse(s); } catch { return []; }
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>)['insights']))
      ? ((raw as Record<string, unknown>)['insights'] as unknown[])
      : [];
  const out: Insight[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = typeof o['title'] === 'string' ? o['title'].trim() : '';
    const consequences = Array.isArray(o['consequences']) ? o['consequences'].filter((x): x is string => typeof x === 'string') : [];
    if (!title || consequences.length === 0) continue; // required
    const sev = typeof o['severity'] === 'string' && SEV.has(o['severity']) ? o['severity'] as Insight['severity'] : 'media';
    const conf = typeof o['confidence'] === 'string' && SEV.has(o['confidence']) ? o['confidence'] as Insight['confidence'] : 'media';
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
    const text = await complete(buildInsightsPrompt(context), { temperature: 0.3, maxTokens: 2000 });
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
```

- [ ] **Step 2: Barrel exports** — in `packages/core/ai/src/index.ts` add:

```ts
// Insights engine (slice B)
export {
  INTEL_PERSONA, buildChokepointContext, buildIntelContext, buildInsightsPrompt,
  parseInsights, generateInsights, type Insight,
} from './insights.js';
```

- [ ] **Step 3: Tests** `packages/core/ai/test/insights.test.ts`:

```ts
// Ephemeral DB — set before the @www/store import chain creates the (lazy) singleton.
process.env['LIBSQL_URL'] = ':memory:';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInsights, buildIntelContext, buildChokepointContext, generateInsights } from '../src/insights.js';
import { _resetDbForTesting, migrate, saveBriefing } from '@www/store';

test('parseInsights: valid JSON array', () => {
  const txt = JSON.stringify([{ id: 'a', title: 'Ormuz', category: 'energia', triggers: ['hormuz'], consequences: ['petróleo↑'], affected: ['UE'], severity: 'alta', confidence: 'media' }]);
  const r = parseInsights(txt);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Ormuz');
  assert.equal(r[0].severity, 'alta');
});

test('parseInsights: strips ```json fences', () => {
  const r = parseInsights('```json\n[{"title":"X","consequences":["y"]}]\n```');
  assert.equal(r.length, 1);
  assert.equal(r[0].category, 'otro'); // default
  assert.equal(r[0].severity, 'media'); // default
});

test('parseInsights: accepts {insights:[...]} wrapper', () => {
  const r = parseInsights('{"insights":[{"title":"X","consequences":["y"]}]}');
  assert.equal(r.length, 1);
});

test('parseInsights: drops cards missing title or consequences', () => {
  const r = parseInsights(JSON.stringify([{ title: '', consequences: ['y'] }, { title: 'ok', consequences: [] }, { title: 'good', consequences: ['z'] }]));
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'good');
});

test('parseInsights: garbage → []', () => {
  assert.deepEqual(parseInsights('not json at all'), []);
  assert.deepEqual(parseInsights(''), []);
});

test('buildChokepointContext: only disrupted/watch, sorted by score', () => {
  const ctx = buildChokepointContext([
    { chokepointId: 'suez', status: 'watch', score: 0.4 },
    { chokepointId: 'hormuz', status: 'disrupted', score: 0.9 },
    { chokepointId: 'panama', status: 'calm', score: 0.05 },
  ]);
  assert.ok(ctx.includes('hormuz'));
  assert.ok(ctx.includes('suez'));
  assert.ok(!ctx.includes('panama'), 'calm excluded');
  assert.ok(ctx.indexOf('hormuz') < ctx.indexOf('suez'), 'sorted by score desc');
});

test('buildIntelContext: empty inputs → empty string', () => {
  assert.equal(buildIntelContext([], [], [], [], []), '');
});

test('generateInsights: serves cached batch without calling the LLM (cache short-circuit)', async () => {
  // No OPENAI key set: a valid cached 'intel' batch must short-circuit before pickProvider/complete.
  _resetDbForTesting();
  await migrate();
  const now = Date.now();
  await saveBriefing({
    domain: 'intel',
    body_md: JSON.stringify([{ id: 'c', title: 'Cached', category: 'energia', triggers: [], consequences: ['x'], affected: [], severity: 'alta', confidence: 'media' }]),
    model: 'test', created_at: now, valid_until: now + 3_600_000,
  });
  const r = await generateInsights();
  assert.equal(r.length, 1, 'returns the cached batch');
  assert.equal(r[0].title, 'Cached');
});
```

- [ ] **Step 4: Run tests** — `node --import tsx --test packages/core/ai/test/insights.test.ts` → 8 PASS.
- [ ] **Step 5: Build dist** — `pnpm --filter @www/core-ai build` → EXIT 0.
- [ ] **Step 6: Commit** — `git add packages/core/ai && git commit -m "feat(core-ai): AI insights engine (relate hotspots → predict consequences)"`

---

## Task 2: Scheduler — generate insights in the daily job

**Files:** Modify `packages/scheduler/src/index.ts`; test `packages/scheduler/test/scheduler.test.ts`

- [ ] **Step 1:** Import `generateInsights` from `@www/core-ai` (add to that import). Add to `SchedulerDeps`: `generateInsights: () => Promise<unknown[]>;`. Add to `REAL_STORE_AI_DEPS` Pick union + object literal. In the `dailyJob.run()`, AFTER the briefing+purge, append:

```ts
      // Slice B: generate intel insights after the briefing (context is populated).
      try {
        const insights = await (deps?.generateInsights ?? storeAi.generateInsights)();
        console.log(`[scheduler] daily: generated ${insights.length} intel insights`);
      } catch (err) {
        console.warn('[scheduler] daily: insights generation failed (non-fatal)');
      }
```

- [ ] **Step 2:** Test — add a `generateInsights: async () => [{}]` mock to the inline cii/daily deps if needed; add one test that the daily job calls generateInsights:

```ts
it('daily job: generates intel insights after briefing', async () => {
  let called = 0;
  const deps: Partial<SchedulerDeps> = { generateInsights: async () => { called++; return [{}]; } };
  const jobs = defaultJobs(undefined, deps);
  await jobs.find((j) => j.name === 'daily')!.run();
  assert.equal(called, 1, 'generateInsights called once by daily job');
});
```

(If `makeDeps()`-built daily tests now run the daily job and it calls the REAL generateInsights → harmless: returns [] without an LLM key. The inline-deps tests above are deterministic.)

- [ ] **Step 3:** Run scheduler tests + build — `node --import tsx --test packages/scheduler/test/scheduler.test.ts && pnpm --filter @www/scheduler build`.
- [ ] **Step 4:** Commit — `git add packages/scheduler && git commit -m "feat(scheduler): generate intel insights in daily job"`

---

## Task 3: Server — GET /api/insights

**Files:** Modify `server.ts`, `server.test.ts`

- [ ] **Step 1: Failing tests** in `server.test.ts` — seed an 'intel' briefing in `before()` (reuse `saveBriefing`; import it):

```ts
    // Seed intel insights batch (slice B) — stored as JSON in briefings domain='intel'
    await saveBriefing({
      domain: 'intel',
      body_md: JSON.stringify([{ id: 'ormuz-oil', title: 'Tensión en Ormuz', category: 'energia', triggers: ['hormuz: disrupted'], consequences: ['Brent↑', 'gas EU↑'], affected: ['UE'], severity: 'alta', confidence: 'media' }]),
      model: 'test', created_at: Date.now(), valid_until: Date.now() + 3600_000,
    });
```

Add tests after the chokepoints block:

```ts
  it('GET /api/insights → 200 with parsed insight cards', async () => {
    const { status, body } = await get(server, '/api/insights');
    assert.equal(status, 200);
    const parsed = JSON.parse(body) as { insights: Array<{ title: string; consequences: string[]; severity: string }> };
    assert.ok(Array.isArray(parsed.insights), 'insights array');
    const ormuz = parsed.insights.find((i) => i.title === 'Tensión en Ormuz');
    assert.ok(ormuz, 'seeded card present');
    assert.ok(ormuz.consequences.length >= 1, 'has consequences');
    assert.equal(ormuz.severity, 'alta');
  });

  it('GET /api/insights → solo-lectura (no LLM on request)', async () => {
    // Returns exactly the seeded batch → proves it reads the cache, never calls the LLM.
    const { status, body } = await get(server, '/api/insights');
    assert.equal(status, 200);
    const parsed = JSON.parse(body) as { insights: unknown[] };
    assert.ok(parsed.insights.length >= 1);
  });
```

- [ ] **Step 2:** Run → FAIL (404). `node --import tsx --test server.test.ts`
- [ ] **Step 3:** Implement. In `server.ts` add `saveBriefing` is NOT needed (test imports from @www/store directly). Add `parseInsights` import from `@www/core-ai`. Add route after `/api/briefing`:

```ts
  // ── /api/insights ─────────────────────────────────────────────────────────
  // SOLO-LECTURA. Returns the latest intel insight batch (briefings domain='intel',
  // body_md = JSON array). Serves the last batch even if stale (nowMs=0). NEVER calls
  // the LLM on-request — generation happens in the scheduler daily job (ADR-004).
  if (pathname === '/api/insights') {
    const cached = await getCachedBriefing('intel', 0);
    const insights = cached ? parseInsights(cached.body_md) : [];
    sendJson(res, 200, {
      insights,
      generatedAt: cached ? cached.created_at : null,
      model: cached ? cached.model : null,
    });
    return;
  }
```

Add `import { parseInsights } from '@www/core-ai';` near the other imports. (Root package.json already deps `@www/core-ai`.)

- [ ] **Step 4:** Run → PASS. Global tsc — `pnpm -r exec tsc --noEmit && npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5:** Commit — `git add server.ts server.test.ts && git commit -m "feat(server): GET /api/insights (latest intel batch, read-only)"`

---

## Task 4: Web — client + IntelPanel + tab

**Files:** `packages/web/src/api/client.ts`, `packages/web/src/panels/IntelPanel.tsx`, `packages/web/src/App.tsx`, `packages/web/src/styles.css`

- [ ] **Step 1: client.ts** — append:

```ts
// ---------------------------------------------------------------------------
// AI Insights (slice B)
// ---------------------------------------------------------------------------
interface RawInsight {
  id: string; title: string; category: string;
  triggers: string[]; consequences: string[]; affected: string[];
  severity: 'alta' | 'media' | 'baja'; confidence: 'alta' | 'media' | 'baja';
}
interface RawInsightsResponse { insights: RawInsight[]; generatedAt: number | null; model: string | null; }

export interface Insight extends RawInsight {}
export interface InsightsResult { insights: Insight[]; generatedAt: string | null; model: string | null; }

export async function getInsights(): Promise<InsightsResult> {
  const raw = await apiFetch<RawInsightsResponse>('/api/insights');
  const insights = Array.isArray(raw?.insights) ? raw.insights : [];
  return {
    insights,
    generatedAt: raw?.generatedAt != null ? new Date(raw.generatedAt).toISOString() : null,
    model: raw?.model ?? null,
  };
}
```

- [ ] **Step 2: IntelPanel.tsx** — new panel (mirror ChokepointsPanel states). Sort by severity (alta>media>baja). Each card: title + category chip + severity/confidence badges + triggers chips + consequences list (visible) + affected. loading/empty/error. Empty copy: "Sin inteligencia generada todavía. El motor IA se ejecuta en segundo plano; requiere clave LLM configurada." Footer model attribution. Classes `intel-panel`, `intel-card`, `intel-card__title`, `intel-card__triggers`, `intel-card__consequences`, etc.

```tsx
// severity rank for sort + color
const sevRank = { alta: 2, media: 1, baja: 0 };
function sevColor(s) { return s === 'alta' ? 'var(--color-danger)' : s === 'media' ? 'var(--color-warning)' : '#14b8a6'; }
// consequences rendered as a <ul> with a "→" lead per item (the cascade).
```

(Full component follows ChokepointsPanel.tsx scaffolding; fetch via getInsights; uses result.insights.)

- [ ] **Step 3: App.tsx** — import IntelPanel; `PanelTab` add `'intel'`; add tab button "Inteligencia" (after Rutas); render `{activeTab === 'intel' && <IntelPanel />}`; panelTitle add `'intel' → 'Inteligencia'`. No new map state (map-tie deferred to C).

- [ ] **Step 4: styles.css** — add `.intel-*` block (card layout, chips, severity badge, consequences list with `→` markers) mirroring chokepoints styles + design tokens.

- [ ] **Step 5:** Typecheck + build — `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`.
- [ ] **Step 6:** Commit — `git add packages/web/src && git commit -m "feat(web): IntelPanel + Inteligencia tab (AI insight feed)"`

---

## Task 5: Integration — verify + live smoke + E2E

**Files:** Create `packages/web/intel-e2e.mjs`; modify `plans/DECISIONS.md`, `plans/ROADMAP.md`

- [ ] **Step 1:** Global tsc + full suite — `pnpm -r exec tsc --noEmit && npx tsc --noEmit -p tsconfig.json` then `pnpm test` + `node --import tsx --test server.test.ts`. New tests: core-ai +8, server +2, scheduler +1.
- [ ] **Step 2: Live smoke (needs OPENAI_API_KEY + OPENAI_MODEL in .env).** Start backend; the daily job generates insights on boot after the briefing. Then:

`curl -s http://127.0.0.1:8787/api/insights | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('insights:',a.insights.length,'model:',a.model);a.insights.slice(0,3).forEach(i=>console.log(' -',i.severity,i.title,'→',i.consequences[0]))})"`

Expected: ≥1 card with title + consequence, model = openai/<OPENAI_MODEL>. If 0 (no key, or daily job not yet run) → note it; E2E then asserts the empty-state instead. Boot of the daily job: the briefing then insights — may take a few seconds; poll.

- [ ] **Step 3: `packages/web/intel-e2e.mjs`** (adapt chokepoints-e2e harness). Assert: load 0 errors; "Inteligencia" tab (7th) exists; click → `.intel-panel` visible; EITHER ≥1 `.intel-card` with non-empty title + ≥1 consequence (if data) OR the empty-state is shown (if no LLM key) — both are PASS (the panel must render correctly in both states); responsive 375 no overflow; 0 console errors. Print VERDICT.
- [ ] **Step 4:** Run E2E (backend + vite). Expected VERDICT: PASS.
- [ ] **Step 5:** ADR-016 (D-701..D-707) in DECISIONS.md; mark Slice B done in ROADMAP (Fase 5).
- [ ] **Step 6:** Commit — `git add packages/web/intel-e2e.mjs plans/ && git commit -m "test(web): intel insights E2E + ADR-016 + roadmap"`

---

## Self-Review
**Coverage:** engine+parser (T1) · daily-job generation (T2) · endpoint (T3) · panel+tab (T4) · verify+smoke+E2E (T5). Deferred D-706 (map-tie→C) documented.
**Type consistency:** `Insight` defined T1 (core-ai), re-typed T4 (web view-model, same fields). `domain='intel'` consistent T1 (save) ↔ T3 (read). `parseInsights` T1 used by T3 (server). `generateInsights` dep T1↔T2.
**Placeholders:** T4 Step 2 references ChokepointsPanel as scaffolding (worker reads it) — flagged. All engine/server code is real.
**Risk (W-1 carried):** insights need an LLM key + the daily job to have run; endpoint + panel handle empty gracefully (D-705). E2E accepts both data and empty-state as PASS. Live smoke documents which occurred.
