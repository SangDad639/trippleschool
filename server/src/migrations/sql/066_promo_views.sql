-- 066: ความถี่โฆษณาแทรก — "1 โฆษณา แสดงต่อผู้เรียน 1 คน ได้ครั้งเดียวต่อ 7 วัน" (user เคาะ 9 ก.ย. 2026) · idempotent
--   ผู้เรียนที่ล็อกอิน: จำที่นี่ (ข้ามอุปกรณ์/เบราว์เซอร์) · ไม่ล็อกอิน: จำใน localStorage ของเบราว์เซอร์
--   แถวถูกอัปเดต (upsert) ทุกครั้งที่ดูโฆษณาจบ/ข้าม → last_seen_at + 7 วัน = เห็นได้อีกครั้ง
CREATE TABLE IF NOT EXISTS promo_views (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  promo_id     INTEGER NOT NULL REFERENCES promo_videos(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  view_count   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, promo_id)
);
CREATE INDEX IF NOT EXISTS idx_promo_views_user_seen ON promo_views(user_id, last_seen_at DESC);
