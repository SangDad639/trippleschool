-- 049: แยกถัง tag เป็นของคอร์ส กับ ของทิป
--
-- เดิมใช้ตาราง tags ใบเดียวปนกัน แล้วชื่อย่อของทิปไปเก็บเป็นข้อความอิสระใน
-- courses.tag_name (พิมพ์เอง ใช้ซ้ำไม่ได้ พิมพ์ผิดก็ไม่มีใครรู้)
--
-- หลังไมเกรชัน:
--   tags.kind = 'course' → ชื่อย่อของคอร์ส (ขึ้นเมนู Course) และเป็นกุญแจให้ทิปมาเกาะ
--   tags.kind = 'tip'    → ชื่อย่อของทิปเอง (ขึ้นเมนู Tip + ชื่อแท็บในหน้าคอร์ส)
--   courses.tag_id     → คอร์ส: tag ของตัวเอง · ทิป: Link Tag Course (เกาะคอร์สไหน)
--   courses.tip_tag_id → ทิป: ชื่อย่อของตัวเอง (คอร์สต้องเป็น NULL เสมอ)

ALTER TABLE tags ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'course';

-- tag ที่มีอยู่เดิมทั้งหมดเป็นชื่อคอร์ส → default 'course' ถูกอยู่แล้ว
-- ย้าย unique จาก (name) เป็น (kind, name): ชื่อซ้ำข้ามถังได้ (เช่นมี "FLUX 3"
-- ทั้งถังคอร์สและถังทิป) แต่ซ้ำภายในถังเดียวกันไม่ได้
ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS tags_kind_name_key ON tags(kind, name);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS tip_tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_courses_tip_tag ON courses(tip_tag_id);

COMMENT ON COLUMN courses.tag_name IS
  'เลิกใช้แล้ว (049) — ชื่อย่อของทิปย้ายไปเป็น tip_tag_id → tags(kind=''tip''); เก็บคอลัมน์ไว้เผื่อย้อนดูข้อมูลเดิม';

DO $$
DECLARE
  r RECORD;
  tid INTEGER;
  n_tip INTEGER := 0;
  n_course INTEGER := 0;
BEGIN
  -- 1) ทิปที่เคยพิมพ์ชื่อย่อไว้ใน tag_name → สร้าง tag ถังทิปแล้วผูกให้
  FOR r IN
    SELECT id, TRIM(tag_name) AS nm FROM courses
    WHERE content_type = 'tip' AND tip_tag_id IS NULL
      AND tag_name IS NOT NULL AND TRIM(tag_name) <> ''
  LOOP
    SELECT id INTO tid FROM tags WHERE kind = 'tip' AND name = r.nm;
    IF tid IS NULL THEN
      INSERT INTO tags (name, kind) VALUES (r.nm, 'tip') RETURNING id INTO tid;
    END IF;
    UPDATE courses SET tip_tag_id = tid WHERE id = r.id;
    n_tip := n_tip + 1;
    RAISE NOTICE 'tip id=% → tag ถังทิป "%" (id=%)', r.id, r.nm, tid;
  END LOOP;

  -- 2) คอร์สที่เผลอพิมพ์ชื่อย่อลง tag_name แทนที่จะ "เลือก" tag ทำให้ tag_id ว่าง
  --    → หา/สร้าง tag ถังคอร์สชื่อนั้นแล้วผูกให้ (ทิปที่ link tag นี้ไว้จะเกาะติดทันที)
  FOR r IN
    SELECT id, TRIM(tag_name) AS nm FROM courses
    WHERE content_type <> 'tip' AND tag_id IS NULL
      AND tag_name IS NOT NULL AND TRIM(tag_name) <> ''
  LOOP
    SELECT id INTO tid FROM tags WHERE kind = 'course' AND name = r.nm;
    IF tid IS NULL THEN
      INSERT INTO tags (name, kind) VALUES (r.nm, 'course') RETURNING id INTO tid;
    END IF;
    UPDATE courses SET tag_id = tid WHERE id = r.id;
    n_course := n_course + 1;
    RAISE NOTICE 'course id=% → tag ถังคอร์ส "%" (id=%)', r.id, r.nm, tid;
  END LOOP;

  -- คอร์สห้ามมีชื่อย่อของทิป (เผื่อมีข้อมูลหลุดมาจากรอบก่อน)
  UPDATE courses SET tip_tag_id = NULL WHERE content_type <> 'tip' AND tip_tag_id IS NOT NULL;

  RAISE NOTICE '049 เสร็จ: ผูก tag ให้ทิป % แถว, คอร์ส % แถว', n_tip, n_course;
END $$;
