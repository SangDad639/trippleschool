/**
 * One-shot backfill: create the missing affiliate commission for
 * aet121@gmail.com (referrer) ← test1405aff@gmail.com (referee).
 *
 * Background: test1405aff registered with refcode `ac780e16` (aet121) and was
 * extended to a yearly plan by an admin before the slipUrl gate was lifted in
 * server/src/routes/admin.ts (2026-05-14). The extend wrote no row to
 * affiliate_commissions, so aet121's Pending Payouts stayed empty.
 *
 * This script:
 *   1. Looks up both users + verifies the referrer link
 *   2. Reads the latest admin-extend log for test1405aff to derive the
 *      period_end day (for the idempotency key) + the actual subtotal that
 *      was paid (admin may have used the yearly promo ฿2,800 base instead
 *      of full ฿3,000).
 *   3. Calls createAffiliateCommission with the same key the live admin
 *      route would have used (`admin_extend_<id>_<plan>_<periodKey>`), so a
 *      future admin extend in the same period won't double-pay (the unique
 *      constraint on (referee_id, stripe_invoice_id) blocks it).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/backfill-aet121-commission.ts
 *
 * Idempotent: rerunning logs "Commission already exists" instead of
 * inserting a duplicate.
 */

import pg from 'pg';
const { Pool } = pg;

const REFERRER_EMAIL = 'aet121@gmail.com';
const REFEREE_EMAIL = 'test1405aff@gmail.com';

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log(`Backfilling commission for ${REFERRER_EMAIL} ← ${REFEREE_EMAIL}`);

  // 1) Look up users
  const userResult = await pool.query(
    `SELECT id, email, referrer_id, subscription_expires_at
       FROM users
      WHERE email IN ($1, $2)`,
    [REFERRER_EMAIL, REFEREE_EMAIL]
  );

  const referrer = userResult.rows.find((u) => u.email === REFERRER_EMAIL);
  const referee = userResult.rows.find((u) => u.email === REFEREE_EMAIL);

  if (!referrer) {
    console.error(`Referrer not found: ${REFERRER_EMAIL}`);
    process.exit(1);
  }
  if (!referee) {
    console.error(`Referee not found: ${REFEREE_EMAIL}`);
    process.exit(1);
  }

  console.log(`  referrer.id = ${referrer.id}`);
  console.log(`  referee.id = ${referee.id}, referrer_id = ${referee.referrer_id}`);

  if (referee.referrer_id !== referrer.id) {
    console.error(
      `Referee referrer_id (${referee.referrer_id}) does not match ${REFERRER_EMAIL} id (${referrer.id}). Aborting.`,
    );
    process.exit(1);
  }

  // 2) Find the latest admin-extend log for the referee.
  // approval_method='admin' covers the +30d/+365d quick-action + Adjust Days
  // flows. Order by created_at DESC to get the most recent extension.
  const logResult = await pool.query(
    `SELECT id, days_added, amount, subtotal, created_at
       FROM subscription_extension_logs
      WHERE user_id = $1 AND approval_method = 'admin'
      ORDER BY created_at DESC
      LIMIT 1`,
    [referee.id]
  );

  if (logResult.rows.length === 0) {
    console.error(`No admin-extend log found for ${REFEREE_EMAIL}. Aborting.`);
    process.exit(1);
  }

  const log = logResult.rows[0];
  console.log(`  Latest admin extend: +${log.days_added}d, total=฿${log.amount}, subtotal=฿${log.subtotal}, at ${log.created_at}`);

  // Derive plan slug from days_added (matches BE resolver fallback).
  const planSlug: string = log.days_added >= 365 ? 'yearly' : 'monthly';

  // Period key = the user's current expiry day, mirroring admin.ts:555
  // (`newExpiry.toISOString().slice(0, 10)`). For backfill we use the
  // referee's current subscription_expires_at since that IS the period_end
  // the admin extend produced.
  const expiry = referee.subscription_expires_at
    ? new Date(referee.subscription_expires_at)
    : null;
  if (!expiry) {
    console.error(`Referee has no subscription_expires_at. Aborting.`);
    process.exit(1);
  }
  const periodKey = expiry.toISOString().slice(0, 10);
  const invoiceKey = `admin_extend_${referee.id}_${planSlug}_${periodKey}`;
  console.log(`  Idempotency key: ${invoiceKey}`);

  // 3) Pre-check for existing commission (mirrors createAffiliateCommission
  // duplicate guard). Stops short of relying on ON CONFLICT so we can print
  // a friendly message.
  const existing = await pool.query(
    `SELECT id, status FROM affiliate_commissions
      WHERE referee_id = $1 AND stripe_invoice_id = $2`,
    [referee.id, invoiceKey]
  );
  if (existing.rows.length > 0) {
    console.log(`  ✓ Commission already exists (id=${existing.rows[0].id}, status=${existing.rows[0].status}). Nothing to do.`);
    return;
  }

  // 4) Resolve commission_percent via the same chain createAffiliateCommission
  // uses. We replicate the simpler path: user_snapshot → tier → settings → 20%.
  // The matrix/plan overrides are stored in `commission_overrides` (per
  // user × plan) — check that first.
  let commissionPercent: number | null = null;
  let source = 'default';

  // (a) per (referrer × plan) override matrix
  const matrixRes = await pool.query(
    `SELECT commission_percent
       FROM commission_overrides
      WHERE user_id = $1 AND plan_slug = $2`,
    [referrer.id, planSlug]
  ).catch(() => ({ rows: [] as any[] }));
  if (matrixRes.rows[0]?.commission_percent != null) {
    commissionPercent = parseFloat(matrixRes.rows[0].commission_percent);
    source = 'matrix';
  }

  // (b) plan-level commission_percent
  if (commissionPercent == null) {
    const planRes = await pool.query(
      `SELECT commission_percent FROM subscription_plans WHERE slug = $1`,
      [planSlug]
    ).catch(() => ({ rows: [] as any[] }));
    if (planRes.rows[0]?.commission_percent != null) {
      commissionPercent = parseFloat(planRes.rows[0].commission_percent);
      source = 'plan';
    }
  }

  // (c) user snapshot on users.commission_percent
  if (commissionPercent == null) {
    const userRes = await pool.query(
      `SELECT commission_percent FROM users WHERE id = $1`,
      [referrer.id]
    );
    if (userRes.rows[0]?.commission_percent != null) {
      commissionPercent = parseFloat(userRes.rows[0].commission_percent);
      source = 'user_snapshot';
    }
  }

  // (d) tier
  if (commissionPercent == null) {
    const tierRes = await pool.query(
      `SELECT t.commission_percent
         FROM users u
         JOIN affiliate_tiers t ON t.id = u.affiliate_tier
        WHERE u.id = $1`,
      [referrer.id]
    ).catch(() => ({ rows: [] as any[] }));
    if (tierRes.rows[0]?.commission_percent != null) {
      commissionPercent = parseFloat(tierRes.rows[0].commission_percent);
      source = 'tier';
    }
  }

  // (e) settings fallback
  if (commissionPercent == null) {
    const settingsRes = await pool.query(
      `SELECT tier1_percent FROM affiliate_settings WHERE id = 1`
    ).catch(() => ({ rows: [] as any[] }));
    if (settingsRes.rows[0]?.tier1_percent != null) {
      commissionPercent = parseFloat(settingsRes.rows[0].tier1_percent);
      source = 'settings';
    }
  }

  if (commissionPercent == null) commissionPercent = 20;

  console.log(`  commission_percent = ${commissionPercent}% (source=${source})`);

  // 5) WHT rate (Thai brokerage 3% default, settings override)
  let whtRate = 3.0;
  const whtRes = await pool.query(
    `SELECT wht_rate_default FROM affiliate_settings WHERE id = 1`
  ).catch(() => ({ rows: [] as any[] }));
  if (whtRes.rows[0]?.wht_rate_default != null) {
    whtRate = parseFloat(whtRes.rows[0].wht_rate_default);
  }

  // 6) Compute amounts. Subtotal from the log (the pre-VAT base). If the log
  // didn't capture subtotal (older row), fall back to deriving from amount.
  const subtotal = log.subtotal != null
    ? parseFloat(log.subtotal)
    : +(parseFloat(log.amount) / 1.07).toFixed(2);

  const commissionAmount = +(subtotal * commissionPercent / 100).toFixed(2);
  const whtAmount = +(commissionAmount * whtRate / 100).toFixed(2);
  const netAmount = +(commissionAmount - whtAmount).toFixed(2);

  console.log(`  subtotal=฿${subtotal}, commission=฿${commissionAmount} (${commissionPercent}%), WHT=฿${whtAmount} (${whtRate}%), net=฿${netAmount}`);

  // 7) INSERT (using ON CONFLICT DO NOTHING for safety even though we already
  // pre-checked above).
  const insertRes = await pool.query(
    `INSERT INTO affiliate_commissions
        (referrer_id, referee_id, stripe_invoice_id, amount, currency,
         commission_percent, wht_rate, wht_amount, net_amount, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
     ON CONFLICT (referee_id, stripe_invoice_id) DO NOTHING
     RETURNING id, status`,
    [
      referrer.id,
      referee.id,
      invoiceKey,
      String(commissionAmount),
      'THB',
      commissionPercent,
      whtRate,
      whtAmount,
      netAmount,
    ]
  );

  if (insertRes.rows.length === 0) {
    console.log(`  ✓ Insert skipped (ON CONFLICT) — row already present.`);
  } else {
    console.log(`  ✓ Created commission id=${insertRes.rows[0].id} status=${insertRes.rows[0].status}`);
  }

  console.log('\nDone. Login as aet121 and check /profile → Affiliate, or as admin → /admin → Affiliate Data → Pending Payouts.');
}

main()
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
