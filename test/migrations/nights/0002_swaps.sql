-- "Read my own pick instead": one row per swapped slot per night.
--   key = 'YYYY-MM-DD|slot' (slot: poem | story | essay)
--   item_id = the skipped curated item (goes to the Saved-for-later shelf)
--   removed = 1 when the swap was undone. Latest ts wins, like checks.
CREATE TABLE IF NOT EXISTS swaps (
  key        TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  slot       TEXT NOT NULL CHECK (slot IN ('poem', 'story', 'essay')),
  day_number INTEGER NOT NULL,
  item_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  removed    INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
  ts         INTEGER NOT NULL,
  seq        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS swaps_seq ON swaps (seq);
