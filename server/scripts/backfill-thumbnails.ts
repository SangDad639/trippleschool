/**
 * Backfill thumbnail_url for schedule_queue items that have video_url but no thumbnail.
 * Uses FFmpeg to extract frame → upload to Dropbox → save URL.
 *
 * Run: npx tsx scripts/backfill-thumbnails.ts
 */
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Find items with video_url but no thumbnail_url (limit batch to avoid overload)
  const result = await pool.query(`
    SELECT id, video_url, user_id FROM schedule_queue
    WHERE video_url IS NOT NULL AND video_url != ''
      AND (thumbnail_url IS NULL OR thumbnail_url = '')
      AND status = 'done'
    ORDER BY id DESC
    LIMIT 100
  `);

  console.log(`Found ${result.rows.length} items without thumbnail`);

  if (result.rows.length === 0) {
    console.log('Nothing to backfill');
    await pool.end();
    return;
  }

  const { generateThumbnail } = await import('../src/utils/thumbnail.js');

  let success = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      console.log(`[${row.id}] Generating thumbnail from ${row.video_url.substring(0, 60)}...`);
      const thumbnailUrl = await generateThumbnail(row.video_url, row.user_id, row.id);
      if (thumbnailUrl) {
        await pool.query('UPDATE schedule_queue SET thumbnail_url = $1 WHERE id = $2', [thumbnailUrl, row.id]);
        success++;
        console.log(`[${row.id}] ✅ Done`);
      } else {
        failed++;
        console.log(`[${row.id}] ⚠️ Skipped (no thumbnail generated)`);
      }
    } catch (err: any) {
      failed++;
      console.error(`[${row.id}] ❌ Failed:`, err.message);
    }
  }

  console.log(`\nDone: ${success} success, ${failed} failed`);
  await pool.end();
}

main().catch(console.error);
