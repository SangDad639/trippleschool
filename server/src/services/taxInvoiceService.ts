/**
 * Tax invoice request service.
 *
 * User flow:
 *   1. GET /api/subscription/extension-history → user sees their paid extensions
 *      with `invoice_request` join (null = ยังไม่ขอ, pending/issued/rejected = ขอแล้ว).
 *   2. POST /api/subscription/extension-history/:logId/request-invoice → INSERT row
 *      (UNIQUE on extension_log_id blocks dup via 409).
 *   3. Admin /admin → ใบกำกับภาษี tab → upload PDF (status='issued') or reject.
 *   4. User refetch → sees ✅ download link.
 *
 * Storage: invoice file → OBS key `tax-invoices/{requestId}/invoice` (no
 * extension → same-key overwrite when admin fixes a typo). Local-dev fallback
 * writes to `uploads/tax-invoices/{requestId}/invoice.{ext}`.
 *
 * Schema: migration 013_tax_invoice_requests
 */

import path from 'path';
import fs from 'fs';
import pool from '../db.js';
import { getBucketName, uploadFile } from '../utils/s3.js';

/** Approval methods that represent a real paid extension — only these are
 *  eligible for an invoice request. Excludes 'coupon', 'admin_approve',
 *  'admin_reduce', 'admin_plan_change', 'admin_set_referrer' (no money). */
const PAID_METHODS = ['admin', 'autoapprove', 'stripe'] as const;

export type InvoiceStatus = 'pending' | 'issued' | 'rejected';

export interface HistoryRow {
  id: number;
  days_added: number;
  amount: string;
  subtotal: number | null;
  vat_amount: number | null;
  vat_rate: number | null;
  approval_method: 'admin' | 'autoapprove' | 'stripe';
  created_at: string;
  invoice_request: {
    id: number;
    status: InvoiceStatus;
    requested_at: string;
    invoice_url: string | null;
    admin_notes: string | null;
  } | null;
}

/**
 * List the caller's paid extension history with invoice-request status joined.
 * Filters to PAID_METHODS + amount > 0 so coupon / admin-approve rows are
 * hidden (they didn't pay → no invoice needed).
 */
export async function listForUser(userId: number): Promise<HistoryRow[]> {
  const r = await pool.query<{
    id: number;
    days_added: number;
    amount: string;
    subtotal: string | null;
    vat_amount: string | null;
    vat_rate: string | null;
    approval_method: 'admin' | 'autoapprove' | 'stripe';
    created_at: string;
    req_id: number | null;
    req_status: InvoiceStatus | null;
    req_requested_at: string | null;
    req_invoice_url: string | null;
    req_admin_notes: string | null;
  }>(
    `SELECT sel.id, sel.days_added, sel.amount,
            sel.subtotal, sel.vat_amount, sel.vat_rate,
            sel.approval_method, sel.created_at,
            tir.id AS req_id,
            tir.status AS req_status,
            tir.requested_at AS req_requested_at,
            tir.invoice_url AS req_invoice_url,
            tir.admin_notes AS req_admin_notes
       FROM subscription_extension_logs sel
       LEFT JOIN tax_invoice_requests tir ON tir.extension_log_id = sel.id
      WHERE sel.user_id = $1
        AND sel.approval_method = ANY($2::text[])
        AND sel.amount IS NOT NULL
        AND sel.amount::numeric > 0
      ORDER BY sel.created_at DESC`,
    [userId, PAID_METHODS]
  );

  return r.rows.map((row) => ({
    id: row.id,
    days_added: row.days_added,
    amount: row.amount,
    subtotal: row.subtotal != null ? Number(row.subtotal) : null,
    vat_amount: row.vat_amount != null ? Number(row.vat_amount) : null,
    vat_rate: row.vat_rate != null ? Number(row.vat_rate) : null,
    approval_method: row.approval_method,
    created_at: row.created_at,
    invoice_request: row.req_id == null
      ? null
      : {
          id: row.req_id,
          status: row.req_status!,
          requested_at: row.req_requested_at!,
          // FE consumes through BE proxy — never expose raw OBS key.
          // Presence of `invoice_url` means "file uploaded"; FE constructs
          // proxy URL from request id.
          invoice_url: row.req_invoice_url ? `/api/subscription/tax-invoice/${row.req_id}/file` : null,
          admin_notes: row.req_admin_notes,
        },
  }));
}

export type RequestInvoiceResult =
  | { ok: true; request: { id: number; status: InvoiceStatus; requested_at: string } }
  | { ok: false; error: 'not_found' | 'not_eligible' | 'already_requested' };

/**
 * Atomic create — validates eligibility (log belongs to user, is a paid
 * extension with amount > 0) then INSERTs. UNIQUE on extension_log_id makes
 * a second insert raise 23505 which we surface as `already_requested`.
 */
export async function requestInvoice(
  userId: number,
  extensionLogId: number
): Promise<RequestInvoiceResult> {
  // 1) Verify log exists, belongs to user, is paid-eligible
  const log = await pool.query<{
    user_id: number;
    approval_method: string;
    amount: string | null;
  }>(
    `SELECT user_id, approval_method, amount
       FROM subscription_extension_logs
      WHERE id = $1`,
    [extensionLogId]
  );
  if (log.rowCount === 0) return { ok: false, error: 'not_found' };
  if (log.rows[0].user_id !== userId) return { ok: false, error: 'not_found' };
  if (
    !PAID_METHODS.includes(log.rows[0].approval_method as any) ||
    log.rows[0].amount == null ||
    parseFloat(log.rows[0].amount) <= 0
  ) {
    return { ok: false, error: 'not_eligible' };
  }

  // 2) INSERT (UNIQUE on extension_log_id enforces 1-per-extension)
  try {
    const r = await pool.query<{ id: number; status: InvoiceStatus; requested_at: string }>(
      `INSERT INTO tax_invoice_requests (extension_log_id, user_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, status, requested_at`,
      [extensionLogId, userId]
    );
    return { ok: true, request: r.rows[0] };
  } catch (e: any) {
    // 23505 = unique_violation → already requested
    if (e?.code === '23505') return { ok: false, error: 'already_requested' };
    throw e;
  }
}

export interface AdminInvoiceFilter {
  status?: 'all' | InvoiceStatus;
  q?: string;            // search on user email
  limit?: number;
  offset?: number;
}

export interface AdminInvoiceRow {
  id: number;
  status: InvoiceStatus;
  requested_at: string;
  reviewed_at: string | null;
  admin_notes: string | null;
  invoice_url: string | null;          // BE proxy path (FE-friendly), not raw OBS key
  user_id: number;
  user_email: string;
  log_id: number;
  log_days_added: number;
  log_amount: string;
  log_subtotal: number | null;
  log_created_at: string;
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

/**
 * Paginated admin list. Joins user + extension_log + user_bank_accounts (for
 * the user's saved tax info — admin needs it to type up the invoice).
 */
export async function listForAdmin(opts: AdminInvoiceFilter): Promise<{
  rows: AdminInvoiceRow[];
  total: number;
}> {
  const status = opts.status ?? 'all';
  const q = (opts.q ?? '').trim();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const where: string[] = [];
  const params: any[] = [];
  if (status !== 'all') {
    params.push(status);
    where.push(`tir.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`u.email ILIKE $${params.length}`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countRes = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
       FROM tax_invoice_requests tir
       JOIN users u ON u.id = tir.user_id
       ${whereSql}`,
    params
  );
  const total = parseInt(countRes.rows[0].c, 10) || 0;

  params.push(limit, offset);
  const r = await pool.query<any>(
    `SELECT tir.id, tir.status, tir.requested_at, tir.reviewed_at,
            tir.admin_notes, tir.invoice_url,
            u.id AS user_id, u.email AS user_email,
            sel.id AS log_id, sel.days_added AS log_days_added,
            sel.amount AS log_amount, sel.subtotal AS log_subtotal,
            sel.created_at AS log_created_at,
            uba.entity_type, uba.title_prefix, uba.tax_name, uba.tax_id,
            uba.address_line, uba.subdistrict, uba.district, uba.province,
            uba.postal_code, uba.tax_branch
       FROM tax_invoice_requests tir
       JOIN users u ON u.id = tir.user_id
       JOIN subscription_extension_logs sel ON sel.id = tir.extension_log_id
       LEFT JOIN user_bank_accounts uba ON uba.user_id = tir.user_id
       ${whereSql}
       ORDER BY tir.requested_at DESC, tir.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    rows: r.rows.map((row) => ({
      id: row.id,
      status: row.status,
      requested_at: row.requested_at,
      reviewed_at: row.reviewed_at,
      admin_notes: row.admin_notes,
      invoice_url: row.invoice_url ? `/api/admin/tax-invoices/${row.id}/file` : null,
      user_id: row.user_id,
      user_email: row.user_email,
      log_id: row.log_id,
      log_days_added: row.log_days_added,
      log_amount: row.log_amount,
      log_subtotal: row.log_subtotal != null ? Number(row.log_subtotal) : null,
      log_created_at: row.log_created_at,
      tax_info: row.tax_name || row.tax_id || row.address_line
        ? {
            entity_type: row.entity_type,
            title_prefix: row.title_prefix,
            tax_name: row.tax_name,
            tax_id: row.tax_id,
            address_line: row.address_line,
            subdistrict: row.subdistrict,
            district: row.district,
            province: row.province,
            postal_code: row.postal_code,
            tax_branch: row.tax_branch,
          }
        : null,
    })),
    total,
  };
}

/** Pre-check + lookup a single request (used by upload/reject/proxy handlers). */
export async function getRequest(requestId: number): Promise<{
  id: number;
  user_id: number;
  status: InvoiceStatus;
  invoice_url: string | null;
} | null> {
  const r = await pool.query<{ id: number; user_id: number; status: InvoiceStatus; invoice_url: string | null }>(
    `SELECT id, user_id, status, invoice_url FROM tax_invoice_requests WHERE id = $1`,
    [requestId]
  );
  return r.rows[0] ?? null;
}

/**
 * Upload an invoice file for a pending/issued request.
 * - Fixed key per request → `tax-invoices/{requestId}/invoice` (no extension).
 * - status → 'issued', clears any rejection note that was set.
 * - Returns the (now-updated) row for the admin caller.
 */
export async function uploadInvoice(
  requestId: number,
  adminId: number,
  buffer: Buffer,
  mimetype: string,
  originalname: string,
): Promise<{ invoice_url: string }> {
  if (getBucketName()) {
    const key = `tax-invoices/${requestId}/invoice`;
    await uploadFile(buffer, key, mimetype, { contentDisposition: 'inline' });
    await pool.query(
      `UPDATE tax_invoice_requests
          SET invoice_url = $1, invoice_uploaded_at = NOW(),
              status = 'issued', reviewed_admin_id = $2, reviewed_at = NOW(),
              admin_notes = CASE WHEN status = 'rejected' THEN NULL ELSE admin_notes END
        WHERE id = $3`,
      [key, adminId, requestId]
    );
    return { invoice_url: key };
  }

  // Local-dev fallback: strip any old file with same prefix, write fresh with mime-derived ext
  const dir = path.join(process.cwd(), 'uploads', 'tax-invoices', String(requestId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('invoice')) fs.unlinkSync(path.join(dir, f));
  }
  const ext = path.extname(originalname).toLowerCase() ||
    (mimetype === 'application/pdf' ? '.pdf' : '.bin');
  const filename = `invoice${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  const localPath = `/uploads/tax-invoices/${requestId}/${filename}`;
  await pool.query(
    `UPDATE tax_invoice_requests
        SET invoice_url = $1, invoice_uploaded_at = NOW(),
            status = 'issued', reviewed_admin_id = $2, reviewed_at = NOW()
      WHERE id = $3`,
    [localPath, adminId, requestId]
  );
  return { invoice_url: localPath };
}

/** Reject a pending request with admin_notes. Cannot reject an issued one. */
export async function rejectInvoice(
  requestId: number,
  adminId: number,
  notes: string,
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'already_issued' }> {
  const r = await pool.query<{ status: InvoiceStatus }>(
    `SELECT status FROM tax_invoice_requests WHERE id = $1`,
    [requestId]
  );
  if (r.rowCount === 0) return { ok: false, error: 'not_found' };
  if (r.rows[0].status === 'issued') return { ok: false, error: 'already_issued' };

  await pool.query(
    `UPDATE tax_invoice_requests
        SET status = 'rejected', reviewed_admin_id = $1, reviewed_at = NOW(),
            admin_notes = $2
      WHERE id = $3`,
    [adminId, notes, requestId]
  );
  return { ok: true };
}
