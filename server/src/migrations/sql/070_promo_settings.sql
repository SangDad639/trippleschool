-- 070: ตั้งค่าโฆษณาก่อนเริ่ม "ทุกคลิป" (user เคาะ 10 ก.ย. 2026)
--   · โฆษณาตัวเดียว (promo_id) เล่นก่อนเริ่มทุกบทที่มีวิดีโอ รวมบทที่สร้างทีหลัง — ไม่ต้องผูกรายบท (บทที่มี lesson_promos offset 0 ของตัวเองให้ของบทชนะ)
--   · cooldown_days = ผู้เรียน 1 คนเห็นโฆษณาซ้ำได้เมื่อครบ N วัน (0 = ทุกครั้ง) นับต่อผู้เรียน ไม่ใช่ต่อคลิป
--   · cycle_started_at = รอบปัจจุบัน: ประวัติ "เห็นแล้ว" (promo_views / localStorage) ที่เกิดก่อนเวลานี้ไม่นับ
--     แอดมินเปลี่ยนจำนวนวัน/เปลี่ยนโฆษณา/กดรีเซ็ต → NOW() = ทุกคนเห็นอีกครั้ง
-- Idempotent (DB local = prod แชร์กัน) · แถวเดียว id=1 · ไม่เปิดใช้ให้เอง (แอดมินกดเปิดในหน้า 🎬 โฆษณา)
CREATE TABLE IF NOT EXISTS promo_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  promo_id INTEGER REFERENCES promo_videos(id) ON DELETE SET NULL,
  cooldown_days INTEGER NOT NULL DEFAULT 7 CHECK (cooldown_days BETWEEN 0 AND 365),
  cycle_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO promo_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
