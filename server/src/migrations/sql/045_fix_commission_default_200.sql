-- 045: ปิดระเบิดค่าคอม 200% (ซาก default จาก fork trippleviral)
-- users.commission_percent / commission_rate มี DEFAULT 200.00 → user ที่ถูกสร้าง
-- นอก path สมัครปกติ (script/seed) ได้ 200% แล้ว resolveCommissionPercent ใช้เป็น
-- user_snapshot ก่อนถึง tier/settings → ค่าคอม 200% ของยอดขาย
-- แก้: default = 5.00 (ตรง Tier 1 + affiliate_settings.default_commission) + ล้าง row ที่ถือ 200

ALTER TABLE users ALTER COLUMN commission_percent SET DEFAULT 5.00;
ALTER TABLE users ALTER COLUMN commission_rate SET DEFAULT 5.00;

UPDATE users SET commission_percent = 5.00 WHERE commission_percent = 200.00;
UPDATE users SET commission_rate = 5.00 WHERE commission_rate = 200.00;
