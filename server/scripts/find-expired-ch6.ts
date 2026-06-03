import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(`
    SELECT id, video_url, dropbox_path
    FROM schedule_queue
    WHERE channel_id = 6 AND status = 'done'
      AND video_url IS NOT NULL AND video_url != ''
      AND video_url NOT LIKE '%dropbox%'
    ORDER BY updated_at DESC
  `);
  for (const row of r.rows) {
    console.log(`#${row.id} | ${row.video_url.substring(0, 120)} | dropbox: ${row.dropbox_path || 'NONE'}`);
  }
  console.log(`\nTotal non-Dropbox for channel 6: ${r.rows.length}`);
  await pool.end();
}
main().catch(console.error);
