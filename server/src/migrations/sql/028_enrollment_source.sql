-- 028_enrollment_source.sql — distinguish purchase vs subscription-comped enrollments.
-- When a user with an ACTIVE subscription opens a course, the backend auto-creates an
-- 'approved' course_enrollments row with source='subscription' (grants access + progress +
-- "my courses" + "เริ่มเรียน" CTA via the normal flow). Real per-course purchases keep
-- source='purchase'. Lets admin/reporting tell the two apart. Idempotent.
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'purchase';
