-- 051: หมวดหมู่กลาง 2 ภาษา สำหรับหมวดในคอร์ส
--
-- เดิม course_sections.title เป็นช่องพิมพ์อิสระ แต่ละคอร์สพิมพ์กันเอง เลยได้ชื่อ
-- กระจัดกระจาย (พื้นฐาน/บทเรียน/ตัวอย่าง/โบนัส/How to) เรื่องเดียวกันสะกดคนละแบบ
-- (สร้างวิดิโอ vs สร้างวิดีโอ) และเป็นไทยตายตัว สลับภาษาไม่ได้
--
-- เก็บ 2 ภาษาเป็นสองคอลัมน์ในแถวหมวดหมู่ (ไม่ใช่ผ่าน translations.ts) เพราะ
-- แอดมินเพิ่มหมวดหมู่เองตอนไหนก็ได้ ข้อความตายตัวใน bundle รองรับไม่ได้
--
-- title ยังอยู่ กลายเป็น "ชื่อที่แสดงเอง" ทับหมวดหมู่ได้ — จำเป็น เพราะมีหมวดชื่อ
-- เฉพาะกิจอีกหลายสิบอันที่ไม่เข้าหมวดหมู่กลางไหนเลย

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name_en VARCHAR(60) NOT NULL,
  name_th VARCHAR(60) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- กันชื่อซ้ำแบบไม่สนตัวพิมพ์ (Basics กับ basics ถือว่าอันเดียวกัน)
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_en_key ON categories(LOWER(name_en));

ALTER TABLE course_sections ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_course_sections_category ON course_sections(category_id);

-- ชุดตั้งต้น 8 หมวด — รันซ้ำไม่เพิ่มซ้ำ และไม่ทับชื่อที่แอดมินแก้ไปแล้ว
INSERT INTO categories (name_en, name_th, display_order) VALUES
  ('Basics',                'พื้นฐาน',            1),
  ('Text & Language',       'ข้อความและภาษา',      2),
  ('Video Generation',      'สร้างวิดีโอ',          3),
  ('Audio & Music',         'เสียงและดนตรี',        4),
  ('Voice & Speech',        'เสียงพูด',            5),
  ('Coding & Development',  'เขียนโค้ดและพัฒนา',    6),
  ('Automation',            'ระบบอัตโนมัติ',        7),
  ('Agents & Assistants',   'เอเจนต์และผู้ช่วย',     8)
ON CONFLICT DO NOTHING;

-- Backfill แบบอนุรักษ์นิยม: ผูกเฉพาะหมวดที่ชื่อ "ตรงเป๊ะ" กับหมวดหมู่กลาง
-- ที่เหลือปล่อยไว้ ไม่เดาให้ แอดมินค่อยไล่เลือกเองใน UI
DO $$
DECLARE n INTEGER;
BEGIN
  UPDATE course_sections s
  SET category_id = c.id
  FROM categories c
  WHERE s.category_id IS NULL
    AND s.title IS NOT NULL
    AND (LOWER(TRIM(s.title)) = LOWER(c.name_en) OR TRIM(s.title) = c.name_th);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '051: ผูกหมวดหมู่ให้หมวดเดิมที่ชื่อตรงกัน % หมวด (ที่เหลือคงชื่อเดิมไว้)', n;
END $$;
