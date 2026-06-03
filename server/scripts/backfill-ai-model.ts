/**
 * Backfill ai_model column in schedule_queue from channel's current ai_model
 * For items that were created before ai_model was stored per-item
 */
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Count items without ai_model
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM schedule_queue WHERE ai_model IS NULL`
  );
  const count = parseInt(countResult.rows[0].count);
  console.log(`Found ${count} items without ai_model`);

  if (count === 0) {
    console.log('Nothing to backfill');
    await pool.end();
    return;
  }

  // Update items using their channel's current ai_model
  const result = await pool.query(`
    UPDATE schedule_queue q
    SET ai_model = c.ai_model
    FROM scheduler_channels c
    WHERE q.channel_id = c.id AND q.ai_model IS NULL
  `);

  console.log(`Updated ${result.rowCount} items`);

  // Verify
  const verifyResult = await pool.query(
    `SELECT COUNT(*) FROM schedule_queue WHERE ai_model IS NULL`
  );
  console.log(`Remaining items without ai_model: ${verifyResult.rows[0].count}`);

  await pool.end();
}

main().catch(console.error);
