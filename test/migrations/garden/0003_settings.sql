-- Small app settings, e.g. the hash of the iPhone Shortcut key.
CREATE TABLE IF NOT EXISTS settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
