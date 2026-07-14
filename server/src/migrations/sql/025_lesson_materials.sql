-- 025_lesson_materials.sql — downloadable documents per lesson.
-- Idempotent: safe to re-run. Stores an array of { title, url, type } objects.
--   type: 'link' (admin-pasted URL) | 'pdf' (uploaded, served via /api/courses/materials/<key>)

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS materials JSONB NOT NULL DEFAULT '[]'::jsonb;
