export interface ThaiBankInfo {
  bank_name: string;
  branch: string | null;
  account_number: string;
  account_holder: string;
  phone: string | null;
  // ข้อมูลหักภาษี ณ ที่จ่าย — legacy text address (kept for backward-compat read);
  // new structured fields below are preferred for ภงด.3/53 export.
  tax_id: string | null;
  tax_name: string | null;
  tax_address: string | null;
  // 'individual' (บุคคลธรรมดา → ภงด.3) | 'juristic' (นิติบุคคล → ภงด.53)
  entity_type?: 'individual' | 'juristic';
  // Structured tax info (mig 010) — used by /profile TaxInfoSection + export.
  title_prefix?: string | null;    // 'นาย' | 'นาง' | 'นางสาว' | 'บริษัท' | 'หจก.' | etc.
  address_line?: string | null;    // บ้านเลขที่ ซอย ถนน
  subdistrict?: string | null;     // ตำบล / แขวง
  district?: string | null;        // อำเภอ / เขต
  province?: string | null;        // จังหวัด
  postal_code?: string | null;     // 5 digits
  tax_branch?: string | null;      // สาขาภาษี '00000' = สำนักงานใหญ่ (juristic)
  // Optional ID card upload (mig 011).
  // User uploads via POST /upload-id-card; fixed key per user (same-key overwrite).
  id_card_url?: string | null;
  id_card_uploaded_at?: string | null;
  /** BE proxy path. FE fetches with Authorization header → blob URL → preview.
   *  Bypasses HWC OBS quirk that forces `Content-Disposition: attachment`
   *  on extensionless keys. Preferred over `id_card_signed_url`. */
  id_card_preview_path?: string | null;
  /** Pre-signed OBS URL. Kept for legacy compat — does NOT support inline
   *  preview on HWC OBS. Use `id_card_preview_path` instead. */
  id_card_signed_url?: string | null;
}

/** Payload accepted by PUT /api/affiliate/tax-info. Partial update — fields
 *  not present (or null) are stored as NULL. */
export interface TaxInfoInput {
  entity_type?: 'individual' | 'juristic';
  title_prefix?: string | null;
  tax_name?: string | null;
  tax_id?: string | null;
  address_line?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postal_code?: string | null;
  tax_branch?: string | null;
}

export type PayoutMethod = 'wise' | 'thai_bank';

export interface AffiliateStats {
  refcode: string;
  commission_percent: number;
  affiliate_tier?: AffiliateTier;
  /** Joined view of the user's affiliate_tiers row — preferred over the
   *  bare `affiliate_tier` integer when displaying the tier card. */
  tier?: {
    id: number;
    name: string;
    name_th: string | null;
    commission_percent: number | null;
    badge_color: string;
    description: string | null;
  } | null;
  total_referrals: number;
  pending_transfers: number;
  completed_transfers: number;
  /** Net amount earned (after WHT). Legacy name for backward compat. */
  total_earnings: number;
  /** Net pending amount (after WHT). Legacy name for backward compat. */
  pending_amount: number;
  // WHT breakdown — explicit gross/wht/net for new UI
  pending_gross?: number;
  pending_wht?: number;
  pending_net?: number;
  gross_earned?: number;
  wht_earned?: number;
  net_earned?: number;
  wise_email: string | null;
  preferred_payout_method: PayoutMethod;
  thai_bank_info: ThaiBankInfo | null;
}

export interface Referee {
  id: number;
  email: string;
  registered_at: string;
  has_subscription: boolean;
  commission_status: 'pending' | 'transferred' | null;
  commission_amount: number | null;
}

export interface AffiliateTransfer {
  id: number;
  referee_email: string;
  amount: number;                     // gross commission (เก่า)
  status: 'pending' | 'transferred';
  payment_reference: string | null;
  admin_notes: string | null;
  created_at: string;
  transferred_at: string | null;
  proof_url: string | null;
  proof_signed_url: string | null;
  // WHT certificate (50ทวิ) — uploaded by admin in Mark as Paid, viewable by user
  wht_cert_url: string | null;
  wht_cert_signed_url: string | null;
  // ข้อมูลเพิ่มเติม
  sale_amount: number | null;         // ยอดขายที่ referee จ่าย (vat-inclusive)
  gxvg_tokens: number | null;         // จำนวน GXVG ที่ได้รับ
  commission_percent: number | null;  // % ที่ได้รับ
  // WHT breakdown — null สำหรับ records เก่า (legacy)
  wht_rate: number | null;
  wht_amount: number | null;
  net_amount: number | null;
}

// Legacy 2-tier alias — kept for compatibility with existing code paths
// that still expect a literal `1 | 2`. New code should use the FK-based
// `AffiliateTierRecord` shape from affiliate_tiers (admin can have N tiers).
export type AffiliateTier = number;

// New shape backed by the affiliate_tiers table (admin CRUD)
export interface AffiliateTierRecord {
  id: number;
  name: string;
  name_th: string | null;
  commission_percent: number;
  is_active: boolean;
  display_order: number;
  description: string | null;
  badge_color: string;          // 'gray' | 'gold' | 'diamond' | custom
  user_count?: number;           // populated by /admin/tiers-v2 only
  created_at?: string;
  updated_at?: string;
}

export interface TierEditInput {
  name?: string;
  name_th?: string | null;
  commission_percent?: number;
  description?: string | null;
  display_order?: number;
  badge_color?: string;
  is_active?: boolean;
}

// Admin types
export interface AdminReferrer {
  user_id: number;
  email: string;
  refcode: string;
  wise_email: string | null;
  preferred_payout_method: PayoutMethod;
  affiliate_tier: AffiliateTier;
  commission_percent: number;
  thai_bank_info: ThaiBankInfo | null;
  total_referrals: number;
  total_transferred: number;
  pending_amount: number;
}

export interface TierSettings {
  tier1_percent: number;
  tier2_percent: number;
}

export interface AdminTransfer {
  id: number;
  referrer_email: string;
  referee_email: string;
  amount: number;                  // gross
  status: 'pending' | 'transferred';
  payment_reference: string | null;
  admin_notes: string | null;
  created_at: string;
  transferred_at: string | null;
  proof_url: string | null;
  proof_signed_url: string | null;
  // WHT certificate (50ทวิ) — uploaded by admin in Mark as Paid, viewable by user
  wht_cert_url: string | null;
  wht_cert_signed_url: string | null;
  // ข้อมูลเพิ่มเติม
  sale_amount: number | null;     // ยอดขายที่ referee จ่าย (vat-inclusive)
  gxvg_tokens: number | null;     // จำนวน GXVG ที่ได้รับ
  // WHT breakdown — null สำหรับ records เก่า
  wht_rate: number | null;
  wht_amount: number | null;
  net_amount: number | null;
}

export interface PendingCommissionDetail {
  id: number;
  referee_email: string;
  amount: number;                 // gross commission
  sale_amount: number | null;     // ยอดขาย (vat-inclusive)
  gxvg_tokens: number | null;
  created_at: string;
  // WHT breakdown — null สำหรับ records เก่า
  wht_rate: number | null;
  wht_amount: number | null;
  net_amount: number | null;
}

export interface AdminPendingPayout {
  referrer_id: number;
  referrer_email: string;
  wise_email: string | null;
  preferred_payout_method: PayoutMethod;
  thai_bank_info: ThaiBankInfo | null;
  pending_count: number;
  /** Legacy: == pending_gross. FE prefers pending_net for "ยอดต้องจ่าย". */
  pending_amount: number;
  pending_gross: number;
  pending_wht: number;
  pending_net: number;
  commission_ids: number[];
  details: PendingCommissionDetail[];
  /** Unique per card. Pending: referrer_id. Transferred: per payout event
   *  (referrer + transferred_at + payment_reference) so each historical
   *  Mark-as-Paid shows as its own card, not a lifetime aggregate. */
  group_key?: string;
  /** Transferred-mode only — the payout event meta. */
  transferred_at?: string | null;
  payment_reference?: string | null;
  admin_notes?: string | null;
}
