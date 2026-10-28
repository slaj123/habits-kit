-- One row per Daily Log voice memo, sent by the voice-memo-logger Worker
-- after it commits the memo (POST /api/ingest/dailylog). `entry` is the
-- memo's file name, which is also its link on the Journal site (/#e-<entry>).
CREATE TABLE IF NOT EXISTS daily_logs (
  entry TEXT PRIMARY KEY,
  at TEXT NOT NULL,          -- ISO time the memo was processed
  headline TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS daily_logs_at ON daily_logs (at);
