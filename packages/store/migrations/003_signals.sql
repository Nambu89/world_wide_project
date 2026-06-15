CREATE TABLE IF NOT EXISTS signals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT    NOT NULL,
  signal_id       TEXT    NOT NULL,
  title           TEXT,
  url             TEXT,
  tone            REAL,
  themes          TEXT,
  persons         TEXT,
  organizations   TEXT,
  lat             REAL,
  lon             REAL,
  country         TEXT,
  occurred_at     INTEGER,
  captured_at     INTEGER NOT NULL,
  raw_json        TEXT,
  UNIQUE (source, signal_id)
);

CREATE TABLE IF NOT EXISTS signal_sections (
  signal_id  INTEGER NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  section    TEXT    NOT NULL,
  matched_by TEXT,
  PRIMARY KEY (signal_id, section)
);

CREATE INDEX IF NOT EXISTS ix_signals_recent  ON signals (captured_at);

CREATE INDEX IF NOT EXISTS ix_signals_tone    ON signals (tone);

CREATE INDEX IF NOT EXISTS ix_signals_occ     ON signals (occurred_at);

CREATE INDEX IF NOT EXISTS ix_sigsec_section  ON signal_sections (section)
