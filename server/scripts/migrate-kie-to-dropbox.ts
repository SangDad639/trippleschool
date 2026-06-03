/**
 * Migrate KIE URLs in schedule_queue to Dropbox.
 * Downloads from KIE → uploads to Dropbox → updates video_url + dropbox_path.
 */
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { uploadVideoToDropbox } = await import('../src/utils/dropbox.js');

  const result = await pool.query(`
    SELECT id, user_id, video_url, created_at
    FROM schedule_queue
    WHERE (video_url LIKE '%kie.ai%' OR video_url LIKE '%tempfile%')
      AND dropbox_path IS NULL
    ORDER BY id
  `);

  console.log(`Found ${result.rows.length} KIE items to migrate\n`);

  let success = 0, failed = 0;
  for (const row of result.rows) {
    try {
      console.log(`[${row.id}] user=${row.user_id} migrating...`);
      const { sharedUrl, dropboxPath } = await uploadVideoToDropbox(row.video_url, row.user_id, row.id);
      await pool.query(
        'UPDATE schedule_queue SET video_url = $1, dropbox_path = $2 WHERE id = $3',
        [sharedUrl, dropboxPath, row.id]
      );
      console.log(`[${row.id}] ✅ Done → ${dropboxPath}`);
      success++;
    } catch (err: any) {
      console.error(`[${row.id}] ❌ Failed:`, err.message);
      failed++;
    }
  }

  console.log(`\nDone: ${success} success, ${failed} failed`);
  await pool.end();
}

main().catch(console.error);
