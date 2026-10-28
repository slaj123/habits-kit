-- One row per person. The plant's fields live as JSON so the page's data
-- shape can grow without a migration each time.
CREATE TABLE IF NOT EXISTS plants (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
