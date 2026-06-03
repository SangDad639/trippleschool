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

async function run() {
  const r = await pool.query(
    `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position`
  );
  for (const row of r.rows) {
    console.log(
      String(row.column_name).padEnd(30),
      String(row.data_type).padEnd(25),
      'default:',
      row.column_default
    );
  }
  await pool.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
