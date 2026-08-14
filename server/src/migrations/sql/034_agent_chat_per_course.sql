-- Agent chat v3: per-course sessions + YouTube auto-subtitle knowledge.
-- Old conversations keep course_id NULL (= legacy site-wide chats).

ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_course ON chat_conversations(course_id);

CREATE TABLE IF NOT EXISTS lesson_subtitles (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER NOT NULL UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  language VARCHAR(10) NOT NULL DEFAULT 'th',
  content TEXT NOT NULL,
  fetched_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lesson_subtitles_course ON lesson_subtitles(course_id);
