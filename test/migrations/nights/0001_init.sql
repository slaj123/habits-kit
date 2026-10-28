-- 1,000 Nights progress store.
-- `seq` is a server-side sequence number: every sync bumps it once, and each row
-- written in that sync gets the new value. Clients ask for rows with seq > N.

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL
);
INSERT OR IGNORE INTO meta (k, v) VALUES ('seq', 0);

-- One row per night that has a mode set or was front-loaded.
-- A night with no row is a Full night.
CREATE TABLE IF NOT EXISTS nights (
  date         TEXT PRIMARY KEY,               -- YYYY-MM-DD (night starts 4 a.m.)
  mode         TEXT NOT NULL CHECK (mode IN ('full', 'light')),
  mode_ts      INTEGER NOT NULL,               -- client ms; latest wins
  front_loaded INTEGER NOT NULL DEFAULT 0,     -- 1 = read ahead of time
  seq          INTEGER NOT NULL
);

-- One row per checkbox.
--   full items:  key = item id, e.g. 'd007-poem' (each is read once)
--   light items: key = 'YYYY-MM-DD|lp-p03' (light items recur)
CREATE TABLE IF NOT EXISTS checks (
  key        TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('full', 'light')),
  item_id    TEXT NOT NULL,
  date       TEXT NOT NULL,                    -- the night it counts for
  day_number INTEGER,                          -- full sets only
  checked    INTEGER NOT NULL CHECK (checked IN (0, 1)),
  ts         INTEGER NOT NULL,                 -- client ms; latest wins
  seq        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS checks_seq ON checks (seq);
CREATE INDEX IF NOT EXISTS nights_seq ON nights (seq);
CREATE INDEX IF NOT EXISTS checks_date ON checks (date);
