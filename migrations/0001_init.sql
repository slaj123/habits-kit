-- Small settings: time zone, nudge hour, start date, Garden retired date.
CREATE TABLE IF NOT EXISTS settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per device that turned nudges on.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One row per day a nudge went out, so the hourly cron never sends twice.
CREATE TABLE IF NOT EXISTS nudges (
  date TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  body TEXT NOT NULL
);

-- Wrong passcode tries, for the login lockout. Rows older than a day are pruned.
CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_at ON login_failures (at);
