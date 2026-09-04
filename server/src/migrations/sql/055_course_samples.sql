-- 055: ตัวอย่างผลงานของคอร์ส (แท็บ "ตัวอย่าง" ในหน้า Course Detail)
-- เก็บเป็น JSONB แบบเดียวกับ tools: [{type:'image'|'video'|'youtube', url?, youtube_id?,
-- orientation:'landscape'|'portrait', title}] — แนวนอน/แนวตั้งอ่านจากไฟล์ตอนอัปโหลด
ALTER TABLE courses ADD COLUMN IF NOT EXISTS samples JSONB NOT NULL DEFAULT '[]'::jsonb;
