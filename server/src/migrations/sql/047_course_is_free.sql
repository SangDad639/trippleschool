-- 047: คอร์สฟรี = flag ชัดเจน ไม่ผูกกับราคา (เดิมใช้ price=0 เป็นเกณฑ์ — เปราะ:
-- admin ตั้ง discount เหลือ 0 แล้วป้ายบอกฟรีแต่บทล็อก) — admin ติ๊กตอนสร้าง/แก้ course+tip
-- is_free = true → ทุกบทดูได้ไม่ต้อง login (เท่ากับ is_preview ทั้งคอร์ส)
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;

-- backfill: คอร์สที่ฟรีตามเกณฑ์เก่า (price=0 — ปัจจุบันคือ id 22 คู่มือ Triple bot + 23 tip ตุ๊กแก)
UPDATE courses SET is_free = true WHERE price = 0 AND is_free = false;
