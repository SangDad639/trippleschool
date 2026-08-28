-- 046: เครื่องมือที่ใช้ในคอร์ส — admin กรอกตอนสร้าง/แก้คอร์ส โชว์บนหน้ารายละเอียดคอร์ส
-- รูปแบบ: [{ "name": "CapCut", "price": "฿250/เดือน" }] — price เป็นข้อความอิสระ
-- (หมายเหตุ "คิดตามเครดิต/แพ็กเกจรายเดือน" เป็นข้อความตายตัวฝั่ง FE ไม่เก็บใน DB)
ALTER TABLE courses ADD COLUMN IF NOT EXISTS tools JSONB NOT NULL DEFAULT '[]'::jsonb;
