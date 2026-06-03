/**
 * Subscription Check Job
 *
 * Runs every hour to check and sync subscription status with Stripe.
 * Updates local DB when subscriptions expire or status changes.
 */

import pool from '../db.js';
import cron from 'node-cron';
import { getStripe } from '../services/stripeService.js';

async function checkSubscriptions(): Promise<void> {
  console.log('📅 [SubscriptionCheck] Starting check...');

  try {
    // Find Stripe subscriptions that may have expired (still marked active but period ended)
    const expiredStripe = await pool.query(`
      SELECT s.id, s.user_id, s.stripe_subscription_id, s.status, s.current_period_end
      FROM subscriptions s
      WHERE s.status = 'active'
        AND s.current_period_end < NOW()
        AND s.stripe_subscription_id IS NOT NULL
    `);

    console.log(`📅 [SubscriptionCheck] Found ${expiredStripe.rows.length} potentially expired Stripe subscriptions`);

    let updatedCount = 0;

    for (const sub of expiredStripe.rows) {
      try {
        // Verify with Stripe
        const stripeSub = await getStripe().subscriptions.retrieve(sub.stripe_subscription_id);

        if (stripeSub.status !== 'active') {
          // Update local DB
          await pool.query(
            `UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE id = $2`,
            [stripeSub.status, sub.id]
          );
          console.log(`📅 [SubscriptionCheck] Updated user ${sub.user_id} subscription to ${stripeSub.status}`);
          updatedCount++;
        }
      } catch (stripeError: any) {
        // Subscription might be deleted in Stripe
        if (stripeError.code === 'resource_missing') {
          await pool.query(
            `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE id = $1`,
            [sub.id]
          );
          console.log(`📅 [SubscriptionCheck] Marked subscription ${sub.id} as canceled (not found in Stripe)`);
          updatedCount++;
        } else {
          console.error(`📅 [SubscriptionCheck] Stripe error for user ${sub.user_id}:`, stripeError.message);
        }
      }
    }

    // Log summary of subscription status
    const summary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE
          (s.status = 'active' AND s.current_period_end > NOW()) OR
          (u.subscription_expires_at > NOW())
        ) as active_count,
        COUNT(*) FILTER (WHERE
          s.status IS NULL AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at <= NOW())
        ) as no_sub_count,
        COUNT(*) FILTER (WHERE
          (s.status != 'active' OR s.current_period_end <= NOW()) AND
          (u.subscription_expires_at IS NULL OR u.subscription_expires_at <= NOW())
          AND s.status IS NOT NULL
        ) as expired_count
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id
      WHERE u.is_admin = false
    `);

    console.log(`📅 [SubscriptionCheck] Summary: Active=${summary.rows[0].active_count || 0}, No Sub=${summary.rows[0].no_sub_count || 0}, Expired=${summary.rows[0].expired_count || 0}, Updated=${updatedCount}`);

  } catch (error) {
    console.error('📅 [SubscriptionCheck] Error:', error);
  }
}

export function startSubscriptionCheckJob(): void {
  console.log('📅 Subscription Check Job scheduled');
  console.log('   Schedule: Every hour');
  console.log('   Action: Sync expired subscriptions from Stripe');

  // Run every hour at minute 0
  cron.schedule('0 * * * *', () => {
    checkSubscriptions();
  }, {
    timezone: 'Asia/Bangkok'
  });

  // Run once on startup after 30 seconds
  setTimeout(() => {
    console.log('📅 [SubscriptionCheck] Running initial check...');
    checkSubscriptions();
  }, 30000);
}

export default { startSubscriptionCheckJob };
