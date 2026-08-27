-- Guide clips (/guide) — the how-to clip grid, moved from a hardcoded array in
-- src/components/guide/clipsData.ts to an admin-managed table.
--
-- Why a table: the page is linked from the Triple Bot desktop app's login screen,
-- so a clip has to be publishable without a frontend deploy. Editing clipsData.ts
-- meant a commit + build for every clip.
--
-- `links` holds the small pill buttons under a card: [{"label":"...","url":"..."}].
-- JSONB (not a child table) because they are always read and written with the
-- clip, never queried on their own.
--
-- clipsData.ts stays in the repo as the fallback the page renders when the API
-- is unreachable, and as the source of the build-time /guide-clips.json.

CREATE TABLE IF NOT EXISTS guide_clips (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL DEFAULT '',
  subtitle VARCHAR(255),
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guide_clips_active ON guide_clips(is_active, display_order);

-- Seed the one clip that shipped hardcoded, so the page does not go blank the
-- moment it starts reading from the DB. Runs only while the table is empty, so
-- a re-run never duplicates it or resurrects a clip the admin deleted.
INSERT INTO guide_clips (title, subtitle, url, links, display_order)
SELECT
  'Ep 6. คู่มือการเชื่อมต่อ YouTube',
  'Triple Next Guide',
  'https://www.youtube.com/watch?v=I_e7yTGM9Qk',
  '[{"label":"ดูบน YouTube","url":"https://www.youtube.com/watch?v=I_e7yTGM9Qk"}]'::jsonb,
  0
WHERE NOT EXISTS (SELECT 1 FROM guide_clips);
