-- 021_credit_purchases.sql
-- Phase 5: Slip-based credit recharge.
--
-- Pattern mirrors /api/subscription/v2/verify-and-approve — user uploads
-- bank-transfer slip, Thunder API verifies, on success credits are added
-- via creditService.addCredits('purchase', ...). Manual admin approval is
-- the fallback when Thunder declines/duplicates/etc.

-- 1. Credit packages catalogue (admin-managed, displayed on /credits/topup)
CREATE TABLE IF NOT EXISTS credit_packages (
  id            SERIAL PRIMARY KEY,
  slug          VARCHAR(50) UNIQUE NOT NULL,
  name          VARCHAR(100) NOT NULL,
  name_th       VARCHAR(100),
  credits       INT NOT NULL CHECK (credits > 0),
  price_thb     NUMERIC(10, 2) NOT NULL CHECK (price_thb > 0),
  description   TEXT,
  display_order INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_packages_active_order
  ON credit_packages (is_active, display_order);

-- Seed 3 starter packages — admin can override via CRUD later.
INSERT INTO credit_packages (slug, name, name_th, credits, price_thb, description, display_order)
VALUES
  ('starter-10k',   'Starter — 10,000 credits',  '10,000 เครดิต',   10000,  299.00,  'พอใช้ภาพ Nano Banana 2 ~1,250 รูป (1k)', 1),
  ('pro-30k',       'Pro — 30,000 credits',      '30,000 เครดิต',   30000,  799.00,  'พอใช้ vdo Kling 3 ~75 วินาที', 2),
  ('studio-100k',   'Studio — 100,000 credits',  '100,000 เครดิต',  100000, 2499.00, 'สำหรับ creator มืออาชีพ', 3)
ON CONFLICT (slug) DO NOTHING;

-- 2. Purchase requests + audit trail
CREATE TABLE IF NOT EXISTS credit_purchases (
  id                  SERIAL PRIMARY KEY,
  user_id             INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_slug        VARCHAR(50) NOT NULL REFERENCES credit_packages(slug),
  credits             INT NOT NULL,                   -- snapshotted from package at time of upload
  amount_thb          NUMERIC(10, 2) NOT NULL,        -- snapshotted from package
  slip_url            TEXT,                           -- /api/subscription/slips/<key> proxy path
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
                      -- 'pending' | 'auto_approved' | 'admin_approved' | 'rejected' | 'duplicate' | 'failed'
  thunder_check       JSONB,                          -- Thunder API response (or null if not yet checked)
  rejection_reason    TEXT,
  approved_by_admin_id INT REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  credit_transaction_id INT REFERENCES credit_transactions(id),  -- link to the granted credit row
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_purchases_user_created
  ON credit_purchases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_status_created
  ON credit_purchases (status, created_at DESC);

-- Idempotency: a single (user_id, package_slug, slip_url) tuple can only be
-- approved once. Same slip uploaded by mistake → second insert is OK but
-- approve path checks status before granting.
CREATE INDEX IF NOT EXISTS idx_credit_purchases_slip
  ON credit_purchases (slip_url) WHERE slip_url IS NOT NULL;
