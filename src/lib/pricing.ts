/**
 * Frontend mirror of server/src/config/pricing.ts
 *
 * Keep these constants in sync with the BE — both are imported wherever
 * pricing is displayed (Landing, Subscription, Profile, Admin, Affiliate).
 *
 * If you change rates here, also update server/src/config/pricing.ts.
 */

export const VAT_RATE = 7; // %
export const WHT_RATE = 3; // %

export type PlanType = 'monthly' | 'yearly';

interface PlanPricing {
  subtotal: number; // ราคาสินค้าก่อน VAT
  vat: number; // VAT amount
  total: number; // ยอดที่ user จ่าย (vat-inclusive)
  days: number;
}

export const PRICING: Record<PlanType, PlanPricing> = {
  monthly: { subtotal: 690, vat: 48.3, total: 738.3, days: 30 },
  yearly: { subtotal: 3990, vat: 279.3, total: 4269.3, days: 365 },
};

export function planFromDays(days: number): PlanType {
  return days >= 365 ? 'yearly' : 'monthly';
}

export function pricingFromPlan(plan: PlanType | string | null | undefined): PlanPricing {
  return plan === 'yearly' ? PRICING.yearly : PRICING.monthly;
}

/**
 * Split a vat-inclusive total back to (subtotal, vat).
 */
export function splitVatInclusive(total: number, rate = VAT_RATE) {
  const subtotal = +(total / (1 + rate / 100)).toFixed(2);
  const vat = +(total - subtotal).toFixed(2);
  return { subtotal, vat, total, rate };
}

/**
 * Calculate WHT breakdown from gross commission (snapshot of legacy records may
 * have NULL — call sites should fall back to the original gross display).
 */
export function calculateWht(grossCommission: number, rate = WHT_RATE) {
  const wht = +(grossCommission * (rate / 100)).toFixed(2);
  const net = +(grossCommission - wht).toFixed(2);
  return { gross: +grossCommission.toFixed(2), wht, net, rate };
}
