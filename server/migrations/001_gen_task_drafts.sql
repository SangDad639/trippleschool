-- Gen Task Drafts table for storing draft tasks before generation
CREATE TABLE IF NOT EXISTS gen_task_drafts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES scheduler_channels(id) ON DELETE CASCADE,
    template_id VARCHAR(255) DEFAULT '',
    custom_prompt TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookup by channel
CREATE INDEX IF NOT EXISTS idx_gen_task_drafts_channel ON gen_task_drafts(channel_id, user_id);
