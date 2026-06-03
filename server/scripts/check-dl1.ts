import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(`SELECT id, video_url FROM schedule_queue WHERE channel_id = 6 AND status = 'done' AND video_url IS NOT NULL AND video_url != ''`);
  for (const row of r.rows) {
    const hasDl1 = row.video_url.includes('dl=1');
    console.log(`#${row.id} | dl=1: ${hasDl1 ? 'YES' : 'NO'} | ${row.video_url.substring(row.video_url.length - 30)}`);
  }
  await pool.end();
}
main().catch(console.error);
