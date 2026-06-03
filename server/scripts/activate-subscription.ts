/**
 * Activate Subscription Script
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/activate-subscription.ts <email>
 *
 * Example:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/activate-subscription.ts aet121@gmail.com
 */

import pg from 'pg';
const { Pool } = pg;

const email = process.argv[2];

if (!email) {
  console.error('Usage: npx tsx scripts/activate-subscription.ts <email>');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function activateSubscription() {
  console.log(`Activating subscription for: ${email}`);

  try {
    // Find user
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      console.error(`User not found: ${email}`);
      process.exit(1);
    }

    const user = userResult.rows[0];
    console.log(`Found user ID: ${user.id}`);

    // Set subscription expiry to 1 year from now
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    // Check if subscription exists
    const subResult = await pool.query(
      'SELECT id FROM subscriptions WHERE user_id = $1',
      [user.id]
    );

    if (subResult.rows.length > 0) {
      // Update existing subscription
      await pool.query(`
        UPDATE subscriptions
        SET status = 'active',
            plan_type = 'yearly',
            current_period_end = $2,
            cancel_at_period_end = false,
            updated_at = NOW()
        WHERE user_id = $1
      `, [user.id, expiresAt]);
      console.log('Updated existing subscription');
    } else {
      // Create new subscription
      await pool.query(`
        INSERT INTO subscriptions (user_id, stripe_customer_id, status, plan_type, current_period_start, current_period_end, cancel_at_period_end)
        VALUES ($1, $2, 'active', 'yearly', NOW(), $3, false)
      `, [user.id, `manual_${user.id}`, expiresAt]);
      console.log('Created new subscription');
    }

    // Also update users table
    await pool.query(
      'UPDATE users SET subscription_expires_at = $1 WHERE id = $2',
      [expiresAt, user.id]
    );

    console.log('');
    console.log('Subscription activated!');
    console.log(`  Email: ${email}`);
    console.log(`  Plan: yearly`);
    console.log(`  Expires: ${expiresAt.toISOString()}`);

  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

activateSubscription();
