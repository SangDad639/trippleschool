/**
 * Subscription Notification Job
 *
 * Runs twice daily (9 AM and 6 PM Bangkok time) to send expiration warnings.
 * Sends notifications at: 7 days, 3 days, and 1 day before expiration.
 */

import pool from '../db.js';
import cron from 'node-cron';

interface UserExpiration {
  user_id: number;
  email: string;
  expires_at: Date;
  days_until_expiry: number;
  source: 'stripe' | 'manual';
}

async function getExpiringUsers(daysAhead: number): Promise<UserExpiration[]> {
  const result = await pool.query(`
    WITH expiration_info AS (
      SELECT
        u.id as user_id,
        u.email,
        COALESCE(
          CASE WHEN s.status = 'active' AND s.current_period_end > NOW() THEN s.current_period_end ELSE NULL END,
          CASE WHEN u.subscription_expires_at > NOW() THEN u.subscription_expires_at ELSE NULL END
        ) as expires_at,
        CASE
          WHEN s.status = 'active' AND s.current_period_end > NOW() THEN 'stripe'
          ELSE 'manual'
        END as source
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id
      WHERE u.is_admin = false
    )
    SELECT
      user_id, email, expires_at, source,
      EXTRACT(DAY FROM (expires_at - NOW())) as days_until_expiry
    FROM expiration_info
    WHERE expires_at IS NOT NULL
      AND expires_at > NOW()
      AND expires_at <= NOW() + INTERVAL '${daysAhead} days'
    ORDER BY expires_at ASC
  `);

  return result.rows;
}

async function sendNotification(
  userId: number,
  notificationType: string,
  expiresAt: Date
): Promise<boolean> {
  // Check if notification already sent
  const existing = await pool.query(`
    SELECT id FROM subscription_notifications
    WHERE user_id = $1 AND notification_type = $2 AND DATE(expires_at) = DATE($3)
  `, [userId, notificationType, expiresAt]);

  if (existing.rows.length > 0) {
    return false; // Already sent
  }

  // Insert notification record (in-app notification)
  await pool.query(`
    INSERT INTO subscription_notifications (user_id, notification_type, expires_at)
    VALUES ($1, $2, $3)
  `, [userId, notificationType, expiresAt]);

  return true;
}

async function processNotifications(): Promise<void> {
  console.log('🔔 [Notification] Processing subscription notifications...');

  try {
    let sent7d = 0, sent3d = 0, sent1d = 0;

    // Get users expiring in 7 days
    const expiring7d = await getExpiringUsers(8);
    for (const user of expiring7d) {
      if (user.days_until_expiry >= 6 && user.days_until_expiry <= 8) {
        if (await sendNotification(user.user_id, 'expiring_7d', user.expires_at)) {
          sent7d++;
          console.log(`🔔 [Notification] Sent 7-day warning to user ${user.user_id} (${user.email})`);
        }
      }
    }

    // Get users expiring in 3 days
    const expiring3d = await getExpiringUsers(4);
    for (const user of expiring3d) {
      if (user.days_until_expiry >= 2 && user.days_until_expiry <= 4) {
        if (await sendNotification(user.user_id, 'expiring_3d', user.expires_at)) {
          sent3d++;
          console.log(`🔔 [Notification] Sent 3-day warning to user ${user.user_id} (${user.email})`);
        }
      }
    }

    // Get users expiring in 1 day
    const expiring1d = await getExpiringUsers(2);
    for (const user of expiring1d) {
      if (user.days_until_expiry >= 0 && user.days_until_expiry <= 2) {
        if (await sendNotification(user.user_id, 'expiring_1d', user.expires_at)) {
          sent1d++;
          console.log(`🔔 [Notification] Sent 1-day warning to user ${user.user_id} (${user.email})`);
        }
      }
    }

    console.log(`🔔 [Notification] Summary: 7d=${sent7d}, 3d=${sent3d}, 1d=${sent1d}`);

  } catch (error) {
    console.error('🔔 [Notification] Error:', error);
  }
}

export function startSubscriptionNotificationJob(): void {
  console.log('📅 Subscription Notification Job scheduled');
  console.log('   Schedule: Twice daily (9 AM, 6 PM Bangkok time)');
  console.log('   Action: Send expiration warnings (7d, 3d, 1d)');

  // Run at 9 AM and 6 PM Bangkok time
  cron.schedule('0 9,18 * * *', () => {
    processNotifications();
  }, {
    timezone: 'Asia/Bangkok'
  });
}

export default { startSubscriptionNotificationJob };
