-- 059: แนวภาพปก Ebook — การ์ดหน้า /ebooks ปรับทรงตามปก (แนวนอน 16:9 / ปกหนังสือแนวตั้ง)
-- default 'landscape' = ปกเดิมทุกเล่ม (อัปโหลดมาเป็น 16:9 ทั้งหมด) หน้าตาเดิมเป๊ะ
-- ค่าถูก detect อัตโนมัติตอนแอดมินอัปปกใหม่ (ฝั่ง client อ่านขนาดรูปจริง) และสลับเองได้
ALTER TABLE ebooks ADD COLUMN IF NOT EXISTS cover_orientation VARCHAR(10) NOT NULL DEFAULT 'landscape';
