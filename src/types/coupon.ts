/**
 * Coupon code types.
 *
 * 1 code = N free days. Two redemption modes (controlled by `max_uses`):
 *   - max_uses = 1    → single-use globally (legacy default)
 *   - max_uses = null → unlimited multi-use, 1 per user
 *   - max_uses = N>1  → capped multi-use, 1 per user
 *
 * Per-user uniqueness is ALWAYS enforced via the `coupon_redemptions`
 * pivot table — independent of max_uses.
 *
 * Schema: migrations 012_coupon_codes + 015_coupon_multi_use
 */

export interface CouponCode {
  id: number;
  code: string;
  days: number;
  is_active: boolean;
  notes: string | null;
  /** Total redemption cap. null = unlimited; 1 = single-use; N = capped. */
  max_uses: number | null;
  /** Live count of redemptions (SELECT COUNT FROM coupon_redemptions). */
  usage_count: number;
  created_at: string;
  /** First redeemer (kept for legacy display — multi-use codes have N redeemers). */
  redeemed_by: number | null;
  redeemed_by_email: string | null;
  redeemed_at: string | null;
}

// `redeemed` kept as alias for back-compat; new code prefers `exhausted`.
export type CouponListStatus = 'all' | 'active' | 'redeemed' | 'exhausted' | 'inactive';

export interface CouponListResponse {
  coupons: CouponCode[];
  total: number;
  limit: number;
  offset: number;
}

export interface CouponBulkCreateInput {
  days: number;
  count: number;
  /** null = unlimited; positive integer = total redemption cap. */
  max_uses?: number | null;
  notes?: string;
}

export interface CouponBulkCreateResponse {
  success: boolean;
  created: Array<{ id: number; code: string; days: number; created_at: string }>;
}

export interface CouponRedeemSuccess {
  success: true;
  days: number;
  expires_at: string;
}

export type CouponRedeemError =
  | 'invalid'
  | 'already_used_by_you'   // this user already redeemed this code
  | 'already_used'          // legacy alias — server may still return for old codes (back-compat)
  | 'limit_reached'         // global cap reached (multi-use codes)
  | 'disabled'
  | 'missing_code';
