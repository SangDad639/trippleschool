-- Migration 007: admin_only flag + seed Tier 3 + Premium package
--
-- Schema:
--   subscription_plans:
--     + admin_only BOOLEAN NOT NULL DEFAULT false
--       — when true, plan is hidden from public Landing / Subscription pages
--         but still visible in /admin → Packages. Admin uploads slip on behalf
--         of users to grant these "secret deal" plans.
--
-- Seeds (all idempotent):
--   1. Tier 3 — display_order=3, commission=35%, badge='diamond'
--   2. Premium package — slug='premium', subtotal=฿18,900, days=365,
--      admin_only=true, tier_id=Tier 3
--
-- Backward compat:
--   - admin_only defaults to false → existing rows (monthly, yearly) keep
--     showing on Landing. Old SELECT statements don't reference this column.
--   - Tier 3 doesn't affect register flow — auth.ts picks the lowest
--     display_order (= Tier 1) as the default, regardless of how many tiers exist.
--
-- REQUIRES: 005 (creates subscription_plans + affiliate_tiers) + 006 (tier_id column)

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS admin_only BOOLEAN NOT NULL DEFAULT false;

-- Tier 3 — gated by display_order=3 not existing (allow admin to have renamed it)
INSERT INTO affiliate_tiers
  (name, name_th, commission_percent, display_order, badge_color, description)
SELECT
  'Tier 3', 'ระดับ 3', 35.00, 3, 'diamond',
  'Tier 3 — สำหรับลูกค้าระดับสูง (commission 35%). กำหนดให้โดยอัตโนมัติเมื่อซื้อ Premium package.'
WHERE NOT EXISTS (
  SELECT 1 FROM affiliate_tiers WHERE display_order = 3
);

-- Premium package — gated by slug='premium' not existing
INSERT INTO subscription_plans
  (slug, name, name_th, subtotal, days, display_order,
   admin_only, tier_id, description, features)
SELECT
  'premium', 'Premium Yearly', 'พรีเมียมรายปี',
  18900.00, 365, 99,
  true,
  (SELECT id FROM affiliate_tiers WHERE display_order = 3 ORDER BY id ASC LIMIT 1),
  'แพ็กเกจระดับพรีเมียม สำหรับลูกค้าพิเศษ (admin-only). ผู้ที่ซื้อจะได้ Tier 3 (35% commission) อัตโนมัติ.',
  '["ทุกอย่างที่ Yearly มี","Commission rate 35% (Tier 3 — promote อัตโนมัติ)","Priority support"]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_plans WHERE slug = 'premium'
);
