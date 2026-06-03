-- Migration 016: Tier backfill + commission rate change + schema invariants
--
-- Context (verified against HWC RDS, 2026-05-16):
--   - 145 users had purchased Yearly (tier_id=2) but were still on Tier 1
--     because maybePromoteOnPurchase() was added after these sales AND
--     Stripe webhook never called it.
--   - Business directive: lower Tier 1 commission from 20% → 5%.
--   - users.affiliate_tier was NULLABLE with ON DELETE SET NULL — gives
--     admin enough rope to break 4,200 users by deleting Tier 1.
--
-- This migration does 4 atomic steps:
--   1. UPDATE tier rates (T1: 20% → 5%)
--   2. Backfill user tiers from purchase history (promote-only)
--   3. Sync users.commission_percent snapshot to match new tier rate
--   4. Enforce NOT NULL + RESTRICT FK
--
-- Idempotent — safe to re-run. ON DELETE RESTRICT means future tier deletes
-- fail loudly if any user references the tier (no silent data loss).

-- ============================================================
-- Step 1: Adjust tier commission rates
-- ============================================================
UPDATE affiliate_tiers
SET commission_percent = 5, updated_at = NOW()
WHERE id = 1 AND commission_percent <> 5;
-- Tier 2 stays 25%, Tier 3 stays 35% — unchanged by directive.

-- ============================================================
-- Step 2: Backfill users' tiers from purchase history
-- Heuristic: days_added + amount uniquely identifies the plan tier in
-- production data:
--   30d  + amount > 0 → monthly (tier 1)
--   365d + amount > 0 → yearly  (tier 2)
-- Premium (also 365d but ฿20,223) has zero historical rows — no false match.
-- Coupons / free admin grants (amount = 0) excluded — no purchase = no promote.
-- Promote-only: never demotes (protects 5 existing manual-T2 users).
-- ============================================================
WITH user_target_tier AS (
  SELECT l.user_id,
         MAX(CASE
           WHEN l.days_added = 365 AND l.amount::numeric > 0 THEN 2
           WHEN l.days_added = 30  AND l.amount::numeric > 0 THEN 1
           ELSE 0
         END) AS expected_tier
  FROM subscription_extension_logs l
  WHERE l.approval_method IN ('admin','autoapprove','stripe')
    AND l.amount::numeric > 0
  GROUP BY l.user_id
)
UPDATE users u
SET affiliate_tier = utt.expected_tier
FROM user_target_tier utt
WHERE u.id = utt.user_id
  AND utt.expected_tier > 0
  AND utt.expected_tier > u.affiliate_tier;

-- ============================================================
-- Step 3: Sync users.commission_percent snapshot to match new tier rate
-- WHY: commissionService resolution chain reads users.commission_percent
-- (step 3) BEFORE affiliate_tiers.commission_percent (step 4). Without
-- this sync, step 1 (rate change) has no effect on T1 users' new sales.
-- ============================================================
UPDATE users u
SET commission_percent = t.commission_percent
FROM affiliate_tiers t
WHERE u.affiliate_tier = t.id
  AND (u.commission_percent IS DISTINCT FROM t.commission_percent);

-- ============================================================
-- Step 4: Schema invariants — every user MUST have a non-NULL tier
-- ============================================================
-- Defensive backfill (production currently has 0 NULLs but be safe)
UPDATE users
SET affiliate_tier = 1
WHERE affiliate_tier IS NULL;

ALTER TABLE users ALTER COLUMN affiliate_tier SET NOT NULL;

-- Replace ON DELETE SET NULL with ON DELETE RESTRICT so any future tier
-- delete attempt fails loudly when users reference it.
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_affiliate_tier;
ALTER TABLE users ADD CONSTRAINT fk_users_affiliate_tier
  FOREIGN KEY (affiliate_tier) REFERENCES affiliate_tiers(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;
