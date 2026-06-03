/**
 * Auto-Retry Job for Failed Queue Items
 *
 * Runs every 10 minutes to check for failed items that should be retried.
 * Only retries items from channels that have auto_retry_hours configured.
 * Items are retried after they've been failed for longer than auto_retry_hours.
 */

import pool from '../db.js';
import cron from 'node-cron';
import { runQueue } from '../lib/queue-runner.js';

async function autoRetryFailedItems(): Promise<void> {
  console.log('⏰ [AutoRetry] Checking for failed items to retry...');

  try {
    // Find failed items where enough time has passed since failure
    const result = await pool.query(`
      SELECT sq.id, sq.user_id, sq.channel_id, sc.name as channel_name, sc.auto_retry_hours
      FROM schedule_queue sq
      JOIN scheduler_channels sc ON sq.channel_id = sc.id
      WHERE sq.status = 'failed'
        AND sc.auto_retry_hours IS NOT NULL
        AND sq.updated_at < NOW() - INTERVAL '1 hour' * sc.auto_retry_hours
    `);

    if (result.rows.length === 0) {
      console.log('⏰ [AutoRetry] No items to retry');
      return;
    }

    console.log(`⏰ [AutoRetry] Found ${result.rows.length} items to retry`);

    // Group by user_id to run queue once per user
    const userIds = new Set<number>();

    for (const item of result.rows) {
      // Reset the item to pending and sync platform/duration/aspect_ratio from channel
      await pool.query(`
        UPDATE schedule_queue sq
        SET status = 'pending', error = NULL, video_url = NULL, retry_count = 0,
            platform = sc.platform, duration = sc.duration, aspect_ratio = sc.aspect_ratio,
            updated_at = CURRENT_TIMESTAMP
        FROM scheduler_channels sc
        WHERE sq.id = $1 AND sc.id = sq.channel_id
      `, [item.id]);

      console.log(`⏰ [AutoRetry] Reset item #${item.id} (channel: ${item.channel_name}, auto_retry: ${item.auto_retry_hours}h)`);
      userIds.add(item.user_id);
    }

    // Start queue processing for each affected user
    for (const userId of userIds) {
      console.log(`⏰ [AutoRetry] Starting queue for user ${userId}`);
      runQueue(userId).catch(err => {
        console.error(`⏰ [AutoRetry] Queue error for user ${userId}:`, err);
      });
    }

  } catch (error) {
    console.error('⏰ [AutoRetry] Error:', error);
  }
}

export function startAutoRetryJob(): void {
  console.log('📅 Auto-Retry Job scheduled');
  console.log('   Schedule: Every 5 minutes');
  console.log('   Action: Retry failed items based on channel auto_retry_hours');

  // Run every 5 minutes for faster retry
  cron.schedule('*/5 * * * *', () => {
    autoRetryFailedItems();
  }, {
    timezone: 'Asia/Bangkok'
  });
}


export default { startAutoRetryJob };
