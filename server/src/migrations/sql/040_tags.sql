-- Shared tag pool for the header hover menus.
-- A tag is the SHORT display name shown in the Course/Tip dropdowns (course
-- titles are too long for a menu). A course carries its own tag; a tip carries
-- the tag of its parent course — same tag = the tip attaches to that course.

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(40) NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_tag ON courses(tag_id);
