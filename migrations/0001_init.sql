-- Phase 2 — accounts (username + password) + sessions.
-- D1 (SQLite): INTEGER unix-ms for times, INTEGER 0/1 for booleans.
-- D1 enforces foreign keys by default; ON DELETE CASCADE cleans sessions.
-- Shared DB: every table/index is prefixed `chat_` (see wrangler.jsonc).

CREATE TABLE IF NOT EXISTS chat_users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  email         TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES chat_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_expires_at ON chat_sessions(expires_at);
