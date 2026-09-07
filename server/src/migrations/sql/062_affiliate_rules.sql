-- 062: กติกา affiliate ทางการ (docs/AFFILIATE-SYSTEM.md §1 — P1) · idempotent · DB local = prod แชร์กัน
--   R2 ค่าคอม 15% คงที่ทุกคน เลิกใช้ tier → เก็บ % เดียวที่ affiliate_settings.commission_percent
--      (users.commission_percent / affiliate_tiers / user_package_commissions กลายเป็นซาก ไม่มีผลกับเงิน)
--   R8 ยกเลิก/คืนเงิน → ค่าคอมต้องยกเลิกได้: pending → cancelled · จ่ายแล้ว → clawback (ยอดหักคืนให้แอดมินตาม)
ALTER TABLE affiliate_settings
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) NOT NULL DEFAULT 15.00;

ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;
ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
-- RESTRICT เหมือน FK อื่นของตารางนี้ (061) — ประวัติเงินต้องไม่หายเพราะลบ user
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'affiliate_commissions' AND column_name = 'cancelled_by'
  ) THEN
    ALTER TABLE affiliate_commissions
      ADD COLUMN cancelled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- สถานะที่อนุญาต — ถอด CHECK เดิมของ status (ถ้ามี ชื่ออาจต่างกัน) แล้วใส่ชุดใหม่
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'affiliate_commissions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE affiliate_commissions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE affiliate_commissions
  ADD CONSTRAINT affiliate_commissions_status_check
    CHECK (status IN ('pending', 'transferred', 'cancelled', 'clawback'));

CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_status ON affiliate_commissions(status);
