import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(`
    SELECT id, video_url, dropbox_path, updated_at
    FROM schedule_queue
    WHERE channel_id = 6 AND status = 'done'
      AND video_url IS NOT NULL AND video_url != ''
    ORDER BY scheduled_time ASC
  `);

  for (const row of r.rows) {
    // Quick check if URL is accessible
    try {
      const resp = await fetch(row.video_url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      const ok = resp.ok ? '✅' : `❌ ${resp.status}`;
      console.log(`#${row.id} | ${ok} | ${row.video_url.substring(0, 80)}`);
    } catch (e: any) {
      console.log(`#${row.id} | ❌ ${e.message.substring(0, 40)} | ${row.video_url.substring(0, 80)}`);
    }
  }

  await pool.end();
}
main().catch(console.error);
