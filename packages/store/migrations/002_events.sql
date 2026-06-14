CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT    NOT NULL,
  source_event_id TEXT    NOT NULL,
  event_type      TEXT    NOT NULL,
  category        TEXT    NOT NULL,
  severity        REAL,
  lat             REAL,
  lon             REAL,
  country         TEXT,
  title           TEXT,
  url             TEXT,
  occurred_at     INTEGER,
  captured_at     INTEGER NOT NULL,
  raw_json        TEXT,
  UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS ix_events_recent  ON events (captured_at);

CREATE INDEX IF NOT EXISTS ix_events_type    ON events (event_type, occurred_at);

CREATE INDEX IF NOT EXISTS ix_events_country ON events (country, occurred_at);

CREATE INDEX IF NOT EXISTS ix_events_sev     ON events (severity);

DROP TABLE IF EXISTS gdelt_events;
