CREATE TABLE IF NOT EXISTS chokepoint_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chokepoint_id TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL,
  components_json TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_chokepoint_status_id_time ON chokepoint_status (chokepoint_id, captured_at)
