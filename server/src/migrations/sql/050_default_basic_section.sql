-- 050: บทเรียนที่ไม่ได้จัดหมวด → ย้ายเข้าหมวด "พื้นฐาน"
--
-- ช่อง "หมวดหมู่" ตอนเพิ่มบทเรียนตั้งต้นเป็น "ไม่จัดหมวด" ทำให้บทหลุดไปกองรวมกัน
-- นอกหมวด (หน้าเรียนยังเห็นอยู่ แต่จัดลำดับ/ย้ายทีหลังลำบาก) — เปลี่ยนค่าเริ่มต้นเป็น
-- "พื้นฐาน" แล้วเก็บกวาดของเดิมให้เข้าหมวดด้วย
--
-- ทำเฉพาะคอร์ส/ทิปที่ยังมีบทค้างนอกหมวดจริงเท่านั้น — ไม่ไปสร้างหมวดเปล่าให้คอร์ส
-- ที่จัดหมวดเรียบร้อยอยู่แล้ว · หมวดใหม่ต่อท้ายหมวดเดิม (ลำดับเดิมบนหน้าจอไม่เปลี่ยน
-- เพราะบทนอกหมวดถูกเรนเดอร์ต่อท้ายหมวดอยู่แล้ว) · รันซ้ำไม่มีอะไรให้ทำ

DO $$
DECLARE
  r RECORD;
  sid INTEGER;
  n_section INTEGER := 0;
  n_lesson INTEGER := 0;
  moved INTEGER;
BEGIN
  FOR r IN
    SELECT DISTINCT l.course_id
    FROM lessons l
    WHERE l.is_active = true AND l.section_id IS NULL
    ORDER BY l.course_id
  LOOP
    -- มีหมวดชื่อ "พื้นฐาน" อยู่แล้วก็ใช้ตัวเดิม ไม่สร้างซ้ำ
    SELECT id INTO sid FROM course_sections
    WHERE course_id = r.course_id AND title = 'พื้นฐาน' AND is_active = true
    ORDER BY id LIMIT 1;

    IF sid IS NULL THEN
      INSERT INTO course_sections (course_id, title, description, section_order, mode)
      VALUES (
        r.course_id, 'พื้นฐาน', NULL,
        (SELECT COALESCE(MAX(section_order), -1) + 1 FROM course_sections WHERE course_id = r.course_id),
        'basic'
      )
      RETURNING id INTO sid;
      n_section := n_section + 1;
      RAISE NOTICE 'course id=% → สร้างหมวด "พื้นฐาน" (section id=%)', r.course_id, sid;
    END IF;

    UPDATE lessons SET section_id = sid
    WHERE course_id = r.course_id AND is_active = true AND section_id IS NULL;
    GET DIAGNOSTICS moved = ROW_COUNT;
    n_lesson := n_lesson + moved;
    RAISE NOTICE 'course id=% → ย้าย % บทเข้าหมวด "พื้นฐาน"', r.course_id, moved;
  END LOOP;

  RAISE NOTICE '050 เสร็จ: สร้างหมวดใหม่ % หมวด, ย้ายบทเรียน % บท', n_section, n_lesson;
END $$;
