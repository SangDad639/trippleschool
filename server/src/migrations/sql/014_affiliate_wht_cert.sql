-- Migration 013: Affiliate WHT certificate (50ทวิ) upload + proof_url formalization
--
-- Context: Admin uploads a "หนังสือรับรองหักภาษี ณ ที่จ่าย" (form 50ทวิ) when
-- marking a commission as paid. User downloads it from /affiliate Transfer
-- History. Also formalizes proof_url which was used by code but never in
-- CREATE TABLE — ALTER ... IF NOT EXISTS keeps both safe.
--
-- Backwards compat: rows where wht_cert_url IS NULL hide the "ดูเอกสาร 50ทวิ"
-- button on the user side (no historical data migration needed).

ALTER TABLE affiliate_commissions
  ADD COLUMN IF NOT EXISTS proof_url TEXT,
  ADD COLUMN IF NOT EXISTS wht_cert_url TEXT;

-- Partial index — helps admin filter "paid rows missing cert" if we add such
-- a query later. Cheap (only indexes rows with cert) so OK to add now.
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_wht_cert
  ON affiliate_commissions(wht_cert_url) WHERE wht_cert_url IS NOT NULL;
