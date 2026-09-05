-- 057: ตัวอย่างผลงานบนหน้า Ebook (แกลเลอรีรูป/คลิป YouTube แนวนอน-แนวตั้ง)
-- โครง JSONB เดียวกับ courses.samples (migration 055) — ใช้ SamplesEditor ตัวเดียวกัน
ALTER TABLE ebooks ADD COLUMN IF NOT EXISTS samples JSONB NOT NULL DEFAULT '[]'::jsonb;
