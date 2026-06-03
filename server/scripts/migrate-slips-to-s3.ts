/**
 * One-time migration: Upload existing payment slips from disk to S3
 * and update database URLs.
 *
 * Usage: npx tsx server/scripts/migrate-slips-to-s3.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: true,
});

const S3_BUCKET = process.env.S3_BUCKET || '';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

async function main() {
  const slipsDir = path.join(__dirname, '../uploads/slips');

  if (!fs.existsSync(slipsDir)) {
    console.log('No slips directory found. Nothing to migrate.');
    process.exit(0);
  }

  const files = fs.readdirSync(slipsDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  console.log(`Found ${files.length} slip files to migrate.`);

  for (const filename of files) {
    const filePath = path.join(slipsDir, filename);
    const ext = path.extname(filename).toLowerCase();
    const key = `payment-slips/${filename}`;
    const contentType = MIME_MAP[ext] || 'image/jpeg';

    console.log(`Uploading ${filename} -> s3://${S3_BUCKET}/${key}`);

    const fileBuffer = fs.readFileSync(filePath);

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    }));

    // Update database: old URL -> new proxy URL
    const oldUrl = `/uploads/slips/${filename}`;
    const newUrl = `/api/subscription/slips/${key}`;

    const result = await pool.query(
      'UPDATE users SET payment_slip_url = $1 WHERE payment_slip_url = $2 RETURNING id, email',
      [newUrl, oldUrl]
    );

    if (result.rowCount && result.rowCount > 0) {
      console.log(`  Updated DB for: ${result.rows.map((r: any) => r.email).join(', ')}`);
    } else {
      console.log(`  No DB record found for ${oldUrl}`);
    }
  }

  console.log('\nMigration complete!');
  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
