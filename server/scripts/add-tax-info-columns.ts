/**
 * Migration: Add tax info columns to user_bank_accounts
 * For Thai withholding tax (หักภาษี ณ ที่จ่าย)
 *
 * Run with: npx tsx server/scripts/add-tax-info-columns.ts
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
    console.log('Adding tax info columns to user_bank_accounts...\n');

    // Check existing columns
    const checkColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'user_bank_accounts'
    `);
    const existingColumns = checkColumns.rows.map(r => r.column_name);

    // Add tax_id column
    if (!existingColumns.includes('tax_id')) {
      await client.query(`
        ALTER TABLE user_bank_accounts ADD COLUMN tax_id VARCHAR(13)
      `);
      console.log('Added tax_id column');
    } else {
      console.log('tax_id column already exists');
    }

    // Add tax_name column
    if (!existingColumns.includes('tax_name')) {
      await client.query(`
        ALTER TABLE user_bank_accounts ADD COLUMN tax_name VARCHAR(100)
      `);
      console.log('Added tax_name column');
    } else {
      console.log('tax_name column already exists');
    }

    // Add tax_address column
    if (!existingColumns.includes('tax_address')) {
      await client.query(`
        ALTER TABLE user_bank_accounts ADD COLUMN tax_address TEXT
      `);
      console.log('Added tax_address column');
    } else {
      console.log('tax_address column already exists');
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
