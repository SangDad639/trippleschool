-- Episode-list redesign: per-lesson custom cover image.
-- NULL = derive the cover from the lesson's YouTube thumbnail automatically
-- (served through /api/courses/lessons/:id/thumb so the video id never leaks).

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS cover_url TEXT;
