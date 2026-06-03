-- Migration 008: VAT (subscription) + WHT (affiliate commission) columns
--
-- ก่อนหน้านี้เคยมีเป็น ad-hoc script `server/scripts/add-vat-wht-columns.ts`
-- ซึ่งรันแค่ Railway ไม่เคยถูก apply ลง HWC RDS — ทำให้
-- `GET /api/affiliate/my-stats` 500 (column "wht_amount" does not exist).
--
-- Schema:
--   subscription_extension_logs:
--     + subtotal     NUMERIC(10,2)  -- price before VAT
--     + vat_amount   NUMERIC(10,2)  -- VAT 7%
--     + vat_rate     NUMERIC(5,2)   -- snapshot rate (7.00)
--     ('amount' column unchanged — represents the vat-inclusive total user paid)
--
--   affiliate_commissions:
--     + wht_rate     NUMERIC(5,2)   -- snapshot rate (3.00)
--     + wht_amount   NUMERIC(10,2)  -- WHT 3% deducted
--     + net_amount   NUMERIC(10,2)  -- amount admin pays affiliate (= amount - wht_amount)
--     ('amount' column unchanged — gross commission)
--
--   affiliate_settings:
--     + vat_rate_default NUMERIC(5,2) DEFAULT 7.00
--     + wht_rate_default NUMERIC(5,2) DEFAULT 3.00
--
--   user_bank_accounts:
--     + entity_type VARCHAR(20) DEFAULT 'individual'   -- 'individual' | 'juristic' (ภงด.3/53)
--
-- No backfill: old rows keep wht/vat/net = NULL by design.

-- 1) subscription_extension_logs — VAT split
ALTER TABLE subscription_extension_logs
  ADD COLUMN IF NOT EXISTS subtotal   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS vat_rate   NUMERIC(5,2);

-- 2) affiliate_commissions — WHT split
ALTER TABLE affiliate_commissions
  ADD COLUMN IF NOT EXISTS wht_rate   NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS wht_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(10,2);

-- 3) affiliate_settings — default rates (single-row id=1)
ALTER TABLE affiliate_settings
  ADD COLUMN IF NOT EXISTS vat_rate_default NUMERIC(5,2) DEFAULT 7.00,
  ADD COLUMN IF NOT EXISTS wht_rate_default NUMERIC(5,2) DEFAULT 3.00;

-- Populate defaults for the id=1 row even if it predates this migration
UPDATE affiliate_settings
   SET vat_rate_default = COALESCE(vat_rate_default, 7.00),
       wht_rate_default = COALESCE(wht_rate_default, 3.00)
 WHERE id = 1;

-- 4) user_bank_accounts — entity_type for ภงด.3 (individual) / ภงด.53 (juristic)
ALTER TABLE user_bank_accounts
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(20) DEFAULT 'individual';
