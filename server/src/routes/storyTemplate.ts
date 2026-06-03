import express, { Response } from 'express';
import axios from 'axios';
import FormDataLib from 'form-data';
import pool from '../db.js';
import { authenticate, AuthRequest, requireAdmin } from '../middleware/auth.js';
import { uploadImageToDropbox, isDropboxConfigured } from '../utils/dropbox.js';

const router = express.Router();

const KIE_BASE = 'https://api.kie.ai';
const KIE_FILE_BASE = 'https://kieai.redpandaai.co';

// Fetch a remote image URL, re-upload to KIE's File API, return the KIE-hosted URL.
// We do this so KIE createTask gets URLs from KIE's own infrastructure (faster, more reliable than Dropbox).
// Detects actual image type from magic bytes (not the response content-type, which Dropbox sometimes mislabels).
async function uploadUrlToKie(kieKey: string, url: string, slot: string, userId: number): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch source failed: HTTP ${r.status}`);
  const buffer = Buffer.from(await r.arrayBuffer());
  if (buffer.length < 8) throw new Error(`source returned only ${buffer.length} bytes`);

  // Detect by magic bytes (most reliable)
  let ext = 'png';
  let contentType = 'image/png';
  const hex8 = buffer.toString('hex', 0, 8);
  const ascii4 = buffer.toString('ascii', 0, 4);
  if (hex8.startsWith('89504e470d0a1a0a')) { ext = 'png'; contentType = 'image/png'; }
  else if (hex8.startsWith('ffd8ff')) { ext = 'jpg'; contentType = 'image/jpeg'; }
  else if (ascii4 === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') { ext = 'webp'; contentType = 'image/webp'; }
  else if (hex8.startsWith('47494638')) { ext = 'gif'; contentType = 'image/gif'; }
  else if (ascii4 === 'BM') { ext = 'bmp'; contentType = 'image/bmp'; }
  else {
    // Not a recognized image — likely an HTML error page from Dropbox / login redirect
    const preview = buffer.toString('utf8', 0, Math.min(200, buffer.length));
    throw new Error(`source is not a recognized image (${buffer.length} bytes, starts with: ${preview.substring(0, 80).replace(/\s+/g, ' ')})`);
  }

  const fileName = `${slot}_${Date.now()}.${ext}`;
  const fd = new FormDataLib();
  fd.append('file', buffer, { filename: fileName, contentType });
  fd.append('uploadPath', `images/story-template/${userId}`);
  fd.append('fileName', fileName);

  const { data: result, status } = await axios.post(
    `${KIE_FILE_BASE}/api/file-stream-upload`,
    fd,
    {
      headers: { Authorization: `Bearer ${kieKey}`, ...fd.getHeaders() },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: () => true,
    }
  );
  if (status < 200 || status >= 300) {
    throw new Error(result?.msg || `KIE upload HTTP ${status}: ${JSON.stringify(result).substring(0, 300)}`);
  }
  const fileUrl =
    result?.data?.fileUrl || result?.data?.downloadUrl || result?.data?.url ||
    result?.fileUrl || result?.downloadUrl || null;
  if (!fileUrl) throw new Error(`KIE upload returned no URL: ${JSON.stringify(result).substring(0, 300)}`);
  return fileUrl as string;
}

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS story_template_tasks (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        template_slug TEXT,
        model TEXT NOT NULL,
        prompt_template TEXT,
        prompt TEXT NOT NULL,
        variables JSONB,
        image_inputs JSONB,
        text_values JSONB,
        aspect_ratio TEXT,
        resolution TEXT,
        status TEXT DEFAULT 'pending',
        result_url TEXT,
        dropbox_url TEXT,
        channel_id INT,
        error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_story_template_user
        ON story_template_tasks(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_story_template_task
        ON story_template_tasks(task_id);
      CREATE INDEX IF NOT EXISTS idx_story_template_slug
        ON story_template_tasks(user_id, template_slug);
      ALTER TABLE story_template_tasks ADD COLUMN IF NOT EXISTS topic TEXT;
      ALTER TABLE story_template_tasks ADD COLUMN IF NOT EXISTS group_id TEXT;
      ALTER TABLE story_template_tasks ADD COLUMN IF NOT EXISTS scene_number INT;
      ALTER TABLE story_template_tasks ADD COLUMN IF NOT EXISTS current_step TEXT;
      ALTER TABLE story_template_tasks ADD COLUMN IF NOT EXISTS video_task_id TEXT;
      ALTER TABLE story_template_tasks ADD COLUMN IF NOT EXISTS video_url TEXT;
      ALTER TABLE story_template_tasks ADD COLUMN IF NOT EXISTS video_status TEXT;
      ALTER TABLE story_template_tasks ADD COLUMN IF NOT EXISTS video_segments JSONB;
      ALTER TABLE story_template_tasks ADD COLUMN IF NOT EXISTS kie_image_urls JSONB;
      CREATE INDEX IF NOT EXISTS idx_story_template_group
        ON story_template_tasks(group_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS story_template_groups (
        id SERIAL PRIMARY KEY,
        group_id TEXT UNIQUE NOT NULL,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_slug TEXT,
        channel_id INT,
        scene_count INT NOT NULL DEFAULT 1,
        duration INT,
        video_resolution TEXT,
        status TEXT DEFAULT 'pending',
        final_video_url TEXT,
        dropbox_path TEXT,
        error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      ALTER TABLE story_template_groups ADD COLUMN IF NOT EXISTS topic TEXT;
      ALTER TABLE story_template_groups ADD COLUMN IF NOT EXISTS options JSONB;
      ALTER TABLE story_template_groups ADD COLUMN IF NOT EXISTS selected_option_id INT;
      ALTER TABLE story_template_groups ADD COLUMN IF NOT EXISTS ai_status TEXT;
      ALTER TABLE story_template_groups ADD COLUMN IF NOT EXISTS composite_image_prompt TEXT;
      ALTER TABLE story_template_groups ADD COLUMN IF NOT EXISTS composite_image_url TEXT;
      ALTER TABLE story_template_groups ADD COLUMN IF NOT EXISTS composite_kie_task_id TEXT;
      ALTER TABLE story_template_groups ADD COLUMN IF NOT EXISTS composite_status TEXT;
      CREATE INDEX IF NOT EXISTS idx_story_groups_user
        ON story_template_groups(user_id, created_at DESC);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS story_templates (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        thumbnail_url TEXT,
        preview_video_url TEXT,
        image_prompt_template TEXT,
        video_prompt_template TEXT,
        system_prompt TEXT,
        template_variables JSONB DEFAULT '[]'::jsonb,
        fixed_scenes INT,
        scene_descriptions JSONB DEFAULT '[]'::jsonb,
        field_config JSONB DEFAULT '{}'::jsonb,
        display_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        yearly_only BOOLEAN DEFAULT FALSE,
        gender TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      ALTER TABLE story_templates ADD COLUMN IF NOT EXISTS system_prompt TEXT;
      CREATE INDEX IF NOT EXISTS idx_story_templates_active
        ON story_templates(is_active, display_order);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS story_template_drafts (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_slug TEXT NOT NULL,
        state JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (user_id, template_slug)
      );
    `);
    console.log('✅ story_template_tasks + story_template_groups + story_templates + story_template_drafts tables ready');
  } catch (err) {
    console.error('Failed to create story template tables:', err);
  }
})();

async function getUserKieKey(userId: number): Promise<string | null> {
  const r = await pool.query(`SELECT kie_api_key FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.kie_api_key || null;
}

// Replace {key} placeholders. Missing keys → empty string.
function substitutePrompt(template: string, subs: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => subs[k] ?? '');
}

// Build the KIE create-task body for the requested model. Uses signed URLs as-is — KIE accepts external HTTPS URLs.
function buildKieBody(args: {
  model: string;
  prompt: string;
  imageUrls: string[];
  aspectRatio?: string;
  resolution?: string;
}): { kieModel: string; body: any } {
  const { model, prompt, imageUrls, aspectRatio, resolution } = args;
  const hasImages = imageUrls.length > 0;

  if (model === 'grok-imagine') {
    const kieModel = hasImages ? 'grok-imagine/image-to-image' : 'grok-imagine/text-to-image';
    // Grok i2i: prompt must reference @image1
    const finalPrompt = hasImages && !/^@image\d/i.test(prompt) ? `@image1 ${prompt}` : prompt;
    return {
      kieModel,
      body: {
        model: kieModel,
        input: hasImages
          ? { prompt: finalPrompt, image_urls: imageUrls.slice(0, 1) } // Grok i2i max 1
          : { prompt: finalPrompt, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) },
      },
    };
  }

  if (model === 'nano-banana-2' || model === 'nano-banana-pro') {
    const kieModel = model;
    return {
      kieModel,
      body: {
        model: kieModel,
        input: {
          prompt,
          ...(hasImages ? { image_input: imageUrls.slice(0, model === 'nano-banana-2' ? 14 : 8) } : {}),
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : { aspect_ratio: model === 'nano-banana-pro' ? '1:1' : 'auto' }),
          ...(resolution ? { resolution } : { resolution: '1K' }),
          output_format: 'png',
        },
      },
    };
  }

  // Default: gpt-image-2
  const kieModel = hasImages ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image';
  return {
    kieModel,
    body: {
      model: kieModel,
      input: {
        prompt,
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        ...(resolution ? { resolution } : {}),
        ...(hasImages ? { input_urls: imageUrls.slice(0, 16) } : {}),
      },
    },
  };
}

// POST /api/story-template/generate
router.post('/generate', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const {
      template_slug,
      model,
      prompt_template,
      variables,
      image_inputs, // { mainImage, outfitImage, backgroundImage, objectImage }
      text_values,  // { outfitText, backgroundText }
      aspect_ratio,
      resolution,
      channel_id,
      group_id,
      scene_number,
      scene_count,
      duration,
      video_resolution,
      topic,
      existing_task_id,
    } = req.body as {
      template_slug?: string;
      model?: string;
      prompt_template?: string;
      variables?: Record<string, string>;
      image_inputs?: { mainImage?: string; outfitImage?: string; backgroundImage?: string; objectImage?: string };
      text_values?: { outfitText?: string; backgroundText?: string };
      aspect_ratio?: string;
      resolution?: string;
      channel_id?: number | string;
      group_id?: string;
      scene_number?: number;
      scene_count?: number;
      duration?: number;
      video_resolution?: string;
      topic?: string;
      existing_task_id?: number; // when provided, attach KIE result to this draft row instead of creating new
    };

    if (!prompt_template || !prompt_template.trim()) {
      return res.status(400).json({ error: 'prompt_template is required' });
    }
    const modelKey = (model || 'gpt-image-2').trim();
    const channelId = channel_id ? parseInt(String(channel_id)) : null;
    const templateSlug = template_slug && template_slug.trim() ? template_slug.trim() : null;
    const imgs = image_inputs || {};
    const txt = text_values || {};
    const vars = variables || {};

    // Substitution map: image takes precedence over text for outfit/background
    const subs: Record<string, string> = {
      ...vars,
      main: imgs.mainImage || '',
      outfit: imgs.outfitImage || txt.outfitText || '',
      background: imgs.backgroundImage || txt.backgroundText || '',
      object: imgs.objectImage || '',
    };

    let finalPrompt = substitutePrompt(prompt_template, subs);

    // Strip any pre-existing duplicate Background:/Outfit: lines that may have crept in from earlier corrupt rows
    {
      const seen = new Set<string>();
      finalPrompt = finalPrompt
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('Background:') || trimmed.startsWith('Outfit:')) {
            if (seen.has(trimmed)) return false;
            seen.add(trimmed);
          }
          return true;
        })
        .join('\n');
    }

    // Append text hints idempotently — only when not already in the prompt
    const hints: string[] = [];
    if (txt.outfitText && txt.outfitText.trim() && !prompt_template.includes('{outfit}')) {
      const hint = `Outfit: ${txt.outfitText.trim()}`;
      if (!finalPrompt.includes(hint)) hints.push(hint);
    }
    if (txt.backgroundText && txt.backgroundText.trim() && !prompt_template.includes('{background}')) {
      const hint = `Background: ${txt.backgroundText.trim()}`;
      if (!finalPrompt.includes(hint)) hints.push(hint);
    }
    if (hints.length > 0) {
      finalPrompt = `${finalPrompt}\n\n${hints.join('. ')}.`;
    }

    const kieKey = await getUserKieKey(userId);
    if (!kieKey) {
      return res.status(400).json({ error: 'KIE API key not configured. Set it in your profile first.' });
    }

    // Multi-image-capable models lock characters across scenes in storyboard mode by accepting refs from other scenes.
    // grok-imagine i2i is single-input — only the scene's own slot is sent.
    const multiImageModels = ['gpt-image-2', 'nano-banana-2', 'nano-banana-pro'];
    const supportsMultiImage = multiImageModels.includes(modelKey);

    // Collect character refs from sibling scenes in the same group (storyboard character lock)
    const groupIdForRefs = group_id && group_id.trim() ? group_id.trim() : null;
    const groupSceneRefs: { scene: number; url: string }[] = [];
    if (supportsMultiImage && groupIdForRefs) {
      const r = await pool.query(
        `SELECT scene_number, image_inputs FROM story_template_tasks
         WHERE user_id = $1 AND group_id = $2 AND id != COALESCE($3, 0)
         ORDER BY COALESCE(scene_number, 1) ASC`,
        [userId, groupIdForRefs, existing_task_id || 0]
      );
      for (const row of r.rows) {
        const m = row.image_inputs?.mainImage;
        if (typeof m === 'string' && m.length > 0) {
          groupSceneRefs.push({ scene: row.scene_number || 0, url: m });
        }
      }
    }

    // Build the ordered, deduplicated input list:
    //   1) current scene's own slots (main/outfit/bg/object) — dominant, defines this scene's setting
    //   2) sibling scenes' mainImages — character anchors (multi-image models only)
    const orderedSources: { key: string; url: string }[] = [];
    const seen = new Set<string>();
    const addSource = (key: string, url?: string) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      orderedSources.push({ key, url });
    };
    addSource('mainImage', imgs.mainImage);
    addSource('outfitImage', imgs.outfitImage);
    addSource('backgroundImage', imgs.backgroundImage);
    addSource('objectImage', imgs.objectImage);
    for (const sib of groupSceneRefs) addSource(`scene${sib.scene}_main`, sib.url);

    // Re-upload each external URL (Dropbox/etc) to KIE's File API for reliable fetching.
    let kieUrlCache: Record<string, { original: string; kie: string }> = {};
    if (typeof existing_task_id === 'number' && existing_task_id > 0) {
      const cacheRow = await pool.query(
        `SELECT kie_image_urls FROM story_template_tasks WHERE id = $1 AND user_id = $2`,
        [existing_task_id, userId]
      );
      kieUrlCache = cacheRow.rows[0]?.kie_image_urls || {};
    }
    const kieImageUrls: string[] = [];
    for (const src of orderedSources) {
      const cached = kieUrlCache[src.key];
      if (cached?.original === src.url && cached?.kie) {
        kieImageUrls.push(cached.kie);
        continue;
      }
      try {
        const kieUrl = await uploadUrlToKie(kieKey, src.url, src.key, userId);
        kieUrlCache[src.key] = { original: src.url, kie: kieUrl };
        kieImageUrls.push(kieUrl);
        console.log(`[storyTemplate:generate] uploaded ${src.key} to KIE: ${kieUrl}`);
      } catch (upErr: any) {
        console.warn(`[storyTemplate:generate] KIE upload failed for ${src.key}, using original URL: ${upErr?.message}`);
        kieImageUrls.push(src.url);
      }
    }
    const imageUrls = kieImageUrls;

    const { body: kieBody } = buildKieBody({
      model: modelKey,
      prompt: finalPrompt,
      imageUrls,
      aspectRatio: aspect_ratio,
      resolution,
    });

    // KIE createTask is NOT idempotent — each call creates a new task and consumes credits even when
    // the response reports an error. So we MUST NOT auto-retry here. One shot only — surface the error
    // to the frontend and let the user retry manually if they want to.
    console.log(`[storyTemplate:generate] submitting model=${modelKey} kie=${(kieBody as any)?.model} prompt_len=${finalPrompt.length} images=${imageUrls.length}`);
    const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kieKey}` },
      body: JSON.stringify(kieBody),
    });
    const kieData: any = await kieRes.json().catch(() => ({}));
    console.log(`[storyTemplate:generate] KIE response → HTTP ${kieRes.status} code=${kieData?.code} msg=${(kieData?.msg || '').substring(0, 200)} taskId=${kieData?.data?.taskId || 'none'}`);

    if (!kieRes.ok || kieData.code !== 200 || !kieData.data?.taskId) {
      console.error(`[storyTemplate:generate] body sent:`, JSON.stringify(kieBody).substring(0, 1000));
      return res.status(502).json({
        error: kieData.msg || `KIE error (HTTP ${kieRes.status})`,
        details: kieData,
      });
    }

    const taskId: string = kieData.data.taskId;
    const groupIdNorm = group_id && group_id.trim() ? group_id.trim() : null;
    const sceneNum = typeof scene_number === 'number' && scene_number > 0 ? scene_number : null;

    // Upsert the group row on first task of a group so the runner has scene_count + duration available
    if (groupIdNorm) {
      await pool.query(
        `INSERT INTO story_template_groups (group_id, user_id, template_slug, channel_id, scene_count, duration, video_resolution, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         ON CONFLICT (group_id) DO NOTHING`,
        [
          groupIdNorm,
          userId,
          templateSlug,
          channelId,
          typeof scene_count === 'number' && scene_count > 0 ? scene_count : 1,
          10, // duration locked at 10s (grok-imagine reliable speech limit)
          video_resolution || null,
        ]
      );
    }

    let inserted: any;
    if (typeof existing_task_id === 'number' && existing_task_id > 0) {
      // Attach KIE result to an existing draft task
      const upd = await pool.query(
        `UPDATE story_template_tasks SET
           task_id = $1,
           model = $2,
           prompt_template = $3,
           prompt = $4,
           variables = $5::jsonb,
           image_inputs = $6::jsonb,
           text_values = $7::jsonb,
           aspect_ratio = COALESCE($8, aspect_ratio),
           resolution = COALESCE($9, resolution),
           status = 'pending',
           channel_id = COALESCE($10, channel_id),
           group_id = COALESCE($11, group_id),
           scene_number = COALESCE($12, scene_number),
           current_step = 'image_gen',
           topic = COALESCE($13, topic),
           error = NULL,
           result_url = NULL,
           dropbox_url = NULL,
           video_task_id = NULL,
           video_url = NULL,
           video_status = NULL,
           kie_image_urls = $16::jsonb,
           updated_at = NOW()
         WHERE id = $14 AND user_id = $15
         RETURNING id, task_id, template_slug, model, prompt, variables, image_inputs, text_values, aspect_ratio, resolution, status, channel_id, group_id, scene_number, current_step, topic, created_at`,
        [
          taskId,
          modelKey,
          prompt_template,
          finalPrompt,
          JSON.stringify(vars),
          JSON.stringify(imgs),
          JSON.stringify(txt),
          aspect_ratio || null,
          resolution || null,
          channelId,
          groupIdNorm,
          sceneNum,
          topic && topic.trim() ? topic.trim() : null,
          existing_task_id,
          userId,
          JSON.stringify(kieUrlCache),
        ]
      );
      if (upd.rowCount === 0) return res.status(404).json({ error: 'existing_task_id not found' });
      inserted = upd.rows[0];

      // If group was marked failed (e.g. earlier scene errored), allow runner to resume concat
      if (groupIdNorm) {
        await pool.query(
          `UPDATE story_template_groups
           SET status='pending', error=NULL, updated_at=NOW()
           WHERE group_id=$1 AND status IN ('failed', 'processing')`,
          [groupIdNorm]
        );
      }
    } else {
      const ins = await pool.query(
        `INSERT INTO story_template_tasks
         (user_id, task_id, template_slug, model, prompt_template, prompt, variables, image_inputs, text_values, aspect_ratio, resolution, status, channel_id, group_id, scene_number, current_step, topic, kie_image_urls)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13, $14, 'image_gen', $15, $16::jsonb)
         RETURNING id, task_id, template_slug, model, prompt, variables, image_inputs, text_values, aspect_ratio, resolution, status, channel_id, group_id, scene_number, current_step, topic, created_at`,
        [
          userId,
          taskId,
          templateSlug,
          modelKey,
          prompt_template,
          finalPrompt,
          JSON.stringify(vars),
          JSON.stringify(imgs),
          JSON.stringify(txt),
          aspect_ratio || null,
          resolution || null,
          channelId,
          groupIdNorm,
          sceneNum,
          topic && topic.trim() ? topic.trim() : null,
          JSON.stringify(kieUrlCache),
        ]
      );
      inserted = ins.rows[0];
    }

    return res.json({ success: true, task: inserted });
  } catch (err: any) {
    console.error('[storyTemplate:generate] Error:', err);
    return res.status(500).json({ error: err?.message || 'Generate failed' });
  }
});

// POST /api/story-template/groups/:groupId/composite-generate
// Generate ONE composite image per group (used as base for every scene's video).
// Uses the AI-picked composite_image_prompt + ALL sibling tasks' mainImage refs as multi-input.
// Polls KIE up to 120s for the result, saves composite_image_url to the group, returns it.
router.post('/groups/:groupId/composite-generate', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { groupId } = req.params;
    const { force } = req.body as { force?: boolean };

    const gr = await pool.query(
      `SELECT composite_image_prompt, composite_image_url, composite_status, composite_kie_task_id
       FROM story_template_groups WHERE group_id=$1 AND user_id=$2`,
      [groupId, userId]
    );
    if (gr.rowCount === 0) return res.status(404).json({ error: 'group not found' });
    const g = gr.rows[0];

    if (g.composite_image_url && !force) {
      return res.json({ success: true, composite_image_url: g.composite_image_url, reused: true });
    }
    if (!g.composite_image_prompt) {
      return res.status(400).json({ error: 'composite_image_prompt missing — pick an AI option first' });
    }

    const kieKey = await getUserKieKey(userId);
    if (!kieKey) return res.status(400).json({ error: 'KIE API key not configured' });

    // Collect mainImage refs + outfit/background text values from every task in the group
    const taskRefs = await pool.query(
      `SELECT scene_number, image_inputs, text_values, model FROM story_template_tasks
       WHERE user_id=$1 AND group_id=$2
       ORDER BY COALESCE(scene_number, 1) ASC`,
      [userId, groupId]
    );
    const refUrls: { slot: string; url: string }[] = [];
    const seen = new Set<string>();
    const outfitTexts = new Set<string>();
    const backgroundTexts = new Set<string>();
    let modelKey = 'nano-banana-2'; // default to multi-image-capable
    for (const row of taskRefs.rows) {
      const tv = row.text_values || {};
      if (tv.outfitText && typeof tv.outfitText === 'string' && tv.outfitText.trim()) outfitTexts.add(tv.outfitText.trim());
      if (tv.backgroundText && typeof tv.backgroundText === 'string' && tv.backgroundText.trim()) backgroundTexts.add(tv.backgroundText.trim());
      if (row.model && ['gpt-image-2', 'nano-banana-2', 'nano-banana-pro'].includes(row.model)) {
        modelKey = row.model;
      }
      const m = row.image_inputs?.mainImage;
      if (typeof m === 'string' && m.length > 0 && !seen.has(m)) {
        seen.add(m);
        refUrls.push({ slot: `scene${row.scene_number}_main`, url: m });
      }
      const o = row.image_inputs?.outfitImage;
      if (typeof o === 'string' && o.length > 0 && !seen.has(o)) {
        seen.add(o);
        refUrls.push({ slot: `scene${row.scene_number}_outfit`, url: o });
      }
      const b = row.image_inputs?.backgroundImage;
      if (typeof b === 'string' && b.length > 0 && !seen.has(b)) {
        seen.add(b);
        refUrls.push({ slot: `scene${row.scene_number}_bg`, url: b });
      }
      const j = row.image_inputs?.objectImage;
      if (typeof j === 'string' && j.length > 0 && !seen.has(j)) {
        seen.add(j);
        refUrls.push({ slot: `scene${row.scene_number}_obj`, url: j });
      }
    }
    if (refUrls.length === 0) {
      return res.status(400).json({ error: 'no reference images found in group tasks' });
    }

    // Re-upload each ref to KIE storage
    const kieRefUrls: string[] = [];
    for (const r of refUrls) {
      try {
        const u = await uploadUrlToKie(kieKey, r.url, r.slot, userId);
        kieRefUrls.push(u);
      } catch (err: any) {
        console.warn(`[composite] upload ${r.slot} failed: ${err?.message}, using original`);
        kieRefUrls.push(r.url);
      }
    }

    // Append user-typed outfit/background hints to the composite prompt so the generated image
    // reflects what the user actually wrote in the form (composite_image_prompt from AI doesn't see these).
    let finalCompositePrompt: string = g.composite_image_prompt;
    const userHints: string[] = [];
    if (outfitTexts.size > 0) userHints.push(`Outfits: ${Array.from(outfitTexts).join(', ')}`);
    if (backgroundTexts.size > 0) userHints.push(`Background: ${Array.from(backgroundTexts).join(', ')}`);
    if (userHints.length > 0) {
      finalCompositePrompt = `${finalCompositePrompt}\n\n${userHints.join('. ')}.`;
    }

    const { body: kieBody } = buildKieBody({
      model: modelKey,
      prompt: finalCompositePrompt,
      imageUrls: kieRefUrls,
      aspectRatio: '9:16',
      resolution: '1K',
    });

    console.log(`[composite] submitting kie=${(kieBody as any)?.model} refs=${kieRefUrls.length} prompt_len=${finalCompositePrompt.length}`);
    const subRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kieKey}` },
      body: JSON.stringify(kieBody),
    });
    const subData: any = await subRes.json().catch(() => ({}));
    if (!subRes.ok || subData.code !== 200 || !subData.data?.taskId) {
      const msg = subData.msg || `KIE error HTTP ${subRes.status}`;
      await pool.query(
        `UPDATE story_template_groups SET composite_status='failed', error=$1, updated_at=NOW() WHERE group_id=$2`,
        [msg, groupId]
      );
      return res.status(502).json({ error: msg, details: subData });
    }
    const compositeKieTaskId = subData.data.taskId as string;
    await pool.query(
      `UPDATE story_template_groups SET composite_kie_task_id=$1, composite_status='generating', error=NULL, updated_at=NOW()
       WHERE group_id=$2`,
      [compositeKieTaskId, groupId]
    );

    // Poll up to 120 seconds for the composite image
    const findUrl = (obj: any): string | null => {
      if (!obj) return null;
      if (typeof obj === 'string') return /^https?:\/\//.test(obj) ? obj : null;
      if (Array.isArray(obj)) { for (const x of obj) { const u = findUrl(x); if (u) return u; } return null; }
      if (typeof obj === 'object') { for (const k of Object.keys(obj)) { const u = findUrl(obj[k]); if (u) return u; } }
      return null;
    };

    let compositeUrl: string | null = null;
    let pollErrMsg: string | null = null;
    const start = Date.now();
    while (Date.now() - start < 120_000) {
      await new Promise((rs) => setTimeout(rs, 4000));
      try {
        const pr = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(compositeKieTaskId)}`, {
          headers: { Authorization: `Bearer ${kieKey}` },
        });
        if (!pr.ok) continue;
        const raw: any = await pr.json().catch(() => ({}));
        const data = raw?.data || raw || {};
        const state: string | undefined = data.state || data.status;
        if (state === 'success' || state === 'completed' || state === 'done') {
          let url: string | null = null;
          if (data.resultJson) {
            try {
              const rd = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
              url = rd.resultUrls?.[0] || rd.result_urls?.[0] || rd.imageUrls?.[0] || rd.image_urls?.[0]
                  || rd.urls?.[0] || rd.url || rd.image_url || rd.imageUrl || null;
              if (!url) url = findUrl(rd);
            } catch {}
          }
          if (!url) url = data.resultUrl || data.imageUrl || data.image_url || data.url || null;
          if (!url) url = findUrl(data) || findUrl(raw);
          if (url) { compositeUrl = url; break; }
          pollErrMsg = 'No image URL in result';
          break;
        }
        if (state === 'fail' || state === 'failed' || state === 'error') {
          pollErrMsg = data.failMsg || data.fail_msg || data.errorMessage || data.error || 'composite generation failed';
          break;
        }
      } catch (pollErr: any) {
        console.warn(`[composite] poll error: ${pollErr?.message}`);
      }
    }

    if (!compositeUrl) {
      const msg = pollErrMsg || 'composite generation timed out (>120s)';
      await pool.query(
        `UPDATE story_template_groups SET composite_status='failed', error=$1, updated_at=NOW() WHERE group_id=$2`,
        [msg, groupId]
      );
      return res.status(502).json({ error: msg });
    }

    await pool.query(
      `UPDATE story_template_groups SET composite_image_url=$1, composite_status='success', error=NULL, updated_at=NOW()
       WHERE group_id=$2`,
      [compositeUrl, groupId]
    );
    console.log(`[composite] group ${groupId} ready: ${compositeUrl}`);
    return res.json({ success: true, composite_image_url: compositeUrl, reused: false });
  } catch (err: any) {
    console.error('[storyTemplate:composite-generate] Error:', err);
    return res.status(500).json({ error: err?.message || 'Composite generation failed' });
  }
});

// POST /api/story-template/tasks/:taskId/retry — smart resume:
//   1) all segments already generated successfully but concat/upload failed → re-run concat only (don't regen videos)
//   2) image done + video failed (some segment still failed) → reset video state, runner re-submits failed segments
//   3) image failed/never run → caller follows up with /generate
router.post('/tasks/:taskId/retry', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.taskId);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid taskId' });
    const r = await pool.query(
      `SELECT id, status, result_url, video_status, video_segments, group_id FROM story_template_tasks WHERE id=$1 AND user_id=$2`,
      [id, userId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'task not found' });
    const t = r.rows[0];

    const imageDone = t.status === 'success' && !!t.result_url;
    const videoFailed = t.video_status === 'failed';
    const segments: any[] = Array.isArray(t.video_segments) ? t.video_segments : [];
    const allSegsHaveUrl = segments.length > 0 && segments.every((s) => s?.video_url);

    // Case 1 — concat-only retry: every segment has a video URL, but concat or Dropbox upload failed
    if (imageDone && videoFailed && allSegsHaveUrl) {
      // Reset every segment back to 'success' so pollVideoForTask runs the concat path again
      const restored = segments.map((s) => ({ ...s, status: 'success', error: undefined }));
      await pool.query(
        `UPDATE story_template_tasks
         SET video_status='pending', current_step='video_gen', error=NULL, video_segments=$1::jsonb, updated_at=NOW()
         WHERE id=$2`,
        [JSON.stringify(restored), id]
      );
      if (t.group_id) {
        await pool.query(
          `UPDATE story_template_groups SET status='pending', error=NULL, updated_at=NOW()
           WHERE group_id=$1 AND status IN ('failed', 'processing')`,
          [t.group_id]
        );
      }
      return res.json({ success: true, mode: 'concat-only' });
    }

    // Case 2 — video-only retry: image is done but some segment failed; clear video state and regen
    if (imageDone && videoFailed) {
      await pool.query(
        `UPDATE story_template_tasks
         SET video_status=NULL, video_url=NULL, video_task_id=NULL, video_segments=NULL,
             current_step='image_gen', error=NULL, updated_at=NOW()
         WHERE id=$1`,
        [id]
      );
      if (t.group_id) {
        await pool.query(
          `UPDATE story_template_groups SET status='pending', error=NULL, updated_at=NOW()
           WHERE group_id=$1 AND status IN ('failed', 'processing')`,
          [t.group_id]
        );
      }
      return res.json({ success: true, mode: 'video-only' });
    }

    // Case 3 — full retry: caller must call /generate with existing_task_id
    return res.json({ success: true, mode: 'full' });
  } catch (err: any) {
    console.error('[storyTemplate:retry] Error:', err);
    return res.status(500).json({ error: err?.message || 'Retry failed' });
  }
});

// GET /api/story-template/status/:taskId
router.get('/status/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { taskId } = req.params;

    const row = await pool.query(
      `SELECT id, task_id, template_slug, model, prompt, variables, image_inputs, text_values, aspect_ratio, resolution,
              status, result_url, dropbox_url, channel_id, error, group_id, scene_number, current_step,
              video_task_id, video_url, video_status, created_at, updated_at
       FROM story_template_tasks WHERE user_id = $1 AND task_id = $2`,
      [userId, taskId]
    );
    if (row.rowCount === 0) return res.status(404).json({ error: 'task not found' });
    const task = row.rows[0];

    // Image stage already finished — return DB state (runner keeps video fields current)
    if (task.status === 'success' || task.status === 'failed') {
      return res.json({ task });
    }

    const kieKey = await getUserKieKey(userId);
    if (!kieKey) return res.status(400).json({ error: 'KIE API key not configured' });

    const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${kieKey}` },
    });
    const raw: any = await kieRes.json().catch(() => ({}));
    const data = raw?.data || raw || {};
    const state: string | undefined = data.state || data.status;

    const findUrl = (obj: any): string | null => {
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
    };

    if (state === 'success' || state === 'completed' || state === 'done') {
      let url: string | null = null;
      if (data.resultJson) {
        try {
          const rd = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
          url = rd.resultUrls?.[0] || rd.result_urls?.[0] || rd.imageUrls?.[0] || rd.image_urls?.[0]
              || rd.urls?.[0] || rd.url || rd.image_url || rd.imageUrl || null;
          if (!url) url = findUrl(rd);
        } catch {}
      }
      if (!url) {
        url = data.resultUrl || data.imageUrl || data.image_url || data.url
            || data.resultUrls?.[0] || data.result_urls?.[0]
            || data.imageUrls?.[0] || data.image_urls?.[0] || null;
      }
      if (!url) url = findUrl(data) || findUrl(raw);

      if (url) {
        let dropboxUrl: string | null = null;
        if (isDropboxConfigured()) {
          try {
            const ext = (url.match(/\.(png|jpg|jpeg|webp)(\?|$)/i)?.[1] || 'png').toLowerCase();
            const dbxResult = await uploadImageToDropbox(url, userId, task.id, ext);
            dropboxUrl = dbxResult.sharedUrl;
          } catch (dbxErr: any) {
            console.error(`[storyTemplate:status] Dropbox upload failed for task ${taskId}:`, dbxErr?.message);
          }
        }

        await pool.query(
          `UPDATE story_template_tasks SET status = 'success', result_url = $1, dropbox_url = $2, updated_at = NOW() WHERE id = $3`,
          [url, dropboxUrl, task.id]
        );

        try {
          await pool.query(
            `INSERT INTO content_history (user_id, channel_id, video_url, prompt, aspect_ratio, source, created_at)
             VALUES ($1, $2, $3, $4, $5, 'story_template', NOW())
             ON CONFLICT (user_id, video_url) DO NOTHING`,
            [userId, task.channel_id, dropboxUrl || url, task.prompt, task.aspect_ratio]
          );
        } catch (chErr: any) {
          console.error(`[storyTemplate:status] content_history insert failed:`, chErr?.message);
        }

        return res.json({ task: { ...task, status: 'success', result_url: url, dropbox_url: dropboxUrl } });
      }
      await pool.query(
        `UPDATE story_template_tasks SET status = 'failed', error = 'No image URL in result', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
      return res.json({ task: { ...task, status: 'failed', error: 'No image URL in result' } });
    }

    // Treat HTTP-level errors (recordInfo call itself failed) as transient — leave pending for next poll
    if (!kieRes.ok) {
      console.warn(`[storyTemplate:status] HTTP ${kieRes.status} from KIE recordInfo for task ${task.id}, will retry`);
      return res.json({ task: { ...task, status: 'pending' } });
    }

    if (state === 'fail' || state === 'failed' || state === 'error') {
      const errMsg = data.failMsg || data.fail_msg || data.errorMessage || data.error || 'Generation failed';
      await pool.query(
        `UPDATE story_template_tasks SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
        [errMsg, task.id]
      );
      return res.json({ task: { ...task, status: 'failed', error: errMsg } });
    }

    return res.json({ task: { ...task, status: 'pending' } });
  } catch (err: any) {
    console.error('[storyTemplate:status] Error:', err);
    return res.status(500).json({ error: err?.message || 'Status check failed' });
  }
});

// POST /api/story-template/generate-options
// Phase 6b — call AI orchestrator with template's system_prompt + group's topic + scene_count
// → returns 3 story options, each with N scenes (image_prompt + video_prompt + dialogue per scene)
router.post('/generate-options', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { group_id, topic, template_slug, image_references, scene_references } = req.body as {
      group_id?: string;
      topic?: string;
      template_slug?: string;
      image_references?: string[];
      scene_references?: { scene: number; main?: string; outfit?: string; background?: string; object?: string }[];
    };
    if (!group_id || !topic || !topic.trim()) {
      return res.status(400).json({ error: 'group_id and topic are required' });
    }
    // Normalize scene_references — preferred over flat image_references
    const sceneRefs: { scene: number; slots: { label: string; url: string }[] }[] = [];
    if (Array.isArray(scene_references) && scene_references.length > 0) {
      for (const s of scene_references) {
        const slots: { label: string; url: string }[] = [];
        if (s.main) slots.push({ label: 'main', url: s.main });
        if (s.outfit) slots.push({ label: 'outfit', url: s.outfit });
        if (s.background) slots.push({ label: 'background', url: s.background });
        if (s.object) slots.push({ label: 'object', url: s.object });
        sceneRefs.push({ scene: s.scene, slots });
      }
    }
    const flatRefImages = Array.isArray(image_references) ? image_references.filter((u) => typeof u === 'string' && u.length > 0) : [];
    const hasAnyImage = sceneRefs.some((s) => s.slots.length > 0) || flatRefImages.length > 0;
    if (!hasAnyImage) {
      return res.status(400).json({ error: 'at least one reference image is required' });
    }

    // 1) Load or upsert the group row (must exist with scene_count + channel_id)
    let groupRow = await pool.query(
      `SELECT user_id, template_slug, channel_id, scene_count, duration, video_resolution
       FROM story_template_groups WHERE group_id = $1 AND user_id = $2`,
      [group_id, userId]
    );
    // If group hasn't been created yet (user pressed "Generate Story" before any /generate),
    // create a placeholder row from the request — scene_count is required for AI to produce N scenes.
    if (groupRow.rowCount === 0) {
      const sceneCount = Number(req.body.scene_count) > 0 ? Number(req.body.scene_count) : 1;
      const channelId = req.body.channel_id ? parseInt(String(req.body.channel_id)) : null;
      const slug = template_slug || null;
      await pool.query(
        `INSERT INTO story_template_groups (group_id, user_id, template_slug, channel_id, scene_count, duration, video_resolution, topic, ai_status, status)
         VALUES ($1, $2, $3, $4, $5, 10, '720p', $6, 'generating', 'pending')`,
        [group_id, userId, slug, channelId, sceneCount, topic.trim()]
      );
      groupRow = await pool.query(
        `SELECT user_id, template_slug, channel_id, scene_count, duration, video_resolution
         FROM story_template_groups WHERE group_id = $1 AND user_id = $2`,
        [group_id, userId]
      );
    } else {
      // Update topic + mark ai_status='generating'
      await pool.query(
        `UPDATE story_template_groups SET topic=$1, ai_status='generating', updated_at=NOW() WHERE group_id=$2 AND user_id=$3`,
        [topic.trim(), group_id, userId]
      );
    }
    const group = groupRow.rows[0];

    // 2) Load story_templates.system_prompt
    const tplSlug = template_slug || group.template_slug;
    if (!tplSlug) {
      await pool.query(`UPDATE story_template_groups SET ai_status='failed', error=$1, updated_at=NOW() WHERE group_id=$2`, ['no template_slug', group_id]);
      return res.status(400).json({ error: 'template_slug not set on group' });
    }
    const tplRow = await pool.query(
      `SELECT system_prompt FROM story_templates WHERE slug = $1`,
      [tplSlug]
    );
    const systemPrompt: string = tplRow.rows[0]?.system_prompt || '';
    if (!systemPrompt) {
      await pool.query(`UPDATE story_template_groups SET ai_status='failed', error=$1, updated_at=NOW() WHERE group_id=$2`, ['template has no system_prompt', group_id]);
      return res.status(400).json({ error: 'template has no system_prompt' });
    }

    // 3) Get user AI config
    const aiCfg = await pool.query(
      `SELECT openai_api_key, openrouter_api_key, ai_provider FROM users WHERE id = $1`,
      [userId]
    );
    const u = aiCfg.rows[0] || {};
    let baseUrl = 'https://api.openai.com/v1';
    let apiKey = u.openai_api_key || '';
    let model = 'gpt-4o-mini';
    if (u.ai_provider === 'openrouter' && u.openrouter_api_key) {
      baseUrl = 'https://openrouter.ai/api/v1';
      apiKey = u.openrouter_api_key;
      model = 'google/gemini-3-flash-preview';
    }
    if (!apiKey) {
      await pool.query(`UPDATE story_template_groups SET ai_status='failed', error=$1, updated_at=NOW() WHERE group_id=$2`, ['AI api key missing', group_id]);
      return res.status(400).json({ error: 'AI API key not configured (set in Profile)' });
    }

    // 4) Compose multimodal user message — text + image_url blocks (vision)
    const sceneCount = group.scene_count || 1;
    const sceneDuration = (Number.isFinite(Number(group.duration)) && Number(group.duration) >= 5) ? Number(group.duration) : 10;
    // Split scene duration into 10s/5s sub-clips (grok-imagine native limit). Pattern per spec:
    //   5→[5], 10→[10], 15→[10,5], 20→[10,10], 25→[10,10,5], 30→[10,10,10]
    const segmentDurations: number[] = (() => {
      switch (sceneDuration) {
        case 5: return [5];
        case 10: return [10];
        case 15: return [10, 5];
        case 20: return [10, 10];
        case 25: return [10, 10, 5];
        case 30: return [10, 10, 10];
        default: return [10];
      }
    })();
    const segCount = segmentDurations.length;
    const segDescription = segmentDurations.map((d, i) => `segment ${i + 1} = ${d}s`).join(', ');
    // Per-segment dialogue word range (~3 Thai words/sec)
    const segWordsRange = (sec: number) => {
      const min = Math.round(sec * 2.2);
      const max = Math.round(sec * 3.0);
      return `${min}-${max} คำ`;
    };
    const segWordsLine = segmentDurations.map((d, i) => `  - segment ${i + 1} (${d}s) → ${segWordsRange(d)}`).join('\n');
    const userText = [
      `คุณคือ AI สร้างคอนเทนต์วิดีโอไวรัล ใช้ตัวละครจาก IMAGE_REFERENCE ของแต่ละฉากเท่านั้น`,
      ``,
      `🎯 INPUT:`,
      `• TOPIC: ${topic.trim()}`,
      `• SCENE_COUNT: ${sceneCount}`,
      `• SCENE_DURATION: ${sceneDuration} วินาที/ฉาก → แตกเป็น ${segCount} sub-clip(s): ${segDescription}`,
      `• IMAGE_REFERENCE: แนบมาด้านล่าง (Scene 1 reference / Scene 2 reference / ...)`,
      ``,
      `🔒 กฎสำคัญ:`,
      `1. ใช้ตัวละครจาก IMAGE_REFERENCE ของฉากนั้นๆ (ล็อกหน้าตา 100%)`,
      `2. วิเคราะห์เพศ/สายพันธุ์/หน้าตาจากภาพ — ล็อกตลอดเรื่อง`,
      `3. ตัวละครพูดคนเดียวทุกฉาก เสียงเดียวกันทุกฉาก`,
      `4. โทน = บ่นตลก กวนๆ ฟีลชีวิตประจำวัน`,
      `5. ภาษา = ภาษาพูดบ้านๆ เข้าใจง่าย ไม่ทางการ`,
      `6. ห้ามมีตัวหนังสือในภาพทุกกรณี`,
      `7. ภาพและวิดีโอต้องสมจริง (cinematic / iPhone style)`,
      ``,
      `📦 SEGMENTS (สำคัญมาก — แตกแต่ละฉากเป็น sub-clip):`,
      `• แต่ละ scene ต้องมี segments[] array ที่มี ${segCount} item ตามแพทเทิร์น: ${segDescription}`,
      `• แต่ละ segment คือคลิป ${segmentDurations[0]}-วินาที 1 ตัว (โมเดลวิดีโอสร้างทีละ segment แล้วต่อกันเป็นฉากเดียว)`,
      `• แต่ละ segment ต้องมี dialogue ของตัวเอง + video_prompt ของตัวเอง`,
      `• dialogue ใน segments ต้องต่อกัน — รวมทั้งหมดเป็นบทพูดของฉากนั้น (segment 1 พูดต่อด้วย segment 2 ต่อด้วย ...)`,
      `• ความยาว dialogue ต่อ segment (อัตรา ~3 คำไทย/วินาที):`,
      segWordsLine,
      ``,
      `🪝 VIRAL HOOK (1-3 วินาทีแรก ของ scene 1, segment 1):`,
      `• ใช้คำเปิด: "เอ้า มึงเคยเป็นแบบนี้ปะ..." / "โคตรพีคเลยว่ะ..." / "ฟังนี่ก่อน กูเจอกับตัว..." / "เห้ย!" / "เธอ! มาดูนี่สิ"`,
      `• ห้ามเปิดด้วย narration ทั่วไป`,
      ``,
      `🎯 ENDING PEAK (ฉากสุดท้าย, segment สุดท้าย):`,
      `• ต้องมี punch line / twist / peak ห้ามจบเฉยๆ`,
      ``,
      `🖼️ COMPOSITE IMAGE (สำคัญที่สุด — 1 ภาพต่อ option ใช้เป็น base ของวิดีโอทุกฉาก):`,
      `• แต่ละ option มี composite_image_prompt = prompt สำหรับสร้าง 1 ภาพรวมที่มี "ตัวละครทุกตัวจาก IMAGE_REFERENCE" อยู่ในเฟรมเดียว`,
      `• ภาพนี้จะถูกใช้เป็น input ของวิดีโอ "ทุกฉาก" — เลยต้องประกอบให้ตัวละครยืนอยู่ในตำแหน่งที่ animate ได้สะดวก`,
      `• บรรยายเป็นภาษาอังกฤษ ~80-120 คำ — subject ทุกตัวจาก ref + พื้นหลังร่วม + composition + lighting + cinematic style`,
      `• ห้ามมีตัวอักษรในภาพ`,
      `• ตัวอย่าง: "a high-quality cinematic photo of a small Scottish Fold kitten and an adult brown tabby cat together in a luxurious restaurant interior, both cats looking forward, soft warm lighting from chandeliers, shallow depth of field, photorealistic, 9:16 vertical"`,
      ``,
      `📋 ในแต่ละ scene ต้องมี:`,
      `• scene_name — ชื่อฉากสั้นๆ`,
      `• visual — บรรยายภาพ/action ของฉากนั้น`,
      `• emotion — อารมณ์ (งง / กวน / หงุดหงิด / ขำ / ทึ่ง / เซ็ง / เขิน)`,
      `• segments[] — ${segCount} items ตามที่กำหนด (วิดีโอจะ animate จาก composite image)`,
      `• ⚠️ ห้ามใส่ image_prompt ต่อ scene — ใช้ composite_image_prompt ของ option แทน`,
      ``,
      `⚠️ Dialogue ต้อง:`,
      `• ฟังเหมือนคนพูดจริง — มี filler: "เออ" "คือ" "แบบ" "นะ" "ก็" "ประมาณว่า"`,
      `• แนวบ่นตลกเท่านั้น ไม่จริงจัง ไม่ดราม่า`,
      `• ภาษาไทยล้วน ห้ามคำอังกฤษปน (ทับศัพท์ไทยเช่น คาเฟ่ กาแฟ ได้)`,
      `• สรรพนาม กู/มึง/ฉัน/เธอ + ลงท้าย ว่ะ/อ่ะ/เนี่ย/นะ/แหละ`,
      ``,
      `🔗 NARRATIVE CONTINUITY:`,
      `• ทุกฉากเล่าเรื่องเดียวเป็น story arc (intro → conflict → climax → peak ending)`,
      `• ฉาก N+1 = ผลโดยตรงจากฉาก N — ความต่อเนื่องผ่าน dialogue + emotion เท่านั้น`,
      ``,
      `🚫 ห้ามมิกซ์ตัวละครข้ามฉาก (สำคัญมาก):`,
      `• image_prompt ของฉาก N ต้องบรรยายเฉพาะสิ่งที่อยู่ในรูปอ้างอิง Scene N เท่านั้น`,
      `• ห้าม! ใส่ตัวละคร/วัตถุ/พื้นหลังจากฉากอื่นมารวมในเฟรม — แม้ว่า dialogue จะอ้างถึงก็ตาม`,
      `• ถ้า dialogue ฉาก 2 พูดถึงตัวละครฉาก 1 → ใช้ตัวละครของฉาก 2 พูดในมุมตัวเอง (เช่น "พี่ทำได้ยังไง..." โดยมีแค่ตัวละครฉาก 2 ในเฟรม)`,
      `• ความต่อเนื่องเชื่อมด้วย dialogue + emotion + body language — ไม่ใช่การยัดทุกตัวละครลงในเฟรมเดียว`,
      ``,
      `🎨 image_prompt format (สำหรับภาพนิ่ง — 1 ต่อ scene):`,
      `• ภาษาอังกฤษ ~80-120 คำ บรรยายตามรูปอ้างอิง Scene N`,
      `• cinematic / iPhone realistic — ห้ามมีข้อความในภาพ`,
      `• ระบุ subject + setting + mood + lighting + composition`,
      `• ห้าม markdown / bullet`,
      ``,
      `🎬 video_prompt format (สำหรับ 1 segment — ต้อง embed dialogue ตาม Viral pattern):`,
      `• format เป๊ะๆ: "a high-quality cinematic iPhone-style handheld 9:16 vertical shot of [ลักษณะตัวละคร]. [Action + facial + emotion]. Lip-sync perfectly to the ภาษาไทย dialogue spoken by a native Thai speaker with clear standard Bangkok accent and natural intonation: '[dialogue ของ segment นี้]' Voice tone: [emotion], native Thai voice, clear pronunciation, same voice as previous segments. Strictly no text, no subtitles, no watermarks."`,
      `• ภาษาอังกฤษทั้งหมด ยกเว้น dialogue ในเครื่องหมายคำพูด`,
      `• ห้ามใส่ duration / CRITICAL / NOTE`,
      ``,
      `🚨 OUTPUT (JSON เท่านั้น):`,
      `{`,
      `  "options": [`,
      `    {`,
      `      "option_id": 1,`,
      `      "story_summary": "...",`,
      `      "composite_image_prompt": "<English ~80-120 words describing 1 image with ALL characters from refs together>",`,
      `      "scenes": [`,
      `        { "scene": 1, "scene_name": "...", "visual": "...", "emotion": "...",`,
      `          "segments": [`,
      `            { "duration": ${segmentDurations[0]}, "dialogue": "...", "video_prompt": "..." }${segmentDurations.length > 1 ? ',' : ''}`,
      ...(segmentDurations.length > 1 ? segmentDurations.slice(1).map((d, i) => `            { "duration": ${d}, "dialogue": "...", "video_prompt": "..." }${i < segmentDurations.length - 2 ? ',' : ''}`) : []),
      `          ]`,
      `        }`,
      `      ]`,
      `    },`,
      `    { "option_id": 2, ... },`,
      `    { "option_id": 3, ... }`,
      `  ]`,
      `}`,
      ``,
      `กฎ: 3 options เป๊ะ, scenes ต่อ option = ${sceneCount} เป๊ะ, segments ต่อ scene = ${segCount} เป๊ะ`,
    ].join('\n');

    const userContent: any[] = [{ type: 'text', text: userText }];
    // Per-scene reference images (preferred path) — label each group so AI maps scene→images
    const MAX_IMAGES = 12;
    let imgCount = 0;
    if (sceneRefs.length > 0) {
      for (const s of sceneRefs) {
        if (s.slots.length === 0) continue;
        userContent.push({ type: 'text', text: `\n=== Scene ${s.scene} reference images ===` });
        for (const slot of s.slots) {
          if (imgCount >= MAX_IMAGES) break;
          userContent.push({ type: 'text', text: `(${slot.label})` });
          userContent.push({ type: 'image_url', image_url: { url: slot.url } });
          imgCount++;
        }
        if (imgCount >= MAX_IMAGES) break;
      }
    } else {
      // Fallback: flat image_references (legacy)
      for (const url of flatRefImages.slice(0, 4)) {
        userContent.push({ type: 'image_url', image_url: { url } });
      }
    }

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const callAI = async (msgs: any[]) => {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: msgs, temperature: 1.0 }),
      });
      if (!resp.ok) throw new Error(`AI error ${resp.status}: ${await resp.text()}`);
      const d: any = await resp.json();
      return d.choices?.[0]?.message?.content || '';
    };

    let content = await callAI(messages);
    if (!content) throw new Error('Empty AI response');

    // Try to extract JSON object
    let parsed: any = null;
    let m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch {}
    }
    if (!parsed) {
      // Fallback: ask AI to convert
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: 'แปลงคำตอบข้างบนเป็น JSON object ตาม schema เท่านั้น ห้ามมี text อื่น' });
      content = await callAI(messages);
      m = content.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }
    if (!parsed?.options || !Array.isArray(parsed.options)) {
      await pool.query(`UPDATE story_template_groups SET ai_status='failed', error=$1, updated_at=NOW() WHERE group_id=$2`, ['AI returned invalid JSON', group_id]);
      return res.status(502).json({ error: 'AI returned invalid JSON', raw: content.substring(0, 500) });
    }

    // Strict validation: must be exactly 3 options. Retry once if not.
    if (parsed.options.length !== 3) {
      console.warn(`[storyTemplate:generate-options] AI returned ${parsed.options.length} options, retrying for exactly 3...`);
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: `คุณคืนมาแค่ ${parsed.options.length} option — กฎต้องเป็น "options" array ที่มี exactly 3 items (option_id: 1, 2, 3) ห้ามขาด ห้ามเกิน กรุณาตอบใหม่เป็น JSON ที่มี options 3 ตัวเท่านั้น` });
      try {
        content = await callAI(messages);
        const m2 = content.match(/\{[\s\S]*\}/);
        if (m2) {
          const reparsed = JSON.parse(m2[0]);
          if (reparsed?.options && Array.isArray(reparsed.options) && reparsed.options.length === 3) {
            parsed = reparsed;
          }
        }
      } catch (e) {
        console.warn('[storyTemplate:generate-options] retry failed:', (e as any)?.message);
      }
    }

    // Validate scene counts (warn only — frontend handles missing scenes gracefully)
    for (const opt of parsed.options) {
      if (!Array.isArray(opt.scenes) || opt.scenes.length !== sceneCount) {
        console.warn(`[storyTemplate:generate-options] option_id=${opt.option_id} has ${opt.scenes?.length} scenes (expected ${sceneCount})`);
      }
    }

    await pool.query(
      `UPDATE story_template_groups SET options=$1, ai_status='success', updated_at=NOW() WHERE group_id=$2`,
      [JSON.stringify(parsed), group_id]
    );

    return res.json({ success: true, options: parsed.options });
  } catch (err: any) {
    console.error('[storyTemplate:generate-options] Error:', err);
    if (req.body?.group_id) {
      await pool.query(
        `UPDATE story_template_groups SET ai_status='failed', error=$1, updated_at=NOW() WHERE group_id=$2`,
        [err?.message || 'AI orchestration failed', req.body.group_id]
      ).catch(() => {});
    }
    return res.status(500).json({ error: err?.message || 'Generate options failed' });
  }
});

// ============================================
// Viral-style draft persistence — group + tasks live in DB from creation
// ============================================

// POST /api/story-template/groups — create group + N draft tasks (no KIE call)
router.post('/groups', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { template_slug, channel_id, scene_count, video_resolution, duration, model, topic, group_id } = req.body as {
      template_slug?: string;
      channel_id?: number | string;
      scene_count?: number;
      video_resolution?: string;
      duration?: number;
      model?: string;
      topic?: string;
      group_id?: string;
    };
    if (!template_slug) return res.status(400).json({ error: 'template_slug is required' });
    const sceneCount = Math.max(1, Math.min(50, Number(scene_count) || 1));
    const channelId = channel_id ? parseInt(String(channel_id)) : null;
    const groupIdNorm =
      group_id && group_id.trim() ? group_id.trim() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const modelKey = (model || 'gpt-image-2').trim();
    // Clamp duration to allowed values (5/10/15/20/25/30)
    const allowedDurations = [5, 10, 15, 20, 25, 30];
    const durationNorm = allowedDurations.includes(Number(duration)) ? Number(duration) : 10;

    await pool.query(
      `INSERT INTO story_template_groups (group_id, user_id, template_slug, channel_id, scene_count, duration, video_resolution, topic, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT (group_id) DO UPDATE SET
         scene_count = EXCLUDED.scene_count,
         channel_id = EXCLUDED.channel_id,
         duration = EXCLUDED.duration,
         video_resolution = EXCLUDED.video_resolution,
         topic = COALESCE(EXCLUDED.topic, story_template_groups.topic),
         updated_at = NOW()`,
      [groupIdNorm, userId, template_slug, channelId, sceneCount, durationNorm, video_resolution || '720p', topic || null]
    );

    // Insert N draft tasks if not yet created
    const existingCount = await pool.query(
      `SELECT COUNT(*) as cnt FROM story_template_tasks WHERE user_id = $1 AND group_id = $2`,
      [userId, groupIdNorm]
    );
    const have = parseInt(existingCount.rows[0]?.cnt || '0', 10);
    const toAdd = Math.max(0, sceneCount - have);
    for (let i = 0; i < toAdd; i++) {
      const sceneNumber = have + i + 1;
      await pool.query(
        `INSERT INTO story_template_tasks
         (user_id, task_id, template_slug, model, prompt_template, prompt, variables, image_inputs, text_values, aspect_ratio, resolution, status, channel_id, group_id, scene_number, current_step)
         VALUES ($1, '', $2, $3, '', '', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'auto', '1K', 'draft', $4, $5, $6, NULL)`,
        [userId, template_slug, modelKey, channelId, groupIdNorm, sceneNumber]
      );
    }

    const groupRow = await pool.query(
      `SELECT * FROM story_template_groups WHERE group_id = $1 AND user_id = $2`,
      [groupIdNorm, userId]
    );
    const taskRows = await pool.query(
      `SELECT * FROM story_template_tasks WHERE user_id = $1 AND group_id = $2 ORDER BY COALESCE(scene_number, 1) ASC, id ASC`,
      [userId, groupIdNorm]
    );

    res.json({ group: groupRow.rows[0], tasks: taskRows.rows });
  } catch (err: any) {
    console.error('[storyTemplate:groups:create] Error:', err);
    res.status(500).json({ error: err?.message || 'Create group failed' });
  }
});

// PATCH /api/story-template/groups/:groupId — update group fields (topic / channel / resolution / selected_option_id)
router.patch('/groups/:groupId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { groupId } = req.params;
    const { topic, channel_id, video_resolution, selected_option_id, composite_image_prompt } = req.body as {
      topic?: string;
      channel_id?: number | string | null;
      video_resolution?: string;
      selected_option_id?: number | null;
      composite_image_prompt?: string;
    };

    const sets: string[] = [];
    const params: any[] = [];
    if (topic !== undefined) { sets.push(`topic = $${params.length + 1}`); params.push(topic); }
    if (channel_id !== undefined) {
      sets.push(`channel_id = $${params.length + 1}`);
      params.push(channel_id === null || channel_id === '' ? null : parseInt(String(channel_id)));
    }
    if (video_resolution !== undefined) { sets.push(`video_resolution = $${params.length + 1}`); params.push(video_resolution); }
    if (selected_option_id !== undefined) { sets.push(`selected_option_id = $${params.length + 1}`); params.push(selected_option_id); }
    if (composite_image_prompt !== undefined) {
      sets.push(`composite_image_prompt = $${params.length + 1}`);
      params.push(composite_image_prompt);
      // Clear stale composite when prompt changes
      sets.push(`composite_image_url = NULL`);
      sets.push(`composite_kie_task_id = NULL`);
      sets.push(`composite_status = NULL`);
    }
    if (sets.length === 0) return res.json({ success: true });
    sets.push(`updated_at = NOW()`);

    params.push(userId, groupId);
    const r = await pool.query(
      `UPDATE story_template_groups SET ${sets.join(', ')} WHERE user_id = $${params.length - 1} AND group_id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'group not found' });
    res.json({ success: true, group: r.rows[0] });
  } catch (err: any) {
    console.error('[storyTemplate:groups:patch] Error:', err);
    res.status(500).json({ error: err?.message || 'Patch group failed' });
  }
});

// PATCH /api/story-template/groups/:groupId/tasks/:taskId — update a single task's fields
router.patch('/groups/:groupId/tasks/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { groupId } = req.params;
    const taskId = parseInt(req.params.taskId);
    if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'invalid taskId' });

    const { image_inputs, text_values, prompt, aspect_ratio, resolution, variables, model } = req.body as {
      image_inputs?: any;
      text_values?: any;
      prompt?: string;
      aspect_ratio?: string;
      resolution?: string;
      variables?: any;
      model?: string;
    };

    const sets: string[] = [];
    const params: any[] = [];
    if (image_inputs !== undefined) { sets.push(`image_inputs = $${params.length + 1}::jsonb`); params.push(JSON.stringify(image_inputs)); }
    if (text_values !== undefined) { sets.push(`text_values = $${params.length + 1}::jsonb`); params.push(JSON.stringify(text_values)); }
    if (prompt !== undefined) { sets.push(`prompt = $${params.length + 1}`); params.push(prompt); }
    if (aspect_ratio !== undefined) { sets.push(`aspect_ratio = $${params.length + 1}`); params.push(aspect_ratio); }
    if (resolution !== undefined) { sets.push(`resolution = $${params.length + 1}`); params.push(resolution); }
    if (variables !== undefined) { sets.push(`variables = $${params.length + 1}::jsonb`); params.push(JSON.stringify(variables)); }
    if (model !== undefined) { sets.push(`model = $${params.length + 1}`); params.push(model); }
    if (sets.length === 0) return res.json({ success: true });
    sets.push(`updated_at = NOW()`);

    params.push(userId, groupId, taskId);
    const r = await pool.query(
      `UPDATE story_template_tasks
       SET ${sets.join(', ')}
       WHERE user_id = $${params.length - 2} AND group_id = $${params.length - 1} AND id = $${params.length}
       RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'task not found' });
    res.json({ success: true, task: r.rows[0] });
  } catch (err: any) {
    console.error('[storyTemplate:tasks:patch] Error:', err);
    res.status(500).json({ error: err?.message || 'Patch task failed' });
  }
});

// DELETE /api/story-template/groups/:groupId — remove group + cascade tasks
router.delete('/groups/:groupId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { groupId } = req.params;
    await pool.query(`DELETE FROM story_template_tasks WHERE user_id = $1 AND group_id = $2`, [userId, groupId]);
    await pool.query(`DELETE FROM story_template_groups WHERE user_id = $1 AND group_id = $2`, [userId, groupId]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[storyTemplate:groups:delete] Error:', err);
    res.status(500).json({ error: err?.message || 'Delete group failed' });
  }
});

// GET /api/story-template/groups — list user's groups + tasks for a template_slug
router.get('/groups', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const templateSlug = typeof req.query.template_slug === 'string' ? req.query.template_slug : null;
    let where = `WHERE user_id = $1`;
    const params: any[] = [userId];
    if (templateSlug) {
      params.push(templateSlug);
      where += ` AND template_slug = $${params.length}`;
    }

    const groups = await pool.query(
      `SELECT * FROM story_template_groups ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    const groupIds = groups.rows.map((g: any) => g.group_id);
    let tasks: any[] = [];
    if (groupIds.length > 0) {
      const tr = await pool.query(
        `SELECT * FROM story_template_tasks WHERE user_id = $1 AND group_id = ANY($2::text[])
         ORDER BY group_id ASC, COALESCE(scene_number, 1) ASC, id ASC`,
        [userId, groupIds]
      );
      tasks = tr.rows;
    }
    res.json({ groups: groups.rows, tasks });
  } catch (err: any) {
    console.error('[storyTemplate:groups:list] Error:', err);
    res.status(500).json({ error: err?.message || 'List groups failed' });
  }
});

// GET /api/story-template/groups/:groupId — fetch group state + scene tasks (for frontend polling final video)
router.get('/groups/:groupId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { groupId } = req.params;
    const groupRes = await pool.query(
      `SELECT group_id, template_slug, channel_id, scene_count, duration, video_resolution,
              status, final_video_url, dropbox_path, error,
              topic, options, selected_option_id, ai_status,
              created_at, updated_at
       FROM story_template_groups WHERE user_id = $1 AND group_id = $2`,
      [userId, groupId]
    );
    if (groupRes.rowCount === 0) return res.status(404).json({ error: 'group not found' });

    const tasksRes = await pool.query(
      `SELECT id, task_id, scene_number, current_step,
              status, result_url, video_status, video_url, video_task_id, error
       FROM story_template_tasks
       WHERE user_id = $1 AND group_id = $2
       ORDER BY COALESCE(scene_number, 1) ASC, id ASC`,
      [userId, groupId]
    );
    return res.json({ group: groupRes.rows[0], tasks: tasksRes.rows });
  } catch (err: any) {
    console.error('[storyTemplate:groupStatus] Error:', err);
    return res.status(500).json({ error: err?.message || 'Group status failed' });
  }
});

// GET /api/story-template/history
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    const offset = parseInt(String(req.query.offset || '0')) || 0;
    const templateSlugFilter = typeof req.query.template_slug === 'string' ? req.query.template_slug : '';

    let where = `WHERE user_id = $1`;
    const params: any[] = [userId];
    if (templateSlugFilter === '__none__') {
      where += ` AND template_slug IS NULL`;
    } else if (templateSlugFilter) {
      params.push(templateSlugFilter);
      where += ` AND template_slug = $${params.length}`;
    }
    const limitParamIdx = params.length + 1;
    const offsetParamIdx = params.length + 2;
    params.push(limit, offset);

    const rows = await pool.query(
      `SELECT id, task_id, template_slug, model, prompt, variables, image_inputs, text_values, aspect_ratio, resolution, status, result_url, dropbox_url, channel_id, error, created_at, updated_at
       FROM story_template_tasks ${where}
       ORDER BY created_at DESC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      params
    );
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM story_template_tasks ${where}`,
      params.slice(0, params.length - 2)
    );

    return res.json({ items: rows.rows, total: parseInt(countRes.rows[0].count) });
  } catch (err: any) {
    console.error('[storyTemplate:history] Error:', err);
    return res.status(500).json({ error: err?.message || 'History fetch failed' });
  }
});

// DELETE /api/story-template/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const r = await pool.query(
      `DELETE FROM story_template_tasks WHERE user_id = $1 AND id = $2 RETURNING id`,
      [userId, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[storyTemplate:delete] Error:', err);
    return res.status(500).json({ error: err?.message || 'Delete failed' });
  }
});

// POST /api/story-template/draft-state — save user's frontend draft state for a template (cross-device sync)
router.post('/draft-state', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { template_slug, state } = req.body as { template_slug?: string; state?: any };
    if (!template_slug || !state) return res.status(400).json({ error: 'template_slug and state are required' });
    await pool.query(
      `INSERT INTO story_template_drafts (user_id, template_slug, state, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, template_slug)
       DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
      [userId, template_slug, JSON.stringify(state)]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('[storyTemplate:draft-state:save] Error:', err);
    res.status(500).json({ error: err?.message || 'save failed' });
  }
});

// GET /api/story-template/draft-state/:templateSlug
router.get('/draft-state/:templateSlug', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const result = await pool.query(
      `SELECT state, updated_at FROM story_template_drafts WHERE user_id = $1 AND template_slug = $2`,
      [userId, req.params.templateSlug]
    );
    if (result.rowCount === 0) return res.json({ state: null });
    res.json({ state: result.rows[0].state, updated_at: result.rows[0].updated_at });
  } catch (err: any) {
    console.error('[storyTemplate:draft-state:get] Error:', err);
    res.status(500).json({ error: err?.message || 'fetch failed' });
  }
});

// GET /api/story-template/list — public (active templates only) for user-facing Story Template tab + detail page
router.get('/list', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, slug, name, description, thumbnail_url, preview_video_url,
              template_variables, fixed_scenes, scene_descriptions, field_config,
              display_order, yearly_only, gender, created_at
       FROM story_templates
       WHERE is_active = true
       ORDER BY display_order, created_at`
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[storyTemplate:list] Error:', err);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// GET /api/story-template/by-slug/:slug — public single template for detail page
router.get('/by-slug/:slug', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, slug, name, description, thumbnail_url, preview_video_url,
              system_prompt, template_variables, fixed_scenes, scene_descriptions, field_config,
              display_order, yearly_only, gender, created_at
       FROM story_templates
       WHERE slug = $1 AND is_active = true`,
      [req.params.slug]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'template not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[storyTemplate:by-slug] Error:', err);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// ============================================
// Admin CRUD for story_templates table
// ============================================

// GET /api/story-template/admin
router.get('/admin', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM story_templates ORDER BY display_order, created_at`);
    res.json(result.rows);
  } catch (err: any) {
    console.error('[storyTemplate:admin:list] Error:', err);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// POST /api/story-template/admin
router.post('/admin', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const {
      slug, name, description, thumbnail_url, preview_video_url,
      system_prompt,
      template_variables, fixed_scenes, scene_descriptions, field_config,
      display_order, is_active, yearly_only, gender,
    } = req.body;

    if (!slug || !name || !system_prompt) {
      return res.status(400).json({ error: 'slug, name, and system_prompt are required' });
    }

    const result = await pool.query(
      `INSERT INTO story_templates
       (slug, name, description, thumbnail_url, preview_video_url, system_prompt,
        template_variables, fixed_scenes, scene_descriptions, field_config,
        display_order, is_active, yearly_only, gender)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        slug, name, description || '', thumbnail_url || '', preview_video_url || '',
        system_prompt,
        JSON.stringify(template_variables || []),
        fixed_scenes ?? null,
        JSON.stringify(scene_descriptions || []),
        JSON.stringify(field_config || {}),
        display_order ?? 0, is_active ?? true, yearly_only ?? false, gender || null,
      ]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(400).json({ error: 'Template slug already exists' });
    console.error('[storyTemplate:admin:create] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to create template' });
  }
});

// PUT /api/story-template/admin/:slug
router.put('/admin/:slug', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug: oldSlug } = req.params;
    const {
      slug, name, description, thumbnail_url, preview_video_url,
      system_prompt,
      template_variables, fixed_scenes, scene_descriptions, field_config,
      display_order, is_active, yearly_only, gender,
    } = req.body;

    const result = await pool.query(
      `UPDATE story_templates SET
        slug = COALESCE($1, slug),
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        thumbnail_url = COALESCE($4, thumbnail_url),
        preview_video_url = COALESCE($5, preview_video_url),
        system_prompt = COALESCE($6, system_prompt),
        template_variables = COALESCE($7, template_variables),
        fixed_scenes = $8,
        scene_descriptions = COALESCE($9, scene_descriptions),
        field_config = COALESCE($10, field_config),
        display_order = COALESCE($11, display_order),
        is_active = COALESCE($12, is_active),
        yearly_only = COALESCE($13, yearly_only),
        gender = $14,
        updated_at = NOW()
       WHERE slug = $15 RETURNING *`,
      [
        slug, name, description, thumbnail_url, preview_video_url,
        system_prompt ?? null,
        template_variables ? JSON.stringify(template_variables) : null,
        fixed_scenes ?? null,
        scene_descriptions ? JSON.stringify(scene_descriptions) : null,
        field_config ? JSON.stringify(field_config) : null,
        display_order, is_active, yearly_only, gender ?? null,
        oldSlug,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(400).json({ error: 'Template slug already exists' });
    console.error('[storyTemplate:admin:update] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to update template' });
  }
});

// DELETE /api/story-template/admin/:slug
router.delete('/admin/:slug', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`DELETE FROM story_templates WHERE slug = $1 RETURNING id`, [req.params.slug]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[storyTemplate:admin:delete] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete template' });
  }
});

export default router;
