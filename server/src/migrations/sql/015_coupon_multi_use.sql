-- Migration 015: Coupon multi-use support
--
-- Context: Adds a 2nd coupon type — multi-use with per-account uniqueness.
-- Legacy single-use codes keep working (max_uses=1 backfill below).
--
-- Semantics of max_uses:
--   NULL   — unlimited total redemptions (still 1 per user via pivot UNIQUE)
--   1      — legacy single-use (1 user globally)
--   N (>1) — capped multi-use (up to N users, each user only once)
--
-- Per-user uniqueness is ALWAYS enforced via UNIQUE(coupon_id, user_id) on
-- the new coupon_redemptions pivot table — independent of max_uses.

-- 1. Add max_uses column
ALTER TABLE coupon_codes
  ADD COLUMN IF NOT EXISTS max_uses INTEGER NULL;

COMMENT ON COLUMN coupon_codes.max_uses IS
  'Total redemption cap. NULL = unlimited; 1 = legacy single-use; N = capped multi-use. Per-user limit (1) is always enforced via coupon_redemptions UNIQUE.';

-- 2. Pivot table — 1 row per (coupon × user) redemption
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id SERIAL PRIMARY KEY,
  coupon_id INTEGER NOT NULL REFERENCES coupon_codes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  redeemed_ip VARCHAR(50) NULL,
  UNIQUE(coupon_id, user_id)  -- enforces "1 user can redeem each code once"
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user ON coupon_redemptions(user_id);

-- 3. Backfill legacy single-use redemptions into the pivot — preserves history.
-- ON CONFLICT DO NOTHING makes it idempotent if migration re-runs.
INSERT INTO coupon_redemptions (coupon_id, user_id, redeemed_at, redeemed_ip)
SELECT id, redeemed_by, redeemed_at, redeemed_ip
FROM coupon_codes
WHERE redeemed_by IS NOT NULL
ON CONFLICT (coupon_id, user_id) DO NOTHING;

-- 4. Lock legacy codes to single-use semantics so behaviour doesn't change.
-- Codes that were never redeemed stay NULL (admin re-saves them to set
-- explicitly via UI; defaulting via UI keeps old UX = single-use).
UPDATE coupon_codes
SET max_uses = 1
WHERE max_uses IS NULL AND redeemed_by IS NOT NULL;
