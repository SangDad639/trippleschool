-- 054: ลิงก์สั้นระดับบทเรียน — https://www.triple-school.com/app/courses/{share_code}
-- เปิดแล้วเด้งเข้าหน้าเรียนของบทนั้นทันที (สั้นกว่ารูปแบบเต็ม /app/courses/{slug}/learn/{id})
--
-- รหัสอยู่ "เนมสเปซเดียวกัน" กับรหัส/slug ของคอร์ส เพราะ /app/courses/{ref} ต้องเดาได้
-- ไม่กำกวมว่า ref เป็นบทเรียนหรือคอร์ส → ตอนสุ่มจึงกันชนทั้ง 3 อย่าง:
-- lessons.share_code · courses.share_code · courses.slug

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS share_code VARCHAR(12);

CREATE UNIQUE INDEX IF NOT EXISTS lessons_share_code_key
  ON lessons(share_code) WHERE share_code IS NOT NULL;

-- backfill: เติมเฉพาะแถวที่ยังว่าง (รันซ้ำรหัสเดิมไม่เปลี่ยน)
-- ชุดอักขระเดียวกับรหัสคอร์ส: ตัด 0/o/1/l/i · ตัวแรกเป็นตัวอักษรเสมอ
DO $$
DECLARE
  r RECORD;
  code TEXT;
  letters TEXT := 'abcdefghjkmnpqrstuvwxyz';
  chars   TEXT := 'abcdefghjkmnpqrstuvwxyz23456789';
  i INT;
  n INT := 0;
BEGIN
  FOR r IN SELECT id FROM lessons WHERE share_code IS NULL LOOP
    LOOP
      code := substr(letters, 1 + floor(random() * length(letters))::int, 1);
      FOR i IN 1..5 LOOP
        code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM lessons WHERE share_code = code)
        AND NOT EXISTS (SELECT 1 FROM courses WHERE share_code = code OR slug = code);
    END LOOP;
    UPDATE lessons SET share_code = code WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RAISE NOTICE '054 เสร็จ: แจกรหัสลิงก์สั้นให้บทเรียน % แถว', n;
END $$;
