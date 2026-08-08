-- 029_discount_50pct_595_2945.sql — 50% launch discount on both plans.
-- Charged subtotal is HALVED: monthly ฿595 (+7% VAT = 636.65), yearly ฿2,945 (+7% VAT = 3,151.15).
-- The pre-discount price (฿1,190 / ฿5,890 = subtotal × 2) is shown struck-through with a
-- "-50%" badge in the FE (presentational only). plansService.withVatBreakdown derives
-- vat/total from subtotal, so this propagates to /api/subscription/plans, the manual-transfer
-- expected amount, and admin extend automatically. VAT is computed on the DISCOUNTED subtotal.
-- Existing subscribers' subscription_expires_at / extension_logs are untouched.
-- Idempotent: plain UPDATEs, safe to re-run.

UPDATE subscription_plans SET subtotal = 595, updated_at = NOW() WHERE slug = 'monthly';
UPDATE subscription_plans SET subtotal = 2945, updated_at = NOW() WHERE slug = 'yearly';
