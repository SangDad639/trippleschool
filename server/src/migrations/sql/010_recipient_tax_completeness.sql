-- Migration 010: Complete recipient tax info for WHT (ภงด.3 / ภงด.53) export
--
-- เพิ่ม structured address components + title prefix เข้า user_bank_accounts
-- ให้ external tax tool (ที่ user มีอยู่แล้ว) map fields เข้า ภงด.3 / ภงด.53
-- ได้ตรง ๆ ไม่ต้อง parse `tax_address` (free-form text) อีก
--
-- All additive. ไม่ migrate ข้อมูลเก่า — แถวเดิม keep columns ใหม่ NULL จนกว่า
-- user จะเข้าหน้า Profile แล้วกรอกในรูปแบบใหม่ (FE จะแสดง legacy `tax_address`
-- เป็น read-only เพื่อช่วย copy-paste).
--
-- ใช้ใน scope: ทั้ง VAT (ใบกำกับภาษี — ผู้ซื้อ) และ WHT (หนังสือรับรองภาษีหัก ณ ที่จ่าย — ผู้รับ)
-- เพราะ user คนเดียวเล่นทั้ง 2 บทบาท ใช้ field ชุดเดียวกันได้.

ALTER TABLE user_bank_accounts
  ADD COLUMN IF NOT EXISTS title_prefix  VARCHAR(20),    -- 'นาย' | 'นาง' | 'นางสาว' | 'บริษัท' | 'หจก.' | etc.
  ADD COLUMN IF NOT EXISTS address_line  VARCHAR(255),   -- บ้านเลขที่ ซอย ถนน
  ADD COLUMN IF NOT EXISTS subdistrict   VARCHAR(100),   -- ตำบล / แขวง
  ADD COLUMN IF NOT EXISTS district      VARCHAR(100),   -- อำเภอ / เขต
  ADD COLUMN IF NOT EXISTS province      VARCHAR(100),   -- จังหวัด
  ADD COLUMN IF NOT EXISTS postal_code   VARCHAR(10),    -- 5 หลัก (string เผื่อ leading zero)
  ADD COLUMN IF NOT EXISTS tax_branch    VARCHAR(50);    -- สาขาภาษี '00000' = สำนักงานใหญ่
                                                         -- แยกจาก `branch` (bank branch)
