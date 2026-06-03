/**
 * Dropbox Cleanup Job
 *
 * Runs daily at 3:00 AM to delete files older than 60 days from Dropbox.
 *
 * 1. schedule_queue   — deletes the video file (dropbox_path).
 *    After deletion clears dropbox_path (video_url kept for reference).
 *
 * 2. viral_template_tasks — deletes ALL associated Dropbox files:
 *    - Final video  (dropbox_path column)
 *    - Scene images (image_tasks[].image_url → path: /trippleviral/viral/{uid}/{tid}_scene{n}.jpg)
 *    - Scene videos (video_tasks[].video_url → path: /trippleviral/viral/{uid}/{tid}_scene{n}.mp4)
 *    After deletion clears dropbox_path, final_video_url, and the URL fields inside
 *    image_tasks / video_tasks JSONB.
 */

import pool from '../db.js';
import cron from 'node-cron';
import { deleteVideoFromDropbox, isDropboxConfigured } from '../utils/dropbox.js';

const RETENTION_DAYS = 60;

// ─────────────────────────────────────────────────────
// 1. Schedule Queue Cleanup
// ─────────────────────────────────────────────────────
async function cleanupScheduleQueue(): Promise<void> {
  console.log('🗑️ [DropboxCleanup:Queue] Checking for expired videos...');

  const result = await pool.query(`
    SELECT id, dropbox_path, updated_at
    FROM schedule_queue
    WHERE dropbox_path IS NOT NULL
      AND dropbox_path != ''
      AND updated_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
  `);

  if (result.rows.length === 0) {
    console.log('🗑️ [DropboxCleanup:Queue] No expired videos found.');
    return;
  }

  console.log(`🗑️ [DropboxCleanup:Queue] Found ${result.rows.length} expired items.`);
  let deleted = 0, errors = 0;

  for (const row of result.rows) {
    try {
      await deleteVideoFromDropbox(row.dropbox_path);
      await pool.query(
        `UPDATE schedule_queue SET dropbox_path = NULL, video_url = NULL, thumbnail_url = NULL WHERE id = $1`,
        [row.id]
      );
      deleted++;
    } catch (err: any) {
      console.error(`🗑️ [DropboxCleanup:Queue] Failed item ${row.id} (${row.dropbox_path}):`, err.message);
      errors++;
    }
  }

  console.log(`🗑️ [DropboxCleanup:Queue] Done. Deleted: ${deleted}, Errors: ${errors}`);
}

// ─────────────────────────────────────────────────────
// 2. Viral Template Tasks Cleanup
// ─────────────────────────────────────────────────────
async function cleanupViralTasks(): Promise<void> {
  console.log('🗑️ [DropboxCleanup:Viral] Checking for expired viral tasks...');

  // Select tasks whose final video was uploaded to Dropbox and are older than retention period
  const result = await pool.query(`
    SELECT id, user_id, dropbox_path, image_tasks, video_tasks
    FROM viral_template_tasks
    WHERE dropbox_path IS NOT NULL
      AND dropbox_path != ''
      AND updated_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
  `);

  if (result.rows.length === 0) {
    console.log('🗑️ [DropboxCleanup:Viral] No expired viral tasks found.');
    return;
  }

  console.log(`🗑️ [DropboxCleanup:Viral] Found ${result.rows.length} expired tasks.`);
  let deletedFiles = 0, errors = 0;

  for (const row of result.rows) {
    const { id: taskId, user_id: userId, dropbox_path, image_tasks, video_tasks } = row;
    const pathsToDelete: string[] = [];

    // 1. Final video (stored directly in dropbox_path)
    if (dropbox_path) {
      pathsToDelete.push(dropbox_path);
    }

    // 2. Scene images — derive Dropbox path from URL or naming pattern
    //    viral-pipeline stores them as: /trippleviral/viral/{userId}/{taskId}_scene{n}.jpg
    const imageTasks: any[] = Array.isArray(image_tasks) ? image_tasks : [];
    for (const img of imageTasks) {
      if (img.image_url && img.image_url.includes('dropbox')) {
        const scenePath = `/trippleviral/viral/${userId}/${taskId}_scene${img.scene}.jpg`;
        pathsToDelete.push(scenePath);
      }
    }

    // 3. Scene videos — derive Dropbox path from naming pattern
    //    viral-pipeline stores them as: /trippleviral/viral/{userId}/{taskId}_scene{n}.mp4
    const videoTasks: any[] = Array.isArray(video_tasks) ? video_tasks : [];
    for (const vid of videoTasks) {
      if (vid.video_url && vid.video_url.includes('dropbox')) {
        const scenePath = `/trippleviral/viral/${userId}/${taskId}_scene${vid.scene}.mp4`;
        pathsToDelete.push(scenePath);
      }
    }

    // Delete all paths (ignore "not found" errors — already gone)
    for (const filePath of pathsToDelete) {
      try {
        await deleteVideoFromDropbox(filePath);
        deletedFiles++;
      } catch (err: any) {
        // file may already be missing — log but don't block
        console.warn(`🗑️ [DropboxCleanup:Viral] Skipped ${filePath}: ${err.message}`);
        errors++;
      }
    }

    // Clear all Dropbox references in DB
    // - Set image_tasks[].image_url = null, video_tasks[].video_url = null
    const clearedImageTasks = imageTasks.map((img: any) => ({ ...img, image_url: null }));
    const clearedVideoTasks = videoTasks.map((vid: any) => ({ ...vid, video_url: null }));

    await pool.query(
      `UPDATE viral_template_tasks
       SET dropbox_path    = NULL,
           final_video_url = NULL,
           thumbnail_url   = NULL,
           image_tasks     = $1,
           video_tasks     = $2
       WHERE id = $3`,
      [JSON.stringify(clearedImageTasks), JSON.stringify(clearedVideoTasks), taskId]
    );

    console.log(`🗑️ [DropboxCleanup:Viral] Task ${taskId}: deleted ${pathsToDelete.length} file(s).`);
  }

  console.log(`🗑️ [DropboxCleanup:Viral] Done. Files deleted: ${deletedFiles}, Errors: ${errors}`);
}

// ─────────────────────────────────────────────────────
// Main cleanup runner
// ─────────────────────────────────────────────────────
async function cleanupExpiredVideos(): Promise<void> {
  if (!isDropboxConfigured()) return;

  console.log('🗑️ [DropboxCleanup] Starting daily cleanup...');
  try {
    await cleanupScheduleQueue();
  } catch (err) {
    console.error('🗑️ [DropboxCleanup:Queue] Job error:', err);
  }
  try {
    await cleanupViralTasks();
  } catch (err) {
    console.error('🗑️ [DropboxCleanup:Viral] Job error:', err);
  }
  console.log('🗑️ [DropboxCleanup] Daily cleanup complete.');
}

export function startDropboxCleanupJob(): void {
  // Run daily at 3:00 AM
  cron.schedule('0 3 * * *', () => {
    cleanupExpiredVideos().catch(console.error);
  });
  console.log(`🗑️ [DropboxCleanup] Scheduled: daily at 3:00 AM (retention: ${RETENTION_DAYS} days — schedule_queue + viral_template_tasks)`);
}
