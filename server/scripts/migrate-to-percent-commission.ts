/**
 * Migration: Change affiliate commission from fixed amount to percentage-based
 *
 * Run with: npx tsx server/scripts/migrate-to-percent-commission.ts
 *
 * Changes:
 * 1. affiliate_settings: rename default_commission → tier1_percent, tier2_commission → tier2_percent
 * 2. users: rename commission_rate → commission_percent
 * 3. affiliate_commissions: add payment_amount, commission_percent columns
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Starting migration to percentage-based commission...\n');

    await client.query('BEGIN');

    // 1. Check if columns already exist (to make migration idempotent)
    const checkColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'affiliate_settings'
    `);
    const existingColumns = checkColumns.rows.map(r => r.column_name);

    // 2. Migrate affiliate_settings table
    console.log('[1/4] Migrating affiliate_settings table...');

    if (existingColumns.includes('default_commission') && !existingColumns.includes('tier1_percent')) {
      // Rename default_commission → tier1_percent
      await client.query(`
        ALTER TABLE affiliate_settings
        RENAME COLUMN default_commission TO tier1_percent
      `);
      console.log('  - Renamed default_commission → tier1_percent');
    }

    if (existingColumns.includes('tier2_commission') && !existingColumns.includes('tier2_percent')) {
      // Rename tier2_commission → tier2_percent
      await client.query(`
        ALTER TABLE affiliate_settings
        RENAME COLUMN tier2_commission TO tier2_percent
      `);
      console.log('  - Renamed tier2_commission → tier2_percent');
    }

    // Remove old currency-specific columns if they exist
    if (existingColumns.includes('tier1_usd')) {
      await client.query('ALTER TABLE affiliate_settings DROP COLUMN IF EXISTS tier1_usd');
      console.log('  - Removed tier1_usd column');
    }
    if (existingColumns.includes('tier2_usd')) {
      await client.query('ALTER TABLE affiliate_settings DROP COLUMN IF EXISTS tier2_usd');
      console.log('  - Removed tier2_usd column');
    }
    if (existingColumns.includes('default_currency')) {
      await client.query('ALTER TABLE affiliate_settings DROP COLUMN IF EXISTS default_currency');
      console.log('  - Removed default_currency column');
    }

    // Set default percentages (10% for Tier 1, 15% for Tier 2)
    await client.query(`
      UPDATE affiliate_settings
      SET tier1_percent = 10, tier2_percent = 15
      WHERE id = 1 AND (tier1_percent > 100 OR tier1_percent IS NULL)
    `);
    console.log('  - Set default percentages: Tier1=10%, Tier2=15%');

    // 3. Migrate users table
    console.log('\n[2/4] Migrating users table...');

    const checkUserColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
    `);
    const userColumns = checkUserColumns.rows.map(r => r.column_name);

    if (userColumns.includes('commission_rate') && !userColumns.includes('commission_percent')) {
      await client.query(`
        ALTER TABLE users
        RENAME COLUMN commission_rate TO commission_percent
      `);
      console.log('  - Renamed commission_rate → commission_percent');
    }

    // Set default 10% for all users (existing values > 100 are likely fixed amounts)
    await client.query(`
      UPDATE users
      SET commission_percent = 10
      WHERE commission_percent IS NULL OR commission_percent > 100
    `);

    // Set Tier 2 users to 15%
    await client.query(`
      UPDATE users
      SET commission_percent = 15
      WHERE affiliate_tier = 2
    `);
    console.log('  - Set commission_percent: 10% for Tier1, 15% for Tier2');

    // 4. Migrate affiliate_commissions table
    console.log('\n[3/4] Migrating affiliate_commissions table...');

    const checkCommColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'affiliate_commissions'
    `);
    const commColumns = checkCommColumns.rows.map(r => r.column_name);

    if (!commColumns.includes('payment_amount')) {
      await client.query(`
        ALTER TABLE affiliate_commissions
        ADD COLUMN payment_amount DECIMAL(10,2)
      `);
      console.log('  - Added payment_amount column');
    }

    if (!commColumns.includes('commission_percent')) {
      await client.query(`
        ALTER TABLE affiliate_commissions
        ADD COLUMN commission_percent DECIMAL(5,2)
      `);
      console.log('  - Added commission_percent column');
    }

    // 5. Summary
    console.log('\n[4/4] Migration summary:');

    const settingsResult = await client.query(
      'SELECT tier1_percent, tier2_percent FROM affiliate_settings WHERE id = 1'
    );
    console.log('  - affiliate_settings:', settingsResult.rows[0]);

    const usersResult = await client.query(`
      SELECT affiliate_tier, COUNT(*) as count, AVG(commission_percent) as avg_percent
      FROM users
      WHERE referrer_id IS NOT NULL OR affiliate_tier IS NOT NULL
      GROUP BY affiliate_tier
    `);
    console.log('  - Users by tier:', usersResult.rows);

    await client.query('COMMIT');
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
