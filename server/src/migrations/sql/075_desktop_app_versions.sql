-- 075: desktop_app_versions — บันทึกว่าแต่ละบัญชีใช้โปรแกรม desktop เวอร์ชันไหน (Triple Music auto-update)
--   เขียนแบบ best-effort จาก GET /api/triplemusic/version (routes/desktopVersion.ts) ทุกครั้งที่แอปเช็คอัปเดต
--   คีย์ (user_id, app_key): บัญชีเดียวใช้ได้หลายโปรแกรม แถวละโปรแกรม · users.id เป็น INTEGER (SERIAL)
--   idempotent · additive-only · ดูการใช้งาน: SELECT version, platform, COUNT(*) FROM desktop_app_versions
--   WHERE app_key = 'triplemusic' GROUP BY 1, 2 ORDER BY 1 DESC;
CREATE TABLE IF NOT EXISTS desktop_app_versions (
  user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_key       VARCHAR(32) NOT NULL,          -- 'triplemusic'
  version       VARCHAR(32),                   -- X-App-Version
  platform      VARCHAR(32),                   -- X-App-Platform (win-x64 | mac-arm64)
  device_id     VARCHAR(64),                   -- X-Device-Id (optional)
  first_seen_at TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, app_key)               -- unique index ที่ ON CONFLICT ใช้
);

CREATE INDEX IF NOT EXISTS idx_desktop_app_versions_app_updated
  ON desktop_app_versions (app_key, updated_at DESC);
