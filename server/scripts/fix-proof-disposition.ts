/**
 * One-off: re-set Content-Disposition=inline on existing affiliate-proofs/ objects.
 *
 * Why: Before commit XXX, /admin/upload-proof did not pass `contentDisposition`
 * to uploadFile(), so OBS stored objects with disposition='attachment' (HWC's
 * default). Browsers then DOWNLOAD instead of rendering in <iframe>/<img>.
 *
 * Approach: S3 CopyObject(self, MetadataDirective=REPLACE) — rewrites object
 * metadata in place without re-uploading the content. Cheap, idempotent.
 *
 * Run: `tsx scripts/fix-proof-disposition.ts` (from server/ dir, .env loaded)
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { S3Client, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: false,
});

const Bucket = process.env.S3_BUCKET!;

async function run() {
  // 1. Collect unique S3 keys from both proof_url + wht_cert_url
  const result = await pool.query<{ url: string }>(`
    SELECT DISTINCT proof_url AS url FROM affiliate_commissions
      WHERE proof_url LIKE 'affiliate-proofs/%'
    UNION
    SELECT DISTINCT wht_cert_url AS url FROM affiliate_commissions
      WHERE wht_cert_url LIKE 'affiliate-proofs/%'
  `);
  const keys = result.rows.map((r) => r.url);
  console.log(`Found ${keys.length} unique S3 keys to fix`);

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const key of keys) {
    try {
      // Peek current disposition — skip if already inline
      const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
      if (head.ContentDisposition === 'inline') {
        console.log(`  [skip] ${key} (already inline)`);
        skipped++;
        continue;
      }

      // Copy onto itself with new metadata. CopySource must be url-encoded.
      await s3.send(new CopyObjectCommand({
        Bucket,
        Key: key,
        CopySource: `/${Bucket}/${encodeURIComponent(key)}`,
        MetadataDirective: 'REPLACE',
        ContentDisposition: 'inline',
        ContentType: head.ContentType, // preserve
      }));
      console.log(`  [fix]  ${key} (was: ${head.ContentDisposition || 'none'})`);
      fixed++;
    } catch (err: any) {
      console.error(`  [fail] ${key}: ${err.message || err}`);
      failed++;
    }
  }

  console.log(`\nDone. fixed=${fixed} skipped=${skipped} failed=${failed} total=${keys.length}`);
  await pool.end();
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
