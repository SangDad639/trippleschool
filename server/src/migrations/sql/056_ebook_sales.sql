-- 056: ขาย Ebook รายเล่ม + ฟิลด์หน้า detail ใหม่ (ตามดีไซน์อ้างอิง fuzionhub)
--   - ebooks: price (0 = ไม่ขาย → เล่มเดิมทุกเล่มคงพฤติกรรม ฟรี/สมาชิก เดิม 100%),
--     pages/author/hook/highlights = ข้อมูลแสดงผลหน้า detail ล้วนๆ
--   - ebook_purchases: คำสั่งซื้อรายเล่ม (mirror course_enrollments ตัดส่วน progress)
--     สลิป + แอดมินอนุมัติมือ + refcode ลด 5% + affiliate commission เหมือนซื้อคอร์ส
ALTER TABLE ebooks
  ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pages INTEGER,
  ADD COLUMN IF NOT EXISTS author_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS author_avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS hook TEXT,
  ADD COLUMN IF NOT EXISTS highlights JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS ebook_purchases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ebook_id INTEGER NOT NULL REFERENCES ebooks(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  slip_url TEXT,
  paid_amount NUMERIC(10,2), -- snapshot ยอดโอน ณ ตอนสั่ง (หลังส่วนลดโค้ด) — ราคาเล่มเปลี่ยนทีหลังไม่กระทบ
  refcode VARCHAR(32),
  rejection_reason TEXT,
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, ebook_id)
);

CREATE INDEX IF NOT EXISTS idx_ebook_purchases_user   ON ebook_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_ebook_purchases_status ON ebook_purchases(status);
CREATE INDEX IF NOT EXISTS idx_ebook_purchases_ebook  ON ebook_purchases(ebook_id);
