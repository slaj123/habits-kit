-- Google sign-in sessions. The cookie holds a random token; only its hash is stored here,
-- so a copy of the database can't be used to log in.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_person ON sessions(person_id);
