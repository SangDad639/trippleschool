-- 069: โค้ดส่วนลดของแอดมิน (admin_codes) — ลดราคาเท่าโค้ดผู้แนะนำ (affiliate_settings.refcode_discount_percent)
--   · ไม่ผูก referrer / ไม่สร้างค่าคอม · ผูกกับบทเรียน (Video) หรือคอร์ส เพื่อเก็บ funnel ว่าลูกค้าเจอเราจากคลิปไหน
--   · ไม่มีวันหมดอายุ/จำกัดครั้ง แค่เปิด/ปิดใช้งาน (user เคาะ 10 ก.ย. 2026)
-- โค้ดเก็บ lowercase เสมอ และห้ามชนกับ users.refcode (ตรวจใน service ทั้งสองทาง)
-- Idempotent (DB local = prod แชร์กัน) · ไม่แตะซาก coupon_codes (012/015)
CREATE TABLE IF NOT EXISTS admin_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL,
  label VARCHAR(255),
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_codes_code_lower_key ON admin_codes (LOWER(code));

-- snapshot ว่าออเดอร์ไหนใช้โค้ดแอดมินตัวไหน (funnel) — สตริงโค้ดยังเก็บในคอลัมน์ refcode เดิมเพื่อการแสดงผล
ALTER TABLE course_enrollments
  ADD COLUMN IF NOT EXISTS admin_code_id INTEGER REFERENCES admin_codes(id) ON DELETE SET NULL;
ALTER TABLE subscription_extension_logs
  ADD COLUMN IF NOT EXISTS admin_code_id INTEGER REFERENCES admin_codes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_enrollments_admin_code
  ON course_enrollments (admin_code_id) WHERE admin_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ext_logs_admin_code
  ON subscription_extension_logs (admin_code_id) WHERE admin_code_id IS NOT NULL;
