/**
 * Story Agent background orchestrator — walks each job through 8 stages:
 *
 *   pending → idea → script → voice → storyboard → scene_image → scene_video
 *                  → assemble → post → done
 *
 * One tick advances one job by one stage (or polls KIE for in-flight tasks).
 * Concurrent ticks are safe: each job is claimed via `FOR UPDATE SKIP LOCKED`.
 *
 * KIE image/video stages naturally span multiple ticks — submit on first visit,
 * then poll on subsequent ticks until all scenes finish. The LLM stages and
 * TTS/assemble stages are synchronous within a tick.
 */
import pool from '../db.js';
import { appendJobLog } from '../routes/storyAgent.js';
import {
  generateIdea,
  generateScript,
  generateStoryboard,
  generateCaptions,
  type Language,
  type Idea,
  type Script,
  type Storyboard,
} from '../services/storyAgentLLM.js';
import { synthesizeLine } from '../services/elevenLabsTTS.js';
import { submitSceneImage, submitSceneVideo, pollKieTask } from '../services/kieSceneGen.js';
import { assembleClip, type SceneInput } from '../services/assembleClip.js';
import { publishPost } from '../services/postForMeService.js';
import { isDropboxConfigured } from '../utils/dropbox.js';
import { deductCreditsWithRetry, refundCreditsWithRetry } from '../services/creditService.js';
import {
  STORY_AGENT_CREDIT_COSTS,
  STORY_AGENT_CREDIT_REF_TYPE,
  storyAgentRefId,
  type StoryAgentStageWithCost,
} from '../config/storyAgentPricing.js';

const TICK_MS = 10_000;
const MAX_JOBS_PER_TICK = 3;

interface JobRow {
  id: number;
  user_id: number;
  channel_id: number | null;
  topic: string;
  duration_sec: number;
  tone: string | null;
  language: string;
  scene_count: number;
  current_stage: string;
  status: string;
  idea_json: Idea | null;
  script_json: Script | null;
  storyboard_json: Storyboard | null;
  final_video_url: string | null;
  caption_fb: string | null;
  caption_tt: string | null;
  retry_count: number;
}

interface UserKeys {
  anthropic_api_key: string | null;
  openrouter_api_key: string | null;
  elevenlabs_api_key: string | null;
  elevenlabs_voice_id_th: string | null;
  elevenlabs_voice_id_en: string | null;
  kie_api_key: string | null;
  postforme_api_key: string | null;
}

async function getUserKeys(userId: number): Promise<UserKeys> {
  const r = await pool.query(
    `SELECT anthropic_api_key, openrouter_api_key, elevenlabs_api_key,
            elevenlabs_voice_id_th, elevenlabs_voice_id_en,
            kie_api_key, postforme_api_key
     FROM users WHERE id = $1`,
    [userId]
  );
  return (
    r.rows[0] || {
      anthropic_api_key: null,
      openrouter_api_key: null,
      elevenlabs_api_key: null,
      elevenlabs_voice_id_th: null,
      elevenlabs_voice_id_en: null,
      kie_api_key: null,
      postforme_api_key: null,
    }
  );
}

function llmKeys(k: UserKeys): { anthropic: string | null; openrouter: string | null } {
  return { anthropic: k.anthropic_api_key, openrouter: k.openrouter_api_key };
}

/**
 * Charge credits for an LLM stage, run the work, and refund on failure.
 * Idempotent — deductCreditsWithRetry checks for an existing tx with the same
 * (user_id, reference_type, reference_id) tuple, so retrying the same stage
 * after a transient error won't double-charge.
 */
async function withCreditDeduction<T>(
  userId: number,
  jobId: number,
  stage: StoryAgentStageWithCost,
  description: string,
  work: () => Promise<T>
): Promise<T> {
  const amount = STORY_AGENT_CREDIT_COSTS[stage];
  const refId = storyAgentRefId(jobId, stage);
  const deduct = await deductCreditsWithRetry(
    userId,
    amount,
    STORY_AGENT_CREDIT_REF_TYPE,
    refId,
    description
  );
  if (!deduct.success) {
    throw new Error(deduct.error || `Credit deduction failed for stage ${stage}`);
  }
  try {
    return await work();
  } catch (err) {
    // Refund on failure (idempotent — won't double-refund if the work threw
    // after partial success). Errors during refund are logged but not propagated
    // so the original stage error reaches the user.
    await refundCreditsWithRetry(
      userId,
      amount,
      STORY_AGENT_CREDIT_REF_TYPE,
      refId,
      `Refund: ${description} failed`
    ).catch((refundErr) =>
      console.error(`[storyAgentRunner] refund failed for ${refId}:`, refundErr?.message)
    );
    throw err;
  }
}

async function markFailed(jobId: number, msg: string): Promise<void> {
  await pool.query(
    `UPDATE story_agent_jobs
     SET status = 'failed', current_stage = 'failed', error = $1, updated_at = NOW()
     WHERE id = $2`,
    [msg.substring(0, 1000), jobId]
  );
  await appendJobLog(jobId, '❌', msg.substring(0, 200));
}

async function setStage(jobId: number, stage: string): Promise<void> {
  await pool.query(
    `UPDATE story_agent_jobs SET current_stage = $1, status = 'running', updated_at = NOW() WHERE id = $2`,
    [stage, jobId]
  );
}

// ---------- Stage handlers ----------

async function runIdea(job: JobRow, keys: UserKeys): Promise<void> {
  await appendJobLog(job.id, '💡', `กำลังคิดไอเดีย... (-${STORY_AGENT_CREDIT_COSTS.idea} credits)`);
  const idea = await withCreditDeduction(
    job.user_id,
    job.id,
    'idea',
    `AI Agent idea — job ${job.id}`,
    () => generateIdea(job.topic, job.tone, job.language as Language, llmKeys(keys))
  );
  await pool.query(
    `UPDATE story_agent_jobs SET idea_json = $1::jsonb, current_stage = 'script', status = 'running', updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(idea), job.id]
  );
  await appendJobLog(job.id, '✅', `ไอเดีย: ${idea.title}`);
}

async function runScript(job: JobRow, keys: UserKeys): Promise<void> {
  if (!job.idea_json) throw new Error('idea_json missing — cannot write script');
  await appendJobLog(job.id, '✍️', `กำลังเขียนบท ${job.scene_count} บรรทัด... (-${STORY_AGENT_CREDIT_COSTS.script} credits)`);
  const script = await withCreditDeduction(
    job.user_id,
    job.id,
    'script',
    `AI Agent script — job ${job.id}`,
    () => generateScript(job.idea_json!, job.scene_count, job.language as Language, llmKeys(keys))
  );
  // Insert scene rows (script_text only — image_prompt comes in storyboard stage)
  for (const line of script.lines) {
    await pool.query(
      `INSERT INTO story_agent_scenes (job_id, scene_number, script_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (job_id, scene_number) DO UPDATE SET script_text = EXCLUDED.script_text`,
      [job.id, line.scene, line.text]
    );
  }
  await pool.query(
    `UPDATE story_agent_jobs SET script_json = $1::jsonb, current_stage = 'voice', updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(script), job.id]
  );
  await appendJobLog(job.id, '✅', `บท ${script.lines.length} บรรทัดเสร็จ`);
}

async function runVoice(job: JobRow, keys: UserKeys): Promise<void> {
  if (!keys.elevenlabs_api_key) {
    throw new Error('ELEVENLABS_API_KEY not configured on user profile');
  }
  const scenes = await pool.query(
    `SELECT scene_number, script_text FROM story_agent_scenes
     WHERE job_id = $1 AND voice_url IS NULL
     ORDER BY scene_number ASC`,
    [job.id]
  );
  if (scenes.rowCount === 0) {
    // All voices already done → advance
    await setStage(job.id, 'storyboard');
    return;
  }
  await appendJobLog(job.id, '🎙️', `กำลังพากย์ ${scenes.rowCount} บรรทัด...`);
  const voiceId =
    job.language === 'en' ? keys.elevenlabs_voice_id_en : keys.elevenlabs_voice_id_th;

  for (const s of scenes.rows) {
    const result = await synthesizeLine(s.script_text, s.scene_number, {
      apiKey: keys.elevenlabs_api_key,
      voiceId: voiceId || undefined,
      language: job.language as 'th' | 'en',
      userId: job.user_id,
      jobId: job.id,
    });
    await pool.query(
      `UPDATE story_agent_scenes
       SET voice_url = $1, voice_duration = $2, updated_at = NOW()
       WHERE job_id = $3 AND scene_number = $4`,
      [result.audio_url, result.duration_sec, job.id, s.scene_number]
    );
  }
  await setStage(job.id, 'storyboard');
  await appendJobLog(job.id, '✅', 'พากย์เสียงครบทุกฉาก');
}

async function runStoryboard(job: JobRow, keys: UserKeys): Promise<void> {
  if (!job.idea_json || !job.script_json) {
    throw new Error('idea_json or script_json missing — cannot build storyboard');
  }
  await appendJobLog(job.id, '🎨', `กำลังออกแบบสตอรีบอร์ด... (-${STORY_AGENT_CREDIT_COSTS.storyboard} credits)`);
  const sb = await withCreditDeduction(
    job.user_id,
    job.id,
    'storyboard',
    `AI Agent storyboard — job ${job.id}`,
    () => generateStoryboard(job.idea_json!, job.script_json!, job.language as Language, llmKeys(keys))
  );
  // Update scene image_prompts
  for (const sc of sb.scenes) {
    const fullPrompt = composeFullScenePrompt(sb, sc.prompt_en);
    await pool.query(
      `UPDATE story_agent_scenes
       SET image_prompt = $1, panel_desc_th = $2, updated_at = NOW()
       WHERE job_id = $3 AND scene_number = $4`,
      [fullPrompt, sc.panel_th, job.id, sc.scene]
    );
  }
  await pool.query(
    `UPDATE story_agent_jobs SET storyboard_json = $1::jsonb, current_stage = 'scene_image', updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(sb), job.id]
  );
  await appendJobLog(job.id, '✅', `สตอรีบอร์ด ${sb.scenes.length} ฉากเสร็จ`);
}

function composeFullScenePrompt(sb: Storyboard, scenePrompt: string): string {
  // Inject the shared style/character context so every scene image is visually consistent.
  return `${sb.style_bible}\n\nRecurring characters/objects: ${sb.character_sheet}\n\nThis scene: ${scenePrompt}`;
}

async function runSceneImage(job: JobRow, keys: UserKeys): Promise<void> {
  if (!keys.kie_api_key) throw new Error('KIE_API_KEY not configured on user profile');
  // Submit any scenes that don't have a kie task yet
  const toSubmit = await pool.query(
    `SELECT scene_number, image_prompt FROM story_agent_scenes
     WHERE job_id = $1 AND image_kie_task_id IS NULL AND image_prompt IS NOT NULL
     ORDER BY scene_number ASC
     LIMIT 5`,
    [job.id]
  );
  if (toSubmit.rowCount && toSubmit.rowCount > 0) {
    await appendJobLog(job.id, '🖼️', `ส่งภาพ ${toSubmit.rowCount} ฉากไป KIE`);
  }
  for (const sc of toSubmit.rows) {
    try {
      const taskId = await submitSceneImage(keys.kie_api_key, sc.image_prompt);
      await pool.query(
        `UPDATE story_agent_scenes SET image_kie_task_id = $1, image_status = 'running', updated_at = NOW()
         WHERE job_id = $2 AND scene_number = $3`,
        [taskId, job.id, sc.scene_number]
      );
    } catch (err: any) {
      await pool.query(
        `UPDATE story_agent_scenes SET image_status = 'failed', error = $1, updated_at = NOW()
         WHERE job_id = $2 AND scene_number = $3`,
        [err?.message || 'submit failed', job.id, sc.scene_number]
      );
    }
  }

  // Poll pending images
  const pending = await pool.query(
    `SELECT scene_number, image_kie_task_id FROM story_agent_scenes
     WHERE job_id = $1 AND image_status IN ('pending', 'running') AND image_kie_task_id IS NOT NULL
     ORDER BY scene_number ASC`,
    [job.id]
  );
  for (const sc of pending.rows) {
    const r = await pollKieTask(keys.kie_api_key, sc.image_kie_task_id);
    if (r.state === 'success' && r.url) {
      await pool.query(
        `UPDATE story_agent_scenes SET image_url = $1, image_status = 'success', updated_at = NOW()
         WHERE job_id = $2 AND scene_number = $3`,
        [r.url, job.id, sc.scene_number]
      );
    } else if (r.state === 'failed') {
      await pool.query(
        `UPDATE story_agent_scenes SET image_status = 'failed', error = $1, updated_at = NOW()
         WHERE job_id = $2 AND scene_number = $3`,
        [r.error || 'image failed', job.id, sc.scene_number]
      );
    }
  }

  // If all scenes are settled (success or failed), advance
  const settled = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE image_status = 'success')::int AS ok,
       COUNT(*) FILTER (WHERE image_status = 'failed')::int AS bad,
       COUNT(*)::int AS total
     FROM story_agent_scenes WHERE job_id = $1`,
    [job.id]
  );
  const { ok, bad, total } = settled.rows[0];
  if (ok + bad === total) {
    if (ok === 0) throw new Error('All scene images failed');
    await setStage(job.id, 'scene_video');
    await appendJobLog(job.id, '✅', `ภาพเสร็จ ${ok}/${total}`);
  }
}

async function runSceneVideo(job: JobRow, keys: UserKeys): Promise<void> {
  if (!keys.kie_api_key) throw new Error('KIE_API_KEY not configured');
  // Submit videos for scenes with image_url but no video_kie_task_id
  const toSubmit = await pool.query(
    `SELECT scene_number, image_url, image_prompt FROM story_agent_scenes
     WHERE job_id = $1 AND image_status = 'success' AND image_url IS NOT NULL
       AND video_kie_task_id IS NULL
     ORDER BY scene_number ASC
     LIMIT 3`,
    [job.id]
  );
  if (toSubmit.rowCount && toSubmit.rowCount > 0) {
    await appendJobLog(job.id, '🎬', `ส่งวิดีโอ ${toSubmit.rowCount} ฉากไป KIE`);
  }
  for (const sc of toSubmit.rows) {
    try {
      const taskId = await submitSceneVideo(
        keys.kie_api_key,
        sc.image_url,
        sc.image_prompt || '',
        { aspect_ratio: '9:16', duration: 10, resolution: '720p' }
      );
      await pool.query(
        `UPDATE story_agent_scenes SET video_kie_task_id = $1, video_status = 'running', updated_at = NOW()
         WHERE job_id = $2 AND scene_number = $3`,
        [taskId, job.id, sc.scene_number]
      );
    } catch (err: any) {
      await pool.query(
        `UPDATE story_agent_scenes SET video_status = 'failed', error = $1, updated_at = NOW()
         WHERE job_id = $2 AND scene_number = $3`,
        [err?.message || 'submit failed', job.id, sc.scene_number]
      );
    }
  }

  // Poll pending videos
  const pending = await pool.query(
    `SELECT scene_number, video_kie_task_id FROM story_agent_scenes
     WHERE job_id = $1 AND video_status IN ('pending', 'running') AND video_kie_task_id IS NOT NULL
     ORDER BY scene_number ASC`,
    [job.id]
  );
  for (const sc of pending.rows) {
    const r = await pollKieTask(keys.kie_api_key, sc.video_kie_task_id);
    if (r.state === 'success' && r.url) {
      await pool.query(
        `UPDATE story_agent_scenes SET video_url = $1, video_status = 'success', updated_at = NOW()
         WHERE job_id = $2 AND scene_number = $3`,
        [r.url, job.id, sc.scene_number]
      );
    } else if (r.state === 'failed') {
      await pool.query(
        `UPDATE story_agent_scenes SET video_status = 'failed', error = $1, updated_at = NOW()
         WHERE job_id = $2 AND scene_number = $3`,
        [r.error || 'video failed', job.id, sc.scene_number]
      );
    }
  }

  // Check completion (only scenes with successful image)
  const settled = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE video_status = 'success')::int AS ok,
       COUNT(*) FILTER (WHERE video_status = 'failed')::int AS bad,
       COUNT(*) FILTER (WHERE image_status = 'success')::int AS image_ok
     FROM story_agent_scenes WHERE job_id = $1`,
    [job.id]
  );
  const { ok, bad, image_ok } = settled.rows[0];
  if (ok + bad === image_ok) {
    if (ok === 0) throw new Error('All scene videos failed');
    await setStage(job.id, 'assemble');
    await appendJobLog(job.id, '✅', `วิดีโอเสร็จ ${ok}/${image_ok}`);
  }
}

async function runAssemble(job: JobRow): Promise<void> {
  const sceneRows = await pool.query(
    `SELECT scene_number, script_text, voice_url, voice_duration, video_url
     FROM story_agent_scenes
     WHERE job_id = $1 AND video_status = 'success' AND voice_url IS NOT NULL
     ORDER BY scene_number ASC`,
    [job.id]
  );
  if (sceneRows.rowCount === 0) throw new Error('No completed scenes to assemble');
  await appendJobLog(job.id, '🎞️', `กำลังประกอบคลิป ${sceneRows.rowCount} ฉาก...`);
  const scenes: SceneInput[] = sceneRows.rows.map((r: any) => ({
    scene: r.scene_number,
    video_url: r.video_url,
    voice_url: r.voice_url,
    voice_duration: r.voice_duration || 6,
    caption_text: r.script_text,
  }));
  const result = await assembleClip({
    userId: job.user_id,
    jobId: job.id,
    scenes,
    uploadToDropbox: isDropboxConfigured(),
  });

  const finalUrl = result.dropboxVideoUrl || `file://${result.localVideoPath}`;
  await pool.query(
    `UPDATE story_agent_jobs
     SET final_video_url = $1, current_stage = 'post', updated_at = NOW()
     WHERE id = $2`,
    [finalUrl, job.id]
  );
  await appendJobLog(job.id, '✅', `ประกอบคลิปเสร็จ (${result.durationSec.toFixed(1)}s)`);

  // Stash local paths via JSONB for the post stage
  await pool.query(
    `UPDATE story_agent_jobs
     SET post_results = COALESCE(post_results, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [
      JSON.stringify({
        _local_video_path: result.localVideoPath,
        _local_cover_path: result.localCoverPath,
      }),
      job.id,
    ]
  );
}

async function runPost(job: JobRow, keys: UserKeys): Promise<void> {
  if (!keys.postforme_api_key) {
    // Posting is optional — skip and mark done
    await appendJobLog(job.id, '⏭️', 'ข้ามขั้นโพสต์ (ไม่ได้ตั้ง POSTFORME_API_KEY)');
    await pool.query(
      `UPDATE story_agent_jobs SET status = 'success', current_stage = 'done', updated_at = NOW() WHERE id = $1`,
      [job.id]
    );
    return;
  }

  // Generate captions if missing
  let captionFb = job.caption_fb;
  let captionTt = job.caption_tt;
  if (!captionFb || !captionTt) {
    if (!job.idea_json || !job.script_json) {
      throw new Error('idea_json or script_json missing — cannot generate captions');
    }
    const caps = await withCreditDeduction(
      job.user_id,
      job.id,
      'captions',
      `AI Agent captions — job ${job.id}`,
      () => generateCaptions(job.idea_json!, job.script_json!, job.language as Language, llmKeys(keys))
    );
    captionFb = caps.caption_fb;
    captionTt = caps.caption_tt;
    await pool.query(
      `UPDATE story_agent_jobs SET caption_fb = $1, caption_tt = $2, updated_at = NOW() WHERE id = $3`,
      [captionFb, captionTt, job.id]
    );
  }

  // Look up local paths stashed by assemble stage
  const pr = await pool.query(`SELECT post_results FROM story_agent_jobs WHERE id = $1`, [job.id]);
  const meta = pr.rows[0]?.post_results || {};
  const videoPath = meta._local_video_path;
  const coverPath = meta._local_cover_path;
  if (!videoPath || !coverPath) {
    throw new Error('local video/cover paths missing — re-run assemble');
  }

  // For MVP we don't yet know which FB/TT account IDs to use — leave as TODO.
  // User will configure these in profile (similar to other API keys) before posting works.
  await appendJobLog(
    job.id,
    '📝',
    'กำลังโพสต์ (ต้องตั้งค่า FB/TT account ID ในโปรไฟล์)'
  );

  const accountFb = process.env.POSTFORME_FACEBOOK_ACCOUNT_ID || '';
  const accountTt = process.env.POSTFORME_TIKTOK_ACCOUNT_ID || '';
  if (!accountFb && !accountTt) {
    await appendJobLog(job.id, '⏭️', 'ข้ามโพสต์ (ไม่มี POSTFORME_*_ACCOUNT_ID ใน env)');
    await pool.query(
      `UPDATE story_agent_jobs SET status = 'success', current_stage = 'done', updated_at = NOW() WHERE id = $1`,
      [job.id]
    );
    return;
  }

  const result = await publishPost({
    apiKey: keys.postforme_api_key,
    videoPath,
    coverPath,
    captionFacebook: captionFb || '',
    captionTiktok: captionTt || '',
    accounts: { facebook: accountFb || undefined, tiktok: accountTt || undefined },
  });

  await pool.query(
    `UPDATE story_agent_jobs
     SET post_results = $1::jsonb, status = 'success', current_stage = 'done', updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(result), job.id]
  );
  await appendJobLog(job.id, '✅', `โพสต์สำเร็จ — post_id ${result.post_id || 'n/a'}`);
}

// ---------- Main tick ----------

async function tick(): Promise<void> {
  let claimed: JobRow[];
  try {
    // Atomically claim up to N pending/running jobs
    const claim = await pool.query<JobRow>(
      `WITH next AS (
         SELECT id FROM story_agent_jobs
         WHERE status IN ('pending', 'running')
           AND current_stage NOT IN ('done', 'failed')
         ORDER BY updated_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE story_agent_jobs j
       SET status = 'running', updated_at = NOW()
       FROM next
       WHERE j.id = next.id
       RETURNING j.id, j.user_id, j.channel_id, j.topic, j.duration_sec, j.tone,
                 j.language, j.scene_count, j.current_stage, j.status,
                 j.idea_json, j.script_json, j.storyboard_json,
                 j.final_video_url, j.caption_fb, j.caption_tt, j.retry_count`,
      [MAX_JOBS_PER_TICK]
    );
    claimed = claim.rows;
  } catch (err: any) {
    console.error('[storyAgentRunner] claim error:', err?.message);
    return;
  }

  for (const job of claimed) {
    try {
      const keys = await getUserKeys(job.user_id);
      switch (job.current_stage) {
        case 'idea':
          await runIdea(job, keys);
          break;
        case 'script':
          await runScript(job, keys);
          break;
        case 'voice':
          await runVoice(job, keys);
          break;
        case 'storyboard':
          await runStoryboard(job, keys);
          break;
        case 'scene_image':
          await runSceneImage(job, keys);
          break;
        case 'scene_video':
          await runSceneVideo(job, keys);
          break;
        case 'assemble':
          await runAssemble(job);
          break;
        case 'post':
          await runPost(job, keys);
          break;
        default:
          console.warn(`[storyAgentRunner] job ${job.id} unknown stage '${job.current_stage}'`);
      }
    } catch (err: any) {
      console.error(`[storyAgentRunner] job ${job.id} stage '${job.current_stage}' failed:`, err?.message);
      await markFailed(job.id, `Stage ${job.current_stage}: ${err?.message || 'unknown'}`);
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startStoryAgentRunner(): void {
  if (timer) return;
  console.log(`[storyAgentRunner] starting (tick every ${TICK_MS / 1000}s)`);
  tick();
  timer = setInterval(tick, TICK_MS);
}

export function stopStoryAgentRunner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
