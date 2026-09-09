-- 065: โฆษณาแทรกแบบ YouTube ในวิดีโอบทเรียน (pre-roll + mid-roll) · idempotent · DB local = prod แชร์กัน
--   promo_videos  = คลังโฆษณา (ไฟล์วิดีโอของเราเองบน S3 ใต้ promo-videos/… เสิร์ฟผ่าน /api/promos/:id/video ที่รองรับ HTTP Range)
--   lesson_promos = จุดแทรกต่อบทเรียน: offset_sec 0 = ก่อนเริ่ม (pre-roll), ≥ 5 = กลางคลิป (mid-roll) วินาทีที่แอดมินกำหนด
--   ชื่อใช้ "promo" ไม่ใช่ "ad" — filter list ของ adblock บล็อก path /ads/ และซ่อน class ad*
--   กติกา (user เคาะ 8 ก.ย. 2026): ทุกคนที่ดูบทเห็นโฆษณา · ข้ามได้หลัง 5 วิ (ตั้งต่อโฆษณาได้) · กด ▶ ก่อน · ครั้งเดียวต่อบทต่อแท็บ
CREATE TABLE IF NOT EXISTS promo_videos (
  id             SERIAL PRIMARY KEY,
  title          VARCHAR(255) NOT NULL,
  source_type    VARCHAR(10)  NOT NULL DEFAULT 'youtube' CHECK (source_type IN ('youtube', 'file')),  -- คลิป YouTube (หลัก) หรือไฟล์ที่อัปโหลด
  youtube_id     VARCHAR(50),                                -- source_type = 'youtube' (เช่น aY7GY9rgWSY)
  video_key      TEXT,                                       -- source_type = 'file': S3 key (promo-videos/<ts>-<rand>.mp4) — ไม่ส่งออกให้ client
  content_type   VARCHAR(50)  NOT NULL DEFAULT 'video/mp4',
  size_bytes     BIGINT,                                     -- ใช้ตอบ Content-Length/Content-Range โดยไม่ต้อง HEAD S3 ทุกครั้ง
  duration_sec   INTEGER,                                    -- อ่านจาก <video>.duration ฝั่งแอดมิน (NULL = ไม่ทราบ)
  poster_url     TEXT,                                       -- ปกก่อนเล่น (ไม่บังคับ)
  click_url      TEXT,                                       -- ปุ่ม "ดูรายละเอียด" (ไม่บังคับ, http/https)
  skip_after_sec INTEGER DEFAULT 5
                 CHECK (skip_after_sec IS NULL OR (skip_after_sec >= 0 AND skip_after_sec <= 120)),  -- NULL = ห้ามข้าม, 0 = ข้ามได้ทันที
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((source_type = 'youtube' AND youtube_id IS NOT NULL) OR (source_type = 'file' AND video_key IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_promo_videos_active ON promo_videos(is_active, id DESC);

CREATE TABLE IF NOT EXISTS lesson_promos (
  id         SERIAL PRIMARY KEY,
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  promo_id   INTEGER NOT NULL REFERENCES promo_videos(id) ON DELETE CASCADE,   -- ลบโฆษณา = จุดแทรกหาย บทเรียนอยู่
  offset_sec INTEGER NOT NULL DEFAULT 0 CHECK (offset_sec = 0 OR offset_sec >= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_id, offset_sec)
);
CREATE INDEX IF NOT EXISTS idx_lesson_promos_lesson ON lesson_promos(lesson_id, offset_sec);
CREATE INDEX IF NOT EXISTS idx_lesson_promos_promo ON lesson_promos(promo_id);
