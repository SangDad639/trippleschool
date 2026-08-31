-- 048: ลิงก์สั้นประจำคอร์ส — https://www.triple-school.com/courses/{share_code}
-- slug ปัจจุบันมาจาก generator ที่ตัดอักษรไทยทิ้งจนเหลือขีดค้าง (-chatgpt-, gemini-)
-- แชร์ออกไปแล้วดูไม่น่าเชื่อถือ → ให้ทุกคอร์ส/ทิปมีรหัสสั้นอ่านง่ายของตัวเอง
-- (slug เดิมยังเปิดได้ตามปกติ — ลิงก์ที่แชร์ไปแล้วไม่พัง)

ALTER TABLE courses ADD COLUMN IF NOT EXISTS share_code VARCHAR(12);

CREATE UNIQUE INDEX IF NOT EXISTS courses_share_code_key
  ON courses(share_code) WHERE share_code IS NOT NULL;

-- backfill: เติมเฉพาะแถวที่ยังว่าง (รันซ้ำแล้วรหัสเดิมไม่เปลี่ยน)
-- ชุดอักขระตัด 0/o/1/l/i ที่อ่าน/พิมพ์สับสน · ตัวแรกเป็นตัวอักษรเสมอ
-- (กันรหัสที่เป็นตัวเลขล้วนไปชนกับ route ที่รับ course id)
DO $$
DECLARE
  r RECORD;
  code TEXT;
  letters TEXT := 'abcdefghjkmnpqrstuvwxyz';
  chars   TEXT := 'abcdefghjkmnpqrstuvwxyz23456789';
  i INT;
BEGIN
  FOR r IN SELECT id FROM courses WHERE share_code IS NULL LOOP
    LOOP
      code := substr(letters, 1 + floor(random() * length(letters))::int, 1);
      FOR i IN 1..5 LOOP
        code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM courses WHERE share_code = code OR slug = code);
    END LOOP;
    UPDATE courses SET share_code = code WHERE id = r.id;
  END LOOP;
END $$;
