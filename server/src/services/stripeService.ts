import Stripe from 'stripe';
import pool from '../db.js';
import { resolveCommissionPercent } from './commissionService.js';
import { maybePromoteOnPurchase } from './tierAssignmentService.js';

// Initialize Stripe lazily (only when key is available)
let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

export interface SubscriptionInfo {
  id: number;
  userId: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  planType: 'monthly' | 'yearly';
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Get or create Stripe customer for user
 */
export async function getOrCreateStripeCustomer(userId: number, email: string): Promise<string> {
  // Check if user already has a Stripe customer
  const result = await pool.query(
    'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 LIMIT 1',
    [userId]
  );

  if (result.rows.length > 0 && result.rows[0].stripe_customer_id) {
    return result.rows[0].stripe_customer_id;
  }

  // Create new Stripe customer
  const customer = await getStripe().customers.create({
    email,
    metadata: { userId: userId.toString() }
  });

  return customer.id;
}

/**
 * Create Stripe Checkout session
 */
export async function createCheckoutSession(
  userId: number,
  email: string,
  planType: 'monthly' | 'yearly'
): Promise<string> {
  const customerId = await getOrCreateStripeCustomer(userId, email);

  const priceId = planType === 'monthly'
    ? process.env.STRIPE_PRICE_MONTHLY
    : process.env.STRIPE_PRICE_YEARLY;

  if (!priceId) {
    throw new Error(`Price ID for ${planType} plan not configured`);
  }

  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{
      price: priceId,
      quantity: 1,
    }],
    success_url: `${process.env.STRIPE_SUCCESS_URL || process.env.FRONTEND_URL + '/subscription/success'}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: process.env.STRIPE_CANCEL_URL || process.env.FRONTEND_URL + '/subscription',
    metadata: {
      userId: userId.toString(),
      planType,
    },
    // Use Stripe Tax for automatic tax calculation by country
    // Configure tax registrations in Stripe Dashboard > Settings > Tax
    automatic_tax: { enabled: !!process.env.STRIPE_TAX_ENABLED },
    subscription_data: {
      // Fallback: manual tax rate (same for all customers)
      ...(process.env.STRIPE_TAX_RATE_ID && !process.env.STRIPE_TAX_ENABLED && {
        default_tax_rates: [process.env.STRIPE_TAX_RATE_ID],
      }),
      metadata: {
        userId: userId.toString(),
        planType,
      }
    }
  });

  return session.url!;
}

/**
 * Get user subscription info
 */
export async function getUserSubscription(userId: number): Promise<SubscriptionInfo | null> {
  const result = await pool.query(
    `SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    planType: row.plan_type,
    status: row.status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  };
}

/**
 * Check if user has active subscription
 * Checks both Stripe subscription AND manual admin extension (users.subscription_expires_at)
 */
export async function hasActiveSubscription(userId: number): Promise<boolean> {
  // Check Stripe subscription first
  const stripeResult = await pool.query(
    `SELECT id FROM subscriptions
     WHERE user_id = $1 AND status = 'active'
     AND current_period_end > NOW()
     LIMIT 1`,
    [userId]
  );
  if (stripeResult.rows.length > 0) return true;

  // Check manual admin extension (users.subscription_expires_at)
  const manualResult = await pool.query(
    `SELECT id FROM users
     WHERE id = $1 AND subscription_expires_at > NOW()
     LIMIT 1`,
    [userId]
  );
  return manualResult.rows.length > 0;
}

/**
 * Handle webhook: subscription created/updated
 */
export async function handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
  const userId = parseInt(subscription.metadata.userId);
  const customerId = subscription.customer as string;

  if (!userId || isNaN(userId)) {
    console.error('[Stripe] No valid userId in subscription metadata');
    return;
  }

  // Determine plan type from actual price ID (not metadata, which may be stale)
  const currentPriceId = subscription.items.data[0]?.price.id;
  let planType: 'monthly' | 'yearly' = subscription.metadata.planType as any || 'monthly';
  if (currentPriceId === process.env.STRIPE_PRICE_MONTHLY) {
    planType = 'monthly';
  } else if (currentPriceId === process.env.STRIPE_PRICE_YEARLY) {
    planType = 'yearly';
  }

  const existingSubscription = await pool.query(
    'SELECT id FROM subscriptions WHERE stripe_subscription_id = $1',
    [subscription.id]
  );

  // Extract period timestamps from subscription items (Stripe SDK v2+ moved these to items)
  const item = subscription.items?.data?.[0];
  const periodStart = (item as any)?.current_period_start ?? (subscription as any).current_period_start;
  const periodEnd = (item as any)?.current_period_end ?? (subscription as any).current_period_end;

  if (existingSubscription.rows.length > 0) {
    // Update existing subscription (including plan_type and price)
    await pool.query(
      `UPDATE subscriptions SET
        plan_type = $1,
        stripe_price_id = $2,
        status = $3,
        current_period_start = to_timestamp($4),
        current_period_end = to_timestamp($5),
        cancel_at_period_end = $6,
        updated_at = NOW()
       WHERE stripe_subscription_id = $7`,
      [
        planType,
        currentPriceId,
        subscription.status,
        periodStart,
        periodEnd,
        subscription.cancel_at_period_end,
        subscription.id
      ]
    );
    console.log(`[Stripe] Updated subscription ${subscription.id}: plan=${planType}, status=${subscription.status}`);
  } else {
    // Insert new subscription
    await pool.query(
      `INSERT INTO subscriptions
       (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan_type, status, current_period_start, current_period_end, cancel_at_period_end)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7), to_timestamp($8), $9)`,
      [
        userId,
        customerId,
        subscription.id,
        currentPriceId,
        planType,
        subscription.status,
        periodStart,
        periodEnd,
        subscription.cancel_at_period_end
      ]
    );
    console.log(`[Stripe] Created subscription ${subscription.id} for user ${userId}`);
  }

  // Sync subscription_expires_at to users table for admin panel
  if (subscription.status === 'active') {
    await pool.query(
      'UPDATE users SET subscription_expires_at = to_timestamp($1) WHERE id = $2',
      [periodEnd, userId]
    );
    // Note: Affiliate commission is now created in invoice.payment_succeeded handler
    // to support recurring payments (not just initial subscription)
  }
}

/**
 * Create affiliate commission when a referred user makes a payment
 * Commission is calculated as percentage of the payment amount
 * Called from invoice.payment_succeeded webhook for both initial and renewal payments
 *
 * Resolution order for `commission_percent` is delegated to commissionService —
 * see resolveCommissionPercent() for the full precedence chain (matrix → plan
 * default → legacy user snapshot → tier → settings → 20% default).
 *
 * @param userId - The user who made the payment
 * @param stripeInvoiceId - The Stripe invoice ID (unique per payment)
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

    // Plug Stripe-path tier promotion gap. Bank slip + admin extend already
    // call this; Stripe webhook previously didn't → buyers who paid via Stripe
    // never got promoted to their plan's tier_id. Best-effort: never blocks the
    // webhook response, never demotes.
    if (planSlug) {
      try {
        const promo = await maybePromoteOnPurchase({ userId, planSlug });
        if (promo.changed) {
          console.log(
            `[Stripe→TierAssign] user ${userId} promoted on Stripe purchase: ` +
            `tier ${promo.previousTierId ?? 'none'} → ${promo.newTierId}`
          );
        }
      } catch (tierErr) {
        console.error('[Stripe→TierAssign] failed:', tierErr);
      }
    }
  } catch (error) {
    console.error('[Affiliate] Error creating commission:', error);
  }
}

/**
 * Handle webhook: subscription deleted
 */
export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  await pool.query(
    `UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [subscription.id]
  );
  console.log(`[Stripe] Subscription ${subscription.id} canceled`);
}

/**
 * Cancel subscription (at period end)
 */
export async function cancelSubscription(userId: number): Promise<boolean> {
  const sub = await getUserSubscription(userId);
  if (!sub || !sub.stripeSubscriptionId) return false;

  await getStripe().subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: true
  });

  await pool.query(
    `UPDATE subscriptions SET cancel_at_period_end = true, updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [sub.stripeSubscriptionId]
  );

  console.log(`[Stripe] Subscription ${sub.stripeSubscriptionId} set to cancel at period end`);
  return true;
}

/**
 * Reactivate subscription (undo cancel)
 */
export async function reactivateSubscription(userId: number): Promise<boolean> {
  const sub = await getUserSubscription(userId);
  if (!sub || !sub.stripeSubscriptionId) return false;

  await getStripe().subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: false
  });

  await pool.query(
    `UPDATE subscriptions SET cancel_at_period_end = false, updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [sub.stripeSubscriptionId]
  );

  return true;
}

/**
 * Change subscription plan (upgrade/downgrade)
 */
export async function changePlan(userId: number, newPlanType: 'monthly' | 'yearly'): Promise<boolean> {
  const sub = await getUserSubscription(userId);
  if (!sub || !sub.stripeSubscriptionId) return false;

  const newPriceId = newPlanType === 'monthly'
    ? process.env.STRIPE_PRICE_MONTHLY
    : process.env.STRIPE_PRICE_YEARLY;

  if (!newPriceId) {
    throw new Error(`Price ID for ${newPlanType} plan not configured`);
  }

  // Get current subscription from Stripe
  const stripeSub = await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId);
  const currentItemId = stripeSub.items.data[0]?.id;

  if (!currentItemId) {
    throw new Error('No subscription item found');
  }

  // Update subscription with new price (prorate by default)
  const updated = await getStripe().subscriptions.update(sub.stripeSubscriptionId, {
    items: [{
      id: currentItemId,
      price: newPriceId,
    }],
    proration_behavior: 'create_prorations',
    metadata: {
      userId: userId.toString(),
      planType: newPlanType,
    },
  });

  // Update local DB
  const item = updated.items?.data?.[0];
  const periodEnd = (item as any)?.current_period_end ?? (updated as any).current_period_end;

  await pool.query(
    `UPDATE subscriptions SET
      plan_type = $1,
      stripe_price_id = $2,
      status = $3,
      current_period_end = to_timestamp($4),
      cancel_at_period_end = false,
      updated_at = NOW()
     WHERE stripe_subscription_id = $5`,
    [newPlanType, newPriceId, updated.status, periodEnd, sub.stripeSubscriptionId]
  );

  console.log(`[Stripe] Changed plan for user ${userId} to ${newPlanType}`);
  return true;
}

/**
 * Create billing portal session
 */
export async function createBillingPortalSession(userId: number): Promise<string | null> {
  const sub = await getUserSubscription(userId);
  if (!sub) return null;

  // Skip for admin bypass / non-real Stripe customers
  if (!sub.stripeCustomerId || !sub.stripeCustomerId.startsWith('cus_')) {
    throw new Error('Billing portal is not available for this account');
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: (process.env.FRONTEND_URL || 'http://localhost:8080') + '/subscription',
  });

  return session.url;
}

/**
 * Sync local DB subscription with actual Stripe data
 */
export async function syncSubscriptionFromStripe(userId: number): Promise<void> {
  const sub = await getUserSubscription(userId);
  if (!sub || !sub.stripeSubscriptionId) return;
  if (!sub.stripeCustomerId || !sub.stripeCustomerId.startsWith('cus_')) return;

  try {
    const stripeSub = await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId);
    const currentPriceId = stripeSub.items.data[0]?.price.id;

    // Determine plan type from Stripe's actual price
    let actualPlanType: 'monthly' | 'yearly' = sub.planType;
    if (currentPriceId === process.env.STRIPE_PRICE_MONTHLY) {
      actualPlanType = 'monthly';
    } else if (currentPriceId === process.env.STRIPE_PRICE_YEARLY) {
      actualPlanType = 'yearly';
    }

    const item = stripeSub.items?.data?.[0];
    const periodStart = (item as any)?.current_period_start ?? (stripeSub as any).current_period_start;
    const periodEnd = (item as any)?.current_period_end ?? (stripeSub as any).current_period_end;

    await pool.query(
      `UPDATE subscriptions SET
        plan_type = $1,
        stripe_price_id = $2,
        status = $3,
        current_period_start = to_timestamp($4),
        current_period_end = to_timestamp($5),
        cancel_at_period_end = $6,
        updated_at = NOW()
       WHERE stripe_subscription_id = $7`,
      [actualPlanType, currentPriceId, stripeSub.status, periodStart, periodEnd, stripeSub.cancel_at_period_end, sub.stripeSubscriptionId]
    );

    // Also sync users table for admin panel
    if (stripeSub.status === 'active' && periodEnd) {
      await pool.query(
        'UPDATE users SET subscription_expires_at = to_timestamp($1) WHERE id = $2',
        [periodEnd, userId]
      );
    }

    console.log(`[Stripe] Synced subscription for user ${userId}: plan=${actualPlanType}, status=${stripeSub.status}`);
  } catch (err) {
    console.error(`[Stripe] Failed to sync subscription for user ${userId}:`, err);
  }
}

/**
 * Create billing portal session for plan change (goes directly to update confirmation)
 */
export async function createPlanChangePortalSession(userId: number, newPlanType: 'monthly' | 'yearly'): Promise<string | null> {
  const sub = await getUserSubscription(userId);
  if (!sub || !sub.stripeSubscriptionId) return null;

  if (!sub.stripeCustomerId || !sub.stripeCustomerId.startsWith('cus_')) {
    throw new Error('Billing portal is not available for this account');
  }

  const newPriceId = newPlanType === 'monthly'
    ? process.env.STRIPE_PRICE_MONTHLY
    : process.env.STRIPE_PRICE_YEARLY;

  if (!newPriceId) {
    throw new Error(`Price ID for ${newPlanType} plan not configured`);
  }

  // Sync with Stripe first to avoid "no changes to confirm" error
  const stripeSub = await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId);
  const currentPriceId = stripeSub.items.data[0]?.price.id;

  // If already on the requested plan, sync DB and throw
  if (currentPriceId === newPriceId) {
    await syncSubscriptionFromStripe(userId);
    throw new Error('ALREADY_ON_PLAN');
  }

  const returnUrl = (process.env.FRONTEND_URL || 'http://localhost:8080') + '/subscription';

  const session = await getStripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: returnUrl,
    flow_data: {
      type: 'subscription_update_confirm',
      subscription_update_confirm: {
        subscription: sub.stripeSubscriptionId,
        items: [{
          id: stripeSub.items.data[0].id,
          price: newPriceId,
          quantity: 1,
        }],
      },
    },
  });

  return session.url;
}

export { getStripe };
