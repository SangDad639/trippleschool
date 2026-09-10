-- 068: ปกคอร์สที่แอดมินตั้งเอง — ทับ "ปกอัตโนมัติจากคลิปล่าสุด" (route GET /api/courses/:id/cover)
--   cover_url    = proxy URL ของไฟล์ที่อัป (/api/courses/thumbnails/course-cover/{id}-{rand}.{ext}) · NULL = ใช้ปกอัตโนมัติ
--   cover_set_at = เวลาที่ตั้ง/ล้างปกล่าสุด → รวมใน cover_rev ให้ FE bust แคชได้ทันที (ชนิด TIMESTAMP เดียวกับ lessons.created_at)
-- ไม่ backfill จาก thumbnail_url (23 คอร์สมีค่าเก่าค้างตั้งแต่ก่อน 31 ส.ค. — thumbnail_url ยังเป็น "ปกสำรอง" เมื่อไม่มีวิดีโอ)
-- Idempotent (DB local = prod แชร์กัน)
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_set_at TIMESTAMP;
