/**
 * Frontend types for the dynamic subscription_plans table.
 *
 * Backed by /api/subscription/plans (public, active only) and
 * /api/admin/packages (admin CRUD, all rows).
 */

/**
 * Admin-only alternate price variant for a plan.
 *
 * Used for prices that should NOT appear on the public Landing page (e.g. the
 * Yearly Promo ฿2,800 that only admin extend can apply). Stored as JSONB.
 */
export interface AdminAltPrice {
  label: string;
  label_th?: string;
  subtotal: number;        // pre-VAT
}

/** Same as AdminAltPrice but with the server-side vat/total computed. */
export interface AdminAltPriceComputed extends AdminAltPrice {
  vat: number;
  total: number;           // subtotal + vat (vat-inclusive)
}

export interface SubscriptionPlan {
  id: number;
  slug: string;                          // 'monthly', 'yearly', or custom
  name: string;
  name_th: string | null;
  subtotal: number;                      // pre-VAT
  vat: number;                           // computed: subtotal × VAT_RATE/100
  total: number;                         // computed: subtotal + vat (vat-inclusive)
  centsTotal?: number;                   // total × 100 (for Stripe / cents math)
  days: number;
  /** Per-package commission override (0-100). NULL → fall back to user's tier. */
  commission_percent: number | null;
  is_active: boolean;
  display_order: number;
  description: string | null;
  features: string[];
  /** Admin-only alternate price variants (raw). Empty array when none. */
  admin_alt_prices: AdminAltPrice[];
  /** Same list, with vat/total pre-computed by the server. */
  admin_alt_prices_computed: AdminAltPriceComputed[];
  /** When set, buying this plan auto-promotes the user to this tier id. */
  tier_id: number | null;
  /**
   * When true, plan is hidden from public Landing / Subscription page. Admin
   * can still see + manage it under /admin → Packages and upload slip on the
   * user's behalf via /admin/upload-extend-slip.
   */
  admin_only: boolean;
  created_at?: string;
  updated_at?: string;
  /** เวลาที่ราคาปัจจุบันเริ่มมีผล (จากการตั้งเวลา) — null/undefined = ไม่เคยตั้งเวลา · admin endpoint เท่านั้น */
  price_effective_at?: string | null;
  /** รายการตั้งเวลาถัดไปที่รอมีผล — admin endpoint เท่านั้น (public ไม่ส่ง = ไม่ประกาศราคาล่วงหน้า) */
  pending_schedule?: PendingPriceSchedule | null;
}

/** schedule ถัดไปที่รอมีผล แนบมากับแพ็กเกจในหน้าแอดมิน */
export interface PendingPriceSchedule {
  id: number;
  subtotal: number;
  vat: number;
  total: number;
  effective_at: string;
  note: string | null;
}

export type PriceScheduleStatus = 'pending' | 'applied' | 'superseded' | 'cancelled';

/** แถวจาก GET /api/admin/packages/price-schedules */
export interface PlanPriceSchedule {
  id: number;
  plan_id: number;
  plan_slug: string;
  plan_name: string;
  plan_name_th: string | null;
  subtotal: number;               // ราคาใหม่ก่อน VAT
  vat: number;
  total: number;                  // ยอดโอนใหม่รวม VAT
  effective_at: string;           // ISO (UTC) — แสดงเป็นเวลาไทยด้วย toLocaleString(th-TH, Asia/Bangkok)
  note: string | null;
  previous_subtotal: number | null;   // ราคาก่อนหน้า ณ ตอนมีผล (มีเมื่อ applied/superseded)
  previous_total: number | null;
  applied_at: string | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
  cancelled_by_email: string | null;
  created_by: number | null;
  created_by_email: string | null;
  created_at: string;
  status: PriceScheduleStatus;
}

export interface PackageEditInput {
  slug?: string;
  name?: string;
  name_th?: string | null;
  subtotal?: number;
  days?: number;
  commission_percent?: number | null;
  description?: string | null;
  features?: string[];
  display_order?: number;
  is_active?: boolean;
  admin_alt_prices?: AdminAltPrice[];
  tier_id?: number | null;
  admin_only?: boolean;
  /** ราคาที่เห็นตอนเปิดฟอร์ม — server ตอบ 409 PRICE_CHANGED ถ้าไม่ตรงราคาปัจจุบัน (กันเขียนทับราคาที่เพิ่งมีผล) */
  expected_subtotal?: number;
}

/** Per-(user × plan) commission override row. */
export interface UserPackageCommission {
  id: number;
  user_id: number;
  plan_id: number;
  commission_percent: number;
  created_at: string;
  updated_at: string;
}
