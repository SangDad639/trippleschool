/**
 * Payment history + Tax invoice request types.
 *
 * Mirrors the response shapes from:
 *   • GET  /api/subscription/extension-history             (user)
 *   • POST /api/subscription/extension-history/:logId/request-invoice
 *   • GET  /api/admin/tax-invoices                          (admin)
 *
 * Schema: migration 013_tax_invoice_requests
 */

export type InvoiceStatus = 'pending' | 'issued' | 'rejected';

/** Approval methods that produce an invoice-eligible row. Coupon redemption
 *  + admin-approve grants are excluded server-side so we never see them here. */
export type PaidApprovalMethod = 'admin' | 'autoapprove' | 'stripe';

/** One row in `/profile → ประวัติการชำระเงิน`. `invoice_request` is null
 *  when the user hasn't asked for an invoice yet. */
export interface PaymentHistoryRow {
  id: number;                       // subscription_extension_logs.id
  days_added: number;
  amount: string;                   // vat-inclusive total (string from DB)
  subtotal: number | null;          // pre-VAT; null on rows older than mig 008
  vat_amount: number | null;
  vat_rate: number | null;
  approval_method: PaidApprovalMethod;
  created_at: string;
  invoice_request: {
    id: number;
    status: InvoiceStatus;
    requested_at: string;
    /** BE proxy path (`/api/subscription/tax-invoice/:id/file`). Use with
     *  Authorization header → blob URL → iframe. Null when status≠'issued'. */
    invoice_url: string | null;
    admin_notes: string | null;     // rejection reason (only when status='rejected')
  } | null;
}

/** One row in `/admin → ใบกำกับภาษี`. Includes user's saved tax info so
 *  admin can type the invoice without context-switching to the user's
 *  profile. `tax_info` is null when user hasn't filled tax fields yet. */
export interface AdminTaxInvoiceRequest {
  id: number;
  status: InvoiceStatus;
  requested_at: string;
  reviewed_at: string | null;
  admin_notes: string | null;
  /** BE proxy path. Null when no file uploaded yet. */
  invoice_url: string | null;

  // Joined user info
  user_id: number;
  user_email: string;

  // Joined extension_log info — what they paid for
  log_id: number;
  log_days_added: number;
  log_amount: string;
  log_subtotal: number | null;
  log_created_at: string;

  // Joined tax info from user_bank_accounts (structured fields, mig 010)
  tax_info: {
    entity_type: 'individual' | 'juristic' | null;
    title_prefix: string | null;
    tax_name: string | null;
    tax_id: string | null;
    address_line: string | null;
    subdistrict: string | null;
    district: string | null;
    province: string | null;
    postal_code: string | null;
    tax_branch: string | null;
  } | null;
}

export interface AdminTaxInvoiceListResponse {
  requests: AdminTaxInvoiceRequest[];
  total: number;
  limit: number;
  offset: number;
}
