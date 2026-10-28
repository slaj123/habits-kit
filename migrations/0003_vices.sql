-- Vices: tracked, never part of the habit streak, never in a push.
-- One row per tap. kind: one of VICES in src/habits.js.
CREATE TABLE IF NOT EXISTS vice_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('drink', 'smoke', 'sweets', 'scroll')),
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vice_events_at ON vice_events (at);

-- One row per day. The iPhone Shortcut (via a Screen Time app's action) or
-- the manual box writes it; the latest write wins.
CREATE TABLE IF NOT EXISTS screen_time (
  date TEXT PRIMARY KEY,       -- YYYY-MM-DD in the tracker's time zone
  minutes INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('shortcut', 'manual')),
  updated_at TEXT NOT NULL
);
