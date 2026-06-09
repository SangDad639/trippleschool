-- ============================================================================
-- OPTIONAL / MANUAL — Drop legacy scheduler + AI-generation + credit tables.
-- ============================================================================
-- This file is intentionally placed OUTSIDE migrations/sql/ so the migration
-- runner does NOT execute it automatically. It is DESTRUCTIVE and irreversible.
--
-- ⚠️ DO NOT RUN until ALL of the following are true:
--   1. You have a fresh database backup.
--   2. You have trimmed the matching `CREATE TABLE IF NOT EXISTS ...` blocks
--      out of server/src/db.ts AND the `credits`/`total_credits_used` setup in
--      server/src/index.ts → initializeDatabase(). Otherwise the server will
--      simply RE-CREATE these tables/columns on the next startup and this drop
--      will have no lasting effect.
--   3. You have confirmed nothing you still use references them.
--
-- The course platform works fine WITHOUT running this — the tables below are
-- dormant (unused) after the code removal. This script is only for operators
-- who want a clean schema.
-- ============================================================================

BEGIN;

-- Scheduler / content-history pipeline
DROP TABLE IF EXISTS scheduler_activity_logs CASCADE;
DROP TABLE IF EXISTS content_history CASCADE;
DROP TABLE IF EXISTS channel_prompt_drafts CASCADE;
DROP TABLE IF EXISTS time_presets CASCADE;

-- Prompt-direct
DROP TABLE IF EXISTS prompt_direct_tasks CASCADE;
DROP TABLE IF EXISTS prompt_direct_jobs CASCADE;

-- Viral templates
DROP TABLE IF EXISTS viral_template_tasks CASCADE;
DROP TABLE IF EXISTS viral_template_jobs CASCADE;
DROP TABLE IF EXISTS viral_custom_prompts CASCADE;
DROP TABLE IF EXISTS viral_templates CASCADE;

-- Idol templates
DROP TABLE IF EXISTS idol_template_tasks CASCADE;
DROP TABLE IF EXISTS idol_template_jobs CASCADE;
DROP TABLE IF EXISTS idol_custom_prompts CASCADE;
DROP TABLE IF EXISTS idol_image_gallery CASCADE;
DROP TABLE IF EXISTS idol_templates CASCADE;

-- Credit system (only if you also remove credits from index.ts/db.ts + auth.ts)
DROP TABLE IF EXISTS credit_purchases CASCADE;
DROP TABLE IF EXISTS credit_transactions CASCADE;
-- ALTER TABLE users DROP COLUMN IF EXISTS credits;
-- ALTER TABLE users DROP COLUMN IF EXISTS total_credits_used;

COMMIT;
