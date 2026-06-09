-- 023_update_plan_pricing.sql — Set course-platform subscription pricing.
-- Monthly base ฿690 (+7% VAT = 738.30), Yearly base ฿3,990 (+7% VAT = 4,269.30).
-- The 005 seed used ON CONFLICT DO NOTHING (monthly 600 / yearly 3000), so existing
-- rows were never updated. plansService.withVatBreakdown derives vat/total from
-- subtotal at read time, so updating subtotal propagates to /api/subscription/plans,
-- the manual-transfer expected amount, and admin extend automatically.
-- Idempotent: plain UPDATEs, safe to re-run.

UPDATE subscription_plans SET subtotal = 690,  updated_at = NOW() WHERE slug = 'monthly';
UPDATE subscription_plans SET subtotal = 3990, updated_at = NOW() WHERE slug = 'yearly';
