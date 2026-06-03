-- Migration 011: Optional ID card upload for affiliate recipient verification
--
-- User upload สำเนาบัตรประชาชนได้ที่หน้า /profile (ไม่บังคับ — admin ตรวจสอบ
-- เองตอน review pending payout). ไฟล์ private, admin ดูผ่าน signed URL (1h TTL).
--
-- Use cases:
--   • Verify identity (กันบัญชี fake / ใช้ชื่อผู้อื่น)
--   • Tax audit หลักฐานพิสูจน์ผู้รับเงินจริง ตรงกับชื่อใน ภงด.3/53
--
-- Storage strategy — fixed key per user:
--   `identity/{user_id}/id-card` (no extension; Content-Type ใน object metadata)
-- → upload ใหม่ทับ object เก่าโดยอัตโนมัติ (S3/OBS same-key overwrite).
-- → DB เก็บ key เดียวกันตลอด (`id_card_url`), แต่ `id_card_uploaded_at` จะ
--    เปลี่ยนทุกครั้งเพื่อให้ FE/admin รู้ว่ามี version ใหม่.

ALTER TABLE user_bank_accounts
  ADD COLUMN IF NOT EXISTS id_card_url          TEXT,
  ADD COLUMN IF NOT EXISTS id_card_uploaded_at  TIMESTAMP;
