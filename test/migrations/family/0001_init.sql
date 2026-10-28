-- People (and pets) who can be tagged in memories.
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  initial TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'pet')),
  sort INTEGER NOT NULL DEFAULT 0
);

-- One spot on the map. Many memories can live at the same place.
CREATE TABLE places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  created_by TEXT REFERENCES people(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One story at a place. date_start is sortable ISO; precision says how exact it is.
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('travel', 'food', 'experience', 'sports', 'accomplishment', 'property')),
  date_start TEXT NOT NULL,
  date_precision TEXT NOT NULL DEFAULT 'day' CHECK (date_precision IN ('day', 'month', 'season', 'year')),
  story TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES people(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX memories_place ON memories(place_id, date_start);

CREATE TABLE memory_people (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  PRIMARY KEY (memory_id, person_id)
);

-- Photos and voice memos attached to a memory. Files live in R2.
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'voice')),
  r2_key TEXT NOT NULL,
  thumb_key TEXT,
  content_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_sec REAL,
  added_by TEXT NOT NULL REFERENCES people(id),
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX media_memory ON media(memory_id, added_at);
