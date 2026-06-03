import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const r = await pool.query(`
    SELECT id, substring(video_url from 1 for 80) as url_preview, dropbox_path,
      CASE
        WHEN video_url LIKE '%dropbox%' THEN 'DROPBOX'
        WHEN video_url LIKE '%kie.ai%' THEN 'KIE'
        WHEN video_url LIKE '%vidgo%' THEN 'VIDGO'
        ELSE 'OTHER'
      END as source
    FROM schedule_queue
    WHERE status = 'done' AND video_url IS NOT NULL AND video_url != ''
    ORDER BY updated_at DESC LIMIT 20
  `);

  console.log('\n=== VIDEO URL SOURCES (latest 20) ===');
  for (const row of r.rows) {
    console.log(`#${row.id} | ${row.source} | dropbox_path: ${row.dropbox_path || 'NONE'}`);
    console.log(`   URL: ${row.url_preview}`);
  }

  // Count by source
  const counts = await pool.query(`
    SELECT
      CASE
        WHEN video_url LIKE '%dropbox%' THEN 'DROPBOX'
        WHEN video_url LIKE '%kie.ai%' THEN 'KIE'
        WHEN video_url LIKE '%vidgo%' THEN 'VIDGO'
        ELSE 'OTHER'
      END as source,
      COUNT(*) as count
    FROM schedule_queue
    WHERE status = 'done' AND video_url IS NOT NULL AND video_url != ''
    GROUP BY source
    ORDER BY count DESC
  `);

  console.log('\n=== COUNTS BY SOURCE ===');
  for (const row of counts.rows) {
    console.log(`${row.source}: ${row.count}`);
  }

  await pool.end();
}

main().catch(console.error);
