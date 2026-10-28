-- Each person's own thoughts on a memory: text, a voice memo, or both.
CREATE TABLE thoughts (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  author TEXT NOT NULL REFERENCES people(id),
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX thoughts_memory ON thoughts(memory_id, created_at);

-- A voice memo either narrates the story (thought_id NULL) or belongs to one thought.
ALTER TABLE media ADD COLUMN thought_id TEXT REFERENCES thoughts(id) ON DELETE CASCADE;
