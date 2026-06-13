-- Migration 001: initial schema
-- world_wide_project — packages/store

CREATE TABLE IF NOT EXISTS _migrations (
  id         TEXT    PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT    NOT NULL,
  symbol      TEXT    NOT NULL,
  asset_class TEXT    NOT NULL,
  price       REAL    NOT NULL,
  change_pct  REAL,
  captured_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_market_trend ON market_snapshots (source, symbol, captured_at);

CREATE TABLE IF NOT EXISTS gdelt_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT    NOT NULL,
  event_id    TEXT    NOT NULL,
  category    TEXT,
  severity    REAL,
  lat         REAL,
  lon         REAL,
  captured_at INTEGER NOT NULL,
  UNIQUE (event_id, captured_at)
);

CREATE INDEX IF NOT EXISTS ix_gdelt_trend ON gdelt_events (source, captured_at);

CREATE TABLE IF NOT EXISTS news_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT    NOT NULL,
  feed_domain  TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  url          TEXT    NOT NULL,
  published_at INTEGER,
  captured_at  INTEGER NOT NULL,
  UNIQUE (url, captured_at)
);

CREATE TABLE IF NOT EXISTS briefings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain      TEXT    NOT NULL,
  body_md     TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  valid_until INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_daily (
  symbol TEXT NOT NULL,
  day    INTEGER NOT NULL,
  open   REAL,
  high   REAL,
  low    REAL,
  close  REAL,
  PRIMARY KEY (symbol, day)
);
