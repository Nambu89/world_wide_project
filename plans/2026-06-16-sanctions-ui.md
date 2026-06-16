# OFAC Sanctions UI Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the already-persisted OFAC sanctions data (table `sanctions`, migration 006) as a read-only UI: a ranked country list folded into FinancePanel + a per-country map layer (toggle OFF by default).

**Architecture:** Exact clone of the CII/Convergence read-only surface pattern. New `GET /api/sanctions` mirrors `/api/cii` (store `getLatestSanctions()` + centroid join → lat/lon or null). Web adds a camelCase adapter + a violet filled-circle map layer (`step` on raw count, distinct from CII fill / convergence ring) + a sanctions section in FinancePanel. NO new connector, NO new store API, NO trend (deferred — needs ≥2 snapshots + dynamicScore in the job).

**Tech Stack:** Node `node:http` server (TS), `@www/store` (libSQL), React + MapLibre GL (Vite), `node:test` + tsx for server/store units, browser E2E via Playwright `.mjs`.

**Decisions locked (ADR-014, to record in plans/DECISIONS.md):**
- D-501: Sanctions surface folded into FinancePanel (finance-domain signal), NOT a 6th tab.
- D-502: Map glyph = filled violet circle, color+radius by `step` on raw `sanctionedCount` (thresholds 1/10/50/200/1000). Distinct from CII (green→red fill) and convergence (amber→red ring).
- D-503: Toggle `sanctions` OFF by default (avoids 3 per-country glyphs on first load; user opts in). Mirrors convergence D-403.
- D-504: Trend arrow + top-entity detail DEFERRED (YAGNI; data not available without job changes).
- D-505: camelCase wire (anti-BUG-1 / L-1) — `RawSanctionRow` is camelCase.

---

## File Structure

- `server.ts` — add `/api/sanctions` route (mirrors `/api/cii` block) + `getLatestSanctions` import + `SanctionRow` type import.
- `server.test.ts` — seed sanctions in `before()` + 4 new `/api/sanctions` tests + 1 regression guard.
- `packages/web/src/api/client.ts` — `RawSanctionRow`, `SanctionCountry`, `adaptSanctionRow`, `getSanctions()`.
- `packages/web/src/map/layers.config.ts` — `SANCTIONS_LAYERS` + wire into `LAYER_SOURCES` / `TOGGLE_KEYS`.
- `packages/web/src/map/MapView.tsx` — `sanctionsToGeoJSON`, load useEffect, `sanctionsDataRef`, extend `flyTo` map-tie, add to the 2 layer loops + imports.
- `packages/web/src/panels/FinancePanel.tsx` — sanctions section (own sub-state) + `activeCountry`/`onCountrySelect` props.
- `packages/web/src/App.tsx` — `buildInitialActive` deletes `sanctions`; pass `activeCountry`/`handleCountrySelect` to FinancePanel; `handleCountrySelect` adds `sanctions` toggle.
- `packages/web/e2e/sanctions-e2e.mjs` — browser E2E (render rows, toggle layer, map-tie, responsive, 0 console errors).
- `plans/DECISIONS.md` — ADR-014 (D-501..D-505).
- `plans/ROADMAP.md` — mark slice closed.

---

## Task 1: Server `/api/sanctions` endpoint

**Files:**
- Modify: `server.ts` (imports near line 30-44; route block near line 453-465, after `/api/convergence`, before 404)
- Test: `server.test.ts` (imports line 19-20; seed in `before()`; new tests after the convergence block ~line 819)

- [ ] **Step 1: Write failing tests**

In `server.test.ts`, extend the store imports (line 19) to add `insertSanctions`, and the type import (line 20) to add `SanctionRow`:

```ts
import { migrate, insertMarketSnapshots, upsertEvents, upsertSignals, insertCiiSnapshots, insertConvergenceSignals, insertSanctions, _resetDbForTesting } from '@www/store';
import type { EventRow, SignalRow, SignalTrendPoint, CiiSnapshotRow, ConvergenceSignalRow, SanctionRow } from '@www/store';
```

In `before()`, after the convergence seed block, add a sanctions seed (Japan has a centroid → lat/lon non-null; ZZZ-NoMap does not → null; Japan seeded twice to prove "latest only"):

```ts
    // Seed sanctions for /api/sanctions tests (D-501..D-505)
    const now5 = Date.now();
    const seedSanctions: SanctionRow[] = [
      { country: 'Japan',     sanctionedCount: 12,  capturedAt: now5 - 900_000 }, // older
      { country: 'Japan',     sanctionedCount: 15,  capturedAt: now5 },           // latest → 15
      { country: 'Russia',    sanctionedCount: 5597, capturedAt: now5 },
      { country: 'ZZZ-NoMap', sanctionedCount: 3,   capturedAt: now5 },
    ];
    await insertSanctions(seedSanctions);
```

Add the test block after the `/api/convergence` tests (~line 819):

```ts
  // ── /api/sanctions (sanctions UI) ─────────────────────────────────────────

  it('GET /api/sanctions → 200 with latest count per country + lat/lon adjunto', async () => {
    const { status, body } = await get(server, '/api/sanctions');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{
      country: string;
      sanctionedCount: number;
      capturedAt: number;
      lat: number | null;
      lon: number | null;
    }>;
    assert.ok(Array.isArray(rows), 'should be an array');
    assert.ok(rows.length >= 3, 'at least Japan/Russia/ZZZ-NoMap');
    const first = rows[0]!;
    assert.ok('sanctionedCount' in first, 'camelCase sanctionedCount field');
    assert.ok('lat' in first && 'lon' in first, 'lat/lon fields present');
  });

  it('GET /api/sanctions → Japan row has non-null lat/lon + latest count only', async () => {
    const { status, body } = await get(server, '/api/sanctions');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ country: string; sanctionedCount: number; lat: number | null; lon: number | null }>;
    const japanRows = rows.filter((r) => r.country === 'Japan');
    assert.equal(japanRows.length, 1, 'only latest Japan row appears');
    assert.equal(japanRows[0]!.sanctionedCount, 15, 'latest count = 15 (not 12)');
    assert.ok(typeof japanRows[0]!.lat === 'number', 'Japan lat is a number');
    assert.ok(typeof japanRows[0]!.lon === 'number', 'Japan lon is a number');
  });

  it('GET /api/sanctions → ZZZ-NoMap row has lat/lon null (no centroid)', async () => {
    const { status, body } = await get(server, '/api/sanctions');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ country: string; lat: number | null; lon: number | null }>;
    const noMap = rows.find((r) => r.country === 'ZZZ-NoMap');
    assert.ok(noMap !== undefined, 'ZZZ-NoMap present');
    assert.equal(noMap.lat, null, 'unknown country lat null');
    assert.equal(noMap.lon, null, 'unknown country lon null');
  });

  it('GET /api/sanctions → solo-lectura (store-only, no conector)', async () => {
    // Returns exactly the seeded data → proves it reads the DB, never fires the connector.
    const { status, body } = await get(server, '/api/sanctions');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ country: string; sanctionedCount: number }>;
    const russia = rows.find((r) => r.country === 'Russia');
    assert.ok(russia !== undefined && russia.sanctionedCount === 5597, 'seeded Russia count exact');
  });

  it('GET /api/cii still 200 after /api/sanctions added (regression)', async () => {
    const { status } = await get(server, '/api/cii');
    assert.equal(status, 200);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @www/server exec tsx --test server.test.ts` (or the repo's server test command)
Expected: the 5 new tests FAIL (route returns 404 → status 404 ≠ 200).

- [ ] **Step 3: Implement the route**

In `server.ts`, add to the store import block (line 30-43):

```ts
  getLatestConvergence,
  getLatestSanctions,
} from '@www/store';
```

Add `SanctionRow` to the store type import (line 44):

```ts
import type { EventFilter, Section, CiiSnapshotRow, ConvergenceSignalRow, SanctionRow } from '@www/store';
```

Insert the route block immediately AFTER the `/api/convergence` block (after line 465, before the 404):

```ts
  // ── /api/sanctions ──────────────────────────────────────────────────────
  // SOLO-LECTURA. Returns latest OFAC sanctions count per country with lat/lon
  // from COUNTRY_CENTROIDS lookup. Countries without a centroid get lat/lon null
  // (shown in panel only, not on map). NEVER fires the connector on-request (ADR-004).
  if (pathname === '/api/sanctions') {
    const rows = await getLatestSanctions();
    const payload = rows.map((row: SanctionRow) => {
      const centroid = COUNTRY_CENTROIDS[row.country];
      return {
        ...row,
        lat: centroid !== undefined ? centroid.lat : null,
        lon: centroid !== undefined ? centroid.lon : null,
      };
    });
    sendJson(res, 200, payload);
    return;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @www/server exec tsx --test server.test.ts`
Expected: all PASS (server suite count +5).

- [ ] **Step 5: Global typecheck**

Run: `pnpm -r exec tsc --noEmit` (from repo root; PM owns the consolidated tsc)
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add server.ts server.test.ts
git commit -m "feat(server): GET /api/sanctions read-only (latest OFAC count/country + centroid)"
```

---

## Task 2: Web API client — `getSanctions`

**Files:**
- Modify: `packages/web/src/api/client.ts` (raw shapes ~line 149; view-models ~line 362; adapters ~line 552; public fns ~line 742)

> No web unit-test runner exists (web verifies via tsc + build + browser E2E, per L-5). Verification = tsc + the E2E in Task 6.

- [ ] **Step 1: Add the raw wire shape**

After `RawConvergenceRow` (line ~149), add:

```ts
/**
 * Raw sanctions row from /api/sanctions.
 * WIRE FORMAT = camelCase (D-505 / L-1 — anti-BUG-1, same discipline as CiiRow).
 * lat/lon null for countries without a centroid.
 */
interface RawSanctionRow {
  country: string;
  sanctionedCount: number;
  capturedAt: number;   // epoch ms
  lat: number | null;
  lon: number | null;
}
```

- [ ] **Step 2: Add the view-model**

After `ConvergenceCountry` (line ~362), add:

```ts
/**
 * View-model for an OFAC sanctions row consumed by FinancePanel + MapView.
 * lat/lon null → panel only (no map feature emitted).
 */
export interface SanctionCountry {
  country: string;
  sanctionedCount: number;
  capturedAt: string;   // ISO string
  lat: number | null;
  lon: number | null;
}
```

- [ ] **Step 3: Add the adapter**

After `adaptConvergenceRow` (line ~552), add:

```ts
function adaptSanctionRow(r: RawSanctionRow): SanctionCountry {
  return {
    country: r.country,
    sanctionedCount: r.sanctionedCount,
    capturedAt: new Date(r.capturedAt).toISOString(),
    lat: r.lat,
    lon: r.lon,
  };
}
```

- [ ] **Step 4: Add the public fetch fn**

After `getConvergence` (end of file, line ~742), add:

```ts
/**
 * Fetch latest OFAC sanctions count per country from /api/sanctions.
 * All rows returned (no lat/lon filter — panel uses all); MapView discards no-coord rows.
 * Wire format: camelCase (D-505 / L-1).
 *
 * Attribution: OpenSanctions (us_ofac_sdn, CC BY-NC) · OFAC SDN list
 */
export async function getSanctions(): Promise<SanctionCountry[]> {
  const raw = await apiFetch<RawSanctionRow[]>('/api/sanctions');
  if (!Array.isArray(raw)) return [];
  return raw.map(adaptSanctionRow);
}
```

- [ ] **Step 5: Typecheck the web package**

Run: `pnpm --filter @www/web exec tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/client.ts
git commit -m "feat(web): getSanctions client + SanctionCountry view-model (camelCase wire)"
```

---

## Task 3: Map layer config — `SANCTIONS_LAYERS`

**Files:**
- Modify: `packages/web/src/map/layers.config.ts` (after `CONVERGENCE_LAYERS`, line ~563; then `LAYER_SOURCES` line ~566 and `TOGGLE_KEYS` line ~573)

- [ ] **Step 1: Add the layer block**

After the `CONVERGENCE_LAYERS` export (line ~563), add:

```ts
// ---------------------------------------------------------------------------
// SANCTIONS_LAYERS — OFAC sanctions per-country (filled violet circle)
//
// Source: 'sanctions-countries' (GeoJSON; 1 Feature per country with centroid).
// Glyph DISTINCT from CII (green→red fill) and convergence (amber→red ring):
//   filled violet circle, color + radius by `step` on raw sanctionedCount (D-502).
// Toggle 'sanctions' OFF by default (D-503) — user opts in to avoid 3-way clutter.
// Property on features (W-3 scalar): country, count.
// ---------------------------------------------------------------------------

/** Step expression: sanctionedCount → violet shade by magnitude (D-502) */
const SANCTIONS_COLOR_STEP = [
  'step',
  ['get', 'count'],
  '#c4b5fd',        // 1-9:    light violet
  10,  '#a78bfa',   // 10-49:  violet
  50,  '#8b5cf6',   // 50-199: medium violet
  200, '#7c3aed',   // 200-999: strong violet
  1000, '#5b21b6',  // 1000+:  deep violet (Russia/Iran tier)
];

/** Step expression: sanctionedCount → radius px by magnitude */
const SANCTIONS_RADIUS_STEP = [
  'step',
  ['get', 'count'],
  5,
  10,  7,
  50,  9,
  200, 12,
  1000, 16,
];

export const SANCTIONS_LAYERS: LayerSpec[] = [
  {
    id: 'sanctions-countries',
    source: 'sanctions-countries',
    type: 'circle',
    label: 'OFAC Sanctions',
    toggleKey: 'sanctions',
    visibleWhen: (active) => active.has('sanctions'),
    paint: {
      'circle-color': SANCTIONS_COLOR_STEP,
      'circle-radius': SANCTIONS_RADIUS_STEP,
      'circle-opacity': 0.80,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': 'rgba(255,255,255,0.20)',
    },
  },
];
```

- [ ] **Step 2: Wire into `LAYER_SOURCES` and `TOGGLE_KEYS`**

Replace the `LAYER_SOURCES` block (line ~565-570):

```ts
/** All unique source ids needed by all layer arrays */
export const LAYER_SOURCES = [
  ...new Set(
    [...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS].map((l) => l.source)
  ),
];

/** All unique toggle keys (events + signals + cii + convergence + sanctions) */
export const TOGGLE_KEYS = [
  ...new Set(
    [...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS].map((l) => l.toggleKey)
  ),
];
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @www/web exec tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/map/layers.config.ts
git commit -m "feat(web): SANCTIONS_LAYERS violet per-country circle (toggle OFF by default)"
```

---

## Task 4: MapView — source, load, map-tie

**Files:**
- Modify: `packages/web/src/map/MapView.tsx` (imports line 17-27; geojson helper ~line 155; refs ~line 179; the 2 layer loops line 232 & 277; new load useEffect ~line 452; flyTo ~line 463)

- [ ] **Step 1: Extend imports**

Line 17 — add `SANCTIONS_LAYERS`:

```ts
import { LAYERS, SIGNAL_LAYERS, CII_LAYERS, CONVERGENCE_LAYERS, SANCTIONS_LAYERS, LAYER_SOURCES } from './layers.config';
```

Lines 18-27 — add `getSanctions` + `SanctionCountry`:

```ts
import {
  getEvents,
  getSignals,
  getCii,
  getConvergence,
  getSanctions,
  type GlobalEvent,
  type RadarSignal,
  type CiiCountry,
  type ConvergenceCountry,
  type SanctionCountry,
} from '../api/client';
```

- [ ] **Step 2: Add the geojson helper**

After `convergenceToGeoJSON` (line ~155), add:

```ts
/**
 * Convert SanctionCountry array to GeoJSON for the 'sanctions-countries' source.
 * Only countries WITH a centroid emit a feature (others are panel-only).
 * Property `count` is scalar (W-3) — drives the step color/radius paint.
 */
function sanctionsToGeoJSON(rows: SanctionCountry[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of rows) {
    if (s.lat == null || s.lon == null) continue; // no centroid — panel only
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        country: s.country,
        count: s.sanctionedCount,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}
```

- [ ] **Step 3: Add the data ref**

After `convergenceDataRef` (line ~179), add:

```ts
  /** Store latest sanctions data for map-tie flyTo (uses embedded lat/lon). */
  const sanctionsDataRef = useRef<SanctionCountry[]>([]);
```

- [ ] **Step 4: Add `SANCTIONS_LAYERS` to both layer loops**

Line 232 (addLayer loop):

```ts
      for (const spec of [...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS]) {
```

Line 277 (visibility loop):

```ts
      for (const spec of [...LAYERS, ...SIGNAL_LAYERS, ...CII_LAYERS, ...CONVERGENCE_LAYERS, ...SANCTIONS_LAYERS]) {
```

- [ ] **Step 5: Add the load useEffect**

After the convergence load useEffect (line ~452, before the map-tie effect), add:

```ts
  // Load sanctions from /api/sanctions and inject into 'sanctions-countries' source.
  // One useEffect per data type — mirrors the convergence pattern.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const load = async () => {
      try {
        const rows = await getSanctions();
        if (cancelled) return;

        sanctionsDataRef.current = rows;

        const injectData = () => {
          if (!map || !mapReadyRef.current) return;
          const source = map.getSource('sanctions-countries') as GeoJSONSource | undefined;
          if (source) {
            source.setData(sanctionsToGeoJSON(rows));
          }
        };

        if (mapReadyRef.current) {
          injectData();
        } else {
          map.once('load', injectData);
        }
      } catch {
        // Graceful: upstream failure leaves source as empty GeoJSON (no crash).
        // FinancePanel shows its own error state independently.
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 6: Extend the map-tie flyTo to search sanctions**

In the map-tie useEffect (line ~457), add a sanctions lookup BEFORE the CII fallback (after the convergence lookup that returns, line ~473):

```ts
    // Sanctions selections embed lat/lon — check before CII fallback.
    const sanctionRow = sanctionsDataRef.current.find(
      (s) => s.country === activeCountry && s.lat != null && s.lon != null
    );
    if (sanctionRow && sanctionRow.lat != null && sanctionRow.lon != null) {
      map.flyTo({ center: [sanctionRow.lon, sanctionRow.lat], zoom: 4, duration: 800 });
      return;
    }
```

- [ ] **Step 7: Typecheck + build**

Run: `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`
Expected: EXIT 0 both.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/map/MapView.tsx
git commit -m "feat(web): MapView sanctions source + load + map-tie flyTo"
```

---

## Task 5: FinancePanel section + App wiring

**Files:**
- Modify: `packages/web/src/panels/FinancePanel.tsx` (imports line 9-15; component signature line 208; render line 236-279)
- Modify: `packages/web/src/App.tsx` (`buildInitialActive` line 45-50; `handleCountrySelect` line 115-122; FinancePanel render line 247)

- [ ] **Step 1: FinancePanel — accept props + import getSanctions**

Replace the import block (line 9-15):

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMarkets,
  getMarketTrend,
  getSanctions,
  type MarketInstrument,
  type PricePoint,
  type SanctionCountry,
} from '../api/client';
```

Add props to the component. Replace `export default function FinancePanel() {` (line 208) with:

```ts
interface FinancePanelProps {
  /** Country currently selected — highlights the matching sanctions row. */
  activeCountry: string | null;
  /** Called when user selects a sanctions row — parent syncs map fly-to. */
  onCountrySelect: (country: string) => void;
}

export default function FinancePanel({ activeCountry, onCountrySelect }: FinancePanelProps) {
```

- [ ] **Step 2: FinancePanel — add the sanctions sub-component**

Before `export default function FinancePanel` (after the `InstrumentCard` block, line ~196), add a self-contained sanctions section with its own loading/empty/error state:

```ts
// ---------------------------------------------------------------------------
// SanctionsSection — ranked OFAC sanctions per country (folded into Finance)
// ---------------------------------------------------------------------------

type SanctionsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ok'; rows: SanctionCountry[] };

interface SanctionsSectionProps {
  activeCountry: string | null;
  onCountrySelect: (country: string) => void;
}

function SanctionsSection({ activeCountry, onCountrySelect }: SanctionsSectionProps) {
  const [state, setState] = useState<SanctionsState>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getSanctions()
      .then((rows) => {
        if (rows.length === 0) {
          setState({ status: 'empty' });
        } else {
          const sorted = [...rows].sort((a, b) => b.sanctionedCount - a.sanctionedCount);
          setState({ status: 'ok', rows: sorted });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ status: 'error', message });
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="sanctions-section" aria-label="OFAC sanctions">
      <h2 className="finance-panel__heading">OFAC Sanctions</h2>

      {state.status === 'loading' && (
        <div className="state-loading" role="status">
          <div className="spinner" aria-hidden="true" />
          <span>Loading sanctions...</span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="state-error" role="alert">
          <div className="state-error__title">Failed to load sanctions</div>
          <div>{state.message}</div>
          <button className="state-error__retry" onClick={load} type="button">Retry</button>
        </div>
      )}

      {state.status === 'empty' && (
        <div className="state-empty" role="status">
          <div className="state-empty__icon" aria-hidden="true">--</div>
          <div>No sanctions data available</div>
        </div>
      )}

      {state.status === 'ok' && (
        <ul className="sanctions-list" role="list" aria-label="Countries by sanctioned-entity count">
          {state.rows.map((s) => (
            <li
              key={s.country}
              className={`sanctions-row${activeCountry === s.country ? ' active' : ''}`}
              style={{ listStyle: 'none' }}
            >
              <button
                type="button"
                className="sanctions-row__btn"
                onClick={() => onCountrySelect(s.country)}
                aria-pressed={activeCountry === s.country}
                aria-label={`Select ${s.country} — ${s.sanctionedCount} sanctioned entities`}
              >
                <span className="sanctions-row__country">{s.country}</span>
                <span className="sanctions-row__count">{s.sanctionedCount.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="sanctions-section__attribution" aria-label="Data attribution">
        Datos:{' '}
        <a href="https://www.opensanctions.org" target="_blank" rel="noopener noreferrer">
          OpenSanctions
        </a>
        {' '}(OFAC SDN, CC BY-NC)
      </footer>
    </section>
  );
}
```

- [ ] **Step 3: FinancePanel — render the section**

At the end of the FinancePanel JSX, inside the root `<div className="finance-panel">`, AFTER the markets block (after line ~277, before the closing `</div>`), add:

```tsx
      <SanctionsSection activeCountry={activeCountry} onCountrySelect={onCountrySelect} />
```

- [ ] **Step 4: App.tsx — sanctions OFF by default**

In `buildInitialActive` (line 45-50), add a delete for `sanctions` next to the convergence one:

```ts
function buildInitialActive(): Set<string> {
  const initial = new Set([...TOGGLE_KEYS, ...EVENTS_TOGGLE_KEYS, ...SIGNAL_TOGGLE_KEYS]);
  // D-403: convergence layer starts OFF — user must enable it explicitly.
  initial.delete('convergence');
  // D-503: sanctions layer starts OFF — user opts in (avoids 3-way per-country clutter).
  initial.delete('sanctions');
  return initial;
}
```

- [ ] **Step 5: App.tsx — handleCountrySelect adds sanctions toggle + pass props**

Replace `handleCountrySelect` (line 115-122):

```ts
  const handleCountrySelect = (country: string) => {
    setActiveCountry(country);
    setActiveLayers((prev) => {
      const next = new Set(prev);
      next.add('cii');
      next.add('sanctions'); // ensure the sanctions glyph is visible when selecting from Finance
      return next;
    });
  };
```

Replace the FinancePanel render (line 247):

```tsx
          {activeTab === 'finance' && (
            <FinancePanel
              activeCountry={activeCountry}
              onCountrySelect={handleCountrySelect}
            />
          )}
```

- [ ] **Step 6: Typecheck + build**

Run: `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`
Expected: EXIT 0 both.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/panels/FinancePanel.tsx packages/web/src/App.tsx
git commit -m "feat(web): OFAC sanctions section in FinancePanel + map-tie wiring"
```

---

## Task 6: Integration — global verify + live smoke + browser E2E

**Files:**
- Create: `packages/web/e2e/sanctions-e2e.mjs`
- Modify: `plans/DECISIONS.md` (ADR-014), `plans/ROADMAP.md`

> Mirrors the existing `events-e2e.mjs` / `cii-e2e.mjs` E2E scripts. Check one of them for the exact Playwright launch boilerplate and the dev base URL (port 8787 server / Vite proxy) before writing this one — reuse it verbatim.

- [ ] **Step 1: Global typecheck + full suite**

Run: `pnpm -r exec tsc --noEmit` then the full test suite (`pnpm -r test` or the repo's aggregate command).
Expected: tsc EXIT 0; suite green (server +5 sanctions tests; prior count + 5).

- [ ] **Step 2: Live smoke — server + curl**

Start the real server (`pnpm dev` / `node` per repo convention, port 8787) so the slow-tier sanctions job has populated the DB, then:

Run: `curl -s http://127.0.0.1:8787/api/sanctions | head -c 800`
Expected: JSON array, camelCase `sanctionedCount`, real counts (Russia/Iran/NK high), `lat`/`lon` present (number or null).

- [ ] **Step 3: Write the browser E2E**

Create `packages/web/e2e/sanctions-e2e.mjs` (adapt the launch boilerplate from `cii-e2e.mjs`). It MUST assert:

```js
// Pseudocode of the assertions (use the repo's existing Playwright harness style):
// 1. Load the app, open the Finance tab.
// 2. Sanctions section renders ≥1 row; each row shows a country name + numeric count.
//    badRows = rows where country text is empty OR count is NaN → assert badRows === 0.
// 3. Toggle the 'sanctions' map layer ON (it starts OFF) → assert sanctions-countries
//    layer becomes visible and renders >0 features (query map.queryRenderedFeatures or
//    the layer visibility property, matching how cii-e2e.mjs checks the CII layer).
// 4. Click the top sanctions row → map flyTo fires (center changes); row gets .active.
// 5. Responsive 375px: Finance panel + sanctions section render with no horizontal overflow.
// 6. Zero console errors and zero failed network requests throughout.
// Print "VERDICT: PASS" on success, non-zero exit on any failure.
```

- [ ] **Step 4: Run the E2E**

Run: `node packages/web/e2e/sanctions-e2e.mjs` (with the dev server + Vite running, per the other E2E scripts)
Expected: `VERDICT: PASS`, exit 0, screenshots written next to the other `plans/screenshots/*`.

- [ ] **Step 5: Record ADR-014 + close ROADMAP**

In `plans/DECISIONS.md` add ADR-014 capturing D-501..D-505. In `plans/ROADMAP.md` mark the sanctions UI surface closed under the "Completar dominios" / Finanzas line and bump the progress note.

- [ ] **Step 6: Commit**

```bash
git add packages/web/e2e/sanctions-e2e.mjs plans/DECISIONS.md plans/ROADMAP.md
git commit -m "test(web): sanctions UI browser E2E + ADR-014 + roadmap close"
```

---

## Self-Review

**Spec coverage:**
- Server `/api/sanctions` → Task 1. ✅
- Client adapter (camelCase) → Task 2. ✅
- Map layer (violet, step, OFF default) → Task 3 + 4. ✅
- MapView source/load/map-tie → Task 4. ✅
- FinancePanel section + App wiring → Task 5. ✅
- Verify (suite/tsc/build/smoke/E2E) → Task 6. ✅
- Deferred (trend, top-entities) → documented in header (D-504), no task. ✅

**Type consistency:** `SanctionCountry` (Task 2) used in MapView (Task 4) + FinancePanel (Task 5). `RawSanctionRow` (Task 2) matches the `/api/sanctions` payload (Task 1: `...row` spread of `SanctionRow` {country, sanctionedCount, capturedAt} + lat/lon). `sanctions-countries` source id consistent across Task 3 (layer), Task 4 (setData). `sanctions` toggle key consistent across Task 3, App buildInitialActive + handleCountrySelect (Task 5). Map property `count` consistent: emitted in `sanctionsToGeoJSON` (Task 4) ↔ `['get','count']` in paint (Task 3). ✅

**Placeholder scan:** E2E assertions in Task 6 Step 3 are pseudocode by necessity (must match the repo's existing Playwright harness, which the worker reads from `cii-e2e.mjs`) — flagged explicitly, not a hidden TODO. All code steps contain real code. ✅
