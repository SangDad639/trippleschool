-- 031_agent_chat.sql — Agent Chat (FAB widget): AI support chat + human escalation.
-- chat_conversations: one thread per user/guest. status flow:
--   'ai' (bot answering) → 'escalated' (waiting for admin) → 'answered' (admin replied;
--   a user reply nudges it back to 'escalated') → 'closed'.
-- Guests are identified by a client-generated guest_id (localStorage uuid) — user_id NULL.
-- chat_messages: per-message rows; sender_type 'user' | 'ai' | 'admin'.
-- (The orphaned chat_threads table from 018 is NOT reused — JSONB blob + user_id NOT NULL.)
-- Idempotent: IF NOT EXISTS, safe to re-run.

CREATE TABLE IF NOT EXISTS chat_conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  guest_id VARCHAR(64),
  status VARCHAR(20) NOT NULL DEFAULT 'ai'
    CHECK (status IN ('ai','escalated','answered','closed')),
  escalate_reason TEXT,
  contact_info VARCHAR(255),
  last_message_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_type VARCHAR(10) NOT NULL CHECK (sender_type IN ('user','ai','admin')),
  admin_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_guest ON chat_conversations(guest_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_status ON chat_conversations(status);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, created_at);
