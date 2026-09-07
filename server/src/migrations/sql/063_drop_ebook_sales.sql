-- 063: เลิกขาย Ebook รายเล่ม (user เคาะ 7 ก.ย. 2026) — Ebook เหลือ 2 โหมด: ฟรี / สมาชิกเท่านั้น · idempotent
--   (1) เล่มที่เคยตั้งราคา → กลายเป็น "สมาชิกเท่านั้น" ก่อนทิ้งคอลัมน์ (ไม่งั้นจะกลายเป็นเล่มฟรีสาธารณะ)
--   (2) ทิ้งตารางคำสั่งซื้อรายเล่ม (ไม่มีตารางอื่น FK มาหา — ค่าคอม affiliate ผูกด้วย key ข้อความเท่านั้น)
--   (3) ทิ้งคอลัมน์ราคา (pages/author/hook/highlights จาก 056 เก็บไว้)
--   (4) ล้างแคชไฟล์ตัวอย่างให้ตัดใหม่ — ตัวตัด (pdfPreview.ts) เพิ่มการถอด link annotation กันเนื้อหาหน้าอื่นติดไป
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ebooks' AND column_name = 'price'
  ) THEN
    EXECUTE 'UPDATE ebooks SET members_only = true WHERE price > 0 AND members_only = false';
  END IF;
END $$;

DROP TABLE IF EXISTS ebook_purchases;

ALTER TABLE ebooks DROP COLUMN IF EXISTS price;

UPDATE ebooks SET preview_cache_url = NULL WHERE preview_cache_url IS NOT NULL;
