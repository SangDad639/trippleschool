/**
 * Migration: Create subscription_notifications table
 * For subscription expiration notifications
 *
 * Run with: npx tsx server/scripts/create-subscription-notifications-table.ts
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Creating subscription_notifications table...\n');

    // Check if table exists
    const checkTable = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'subscription_notifications'
      )
    `);

    if (checkTable.rows[0].exists) {
      console.log('Table subscription_notifications already exists. Skipping.');
    } else {
      await client.query(`
        CREATE TABLE subscription_notifications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          notification_type VARCHAR(50) NOT NULL,
          expires_at TIMESTAMP,
          sent_at TIMESTAMP DEFAULT NOW(),
          read_at TIMESTAMP
        )
      `);
      console.log('Created subscription_notifications table');

      // Create index
      await client.query(`
        CREATE INDEX idx_subscription_notifications_user ON subscription_notifications(user_id)
      `);
      console.log('Created index: idx_subscription_notifications_user');
    }

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
