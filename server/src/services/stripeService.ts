import pool from '../db.js';
import { resolveCommissionPercent } from './commissionService.js';
import { maybePromoteOnPurchase } from './tierAssignmentService.js';

/**
 * Check if user has an active subscription (membership).
 *
 * Stripe has been removed — subscription validity is driven solely by
 * `users.subscription_expires_at`, set when a bank-transfer/PromptPay slip is
 * verified (Thunder OCR auto-approve) or extended by an admin.
 */
export async function hasActiveSubscription(userId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM users
     WHERE id = $1 AND subscription_expires_at > NOW()
     LIMIT 1`,
    [userId]
  );
  return result.rows.length > 0;
}

/**
 * Create affiliate commission when a referred user makes a payment
 * Commission is calculated as percentage of the payment amount
 *
 * Resolution order for `commission_percent` is delegated to commissionService —
 * see resolveCommissionPercent() for the full precedence chain (matrix → plan
 * default → legacy user snapshot → tier → settings → 20% default).
 *
 * @param userId - The user who made the payment
 * @param stripeInvoiceId - A unique-per-payment identifier (kept name for the
 *                          affiliate_commissions.stripe_invoice_id column)
 * @param paymentAmountCents - Payment amount in cents
 * @param currency - Payment currency (e.g., 'usd', 'thb')
 * @param planSlug - Optional. Caller passes this when known so we can apply
 *                   per-plan commission overrides + the per-(user × plan) matrix.
 */
export async function createAffiliateCommission(
  userId: number,
  stripeInvoiceId: string,
  paymentAmountCents: number,
  currency: string,
  planSlug?: string
): Promise<void> {
  console.log(`[Affiliate] Creating commission for user ${userId}, invoice ${stripeInvoiceId}, amount ${paymentAmountCents} cents`);

  try {
    // 1) Has referrer?
    const userResult = await pool.query(
      'SELECT referrer_id FROM users WHERE id = $1',
      [userId]
    );

    console.log(`[Affiliate] User ${userId} referrer_id:`, userResult.rows[0]?.referrer_id);

    if (!userResult.rows[0]?.referrer_id) {
      console.log(`[Affiliate] User ${userId} has no referrer, skipping`);
      return; // No referrer, skip
    }

    const referrerId = userResult.rows[0].referrer_id;

    // 2) Determine commission % via the canonical resolution chain.
    //    Sources, in precedence order: matrix → plan → user_snapshot → tier → settings → default.
    const resolved = await resolveCommissionPercent({
      referrerId,
      planSlug: planSlug ?? null,
    });
    const commissionPercent = resolved.percent;
    console.log(`[Affiliate] commission_percent resolved: ${commissionPercent}% (source=${resolved.source})`);

    // Check if commission already exists for this invoice
    const existingCommission = await pool.query(
      'SELECT id FROM affiliate_commissions WHERE referee_id = $1 AND stripe_invoice_id = $2',
      [userId, stripeInvoiceId]
    );

    if (existingCommission.rows.length > 0) {
      console.log(`[Affiliate] Commission already exists for invoice ${stripeInvoiceId}, skipping`);
      return; // Commission already exists for this invoice
    }

    // Resolve the WHT rate from settings (fallback to 3% per Thai tax law for
    // commission/brokerage). Snapshotted onto the row so a future rate change
    // doesn't retroactively alter pending commissions.
    let whtRate = 3.0;
    const whtSettings = await pool.query(
      'SELECT wht_rate_default FROM affiliate_settings WHERE id = 1'
    );
    if (whtSettings.rows[0]?.wht_rate_default != null) {
      whtRate = parseFloat(whtSettings.rows[0].wht_rate_default);
    }

    // Calculate commission amount + WHT breakdown.
    //   amount     = gross commission (before tax) — preserves legacy semantic
    //   wht_amount = amount × wht_rate% (we withhold + remit to Revenue Dept)
    //   net_amount = amount − wht_amount (what admin pays the affiliate)
    const paymentAmount = paymentAmountCents / 100; // currency units
    const commissionAmount = +(paymentAmount * (commissionPercent / 100)).toFixed(2);
    const whtAmount = +(commissionAmount * (whtRate / 100)).toFixed(2);
    const netAmount = +(commissionAmount - whtAmount).toFixed(2);

    // Create commission record with payment + tax breakdown
    const commissionResult = await pool.query(`
      INSERT INTO affiliate_commissions
        (referrer_id, referee_id, stripe_invoice_id, payment_amount, commission_percent,
         amount, currency, status, wht_rate, wht_amount, net_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)
      ON CONFLICT (referee_id, stripe_invoice_id) DO NOTHING
      RETURNING id
    `, [
      referrerId, userId, stripeInvoiceId,
      paymentAmount, commissionPercent, commissionAmount,
      currency.toLowerCase(),
      whtRate, whtAmount, netAmount,
    ]);

    if (commissionResult.rows.length === 0) {
      return; // Commission already existed or insert failed
    }

    const commissionId = commissionResult.rows[0].id;
    console.log(
      `[Affiliate] Created commission ${commissionId}: ` +
      `${commissionPercent}% of ${paymentAmount} ${currency.toUpperCase()} = ` +
      `${commissionAmount.toFixed(2)} gross − ${whtAmount.toFixed(2)} WHT(${whtRate}%) = ` +
      `${netAmount.toFixed(2)} net ${currency.toUpperCase()}`
    );

    // Best-effort tier promotion on purchase. Never blocks the caller, never demotes.
    if (planSlug) {
      try {
        const promo = await maybePromoteOnPurchase({ userId, planSlug });
        if (promo.changed) {
          console.log(
            `[TierAssign] user ${userId} promoted on purchase: ` +
            `tier ${promo.previousTierId ?? 'none'} → ${promo.newTierId}`
          );
        }
      } catch (tierErr) {
        console.error('[TierAssign] failed:', tierErr);
      }
    }
  } catch (error) {
    console.error('[Affiliate] Error creating commission:', error);
  }
}
