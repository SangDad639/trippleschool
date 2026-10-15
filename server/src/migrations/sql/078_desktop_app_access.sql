-- 078: desktop_app_access — สิทธิ์ต่อโปรแกรม desktop ของแต่ละบัญชี (เริ่มที่ Triple Idol · repo Triple-Idol)
--   แถวละ (user_id, app_key) แบบเดียวกับ desktop_app_versions (077) · สร้างตอนล็อกอินผ่าน POST /api/tripleidol/auth/login
--   device_id: เครื่องที่ถือเซสชันอยู่ — ล็อกอินเครื่องใหม่ทับ แล้ว /me จากเครื่องเก่าได้ 401 DEVICE_CHANGED
--   card_limit_override: จำนวนการ์ดที่แอดมินกำหนดเอง (NULL = ตามสถานะสมาชิก: ฟรี 1 / สมาชิก 100 — services/tripleidolAccess.ts)
--   imported_from: 'sora' = บัญชีที่ย้ายมาจาก backend เดิม (scripts/migrate-tripleidol-users.ts) · NULL = สมัครที่ school เอง
--   idempotent · additive-only
CREATE TABLE IF NOT EXISTS desktop_app_access (
  user_id             INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_key             VARCHAR(32) NOT NULL,          -- 'tripleidol'
  device_id           VARCHAR(64),                   -- sha256[:32] ของ MachineGuid ที่แอปส่งมา
  device_bound_at     TIMESTAMP,
  last_login_at       TIMESTAMP,
  card_limit_override INTEGER
    CHECK (card_limit_override IS NULL OR (card_limit_override >= 0 AND card_limit_override <= 1000)),
  imported_from       VARCHAR(32),
  created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, app_key)
);

CREATE INDEX IF NOT EXISTS idx_desktop_app_access_app_login
  ON desktop_app_access (app_key, last_login_at DESC);
