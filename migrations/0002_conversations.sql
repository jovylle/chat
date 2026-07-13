-- Phase 3 — server-side conversation sync.
-- Mirrors the localStorage shape 1:1 (conversation {id,title,model,pinned,
-- tokenCount,created,updated}, message {role,content}).
-- Shared DB: every table/index is prefixed `chat_` (see wrangler.jsonc).

CREATE TABLE IF NOT EXISTS chat_conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT,
  model       TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES chat_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user
  ON chat_conversations(user_id, pinned DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  model           TEXT,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON chat_messages(conversation_id, created_at);
