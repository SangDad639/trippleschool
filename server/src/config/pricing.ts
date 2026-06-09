/**
 * Single source of truth for subscription pricing + tax rates.
 * Imported by routes/subscription.ts, routes/admin.ts, services/stripeService.ts.
 *
 * Pricing model: VAT-Exclusive
 *   - Subtotal = product price (฿690 monthly / ฿3,990 yearly)
 *   - VAT 7% added on top
 *   - Total (vat-inclusive) = what user actually pays / transfers
 *
 * Affiliate commission base = Total (vat-inclusive) — per business decision
 * WHT 3% deducted from gross commission before payout to affiliate.
 */

export const VAT_RATE = 7; // %
export const WHT_RATE = 3; // %

export type PlanType = 'monthly' | 'yearly';

interface PlanPricing {
  subtotal: number; // before VAT
  vat: number; // VAT amount
  total: number; // user-facing price (vat-inclusive)
  days: number;
  centsTotal: number; // total × 100 — for Stripe / commission idempotency
}

export const PRICING: Record<PlanType, PlanPricing> = {
  monthly: {
    subtotal: 690,
    vat: 48.3,
    total: 738.3,
    days: 30,
    centsTotal: 73830,
  },
  yearly: {
    subtotal: 3990,
    vat: 279.3,
    total: 4269.3,
    days: 365,
    centsTotal: 426930,
  },
};

export function planFromDays(days: number): PlanType {
  return days >= 365 ? 'yearly' : 'monthly';
}

export function pricingFromPlan(plan: PlanType | string): PlanPricing {
  return plan === 'yearly' ? PRICING.yearly : PRICING.monthly;
}

export function pricingFromDays(days: number): PlanPricing {
  return pricingFromPlan(planFromDays(days));
}

/**
 * Split a vat-inclusive total back to (subtotal, vat) using the standard rate.
 * Used when we know the total but need to record the VAT breakdown.
 */
export function splitVatInclusive(total: number, rate = VAT_RATE) {
  const subtotal = +(total / (1 + rate / 100)).toFixed(2);
  const vat = +(total - subtotal).toFixed(2);
  return { subtotal, vat, total, rate };
}

/**
 * Calculate WHT on a gross commission and return breakdown.
 */
export function calculateWht(grossCommission: number, rate = WHT_RATE) {
  const wht = +(grossCommission * (rate / 100)).toFixed(2);
  const net = +(grossCommission - wht).toFixed(2);
  return { gross: +grossCommission.toFixed(2), wht, net, rate };
}
