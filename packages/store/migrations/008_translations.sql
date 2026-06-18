CREATE TABLE IF NOT EXISTS translations (
  source TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL
)
