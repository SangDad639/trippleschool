import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(`
    SELECT id, substring(video_url from 1 for 100) as url, dropbox_path
    FROM schedule_queue
    WHERE channel_id = 16 AND status = 'done'
      AND video_url IS NOT NULL AND video_url != ''
      AND video_url NOT LIKE '%dropbox%'
    ORDER BY scheduled_time ASC
  `);
  console.log(`Non-Dropbox URLs for channel 16: ${r.rows.length}`);
  for (const row of r.rows) {
    console.log(`#${row.id} | ${row.url} | dropbox: ${row.dropbox_path || 'NONE'}`);
  }
  await pool.end();
}
main().catch(console.error);
