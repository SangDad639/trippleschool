/**
 * Story Template background runner.
 * Chains: image (already done by /generate) → video (grok-imagine/image-to-video) → group concat (Phase 5c).
 *
 * Picks tasks every TICK_MS and advances them through the pipeline:
 *   - current_step='image_gen' AND status='success' AND video_task_id IS NULL  → start video gen
 *   - current_step='video_gen' AND video_status='pending'                       → poll KIE for video
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import pool from '../db.js';
import { uploadLocalFileToDropbox, isDropboxConfigured } from '../utils/dropbox.js';
import { applyWatermark, type WatermarkSettings } from '../utils/watermark.js';

const KIE_BASE = 'https://api.kie.ai';
const TICK_MS = 10_000;

async function getChannelWatermark(channelId: number | null | undefined): Promise<WatermarkSettings | null> {
  if (!channelId) return null;
  try {
    const r = await pool.query(
      `SELECT watermark_enabled, watermark_type, watermark_text, watermark_image_url,
              watermark_position, watermark_opacity, watermark_image_size, watermark_circular
       FROM scheduler_channels WHERE id = $1`,
      [channelId]
    );
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

async function concatStoryVideos(
  videos: { scene_number: number; video_url: string }[],
  userId: number,
  groupId: string,
  watermark?: WatermarkSettings | null
): Promise<{ sharedUrl: string; dropboxPath: string }> {
  const tmpDir = path.join(os.tmpdir(), `story-${groupId}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const sorted = [...videos].sort((a, b) => a.scene_number - b.scene_number);
    const { execSync } = await import('child_process');
    const ff = ffmpegPath || 'ffmpeg';
    const videoFiles: string[] = [];
    for (const v of sorted) {
      if (!v.video_url) throw new Error(`No video URL for scene ${v.scene_number}`);
      const filePath = path.join(tmpDir, `scene_${v.scene_number}.mp4`);
      const resp = await fetch(v.video_url);
      if (!resp.ok) throw new Error(`Download failed for scene ${v.scene_number}: HTTP ${resp.status}`);
      fs.writeFileSync(filePath, Buffer.from(await resp.arrayBuffer()));
      videoFiles.push(filePath);
    }

    const listPath = path.join(tmpDir, 'list.txt');
    const listContent = videoFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    const outputPath = path.join(tmpDir, 'output.mp4');
    const listFile = listPath.replace(/\\/g, '/');
    const outFile = outputPath.replace(/\\/g, '/');
    try {
      execSync(`"${ff}" -f concat -safe 0 -i "${listFile}" -c copy -y "${outFile}"`, { timeout: 120_000 });
    } catch {
      console.log('[storyRunner:concat] Stream copy failed, re-encoding...');
      execSync(
        `"${ff}" -f concat -safe 0 -i "${listFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${outFile}"`,
        { timeout: 300_000 }
      );
    }

    let uploadPath = outputPath;
    if (watermark?.enabled) {
      const wmPath = path.join(tmpDir, 'output_wm.mp4');
      await applyWatermark(outputPath, wmPath, watermark, tmpDir);
      uploadPath = wmPath;
    }

    const date = new Date().toISOString().slice(0, 10);
    const dropboxPath = `/trippleviral/story-templates/${userId}/${date}_${groupId}_final.mp4`;
    const result = await uploadLocalFileToDropbox(uploadPath, dropboxPath);
    return { sharedUrl: result.sharedUrl, dropboxPath: result.dropboxPath };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// Single-scene path: download, optionally watermark, upload to Dropbox.
async function uploadSingleSceneToDropbox(
  videoUrl: string,
  userId: number,
  groupId: string,
  watermark?: WatermarkSettings | null
): Promise<{ sharedUrl: string; dropboxPath: string }> {
  const tmpDir = path.join(os.tmpdir(), `story-${groupId}-single-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const inputPath = path.join(tmpDir, 'input.mp4');
    const resp = await fetch(videoUrl);
    if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
    fs.writeFileSync(inputPath, Buffer.from(await resp.arrayBuffer()));

    let uploadPath = inputPath;
    if (watermark?.enabled) {
      const wmPath = path.join(tmpDir, 'output_wm.mp4');
      await applyWatermark(inputPath, wmPath, watermark, tmpDir);
      uploadPath = wmPath;
    }

    const date = new Date().toISOString().slice(0, 10);
    const dropboxPath = `/trippleviral/story-templates/${userId}/${date}_${groupId}_final.mp4`;
    const result = await uploadLocalFileToDropbox(uploadPath, dropboxPath);
    return { sharedUrl: result.sharedUrl, dropboxPath: result.dropboxPath };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// Recover groups stuck in 'processing' for >2 minutes — likely a previous concat attempt crashed
// or the server restarted mid-concat. Reset to 'pending' so processFinishedGroups can pick up again.
async function recoverStaleProcessingGroups() {
  await pool.query(
    `UPDATE story_template_groups
     SET status='pending', error=NULL, updated_at=NOW()
     WHERE status='processing' AND updated_at < NOW() - INTERVAL '2 minutes'`
  );
}

// Recover groups marked 'failed' even though every task has now succeeded
// (user retried failed tasks → tasks are now success, but group's old failure status was never cleared).
async function recoverFailedButCompleteGroups() {
  await pool.query(
    `UPDATE story_template_groups g
     SET status='pending', error=NULL, updated_at=NOW()
     WHERE g.status='failed'
       AND (
         SELECT COUNT(*) FROM story_template_tasks t
         WHERE t.group_id = g.group_id
           AND (t.status='failed' OR t.video_status='failed')
       ) = 0
       AND (
         SELECT COUNT(*) FROM story_template_tasks t
         WHERE t.group_id = g.group_id AND t.video_status='success'
       ) >= g.scene_count`
  );
}

// Detect groups that have any failed scene (image or video) and mark them as failed
// so frontend can surface the error. Retry endpoint flips them back to 'pending'.
async function markFailedGroups() {
  const candidates = await pool.query(
    `SELECT g.group_id,
            ARRAY_AGG(
              CASE
                WHEN t.status='failed' THEN 'ฉาก #' || COALESCE(t.scene_number, t.id) || ' ภาพ: ' || COALESCE(t.error, 'unknown')
                WHEN t.video_status='failed' THEN 'ฉาก #' || COALESCE(t.scene_number, t.id) || ' วิดีโอ: ' || COALESCE(t.error, 'unknown')
              END
            ) FILTER (WHERE t.status='failed' OR t.video_status='failed') AS errors
     FROM story_template_groups g
     INNER JOIN story_template_tasks t ON t.group_id = g.group_id
     WHERE g.status='pending'
       AND (t.status='failed' OR t.video_status='failed')
     GROUP BY g.group_id
     LIMIT 10`
  );
  for (const row of candidates.rows) {
    const msgs: string[] = (row.errors || []).filter(Boolean);
    const errMsg = (msgs.length > 0 ? msgs.join(' | ') : 'one or more scenes failed').substring(0, 500);
    await pool.query(
      `UPDATE story_template_groups
       SET status='failed', error=$1, updated_at=NOW()
       WHERE group_id=$2 AND status='pending'`,
      [errMsg, row.group_id]
    );
    console.log(`[storyRunner:markFailed] Group ${row.group_id} marked failed: ${errMsg}`);
  }
}

// Find groups whose all tasks have video_status='success' and group is not yet done.
// Atomically claim group (set status='processing') so two ticks don't double-process.
async function processFinishedGroups() {
  const candidates = await pool.query(
    `SELECT g.group_id, g.user_id, g.channel_id, g.scene_count,
            (SELECT COUNT(*) FROM story_template_tasks t
             WHERE t.group_id = g.group_id AND t.video_status = 'success') AS done_count
     FROM story_template_groups g
     WHERE g.status='pending'
       AND (
         SELECT COUNT(*) FROM story_template_tasks t
         WHERE t.group_id = g.group_id AND t.video_status = 'success'
       ) >= g.scene_count
     LIMIT 5`
  );
  if (candidates.rowCount && candidates.rowCount > 0) {
    console.log(`[storyRunner:concat] ${candidates.rowCount} group(s) ready to concat`);
  }
  for (const g of candidates.rows) {
    // Atomic claim
    const claim = await pool.query(
      `UPDATE story_template_groups
       SET status='processing', updated_at=NOW()
       WHERE group_id=$1 AND status='pending'
       RETURNING group_id`,
      [g.group_id]
    );
    if (claim.rowCount === 0) continue;

    try {
      const tasks = await pool.query(
        `SELECT scene_number, video_url FROM story_template_tasks
         WHERE group_id=$1 AND video_status='success'
         ORDER BY COALESCE(scene_number, 1) ASC`,
        [g.group_id]
      );
      const videos = tasks.rows.map((r: any) => ({
        scene_number: r.scene_number || 1,
        video_url: r.video_url as string,
      }));

      // Helper: insert into content_history so the final video shows in /history page
      const saveToHistory = async (videoUrl: string) => {
        try {
          // Use group's topic as the prompt label (fallback to first task's prompt)
          const groupRow = await pool.query(
            `SELECT topic FROM story_template_groups WHERE group_id=$1`,
            [g.group_id]
          );
          const topic = groupRow.rows[0]?.topic || '';
          await pool.query(
            `INSERT INTO content_history (user_id, channel_id, video_url, prompt, aspect_ratio, source, created_at)
             VALUES ($1, $2, $3, $4, '9:16', 'story_template', NOW())
             ON CONFLICT (user_id, video_url) DO NOTHING`,
            [g.user_id, g.channel_id, videoUrl, topic]
          );
        } catch (chErr: any) {
          console.error(`[storyRunner:concat] content_history insert failed:`, chErr?.message);
        }
      };

      if (!isDropboxConfigured()) {
        // No Dropbox — mark done with first video URL as fallback
        const fallbackUrl = videos[0]?.video_url || null;
        await pool.query(
          `UPDATE story_template_groups
           SET status='done', final_video_url=$1, updated_at=NOW()
           WHERE group_id=$2`,
          [fallbackUrl, g.group_id]
        );
        if (fallbackUrl) await saveToHistory(fallbackUrl);
        console.log(`[storyRunner:concat] Group ${g.group_id}: no Dropbox, used raw URL`);
        continue;
      }

      const watermark = await getChannelWatermark(g.channel_id);
      const result =
        videos.length === 1
          ? await uploadSingleSceneToDropbox(videos[0].video_url, g.user_id, g.group_id, watermark)
          : await concatStoryVideos(videos, g.user_id, g.group_id, watermark);

      await pool.query(
        `UPDATE story_template_groups
         SET status='done', final_video_url=$1, dropbox_path=$2, updated_at=NOW()
         WHERE group_id=$3`,
        [result.sharedUrl, result.dropboxPath, g.group_id]
      );
      await saveToHistory(result.sharedUrl);
      console.log(`[storyRunner:concat] Group ${g.group_id}: final video ready`);
    } catch (err: any) {
      console.error(`[storyRunner:concat] Group ${g.group_id} failed:`, err?.message);
      await pool.query(
        `UPDATE story_template_groups
         SET status='failed', error=$1, updated_at=NOW()
         WHERE group_id=$2`,
        [err?.message || 'concat failed', g.group_id]
      );
    }
  }
}

async function getUserKieKey(userId: number): Promise<string | null> {
  const r = await pool.query(`SELECT kie_api_key FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.kie_api_key || null;
}

function findUrl(obj: any): string | null {
  if (!obj) return null;
  if (typeof obj === 'string') return /^https?:\/\//.test(obj) ? obj : null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const u = findUrl(item);
      if (u) return u;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const u = findUrl(obj[k]);
      if (u) return u;
    }
  }
  return null;
}

type SegmentInput = { duration: number; dialogue?: string; video_prompt?: string };
type SegmentProgress = { idx: number; duration: number; kie_task_id: string | null; status: 'pending' | 'success' | 'failed'; video_url: string | null; error?: string };

function buildSegmentPrompt(seg: SegmentInput, fallbackEmotion: string): string {
  const dialogue = (seg.dialogue || '').trim();
  let motion = 'gentle cinematic motion, subtle body movement, eye contact with camera';
  if (seg.video_prompt && seg.video_prompt.trim().length > 0) {
    const cleaned = seg.video_prompt
      .replace(/Lip-sync[\s\S]*?(?:Strictly no text[^.]*\.|$)/i, '')
      .replace(/Voice tone:[\s\S]*?(?:\.|$)/i, '')
      .replace(/Speak the line[\s\S]*?(?:\.|$)/i, '')
      .trim();
    if (cleaned.length > 20) motion = cleaned;
  }
  const tone = fallbackEmotion ? `${fallbackEmotion}, natural conversational` : 'natural conversational';
  if (!dialogue) return motion;
  return `a high-quality cinematic iPhone-style handheld 9:16 vertical shot. ${motion}. Lip-sync perfectly to the ภาษาไทย dialogue spoken by a native Thai speaker with clear standard Bangkok accent and natural intonation: '${dialogue}' Voice tone: ${tone}, native Thai voice, clear pronunciation, same voice as previous segments. Strictly no text, no subtitles, no watermarks.`;
}

// Submit grok-imagine/image-to-video for each segment of a finished image task.
// Multi-segment: scene_duration > 10 splits into 10s/5s sub-clips per spec.
async function submitVideoForTask(task: {
  id: number;
  user_id: number;
  task_id: string;
  result_url: string;
  prompt: string;
  group_id: string | null;
  variables?: any;
}) {
  const kieKey = await getUserKieKey(task.user_id);
  if (!kieKey) {
    await pool.query(
      `UPDATE story_template_tasks SET video_status='failed', error=$1, updated_at=NOW() WHERE id=$2`,
      ['KIE API key not configured', task.id]
    );
    return;
  }

  let resolution = '720p';
  if (task.group_id) {
    const g = await pool.query(
      `SELECT video_resolution FROM story_template_groups WHERE group_id=$1`,
      [task.group_id]
    );
    if (g.rows[0]) resolution = g.rows[0].video_resolution || '720p';
  }

  const findVar = (key: string): string => {
    const v = task.variables;
    if (!v) return '';
    if (Array.isArray(v)) return v.find((x: any) => x?.name === key)?.value || '';
    if (typeof v === 'object') return String((v as any)[key] ?? '');
    return '';
  };
  const segmentsRaw = findVar('segments');
  const dialogue = findVar('dialogue');
  const emotion = findVar('emotion');
  const aiVideoPrompt = findVar('video_prompt');

  let segments: SegmentInput[] = [];
  if (segmentsRaw) {
    try {
      const parsed = JSON.parse(segmentsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        segments = parsed.filter((s: any) => s && typeof s.duration === 'number');
      }
    } catch {}
  }
  if (segments.length === 0) {
    segments = [{ duration: 10, dialogue, video_prompt: aiVideoPrompt }];
  }

  const progress: SegmentProgress[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segDur = (seg.duration === 5 || seg.duration === 10) ? seg.duration : 10;
    const prompt = buildSegmentPrompt(seg, emotion);
    try {
      const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kieKey}` },
        body: JSON.stringify({
          model: 'grok-imagine/image-to-video',
          input: {
            image_urls: [task.result_url],
            prompt,
            mode: 'spicy',
            aspect_ratio: '9:16',
            duration: segDur,
            resolution,
          },
        }),
      });
      const kieData: any = await kieRes.json().catch(() => ({}));
      if (!kieRes.ok || kieData.code !== 200 || !kieData.data?.taskId) {
        const msg = kieData.msg || `KIE error (HTTP ${kieRes.status})`;
        progress.push({ idx: i, duration: segDur, kie_task_id: null, status: 'failed', video_url: null, error: msg });
        continue;
      }
      progress.push({ idx: i, duration: segDur, kie_task_id: kieData.data.taskId as string, status: 'pending', video_url: null });
    } catch (err: any) {
      progress.push({ idx: i, duration: segDur, kie_task_id: null, status: 'failed', video_url: null, error: err?.message || 'submit failed' });
    }
  }

  const anyPending = progress.some((p) => p.status === 'pending');
  if (!anyPending) {
    const errSummary = progress.map((p) => `seg${p.idx + 1}: ${p.error || 'unknown'}`).join('; ');
    await pool.query(
      `UPDATE story_template_tasks SET video_status='failed', error=$1, video_segments=$2::jsonb, updated_at=NOW() WHERE id=$3`,
      [errSummary, JSON.stringify(progress), task.id]
    );
    return;
  }

  const firstKieId = progress.find((p) => p.kie_task_id)?.kie_task_id || null;
  await pool.query(
    `UPDATE story_template_tasks
     SET current_step='video_gen', video_status='pending', video_task_id=$1, video_segments=$2::jsonb, updated_at=NOW()
     WHERE id=$3`,
    [firstKieId, JSON.stringify(progress), task.id]
  );
  console.log(`[storyRunner] Task ${task.id}: ${progress.length} video segment(s) started`);
}

async function fetchKieResult(kieKey: string, kieTaskId: string): Promise<{ state: string; url: string | null; error?: string }> {
  const kieRes = await fetch(
    `${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(kieTaskId)}`,
    { headers: { Authorization: `Bearer ${kieKey}` } }
  );
  // HTTP-level error → transient, treat as pending (next poll will retry)
  if (!kieRes.ok) {
    console.warn(`[storyRunner] HTTP ${kieRes.status} from KIE recordInfo for ${kieTaskId}, will retry`);
    return { state: 'pending', url: null };
  }
  const raw: any = await kieRes.json().catch(() => ({}));
  const data = raw?.data || raw || {};
  const state: string | undefined = data.state || data.status;

  if (state === 'success' || state === 'completed' || state === 'done') {
    let url: string | null = null;
    if (data.resultJson) {
      try {
        const rd = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
        url = rd.resultUrls?.[0] || rd.result_urls?.[0] || rd.videoUrls?.[0] || rd.video_urls?.[0]
            || rd.urls?.[0] || rd.url || rd.video_url || rd.videoUrl || null;
        if (!url) url = findUrl(rd);
      } catch {}
    }
    if (!url) url = data.videoUrl || data.video_url || data.url || data.videoUrls?.[0] || data.video_urls?.[0] || null;
    if (!url) url = findUrl(data) || findUrl(raw);
    return { state: 'success', url };
  }
  if (state === 'fail' || state === 'failed' || state === 'error') {
    const msg = data.failMsg || data.fail_msg || data.errorMessage || data.error || 'Video generation failed';
    return { state: 'failed', url: null, error: msg };
  }
  return { state: 'pending', url: null };
}

// Concat segment clips into one scene video using ffmpeg, upload to Dropbox, return public URL
async function concatSegmentsForTask(taskId: number, userId: number, segments: SegmentProgress[]): Promise<string | null> {
  const tmpDir = path.join(os.tmpdir(), `story-task-${taskId}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const sorted = [...segments].sort((a, b) => a.idx - b.idx);
    const files: string[] = [];
    for (const seg of sorted) {
      if (!seg.video_url) throw new Error(`segment ${seg.idx + 1} missing url`);
      const fp = path.join(tmpDir, `seg_${seg.idx}.mp4`);
      const r = await fetch(seg.video_url);
      if (!r.ok) throw new Error(`download seg ${seg.idx + 1} failed: ${r.status}`);
      fs.writeFileSync(fp, Buffer.from(await r.arrayBuffer()));
      files.push(fp);
    }

    if (files.length === 1) {
      // Single segment — just upload as-is
      if (!isDropboxConfigured()) return sorted[0].video_url;
      const date = new Date().toISOString().slice(0, 10);
      const dbxPath = `/trippleviral/story-segments/${userId}/${date}_task${taskId}.mp4`;
      const result = await uploadLocalFileToDropbox(files[0], dbxPath);
      return result.sharedUrl;
    }

    const listPath = path.join(tmpDir, 'list.txt');
    fs.writeFileSync(listPath, files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
    const outPath = path.join(tmpDir, 'concat.mp4');
    const { execSync } = await import('child_process');
    const ff = ffmpegPath || 'ffmpeg';
    try {
      execSync(`"${ff}" -f concat -safe 0 -i "${listPath.replace(/\\/g, '/')}" -c copy -y "${outPath.replace(/\\/g, '/')}"`, { timeout: 120_000 });
    } catch {
      execSync(
        `"${ff}" -f concat -safe 0 -i "${listPath.replace(/\\/g, '/')}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${outPath.replace(/\\/g, '/')}"`,
        { timeout: 300_000 }
      );
    }

    if (!isDropboxConfigured()) {
      // Fallback: cannot upload, return first segment URL (best effort)
      return sorted[0].video_url;
    }
    const date = new Date().toISOString().slice(0, 10);
    const dbxPath = `/trippleviral/story-segments/${userId}/${date}_task${taskId}_concat.mp4`;
    const result = await uploadLocalFileToDropbox(outPath, dbxPath);
    return result.sharedUrl;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function pollVideoForTask(task: {
  id: number;
  user_id: number;
  video_task_id: string;
  video_segments?: any;
}) {
  const kieKey = await getUserKieKey(task.user_id);
  if (!kieKey) return;

  // Multi-segment path: poll each pending segment, concat when all done
  if (Array.isArray(task.video_segments) && task.video_segments.length > 0) {
    const segs: SegmentProgress[] = task.video_segments as SegmentProgress[];
    let updated = false;
    for (const seg of segs) {
      if (seg.status !== 'pending' || !seg.kie_task_id) continue;
      try {
        const r = await fetchKieResult(kieKey, seg.kie_task_id);
        if (r.state === 'success' && r.url) {
          seg.status = 'success';
          seg.video_url = r.url;
          updated = true;
        } else if (r.state === 'failed') {
          seg.status = 'failed';
          seg.error = r.error;
          updated = true;
        }
      } catch (err: any) {
        console.error(`[storyRunner] poll seg ${seg.idx} err:`, err?.message);
      }
    }

    const allDone = segs.every((s) => s.status === 'success' || s.status === 'failed');
    const anyFailed = segs.some((s) => s.status === 'failed');

    if (allDone) {
      if (anyFailed) {
        const errMsg = segs.filter((s) => s.status === 'failed').map((s) => `seg${s.idx + 1}: ${s.error || 'failed'}`).join('; ');
        await pool.query(
          `UPDATE story_template_tasks SET video_status='failed', error=$1, video_segments=$2::jsonb, updated_at=NOW() WHERE id=$3`,
          [errMsg, JSON.stringify(segs), task.id]
        );
        return;
      }
      // All success — concat
      try {
        const finalUrl = await concatSegmentsForTask(task.id, task.user_id, segs);
        if (!finalUrl) throw new Error('concat returned no url');
        await pool.query(
          `UPDATE story_template_tasks
           SET video_status='success', video_url=$1, video_segments=$2::jsonb, current_step=NULL, updated_at=NOW()
           WHERE id=$3`,
          [finalUrl, JSON.stringify(segs), task.id]
        );
        console.log(`[storyRunner] Task ${task.id}: ${segs.length} segments concatenated → done`);
      } catch (err: any) {
        console.error(`[storyRunner] concat failed for task ${task.id}:`, err?.message);
        await pool.query(
          `UPDATE story_template_tasks SET video_status='failed', error=$1, video_segments=$2::jsonb, updated_at=NOW() WHERE id=$3`,
          [`segment concat failed: ${err?.message || 'unknown'}`, JSON.stringify(segs), task.id]
        );
      }
      return;
    }

    if (updated) {
      await pool.query(
        `UPDATE story_template_tasks SET video_segments=$1::jsonb, updated_at=NOW() WHERE id=$2`,
        [JSON.stringify(segs), task.id]
      );
    }
    return;
  }

  // Legacy single-task path (no segments)
  try {
    const r = await fetchKieResult(kieKey, task.video_task_id);
    if (r.state === 'success' && r.url) {
      await pool.query(
        `UPDATE story_template_tasks
         SET video_status='success', video_url=$1, current_step=NULL, updated_at=NOW()
         WHERE id=$2`,
        [r.url, task.id]
      );
      console.log(`[storyRunner] Task ${task.id}: video done`);
    } else if (r.state === 'success' && !r.url) {
      await pool.query(
        `UPDATE story_template_tasks SET video_status='failed', error='No video URL in result', updated_at=NOW() WHERE id=$1`,
        [task.id]
      );
    } else if (r.state === 'failed') {
      await pool.query(
        `UPDATE story_template_tasks SET video_status='failed', error=$1, updated_at=NOW() WHERE id=$2`,
        [r.error || 'failed', task.id]
      );
    }
  } catch (err: any) {
    console.error(`[storyRunner] Poll error for task ${task.id}:`, err?.message);
  }
}

async function tick() {
  try {
    // 1. Tasks with image done that haven't started video yet
    const toStart = await pool.query(
      `SELECT id, user_id, task_id, result_url, prompt, group_id, variables
       FROM story_template_tasks
       WHERE current_step='image_gen'
         AND status='success'
         AND result_url IS NOT NULL
         AND video_task_id IS NULL
         AND (video_status IS NULL OR video_status='')
       ORDER BY created_at ASC
       LIMIT 5`
    );
    for (const t of toStart.rows) {
      await submitVideoForTask(t);
    }

    // 2. Tasks waiting on video result (multi-segment via video_segments OR legacy single via video_task_id)
    const toPoll = await pool.query(
      `SELECT id, user_id, video_task_id, video_segments
       FROM story_template_tasks
       WHERE current_step='video_gen'
         AND video_status='pending'
         AND (video_task_id IS NOT NULL OR video_segments IS NOT NULL)
       ORDER BY updated_at ASC
       LIMIT 10`
    );
    for (const t of toPoll.rows) {
      await pollVideoForTask(t);
    }

    // 3. Recover groups stuck in 'processing' for too long (stale claim)
    await recoverStaleProcessingGroups();

    // 4. Recover groups marked 'failed' but whose tasks have all since succeeded
    await recoverFailedButCompleteGroups();

    // 5. Mark groups failed if any scene has irrecoverable failure
    await markFailedGroups();

    // 6. Concat groups whose tasks are all done
    await processFinishedGroups();
  } catch (err: any) {
    console.error('[storyRunner] tick error:', err?.message);
  }
}

let timer: NodeJS.Timeout | null = null;

export function startStoryTemplateRunner() {
  if (timer) return;
  console.log(`[storyRunner] starting (tick every ${TICK_MS / 1000}s)`);
  // Run immediately, then on interval
  tick();
  timer = setInterval(tick, TICK_MS);
}

export function stopStoryTemplateRunner() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
