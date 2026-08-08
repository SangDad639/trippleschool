-- 030_verified_slips.sql — defense-in-depth against slip replay + race double-grant.
-- Every Thunder-verified bank slip's transRef is recorded here as part of the grant
-- transaction. UNIQUE(trans_ref) makes the subscription grant idempotent and blocks
-- two concurrent submits of the SAME slip: the 2nd INSERT hits the unique constraint
-- and the transaction rolls back (no double extension). This complements Thunder's
-- own checkDuplicate flag, which is no longer the sole guard.
--   source = 'autoapprove' (public /v2/verify-and-approve) | 'admin' (admin extend).
-- Idempotent: IF NOT EXISTS, safe to re-run.
CREATE TABLE IF NOT EXISTS verified_slips (
  id SERIAL PRIMARY KEY,
  trans_ref TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  plan_slug VARCHAR(50),
  amount NUMERIC(10,2),
  source VARCHAR(20) NOT NULL DEFAULT 'autoapprove',
  created_at TIMESTAMP DEFAULT NOW()
);
