/**
 * Viral Runner Job
 * เช็ค viral_template_tasks ที่ scheduler สร้าง แล้วรัน pipeline + update status กลับ schedule_queue
 * Log เขียนตรงจาก pipeline ผ่าน appendLog → scheduler_activity_logs (ไม่มี sync loop)
 */

import cron from 'node-cron';
import pool from '../db.js';
import { stepGenerateCaption, stepPostToSocial, logActivity, resolveAndSaveTaskPrompt } from '../lib/queue-runner.js';
import { runTaskPipeline } from '../lib/viral-pipeline.js';
import { getPostFormePostStatus, getPostFormeSocialAccounts } from '../lib/postforme.js';

// Postforme inner-status polling tunables
const STATUS_CHECK_MAX_ATTEMPTS = 5;        // Stop after this many polls if still pending
const STATUS_CHECK_RETRY_MINUTES = 1;       // Wait this long between polls when status is still pending

// Tracks viral tasks the watchdog has recently restarted (prevents double-fire within same process).
// Entry TTL = 2 min, long enough for the pipeline to emit its first heartbeat (appendLog).
const recentlyRestarted = new Map<number, number>();
const RESTART_COOLDOWN_MS = 2 * 60 * 1000;
// If a task's updated_at is older than this and it's still in an in-flight status → assume stuck.
// Pipeline heartbeats every ~30s (appendLog during polling), so 5 min is well beyond normal quiet.
const STUCK_TASK_THRESHOLD_MIN = 5;

async function restartStuckViralTasks(): Promise<void> {
  // Prune cooldown entries
  const now = Date.now();
  for (const [id, ts] of recentlyRestarted) {
    if (now - ts > RESTART_COOLDOWN_MS) recentlyRestarted.delete(id);
  }

  // Tasks in an active status but whose updated_at is stale = pipeline is no longer running
  // (server restart, uncaught rejection, or KIE polling exceeded pipeline lifetime).
  const stuck = await pool.query(`
    SELECT id, user_id, status, current_step
    FROM viral_template_tasks
    WHERE status IN ('pending', 'prompt_generating', 'image_generating', 'video_generating', 'concatenating')
      AND updated_at < NOW() - INTERVAL '${STUCK_TASK_THRESHOLD_MIN} minutes'
  `);

  for (const task of stuck.rows) {
    if (recentlyRestarted.has(task.id)) continue;
    recentlyRestarted.set(task.id, Date.now());

    console.log(`[ViralRunner] 🚨 Task ${task.id} stuck (status=${task.status}, step=${task.current_step}) — restarting pipeline`);
    try {
      // Reset to 'pending' so runTaskPipeline's atomic claim can proceed (it requires status='pending').
      // If another instance concurrently claimed, our reset is a no-op for them.
      await pool.query(
        `UPDATE viral_template_tasks
         SET status = 'pending', current_step = NULL, error = NULL,
             logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [JSON.stringify([{ time: new Date().toISOString(), emoji: '🚨', text: `ระบบตรวจพบ task ค้าง ${STUCK_TASK_THRESHOLD_MIN}+ นาที — กำลัง restart pipeline อัตโนมัติ` }]), task.id]
      );
      // runTaskPipeline has built-in smart-retry: resumes from existing KIE task IDs where possible,
      // or regens failed scenes. Fire-and-forget; pipeline will write its own status back.
      runTaskPipeline(task.id, task.user_id).catch(err => {
        console.error(`[ViralRunner] Watchdog-restart error for task ${task.id}:`, err.message);
      });
    } catch (err: any) {
      console.error(`[ViralRunner] Failed to restart task ${task.id}:`, err.message);
    }
  }
}

/**
 * Poll Postforme for inner per-provider status of items whose status_check_after_at has arrived.
 * - Max STATUS_CHECK_MAX_ATTEMPTS polls per item.
 * - On the first poll, logs "🔄 Checking post status on platforms...".
 * - When all providers reach a final state (success/failed) OR attempts exhausted, logs the
 *   per-platform outcome and clears status_check_after_at to stop polling.
 * - While any provider is still pending, schedules the next poll STATUS_CHECK_RETRY_MINUTES later.
 */
async function pollPostFormeInnerStatus(): Promise<void> {
  let due: { rows: any[] };
  try {
    due = await pool.query(`
      SELECT sq.id, sq.user_id, sq.channel_id, sq.postforme_post_ids, sq.status_check_attempts,
             u.postforme_api_key, u.postforme_api_keys,
             c.postforme_accounts
      FROM schedule_queue sq
      JOIN users u ON u.id = sq.user_id
      JOIN scheduler_channels c ON c.id = sq.channel_id
      WHERE sq.status_check_after_at IS NOT NULL
        AND sq.status_check_after_at <= NOW()
        AND sq.posting_service = 'postforme'
        AND sq.postforme_post_ids IS NOT NULL
      LIMIT 20
    `);
  } catch (err: any) {
    console.error('[ViralRunner] pollPostFormeInnerStatus query error:', err.message);
    return;
  }

  for (const row of due.rows) {
    try {
      const postIds: any[] = Array.isArray(row.postforme_post_ids) ? row.postforme_post_ids : [];
      const spId: string | undefined = postIds.find((p: any) => p?.postId)?.postId;
      if (!spId) {
        // No sp_xxx to query — clear the schedule and move on.
        await pool.query(`UPDATE schedule_queue SET status_check_after_at = NULL WHERE id = $1`, [row.id]);
        continue;
      }

      const attempts: number = row.status_check_attempts || 0;

      // Resolve API key the same way processItem does: try each user key and pick the one
      // whose social-accounts include this channel's spc_xxx accounts; fall back to legacy single key.
      const apiKey = await resolvePostFormeApiKey(row);
      if (!apiKey) {
        await pool.query(
          `UPDATE schedule_queue SET status_check_after_at = NULL WHERE id = $1`,
          [row.id]
        );
        await logActivity(row.user_id, `⚠️ ไม่พบ API Key สำหรับเช็คสถานะ Post ID ${spId}`, 'warning', row.id);
        continue;
      }

      if (attempts === 0) {
        await logActivity(row.user_id, `🔄 Checking post status on platforms...`, 'info', row.id);
      }

      const result = await getPostFormePostStatus(apiKey, spId);
      const newAttempts = attempts + 1;

      if (!result) {
        // Transient API failure — try again later if budget remains.
        if (newAttempts >= STATUS_CHECK_MAX_ATTEMPTS) {
          await pool.query(
            `UPDATE schedule_queue SET status_check_after_at = NULL, status_check_attempts = $1 WHERE id = $2`,
            [newAttempts, row.id]
          );
          await logActivity(row.user_id, `⚠️ ไม่สามารถดึงสถานะ Post ID ${spId} ได้ (ลอง ${STATUS_CHECK_MAX_ATTEMPTS} ครั้งแล้ว)`, 'warning', row.id);
        } else {
          const next = new Date(Date.now() + STATUS_CHECK_RETRY_MINUTES * 60 * 1000);
          await pool.query(
            `UPDATE schedule_queue SET status_check_after_at = $1, status_check_attempts = $2 WHERE id = $3`,
            [next, newAttempts, row.id]
          );
        }
        continue;
      }

      const allFinal = result.results.length > 0 && result.results.every(r => r.status === 'success' || r.status === 'failed');
      const exhausted = newAttempts >= STATUS_CHECK_MAX_ATTEMPTS;

      // Always persist the latest snapshot so the UI can read it even between polls.
      await pool.query(
        `UPDATE schedule_queue
           SET postforme_post_results = $1, status_check_attempts = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [JSON.stringify(result.results), newAttempts, row.id]
      );

      if (allFinal || exhausted) {
        // Stop polling and emit final per-platform log lines.
        await pool.query(`UPDATE schedule_queue SET status_check_after_at = NULL WHERE id = $1`, [row.id]);

        if (result.results.length === 0) {
          await logActivity(row.user_id, `⚠️ Postforme ยังไม่ส่งคืนผลของแต่ละ provider (Post ID ${spId})`, 'warning', row.id);
        } else {
          for (const r of result.results) {
            const platformLabel = (r.platform || 'unknown').charAt(0).toUpperCase() + (r.platform || 'unknown').slice(1);
            if (r.status === 'success') {
              const url = r.platform_url ? ` — ${r.platform_url}` : '';
              await logActivity(row.user_id, `✅ Successfully posted to ${platformLabel}${url}`, 'success', row.id);
            } else if (r.status === 'failed') {
              const reason = r.error ? `: ${r.error}` : '';
              await logActivity(row.user_id, `❌ Failed to post to ${platformLabel}${reason}`, 'error', row.id);
            } else {
              await logActivity(row.user_id, `⏳ ${platformLabel} still pending — will not retry`, 'warning', row.id);
            }
          }
        }
      } else {
        // Still pending on some provider — schedule next poll.
        const next = new Date(Date.now() + STATUS_CHECK_RETRY_MINUTES * 60 * 1000);
        await pool.query(
          `UPDATE schedule_queue SET status_check_after_at = $1 WHERE id = $2`,
          [next, row.id]
        );
      }
    } catch (err: any) {
      console.error(`[ViralRunner] pollPostFormeInnerStatus error for queue ${row.id}:`, err.message);
      // Don't loop forever on the same broken row.
      await pool.query(
        `UPDATE schedule_queue SET status_check_attempts = COALESCE(status_check_attempts, 0) + 1 WHERE id = $1`,
        [row.id]
      ).catch(() => {});
    }
  }
}

/**
 * Find the Postforme API key that owns this row's spc_xxx social accounts.
 * Mirrors the auto-match logic in queue-runner.processItem (postforme branch).
 */
async function resolvePostFormeApiKey(row: any): Promise<string> {
  const userKeys: any[] = row.postforme_api_keys || [];
  const channelAccounts: string[] = (row.postforme_accounts || []).filter((a: string) => a && a.trim() !== '');

  if (channelAccounts.length > 0 && userKeys.length > 0) {
    for (const keyEntry of userKeys) {
      try {
        const keyAccounts = await getPostFormeSocialAccounts(keyEntry.key);
        if (channelAccounts.every(acc => keyAccounts.includes(acc))) {
          return keyEntry.key;
        }
      } catch { /* try next key */ }
    }
    if (userKeys.length === 1) return userKeys[0].key; // fall back to the only key
  }

  return row.postforme_api_key || '';
}

async function processViralTasks(): Promise<void> {
  try {
    // ---- 0) Watchdog: ปิดแล้ว — ให้ user กด "ลองอีกครั้ง" เอง ----
    // await restartStuckViralTasks();

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

      console.log(`[ViralRunner] 🔁 Retrying posting for queue ${r.queue_id} (attempt ${r.posting_attempts + 1})`);
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
        console.error(`[ViralRunner] Retry error for queue ${r.queue_id}:`, err.message);
        await pool.query(
          `UPDATE schedule_queue SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [err.message, r.queue_id]
        );
      }
    }

    // ---- 1b) Postforme inner-status polling ----
    // After processItem marks a postforme post as 'done', it sets status_check_after_at = post_at + 30s.
    // We pick those items up here, GET /v1/social-posts/{sp_xxx}, and log per-provider results.
    await pollPostFormeInnerStatus();

    // ---- 2) Main loop: items running the viral pipeline ----
    const running = await pool.query(`
      SELECT sq.id as queue_id, sq.user_id, sq.external_task_id, sq.channel_id, sq.generate_only
      FROM schedule_queue sq
      WHERE sq.external_task_id LIKE 'viral-%'
        AND sq.status NOT IN ('done', 'failed', 'captioning', 'scheduling', 'posting_retry')
    `);

    if (running.rows.length > 0) console.log(`[ViralRunner] Found ${running.rows.length} viral items to check`);

    for (const item of running.rows) {
      const match = item.external_task_id?.match(/^viral-(\d+)-(\d+)$/);
      if (!match) continue;
      const viralTaskId = parseInt(match[2]);

      const taskResult = await pool.query(
        `SELECT status, current_step, final_video_url, error FROM viral_template_tasks WHERE id = $1`,
        [viralTaskId]
      );
      const task = taskResult.rows[0];
      if (!task) continue;

      console.log(`[ViralRunner] Queue ${item.queue_id}: task=${viralTaskId} status=${task.status} step=${task.current_step}`);

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
        console.log(`[ViralRunner] DEBUG: queue=${item.queue_id} generate_only=${item.generate_only} (type=${typeof item.generate_only})`);
        // generate_only = true → แค่บันทึก video URL แล้วจบ ไม่ต้อง caption + post
        if (item.generate_only) {
          const doneResult = await pool.query(
            `UPDATE schedule_queue SET status = 'done', video_url = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND status IN ('generating', 'viral_running', 'viral_pending', 'pending', 'image_generating')
             RETURNING id`,
            [task.final_video_url, item.queue_id]
          );
          if (doneResult.rows.length === 0) {
            console.log(`[ViralRunner] Queue ${item.queue_id} already locked — skipping`);
            continue;
          }
          console.log(`[ViralRunner] ✅ Task ${viralTaskId} done (generate_only) — saved to history, no posting`);
          await logActivity(item.user_id, '✅ Video เสร็จ — บันทึกประวัติแล้ว', 'success', item.queue_id);
          continue;
        }

        // Lock: set status = 'captioning' (atomic)
        const lockResult = await pool.query(
          `UPDATE schedule_queue SET status = 'captioning', video_url = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND status IN ('generating', 'viral_running', 'viral_pending', 'pending', 'image_generating')
           RETURNING id`,
          [task.final_video_url, item.queue_id]
        );
        if (lockResult.rows.length === 0) {
          console.log(`[ViralRunner] Queue ${item.queue_id} already locked — skipping`);
          continue;
        }
        console.log(`[ViralRunner] ✅ Task ${viralTaskId} done! Starting caption + posting...`);
        await logActivity(item.user_id, '✅ Viral Template video เสร็จ! กำลังสร้าง caption...', 'success', item.queue_id);

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
            // FIX D: resolve scene-specific prompt from viral_template_tasks.ai_prompts
            // and persist to schedule_queue.prompt — so caption gets actual scene content,
            // not the meta-instruction template that handoffToViralPipeline left behind.
            const resolvedPrompt = await resolveAndSaveTaskPrompt(
              'viral_template_tasks',
              viralTaskId,
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
              console.log(`[ViralRunner] ✅ Posted queue ${item.queue_id}`);
            } else {
              console.log(`[ViralRunner] ⚠️ Queue ${item.queue_id} posting failed (status already set by stepPostToSocial)`);
            }
          }
        } catch (postErr: any) {
          console.error(`[ViralRunner] Caption/posting error:`, postErr.message);
          await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [postErr.message, item.queue_id]);
          await logActivity(item.user_id, `⚠️ Video เสร็จแล้ว แต่โพสต์ไม่สำเร็จ: ${postErr.message}`, 'error', item.queue_id);
        }
      } else if (task.status === 'failed') {
        console.log(`[ViralRunner] ❌ Task ${viralTaskId} failed: ${task.error}`);
        await pool.query(
          `UPDATE schedule_queue SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [task.error || 'Viral pipeline failed', item.queue_id]
        );
      }
    }
  } catch (err) {
    console.error('[ViralRunner] Error:', err);
  }
}

let isProcessing = false;

async function safeProcessViralTasks() {
  if (isProcessing) return;
  isProcessing = true;
  try { await processViralTasks(); } finally { isProcessing = false; }
}

export function startViralRunnerJob(): void {
  console.log('🎬 [ViralRunner] Job scheduled — every 10 seconds');

  cron.schedule('*/10 * * * * *', () => { safeProcessViralTasks(); });

  setTimeout(() => safeProcessViralTasks(), 5000);
}

export default { startViralRunnerJob };
