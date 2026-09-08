-- 064: ตั้งเวลาเปลี่ยนราคาแพ็กเกจ (docs/PLAN-SCHEDULED-PRICE-CHANGE.md) · idempotent · DB local = prod แชร์กัน
--   กติกา: subscription_plans.subtotal คือราคาจริงเสมอ — แถวในตารางนี้จะถูก "materialize" ลงคอลัมน์นั้น
--   ตอนอ่านครั้งแรกหลัง effective_at (plansService.applyDueSchedules, atomic ข้าม replica ด้วย FOR UPDATE SKIP LOCKED)
--   ไม่มีช่วงรับราคาเก่า (user เคาะ 8 ก.ย. 2026) — ถึงเวลาแล้วรับเฉพาะราคาใหม่ทันที
CREATE TABLE IF NOT EXISTS subscription_plan_price_schedules (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),   -- ราคาใหม่ก่อน VAT
  effective_at TIMESTAMPTZ NOT NULL,                        -- เวลามีผล (เก็บ UTC, แอดมินกรอกเป็นเวลาไทย)
  note TEXT,
  previous_subtotal NUMERIC(10,2),                          -- snapshot ราคาก่อนหน้า ณ ตอน materialize (audit)
  applied_at TIMESTAMPTZ,                                   -- materialize ลง subscription_plans แล้วเมื่อไร
  cancelled_at TIMESTAMPTZ,
  cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_price_schedules_plan_eff
  ON subscription_plan_price_schedules(plan_id, effective_at DESC);

-- กัน 2 รายการเวลาเดียวกันของแพ็กเกจเดียว (เช็คระดับแอปอย่างเดียว race ได้) — ที่ยกเลิกแล้วไม่นับ
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_price_schedules_live
  ON subscription_plan_price_schedules(plan_id, effective_at)
  WHERE cancelled_at IS NULL;
