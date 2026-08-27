-- Guide groups: the clip grid gains the same two levels a course has —
-- a group is the "course", the clips inside it are the "lessons".
--
-- /guide now lists groups like the course catalog, and /guide/:slug opens one
-- group with its clip list. Flat clips did not scale: everything the team
-- published landed in one wall of cards with no way to say what belonged together.
--
-- ON DELETE CASCADE mirrors courses/lessons: dropping a group drops its clips,
-- and the admin screen warns before that happens.

CREATE TABLE IF NOT EXISTS guide_groups (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  cover_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guide_groups_active ON guide_groups(is_active, display_order);

ALTER TABLE guide_clips
  ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES guide_groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_guide_clips_group ON guide_clips(group_id, display_order);

-- Clips published before groups existed keep working: park them in one group
-- instead of hiding them. Both statements are conditional, so a re-run is a no-op
-- and a group the admin later renamed or emptied is never recreated.
INSERT INTO guide_groups (title, slug, description, display_order)
SELECT 'คู่มือการใช้งาน', 'general', 'คลิปที่เพิ่มไว้ก่อนแยกกลุ่ม', 0
WHERE EXISTS (SELECT 1 FROM guide_clips WHERE group_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM guide_groups WHERE slug = 'general');

UPDATE guide_clips
   SET group_id = (SELECT id FROM guide_groups WHERE slug = 'general')
 WHERE group_id IS NULL
   AND EXISTS (SELECT 1 FROM guide_groups WHERE slug = 'general');
