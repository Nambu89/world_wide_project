---
name: project_store_t02
description: T-02 packages/store/ implementation — libSQL schema, migrations, full normative API, 10/10 tests passing
metadata:
  type: project
---

T-02 DONE (2026-06-13). packages/store/ fully implemented with @libsql/client.

**Files written:**
- `packages/store/migrations/001_init.sql` — exact normative schema (5 tables: market_snapshots, gdelt_events, news_items, briefings, market_daily; _migrations; 2 composite indexes)
- `packages/store/src/types.ts` — MarketSnapshot, GdeltEvent, NewsItem, Briefing, MarketDaily interfaces (wide-typed, D-100)
- `packages/store/src/db.ts` — singleton getDb(url?) with LIBSQL_URL env override + _resetDbForTesting() for tests
- `packages/store/src/migrate.ts` — idempotent migration runner (splits SQL on ';', skips applied migrations)
- `packages/store/src/index.ts` — all normative API functions + re-exports

**Key design decisions:**
- _resetDbForTesting() + LIBSQL_URL=:memory: pattern allows test isolation without touching prod DB
- migrate() in migrate.ts accepts explicit client (for tests); index.ts wrapper calls getDb() singleton
- purgeAndDownsample uses window functions (ROW_NUMBER OVER PARTITION) for OHLC — requires SQLite 3.25+ (libSQL supports this)
- INSERT OR IGNORE for gdelt_events and news_items (UNIQUE constraints)
- getLatestMarkets uses MAX(captured_at) subquery JOIN — correct latest-per-group pattern

**Verify:** `pnpm --filter @www/store build && node --import tsx --test packages/store/test/store.test.ts` → 10 pass, 0 fail, ~820ms

**Why:** Base layer for all other packages — connectors write snapshots, scheduler calls purgeAndDownsample, core/ai reads briefing cache, UI reads historical data.
**How to apply:** When adding new connectors or scheduler jobs, use insertMarketSnapshots/insertGdeltEvents/insertNewsItems. Never bypass the store to read upstream in the UI.
