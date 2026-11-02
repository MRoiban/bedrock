ALTER TABLE sessions ADD COLUMN fixed_expiry INTEGER NOT NULL DEFAULT 0;
CREATE TABLE session_links (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pebble TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX session_links_expiry ON session_links(expires_at);
