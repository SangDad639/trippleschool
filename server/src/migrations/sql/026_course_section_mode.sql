-- 026_course_section_mode.sql — 2-mode content split (พื้นฐาน / อัพเดท) at section level.
-- Each course section is tagged 'basic' (พื้นฐาน) or 'update' (อัพเดท). CourseDetail/
-- CourseLearn render the sections in two tabs by this mode. Default 'basic' keeps all
-- existing sections in the พื้นฐาน tab. Idempotent.
ALTER TABLE course_sections ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'basic';
