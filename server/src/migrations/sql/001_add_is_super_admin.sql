-- Migration 001: Add is_super_admin column + promote master admin
--
-- Super admins มีสิทธิ์เหนือกว่า admin ปกติ:
--   - ใช้ bypass code +30d / +365d (skip Thunder slip verification)
--   - ใช้ "Adjust days" menu
--   - ใช้ /reduce endpoint
--
-- Idempotent: รันซ้ำได้ด้วย IF NOT EXISTS + idempotent UPDATE

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

UPDATE users
SET is_super_admin = true
WHERE LOWER(email) = LOWER('123456789123456789ori@gmail.com');
