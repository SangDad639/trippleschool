-- Migration 013: Tax invoice request system
--
-- Member-driven workflow: user clicks "ขอใบกำกับภาษี" on a row from their
-- payment history (/profile → Payment History) → row inserted with status
-- 'pending' → admin sees it under /admin → ใบกำกับภาษี tab → admin uploads
-- PDF/image → status flips to 'issued' (or 'rejected' + admin_notes).
--
-- Per-request file lives at OBS key `tax-invoices/{request_id}/invoice`
-- (no extension → same-key overwrite when admin needs to fix a typo).
-- BE proxy `/api/subscription/tax-invoice/:id/file` streams with auth and
-- `Content-Disposition: inline` (or `attachment` for download).
--
-- Constraints (per design 2026-05-14):
--   • 1 invoice / 1 extension       UNIQUE (extension_log_id)
--   • Allowed statuses              CHECK status IN ('pending','issued','rejected')
--   • issued ⇒ invoice_url required CHECK constraint
--   • ON DELETE CASCADE             follow extension_log + user lifecycle

CREATE TABLE IF NOT EXISTS tax_invoice_requests (
  id                   SERIAL PRIMARY KEY,
  extension_log_id     INTEGER NOT NULL UNIQUE
                         REFERENCES subscription_extension_logs(id) ON DELETE CASCADE,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','issued','rejected')),
  requested_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Admin action fields (all NULL while status='pending')
  reviewed_admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at          TIMESTAMP,
  admin_notes          TEXT,
  -- Issued: OBS key (fixed per request)
  invoice_url          TEXT,
  invoice_uploaded_at  TIMESTAMP,
  CONSTRAINT issued_has_url CHECK (
    (status <> 'issued') OR (invoice_url IS NOT NULL)
  )
);

-- User-side: /profile Payment History fetch (sorts by recency)
CREATE INDEX IF NOT EXISTS idx_invoice_req_user
  ON tax_invoice_requests (user_id, requested_at DESC);

-- Admin-side hot path: pending queue
CREATE INDEX IF NOT EXISTS idx_invoice_req_pending
  ON tax_invoice_requests (requested_at DESC) WHERE status = 'pending';
