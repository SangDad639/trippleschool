-- 072: "บทในคลิป" (chapters) ของบทเรียน — เพิ่มคอลัมน์อย่างเดียว (DB local = prod แชร์กัน ห้าม DROP/RENAME) · idempotent
--   lessons.chapters            JSONB [{sec:int, title:string}] เรียงตาม sec · NULL = ยังไม่มี
--   lessons.chapters_source     'manual' (แอดมินแก้เอง) | 'youtube' (timestamp ในคำอธิบายคลิป) | 'ai' (สรุปจากซับ)
--   lesson_subtitles.segments   JSONB [{t:sec, d:sec, text}] ซับแบบมีเวลาจาก YouTube (content เดิม = ข้อความล้วนของผู้ช่วยประจำคอร์ส คงไว้)
--   lesson_subtitles.description คำอธิบายคลิปจาก YouTube (ไว้ parse timestamp เผื่ออนาคต)
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS chapters JSONB;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS chapters_source VARCHAR(16);
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS chapters_updated_at TIMESTAMPTZ;
ALTER TABLE lesson_subtitles ADD COLUMN IF NOT EXISTS segments JSONB;
ALTER TABLE lesson_subtitles ADD COLUMN IF NOT EXISTS segments_fetched_at TIMESTAMPTZ;
ALTER TABLE lesson_subtitles ADD COLUMN IF NOT EXISTS description TEXT;
