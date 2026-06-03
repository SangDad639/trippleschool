import pg from 'pg';
import bcrypt from 'bcryptjs';
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

const EMAIL = 'testapprove121@gmail.com';
const PASSWORD = '442285';

async function run() {
  const client = await pool.connect();
  try {
    const exists = await client.query(
      `SELECT id, email, is_admin, is_approved FROM users WHERE LOWER(email)=LOWER($1)`,
      [EMAIL]
    );
    if (exists.rows.length > 0) {
      console.log('Already exists — resetting to pending (is_approved=false):', exists.rows[0]);
      const upd = await client.query(
        `UPDATE users SET is_admin=false, is_approved=false WHERE id=$1
         RETURNING id, email, is_admin, is_approved, credits`,
        [exists.rows[0].id]
      );
      console.log('Updated:', upd.rows[0]);
    } else {
      const hash = await bcrypt.hash(PASSWORD, 10);
      const ins = await client.query(
        `INSERT INTO users (email, password_hash, is_admin, is_approved, credits, join_date)
         VALUES ($1, $2, false, false, 100, NOW())
         RETURNING id, email, is_admin, is_approved, credits, join_date`,
        [EMAIL, hash]
      );
      console.log('Created (pending approval):', ins.rows[0]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
