CREATE TABLE IF NOT EXISTS convergence_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  families_json TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  components_json TEXT NOT NULL,
  strength REAL NOT NULL,
  source_count INTEGER NOT NULL,
  dynamic_score REAL,
  methodology_version TEXT NOT NULL,
  first_detected_at INTEGER NOT NULL,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_conv_country_time ON convergence_signals (country, captured_at)