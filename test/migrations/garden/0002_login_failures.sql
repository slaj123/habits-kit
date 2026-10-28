-- Wrong passcode tries, for the login lockout. Rows older than a day are pruned.
CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_at ON login_failures (at);
