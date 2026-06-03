import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Items with Dropbox video_url but no dropbox_path
  const r = await pool.query(`
    SELECT id, substring(video_url from 1 for 80) as url, dropbox_path
    FROM schedule_queue
    WHERE video_url LIKE '%dropbox%'
      AND (dropbox_path IS NULL OR dropbox_path = '')
    ORDER BY id DESC LIMIT 20
  `);
  console.log(`Dropbox URL but NO dropbox_path: ${r.rows.length}`);
  for (const row of r.rows) {
    console.log(`#${row.id} | ${row.url}`);
  }

  // Count totals
  const counts = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE video_url LIKE '%dropbox%' AND dropbox_path IS NOT NULL AND dropbox_path != '') as has_both,
      COUNT(*) FILTER (WHERE video_url LIKE '%dropbox%' AND (dropbox_path IS NULL OR dropbox_path = '')) as url_only
    FROM schedule_queue
    WHERE status = 'done'
  `);
  console.log(`\nHas both (video_url + dropbox_path): ${counts.rows[0].has_both}`);
  console.log(`Dropbox URL but missing dropbox_path: ${counts.rows[0].url_only}`);

  await pool.end();
}
main().catch(console.error);
