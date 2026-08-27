-- A tip carries TWO naming fields:
--   tag_id   → the LINK tag (same tag as its parent course = attachment)
--   tag_name → its OWN short display name (Tip menu label, CourseDetail tab label)
-- Courses don't need tag_name — their menu label comes from tags.name via tag_id.

ALTER TABLE courses ADD COLUMN IF NOT EXISTS tag_name VARCHAR(40);
