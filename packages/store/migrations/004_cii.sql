CREATE TABLE IF NOT EXISTS cii_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  composite REAL NOT NULL,
  baseline_risk REAL NOT NULL,
  event_score REAL NOT NULL,
  dynamic_score REAL,
  trend TEXT,
  methodology_version TEXT NOT NULL,
  components_json TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cii_country_time ON cii_snapshots (country, captured_at)
