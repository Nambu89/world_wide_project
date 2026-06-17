# App vista IA-first (Slice C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** The app opens on the "Inteligencia" insight feed (1st tab, default), with raw-data tabs as the menu; clicking an insight card flies the map to the involved country/chokepoint.

**Architecture:** Small slice on top of B. Extend the insight card schema with `countries[]`/`chokepoints[]` (LLM-emitted) so cards carry map-tie targets. Reorder tabs (Inteligencia first) + default `activeTab='intel'`. IntelPanel cards become clickable → App routes to the existing `handleChokepointSelect`/`handleCountrySelect` map-tie. No new table, no server change (endpoint passes through `parseInsights`).

**Tech Stack:** `@www/core-ai` (schema+prompt+parser), React (App/IntelPanel), node:test+tsx, Playwright.

**Decisions locked (ADR-017):**
- D-801: Inteligencia = 1st tab + default landing. Raw tabs = the menu (lean reorder, no hero/drawer rebuild).
- D-802: Insight card schema gains `countries: string[]` (English names matching CII keys) + `chokepoints: string[]` (ids matching chokepoint config). LLM-emitted; `parseInsights` parses optional, default `[]` (backward-compatible — old cached cards → `[]`, no map-tie until regenerated).
- D-803: Card click priority — chokepoint first (more specific/visual), else country. Reuses `handleChokepointSelect`/`handleCountrySelect`. Highlight = flyTo + visible glyph + active row; dedicated highlight ring DEFERRED.
- D-804: No server/store change — `/api/insights` already returns `parseInsights(body)` which now includes the new fields.

---

## File Structure
- `packages/core/ai/src/insights.ts` — `Insight` +countries/chokepoints; prompt asks for them; `parseInsights` parses them.
- `packages/core/ai/test/insights.test.ts` — assert entities parsed + default [].
- `packages/web/src/api/client.ts` — `Insight` view-model +countries/chokepoints.
- `packages/web/src/panels/IntelPanel.tsx` — clickable cards + `onSelect`/`activeId` props.
- `packages/web/src/App.tsx` — reorder tabs (Inteligencia 1st) + default `'intel'` + `handleInsightSelect` + `activeInsightId`.
- `packages/web/src/styles.css` — `.intel-card` clickable/active styles.
- `packages/web/intel-e2e.mjs` — extend: default tab + card click map-tie.
- `plans/DECISIONS.md`, `plans/ROADMAP.md`.

---

## Task 1: core-ai — card entities

**Files:** `packages/core/ai/src/insights.ts`, `packages/core/ai/test/insights.test.ts`

- [ ] **Step 1:** Add fields to the `Insight` interface (after `affected`):

```ts
  affected: string[];          // economies / commodities
  countries: string[];         // involved country names (English, match CII keys) — map-tie
  chokepoints: string[];       // involved chokepoint ids (e.g. 'hormuz') — map-tie
  severity: 'alta' | 'media' | 'baja';
```

- [ ] **Step 2:** Extend the prompt JSON schema line in `buildInsightsPrompt` to include the new fields + an instruction:

```ts
    'Sé conciso: máximo 3 consecuencias por tarjeta, frases breves (≤20 palabras).',
    'Incluye en cada tarjeta los países involucrados (campo "countries", nombres en inglés tal como ' +
      'aparecen en el contexto, p.ej. "Iraq","Russia") y los chokepoints involucrados (campo "chokepoints", ' +
      'ids en minúscula: hormuz, suez, bab-el-mandeb, malacca, panama, bosphorus, gibraltar, dover, ' +
      'danish-straits, taiwan, good-hope, magellan). Vacíos si no aplica.',
    'Responde SOLO con un array JSON (sin texto fuera del JSON), cada elemento:',
    '{"id":"slug-corto","title":"titular es","category":"energia|comercio|geopolitica|conflicto|mercados|clima|otro",' +
      '"triggers":["señal real 1"],"consequences":["consecuencia predicha 1"],"affected":["UE","petróleo"],' +
      '"countries":["Iraq"],"chokepoints":["hormuz"],"severity":"alta|media|baja","confidence":"alta|media|baja"}',
```

- [ ] **Step 3:** In `parseInsights`, add the two fields to the pushed object (mirror `triggers`/`affected`):

```ts
      affected: Array.isArray(o['affected']) ? o['affected'].filter((x): x is string => typeof x === 'string') : [],
      countries: Array.isArray(o['countries']) ? o['countries'].filter((x): x is string => typeof x === 'string') : [],
      chokepoints: Array.isArray(o['chokepoints']) ? o['chokepoints'].filter((x): x is string => typeof x === 'string') : [],
      severity: sev,
```

- [ ] **Step 4:** Add a test (after the valid-array test):

```ts
test('parseInsights: parses countries/chokepoints; defaults to [] when absent', () => {
  const withEnt = parseInsights(JSON.stringify([{ title: 'A', consequences: ['x'], countries: ['Iraq'], chokepoints: ['hormuz'] }]));
  assert.deepEqual(withEnt[0].countries, ['Iraq']);
  assert.deepEqual(withEnt[0].chokepoints, ['hormuz']);
  const without = parseInsights(JSON.stringify([{ title: 'B', consequences: ['y'] }]));
  assert.deepEqual(without[0].countries, []);
  assert.deepEqual(without[0].chokepoints, []);
});
```

- [ ] **Step 5:** Run `node --import tsx --test packages/core/ai/test/insights.test.ts` → all PASS (10). Build `pnpm --filter @www/core-ai build`.
- [ ] **Step 6:** Commit — `git add packages/core/ai && git commit -m "feat(core-ai): insight cards carry countries/chokepoints for map-tie"`

---

## Task 2: web — landing reorder + clickable cards + map-tie

**Files:** `packages/web/src/api/client.ts`, `packages/web/src/panels/IntelPanel.tsx`, `packages/web/src/App.tsx`, `packages/web/src/styles.css`

- [ ] **Step 1:** `client.ts` — add `countries: string[]; chokepoints: string[];` to the `Insight` interface (mirror core-ai).

- [ ] **Step 2:** `IntelPanel.tsx` — accept props `{ onSelect?: (i: Insight) => void; activeId?: string | null }`. Wrap each card's content in a `<button className="intel-card__btn" onClick={() => onSelect?.(c)}>`; add `active` class when `activeId === c.id`. Disable the button (or render a plain div) when the card has no countries AND no chokepoints (nothing to fly to) — optional; simpler: always clickable, handler no-ops if no entities.

```tsx
interface IntelPanelProps {
  onSelect?: (insight: Insight) => void;
  activeId?: string | null;
}
export default function IntelPanel({ onSelect, activeId }: IntelPanelProps) { /* ... */ }
// each <li> → className includes (activeId === c.id ? ' active' : ''); inner <button className="intel-card__btn" type="button" onClick={() => onSelect?.(c)}>
```

- [ ] **Step 3:** `App.tsx`:
  - Default landing: `useState<PanelTab>('intel')` (was `'events'`).
  - Add `const [activeInsightId, setActiveInsightId] = useState<string | null>(null);`
  - Import `type Insight` from `./api/client`.
  - Handler:

```ts
  const handleInsightSelect = (insight: Insight) => {
    setActiveInsightId(insight.id);
    if (insight.chokepoints.length > 0) handleChokepointSelect(insight.chokepoints[0]!);
    else if (insight.countries.length > 0) handleCountrySelect(insight.countries[0]!);
  };
```

  - Move the "Inteligencia" tab button to be the FIRST tab button (before Finance); keep the rest in order.
  - Render: `{activeTab === 'intel' && <IntelPanel onSelect={handleInsightSelect} activeId={activeInsightId} />}`
  - `panelTitle`: ensure 'intel' → 'Inteligencia' (already present).

- [ ] **Step 4:** `styles.css` — `.intel-card__btn { width:100%; text-align:left; background:transparent; border:none; cursor:pointer; padding:0; display:flex; flex-direction:column; gap:var(--space-2); }` + `.intel-card.active { border-color: var(--color-accent); }`. (Card padding moves to the button or stays on `.intel-card`.)

- [ ] **Step 5:** Typecheck + build — `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`.
- [ ] **Step 6:** Commit — `git add packages/web/src && git commit -m "feat(web): IA-first landing (Inteligencia 1st) + clickable insight cards map-tie"`

---

## Task 3: verify + smoke + E2E

**Files:** `packages/web/intel-e2e.mjs`, `plans/DECISIONS.md`, `plans/ROADMAP.md`

- [ ] **Step 1:** Global tsc + suite — `pnpm -r exec tsc --noEmit && npx tsc --noEmit -p tsconfig.json` + `pnpm test` + `node --import tsx --test server.test.ts`.
- [ ] **Step 2:** Live smoke — start backend with `.env`; regenerate insights so cards carry entities:
  `node --env-file-if-exists=.env --import tsx -e "import('@www/core-ai').then(async m=>{const r=await m.generateInsights();console.log(r.length,'cards; entities:',r.slice(0,5).map(i=>i.title+' ['+[...i.countries,...i.chokepoints].join(',')+']'))})"`
  Expected: cards with non-empty countries/chokepoints (Hormuz card → chokepoints:['hormuz'], etc). If the live batch is cached (12h) without entities, it returns the stale batch — delete/expire or wait; for the smoke, the regenerate call above forces a fresh batch only if cache expired. **To force regen for the smoke:** the cache check returns the existing batch; bump is not needed — instead run the smoke against a fresh DB OR accept that the NEXT generation carries entities. Document which occurred.
- [ ] **Step 3:** Extend `packages/web/intel-e2e.mjs`: assert (a) on load WITHOUT clicking any tab, `.intel-panel` is the visible panel (default landing); (b) the first `.panel-tab` text is "Inteligencia"; (c) clicking a card with entities sets `.intel-card.active` and the map canvas is present (flyTo). Keep the data-or-empty tolerance.
- [ ] **Step 4:** Run E2E (backend+vite) → VERDICT PASS.
- [ ] **Step 5:** ADR-017 (D-801..D-804) + ROADMAP Slice C done.
- [ ] **Step 6:** Commit — `git add packages/web/intel-e2e.mjs plans/ && git commit -m "test(web): IA-first landing + card map-tie E2E + ADR-017"`

---

## Self-Review
**Coverage:** schema+prompt+parser (T1) · landing+clickable+map-tie (T2) · verify (T3). Deferred D-803 highlight ring documented.
**Type consistency:** `Insight` +countries/chokepoints consistent core-ai (T1) ↔ web (T2). `handleInsightSelect` routes to existing `handleChokepointSelect`(id)/`handleCountrySelect`(name) — entity types match their map-tie (chokepoint id ↔ chokepointsDataRef.id; country name ↔ ciiDataRef.country).
**Placeholders:** none — all code real; IntelPanel/App edits are concrete diffs on known files.
**Risk:** cached insight batch lacks entities until regenerated → map-tie no-ops gracefully (empty arrays). Smoke documents whether the live batch carried entities. Country-name match depends on the LLM emitting CII-key names; flyTo no-ops if no match (graceful).
