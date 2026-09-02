-- 052: ย้ายหมวดเดิมของคอร์สทั้งหมดเข้าถังหมวดหมู่กลาง
--
-- กติกา: ห้ามยุบรวม ทุกชื่อต้องอยู่ครบเป๊ะ ไม่ match 100% ห้ามเอาไปรวมกัน
-- จึงไม่แมปชื่อเดิมเข้าหมวดหมู่กว้างๆ (เช่นไม่เอา "โบนัสพิเศษ" ไปยัดรวมกับ "โบนัส")
-- แต่ยกทุกชื่อขึ้นเป็นหมวดหมู่กลางของตัวเอง แล้วผูกด้วยชื่อที่ตรงกัน 100% เท่านั้น
--
-- ชื่อไทยคัดลอกมาเป๊ะทุกตัวอักษร รวมที่พิมพ์ตกอย่าง "สรา้ง" และ "อัพเดพ" — ไม่แก้คำให้
-- เพราะเป็นชื่อที่ผู้เรียนเห็นอยู่จริง แก้เองได้ทีหลังที่ 📂 จัดการหมวดหมู่

-- ชื่อเดิมยาวสุด 74 ตัวอักษร แต่คอลัมน์เดิมรับได้ 60
ALTER TABLE categories ALTER COLUMN name_en TYPE VARCHAR(120);
ALTER TABLE categories ALTER COLUMN name_th TYPE VARCHAR(120);

INSERT INTO categories (name_en, name_th, display_order)
SELECT v.en, v.th, 8 + v.ord
FROM (VALUES
  ('Lessons',                                          'บทเรียน',                                                                     1),
  ('Basic Lessons',                                    'บทเรียนพื้นฐาน',                                                               2),
  ('Introduction',                                     'บทนำ',                                                                       3),
  ('Examples',                                         'ตัวอย่าง',                                                                    4),
  ('Bonus',                                            'โบนัส',                                                                      5),
  ('Special Bonus',                                    'โบนัสพิเศษ',                                                                  6),
  ('How to',                                           'How to',                                                                    7),
  ('Masterclass',                                      'Masterclass',                                                               8),
  ('Gemini Advanced',                                  'Gemini Advanced',                                                           9),
  ('Sign Up',                                          'สมัครใช้งาน',                                                                10),
  ('Sign Up for the Program',                          'สมัครใช้งานโปรแกรม',                                                          11),
  ('Using the Program',                                'การใช้งานโปรแกรม',                                                            12),
  ('Create Videos',                                    'สร้างวิดิโอ',                                                                 13),
  ('Latest Updates',                                   'อัพเดทล่าสุด',                                                                14),
  ('ChatGPT 2026 Update',                              'อัพเดพ Chat GPT ปี 2026',                                                    15),
  ('Product Sales Videos with ChatGPT',                'สร้างวิดิโอขายสินค้าด้วย Chat GPT',                                             16),
  ('Sales Clips with Google Flow',                     'สร้างคลิปขายด้วย google flow',                                                17),
  ('Sales Clips with Gemini',                          'สรา้งคลิปขายด้วย GEMINI',                                                     18),
  ('Guide: House Review Clips with AI',                'ชุดคู่มือสร้างคลิปรีวิวบ้านด้วย Ai',                                              19),
  ('Guide: Land Presentation Clips (All Steps)',       'ชุดคู่มือการสร้างคลิปนำเสนอที่ดิน (ครบทุกขั้นตอน)',                                  20),
  ('Guide: Absurd Vegetable / Fruit Comedy AI Clips',  'คู่มือการทำคลิปแนว Absurd Vegetable / Fruit Comedy AI (ทำไมลูกฉันเป็นเห็ด)',       21),
  ('House Review Clips from Real Photos with AI',      'หมวดสร้างคลิปรีวิวบ้านจากภาพจริงด้วย AI',                                        22),
  ('Real Estate Educational Clips with AI',            'หมวดสร้างคลิปให้ความรู้เรื่องอสังหาด้วย AI',                                       23),
  ('Land Clip Techniques with AI',                     'เทคนิคการสร้างคลิปเกี่ยวกับที่ดินด้วย AI',                                        24)
) AS v(en, th, ord)
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE LOWER(c.name_en) = LOWER(v.en));

DO $$
DECLARE
  r RECORD;
  n_link INTEGER := 0;
  n_skip INTEGER := 0;
BEGIN
  FOR r IN
    -- ตรง 100% เท่านั้น ไม่มี fuzzy — ไทยเทียบตรงตัว อังกฤษไม่สนตัวพิมพ์เล็กใหญ่
    SELECT s.id, s.course_id, c.id AS cat_id, c.name_th
    FROM course_sections s
    JOIN categories c
      ON TRIM(s.title) = c.name_th OR LOWER(TRIM(s.title)) = LOWER(c.name_en)
    WHERE s.category_id IS NULL AND s.is_active = true
    ORDER BY s.id
  LOOP
    -- กันกล่องชื่อเดียวกันซ้อนกันในคอร์สเดียว (ข้อมูลตอนนี้ไม่มีเคสนี้ แต่กันอนาคตไว้)
    IF EXISTS (
      SELECT 1 FROM course_sections x
      WHERE x.course_id = r.course_id AND x.category_id = r.cat_id AND x.id <> r.id AND x.is_active = true
    ) THEN
      n_skip := n_skip + 1;
      RAISE NOTICE 'ข้าม section id=% (คอร์ส % มีหมวดหมู่ "%" อยู่แล้ว) — คงชื่อเดิมไว้', r.id, r.course_id, r.name_th;
      CONTINUE;
    END IF;
    UPDATE course_sections SET category_id = r.cat_id WHERE id = r.id;
    n_link := n_link + 1;
  END LOOP;

  RAISE NOTICE '052 เสร็จ: ผูกหมวดหมู่ให้กล่องเดิม % กล่อง, ข้าม % กล่อง', n_link, n_skip;
END $$;
