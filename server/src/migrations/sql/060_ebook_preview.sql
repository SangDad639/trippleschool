-- 060: อ่านตัวอย่าง PDF จำกัดหน้า (เล่มสมาชิก/เล่มขาย)
--   preview_pages      จำนวนหน้าที่ให้อ่านฟรี (0 = ปิดตัวอย่าง → เล่มเดิมทุกเล่มพฤติกรรมเดิม)
--   preview_file_url   ไฟล์ตัวอย่างที่แอดมินอัพเอง — ถ้าตั้งไว้ใช้แทนการตัดอัตโนมัติ
--   preview_cache_url  แคชไฟล์ที่ server ตัดหน้าด้วย pdf-lib แล้ว (ล้างเมื่อไฟล์เต็ม/จำนวนหน้าเปลี่ยน)
ALTER TABLE ebooks
  ADD COLUMN IF NOT EXISTS preview_pages INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preview_file_url TEXT,
  ADD COLUMN IF NOT EXISTS preview_cache_url TEXT;
