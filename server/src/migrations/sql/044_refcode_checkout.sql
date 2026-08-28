-- 044: Affiliate refcode at checkout — โค้ดผู้แนะนำกรอกตอนชำระเงิน = ผู้ซื้อได้ส่วนลด + เจ้าของโค้ดได้ค่าคอม
-- ส่วนลดตั้งค่าได้ที่ affiliate_settings.refcode_discount_percent (default 5%)
-- ราคาที่จ่ายจริง (หลังหักส่วนลด) เก็บลง enrollment/extension log เพื่อใช้เป็นฐานค่าคอม

ALTER TABLE affiliate_settings
  ADD COLUMN IF NOT EXISTS refcode_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00;

ALTER TABLE course_enrollments
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS refcode VARCHAR(32);

ALTER TABLE subscription_extension_logs
  ADD COLUMN IF NOT EXISTS refcode VARCHAR(32);
