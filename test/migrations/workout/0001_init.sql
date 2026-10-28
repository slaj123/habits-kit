-- One row per workout. date and type are columns for sorting and the Watch
-- "same day, same type" match; everything else lives in data as JSON (shape
-- in src/model.js) so new fields don't need a migration.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,          -- form | watch | voice | import
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_date ON sessions (date);

-- Climbing projects persist across sessions until sent.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Wrong passcode tries, for the login lockout. Rows older than a day are pruned.
CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_at ON login_failures (at);
