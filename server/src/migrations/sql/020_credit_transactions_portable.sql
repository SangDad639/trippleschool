-- 020_credit_transactions_portable.sql
-- Hardens the existing credit_transactions table:
--   - Adds `metadata` JSONB column (used by updateKieTaskId in creditService.ts)
--   - Adds UNIQUE idempotency constraint (user_id, reference_type, reference_id, type)
--     so deductCredits/refundCredits cannot double-charge on retry
--   - Adds composite indexes for paginated history + reference lookups
--   - Adds CHECK (credits >= 0) on users to prevent overdraft from race conditions
--
-- Production schema pre-flight (2026-06-01):
--   - Table exists with 12 cols, all rows have type='deduct'|'refund' (column `transaction_type` is empty legacy column)
--   - 0 duplicate (user_id, reference_type, reference_id, type) tuples → safe to add UNIQUE
--   - users.credits has 0 negative values → safe to add CHECK

-- 1. Add missing column
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 2. Idempotency UNIQUE — prevents double-deduct / double-refund on retry.
--    Partial: only enforces when all four cols are non-null (admin_add/registration may have NULL ref fields).
CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_idempotency
  ON credit_transactions (user_id, reference_type, reference_id, type)
  WHERE reference_type IS NOT NULL
    AND reference_id IS NOT NULL
    AND type IS NOT NULL;

-- 3. History query indexes
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created
  ON credit_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_reference
  ON credit_transactions (reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_type_created
  ON credit_transactions (type, created_at DESC);

-- 4. Overdraft prevention on users.credits
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_positive_credits'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_positive_credits CHECK (credits >= 0) NOT VALID;
    -- NOT VALID skips pre-existing rows check (safe — we verified 0 negatives).
    -- New writes enforced immediately.
  END IF;
END $$;
