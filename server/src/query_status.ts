import { pool } from './db.js';

async function run() {
  try {
    const res = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM schedule_queue 
      WHERE scheduled_time >= CURRENT_DATE
      GROUP BY status
    `);
    console.log(JSON.stringify(res.rows, null, 2));

    const allRes = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM schedule_queue 
      GROUP BY status
    `);
    console.log("All time:", JSON.stringify(allRes.rows, null, 2));

  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
