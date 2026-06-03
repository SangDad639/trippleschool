-- Migration 014: Welcome popup banner — admin-managed library of swap-able
-- images for the WelcomePopup modal (formerly hardcoded in WelcomePopup.tsx).
--
-- Schema is intentionally light (image + destination link + label) — distinct
-- from the rich `update_banners` table that backs the /update page. Admin
-- keeps a history of past banners in the same table; only one row is active
-- at a time (enforced by the partial unique index below).
--
-- Behavior on the FE side:
--   • WelcomePopup fetches the active row at mount via GET /api/welcome-banner/active
--   • localStorage key includes the active row's image_url, so flipping which
--     banner is active causes the popup to re-show for every user who had
--     dismissed the previous image.

CREATE TABLE IF NOT EXISTS welcome_banners (
  id            SERIAL PRIMARY KEY,
  image_url     TEXT NOT NULL,
  link_url      TEXT NOT NULL DEFAULT '/app/image-templates',
  label         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- At most one active banner — partial unique on a constant expression.
-- Inactive rows are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS welcome_banners_one_active
  ON welcome_banners ((1)) WHERE is_active = true;

-- Seed the current hardcoded banner so behavior is preserved post-migration.
-- Only runs on an empty table (re-applies are no-ops).
INSERT INTO welcome_banners (image_url, link_url, label, is_active, display_order, created_at)
SELECT '/new-image-template.png', '/app/image-templates', 'Initial (seeded)', true, 0, NOW()
WHERE NOT EXISTS (SELECT 1 FROM welcome_banners);
