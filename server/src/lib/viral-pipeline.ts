import pool from '../db.js';
import { uploadLocalFileToDropbox, uploadVideoToDropbox, isDropboxConfigured } from '../utils/dropbox.js';
import { applyWatermark, type WatermarkSettings } from '../utils/watermark.js';

import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import FormDataLib from 'form-data';
// @ts-ignore - ffmpeg-static types don't match ESM default export
import _ffmpegStatic from 'ffmpeg-static';
const ffmpegPath: string = typeof _ffmpegStatic === 'string' ? _ffmpegStatic : 'ffmpeg';
// @ts-ignore - probe-image-size has no published types
import probeImageSize from 'probe-image-size';

// Kie Grok image-to-video supports exactly these 5 aspect ratios.
// Used by templates (e.g. "add-character-in-movie") that want output sized to match the user's reference image.
type KieAspectRatio = '16:9' | '3:2' | '1:1' | '2:3' | '9:16';

/**
 * Snap an arbitrary width/height ratio to one of Kie's 5 supported aspect_ratio values.
 * Buckets are nearest-match against the canonical ratio numerics.
 */
function snapToKieAspectRatio(width: number, height: number): KieAspectRatio {
  if (!width || !height || width <= 0 || height <= 0) return '16:9';
  const r = width / height;
  if (r >= 1.7) return '16:9';
  if (r >= 1.3) return '3:2';
  if (r >= 0.85) return '1:1';
  if (r >= 0.55) return '2:3';
  return '9:16';
}

/**
 * Probe an image URL (HTTP HEAD-style range download) and return the Kie-supported
 * aspect_ratio bucket that best matches its native dimensions. Falls back to '16:9'
 * (Kie's own default) on any error.
 */
async function detectKieAspectRatio(imageUrl: string): Promise<KieAspectRatio> {
  try {
    const result: any = await probeImageSize(imageUrl, { timeout: 15_000 });
    return snapToKieAspectRatio(result?.width, result?.height);
  } catch {
    return '16:9';
  }
}

const POLL_INTERVAL_MS = 5000;
const MAX_CONSECUTIVE_ERRORS = 10;
const MAX_POLL_ATTEMPTS = 360; // 360 * 5s = 30 นาที (ป้องกัน infinite loop)
const KIE_FILE_BASE = 'https://kieai.redpandaai.co';

/**
 * Re-host an external image URL (e.g. Dropbox) onto KIE's file storage so it can be
 * used as input for Grok image-to-video (which only accepts KIE-hosted URLs).
 * Used only by direct_video_from_ref templates (e.g. "ลิง").
 */
async function rehostUrlToKie(url: string, apiKey: string, scene: number): Promise<string> {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60_000, validateStatus: () => true });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Failed to download reference image for scene ${scene}: HTTP ${resp.status}`);
  }
  const buffer = Buffer.from(resp.data);
  const mimetype: string = resp.headers['content-type'] || 'image/jpeg';
  const ext = mimetype.includes('png') ? 'png' : mimetype.includes('webp') ? 'webp' : 'jpg';
  const fileName = `scene-${scene}-${Date.now()}.${ext}`;

  const fd = new FormDataLib();
  fd.append('file', buffer, { filename: fileName, contentType: mimetype });
  fd.append('uploadPath', 'images/viral-direct-ref');
  fd.append('fileName', fileName);

  const { data: result, status } = await axios.post(
    `${KIE_FILE_BASE}/api/file-stream-upload`,
    fd,
    {
      headers: { Authorization: `Bearer ${apiKey}`, ...fd.getHeaders() },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: () => true,
    }
  );
  if (status < 200 || status >= 300) {
    throw new Error(result?.msg || `KIE file upload failed for scene ${scene}: HTTP ${status}`);
  }
  const fileUrl = result?.data?.fileUrl || result?.data?.downloadUrl || result?.data?.url || result?.fileUrl || result?.downloadUrl;
  if (!fileUrl) throw new Error(`KIE upload returned no URL for scene ${scene}`);
  return fileUrl as string;
}

// ============================================
// Template System Prompts
// ============================================

// Template cache (slug -> config) to avoid querying DB every time
interface TemplateCache {
  system_prompt: string;
  template_variables: any[];
  fetchedAt: number;
}
const templateCache: Map<string, TemplateCache> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getTemplateConfig(templateSlug: string): Promise<{ system_prompt: string; template_variables: any[] }> {
  const cached = templateCache.get(templateSlug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { system_prompt: cached.system_prompt, template_variables: cached.template_variables };
  }

  const result = await pool.query(
    'SELECT system_prompt, template_variables FROM viral_templates WHERE slug = $1',
    [templateSlug]
  );
  if (result.rows.length === 0) throw new Error(`Template "${templateSlug}" not found in database`);

  const { system_prompt, template_variables } = result.rows[0];
  templateCache.set(templateSlug, { system_prompt, template_variables: template_variables || [], fetchedAt: Date.now() });
  return { system_prompt, template_variables: template_variables || [] };
}

// Build user message from task_variables + template_variables
function buildUserMessageFromVariables(
  templateVars: any[],
  taskVars: Record<string, any>,
  sceneCount: number,
  language: string
): string {
  const langText = language === 'th' ? 'ภาษาไทย' : 'English';
  const enabledVars = templateVars.filter((v: any) => v.enabled !== false);
  const lines: string[] = [];

  for (const varDef of enabledVars) {
    // ลองหลายรูปแบบของ key: ตรงๆ / hyphen / underscore / lowercase / label
    const keyCandidates = [
      varDef.key,
      varDef.key?.replace(/_/g, '-'),
      varDef.key?.replace(/-/g, '_'),
      varDef.key?.toLowerCase(),
      varDef.key?.toLowerCase().replace(/_/g, '-'),
      varDef.key?.toLowerCase().replace(/-/g, '_'),
      varDef.label,
      varDef.label?.toLowerCase().replace(/\s+/g, '-'),
      varDef.label?.toLowerCase().replace(/\s+/g, '_'),
    ].filter(Boolean);
    let value: any = undefined;
    for (const k of keyCandidates) {
      if (taskVars[k] !== undefined) { value = taskVars[k]; break; }
    }
    if (!value) continue;

    if (varDef.per_scene && Array.isArray(value)) {
      // Per-scene variable: list each scene's value
      lines.push(`${varDef.label}:`);
      value.forEach((v: string, i: number) => {
        lines.push(`  ฉาก ${i + 1}: ${v}`);
      });
    } else {
      // Single variable for all scenes
      lines.push(`${varDef.label}: ${value}`);
    }
  }

  lines.push(`จำนวนฉาก: ${sceneCount}`);
  lines.push(`ภาษา Dialogue: ${langText}`);
  return lines.join('\n');
}

// ============================================
// Helper: Get user API keys
// ============================================

async function getUserApiKeys(userId: number): Promise<{ openrouterApiKey: string; kieApiKey: string }> {
  const result = await pool.query(
    'SELECT openrouter_api_key, kie_api_key FROM users WHERE id = $1',
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new Error('User not found');
  if (!user.openrouter_api_key) throw new Error('กรุณาตั้งค่า OpenRouter API Key ในหน้า Settings ก่อน');
  if (!user.kie_api_key) throw new Error('กรุณาตั้งค่า KIE API Key ในหน้า Settings ก่อน');
  return { openrouterApiKey: user.openrouter_api_key, kieApiKey: user.kie_api_key };
}

// ============================================
// Helper: Append log entry to task
// ============================================

// Cache: viral task id → { queue_id, user_id } เพื่อไม่ต้อง query ทุกครั้ง
const taskQueueCache = new Map<number, { queue_id: number; user_id: number } | null>();

async function getQueueLink(taskId: number): Promise<{ queue_id: number; user_id: number } | null> {
  if (taskQueueCache.has(taskId)) return taskQueueCache.get(taskId)!;
  try {
    const r = await pool.query(
      `SELECT sq.id as queue_id, sq.user_id FROM schedule_queue sq
       JOIN viral_template_tasks vt ON sq.external_task_id = 'viral-' || vt.job_id::text || '-' || vt.id::text
       WHERE vt.id = $1 LIMIT 1`,
      [taskId]
    );
    const link = r.rows.length > 0 ? r.rows[0] : null;
    taskQueueCache.set(taskId, link);
    return link;
  } catch {
    return null;
  }
}

async function appendLog(taskId: number, emoji: string, text: string) {
  const entry = [{ time: new Date().toISOString(), emoji, text }];
  // เขียนลง viral_template_tasks.logs (สำหรับหน้า Viral Template ตรง)
  await pool.query(
    `UPDATE viral_template_tasks SET logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [JSON.stringify(entry), taskId]
  );

  // เขียนลง scheduler_activity_logs ด้วย เพื่อให้หน้า Schedule + DayDetail เห็น log
  const link = await getQueueLink(taskId);
  if (link) {
    // แยก log_type ตาม emoji
    const logType = emoji.includes('❌') || emoji.includes('💥') ? 'error'
      : emoji.includes('⚠️') ? 'warning'
      : emoji.includes('✅') || emoji.includes('🎉') ? 'success'
      : 'info';
    try {
      await pool.query(
        `INSERT INTO scheduler_activity_logs (user_id, queue_item_id, message, log_type)
         VALUES ($1, $2, $3, $4)`,
        [link.user_id, link.queue_id, `${emoji} ${text}`, logType]
      );
    } catch (_) { /* ไม่ให้ log error หยุด pipeline */ }
  }
}

// ============================================
// Helper: Update task status in DB
// ============================================

async function updateTaskStatus(taskId: number, updates: Record<string, any>) {
  const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(`${key} = $${idx}`);
    values.push(key === 'ai_prompts' || key === 'image_tasks' || key === 'video_tasks'
      ? JSON.stringify(value) : value);
    idx++;
  }

  values.push(taskId);
  await pool.query(
    `UPDATE viral_template_tasks SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values
  );
}

// ============================================
// Helper: KIE create task + poll
// ============================================

interface KieTaskResult {
  success: boolean;
  taskId?: string;
  resultUrl?: string;
  error?: string;
}

async function kieCreateAndPoll(
  apiKey: string,
  model: string,
  input: Record<string, any>,
  label: string,
  dbTaskId?: number,
  onTaskCreated?: (kieTaskId: string) => Promise<void>,
  existingTaskId?: string
): Promise<KieTaskResult> {
  let taskId: string;

  if (existingTaskId) {
    // Resume polling for existing KIE task (e.g. after server restart)
    console.log(`[Viral:${label}] Resuming poll for existing task: ${existingTaskId}`);
    if (dbTaskId) await appendLog(dbTaskId, '🔄', `${label}: Resume Task ID: ${existingTaskId} — รอประมวลผล...`);
    taskId = existingTaskId;
  } else {
    console.log(`[Viral:${label}] Creating KIE task...`);

    let createResponse: Response | null = null;
    const MAX_CREATE_RETRIES = 3;
    for (let createAttempt = 1; createAttempt <= MAX_CREATE_RETRIES; createAttempt++) {
      createResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input }),
      });

      if (createResponse.ok) break;

      const isRetryable = createResponse.status >= 500 || createResponse.status === 429;
      if (isRetryable && createAttempt < MAX_CREATE_RETRIES) {
        const delay = 5000 * createAttempt;
        console.log(`[Viral:${label}] KIE createTask HTTP ${createResponse.status}, retry in ${delay / 1000}s (${createAttempt}/${MAX_CREATE_RETRIES})...`);
        if (dbTaskId) await appendLog(dbTaskId, '⏳', `${label}: KIE ไม่ว่าง (${createResponse.status}) รอ ${delay / 1000}s แล้ว retry...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      const error = await createResponse.text();
      return { success: false, error: `KIE error (${createResponse.status}): ${error}` };
    }

    const createData: any = await createResponse!.json();

    if (createData.data?.state === 'fail' || createData.state === 'fail') {
      const failMsg = createData.data?.failMsg || createData.failMsg || 'Unknown';
      console.error(`[Viral:${label}] KIE rejected (state=fail):`, JSON.stringify(createData));
      return { success: false, error: `KIE rejected: ${failMsg}` };
    }

    if (createData.code && createData.code !== 0 && createData.code !== 200) {
      const apiError = createData.msg || `API error code: ${createData.code}`;
      // Log raw response so we can diagnose false-positive "credit" matches
      console.error(`[Viral:${label}] KIE error response: code=${createData.code}, msg="${apiError}", raw=`, JSON.stringify(createData));
      // Match "insufficient credit" / "no credit" / "credit exhausted" — not just any "credit" mention
      const lowerMsg = apiError.toLowerCase();
      const isCreditError = /insufficient|not enough|exhausted|no credit|balance/.test(lowerMsg) && lowerMsg.includes('credit');
      if (isCreditError) {
        return { success: false, error: `💳 KIE Credit หมด — ${apiError} (กรุณาเติม Credit ที่ kie.ai)` };
      }
      return { success: false, error: `KIE error: ${apiError} (code=${createData.code})` };
    }

    const newTaskId = createData.data?.taskId;
    if (!newTaskId) {
      return { success: false, error: 'No task ID returned from KIE' };
    }
    taskId = newTaskId;

    console.log(`[Viral:${label}] Task created: ${taskId}, polling...`);
    if (dbTaskId) await appendLog(dbTaskId, '🔄', `${label}: Task ID: ${taskId} — รอประมวลผล...`);

    // Persist kie_task_id to DB immediately (so we can resume polling if server restarts)
    if (onTaskCreated) {
      try {
        await onTaskCreated(taskId);
      } catch (cbErr: any) {
        console.error(`[Viral:${label}] onTaskCreated callback failed:`, cbErr.message);
      }
    }
  }

  // Poll for completion
  let consecutiveErrors = 0;
  const pollStartTime = Date.now();
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const statusResponse = await fetch(
        `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } }
      );

      if (!statusResponse.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return { success: false, error: `KIE polling failed (${MAX_CONSECUTIVE_ERRORS} consecutive errors)` };
        }
        continue;
      }

      consecutiveErrors = 0;
      const statusRaw: any = await statusResponse.json();
      const statusData = statusRaw.data || statusRaw;

      if (statusData.state === 'success') {
        let resultUrl: string | null = null;
        // Try nested resultJson first
        if (statusData.resultJson) {
          try {
            const resultData = typeof statusData.resultJson === 'string'
              ? JSON.parse(statusData.resultJson)
              : statusData.resultJson;
            resultUrl = resultData.resultUrls?.[0] || resultData.url || resultData.videoUrl || null;
          } catch {}
        }
        // Try top-level fields + response.resultUrls (KIE schema variations)
        if (!resultUrl) {
          resultUrl = statusData.resultUrl || statusData.videoUrl || statusData.url
            || statusData.resultUrls?.[0] || statusData.response?.resultUrls?.[0] || null;
        }
        if (resultUrl) {
          console.log(`[Viral:${label}] ✅ Done! URL: ${resultUrl}`);
          return { success: true, taskId, resultUrl };
        }
        // state=success แต่หา URL ไม่เจอ → log raw response ช่วย diagnose
        console.error(`[Viral:${label}] state=success but no URL. Raw:`, JSON.stringify(statusRaw));
        if (attempt > 2) {
          if (dbTaskId) await appendLog(dbTaskId, '⚠️', `${label}: KIE success แต่หา URL ไม่เจอ — ดู server log`);
          return { success: false, error: `KIE state=success but no URL field found (taskId=${taskId})` };
        }
      }

      if (statusData.state === 'fail' && statusData.failMsg !== 'success') {
        return { success: false, error: statusData.failMsg || 'Task failed' };
      }

      if (attempt % 6 === 0 && attempt > 0) {
        console.log(`[Viral:${label}] Still processing... state=${statusData.state} (attempt ${attempt + 1})`);
        if (dbTaskId) await appendLog(dbTaskId, '⏳', `${label}: ยังประมวลผลอยู่... (${Math.round((attempt * POLL_INTERVAL_MS) / 1000)}s)`);
      }
    } catch (pollError: any) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return { success: false, error: `KIE polling crashed: ${pollError.message}` };
      }
    }
  }

  // Hard timeout — prevent infinite polling
  const elapsed = Math.round((Date.now() - pollStartTime) / 1000);
  console.error(`[Viral:${label}] Polling timeout after ${elapsed}s (taskId=${taskId})`);
  if (dbTaskId) await appendLog(dbTaskId, '⏰', `${label}: รอเกิน ${Math.round(elapsed / 60)} นาที — timeout (task ${taskId} อาจยังประมวลผลที่ KIE)`);
  return {
    success: false,
    error: `KIE polling timeout หลัง ${elapsed}s — task ${taskId} อาจยังประมวลผลอยู่ที่ KIE`
  };
}

// ============================================
// Step 1: Generate AI Prompts via OpenRouter
// ============================================

interface ScenePrompt {
  scene: number;
  scene_name: string;
  image_prompt: string;
  video_prompt: string;
}

async function generateScenePrompts(
  openrouterApiKey: string,
  templateSlug: string,
  characterName: string,
  sceneCount: number,
  language: string,
  policyRetry = false,
  characterNames?: string[],
  taskVariables?: Record<string, any>,
  customSystemPrompt?: string
): Promise<ScenePrompt[]> {
  let rawSystemPrompt: string;
  let templateVars: any[] = [];
  if (customSystemPrompt && (templateSlug === 'custom' || templateSlug === 'scheduler')) {
    // Custom prompt mode — no template in DB, use provided prompt directly
    rawSystemPrompt = customSystemPrompt;
    // Scheduler path: สร้าง templateVars จาก taskVariables keys เพื่อให้ buildUserMessageFromVariables ทำงานได้
    if (taskVariables && Object.keys(taskVariables).length > 0) {
      templateVars = Object.keys(taskVariables).map(key => ({
        key, label: key, enabled: true, per_scene: Array.isArray(taskVariables[key])
      }));
    }
  } else {
    const templateConfig = await getTemplateConfig(templateSlug);
    rawSystemPrompt = customSystemPrompt || templateConfig.system_prompt;
    templateVars = templateConfig.template_variables;
  }

  // Auto-inject variable definitions into system prompt if template has variables with descriptions
  let systemPrompt = rawSystemPrompt;
  const enabledVars = templateVars?.filter((v: any) => v.enabled !== false && v.description) || [];
  if (enabledVars.length > 0) {
    const varDefs = enabledVars.map((v: any) => `[${v.label}]: ${v.description}`).join('\n');
    systemPrompt += `\n\nInput Variables:\n${varDefs}`;
  }

  // Append reference image instruction if user attached reference images (global or per-scene)
  const hasGlobalRefImages = taskVariables && ['character_image', 'outfit_image', 'background_image', 'movie_scene_image'].some(k => taskVariables[k]);
  const hasPerSceneRefImages = taskVariables && Object.keys(taskVariables).some(k => /^(character_image|outfit_image|background_image|movie_scene_image)_\d+$/.test(k));
  if (hasGlobalRefImages) {
    const parts: string[] = [];
    // Order matches the image_urls order sent to the video/image model:
    // movie_scene (base) → character → outfit → background
    if (taskVariables!['movie_scene_image']) parts.push('use the movie scene composition and KEEP ALL existing characters from the attached reference image ' + (parts.length + 1));
    if (taskVariables!['character_image']) parts.push('add the character (preserve exact face, body, hair, outfit, species) from the attached reference image ' + (parts.length + 1));
    if (taskVariables!['outfit_image']) parts.push('clothing and accessories from the attached reference image ' + (parts.length + 1));
    if (taskVariables!['background_image']) parts.push('background from the attached reference image ' + (parts.length + 1));
    systemPrompt += '\n\n⚠️ IMPORTANT: In every image_prompt, ' + parts.join(', ') + '.';
  } else if (hasPerSceneRefImages) {
    systemPrompt += '\n\n⚠️ IMPORTANT: Each scene has its own reference images attached. In every image_prompt, strictly use the exact face, hairstyle, clothing, accessories, and background from the attached reference images for that scene.';
  }

  let userMessage: string;

  // New flexible variable system: use task_variables if template has template_variables defined
  if (taskVariables && Object.keys(taskVariables).length > 0 && templateVars && templateVars.length > 0) {
    userMessage = buildUserMessageFromVariables(templateVars, taskVariables, sceneCount, language);
  } else if (characterNames && characterNames.length > 0) {
    // Legacy multi-character mode (Baby Food Feast)
    const langText = language === 'th' ? 'ภาษาไทย' : 'English';
    const menuList = characterNames.map((name, i) => `ฉาก ${i + 1}: ${name}`).join('\n');
    userMessage = `จำนวนฉาก: ${sceneCount}\nรายการเมนู:\n${menuList}\nภาษา Dialogue: ${langText}`;
  } else {
    // Legacy single-character mode (Rebellion)
    const langText = language === 'th' ? 'ภาษาไทย' : 'English';
    userMessage = `ตัวละคร: ${characterName}\nจำนวนฉาก: ${sceneCount}\nภาษา Dialogue: ${langText}`;
  }

  if (policyRetry) {
    userMessage += `\n\n⚠️ IMPORTANT: Prompt ครั้งก่อนถูกบล็อกเพราะผิด Content Policy ของเว็บสร้างภาพ/วิดีโอ\nกรุณาเขียน image_prompt และ video_prompt ใหม่ที่หลีกเลี่ยงคำที่อาจถูก flag เช่น คำเกี่ยวกับความรุนแรง/เปลือย/อาวุธ\nใช้คำอ้อมค้อมมากขึ้น เน้นตลก/น่ารัก/ไม่มีเนื้อหารุนแรง\nห้ามใช้คำว่า condom, latex, rubber, nude, naked, weapon ใน prompt`;
  }

  // Always append JSON format instruction
  const jsonInstruction = `\n\n⚠️ ตอบเป็น JSON array เท่านั้น ห้ามมี text อื่นนอก JSON:\n[{"scene":1,"scene_name":"...","image_prompt":"...","video_prompt":"..."}]`;
  userMessage += jsonInstruction;

  const displayName = taskVariables && Object.keys(taskVariables).length > 0
    ? Object.values(taskVariables).flat().filter(Boolean).join(', ')
    : (characterNames && characterNames.length > 0 ? characterNames.join(', ') : characterName);
  console.log(`[Viral:AI] Calling OpenRouter for "${displayName}" (${sceneCount} scenes, ${language})...`);

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const callAI = async (msgs: any[]) => {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openrouterApiKey}` },
      body: JSON.stringify({ model: 'google/gemini-3-flash-preview', messages: msgs, temperature: 1.0 }),
    });
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`OpenRouter error (${resp.status}): ${errorText}`);
    }
    const d: any = await resp.json();
    return d.choices?.[0]?.message?.content || '';
  };

  let content = await callAI(messages);
  if (!content) throw new Error('No content from OpenRouter');

  // Parse JSON from content (might have markdown code fences)
  let jsonMatch = content.match(/\[[\s\S]*\]/);

  // Fallback: if AI didn't return JSON, ask it to convert
  if (!jsonMatch) {
    console.log(`[Viral:AI] Response not JSON, sending follow-up to convert...`);
    messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: 'แปลงคำตอบข้างบนเป็น JSON array เท่านั้น ห้ามมี text อื่น:\n[{"scene":1,"scene_name":"...","image_prompt":"...","video_prompt":"..."}]' });
    content = await callAI(messages);
    jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error(`Cannot parse scene prompts from AI response. Content: ${content.substring(0, 500)}`);
  }

  const scenes: ScenePrompt[] = JSON.parse(jsonMatch[0]);
  console.log(`[Viral:AI] ✅ Got ${scenes.length} scenes`);
  return scenes;
}

// ============================================
// Helper: Regenerate ONLY video_prompt for failed scenes
// ============================================

async function regenerateVideoPrompts(
  openrouterApiKey: string,
  failedScenes: { scene: number; oldPrompt: string }[],
  characterName: string,
  language: string
): Promise<{ scene: number; video_prompt: string }[]> {
  const langText = language === 'th' ? 'ภาษาไทย' : 'English';
  const scenesDesc = failedScenes.map(s => `ฉาก ${s.scene}: "${s.oldPrompt}"`).join('\n');

  const systemPrompt = `คุณคือผู้เชี่ยวชาญเขียน Video Prompt สำหรับ 3D CGI Animation สไตล์ Pixar/Disney
หน้าที่: เขียน video_prompt ใหม่ที่ปลอดภัยจาก Content Policy โดย:
- ห้ามใช้คำว่า condom, latex, rubber, nude, naked, weapon, blood, kill, die, sex, drug
- ห้ามอธิบายชุด/เสื้อผ้าที่อาจถูก flag
- เน้นการเคลื่อนไหว อารมณ์ตลก และบทพูดเป็นหลัก
- Video Prompt format: "a high-quality 3D CGI [ลักษณะตัวละครสั้นๆ] in [มุมกล้อง]. [Action]. Lip-sync perfectly to the ${langText} dialogue: '[บทพูด]' Voice tone: [โทนเสียง]. Strictly no text, no subtitles, no watermarks."

ตอบเป็น JSON array เท่านั้น:
[{"scene": 1, "video_prompt": "..."}]`;

  const userMessage = `ตัวละคร: ${characterName}
Video prompt เดิมที่ถูกบล็อกเพราะผิด Content Policy:
${scenesDesc}

กรุณาเขียน video_prompt ใหม่ที่ปลอดภัยกว่า แต่ยังคงเนื้อเรื่อง/บทพูดเดิม (แก้แค่คำอธิบายภาพให้ปลอดภัย)`;

  console.log(`[Viral:AI] Regenerating video prompts for ${failedScenes.length} failed scene(s)...`);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterApiKey}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content from OpenRouter for video prompt regen');

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Cannot parse regen video prompts. Content: ${content.substring(0, 500)}`);

  const results: { scene: number; video_prompt: string }[] = JSON.parse(jsonMatch[0]);
  console.log(`[Viral:AI] ✅ Regenerated ${results.length} video prompts`);
  return results;
}

const MAX_POLICY_RETRIES = 3;

function isPolicyError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes('policy') ||
    lower.includes('policies') ||
    lower.includes('flagged') ||
    lower.includes('filtered') ||
    lower.includes('violat') ||
    // KIE content moderation variants
    lower.includes('failed the review') ||
    lower.includes('content review') ||
    lower.includes('review failed') ||
    lower.includes('check your input') ||
    lower.includes('inappropriate') ||
    lower.includes('moderation') ||
    lower.includes('not safe') ||
    lower.includes('nsfw') ||
    lower.includes('rejected by') ||
    lower.includes('sensitive content') ||
    lower.includes('prohibited') ||
    lower.includes('forbidden')
  );
}

/**
 * KIE sometimes returns a generic "Server exception, please try again later" for specific
 * prompt+image combos that persistently fail (not a flat outage — new tasks succeed).
 * After inner retries exhaust with this error, regenerating the image usually unblocks it.
 */
function isPersistentServerError(error: string): boolean {
  const lower = error.toLowerCase();
  return lower.includes('server exception') || lower.includes('try again later');
}

// ============================================
// Step 2: Generate Images (all scenes parallel)
// ============================================

async function generateImages(
  kieApiKey: string,
  scenes: ScenePrompt[],
  taskId: number,
  userId: number,
  refImageUrls?: string[],
  perSceneRefImages?: Record<number, string[]>
): Promise<SceneProgress[]> {
  console.log(`[Viral:Image] Generating ${scenes.length} images in parallel...`);

  const MAX_RETRIES = 3;

  const results = await Promise.allSettled(
    scenes.map(async (scene) => {
      let lastError = '';
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // Check if we have an existing KIE task ID to resume (from pre-restart)
        const taskRowForResume = await pool.query('SELECT image_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
        const existingImgForScene = (taskRowForResume.rows[0]?.image_tasks || []).find((i: any) => i.scene === scene.scene);
        const resumeKieTaskId = (attempt === 1 && existingImgForScene?.kie_task_id && existingImgForScene?.status !== 'done')
          ? existingImgForScene.kie_task_id as string
          : undefined;

        if (attempt > 1) {
          await appendLog(taskId, '🔄', `Retry ภาพ ฉาก ${scene.scene} (ครั้งที่ ${attempt})...`);
        } else if (resumeKieTaskId) {
          await appendLog(taskId, '♻️', `Resume ภาพ ฉาก ${scene.scene} (KIE Task: ${resumeKieTaskId})...`);
        } else {
          await appendLog(taskId, '🖼️', `ส่งสร้างภาพ ฉาก ${scene.scene} ไป KIE...`);
        }

        // Use per-scene images if available (scene index is 0-based: scene.scene - 1), fallback to global
        const sceneRefUrls = perSceneRefImages?.[scene.scene - 1] ?? refImageUrls;
        const result = await kieCreateAndPoll(kieApiKey, 'nano-banana-2', {
          prompt: scene.image_prompt,
          ...(sceneRefUrls && sceneRefUrls.length > 0 ? { image_input: sceneRefUrls } : {}),
          aspect_ratio: '9:16',
          resolution: '1K',
          output_format: 'jpg',
        }, `Image-S${scene.scene}${attempt > 1 ? `-retry${attempt}` : ''}`, taskId,
          // onTaskCreated: persist kie_task_id ทันทีเพื่อ resume หลัง restart
          async (kieTaskId: string) => {
            const t = await pool.query('SELECT image_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
            const iTasks = t.rows[0]?.image_tasks || [];
            const idx = iTasks.findIndex((x: any) => x.scene === scene.scene);
            const entry = { scene: scene.scene, kie_task_id: kieTaskId, status: 'pending', image_url: null, kie_image_url: null };
            if (idx >= 0) iTasks[idx] = { ...iTasks[idx], ...entry };
            else iTasks.push(entry);
            await updateTaskStatus(taskId, { image_tasks: iTasks });
          },
          resumeKieTaskId
        );

        const progress: any = {
          scene: scene.scene,
          kie_task_id: result.taskId || null,
          status: result.success ? 'done' : 'failed',
          image_url: result.resultUrl || null,
          kie_image_url: result.resultUrl || null, // Always keep original KIE URL for img2vid
        };

        // Update DB progressively
        const task = await pool.query('SELECT image_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
        const imageTasks = task.rows[0]?.image_tasks || [];
        const idx = imageTasks.findIndex((t: any) => t.scene === scene.scene);
        if (idx >= 0) imageTasks[idx] = progress;
        else imageTasks.push(progress);
        await updateTaskStatus(taskId, { image_tasks: imageTasks });

        if (result.success) {
          // Persist image to Dropbox (for permanent storage/display)
          if (progress.image_url && isDropboxConfigured() && !progress.image_url.includes('dropbox.com')) {
            try {
              const imgPath = `/trippleviral/viral/${userId}/${taskId}_scene${scene.scene}.jpg`;
              const { sharedUrl } = await uploadVideoToDropbox(progress.image_url, userId, taskId, imgPath);
              // DB stores Dropbox URL for display, but kie_image_url stays as KIE URL
              const freshTask = await pool.query('SELECT image_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
              const freshImgTasks = freshTask.rows[0]?.image_tasks || [];
              const freshIdx = freshImgTasks.findIndex((t: any) => t.scene === scene.scene);
              if (freshIdx >= 0) freshImgTasks[freshIdx].image_url = sharedUrl;
              await updateTaskStatus(taskId, { image_tasks: freshImgTasks });
              await appendLog(taskId, '📦', `ฉาก ${scene.scene} บันทึกภาพไป Dropbox แล้ว`);
            } catch (dbxErr: any) {
              console.error(`[Viral:Dropbox] Image scene ${scene.scene} upload failed:`, dbxErr.message);
              await appendLog(taskId, '⚠️', `ฉาก ${scene.scene} Dropbox ล้มเหลว ใช้ URL เดิม`);
            }
          }

          await appendLog(taskId, '✅', `ฉาก ${scene.scene} สร้างภาพสำเร็จ`);
          return progress;
        }

        lastError = result.error || 'Unknown error';
        await appendLog(taskId, '❌', `ฉาก ${scene.scene} ภาพล้มเหลว: ${lastError.substring(0, 80)}`);
        const lowerError = lastError.toLowerCase();
        const isPolicyErr = isPolicyError(lastError);
        const isTransientError = lowerError.includes('unavailable') || lowerError.includes('high demand')
          || lowerError.includes('rate limit') || lowerError.includes('timeout')
          || lowerError.includes('too many requests') || /kie error \(5\d\d\)/.test(lowerError)
          || lowerError.includes('server exception') || lowerError.includes('try again later');

        if ((isPolicyErr || isTransientError) && attempt < MAX_RETRIES) {
          if (isTransientError) {
            const delay = 5000 * Math.pow(2, attempt - 1); // 5s, 10s, 20s exponential backoff
            await appendLog(taskId, '⏳', `ฉาก ${scene.scene} รอ ${delay / 1000}s แล้ว retry...`);
            await new Promise(r => setTimeout(r, delay));
          }
          continue;
        }
        break;
      }
      throw new Error(lastError);
    })
  );

  const imageProgress: any[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      imageProgress.push(r.value);
    } else {
      imageProgress.push({ scene: 0, status: 'failed', error: r.reason?.message });
    }
  }

  const failedScenes = imageProgress.filter(p => p.status === 'failed');
  if (failedScenes.length > 0) {
    throw new Error(`Image generation failed for ${failedScenes.length} scene(s): ${failedScenes.map(f => f.error || 'unknown').join(', ')}`);
  }

  return imageProgress;
}

// ============================================
// Step 3: Generate Videos (all scenes parallel)
// ============================================

interface SceneProgress {
  scene: number;
  kie_task_id?: string;
  status: string;
  image_url?: string;
  video_url?: string;
}

async function generateVideos(
  kieApiKey: string,
  scenes: ScenePrompt[],
  imageResults: SceneProgress[],
  taskId: number,
  userId: number,
  aspectRatio: string = '9:16',
  mode: string = 'spicy'
): Promise<SceneProgress[]> {
  // Check existing video progress to skip already-done scenes
  const taskRow = await pool.query('SELECT video_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
  const existingVideos: any[] = taskRow.rows[0]?.video_tasks || [];

  const scenesToGenerate = scenes.filter(scene => {
    const existing = existingVideos.find((v: any) => v.scene === scene.scene);
    return !existing || existing.status !== 'done' || !existing.video_url;
  });

  console.log(`[Viral:Video] Generating ${scenesToGenerate.length}/${scenes.length} videos (${scenes.length - scenesToGenerate.length} already done)...`);

  const MAX_RETRIES = 3;

  const results = await Promise.allSettled(
    scenesToGenerate.map(async (scene) => {
      const imageResult = imageResults.find(r => r.scene === scene.scene);
      // Prefer kie_image_urls (array, multi-image for direct_video_from_ref) → kie_image_url (single)
      // → image_url (if not Dropbox). Never send Dropbox URL to KIE.
      let imageUrlsForKie: string[] = [];
      const multiKieUrls = (imageResult as any)?.kie_image_urls;
      if (Array.isArray(multiKieUrls) && multiKieUrls.length > 0) {
        imageUrlsForKie = multiKieUrls.filter((u: any) => typeof u === 'string' && u);
      } else if ((imageResult as any)?.kie_image_url) {
        imageUrlsForKie = [(imageResult as any).kie_image_url];
      } else if (imageResult?.image_url && !imageResult.image_url.includes('dropbox.com')) {
        imageUrlsForKie = [imageResult.image_url];
      }
      // If only Dropbox URL available (old task), need to re-generate image
      if (imageUrlsForKie.length === 0) {
        await appendLog(taskId, '⚠️', `ฉาก ${scene.scene} ไม่มี KIE URL — ต้อง regen ภาพ`);
        throw new Error(`No KIE image URL for scene ${scene.scene} (only Dropbox URL available, need to regenerate image)`);
      }

      let lastError = '';
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // Check if we have an existing KIE task ID to resume (from pre-restart)
        const taskRowForResume = await pool.query('SELECT video_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
        const existingVidForScene = (taskRowForResume.rows[0]?.video_tasks || []).find((v: any) => v.scene === scene.scene);
        const resumeKieTaskId = (attempt === 1 && existingVidForScene?.kie_task_id && existingVidForScene?.status !== 'done')
          ? existingVidForScene.kie_task_id as string
          : undefined;

        if (attempt > 1) {
          await appendLog(taskId, '🔄', `Retry VDO ฉาก ${scene.scene} (ครั้งที่ ${attempt})...`);
        } else if (resumeKieTaskId) {
          await appendLog(taskId, '♻️', `Resume VDO ฉาก ${scene.scene} (KIE Task: ${resumeKieTaskId})...`);
        } else {
          await appendLog(taskId, '📺', `ส่งสร้าง VDO ฉาก ${scene.scene} ไป KIE...`);
        }

        const result = await kieCreateAndPoll(kieApiKey, 'grok-imagine/image-to-video', {
          image_urls: imageUrlsForKie,
          prompt: scene.video_prompt,
          mode,
          aspect_ratio: aspectRatio,
          duration: 10,
          resolution: '720p',
        }, `Video-S${scene.scene}${attempt > 1 ? `-retry${attempt}` : ''}`, taskId,
          // onTaskCreated: persist kie_task_id ทันทีเพื่อ resume หลัง restart
          async (kieTaskId: string) => {
            const t = await pool.query('SELECT video_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
            const vTasks = t.rows[0]?.video_tasks || [];
            const idx = vTasks.findIndex((x: any) => x.scene === scene.scene);
            const entry = { scene: scene.scene, kie_task_id: kieTaskId, status: 'pending', video_url: null, thumbnail_url: imageResult?.image_url || null };
            if (idx >= 0) vTasks[idx] = { ...vTasks[idx], ...entry };
            else vTasks.push(entry);
            await updateTaskStatus(taskId, { video_tasks: vTasks });
          },
          resumeKieTaskId
        );

        const progress: any = {
          scene: scene.scene,
          kie_task_id: result.taskId || null,
          status: result.success ? 'done' : 'failed',
          video_url: result.resultUrl || null,
          // Store reference image URL for fast thumbnail display (no JSONB subquery needed)
          thumbnail_url: imageResult?.image_url || null,
        };

        // Update DB progressively
        const task = await pool.query('SELECT video_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
        const videoTasks = task.rows[0]?.video_tasks || [];
        const idx = videoTasks.findIndex((t: any) => t.scene === scene.scene);
        if (idx >= 0) videoTasks[idx] = progress;
        else videoTasks.push(progress);
        await updateTaskStatus(taskId, { video_tasks: videoTasks });

        if (result.success) {
          await appendLog(taskId, '🎬', `ฉาก ${scene.scene} สร้าง VDO สำเร็จ`);

          // Keep original KIE URL for concatenation (direct URL is faster/more reliable)
          const originalVideoUrl = progress.video_url;

          // Upload scene video to Dropbox for persistent storage/display
          if (progress.video_url && isDropboxConfigured() && !progress.video_url.includes('dropbox.com')) {
            try {
              const scenePath = `/trippleviral/viral/${userId}/${taskId}_scene${scene.scene}.mp4`;
              const { sharedUrl } = await uploadVideoToDropbox(progress.video_url, userId, taskId, scenePath);
              // DB stores Dropbox URL for display
              const freshTask = await pool.query('SELECT video_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
              const freshVideoTasks = freshTask.rows[0]?.video_tasks || [];
              const freshIdx = freshVideoTasks.findIndex((t: any) => t.scene === scene.scene);
              if (freshIdx >= 0) freshVideoTasks[freshIdx].video_url = sharedUrl;
              await updateTaskStatus(taskId, { video_tasks: freshVideoTasks });
              await appendLog(taskId, '📦', `ฉาก ${scene.scene} บันทึกไป Dropbox แล้ว`);
            } catch (dbxErr: any) {
              console.error(`[Viral:Dropbox] Scene ${scene.scene} upload failed:`, dbxErr.message);
              await appendLog(taskId, '⚠️', `ฉาก ${scene.scene} Dropbox ล้มเหลว ใช้ URL เดิม`);
            }
          }

          // Return progress with original KIE URL (for concat download)
          progress.video_url = originalVideoUrl;
          return progress;
        }

        lastError = result.error || 'Unknown error';
        await appendLog(taskId, '❌', `ฉาก ${scene.scene} VDO ล้มเหลว: ${lastError.substring(0, 80)}`);
        const lowerError = lastError.toLowerCase();
        const isTransientError = lowerError.includes('unavailable') || lowerError.includes('high demand')
          || lowerError.includes('rate limit') || lowerError.includes('timeout')
          || lowerError.includes('too many requests') || /kie error \(5\d\d\)/.test(lowerError)
          || lowerError.includes('server exception') || lowerError.includes('try again later');

        if (attempt < MAX_RETRIES) {
          if (isTransientError) {
            const delay = 5000 * Math.pow(2, attempt - 1); // 5s, 10s, 20s exponential backoff
            await appendLog(taskId, '⏳', `ฉาก ${scene.scene} VDO รอ ${delay / 1000}s แล้ว retry...`);
            await new Promise(r => setTimeout(r, delay));
          }
          continue;
        }
        break;
      }
      throw new Error(lastError);
    })
  );

  // Merge new results with existing done scenes
  const videoProgress: any[] = existingVideos.filter((v: any) => v.status === 'done' && v.video_url);
  for (const r of results) {
    if (r.status === 'fulfilled') {
      videoProgress.push(r.value);
    } else {
      videoProgress.push({ scene: 0, status: 'failed', error: r.reason?.message });
    }
  }

  const failedScenes = videoProgress.filter(p => p.status === 'failed');
  if (failedScenes.length > 0) {
    throw new Error(`Video generation failed for ${failedScenes.length} scene(s): ${failedScenes.map(f => f.error || 'unknown').join(', ')}`);
  }

  return videoProgress;
}

// ============================================
// Step 4: FFmpeg Concatenation
// ============================================

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

async function concatenateVideos(
  videoResults: SceneProgress[],
  userId: number,
  taskId: number,
  watermark?: WatermarkSettings | null
): Promise<string> {
  console.log(`[Viral:Concat] Concatenating ${videoResults.length} videos...`);

  const tmpDir = path.join(os.tmpdir(), `viral-${taskId}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Sort by scene number
    const sorted = [...videoResults].sort((a, b) => a.scene - b.scene);

    // Download all videos
    const videoFiles: string[] = [];
    for (const vr of sorted) {
      if (!vr.video_url) throw new Error(`No video URL for scene ${vr.scene}`);
      const filePath = path.join(tmpDir, `scene_${vr.scene}.mp4`);

      const response = await fetch(vr.video_url);
      if (!response.ok) throw new Error(`Failed to download video for scene ${vr.scene}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
      videoFiles.push(filePath);
    }

    // Create concat list file
    const listPath = path.join(tmpDir, 'list.txt');
    const listContent = videoFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    // Run FFmpeg
    const outputPath = path.join(tmpDir, 'output.mp4');

    const { execSync } = await import('child_process');
    const ff = ffmpegPath || 'ffmpeg';
    const listFile = listPath.replace(/\\/g, '/');
    const outFile = outputPath.replace(/\\/g, '/');
    try {
      // Try stream copy first (fast, works if codecs match)
      execSync(`"${ff}" -f concat -safe 0 -i "${listFile}" -c copy -y "${outFile}"`, { timeout: 120000 });
    } catch {
      // Fallback: re-encode (slower, always works)
      console.log('[Viral:Concat] Stream copy failed, falling back to re-encode...');
      execSync(`"${ff}" -f concat -safe 0 -i "${listFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${outFile}"`, { timeout: 300000 });
    }

    // Apply watermark if enabled
    let uploadPath = outputPath;
    if (watermark?.enabled) {
      const watermarkedPath = path.join(tmpDir, 'output_wm.mp4');
      console.log(`[Viral:Concat] Applying watermark...`);
      await applyWatermark(outputPath, watermarkedPath, watermark, tmpDir);
      uploadPath = watermarkedPath;
    }

    // Upload to Dropbox
    const date = new Date().toISOString().slice(0, 10);
    const dropboxPath = `/trippleviral/viral-templates/${userId}/${date}_${taskId}_final.mp4`;
    await appendLog(taskId, '📦', 'กำลังบันทึก VDO ไป Dropbox...');
    const { sharedUrl, dropboxPath: savedPath } = await uploadLocalFileToDropbox(uploadPath, dropboxPath);
    await pool.query(`UPDATE viral_template_tasks SET dropbox_path = $1 WHERE id = $2`, [savedPath, taskId]);
    await appendLog(taskId, '✅', 'บันทึก VDO ไป Dropbox สำเร็จ');
    console.log(`[Viral:Concat] ✅ Uploaded to Dropbox: ${savedPath}`);
    return sharedUrl;

  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// ============================================
// Main Pipeline Orchestrator
// ============================================

export async function runTaskPipeline(taskId: number, userId: number): Promise<void> {
  try {
    // Atomic claim: เปลี่ยน status เป็น 'prompt_generating' เฉพาะเมื่อยังเป็น 'pending'
    // ถ้า instance อื่นหรือ restart แล้ว pick ซ้ำ จะ claim ไม่ได้ → skip
    const claimed = await pool.query(
      `UPDATE viral_template_tasks SET status = 'prompt_generating', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
      [taskId, userId]
    );
    if (claimed.rowCount === 0) {
      console.log(`[Viral] Task ${taskId} already claimed by another instance — skipping`);
      return;
    }

    // Get task info
    const taskResult = await pool.query(
      'SELECT * FROM viral_template_tasks WHERE id = $1 AND user_id = $2',
      [taskId, userId]
    );
    const task = taskResult.rows[0];
    if (!task) throw new Error('Task not found');

    // Get job info
    const jobResult = await pool.query(
      'SELECT * FROM viral_template_jobs WHERE id = $1',
      [task.job_id]
    );
    const job = jobResult.rows[0];
    if (!job) throw new Error('Job not found');

    // Get API keys
    const { openrouterApiKey, kieApiKey } = await getUserApiKeys(userId);

    // Read template-level field_config + system_prompt (field_config: detects direct_video_from_ref + skip_ai_prompt_gen opt-ins;
    // system_prompt: used as the literal video_prompt when skip_ai_prompt_gen is on).
    let templateFieldConfig: any = {};
    let templateSystemPrompt: string = '';
    if (job.template_slug && job.template_slug !== 'custom') {
      try {
        const tplRes = await pool.query('SELECT field_config, system_prompt FROM viral_templates WHERE slug = $1', [job.template_slug]);
        templateFieldConfig = tplRes.rows[0]?.field_config || {};
        templateSystemPrompt = tplRes.rows[0]?.system_prompt || '';
      } catch { /* ignore */ }
    }
    const directVideoFromRef = templateFieldConfig?.direct_video_from_ref === true;
    const skipAiPromptGen = templateFieldConfig?.skip_ai_prompt_gen === true;

    const taskCharNames: string[] | null = task.character_names && Array.isArray(task.character_names) ? task.character_names : null;
    const displayName = taskCharNames && taskCharNames.length > 0 ? taskCharNames.join(', ') : (task.character_name || 'Task');
    await appendLog(taskId, '🚀', `Starting: ${displayName}`);

    // Collect reference image URLs from task_variables
    // Supports global keys (character_image) and per-scene keys (character_image_0, character_image_1)
    const taskVars = task.task_variables || {};
    const resolveUrl = (url: string) => url.startsWith('/') ? `${process.env.PUBLIC_URL || 'http://localhost:3001'}${url}` : url;

    // Global reference images (used for all scenes)
    // ORDER MATTERS: the first URL becomes IMAGE 1 (the model's base/scene),
    // subsequent URLs become IMAGE 2, IMAGE 3, etc. (additive elements).
    // movie_scene first so "Add Character in Movie" treats the scene as the base
    // and the character as something ADDED into it.
    const refImageUrls: string[] = [];
    for (const key of ['movie_scene_image', 'character_image', 'outfit_image', 'background_image']) {
      const url = taskVars[key];
      if (url && typeof url === 'string') refImageUrls.push(resolveUrl(url));
    }

    // Per-scene reference images: { 0: [movieSceneUrl, characterUrl, outfitUrl, backgroundUrl], 1: ... }
    // Same order as refImageUrls — movie_scene is IMAGE 1 (base), character is IMAGE 2 (insert).
    const perSceneRefImages: Record<number, string[]> = {};
    const orderedBaseKeys = ['movie_scene_image', 'character_image', 'outfit_image', 'background_image'] as const;
    // Discover scene indices from any matching key first
    const sceneIndices = new Set<number>();
    for (const key of Object.keys(taskVars)) {
      const m = key.match(/^(character_image|outfit_image|background_image|movie_scene_image)_(\d+)$/);
      if (m) sceneIndices.add(parseInt(m[2]));
    }
    for (const sceneIdx of sceneIndices) {
      for (const baseKey of orderedBaseKeys) {
        const url = taskVars[`${baseKey}_${sceneIdx}`];
        if (url && typeof url === 'string') {
          if (!perSceneRefImages[sceneIdx]) perSceneRefImages[sceneIdx] = [];
          perSceneRefImages[sceneIdx].push(resolveUrl(url));
        }
      }
    }

    const hasPerSceneRef = Object.keys(perSceneRefImages).length > 0;
    if (refImageUrls.length > 0) {
      await appendLog(taskId, '🖼️', `ใช้ ${refImageUrls.length} รูปอ้างอิง (ทุกฉาก)`);
    }
    if (hasPerSceneRef) {
      const totalPerScene = Object.values(perSceneRefImages).reduce((sum, urls) => sum + urls.length, 0);
      await appendLog(taskId, '🖼️', `ใช้ ${totalPerScene} รูปอ้างอิงแยกฉาก (${Object.keys(perSceneRefImages).length} ฉาก)`);
    }

    // Log ตัวแปรที่ถูก pick ส่งให้ AI (เพื่อให้เห็นใน UI ว่าใช้ค่าอะไร)
    const taskVarsForLog = task.task_variables && typeof task.task_variables === 'object' ? task.task_variables : {};
    const taskVarKeys = Object.keys(taskVarsForLog);
    if (taskVarKeys.length > 0) {
      const varSummary = taskVarKeys
        .map(k => {
          const v = taskVarsForLog[k];
          const valStr = Array.isArray(v) ? v.filter(Boolean).join(' | ') : String(v);
          return `${k}=${valStr}`;
        })
        .join(', ');
      await appendLog(taskId, '🎯', `ตัวแปร: ${varSummary}`);
    } else {
      await appendLog(taskId, '⚠️', 'ไม่มีตัวแปรถูก pick (task_variables ว่าง) — AI จะใช้ค่า default จาก system prompt');
    }

    // Smart retry: check what's already completed
    // For direct_video_from_ref templates we additionally require kie_image_url, because
    // legacy retries may have only the Dropbox URL stored as image_url (which Grok can't consume).
    const hasPrompts = task.ai_prompts && Array.isArray(task.ai_prompts) && task.ai_prompts.length > 0;
    const existingImages = task.image_tasks || [];
    const allImagesDone = hasPrompts && existingImages.length > 0 && existingImages.every((t: any) =>
      t.status === 'done' && t.image_url && (!directVideoFromRef || t.kie_image_url)
    );
    const existingVideos = task.video_tasks || [];
    const allVideosDone = allImagesDone && existingVideos.length > 0 && existingVideos.every((t: any) => t.status === 'done' && t.video_url);

    let scenes = task.ai_prompts;
    let imageResults = existingImages;
    let videoResults = existingVideos;

    // ---- Step 1: Generate AI Prompts (once) ----
    if (!allImagesDone) {
      if (!scenes || scenes.length === 0) {
        await updateTaskStatus(taskId, { status: 'prompt_generating', current_step: 'ai_prompt', error: null });

        if (skipAiPromptGen && templateSystemPrompt) {
          // Direct-substitute path: bypass OpenRouter entirely. The template's system_prompt IS
          // the video_prompt — we just swap [ACTION]/[DIALOGUE]/[LANGUAGE] in code so Grok receives
          // the template verbatim (no AI rewrite to "3D CGI" / "fantasy classroom" / etc.).
          await appendLog(taskId, '⏭️', 'ข้าม AI Prompt — ใช้ template ตรง ๆ');
          const tvars = task.task_variables || {};
          const actionVal = String(tvars.action ?? tvars.content ?? '').trim();
          const dialogueVal = String(tvars.dialogue ?? '').trim();
          const langVal = job.language === 'th' ? 'Thai' : 'English';
          // Strip the [Response Format ...] block — that's instructions for the AI we're skipping.
          const templateBody = templateSystemPrompt.split(/\n\s*---\s*\n\s*\[Response Format/)[0].trim();
          const videoPrompt = templateBody
            .replace(/\[ACTION\]/g, actionVal)
            .replace(/\[DIALOGUE\]/g, dialogueVal)
            .replace(/\[LANGUAGE\]/g, langVal);
          scenes = [{
            scene: 1,
            scene_name: 'ตัวละครเข้าฉากหนัง',
            image_prompt: '',
            video_prompt: videoPrompt,
          }];
        } else {
          await appendLog(taskId, '🤖', 'กำลังสร้าง AI Prompt...');
          scenes = await generateScenePrompts(
            openrouterApiKey,
            job.template_slug,
            task.character_name,
            job.scenes_per_video,
            job.language,
            false,
            taskCharNames || undefined,
            task.task_variables && Object.keys(task.task_variables).length > 0 ? task.task_variables : undefined,
            job.custom_system_prompt || undefined
          );
        }

        await updateTaskStatus(taskId, { ai_prompts: scenes });
        await appendLog(taskId, '✅', `AI Prompt สำเร็จ (${scenes.length} ฉาก)`);

        const initialImageTasks = scenes.map((s: any) => ({ scene: s.scene, status: 'pending', kie_task_id: null, image_url: null }));
        const initialVideoTasks = scenes.map((s: any) => ({ scene: s.scene, status: 'pending', kie_task_id: null, video_url: null }));
        await updateTaskStatus(taskId, { image_tasks: initialImageTasks, video_tasks: initialVideoTasks });
      }

      // ---- Step 2 (direct_video_from_ref shortcut): use uploaded reference images directly ----
      // Templates that opt in skip the AI image-generation step. Reference images live on Dropbox,
      // but Grok image-to-video only accepts KIE-hosted URLs, so we re-host each ref image onto
      // KIE's file storage first, then feed the resulting KIE URL(s) into the video step.
      // Supports both per-scene refs (e.g. "ลิง" with character per scene) and global refs
      // (e.g. "Add Character in Movie" with character + movie_scene shared across all scenes).
      // ALL refs per scene are passed to Grok (not just the first) so multi-image input works.
      if (directVideoFromRef && (hasPerSceneRef || refImageUrls.length > 0)) {
        // Per scene, pick per-scene refs if present, else fallback to global refs
        const sceneSourceUrls: Record<number, string[]> = {};
        for (const s of scenes!) {
          const sceneIdx = s.scene - 1;
          const urls = (perSceneRefImages[sceneIdx] && perSceneRefImages[sceneIdx].length > 0)
            ? perSceneRefImages[sceneIdx]
            : refImageUrls;
          sceneSourceUrls[sceneIdx] = urls || [];
        }

        const missingScenes = scenes!.filter((s: any) => {
          const sceneIdx = s.scene - 1;
          return !sceneSourceUrls[sceneIdx] || sceneSourceUrls[sceneIdx].length === 0;
        });
        if (missingScenes.length > 0) {
          throw new Error(`Template นี้ต้องแนบรูปทุกฉาก ขาดฉาก: ${missingScenes.map((s: any) => s.scene).join(', ')}`);
        }

        // Skip re-hosting if image_tasks already have KIE URLs from a previous run (smart retry)
        const currentTask = await pool.query('SELECT image_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
        const existingImages: any[] = currentTask.rows[0]?.image_tasks || [];

        await appendLog(taskId, '⬆️', `กำลังอัปรูปแนบไป KIE (${scenes!.length} ฉาก)...`);
        imageResults = await Promise.all(scenes!.map(async (s: any) => {
          const sceneIdx = s.scene - 1;
          const sourceUrls = sceneSourceUrls[sceneIdx];
          const existing = existingImages.find((i: any) => i.scene === s.scene);

          // Reuse cached KIE URLs if same source URLs and all KIE URLs exist
          const cachedSourceUrls: string[] = Array.isArray(existing?.source_urls)
            ? existing.source_urls
            : (existing?.source_url ? [existing.source_url] : []);
          const cachedKieUrls: string[] = Array.isArray(existing?.kie_image_urls)
            ? existing.kie_image_urls
            : (existing?.kie_image_url ? [existing.kie_image_url] : []);
          const sourcesMatch = cachedSourceUrls.length === sourceUrls.length &&
            cachedSourceUrls.every((u, i) => u === sourceUrls[i]);
          if (sourcesMatch && cachedKieUrls.length === sourceUrls.length) {
            return {
              scene: s.scene,
              status: 'done',
              kie_task_id: null,
              image_url: cachedKieUrls[0],
              kie_image_url: cachedKieUrls[0],
              kie_image_urls: cachedKieUrls,
              source_urls: cachedSourceUrls,
            };
          }

          // Rehost ALL ref URLs (so Grok can take multi-image input)
          const kieUrls: string[] = [];
          for (const url of sourceUrls) {
            const kieUrl = await rehostUrlToKie(url, kieApiKey, s.scene);
            kieUrls.push(kieUrl);
          }
          await appendLog(taskId, '✅', `ฉาก ${s.scene} อัปไป KIE สำเร็จ (${kieUrls.length} รูป)`);
          return {
            scene: s.scene,
            status: 'done',
            kie_task_id: null,
            image_url: kieUrls[0],          // first URL for display/thumbnail
            kie_image_url: kieUrls[0],      // backward compat (single URL)
            kie_image_urls: kieUrls,        // ALL URLs for multi-image video gen
            source_urls: sourceUrls,
          };
        }));
        await updateTaskStatus(taskId, { image_tasks: imageResults });
        await appendLog(taskId, '⏭️', `ข้ามสร้างภาพ AI — ใช้รูปแนบของ user เป็น input ของ VDO ตรงๆ (${imageResults.length} ฉาก)`);
      } else {

      // ---- Step 2: Generate Images (retry only failed scenes) ----
      await updateTaskStatus(taskId, { status: 'image_generating', current_step: 'image_gen' });

      for (let imgAttempt = 0; imgAttempt < MAX_POLICY_RETRIES; imgAttempt++) {
        // Find which scenes still need images
        const currentTask = await pool.query('SELECT image_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
        const currentImages: any[] = currentTask.rows[0]?.image_tasks || [];
        const failedOrPendingScenes = scenes!.filter((s: any) => {
          const img = currentImages.find((i: any) => i.scene === s.scene);
          return !img || img.status !== 'done' || !img.image_url;
        });

        if (failedOrPendingScenes.length === 0) {
          imageResults = currentImages;
          break; // all images done
        }

        if (imgAttempt > 0) {
          // Regen prompts ONLY for failed scenes with policy-safe instruction
          await appendLog(taskId, '⚠️', `ภาพ ${failedOrPendingScenes.length} ฉากผิด Policy — regen prompt เฉพาะฉากที่พัง (${imgAttempt}/${MAX_POLICY_RETRIES})...`);
          const saferScenes = await generateScenePrompts(
            openrouterApiKey, job.template_slug, task.character_name, job.scenes_per_video, job.language,
            true, taskCharNames || undefined,
            task.task_variables && Object.keys(task.task_variables).length > 0 ? task.task_variables : undefined,
            job.custom_system_prompt || undefined
          );
          // Replace only the failed scene prompts, keep successful ones
          for (const fs of failedOrPendingScenes) {
            const newPrompt = saferScenes.find((s: any) => s.scene === fs.scene);
            if (newPrompt) {
              const idx = scenes!.findIndex((s: any) => s.scene === fs.scene);
              if (idx >= 0) scenes![idx] = newPrompt;
            }
          }
          await updateTaskStatus(taskId, { ai_prompts: scenes });
          await appendLog(taskId, '✅', `Regen prompt สำเร็จ ${failedOrPendingScenes.length} ฉาก`);
        }

        try {
          // Generate images only for failed/pending scenes
          const partialResults = await generateImages(kieApiKey, failedOrPendingScenes, taskId, userId, refImageUrls.length > 0 ? refImageUrls : undefined, hasPerSceneRef ? perSceneRefImages : undefined);
          // Merge with existing successful images
          const merged = [...currentImages.filter((i: any) => i.status === 'done' && i.image_url), ...partialResults];
          imageResults = merged;
          break; // success
        } catch (err: any) {
          // Treat persistent KIE server exception same as policy error — regen prompt for failed scenes
          if ((isPolicyError(err.message) || isPersistentServerError(err.message)) && imgAttempt < MAX_POLICY_RETRIES - 1) {
            console.log(`[Viral] Task ${taskId}: Image ${isPolicyError(err.message) ? 'policy' : 'server'} error for ${failedOrPendingScenes.length} scene(s), retrying (${imgAttempt + 2}/${MAX_POLICY_RETRIES})`);
            continue;
          }
          throw err;
        }
      }
      } // end else (normal image generation path — directVideoFromRef branch closed above)
    } else {
      await appendLog(taskId, '⏭️', 'ข้าม Prompt+ภาพ (สำเร็จแล้ว)');
      console.log(`[Viral] Task ${taskId}: Skipping prompt+image (already done)`);
    }

    // For "add-character-in-movie" the user-uploaded movie scene drives the output ratio.
    // Probe the movie_scene reference and snap to one of Kie's 5 supported aspect_ratios.
    // Every other template keeps the original '9:16' default.
    let videoAspectRatio = '9:16';
    if (job.template_slug === 'add-character-in-movie') {
      const movieSceneUrl = taskVars['movie_scene_image'];
      if (movieSceneUrl && typeof movieSceneUrl === 'string') {
        videoAspectRatio = await detectKieAspectRatio(resolveUrl(movieSceneUrl));
        await appendLog(taskId, '📐', `Aspect ratio = ${videoAspectRatio} (อิงจากภาพฉากหนัง)`);
      }
    }

    // Kie docs: mode 'spicy' is "unavailable for external images" — direct_video_from_ref templates
    // pass user-uploaded refs straight to Grok, so 'spicy' has unpredictable behavior there.
    // Fall back to 'normal' for those templates (better identity preservation, supported with external imgs).
    // Templates that go through Kie image gen first still use 'spicy' (the internal Kie image is not external).
    const videoMode = directVideoFromRef ? 'normal' : 'spicy';

    // ---- Step 3: Videos (with policy retry) ----
    // Attempt 1: regen video_prompt only (keep images)
    // Attempt 2+: regen image_prompt + image + video_prompt (full regen for failed scenes)
    if (!allVideosDone) {
      for (let vidAttempt = 0; vidAttempt < MAX_POLICY_RETRIES; vidAttempt++) {
        try {
          await updateTaskStatus(taskId, { status: 'video_generating', current_step: 'video_gen', error: null });
          videoResults = await generateVideos(kieApiKey, scenes, imageResults, taskId, userId, videoAspectRatio, videoMode);
          break; // success
        } catch (err: any) {
          const needsImageRegen = err.message?.includes('need to regenerate image');
          const policyErr = isPolicyError(err.message);
          const serverErr = isPersistentServerError(err.message);
          // Server exception that persisted through inner retries = image/prompt likely to blame → treat like policy error
          if ((policyErr || needsImageRegen || serverErr) && vidAttempt < MAX_POLICY_RETRIES - 1) {
            // Find which scenes failed
            const currentTask = await pool.query('SELECT video_tasks, ai_prompts, image_tasks FROM viral_template_tasks WHERE id = $1', [taskId]);
            const videoTasks = currentTask.rows[0]?.video_tasks || [];
            const currentPrompts: ScenePrompt[] = currentTask.rows[0]?.ai_prompts || scenes;
            const failedVidScenes = videoTasks
              .filter((v: any) => v.status === 'failed')
              .map((v: any) => ({
                scene: v.scene,
                oldPrompt: currentPrompts.find((p: any) => p.scene === v.scene)?.video_prompt || ''
              }));

            // For server errors, jump straight to image regen (round 2 behavior) — video_prompt-only regen
            // won't help if KIE is choking on the image itself.
            // Exception: directVideoFromRef templates use user-uploaded images and must NOT regen images.
            const forceImageRegen = serverErr && !policyErr && !directVideoFromRef;

            if ((vidAttempt === 0 && !forceImageRegen) || directVideoFromRef) {
              // ---- Round 1: regen video_prompt only (keep images) ----
              if (skipAiPromptGen) {
                // skip_ai_prompt_gen templates must NEVER round-trip through OpenRouter — the AI
                // would rewrite the carefully-authored template ("3D CGI fantasy classroom" etc.).
                // Just reset failed scenes to pending and retry with the same prompt; that handles
                // transient Kie 500s. If policy keeps failing the outer loop will exhaust retries
                // and fail the task, prompting the user to adjust action/dialogue.
                await appendLog(taskId, '🔁', `VDO fail — ลอง gen ใหม่ด้วย prompt เดิม (${vidAttempt + 1}/${MAX_POLICY_RETRIES})...`);
                console.log(`[Viral] Task ${taskId}: skip_ai_prompt_gen ON — retrying with same prompt (attempt ${vidAttempt + 2})`);
                if (failedVidScenes.length > 0) {
                  const resetVideoTasks = videoTasks.map((v: any) =>
                    v.status === 'failed' ? { ...v, status: 'pending', kie_task_id: null, video_url: null } : v
                  );
                  await updateTaskStatus(taskId, { video_tasks: resetVideoTasks });
                }
              } else {
                await appendLog(taskId, '⚠️', `VDO ผิด Content Policy — กำลัง regen video prompt ใหม่ (${vidAttempt + 1}/${MAX_POLICY_RETRIES})...`);
                console.log(`[Viral] Task ${taskId}: Video policy error, regenerating video prompts only (attempt ${vidAttempt + 2})`);

                if (failedVidScenes.length > 0) {
                  const newVideoPrompts = await regenerateVideoPrompts(
                    openrouterApiKey,
                    failedVidScenes,
                    task.character_name,
                    job.language
                  );
                  for (const nvp of newVideoPrompts) {
                    const idx = scenes.findIndex((s: any) => s.scene === nvp.scene);
                    if (idx >= 0) scenes[idx].video_prompt = nvp.video_prompt;
                  }
                  await updateTaskStatus(taskId, { ai_prompts: scenes });

                  const resetVideoTasks = videoTasks.map((v: any) =>
                    v.status === 'failed' ? { ...v, status: 'pending', kie_task_id: null, video_url: null } : v
                  );
                  await updateTaskStatus(taskId, { video_tasks: resetVideoTasks });
                  await appendLog(taskId, '🔄', `Regen video prompt สำเร็จ ${newVideoPrompts.length} ฉาก — ลอง gen VDO ใหม่...`);
                }
              }
            } else {
              // ---- Round 2+ (or forced image regen for server errors): regen image + video for failed scenes ----
              const reasonMsg = forceImageRegen
                ? `KIE Server exception ซ้ำ — สาเหตุน่าจะมาจากภาพ กำลัง regen ภาพ+prompt ใหม่`
                : `VDO ยังผิด Policy — สาเหตุน่าจะมาจากภาพ กำลัง regen ภาพ+prompt ใหม่`;
              await appendLog(taskId, '⚠️', `${reasonMsg} (${vidAttempt + 1}/${MAX_POLICY_RETRIES})...`);
              console.log(`[Viral] Task ${taskId}: ${forceImageRegen ? 'Server exception persists' : 'Video policy persists'}, regenerating images+prompts for failed scenes (attempt ${vidAttempt + 2})`);

              // Regen prompts with policy-safe instruction
              scenes = await generateScenePrompts(
                openrouterApiKey,
                job.template_slug,
                task.character_name,
                job.scenes_per_video,
                job.language,
                true, // policyRetry
                taskCharNames || undefined,
                task.task_variables && Object.keys(task.task_variables).length > 0 ? task.task_variables : undefined,
                job.custom_system_prompt || undefined
              );
              await updateTaskStatus(taskId, { ai_prompts: scenes });
              await appendLog(taskId, '✅', `AI Prompt ใหม่สำเร็จ (${scenes.length} ฉาก)`);

              // Regen images for failed scenes only
              const failedSceneNums = new Set(failedVidScenes.map((f: any) => f.scene));
              const scenesToRegenImage = scenes.filter((s: any) => failedSceneNums.has(s.scene));

              // Reset image+video tasks for failed scenes
              const curImageTasks = currentTask.rows[0]?.image_tasks || [];
              const resetImageTasks = curImageTasks.map((img: any) =>
                failedSceneNums.has(img.scene) ? { ...img, status: 'pending', kie_task_id: null } : img
              );
              const resetVideoTasks = videoTasks.map((v: any) =>
                failedSceneNums.has(v.scene) ? { ...v, status: 'pending', kie_task_id: null, video_url: null } : v
              );
              await updateTaskStatus(taskId, { image_tasks: resetImageTasks, video_tasks: resetVideoTasks });

              await updateTaskStatus(taskId, { status: 'image_generating', current_step: 'image_gen' });
              const newImageResults = await generateImages(kieApiKey, scenesToRegenImage, taskId, userId, refImageUrls.length > 0 ? refImageUrls : undefined, hasPerSceneRef ? perSceneRefImages : undefined);

              // Merge new images into imageResults
              for (const newImg of newImageResults) {
                const idx = imageResults.findIndex((r: any) => r.scene === newImg.scene);
                if (idx >= 0) imageResults[idx] = newImg;
                else imageResults.push(newImg);
              }
              await appendLog(taskId, '🔄', `สร้างภาพใหม่สำเร็จ ${newImageResults.length} ฉาก — ลอง gen VDO ใหม่...`);
            }
            continue;
          }
          throw err;
        }
      }
    } else {
      await appendLog(taskId, '⏭️', 'ข้าม VDO (สำเร็จแล้ว)');
      console.log(`[Viral] Task ${taskId}: Skipping video gen (already done)`);
    }

    // ---- Step 4: Concatenate Videos (skip if only 1 scene) ----
    // Fetch channel watermark settings once (both paths use it)
    const watermark = await getChannelWatermark(job.channel_id);
    if (watermark?.enabled) {
      await appendLog(taskId, '💧', 'Watermark เปิดใช้งาน');
    }

    let finalVideoUrl: string;
    if (videoResults.length === 1 && videoResults[0].video_url) {
      await appendLog(taskId, '⏭️', 'ฉากเดียว ข้าม concat');
      const sceneVideoUrl = videoResults[0].video_url!;
      const alreadyOnDropbox = sceneVideoUrl.includes('dropbox.com');

      if (alreadyOnDropbox) {
        // Retry case: scene already uploaded to Dropbox in a previous run.
        // Re-uploading would duplicate the file + shared link and can 401 on link conflict.
        finalVideoUrl = sceneVideoUrl;
        await appendLog(taskId, '⏭️', 'อยู่บน Dropbox แล้ว ใช้ URL เดิม');
      } else if (watermark?.enabled) {
        // Download → apply watermark → upload
        const tmpDir = path.join(os.tmpdir(), `viral-${taskId}-wm-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        try {
          const inputPath = path.join(tmpDir, 'input.mp4');
          const outputPath = path.join(tmpDir, 'output.mp4');
          const resp = await fetch(sceneVideoUrl, { signal: AbortSignal.timeout(120_000) });
          if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
          fs.writeFileSync(inputPath, Buffer.from(await resp.arrayBuffer()));
          await appendLog(taskId, '💧', 'กำลังใส่ watermark...');
          await applyWatermark(inputPath, outputPath, watermark, tmpDir);
          const date = new Date().toISOString().slice(0, 10);
          const dbxPath = `/trippleviral/viral-templates/${userId}/${date}_${taskId}_final.mp4`;
          const { sharedUrl } = await uploadLocalFileToDropbox(outputPath, dbxPath);
          await pool.query(`UPDATE viral_template_tasks SET dropbox_path = $1 WHERE id = $2`, [dbxPath, taskId]);
          finalVideoUrl = sharedUrl;
          await appendLog(taskId, '☁️', 'อัปโหลด Dropbox สำเร็จ (watermarked)');
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
      } else {
        // Upload single scene to Dropbox for persistence
        const { uploadVideoToDropbox } = await import('../utils/dropbox.js');
        const { sharedUrl, dropboxPath } = await uploadVideoToDropbox(sceneVideoUrl, userId, taskId);
        await pool.query(`UPDATE viral_template_tasks SET dropbox_path = $1 WHERE id = $2`, [dropboxPath, taskId]);
        finalVideoUrl = sharedUrl;
        await appendLog(taskId, '☁️', 'อัปโหลด Dropbox สำเร็จ');
      }
    } else {
      await appendLog(taskId, '🔗', 'กำลังต่อ VDO...');
      await updateTaskStatus(taskId, { status: 'concatenating', current_step: 'concat', error: null });
      finalVideoUrl = await concatenateVideos(videoResults, userId, taskId, watermark);
      await appendLog(taskId, '✅', 'ต่อ VDO สำเร็จ');
    }

    // ---- Upload final video to Dropbox ----
    if (finalVideoUrl && isDropboxConfigured() && !finalVideoUrl.includes('dropbox.com')) {
      try {
        await appendLog(taskId, '📦', 'กำลังบันทึก VDO ไป Dropbox...');
        const finalPath = `/trippleviral/viral/${userId}/${taskId}_final.mp4`;
        const { sharedUrl, dropboxPath } = await uploadVideoToDropbox(finalVideoUrl, userId, taskId, finalPath);
        finalVideoUrl = sharedUrl;
        await pool.query(
          `UPDATE viral_template_tasks SET dropbox_path = $1 WHERE id = $2`,
          [dropboxPath, taskId]
        );
        await appendLog(taskId, '✅', 'บันทึก VDO ไป Dropbox สำเร็จ');
      } catch (dbxErr: any) {
        console.error(`[Viral:Dropbox] Final video upload failed for task ${taskId}:`, dbxErr.message);
        await appendLog(taskId, '⚠️', `Dropbox ล้มเหลว ใช้ URL เดิม`);
      }
    }

    // ---- Done! ----
    // Set task-level thumbnail_url = first scene's image (for viral_final_video fast lookup)
    const thumbnailUrl = (imageResults as any[]).find((r: any) => r.scene === 1)?.image_url
      || (imageResults as any[])[0]?.image_url
      || null;
    await updateTaskStatus(taskId, {
      status: 'done',
      current_step: null,
      final_video_url: finalVideoUrl,
      thumbnail_url: thumbnailUrl,
    });

    // Save into content_history so this video shows up in the global "ประวัติเนื้อหา" feed.
    // Standalone viral tasks (created from the Viral Template Detail page, not via scheduler)
    // bypass schedule_queue, so the trigger that populates content_history doesn't fire — we
    // insert directly here. ON CONFLICT prevents duplicates if pipeline retries.
    if (finalVideoUrl) {
      try {
        await pool.query(
          `INSERT INTO content_history (user_id, channel_id, video_url, thumbnail_url, prompt, aspect_ratio, source, template_slug, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'viral_template', $7, NOW())
           ON CONFLICT (user_id, video_url) DO NOTHING`,
          [userId, job.channel_id || null, finalVideoUrl, thumbnailUrl, task.character_name || '', videoAspectRatio, job.template_slug]
        );
        await appendLog(taskId, '📚', 'บันทึกลงประวัติเนื้อหาแล้ว');
      } catch (err: any) {
        console.error(`[Viral] Failed to insert content_history for task ${taskId}:`, err.message);
      }
    }

    await appendLog(taskId, '🎉', 'เสร็จสมบูรณ์!');

    console.log(`[Viral] ✅ Task ${taskId} completed! Final video: ${finalVideoUrl}`);

  } catch (error: any) {
    console.error(`[Viral] ❌ Task ${taskId} failed:`, error.message);
    await appendLog(taskId, '💥', `ล้มเหลว: ${error.message?.substring(0, 100)}`);
    await updateTaskStatus(taskId, {
      status: 'failed',
      error: error.message,
    });
  }
}
