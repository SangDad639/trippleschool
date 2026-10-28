-- 079: แบบสอบถามหลังซื้อ (routes/purchaseSurveys.ts · FE components/PurchaseSurvey.tsx)
--   ถาม 2 ข้อหลังซื้อ: เหตุผลที่ซื้อ (free text) + คอร์สที่สนใจ (เลือกหลายคอร์ส)
--   นับทั้งสมาชิกรายเดือน/รายปี (ผูก subscription_extension_logs) และคอร์สเดี่ยว (ผูก course_enrollments ที่จ่ายเงิน)
--   1 แถวต่อ 1 การซื้อ (unique partial index ตามชนิด) · ข้ามได้ (skipped=true เก็บไว้กันถามซ้ำ + ดูอัตราการตอบ)
--   idempotent · additive-only
CREATE TABLE IF NOT EXISTS purchase_surveys (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchase_type    VARCHAR(16) NOT NULL CHECK (purchase_type IN ('subscription', 'course')),
  extension_log_id INTEGER     REFERENCES subscription_extension_logs(id) ON DELETE SET NULL, -- สมาชิก
  plan_slug        VARCHAR(32),                                                              -- monthly | yearly
  enrollment_id    INTEGER     REFERENCES course_enrollments(id) ON DELETE SET NULL,         -- คอร์สเดี่ยว
  course_id        INTEGER     REFERENCES courses(id) ON DELETE SET NULL,                    -- คอร์สที่ซื้อ
  reason           TEXT,                                                                     -- เหตุผลที่ซื้อ (≤ 500 ตัวอักษร ตัดที่ route)
  skipped          BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_surveys_ext
  ON purchase_surveys (extension_log_id) WHERE extension_log_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_surveys_enr
  ON purchase_surveys (enrollment_id) WHERE enrollment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_surveys_created
  ON purchase_surveys (created_at DESC);

-- คอร์สที่ผู้ซื้อบอกว่าสนใจ (หลายคอร์สต่อ 1 แบบสอบถาม)
CREATE TABLE IF NOT EXISTS purchase_survey_courses (
  survey_id INTEGER NOT NULL REFERENCES purchase_surveys(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (survey_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_purchase_survey_courses_course
  ON purchase_survey_courses (course_id);
