-- 061: ซ่อม schema drift ของระบบ affiliate (P0 จาก docs/AFFILIATE-SYSTEM.md)
--   1) users.commission_percent / affiliate_settings.tier1_percent,tier2_percent เดิมถูกสร้างโดย
--      server/scripts/migrate-to-percent-commission.ts (รันมือ ไม่อยู่ใน runner) → DB ใหม่ไม่มีคอลัมน์
--      ทำให้ 005/016/045 พังและ migration ที่เหลือไม่ถูกรัน — ประกาศไว้ที่นี่ให้ idempotent
--   2) FK ของ affiliate_commissions เดิม ON DELETE CASCADE → ลบ user = ประวัติเงิน/ภาษีหาย
--      เปลี่ยนเป็น RESTRICT (ต้องจัดการค่าคอมก่อนถึงจะลบ user ได้)
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(10,2) DEFAULT 5.00;
ALTER TABLE affiliate_settings ADD COLUMN IF NOT EXISTS tier1_percent NUMERIC(10,2);
ALTER TABLE affiliate_settings ADD COLUMN IF NOT EXISTS tier2_percent NUMERIC(10,2);

DO $$
DECLARE
  c RECORD;
BEGIN
  -- ถอด FK ทุกตัวที่ชี้ออกจาก affiliate_commissions (ชื่ออาจต่างกันตาม DB ที่สร้าง) แล้วใส่ใหม่แบบ RESTRICT
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'affiliate_commissions'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE affiliate_commissions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE affiliate_commissions
  ADD CONSTRAINT affiliate_commissions_referrer_id_fkey
    FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT affiliate_commissions_referee_id_fkey
    FOREIGN KEY (referee_id) REFERENCES users(id) ON DELETE RESTRICT;
