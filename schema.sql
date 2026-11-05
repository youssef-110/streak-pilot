CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                 -- GitHub user id
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  token_enc TEXT,                         -- AES-GCM encrypted OAuth token; NULL after disconnect
  token_ok INTEGER NOT NULL DEFAULT 1,    -- 0 when GitHub rejected the token
  repo TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT 'main',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  jitter INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_manual_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS slots (
  id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  commits INTEGER NOT NULL,
  days INTEGER NOT NULL DEFAULT 127,
  message TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_key TEXT NOT NULL UNIQUE,           -- user:slot:local-date, or user:manual:ts
  kind TEXT NOT NULL,                     -- 'scheduled' | 'manual'
  local_date TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,                   -- 'running' | 'ok' | 'error'
  planned INTEGER NOT NULL,
  made INTEGER NOT NULL DEFAULT 0,
  repo TEXT NOT NULL,
  url TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS runs_user_time ON runs(user_id, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
