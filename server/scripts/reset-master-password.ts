/**
 * One-off: reset master admin password.
 * Generates a random strong password, hashes via bcryptjs (cost=10),
 * updates Railway DB (via DATABASE_URL in server/.env), and writes the
 * hash to /tmp/master-hash.txt so HWC update can re-use the same hash.
 *
 * Run: npx tsx server/scripts/reset-master-password.ts
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { writeFileSync } from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const EMAIL = '123456789123456789ori@gmail.com';
const PASSWORD_LEN = 24;

// Excluded ambiguous chars: 0/O, 1/l/I, no spaces. All shell-safe (no $`"').
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#%^&*-_=+';

function genPassword(): string {
  const buf = crypto.randomBytes(PASSWORD_LEN);
  let pw = '';
  for (let i = 0; i < PASSWORD_LEN; i++) pw += ALPHABET[buf[i] % ALPHABET.length];
  return pw;
}

const plain = genPassword();
const hash = await bcrypt.hash(plain, 10);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const res = await pool.query(
  `UPDATE users SET password_hash = $1 WHERE LOWER(email) = LOWER($2) RETURNING id, email`,
  [hash, EMAIL]
);

if (res.rowCount === 0) {
  console.error(`No user matched ${EMAIL} — aborting.`);
  await pool.end();
  process.exit(1);
}

console.log('Railway updated:', res.rows[0]);

writeFileSync('/tmp/master-hash.txt', hash);
writeFileSync('/tmp/master-pw.txt', plain);

console.log('\n=== NEW PASSWORD ===');
console.log(plain);
console.log('\n=== HASH (also at /tmp/master-hash.txt) ===');
console.log(hash);

await pool.end();
