-- Agent chat: users can attach an image to a question (served via the
-- agent-chat image proxy, stored in S3 like enrollment slips).

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image_url TEXT;
