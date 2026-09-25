-- 074: ที่คั่นหน้า "เรียนถึงบทไหน" ต้องไม่หายเมื่อบทถูกลบ/แทนที่
--   ปัญหา 25 ก.ย. 2026: ลบบทออกจากคอร์ส (id 302/316/356) แต่ course_enrollments.last_lesson_id ของผู้เรียน 5 คน
--   ยังชี้บทที่ไม่มีแล้ว → กด "เรียนต่อ" เจอ "ไม่พบบทเรียน"
--   แนวทาง: จำ "ลำดับบท" (lesson_order) ควบคู่กับ id → id หายก็ยังรู้ว่าอยู่บทที่เท่าไหร่ (services/lessonRefs.ts)
--   กติกา: additive-only (DB แชร์กับ prod ที่อาจยังรันโค้ดเก่า) · idempotent · ไม่แตะ course_enrollments.updated_at
--   (หน้า "คอร์สของฉัน"/"เรียนต่อของฉัน" เรียงตามคอลัมน์นั้น)

-- (1) คอลัมน์ใหม่: ลำดับของบทที่คั่นไว้ (server เติมให้เองทุกครั้งที่บันทึกความคืบหน้า)
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS last_lesson_order INTEGER;

-- (2) เติมลำดับให้แถวเดิมที่ id ยังใช้ได้ — ตั้งแต่นี้ทุกคนมี "ตำแหน่ง" สำรองไว้
UPDATE course_enrollments e
   SET last_lesson_order = l.lesson_order
  FROM lessons l
 WHERE l.id = e.last_lesson_id
   AND e.last_lesson_order IS NULL;

-- (3) รายการ "เรียนจบ": ตัด id ที่ไม่ใช่บท active ของคอร์สเดียวกันแล้ว (+ตัดซ้ำ) แล้วคิด % ใหม่เฉพาะแถวที่แตะ
--     (คำนวณอาร์เรย์ใหม่และ % ใน UPDATE เดียว — PostgreSQL ไม่ให้ UPDATE แถวเดิมซ้ำใน statement เดียวผ่าน CTE)
UPDATE course_enrollments e
   SET completed_lessons = cleaned.arr,
       progress_percent = LEAST(100, ROUND(cardinality(cleaned.arr) * 100.0 / GREATEST(cleaned.total, 1)))
  FROM (
    SELECT e2.id,
           ARRAY(SELECT DISTINCT l.id
                   FROM unnest(e2.completed_lessons) AS x(id)
                   JOIN lessons l ON l.id = x.id
                  WHERE l.course_id = e2.course_id AND l.is_active = true
                  ORDER BY l.id) AS arr,
           (SELECT COUNT(*) FROM lessons l WHERE l.course_id = e2.course_id AND l.is_active = true) AS total
      FROM course_enrollments e2
     WHERE e2.completed_lessons IS NOT NULL
       AND cardinality(e2.completed_lessons) > 0
       AND EXISTS (SELECT 1 FROM unnest(e2.completed_lessons) AS x(id)
                    WHERE NOT EXISTS (SELECT 1 FROM lessons l
                                       WHERE l.id = x.id AND l.course_id = e2.course_id AND l.is_active = true))
  ) cleaned
 WHERE e.id = cleaned.id;

-- (4) ที่คั่นหน้าที่ชี้บทซึ่งไม่มี/ปิด/คนละคอร์ส → บทแรกตามลำดับที่ยังไม่อยู่ในรายการเรียนจบ
--     (จบหมด → บทสุดท้าย · คอร์สไม่มีบท → NULL) — แถวเหล่านี้ไม่มีลำดับเก็บไว้ จึงใช้ข้อมูลที่ดีที่สุดที่เหลือ
UPDATE course_enrollments e
   SET last_lesson_id = sub.resume_id,
       last_lesson_order = ln.lesson_order
  FROM (
    SELECT e2.id AS enrollment_id,
           COALESCE(
             (SELECT l.id FROM lessons l
               WHERE l.course_id = e2.course_id AND l.is_active = true
                 AND NOT (l.id = ANY(COALESCE(e2.completed_lessons, '{}')))
               ORDER BY l.lesson_order, l.id LIMIT 1),
             (SELECT l.id FROM lessons l
               WHERE l.course_id = e2.course_id AND l.is_active = true
               ORDER BY l.lesson_order DESC, l.id DESC LIMIT 1)
           ) AS resume_id
      FROM course_enrollments e2
     WHERE e2.last_lesson_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM lessons l
                        WHERE l.id = e2.last_lesson_id AND l.course_id = e2.course_id AND l.is_active = true)
  ) sub
  LEFT JOIN lessons ln ON ln.id = sub.resume_id
 WHERE e.id = sub.enrollment_id;

-- (5) % ที่เกิน 100 จากการลบบทก่อนหน้า (จบมากกว่าจำนวนบทปัจจุบัน) → 100
UPDATE course_enrollments SET progress_percent = 100 WHERE progress_percent > 100;

-- (6) กันตกหล่น: ลบบทผ่านทางอื่น (SQL/โค้ดเก่าบน prod) → id ว่างเอง แต่ลำดับยังอยู่ให้ซ่อมตอนอ่าน
CREATE INDEX IF NOT EXISTS idx_course_enrollments_last_lesson ON course_enrollments(last_lesson_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_enrollments_last_lesson_fk') THEN
    ALTER TABLE course_enrollments
      ADD CONSTRAINT course_enrollments_last_lesson_fk
      FOREIGN KEY (last_lesson_id) REFERENCES lessons(id) ON DELETE SET NULL;
  END IF;
END $$;
