import { Router } from 'express';
import archiver from 'archiver';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/requireSubscription.js';
import { scheduleToAllPlatforms, generateCaption } from '../lib/blotato.js';
import {
  runQueue,
  stopQueue,
  isRunning,
  generateQueueForDate,
  getActivityLogs,
  clearActivityLogs,
  getRunnerState,
  updateRunnerState,
  logActivity,
  processItem,
  stopItemRetry,
  checkExistingVidgoTask,
  clearStoppedItem,
  resetRunnerLoop,
} from '../lib/queue-runner.js';
import { runTaskPipeline } from '../lib/viral-pipeline.js';
import { runIdolTaskPipeline } from '../lib/idol-pipeline.js';

const router = Router();

// Request ID deduplication - prevent double-submit from frontend
const recentRequestIds = new Map<string, number>(); // requestId -> timestamp
const REQUEST_DEDUP_WINDOW = 5000; // 5 seconds

// Cleanup old request IDs every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of recentRequestIds) {
    if (now - ts > REQUEST_DEDUP_WINDOW) {
      recentRequestIds.delete(id);
    }
  }
}, 60000);

// GET /api/scheduler/queue - Get queue items for current user
router.get('/', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { channel_id, status, limit = 50, offset = 0, include_generate_only } = req.query;

    const excludeGenOnly = !include_generate_only || include_generate_only === 'false';

    // For 'done' status (history page), use lightweight SELECT; otherwise full SELECT
    const selectColumns = status === 'done'
      ? `q.id, q.video_url, q.thumbnail_url, q.scheduled_time, q.updated_at, q.aspect_ratio, q.channel_id, c.name as channel_name, COUNT(*) OVER() as total_count`
      : `q.*, c.name as channel_name, COUNT(*) OVER() as total_count`;

    let query = `
      SELECT ${selectColumns}
      FROM schedule_queue q
      LEFT JOIN scheduler_channels c ON q.channel_id = c.id
      WHERE q.user_id = $1${excludeGenOnly ? ' AND (q.generate_only IS NULL OR q.generate_only = false)' : ''}
    `;
    const params: any[] = [userId];
    let paramIndex = 2;

    if (channel_id) {
      query += ` AND q.channel_id = $${paramIndex}`;
      params.push(channel_id);
      paramIndex++;
    }

    if (status) {
      query += ` AND q.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // If requesting 'done' items, filter to only those with video_url and within 30 days
    if (status === 'done') {
      query += ` AND q.video_url IS NOT NULL AND q.video_url != ''`;
      query += ` AND q.updated_at >= NOW() - INTERVAL '30 days'`;
    }

    query += ` ORDER BY q.scheduled_time DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

    res.json({
      items: result.rows,
      total: totalCount,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });
  } catch (error) {
    console.error('Error fetching schedule queue:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// Helper: Convert a date string (YYYY-MM-DD) at start/end of day in a timezone to UTC ISO string
function getUTCRangeForDateInTimezone(dateStr: string, timezone: string, isEndOfDay: boolean): string {
  // Create a date at midnight (or end of day) in the target timezone
  // We'll use a workaround since Node.js doesn't have native timezone support
  const [year, month, day] = dateStr.split('-').map(Number);

  // Create a date in UTC, then adjust for the timezone offset
  const date = new Date(Date.UTC(year!, month! - 1, day!, isEndOfDay ? 23 : 0, isEndOfDay ? 59 : 0, isEndOfDay ? 59 : 0, isEndOfDay ? 999 : 0));

  // Get the offset for this timezone at this date
  // We use toLocaleString to find what local time this UTC instant represents in the target timezone
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: timezone });
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  const offsetMs = utcDate.getTime() - tzDate.getTime();

  // Adjust: if we want "start of Feb 9 in NY", we need to find what UTC time that is
  // Start of Feb 9 in NY (UTC-5) = Feb 9, 05:00 UTC
  const adjustedDate = new Date(date.getTime() + offsetMs);

  return adjustedDate.toISOString();
}

// GET /api/scheduler/queue/by-date - Get queue items grouped by date
router.get('/by-date', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { channel_id, start_date, end_date, timezone = 'UTC' } = req.query;
    const tz = (!timezone || timezone === 'local') ? 'UTC' : String(timezone);

    let query = `
      SELECT q.*, c.name as channel_name,
             CASE WHEN q.posting_service IS NULL OR q.posting_service = 'none' THEN c.posting_service ELSE q.posting_service END as posting_service
      FROM schedule_queue q
      LEFT JOIN scheduler_channels c ON q.channel_id = c.id
      WHERE q.user_id = $1 AND (q.generate_only IS NULL OR q.generate_only = false)
    `;
    const params: any[] = [userId];
    let paramIndex = 2;

    if (channel_id) {
      query += ` AND q.channel_id = $${paramIndex}`;
      params.push(channel_id);
      paramIndex++;
    }

    // Convert date range to UTC based on timezone
    // This ensures correct filtering regardless of TIMESTAMP vs TIMESTAMPTZ column type
    if (start_date) {
      const utcStart = getUTCRangeForDateInTimezone(String(start_date), tz, false);
      query += ` AND q.scheduled_time >= $${paramIndex}`;
      params.push(utcStart);
      paramIndex++;
    }

    if (end_date) {
      const utcEnd = getUTCRangeForDateInTimezone(String(end_date), tz, true);
      query += ` AND q.scheduled_time <= $${paramIndex}`;
      params.push(utcEnd);
      paramIndex++;
    }

    query += ` ORDER BY q.scheduled_time ASC`;

    console.log(`[by-date] Query: channel=${channel_id}, start=${start_date}, end=${end_date}, tz=${tz}`);

    const result = await pool.query(query, params);
    console.log(`[by-date] Found ${result.rows.length} items`);

    // Group by date using the specified timezone
    const groupedByDate: Record<string, any[]> = {};
    for (const row of result.rows) {
      const st = row.scheduled_time;
      // Format date in the specified timezone
      const dateObj = st instanceof Date ? st : new Date(st);
      const date = dateObj.toLocaleDateString('sv-SE', { timeZone: tz });

      if (!groupedByDate[date]) {
        groupedByDate[date] = [];
      }
      groupedByDate[date].push(row);
    }

    // Log grouping summary
    console.log(`[by-date] Grouped:`, Object.keys(groupedByDate).map(k => `${k}:${groupedByDate[k].length}`).join(', '));

    res.json(groupedByDate);
  } catch (error) {
    console.error('Error fetching schedule queue by date:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// POST /api/scheduler/queue - Create queue items (bulk)
router.post('/', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { items, autoStart = true } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    console.log(`[Queue] Creating ${items.length} queue items for user ${userId}...`);

    const createdItems = [];
    let skippedCount = 0;

    // Cache channel data to avoid repeated lookups
    const channelCache: Record<number, any> = {};

    for (const item of items) {
      const {
        channel_id,
        scheduled_time,
        prompt,
        variable_values,
        platform: itemPlatform,
        duration: itemDuration,
        aspect_ratio: itemAspectRatio
      } = item;

      // prompt is optional (can be empty string, AI will generate)
      if (!channel_id || !scheduled_time) {
        continue; // Skip invalid items
      }

      // Fetch channel settings (platform, duration, aspect_ratio, ai_model) from DB
      if (!channelCache[channel_id]) {
        const chResult = await pool.query(
          'SELECT platform, duration, aspect_ratio, ai_model FROM scheduler_channels WHERE id = $1 AND user_id = $2',
          [channel_id, userId]
        );
        channelCache[channel_id] = chResult.rows[0] || {};
      }
      const ch = channelCache[channel_id];

      const result = await pool.query(`
        INSERT INTO schedule_queue (
          user_id, channel_id, scheduled_time, prompt,
          variable_values, platform, duration, aspect_ratio, status, ai_model
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
        RETURNING *
      `, [
        userId,
        channel_id,
        scheduled_time,
        prompt,
        JSON.stringify(variable_values || {}),
        itemPlatform || ch.platform || 'sora2-grsai',
        itemDuration || ch.duration || '10',
        itemAspectRatio || ch.aspect_ratio || 'portrait',
        ch.ai_model || null
      ]);

      if (result.rows.length > 0) {
        createdItems.push(result.rows[0]);
      }
    }

    console.log(`[Queue] Created ${createdItems.length - skippedCount} items, skipped ${skippedCount} duplicates`);

    // ✅ AUTO-START RUNNER after items are inserted (fixes race condition)
    let runnerStarted = false;
    if (autoStart && createdItems.length > 0) {
      console.log(`[Queue] Auto-starting runner after creating ${createdItems.length} items...`);

      // Start in background (fire-and-forget)
      runQueue(userId).catch(err => {
        console.error('[Queue] Auto-start runner error:', err);
      });
      runnerStarted = true;
    }

    res.status(201).json({
      created: createdItems.length - skippedCount,
      skipped: skippedCount,
      items: createdItems,
      runnerStarted
    });
  } catch (error) {
    console.error('Error creating schedule queue items:', error);
    res.status(500).json({ error: 'Failed to create queue items' });
  }
});

// PUT /api/scheduler/queue/:id - Update queue item
router.put('/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const {
      scheduled_time,
      prompt,
      variable_values,
      status,
      video_url,
      dropbox_path,
      error,
      platform,
      duration,
      aspect_ratio
    } = req.body;

    console.log(`[Queue PUT] Updating item ${id} for user ${userId}:`, { platform, duration, aspect_ratio, scheduled_time, prompt, status });

    const result = await pool.query(`
      UPDATE schedule_queue
      SET
        scheduled_time = COALESCE($1, scheduled_time),
        prompt = COALESCE($2, prompt),
        variable_values = COALESCE($3, variable_values),
        status = COALESCE($4, status),
        video_url = COALESCE($5, video_url),
        error = COALESCE($6, error),
        platform = COALESCE($7, platform),
        duration = COALESCE($8, duration),
        aspect_ratio = COALESCE($9, aspect_ratio),
        dropbox_path = COALESCE($12, dropbox_path),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10 AND user_id = $11
      RETURNING *
    `, [
      scheduled_time,
      prompt,
      variable_values ? JSON.stringify(variable_values) : null,
      status,
      video_url,
      error,
      platform,
      duration,
      aspect_ratio,
      id,
      userId,
      dropbox_path,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating schedule queue item:', error);
    res.status(500).json({ error: 'Failed to update queue item' });
  }
});

// PUT /api/scheduler/queue/:id/status - Update queue item status
router.put('/:id/status', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { status, video_url, error } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const result = await pool.query(`
      UPDATE schedule_queue
      SET
        status = $1,
        video_url = COALESCE($2, video_url),
        error = COALESCE($3, error),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND user_id = $5
      RETURNING *
    `, [status, video_url, error, id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating queue item status:', error);
    res.status(500).json({ error: 'Failed to update queue item status' });
  }
});

// DELETE /api/scheduler/queue/channel/:channelId - Delete all queue items for a channel
router.delete('/channel/:channelId', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { channelId } = req.params;

    // Delete all items except those currently being processed
    const result = await pool.query(`
      DELETE FROM schedule_queue
      WHERE channel_id = $1 AND user_id = $2 AND status NOT IN ('generating', 'captioning', 'scheduling')
      RETURNING id
    `, [channelId, userId]);

    console.log(`🗑️ Deleted ${result.rows.length} queue items for channel ${channelId}`);
    res.json({ deleted: result.rows.length });
  } catch (error) {
    console.error('Error deleting channel queue items:', error);
    res.status(500).json({ error: 'Failed to delete queue items' });
  }
});

// DELETE /api/scheduler/queue/:id - Delete queue item
router.delete('/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    console.log(`🗑️ Delete request: queue item ${id} for user ${userId}`);

    // First check if item exists
    const checkResult = await pool.query(`
      SELECT id, user_id, status FROM schedule_queue WHERE id = $1
    `, [id]);

    if (checkResult.rows.length === 0) {
      console.log(`❌ Queue item ${id} not found in database`);
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const item = checkResult.rows[0];
    if (item.user_id !== userId) {
      console.log(`❌ Queue item ${id} belongs to user ${item.user_id}, not ${userId}`);
      return res.status(403).json({ error: 'Not authorized to delete this item' });
    }

    console.log(`📋 Found queue item ${id} with status: ${item.status}`);

    const result = await pool.query(`
      DELETE FROM schedule_queue
      WHERE id = $1 AND user_id = $2 AND status NOT IN ('generating', 'captioning', 'scheduling', 'queued')
      RETURNING *
    `, [id, userId]);

    if (result.rows.length === 0) {
      // Check if item exists but is in a protected status
      const check = await pool.query('SELECT status FROM schedule_queue WHERE id = $1 AND user_id = $2', [id, userId]);
      if (check.rows.length > 0) {
        console.log(`❌ Cannot delete queue item ${id}: status is '${check.rows[0].status}'`);
        return res.status(409).json({ error: 'ไม่สามารถลบได้ขณะกำลังประมวลผล' });
      }
      console.log(`❌ Queue item ${id} not found`);
      return res.status(404).json({ error: 'Queue item not found' });
    }

    console.log(`✅ Successfully deleted queue item ${id}`);
    res.json({ success: true, message: 'Queue item deleted successfully' });
  } catch (error) {
    console.error('Error deleting schedule queue item:', error);
    res.status(500).json({ error: 'Failed to delete queue item' });
  }
});

// POST /api/scheduler/queue/retry/:id - Retry failed queue item (or done with partial Blotato failure)
router.post('/retry/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    console.log(`\n========================================`);
    console.log(`[Queue Retry] Starting retry for item ${id} by user ${userId}`);
    console.log(`========================================`);

    // First check current status and video_url
    const checkResult = await pool.query(`
      SELECT status, video_url, blotato_post_ids, external_task_id FROM schedule_queue
      WHERE id = $1 AND user_id = $2
    `, [id, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const item = checkResult.rows[0];
    const hasVideo = item.video_url && item.video_url.startsWith('http');
    const hasBlotatoFailure = item.blotato_post_ids?.some?.((p: any) => p.status === 'failed');
    const isViralItem = typeof item.external_task_id === 'string' && item.external_task_id.startsWith('viral-');

    // Allow retry for 'failed' items OR 'done' items with Blotato failure
    if (item.status !== 'failed' && !(item.status === 'done' && hasBlotatoFailure)) {
      return res.status(400).json({ error: 'Item is not in a retryable state' });
    }

    // ============================================================
    // VIRAL ITEMS: resume existing viral_template_task — ห้ามสร้างใหม่
    // runTaskPipeline มี smart-retry built-in (เช็ค hasPrompts/allImagesDone/allVideosDone)
    // จึงทำงานต่อจากของเดิมโดยไม่เสีย credit ทำซ้ำ
    // ============================================================
    if (isViralItem) {
      const match = (item.external_task_id as string).match(/^viral-(\d+)-(\d+)$/);
      if (match) {
        const viralTaskId = parseInt(match[2]);
        const vt = await pool.query(
          `SELECT id, status, final_video_url FROM viral_template_tasks WHERE id = $1 AND user_id = $2`,
          [viralTaskId, userId]
        );

        if (vt.rows[0]) {
          const viralStatus = vt.rows[0].status;
          const finalVideoUrl = vt.rows[0].final_video_url;
          let updatedQueue: any;

          if (viralStatus === 'done' && finalVideoUrl) {
            // Video เสร็จแล้ว เหลือแค่ posting — reset queue ให้ viralRunnerJob ทำ caption + post ใหม่
            const r = await pool.query(`
              UPDATE schedule_queue
              SET status = 'viral_running',
                  error = NULL,
                  blotato_post_ids = NULL,
                  late_post_ids = NULL,
                  postforme_post_ids = NULL,
                  posting_attempts = 0,
                  retry_after_at = NULL,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND user_id = $2
              RETURNING *
            `, [id, userId]);
            updatedQueue = r.rows[0];
            await pool.query(`
              INSERT INTO scheduler_activity_logs (user_id, queue_item_id, message, log_type)
              VALUES ($1, $2, $3, $4)
            `, [userId, id, '🔄 Retry — viral video พร้อมแล้ว ลองโพสต์ใหม่', 'info']);
            console.log(`[Queue Retry] Viral item ${id}: video done, resuming posting only`);
          } else {
            // Reset viral task → 'pending' แล้วเรียก runTaskPipeline ตรง ๆ
            // (smart-retry ใน runTaskPipeline จะข้ามฉาก/step ที่สำเร็จแล้ว)
            // Watchdog ถูกปิด จึงต้องเรียกเองตรงนี้ ไม่รอ viralRunnerJob
            await pool.query(`
              UPDATE viral_template_tasks
              SET status = 'pending', error = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `, [viralTaskId]);
            const r = await pool.query(`
              UPDATE schedule_queue
              SET status = 'viral_pending',
                  error = NULL,
                  blotato_post_ids = NULL,
                  late_post_ids = NULL,
                  postforme_post_ids = NULL,
                  posting_attempts = 0,
                  retry_after_at = NULL,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND user_id = $2
              RETURNING *
            `, [id, userId]);
            updatedQueue = r.rows[0];
            await pool.query(`
              INSERT INTO scheduler_activity_logs (user_id, queue_item_id, message, log_type)
              VALUES ($1, $2, $3, $4)
            `, [userId, id, `🔄 Retry — ทำงานต่อจาก viral task #${viralTaskId} ที่ค้างอยู่`, 'info']);
            console.log(`[Queue Retry] Viral item ${id}: resuming viral task ${viralTaskId} (status was ${viralStatus})`);
            runTaskPipeline(viralTaskId, userId).catch(err => {
              console.error(`[Queue Retry] Viral retry pipeline error for task ${viralTaskId}:`, err.message);
            });
          }

          // viralRunnerJob (cron 10s) จะรับช่วง posting หลัง pipeline เสร็จ
          return res.json({
            success: true,
            item: updatedQueue,
            runnerStarted: false,
            mode: 'viral-resume'
          });
        }
        console.warn(`[Queue Retry] Viral item ${id}: viral_template_task ${viralTaskId} not found — falling back to legacy retry`);
      } else {
        console.warn(`[Queue Retry] Viral item ${id}: external_task_id "${item.external_task_id}" doesn't match pattern — falling back to legacy retry`);
      }
      // ถ้า fall through มาตรงนี้ = parse ไม่ได้ หรือหา task เดิมไม่เจอ → ใช้ legacy path ข้างล่าง
    }

    // ============================================================
    // IDOL ITEMS: resume existing idol_template_task
    // ============================================================
    const isIdolItem = typeof item.external_task_id === 'string' && item.external_task_id.startsWith('idol-');
    if (isIdolItem) {
      const match = (item.external_task_id as string).match(/^idol-(\d+)-(\d+)$/);
      if (match) {
        const idolTaskId = parseInt(match[2]);
        const it = await pool.query(
          `SELECT id, status, final_video_url FROM idol_template_tasks WHERE id = $1 AND user_id = $2`,
          [idolTaskId, userId]
        );

        if (it.rows[0]) {
          const idolStatus = it.rows[0].status;
          const finalVideoUrl = it.rows[0].final_video_url;
          let updatedQueue: any;

          if (idolStatus === 'done' && finalVideoUrl) {
            const r = await pool.query(`
              UPDATE schedule_queue
              SET status = 'idol_running',
                  error = NULL,
                  blotato_post_ids = NULL,
                  late_post_ids = NULL,
                  postforme_post_ids = NULL,
                  posting_attempts = 0,
                  retry_after_at = NULL,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND user_id = $2
              RETURNING *
            `, [id, userId]);
            updatedQueue = r.rows[0];
            await pool.query(`
              INSERT INTO scheduler_activity_logs (user_id, queue_item_id, message, log_type)
              VALUES ($1, $2, $3, $4)
            `, [userId, id, '🔄 Retry — idol video พร้อมแล้ว ลองโพสต์ใหม่', 'info']);
            console.log(`[Queue Retry] Idol item ${id}: video done, resuming posting only`);
          } else {
            await pool.query(`
              UPDATE idol_template_tasks
              SET status = 'pending', error = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `, [idolTaskId]);
            const r = await pool.query(`
              UPDATE schedule_queue
              SET status = 'idol_pending',
                  error = NULL,
                  blotato_post_ids = NULL,
                  late_post_ids = NULL,
                  postforme_post_ids = NULL,
                  posting_attempts = 0,
                  retry_after_at = NULL,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND user_id = $2
              RETURNING *
            `, [id, userId]);
            updatedQueue = r.rows[0];
            await pool.query(`
              INSERT INTO scheduler_activity_logs (user_id, queue_item_id, message, log_type)
              VALUES ($1, $2, $3, $4)
            `, [userId, id, `🔄 Retry — ทำงานต่อจาก idol task #${idolTaskId} ที่ค้างอยู่`, 'info']);
            console.log(`[Queue Retry] Idol item ${id}: resuming idol task ${idolTaskId} (status was ${idolStatus})`);
            runIdolTaskPipeline(idolTaskId, userId).catch(err => {
              console.error(`[Queue Retry] Idol retry pipeline error for task ${idolTaskId}:`, err.message);
            });
          }

          return res.json({
            success: true,
            item: updatedQueue,
            runnerStarted: false,
            mode: 'idol-resume'
          });
        }
        console.warn(`[Queue Retry] Idol item ${id}: idol_template_task ${idolTaskId} not found — falling back to legacy retry`);
      } else {
        console.warn(`[Queue Retry] Idol item ${id}: external_task_id "${item.external_task_id}" doesn't match pattern — falling back to legacy retry`);
      }
    }

    // ============================================================
    // LEGACY / NON-VIRAL: pending → processItem
    // ============================================================
    const runnerIsActive = isRunning(userId);
    const newStatus = 'pending';

    // Reset status - keep video_url if exists (so we skip video generation on retry)
    const result = await pool.query(`
      UPDATE schedule_queue
      SET
        status = $4,
        error = NULL,
        video_url = CASE WHEN $3 THEN video_url ELSE NULL END,
        blotato_post_ids = NULL,
        late_post_ids = NULL,
        postforme_post_ids = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId, hasVideo, newStatus]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Failed to update queue item' });
    }

    const retryType = hasVideo ? 'posting only' : 'full regeneration';
    console.log(`[Queue Retry] Item ${id} set to '${newStatus}' (${retryType}), runnerActive=${runnerIsActive}`);

    // Log the retry attempt
    const logMessage = hasVideo
      ? '🔄 Retry requested - retrying posting only (video exists)'
      : '🔄 Retry requested - full regeneration';
    await pool.query(`
      INSERT INTO scheduler_activity_logs (user_id, queue_item_id, message, log_type)
      VALUES ($1, $2, $3, $4)
    `, [userId, id, logMessage, 'info']);

    // Always call processItem directly — DB-level lock prevents duplicate processing
    // (Previously relied on runQueue to pick up 'queued' items, but runner loop may have already exited)
    console.log(`[Queue Retry] Calling processItem(${userId}, ${id})... (runnerActive=${runnerIsActive})`);
    processItem(userId, parseInt(id))
      .then((result) => {
        console.log(`[Queue Retry] processItem completed for item ${id}:`, result);
      })
      .catch(err => {
        console.error(`[Queue Retry] processItem ERROR for item ${id}:`, err);
      });

    res.json({
      success: true,
      item: result.rows[0],
      runnerStarted: !runnerIsActive // true if we started it, false if runner will handle it
    });
  } catch (error) {
    console.error('Error retrying queue item:', error);
    res.status(500).json({ error: 'Failed to retry queue item' });
  }
});

// POST /api/scheduler/queue/retry-all-failed - Bulk retry all failed items for a channel
router.post('/retry-all-failed', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { channel_id } = req.body;

    if (!channel_id) {
      return res.status(400).json({ error: 'channel_id is required' });
    }

    console.log(`\n========================================`);
    console.log(`[Queue Bulk Retry] Retrying all failed items for channel ${channel_id}, user ${userId}`);
    console.log(`========================================`);

    // Find all failed items for this channel
    const failedItems = await pool.query(`
      SELECT id, video_url FROM schedule_queue
      WHERE user_id = $1 AND channel_id = $2 AND status = 'failed'
    `, [userId, channel_id]);

    if (failedItems.rows.length === 0) {
      return res.json({ success: true, count: 0, message: 'No failed items to retry' });
    }

    console.log(`[Queue Bulk Retry] Found ${failedItems.rows.length} failed items`);

    // Check if runQueue is already running
    const runnerIsActive = isRunning(userId);
    // If runner active: set to 'queued' so it picks them up immediately
    // If not active: set to 'pending' (will be picked up when runner starts)
    const newStatus = runnerIsActive ? 'queued' : 'pending';

    // Reset all failed items
    const result = await pool.query(`
      UPDATE schedule_queue
      SET
        status = $3,
        error = NULL,
        blotato_post_ids = NULL,
        late_post_ids = NULL,
        postforme_post_ids = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND channel_id = $2 AND status = 'failed'
      RETURNING id
    `, [userId, channel_id, newStatus]);

    const retriedCount = result.rows.length;
    console.log(`[Queue Bulk Retry] Reset ${retriedCount} items to '${newStatus}', runnerActive=${runnerIsActive}`);

    // Log the bulk retry
    await pool.query(`
      INSERT INTO scheduler_activity_logs (user_id, channel_id, message, log_type)
      VALUES ($1, $2, $3, $4)
    `, [userId, channel_id, `🔄 Bulk retry: ${retriedCount} failed items reset to ${newStatus}`, 'info']);

    res.json({
      success: true,
      count: retriedCount,
      message: `${retriedCount} items queued for retry`
    });
  } catch (error) {
    console.error('Error bulk retrying queue items:', error);
    res.status(500).json({ error: 'Failed to retry queue items' });
  }
});

// POST /api/scheduler/queue/:id/unlimited-retry - Enable unlimited retry mode
router.post('/:id/unlimited-retry', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    // Verify ownership
    const checkResult = await pool.query(`
      SELECT id, status FROM schedule_queue WHERE id = $1 AND user_id = $2
    `, [id, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const item = checkResult.rows[0];
    if (!['pending', 'failed', 'generating'].includes(item.status)) {
      return res.status(400).json({ error: `Cannot enable unlimited retry for status: ${item.status}` });
    }

    // Check if runner is active and item is already being processed
    const runnerIsActive = isRunning(userId);
    const alreadyProcessing = item.status === 'generating';

    // If runner is active: set to 'queued' so runQueue picks it up
    // If not active OR item not already processing: set to 'generating' and call processItem
    const newStatus = (runnerIsActive && !alreadyProcessing) ? 'queued' : 'generating';

    await pool.query(`
      UPDATE schedule_queue
      SET retry_mode = 'unlimited', status = $2, error = NULL, retry_count = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id, newStatus]);

    await logActivity(userId, `🔄 Unlimited retry mode enabled`, 'info', parseInt(id));

    // Only call processItem if runner is NOT active AND item is not already processing
    if (!runnerIsActive && !alreadyProcessing) {
      console.log(`[unlimited-retry] Runner not active, calling processItem(${userId}, ${id})...`);
      processItem(userId, parseInt(id)).catch(err => {
        console.error(`[unlimited-retry] Process error:`, err);
      });
    } else {
      console.log(`[unlimited-retry] Runner active or item already processing, skipping direct processItem call`);
    }

    res.json({ success: true, message: 'Unlimited retry enabled' });
  } catch (error: any) {
    console.error('Error enabling unlimited retry:', error);
    res.status(500).json({ error: 'Failed to enable unlimited retry' });
  }
});

// POST /api/scheduler/queue/:id/stop-retry - Stop retrying a specific item
router.post('/:id/stop-retry', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    console.log(`🛑 [STOP-RETRY] Called for item ${id} by user ${userId}`);

    // Verify ownership
    const checkResult = await pool.query(`
      SELECT id FROM schedule_queue WHERE id = $1 AND user_id = $2
    `, [id, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    // Mark item to stop retrying (in-memory flag for any running retry)
    console.log(`[/stop-retry endpoint] ⚠️ STATUS->FAILED (reason: user clicked Stop on single item) item=${id}`);
    stopItemRetry(parseInt(id));

    // Set to 'failed' immediately so frontend shows FAILED right away
    await pool.query(`
      UPDATE schedule_queue
      SET status = 'failed', error = 'Stopped by user', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
    `, [id, userId]);

    await logActivity(userId, `🛑 Stopped`, 'warning', parseInt(id));

    res.json({ success: true, message: 'Stopped' });
  } catch (error: any) {
    console.error('Error stopping item retry:', error);
    res.status(500).json({ error: 'Failed to stop item retry' });
  }
});

// POST /api/scheduler/queue/generate/:id - Generate single item
router.post('/generate/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    console.log(`[Queue] Generate single item ${id} for user ${userId}`);

    // Clear stopped flag so this item can be processed
    clearStoppedItem(parseInt(id));

    // Check item exists with user's Vidgo API key
    const checkResult = await pool.query(`
      SELECT q.*, u.vidgo_api_key
      FROM schedule_queue q
      LEFT JOIN users u ON q.user_id = u.id
      WHERE q.id = $1 AND q.user_id = $2
    `, [id, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const item = checkResult.rows[0];
    // ทำใหม่ได้ทุก status ยกเว้น done (เสร็จแล้ว)
    if (item.status === 'done') {
      return res.status(400).json({ error: 'Item already completed' });
    }

    // Check if there's an existing Vidgo task we can reuse
    if (item.external_task_id && item.vidgo_api_key) {
      console.log(`[Queue] Checking existing task ${item.external_task_id}...`);
      await logActivity(userId, `🔍 Checking previous task...`, 'info', parseInt(id));

      const taskResult = await checkExistingVidgoTask(item.external_task_id, item.vidgo_api_key);

      if (taskResult.status === 'ready' && taskResult.videoUrl) {
        // Video is ready! Use it directly
        console.log(`[Queue] Found existing video: ${taskResult.videoUrl}`);
        await pool.query(`
          UPDATE schedule_queue
          SET status = 'done', video_url = $1, error = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [taskResult.videoUrl, id]);
        await logActivity(userId, `✅ Found previous video - using it!`, 'success', parseInt(id));
        return res.json({ success: true, message: 'Used existing video', videoUrl: taskResult.videoUrl });
      }

      if (taskResult.status === 'running') {
        // Task is still running, resume polling
        console.log(`[Queue] Task still running (${taskResult.progress}%), resuming...`);
        await logActivity(userId, `⏳ Previous task still running (${taskResult.progress}%)...`, 'info', parseInt(id));
        // Continue to processItem which will poll for completion
      } else {
        // Task failed, clear it and generate new
        console.log(`[Queue] Previous task failed: ${taskResult.error}, generating new...`);
        await pool.query(`UPDATE schedule_queue SET external_task_id = NULL WHERE id = $1`, [id]);
        await logActivity(userId, `❌ Previous task failed - generating new...`, 'warning', parseInt(id));
      }
    }

    const { generate_only, extend_prompt } = req.body || {};

    // Viral template: resume existing viral task (smart-retry จะข้ามขั้นตอนที่สำเร็จแล้ว)
    const isViralItem = item.external_task_id && String(item.external_task_id).startsWith('viral-');
    if (isViralItem) {
      const match = String(item.external_task_id).match(/^viral-(\d+)-(\d+)$/);
      if (match) {
        const viralTaskId = parseInt(match[2]);
        // Reset viral task → pending เพื่อให้ runTaskPipeline resume (smart-retry ข้ามขั้นที่สำเร็จแล้ว)
        await pool.query(
          `UPDATE viral_template_tasks SET status = 'pending', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [viralTaskId]
        );
        await pool.query(
          `UPDATE schedule_queue SET status = 'viral_pending', error = NULL, generate_only = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id, !!generate_only]
        );
        await logActivity(userId, `🔄 ลองอีกครั้ง — ทำต่อจาก viral task #${viralTaskId}`, 'info', parseInt(id));
        // เรียก pipeline ตรงเลย ไม่ต้องรอ viralRunnerJob/watchdog
        runTaskPipeline(viralTaskId, userId).catch(err => {
          console.error(`[Queue] Viral retry pipeline error for task ${viralTaskId}:`, err.message);
        });
        return res.json({ success: true, message: 'Viral retry started', mode: 'viral-resume' });
      }
    }

    // Idol template: resume existing idol task
    const isIdolItemGen = item.external_task_id && String(item.external_task_id).startsWith('idol-');
    if (isIdolItemGen) {
      const match = String(item.external_task_id).match(/^idol-(\d+)-(\d+)$/);
      if (match) {
        const idolTaskId = parseInt(match[2]);
        await pool.query(
          `UPDATE idol_template_tasks SET status = 'pending', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [idolTaskId]
        );
        await pool.query(
          `UPDATE schedule_queue SET status = 'idol_pending', error = NULL, generate_only = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id, !!generate_only]
        );
        await logActivity(userId, `🔄 ลองอีกครั้ง — ทำต่อจาก idol task #${idolTaskId}`, 'info', parseInt(id));
        runIdolTaskPipeline(idolTaskId, userId).catch(err => {
          console.error(`[Queue] Idol retry pipeline error for task ${idolTaskId}:`, err.message);
        });
        return res.json({ success: true, message: 'Idol retry started', mode: 'idol-resume' });
      }
    }

    // Non-viral: reset to pending + persist generate_only flag
    await pool.query(
      `UPDATE schedule_queue SET status = 'pending', error = NULL, generate_only = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id, !!generate_only]
    );

    // Apply extend_prompt if provided
    if (extend_prompt && typeof extend_prompt === 'string') {
      await pool.query(
        `UPDATE schedule_queue SET extend_prompt = $1 WHERE id = $2 AND user_id = $3`,
        [extend_prompt, id, userId]
      );
    }

    // Process single item (fire-and-forget) — processItem handles its own DB lock
    processItem(userId, parseInt(id), undefined, undefined, undefined, generate_only).catch(err => {
      console.error('[Queue] Single item process error:', err);
    });

    res.json({ success: true, message: 'Generation started' });
  } catch (error) {
    console.error('Error generating single item:', error);
    res.status(500).json({ error: 'Failed to generate item' });
  }
});

// POST /api/scheduler/queue/post/:id - Post a completed item (that was generated without posting)
router.post('/post/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    console.log(`[Queue] Post item ${id} for user ${userId}`);

    const checkResult = await pool.query(`
      SELECT q.* FROM schedule_queue q
      WHERE q.id = $1 AND q.user_id = $2
    `, [id, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const item = checkResult.rows[0];
    if (!item.video_url) {
      return res.status(400).json({ error: 'Item must have a video before posting' });
    }

    // Reset to pending so processItem can pick it up, but it already has video_url + caption
    // processItem will detect video_url exists and skip to posting
    await pool.query(`UPDATE schedule_queue SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

    // Process item — generateOnly=false so it will post
    processItem(userId, parseInt(id)).catch(err => {
      console.error('[Queue] Post item error:', err);
    });

    res.json({ success: true, message: 'Posting started' });
  } catch (error) {
    console.error('Error posting item:', error);
    res.status(500).json({ error: 'Failed to post item' });
  }
});

// GET /api/scheduler/queue/active-gens/:channelId - Get active generate_only items for a channel (last 24h)
router.get('/active-gens/:channelId', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const channelId = parseInt(req.params.channelId);
    if (isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }
    const result = await pool.query(
      `SELECT q.*, c.name as channel_name
       FROM schedule_queue q
       LEFT JOIN scheduler_channels c ON q.channel_id = c.id
       WHERE q.user_id = $1
         AND q.channel_id = $2
         AND q.generate_only = true
         AND q.created_at > NOW() - INTERVAL '24 hours'
       ORDER BY q.created_at ASC`,
      [userId, channelId]
    );
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Error fetching active gens:', error);
    res.status(500).json({ error: 'Failed to fetch active gens' });
  }
});

// GET /api/scheduler/queue/stats - Get queue statistics
// POST /api/scheduler/queue/generate-to-history - Generate N clips and save to history (no posting)
router.post('/generate-to-history', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { channel_id, count = 1, prompt, prompt_mode = 'same', prompts, template_ids, extend_prompts, request_id } = req.body;
    const clipCount = Math.min(Math.max(1, parseInt(count)), 50);

    console.log(`[generate-to-history] Request received: count=${count}, clipCount=${clipCount}, prompts.length=${prompts?.length || 0}, template_ids.length=${template_ids?.length || 0}, request_id=${request_id}`);

    // Deduplicate requests - prevent double-submit
    if (request_id) {
      if (recentRequestIds.has(request_id)) {
        console.log(`[generate-to-history] DUPLICATE REQUEST BLOCKED: request_id=${request_id}`);
        return res.status(409).json({ error: 'Duplicate request', duplicate: true });
      }
      recentRequestIds.set(request_id, Date.now());
    }

    if (!channel_id) {
      return res.status(400).json({ error: 'channel_id required' });
    }

    // Get channel info for platform and prompt templates
    const channelResult = await pool.query(
      `SELECT platform, aspect_ratio, duration, prompt_templates, ai_model FROM scheduler_channels WHERE id = $1 AND user_id = $2`,
      [channel_id, userId]
    );
    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const channel = channelResult.rows[0];

    // For 'varied' mode, get all prompt templates to rotate
    const templates = channel.prompt_templates || [];

    // Validate that we have prompts to use
    if (prompt_mode === 'same' && !prompt) {
      return res.status(400).json({ error: 'Prompt is required for single prompt mode' });
    }
    if (prompt_mode === 'varied' && (!prompts || prompts.length === 0) && templates.length === 0) {
      return res.status(400).json({ error: 'Prompts are required for varied mode (no templates available)' });
    }

    // Create queue items with current time, generate_only
    // Use a transaction for variable processing to avoid race conditions
    const client = await pool.connect();
    const now = new Date();
    const ids: number[] = [];

    try {
      await client.query('BEGIN');

      // Lock channel row for variable updates
      const lockedChannelResult = await client.query(
        `SELECT * FROM scheduler_channels WHERE id = $1 FOR UPDATE`,
        [channel_id]
      );
      const lockedChannel = lockedChannelResult.rows[0];
      // Viral + Idol templates ใช้ ai_prompt_templates แยกจาก prompt_templates (variable mode)
      const isAiTemplateModel = lockedChannel?.ai_model === 'kie_viral_template'
        || lockedChannel?.ai_model === 'kie_idol_template';
      const lockedTemplates = (isAiTemplateModel && lockedChannel?.ai_prompt_templates?.length > 0)
        ? lockedChannel.ai_prompt_templates
        : (lockedChannel?.prompt_templates || templates);
      const lockedTemplatesField: 'ai_prompt_templates' | 'prompt_templates' =
        (isAiTemplateModel && lockedChannel?.ai_prompt_templates?.length > 0) ? 'ai_prompt_templates' : 'prompt_templates';

      for (let i = 0; i < clipCount; i++) {
        let itemPrompt = prompt || '';
        let itemExtendPrompt: string | null = null;
        let templateVariables: any[] = [];
        let extendVariables: any[] = [];
        const variableValues: Record<string, string | string[]> = {};
        let matchingTemplate: any = null;

        if (prompt_mode === 'varied') {
          // Use per-item prompt from prompts array if provided
          if (prompts && prompts[i] !== undefined && prompts[i]) {
            itemPrompt = prompts[i];
            // Find template by ID first (preferred), then fallback to prompt comparison
            const templateId = template_ids?.[i];

            if (templateId && templateId !== '__default__') {
              matchingTemplate = lockedTemplates.find((t: any) => t.id === templateId);
            }
            // Fallback: try to match by prompt text
            if (!matchingTemplate) {
              matchingTemplate = lockedTemplates.find((t: any) => t.prompt_template === prompts[i]);
            }

            console.log(`[generate-to-history] Item ${i}: templateId=${templateId}, matchingTemplate found = ${!!matchingTemplate}, templateVars = ${matchingTemplate?.variables?.length || 0}`);
            console.log(`[generate-to-history] Item ${i}: matchingTemplate.label="${matchingTemplate?.label}" variable names:`, (matchingTemplate?.variables || []).map((v: any) => v.name).join(', '));
            if (matchingTemplate) {
              templateVariables = matchingTemplate.variables || [];
              extendVariables = matchingTemplate.extend_variables || [];
              console.log(`[generate-to-history] Variables: ${templateVariables.map((v: any) => v.name).join(', ')}`);
              console.log(`[generate-to-history] Extend Variables: ${extendVariables.map((v: any) => v.name).join(', ')}`);
            }
          } else if (lockedTemplates.length > 0) {
            const tmpl = lockedTemplates[i % lockedTemplates.length];
            matchingTemplate = tmpl;
            itemPrompt = tmpl.prompt_template || '';
            templateVariables = tmpl.variables || [];
            extendVariables = tmpl.extend_variables || [];
          }
        }

        // Skip if no valid prompt
        if (!itemPrompt) {
          continue;
        }

        // Use extend_prompt from frontend if provided, otherwise get from template
        if (extend_prompts && extend_prompts[i]) {
          itemExtendPrompt = extend_prompts[i];
          console.log(`[generate-to-history] Item ${i}: Using frontend extend_prompt`);
        } else if (matchingTemplate?.extend_prompt_template) {
          itemExtendPrompt = matchingTemplate.extend_prompt_template;
          console.log(`[generate-to-history] Item ${i}: Using template extend_prompt_template`);
        }

        // Process variables จาก template ที่เลือกตรงๆ (matchingTemplate.variables)
        // Per-scene variables (name ลงท้าย _sceneN) group เป็น array ใน variable_values
        // ใช้ scenes_per_video ของ template ที่เลือก (fallback ไป channel-level)
        const channelScenesLimit = matchingTemplate?.scenes_per_video ?? lockedChannel?.viral_scenes_per_video ?? 3;
        for (const variable of templateVariables) {
          const sceneMatch = variable.name.match(/^(.+)_scene(\d+)$/);

          // ข้าม per-scene variable สำหรับฉากที่เกินจำนวนที่ตั้ง
          if (sceneMatch) {
            const sceneNum = parseInt(sceneMatch[2]);
            if (sceneNum > channelScenesLimit) continue;
          }

          const allValues = variable.values || [];
          if (allValues.length === 0) continue;

          // Pick next unused value
          let unusedValues = allValues.filter((v: any) => v.status === 'new' || !v.status);
          if (unusedValues.length === 0) {
            for (const v of allValues) { v.status = 'new'; }
            unusedValues = allValues;
          }

          const pickedValue = unusedValues[unusedValues.length - 1];
          const pickedIndex = allValues.findIndex((v: any) => v.id === pickedValue.id);
          if (pickedIndex !== -1) {
            allValues[pickedIndex].status = 'used';
          }

          // Replace placeholder ในprompt ถ้ามี (non-per-scene variables)
          const curlyPlaceholder = `{${variable.name}}`;
          const squarePlaceholder = `[${variable.name}]`;
          if (itemPrompt.includes(curlyPlaceholder)) {
            itemPrompt = itemPrompt.replace(new RegExp(`\\{${variable.name}\\}`, 'g'), pickedValue.value);
          }
          if (itemPrompt.includes(squarePlaceholder)) {
            itemPrompt = itemPrompt.replace(new RegExp(`\\[${variable.name}\\]`, 'g'), pickedValue.value);
          }

          // Group per-scene เข้า array / non-per-scene เก็บตรงๆ
          if (sceneMatch) {
            const baseName = sceneMatch[1];
            const sceneIdx = parseInt(sceneMatch[2]) - 1;
            if (!Array.isArray(variableValues[baseName])) variableValues[baseName] = [] as any;
            (variableValues[baseName] as any)[sceneIdx] = pickedValue.value;
          } else {
            variableValues[variable.name] = pickedValue.value;
          }
        }

        // Process variables in the extend prompt (if not already resolved by frontend)
        if (itemExtendPrompt && extendVariables.length > 0) {
          for (const variable of extendVariables) {
            const curlyPlaceholder = `{${variable.name}}`;
            const squarePlaceholder = `[${variable.name}]`;
            const hasCurly = itemExtendPrompt.includes(curlyPlaceholder);
            const hasSquare = itemExtendPrompt.includes(squarePlaceholder);

            if (!hasCurly && !hasSquare) continue;

            const allValues = variable.values || [];
            if (allValues.length === 0) continue;

            // Pick next unused value
            let unusedValues = allValues.filter((v: any) => v.status === 'new' || !v.status);
            if (unusedValues.length === 0) {
              for (const v of allValues) { v.status = 'new'; }
              unusedValues = allValues;
            }

            const pickedValue = unusedValues[unusedValues.length - 1];
            const pickedIndex = allValues.findIndex((v: any) => v.id === pickedValue.id);
            if (pickedIndex !== -1) {
              allValues[pickedIndex].status = 'used';
            }

            if (hasCurly) {
              itemExtendPrompt = itemExtendPrompt.replace(new RegExp(`\\{${variable.name}\\}`, 'g'), pickedValue.value);
            }
            if (hasSquare) {
              itemExtendPrompt = itemExtendPrompt.replace(new RegExp(`\\[${variable.name}\\]`, 'g'), pickedValue.value);
            }
            variableValues[`extend_${variable.name}`] = pickedValue.value;
          }
        }

        console.log(`[generate-to-history] Item ${i}: Final extend_prompt = ${itemExtendPrompt?.substring(0, 100)}...`);

        const scheduledTime = new Date(now.getTime() + i * 1000); // stagger by 1s
        const result = await client.query(`
          INSERT INTO schedule_queue (user_id, channel_id, scheduled_time, status, prompt, extend_prompt, variable_values, platform, aspect_ratio, duration, generate_only, ai_model, created_at, updated_at)
          VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, true, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id
        `, [userId, channel_id, scheduledTime.toISOString(), itemPrompt, itemExtendPrompt, JSON.stringify(variableValues), channel.platform, channel.aspect_ratio, channel.duration, channel.ai_model]);
        ids.push(result.rows[0].id);
      }

      // Update channel with used variable values (ใช้ field ที่ถูกต้อง — ai_prompt_templates สำหรับ viral)
      await client.query(`
        UPDATE scheduler_channels SET ${lockedTemplatesField} = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [JSON.stringify(lockedTemplates), channel_id]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Start processing each item directly (processItem handles its own locking)
    // Don't use runQueue — it exits immediately if another runQueue is already active for this user
    console.log(`[generate-to-history] Created ${ids.length} queue items: ${ids.join(', ')}`);
    for (let i = 0; i < ids.length; i++) {
      const tid = template_ids?.[i] || undefined;
      processItem(userId, ids[i], undefined, tid, undefined, true).catch(err => {
        console.error(`[Queue] Generate-to-history processItem error for ${ids[i]}:`, err);
      });
    }

    res.json({ success: true, count: clipCount, ids });
  } catch (error) {
    console.error('Error generating to history:', error);
    res.status(500).json({ error: 'Failed to generate to history' });
  }
});

// POST /api/scheduler/queue/by-ids - Get queue items by IDs
router.post('/by-ids', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.json({ items: [] });
    }
    const placeholders = ids.map((_: any, i: number) => `$${i + 2}`).join(',');
    const result = await pool.query(
      `SELECT * FROM schedule_queue WHERE user_id = $1 AND id IN (${placeholders}) ORDER BY id`,
      [userId, ...ids]
    );
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Error fetching queue items by ids:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/stats', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { channel_id } = req.query;

    let query = `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
        COUNT(CASE WHEN status = 'generating' THEN 1 END) as generating,
        COUNT(CASE WHEN status = 'captioning' THEN 1 END) as captioning,
        COUNT(CASE WHEN status = 'scheduling' THEN 1 END) as scheduling,
        COUNT(CASE WHEN status = 'done' THEN 1 END) as done,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
      FROM schedule_queue
      WHERE user_id = $1
    `;
    const params: any[] = [userId];

    if (channel_id) {
      query += ` AND channel_id = $2`;
      params.push(channel_id);
    }

    const result = await pool.query(query, params);
    const stats = result.rows[0];

    res.json({
      total: parseInt(stats.total),
      pending: parseInt(stats.pending),
      queued: parseInt(stats.queued || 0),
      generating: parseInt(stats.generating),
      captioning: parseInt(stats.captioning || 0),
      scheduling: parseInt(stats.scheduling || 0),
      done: parseInt(stats.done),
      failed: parseInt(stats.failed)
    });
  } catch (error) {
    console.error('Error getting queue stats:', error);
    res.status(500).json({ error: 'Failed to get queue stats' });
  }
});

// GET /api/scheduler/queue/stats-by-channel - Batch per-channel queue stats for current user
router.get('/stats-by-channel', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const result = await pool.query(
      `SELECT channel_id,
              COUNT(*) FILTER (WHERE status='pending')    AS pending,
              COUNT(*) FILTER (WHERE status='queued')     AS queued,
              COUNT(*) FILTER (WHERE status='generating') AS generating,
              COUNT(*) FILTER (WHERE status='captioning') AS captioning,
              COUNT(*) FILTER (WHERE status='scheduling') AS scheduling,
              COUNT(*) FILTER (WHERE status='done')       AS done,
              COUNT(*) FILTER (WHERE status='failed')     AS failed
         FROM schedule_queue
        WHERE user_id = $1
        GROUP BY channel_id`,
      [userId]
    );

    const map: Record<string, any> = {};
    for (const row of result.rows) {
      if (row.channel_id == null) continue;
      map[row.channel_id] = {
        pending: parseInt(row.pending || 0),
        queued: parseInt(row.queued || 0),
        generating: parseInt(row.generating || 0),
        captioning: parseInt(row.captioning || 0),
        scheduling: parseInt(row.scheduling || 0),
        done: parseInt(row.done || 0),
        failed: parseInt(row.failed || 0),
      };
    }

    res.json(map);
  } catch (error) {
    console.error('Error getting queue stats by channel:', error);
    res.status(500).json({ error: 'Failed to get queue stats by channel' });
  }
});

// GET /api/scheduler/queue/dashboard-stats - Comprehensive dashboard statistics
router.get('/dashboard-stats', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);
    const channelId = req.query.channel_id ? parseInt(req.query.channel_id as string) : null;

    const channelFilter = channelId ? ' AND q.channel_id = $2' : '';
    const channelFilterSimple = channelId ? ' AND channel_id = $2' : '';
    const params: any[] = channelId ? [userId, channelId] : [userId];

    // 1. Summary KPI
    const summaryResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status IN ('generating','captioning','scheduling','queued') THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'done' THEN 1 END) as done,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        ROUND(
          COUNT(CASE WHEN status = 'done' THEN 1 END)::numeric /
          NULLIF(COUNT(CASE WHEN status IN ('done','failed') THEN 1 END), 0) * 100, 1
        ) as success_rate,
        COUNT(CASE WHEN status = 'done' AND updated_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as done_today,
        AVG(CASE WHEN status = 'done' THEN EXTRACT(EPOCH FROM (updated_at - created_at)) END) as avg_processing_seconds
      FROM schedule_queue
      WHERE user_id = $1${channelFilterSimple}
    `, params);

    const summary = summaryResult.rows[0];

    // 2. Daily Output Trend
    const daysParam = channelId ? '$3' : '$2';
    const trendParams = [...params, days];
    const trendResult = await pool.query(`
      SELECT
        DATE(scheduled_time) as date,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'done' THEN 1 END) as done,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
      FROM schedule_queue
      WHERE user_id = $1${channelFilterSimple}
        AND scheduled_time >= NOW() - (${daysParam} || ' days')::INTERVAL
      GROUP BY DATE(scheduled_time)
      ORDER BY date
    `, trendParams);

    // 3. Channel Performance
    const channelResult = await pool.query(`
      SELECT
        q.channel_id,
        c.name as channel_name,
        COUNT(*) as total,
        COUNT(CASE WHEN q.status = 'done' THEN 1 END) as done,
        COUNT(CASE WHEN q.status = 'failed' THEN 1 END) as failed,
        ROUND(
          COUNT(CASE WHEN q.status = 'done' THEN 1 END)::numeric /
          NULLIF(COUNT(CASE WHEN q.status IN ('done','failed') THEN 1 END), 0) * 100, 1
        ) as success_rate,
        c.posting_service,
        MAX(q.updated_at) as last_activity
      FROM schedule_queue q
      JOIN scheduler_channels c ON q.channel_id = c.id
      WHERE q.user_id = $1${channelFilter}
      GROUP BY q.channel_id, c.name, c.posting_service
      ORDER BY total DESC
    `, params);

    // 4. Platform Reliability (parse JSONB post results)
    const postResultsQuery = await pool.query(`
      SELECT
        blotato_post_ids,
        late_post_ids
      FROM schedule_queue
      WHERE user_id = $1${channelFilterSimple} AND status = 'done'
        AND (blotato_post_ids IS NOT NULL OR late_post_ids IS NOT NULL)
    `, params);

    const platformStats: Record<string, { success: number; failed: number }> = {};
    for (const row of postResultsQuery.rows) {
      const allPosts = [
        ...(Array.isArray(row.blotato_post_ids) ? row.blotato_post_ids : []),
        ...(Array.isArray(row.late_post_ids) ? row.late_post_ids : []),
      ];
      for (const post of allPosts) {
        const platform = post.platform || 'unknown';
        if (!platformStats[platform]) platformStats[platform] = { success: 0, failed: 0 };
        if (post.status === 'success') platformStats[platform].success++;
        else platformStats[platform].failed++;
      }
    }
    const platformReliability = Object.entries(platformStats).map(([platform, stats]) => ({
      platform,
      success: stats.success,
      failed: stats.failed,
      total: stats.success + stats.failed,
    })).sort((a, b) => b.total - a.total);

    // 5. Posting Heatmap
    const heatmapResult = await pool.query(`
      SELECT
        EXTRACT(DOW FROM scheduled_time) as day_of_week,
        EXTRACT(HOUR FROM scheduled_time) as hour,
        COUNT(*) as count,
        COUNT(CASE WHEN status = 'done' THEN 1 END) as done
      FROM schedule_queue
      WHERE user_id = $1${channelFilterSimple}
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `, params);

    // 6. Top Failures
    const failuresResult = await pool.query(`
      SELECT
        error,
        COUNT(*) as count,
        MAX(updated_at) as last_occurrence
      FROM schedule_queue
      WHERE user_id = $1${channelFilterSimple} AND status = 'failed' AND error IS NOT NULL
      GROUP BY error
      ORDER BY count DESC
      LIMIT 10
    `, params);

    // 7. Pipeline Stage Timing (from activity logs, last 100 done items)
    const timingResult = await pool.query(`
      SELECT
        q.id,
        q.created_at as item_created,
        MIN(CASE WHEN l.message ILIKE '%generating%' OR l.message ILIKE '%start%generat%' THEN l.created_at END) as gen_start,
        MIN(CASE WHEN l.message ILIKE '%caption%' THEN l.created_at END) as caption_start,
        MIN(CASE WHEN l.message ILIKE '%posting%' OR l.message ILIKE '%schedul%' OR l.message ILIKE '%blotato%' OR l.message ILIKE '%late%' THEN l.created_at END) as post_start,
        MAX(l.created_at) as done_at
      FROM schedule_queue q
      JOIN scheduler_activity_logs l ON l.queue_item_id = q.id
      WHERE q.user_id = $1${channelFilter} AND q.status = 'done'
      GROUP BY q.id, q.created_at
      ORDER BY q.id DESC
      LIMIT 100
    `, params);

    let avgGenSec = 0, avgCapSec = 0, avgPostSec = 0;
    let genCount = 0, capCount = 0, postCount = 0;
    for (const row of timingResult.rows) {
      if (row.gen_start && row.caption_start) {
        avgGenSec += (new Date(row.caption_start).getTime() - new Date(row.gen_start).getTime()) / 1000;
        genCount++;
      }
      if (row.caption_start && row.post_start) {
        avgCapSec += (new Date(row.post_start).getTime() - new Date(row.caption_start).getTime()) / 1000;
        capCount++;
      }
      if (row.post_start && row.done_at) {
        avgPostSec += (new Date(row.done_at).getTime() - new Date(row.post_start).getTime()) / 1000;
        postCount++;
      }
    }

    res.json({
      summary: {
        total: parseInt(summary.total),
        pending: parseInt(summary.pending),
        inProgress: parseInt(summary.in_progress),
        done: parseInt(summary.done),
        failed: parseInt(summary.failed),
        successRate: parseFloat(summary.success_rate) || 0,
        doneToday: parseInt(summary.done_today),
        avgProcessingSeconds: Math.round(parseFloat(summary.avg_processing_seconds) || 0),
      },
      dailyTrend: trendResult.rows.map(r => ({
        date: r.date?.toISOString?.()?.split('T')[0] || r.date,
        total: parseInt(r.total),
        done: parseInt(r.done),
        failed: parseInt(r.failed),
        pending: parseInt(r.pending),
      })),
      channelPerformance: channelResult.rows.map(r => ({
        channelId: r.channel_id,
        channelName: r.channel_name,
        total: parseInt(r.total),
        done: parseInt(r.done),
        failed: parseInt(r.failed),
        successRate: parseFloat(r.success_rate) || 0,
        postingService: r.posting_service || 'none',
        lastActivity: r.last_activity,
      })),
      platformReliability,
      postingHeatmap: heatmapResult.rows.map(r => ({
        dayOfWeek: parseInt(r.day_of_week),
        hour: parseInt(r.hour),
        count: parseInt(r.count),
        done: parseInt(r.done),
      })),
      topErrors: failuresResult.rows.map(r => ({
        error: r.error,
        count: parseInt(r.count),
        lastOccurrence: r.last_occurrence,
      })),
      pipelineTiming: {
        avgGenerationSeconds: genCount > 0 ? Math.round(avgGenSec / genCount) : 0,
        avgCaptioningSeconds: capCount > 0 ? Math.round(avgCapSec / capCount) : 0,
        avgPostingSeconds: postCount > 0 ? Math.round(avgPostSec / postCount) : 0,
      },
    });
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

// POST /api/scheduler/queue/:id/post-to-social - Post video to social media via Blotato
router.post('/:id/post-to-social', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    // Get queue item with channel info
    const queueResult = await pool.query(`
      SELECT q.*, c.blotato_account_id, c.blotato_api_key, c.page_ids, c.caption_language, c.custom_hashtags
      FROM schedule_queue q
      LEFT JOIN scheduler_channels c ON q.channel_id = c.id
      WHERE q.id = $1 AND q.user_id = $2
    `, [id, userId]);

    if (queueResult.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const item = queueResult.rows[0];

    if (!item.video_url) {
      return res.status(400).json({ error: 'Video URL is required. Generate video first.' });
    }

    if (!item.blotato_account_id) {
      return res.status(400).json({ error: 'Blotato Account ID not configured for this channel' });
    }

    const pageIds = item.page_ids || {};
    const hasPageIds = Object.values(pageIds).some((id: any) => id && id.trim() !== '');

    if (!hasPageIds) {
      return res.status(400).json({ error: 'No social media page IDs configured for this channel' });
    }

    // Update status to scheduling
    await pool.query(`
      UPDATE schedule_queue SET status = 'scheduling', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);

    // Generate caption if not exists
    let caption = item.caption;
    if (!caption) {
      // Get OpenAI API key
      const apiKeyResult = await pool.query(`
        SELECT key_value FROM api_keys WHERE key_name = 'openai_api_key'
      `);
      const openaiApiKey = apiKeyResult.rows[0]?.key_value || '';

      caption = await generateCaption(
        item.prompt,
        item.caption_language || 'en',
        item.custom_hashtags || '',
        openaiApiKey
      );

      // Save caption
      await pool.query(`
        UPDATE schedule_queue SET caption = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [caption, id]);
    }

    // Post to all configured platforms
    console.log(`📤 Posting queue item ${id} to social media...`);
    const results = await scheduleToAllPlatforms(
      item.blotato_account_id,
      pageIds,
      item.video_url,
      caption,
      undefined, // scheduledTime
      item.blotato_api_key
    );

    // Update with post results
    const allSuccessful = results.every(r => r.status === 'success');
    const finalStatus = allSuccessful ? 'done' : 'failed';
    const errorMessage = results
      .filter(r => r.status === 'failed')
      .map(r => `${r.platform}: ${r.error}`)
      .join('; ');

    await pool.query(`
      UPDATE schedule_queue
      SET
        status = $1,
        blotato_post_ids = $2,
        error = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `, [
      finalStatus,
      JSON.stringify(results),
      errorMessage || null,
      id
    ]);

    res.json({
      success: allSuccessful,
      results,
      caption
    });
  } catch (error: any) {
    console.error('Error posting to social media:', error);

    // Update status to failed
    await pool.query(`
      UPDATE schedule_queue
      SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [error.message, req.params.id]);

    res.status(500).json({ error: 'Failed to post to social media', details: error.message });
  }
});

// POST /api/scheduler/queue/:id/generate-caption - Generate caption for queue item
router.post('/:id/generate-caption', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    // Get queue item with channel info
    const queueResult = await pool.query(`
      SELECT q.*, c.caption_language, c.custom_hashtags
      FROM schedule_queue q
      LEFT JOIN scheduler_channels c ON q.channel_id = c.id
      WHERE q.id = $1 AND q.user_id = $2
    `, [id, userId]);

    if (queueResult.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const item = queueResult.rows[0];

    // Get OpenAI API key
    const apiKeyResult = await pool.query(`
      SELECT key_value FROM api_keys WHERE key_name = 'openai_api_key'
    `);
    const openaiApiKey = apiKeyResult.rows[0]?.key_value || '';

    const caption = await generateCaption(
      item.prompt,
      item.caption_language || 'en',
      item.custom_hashtags || '',
      openaiApiKey
    );

    // Save caption
    await pool.query(`
      UPDATE schedule_queue SET caption = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [caption, id]);

    res.json({ caption });
  } catch (error: any) {
    console.error('Error generating caption:', error);
    res.status(500).json({ error: 'Failed to generate caption', details: error.message });
  }
});

// ============================================
// QUEUE RUNNER ENDPOINTS
// ============================================

// POST /api/scheduler/queue/run - Start queue processing
router.post('/run', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { force, channel_id, dates, date, timezone: rawTimezone, template_id, template_mode, generate_only, request_id, extend_prompts } = req.body;
    const timezone = (!rawTimezone || rawTimezone === 'local') ? 'UTC' : rawTimezone;
    // Support both 'dates' (array) and 'date' (single string) for backward compatibility
    const filterDates: string[] | undefined = dates || (date ? [date] : undefined);

    // Dedup: reject duplicate request within 5 seconds
    if (request_id && recentRequestIds.has(request_id)) {
      console.log(`[Queue] Duplicate request_id: ${request_id}`);
      return res.status(409).json({ error: 'Duplicate request' });
    }
    if (request_id) {
      recentRequestIds.set(request_id, Date.now());
      setTimeout(() => recentRequestIds.delete(request_id), 5000);
    }

    console.log(`\n[Queue] ========================================`);
    console.log(`[Queue] Run request for user ${userId}${channel_id ? ` (channel ${channel_id})` : ' (all channels)'}${filterDates ? ` (dates ${filterDates.join(',')})` : ''}`);
    console.log(`[Queue] force=${force}, isRunning=${isRunning(userId)}`);

    // Check how many pending items exist (filtered by channel and dates if specified)
    // Count both 'pending' AND 'queued' items (queued items may be stuck from a previous run)
    let pendingQuery = 'SELECT COUNT(*) as count FROM schedule_queue WHERE user_id = $1 AND status IN (\'pending\', \'queued\')';
    const params: any[] = [userId];
    let paramIndex = 2;

    if (channel_id) {
      pendingQuery += ` AND channel_id = $${paramIndex++}`;
      params.push(channel_id);
    }

    if (filterDates && filterDates.length > 0 && timezone) {
      // Filter by multiple dates in the specified timezone
      const datePlaceholders = filterDates.map((_, i) => `$${paramIndex + i + 1}`).join(', ');
      pendingQuery += ` AND DATE(scheduled_time AT TIME ZONE 'UTC' AT TIME ZONE $${paramIndex}) IN (${datePlaceholders})`;
      params.push(timezone, ...filterDates);
      paramIndex += 1 + filterDates.length;
    }

    const pendingCheck = await pool.query(pendingQuery, params);
    const pendingCount = parseInt(pendingCheck.rows[0]?.count || '0');
    console.log(`[Queue] Pending items in DB: ${pendingCount}`);

    // If already running, clear runner state so a new runQueue can start
    // (The old runner loop may have exited while background processItem tasks are still running)
    // NOTE: Don't call stopQueue() — that would interrupt currently running background items
    if (isRunning(userId) && !force) {
      console.log(`[Queue] Already running — clearing runner state to start new runQueue for ${pendingCount} pending items`);
      resetRunnerLoop(userId);
      await updateRunnerState(userId, false);
      // Fall through to start a new runQueue below
    }

    // Force reset running state if requested
    if (force) {
      console.log(`[Queue] Force resetting running state`);
      await stopQueue(userId);
      await updateRunnerState(userId, false);
    }

    if (pendingCount === 0) {
      console.log(`[Queue] No pending items to process`);
      return res.json({ success: true, message: 'No pending items', pendingCount });
    }

    // Apply extend_prompts to items before starting (if provided)
    if (extend_prompts && typeof extend_prompts === 'object') {
      for (const [itemId, extPrompt] of Object.entries(extend_prompts)) {
        if (extPrompt && typeof extPrompt === 'string') {
          await pool.query(
            `UPDATE schedule_queue SET extend_prompt = $1 WHERE id = $2 AND user_id = $3`,
            [extPrompt, Number(itemId), userId]
          );
        }
      }
      console.log(`[Queue] Applied extend_prompts to ${Object.keys(extend_prompts).length} items`);
    }

    // Start queue in background (don't await)
    const dateFilter = filterDates ? filterDates.join(',') : undefined;
    console.log(`[Queue] Starting runQueue for user ${userId}${channel_id ? ` (channel ${channel_id})` : ''}${dateFilter ? ` (dates ${dateFilter})` : ''}...`);
    runQueue(userId, undefined, channel_id, dateFilter, timezone, template_id, template_mode, generate_only).catch(err => {
      console.error('[Queue] Runner error:', err);
    });

    console.log(`[Queue] ========================================\n`);
    res.json({ success: true, message: 'Queue started', pendingCount });
  } catch (error: any) {
    console.error('Error starting queue:', error);
    res.status(500).json({ error: 'Failed to start queue' });
  }
});

// POST /api/scheduler/queue/stop - Stop queue processing
router.post('/stop', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    console.log(`[/stop endpoint] ⚠️ User ${userId} called STOP endpoint - will reset all active items to pending`);
    await stopQueue(userId);

    // Force-reset any items stuck in active statuses back to pending
    // This handles orphaned items from crashed/restarted server processes
    const resetResult = await pool.query(`
      UPDATE schedule_queue
      SET status = 'pending', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND status IN ('generating', 'captioning', 'scheduling')
      RETURNING id
    `, [userId]);

    if (resetResult.rows.length > 0) {
      // Log per-item so it shows in each item's Activity Log
      for (const row of resetResult.rows) {
        await logActivity(userId, `🛑 Stopped — reset to pending`, 'warning', row.id);
      }
      const ids = resetResult.rows.map((r: any) => r.id).join(', ');
      console.log(`[stopQueue] Force-reset ${resetResult.rows.length} items for user ${userId}: ${ids}`);
    }

    res.json({ success: true, message: 'Queue stopped', resetCount: resetResult.rows.length });
  } catch (error: any) {
    console.error('Error stopping queue:', error);
    res.status(500).json({ error: 'Failed to stop queue' });
  }
});

// GET /api/scheduler/queue/runner-status - Get runner status
router.get('/runner-status', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const state = await getRunnerState(userId);
    res.json({
      isRunning: isRunning(userId),
      currentItemId: state.current_item_id,
      lastUpdated: state.last_updated,
    });
  } catch (error: any) {
    console.error('Error getting runner status:', error);
    res.status(500).json({ error: 'Failed to get runner status' });
  }
});

// GET /api/scheduler/queue/activity-logs - Get activity logs
router.get('/activity-logs', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { limit = 50 } = req.query;
    const logs = await getActivityLogs(userId, parseInt(limit as string));
    res.json(logs);
  } catch (error: any) {
    console.error('Error getting activity logs:', error);
    res.status(500).json({ error: 'Failed to get activity logs' });
  }
});

// DELETE /api/scheduler/queue/activity-logs - Clear activity logs
router.delete('/activity-logs', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    await clearActivityLogs(userId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error clearing activity logs:', error);
    res.status(500).json({ error: 'Failed to clear activity logs' });
  }
});

// GET /api/scheduler/queue/:id/logs - Get activity logs for specific queue item
router.get('/:id/logs', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const queueItemId = parseInt(req.params.id);

    // Verify user owns this queue item
    const itemResult = await pool.query(`
      SELECT id FROM schedule_queue WHERE id = $1 AND user_id = $2
    `, [queueItemId, userId]);

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    // Get logs for this specific queue item (dedup ข้อความเดียวกันภายใน 15 วินาที)
    const logsResult = await pool.query(`
      SELECT * FROM (
        SELECT DISTINCT ON (md5(message), FLOOR(EXTRACT(EPOCH FROM created_at) / 15))
          id, user_id, queue_item_id, message, log_type, created_at
        FROM scheduler_activity_logs
        WHERE user_id = $1 AND queue_item_id = $2
        ORDER BY FLOOR(EXTRACT(EPOCH FROM created_at) / 15), md5(message), id ASC
      ) deduped
      ORDER BY created_at ASC
    `, [userId, queueItemId]);

    res.json(logsResult.rows);
  } catch (error: any) {
    console.error('Error getting queue item logs:', error);
    res.status(500).json({ error: 'Failed to get queue item logs' });
  }
});

// POST /api/scheduler/queue/generate - Generate queue items for a date
router.post('/generate', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { date } = req.body;

    // Default to today if no date provided
    const targetDate = date || new Date().toISOString().split('T')[0];

    const result = await generateQueueForDate(userId, targetDate);

    res.json({
      success: true,
      date: targetDate,
      created: result.created,
      logs: result.logs,
    });
  } catch (error: any) {
    console.error('Error generating queue:', error);
    res.status(500).json({ error: 'Failed to generate queue', details: error.message });
  }
});

// POST /api/scheduler/queue/bulk-generate - Bulk generate queue items for multiple dates with custom time slots
router.post('/bulk-generate', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { channel_id, dates, time_slots } = req.body;

    if (!channel_id || !dates || !Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: 'channel_id and dates array are required' });
    }

    if (!time_slots || !Array.isArray(time_slots) || time_slots.length === 0) {
      return res.status(400).json({ error: 'time_slots array is required' });
    }

    // Get channel
    const channelResult = await pool.query(`
      SELECT * FROM scheduler_channels WHERE id = $1 AND user_id = $2
    `, [channel_id, userId]);

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    // Check if channel uses AI Prompt System
    const hasAISystem = channel.system_prompt;

    // Get example prompts for AI system
    let examplePrompts: any[] = [];
    if (hasAISystem) {
      const examplesResult = await pool.query(`
        SELECT * FROM channel_example_prompts
        WHERE channel_id = $1
        ORDER BY times_used ASC, RANDOM()
      `, [channel_id]);
      examplePrompts = examplesResult.rows;
    }

    const useAIPrompt = hasAISystem && examplePrompts.length > 0;

    const logs: string[] = [];
    let created = 0;
    const createdItems: any[] = [];

    // Sort dates and time slots
    const sortedDates = [...dates].sort();
    const sortedTimeSlots = [...time_slots].sort();

    for (const dateStr of sortedDates) {
      for (const timeSlot of sortedTimeSlots) {
        const scheduledTime = `${dateStr}T${timeSlot}:00`;

        // Check if already exists
        const existsResult = await pool.query(`
          SELECT id FROM schedule_queue
          WHERE channel_id = $1 AND scheduled_time = $2
        `, [channel_id, scheduledTime]);

        if (existsResult.rows.length > 0) {
          logs.push(`Skip: ${dateStr} at ${timeSlot} (already exists)`);
          continue;
        }

        let prompt = '';

        if (useAIPrompt) {
          // AI SYSTEM: Generate prompt using AI
          // Import and use the generateAIPrompt function from queue-runner
          const { generateAIPromptForBulk } = await import('../lib/queue-runner.js');

          // Select a random example (preferring less used ones)
          const randomExample = examplePrompts[Math.floor(Math.random() * Math.min(examplePrompts.length, 3))];

          const aiResult = await generateAIPromptForBulk(userId, channel, randomExample);

          if (!aiResult.success || !aiResult.prompt) {
            logs.push(`Skip: ${dateStr} at ${timeSlot} (AI error: ${aiResult.error})`);
            continue;
          }

          prompt = aiResult.prompt;
          logs.push(`AI Generated: ${dateStr} at ${timeSlot} (5 credits)`);

        } else if (channel.prompt_template) {
          // Simple template
          prompt = channel.prompt_template;
          logs.push(`Template: ${dateStr} at ${timeSlot}`);

        } else {
          // No prompt system configured
          logs.push(`Skip: ${dateStr} at ${timeSlot} (no prompt system configured)`);
          continue;
        }

        // Create queue item
        const result = await pool.query(`
          INSERT INTO schedule_queue (
            user_id, channel_id, scheduled_time, prompt, variable_values,
            platform, duration, aspect_ratio, status, ai_model
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
          RETURNING *
        `, [
          userId,
          channel_id,
          scheduledTime,
          prompt,
          JSON.stringify({}),
          channel.platform,
          channel.duration,
          channel.aspect_ratio,
          channel.ai_model,
        ]);

        createdItems.push(result.rows[0]);
        created++;
      }
    }

    res.json({
      success: true,
      created,
      items: createdItems,
      logs,
    });
  } catch (error: any) {
    console.error('Error bulk generating queue:', error);
    res.status(500).json({ error: 'Failed to bulk generate queue', details: error.message });
  }
});

// POST /api/scheduler/queue/clear-completed - Clear completed items
router.post('/clear-completed', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;

    const result = await pool.query(`
      DELETE FROM schedule_queue
      WHERE user_id = $1 AND status = 'done'
      RETURNING id
    `, [userId]);

    res.json({
      success: true,
      deleted: result.rowCount,
    });
  } catch (error: any) {
    console.error('Error clearing completed items:', error);
    res.status(500).json({ error: 'Failed to clear completed items' });
  }
});

// POST /api/scheduler/queue/download-zip - Download multiple videos as zip
router.post('/download-zip', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const placeholders = ids.map((_: any, i: number) => `$${i + 3}`).join(',');
    const result = await pool.query(
      `SELECT id, video_url, scheduled_time FROM schedule_queue WHERE id IN (${placeholders}) AND user_id = $1 AND status = $2`,
      [userId, 'done', ...ids]
    );

    const items = result.rows.filter((r: any) => r.video_url);
    if (items.length === 0) {
      return res.status(404).json({ error: 'No videos found' });
    }

    // Download all videos first
    const videos: { name: string; buffer: Buffer }[] = [];
    for (const item of items) {
      try {
        const response = await fetch(item.video_url);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          const date = new Date(item.scheduled_time).toISOString().slice(0, 10);
          videos.push({ name: `video_${date}_${item.id}.mp4`, buffer });
        }
      } catch (err) {
        console.error(`Failed to fetch video ${item.id}:`, err);
      }
    }

    if (videos.length === 0) {
      return res.status(404).json({ error: 'No videos could be downloaded' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="videos_${Date.now()}.zip"`);

    const archive = archiver('zip', { store: true });

    archive.on('error', (err: any) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create zip' });
      }
    });

    archive.pipe(res);

    for (const video of videos) {
      archive.append(video.buffer, { name: video.name });
    }

    await archive.finalize();
  } catch (error: any) {
    console.error('Error creating zip:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create zip' });
    }
  }
});

// GET /api/scheduler/queue/download/:id - Proxy download video
router.get('/download/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const result = await pool.query(
      'SELECT video_url FROM schedule_queue WHERE id = $1 AND user_id = $2 AND status = $3',
      [id, userId, 'done']
    );

    if (result.rows.length === 0 || !result.rows[0].video_url) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoUrl = result.rows[0].video_url;
    const response = await fetch(videoUrl);

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch video' });
    }

    res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="video_${id}.mp4"`);

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error: any) {
    console.error('Error downloading video:', error);
    res.status(500).json({ error: 'Failed to download video' });
  }
});

export default router;
