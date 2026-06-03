/**
 * Migration: Add proof_url column to affiliate_commissions
 *
 * Run with: npx tsx server/scripts/add-proof-url-column.ts
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
    console.log('Adding proof_url column to affiliate_commissions...\n');

    // Check if column already exists
    const checkColumn = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'affiliate_commissions' AND column_name = 'proof_url'
    `);

    if (checkColumn.rows.length > 0) {
      console.log('Column proof_url already exists. Skipping.');
    } else {
      await client.query(`
        ALTER TABLE affiliate_commissions ADD COLUMN proof_url TEXT
      `);
      console.log('Added proof_url column to affiliate_commissions');
    }

    console.log('\n Migration completed successfully!');
  } catch (error) {
    console.error('\n Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
