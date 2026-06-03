import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(`
    UPDATE schedule_queue
    SET video_url = REPLACE(video_url, 'dl=0', 'dl=1')
    WHERE video_url LIKE '%dropbox%' AND video_url LIKE '%dl=0%'
    RETURNING id
  `);
  console.log(`Fixed ${r.rowCount} URLs: ${r.rows.map((r: any) => '#' + r.id).join(', ')}`);
  await pool.end();
}
main().catch(console.error);
