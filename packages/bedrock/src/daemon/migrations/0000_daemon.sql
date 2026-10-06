CREATE TABLE pebbles (
  name TEXT PRIMARY KEY,
  release TEXT NOT NULL,
  previous_release TEXT,
  status TEXT NOT NULL DEFAULT 'running'
);
CREATE TABLE deploy_tokens (
  hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
