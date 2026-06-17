# /check-plan — Chokepoints Slice A (2026-06-17)

**Plan:** `plans/2026-06-17-chokepoints.md`
**Verdict:** ✅ **PASS** (1 blocker FIXED inline, 1 non-blocking warning)

> Dispatched plan-checker subagent truncated by turn-limit (L-6, 3rd occurrence) before
> writing a verdict — but surfaced one real defect (below). PM finished the residual
> checks + applied the fix directly (documented practice).

## Blocker found + FIXED

- **B-1 (event/signal coverage cap):** `getEvents`/`getSignals` both default `limit ?? 500`
  (`ORDER BY captured_at DESC`). `detectAllChokepoints` originally called them with no limit
  → a spatial proximity scan over only the 500 most-recent events would silently miss events
  near a specific chokepoint (GDELT alone ~650/fetch). **FIX applied to plan T2 Step 4:** pass
  explicit `limit: 20000` to both, with a `ponytail:` comment naming the ceiling + upgrade path
  (a coords-filtered store getter if 72h volume ever exceeds it). CII avoids this by using
  `getEventsByCountry` (unlimited); chokepoints scan by coords, so the explicit cap is correct.

## 5 dimensions

1. **Coverage** — PASS. Dataset (T2) · hybrid+name-match detection (T2) · documented impact (T2/D-603) · table+job (T1/T3) · endpoint merge (T4) · layer/panel/tab (T6/T7) · verify+E2E (T8). Deferred D-607 documented.
2. **Task completeness** — PASS. TDD steps with real code; engine/store/server use node:test, web uses tsc+build+E2E (correct per repo convention). T2 Step 1 leaves 10 chokepoints as curated reference data (flagged, not code logic); T7 references ConvergencePanel as scaffolding template (flagged).
3. **Dependencies** — PASS. store → core-signals → scheduler/server → web → verify. `chokepoints.ts` imports only `@www/store` + local config (mirrors observe.ts — confirmed observe.ts imports only @www/store, NO connectors dep). Migration 007 auto-discovered by migrate.ts readdir+sort (no runner change). Barrel exports wired.
4. **Scope** — PASS. D-601..D-607 honored; impact is documented (no LLM in A — Slice B boundary intact). No connector added.
5. **Risks** — PASS w/ warning.

## Locked-decision fidelity

D-601 dataset in core-signals (no connector) ✓ · D-602 hybrid+name-match score→bands ✓ · D-603 documented impact (no AI) ✓ · D-604 status circle ON-default (buildInitialActive does NOT delete 'chokepoints') ✓ · D-605 Rutas tab + scroll-x ✓ · D-606 camelCase + new activeChokepoint state ✓ · D-607 deferrals documented ✓.

## Warning (non-blocking)

- **W-1 (smoke timing):** medium-tier chokepoints job needs events/signals populated first;
  on cold boot Hormuz may read calm until gdelt/gkg + one chokepoints tick land. Endpoint still
  returns all 12 (config-backed, status calm). Noted in T8 Step 2 — not a failure.
