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

// 50% launch discount — actual charged subtotal is halved (595 / 2945).
// The pre-discount price (1,190 / 5,890 = subtotal × 2) is shown struck-through
// with a "-50%" badge in the UI. VAT/total are computed from the discounted subtotal.
export const PRICING: Record<PlanType, PlanPricing> = {
  monthly: { subtotal: 595, vat: 41.65, total: 636.65, days: 30 },
  yearly: { subtotal: 2945, vat: 206.15, total: 3151.15, days: 365 },
};

export function planFromDays(days: number): PlanType {
  return days >= 365 ? 'yearly' : 'monthly';
}

/**
 * ราคา/เดือนของยอดรายปี ปัดลงจำนวนเต็ม (สไตล์ TradingView: "฿245 /เดือน")
 * ยอดจ่ายจริงต้องระบุคู่กันในบรรทัด "ชำระเป็นรายปี ฿X" เสมอ
 */
export const perMonthOfYearly = (yearlySubtotal: number) => Math.floor(yearlySubtotal / 12);

/** เงินที่ประหยัดต่อปีเมื่อจ่ายรายปี เทียบกับจ่ายรายเดือน 12 เดือน */
export const yearlySavings = (monthlySubtotal: number, yearlySubtotal: number) =>
  Math.max(0, Math.round(monthlySubtotal * 12 - yearlySubtotal));

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
