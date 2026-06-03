import pool from '../db.js';
import { uploadLocalFileToDropbox, uploadVideoToDropbox, isDropboxConfigured } from '../utils/dropbox.js';
import { applyWatermark, type WatermarkSettings } from '../utils/watermark.js';

import fs from 'fs';
import path from 'path';
import os from 'os';
// @ts-ignore - ffmpeg-static types don't match ESM default export
import _ffmpegStatic from 'ffmpeg-static';
const ffmpegPath: string = typeof _ffmpegStatic === 'string' ? _ffmpegStatic : 'ffmpeg';

const POLL_INTERVAL_MS = 5000;
const MAX_CONSECUTIVE_ERRORS = 10;
const MAX_POLL_ATTEMPTS = 360; // 360 * 5s = 30 นาที (ป้องกัน infinite loop)

// ============================================
// Template System Prompts
// ============================================

// Template cache (slug -> config) to avoid querying DB every time
interface TemplateCache {
  system_prompt: string;
  template_variables: any[];
  image_prompt_template?: string;
  video_prompt_template?: string;
  fetchedAt: number;
}
const templateCache: Map<string, TemplateCache> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getTemplateConfig(templateSlug: string): Promise<{ system_prompt: string; template_variables: any[]; image_prompt_template?: string; video_prompt_template?: string }> {
  const cached = templateCache.get(templateSlug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { system_prompt: cached.system_prompt, template_variables: cached.template_variables, image_prompt_template: cached.image_prompt_template, video_prompt_template: cached.video_prompt_template };
  }

  const result = await pool.query(
    'SELECT system_prompt, template_variables, image_prompt_template, video_prompt_template FROM idol_templates WHERE slug = $1',
    [templateSlug]
  );
  if (result.rows.length === 0) throw new Error(`Template "${templateSlug}" not found in database`);

  const { system_prompt, template_variables, image_prompt_template, video_prompt_template } = result.rows[0];
  templateCache.set(templateSlug, { system_prompt, template_variables: template_variables || [], image_prompt_template, video_prompt_template, fetchedAt: Date.now() });
  return { system_prompt, template_variables: template_variables || [], image_prompt_template, video_prompt_template };
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

// Cache: idol task id → { queue_id, user_id } เพื่อไม่ต้อง query ทุกครั้ง
const taskQueueCache = new Map<number, { queue_id: number; user_id: number } | null>();

async function getQueueLink(taskId: number): Promise<{ queue_id: number; user_id: number } | null> {
  if (taskQueueCache.has(taskId)) return taskQueueCache.get(taskId)!;
  try {
    const r = await pool.query(
      `SELECT sq.id as queue_id, sq.user_id FROM schedule_queue sq
       JOIN idol_template_tasks vt ON sq.external_task_id = 'idol-' || vt.job_id::text || '-' || vt.id::text
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
  // เขียนลง idol_template_tasks.logs (สำหรับหน้า Idol Template ตรง)
  await pool.query(
    `UPDATE idol_template_tasks SET logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
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
    `UPDATE idol_template_tasks SET ${setClauses.join(', ')} WHERE id = $${idx}`,
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
    console.log(`[Idol:${label}] Resuming poll for existing task: ${existingTaskId}`);
    if (dbTaskId) await appendLog(dbTaskId, '🔄', `${label}: Resume Task ID: ${existingTaskId} — รอประมวลผล...`);
    taskId = existingTaskId;
  } else {
    console.log(`[Idol:${label}] Creating KIE task...`);

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
        console.log(`[Idol:${label}] KIE createTask HTTP ${createResponse.status}, retry in ${delay / 1000}s (${createAttempt}/${MAX_CREATE_RETRIES})...`);
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
      console.error(`[Idol:${label}] KIE rejected (state=fail):`, JSON.stringify(createData));
      return { success: false, error: `KIE rejected: ${failMsg}` };
    }

    if (createData.code && createData.code !== 0 && createData.code !== 200) {
      const apiError = createData.msg || `API error code: ${createData.code}`;
      // Log raw response so we can diagnose false-positive "credit" matches
      console.error(`[Idol:${label}] KIE error response: code=${createData.code}, msg="${apiError}", raw=`, JSON.stringify(createData));
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

    console.log(`[Idol:${label}] Task created: ${taskId}, polling...`);
    if (dbTaskId) await appendLog(dbTaskId, '🔄', `${label}: Task ID: ${taskId} — รอประมวลผล...`);

    // Persist kie_task_id to DB immediately (so we can resume polling if server restarts)
    if (onTaskCreated) {
      try {
        await onTaskCreated(taskId);
      } catch (cbErr: any) {
        console.error(`[Idol:${label}] onTaskCreated callback failed:`, cbErr.message);
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
          console.log(`[Idol:${label}] ✅ Done! URL: ${resultUrl}`);
          return { success: true, taskId, resultUrl };
        }
        // state=success แต่หา URL ไม่เจอ → log raw response ช่วย diagnose
        console.error(`[Idol:${label}] state=success but no URL. Raw:`, JSON.stringify(statusRaw));
        if (attempt > 2) {
          if (dbTaskId) await appendLog(dbTaskId, '⚠️', `${label}: KIE success แต่หา URL ไม่เจอ — ดู server log`);
          return { success: false, error: `KIE state=success but no URL field found (taskId=${taskId})` };
        }
      }

      if (statusData.state === 'fail' && statusData.failMsg !== 'success') {
        return { success: false, error: statusData.failMsg || 'Task failed' };
      }

      if (attempt % 6 === 0 && attempt > 0) {
        console.log(`[Idol:${label}] Still processing... state=${statusData.state} (attempt ${attempt + 1})`);
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
  console.error(`[Idol:${label}] Polling timeout after ${elapsed}s (taskId=${taskId})`);
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
  console.log(`[Idol:AI] Calling OpenRouter for "${displayName}" (${sceneCount} scenes, ${language})...`);

  // Build user message content — include uploaded images as vision if present
  const userContent: any[] = [];
  if (taskVariables?.idol_image) {
    // Resolve relative URLs to absolute for OpenRouter
    const idolUrl = taskVariables.idol_image.startsWith('/')
      ? `${process.env.PUBLIC_URL || 'http://localhost:3001'}${taskVariables.idol_image}`
      : taskVariables.idol_image;
    userContent.push({ type: 'image_url', image_url: { url: idolUrl } });
    userContent.push({ type: 'text', text: '[ภาพด้านบนคือรูป Idol]' });
  }
  if (taskVariables?.outfit_image) {
    const outfitUrl = taskVariables.outfit_image.startsWith('/')
      ? `${process.env.PUBLIC_URL || 'http://localhost:3001'}${taskVariables.outfit_image}`
      : taskVariables.outfit_image;
    userContent.push({ type: 'image_url', image_url: { url: outfitUrl } });
    userContent.push({ type: 'text', text: '[ภาพด้านบนคือรูปชุด/Outfit]' });
  }
  if (taskVariables?.background_image) {
    const bgUrl = taskVariables.background_image.startsWith('/')
      ? `${process.env.PUBLIC_URL || 'http://localhost:3001'}${taskVariables.background_image}`
      : taskVariables.background_image;
    userContent.push({ type: 'image_url', image_url: { url: bgUrl } });
    userContent.push({ type: 'text', text: '[ภาพด้านบนคือ Background ที่ต้องการ]' });
  }
  // Append background instruction
  if (taskVariables?.background_text) {
    userMessage += `\nBackground: ${taskVariables.background_text}`;
  } else if (taskVariables?.background_image) {
    userMessage += `\nBackground: ใช้ background จากรูปที่แนบมา`;
  } else {
    userMessage += `\nBackground: AI เลือกเอง ให้เข้ากับชุดและสไตล์ของ Idol`;
  }
  // Append outfit instruction
  if (taskVariables?.outfit_image) {
    userMessage += `\nOutfit: ใช้ชุดจากรูปที่แนบมา`;
  } else {
    userMessage += `\nOutfit: AI เลือกชุดเอง ให้เหมาะสมกับสไตล์และ concept ของ Idol`;
  }
  userContent.push({ type: 'text', text: userMessage });

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent.length > 1 ? userContent : userMessage },
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
    console.log(`[Idol:AI] Response not JSON, sending follow-up to convert...`);
    messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: 'แปลงคำตอบข้างบนเป็น JSON array เท่านั้น ห้ามมี text อื่น:\n[{"scene":1,"scene_name":"...","image_prompt":"...","video_prompt":"..."}]' });
    content = await callAI(messages);
    jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error(`Cannot parse scene prompts from AI response. Content: ${content.substring(0, 500)}`);
  }

  const scenes: ScenePrompt[] = JSON.parse(jsonMatch[0]);
  console.log(`[Idol:AI] ✅ Got ${scenes.length} scenes`);
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

  const systemPrompt = `คุณคือผู้เชี่ยวชาญเขียน Video Prompt สำหรับวิดีโอคนจริง (live-action / realistic footage)
หน้าที่: เขียน video_prompt ใหม่ที่ปลอดภัยจาก Content Policy โดย:
- ห้ามใช้คำที่สุ่มเสี่ยง เช่น tease, seductive, sexy, sensual, suggestive, revealing, nude, naked, lingerie, bikini, cleavage, wet shirt, condom, latex, weapon, blood, kill, die, sex, drug
- ห้ามอธิบายชุด/เสื้อผ้าหรือสรีระในเชิงยั่วยวน ให้บรรยายแบบสุภาพและเป็นกลาง
- เน้นการเคลื่อนไหวที่นุ่มนวล มุมกล้อง อารมณ์ และบทพูดเป็นหลัก (ไม่ใช่เนื้อตัว)
- Video Prompt format: "cinematic realistic footage of a person in [มุมกล้อง]. [Action / subtle movement]. Lip-sync perfectly to the ${langText} dialogue: '[บทพูด]' Voice tone: [โทนเสียง]. Strictly no text, no subtitles, no watermarks."

ตอบเป็น JSON array เท่านั้น:
[{"scene": 1, "video_prompt": "..."}]`;

  const userMessage = `ตัวละคร: ${characterName}
Video prompt เดิมที่ถูกบล็อกเพราะผิด Content Policy:
${scenesDesc}

กรุณาเขียน video_prompt ใหม่ที่ปลอดภัยกว่า แต่ยังคงเนื้อเรื่อง/บทพูดเดิม (แก้แค่คำอธิบายภาพให้ปลอดภัย)`;

  console.log(`[Idol:AI] Regenerating video prompts for ${failedScenes.length} failed scene(s)...`);

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
  console.log(`[Idol:AI] ✅ Regenerated ${results.length} video prompts`);
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
  imageInputUrls?: string[]
): Promise<SceneProgress[]> {
  console.log(`[IdolPipeline:Image] Generating ${scenes.length} images in parallel...`);

  const MAX_RETRIES = 3;

  const results = await Promise.allSettled(
    scenes.map(async (scene) => {
      let lastError = '';
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // Check if we have an existing KIE task ID to resume (from pre-restart)
        const taskRowForResume = await pool.query('SELECT image_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
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

        const result = await kieCreateAndPoll(kieApiKey, 'nano-banana-2', {
          prompt: scene.image_prompt,
          ...(imageInputUrls && imageInputUrls.length > 0 ? { image_input: imageInputUrls } : {}),
          aspect_ratio: '9:16',
          resolution: '1K',
          output_format: 'jpg',
        }, `Image-S${scene.scene}${attempt > 1 ? `-retry${attempt}` : ''}`, taskId,
          // onTaskCreated: persist kie_task_id ทันทีเพื่อ resume หลัง restart
          async (kieTaskId: string) => {
            const t = await pool.query('SELECT image_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
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
        const task = await pool.query('SELECT image_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
        const imageTasks = task.rows[0]?.image_tasks || [];
        const idx = imageTasks.findIndex((t: any) => t.scene === scene.scene);
        if (idx >= 0) imageTasks[idx] = progress;
        else imageTasks.push(progress);
        await updateTaskStatus(taskId, { image_tasks: imageTasks });

        if (result.success) {
          // Persist image to Dropbox (for permanent storage/display)
          if (progress.image_url && isDropboxConfigured() && !progress.image_url.includes('dropbox.com')) {
            try {
              const imgPath = `/trippleviral/idol/${userId}/${taskId}_scene${scene.scene}.jpg`;
              const { sharedUrl } = await uploadVideoToDropbox(progress.image_url, userId, taskId, imgPath);
              // DB stores Dropbox URL for display, but kie_image_url stays as KIE URL
              const freshTask = await pool.query('SELECT image_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
              const freshImgTasks = freshTask.rows[0]?.image_tasks || [];
              const freshIdx = freshImgTasks.findIndex((t: any) => t.scene === scene.scene);
              if (freshIdx >= 0) freshImgTasks[freshIdx].image_url = sharedUrl;
              await updateTaskStatus(taskId, { image_tasks: freshImgTasks });
              await appendLog(taskId, '📦', `ฉาก ${scene.scene} บันทึกภาพไป Dropbox แล้ว`);
            } catch (dbxErr: any) {
              console.error(`[IdolPipeline:Dropbox] Image scene ${scene.scene} upload failed:`, dbxErr.message);
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
  videoDuration: number = 10
): Promise<SceneProgress[]> {
  // Check existing video progress to skip already-done scenes
  const taskRow = await pool.query('SELECT video_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
  const existingVideos: any[] = taskRow.rows[0]?.video_tasks || [];

  const scenesToGenerate = scenes.filter(scene => {
    const existing = existingVideos.find((v: any) => v.scene === scene.scene);
    return !existing || existing.status !== 'done' || !existing.video_url;
  });

  console.log(`[IdolPipeline:Video] Generating ${scenesToGenerate.length}/${scenes.length} videos (${scenes.length - scenesToGenerate.length} already done)...`);

  const MAX_RETRIES = 3;

  const results = await Promise.allSettled(
    scenesToGenerate.map(async (scene) => {
      const imageResult = imageResults.find(r => r.scene === scene.scene);
      // Prefer kie_image_url (original KIE URL) — never send Dropbox URL to KIE
      let imageUrlForKie = (imageResult as any)?.kie_image_url || null;
      // Fallback: if no kie_image_url, check image_url but only if it's NOT a Dropbox URL
      if (!imageUrlForKie && imageResult?.image_url && !imageResult.image_url.includes('dropbox.com')) {
        imageUrlForKie = imageResult.image_url;
      }
      // If only Dropbox URL available (old task), need to re-generate image
      if (!imageUrlForKie) {
        await appendLog(taskId, '⚠️', `ฉาก ${scene.scene} ไม่มี KIE URL — ต้อง regen ภาพ`);
        throw new Error(`No KIE image URL for scene ${scene.scene} (only Dropbox URL available, need to regenerate image)`);
      }

      let lastError = '';
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // Check if we have an existing KIE task ID to resume (from pre-restart)
        const taskRowForResume = await pool.query('SELECT video_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
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
          image_urls: [imageUrlForKie],
          prompt: scene.video_prompt,
          mode: 'spicy',
          aspect_ratio: '9:16',
          duration: videoDuration,
          resolution: '720p',
        }, `Video-S${scene.scene}${attempt > 1 ? `-retry${attempt}` : ''}`, taskId,
          // onTaskCreated: persist kie_task_id ทันทีเพื่อ resume หลัง restart
          async (kieTaskId: string) => {
            const t = await pool.query('SELECT video_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
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
        const task = await pool.query('SELECT video_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
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
              const scenePath = `/trippleviral/idol/${userId}/${taskId}_scene${scene.scene}.mp4`;
              const { sharedUrl } = await uploadVideoToDropbox(progress.video_url, userId, taskId, scenePath);
              // DB stores Dropbox URL for display
              const freshTask = await pool.query('SELECT video_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
              const freshVideoTasks = freshTask.rows[0]?.video_tasks || [];
              const freshIdx = freshVideoTasks.findIndex((t: any) => t.scene === scene.scene);
              if (freshIdx >= 0) freshVideoTasks[freshIdx].video_url = sharedUrl;
              await updateTaskStatus(taskId, { video_tasks: freshVideoTasks });
              await appendLog(taskId, '📦', `ฉาก ${scene.scene} บันทึกไป Dropbox แล้ว`);
            } catch (dbxErr: any) {
              console.error(`[IdolPipeline:Dropbox] Scene ${scene.scene} upload failed:`, dbxErr.message);
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
  console.log(`[IdolPipeline:Concat] Concatenating ${videoResults.length} videos...`);

  const tmpDir = path.join(os.tmpdir(), `idol-${taskId}-${Date.now()}`);
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
      console.log('[IdolPipeline:Concat] Stream copy failed, falling back to re-encode...');
      execSync(`"${ff}" -f concat -safe 0 -i "${listFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -y "${outFile}"`, { timeout: 300000 });
    }

    // Apply watermark if enabled
    let uploadPath = outputPath;
    if (watermark?.enabled) {
      const watermarkedPath = path.join(tmpDir, 'output_wm.mp4');
      console.log(`[IdolPipeline:Concat] Applying watermark...`);
      await applyWatermark(outputPath, watermarkedPath, watermark, tmpDir);
      uploadPath = watermarkedPath;
    }

    // Upload to Dropbox
    const date = new Date().toISOString().slice(0, 10);
    const dropboxPath = `/trippleviral/idol-templates/${userId}/${date}_${taskId}_final.mp4`;
    const { sharedUrl, dropboxPath: savedPath } = await uploadLocalFileToDropbox(uploadPath, dropboxPath);
    await pool.query(`UPDATE idol_template_tasks SET dropbox_path = $1 WHERE id = $2`, [savedPath, taskId]);
    console.log(`[IdolPipeline:Concat] ✅ Uploaded to Dropbox: ${savedPath}`);
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

export async function runIdolTaskPipeline(taskId: number, userId: number): Promise<void> {
  try {
    // Atomic claim: เปลี่ยน status เป็น 'prompt_generating' เฉพาะเมื่อยังเป็น 'pending'
    // ถ้า instance อื่นหรือ restart แล้ว pick ซ้ำ จะ claim ไม่ได้ → skip
    const claimed = await pool.query(
      `UPDATE idol_template_tasks SET status = 'prompt_generating', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
      [taskId, userId]
    );
    if (claimed.rowCount === 0) {
      console.log(`[IdolPipeline] Task ${taskId} already claimed by another instance — skipping`);
      return;
    }

    // Get task info
    const taskResult = await pool.query(
      'SELECT * FROM idol_template_tasks WHERE id = $1 AND user_id = $2',
      [taskId, userId]
    );
    const task = taskResult.rows[0];
    if (!task) throw new Error('Task not found');

    // Get job info
    const jobResult = await pool.query(
      'SELECT * FROM idol_template_jobs WHERE id = $1',
      [task.job_id]
    );
    const job = jobResult.rows[0];
    if (!job) throw new Error('Job not found');

    // Get KIE API key (required). OpenRouter key is optional here — prompts come from the
    // template, but we use OpenRouter to soften the video_prompt if KIE moderation rejects it.
    const userResult = await pool.query('SELECT kie_api_key, openrouter_api_key FROM users WHERE id = $1', [userId]);
    const kieApiKey = userResult.rows[0]?.kie_api_key;
    const openrouterApiKey: string = userResult.rows[0]?.openrouter_api_key || '';
    if (!kieApiKey) throw new Error('กรุณาตั้งค่า KIE API Key ในหน้า Settings ก่อน');

    await appendLog(taskId, '🚀', `Starting task #${task.task_index + 1}`);

    // Get template prompts (image_prompt_template + video_prompt_template)
    let imagePrompt = '';
    let videoPrompt = '';
    if (job.template_slug !== 'custom' && job.template_slug !== 'scheduler') {
      const templateConfig = await getTemplateConfig(job.template_slug);
      imagePrompt = templateConfig.image_prompt_template || '';
      videoPrompt = templateConfig.video_prompt_template || '';
    }
    // Embedded prompts from custom prompts going through scheduler — preferred over the
    // legacy custom_system_prompt fallback because they include both image AND video.
    if (job.custom_image_prompt) imagePrompt = imagePrompt || job.custom_image_prompt;
    if (job.custom_video_prompt) videoPrompt = videoPrompt || job.custom_video_prompt;
    // Custom prompt override: use custom_system_prompt as image_prompt (legacy compat)
    if (job.custom_system_prompt) {
      imagePrompt = imagePrompt || job.custom_system_prompt;
    }

    if (!imagePrompt) {
      throw new Error('Image Prompt Template ไม่ได้ตั้งค่า — กรุณาตั้งค่าใน Admin');
    }

    // Collect reference image URLs from task_variables (idol_image, outfit_image, background_image)
    const taskVars = task.task_variables || {};
    const refImageUrls: string[] = [];
    for (const key of ['idol_image', 'outfit_image', 'background_image']) {
      const url = taskVars[key];
      if (url && typeof url === 'string') {
        // Resolve relative URLs to absolute for KIE API
        const absUrl = url.startsWith('/') ? `${process.env.PUBLIC_URL || 'http://localhost:3001'}${url}` : url;
        refImageUrls.push(absUrl);
      }
    }
    if (refImageUrls.length > 0) {
      await appendLog(taskId, '🖼️', `ใช้ ${refImageUrls.length} รูปอ้างอิง (Idol/Outfit/BG)`);
    }

    // Smart retry: check what's already completed
    const hasPrompts = task.ai_prompts && Array.isArray(task.ai_prompts) && task.ai_prompts.length > 0;
    const existingImages = task.image_tasks || [];
    const allImagesDone = hasPrompts && existingImages.length > 0 && existingImages.every((t: any) => t.status === 'done' && t.image_url);
    const existingVideos = task.video_tasks || [];
    const allVideosDone = allImagesDone && existingVideos.length > 0 && existingVideos.every((t: any) => t.status === 'done' && t.video_url);

    let scenes = task.ai_prompts;
    let imageResults = existingImages;
    let videoResults = existingVideos;

    // ---- Step 1: Use Template Prompts directly (no AI) ----
    if (!allImagesDone) {
      if (!scenes || scenes.length === 0) {
        await appendLog(taskId, '📝', 'ใช้ Prompt Template จาก Admin');
        await updateTaskStatus(taskId, { status: 'prompt_generating', current_step: 'ai_prompt', error: null });

        // Build scene directly from template prompts
        // Append background text to image prompt if provided
        let finalImagePrompt = imagePrompt;
        if (taskVars.background_text && typeof taskVars.background_text === 'string' && taskVars.background_text.trim()) {
          finalImagePrompt += `, background: ${taskVars.background_text.trim()}`;
          await appendLog(taskId, '🏞️', `Background: ${taskVars.background_text.trim()}`);
        }

        let finalVideoPrompt = videoPrompt || 'gentle pose, subtle body movement, eye contact with camera, smooth cinematic slow motion';
        // Inject language into video_prompt
        const lang = job.language || 'th';
        if (lang === 'th') {
          finalVideoPrompt += '. Dialogue and narration must be in Thai (ภาษาไทย).';
        }

        scenes = [{
          scene: 1,
          scene_name: 'Idol Showcase',
          image_prompt: finalImagePrompt,
          video_prompt: finalVideoPrompt,
        }];

        await updateTaskStatus(taskId, { ai_prompts: scenes });
        await appendLog(taskId, '✅', `Prompt Template พร้อม`);

        const initialImageTasks = scenes.map((s: any) => ({ scene: s.scene, status: 'pending', kie_task_id: null, image_url: null }));
        const initialVideoTasks = scenes.map((s: any) => ({ scene: s.scene, status: 'pending', kie_task_id: null, video_url: null }));
        await updateTaskStatus(taskId, { image_tasks: initialImageTasks, video_tasks: initialVideoTasks });
      }

      // ---- Step 2: Generate Images (retry only failed scenes) ----
      await updateTaskStatus(taskId, { status: 'image_generating', current_step: 'image_gen' });

      for (let imgAttempt = 0; imgAttempt < MAX_POLICY_RETRIES; imgAttempt++) {
        // Find which scenes still need images
        const currentTask = await pool.query('SELECT image_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
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
          // Idol uses fixed template prompts — retry with same prompt (no AI regen)
          await appendLog(taskId, '⚠️', `ภาพ ${failedOrPendingScenes.length} ฉากผิด Policy — ลองใหม่ด้วย prompt เดิม (${imgAttempt}/${MAX_POLICY_RETRIES})...`);
        }

        try {
          // Generate images only for failed/pending scenes
          const partialResults = await generateImages(kieApiKey, failedOrPendingScenes, taskId, userId, refImageUrls);
          // Merge with existing successful images
          const merged = [...currentImages.filter((i: any) => i.status === 'done' && i.image_url), ...partialResults];
          imageResults = merged;
          break; // success
        } catch (err: any) {
          // Treat persistent KIE server exception same as policy error — regen prompt for failed scenes
          if ((isPolicyError(err.message) || isPersistentServerError(err.message)) && imgAttempt < MAX_POLICY_RETRIES - 1) {
            console.log(`[IdolPipeline] Task ${taskId}: Image ${isPolicyError(err.message) ? 'policy' : 'server'} error for ${failedOrPendingScenes.length} scene(s), retrying (${imgAttempt + 2}/${MAX_POLICY_RETRIES})`);
            continue;
          }
          throw err;
        }
      }
    } else {
      await appendLog(taskId, '⏭️', 'ข้าม Prompt+ภาพ (สำเร็จแล้ว)');
      console.log(`[IdolPipeline] Task ${taskId}: Skipping prompt+image (already done)`);
    }

    // ---- Step 3: Videos (with policy retry) ----
    // Attempt 1: regen video_prompt only (keep images)
    // Attempt 2+: regen image_prompt + image + video_prompt (full regen for failed scenes)
    if (!allVideosDone) {
      for (let vidAttempt = 0; vidAttempt < MAX_POLICY_RETRIES; vidAttempt++) {
        try {
          await updateTaskStatus(taskId, { status: 'video_generating', current_step: 'video_gen', error: null });
          videoResults = await generateVideos(kieApiKey, scenes, imageResults, taskId, userId, job.duration || 10);
          break; // success
        } catch (err: any) {
          const needsImageRegen = err.message?.includes('need to regenerate image');
          const policyErr = isPolicyError(err.message);
          const serverErr = isPersistentServerError(err.message);
          // Server exception that persisted through inner retries = image/prompt likely to blame → treat like policy error
          if ((policyErr || needsImageRegen || serverErr) && vidAttempt < MAX_POLICY_RETRIES - 1) {
            // Find which scenes failed
            const currentTask = await pool.query('SELECT video_tasks, ai_prompts, image_tasks FROM idol_template_tasks WHERE id = $1', [taskId]);
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
            const forceImageRegen = serverErr && !policyErr;

            if (vidAttempt === 0 && !forceImageRegen) {
              // ---- Round 1: soften video_prompt via OpenRouter (keep images) ----
              // Template prompts are fixed, so retrying the same text never clears KIE moderation.
              // If an OpenRouter key is available, rewrite the prompt policy-safe; otherwise fall
              // back to retrying the same prompt (best effort for users without OpenRouter).
              if (failedVidScenes.length > 0 && openrouterApiKey) {
                await appendLog(taskId, '⚠️', `VDO ผิด Content Policy — กำลัง regen video prompt ใหม่ (${vidAttempt + 1}/${MAX_POLICY_RETRIES})...`);
                console.log(`[IdolPipeline] Task ${taskId}: Video policy error, regenerating video prompts only (attempt ${vidAttempt + 2})`);

                const newVideoPrompts = await regenerateVideoPrompts(
                  openrouterApiKey,
                  failedVidScenes,
                  job.template_slug || 'บุคคลในภาพ',
                  job.language || 'th'
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
              } else {
                await appendLog(taskId, '⚠️', `VDO ผิด Content Policy — ลองใหม่ด้วย prompt เดิม (${vidAttempt + 1}/${MAX_POLICY_RETRIES})...`);
                console.log(`[IdolPipeline] Task ${taskId}: Video policy error, retrying with same prompt (attempt ${vidAttempt + 2})${openrouterApiKey ? '' : ' (no OpenRouter key)'}`);

                if (failedVidScenes.length > 0) {
                  const resetVideoTasks = videoTasks.map((v: any) =>
                    v.status === 'failed' ? { ...v, status: 'pending', kie_task_id: null, video_url: null } : v
                  );
                  await updateTaskStatus(taskId, { video_tasks: resetVideoTasks });
                  await appendLog(taskId, '🔄', `Reset ${failedVidScenes.length} ฉาก — ลอง gen VDO ใหม่...`);
                }
              }
            } else {
              // ---- Round 2+: Idol uses fixed prompts — regen image with same prompt for failed scenes ----
              await appendLog(taskId, '⚠️', `VDO ผิด Policy — ลอง regen ภาพใหม่ด้วย prompt เดิม (${vidAttempt + 1}/${MAX_POLICY_RETRIES})...`);
              console.log(`[IdolPipeline] Task ${taskId}: retrying image gen for failed scenes (attempt ${vidAttempt + 2})`);

              const failedSceneNums = new Set(failedVidScenes.map((f: any) => f.scene));
              const scenesToRegenImage = scenes!.filter((s: any) => failedSceneNums.has(s.scene));

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
              const newImageResults = await generateImages(kieApiKey, scenesToRegenImage, taskId, userId, refImageUrls);

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
      console.log(`[IdolPipeline] Task ${taskId}: Skipping video gen (already done)`);
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
        const tmpDir = path.join(os.tmpdir(), `idol-${taskId}-wm-${Date.now()}`);
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
          const dbxPath = `/trippleviral/idol-templates/${userId}/${date}_${taskId}_final.mp4`;
          const { sharedUrl } = await uploadLocalFileToDropbox(outputPath, dbxPath);
          await pool.query(`UPDATE idol_template_tasks SET dropbox_path = $1 WHERE id = $2`, [dbxPath, taskId]);
          finalVideoUrl = sharedUrl;
          await appendLog(taskId, '☁️', 'อัปโหลด Dropbox สำเร็จ (watermarked)');
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
      } else {
        // Try upload single scene to Dropbox for persistence (fallback to KIE URL if Dropbox not configured)
        try {
          const { uploadVideoToDropbox } = await import('../utils/dropbox.js');
          const { sharedUrl, dropboxPath } = await uploadVideoToDropbox(sceneVideoUrl, userId, taskId);
          await pool.query(`UPDATE idol_template_tasks SET dropbox_path = $1 WHERE id = $2`, [dropboxPath, taskId]);
          finalVideoUrl = sharedUrl;
          await appendLog(taskId, '☁️', 'อัปโหลด Dropbox สำเร็จ');
        } catch (dbxErr: any) {
          console.log(`[IdolPipeline] Dropbox upload skipped: ${dbxErr.message} — using KIE URL`);
          finalVideoUrl = sceneVideoUrl;
          await appendLog(taskId, '⚠️', 'Dropbox ไม่พร้อม — ใช้ URL จาก KIE แทน');
        }
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
        const finalPath = `/trippleviral/idol/${userId}/${taskId}_final.mp4`;
        const { sharedUrl, dropboxPath } = await uploadVideoToDropbox(finalVideoUrl, userId, taskId, finalPath);
        finalVideoUrl = sharedUrl;
        await pool.query(
          `UPDATE idol_template_tasks SET dropbox_path = $1 WHERE id = $2`,
          [dropboxPath, taskId]
        );
        await appendLog(taskId, '✅', 'บันทึก VDO ไป Dropbox สำเร็จ');
      } catch (dbxErr: any) {
        console.error(`[IdolPipeline:Dropbox] Final video upload failed for task ${taskId}:`, dbxErr.message);
        await appendLog(taskId, '⚠️', `Dropbox ล้มเหลว ใช้ URL เดิม`);
      }
    }

    // ---- Done! ----
    // Set task-level thumbnail_url = first scene's image (for idol_final_video fast lookup)
    const thumbnailUrl = (imageResults as any[]).find((r: any) => r.scene === 1)?.image_url
      || (imageResults as any[])[0]?.image_url
      || null;
    await updateTaskStatus(taskId, {
      status: 'done',
      current_step: null,
      final_video_url: finalVideoUrl,
      thumbnail_url: thumbnailUrl,
    });
    await appendLog(taskId, '🎉', 'เสร็จสมบูรณ์!');

    console.log(`[IdolPipeline] ✅ Task ${taskId} completed! Final video: ${finalVideoUrl}`);

  } catch (error: any) {
    console.error(`[IdolPipeline] ❌ Task ${taskId} failed:`, error.message);
    await appendLog(taskId, '💥', `ล้มเหลว: ${error.message?.substring(0, 100)}`);
    await updateTaskStatus(taskId, {
      status: 'failed',
      error: error.message,
    });
  }
}
