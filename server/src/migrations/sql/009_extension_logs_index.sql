-- Migration 009: Compound index on subscription_extension_logs(user_id, created_at DESC)
--
-- Speeds up the LATERAL JOIN in GET /api/admin/users that fetches the latest
-- extension log per user (`WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`).
-- Without this index Postgres falls back to seq scan + sort per user — slow on
-- the admin Users table when count is in the thousands.
--
-- Migrated from ad-hoc script `server/scripts/add-extension-logs-index.ts`.

CREATE INDEX IF NOT EXISTS idx_extension_logs_user_created
  ON subscription_extension_logs (user_id, created_at DESC);
