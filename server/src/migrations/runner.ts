/**
 * Migration runner — apply pending SQL migrations to DATABASE_URL.
 *
 * Looks at sibling `sql/` directory for `*.sql` files (sorted by filename).
 * Tracks applied migrations in `_migrations` table so each runs once.
 *
 * Each .sql file MUST be idempotent (use `IF NOT EXISTS`, ON CONFLICT, etc.)
 * — runner doesn't re-run files in `_migrations`, but if you mutate a SQL file
 * after deploy, it will NOT re-apply (history is by filename, not content).
 *
 * Run locally:   npm run migrate:dev
 * Run in image:  node dist/migrations/runner.js (used in CI/CD k8s Job)
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In dev (tsx) loads server/.env. In prod (k8s Job) env injected via secret.
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: join(__dirname, '..', '..', '.env') });
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const SQL_DIR = join(__dirname, 'sql');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function ensureMigrationsTable(client: pg.PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(client: pg.PoolClient): Promise<Set<string>> {
  const res = await client.query<{ name: string }>(`SELECT name FROM _migrations`);
  return new Set(res.rows.map((r) => r.name));
}

function listMigrationFiles(): string[] {
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function applyMigration(client: pg.PoolClient, file: string) {
  const sql = readFileSync(join(SQL_DIR, file), 'utf-8');
  const name = file.replace(/\.sql$/, '');
  console.log(`→ Applying ${name}`);

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [name]);
    await client.query('COMMIT');
    console.log(`  ✅ ${name} applied`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ❌ ${name} failed`);
    throw err;
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    const files = listMigrationFiles();

    if (files.length === 0) {
      console.log('No migration files found in', SQL_DIR);
      return;
    }

    const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, '')));
    console.log(`Migrations: ${files.length} total, ${applied.size} applied, ${pending.length} pending`);

    if (pending.length === 0) {
      console.log('Database is up to date.');
      return;
    }

    for (const file of pending) {
      await applyMigration(client, file);
    }

    console.log(`\n✨ Applied ${pending.length} migration(s) successfully`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('\n❌ Migration runner failed:', err.message || err);
  process.exit(1);
});
