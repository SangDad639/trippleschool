// Queue Runner for Content Scheduler
// Processes queue items: Generate Video -> Caption -> Post to Blotato

import fs from 'fs';
import path from 'path';
import os from 'os';
import pool from '../db.js';
import { scheduleToAllPlatforms, generateCaption } from './blotato.js';
import { scheduleToAllPlatformsViaLate } from './late.js';
import { scheduleViaPostForMe, getPostFormeSocialAccounts, getPostFormePostStatus } from './postforme.js';
import { deductCredits, refundCredits, hasBeenRefunded } from '../services/creditService.js';
import { runTaskPipeline } from './viral-pipeline.js';
import { runIdolTaskPipeline } from './idol-pipeline.js';
import { uploadVideoToDropbox, uploadLocalFileToDropbox, isDropboxConfigured, getSharedLinkFromPath } from '../utils/dropbox.js';
import { applyWatermark, type WatermarkSettings } from '../utils/watermark.js';

/**
 * Sync video_url with Dropbox URL when dropbox_path exists.
 * Called after recovery/resume updates video_url with a raw CDN/provider URL.
 * Prevents CDN URL from overwriting permanent Dropbox URL.
 */
async function syncVideoUrlWithDropbox(itemId: number): Promise<void> {
  try {
    const r = await pool.query('SELECT dropbox_path FROM schedule_queue WHERE id = $1', [itemId]);
    const dropboxPath = r.rows[0]?.dropbox_path;
    if (!dropboxPath) return; // No Dropbox path → nothing to sync
    const sharedUrl = await getSharedLinkFromPath(dropboxPath);
    await pool.query('UPDATE schedule_queue SET video_url = $1 WHERE id = $2', [sharedUrl, itemId]);
    console.log(`[SyncDropbox] Item ${itemId}: synced video_url to Dropbox shared link`);
  } catch (err: any) {
    console.error(`[SyncDropbox] Failed for item ${itemId}:`, err.message);
  }
}

const AI_PROMPT_CREDIT_COST = 5;

// Auto-retry is now unlimited by default (no max limit)
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 180; // 15 minutes max (recovery job will continue after)

// Store running state per user with unique run IDs to prevent race conditions
// Key: userId, Value: unique run ID (string) or null if not running
const activeRunIds = new Map<number, string | null>();

// Track users who have explicitly pressed Stop - this is the source of truth for "stopped"
const stoppedUsers = new Set<number>();

// Track currently running items per user to support multiple concurrent tasks
const runningItemsPerUser = new Map<number, Set<number>>();

// Track items that user requested to stop retrying (per-item stop)
const stoppedRetryItems = new Set<number>();

// Track items currently in retry delay — prevents recovery job from spawning duplicate processItem
const itemsInRetryDelay = new Set<number>();

// Retry delay constants (exponential backoff to avoid API bans)
const INITIAL_RETRY_DELAY_MS = 10000;  // 10 seconds initial delay
const MAX_RETRY_DELAY_MS = 60000;      // 60 seconds max delay

// Helper to generate unique run ID
const generateRunId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// Legacy compatibility - check if user has an active run
const runningUsers = {
  get: (userId: number): boolean => activeRunIds.has(userId) && activeRunIds.get(userId) !== null,
  set: (userId: number, running: boolean) => {
    if (running) {
      // Only set if not already running - to prevent overwriting existing run ID
      if (!activeRunIds.has(userId) || activeRunIds.get(userId) === null) {
        activeRunIds.set(userId, generateRunId());
      }
      // Clear stopped flag when starting a new run
      stoppedUsers.delete(userId);
    } else {
      activeRunIds.set(userId, null);
    }
  }
};

// Get current run ID for a user
const getRunId = (userId: number): string | null => activeRunIds.get(userId) || null;

// Check if a specific run is still active - now checks stoppedUsers instead of runId
const isRunActive = (userId: number, _runId: string): boolean => {
  // A run is active if the user hasn't explicitly stopped it
  return !stoppedUsers.has(userId);
};

// Track item as running
const trackItemRunning = (userId: number, itemId: number) => {
  if (!runningItemsPerUser.has(userId)) {
    runningItemsPerUser.set(userId, new Set());
  }
  runningItemsPerUser.get(userId)!.add(itemId);
};

// Untrack item (finished running)
const untrackItemRunning = (userId: number, itemId: number) => {
  runningItemsPerUser.get(userId)?.delete(itemId);
};

interface ProcessCallbacks {
  onProgress?: (itemId: number, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  onItemStart?: (itemId: number, channelName: string) => void;
  onItemComplete?: (itemId: number, success: boolean) => void;
}

interface VideoGenerationResult {
  success: boolean;
  videoUrl?: string;
  error?: string;
  stopped?: boolean;  // true when interrupted by stop request
  externalTaskId?: string;  // External API task ID (e.g., Vidgo task_id)
  taskId?: string;  // KIE task ID (used by extend to reference the original task)
}

/**
 * Check if an item has been stopped via DB (works across servers)
 * Returns true if the item's status was set to 'failed' with 'Stopped by user'
 */
async function isItemStoppedInDB(itemId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT status, error FROM schedule_queue WHERE id = $1`,
      [itemId]
    );
    if (result.rows.length === 0) return true; // Item deleted = stop
    const { status, error } = result.rows[0];
    return status === 'failed' && error?.includes('Stopped by user');
  } catch {
    return false;
  }
}

/**
 * Log activity to database
 */
export async function logActivity(
  userId: number,
  message: string,
  logType: 'info' | 'success' | 'warning' | 'error' = 'info',
  queueItemId?: number
): Promise<void> {
  try {
    // Skip logging if item was stopped (except for the "Stopped" message itself)
    if (queueItemId && stoppedRetryItems.has(queueItemId) && !message.includes('Stopped')) {
      console.log(`[logActivity] Skipping log for stopped item ${queueItemId}: ${message}`);
      return;
    }

    await pool.query(`
      INSERT INTO scheduler_activity_logs (user_id, queue_item_id, message, log_type)
      VALUES ($1, $2, $3, $4)
    `, [userId, queueItemId || null, message, logType]);
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

/**
 * Format a Date for activity-log display: "dd/MM/yyyy HH:mm:ss" in the given IANA timezone.
 * Falls back to ISO string if the timezone is invalid.
 */
export function formatPostAtForLog(d: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value || '';
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
  } catch {
    return d.toISOString();
  }
}

/**
 * Format an ISO timestamp to match Postforme's dashboard "Post At" column exactly:
 *   "MM/DD/YYYY HH:mm" (e.g. "05/06/2026 17:00") in Asia/Bangkok timezone.
 * Used after fetching scheduled_at from Postforme's GET /v1/social-posts/{id} so the
 * activity log mirrors the dashboard verbatim.
 */
export function formatPostAtAsDashboard(isoOrDate: string | Date): string {
  try {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    if (isNaN(d.getTime())) return String(isoOrDate);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value || '';
    return `${get('month')}/${get('day')}/${get('year')} ${get('hour')}:${get('minute')}`;
  } catch {
    return String(isoOrDate);
  }
}

/**
 * Get activity logs for user
 */
export async function getActivityLogs(userId: number, limit = 50): Promise<any[]> {
  const result = await pool.query(`
    SELECT * FROM scheduler_activity_logs
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [userId, limit]);
  return result.rows;
}

/**
 * Clear activity logs for user
 */
export async function clearActivityLogs(userId: number): Promise<void> {
  await pool.query(`
    DELETE FROM scheduler_activity_logs WHERE user_id = $1
  `, [userId]);
}

/**
 * Update runner state
 */
export async function updateRunnerState(
  userId: number,
  isRunning: boolean,
  currentItemId?: number
): Promise<void> {
  await pool.query(`
    INSERT INTO scheduler_runner_state (user_id, is_running, current_item_id, last_updated)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO UPDATE SET
      is_running = $2,
      current_item_id = $3,
      last_updated = CURRENT_TIMESTAMP
  `, [userId, isRunning, currentItemId || null]);
}

/**
 * Get runner state
 */
export async function getRunnerState(userId: number): Promise<any> {
  const result = await pool.query(`
    SELECT * FROM scheduler_runner_state WHERE user_id = $1
  `, [userId]);
  return result.rows[0] || { is_running: false, current_item_id: null };
}

/**
 * Generate video using Sora2 API
 */
async function generateVideoKieAI(
  prompt: string,
  aspectRatio: string,
  duration: string,
  apiKey: string,
  onProgress?: (message: string) => Promise<void>,
  isStopped?: () => boolean,
  onTaskCreated?: (taskId: string) => Promise<void>,
  itemId?: number,
  aiModel?: string
): Promise<VideoGenerationResult> {
  const startTime = Date.now();
  console.log(`[Sora2] Starting video generation...`);
  console.log(`[Sora2] Prompt: ${prompt.substring(0, 100)}...`);
  console.log(`[Sora2] Aspect ratio: ${aspectRatio}, Duration: ${duration}`);

  try {
    // Block viral template from using this function — it has its own pipeline
    if (aiModel === 'kie_viral_template') {
      console.log(`[Sora2] ⛔ Viral Template should not use generateVideoKieAI — blocking`);
      return { success: false, error: 'Viral Template uses its own pipeline' };
    }

    // Block idol template from using this function — it has its own pipeline
    if (aiModel === 'kie_idol_template') {
      console.log(`[Sora2] ⛔ Idol Template should not use generateVideoKieAI — blocking`);
      return { success: false, error: 'Idol Template uses its own pipeline' };
    }

    // Check stop before creating task (avoid wasting API credits)
    if (isStopped?.()) {
      console.log(`[Sora2] 🛑 Stop requested before task creation`);
      return { success: false, error: 'Stopped by user', stopped: true };
    }

    const requestBody = aiModel === 'kie_grok_imagine' ? {
      model: 'grok-imagine/text-to-video',
      input: {
        prompt,
        aspect_ratio: aspectRatio === 'portrait' ? '9:16' : '16:9',
        mode: 'spicy',
        duration: parseInt(duration) || 10,
        resolution: '720p',
      },
    } : {
      model: 'sora-2-text-to-video',
      input: {
        prompt,
        aspect_ratio: aspectRatio === 'portrait' ? 'portrait' : 'landscape',
        n_frames: String(parseInt(duration) || 10),
        remove_watermark: true,
      },
    };
    console.log(`[Sora2] Request body:`, JSON.stringify(requestBody));

    // Create task
    const createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`[Sora2] Create response status: ${createResponse.status}`);

    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.log(`[Sora2] Create task failed: ${error}`);
      return { success: false, error: `Sora2 error: ${error}` };
    }

    const createData: any = await createResponse.json();
    console.log(`[Sora2] Create response:`, JSON.stringify(createData));

    // Check if KIE returned state=fail immediately in createTask response
    if (createData.data?.state === 'fail' || createData.state === 'fail') {
      const failMsg = createData.data?.failMsg || createData.failMsg || 'Unknown';
      console.log(`[Sora2] KIE returned fail immediately: ${failMsg}`);
      await onProgress?.(`⚠️ KIE rejected task: ${failMsg}`);
      return { success: false, error: `KIE rejected: ${failMsg}` };
    }

    // Check for API error (e.g., credits insufficient)
    // KIE returns code=0 or code=200 for success
    if (createData.code && createData.code !== 0 && createData.code !== 200) {
      const apiError = createData.msg || `API error code: ${createData.code}`;
      console.error(`[Sora2] KIE error response: code=${createData.code}, msg="${apiError}", raw=`, JSON.stringify(createData));
      // Match "insufficient credit" / "no credit" / "credit exhausted" — not just any "credit" mention
      const lowerMsg = apiError.toLowerCase();
      const isCreditError = /insufficient|not enough|exhausted|no credit|balance/.test(lowerMsg) && lowerMsg.includes('credit');
      if (isCreditError) {
        return { success: false, error: `💳 KIE Credit หมด — ${apiError} (กรุณาเติม Credit ที่ kie.ai)` };
      }
      return { success: false, error: `KIE error: ${apiError} (code=${createData.code})` };
    }

    const taskId = createData.data?.taskId;

    if (!taskId) {
      console.log(`[Sora2] No task ID returned!`);
      return { success: false, error: `No task ID returned. Response: ${JSON.stringify(createData)}` };
    }

    console.log(`[Sora2] Task created: ${taskId}`);
    await onTaskCreated?.(taskId);
    await onProgress?.(`📡 KIE Task: ${taskId}`);

    // Poll forever until done, stopped, or too many consecutive errors
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;
    for (let attempt = 0; ; attempt++) {
      if (isStopped?.()) {
        console.log(`[Sora2] 🛑 Stop requested, aborting polling for task ${taskId}`);
        return { success: false, error: 'Stopped by user', stopped: true };
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      if (isStopped?.()) {
        console.log(`[Sora2] 🛑 Stop requested, aborting polling for task ${taskId}`);
        return { success: false, error: 'Stopped by user', stopped: true };
      }

      try {
        console.log(`[Sora2] 📡 Polling attempt ${attempt + 1}: GET recordInfo?taskId=${taskId}`);
        const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });

        if (isStopped?.()) {
          console.log(`[Sora2] 🛑 Stop requested, aborting polling for task ${taskId}`);
          return { success: false, error: 'Stopped by user', stopped: true };
        }

        if (!statusResponse.ok) {
          consecutiveErrors++;
          console.log(`[Sora2] Poll attempt ${attempt + 1} failed: ${statusResponse.status} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            return { success: false, error: `KIE API error ${statusResponse.status} (${MAX_CONSECUTIVE_ERRORS} consecutive failures)` };
          }
          continue;
        }

        consecutiveErrors = 0;

        const statusRaw: any = await statusResponse.json();
        const statusData = statusRaw.data || statusRaw;
        console.log(`[Sora2] Poll attempt ${attempt + 1}:`, JSON.stringify(statusData));

        if (statusData.state === 'success') {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`[Sora2] ✅ State=success! Extracting video URL...`);
          await onProgress?.(`✅ Video generated! Extracting URL... (${elapsed}s)`);

          let videoUrl: string | null = null;

          if (statusData.resultJson) {
            try {
              const resultData = typeof statusData.resultJson === 'string'
                ? JSON.parse(statusData.resultJson)
                : statusData.resultJson;
              videoUrl = resultData.resultUrls?.[0] || resultData.url || resultData.video_url || null;
              if (!videoUrl) {
                console.log(`[Sora2] resultJson parsed but no URL found. Keys:`, Object.keys(resultData));
                console.log(`[Sora2] resultData:`, JSON.stringify(resultData));
              }
            } catch (parseErr) {
              console.log(`[Sora2] Failed to parse resultJson:`, statusData.resultJson);
            }
          }

          if (!videoUrl) {
            videoUrl = statusData.resultUrl || statusData.videoUrl || statusData.url || statusData.video_url || null;
          }

          if (videoUrl) {
            console.log(`[Sora2] Video ready! URL: ${videoUrl} (took ${elapsed}s)`);
            return { success: true, videoUrl, taskId };
          } else {
            console.log(`[Sora2] ⚠️ State=success but no video URL found in response!`);
            console.log(`[Sora2] Full statusData:`, JSON.stringify(statusData));
            await onProgress?.(`⚠️ Server says success but no video URL — retrying...`);
            if (attempt > 5) {
              return { success: false, error: `State=success but no video URL found. Response: ${JSON.stringify(statusData).substring(0, 200)}` };
            }
          }
        }

        if (statusData.state === 'fail') {
          // KIE sometimes returns state='fail' with failMsg='success' — treat as still processing
          if (statusData.failMsg === 'success') {
            if (attempt > 60) { // Give up after 5 minutes (60 * 5s poll interval)
              console.log(`[Sora2] state=fail+failMsg=success persisted for ${attempt} attempts, giving up`);
              return { success: false, error: 'KIE task stuck (state=fail, failMsg=success). Please retry.' };
            }
            console.log(`[Sora2] state=fail but failMsg=success — treating as still processing, continuing poll...`);
          } else {
            console.log(`[Sora2] Video generation failed: ${statusData.failMsg}`);
            return { success: false, error: statusData.failMsg || 'Video generation failed' };
          }
        }

        // Log progress to Activity Log every 30 seconds (every 6 attempts)
        if (attempt > 0 && attempt % 6 === 0) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          await onProgress?.(`⏳ Still generating... state=${statusData.state} (${elapsed}s elapsed)`);
          if (itemId && await isItemStoppedInDB(itemId)) {
            console.log(`[Sora2] 🛑 Stop detected via DB for task ${taskId}`);
            return { success: false, error: 'Stopped by user', stopped: true };
          }
        }

        if (attempt % 3 === 0) {
          console.log(`[Sora2] Still processing... state=${statusData.state} (attempt ${attempt + 1})`);
        }
      } catch (pollError: any) {
        consecutiveErrors++;
        console.error(`[Sora2] ❌ Poll error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, pollError.message);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return { success: false, error: `KIE polling crashed: ${pollError.message} (${MAX_CONSECUTIVE_ERRORS} consecutive failures)` };
        }
      }
    }
  } catch (error: any) {
    console.log(`[Sora2] Exception: ${error.message}`);
    console.log(`[Sora2] Stack:`, error.stack);
    return { success: false, error: error.message };
  }
}

/**
 * Generate video using KIE Grok + Extend (two-phase)
 * Phase 1: Generate 10s Grok video (same as kie_grok_imagine)
 * Phase 2: Call grok-imagine/extend API with the Phase 1 taskId to extend the video
 */
async function generateVideoKieExtend(
  prompt: string,
  extendPrompt: string,
  aspectRatio: string,
  duration: string,
  apiKey: string,
  onProgress?: (message: string) => Promise<void>,
  isStopped?: () => boolean,
  onTaskCreated?: (taskId: string) => Promise<void>,
  itemId?: number,
  existingPhase1TaskId?: string, // Skip Phase 1 if provided (retry Phase 2 only)
): Promise<VideoGenerationResult> {
  console.log(`[KIE-Extend ${itemId}] Starting two-phase generation...`);
  console.log(`[KIE-Extend ${itemId}] Prompt: ${prompt.substring(0, 100)}...`);
  console.log(`[KIE-Extend ${itemId}] Extend Prompt: ${extendPrompt.substring(0, 100)}...`);

  let phase1TaskId = existingPhase1TaskId;

  if (phase1TaskId) {
    // Phase 1 already done — skip directly to Phase 2
    console.log(`[KIE-Extend ${itemId}] Phase 1 already done (taskId=${phase1TaskId}), skipping to Phase 2...`);
    await onProgress?.('♻️ Phase 1 already done, skipping to Phase 2...');
  } else {
    // Phase 1: Generate initial 10s Grok video
    console.log(`[KIE-Extend ${itemId}] Phase 1: Starting 10s Grok video generation...`);
    await onProgress?.('🎬 Phase 1: Generating 10s Grok video...');

    const phase1Result = await generateVideoKieAI(
      prompt,
      aspectRatio,
      '10', // Phase 1 always 10s for Grok
      apiKey,
      async (msg: string) => { await onProgress?.(`[Phase 1] ${msg}`); },
      isStopped,
      async (taskId: string) => {
        // Store with phase1: prefix so resume logic knows which phase
        await onTaskCreated?.(`phase1:${taskId}`);
      },
      itemId,
      'kie_grok_imagine', // Use Grok model for Phase 1
    );

    if (!phase1Result.success || phase1Result.stopped) {
      return phase1Result;
    }

    if (!phase1Result.taskId) {
      return { success: false, error: 'Phase 1 completed but no taskId returned for extend' };
    }

    phase1TaskId = phase1Result.taskId;

    // Save phase1_task_id so retry can skip Phase 1
    if (itemId) {
      await pool.query('UPDATE schedule_queue SET phase1_task_id = $1 WHERE id = $2', [phase1TaskId, itemId]);
      console.log(`[KIE-Extend ${itemId}] Saved phase1_task_id: ${phase1TaskId}`);
    }

    console.log(`[KIE-Extend] Phase 1 complete! taskId=${phase1TaskId}`);
    await onProgress?.('✅ Phase 1 complete! Starting Phase 2: Extending video...');
  }

  // Check stop between phases
  if (isStopped?.()) {
    console.log(`[KIE-Extend] 🛑 Stop requested between phases`);
    return { success: false, error: 'Stopped by user', stopped: true };
  }
  if (itemId && await isItemStoppedInDB(itemId)) {
    console.log(`[KIE-Extend] 🛑 Stop detected via DB between phases`);
    return { success: false, error: 'Stopped by user', stopped: true };
  }

  // Phase 2: Call Extend API
  try {
    const extendBody = {
      model: 'grok-imagine/extend',
      input: {
        task_id: phase1TaskId,
        prompt: extendPrompt || prompt,
        extend_at: 10,
        extend_times: '10',
      },
    };
    console.log(`[KIE-Extend] Phase 2 request:`, JSON.stringify(extendBody));

    const extendResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(extendBody),
    });

    if (!extendResponse.ok) {
      const error = await extendResponse.text();
      console.log(`[KIE-Extend] Phase 2 create task failed: ${error}`);
      return { success: false, error: `Extend error: ${error}` };
    }

    const extendData: any = await extendResponse.json();
    const extendTaskId = extendData.data?.taskId;

    if (!extendTaskId) {
      return { success: false, error: `No extend task ID returned. Response: ${JSON.stringify(extendData)}` };
    }

    console.log(`[KIE-Extend] Phase 2 task created: ${extendTaskId}`);
    // Update external_task_id with phase2: prefix
    await onTaskCreated?.(`phase2:${extendTaskId}`);
    await onProgress?.(`🔄 Phase 2: Extending video (task ${extendTaskId})...`);

    // Poll for extend result (same pattern as generateVideoKieAI)
    const startTime = Date.now();
    const POLL_INTERVAL_MS = 5000;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    for (let attempt = 0; ; attempt++) {
      if (isStopped?.()) {
        console.log(`[KIE-Extend] 🛑 Stop requested during Phase 2 polling`);
        return { success: false, error: 'Stopped by user', stopped: true };
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const statusResponse = await fetch(
          `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${extendTaskId}`,
          { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );

        if (!statusResponse.ok) {
          consecutiveErrors++;
          console.error(`[KIE-Extend] Poll error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): HTTP ${statusResponse.status}`);
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            return { success: false, error: `Extend polling failed: HTTP ${statusResponse.status}` };
          }
          continue;
        }

        consecutiveErrors = 0;
        const statusRaw: any = await statusResponse.json();
        const statusData = statusRaw.data || statusRaw;

        if (statusData.state === 'success') {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`[KIE-Extend] ✅ Phase 2 success!`);

          let videoUrl: string | null = null;
          if (statusData.resultJson) {
            try {
              const resultData = typeof statusData.resultJson === 'string'
                ? JSON.parse(statusData.resultJson)
                : statusData.resultJson;
              videoUrl = resultData.resultUrls?.[0] || resultData.url || resultData.video_url || null;
            } catch (parseErr) {
              console.log(`[KIE-Extend] Failed to parse resultJson:`, statusData.resultJson);
            }
          }
          if (!videoUrl) {
            videoUrl = statusData.resultUrl || statusData.videoUrl || statusData.url || statusData.video_url || null;
          }

          if (videoUrl) {
            console.log(`[KIE-Extend] Extended video ready! URL: ${videoUrl} (Phase 2 took ${elapsed}s)`);
            return { success: true, videoUrl, taskId: extendTaskId };
          } else {
            console.log(`[KIE-Extend] State=success but no video URL`);
            if (attempt > 5) {
              return { success: false, error: `Extend state=success but no URL. Response: ${JSON.stringify(statusData).substring(0, 200)}` };
            }
          }
        }

        if (statusData.state === 'fail') {
          // KIE sometimes returns state='fail' with failMsg='success' — treat as still processing
          if (statusData.failMsg === 'success') {
            if (attempt > 60) { // Give up after 5 minutes
              console.log(`[KIE-Extend] state=fail+failMsg=success persisted for ${attempt} attempts, giving up`);
              return { success: false, error: 'KIE Extend stuck (state=fail, failMsg=success). Please retry.' };
            }
            console.log(`[KIE-Extend] Phase 2 state=fail but failMsg=success — treating as still processing, continuing poll...`);
          } else {
            console.log(`[KIE-Extend] Phase 2 failed: ${statusData.failMsg}`);
            return { success: false, error: `Extend failed: ${statusData.failMsg || 'Unknown error'}` };
          }
        }

        // Progress logging every 30s
        if (attempt > 0 && attempt % 6 === 0) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          await onProgress?.(`⏳ [Phase 2] Still extending... state=${statusData.state} (${elapsed}s elapsed)`);
          if (itemId && await isItemStoppedInDB(itemId)) {
            console.log(`[KIE-Extend] 🛑 Stop detected via DB during Phase 2`);
            return { success: false, error: 'Stopped by user', stopped: true };
          }
        }
      } catch (pollError: any) {
        consecutiveErrors++;
        console.error(`[KIE-Extend] Poll error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, pollError.message);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return { success: false, error: `Extend polling crashed: ${pollError.message}` };
        }
      }
    }
  } catch (error: any) {
    console.log(`[KIE-Extend] Phase 2 exception: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Generate video using Sora2 grsai API
 * API Docs: https://grsaiapi.com
 * - POST /v1/video/sora-video with webHook="-1" returns { code: 0, data: { id: "task-xxx" } }
 * - POST /v1/draw/result returns { status: "running"|"succeeded"|"failed", results: [{url, pid}], progress: 0-100 }
 */
async function generateVideoGrsai(
  prompt: string,
  aspectRatio: string,
  duration: string,
  apiKey: string,
  host: string = 'https://grsaiapi.com',
  onProgress?: (message: string) => Promise<void>,
  isStopped?: () => boolean
): Promise<VideoGenerationResult> {
  const startTime = Date.now();
  let lastProgress = -1; // Track last progress to avoid duplicate logs

  try {
    await onProgress?.('📤 Sending prompt to Server 2...');

    // Create task with webHook="-1" to get task ID synchronously
    const createResponse = await fetch(`${host}/v1/video/sora-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'sora-2',
        prompt,
        aspectRatio: aspectRatio === 'portrait' ? '9:16' : '16:9',
        duration: parseInt(duration),
        size: aspectRatio === 'portrait' ? '768x1344' : '1344x768',
        webHook: '-1', // Get task ID synchronously instead of webhook
      }),
    });

    if (!createResponse.ok) {
      const error = await createResponse.text();
      return { success: false, error: `grsai error: ${error}` };
    }

    const createData: any = await createResponse.json();
    console.log('GRSAI create response:', JSON.stringify(createData));

    // Response format: { code: 0, data: { id: "task-xxx" } }
    const taskId = createData.data?.id || createData.id;

    if (!taskId) {
      return { success: false, error: `No task ID returned from grsai. Response: ${JSON.stringify(createData)}` };
    }

    console.log(`GRSAI task created: ${taskId}`);
    await onProgress?.(`📤 Task created: ${taskId}`);

    // Poll for completion
    await onProgress?.('⏳ Waiting for Server 2 to process...');
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      // Check if stop was requested
      if (isStopped?.()) {
        console.log(`[GRSAI] 🛑 Stop requested, aborting polling for task ${taskId}`);
        return { success: false, error: 'Stopped by user', stopped: true };
      }

      const statusResponse = await fetch(`${host}/v1/draw/result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ id: taskId }),
      });

      if (!statusResponse.ok) {
        console.log(`GRSAI poll attempt ${attempt + 1} failed: ${statusResponse.status}`);
        continue;
      }

      const statusData: any = await statusResponse.json();
      console.log(`GRSAI poll attempt ${attempt + 1}:`, JSON.stringify(statusData));

      // Response format: { code: 0, data: { status: "succeeded", results: [{url, pid}], progress: 100 } }
      // Handle both wrapped (data.status) and unwrapped (status) formats for compatibility
      const resultData = statusData.data || statusData;
      const status = resultData.status;
      const results = resultData.results;
      const progress = resultData.progress || 0;

      if (status === 'succeeded' && results?.[0]?.url) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        await onProgress?.(`✅ Video ready! (took ${elapsed}s)`);
        return { success: true, videoUrl: results[0].url };
      }

      if (status === 'failed') {
        const errorMsg = resultData.error || resultData.failure_reason || 'Video generation failed';
        await onProgress?.(`❌ Server 2 failed: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      // Status is "running" - log progress (only when it changes by 10% or more)
      console.log(`GRSAI progress: ${progress}%`);

      // Log progress every 10% change to avoid spam
      if (progress >= lastProgress + 10 || (progress === 100 && lastProgress !== 100)) {
        await onProgress?.(`⏳ Generating video... ${progress}%`);
        lastProgress = progress;
      }
    }

    await onProgress?.(`❌ Video generation timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
    return { success: false, error: 'Video generation timed out' };
  } catch (error: any) {
    console.error('GRSAI error:', error);
    await onProgress?.(`❌ Server 2 error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Generate video using Vidgo.ai API (Server 3)
 * API Docs: https://vidgo.ai/apis/models/sora-2
 */
async function generateVideoVidgo(
  prompt: string,
  aspectRatio: string,
  duration: string,
  apiKey: string,
  onProgress?: (message: string) => Promise<void>,
  isStopped?: () => boolean,
  onTaskCreated?: (taskId: string) => Promise<void>,  // Callback to save task ID immediately
  aiModel?: string,  // 'sora2_15s' or 'veo3_1'
  itemId?: number
): Promise<VideoGenerationResult> {
  const startTime = Date.now();
  let lastProgress = -1;

  try {
    await onProgress?.('📤 Sending prompt to Server 3 (Vidgo)...');

    // Create task with 30s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let createResponse: Response;
    try {
      createResponse = await fetch('https://api.vidgo.ai/api/generate/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(aiModel === 'veo3_1' ? {
          model: 'veo3.1-fast',
          input: {
            prompt,
            aspect_ratio: aspectRatio === 'portrait' ? '9:16' : '16:9',
            duration: 8,
            resolution: '720p',
          },
        } : aiModel === 'grok_imagine' ? {
          model: 'grok-imagine',
          input: {
            prompt,
            aspect_ratio: aspectRatio === 'portrait' ? '9:16' : '16:9',
            mode: 'spicy',
          },
        } : {
          model: 'sora-2',
          input: {
            prompt,
            aspect_ratio: aspectRatio === 'portrait' ? '9:16' : '16:9',
            duration: parseInt(duration),
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    console.log(`[Vidgo] Sent request with duration: ${duration} (parsed: ${parseInt(duration)}), aspect_ratio: ${aspectRatio === 'portrait' ? '9:16' : '16:9'}`);

    if (!createResponse.ok) {
      const error = await createResponse.text();
      return { success: false, error: `Vidgo error: ${error}` };
    }

    const createData: any = await createResponse.json();
    console.log('Vidgo create response:', JSON.stringify(createData));

    // Response format: { code: 200, data: { task_id: "task-xxx", status: "not_started", created_time } }
    const taskId = createData.data?.task_id || createData.task_id;

    if (!taskId) {
      return { success: false, error: `No task ID returned from Vidgo. Response: ${JSON.stringify(createData)}` };
    }

    console.log(`Vidgo task created: ${taskId}`);
    await onProgress?.(`📤 Task created: ${taskId}`);

    // Save task ID to database immediately so it can be resumed if process is interrupted
    await onTaskCreated?.(taskId);

    // Poll for completion — no timeout, just wait for Completed or Failed from Vidgo
    await onProgress?.('⏳ Waiting for Server 3 to process...');
    let pollCount = 0;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      pollCount++;

      // Check if stop was requested (in-memory + DB every 30s)
      if (isStopped?.()) {
        console.log(`[Vidgo] 🛑 Stop requested, aborting polling for task ${taskId}`);
        return { success: false, error: 'Stopped by user', stopped: true, externalTaskId: taskId };
      }
      if (itemId && pollCount % 6 === 0 && await isItemStoppedInDB(itemId)) {
        console.log(`[Vidgo] 🛑 Stop detected via DB for task ${taskId}`);
        return { success: false, error: 'Stopped by user', stopped: true, externalTaskId: taskId };
      }

      // Poll status endpoint with 15s timeout
      const pollController = new AbortController();
      const pollTimeoutId = setTimeout(() => pollController.abort(), 15000);

      let statusResponse: Response;
      try {
        statusResponse = await fetch(`https://api.vidgo.ai/api/generate/status/${taskId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          signal: pollController.signal,
        });
      } catch (fetchError: any) {
        clearTimeout(pollTimeoutId);
        if (fetchError.name === 'AbortError') {
          console.log(`Vidgo poll #${pollCount} timeout`);
        } else {
          console.log(`Vidgo poll #${pollCount} error: ${fetchError.message}`);
        }
        continue;
      } finally {
        clearTimeout(pollTimeoutId);
      }

      if (!statusResponse.ok) {
        console.log(`Vidgo poll #${pollCount} failed: ${statusResponse.status}`);
        continue;
      }

      const statusData: any = await statusResponse.json();
      console.log(`Vidgo poll #${pollCount}:`, JSON.stringify(statusData));

      // Response format varies - handle common patterns
      const resultData = statusData.data || statusData;
      const status = resultData.status;
      const progress = resultData.progress || 0;

      // Check for completion - video URL might be in different fields
      // Vidgo returns: { data: { files: [{ file_url: "...", file_type: "video" }] } }
      const videoUrl = resultData.files?.[0]?.file_url || resultData.video_url || resultData.videoUrl || resultData.output?.video_url || resultData.result?.url;

      if ((status === 'finished' || status === 'succeeded' || status === 'completed') && videoUrl) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        await onProgress?.(`✅ Video ready! (took ${elapsed}s)`);
        return { success: true, videoUrl, externalTaskId: taskId };
      }

      if (status === 'failed' || status === 'error') {
        const errorMsg = resultData.error || resultData.message || resultData.failure_reason || 'Video generation failed';
        await onProgress?.(`❌ Server 3 failed: ${errorMsg}`);
        return { success: false, error: errorMsg, externalTaskId: taskId };
      }

      // Status is processing/running - log progress
      if (progress !== lastProgress) {
        if (progress >= lastProgress + 10 || (progress === 100 && lastProgress !== 100)) {
          await onProgress?.(`⏳ Generating video... ${progress}%`);
        }
        lastProgress = progress;
      }
    }
  } catch (error: any) {
    console.error('Vidgo error:', error);
    await onProgress?.(`❌ Server 3 error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Check if an existing Vidgo task has completed and return the video URL if ready
 */
export async function checkExistingVidgoTask(
  taskId: string,
  apiKey: string
): Promise<{ status: 'ready' | 'running' | 'failed'; videoUrl?: string; error?: string; progress?: number }> {
  try {
    const statusResponse = await fetch(`https://api.vidgo.ai/api/generate/status/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!statusResponse.ok) {
      return { status: 'failed', error: `API error: ${statusResponse.status}` };
    }

    const statusData: any = await statusResponse.json();
    const resultData = statusData.data || statusData;
    const status = resultData.status;
    const progress = resultData.progress || 0;

    // Check for video URL
    const videoUrl = resultData.files?.[0]?.file_url || resultData.video_url || resultData.videoUrl || resultData.output?.video_url || resultData.result?.url;

    if ((status === 'finished' || status === 'succeeded' || status === 'completed') && videoUrl) {
      return { status: 'ready', videoUrl };
    }

    if (status === 'failed' || status === 'error') {
      const errorMsg = resultData.error || resultData.message || resultData.failure_reason || 'Video generation failed';
      return { status: 'failed', error: errorMsg };
    }

    // Still running
    return { status: 'running', progress };
  } catch (error: any) {
    return { status: 'failed', error: error.message };
  }
}

/**
 * Poll an existing Vidgo task until Completed or Failed
 */
async function pollExistingVidgoTask(
  taskId: string,
  apiKey: string,
  onProgress?: (message: string) => Promise<void>,
  isStopped?: () => boolean,
  itemId?: number
): Promise<{ success: boolean; videoUrl?: string; error?: string }> {
  const startTime = Date.now();
  let lastProgress = -1;
  let pollCount = 0;

  while (true) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    pollCount++;

    if (isStopped?.()) {
      return { success: false, error: 'Stopped by user' };
    }
    // Cross-server stop check via DB every 30s
    if (itemId && pollCount % 6 === 0 && await isItemStoppedInDB(itemId)) {
      console.log(`[Vidgo Resume] 🛑 Stop detected via DB for task ${taskId}`);
      return { success: false, error: 'Stopped by user' };
    }

    const result = await checkExistingVidgoTask(taskId, apiKey);

    if (result.status === 'ready' && result.videoUrl) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      await onProgress?.(`✅ Video ready! (took ${elapsed}s)`);
      return { success: true, videoUrl: result.videoUrl };
    }

    if (result.status === 'failed') {
      await onProgress?.(`❌ Server 3 failed: ${result.error}`);
      return { success: false, error: result.error };
    }

    // Still running — log progress
    const progress = result.progress || 0;
    if (progress !== lastProgress && (progress >= lastProgress + 10 || progress === 100)) {
      await onProgress?.(`⏳ Generating video... ${progress}%`);
      lastProgress = progress;
    }
  }
}

// ============================================================
// STEP FUNCTIONS (extracted from processItem for readability)
// ============================================================

/**
 * Viral Template Handoff
 * สร้าง viral_template_jobs + viral_template_tasks, update schedule_queue → viral_pending
 * แล้ว throw StepError('VIRAL_HANDOFF') เพื่อให้ processItem จบทันที
 * (viralRunnerJob จะรับช่วงต่อ)
 *
 * ต้องเรียก "ก่อน" STEP 0 เสมอ เพราะ retry flow จะมี item.prompt populated อยู่แล้ว
 * (ไม่งั้นถ้าอยู่ใน stepGeneratePrompt จะโดน skip เพราะมี prompt แล้ว)
 */
async function handoffToViralPipeline(
  userId: number,
  itemId: number,
  item: any,
  templateId?: string,
  templateMode?: string
): Promise<void> {
  // Get channel info
  const channelResult = await pool.query(`
    SELECT * FROM scheduler_channels WHERE id = $1
  `, [item.channel_id]);
  const channel = channelResult.rows[0];

  if (!channel) {
    const error = 'Channel not found';
    await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [error, itemId]);
    await logActivity(userId, `❌ ${error}`, 'error', itemId);
    throw new StepError(error);
  }

  console.log(`[processItem] Viral Template mode — handing off to viral pipeline`);

  // เลือก prompt จาก template ที่ user เลือก (หรือ round-robin/random)
  // ใช้ ai_prompt_templates (separate field) — fallback ไป prompt_templates สำหรับ channel เก่า
  // Lock channel row เพื่อป้องกัน race ระหว่าง parallel items
  let viralPrompt = channel.system_prompt || '';
  let selectedTemplate: any = null;
  let selectedTemplateIdx: number = -1;
  let aiTemplatesSourceField: 'ai_prompt_templates' | 'prompt_templates' = 'ai_prompt_templates';
  const pickedVars: Record<string, string> = {};

  const viralClient = await pool.connect();
  try {
    await viralClient.query('BEGIN');
    const lockedChannelResult = await viralClient.query(
      `SELECT ai_prompt_templates, prompt_templates, template_round_robin_index FROM scheduler_channels WHERE id = $1 FOR UPDATE`,
      [channel.id]
    );
    const lockedChannel = lockedChannelResult.rows[0] || {};
    let aiTemplates: any[] = [];
    if (lockedChannel.ai_prompt_templates && lockedChannel.ai_prompt_templates.length > 0) {
      aiTemplates = lockedChannel.ai_prompt_templates;
      aiTemplatesSourceField = 'ai_prompt_templates';
    } else if (lockedChannel.prompt_templates && lockedChannel.prompt_templates.length > 0) {
      aiTemplates = lockedChannel.prompt_templates;
      aiTemplatesSourceField = 'prompt_templates';
    }

    if (aiTemplates.length > 0) {
      if (templateId) {
        selectedTemplateIdx = aiTemplates.findIndex((t: any) => t.id === templateId);
        selectedTemplate = selectedTemplateIdx >= 0 ? aiTemplates[selectedTemplateIdx] : null;
      } else if (templateMode === 'random') {
        selectedTemplateIdx = Math.floor(Math.random() * aiTemplates.length);
        selectedTemplate = aiTemplates[selectedTemplateIdx];
      } else {
        // round-robin
        selectedTemplateIdx = (lockedChannel.template_round_robin_index || 0) % aiTemplates.length;
        selectedTemplate = aiTemplates[selectedTemplateIdx];
        await viralClient.query(
          `UPDATE scheduler_channels SET template_round_robin_index = $1 WHERE id = $2`,
          [selectedTemplateIdx + 1, channel.id]
        );
      }
      if (selectedTemplate?.prompt_template) {
        viralPrompt = selectedTemplate.prompt_template;
        console.log(`[processItem] Viral Template using: "${selectedTemplate.label || selectedTemplate.id}"`);
      }
    }

    // ใช้ตัวแปรของ template ที่เลือกจริงๆ (per-template) — fallback ไป channel.variables
    // Fix: empty array [] ไม่ถือเป็น falsy ใน JS → ต้อง check length
    const tmplVars = selectedTemplate?.variables;
    const chanVars = channel.variables;
    const templateVars = (tmplVars && tmplVars.length > 0)
      ? tmplVars
      : (chanVars && chanVars.length > 0 ? chanVars : []);
    console.log(`[handoffToViralPipeline] selectedTemplate=${selectedTemplate?.label || 'null'}, templateVars.length=${templateVars.length}, names:`, templateVars.map((v: any) => `${v.name}(${v.values?.length || 0} values)`).join(', '));

    // สร้าง labelMap: key (random ID เช่น "var_xxx") → label (ชื่ออ่านเข้าใจ เช่น "Animal_Subject")
    // ใช้ตอน emit pickedVars เพื่อให้ AI เห็นชื่อตัวแปรที่ตรงกับ system prompt
    const labelMap: Record<string, string> = {};
    const selectedViralPrompts = channel.selected_viral_prompts || [];
    let matchedViralPrompt = selectedViralPrompts.find((vp: any) =>
      vp.id === selectedTemplate?.id || vp.name === selectedTemplate?.label
    );
    // Fallback: ถ้ามี viral prompt ตัวเดียว ใช้มันเลย (single template scenario)
    if (!matchedViralPrompt && selectedViralPrompts.length === 1) {
      matchedViralPrompt = selectedViralPrompts[0];
    }
    const tvarsConfig = matchedViralPrompt?.config?.template_variables || [];
    for (const tv of tvarsConfig) {
      if (tv.key && tv.label) labelMap[tv.key] = tv.label;
    }
    console.log(`[handoffToViralPipeline] labelMap:`, JSON.stringify(labelMap));

    // ใช้ scenes_per_video ของ template ที่เลือก (fallback ไป channel-level)
    const channelScenesPerVideo = selectedTemplate?.scenes_per_video ?? channel.viral_scenes_per_video ?? 3;

    console.log(`[handoffToViralPipeline] DEBUG templateVars:`, templateVars.map((v: any) => ({
      name: v.name,
      total: v.values?.length || 0,
      newCount: v.values?.filter((x: any) => x.status === 'new').length || 0,
    })));

    for (const variable of templateVars) {
      // ตัวแปรมาจาก selectedTemplate.variables อยู่แล้ว (กรอง per-template ใน UI) → ไม่ต้อง filter ซ้ำ
      const sceneMatch = variable.name.match(/^(.+)_scene(\d+)$/);
      if (sceneMatch) {
        // ข้าม per-scene variable สำหรับฉากที่เกินจำนวนที่ตั้ง (viral_scenes_per_video)
        const sceneNum = parseInt(sceneMatch[2]);
        if (sceneNum > channelScenesPerVideo) continue;
      }

      // Pick ค่าจาก variable
      const unused = (variable.values || []).filter((v: any) => v.status === 'new');
      let val = '';
      if (unused.length > 0) {
        const picked = unused[unused.length - 1];
        val = picked.value;
        picked.status = 'used';
      } else if (variable.loop !== false && variable.values?.length > 0) {
        variable.values.forEach((v: any) => { v.status = 'new'; });
        const picked = variable.values[variable.values.length - 1];
        val = picked.value;
        picked.status = 'used';
      }
      if (!val) continue;

      // แทนค่าใน prompt ถ้ามี placeholder ตรง
      const p1 = `[${variable.name}]`;
      const p2 = `{${variable.name}}`;
      if (viralPrompt.includes(p1) || viralPrompt.includes(p2)) {
        viralPrompt = viralPrompt.replaceAll(p1, val).replaceAll(p2, val);
      }

      // เก็บใน pickedVars — per-scene variables รวมเป็น array
      // ใช้ label เป็น key ถ้ามี (Animal_Subject) แทน random ID (var_xxx) เพื่อให้ AI อ่านเข้าใจ
      if (sceneMatch) {
        const baseName = sceneMatch[1];
        const pickKey = labelMap[baseName] || baseName;
        const sceneIdx = parseInt(sceneMatch[2]) - 1;
        if (!pickedVars[pickKey]) pickedVars[pickKey] = [] as any;
        (pickedVars[pickKey] as any)[sceneIdx] = val;
      } else {
        const pickKey = labelMap[variable.name] || variable.name;
        pickedVars[pickKey] = val;
      }
    }

    // Merge per-scene reference images from template (saved in Channel form's
    // reference_images field). Keys are already in the right shape for the viral
    // pipeline (character_image_0, background_image_0, etc.). These are fixed
    // defaults — they don't rotate like text variables.
    if (selectedTemplate?.reference_images && typeof selectedTemplate.reference_images === 'object') {
      for (const [k, v] of Object.entries(selectedTemplate.reference_images)) {
        if (typeof v === 'string' && v) {
          (pickedVars as any)[k] = v;
        }
      }
      console.log(`[handoffToViralPipeline] merged reference_images:`, Object.keys(selectedTemplate.reference_images).join(', '));
    }

    console.log(`[handoffToViralPipeline] DEBUG pickedVars:`, JSON.stringify(pickedVars));

    // Persist 'used' status กลับไปที่ template ที่เลือก
    if (selectedTemplate && selectedTemplateIdx >= 0 && aiTemplates.length > 0) {
      const updatedTemplates = aiTemplates.map((t: any, i: number) =>
        i === selectedTemplateIdx ? { ...t, variables: templateVars } : t
      );
      await viralClient.query(
        `UPDATE scheduler_channels SET ${aiTemplatesSourceField} = $1 WHERE id = $2`,
        [JSON.stringify(updatedTemplates), channel.id]
      );
    } else if (templateVars.length > 0) {
      // Fallback: ถ้าไม่มี selectedTemplate ให้ update channel.variables (legacy path)
      await viralClient.query(
        `UPDATE scheduler_channels SET variables = $1 WHERE id = $2`,
        [JSON.stringify(templateVars), channel.id]
      );
    }
    console.log(`[handoffToViralPipeline] pickedVars:`, JSON.stringify(pickedVars));

    await viralClient.query('COMMIT');
  } catch (txErr) {
    await viralClient.query('ROLLBACK');
    throw txErr;
  } finally {
    viralClient.release();
  }

  // scenes_per_video แยกต่อ template (fallback ไป channel-level)
  const scenesPerVideo = selectedTemplate?.scenes_per_video ?? channel.viral_scenes_per_video ?? 3;
  console.log(`[handoffToViralPipeline] scenes_per_video=${scenesPerVideo} (from template: ${selectedTemplate?.scenes_per_video}, channel: ${channel.viral_scenes_per_video})`);

  // สร้าง viral job + task
  const jobResult = await pool.query(
    `INSERT INTO viral_template_jobs (user_id, template_slug, channel_id, language, scenes_per_video, custom_system_prompt)
     VALUES ($1, 'scheduler', $2, 'th', $3, $4) RETURNING *`,
    [userId, item.channel_id, scenesPerVideo, viralPrompt]
  );
  const viralJob = jobResult.rows[0];

  // รวมทุก value จาก pickedVars → character_names (array) เพื่อให้ log แสดงครบ
  // (per-scene = array, single = string) flatten เป็น string[]
  const allPickedValues: string[] = [];
  for (const v of Object.values(pickedVars)) {
    if (Array.isArray(v)) allPickedValues.push(...v.filter(Boolean));
    else if (v) allPickedValues.push(String(v));
  }
  const firstVarValue = allPickedValues[0] || '';
  const taskResult = await pool.query(
    `INSERT INTO viral_template_tasks (job_id, user_id, task_index, character_name, character_names, task_variables)
     VALUES ($1, $2, 0, $3, $4, $5) RETURNING *`,
    [viralJob.id, userId, firstVarValue, JSON.stringify(allPickedValues), JSON.stringify(pickedVars)]
  );
  const viralTask = taskResult.rows[0];

  // Set schedule_queue → viral_running + เก็บ reference ไป viral task
  await pool.query(
    `UPDATE schedule_queue SET status = 'viral_running', prompt = $1, external_task_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
    [viralPrompt, `viral-${viralJob.id}-${viralTask.id}`, itemId]
  );

  console.log(`[processItem] Viral Template: job=${viralJob.id} task=${viralTask.id} — running pipeline directly`);

  // เรียก pipeline ตรงเลย ไม่ต้องรอ viralRunnerJob
  runTaskPipeline(viralTask.id, userId).catch(err => {
    console.error(`[processItem] Viral pipeline error for task ${viralTask.id}:`, err);
  });

  // Throw เพื่อหยุด processItem ไม่ให้ทำ video generation ต่อ
  throw new StepError('VIRAL_HANDOFF');
}

/**
 * Idol Template Handoff
 * สร้าง idol_template_jobs + idol_template_tasks, update schedule_queue → idol_pending
 * แล้ว throw StepError('IDOL_HANDOFF') เพื่อให้ processItem จบทันที
 * (idolRunnerJob จะรับช่วงต่อ)
 */
async function handoffToIdolPipeline(
  userId: number,
  itemId: number,
  item: any,
  templateId?: string,
  templateMode?: string
): Promise<void> {
  // Get channel info
  const channelResult = await pool.query(`
    SELECT * FROM scheduler_channels WHERE id = $1
  `, [item.channel_id]);
  const channel = channelResult.rows[0];

  if (!channel) {
    const error = 'Channel not found';
    await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [error, itemId]);
    await logActivity(userId, `❌ ${error}`, 'error', itemId);
    throw new StepError(error);
  }

  console.log(`[processItem] Idol Template mode — handing off to idol pipeline`);

  // Intentionally do NOT fallback to channel.system_prompt here.
  // Idol Template requires a selected template in ai_prompt_templates — falling back to
  // the legacy system_prompt column leaks stale data from other ai_models (e.g. viral).
  let idolPrompt = '';
  let selectedTemplate: any = null;
  let selectedTemplateIdx: number = -1;
  let aiTemplatesSourceField: 'ai_prompt_templates' | 'prompt_templates' = 'ai_prompt_templates';
  const pickedVars: Record<string, string> = {};

  const idolClient = await pool.connect();
  try {
    await idolClient.query('BEGIN');
    const lockedChannelResult = await idolClient.query(
      `SELECT ai_prompt_templates, prompt_templates, template_round_robin_index FROM scheduler_channels WHERE id = $1 FOR UPDATE`,
      [channel.id]
    );
    const lockedChannel = lockedChannelResult.rows[0] || {};
    let aiTemplates: any[] = [];
    if (lockedChannel.ai_prompt_templates && lockedChannel.ai_prompt_templates.length > 0) {
      aiTemplates = lockedChannel.ai_prompt_templates;
      aiTemplatesSourceField = 'ai_prompt_templates';
    }
    // Note: we intentionally don't fallback to prompt_templates for idol mode —
    // prompt_templates is used by variable-mode AI models and may contain stale viral data.

    if (aiTemplates.length > 0) {
      if (templateId) {
        selectedTemplateIdx = aiTemplates.findIndex((t: any) => t.id === templateId);
        selectedTemplate = selectedTemplateIdx >= 0 ? aiTemplates[selectedTemplateIdx] : null;
      } else if (templateMode === 'random') {
        selectedTemplateIdx = Math.floor(Math.random() * aiTemplates.length);
        selectedTemplate = aiTemplates[selectedTemplateIdx];
      } else {
        // round-robin
        selectedTemplateIdx = (lockedChannel.template_round_robin_index || 0) % aiTemplates.length;
        selectedTemplate = aiTemplates[selectedTemplateIdx];
        await idolClient.query(
          `UPDATE scheduler_channels SET template_round_robin_index = $1 WHERE id = $2`,
          [selectedTemplateIdx + 1, channel.id]
        );
      }
      if (selectedTemplate?.prompt_template) {
        idolPrompt = selectedTemplate.prompt_template;
        console.log(`[processItem] Idol Template using: "${selectedTemplate.label || selectedTemplate.id}"`);
      }
    }

    const tmplVars = selectedTemplate?.variables;
    const chanVars = channel.variables;
    const templateVars = (tmplVars && tmplVars.length > 0)
      ? tmplVars
      : (chanVars && chanVars.length > 0 ? chanVars : []);
    console.log(`[handoffToIdolPipeline] selectedTemplate=${selectedTemplate?.label || 'null'}, templateVars.length=${templateVars.length}, names:`, templateVars.map((v: any) => `${v.name}(${v.values?.length || 0} values)`).join(', '));

    const labelMap: Record<string, string> = {};
    const selectedIdolPrompts = channel.selected_idol_prompts || [];
    let matchedIdolPrompt = selectedIdolPrompts.find((vp: any) =>
      vp.id === selectedTemplate?.id || vp.name === selectedTemplate?.label
    );
    if (!matchedIdolPrompt && selectedIdolPrompts.length === 1) {
      matchedIdolPrompt = selectedIdolPrompts[0];
    }
    const tvarsConfig = matchedIdolPrompt?.config?.template_variables || [];
    for (const tv of tvarsConfig) {
      if (tv.key && tv.label) labelMap[tv.key] = tv.label;
    }
    console.log(`[handoffToIdolPipeline] labelMap:`, JSON.stringify(labelMap));

    const channelScenesPerVideo = selectedTemplate?.scenes_per_video ?? channel.idol_scenes_per_video ?? 3;

    console.log(`[handoffToIdolPipeline] DEBUG templateVars:`, templateVars.map((v: any) => ({
      name: v.name,
      total: v.values?.length || 0,
      newCount: v.values?.filter((x: any) => x.status === 'new').length || 0,
    })));

    for (const variable of templateVars) {
      const sceneMatch = variable.name.match(/^(.+)_scene(\d+)$/);
      if (sceneMatch) {
        const sceneNum = parseInt(sceneMatch[2]);
        if (sceneNum > channelScenesPerVideo) continue;
      }

      const unused = (variable.values || []).filter((v: any) => v.status === 'new');
      let val = '';
      if (unused.length > 0) {
        const picked = unused[unused.length - 1];
        val = picked.value;
        picked.status = 'used';
      } else if (variable.loop !== false && variable.values?.length > 0) {
        variable.values.forEach((v: any) => { v.status = 'new'; });
        const picked = variable.values[variable.values.length - 1];
        val = picked.value;
        picked.status = 'used';
      }
      if (!val) continue;

      const p1 = `[${variable.name}]`;
      const p2 = `{${variable.name}}`;
      const hasPlaceholder = idolPrompt.includes(p1) || idolPrompt.includes(p2);
      if (hasPlaceholder) {
        idolPrompt = idolPrompt.replaceAll(p1, val).replaceAll(p2, val);
      } else if (!sceneMatch && (variable.name === 'outfit' || variable.name === 'background')) {
        // Idol Template: user picks outfit/background as direct values (not placeholder-substituted).
        // Auto-append to prompt so AI Image Prompt stage sees them even when template has no placeholder.
        const labelByName: Record<string, string> = { outfit: 'Outfit', background: 'Background' };
        const label = labelByName[variable.name] || variable.name;
        idolPrompt += `\n${label}: ${val}`;
      }

      if (sceneMatch) {
        const baseName = sceneMatch[1];
        const pickKey = labelMap[baseName] || baseName;
        const sceneIdx = parseInt(sceneMatch[2]) - 1;
        if (!pickedVars[pickKey]) pickedVars[pickKey] = [] as any;
        (pickedVars[pickKey] as any)[sceneIdx] = val;
      } else {
        const pickKey = labelMap[variable.name] || variable.name;
        pickedVars[pickKey] = val;
      }
    }

    console.log(`[handoffToIdolPipeline] DEBUG pickedVars:`, JSON.stringify(pickedVars));

    if (selectedTemplate && selectedTemplateIdx >= 0 && aiTemplates.length > 0) {
      const updatedTemplates = aiTemplates.map((t: any, i: number) =>
        i === selectedTemplateIdx ? { ...t, variables: templateVars } : t
      );
      await idolClient.query(
        `UPDATE scheduler_channels SET ${aiTemplatesSourceField} = $1 WHERE id = $2`,
        [JSON.stringify(updatedTemplates), channel.id]
      );
    } else if (templateVars.length > 0) {
      await idolClient.query(
        `UPDATE scheduler_channels SET variables = $1 WHERE id = $2`,
        [JSON.stringify(templateVars), channel.id]
      );
    }
    console.log(`[handoffToIdolPipeline] pickedVars:`, JSON.stringify(pickedVars));

    await idolClient.query('COMMIT');
  } catch (txErr) {
    await idolClient.query('ROLLBACK');
    throw txErr;
  } finally {
    idolClient.release();
  }

  // Determine slug + embedded prompts. The selectedTemplate may have:
  //  - slug pointing to a built-in idol_templates row → pipeline loads from DB
  //  - slug = 'custom' (user custom prompt) + embedded image/video templates → use them directly
  //  - no slug at all → fall back to 'custom' if embedded prompts are present
  const rawSlug: string | undefined = selectedTemplate?.slug;
  const embeddedImagePrompt: string | undefined = selectedTemplate?.image_prompt_template || undefined;
  const embeddedVideoPrompt: string | undefined = selectedTemplate?.video_prompt_template || undefined;

  let idolTemplateSlug = rawSlug;
  if (!idolTemplateSlug && (embeddedImagePrompt || embeddedVideoPrompt)) {
    // Custom prompt path (no built-in slug, but prompts are embedded in channel template)
    idolTemplateSlug = 'custom';
  }

  if (!idolTemplateSlug) {
    const errMsg = 'Idol Template: ไม่พบ template ที่ตั้งค่าไว้ — กรุณาเลือก template ในหน้าตั้งค่า channel';
    await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [errMsg, itemId]);
    await logActivity(userId, `❌ ${errMsg}`, 'error', itemId);
    throw new StepError(errMsg);
  }

  const scenesPerVideo = selectedTemplate?.scenes_per_video ?? channel.idol_scenes_per_video ?? 3;
  const idolDuration = typeof selectedTemplate?.duration === 'number' ? selectedTemplate.duration : 10;
  console.log(`[handoffToIdolPipeline] template_slug=${idolTemplateSlug} scenes=${scenesPerVideo} duration=${idolDuration} embedded=${!!(embeddedImagePrompt || embeddedVideoPrompt)}`);

  // สร้าง idol job + task — เก็บ embedded image/video prompts ลง columns ใหม่
  // ถ้า template_slug เป็น built-in pipeline จะโหลดจาก idol_templates table ตาม slug
  // ถ้าเป็น 'custom' pipeline จะใช้ custom_image_prompt + custom_video_prompt แทน
  const jobResult = await pool.query(
    `INSERT INTO idol_template_jobs (user_id, template_slug, channel_id, language, scenes_per_video, duration, custom_image_prompt, custom_video_prompt)
     VALUES ($1, $2, $3, 'th', $4, $5, $6, $7) RETURNING *`,
    [userId, idolTemplateSlug, item.channel_id, scenesPerVideo, idolDuration, embeddedImagePrompt || null, embeddedVideoPrompt || null]
  );
  const idolJob = jobResult.rows[0];

  const allPickedValues: string[] = [];
  for (const v of Object.values(pickedVars)) {
    if (Array.isArray(v)) allPickedValues.push(...v.filter(Boolean));
    else if (v) allPickedValues.push(String(v));
  }
  const firstVarValue = allPickedValues[0] || '';

  // Attach idol_image URL from template config (configured once per template in ChannelForm).
  // The idol pipeline reads task_variables.idol_image as a reference image URL.
  const taskVarsForInsert: Record<string, any> = { ...pickedVars };
  if (selectedTemplate?.idol_image && typeof selectedTemplate.idol_image === 'string') {
    taskVarsForInsert.idol_image = selectedTemplate.idol_image;
  }

  const taskResult = await pool.query(
    `INSERT INTO idol_template_tasks (job_id, user_id, task_index, character_name, character_names, task_variables)
     VALUES ($1, $2, 0, $3, $4, $5) RETURNING *`,
    [idolJob.id, userId, firstVarValue, JSON.stringify(allPickedValues), JSON.stringify(taskVarsForInsert)]
  );
  const idolTask = taskResult.rows[0];

  // Set schedule_queue → idol_running + เก็บ reference ไป idol task
  await pool.query(
    `UPDATE schedule_queue SET status = 'idol_running', prompt = $1, external_task_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
    [idolPrompt, `idol-${idolJob.id}-${idolTask.id}`, itemId]
  );

  console.log(`[processItem] Idol Template: job=${idolJob.id} task=${idolTask.id} — running pipeline directly`);

  // เรียก pipeline ตรงเลย ไม่ต้องรอ idolRunnerJob
  runIdolTaskPipeline(idolTask.id, userId).catch(err => {
    console.error(`[processItem] Idol pipeline error for task ${idolTask.id}:`, err);
  });

  // Throw เพื่อหยุด processItem ไม่ให้ทำ video generation ต่อ
  throw new StepError('IDOL_HANDOFF');
}

/**
 * STEP 0: Generate Prompt (AI or Variable template)
 * Returns the generated prompt string, or throws/returns early via the item.
 */
async function stepGeneratePrompt(
  userId: number,
  itemId: number,
  item: any,
  templateId?: string,
  templateMode?: string,
  skipEmptyVariables?: boolean
): Promise<string> {
  // Get channel info
  const channelResult = await pool.query(`
    SELECT * FROM scheduler_channels WHERE id = $1
  `, [item.channel_id]);
  const channel = channelResult.rows[0];

  if (!channel) {
    const error = 'Channel not found';
    await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [error, itemId]);
    await logActivity(userId, `❌ ${error}`, 'error', itemId);
    throw new StepError(error);
  }

  // NOTE: viral template handoff ถูกย้ายออกไปเรียก "ก่อน" STEP 0 ใน processItem แล้ว
  // (เดิมอยู่ตรงนี้ ซึ่งจะไม่ทำงานเวลา retry เพราะ STEP 0 โดน skip เมื่อ item.prompt ถูก populate)

  // Check prompt_mode: 'ai' or 'variable'
  console.log(`[processItem] Channel prompt_mode: "${channel.prompt_mode}", hasTemplates: ${!!(channel.prompt_templates?.length)}`);
  if (channel.prompt_mode === 'variable') {
    // ===== VARIABLE SYSTEM =====
    await logActivity(userId, '📝 Generating prompt from template...', 'info', itemId);

    const hasTemplates = channel.prompt_templates && channel.prompt_templates.length > 0;
    if (!channel.prompt_template && !hasTemplates) {
      const error = 'No prompt template configured';
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [error, itemId]);
      await logActivity(userId, `❌ ${error}`, 'error', itemId);
      throw new StepError(error);
    }

    // Use a DB transaction with row-level lock to prevent race condition
    // when multiple items process in parallel and pick the same variable value
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the channel row so other concurrent processItem calls wait here
      const lockedChannelResult = await client.query(`
        SELECT * FROM scheduler_channels WHERE id = $1 FOR UPDATE
      `, [item.channel_id]);
      const lockedChannel = lockedChannelResult.rows[0];

      // Multi-template support: pick a template if available
      const templates = lockedChannel.prompt_templates || [];
      let activeTemplateIndex = -1;
      let variables: any[];
      let prompt: string;

      if (templates.length > 0) {
        // If a specific template was requested, use it
        if (templateId) {
          activeTemplateIndex = templates.findIndex((t: any) => t.id === templateId);
          if (activeTemplateIndex < 0) activeTemplateIndex = 0;
          console.log(`[processItem] Using specific template id=${templateId}, index=${activeTemplateIndex}`);
        } else {
          const mode = templateMode || lockedChannel.template_selection_mode || 'round-robin';
          if (mode === 'random') {
            activeTemplateIndex = Math.floor(Math.random() * templates.length);
          } else {
            activeTemplateIndex = (lockedChannel.template_round_robin_index || 0) % templates.length;
          }
          console.log(`[processItem] Multi-template mode=${mode}, picked template ${activeTemplateIndex}: "${templates[activeTemplateIndex]?.label}"`);
        }
        const activeTemplate = templates[activeTemplateIndex];
        variables = activeTemplate.variables || [];
        prompt = activeTemplate.prompt_template;
      } else {
        variables = lockedChannel.variables || [];
        prompt = lockedChannel.prompt_template;
      }

      const usedVariableValues: Record<string, string> = {};

      console.log(`[processItem] Variables count: ${variables.length}`);
      console.log(`[processItem] Variable names: ${variables.map((v: any) => v.name).join(', ')}`);
      console.log(`[processItem] Prompt template (first 200): ${prompt?.substring(0, 200)}`);

      // Replace each variable placeholder with a random unused value
      let hasAllVariables = true;
      for (const variable of variables) {
        // Support both {VAR_NAME} and [VAR_NAME] formats
        const curlyPlaceholder = `{${variable.name}}`;
        const squarePlaceholder = `[${variable.name}]`;
        const hasCurly = prompt.includes(curlyPlaceholder);
        const hasSquare = prompt.includes(squarePlaceholder);

        console.log(`[processItem] Checking var "${variable.name}": curly=${hasCurly}, square=${hasSquare}`);

        if (!hasCurly && !hasSquare) continue;

        // Pick next unused value sequentially (bottom to top = last unused first)
        const allValues = variable.values || [];
        console.log(`[processItem] Var "${variable.name}" has ${allValues.length} values: ${JSON.stringify(allValues.map((v: any) => ({ value: v.value?.substring(0, 30), status: v.status })))}`);

        if (allValues.length === 0) {
          if (skipEmptyVariables) {
            // Remove placeholder from prompt instead of failing (video already exists)
            if (hasCurly) prompt = prompt.replace(new RegExp(`\\{${variable.name}\\}`, 'g'), '');
            if (hasSquare) prompt = prompt.replace(new RegExp(`\\[${variable.name}\\]`, 'g'), '');
            console.log(`[processItem] Skipped empty variable "${variable.name}" (video exists)`);
            continue;
          }
          hasAllVariables = false;
          const error = `No values for variable: ${variable.name}`;
          await client.query('ROLLBACK');
          await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [error, itemId]);
          await logActivity(userId, `❌ ${error}`, 'error', itemId);
          throw new StepError(error);
        }

        // Find unused values (status = 'new'), pick from the end (bottom to top)
        let unusedValues = allValues.filter((v: any) => v.status === 'new' || !v.status);
        if (unusedValues.length === 0) {
          // All used — reset all to 'new' and start over
          for (const v of allValues) { v.status = 'new'; }
          unusedValues = allValues;
          console.log(`[processItem] All values used for "${variable.name}", reset to new`);
        }
        // Pick the last unused value (bottom of the list)
        const pickedValue = unusedValues[unusedValues.length - 1];
        console.log(`[processItem] Picked value for "${variable.name}": "${pickedValue.value?.substring(0, 50)}..." (id=${pickedValue.id})`);
        // Mark as used
        const pickedIndex = allValues.findIndex((v: any) => v.id === pickedValue.id);
        if (pickedIndex !== -1) {
          allValues[pickedIndex].status = 'used';
        }

        // Replace placeholder with value (both formats)
        if (hasCurly) {
          prompt = prompt.replace(new RegExp(`\\{${variable.name}\\}`, 'g'), pickedValue.value);
        }
        if (hasSquare) {
          prompt = prompt.replace(new RegExp(`\\[${variable.name}\\]`, 'g'), pickedValue.value);
        }
        usedVariableValues[variable.name] = pickedValue.value;
      }

      // Update channel with marked variables (inside the transaction)
      if (activeTemplateIndex >= 0) {
        // Multi-template: update variables inside the template array + increment round-robin index
        templates[activeTemplateIndex].variables = variables;
        // Don't increment round-robin index when a specific template was requested
        const nextIndex = templateId ? (lockedChannel.template_round_robin_index || 0) : (activeTemplateIndex + 1) % templates.length;
        await client.query(`
          UPDATE scheduler_channels SET prompt_templates = $1, template_round_robin_index = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `, [JSON.stringify(templates), nextIndex, lockedChannel.id]);
      } else {
        await client.query(`
          UPDATE scheduler_channels SET variables = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [JSON.stringify(variables), lockedChannel.id]);
      }

      // Save generated prompt to queue item
      await client.query(`
        UPDATE schedule_queue SET prompt = $1, variable_values = $2 WHERE id = $3
      `, [prompt, JSON.stringify(usedVariableValues), itemId]);

      await client.query('COMMIT');

      await logActivity(userId, `✅ Prompt generated from template`, 'success', itemId);
      console.log(`[processItem] Variable prompt: ${prompt.substring(0, 100)}...`);
      return prompt;
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

  } else {
    // ===== AI PROMPT SYSTEM (default) =====
    await logActivity(userId, '🤖 Generating prompt with AI...', 'info', itemId);

    if (!channel.system_prompt) {
      const error = 'No prompt provided and no AI system configured';
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [error, itemId]);
      await logActivity(userId, `❌ ${error}`, 'error', itemId);
      throw new StepError(error);
    }

    // Substitute variables in system_prompt if channel has variables
    let resolvedSystemPrompt = channel.system_prompt;
    const channelVars = channel.variables || [];
    const usedVarValues: Record<string, string> = {};
    if (channelVars.length > 0) {
      for (const variable of channelVars) {
        const placeholder1 = `[${variable.name}]`;
        const placeholder2 = `{${variable.name}}`;
        if (resolvedSystemPrompt.includes(placeholder1) || resolvedSystemPrompt.includes(placeholder2)) {
          const unusedValues = (variable.values || []).filter((v: any) => v.status === 'new');
          let selectedValue = '';
          if (unusedValues.length > 0) {
            const picked = unusedValues[unusedValues.length - 1];
            selectedValue = picked.value;
            picked.status = 'used';
          } else if (variable.loop !== false && variable.values?.length > 0) {
            // Reset all to new and pick last
            variable.values.forEach((v: any) => { v.status = 'new'; });
            const picked = variable.values[variable.values.length - 1];
            selectedValue = picked.value;
            picked.status = 'used';
          }
          if (selectedValue) {
            resolvedSystemPrompt = resolvedSystemPrompt.replaceAll(placeholder1, selectedValue).replaceAll(placeholder2, selectedValue);
            usedVarValues[variable.name] = selectedValue;
          }
        }
      }
      // Save updated variables back to channel
      if (Object.keys(usedVarValues).length > 0) {
        await pool.query(`UPDATE scheduler_channels SET variables = $1 WHERE id = $2`, [JSON.stringify(channelVars), channel.id]);
        await pool.query(`UPDATE schedule_queue SET variable_values = $1 WHERE id = $2`, [JSON.stringify(usedVarValues), itemId]);
        await logActivity(userId, `📝 Variables: ${Object.entries(usedVarValues).map(([k, v]) => `${k}=${v}`).join(', ')}`, 'info', itemId);
      }
    }

    // Get example prompts for this channel (optional for AI mode)
    const examplesResult = await pool.query(`
      SELECT * FROM channel_example_prompts
      WHERE channel_id = $1
      ORDER BY times_used ASC, RANDOM()
      LIMIT 5
    `, [item.channel_id]);

    const randomExample = examplesResult.rows.length > 0
      ? examplesResult.rows[Math.floor(Math.random() * examplesResult.rows.length)]
      : null;

    const aiResult = await generateAIPrompt(userId, { ...channel, system_prompt: resolvedSystemPrompt }, randomExample);

    if (aiResult.success && aiResult.prompt) {
      // Save the generated prompt to DB
      await pool.query(`UPDATE schedule_queue SET prompt = $1 WHERE id = $2`, [aiResult.prompt, itemId]);
      await logActivity(userId, `✅ AI prompt generated`, 'success', itemId);
      console.log(`[processItem] AI generated prompt: ${aiResult.prompt.substring(0, 100)}...`);
      return aiResult.prompt;
    } else {
      const error = `AI prompt generation failed: ${aiResult.error}`;
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [error, itemId]);
      await logActivity(userId, `❌ ${error}`, 'error', itemId);
      throw new StepError(error);
    }
  }
}

/**
 * STEP 1: Generate Video + Resume existing tasks + Dropbox upload
 * Returns the video URL string.
 * Throws StepError for non-recoverable failures that should not retry.
 * Returns a VideoGenerationResult on failure so processItem can handle retry logic.
 */
async function stepGenerateVideo(
  userId: number,
  itemId: number,
  item: any,
  isStoppedFn: () => boolean,
  progressCallback: (msg: string) => Promise<void>,
): Promise<{ videoUrl: string } | { failed: true; result: VideoGenerationResult }> {
  await pool.query(`UPDATE schedule_queue SET status = 'generating' WHERE id = $1`, [itemId]);
  await logActivity(userId, 'Generating video...', 'info', itemId);

  // Get API key based on platform from user's settings
  // sora2-kie uses kie_api_key, sora2-grsai uses piapi_api_key, sora2-vidgo uses vidgo_api_key
  const apiKeyColumn = item.platform === 'sora2-kie' ? 'kie_api_key'
    : item.platform === 'sora2-vidgo' ? 'vidgo_api_key'
    : 'piapi_api_key';
  const apiKeyResult = await pool.query(`
    SELECT ${apiKeyColumn} as api_key FROM users WHERE id = $1
  `, [userId]);
  const apiKey = apiKeyResult.rows[0]?.api_key;

  console.log(`[processItem] Using API: ${apiKeyColumn}, key exists: ${!!apiKey}`);
  if (!apiKey) {
    const error = `API key not configured: ${apiKeyColumn}. Please add it in Settings.`;
    console.log(`[processItem] ERROR: ${error}`);
    await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [error, itemId]);
    await logActivity(userId, error, 'error', itemId);
    throw new StepError(error);
  }

  let videoUrl: string | undefined;

  // Check if there's already an existing task on Vidgo — resume polling instead of creating new
  if (item.platform === 'sora2-vidgo' && item.external_task_id) {
    console.log(`[processItem] Found existing Vidgo task ${item.external_task_id} for item ${itemId}, resuming poll...`);
    await logActivity(userId, `♻️ Resuming existing task: ${item.external_task_id}`, 'info', itemId);
    const existingResult = await checkExistingVidgoTask(item.external_task_id, apiKey);
    if (existingResult.status === 'ready' && existingResult.videoUrl) {
      await logActivity(userId, `✅ Video ready from existing task!`, 'success', itemId);
      videoUrl = existingResult.videoUrl;
      // Skip to post-processing below
      await pool.query(`UPDATE schedule_queue SET video_url = $1, status = 'generating' WHERE id = $2`, [videoUrl, itemId]);
      await syncVideoUrlWithDropbox(itemId);
    } else if (existingResult.status === 'running') {
      // Still running — poll it until done
      await logActivity(userId, `⏳ Task still running (${existingResult.progress}%), polling...`, 'info', itemId);
      const pollResult = await pollExistingVidgoTask(item.external_task_id, apiKey, async (msg) => {
        await logActivity(userId, msg, 'info', itemId);
      }, isStoppedFn, itemId);
      if (pollResult.success && pollResult.videoUrl) {
        await logActivity(userId, `✅ Video ready from Server 3!`, 'success', itemId);
        videoUrl = pollResult.videoUrl;
        await pool.query(`UPDATE schedule_queue SET video_url = $1, status = 'generating' WHERE id = $2`, [videoUrl, itemId]);
        await syncVideoUrlWithDropbox(itemId);
      } else {
        // Task failed on Vidgo — clear external_task_id so next retry creates fresh task
        await pool.query(`UPDATE schedule_queue SET external_task_id = NULL WHERE id = $1`, [itemId]);
        await logActivity(userId, `❌ Server 3 failed: ${pollResult.error}`, 'error', itemId);
      }
    } else {
      // Task failed — clear external_task_id so we create a fresh one below
      await pool.query(`UPDATE schedule_queue SET external_task_id = NULL WHERE id = $1`, [itemId]);
      console.log(`[processItem] Existing Vidgo task failed, will create new one`);
    }
  }

  // Generate video with progress callback (only if we don't have a video yet)
  let result: VideoGenerationResult | undefined;

  // Check if there's an existing KIE task to resume
  if (item.platform === 'sora2-kie' && item.external_task_id && !videoUrl) {
    // Parse phase prefix for extend model: "phase1:<taskId>" or "phase2:<taskId>"
    const isExtendPhase1 = item.external_task_id.startsWith('phase1:');
    const isExtendPhase2 = item.external_task_id.startsWith('phase2:');
    const rawTaskId = (isExtendPhase1 || isExtendPhase2) ? item.external_task_id.split(':')[1] : item.external_task_id;

    console.log(`[processItem] Found existing KIE task ${item.external_task_id} for item ${itemId}, resuming poll...`);
    await logActivity(userId, `♻️ Resuming existing KIE task: ${item.external_task_id}`, 'info', itemId);
    // Poll existing KIE task
    for (let attempt = 0; ; attempt++) {
      if (isStoppedFn()) break;
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      if (isStoppedFn()) break;
      try {
        const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${rawTaskId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (isStoppedFn()) break;
        if (!statusResponse.ok) continue;
        const statusRaw: any = await statusResponse.json();
        const statusData = statusRaw.data || statusRaw;
        if (statusData.state === 'success') {
          let url: string | null = null;
          if (statusData.resultJson) {
            try {
              const rd = typeof statusData.resultJson === 'string' ? JSON.parse(statusData.resultJson) : statusData.resultJson;
              url = rd.resultUrls?.[0] || rd.url || rd.video_url || null;
            } catch {}
          }
          if (!url) url = statusData.resultUrl || statusData.videoUrl || statusData.url || null;

          if (isExtendPhase1) {
            // Phase 1 of extend completed on resume — save phase1_task_id so Phase 2 can skip Phase 1
            console.log(`[processItem] KIE Extend Phase 1 completed on resume (taskId=${rawTaskId}). Saving for Phase 2...`);
            await logActivity(userId, `✅ Phase 1 done. Proceeding to Phase 2...`, 'info', itemId);
            await pool.query(`UPDATE schedule_queue SET phase1_task_id = $1, external_task_id = NULL WHERE id = $2`, [rawTaskId, itemId]);
            // Update item in-memory so processItem picks it up
            item.phase1_task_id = rawTaskId;
            break;
          }

          if (url) {
            videoUrl = url;
            await pool.query(`UPDATE schedule_queue SET video_url = $1, status = 'generating' WHERE id = $2`, [videoUrl, itemId]);
            await syncVideoUrlWithDropbox(itemId);
            await logActivity(userId, `✅ Video ready from KIE (resumed)!`, 'success', itemId);
            break;
          }
        } else if (statusData.state === 'fail') {
          await pool.query(`UPDATE schedule_queue SET external_task_id = NULL WHERE id = $1`, [itemId]);
          await logActivity(userId, `❌ KIE task failed: ${statusData.failMsg}`, 'error', itemId);
          break;
        }
        if (attempt > 0 && attempt % 6 === 0) {
          const elapsed = Math.round(attempt * 5);
          // Check DB for cross-server stop before logging
          if (await isItemStoppedInDB(itemId)) {
            console.log(`[processItem] 🛑 KIE resume: stop detected via DB for item ${itemId}`);
            break;
          }
          await logActivity(userId, `⏳ Still generating... state=${statusData.state} (${elapsed}s elapsed)`, 'info', itemId);
        }
      } catch {}
    }
  }

  // After KIE resume loop: check why we broke out
  if (item.platform === 'sora2-kie' && item.external_task_id && !videoUrl && !result) {
    if (isStoppedFn()) {
      console.log(`[processItem] ⚠️ STATUS->FAILED (reason: KIE resume stopped by user) item=${itemId}`);
      stoppedRetryItems.delete(itemId);
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = 'Stopped by user', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
      await logActivity(userId, `🛑 Stopped`, 'warning', itemId);
      throw new StepError('Stopped by user');
    }
    // Resume task failed — don't create new task, let retry handle it
    console.log(`[processItem] KIE resume failed for item ${itemId}, letting retry handle it`);
    result = { success: false, error: 'KIE task failed on resume' };
  }

  if (videoUrl) {
    // Already got video from existing task above — skip generation
    result = { success: true, videoUrl };
  } else if (result) {
    // Already have a result from resume above — skip generation
  } else if (item.platform === 'sora2-kie' && item.ai_model === 'kie_grok_extend') {
    console.log(`[processItem] Calling KIE Grok + Extend API...`);
    await logActivity(userId, '📤 Sending prompt to KIE (Grok + Extend)...', 'info', itemId);

    // Use saved extend_prompt if available, otherwise generate from template
    let extendPrompt = item.prompt; // fallback to main prompt

    // Check if we have a pre-resolved extend_prompt saved in the queue item
    if (item.extend_prompt) {
      extendPrompt = item.extend_prompt;
      console.log(`[processItem ${itemId}] Using saved extend_prompt from queue item`);
      await logActivity(userId, '📝 Using saved extend prompt', 'info', itemId);
    } else {
      // No saved extend_prompt - generate from template (legacy behavior)
      const extClient = await pool.connect();
      try {
        await extClient.query('BEGIN');
        const extChResult = await extClient.query(
          `SELECT prompt_templates, template_selection_mode, template_round_robin_index, extend_prompt, extend_variables FROM scheduler_channels WHERE id = $1 FOR UPDATE`,
          [item.channel_id]
        );
        const extCh = extChResult.rows[0];
        const templates = extCh?.prompt_templates || [];

        if (templates.length > 0) {
        // The main prompt already advanced the round-robin index, so the current index
        // points to the NEXT template. Go back 1 to find the template used for this item.
        const currentIdx = extCh.template_round_robin_index || 0;
        const mode = extCh.template_selection_mode || 'round-robin';
        let usedIdx: number;
        if (mode === 'random') {
          // For random mode, we can't know which was picked — use the template whose
          // prompt best matches item.prompt, or just use first one with extend_prompt_template
          usedIdx = templates.findIndex((t: any) => t.extend_prompt_template);
          if (usedIdx < 0) usedIdx = 0;
        } else {
          // Round-robin: the index was already incremented, go back 1
          usedIdx = (currentIdx - 1 + templates.length) % templates.length;
        }
        const tmpl = templates[usedIdx];
        let extPromptText = tmpl?.extend_prompt_template || '';
        const extVars = tmpl?.extend_variables || [];

        if (extPromptText) {
          console.log(`[processItem] Extend prompt from template: "${tmpl.label}" (idx=${usedIdx})`);

          // Replace variables
          for (const variable of extVars) {
            const curlyPlaceholder = `{${variable.name}}`;
            const squarePlaceholder = `[${variable.name}]`;
            const hasCurly = extPromptText.includes(curlyPlaceholder);
            const hasSquare = extPromptText.includes(squarePlaceholder);
            if (!hasCurly && !hasSquare) continue;

            const allValues = variable.values || [];
            if (allValues.length === 0) continue;

            let unusedValues = allValues.filter((v: any) => v.status === 'new' || !v.status);
            if (unusedValues.length === 0) {
              for (const v of allValues) { v.status = 'new'; }
              unusedValues = allValues;
            }
            const pickedValue = unusedValues[unusedValues.length - 1];
            const pickedIndex = allValues.findIndex((v: any) => v.id === pickedValue.id);
            if (pickedIndex !== -1) allValues[pickedIndex].status = 'used';

            if (hasCurly) extPromptText = extPromptText.replace(new RegExp(`\\{${variable.name}\\}`, 'g'), pickedValue.value);
            if (hasSquare) extPromptText = extPromptText.replace(new RegExp(`\\[${variable.name}\\]`, 'g'), pickedValue.value);
          }

          // Save updated extend_variables back into the template
          templates[usedIdx].extend_variables = extVars;
          await extClient.query(
            `UPDATE scheduler_channels SET prompt_templates = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [JSON.stringify(templates), item.channel_id]
          );

          extendPrompt = extPromptText;
          console.log(`[processItem ${itemId}] Generated extend prompt from template: "${tmpl.label}"`);
          await logActivity(userId, `📝 Extend prompt generated from template: "${tmpl.label}"`, 'info', itemId);
        } else {
          console.log(`[processItem] No extend_prompt_template in template "${tmpl?.label}", using main prompt as extend`);
        }
      } else if (extCh?.extend_prompt) {
        // Single-template mode: use extend_prompt + extend_variables from channel
        let extPromptText = extCh.extend_prompt;
        const extVars = extCh.extend_variables || [];

        console.log(`[processItem] Extend prompt from single-template mode`);

        for (const variable of extVars) {
          const curlyPlaceholder = `{${variable.name}}`;
          const squarePlaceholder = `[${variable.name}]`;
          const hasCurly = extPromptText.includes(curlyPlaceholder);
          const hasSquare = extPromptText.includes(squarePlaceholder);
          if (!hasCurly && !hasSquare) continue;

          const allValues = variable.values || [];
          if (allValues.length === 0) continue;

          let unusedValues = allValues.filter((v: any) => v.status === 'new' || !v.status);
          if (unusedValues.length === 0) {
            for (const v of allValues) { v.status = 'new'; }
            unusedValues = allValues;
          }
          const pickedValue = unusedValues[unusedValues.length - 1];
          const pickedIndex = allValues.findIndex((v: any) => v.id === pickedValue.id);
          if (pickedIndex !== -1) allValues[pickedIndex].status = 'used';

          if (hasCurly) extPromptText = extPromptText.replace(new RegExp(`\\{${variable.name}\\}`, 'g'), pickedValue.value);
          if (hasSquare) extPromptText = extPromptText.replace(new RegExp(`\\[${variable.name}\\]`, 'g'), pickedValue.value);
        }

        await extClient.query(
          `UPDATE scheduler_channels SET extend_variables = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [JSON.stringify(extVars), item.channel_id]
        );

        extendPrompt = extPromptText;
        await logActivity(userId, `📝 Extend prompt generated`, 'info', itemId);
      }
      await extClient.query('COMMIT');
      } catch (extErr: any) {
        await extClient.query('ROLLBACK');
        console.error(`[processItem] Extend prompt generation error:`, extErr);
        await logActivity(userId, `⚠️ Extend prompt fallback to main prompt: ${extErr.message}`, 'warning', itemId);
      } finally {
        extClient.release();
      }
    } // end of else block for generating extend_prompt from template

    result = await generateVideoKieExtend(
      item.prompt, extendPrompt, item.aspect_ratio, item.duration, apiKey,
      progressCallback,
      isStoppedFn,
      async (taskId: string) => {
        await pool.query(
          `UPDATE schedule_queue SET external_task_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [taskId, itemId]
        );
        console.log(`[processItem] Saved KIE Extend task ID: ${taskId} for item ${itemId}`);
      },
      itemId,
      item.phase1_task_id || undefined, // Skip Phase 1 if already done
    );
    console.log(`[processItem] KIE Extend result:`, JSON.stringify(result));
    if (result.stopped) {
      console.log(`[processItem] ⚠️ STATUS->FAILED (reason: result.stopped=true, KIE Extend) item=${itemId}`);
      stoppedRetryItems.delete(itemId);
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = 'Stopped by user', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
      await logActivity(userId, `🛑 Stopped`, 'warning', itemId);
      throw new StepError('Stopped by user');
    }
    if (result.success) {
      await logActivity(userId, `✅ Extended video ready from KIE!`, 'success', itemId);
    } else {
      await logActivity(userId, `❌ KIE Extend failed: ${result.error}`, 'error', itemId);
    }
  } else if (item.platform === 'sora2-kie') {
    console.log(`[processItem] Calling KIE API...`);
    await logActivity(userId, '📤 Sending prompt to KIE...', 'info', itemId);
    result = await generateVideoKieAI(
      item.prompt, item.aspect_ratio, item.duration, apiKey, progressCallback,
      isStoppedFn,
      async (taskId: string) => {
        await pool.query(
          `UPDATE schedule_queue SET external_task_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [taskId, itemId]
        );
        console.log(`[processItem] Saved KIE task ID: ${taskId} for item ${itemId}`);
      },
      itemId,
      item.ai_model
    );
    console.log(`[processItem] KIE result:`, JSON.stringify(result));
    if (result.stopped) {
      // User pressed Stop — mark as failed so it won't be auto-retried
      console.log(`[processItem] ⚠️ STATUS->FAILED (reason: result.stopped=true, KIE) item=${itemId}`);
      stoppedRetryItems.delete(itemId);
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = 'Stopped by user', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
      await logActivity(userId, `🛑 Stopped`, 'warning', itemId);
      throw new StepError('Stopped by user');
    }
    if (result.success) {
      await logActivity(userId, `✅ Video ready from KIE!`, 'success', itemId);
    } else {
      await logActivity(userId, `❌ KIE failed: ${result.error}`, 'error', itemId);
    }
  } else if (item.platform === 'sora2-vidgo') {
    console.log(`[processItem] Calling Vidgo API...`);
    await logActivity(userId, '📤 Sending prompt to Server 3 (Vidgo)...', 'info', itemId);
    result = await generateVideoVidgo(
      item.prompt,
      item.aspect_ratio,
      item.duration,
      apiKey,
      progressCallback,
      isStoppedFn,
      // Save Vidgo task ID to database immediately so it can be tracked/resumed
      async (taskId: string) => {
        await pool.query(
          `UPDATE schedule_queue SET external_task_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [taskId, itemId]
        );
        console.log(`[processItem] Saved Vidgo task ID: ${taskId} for item ${itemId}`);
      },
      item.ai_model,
      itemId
    );
    console.log(`[processItem] Server 3 result:`, JSON.stringify(result));
    if (result.stopped) {
      console.log(`[processItem] ⚠️ STATUS->FAILED (reason: result.stopped=true, Server 3 Vidgo) item=${itemId}`);
      stoppedRetryItems.delete(itemId);
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = 'Stopped by user', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
      await logActivity(userId, `🛑 Stopped`, 'warning', itemId);
      throw new StepError('Stopped by user');
    }
    if (result.success) {
      await logActivity(userId, `✅ Video ready from Server 3!`, 'success', itemId);
    } else {
      await logActivity(userId, `❌ Server 3 failed: ${result.error}`, 'error', itemId);
    }
  } else {
    result = await generateVideoGrsai(
      item.prompt,
      item.aspect_ratio,
      item.duration,
      apiKey,
      undefined, // use default host
      progressCallback,
      isStoppedFn  // Use stable isStopped check with run ID
    );
    if (result.stopped) {
      console.log(`[processItem] ⚠️ STATUS->FAILED (reason: result.stopped=true, Server 2 Grsai) item=${itemId}`);
      stoppedRetryItems.delete(itemId);
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = 'Stopped by user', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
      await logActivity(userId, `🛑 Stopped`, 'warning', itemId);
      throw new StepError('Stopped by user');
    }
  }

  // If generation failed, return the result for processItem to handle retry
  if (!result!.success || !result!.videoUrl) {
    return { failed: true, result: result! };
  }

  videoUrl = result!.videoUrl;
  await pool.query(`UPDATE schedule_queue SET video_url = $1 WHERE id = $2`, [videoUrl, itemId]);
  await logActivity(userId, 'Video generated successfully!', 'success', itemId);

  // Upload to Dropbox for persistent storage (skip if already stored or already a Dropbox URL)
  if (videoUrl && isDropboxConfigured() && !item.dropbox_path && !videoUrl.includes('dropbox.com')) {
    try {
      // Check if channel has watermark enabled
      const wmResult = await pool.query(`
        SELECT watermark_enabled, watermark_type, watermark_text, watermark_image_url,
               watermark_position, watermark_opacity, watermark_image_size, watermark_circular
        FROM scheduler_channels WHERE id = $1
      `, [item.channel_id]);
      const wm = wmResult.rows[0];
      const wmEnabled = !!wm?.watermark_enabled;

      if (wmEnabled) {
        // Download → apply watermark → upload watermarked version
        await logActivity(userId, '💧 Applying watermark...', 'info', itemId);
        const tmpDir = path.join(os.tmpdir(), `wm-item-${itemId}-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        const inputPath = path.join(tmpDir, 'input.mp4');
        const outputPath = path.join(tmpDir, 'output.mp4');
        try {
          const resp = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
          if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
          fs.writeFileSync(inputPath, Buffer.from(await resp.arrayBuffer()));

          const settings: WatermarkSettings = {
            enabled: true,
            type: wm.watermark_type || 'text',
            text: wm.watermark_text || '',
            imageUrl: wm.watermark_image_url || undefined,
            position: wm.watermark_position || 'bottom-right',
            opacity: wm.watermark_opacity ?? 50,
            imageSize: wm.watermark_image_size || 'medium',
            circular: !!wm.watermark_circular,
          };
          await applyWatermark(inputPath, outputPath, settings, tmpDir);

          await logActivity(userId, '📦 Uploading watermarked video to storage...', 'info', itemId);
          const date = new Date().toISOString().slice(0, 10);
          const dropboxPath = `/trippleviral/videos/${userId}/${date}_${itemId}.mp4`;
          const { sharedUrl } = await uploadLocalFileToDropbox(outputPath, dropboxPath);
          videoUrl = sharedUrl;
          await pool.query(
            `UPDATE schedule_queue SET video_url = $1, dropbox_path = $2, watermarked = true WHERE id = $3`,
            [sharedUrl, dropboxPath, itemId]
          );
          await logActivity(userId, '✅ Video saved to storage (watermarked)!', 'success', itemId);
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
      } else {
        await logActivity(userId, '📦 Uploading video to storage...', 'info', itemId);
        const { sharedUrl, dropboxPath } = await uploadVideoToDropbox(videoUrl, userId, itemId);
        videoUrl = sharedUrl;
        await pool.query(
          `UPDATE schedule_queue SET video_url = $1, dropbox_path = $2 WHERE id = $3`,
          [sharedUrl, dropboxPath, itemId]
        );
        await logActivity(userId, '✅ Video saved to storage!', 'success', itemId);
      }
    } catch (dropboxErr: any) {
      // Log warning but continue with original URL — don't block the pipeline
      console.error(`[Dropbox] Upload failed for item ${itemId}:`, dropboxErr.message);
      await logActivity(userId, `⚠️ Storage upload failed, using original URL`, 'warning', itemId);
    }
  }

  // Generate thumbnail from video (non-blocking — don't fail the pipeline)
  try {
    const { generateThumbnail } = await import('../utils/thumbnail.js');
    const thumbnailUrl = await generateThumbnail(videoUrl, userId, itemId);
    if (thumbnailUrl) {
      await pool.query(`UPDATE schedule_queue SET thumbnail_url = $1 WHERE id = $2`, [thumbnailUrl, itemId]);
      await logActivity(userId, '🖼️ Thumbnail generated!', 'success', itemId);
    }
  } catch (thumbErr: any) {
    console.error(`[Thumbnail] Failed for item ${itemId}:`, thumbErr.message);
  }

  return { videoUrl };
}

/**
 * FIX D helper: pull the scene-specific prompt from a viral/idol task and
 * persist it to schedule_queue.prompt before captioning runs.
 *
 * Called by viralRunnerJob/idolRunnerJob right after the pipeline completes.
 * Returns the resolved prompt (or '' if nothing usable was found).
 */
export async function resolveAndSaveTaskPrompt(
  table: 'viral_template_tasks' | 'idol_template_tasks',
  taskId: number,
  queueItemId: number,
  videoUrl: string | null
): Promise<string> {
  try {
    const r = await pool.query(
      `SELECT ai_prompts, video_tasks, final_video_url FROM ${table} WHERE id = $1 LIMIT 1`,
      [taskId]
    );
    const row = r.rows[0];
    if (!row) return '';

    const aiPrompts = Array.isArray(row.ai_prompts) ? row.ai_prompts : [];
    if (aiPrompts.length === 0) return '';

    // Find which scene matches this video_url (if any)
    let sceneNum: number | undefined;
    if (videoUrl) {
      const urlMatch = String(videoUrl).match(/\/(\d+)_scene(\d+)\.mp4/i);
      if (urlMatch) {
        sceneNum = parseInt(urlMatch[2], 10);
      } else {
        const videoTasks = Array.isArray(row.video_tasks) ? row.video_tasks : [];
        const matched = videoTasks.find((v: any) => v?.video_url === videoUrl);
        if (matched?.scene !== undefined) sceneNum = matched.scene;
      }
    }

    // Pick scene-specific prompt; otherwise concat all scenes
    let promptText = '';
    if (sceneNum !== undefined) {
      const scene = aiPrompts.find((p: any) => p?.scene === sceneNum);
      if (scene) {
        promptText = scene.video_prompt || scene.image_prompt || scene.scene_name || '';
      }
    }
    if (!promptText) {
      promptText = aiPrompts
        .map((p: any) => p?.video_prompt || p?.image_prompt || p?.scene_name || '')
        .filter(Boolean)
        .join(' | ');
    }

    if (promptText) {
      // Overwrite even if a value already exists — handoffToViralPipeline/handoffToIdolPipeline
      // pre-fills schedule_queue.prompt with the meta-instruction template, which produces
      // generic captions. Replace it with the actual scene content from ai_prompts.
      await pool.query(
        `UPDATE schedule_queue SET prompt = $1 WHERE id = $2`,
        [promptText, queueItemId]
      );
    }
    return promptText;
  } catch (err: any) {
    console.error(`[resolveAndSaveTaskPrompt] ${table} task=${taskId} item=${queueItemId} error:`, err.message);
    return '';
  }
}

/**
 * STEP 2: Generate Caption
 * Returns the caption string.
 */
export async function stepGenerateCaption(
  userId: number,
  itemId: number,
  item: any
): Promise<string> {
  await pool.query(`UPDATE schedule_queue SET status = 'captioning' WHERE id = $1`, [itemId]);
  await logActivity(userId, '✍️ Generating caption with AI...', 'info', itemId);

  const captionStartTime = Date.now();
  // Get user's AI config
  const aiConfigResult = await pool.query(
    'SELECT openai_api_key, openrouter_api_key, ai_provider FROM users WHERE id = $1',
    [userId]
  );
  const userAiConfig = aiConfigResult.rows[0];
  let captionApiKey = '';
  let captionBaseUrl = 'https://api.openai.com/v1';
  if (userAiConfig?.ai_provider === 'openrouter' && userAiConfig?.openrouter_api_key) {
    captionApiKey = userAiConfig.openrouter_api_key;
    captionBaseUrl = 'https://openrouter.ai/api/v1';
  } else if (userAiConfig?.openai_api_key) {
    captionApiKey = userAiConfig.openai_api_key;
  } else {
    // Fallback to global api_keys table
    const openaiKeyResult = await pool.query(`SELECT key_value FROM api_keys WHERE key_name = 'openai_api_key'`);
    captionApiKey = openaiKeyResult.rows[0]?.key_value || '';
  }

  // ถ้า prompt ว่าง (เช่นเลือกคลิปจากประวัติมาโพส) → ย้อนหา original prompt จาก video_url เดียวกัน
  // ป้องกัน caption generic ("Less is more"/"Less talk, more action") ที่ไม่เกี่ยวกับเนื้อหาคลิป
  let promptForCaption = (item.prompt || '').trim();
  let promptResolutionFailed = false;
  if (!promptForCaption && item.video_url) {
    // FIX A: pick scene-specific prompt when URL embeds scene number
    // Otherwise join all scenes (best-effort context)
    const pickPromptFromAiPrompts = (raw: any, sceneNum?: number): string => {
      const prompts = Array.isArray(raw) ? raw : [];
      if (prompts.length === 0) return '';
      // Try scene-specific first
      if (sceneNum !== undefined) {
        const sceneEntry = prompts.find((p: any) => p?.scene === sceneNum);
        if (sceneEntry) {
          const s = sceneEntry.video_prompt || sceneEntry.image_prompt || sceneEntry.scene_name || '';
          if (s) return s;
        }
      }
      // Fallback: join all
      return prompts
        .map((p: any) => p?.video_prompt || p?.image_prompt || p?.scene_name || '')
        .filter(Boolean)
        .join(' | ');
    };

    // 1) หาใน schedule_queue อื่นที่มี video_url เดียวกัน (ใช้ prompt เก่าสุดที่ไม่ว่าง)
    const origSq = await pool.query(
      `SELECT prompt FROM schedule_queue
       WHERE video_url = $1 AND id <> $2 AND prompt IS NOT NULL AND length(trim(prompt)) > 0
       ORDER BY created_at ASC LIMIT 1`,
      [item.video_url, itemId]
    );
    if (origSq.rows[0]?.prompt) {
      promptForCaption = origSq.rows[0].prompt;
      await logActivity(userId, '📝 ใช้ prompt เดิมของคลิปสำหรับสร้าง caption', 'info', itemId);
    }

    // 2a) viral_template_tasks: ดึงตรงๆ ผ่าน task_id ที่ฝังใน URL (pattern: /<task_id>_scene<n>.mp4)
    //     FIX A: extract scene number too → pick only that scene's prompt
    if (!promptForCaption) {
      const viralIdMatch = String(item.video_url).match(/\/(\d+)_scene(\d+)\.mp4/i);
      if (viralIdMatch) {
        const taskId = parseInt(viralIdMatch[1], 10);
        const sceneNum = parseInt(viralIdMatch[2], 10);
        const r = await pool.query(
          `SELECT ai_prompts FROM viral_template_tasks WHERE id = $1 LIMIT 1`,
          [taskId]
        );
        const picked = pickPromptFromAiPrompts(r.rows[0]?.ai_prompts, sceneNum);
        if (picked) {
          promptForCaption = picked;
          await logActivity(userId, `📝 ใช้ prompt จาก viral template (scene ${sceneNum}) สำหรับสร้าง caption`, 'info', itemId);
        }
      }
    }

    // 2b) viral_template_tasks: fallback substring match (กรณี URL ไม่ match pattern)
    //     ลอง match scene จาก video_tasks[].video_url ก่อน เพื่อ pick scene-specific
    if (!promptForCaption) {
      const r = await pool.query(
        `SELECT ai_prompts, video_tasks, final_video_url FROM viral_template_tasks
         WHERE final_video_url = $1 OR video_tasks::text LIKE '%' || $1 || '%'
         LIMIT 1`,
        [item.video_url]
      );
      if (r.rows[0]) {
        const videoTasks = Array.isArray(r.rows[0].video_tasks) ? r.rows[0].video_tasks : [];
        const matchedScene = videoTasks.find((v: any) => v?.video_url === item.video_url);
        const sceneNum = matchedScene?.scene as number | undefined;
        const picked = pickPromptFromAiPrompts(r.rows[0].ai_prompts, sceneNum);
        if (picked) {
          promptForCaption = picked;
          const label = sceneNum !== undefined
            ? `📝 ใช้ prompt จาก viral template (scene ${sceneNum}, by url) สำหรับสร้าง caption`
            : `📝 ใช้ prompt จาก viral template (by url) สำหรับสร้าง caption`;
          await logActivity(userId, label, 'info', itemId);
        }
      }
    }

    // 2c) idol_template_tasks: pattern เดียวกัน (FIX A เพิ่ม idol lookup)
    if (!promptForCaption) {
      const idolIdMatch = String(item.video_url).match(/\/(\d+)_scene(\d+)\.mp4/i);
      if (idolIdMatch) {
        const taskId = parseInt(idolIdMatch[1], 10);
        const sceneNum = parseInt(idolIdMatch[2], 10);
        const r = await pool.query(
          `SELECT ai_prompts FROM idol_template_tasks WHERE id = $1 LIMIT 1`,
          [taskId]
        );
        const picked = pickPromptFromAiPrompts(r.rows[0]?.ai_prompts, sceneNum);
        if (picked) {
          promptForCaption = picked;
          await logActivity(userId, `📝 ใช้ prompt จาก idol template (scene ${sceneNum}) สำหรับสร้าง caption`, 'info', itemId);
        }
      }
    }

    // 2d) idol_template_tasks: substring match
    if (!promptForCaption) {
      const r = await pool.query(
        `SELECT ai_prompts, video_tasks, final_video_url FROM idol_template_tasks
         WHERE final_video_url = $1 OR video_tasks::text LIKE '%' || $1 || '%'
         LIMIT 1`,
        [item.video_url]
      );
      if (r.rows[0]) {
        const videoTasks = Array.isArray(r.rows[0].video_tasks) ? r.rows[0].video_tasks : [];
        const matchedScene = videoTasks.find((v: any) => v?.video_url === item.video_url);
        const sceneNum = matchedScene?.scene as number | undefined;
        const picked = pickPromptFromAiPrompts(r.rows[0].ai_prompts, sceneNum);
        if (picked) {
          promptForCaption = picked;
          const label = sceneNum !== undefined
            ? `📝 ใช้ prompt จาก idol template (scene ${sceneNum}, by url) สำหรับสร้าง caption`
            : `📝 ใช้ prompt จาก idol template (by url) สำหรับสร้าง caption`;
          await logActivity(userId, label, 'info', itemId);
        }
      }
    }

    // 3) content_history.prompt (กรณีคลิปถูก save ไว้ใน history)
    if (!promptForCaption) {
      const ch = await pool.query(
        `SELECT prompt FROM content_history WHERE user_id = $1 AND video_url = $2 AND prompt IS NOT NULL AND length(trim(prompt)) > 0 LIMIT 1`,
        [userId, item.video_url]
      );
      if (ch.rows[0]?.prompt) {
        promptForCaption = ch.rows[0].prompt;
        await logActivity(userId, '📝 ใช้ prompt จาก history สำหรับสร้าง caption', 'info', itemId);
      }
    }

    // ถ้ายังไม่เจอ — เตือน + ไม่ใช้ system_prompt (เพราะเป็น meta-instruction ไม่ใช่ scene content)
    if (!promptForCaption) {
      promptResolutionFailed = true;
      console.log(`[Caption] ⚠️ Item ${itemId}: no prompt found for video_url=${item.video_url}`);
      await logActivity(userId, '⚠️ หา prompt ของวิดีโอไม่เจอ — caption อาจไม่ตรงเนื้อหา', 'warning', itemId);
    } else {
      // FIX D (incremental): save resolved prompt back so retries/recovery skip lookup
      try {
        await pool.query(`UPDATE schedule_queue SET prompt = $1 WHERE id = $2 AND (prompt IS NULL OR length(trim(prompt)) = 0)`, [promptForCaption, itemId]);
      } catch (saveErr) {
        // non-critical — caption flow continues regardless
      }
    }
  }

  const caption = await generateCaption(
    promptForCaption,
    item.caption_language || 'en',
    item.custom_hashtags || '',
    captionApiKey,
    captionBaseUrl
  );

  const captionElapsed = Math.round((Date.now() - captionStartTime) / 1000);
  await pool.query(`UPDATE schedule_queue SET caption = $1 WHERE id = $2`, [caption, itemId]);
  // FIX C: log differently if prompt resolution failed (UI shows orange warning instead of green success)
  if (promptResolutionFailed) {
    await logActivity(
      userId,
      `⚠️ Caption สร้างแล้ว แต่ไม่มี prompt ต้นทาง — อาจไม่ตรงเนื้อหาคลิป (${captionElapsed}s)`,
      'warning',
      itemId
    );
  } else {
    await logActivity(userId, `✅ Caption ready! (took ${captionElapsed}s)`, 'success', itemId);
  }
  return caption;
}

/**
 * Classify a posting error as transient (worth retrying later) vs permanent.
 * Transient: auth hiccups, rate limits, server errors, network/timeout.
 * Permanent: bad request, missing resource, validation — retrying won't help.
 */
function isTransientPostingError(error: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  // Permanent: explicit client errors that won't recover on retry
  if (/\b4(00|03|04|22)\b/.test(error)) return false;
  // Transient signals
  return (
    /\b401\b/.test(error) ||
    /\b429\b/.test(error) ||
    /\b5\d\d\b/.test(error) ||
    lower.includes('unauthorized') ||
    lower.includes('rate limit') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('socket hang up')
  );
}

// Backoff schedule in minutes, indexed by attempt number (0-based)
const POSTING_RETRY_BACKOFF_MIN = [1, 3, 10, 30, 60, 120];
const MAX_POSTING_ATTEMPTS = POSTING_RETRY_BACKOFF_MIN.length;

function backoffMinutesForAttempt(attempt: number): number {
  return POSTING_RETRY_BACKOFF_MIN[Math.min(attempt, POSTING_RETRY_BACKOFF_MIN.length - 1)];
}

/**
 * STEP 3: Post to social media (Blotato, Late, PostForMe)
 * Includes posting retry loop for duplicate content errors.
 * Returns { success: true } or throws/returns failure.
 */
export async function stepPostToSocial(
  userId: number,
  itemId: number,
  item: any,
  videoUrl: string,
  caption: string,
  callbacks?: ProcessCallbacks
): Promise<{ success: boolean }> {
  // Don't post if there's no video
  if (!videoUrl) {
    console.log(`[processItem] No video URL — skipping posting for item ${itemId}`);
    await logActivity(userId, '⚠️ ยังไม่มี URL วิดีโอ ข้ามการโพสต์', 'warning', itemId);
    await pool.query(`UPDATE schedule_queue SET status = 'failed', error = 'No video URL', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
    return { success: false };
  }

  const postingService = item.posting_service || 'none';
  const channelTimezone = (!item.timezone || item.timezone === 'local') ? 'UTC' : item.timezone;

  // Parse scheduled time - already stored as UTC in DB
  let scheduledTimeStr = item.scheduled_time;
  if (scheduledTimeStr && typeof scheduledTimeStr === 'string') {
    scheduledTimeStr = scheduledTimeStr.replace('.undefinedZ', '.000Z').replace('undefined', '');
  }

  let parsedScheduledTime: Date | undefined;
  if (scheduledTimeStr) {
    const parsed = new Date(scheduledTimeStr);
    parsedScheduledTime = !isNaN(parsed.getTime()) ? parsed : undefined;
    if (parsedScheduledTime) {
      console.log(`[processItem] Scheduled time: ${parsedScheduledTime.toISOString()} UTC`);
    }
  }

  const now = new Date();
  const validScheduledTime = parsedScheduledTime && parsedScheduledTime > now ? parsedScheduledTime : undefined;

  if (parsedScheduledTime && !validScheduledTime) {
    console.log(`[processItem] Scheduled time passed (${parsedScheduledTime.toISOString()}), posting immediately`);
    await logActivity(userId, `⏰ Scheduled time passed, posting immediately`, 'info', itemId);
  }

  let postResults: Array<{ platform: string; status: string; error?: string; postId?: string }> | null = null;
  let resultColumnName: string | null = null;
  // Hoisted so the success block can re-use the resolved Postforme key to GET
  // /v1/social-posts/{sp_xxx} for the dashboard-matching scheduled_at value.
  let pfmApiKeyResolved: string = '';

  // Track posting retries for duplicate content errors
  const MAX_POSTING_RETRIES = 3;
  let postingRetryCount = 0;
  let currentCaption = caption;

  // Helper to check if error is Facebook duplicate content error
  const isDuplicateContentError = (error: string) => {
    return error.includes('already scheduled') ||
           error.includes('exact content') ||
           error.includes('posted to this account within');
  };

  // Helper to modify caption slightly for retry
  const modifyCaption = (cap: string, attempt: number) => {
    // Add invisible zero-width space + timestamp at end
    const zwsp = '\u200B'; // Zero-width space (invisible)
    const modifier = `${zwsp}${Date.now().toString(36).slice(-3)}`;
    return cap + modifier;
  };

  // Posting retry loop
  while (postingRetryCount <= MAX_POSTING_RETRIES) {
    postResults = null;
    resultColumnName = null;

  if (postingService === 'blotato' && item.blotato_account_id) {
    const pageIds = item.page_ids || {};
    const hasPageIds = Object.values(pageIds).some((id: any) => id && id.trim() !== '');

    if (hasPageIds) {
      await pool.query(`UPDATE schedule_queue SET status = 'scheduling' WHERE id = $1`, [itemId]);
      const platforms = Object.entries(pageIds)
        .filter(([_, id]: [string, any]) => id && id.trim() !== '')
        .map(([platform]) => platform);
      await logActivity(userId, `📤 Blotato: Posting to ${platforms.join(', ')}...`, 'info', itemId);

      postResults = await scheduleToAllPlatforms(
        item.blotato_account_id, pageIds, videoUrl, currentCaption, validScheduledTime, item.blotato_api_key
      );
      resultColumnName = 'blotato_post_ids';
    } else {
      await logActivity(userId, 'Skipping Blotato (no page IDs configured)', 'info', itemId);
    }
  } else if (postingService === 'late' && item.late_api_key) {
    const lateAccounts = item.late_accounts || [];
    const hasAccounts = lateAccounts.some((a: any) => a.accountId && a.accountId.trim() !== '');

    if (hasAccounts) {
      await pool.query(`UPDATE schedule_queue SET status = 'scheduling' WHERE id = $1`, [itemId]);
      const platforms = lateAccounts.filter((a: any) => a.accountId).map((a: any) => a.platform);
      await logActivity(userId, `📤 Late: Posting to ${platforms.join(', ')}...`, 'info', itemId);

      postResults = await scheduleToAllPlatformsViaLate(
        item.late_api_key, lateAccounts, videoUrl, currentCaption, validScheduledTime, item.timezone || 'UTC'
      );
      resultColumnName = 'late_post_ids';
    } else {
      await logActivity(userId, 'Skipping Late (no accounts configured)', 'info', itemId);
    }
  } else if (postingService === 'postforme') {
    // Auto-match PostForMe API key by checking which key owns the channel's social accounts
    const pfmAccounts: string[] = item.postforme_accounts || [];
    const hasAccounts = pfmAccounts.some((id: string) => id && id.trim() !== '');
    const activeAccounts = pfmAccounts.filter((id: string) => id && id.trim() !== '');

    let pfmApiKey = '';
    const userKeys: any[] = item.postforme_api_keys || [];
    console.log(`[PostForMe] Debug: activeAccounts=${JSON.stringify(activeAccounts)}, userKeys count=${userKeys.length}, channel_key_name=${item.channel_postforme_key_name}, legacy_key=${item.postforme_api_key ? 'yes' : 'no'}`);

    if (hasAccounts && userKeys.length > 0) {
      // Auto-match: find which key owns the channel's social accounts
      for (const keyEntry of userKeys) {
        try {
          const keyAccounts = await getPostFormeSocialAccounts(keyEntry.key);
          const allMatch = activeAccounts.every((acc: string) => keyAccounts.includes(acc));
          if (allMatch) {
            pfmApiKey = keyEntry.key;
            console.log(`[PostForMe] Auto-matched key "${keyEntry.name}" for accounts: ${activeAccounts.join(', ')}`);
            break;
          }
        } catch (e) {
          console.log(`[PostForMe] Failed to check key "${keyEntry.name}":`, e);
        }
      }

      // Fallback: try first key if no match found
      if (!pfmApiKey && userKeys.length === 1) {
        pfmApiKey = userKeys[0].key;
        console.log(`[PostForMe] Using only available key "${userKeys[0].name}"`);
      }
    }

    // Legacy fallback: single key
    if (!pfmApiKey) {
      pfmApiKey = item.postforme_api_key || '';
    }

    if (hasAccounts && pfmApiKey) {
      await pool.query(`UPDATE schedule_queue SET status = 'scheduling' WHERE id = $1`, [itemId]);
      await logActivity(userId, `[PostForMe] Posting to ${activeAccounts.length} accounts...`, 'info', itemId);

      postResults = await scheduleViaPostForMe(
        pfmApiKey, pfmAccounts, videoUrl, currentCaption, validScheduledTime
      );
      resultColumnName = 'postforme_post_ids';
      pfmApiKeyResolved = pfmApiKey; // expose for the success block's GET call
    } else if (!pfmApiKey) {
      await logActivity(userId, '❌ ไม่พบ API Key ที่ตรงกับ Social Accounts ของช่องนี้ กรุณาตั้งค่า PostForMe API Key ในหน้าตั้งค่า', 'error', itemId);
    } else {
      await logActivity(userId, 'Skipping Post for Me (no accounts configured)', 'info', itemId);
    }
  } else if (postingService === 'none') {
    await logActivity(userId, 'Posting service: none (gen only)', 'info', itemId);
    break; // No posting needed, exit retry loop
  } else {
    // Legacy: check blotato_account_id for backwards compatibility
    if (item.blotato_account_id) {
      const pageIds = item.page_ids || {};
      const hasPageIds = Object.values(pageIds).some((id: any) => id && id.trim() !== '');
      if (hasPageIds) {
        await pool.query(`UPDATE schedule_queue SET status = 'scheduling' WHERE id = $1`, [itemId]);
        const platforms = Object.entries(pageIds)
          .filter(([_, id]: [string, any]) => id && id.trim() !== '')
          .map(([platform]) => platform);
        await logActivity(userId, `📤 Blotato (legacy): Posting to ${platforms.join(', ')}...`, 'info', itemId);

        postResults = await scheduleToAllPlatforms(
          item.blotato_account_id, pageIds, videoUrl, currentCaption, validScheduledTime, item.blotato_api_key
        );
        resultColumnName = 'blotato_post_ids';
      }
    }
    if (!postResults) break; // No posting configured, exit retry loop
  }

  // Handle post results (shared logic for both services)
  if (postResults && resultColumnName) {
    const allSuccessful = postResults.every(r => r.status === 'success');
    const anySuccessful = postResults.some(r => r.status === 'success');
    const postedPlatforms = postResults.filter(r => r.status === 'success').map(r => r.platform).join(', ');

    await pool.query(
      `UPDATE schedule_queue SET ${resultColumnName} = $1, posting_service = $2 WHERE id = $3`,
      [JSON.stringify(postResults), postingService, itemId]
    );

    if (allSuccessful) {
      if (postingService === 'postforme') {
        // Postforme aggregates all accounts under one sp_xxx — show that ID and schedule
        // an inner-status check after the post_at time (or 30 s from now for immediate posts).
        const spId = postResults[0]?.postId || 'unknown';
        await logActivity(userId, `✅ Posted to: Post ID : ${spId}`, 'success', itemId);

        const checkBaseMs = (parsedScheduledTime && parsedScheduledTime > new Date())
          ? parsedScheduledTime.getTime()
          : Date.now();
        const checkAfter = new Date(checkBaseMs + 30_000);

        await pool.query(
          `UPDATE schedule_queue
             SET status = 'done', posting_attempts = 0, retry_after_at = NULL,
                 status_check_after_at = $1, status_check_attempts = 0,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [checkAfter, itemId]
        );
        await logActivity(userId, '✅ Completed!', 'success', itemId);

        // Pull scheduled_at straight from Postforme so the log mirrors the dashboard's
        // "Post At" column verbatim — sidesteps any local timezone-fallback drift.
        let postAtDisplay = formatPostAtAsDashboard(parsedScheduledTime || new Date());
        if (spId !== 'unknown' && pfmApiKeyResolved) {
          try {
            const meta = await getPostFormePostStatus(pfmApiKeyResolved, spId);
            if (meta?.scheduled_at) {
              postAtDisplay = formatPostAtAsDashboard(meta.scheduled_at);
            }
          } catch (e: any) {
            console.log(`[PostForMe] Failed to fetch scheduled_at for log: ${e.message}`);
          }
        }
        await logActivity(userId, `📅 Post At: ${postAtDisplay}`, 'info', itemId);
      } else {
        await logActivity(userId, `✅ Posted to: ${postedPlatforms}`, 'success', itemId);
        await pool.query(`UPDATE schedule_queue SET status = 'done', posting_attempts = 0, retry_after_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
        await logActivity(userId, '✅ Completed!', 'success', itemId);
      }
      callbacks?.onItemComplete?.(itemId, true);
      return { success: true };
    } else if (anySuccessful) {
      const errors = postResults.filter(r => r.status === 'failed').map(r => `${r.platform}: ${r.error}`).join('; ');
      await logActivity(userId, `⚠️ Partial success. Posted to: ${postedPlatforms}. Failed: ${errors}`, 'warning', itemId);
      await pool.query(`UPDATE schedule_queue SET status = 'done', posting_attempts = 0, retry_after_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
      await logActivity(userId, '✅ Completed (with warnings)', 'success', itemId);
      callbacks?.onItemComplete?.(itemId, true);
      return { success: true };
    } else {
      // All posts failed - check if it's a duplicate content error
      const errors = postResults.filter(r => r.status === 'failed').map(r => `${r.platform}: ${r.error}`).join('; ');
      const hasDuplicateError = postResults.some(r => r.error && isDuplicateContentError(r.error));

      if (hasDuplicateError && postingRetryCount < MAX_POSTING_RETRIES) {
        // Duplicate content error - modify caption and retry
        postingRetryCount++;
        currentCaption = modifyCaption(caption, postingRetryCount);
        await logActivity(userId, `🔄 Duplicate detected, modifying caption and retrying (${postingRetryCount}/${MAX_POSTING_RETRIES})...`, 'info', itemId);
        // Update caption in DB
        await pool.query(`UPDATE schedule_queue SET caption = $1 WHERE id = $2`, [currentCaption, itemId]);
        continue; // Retry posting with modified caption
      }

      // Not a duplicate error or duplicate retries exhausted
      const serviceName = postingService === 'late' ? 'Late' : postingService === 'postforme' ? 'Post for Me' : 'Blotato';
      const errorMsg = `${serviceName} posting failed: ${errors}`;

      // Check if ALL failing posts are transient → schedule a delayed retry
      const allTransient = postResults
        .filter(r => r.status !== 'success')
        .every(r => isTransientPostingError(r.error || ''));

      if (allTransient) {
        const attemptsRow = await pool.query(`SELECT posting_attempts FROM schedule_queue WHERE id = $1`, [itemId]);
        const currentAttempts = (attemptsRow.rows[0]?.posting_attempts || 0) + 1;

        if (currentAttempts < MAX_POSTING_ATTEMPTS) {
          const waitMin = backoffMinutesForAttempt(currentAttempts - 1);
          const retryAt = new Date(Date.now() + waitMin * 60 * 1000);
          await pool.query(
            `UPDATE schedule_queue
               SET status = 'posting_retry', posting_attempts = $1, retry_after_at = $2,
                   error = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [currentAttempts, retryAt, errorMsg, itemId]
          );
          await logActivity(
            userId,
            `⏰ Transient error — will auto-retry in ${waitMin} min (${currentAttempts}/${MAX_POSTING_ATTEMPTS}): ${errors}`,
            'warning',
            itemId
          );
          callbacks?.onItemComplete?.(itemId, false);
          return { success: false };
        }
        // Exhausted retries — fall through to permanent failure
        await logActivity(userId, `❌ Auto-retry exhausted (${MAX_POSTING_ATTEMPTS} attempts): ${errors}`, 'error', itemId);
      }

      await logActivity(userId, `❌ All posts failed: ${errors}`, 'error', itemId);
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [errorMsg, itemId]);
      callbacks?.onItemComplete?.(itemId, false);
      return { success: false };
    }
  }

  break; // No posting results, exit retry loop
  } // End of posting retry loop

  // No posting service configured or no accounts — mark as done
  await pool.query(`UPDATE schedule_queue SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
  await logActivity(userId, '✅ Completed!', 'success', itemId);
  callbacks?.onItemComplete?.(itemId, true);

  return { success: true };
}

/**
 * Custom error class for step functions to signal early return with { success: false }
 * without triggering the catch block's retry/transient error logic.
 */
class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepError';
  }
}

/**
 * Process a single queue item
 */
export async function processItem(
  userId: number,
  itemId: number,
  callbacks?: ProcessCallbacks,
  templateId?: string,
  templateMode?: string,
  generateOnly?: boolean,
  skipLock?: boolean
): Promise<{ success: boolean; error?: string }> {
  console.log(`[processItem] Starting item ${itemId} for user ${userId} — called from:`, new Error().stack?.split('\n')[2]?.trim());

  // Check if this item was recently stopped - skip processing entirely
  if (stoppedRetryItems.has(itemId)) {
    console.log(`[processItem] ⏹️ Item ${itemId} was stopped - skipping`);
    return { success: false, error: 'Item was stopped' };
  }

  // Check if this item is ALREADY running - prevent duplicate processing
  // Skip when skipLock=true (retry recursive call) — item stays tracked, no need to block
  if (!skipLock) {
    const userRunningItems = runningItemsPerUser.get(userId);
    if (userRunningItems?.has(itemId)) {
      console.log(`[processItem] ⚠️ Item ${itemId} already running - skipping duplicate`);
      return { success: false, error: 'Item already running' };
    }
  }

  // Ensure runningUsers is set so isStopped check doesn't think user stopped
  // (This is needed when processItem is called directly, not through runQueue)
  const wasRunning = runningUsers.get(userId);
  if (!wasRunning) {
    runningUsers.set(userId, true);
  }

  // Clear stopped flag when starting a new task (allows new runs after a stop)
  stoppedUsers.delete(userId);

  // Track this item as running
  trackItemRunning(userId, itemId);

  // Capture the current run ID to use for isStopped checks
  const myRunId = getRunId(userId);
  console.log(`[processItem] Item ${itemId} using runId: ${myRunId}, stoppedUsers.has: ${stoppedUsers.has(userId)}`);

  // Create a stable isStopped function that checks if user has pressed Stop
  const isStoppedForThisRun = (): boolean => {
    // Check if user pressed Stop (all items) or stopped this specific item
    return stoppedUsers.has(userId) || stoppedRetryItems.has(itemId);
  };

  try {
    // Get queue item with channel info and user's Late API key
    // Use COALESCE to prefer channel posting_service if queue item posting_service is null or 'none'
    const itemResult = await pool.query(`
      SELECT q.*, c.blotato_account_id, c.blotato_api_key, c.page_ids, c.caption_language, c.custom_hashtags, c.name as channel_name, COALESCE(q.ai_model, c.ai_model) as ai_model,
             CASE WHEN q.posting_service IS NULL OR q.posting_service = 'none' THEN c.posting_service ELSE q.posting_service END as posting_service,
             u.late_api_key, c.late_profile_id, c.late_accounts, c.postforme_api_key as channel_postforme_key_name, u.postforme_api_key, u.postforme_api_keys, c.postforme_accounts, c.timezone
      FROM schedule_queue q
      LEFT JOIN scheduler_channels c ON q.channel_id = c.id
      LEFT JOIN users u ON q.user_id = u.id
      WHERE q.id = $1 AND q.user_id = $2
    `, [itemId, userId]);

    if (itemResult.rows.length === 0) {
      console.log(`[processItem] Item ${itemId} not found`);
      return { success: false, error: 'Queue item not found' };
    }

    const item = itemResult.rows[0];

    // Skip if item is already completed or stopped
    if (item.status === 'done') {
      console.log(`[processItem] Item ${itemId} already done - skipping`);
      untrackItemRunning(userId, itemId);
      return { success: true };
    }
    if (item.status === 'failed' && item.error === 'Stopped by user') {
      console.log(`[processItem] Item ${itemId} was stopped by user - skipping`);
      untrackItemRunning(userId, itemId);
      return { success: false, error: 'Stopped by user' };
    }

    // DB-LEVEL LOCK: Atomically set status to 'generating' ONLY if item is in a startable state
    // skipLock=true when called from retry (item is already 'generating' and tracked)
    if (skipLock) {
      console.log(`[processItem] Skipping DB lock for item ${itemId} (retry call)`);
      // Keep external_task_id — processItem will resume polling if task is still running on KIE/Vidgo
      await pool.query(`UPDATE schedule_queue SET error = NULL, video_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
    }

    const lockResult = skipLock ? { rowCount: 1 } : await pool.query(`
      UPDATE schedule_queue
      SET status = 'generating', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status IN ('pending', 'queued', 'failed')
      RETURNING id
    `, [itemId]);

    if (lockResult.rowCount === 0) {
      // Item is in 'generating', 'done', 'scheduling', 'captioning' or other state
      // 'generating' means another processItem call is already handling it
      // 'done' means it's already completed
      console.log(`[processItem] Item ${itemId} status='${item.status}' - already being processed or completed, skipping`);
      untrackItemRunning(userId, itemId);
      // Return success if done, failure otherwise
      if (item.status === 'done') {
        return { success: true };
      }
      return { success: false, error: `Item already in ${item.status} state` };
    }

    console.log(`[processItem] Item ${itemId}: channel=${item.channel_name}, platform=${item.platform}, prompt=${item.prompt?.substring(0, 50)}...`);

    // ข้าม viral items ที่ handoff ไปแล้ว — viralRunnerJob จัดการต่อ
    if (item.external_task_id && String(item.external_task_id).startsWith('viral-')) {
      console.log(`[processItem] Item ${itemId} is viral — skipping (viralRunnerJob handles it)`);
      callbacks?.onItemComplete?.(itemId, true);
      return { success: true };
    }

    callbacks?.onItemStart?.(itemId, item.channel_name);
    await logActivity(userId, `Starting: ${item.channel_name}`, 'info', itemId);

    // ถ้ามี video_url อยู่แล้ว (เช่น user เลือกคลิปจากประวัติมา post) → skip pipeline, ไปขั้น caption+post
    const hasReadyVideo = !!(item.video_url && String(item.video_url).startsWith('http'));

    // VIRAL TEMPLATE FIRST-RUN: สร้าง viral task แล้ว handoff ไป viralRunnerJob
    // เงื่อนไข: ai_model = kie_viral_template และ "ยังไม่มี" external_task_id และยัง "ไม่มี video_url"
    // (retry flow ไม่ผ่านตรงนี้ — retry endpoint reset viral task เดิมให้ pending แล้ว return โดยตรง)
    // handoffToViralPipeline throws StepError('VIRAL_HANDOFF') ซึ่งโดน catch ที่ด้านล่างและ return success
    if (item.ai_model === 'kie_viral_template' && !item.external_task_id && !hasReadyVideo) {
      await handoffToViralPipeline(userId, itemId, item, templateId, templateMode);
      // ไม่ถึงตรงนี้ — throw ไปแล้ว
    }

    // IDOL TEMPLATE FIRST-RUN: สร้าง idol task แล้ว handoff ไป idolRunnerJob
    if (item.ai_model === 'kie_idol_template' && !item.external_task_id && !hasReadyVideo) {
      await handoffToIdolPipeline(userId, itemId, item, templateId, templateMode);
      // ไม่ถึงตรงนี้ — throw ไปแล้ว
    }

    // STEP 0: Generate Prompt if prompt is empty
    // ข้าม prompt generation ถ้า video พร้อมแล้ว (post-from-history / retry post-only)
    // caption step มี fallback หา prompt เดิมจาก video_url อยู่แล้ว (~line 2437) — ไม่ต้องเรียก AI, ไม่หัก credit
    if (hasReadyVideo) {
      await logActivity(userId, '♻️ Skip prompt generation (video exists)', 'info', itemId);
    } else if (!item.prompt || item.prompt.trim() === '') {
      item.prompt = await stepGeneratePrompt(userId, itemId, item, templateId, templateMode, false);
    }

    // STEP 1: Generate Video (skip if already has video_url)
    let videoUrl = item.video_url;

    // Check if video already exists (for retry - skip video generation)
    if (videoUrl && videoUrl.startsWith('http')) {
      console.log(`[processItem] Video already exists: ${videoUrl.substring(0, 50)}...`);
      await logActivity(userId, '♻️ Video exists, skipping generation...', 'info', itemId);

      // Apply watermark สำหรับ "เลือกจากประวัติมาโพสต์" — ถ้า channel เปิดลายน้ำและยังไม่เคยใส่กับ URL นี้
      if (isDropboxConfigured()) {
        const wmResult = await pool.query(`
          SELECT watermark_enabled, watermark_type, watermark_text, watermark_image_url,
                 watermark_position, watermark_opacity, watermark_image_size, watermark_circular
          FROM scheduler_channels WHERE id = $1
        `, [item.channel_id]);
        const wm = wmResult.rows[0];
        if (wm?.watermark_enabled) {
          // เช็คว่า video_url นี้เคยโดนใส่ลายน้ำหรือยัง (ดูข้าม queue item ทุกรายการของ user)
          const already = await pool.query(
            `SELECT 1 FROM schedule_queue WHERE video_url = $1 AND watermarked = true LIMIT 1`,
            [videoUrl]
          );
          if (already.rowCount && already.rowCount > 0) {
            await logActivity(userId, '💧 ลายน้ำใส่แล้ว (ข้าม)', 'info', itemId);
            await pool.query(`UPDATE schedule_queue SET watermarked = true WHERE id = $1`, [itemId]);
          } else {
            await logActivity(userId, '💧 Applying watermark ก่อนโพสต์...', 'info', itemId);
            const tmpDir = path.join(os.tmpdir(), `wm-post-${itemId}-${Date.now()}`);
            fs.mkdirSync(tmpDir, { recursive: true });
            const inputPath = path.join(tmpDir, 'input.mp4');
            const outputPath = path.join(tmpDir, 'output.mp4');
            try {
              const resp = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
              if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
              fs.writeFileSync(inputPath, Buffer.from(await resp.arrayBuffer()));

              const settings: WatermarkSettings = {
                enabled: true,
                type: wm.watermark_type || 'text',
                text: wm.watermark_text || '',
                imageUrl: wm.watermark_image_url || undefined,
                position: wm.watermark_position || 'bottom-right',
                opacity: wm.watermark_opacity ?? 50,
                imageSize: wm.watermark_image_size || 'medium',
                circular: !!wm.watermark_circular,
              };
              await applyWatermark(inputPath, outputPath, settings, tmpDir);

              const date = new Date().toISOString().slice(0, 10);
              const dropboxPath = `/trippleviral/videos/${userId}/${date}_${itemId}_wm.mp4`;
              const { sharedUrl } = await uploadLocalFileToDropbox(outputPath, dropboxPath);
              videoUrl = sharedUrl;
              item.video_url = sharedUrl;
              await pool.query(
                `UPDATE schedule_queue SET video_url = $1, dropbox_path = $2, watermarked = true WHERE id = $3`,
                [sharedUrl, dropboxPath, itemId]
              );
              await logActivity(userId, '✅ ใส่ลายน้ำและอัพโหลดเรียบร้อย', 'success', itemId);
            } catch (wmErr: any) {
              console.error(`[Watermark] Post-time apply failed for item ${itemId}:`, wmErr.message);
              await logActivity(userId, `⚠️ ใส่ลายน้ำไม่สำเร็จ ใช้วิดีโอเดิมโพสต์`, 'warning', itemId);
            } finally {
              try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
            }
          }
        }
      }
    } else if (!videoUrl) {
      const progressCallback = async (msg: string) => {
        await logActivity(userId, msg, 'info', itemId);
      };

      const videoResult = await stepGenerateVideo(userId, itemId, item, isStoppedForThisRun, progressCallback);

      if ('failed' in videoResult) {
        // Video generation failed — handle retry logic here (stays in processItem)
        const result = videoResult.result;
        const error = result.error || 'Video generation failed';

        // If this is a polling timeout with external_task_id, keep in 'generating' for recovery
        if (result.externalTaskId && error.includes('polling timeout')) {
          await logActivity(userId, `⏳ Polling timeout - task ${result.externalTaskId} will be checked by recovery job`, 'warning', itemId);
          // Keep status as 'generating' - recovery job will check later
          return { success: false, error: 'Polling timeout - recovery will continue' };
        }

        // Check if this item was requested to stop retrying
        if (stoppedRetryItems.has(itemId)) {
          stoppedRetryItems.delete(itemId);
          await pool.query(`UPDATE schedule_queue SET status = 'failed', retry_mode = 'limited', error = $1 WHERE id = $2`,
            [`${error} (stopped by user)`, itemId]);
          await logActivity(userId, `🛑 Retry stopped by user`, 'warning', itemId);
          return { success: false, error: 'Stopped by user' };
        }

        // Don't retry if it's a non-recoverable error (credits, API key, etc.)
        const nonRecoverableErrors = ['API key not configured', 'Invalid API key', 'Unauthorized'];
        const errorLower = error.toLowerCase();
        const isCreditError = errorLower.includes('credit') && /insufficient|not enough|exhausted|no credit|balance|หมด/.test(errorLower);
        const isNonRecoverable = isCreditError || nonRecoverableErrors.some(e => errorLower.includes(e.toLowerCase()));
        if (isNonRecoverable) {
          // Custom message for credits error
          let userMessage = `🚫 ${error} — retry stopped (fix the issue first)`;
          if (isCreditError) {
            userMessage = `💳 KIE Credit หมด — กรุณาเติม Credit ที่ kie.ai แล้วกด "สร้าง" ใหม่`;
          }
          await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [error, itemId]);
          await logActivity(userId, userMessage, 'error', itemId);
          return { success: false, error };
        }

        // Auto-retry unlimited by default (always retry until success or user stops)
        // CRITICAL: Check DB status before retrying — stop endpoint sets status='failed' directly
        const retryInfoResult = await pool.query(`SELECT retry_count, status FROM schedule_queue WHERE id = $1`, [itemId]);
        if (retryInfoResult.rows[0]?.status === 'failed') {
          console.log(`[processItem] Item ${itemId} status is 'failed' in DB — stop was requested, not retrying`);
          return { success: false, error: 'Stopped by user' };
        }
        const currentRetryCount = retryInfoResult.rows[0]?.retry_count || 0;

        // Always auto-retry (unlimited mode is now default)
        // Auto-retry: reset to 'pending' so processItem's DB lock can re-acquire
        // IMPORTANT: Keep external_task_id if it exists — processItem will check & resume it
        const newRetryCount = currentRetryCount + 1;
        await pool.query(`
          UPDATE schedule_queue
          SET retry_count = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [newRetryCount, itemId]);

        // Calculate delay first so we can show it in the log
        const delayMs = Math.min(INITIAL_RETRY_DELAY_MS * Math.pow(1.5, Math.min(newRetryCount - 1, 10)), MAX_RETRY_DELAY_MS);
        const delaySec = Math.round(delayMs / 1000);

        // Show retry attempt with wait time
        await logActivity(userId, `⟳ Retry #${newRetryCount} in ${delaySec}s...`, 'info', itemId);
        console.log(`[processItem] Auto-retry ${newRetryCount} for item ${itemId}, waiting ${delaySec}s`);

        // Mark item as in retry delay so recovery job won't spawn a duplicate
        itemsInRetryDelay.add(itemId);

        // Check stop every 1 second during retry delay (allows immediate stop response)
        const CHECK_INTERVAL_MS = 1000;
        const totalChecks = Math.ceil(delayMs / CHECK_INTERVAL_MS);
        for (let i = 0; i < totalChecks; i++) {
          // Check stop every second
          if (stoppedRetryItems.has(itemId) || stoppedUsers.has(userId)) {
            console.log(`[processItem] ⚠️ Stop detected during retry delay (check ${i}/${totalChecks}), item=${itemId}`);
            stoppedRetryItems.delete(itemId);
            itemsInRetryDelay.delete(itemId);
            const statusCheck = await pool.query(`SELECT status FROM schedule_queue WHERE id = $1`, [itemId]);
            if (statusCheck.rows[0]?.status !== 'failed') {
              await pool.query(`UPDATE schedule_queue SET status = 'failed', error = 'Stopped by user' WHERE id = $1`, [itemId]);
              await logActivity(userId, `🛑 Stopped`, 'warning', itemId);
            }
            return { success: false, error: 'Stopped by user' };
          }
          await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
        }

        // Final check after delay — stop route already set status='failed' + logged "Stopped"
        if (stoppedRetryItems.has(itemId) || stoppedUsers.has(userId)) {
          console.log(`[processItem] ⚠️ Stop detected after retry delay, item=${itemId}`);
          stoppedRetryItems.delete(itemId);
          itemsInRetryDelay.delete(itemId);
          // เช็คว่า stop route ตั้ง failed ไปแล้วหรือยัง ถ้ายังก็ตั้งเอง
          const statusCheck = await pool.query(`SELECT status FROM schedule_queue WHERE id = $1`, [itemId]);
          if (statusCheck.rows[0]?.status !== 'failed') {
            await pool.query(`UPDATE schedule_queue SET status = 'failed', error = 'Stopped by user' WHERE id = $1`, [itemId]);
            await logActivity(userId, `🛑 Stopped`, 'warning', itemId);
          }
          return { success: false, error: 'Stopped by user' };
        }

        // Clear retry delay flag before re-entering
        itemsInRetryDelay.delete(itemId);

        // skipLock=true: item stays tracked + skips "already running" check + skips DB lock
        return processItem(userId, itemId, callbacks, undefined, undefined, undefined, true);
      }

      videoUrl = videoResult.videoUrl;
    }
    // Note: If videoUrl exists but is invalid (not http), we continue anyway and Blotato will fail

    // Check stop after video generation + Dropbox upload
    if (isStoppedForThisRun()) {
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = 'Stopped by user', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
      await logActivity(userId, '🛑 Stopped', 'warning', itemId);
      return { success: false, error: 'Stopped by user' };
    }

    // Atomic claim: only one processor advances past 'generating' to caption+post.
    // Prevents duplicate posts if multiple processItem calls race to this point.
    const claim = await pool.query(
      `UPDATE schedule_queue SET status = 'captioning', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'generating' RETURNING id`,
      [itemId]
    );
    if (claim.rowCount === 0) {
      console.log(`[processItem] Item ${itemId} already claimed by another processor — skipping caption/post to prevent duplicate`);
      callbacks?.onItemComplete?.(itemId, true);
      return { success: true };
    }

    // STEP 2: Generate Caption (skip if already has caption)
    let caption = item.caption;
    if (!caption) {
      caption = await stepGenerateCaption(userId, itemId, item);
    } else {
      await logActivity(userId, 'Skipping caption generation (already exists)', 'info', itemId);
    }

    // Check stop after caption generation (before posting — posting can't be interrupted)
    if (isStoppedForThisRun()) {
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = 'Stopped by user', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
      await logActivity(userId, '🛑 Stopped', 'warning', itemId);
      return { success: false, error: 'Stopped by user' };
    }

    // STEP 3: Post to social media
    if (generateOnly || item.generate_only) {
      await pool.query(`UPDATE schedule_queue SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [itemId]);
      await logActivity(userId, '✅ สร้างเสร็จ (ไม่โพสต์)', 'success', itemId);
      callbacks?.onItemComplete?.(itemId, true);
      return { success: true };
    }

    const postResult = await stepPostToSocial(userId, itemId, item, videoUrl, caption, callbacks);
    return postResult;
  } catch (error: any) {
    // StepError = controlled early return from step functions (already handled DB updates + logging)
    if (error instanceof StepError) {
      // VIRAL_HANDOFF = viral template handed off to viral pipeline — not an error
      if (error.message === 'VIRAL_HANDOFF') {
        callbacks?.onItemComplete?.(itemId, true);
        return { success: true };
      }
      // IDOL_HANDOFF = idol template handed off to idol pipeline — not an error
      if (error.message === 'IDOL_HANDOFF') {
        callbacks?.onItemComplete?.(itemId, true);
        return { success: true };
      }
      callbacks?.onItemComplete?.(itemId, false);
      return { success: false, error: error.message };
    }

    console.log(`[processItem] CAUGHT ERROR: ${error.message}`);
    console.log(`[processItem] Stack:`, error.stack);

    // Transient errors (DB connection, network) → reset to pending for auto-retry
    const transientErrors = ['Connection terminated', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'socket hang up', 'fetch failed'];
    const isTransient = transientErrors.some(e => error.message?.includes(e));

    if (isTransient && !stoppedRetryItems.has(itemId) && !stoppedUsers.has(userId)) {
      console.log(`[processItem] Transient error for item ${itemId}, will retry`);
      try {
        await pool.query(`UPDATE schedule_queue SET status = 'pending', error = NULL WHERE id = $1`, [itemId]);
        await logActivity(userId, `⚠️ ระบบขัดข้องชั่วคราว รอ Retry...`, 'warning', itemId);
      } catch {
        // DB might still be down, just log
        console.log(`[processItem] Cannot update DB for retry, item ${itemId} may need manual recovery`);
      }
      return { success: false, error: error.message };
    }

    try {
      await pool.query(`UPDATE schedule_queue SET status = 'failed', error = $1 WHERE id = $2`, [error.message, itemId]);
      await logActivity(userId, `❌ Error: ${error.message}`, 'error', itemId);
    } catch {
      console.log(`[processItem] Cannot write failure to DB for item ${itemId}`);
    }
    callbacks?.onItemComplete?.(itemId, false);
    return { success: false, error: error.message };
  } finally {
    // Untrack this item as running
    untrackItemRunning(userId, itemId);

    // Only clear the run ID if processItem was the one that set it (direct call, not through runQueue)
    // AND only if it's still our run ID (hasn't been replaced by another run)
    // AND no other items are still running for this user
    const userRunningItems = runningItemsPerUser.get(userId);
    const hasOtherRunning = userRunningItems && userRunningItems.size > 0;

    if (!wasRunning && myRunId && activeRunIds.get(userId) === myRunId && !hasOtherRunning) {
      activeRunIds.set(userId, null);
      console.log(`[processItem] Cleared runId: ${myRunId} (direct call cleanup, no other items running)`);
    }
  }
}

/**
 * Get next pending items
 * @param channelId - Optional: filter by specific channel
 * @param date - Optional: filter by specific date (YYYY-MM-DD)
 * @param timezone - Optional: timezone for date filtering
 */
async function getNextQueuedItems(userId: number, channelId?: number, date?: string, timezone?: string): Promise<any[]> {
  let query = 'SELECT id, platform FROM schedule_queue WHERE user_id = $1 AND status = \'queued\'';
  const params: any[] = [userId];
  let paramIndex = 2;

  if (channelId) {
    query += ` AND channel_id = $${paramIndex++}`;
    params.push(channelId);
  }

  if (date && timezone) {
    const dateList = date.split(',');
    if (dateList.length === 1) {
      query += ` AND DATE(scheduled_time AT TIME ZONE 'UTC' AT TIME ZONE $${paramIndex++}) = $${paramIndex++}`;
      params.push(timezone, date);
    } else {
      const datePlaceholders = dateList.map((_, i) => `$${paramIndex + i + 1}`).join(', ');
      query += ` AND DATE(scheduled_time AT TIME ZONE 'UTC' AT TIME ZONE $${paramIndex}) IN (${datePlaceholders})`;
      params.push(timezone, ...dateList);
      paramIndex += 1 + dateList.length;
    }
  }

  query += ' ORDER BY scheduled_time ASC';

  const result = await pool.query(query, params);
  return result.rows;
}

// Vidgo API rate limit: max 20 concurrent requests
const VIDGO_MAX_CONCURRENT = 20;
const VIDGO_WAIT_INTERVAL_MS = 10000; // Check every 10 seconds when waiting for slots

// KIE API rate limit: max 5 concurrent requests (KIE is more sensitive to parallel requests)
const KIE_MAX_CONCURRENT = 5;
const KIE_WAIT_INTERVAL_MS = 10000;
const KIE_SUBMIT_DELAY_MS = 1000; // 1 second delay between KIE submissions

/**
 * Get count of currently generating Vidgo items for a user
 */
async function getVidgoGeneratingCount(userId: number): Promise<number> {
  const result = await pool.query(`
    SELECT COUNT(*) as count FROM schedule_queue
    WHERE user_id = $1 AND platform = 'sora2-vidgo' AND status = 'generating'
  `, [userId]);
  return parseInt(result.rows[0]?.count || '0');
}

/**
 * Get count of currently generating KIE items for a user
 */
async function getKieGeneratingCount(userId: number): Promise<number> {
  const result = await pool.query(`
    SELECT COUNT(*) as count FROM schedule_queue
    WHERE user_id = $1 AND platform IN ('sora2-kie', 'sora2-grsai') AND status = 'generating'
  `, [userId]);
  return parseInt(result.rows[0]?.count || '0');
}

/**
 * Run queue processing
 * @param channelId - Optional: process only items from specific channel
 * @param date - Optional: filter by specific date (YYYY-MM-DD)
 * @param timezone - Optional: timezone for date filtering
 */
export async function runQueue(
  userId: number,
  callbacks?: ProcessCallbacks,
  channelId?: number,
  date?: string,
  timezone?: string,
  templateId?: string,
  templateMode?: string,
  generateOnly?: boolean
): Promise<{ processedCount: number; errorCount: number }> {
  console.log(`[runQueue] Starting for user ${userId}${channelId ? ` (channel ${channelId})` : ' (all channels)'}${date ? ` (date ${date})` : ''}${generateOnly ? ' (generate only)' : ''}`);

  // Check if already running
  if (runningUsers.get(userId)) {
    console.log(`[runQueue] Already running, exiting`);
    return { processedCount: 0, errorCount: 0 };
  }

  // Clear stopped flag when starting a new run (MUST be before isRunActive check)
  stoppedUsers.delete(userId);
  console.log(`[runQueue] Cleared stoppedUsers flag for user ${userId}`);

  // Generate a unique run ID for this run - prevents race conditions
  const myRunId = generateRunId();
  activeRunIds.set(userId, myRunId);
  console.log(`[runQueue] Started with runId: ${myRunId}`);
  await updateRunnerState(userId, true);

  // Find orphaned items (stuck in active status from crashed/restarted server)
  // IMPORTANT: Don't reset to 'pending' - instead auto-retry them to keep blue status
  // Only check items that:
  // 1. Have been stuck for more than 15 minutes (video gen typically takes 3-10 min)
  // 2. Do NOT have external_task_id (if they have task ID, let recovery job handle them)
  // 3. Are NOT currently being processed
  const orphanedResult = await pool.query(`
    SELECT id, error FROM schedule_queue
    WHERE user_id = $1
      AND status IN ('generating', 'captioning', 'scheduling')
      AND updated_at < NOW() - INTERVAL '15 minutes'
      AND external_task_id IS NULL
  `, [userId]);

  if (orphanedResult.rows.length > 0) {
    // Filter out items that are currently running
    const userRunning = runningItemsPerUser.get(userId);
    const actuallyOrphaned = orphanedResult.rows.filter((item: any) => !userRunning?.has(item.id));

    if (actuallyOrphaned.length > 0) {
      const ids = actuallyOrphaned.map((r: any) => r.id).join(', ');
      console.log(`[runQueue] Auto-retrying ${actuallyOrphaned.length} orphaned items: ${ids}`);

      // Auto-retry each orphaned item instead of resetting to pending
      for (const item of actuallyOrphaned) {
        // Check if user stopped this item
        if (stoppedRetryItems.has(item.id)) {
          stoppedRetryItems.delete(item.id);
          continue;
        }

        // Skip items with non-recoverable credit errors
        const _errLower = (item.error || '').toLowerCase();
        if (_errLower.includes('credit') && /insufficient|not enough|exhausted|no credit|balance|หมด/.test(_errLower)) {
          console.log(`[runQueue] Skipping orphaned item ${item.id} - non-recoverable error: ${item.error}`);
          await pool.query(`UPDATE schedule_queue SET status = 'failed' WHERE id = $1`, [item.id]);
          continue;
        }

        await logActivity(userId, `🔄 Auto-retrying orphaned item...`, 'info', item.id);
        processItem(userId, item.id).catch(err => {
          console.error(`[runQueue] Auto-retry error for item ${item.id}:`, err);
        });
      }
    }
  }

  await logActivity(userId, '🚀 Queue runner started', 'info');
  console.log(`[runQueue] Runner state set to running`);

  // Mark pending items as 'queued' to show they're waiting in queue
  // Filter by channel and/or date if specified
  let queueQuery = `
    UPDATE schedule_queue
    SET status = 'queued', updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND status = 'pending'
  `;
  const queueParams: any[] = [userId];
  let paramIdx = 2;

  if (channelId) {
    queueQuery += ` AND channel_id = $${paramIdx++}`;
    queueParams.push(channelId);
  }

  // Filter by date(s) if specified (critical fix: only queue items for the specific dates)
  if (date && timezone) {
    const dateList = date.split(',');
    if (dateList.length === 1) {
      queueQuery += ` AND DATE(scheduled_time AT TIME ZONE 'UTC' AT TIME ZONE $${paramIdx++}) = $${paramIdx++}`;
      queueParams.push(timezone, date);
    } else {
      const datePlaceholders = dateList.map((_, i) => `$${paramIdx + i + 1}`).join(', ');
      queueQuery += ` AND DATE(scheduled_time AT TIME ZONE 'UTC' AT TIME ZONE $${paramIdx}) IN (${datePlaceholders})`;
      queueParams.push(timezone, ...dateList);
      paramIdx += 1 + dateList.length;
    }
  }

  const queuedResult = await pool.query(queueQuery, queueParams);
  if (queuedResult.rowCount && queuedResult.rowCount > 0) {
    console.log(`[runQueue] Marked ${queuedResult.rowCount} items as 'queued'`);
    await logActivity(userId, `📋 ${queuedResult.rowCount} items queued for processing`, 'info');
  }

  let processedCount = 0;
  let errorCount = 0;

  try {
    // Use run ID for stable checks instead of boolean
    while (isRunActive(userId, myRunId)) {
      console.log(`[runQueue] Fetching queued items${channelId ? ` for channel ${channelId}` : ''}${date ? ` for date ${date}` : ''}...`);
      const pendingItems = await getNextQueuedItems(userId, channelId, date, timezone);
      console.log(`[runQueue] Found ${pendingItems.length} pending items`);

      if (pendingItems.length === 0) {
        await logActivity(userId, '✅ All items processed!', 'success');
        console.log(`[runQueue] No pending items, stopping`);
        break;
      }

      // Separate items by platform for different rate limiting strategies
      const vidgoItems = pendingItems.filter((item: any) => item.platform === 'sora2-vidgo');
      const kieItems = pendingItems.filter((item: any) => item.platform === 'sora2-kie' || item.platform === 'sora2-grsai');

      console.log(`[runQueue] Items breakdown: Vidgo=${vidgoItems.length}, KIE=${kieItems.length}`);

      // Process KIE items with rate limit: max 5 concurrent
      if (kieItems.length > 0) {
        console.log(`[runQueue] Processing ${kieItems.length} KIE items (max ${KIE_MAX_CONCURRENT} concurrent)...`);
        await logActivity(userId, `📦 KIE: ${kieItems.length} items (max ${KIE_MAX_CONCURRENT} concurrent)`, 'info');

        for (const item of kieItems) {
          if (!isRunActive(userId, myRunId)) break;

          // Wait for available slots
          let currentGenerating = await getKieGeneratingCount(userId);
          while (currentGenerating >= KIE_MAX_CONCURRENT && isRunActive(userId, myRunId)) {
            console.log(`[runQueue] KIE limit reached (${currentGenerating}/${KIE_MAX_CONCURRENT}), waiting...`);
            await logActivity(userId, `⏳ KIE: Waiting for slots (${currentGenerating}/${KIE_MAX_CONCURRENT} generating)...`, 'info');
            await new Promise(resolve => setTimeout(resolve, KIE_WAIT_INTERVAL_MS));
            currentGenerating = await getKieGeneratingCount(userId);
          }

          if (!isRunActive(userId, myRunId)) break;

          console.log(`[runQueue] Processing KIE item ${item.id} (${currentGenerating + 1}/${KIE_MAX_CONCURRENT} slots used)...`);
          await updateRunnerState(userId, true, item.id);

          // เปลี่ยน status ก่อน fire-and-forget เพื่อกัน while loop ดึง item เดิมซ้ำ
          await pool.query(`UPDATE schedule_queue SET status = 'generating', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'queued'`, [item.id]);

          // Fire-and-forget (like Vidgo) — don't await so we can submit next item
          processItem(userId, item.id, callbacks, templateId, templateMode, generateOnly, true)
            .then(result => {
              if (result.success) processedCount++;
              else errorCount++;
            })
            .catch(err => {
              console.error(`[runQueue] KIE item ${item.id} error:`, err);
              errorCount++;
            });

          // Delay between submissions to avoid hammering KIE API
          await new Promise(resolve => setTimeout(resolve, KIE_SUBMIT_DELAY_MS));
        }
      }

      // Process Vidgo items with rate limit: max 20 concurrent generating
      if (vidgoItems.length > 0) {
        console.log(`[runQueue] Processing ${vidgoItems.length} Vidgo items (max ${VIDGO_MAX_CONCURRENT} concurrent)...`);
        await logActivity(userId, `📦 Vidgo: ${vidgoItems.length} items (max ${VIDGO_MAX_CONCURRENT} concurrent)`, 'info');

        let processedVidgoItems = 0;

        for (const item of vidgoItems) {
          if (!isRunActive(userId, myRunId)) break;

          // Check current generating count before sending new item
          let currentGenerating = await getVidgoGeneratingCount(userId);

          // Wait if we've hit the limit
          while (currentGenerating >= VIDGO_MAX_CONCURRENT && isRunActive(userId, myRunId)) {
            console.log(`[runQueue] Vidgo limit reached (${currentGenerating}/${VIDGO_MAX_CONCURRENT}), waiting ${VIDGO_WAIT_INTERVAL_MS / 1000}s...`);
            await logActivity(userId, `⏳ Vidgo: Waiting for slots (${currentGenerating}/${VIDGO_MAX_CONCURRENT} generating)...`, 'info');
            await new Promise(resolve => setTimeout(resolve, VIDGO_WAIT_INTERVAL_MS));
            currentGenerating = await getVidgoGeneratingCount(userId);
          }

          if (!isRunActive(userId, myRunId)) break;

          // Process this item (it will set status to 'generating')
          console.log(`[runQueue] Processing Vidgo item ${item.id} (${currentGenerating + 1}/${VIDGO_MAX_CONCURRENT} slots used)...`);
          await updateRunnerState(userId, true, item.id);

          // Don't pre-set status to 'generating' here — processItem handles it via DB-level lock
          // (Setting it here caused processItem's lock to fail, leaving items stuck in 'generating')

          // Don't await - let it run in background so we can start more items
          processItem(userId, item.id, callbacks, templateId, templateMode, generateOnly).then(result => {
            if (result.success) processedCount++;
            else errorCount++;
            console.log(`[runQueue] Vidgo item ${item.id} result: ${result.success ? 'success' : 'failed'}`);
          }).catch(err => {
            errorCount++;
            console.error(`[runQueue] Vidgo item ${item.id} error:`, err);
          });

          processedVidgoItems++;

          // Small delay between submissions to avoid burst
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Don't wait for Vidgo items to finish — they run in background (fire-and-forget)
        // The concurrent limit check at the top of the for-loop handles rate limiting
        console.log(`[runQueue] Submitted ${processedVidgoItems} Vidgo items (running in background)`);
      }

      // Small delay between main loops
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error(`[runQueue] Error:`, error);
    await logActivity(userId, `❌ Runner error: ${error}`, 'error');
  } finally {
    // Only clear the run ID if it's still ours (prevents clearing another run's ID)
    if (activeRunIds.get(userId) === myRunId) {
      activeRunIds.set(userId, null);
      console.log(`[runQueue] Cleared runId: ${myRunId}`);
    } else {
      console.log(`[runQueue] RunId changed (was ${myRunId}, now ${activeRunIds.get(userId)}), not clearing`);
    }
    await updateRunnerState(userId, false);
    await logActivity(userId, `🏁 Runner stopped. Processed: ${processedCount}, Errors: ${errorCount}`, 'info');
    console.log(`[runQueue] Runner stopped. Processed: ${processedCount}, Errors: ${errorCount}`);
  }

  return { processedCount, errorCount };
}

/**
 * Stop queue processing
 */
export async function stopQueue(userId: number): Promise<void> {
  // Mark user as stopped - this is the source of truth for isRunActive checks
  stoppedUsers.add(userId);
  // Also clear the run ID for legacy compatibility
  activeRunIds.set(userId, null);
  await logActivity(userId, '🛑 Stop requested — waiting for active items to finish...', 'warning');
  console.log(`[stopQueue] User ${userId} requested stop, added to stoppedUsers`);
}

/**
 * Check if queue is running for user
 */
export function isRunning(userId: number): boolean {
  return runningUsers.get(userId) || false;
}

/**
 * Reset runner loop state so a new runQueue can start
 * Does NOT stop currently running background processItem tasks
 */
export function resetRunnerLoop(userId: number): void {
  activeRunIds.set(userId, null);
  console.log(`[resetRunnerLoop] Cleared activeRunIds for user ${userId} (background tasks still running)`);
}

/**
 * Stop retrying a specific item (per-item stop)
 */
export function stopItemRetry(itemId: number): void {
  stoppedRetryItems.add(itemId);
  console.log(`[stopItemRetry] Item ${itemId} marked to stop retrying`);
}

/**
 * Clear stopped flag for an item (called after item is marked as failed)
 */
export function clearStoppedItem(itemId: number): void {
  stoppedRetryItems.delete(itemId);
}

/**
 * Generate prompt using AI (inspired by random example) - For bulk operations
 * This is exported for use by the bulk-generate endpoint
 */
export async function generateAIPromptForBulk(
  userId: number,
  channel: any,
  examplePrompt: any
): Promise<{ success: boolean; prompt?: string; error?: string }> {
  return generateAIPrompt(userId, channel, examplePrompt);
}

/**
 * Generate prompt using AI (inspired by random example)
 */
async function generateAIPrompt(
  userId: number,
  channel: any,
  examplePrompt: any
): Promise<{ success: boolean; prompt?: string; error?: string }> {
  // Get user's AI config
  const userAiResult = await pool.query(
    'SELECT openai_api_key, openrouter_api_key, ai_provider FROM users WHERE id = $1',
    [userId]
  );
  const userAi = userAiResult.rows[0];
  let aiApiKey = '';
  let aiBaseUrl = 'https://api.openai.com/v1';
  if (userAi?.ai_provider === 'openrouter' && userAi?.openrouter_api_key) {
    aiApiKey = userAi.openrouter_api_key;
    aiBaseUrl = 'https://openrouter.ai/api/v1';
  } else if (userAi?.openai_api_key) {
    aiApiKey = userAi.openai_api_key;
  } else {
    // Fallback to global api_keys table
    const apiKeyResult = await pool.query(`SELECT key_value FROM api_keys WHERE key_name = 'openai_api_key'`);
    aiApiKey = apiKeyResult.rows[0]?.key_value;
  }

  if (!aiApiKey) {
    return { success: false, error: 'AI API key not configured' };
  }

  // Deduct credits
  const tempReferenceId = `queue_auto_prompt_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const deductResult = await deductCredits(
    userId,
    AI_PROMPT_CREDIT_COST,
    'queue_auto_prompt_generation',
    tempReferenceId,
    'AI Auto Prompt Generation for Queue (GPT-4o)'
  );

  if (!deductResult.success) {
    return { success: false, error: `Insufficient credits: ${deductResult.error}` };
  }

  console.log(`💰 Deducted ${AI_PROMPT_CREDIT_COST} credits for queue AI prompt (User ${userId})`);

  try {
    const userPromptForAI = examplePrompt
      ? `Based on this example prompt, create a NEW prompt that closely follows the style of the example:
1. Use the SAME writing style, sentence structure, and format
2. Keep the same tone, pacing, and level of detail
3. Use a DIFFERENT subject, location, or scenario
4. You MAY reuse key phrases and stylistic patterns from the example
5. The result should feel like it belongs to the same series

EXAMPLE PROMPT:
${examplePrompt.prompt_text}

Generate a new prompt that closely matches the style and quality of the example above.

IMPORTANT: Output ONLY the new prompt, no explanations or additional text.`
      : `Generate a creative prompt based on the system instructions above.

IMPORTANT: Output ONLY the prompt, no explanations or additional text.`;

    const apiResponse = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: channel.system_prompt },
          { role: 'user', content: userPromptForAI }
        ],
        max_tokens: 2000,
        temperature: channel.prompt_temperature ?? 0.5,
      }),
    });

    if (!apiResponse.ok) {
      const errorData: any = await apiResponse.json().catch(() => ({}));
      console.error('AI API Error Response:', errorData);

      // Auto-refund on API error
      const alreadyRefunded = await hasBeenRefunded('queue_auto_prompt_generation', tempReferenceId);
      if (!alreadyRefunded) {
        await refundCredits(
          userId,
          AI_PROMPT_CREDIT_COST,
          'queue_auto_prompt_generation',
          tempReferenceId,
          `Auto-refund: AI API failed`
        );
        console.log(`✅ Refunded ${AI_PROMPT_CREDIT_COST} credits to user ${userId}`);
      }

      return { success: false, error: `AI API error: ${errorData.error?.message || apiResponse.status}` };
    }

    const data: any = await apiResponse.json();
    const generatedPrompt = data.choices[0]?.message?.content || '';

    // Update usage count for the example (only if an example was used)
    if (examplePrompt) {
      await pool.query(
        `UPDATE channel_example_prompts SET times_used = times_used + 1 WHERE id = $1`,
        [examplePrompt.id]
      );
    }

    return { success: true, prompt: generatedPrompt };

  } catch (openaiError: any) {
    console.error('OpenAI API call failed:', openaiError);

    // Auto-refund on exception
    const alreadyRefunded = await hasBeenRefunded('queue_auto_prompt_generation', tempReferenceId);
    if (!alreadyRefunded) {
      await refundCredits(
        userId,
        AI_PROMPT_CREDIT_COST,
        'queue_auto_prompt_generation',
        tempReferenceId,
        `Auto-refund: OpenAI exception - ${openaiError.message}`
      );
      console.log(`✅ Refunded ${AI_PROMPT_CREDIT_COST} credits to user ${userId}`);
    }

    return { success: false, error: openaiError.message };
  }
}

/**
 * Generate queue items for a date range
 */
export async function generateQueueForDate(
  userId: number,
  targetDate: string // YYYY-MM-DD
): Promise<{ created: number; logs: string[] }> {
  const logs: string[] = [];
  let created = 0;

  // Get all channels for user
  const channelsResult = await pool.query(`
    SELECT * FROM scheduler_channels WHERE user_id = $1
  `, [userId]);

  for (const channel of channelsResult.rows) {
    const postsPerDay = channel.posts_per_day || 3;
    let variables = channel.variables || [];
    const templates = channel.prompt_templates || [];
    let templateRRIndex = channel.template_round_robin_index || 0;

    // Check if channel uses new AI prompt system
    const hasAISystem = channel.system_prompt;

    // Get example prompts for AI system
    let examplePrompts: any[] = [];
    if (hasAISystem) {
      const examplesResult = await pool.query(`
        SELECT * FROM channel_example_prompts
        WHERE channel_id = $1
        ORDER BY times_used ASC, RANDOM()
      `, [channel.id]);
      examplePrompts = examplesResult.rows;
    }

    const useAIPrompt = hasAISystem && examplePrompts.length > 0;

    // Generate time slots based on posts_per_day
    const defaultTimeSlots = ['09:00', '12:00', '15:00', '18:00', '21:00'];
    const timeSlots = defaultTimeSlots.slice(0, postsPerDay);

    for (const timeSlot of timeSlots) {
      const scheduledTime = `${targetDate}T${timeSlot}:00`;

      // Check if already exists
      const existsResult = await pool.query(`
        SELECT id FROM schedule_queue
        WHERE channel_id = $1 AND scheduled_time = $2
      `, [channel.id, scheduledTime]);

      if (existsResult.rows.length > 0) {
        logs.push(`Skip: ${channel.name} at ${timeSlot} (already exists)`);
        continue;
      }

      let prompt = '';
      const variableValues: Record<string, string> = {};

      if (useAIPrompt) {
        // NEW AI SYSTEM: Generate prompt using AI
        // Select a random example (preferring less used ones)
        const randomExample = examplePrompts[Math.floor(Math.random() * Math.min(examplePrompts.length, 3))];

        const aiResult = await generateAIPrompt(userId, channel, randomExample);

        if (!aiResult.success || !aiResult.prompt) {
          logs.push(`Skip: ${channel.name} at ${timeSlot} (AI error: ${aiResult.error})`);
          continue;
        }

        prompt = aiResult.prompt;
        logs.push(`AI Generated: ${channel.name} at ${timeSlot} (${AI_PROMPT_CREDIT_COST} credits)`);

      } else if ((templates.length > 0) || (channel.prompt_template && variables.length > 0)) {
        // Variable system: multi-template or legacy single template
        let activeVars: any[];
        let activePrompt: string;
        let isMultiTemplate = false;

        if (templates.length > 0) {
          const mode = channel.template_selection_mode || 'round-robin';
          let tIdx: number;
          if (mode === 'random') {
            tIdx = Math.floor(Math.random() * templates.length);
          } else {
            tIdx = templateRRIndex % templates.length;
            templateRRIndex++;
          }
          activeVars = templates[tIdx].variables || [];
          activePrompt = templates[tIdx].prompt_template;
          isMultiTemplate = true;
        } else {
          activeVars = variables;
          activePrompt = channel.prompt_template;
        }

        let hasAllVariables = true;

        for (const variable of activeVars) {
          const allValues = variable.values || [];
          if (allValues.length > 0) {
            let unusedValues = allValues.filter((v: any) => v.status === 'new' || !v.status);
            if (unusedValues.length === 0) {
              for (const v of allValues) { v.status = 'new'; }
              unusedValues = allValues;
            }
            const picked = unusedValues[unusedValues.length - 1];
            const pickedIdx = allValues.findIndex((v: any) => v.id === picked.id);
            if (pickedIdx !== -1) { allValues[pickedIdx].status = 'used'; }
            variableValues[variable.name] = picked.value;
          } else {
            hasAllVariables = false;
            logs.push(`Skip: ${channel.name} at ${timeSlot} (no values for ${variable.name})`);
            break;
          }
        }

        if (!hasAllVariables) continue;

        prompt = activePrompt;
        for (const [varName, value] of Object.entries(variableValues)) {
          prompt = prompt.replace(new RegExp(`\\{${varName}\\}`, 'g'), value);
          prompt = prompt.replace(new RegExp(`\\[${varName}\\]`, 'g'), value);
        }

        if (isMultiTemplate) {
          await pool.query(`
            UPDATE scheduler_channels SET prompt_templates = $1, template_round_robin_index = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
          `, [JSON.stringify(templates), templateRRIndex, channel.id]);
        } else {
          await pool.query(`
            UPDATE scheduler_channels SET variables = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `, [JSON.stringify(variables), channel.id]);
        }

      } else if (channel.prompt_template) {
        // Simple prompt template without variables
        prompt = channel.prompt_template;

      } else {
        // No prompt system configured
        logs.push(`Skip: ${channel.name} at ${timeSlot} (no prompt system configured)`);
        continue;
      }

      // Create queue item
      await pool.query(`
        INSERT INTO schedule_queue (
          user_id, channel_id, scheduled_time, prompt, variable_values,
          platform, duration, aspect_ratio, status, ai_model
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
      `, [
        userId,
        channel.id,
        scheduledTime,
        prompt,
        JSON.stringify(variableValues),
        channel.platform,
        channel.duration,
        channel.aspect_ratio,
        channel.ai_model,
      ]);

      created++;
      if (!useAIPrompt) {
        logs.push(`Created: ${channel.name} at ${timeSlot}`);
      }
    }
  }

  return { created, logs };
}

/**
 * Check Vidgo task status and return video URL if completed
 */
async function checkVidgoTaskStatus(taskId: string, apiKey: string): Promise<{
  status: 'running' | 'finished' | 'failed' | 'unknown';
  videoUrl?: string;
  progress?: number;
  error?: string;
}> {
  try {
    const response = await fetch(`https://api.vidgo.ai/api/generate/status/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return { status: 'unknown', error: `HTTP ${response.status}` };
    }

    const data: any = await response.json();
    const resultData = data.data || data;
    const status = resultData.status;
    const progress = resultData.progress || 0;

    // Check for completion
    const videoUrl = resultData.files?.[0]?.file_url || resultData.video_url || resultData.videoUrl;

    if ((status === 'finished' || status === 'succeeded' || status === 'completed') && videoUrl) {
      return { status: 'finished', videoUrl, progress: 100 };
    }

    if (status === 'failed' || status === 'error') {
      return { status: 'failed', error: resultData.error || resultData.message || 'Task failed', progress };
    }

    return { status: 'running', progress };
  } catch (error: any) {
    return { status: 'unknown', error: error.message };
  }
}

/**
 * Check KIE task status and return video URL if completed
 */
async function checkKieTaskStatus(taskId: string, apiKey: string): Promise<{
  status: 'running' | 'finished' | 'failed' | 'unknown';
  videoUrl?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return { status: 'unknown', error: `HTTP ${response.status}` };
    }

    const raw: any = await response.json();
    const data = raw.data || raw;

    if (data.state === 'success') {
      let videoUrl: string | null = null;
      if (data.resultJson) {
        try {
          const resultData = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
          videoUrl = resultData.resultUrls?.[0] || resultData.url || resultData.video_url || null;
        } catch {}
      }
      if (!videoUrl) {
        videoUrl = data.resultUrl || data.videoUrl || data.url || data.video_url || null;
      }
      return videoUrl ? { status: 'finished', videoUrl } : { status: 'failed', error: 'State=success but no video URL' };
    }

    if (data.state === 'fail') {
      return { status: 'failed', error: data.failMsg || 'KIE task failed' };
    }

    return { status: 'running' };
  } catch (error: any) {
    return { status: 'unknown', error: error.message };
  }
}

/**
 * Recovery job for stuck Vidgo tasks
 * Finds items stuck in 'generating' status with external_task_id and tries to complete them
 */
async function recoverStuckVidgoTasks(): Promise<{ recovered: number; failed: number; checked: number }> {
  console.log('🔄 [VidgoRecovery] Checking for stuck Vidgo tasks...');

  try {
    // First, find items that are stuck in 'generating' WITHOUT external_task_id
    // These were interrupted before task creation - AUTO-RETRY them
    // No time-based timeout — we check runningItemsPerUser to skip active items
    const stuckNoTaskId = await pool.query(`
      SELECT q.id, q.user_id, q.error, COALESCE(q.ai_model, c.ai_model) as ai_model
      FROM schedule_queue q
      LEFT JOIN scheduler_channels c ON c.id = q.channel_id
      WHERE q.status = 'generating'
        AND q.external_task_id IS NULL
        AND COALESCE(q.ai_model, c.ai_model) != 'kie_viral_template'
    `);

    if (stuckNoTaskId.rows.length > 0) {
      // Check if any of these items are currently being processed
      const actuallyStuck = stuckNoTaskId.rows.filter((item: any) => {
        const userRunning = runningItemsPerUser.get(item.user_id);
        const isRunning = userRunning?.has(item.id);
        if (isRunning) {
          console.log(`🔄 [VidgoRecovery] Item ${item.id} is still running, skipping`);
        }
        return !isRunning;
      });

      if (actuallyStuck.length > 0) {
        console.log(`🔄 [VidgoRecovery] Auto-retrying ${actuallyStuck.length} stuck items without task ID`);
        for (const item of actuallyStuck) {
          // Re-check DB status — normal flow may have completed since the query
          const freshStatus = await pool.query('SELECT status FROM schedule_queue WHERE id = $1', [item.id]);
          if (freshStatus.rows[0]?.status !== 'generating') {
            console.log(`🔄 [Recovery] Item ${item.id} status changed to '${freshStatus.rows[0]?.status}' — skipping`);
            continue;
          }

          // Check if user stopped this item
          if (stoppedRetryItems.has(item.id)) {
            console.log(`[VidgoRecovery] ⚠️ STATUS->PENDING (reason: stoppedRetryItems=true, no task ID) item=${item.id}`);
            await pool.query(`UPDATE schedule_queue SET status = 'pending' WHERE id = $1`, [item.id]);
            await logActivity(item.user_id, `⏹️ Stopped by user`, 'warning', item.id);
            stoppedRetryItems.delete(item.id);
            continue;
          }

          // Skip items with non-recoverable credit errors
          const _vErrLower = (item.error || '').toLowerCase();
          if (_vErrLower.includes('credit') && /insufficient|not enough|exhausted|no credit|balance|หมด/.test(_vErrLower)) {
            console.log(`[VidgoRecovery] ⚠️ Skipping item ${item.id} - non-recoverable error: ${item.error}`);
            await pool.query(`UPDATE schedule_queue SET status = 'failed' WHERE id = $1`, [item.id]);
            continue;
          }

          // Check if auto-retry is already handling this item
          const retryCheck = await pool.query('SELECT retry_count, updated_at FROM schedule_queue WHERE id = $1', [item.id]);
          const timeSinceUpdate = Date.now() - new Date(retryCheck.rows[0]?.updated_at).getTime();
          if (retryCheck.rows[0]?.retry_count > 0 && timeSinceUpdate < 120000) {
            console.log(`🔄 [Recovery] Item ${item.id} was retried ${Math.round(timeSinceUpdate / 1000)}s ago, skipping`);
            continue;
          }

          // Skip viral template items — they run their own pipeline and take longer
          if (item.ai_model === 'kie_viral_template') {
            console.log(`🔄 [Recovery] Item ${item.id} is Viral Template — skipping (pipeline handles its own retry)`);
            continue;
          }

          // Reset status to 'pending' first so processItem's DB lock can acquire it
          await pool.query(`UPDATE schedule_queue SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [item.id]);
          await logActivity(item.user_id, `🔄 Recovery: Auto-retrying...`, 'info', item.id);
          processItem(item.user_id, item.id).catch(err => {
            console.error(`❌ [Recovery] Auto-retry for item ${item.id} failed:`, err);
          });
          // Small delay between retries to avoid connection pool exhaustion
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    // Find items stuck in 'generating' with external_task_id (KIE & Vidgo)
    // No time-based timeout — we check runningItemsPerUser to skip active polling
    const stuckItems = await pool.query(`
      SELECT q.*, c.blotato_account_id, c.blotato_api_key, c.page_ids,
             c.posting_service, u.late_api_key, c.late_profile_id, c.late_accounts, c.postforme_api_key as channel_postforme_key_name, u.postforme_api_key, u.postforme_api_keys, c.postforme_accounts, c.timezone,
             u.vidgo_api_key, u.kie_api_key
      FROM schedule_queue q
      JOIN scheduler_channels c ON q.channel_id = c.id
      JOIN users u ON q.user_id = u.id
      WHERE q.status = 'generating'
        AND q.external_task_id IS NOT NULL
        AND q.platform IN ('sora2-vidgo', 'sora2-kie')
    `);

    if (stuckItems.rows.length === 0) {
      console.log('✅ [VidgoRecovery] No stuck tasks found');
      return { recovered: 0, failed: 0, checked: 0 };
    }

    console.log(`📋 [VidgoRecovery] Found ${stuckItems.rows.length} stuck items`);

    let recovered = 0;
    let failed = 0;

    // Filter out items that are still being actively polled
    const actuallyStuckItems = stuckItems.rows.filter((item: any) => {
      const userRunning = runningItemsPerUser.get(item.user_id);
      const isRunning = userRunning?.has(item.id);
      if (isRunning) {
        console.log(`🔄 [Recovery] Item ${item.id} is still being polled, skipping`);
      }
      return !isRunning;
    });

    if (actuallyStuckItems.length === 0) {
      console.log('✅ [Recovery] All items are still being actively polled');
      return { recovered: 0, failed: 0, checked: 0 };
    }

    for (const item of actuallyStuckItems) {
      const { id, user_id, external_task_id, vidgo_api_key, kie_api_key, platform } = item;
      const isKie = platform === 'sora2-kie';
      const apiKey = isKie ? kie_api_key : vidgo_api_key;
      const platformName = isKie ? 'KIE' : 'Vidgo';

      // Re-check DB status before processing — the normal flow may have completed
      // between the initial query and now (race condition prevention)
      const freshStatus = await pool.query('SELECT status FROM schedule_queue WHERE id = $1', [id]);
      if (freshStatus.rows[0]?.status !== 'generating') {
        console.log(`🔄 [Recovery] Item ${id} status changed to '${freshStatus.rows[0]?.status}' — skipping`);
        continue;
      }

      if (!apiKey) {
        console.log(`⚠️ [Recovery] Item ${id} has no ${platformName} API key configured`);
        continue;
      }

      console.log(`🔍 [Recovery] Checking ${platformName} item ${id}, task: ${external_task_id}`);

      // Strip phase prefix (phase1: or phase2:) from extend model task IDs
      const cleanTaskId = external_task_id.startsWith('phase1:') || external_task_id.startsWith('phase2:')
        ? external_task_id.split(':')[1]
        : external_task_id;

      const result = isKie
        ? await checkKieTaskStatus(cleanTaskId, apiKey)
        : await checkVidgoTaskStatus(external_task_id, apiKey);

      if (result.status === 'finished' && result.videoUrl) {
        // Re-check DB status AFTER API call — the normal flow may have completed
        // while we were waiting for the external API response (race condition prevention)
        const postApiStatus = await pool.query('SELECT status FROM schedule_queue WHERE id = $1', [id]);
        if (postApiStatus.rows[0]?.status !== 'generating') {
          console.log(`🔄 [Recovery] Item ${id} status changed to '${postApiStatus.rows[0]?.status}' after API check — skipping`);
          continue;
        }

        // If this is Phase 1 of an extend model, Phase 2 still needs to run
        if (external_task_id.startsWith('phase1:')) {
          console.log(`🔄 [Recovery] Item ${id} Phase 1 finished. Saving phase1_task_id for Phase 2...`);
          // Guard: only advance if external_task_id is STILL phase1: — if normal flow already
          // moved to phase2:, don't overwrite (prevents duplicate Phase 2 task creation)
          const phaseUpdate = await pool.query(`
            UPDATE schedule_queue
            SET phase1_task_id = $1, external_task_id = NULL, status = 'pending', updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND status = 'generating' AND external_task_id LIKE 'phase1:%'
            RETURNING id
          `, [cleanTaskId, id]);
          if (phaseUpdate.rowCount === 0) {
            console.log(`🔄 [Recovery] Item ${id} already advanced past Phase 1 — skipping to prevent duplicate`);
            continue;
          }
          await logActivity(user_id, `🔄 Recovery: Phase 1 done, proceeding to Phase 2...`, 'info', id);
          try {
            await processItem(user_id, id, {
              onProgress: async (msg) => console.log(`[Recovery ${id}] ${msg}`),
            });
            recovered++;
          } catch (err: any) {
            console.error(`❌ [Recovery] Failed to re-run extend for item ${id}:`, err);
            failed++;
          }
          continue;
        }

        console.log(`✅ [Recovery] Item ${id} completed! Video: ${result.videoUrl}`);

        await logActivity(user_id, `🔄 Recovery: Video found from ${platformName}!`, 'success', id);

        if (item.posting_service === 'none') {
          // No posting needed - mark as done directly (only if still generating)
          const doneUpdate = await pool.query(`
            UPDATE schedule_queue
            SET video_url = $1, status = 'done', updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND status = 'generating'
            RETURNING id
          `, [result.videoUrl, id]);
          if (doneUpdate.rowCount === 0) {
            console.log(`🔄 [Recovery] Item ${id} status changed before done update — skipping`);
            continue;
          }
          await syncVideoUrlWithDropbox(id);
          console.log(`✅ [VidgoRecovery] Item ${id} marked as done (posting_service=none)`);
          recovered++;
        } else {
          // Reset to 'pending' so processItem's DB lock can acquire it (only if still generating)
          const pendingUpdate = await pool.query(`
            UPDATE schedule_queue
            SET video_url = $1, status = 'pending', updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND status = 'generating'
            RETURNING id
          `, [result.videoUrl, id]);
          if (pendingUpdate.rowCount === 0) {
            console.log(`🔄 [Recovery] Item ${id} status changed before pending update — skipping`);
            continue;
          }
          await syncVideoUrlWithDropbox(id);

          try {
            await processItem(user_id, id, {
              onProgress: async (msg) => console.log(`[Recovery ${id}] ${msg}`),
            });
            recovered++;
          } catch (err: any) {
            console.error(`❌ [Recovery] Failed to complete item ${id}:`, err);
            await logActivity(user_id, `🔄 Recovery failed: ${err.message}`, 'error', id);
            failed++;
          }
        }
      } else if (result.status === 'failed') {
        // Task failed on Vidgo/KIE — check if auto-retry is already handling this item
        const userRunning = runningItemsPerUser.get(user_id);
        if (userRunning?.has(id) || itemsInRetryDelay.has(id)) {
          console.log(`🔄 [Recovery] Item ${id} is being handled by auto-retry (running=${userRunning?.has(id)}, inDelay=${itemsInRetryDelay.has(id)}), skipping`);
          continue;
        }
        // Also check if item has recent retry_count (auto-retry may be in delay phase)
        const retryCheck = await pool.query('SELECT retry_count, updated_at FROM schedule_queue WHERE id = $1', [id]);
        const timeSinceUpdate = Date.now() - new Date(retryCheck.rows[0]?.updated_at).getTime();
        if (retryCheck.rows[0]?.retry_count > 0 && timeSinceUpdate < 120000) {
          // Item was retried recently (< 2 min ago) — auto-retry is likely handling it
          console.log(`🔄 [Recovery] Item ${id} was retried ${Math.round(timeSinceUpdate / 1000)}s ago (retry #${retryCheck.rows[0].retry_count}), skipping`);
          continue;
        }

        console.log(`❌ [VidgoRecovery] Item ${id} failed: ${result.error}`);
        await pool.query(`
          UPDATE schedule_queue
          SET status = 'pending', error = NULL, external_task_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [id]);
        await logActivity(user_id, `❌ ${platformName} task failed: ${result.error} — auto-retrying...`, 'error', id);
        processItem(user_id, id).catch(err => {
          console.error(`❌ [Recovery] Auto-retry for item ${id} failed:`, err);
        });
        failed++;
      } else if (result.status === 'running') {
        // Still running — just log progress, don't create new tasks
        console.log(`[Recovery] Item ${id} still running on ${platformName} — waiting`);
        // Update timestamp so we know it's still alive
        await pool.query(`UPDATE schedule_queue SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
      } else {
        console.log(`❓ [Recovery] Item ${id} unknown status: ${result.error}`);
      }
    }

    // === Recover items stuck in 'queued' for >5 min (no runner picking them up) ===
    const stuckQueued = await pool.query(`
      SELECT id, user_id
      FROM schedule_queue
      WHERE status = 'queued'
        AND updated_at < NOW() - INTERVAL '5 minutes'
    `);

    if (stuckQueued.rows.length > 0) {
      console.log(`🔄 [Recovery] Found ${stuckQueued.rows.length} items stuck in 'queued' >5min`);
      const userIdsToRestart = new Set<number>();

      for (const item of stuckQueued.rows) {
        const upd = await pool.query(
          `UPDATE schedule_queue
           SET status = 'pending', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND status = 'queued'`,
          [item.id]
        );
        if (upd.rowCount && upd.rowCount > 0) {
          await logActivity(item.user_id, `🔄 Recovery: queued ค้างนาน — reset เป็น pending`, 'info', item.id);
          userIdsToRestart.add(item.user_id);
        }
      }

      for (const uid of userIdsToRestart) {
        console.log(`🔄 [Recovery] Restarting runner for user ${uid}`);
        runQueue(uid).catch(err => console.error(`[Recovery] runQueue restart user=${uid} failed:`, err));
      }
    }

    console.log(`🔄 [VidgoRecovery] Done. Recovered: ${recovered}, Failed: ${failed}`);
    return { recovered, failed, checked: stuckItems.rows.length };
  } catch (error) {
    console.error('❌ [VidgoRecovery] Error:', error);
    return { recovered: 0, failed: 0, checked: 0 };
  }
}

// NOTE: Viral runner ย้ายไปที่ server/src/jobs/viralRunnerJob.ts แล้ว — เพื่อไม่ให้รันซ้อนกัน

export default {
  processItem,
  runQueue,
  stopQueue,
  isRunning,
  generateQueueForDate,
  logActivity,
  getActivityLogs,
  clearActivityLogs,
  getRunnerState,
  updateRunnerState,
  recoverStuckVidgoTasks,
  checkVidgoTaskStatus,
  checkKieTaskStatus,
  resetRunnerLoop,
};
