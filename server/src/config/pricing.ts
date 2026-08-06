/**
 * Single source of truth for subscription pricing + tax rates.
 * Imported by routes/subscription.ts, routes/admin.ts, services/stripeService.ts.
 *
 * Pricing model: VAT-Exclusive
 *   - Subtotal = product price. 50% launch discount → ฿595 monthly / ฿2,945 yearly
 *     (pre-discount ฿1,190 / ฿5,890 shown struck-through + "-50%" in the UI).
 *   - VAT 7% added on top of the discounted subtotal
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
    subtotal: 595,
    vat: 41.65,
    total: 636.65,
    days: 30,
    centsTotal: 63665,
  },
  yearly: {
    subtotal: 2945,
    vat: 206.15,
    total: 3151.15,
    days: 365,
    centsTotal: 315115,
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
