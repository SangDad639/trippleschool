-- Migration 012: Coupon code system (free-days redemption)
--
-- Admin generates redeemable codes; users redeem to extend their subscription.
-- Separate from the existing "Adjust Days" admin tool — coupons are pre-issued
-- tokens that the user themselves activates.
--
-- Constraints (per design):
--   • code            8-char uppercase A-Z + 2-9 (no 0/O/1/I/L confusables)
--   • days            positive INTEGER (cap 3650 = 10 years sanity bound)
--   • One-time use    redeemed_by + redeemed_at set atomically on redeem;
--                     once non-NULL, the code is dead
--   • No expiry       admin deactivates manually (is_active=false)
--   • CHECK pair      audit-trail consistency: both redeemed_* are NULL
--                     or both are non-NULL

CREATE TABLE IF NOT EXISTS coupon_codes (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(20) UNIQUE NOT NULL,
  days            INTEGER NOT NULL CHECK (days > 0 AND days <= 3650),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  redeemed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  redeemed_at     TIMESTAMP,
  redeemed_ip     VARCHAR(50),
  CONSTRAINT coupon_redeemed_consistency CHECK (
    (redeemed_by IS NULL AND redeemed_at IS NULL) OR
    (redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL)
  )
);

-- Partial index speeds up the hot path: admin filter "active + unredeemed" + user redeem lookup
CREATE INDEX IF NOT EXISTS idx_coupons_status
  ON coupon_codes (is_active, redeemed_by)
  WHERE is_active = true;

-- Lookup by who redeemed (for /profile / /admin user detail)
CREATE INDEX IF NOT EXISTS idx_coupons_redeemed_by
  ON coupon_codes (redeemed_by) WHERE redeemed_by IS NOT NULL;
