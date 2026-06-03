-- Migration 006: Move commission ownership onto subscription_plans + per-(user, plan) override matrix
--
-- Schema changes (ADDITIVE ONLY — safe to run while old code is live):
--   subscription_plans:
--     + admin_alt_prices JSONB           — admin-only alternate price variants
--                                          (e.g. yearly Promo ฿2,800 — was hardcoded)
--     + tier_id INTEGER FK               — when a user buys this plan they're
--                                          auto-assigned to this tier (promote only)
--
--   user_package_commissions (NEW):
--     UNIQUE(user_id, plan_id) → commission_percent
--     ใช้สำหรับ admin override commission ของ user ที่ขาย plan เฉพาะตัว
--     (override ระดับสูงสุดใน resolution chain — สูงกว่า plan default + tier)
--
-- Seeds (idempotent):
--   - yearly.admin_alt_prices = [{label:'Promo', subtotal:2800}]
--   - monthly.tier_id = Tier 1 row, yearly.tier_id = Tier 2 row
--
-- REQUIRES: 005 (creates subscription_plans + affiliate_tiers)

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS admin_alt_prices JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tier_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_plans_tier'
  ) THEN
    ALTER TABLE subscription_plans
      ADD CONSTRAINT fk_plans_tier
      FOREIGN KEY (tier_id) REFERENCES affiliate_tiers(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END$$;

-- Seed yearly Promo ฿2,800 — only if still default '[]' (admin edits preserved)
UPDATE subscription_plans
   SET admin_alt_prices = '[{"label":"Promo","label_th":"โปรโมชั่น","subtotal":2800}]'::jsonb,
       updated_at = NOW()
 WHERE slug = 'yearly' AND admin_alt_prices = '[]'::jsonb;

-- Seed tier links — monthly→Tier 1, yearly→Tier 2 (only if still NULL)
UPDATE subscription_plans
   SET tier_id = (
     SELECT id FROM affiliate_tiers
      WHERE name = 'Tier 1' OR display_order = 1
      ORDER BY display_order ASC, id ASC
      LIMIT 1
   ),
       updated_at = NOW()
 WHERE slug = 'monthly' AND tier_id IS NULL;

UPDATE subscription_plans
   SET tier_id = (
     SELECT id FROM affiliate_tiers
      WHERE name = 'Tier 2' OR display_order = 2
      ORDER BY display_order ASC, id ASC
      LIMIT 1
   ),
       updated_at = NOW()
 WHERE slug = 'yearly' AND tier_id IS NULL;

-- ── user_package_commissions (per-(user × plan) override matrix) ──
CREATE TABLE IF NOT EXISTS user_package_commissions (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id            INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  commission_percent NUMERIC(5,2) NOT NULL
    CHECK (commission_percent >= 0 AND commission_percent <= 100),
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_upc_user
  ON user_package_commissions (user_id);
