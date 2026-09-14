-- 072: เนื้อหา HTML สำหรับแท็บ "พื้นฐานสำหรับผู้เริ่มต้น" ในหน้ารายละเอียดคอร์ส
-- Nullable by design: existing courses are left untouched and an empty value means no tab content.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS beginner_content_html TEXT;
