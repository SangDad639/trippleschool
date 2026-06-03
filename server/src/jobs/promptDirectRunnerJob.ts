/**
 * Watchdog for Prompt Direct tasks — ตาม viralRunnerJob pattern
 * Detects stuck tasks (status=generating + updated_at > 5 min) → auto-restart
 */
import pool from '../db.js';
import { runPromptDirectTask } from '../lib/prompt-direct-pipeline.js';

const CHECK_INTERVAL_MS = 60_000; // Check every 1 minute
const STUCK_THRESHOLD_MS = 5 * 60_000; // 5 minutes

export function startPromptDirectRunnerJob() {
  // Initial check on startup
  setTimeout(() => checkOrphanedTasks(), 10_000);

  // Periodic check
  setInterval(() => checkOrphanedTasks(), CHECK_INTERVAL_MS);
}

async function checkOrphanedTasks() {
  try {
    const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
    const result = await pool.query(`
      SELECT id, user_id FROM prompt_direct_tasks
      WHERE status = 'generating' AND updated_at < $1
    `, [threshold]);

    if (result.rows.length === 0) return;

    const taskIds = result.rows.map((r: any) => r.id);
    console.log(`[PromptDirectRecovery] Found ${taskIds.length} stuck tasks: [${taskIds.join(', ')}]`);

    for (const task of result.rows) {
      // Reset to pending then re-run
      await pool.query(
        `UPDATE prompt_direct_tasks SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [task.id]
      );
      runPromptDirectTask(task.id, task.user_id).catch((err: any) => {
        console.error(`[PromptDirectRecovery] Re-run failed for task ${task.id}:`, err.message);
      });
    }
  } catch (err: any) {
    console.error('[PromptDirectRecovery] Check failed:', err.message);
  }
}
