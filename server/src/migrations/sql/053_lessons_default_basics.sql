-- 053: บทเรียนต้องมีหมวดเสมอ — ตัวไหนยังไม่มีให้ลงหมวดหมู่ "พื้นฐาน" (Basics)
--
-- UI ถอดตัวเลือก "ไม่จัดหมวด" ออกแล้ว บทเรียนจึงไม่ควรมีตัวไหนลอยอยู่นอกหมวดอีก
-- ไมเกรชันนี้เก็บกวาดของที่ค้างอยู่ (ถ้ามี) และเป็นตาข่ายรับกรณีข้อมูลจากที่อื่น
--
-- 050 เคยทำงานคล้ายกันแต่เล็งที่หมวด "ชื่อพื้นฐาน" ตอนนั้นยังไม่มีระบบหมวดหมู่กลาง
-- รอบนี้เล็งที่ "หมวดหมู่ Basics" ซึ่งเป็นของจริงที่ใช้กันทั้งระบบแล้ว

DO $$
DECLARE
  basics_id INTEGER;
  r RECORD;
  sid INTEGER;
  n_section INTEGER := 0;
  n_lesson INTEGER := 0;
  moved INTEGER;
BEGIN
  SELECT id INTO basics_id FROM categories WHERE name_en = 'Basics';
  IF basics_id IS NULL THEN
    RAISE NOTICE '053 ข้าม: ไม่พบหมวดหมู่ Basics';
    RETURN;
  END IF;

  FOR r IN
    SELECT DISTINCT course_id FROM lessons WHERE section_id IS NULL ORDER BY course_id
  LOOP
    -- คอร์สนี้มีกล่องที่ผูก Basics อยู่แล้วก็ใช้ตัวเดิม
    SELECT id INTO sid FROM course_sections
    WHERE course_id = r.course_id AND category_id = basics_id AND is_active = true
    ORDER BY id LIMIT 1;

    IF sid IS NULL THEN
      INSERT INTO course_sections (course_id, title, section_order, mode, category_id)
      VALUES (
        r.course_id,
        (SELECT name_th FROM categories WHERE id = basics_id),  -- สำเนาสำรองของชื่อ
        (SELECT COALESCE(MAX(section_order), -1) + 1 FROM course_sections WHERE course_id = r.course_id),
        'basic', basics_id
      )
      RETURNING id INTO sid;
      n_section := n_section + 1;
    END IF;

    UPDATE lessons SET section_id = sid WHERE course_id = r.course_id AND section_id IS NULL;
    GET DIAGNOSTICS moved = ROW_COUNT;
    n_lesson := n_lesson + moved;
    RAISE NOTICE 'course id=% → ย้าย % บทเข้าหมวดหมู่ Basics (section id=%)', r.course_id, moved, sid;
  END LOOP;

  RAISE NOTICE '053 เสร็จ: สร้างหมวดใหม่ % หมวด, ย้ายบทเรียน % บท', n_section, n_lesson;
END $$;
