# Chokepoints + Economic Impact (Slice A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A read-only "Rutas / Chokepoints" surface: ~12 curated global trade chokepoints (Hormuz, Suez, …) whose disruption status is detected from stored events+signals, each carrying a documented economic-impact cascade, shown as a map layer + a "Rutas" panel tab.

**Architecture:** Mirrors the CII/convergence engine pattern. Static dataset + pure scorer + IO orchestrator live in `@www/core-signals` (same store inputs as convergence — no new package, no connectors dep). A medium-tier scheduler job persists per-chokepoint status snapshots to `chokepoint_status` (migration 007). `GET /api/chokepoints` merges latest status with the static config. Web adds a camelCase adapter + a status-colored circle layer + a `ChokepointsPanel`.

**Tech Stack:** Node `node:http`, `@www/store` (libSQL), `@www/core-signals`, `@www/scheduler`, React + MapLibre GL, `node:test`+tsx for engine/store/server, Playwright `.mjs` for browser E2E.

**Decisions locked (ADR-015, to record in plans/DECISIONS.md):**
- D-601: Static dataset `chokepoints.config.ts` in `@www/core-signals` (reference data — chokepoints don't change; NO connector).
- D-602: Detection = hybrid proximity (events conflict/protest + GKG signals within radiusKm) **+ name/entity match** against per-chokepoint aliases. Score 0..1 → step bands (<0.2 calm / <0.5 watch / ≥0.5 disrupted). 72h window.
- D-603: Economic impact = **documented** in the dataset (`impactEs`), NOT AI-generated (AI narrative = Slice B).
- D-604: Map glyph = filled circle by status (teal/amber/red), toggle `chokepoints` **ON by default** (headline feature); sits on sea lanes, won't collide with country circles on land.
- D-605: Own tab "Rutas" (6th); tab bar becomes horizontally scrollable for 375px. Slice C later promotes it to the AI-first portada.
- D-606: camelCase wire (`RawChokepointRow`). NEW `activeChokepoint` map-tie state (chokepoints are not countries).
- D-607: Deferred — AI consequence narrative (Slice B); map click-popup + full Spanish UI (Slice D); line/corridor geometry; trend chart (table supports it, panel shows current).

---

## File Structure

- `packages/core/signals/src/chokepoints.config.ts` — `CHOKEPOINTS: ChokepointConfig[]` + scoring constants + `ChokepointConfig` type.
- `packages/core/signals/src/chokepoints.ts` — `haversineKm`, pure `scoreChokepoints(events, signals, nowMs): ChokepointStatusRow[]`, IO `detectAllChokepoints(nowMs)`.
- `packages/core/signals/src/index.ts` — barrel: export the above + `CHOKEPOINTS` + types.
- `packages/core/signals/test/chokepoints.test.ts` — pure-scorer unit tests.
- `packages/store/migrations/007_chokepoints.sql` — `chokepoint_status` table (auto-discovered by migrate.ts).
- `packages/store/src/types.ts` — `ChokepointStatusRow`.
- `packages/store/src/index.ts` — `insertChokepointStatus`, `getLatestChokepointStatus`, re-export type, purge step.
- `packages/store/test/store.test.ts` — chokepoint status CRUD test.
- `packages/scheduler/src/index.ts` — `chokepoints` job (medium) + deps wiring.
- `packages/scheduler/test/scheduler.test.ts` — job-count/order update.
- `server.ts` — `GET /api/chokepoints` + imports.
- `server.test.ts` — `/api/chokepoints` tests.
- `packages/web/src/api/client.ts` — `RawChokepointRow`, `Chokepoint`, `adaptChokepoint`, `getChokepoints`.
- `packages/web/src/map/layers.config.ts` — `CHOKEPOINT_LAYERS` + wiring.
- `packages/web/src/map/MapView.tsx` — `chokepointsToGeoJSON`, load, `chokepointsDataRef`, map-tie via `activeChokepoint`.
- `packages/web/src/panels/ChokepointsPanel.tsx` — new panel.
- `packages/web/src/App.tsx` — 6th "Rutas" tab + `activeChokepoint` state.
- `packages/web/src/styles.css` — `.panel-tabs` scroll-x + chokepoint panel styles.
- `packages/web/chokepoints-e2e.mjs` — browser E2E.
- `plans/DECISIONS.md`, `plans/ROADMAP.md`.

---

## Task 1: Store — migration 007 + chokepoint_status CRUD

**Files:**
- Create: `packages/store/migrations/007_chokepoints.sql`
- Modify: `packages/store/src/types.ts`, `packages/store/src/index.ts`
- Test: `packages/store/test/store.test.ts`

- [ ] **Step 1: Create the migration**

`packages/store/migrations/007_chokepoints.sql`:

```sql
CREATE TABLE IF NOT EXISTS chokepoint_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chokepoint_id TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL,
  components_json TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_chokepoint_status_id_time ON chokepoint_status (chokepoint_id, captured_at)
```

- [ ] **Step 2: Add the type**

In `packages/store/src/types.ts`, after `SanctionRow`:

```ts
/**
 * Chokepoint disruption status snapshot — camelCase (L-1).
 * Persisted as a time-series append in `chokepoint_status` (migration 007).
 * status: 'calm' | 'watch' | 'disrupted'. score: 0..1.
 * componentsJson: JSON of the scoring breakdown (eventScore/signalScore/nameScore/counts).
 */
export interface ChokepointStatusRow {
  id?: number;
  chokepointId: string;
  status: 'calm' | 'watch' | 'disrupted';
  score: number;
  componentsJson: string;
  capturedAt: number;
}
```

- [ ] **Step 3: Write the failing CRUD test**

In `packages/store/test/store.test.ts`, add (mirror the sanctions CRUD test; import `insertChokepointStatus`, `getLatestChokepointStatus`, `ChokepointStatusRow`):

```ts
test('chokepoint_status: insert + getLatest returns latest per chokepoint', async () => {
  const now = Date.now();
  await insertChokepointStatus([
    { chokepointId: 'hormuz', status: 'watch', score: 0.3, componentsJson: '{}', capturedAt: now - 1000 },
    { chokepointId: 'hormuz', status: 'disrupted', score: 0.8, componentsJson: '{}', capturedAt: now },
    { chokepointId: 'suez', status: 'calm', score: 0.05, componentsJson: '{}', capturedAt: now },
  ]);
  const latest = await getLatestChokepointStatus();
  const hormuz = latest.filter((r) => r.chokepointId === 'hormuz');
  assert.equal(hormuz.length, 1, 'one latest row per chokepoint');
  assert.equal(hormuz[0].status, 'disrupted');
  assert.equal(hormuz[0].score, 0.8);
});
```

- [ ] **Step 4: Run test — expect FAIL** (`insertChokepointStatus` not defined)

Run: `node --import tsx --test packages/store/test/store.test.ts`

- [ ] **Step 5: Implement the store functions**

In `packages/store/src/index.ts`: add `ChokepointStatusRow` to both the type import (line 9) and the re-export (line 12). After the Sanctions API block (after `rowToSanctionRow`, ~line 903), add:

```ts
// ─── Chokepoint status API (slice A) ─────────────────────────────────────────

export async function insertChokepointStatus(rows: ChokepointStatusRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getDb();
  for (const row of rows) {
    await client.execute({
      sql: `INSERT INTO chokepoint_status (chokepoint_id, status, score, components_json, captured_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [row.chokepointId, row.status, row.score, row.componentsJson, row.capturedAt],
    });
  }
}

export async function getLatestChokepointStatus(): Promise<ChokepointStatusRow[]> {
  const client = getDb();
  const result = await client.execute(`
    SELECT c.*
    FROM chokepoint_status c
    INNER JOIN (
      SELECT chokepoint_id, MAX(captured_at) AS max_ts
      FROM chokepoint_status
      GROUP BY chokepoint_id
    ) latest ON c.chokepoint_id = latest.chokepoint_id AND c.captured_at = latest.max_ts
    ORDER BY c.chokepoint_id
  `);
  return result.rows.map(rowToChokepointStatusRow);
}

function rowToChokepointStatusRow(r: Record<string, unknown>): ChokepointStatusRow {
  const base: ChokepointStatusRow = {
    chokepointId: String(r['chokepoint_id']),
    status: String(r['status']) as ChokepointStatusRow['status'],
    score: Number(r['score']),
    componentsJson: String(r['components_json']),
    capturedAt: Number(r['captured_at']),
  };
  if (r['id'] != null) base.id = Number(r['id']);
  return base;
}
```

Add a purge step in `purgeAndDownsample` (after the sanctions purge, ~line 649):

```ts
  // Purge chokepoint_status older than beforeMs.
  await client.execute({
    sql: 'DELETE FROM chokepoint_status WHERE captured_at < ?',
    args: [beforeMs],
  });
```

- [ ] **Step 6: Run test — expect PASS**; then rebuild store dist (cross-package consumers read dist):

Run: `node --import tsx --test packages/store/test/store.test.ts && pnpm --filter @www/store build`

- [ ] **Step 7: Commit**

```bash
git add packages/store
git commit -m "feat(store): chokepoint_status table (migr 007) + insert/getLatest"
```

---

## Task 2: core-signals — dataset + pure scorer + IO orchestrator

**Files:**
- Create: `packages/core/signals/src/chokepoints.config.ts`, `packages/core/signals/src/chokepoints.ts`
- Modify: `packages/core/signals/src/index.ts`
- Test: `packages/core/signals/test/chokepoints.test.ts`

- [ ] **Step 1: Create the dataset config**

`packages/core/signals/src/chokepoints.config.ts` (12 chokepoints; full curated impact text per entry — sample shows Hormuz + Suez; the worker fills the remaining 10 following the same shape with curated facts):

```ts
/**
 * Static chokepoints dataset (D-601) — reference data, NOT a connector.
 * Geometry (lat/lon center + radiusKm) + GKG match aliases + documented economic impact.
 * impactEs is the DOCUMENTED cascade (D-603); AI narrative is Slice B.
 */
export interface ChokepointConfig {
  id: string;
  name: string;        // English
  nameEs: string;      // Spanish
  lat: number;
  lon: number;
  radiusKm: number;    // proximity radius for event/signal detection
  aliases: string[];   // for GKG name/entity match (lower-cased compare)
  commodities: string[];
  worldShare: string;  // documented stat, Spanish
  dependentEconomies: string[];
  impactEs: string;    // documented cascade
}

/** Default proximity radius (km) — tunable knob. */
export const DEFAULT_RADIUS_KM = 400;

/** Detection window (72h) — matches convergence. */
export const CHOKEPOINT_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Scoring weights (documented; sum = 1). */
export const CHOKEPOINT_WEIGHTS = { event: 0.5, signal: 0.25, name: 0.25 } as const;

/** Saturation counts — score component reaches 1.0 at these magnitudes (tunable). */
export const CHOKEPOINT_SAT = { event: 3, signal: 5, name: 3 } as const;

/** Status band thresholds on the 0..1 score (tunable knob). */
export const CHOKEPOINT_BANDS = { watch: 0.2, disrupted: 0.5 } as const;

export const CHOKEPOINTS: ChokepointConfig[] = [
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    nameEs: 'Estrecho de Ormuz',
    lat: 26.6, lon: 56.4, radiusKm: 400,
    aliases: ['strait of hormuz', 'hormuz', 'ormuz', 'persian gulf', 'gulf of oman'],
    commodities: ['crudo', 'GNL'],
    worldShare: '~20% del petróleo mundial y gran parte del GNL de Catar',
    dependentEconomies: ['UE', 'China', 'India', 'Japón', 'Corea del Sur'],
    impactEs: 'Un cierre o incidente en Ormuz dispara el precio del Brent, encarece el GNL europeo y asiático, sube la gasolina y la energía en la UE, y presiona la inflación global. Es el chokepoint petrolero más crítico del mundo.',
  },
  {
    id: 'suez',
    name: 'Suez Canal',
    nameEs: 'Canal de Suez',
    lat: 30.5, lon: 32.35, radiusKm: 300,
    aliases: ['suez canal', 'suez', 'bab-el-mandeb', 'red sea'],
    commodities: ['contenedores', 'crudo', 'GNL'],
    worldShare: '~12% del comercio mundial y ~30% del tráfico de contenedores',
    dependentEconomies: ['UE', 'Asia', 'Mediterráneo'],
    impactEs: 'Un bloqueo del Canal de Suez desvía los buques por el Cabo de Buena Esperanza (+10-14 días), encarece fletes y contenedores, retrasa cadenas de suministro y sube precios de bienes importados en Europa.',
  },
  // ... worker adds the remaining 10 with curated facts:
  // bab-el-mandeb, malacca, panama, bosphorus, gibraltar, dover (English Channel),
  // danish-straits, taiwan, good-hope (Cabo de Buena Esperanza), magellan.
];
```

- [ ] **Step 2: Write the failing scorer test**

`packages/core/signals/test/chokepoints.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreChokepoints, haversineKm } from '../src/chokepoints.js';
import type { EventRow, SignalRow } from '@www/store';

const now = Date.now();

function evt(lat: number, lon: number, severity: number): EventRow {
  return {
    source: 'gdelt', sourceEventId: `e${lat}${lon}${severity}`, eventType: 'conflict',
    category: 'conflict', severity, lat, lon, country: 'IR', title: 't', url: null,
    occurredAt: now, capturedAt: now, rawJson: null,
  };
}

test('haversineKm: Hormuz center to ~near point is small, to far point is large', () => {
  assert.ok(haversineKm(26.6, 56.4, 26.6, 56.4) < 1);
  assert.ok(haversineKm(26.6, 56.4, 0, 0) > 5000);
});

test('scoreChokepoints: conflict events near Hormuz → disrupted', () => {
  const events: EventRow[] = [evt(26.7, 56.5, 90), evt(26.5, 56.3, 80), evt(26.6, 56.4, 95)];
  const rows = scoreChokepoints(events, [], now);
  const hormuz = rows.find((r) => r.chokepointId === 'hormuz');
  assert.ok(hormuz, 'hormuz present');
  assert.equal(hormuz.status, 'disrupted', `score=${hormuz.score}`);
});

test('scoreChokepoints: no nearby activity → calm', () => {
  const rows = scoreChokepoints([], [], now);
  assert.ok(rows.every((r) => r.status === 'calm'), 'all calm with no data');
  assert.equal(rows.length >= 12, true, 'one row per chokepoint');
});

test('scoreChokepoints: GKG name-match (no coords) still raises score', () => {
  const sig: SignalRow = {
    source: 'gkg', signalId: 's1', title: 'Tensions rise in the Strait of Hormuz',
    url: null, tone: -8, themes: 'ECON_OILPRICE', persons: null, organizations: null,
    lat: null, lon: null, country: null, occurredAt: now, capturedAt: now,
    rawJson: null, sections: [],
  };
  const rows = scoreChokepoints([], [sig], now);
  const hormuz = rows.find((r) => r.chokepointId === 'hormuz');
  assert.ok(hormuz.score > 0, 'name-match contributes to score');
});
```

- [ ] **Step 3: Run — expect FAIL** (`scoreChokepoints` not defined)

Run: `node --import tsx --test packages/core/signals/test/chokepoints.test.ts`

- [ ] **Step 4: Implement `chokepoints.ts`**

`packages/core/signals/src/chokepoints.ts`:

```ts
/**
 * chokepoints.ts — chokepoint disruption detection (slice A).
 * Pure scorer (scoreChokepoints) + IO orchestrator (detectAllChokepoints).
 * Methodology D-602: hybrid proximity (events+signals) + GKG name/entity match,
 * weighted blend → 0..1 score → status bands. 72h window.
 */

import { getEvents, getSignals, type EventRow, type SignalRow, type ChokepointStatusRow } from '@www/store';
import {
  CHOKEPOINTS, CHOKEPOINT_WINDOW_MS, CHOKEPOINT_WEIGHTS, CHOKEPOINT_SAT, CHOKEPOINT_BANDS,
  type ChokepointConfig,
} from './chokepoints.config.js';

/** Great-circle distance in km (Haversine). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const DISRUPTIVE = new Set(['conflict', 'protest']);

function aliasMatch(sig: SignalRow, aliases: string[]): boolean {
  const hay = `${sig.title ?? ''} ${sig.themes ?? ''} ${sig.persons ?? ''} ${sig.organizations ?? ''}`.toLowerCase();
  return aliases.some((a) => hay.includes(a));
}

function bandFor(score: number): ChokepointStatusRow['status'] {
  if (score >= CHOKEPOINT_BANDS.disrupted) return 'disrupted';
  if (score >= CHOKEPOINT_BANDS.watch) return 'watch';
  return 'calm';
}

/**
 * Pure scorer: given recent events + signals, score every chokepoint.
 * Returns one ChokepointStatusRow per CHOKEPOINTS entry (capturedAt = nowMs).
 */
export function scoreChokepoints(events: EventRow[], signals: SignalRow[], nowMs: number): ChokepointStatusRow[] {
  const since = nowMs - CHOKEPOINT_WINDOW_MS;
  const freshEvents = events.filter((e) => e.capturedAt >= since && DISRUPTIVE.has(e.eventType) && e.lat != null && e.lon != null);
  const freshSignals = signals.filter((s) => s.capturedAt >= since);

  return CHOKEPOINTS.map((cp) => scoreOne(cp, freshEvents, freshSignals, nowMs));
}

function scoreOne(cp: ChokepointConfig, events: EventRow[], signals: SignalRow[], nowMs: number): ChokepointStatusRow {
  // Proximity events: sum of severity (0..100 → 0..1) within radius.
  let eventSum = 0, eventCount = 0;
  for (const e of events) {
    if (haversineKm(cp.lat, cp.lon, e.lat as number, e.lon as number) <= cp.radiusKm) {
      eventSum += (e.severity ?? 0) / 100;
      eventCount++;
    }
  }
  // Proximity signals: nearby negative-tone GKG signals within radius.
  let signalCount = 0;
  for (const s of signals) {
    if (s.lat == null || s.lon == null) continue;
    if ((s.tone ?? 0) < 0 && haversineKm(cp.lat, cp.lon, s.lat, s.lon) <= cp.radiusKm) signalCount++;
  }
  // Name/entity match: any signal mentioning an alias (negative tone weighted).
  let nameCount = 0;
  for (const s of signals) {
    if (aliasMatch(s, cp.aliases)) nameCount += (s.tone ?? 0) < 0 ? 1 : 0.5;
  }

  const eventScore = clamp01(eventSum / CHOKEPOINT_SAT.event);
  const signalScore = clamp01(signalCount / CHOKEPOINT_SAT.signal);
  const nameScore = clamp01(nameCount / CHOKEPOINT_SAT.name);
  const score = clamp01(
    CHOKEPOINT_WEIGHTS.event * eventScore +
    CHOKEPOINT_WEIGHTS.signal * signalScore +
    CHOKEPOINT_WEIGHTS.name * nameScore,
  );

  return {
    chokepointId: cp.id,
    status: bandFor(score),
    score,
    componentsJson: JSON.stringify({ eventScore, signalScore, nameScore, eventCount, signalCount, nameCount }),
    capturedAt: nowMs,
  };
}

/**
 * IO orchestrator: reads recent events+signals from the store, scores all
 * chokepoints, returns persistable rows. Graceful: never throws on own logic.
 */
export async function detectAllChokepoints(nowMs: number): Promise<ChokepointStatusRow[]> {
  const since = nowMs - CHOKEPOINT_WINDOW_MS;
  // getEvents/getSignals default to LIMIT 500 (most-recent). A spatial proximity
  // scan needs the FULL 72h window or it silently misses events near a chokepoint
  // (GDELT alone is ~650/fetch). Pass a generous explicit cap.
  // ponytail: 20000 cap; if 72h volume ever exceeds it, add a coords-filtered store getter.
  const events = await getEvents({ sinceMs: since, limit: 20000 });
  const signals = await getSignals({ sinceMs: since, limit: 20000 });
  return scoreChokepoints(events, signals, nowMs);
}
```

- [ ] **Step 5: Export from the barrel**

In `packages/core/signals/src/index.ts`, append:

```ts
// Chokepoints (slice A)
export {
  CHOKEPOINTS, DEFAULT_RADIUS_KM, CHOKEPOINT_WINDOW_MS, CHOKEPOINT_WEIGHTS,
  CHOKEPOINT_SAT, CHOKEPOINT_BANDS, type ChokepointConfig,
} from './chokepoints.config.js';
export { scoreChokepoints, detectAllChokepoints, haversineKm } from './chokepoints.js';
```

- [ ] **Step 6: Run tests — expect PASS**; rebuild dist:

Run: `node --import tsx --test packages/core/signals/test/chokepoints.test.ts && pnpm --filter @www/core-signals build`
Expected: 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/signals
git commit -m "feat(core-signals): chokepoint dataset + disruption scorer + detectAllChokepoints"
```

---

## Task 3: Scheduler — chokepoints job (medium)

**Files:**
- Modify: `packages/scheduler/src/index.ts`
- Test: `packages/scheduler/test/scheduler.test.ts`

- [ ] **Step 1: Wire deps + job**

In `packages/scheduler/src/index.ts`:
- Import: add `detectAllChokepoints` to the `@www/core-signals` import (line 61) and `insertChokepointStatus` + `ChokepointStatusRow` to the `@www/store` import (lines 36-53).
- `SchedulerDeps`: add after the convergence block (line 208):

```ts
  // Chokepoints pipeline (@www/core-signals + @www/store) — slice A
  detectAllChokepoints: (nowMs: number) => Promise<ChokepointStatusRow[]>;
  insertChokepointStatus: (rows: ChokepointStatusRow[]) => Promise<void>;
```

- `REAL_STORE_AI_DEPS`: add `detectAllChokepoints` and `insertChokepointStatus` to both the `Pick<...>` union (lines 237-238) and the object literal (lines 251-252).
- Add the job after `ciiJob` (before `sanctionsJob`, ~line 490). Like cii, it reads the store internally:

```ts
  // ── chokepoints job (medium tier) — slice A ───────────────────────────────
  // Reads recent events+signals via detectAllChokepoints (store-backed) and
  // persists per-chokepoint disruption status. Sibling of cii (same medium tier);
  // eventually consistent with the latest gdelt/gkg writes.
  const chokepointsJob: Job = {
    name: 'chokepoints',
    tier: 'medium',
    intervalMs: intervals.medium,
    async run() {
      const now = Date.now();
      const rows = await (deps?.detectAllChokepoints ?? storeAi.detectAllChokepoints)(now);
      if (rows.length > 0) {
        await storeAi.insertChokepointStatus(rows);
        console.log(`[scheduler] chokepoints: persisted ${rows.length} status rows`);
      }
    },
  };
```

- Add `chokepointsJob` to the return array, after `ciiJob`:

```ts
  return [marketsJob, usgsJob, eonetJob, gdeltJob, gkgJob, ciiJob, chokepointsJob, newsJob, sanctionsJob, dailyJob];
```

- [ ] **Step 2: Update the job-count/order test**

In `packages/scheduler/test/scheduler.test.ts`, find the test asserting `defaultJobs(...).length` and the job-name order (currently 9 jobs incl. sanctions). Bump expected length to 10 and insert `'chokepoints'` after `'cii'` in any order-assertion array. Add a mocked-deps entry for `detectAllChokepoints: async () => []` and `insertChokepointStatus: async () => {}` if the test constructs a full deps object.

- [ ] **Step 3: Run — expect PASS**; rebuild dist:

Run: `node --import tsx --test packages/scheduler/test/scheduler.test.ts && pnpm --filter @www/scheduler build`

- [ ] **Step 4: Commit**

```bash
git add packages/scheduler
git commit -m "feat(scheduler): chokepoints job (medium) → detectAllChokepoints + persist"
```

---

## Task 4: Server — GET /api/chokepoints

**Files:**
- Modify: `server.ts`
- Test: `server.test.ts`

- [ ] **Step 1: Write failing tests**

In `server.test.ts`: add `insertChokepointStatus` + `ChokepointStatusRow` to the `@www/store` imports. Seed in `before()` (after the sanctions seed):

```ts
    // Seed chokepoint status (slice A)
    const now6 = Date.now();
    await insertChokepointStatus([
      { chokepointId: 'hormuz', status: 'disrupted', score: 0.82, componentsJson: '{"eventScore":0.9}', capturedAt: now6 },
      { chokepointId: 'suez',   status: 'calm',      score: 0.04, componentsJson: '{}', capturedAt: now6 },
    ]);
```

Add tests after the sanctions block:

```ts
  it('GET /api/chokepoints → 200, merges status with static config (camelCase)', async () => {
    const { status, body } = await get(server, '/api/chokepoints');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ id: string; nameEs: string; lat: number; lon: number; status: string; score: number; impactEs: string; commodities: string[] }>;
    assert.ok(Array.isArray(rows));
    const hormuz = rows.find((r) => r.id === 'hormuz');
    assert.ok(hormuz, 'hormuz present');
    assert.equal(hormuz.status, 'disrupted');
    assert.equal(hormuz.nameEs, 'Estrecho de Ormuz');
    assert.ok(typeof hormuz.lat === 'number' && typeof hormuz.lon === 'number', 'geometry merged');
    assert.ok(hormuz.impactEs.length > 0, 'documented impact merged');
    assert.ok(Array.isArray(hormuz.commodities), 'commodities array');
  });

  it('GET /api/chokepoints → chokepoint without a status snapshot defaults to calm', async () => {
    const { status, body } = await get(server, '/api/chokepoints');
    assert.equal(status, 200);
    const rows = JSON.parse(body) as Array<{ id: string; status: string; score: number }>;
    // A config entry never seeded (e.g. 'malacca') still appears, status 'calm', score 0.
    const malacca = rows.find((r) => r.id === 'malacca');
    assert.ok(malacca, 'unseeded chokepoint still listed (from config)');
    assert.equal(malacca.status, 'calm');
  });
```

- [ ] **Step 2: Run — expect FAIL** (404). Run: `node --import tsx --test server.test.ts`

- [ ] **Step 3: Implement the route**

In `server.ts`:
- Add `getLatestChokepointStatus` to the `@www/store` import; add `import { CHOKEPOINTS } from '@www/core-signals';` near the other imports.
- Add the route after `/api/sanctions`, before 404:

```ts
  // ── /api/chokepoints ──────────────────────────────────────────────────────
  // SOLO-LECTURA. Merges the static CHOKEPOINTS config (geometry + documented
  // impact) with the latest disruption status per chokepoint. A chokepoint with
  // no status snapshot yet defaults to calm/score 0. NEVER fires detection on-request.
  if (pathname === '/api/chokepoints') {
    const statusRows = await getLatestChokepointStatus();
    const byId = new Map(statusRows.map((r) => [r.chokepointId, r]));
    const payload = CHOKEPOINTS.map((cp) => {
      const st = byId.get(cp.id);
      return {
        id: cp.id,
        name: cp.name,
        nameEs: cp.nameEs,
        lat: cp.lat,
        lon: cp.lon,
        commodities: cp.commodities,
        worldShare: cp.worldShare,
        dependentEconomies: cp.dependentEconomies,
        impactEs: cp.impactEs,
        status: st ? st.status : 'calm',
        score: st ? st.score : 0,
        capturedAt: st ? st.capturedAt : null,
      };
    });
    sendJson(res, 200, payload);
    return;
  }
```

- [ ] **Step 4: Run — expect PASS**. Run: `node --import tsx --test server.test.ts`
- [ ] **Step 5: Global typecheck.** Run: `pnpm -r exec tsc --noEmit && npx tsc --noEmit -p tsconfig.json`
- [ ] **Step 6: Commit**

```bash
git add server.ts server.test.ts
git commit -m "feat(server): GET /api/chokepoints (status × static config merge)"
```

---

## Task 5: Web — client adapter

**Files:** Modify `packages/web/src/api/client.ts`

- [ ] **Step 1: Raw shape + view-model + adapter + fetch** (after the sanctions block, end of file region):

```ts
interface RawChokepointRow {
  id: string;
  name: string;
  nameEs: string;
  lat: number;
  lon: number;
  commodities: string[];
  worldShare: string;
  dependentEconomies: string[];
  impactEs: string;
  status: 'calm' | 'watch' | 'disrupted';
  score: number;
  capturedAt: number | null;
}

export interface Chokepoint {
  id: string;
  name: string;
  nameEs: string;
  lat: number;
  lon: number;
  commodities: string[];
  worldShare: string;
  dependentEconomies: string[];
  impactEs: string;
  status: 'calm' | 'watch' | 'disrupted';
  score: number;
  capturedAt: string | null;   // ISO or null
}

function adaptChokepoint(r: RawChokepointRow): Chokepoint {
  return {
    id: r.id, name: r.name, nameEs: r.nameEs, lat: r.lat, lon: r.lon,
    commodities: Array.isArray(r.commodities) ? r.commodities : [],
    worldShare: r.worldShare,
    dependentEconomies: Array.isArray(r.dependentEconomies) ? r.dependentEconomies : [],
    impactEs: r.impactEs, status: r.status, score: r.score,
    capturedAt: r.capturedAt != null ? new Date(r.capturedAt).toISOString() : null,
  };
}

/**
 * Fetch chokepoints (geometry + documented impact + live disruption status) from /api/chokepoints.
 * Attribution: datos propios (rutas comerciales) · disrupción derivada de GDELT/USGS/GKG.
 */
export async function getChokepoints(): Promise<Chokepoint[]> {
  const raw = await apiFetch<RawChokepointRow[]>('/api/chokepoints');
  if (!Array.isArray(raw)) return [];
  return raw.map(adaptChokepoint);
}
```

- [ ] **Step 2: Typecheck.** Run: `pnpm --filter @www/web exec tsc --noEmit`
- [ ] **Step 3: Commit.** `git add packages/web/src/api/client.ts && git commit -m "feat(web): getChokepoints client + Chokepoint view-model"`

---

## Task 6: Web — map layer + MapView wiring

**Files:** Modify `packages/web/src/map/layers.config.ts`, `packages/web/src/map/MapView.tsx`

- [ ] **Step 1: Add `CHOKEPOINT_LAYERS`** (after `SANCTIONS_LAYERS`, before `LAYER_SOURCES`):

```ts
// ---------------------------------------------------------------------------
// CHOKEPOINT_LAYERS — trade chokepoints (slice A). Circle by disruption status.
// Distinct from country layers: status colors (teal/amber/red) on sea lanes.
// Toggle 'chokepoints' ON by default (D-604, headline feature).
// Property (W-3 scalar): id, status, score.
// ---------------------------------------------------------------------------
const CHOKEPOINT_COLOR = [
  'match', ['get', 'status'],
  'disrupted', '#ef4444',  // red
  'watch', '#f59e0b',      // amber
  '#14b8a6',               // calm — teal (default)
];

export const CHOKEPOINT_LAYERS: LayerSpec[] = [
  {
    id: 'chokepoints',
    source: 'chokepoints',
    type: 'circle',
    label: 'Rutas / Chokepoints',
    toggleKey: 'chokepoints',
    visibleWhen: (active) => active.has('chokepoints'),
    paint: {
      'circle-color': CHOKEPOINT_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 6, 8, 12],
      'circle-opacity': 0.85,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  },
];
```

Then add `...CHOKEPOINT_LAYERS` to both `LAYER_SOURCES` and `TOGGLE_KEYS` spread arrays.

- [ ] **Step 2: MapView wiring.** In `packages/web/src/map/MapView.tsx`:
- Import `CHOKEPOINT_LAYERS` from layers.config and `getChokepoints`, `type Chokepoint` from client.
- Add `...CHOKEPOINT_LAYERS` to the two layer loops (addLayer + visibility).
- Add helper:

```ts
function chokepointsToGeoJSON(rows: Chokepoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: { id: c.id, nameEs: c.nameEs, status: c.status, score: c.score },
    })),
  };
}
```

- Add `const chokepointsDataRef = useRef<Chokepoint[]>([]);` near the other refs.
- Add a load useEffect (mirror the sanctions one) that calls `getChokepoints()`, stores in `chokepointsDataRef.current`, and `setData(chokepointsToGeoJSON(rows))` on source `'chokepoints'`.
- Add an `activeChokepoint` prop (`string | null`) to `Props` and a flyTo effect:

```ts
  useEffect(() => {
    if (!activeChokepoint) return;
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const cp = chokepointsDataRef.current.find((c) => c.id === activeChokepoint);
    if (!cp) return;
    map.flyTo({ center: [cp.lon, cp.lat], zoom: 5, duration: 800 });
  }, [activeChokepoint]);
```

- Destructure `activeChokepoint` in the component signature.

- [ ] **Step 3: Typecheck + build.** Run: `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`
- [ ] **Step 4: Commit.** `git add packages/web/src/map && git commit -m "feat(web): chokepoints map layer + MapView source/load/flyTo"`

---

## Task 7: Web — ChokepointsPanel + App "Rutas" tab + CSS

**Files:** Create `packages/web/src/panels/ChokepointsPanel.tsx`; modify `packages/web/src/App.tsx`, `packages/web/src/styles.css`

- [ ] **Step 1: Create `ChokepointsPanel.tsx`** (mirror ConvergencePanel structure: loading/empty/error states, sorted list, map-tie via row click). Each row: `nameEs`, status badge (calm/watch/disrupted with color), score bar, `commodities` chips, `dependentEconomies`, and the documented `impactEs` text (always visible — it's the headline). Props: `activeChokepoint: string | null`, `onSelect: (id: string) => void`. Fetch via `getChokepoints()`, sort by score desc. Attribution footer: "Rutas comerciales (datos propios) · disrupción derivada de GDELT/USGS/GKG". Use classes `chokepoints-panel`, `chokepoints-row`, `chokepoints-row__name`, `chokepoints-row__status`, `chokepoints-row__impact`, etc.

```tsx
// Key shape (full component mirrors ConvergencePanel.tsx states + list):
type CpState =
  | { status: 'loading' } | { status: 'error'; message: string }
  | { status: 'empty' } | { status: 'ok'; rows: Chokepoint[] };

// status badge color helper:
function statusColor(s: Chokepoint['status']): string {
  return s === 'disrupted' ? 'var(--color-danger)' : s === 'watch' ? 'var(--color-warning)' : '#14b8a6';
}
function statusLabel(s: Chokepoint['status']): string {
  return s === 'disrupted' ? 'Disrupción' : s === 'watch' ? 'Vigilancia' : 'Estable';
}
// row impact line ALWAYS rendered: <p className="chokepoints-row__impact">{c.impactEs}</p>
```

The full file follows ConvergencePanel.tsx exactly for the loading/error/empty/ok scaffolding; the only differences are the row contents above and the fetch (`getChokepoints`).

- [ ] **Step 2: App.tsx — 6th tab + state.**
- Import `ChokepointsPanel`.
- Add `type PanelTab = ... | 'chokepoints';`
- Add `const [activeChokepoint, setActiveChokepoint] = useState<string | null>(null);`
- Add handler: `const handleChokepointSelect = (id: string) => { setActiveChokepoint(id); setActiveLayers((prev) => new Set(prev).add('chokepoints')); };`
- Pass `activeChokepoint={activeChokepoint}` to `<MapView … />`.
- Add a tab button "Rutas" (after Convergence) and the panel render:

```tsx
          {activeTab === 'chokepoints' && (
            <ChokepointsPanel activeChokepoint={activeChokepoint} onSelect={handleChokepointSelect} />
          )}
```

- Add `'chokepoints'` to the `panelTitle` ternary (→ 'Rutas').
- `chokepoints` toggle is ON by default — do NOT delete it in `buildInitialActive` (unlike convergence/sanctions).

- [ ] **Step 3: styles.css — tab bar scroll + panel styles.**
- Make `.panel-tabs { overflow-x: auto; }` and `.panel-tab { flex: 0 0 auto; white-space: nowrap; }` so 6 tabs scroll horizontally at 375px instead of overflowing.
- Add a `.chokepoints-*` block mirroring the sanctions block (row card flex, status badge pill, score bar, `.chokepoints-row__impact { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: var(--space-1); }`).

- [ ] **Step 4: Typecheck + build.** Run: `pnpm --filter @www/web exec tsc --noEmit && pnpm --filter @www/web build`
- [ ] **Step 5: Commit.** `git add packages/web/src && git commit -m "feat(web): ChokepointsPanel + Rutas tab + scrollable tab bar"`

---

## Task 8: Integration — verify + live smoke + browser E2E

**Files:** Create `packages/web/chokepoints-e2e.mjs`; modify `plans/DECISIONS.md`, `plans/ROADMAP.md`

- [ ] **Step 1: Global typecheck + full suite.** Run: `pnpm -r exec tsc --noEmit && npx tsc --noEmit -p tsconfig.json` then `pnpm test` + `node --import tsx --test server.test.ts`. Expected: tsc EXIT 0, 0 fails. New tests: store +1, core-signals +4, server +2, scheduler order updated.

- [ ] **Step 2: Live smoke.** Start backend (`node --env-file-if-exists=.env --import tsx server.ts`, port 8787) so the medium-tier chokepoints job runs after gdelt/gkg populate. Then:

Run: `curl -s http://127.0.0.1:8787/api/chokepoints | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('chokepoints:',a.length,'| statuses:',a.map(r=>r.id+'='+r.status).join(', '))})"`
Expected: 12 chokepoints, camelCase, each with a status; Hormuz likely watch/disrupted if Gulf conflict events are present (else calm — note in report, not a failure).

- [ ] **Step 3: Write `packages/web/chokepoints-e2e.mjs`** (adapt convergence-e2e.mjs harness; BASE `http://localhost:5173`, screenshots `../../plans/screenshots`). Assert:
  - Load: 0 console errors / 0 net 4xx-5xx.
  - 6th tab "Rutas" exists; click → `.chokepoints-panel` visible; ≥12 `.chokepoints-row`; badNames=0 (`.chokepoints-row__name` non-empty); every row shows a non-empty `.chokepoints-row__impact`.
  - Sorted by score desc.
  - `chokepoints` map layer toggle exists and is ON by default (D-604).
  - Map-tie: click first row → map canvas present + flyTo (center changes).
  - Responsive 375px: no horizontal overflow (`document.body.scrollWidth <= 377`), tab bar scrollable, panel usable.
  - Print `VERDICT: PASS`; non-zero exit on any FAIL.

- [ ] **Step 4: Run E2E.** Start backend (8787) + `pnpm exec vite --port 5173`, then `node packages/web/chokepoints-e2e.mjs`. Expected `VERDICT: PASS`.

- [ ] **Step 5: Record ADR-015 (D-601..D-607) in `plans/DECISIONS.md` + add the slice to `plans/ROADMAP.md`** under a new Fase (or extend "Completar dominios"). Note slices B/C/D as the follow-on roadmap for the AI-first vision.

- [ ] **Step 6: Commit.** `git add packages/web/chokepoints-e2e.mjs plans/ && git commit -m "test(web): chokepoints browser E2E + ADR-015 + roadmap"`

---

## Self-Review

**Spec coverage:** dataset (T2) · detection hybrid+name-match (T2 scorer, D-602) · documented impact (T2 config, D-603) · table+job (T1,T3) · endpoint merge (T4) · map layer status colors ON-default (T6, D-604) · Rutas tab + scroll (T7, D-605) · activeChokepoint map-tie (T6,T7, D-606) · verify+E2E (T8). Deferred D-607 documented, no task. ✅

**Type consistency:** `ChokepointStatusRow` defined T1 (store), consumed T2 (scorer returns it), T3 (job). `ChokepointConfig`/`CHOKEPOINTS` defined T2, consumed T4 (server merge). `Chokepoint` view-model T5, consumed T6 (MapView), T7 (panel). Source id `'chokepoints'` + toggle key `'chokepoints'` consistent T6↔T7↔App. Map property `status`/`id` emitted T6 geojson ↔ `['get','status']` paint T6 ↔ `activeChokepoint` find-by-`id` T6. `detectAllChokepoints`/`insertChokepointStatus` deps consistent T2/T1↔T3. ✅

**Placeholder scan:** T2 Step 1 leaves 10 chokepoints for the worker to fill with curated facts (flagged explicitly — content is curated reference data, not code logic). T7 Step 1 references ConvergencePanel.tsx as the scaffolding template (the worker reads it) rather than repeating ~250 lines — flagged. All code-logic steps contain real code. ✅

**Risk note (smoke timing, W-1 carried from sanctions):** the medium-tier chokepoints job needs events/signals populated first; on cold boot Hormuz may read calm until gdelt/gkg + one chokepoints tick land. Endpoint still returns all 12 (config-backed, status calm). Not a failure — note in the smoke report.
