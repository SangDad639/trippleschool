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
