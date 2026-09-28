-- 075: คลิปคู่มือของโปรแกรม (/programs/:slug) — ให้แอดมินใส่เองได้ที่ /admin/programs
--   เดิมลิงก์วิดีโอฝังอยู่ใน src/components/programs/programsData.ts (videoUrl จาก env var)
--   → จะเปลี่ยนคลิปต้อง commit + build ใหม่ทุกครั้ง และหน้าเว็บเลยค้าง "วิดีโอตัวอย่างเร็วๆ นี้"
--   ตัวโปรแกรม (ชื่อ ฟีเจอร์ ปุ่มดาวน์โหลด) ยังอยู่ใน programsData.ts เหมือนเดิม — ตารางนี้ผูกด้วย slug เท่านั้น
--   ไม่มี FK เพราะโปรแกรมไม่ได้อยู่ใน DB
-- กติกา: additive-only (DB แชร์กับ prod) · idempotent
CREATE TABLE IF NOT EXISTS program_videos (
  id SERIAL PRIMARY KEY,
  program_slug VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_program_videos_slug ON program_videos(program_slug, display_order);
