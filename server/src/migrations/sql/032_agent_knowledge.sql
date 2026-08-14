-- 032_agent_knowledge.sql — admin-editable knowledge base for the Agent Chat bot.
-- Each row is one self-contained knowledge entry (FAQ answer, promo detail, policy).
-- Injected into the bot's context while the total is small; when it grows past the
-- context budget the bot falls back to the search_knowledge tool (ILIKE today —
-- the row-per-entry shape is deliberately chunk-sized so a future pgvector
-- embedding column can be added per-row without restructuring).
-- Managed from /admin/chats → "คลังความรู้บอท". Idempotent.
CREATE TABLE IF NOT EXISTS agent_knowledge (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_active ON agent_knowledge(is_active, display_order);
