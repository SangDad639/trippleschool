-- 019_chat_thread_agent_mode.sql
-- Add agent_mode column to chat_threads so the AI Agent can dispatch
-- between the existing "reels-pipeline" assistant and the new
-- "full-commander" assistant (drives any feature in the app).
--
-- Default 'reels-pipeline' preserves the existing tab inside ContentScheduler.
-- New /app/ai-agent standalone page creates threads with 'full-commander'.

ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS agent_mode VARCHAR(32) NOT NULL DEFAULT 'reels-pipeline';

CREATE INDEX IF NOT EXISTS idx_chat_threads_agent_mode
  ON chat_threads(user_id, agent_mode, updated_at DESC);
