-- 027_update_plan_pricing_1190_5890.sql — new course-platform subscription pricing.
-- Monthly base ฿1,190 (+7% VAT = 1,273.30), Yearly base ฿5,890 (+7% VAT = 6,302.30).
-- plansService.withVatBreakdown derives vat/total from subtotal at read time, so
-- updating subtotal propagates to /api/subscription/plans, the manual-transfer
-- expected amount, and admin extend automatically. Existing subscribers'
-- subscription_expires_at / extension_logs are untouched (migrate rule handled later).
-- Idempotent: plain UPDATEs, safe to re-run.

UPDATE subscription_plans SET subtotal = 1190, updated_at = NOW() WHERE slug = 'monthly';
UPDATE subscription_plans SET subtotal = 5890, updated_at = NOW() WHERE slug = 'yearly';
