import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Clear ALL non-Dropbox video_url that don't have dropbox_path backup
  const r = await pool.query(`
    UPDATE schedule_queue
    SET video_url = NULL
    WHERE status = 'done'
      AND video_url IS NOT NULL AND video_url != ''
      AND video_url NOT LIKE '%dropbox%'
      AND (dropbox_path IS NULL OR dropbox_path = '')
    RETURNING id
  `);
  console.log(`Cleared ${r.rowCount} non-Dropbox video URLs (no Dropbox backup)`);

  // Summary
  const summary = await pool.query(`
    SELECT
      CASE
        WHEN video_url LIKE '%dropbox%' THEN 'DROPBOX'
        WHEN video_url IS NULL OR video_url = '' THEN 'NO_VIDEO'
        ELSE 'OTHER: ' || substring(video_url from 'https?://([^/]+)')
      END as source,
      COUNT(*) as count
    FROM schedule_queue WHERE status = 'done'
    GROUP BY source ORDER BY count DESC
  `);
  console.log('\n=== FINAL ===');
  for (const row of summary.rows) {
    console.log(`${row.source}: ${row.count}`);
  }

  await pool.end();
}
main().catch(console.error);
