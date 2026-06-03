-- Migration 005: subscription_plans + affiliate_tiers tables
--
-- เพิ่มตารางสำหรับระบบ admin-managed subscription packages + N-tier affiliate program.
-- ย้าย commission ownership จาก `affiliate_settings.tier1_percent/tier2_percent`
-- (ที่อ่านครั้งเดียวตอน register) → ตาราง `affiliate_tiers` ที่ admin แก้ได้
-- และ ย้าย pricing จาก hardcode `config/pricing.ts` → ตาราง `subscription_plans`.
--
-- Seeds (idempotent):
--   - monthly (฿600/30d, display_order=1) + yearly (฿3,000/365d, display_order=2)
--   - Tier 1 + Tier 2 (commission rates อ่านจาก legacy affiliate_settings ถ้ามี)
--   - FK users.affiliate_tier → affiliate_tiers(id) ON UPDATE CASCADE ON DELETE SET NULL
--
-- Backward compat:
--   - `affiliate_settings.tier1_percent/tier2_percent` ยังคงอยู่ — kept สำหรับ
--     legacy code path ที่ยังอ้างถึง (e.g. /register's lookup fallback chain)
--   - `users.affiliate_tier` ตอนนี้เป็น FK ไป affiliate_tiers.id (id 1=Tier 1, 2=Tier 2 ตรงกับเดิม)

-- ── subscription_plans ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_plans (
  id                SERIAL PRIMARY KEY,
  slug              VARCHAR(50) UNIQUE NOT NULL,
  name              VARCHAR(100) NOT NULL,
  name_th           VARCHAR(100),
  subtotal          NUMERIC(10,2) NOT NULL,
  days              INTEGER NOT NULL,
  commission_percent NUMERIC(5,2)
    CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100)),
  is_active         BOOLEAN DEFAULT true,
  display_order     INTEGER DEFAULT 0,
  description       TEXT,
  features          JSONB DEFAULT '[]'::jsonb,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plans_active_order
  ON subscription_plans (is_active, display_order);

INSERT INTO subscription_plans (slug, name, name_th, subtotal, days, display_order, is_active)
VALUES
  ('monthly', 'Monthly', 'รายเดือน', 600,  30,  1, true),
  ('yearly',  'Yearly',  'รายปี',    3000, 365, 2, true)
ON CONFLICT (slug) DO NOTHING;

-- ── affiliate_tiers ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_tiers (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(50) NOT NULL,
  name_th           VARCHAR(50),
  commission_percent NUMERIC(5,2) NOT NULL
    CHECK (commission_percent >= 0 AND commission_percent <= 100),
  is_active         BOOLEAN DEFAULT true,
  display_order     INTEGER DEFAULT 0,
  description       TEXT,
  badge_color       VARCHAR(20) DEFAULT 'gray',
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tiers_active_order
  ON affiliate_tiers (is_active, display_order);

-- Seed Tier 1 / Tier 2 — pick up legacy rates if affiliate_settings exists,
-- else fall back to 20% / 25% (matches the historical defaults).
INSERT INTO affiliate_tiers (id, name, name_th, commission_percent, display_order, badge_color)
SELECT 1, 'Tier 1', 'ระดับ 1', COALESCE(tier1_percent, 20.00), 1, 'gray'
  FROM affiliate_settings WHERE id = 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO affiliate_tiers (id, name, name_th, commission_percent, display_order, badge_color)
SELECT 2, 'Tier 2', 'ระดับ 2', COALESCE(tier2_percent, 25.00), 2, 'gold'
  FROM affiliate_settings WHERE id = 1
ON CONFLICT (id) DO NOTHING;

-- Fallback: if affiliate_settings is missing (fresh DB), seed defaults
INSERT INTO affiliate_tiers (id, name, name_th, commission_percent, display_order, badge_color)
VALUES
  (1, 'Tier 1', 'ระดับ 1', 20.00, 1, 'gray'),
  (2, 'Tier 2', 'ระดับ 2', 25.00, 2, 'gold')
ON CONFLICT (id) DO NOTHING;

-- Bump sequence so future inserts get id >= 3 (Tier 3+ added in 007)
SELECT setval(
  'affiliate_tiers_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 0) FROM affiliate_tiers), 2)
);

-- ── FK users.affiliate_tier → affiliate_tiers(id) ───────────────────
-- Wrapped in DO block because there's no IF NOT EXISTS for ADD CONSTRAINT
-- in PG < 17; the constraint name uniqueness check handles idempotency.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_affiliate_tier'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_affiliate_tier
      FOREIGN KEY (affiliate_tier) REFERENCES affiliate_tiers(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END$$;
