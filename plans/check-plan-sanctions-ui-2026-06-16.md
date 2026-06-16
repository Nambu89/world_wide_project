# /check-plan — Sanctions UI Surface (2026-06-16)

**Plan:** `plans/2026-06-16-sanctions-ui.md`
**Verdict:** ✅ **PASS** (0 blockers, 2 non-blocking warnings)

> Note: 2 dispatched `plan-checker` subagents truncated by turn-limit (L-6) before
> emitting a verdict; both ended mid-verification on benign "let me check X" notes,
> neither on a found defect. PM finished the residual checks directly (documented practice).

## 5 dimensions

1. **Requirement coverage** — PASS. Every design element maps to a task (Self-Review table in plan). Deferred items (trend, top-entities) documented as D-504, no phantom task.
2. **Task completeness** — PASS. Bite-sized TDD steps with real code; server gets node:test units (+5); web verifies via tsc+build+E2E (no web unit runner exists — correct per repo convention).
3. **Dependencies** — PASS. Order: store (exists) → server → client → layers → MapView → panel/App → verify. No forward refs; types defined before use.
4. **Scope** — PASS. Pure clone of CII/convergence surface; no connector, no new store API, no trend. D-501..D-505 honored in tasks; no scope-erosion phrasing.
5. **Risks** — PASS w/ warnings (below).

## Locked decisions fidelity (D-501..D-505)

- D-501 folded into FinancePanel (no 6th tab) → Task 5. ✅
- D-502 violet filled circle, `step` on raw count → Task 3. ✅
- D-503 toggle 'sanctions' OFF default → Task 5 Step 4 (buildInitialActive delete). ✅
- D-504 trend/top-entities deferred → header, no task. ✅
- D-505 camelCase wire → Task 2 `RawSanctionRow`. ✅

## Residual checks (PM, post-truncation)

- **FinancePanel signature change** (props now required): single call site `App.tsx:247` (today `<FinancePanel />` no props) — updated in Task 5 Step 5. `grep FinancePanel` confirms no other call site. ✅ No breaking change.
- **Country name ↔ centroid key match**: `COUNTRY_CENTROIDS` keyed by names (`Russia`, `Iran`, `"North Korea"`); sanctions connector emits those same names (memory: Russia 5597 / Iran 1918 / NK 415). Partial coverage → null lat/lon → panel-only (established CII/convergence behavior). ✅
- **Route order**: `/api/sanctions` exact `===` match, placed after `/api/convergence`, before 404; no collision with regex route `/api/cii/:country`. ✅
- **Store API**: `getLatestSanctions()` (store/index.ts:878) + `SanctionRow` (types.ts:178) exist. ✅

## Warnings (non-blocking)

- **W-1 (smoke timing):** slow-tier sanctions job may not have populated the DB on a cold boot at smoke time → `/api/sanctions` could return `[]` and the panel shows the empty state (graceful). Mitigation: live DB already has 190 countries (prior smoke); if empty, wait one slow-tier cycle or seed. Noted in Task 6 Step 2.
- **W-2 (L-5 discipline):** browser E2E is mandatory, not optional — verde≠funciona. The camelCase wire + map-layer render are exactly the BUG-1 class of defect that tsc+curl miss. Task 6 Step 3/4 enforce it.
