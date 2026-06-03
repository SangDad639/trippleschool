/**
 * Prompt Direct Pipeline — ตาม Viral Template pattern
 * Single video generation per task. No auto-retry. Fail → stop.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import pool from '../db.js';
import { uploadVideoToDropbox, uploadLocalFileToDropbox, isDropboxConfigured } from '../utils/dropbox.js';
import { applyWatermark, type WatermarkSettings } from '../utils/watermark.js';

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 360; // 30 minutes
const MAX_CONSECUTIVE_ERRORS = 10;

// Platform → API mapping
const PLATFORM_MAP: Record<string, { platform: string; ai_model: string | null; duration: string }> = {
  'kie-grok-10s':        { platform: 'sora2-kie',   ai_model: 'kie_grok_imagine', duration: '10' },
  'kie-grok-10s-extend': { platform: 'sora2-kie',   ai_model: 'kie_grok_extend',  duration: '10' },
  'kie_grok_imagine':    { platform: 'sora2-kie',   ai_model: 'kie_grok_imagine', duration: '10' },
  'grok_imagine':        { platform: 'sora2-vidgo', ai_model: 'grok_imagine',     duration: '6' },
  'sora2':               { platform: 'sora2-kie',   ai_model: 'kie_sora2',        duration: '15' },
  'sora2-vidgo':         { platform: 'sora2-vidgo', ai_model: 'sora2_15s',        duration: '15' },
  'sora2-kie':           { platform: 'sora2-kie',   ai_model: 'kie_sora2',        duration: '15' },
  'sora2-grsai':         { platform: 'sora2-grsai', ai_model: null,               duration: '10' },
};

async function appendLog(taskId: number, emoji: string, message: string) {
  await pool.query(
    `UPDATE prompt_direct_tasks SET logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [JSON.stringify([{ emoji, message, time: new Date().toISOString() }]), taskId]
  );
}

async function updateTaskStatus(taskId: number, updates: Record<string, any>) {
  const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: any[] = [];
  let idx = 1;
  for (const [key, val] of Object.entries(updates)) {
    setClauses.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }
  values.push(taskId);
  await pool.query(
    `UPDATE prompt_direct_tasks SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values
  );
}

// Load watermark settings from channel — returns null if no channel or watermark disabled
async function getChannelWatermark(channelId: number | null | undefined): Promise<WatermarkSettings | null> {
  if (!channelId) return null;
  try {
    const r = await pool.query(`
      SELECT watermark_enabled, watermark_type, watermark_text, watermark_image_url,
             watermark_position, watermark_opacity, watermark_image_size, watermark_circular
      FROM scheduler_channels WHERE id = $1
    `, [channelId]);
    const wm = r.rows[0];
    if (!wm?.watermark_enabled) return null;
    return {
      enabled: true,
      type: wm.watermark_type || 'text',
      text: wm.watermark_text || '',
      imageUrl: wm.watermark_image_url || undefined,
      position: wm.watermark_position || 'bottom-right',
      opacity: wm.watermark_opacity ?? 50,
      imageSize: wm.watermark_image_size || 'medium',
      circular: !!wm.watermark_circular,
    };
  } catch {
    return null;
  }
}

async function getUserApiKey(userId: number, keyType: string): Promise<string | null> {
  const col = keyType === 'kie' ? 'kie_api_key' : keyType === 'vidgo' ? 'vidgo_api_key' : 'piapi_api_key';
  const r = await pool.query(`SELECT ${col} as api_key FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.api_key || null;
}

// KIE: Create task + poll until done
async function kieGenerateVideo(
  apiKey: string,
  model: string,
  input: Record<string, any>,
  taskId: number
): Promise<{ success: boolean; videoUrl?: string; error?: string }> {
  // Create task
  await appendLog(taskId, '📤', `กำลังส่ง prompt ไป KIE (${model})...`);

  const createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(30000),
  });

  if (!createResponse.ok) {
    const errText = await createResponse.text();
    return { success: false, error: `KIE error (${createResponse.status}): ${errText}` };
  }

  const createData: any = await createResponse.json();

  if (createData.code && createData.code !== 0 && createData.code !== 200) {
    const apiError = createData.msg || `API error code: ${createData.code}`;
    const lowerMsg = apiError.toLowerCase();
    if (/insufficient|not enough|exhausted|no credit|balance/.test(lowerMsg) && lowerMsg.includes('credit')) {
      return { success: false, error: `💳 KIE Credit หมด — ${apiError}` };
    }
    return { success: false, error: `KIE error: ${apiError}` };
  }

  const kieTaskId = createData.data?.taskId;
  if (!kieTaskId) return { success: false, error: 'No task ID from KIE' };

  // Save external_task_id for resume
  await pool.query('UPDATE prompt_direct_tasks SET external_task_id = $1 WHERE id = $2', [kieTaskId, taskId]);
  await appendLog(taskId, '📡', `KIE Task: ${kieTaskId}`);

  // Poll
  let consecutiveErrors = 0;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const statusResp = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${kieTaskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!statusResp.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return { success: false, error: `KIE polling failed (${MAX_CONSECUTIVE_ERRORS} errors)` };
        }
        continue;
      }

      consecutiveErrors = 0;
      const raw: any = await statusResp.json();
      const data = raw.data || raw;

      if (data.state === 'success') {
        let videoUrl: string | null = null;
        if (data.resultJson) {
          try {
            const result = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
            videoUrl = result.resultUrls?.[0] || result.videoUrl || result.url || null;
          } catch {}
        }
        if (!videoUrl) videoUrl = data.videoUrl || data.resultUrl || data.url || null;
        if (!videoUrl) return { success: false, error: 'No video URL in KIE response' };
        return { success: true, videoUrl };
      }

      if (data.state === 'fail') {
        return { success: false, error: `KIE failed: ${data.failMsg || 'Unknown'}` };
      }

      // Still processing — log every 30s
      if (attempt > 0 && attempt % 6 === 0) {
        const elapsed = Math.round((attempt * POLL_INTERVAL_MS) / 1000);
        await appendLog(taskId, '⏳', `กำลังสร้าง... (${elapsed}s)`);
      }
    } catch (err: any) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return { success: false, error: `KIE polling error: ${err.message}` };
      }
    }
  }

  return { success: false, error: 'KIE polling timeout (30 min)' };
}

/**
 * Main pipeline: run a single prompt_direct_task
 */
export async function runPromptDirectTask(taskId: number, userId: number): Promise<void> {
  try {
    // Atomic claim: pending → generating
    const claimed = await pool.query(
      `UPDATE prompt_direct_tasks SET status = 'generating', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [taskId]
    );
    if (claimed.rows.length === 0) {
      console.log(`[PromptDirect] Task ${taskId} not in pending state, skipping`);
      return;
    }
    const task = claimed.rows[0];

    // Load job
    const jobResult = await pool.query('SELECT * FROM prompt_direct_jobs WHERE id = $1', [task.job_id]);
    const job = jobResult.rows[0];
    if (!job) throw new Error('Job not found');

    await appendLog(taskId, '🚀', `เริ่มสร้างวิดีโอ...`);

    // Determine platform + API
    const mapped = PLATFORM_MAP[job.platform] || PLATFORM_MAP['kie-grok-10s'];
    const keyType = mapped.platform === 'sora2-vidgo' ? 'vidgo' : mapped.platform === 'sora2-grsai' ? 'piapi' : 'kie';
    const apiKey = await getUserApiKey(userId, keyType);
    if (!apiKey) {
      throw new Error(`API key ไม่ได้ตั้งค่า (${keyType}) — กรุณาไปตั้งค่าใน Settings`);
    }

    let videoUrl: string | null = null;

    // KIE-based generation
    if (mapped.platform === 'sora2-kie') {
      const isExtend = mapped.ai_model === 'kie_grok_extend';

      // Phase 1: Generate video
      const model1 = mapped.ai_model === 'kie_grok_imagine' || isExtend
        ? 'grok-imagine/text-to-video'
        : 'sora-2-text-to-video';

      const input1: Record<string, any> = {
        prompt: task.prompt,
        aspect_ratio: '9:16',
        duration: parseInt(mapped.duration),
      };
      if (model1.includes('grok')) {
        input1.mode = 'spicy';
        input1.resolution = '720p';
      }

      const result1 = await kieGenerateVideo(apiKey, model1, input1, taskId);
      if (!result1.success) throw new Error(result1.error);

      videoUrl = result1.videoUrl!;

      // Phase 2: Extend (if applicable)
      if (isExtend && task.extend_prompt) {
        await appendLog(taskId, '🔗', `กำลังต่อวิดีโอ (Extend)...`);

        // Get phase 1 task ID from external_task_id
        const taskRow = await pool.query('SELECT external_task_id FROM prompt_direct_tasks WHERE id = $1', [taskId]);
        const phase1TaskId = taskRow.rows[0]?.external_task_id;
        if (!phase1TaskId) throw new Error('Phase 1 task ID not found for extend');

        const result2 = await kieGenerateVideo(apiKey, 'grok-imagine/extend', {
          task_id: phase1TaskId,
          prompt: task.extend_prompt,
          extend_at: 10,
          extend_times: '10',
        }, taskId);
        if (!result2.success) throw new Error(result2.error);

        videoUrl = result2.videoUrl!;
      }
    }
    // TODO: Vidgo + Grsai support (add later if needed)
    else {
      throw new Error(`Platform ${mapped.platform} ยังไม่รองรับใน Prompt Direct`);
    }

    if (!videoUrl) throw new Error('No video URL generated');

    // Load watermark settings from channel (if any)
    const watermark = await getChannelWatermark(job.channel_id);

    // Upload to Dropbox (with watermark if enabled)
    if (isDropboxConfigured()) {
      try {
        if (watermark?.enabled) {
          // Download → apply watermark → upload watermarked
          await appendLog(taskId, '💧', 'กำลังใส่ลายน้ำ...');
          const tmpDir = path.join(os.tmpdir(), `pd-wm-${taskId}-${Date.now()}`);
          fs.mkdirSync(tmpDir, { recursive: true });
          try {
            const inputPath = path.join(tmpDir, 'input.mp4');
            const outputPath = path.join(tmpDir, 'output.mp4');
            const resp = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
            if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
            fs.writeFileSync(inputPath, Buffer.from(await resp.arrayBuffer()));
            await applyWatermark(inputPath, outputPath, watermark, tmpDir);

            await appendLog(taskId, '📦', 'กำลังบันทึกวิดีโอ (watermarked)...');
            const date = new Date().toISOString().slice(0, 10);
            const dropboxPath = `/trippleviral/prompt-direct/${userId}/${date}_${taskId}.mp4`;
            const { sharedUrl } = await uploadLocalFileToDropbox(outputPath, dropboxPath);
            videoUrl = sharedUrl;
            await pool.query('UPDATE prompt_direct_tasks SET dropbox_path = $1 WHERE id = $2', [dropboxPath, taskId]);
            await appendLog(taskId, '✅', 'บันทึกวิดีโอสำเร็จ (watermarked)');
          } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          }
        } else {
          await appendLog(taskId, '📦', 'กำลังบันทึกวิดีโอ...');
          const { sharedUrl, dropboxPath } = await uploadVideoToDropbox(videoUrl, userId, taskId);
          videoUrl = sharedUrl;
          await pool.query('UPDATE prompt_direct_tasks SET dropbox_path = $1 WHERE id = $2', [dropboxPath, taskId]);
          await appendLog(taskId, '✅', 'บันทึกวิดีโอสำเร็จ');
        }
      } catch (dbxErr: any) {
        console.error(`[PromptDirect] Dropbox upload failed for task ${taskId}:`, dbxErr.message);
        await appendLog(taskId, '⚠️', `Dropbox ล้มเหลว — ใช้ URL เดิม`);
      }
    }

    // Done!
    await updateTaskStatus(taskId, { status: 'done', video_url: videoUrl, error: null });
    await appendLog(taskId, '🎉', 'สร้างวิดีโอสำเร็จ!');
    console.log(`[PromptDirect] ✅ Task ${taskId} done: ${videoUrl?.substring(0, 60)}...`);

  } catch (error: any) {
    console.error(`[PromptDirect] ❌ Task ${taskId} failed:`, error.message);
    await appendLog(taskId, '💥', `ล้มเหลว: ${error.message?.substring(0, 100)}`);
    await updateTaskStatus(taskId, { status: 'failed', error: error.message });
  }
}
