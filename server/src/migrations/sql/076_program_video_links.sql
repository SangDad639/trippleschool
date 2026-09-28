-- 076: ปุ่มลิงก์คู่มือใต้คลิปของโปรแกรม (user ขอ 28 ก.ย. 2026 — "ใส่ลิงก์คู่มือไปให้ด้วย")
--   [{"label":"คู่มือการติดตั้ง","url":"https://..."}] ต่อคลิป · แบบเดียวกับ guide_clips.links
--   JSONB (ไม่แยกตาราง) เพราะอ่าน/เขียนพร้อมคลิปเสมอ ไม่เคย query แยก
-- กติกา: additive-only (DB แชร์กับ prod ที่อาจยังรันโค้ดเก่า — โค้ดเก่าไม่แตะคอลัมน์นี้) · idempotent
ALTER TABLE program_videos ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb;
