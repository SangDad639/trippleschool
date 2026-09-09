-- 067: โค้ดผู้แนะนำกำหนดเอง (custom refcode) — ผู้ใช้เปลี่ยน users.refcode เป็นโค้ดของตัวเองได้ (เปลี่ยนได้ไม่จำกัด, โค้ดเก่าใช้ไม่ได้ทันที)
-- Idempotent ทุกคำสั่ง (DB local = prod แชร์กัน) · ห้าม CONCURRENTLY (runner ครอบ BEGIN/COMMIT)

-- (1) unique แบบไม่สนตัวพิมพ์ + functional index ให้ทุก lookup ที่ใช้ LOWER(refcode)
--     UNIQUE เดิม (db.ts boot block) เป็น case-sensitive คงไว้ — ทุก write ต้องเก็บ lowercase อยู่แล้ว
CREATE UNIQUE INDEX IF NOT EXISTS users_refcode_lower_key
  ON users (LOWER(refcode)) WHERE refcode IS NOT NULL;

-- (2) โค้ดที่ถูกใช้ต้องรู้เสมอว่าเป็นของ user ไหน — เดิมเก็บแค่สตริงโค้ด พอเจ้าของเปลี่ยนโค้ด สตริงเก่าจะชี้ใครไม่ได้อีก
--     snapshot id ผู้แนะนำตอน checkout ทั้งออเดอร์คอร์สและ log สมัครสมาชิก · approve คอร์สใช้ id นี้ ไม่ resolve สตริง
ALTER TABLE course_enrollments
  ADD COLUMN IF NOT EXISTS referrer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE subscription_extension_logs
  ADD COLUMN IF NOT EXISTS referrer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- backfill แถวเก่าทุกสถานะที่มีโค้ด — ณ ตอน migrate สตริงยังแมปเจ้าของถูก (ยังไม่มีใครเปลี่ยนโค้ด) รันซ้ำได้ (guard IS NULL)
UPDATE course_enrollments e SET referrer_user_id = u.id
  FROM users u
 WHERE e.referrer_user_id IS NULL AND e.refcode IS NOT NULL
   AND LOWER(u.refcode) = LOWER(e.refcode) AND u.id <> e.user_id;
UPDATE subscription_extension_logs l SET referrer_user_id = u.id
  FROM users u
 WHERE l.referrer_user_id IS NULL AND l.refcode IS NOT NULL
   AND LOWER(u.refcode) = LOWER(l.refcode) AND u.id <> l.user_id;

CREATE INDEX IF NOT EXISTS idx_enrollments_referrer
  ON course_enrollments (referrer_user_id) WHERE referrer_user_id IS NOT NULL;

-- (3) audit การเปลี่ยนโค้ด — support ไล่ย้อนได้ว่าใครถือโค้ดอะไรช่วงไหน (ตัวเองหรือแอดมินเปลี่ยน)
CREATE TABLE IF NOT EXISTS refcode_changes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_refcode VARCHAR(20),
  new_refcode VARCHAR(20) NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refcode_changes_user ON refcode_changes (user_id, changed_at DESC);
