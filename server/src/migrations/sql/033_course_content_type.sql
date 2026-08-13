-- 033_course_content_type.sql — content taxonomy for the Netflix-style nav:
--   'course' = multi-episode course (ซีรีส์)  |  'tip' = single-episode quick lesson (หนังจบในเรื่อง)
-- Admin picks the type when creating/editing; existing rows default to 'course'.
-- (Numbered 033: 031/032 file names were removed with the agent-chat feature but
-- remain recorded as applied in _migrations — reusing them would be skipped.)
-- Idempotent.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS content_type VARCHAR(20) NOT NULL DEFAULT 'course';
DO $$ BEGIN
  ALTER TABLE courses ADD CONSTRAINT courses_content_type_check CHECK (content_type IN ('course','tip'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
