-- 058: ลิงก์สั้นประจำ Ebook — https://www.triple-school.com/ebooks/{share_code}
-- แบบเดียวกับคอร์ส (048): slug ไทยถูก generator ตัดจนดูไม่น่าเชื่อถือเวลาแชร์
-- → ทุกเล่มมีรหัสสั้นของตัวเอง (slug เดิมยังเปิดได้ปกติ ลิงก์เก่าไม่พัง)

ALTER TABLE ebooks ADD COLUMN IF NOT EXISTS share_code VARCHAR(12);

CREATE UNIQUE INDEX IF NOT EXISTS ebooks_share_code_key
  ON ebooks(share_code) WHERE share_code IS NOT NULL;

-- backfill: เติมเฉพาะแถวที่ยังว่าง (รันซ้ำแล้วรหัสเดิมไม่เปลี่ยน)
-- ชุดอักขระตัด 0/o/1/l/i ที่อ่าน/พิมพ์สับสน · ตัวแรกเป็นตัวอักษรเสมอ
DO $$
DECLARE
  r RECORD;
  code TEXT;
  letters TEXT := 'abcdefghjkmnpqrstuvwxyz';
  chars   TEXT := 'abcdefghjkmnpqrstuvwxyz23456789';
  i INT;
BEGIN
  FOR r IN SELECT id FROM ebooks WHERE share_code IS NULL LOOP
    LOOP
      code := substr(letters, 1 + floor(random() * length(letters))::int, 1);
      FOR i IN 1..5 LOOP
        code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM ebooks WHERE share_code = code OR slug = code);
    END LOOP;
    UPDATE ebooks SET share_code = code WHERE id = r.id;
  END LOOP;
END $$;
