/**
 * Idol Runner Job
 * เช็ค idol_template_tasks ที่ scheduler สร้าง แล้วรัน pipeline + update status กลับ schedule_queue
 * Log เขียนตรงจาก pipeline ผ่าน appendLog → scheduler_activity_logs (ไม่มี sync loop)
 */

import cron from 'node-cron';
import pool from '../db.js';
import { stepGenerateCaption, stepPostToSocial, logActivity, resolveAndSaveTaskPrompt } from '../lib/queue-runner.js';
import { runIdolTaskPipeline } from '../lib/idol-pipeline.js';

// Tracks idol tasks the watchdog has recently restarted (prevents double-fire within same process).
// Entry TTL = 2 min, long enough for the pipeline to emit its first heartbeat (appendLog).
const recentlyRestarted = new Map<number, number>();
const RESTART_COOLDOWN_MS = 2 * 60 * 1000;
// If a task's updated_at is older than this and it's still in an in-flight status → assume stuck.
// Pipeline heartbeats every ~30s (appendLog during polling), so 5 min is well beyond normal quiet.
const STUCK_TASK_THRESHOLD_MIN = 5;

async function restartStuckIdolTasks(): Promise<void> {
  // Prune cooldown entries
  const now = Date.now();
  for (const [id, ts] of recentlyRestarted) {
    if (now - ts > RESTART_COOLDOWN_MS) recentlyRestarted.delete(id);
  }

  // Tasks in an active status but whose updated_at is stale = pipeline is no longer running
  // (server restart, uncaught rejection, or KIE polling exceeded pipeline lifetime).
  const stuck = await pool.query(`
    SELECT id, user_id, status, current_step
    FROM idol_template_tasks
    WHERE status IN ('pending', 'prompt_generating', 'image_generating', 'video_generating', 'concatenating')
      AND updated_at < NOW() - INTERVAL '${STUCK_TASK_THRESHOLD_MIN} minutes'
  `);

  for (const task of stuck.rows) {
    if (recentlyRestarted.has(task.id)) continue;
    recentlyRestarted.set(task.id, Date.now());

    console.log(`[IdolRunner] 🚨 Task ${task.id} stuck (status=${task.status}, step=${task.current_step}) — restarting pipeline`);
    try {
      // Reset to 'pending' so runIdolTaskPipeline's atomic claim can proceed (it requires status='pending').
      // If another instance concurrently claimed, our reset is a no-op for them.
      await pool.query(
        `UPDATE idol_template_tasks
         SET status = 'pending', current_step = NULL, error = NULL,
             logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [JSON.stringify([{ time: new Date().toISOString(), emoji: '🚨', text: `ระบบตรวจพบ task ค้าง ${STUCK_TASK_THRESHOLD_MIN}+ นาที — กำลัง restart pipeline อัตโนมัติ` }]), task.id]
      );
      // runIdolTaskPipeline has built-in smart-retry: resumes from existing KIE task IDs where possible,
      // or regens failed scenes. Fire-and-forget; pipeline will write its own status back.
      runIdolTaskPipeline(task.id, task.user_id).catch(err => {
        console.error(`[IdolRunner] Watchdog-restart error for task ${task.id}:`, err.message);
      });
    } catch (err: any) {
      console.error(`[IdolRunner] Failed to restart task ${task.id}:`, err.message);
    }
  }
}

async function processIdolTasks(): Promise<void> {
  try {
    // ---- 0) Watchdog: ปิดแล้ว — ให้ user กด "ลองอีกครั้ง" เอง ----
    // await restartStuckIdolTasks();

    // ---- 1) Auto-retry items whose posting failed with a transient error ----
    // Pickup when retry_after_at has arrived; skip caption regen (already saved in DB).
    const retryPending = await pool.query(`
      SELECT sq.id as queue_id, sq.user_id, sq.video_url, sq.caption, sq.posting_attempts
      FROM schedule_queue sq
      WHERE sq.status = 'posting_retry'
        AND sq.retry_after_at IS NOT NULL
        AND sq.retry_after_at <= NOW()
    `);

    for (const r of retryPending.rows) {
      // Lock: posting_retry → scheduling (atomic, so concurrent ticks don't double-post)
      const lock = await pool.query(
        `UPDATE schedule_queue SET status = 'scheduling', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'posting_retry' RETURNING id`,
        [r.queue_id]
      );
      if (lock.rows.length === 0) continue;

      console.log(`[IdolRunner] 🔁 Retrying posting for queue ${r.queue_id} (attempt ${r.posting_attempts + 1})`);
      await logActivity(r.user_id, `🔁 Auto-retrying post (attempt ${r.posting_attempts + 1})...`, 'info', r.queue_id);

      try {
        const itemResult = await pool.query(
          `SELECT q.*, c.caption_language, c.custom_hashtags, c.posting_service,
                  c.blotato_account_id, c.blotato_api_key, c.page_ids, c.name as channel_name,
                  c.late_profile_id, c.late_accounts, c.postforme_api_key as channel_postforme_key_name,
                  c.postforme_accounts, c.timezone,
                  u.late_api_key, u.postforme_api_key, u.postforme_api_keys
           FROM schedule_queue q
           JOIN scheduler_channels c ON c.id = q.channel_id
           JOIN users u ON u.id = q.user_id
           WHERE q.id = $1`,
          [r.queue_id]
        );
        const queueItem = itemResult.rows[0];
        if (queueItem && r.video_url && r.caption) {
          // stepPostToSocial will re-classify errors and either set 'done', schedule another 'posting_retry', or mark 'failed' after exhaustion
          await stepPostToSocial(r.user_id, r.queue_id, queueItem, r.video_url, r.caption);
        } else {
          // Missing data — can't retry, mark permanent failure
          await pool.query(
            `UPDATE schedule_queue SET status = 'failed', error = 'Missing video_url or caption for retry', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [r.queue_id]
          );
        }
      } catch (err: any) {
        console.error(`[IdolRunner] Retry error for queue ${r.queue_id}:`, err.message);
        await pool.query(
          `UPDATE schedule_queue SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [err.message, r.queue_id]
        );
      }
    }

    // ---- 2) Main loop: items running the idol pipeline ----
    const running = await pool.query(`
      SELECT sq.id as queue_id, sq.user_id, sq.external_task_id, sq.channel_id, sq.generate_only
      FROM schedule_queue sq
      WHERE sq.external_task_id LIKE 'idol-%'
        AND sq.status NOT IN ('done', 'failed', 'captioning', 'scheduling', 'posting_retry')
    `);

    if (running.rows.length > 0) console.log(`[IdolRunner] Found ${running.rows.length} idol items to check`);

    for (const item of running.rows) {
      const match = item.external_task_id?.match(/^idol-(\d+)-(\d+)$/);
      if (!match) continue;
      const idolTaskId = parseInt(match[2]);

      const taskResult = await pool.query(
        `SELECT status, current_step, final_video_url, error FROM idol_template_tasks WHERE id = $1`,
        [idolTaskId]
      );
      const task = taskResult.rows[0];
      if (!task) continue;

      console.log(`[IdolRunner] Queue ${item.queue_id}: task=${idolTaskId} status=${task.status} step=${task.current_step}`);

      // Update schedule_queue status ตาม current_step เพื่อให้ UI แสดงถูก
      if (task.status !== 'done' && task.status !== 'failed' && task.current_step) {
        const stepLabel: Record<string, string> = {
          'ai_prompt': 'image_generating',
          'image_gen': 'image_generating',
          'video_gen': 'generating',
          'concat': 'generating',
        };
        const newStatus = stepLabel[task.current_step] || 'generating';
        await pool.query(`UPDATE schedule_queue SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [newStatus, item.queue_id]);
      }

      if (task.status === 'done' && task.final_video_url) {
        console.log(`[IdolRunner] DEBUG: queue=${item.queue_id} generate_only=${item.generate_only} (type=${typeof item.generate_only})`);
        // generate_only = true → แค่บันทึก video URL แล้วจบ ไม่ต้อง caption + post
        if (item.generate_only) {
          const doneResult = await pool.query(
            `UPDATE schedule_queue SET status = 'done', video_url = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND status IN ('generating', 'idol_running', 'idol_pending', 'pending', 'image_generating')
             RETURNING id`,
            [task.final_video_url, item.queue_id]
          );
          if (doneResult.rows.length === 0) {
            console.log(`[IdolRunner] Queue ${item.queue_id} already locked — skipping`);
            continue;
          }
          console.log(`[IdolRunner] ✅ Task ${idolTaskId} done (generate_only) — saved to history, no posting`);
          await logActivity(item.user_id, '✅ Video เสร็จ — บันทึกประวัติแล้ว', 'success', item.queue_id);
          continue;
        }

        // Lock: set status = 'captioning' (atomic)
        const lockResult = await pool.query(
          `UPDATE schedule_queue SET status = 'captioning', video_url = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND status IN ('generating', 'idol_running', 'idol_pending', 'pending', 'image_generating')
           RETURNING id`,
          [task.final_video_url, item.queue_id]
        );
        if (lockResult.rows.length === 0) {
          console.log(`[IdolRunner] Queue ${item.queue_id} already locked — skipping`);
          continue;
        }
        console.log(`[IdolRunner] ✅ Task ${idolTaskId} done! Starting caption + posting...`);
        await logActivity(item.user_id, '✅ Idol Template video เสร็จ! กำลังสร้าง caption...', 'success', item.queue_id);

        try {
          const itemResult = await pool.query(
            `SELECT q.*, c.caption_language, c.custom_hashtags, c.posting_service,
                    c.blotato_account_id, c.blotato_api_key, c.page_ids, c.name as channel_name,
                    c.late_profile_id, c.late_accounts, c.postforme_api_key as channel_postforme_key_name,
                    c.postforme_accounts, c.timezone,
                    u.late_api_key, u.postforme_api_key, u.postforme_api_keys
             FROM schedule_queue q
             JOIN scheduler_channels c ON c.id = q.channel_id
             JOIN users u ON u.id = q.user_id
             WHERE q.id = $1`,
            [item.queue_id]
          );
          const queueItem = itemResult.rows[0];

          if (queueItem) {
            // FIX D: resolve scene-specific prompt from idol_template_tasks.ai_prompts
            // and persist to schedule_queue.prompt — so caption gets actual scene content,
            // not the meta-instruction template that handoffToIdolPipeline left behind.
            const resolvedPrompt = await resolveAndSaveTaskPrompt(
              'idol_template_tasks',
              idolTaskId,
              item.queue_id,
              task.final_video_url
            );
            if (resolvedPrompt) {
              queueItem.prompt = resolvedPrompt;
            }

            const caption = await stepGenerateCaption(item.user_id, item.queue_id, queueItem);

            await pool.query(`UPDATE schedule_queue SET status = 'scheduling', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [item.queue_id]);
            // stepPostToSocial manages its own status (done/failed) internally — don't overwrite it.
            const postResult = await stepPostToSocial(item.user_id, item.queue_id, queueItem, task.final_video_url, caption);
            if (postResult.success) {
              console.log(`[IdolRunner] ✅ Posted queue ${item.queue_id}`);
            } else {
              console.log(`[IdolRunner] ⚠️ Queue ${item.queue_id} posting failed (status already set by stepPostToSocial)`);
            }
          }
        } catch (postErr: any) {
          console.error(`[IdolRunner] Caption/posting error:`, postErr.message);
          await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [postErr.message, item.queue_id]);
          await logActivity(item.user_id, `⚠️ Video เสร็จแล้ว แต่โพสต์ไม่สำเร็จ: ${postErr.message}`, 'error', item.queue_id);
        }
      } else if (task.status === 'failed') {
        console.log(`[IdolRunner] ❌ Task ${idolTaskId} failed: ${task.error}`);
        await pool.query(
          `UPDATE schedule_queue SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [task.error || 'Idol pipeline failed', item.queue_id]
        );
      }
    }
  } catch (err) {
    console.error('[IdolRunner] Error:', err);
  }
}

let isProcessing = false;

async function safeProcessIdolTasks() {
  if (isProcessing) return;
  isProcessing = true;
  try { await processIdolTasks(); } finally { isProcessing = false; }
}

export function startIdolRunnerJob(): void {
  console.log('🎬 [IdolRunner] Job scheduled — every 10 seconds');

  cron.schedule('*/10 * * * * *', () => { safeProcessIdolTasks(); });

  setTimeout(() => safeProcessIdolTasks(), 5000);
}

export default { startIdolRunnerJob };
