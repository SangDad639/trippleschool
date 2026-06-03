/**
 * Fix items where video_url is CDN/expired but dropbox_path exists.
 * Regenerate Dropbox shared URL from path and update video_url.
 *
 * Run: npx tsx scripts/fix-cdn-with-dropbox.ts
 */
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { getSharedLinkFromPath } = await import('../src/utils/dropbox.js');

  const result = await pool.query(`
    SELECT id, video_url, dropbox_path FROM schedule_queue
    WHERE dropbox_path IS NOT NULL AND dropbox_path != ''
      AND (video_url IS NULL OR video_url NOT LIKE '%dropbox.com%')
    ORDER BY id DESC
  `);

  console.log(`Found ${result.rows.length} items with dropbox_path but non-Dropbox video_url`);

  if (result.rows.length === 0) {
    console.log('Nothing to fix');
    await pool.end();
    return;
  }

  let success = 0, failed = 0;
  for (const row of result.rows) {
    try {
      const sharedUrl = await getSharedLinkFromPath(row.dropbox_path);
      await pool.query('UPDATE schedule_queue SET video_url = $1 WHERE id = $2', [sharedUrl, row.id]);
      console.log(`[${row.id}] ✅ Updated video_url → Dropbox`);
      success++;
    } catch (err: any) {
      console.error(`[${row.id}] ❌ Failed:`, err?.error?.error?.['.tag'] || err.message);
      failed++;
    }
  }

  console.log(`\nDone: ${success} success, ${failed} failed`);
  await pool.end();
}

main().catch(console.error);
