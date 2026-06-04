import express, { Response } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { uploadFile, getSignedFileUrl } from '../utils/s3.js';
import { uploadImageToDropbox, isDropboxConfigured } from '../utils/dropbox.js';
import {
  deductCreditsWithRetry,
  refundCreditsWithRetry,
  updateKieTaskId,
  hasBeenRefunded,
} from '../services/creditService.js';
import { IMAGE_CREDITS, ImageResolution, chargeCredits } from '../config/generationPricing.js';

/** Reference type stored in credit_transactions for GPT Image 2 charges. */
const GPT_IMAGE_2_REF_TYPE = 'gpt_image_2_task';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 16 }, // 20MB per file, max 16 files
});

const KIE_BASE = 'https://api.kie.ai';

// Ensure table exists at startup
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gpt_image2_tasks (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        prompt TEXT NOT NULL,
        aspect_ratio TEXT,
        resolution TEXT,
        input_urls JSONB,
        status TEXT DEFAULT 'pending',
        result_url TEXT,
        dropbox_url TEXT,
        channel_id INT,
        error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      ALTER TABLE gpt_image2_tasks ADD COLUMN IF NOT EXISTS dropbox_url TEXT;
      ALTER TABLE gpt_image2_tasks ADD COLUMN IF NOT EXISTS channel_id INT;
      ALTER TABLE gpt_image2_tasks ADD COLUMN IF NOT EXISTS template_slug TEXT;
      ALTER TABLE gpt_image2_tasks ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_gpt_image2_user ON gpt_image2_tasks(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_gpt_image2_task ON gpt_image2_tasks(task_id);
      CREATE INDEX IF NOT EXISTS idx_gpt_image2_channel ON gpt_image2_tasks(channel_id);
      CREATE INDEX IF NOT EXISTS idx_gpt_image2_template ON gpt_image2_tasks(user_id, template_slug);
      ALTER TABLE gpt_image2_tasks ADD COLUMN IF NOT EXISTS logs JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE gpt_image2_tasks ADD COLUMN IF NOT EXISTS credit_cost INT;
      ALTER TABLE gpt_image2_tasks ADD COLUMN IF NOT EXISTS system_charged BOOLEAN DEFAULT FALSE;
    `);
    console.log('✅ gpt_image2_tasks table ready');
  } catch (err) {
    console.error('Failed to create gpt_image2_tasks table:', err);
  }
})();

// Server-authoritative log writer — append to gpt_image2_tasks.logs JSONB (mirrors idol-pipeline pattern).
async function appendLog(taskDbId: number, emoji: string, text: string) {
  try {
    const entry = [{ time: new Date().toISOString(), emoji, text }];
    await pool.query(
      `UPDATE gpt_image2_tasks SET logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(entry), taskDbId]
    );
  } catch (err: any) {
    console.error('[gptImage2:appendLog] failed:', err?.message);
  }
}

async function getUserKieKey(userId: number): Promise<string | null> {
  const r = await pool.query(`SELECT kie_api_key FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.kie_api_key || null;
}

// POST /api/gpt-image-2/generate
// Multipart form-data fields:
//   prompt: string (required)
//   mode: 'text-to-image' | 'image-to-image' (required)
//   aspect_ratio?: 'auto' | '1:1' | '9:16' | '16:9' | '4:3' | '3:4'
//   resolution?: '1K' | '2K' | '4K'
//   files: File[] (only when mode=image-to-image, 1-16 files)
router.post('/generate', authenticate, upload.array('files', 16), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { prompt, mode, aspect_ratio, resolution, channel_id, template_slug, template_thumbnail_url } = req.body as {
      prompt?: string;
      mode?: string;
      aspect_ratio?: string;
      resolution?: string;
      channel_id?: string;
      template_slug?: string;
      template_thumbnail_url?: string;
    };
    const channelId = channel_id ? parseInt(channel_id) : null;
    const templateSlug = template_slug && template_slug.trim() ? template_slug.trim() : null;
    let files = (req.files as Express.Multer.File[]) || [];

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    let effectiveMode = mode;
    // If user attached no images BUT a template thumbnail is available, use it as the reference image
    // so the generated poster sticks close to the original template's style/composition.
    if ((effectiveMode === 'text-to-image' || files.length === 0) && template_thumbnail_url && template_thumbnail_url.trim()) {
      try {
        const thumbResp = await fetch(template_thumbnail_url);
        if (thumbResp.ok) {
          const arrayBuf = await thumbResp.arrayBuffer();
          const mimetype = thumbResp.headers.get('content-type') || 'image/png';
          const ext = (mimetype.split('/')[1] || 'png').split('+')[0];
          const fakeFile: any = {
            buffer: Buffer.from(arrayBuf),
            originalname: `template-thumbnail.${ext}`,
            mimetype,
          };
          files = [fakeFile, ...files];
          effectiveMode = 'image-to-image';
          console.log(`[gptImage2:generate] Using template thumbnail as reference (no user images attached)`);
        } else {
          console.warn(`[gptImage2:generate] Failed to fetch template thumbnail: HTTP ${thumbResp.status}`);
        }
      } catch (e: any) {
        console.warn(`[gptImage2:generate] Template thumbnail fetch error:`, e?.message);
      }
    }
    if (effectiveMode !== 'text-to-image' && effectiveMode !== 'image-to-image') {
      return res.status(400).json({ error: 'mode must be text-to-image or image-to-image' });
    }
    if (effectiveMode === 'image-to-image' && files.length === 0) {
      return res.status(400).json({ error: 'image-to-image requires at least 1 file' });
    }

    // Hybrid 2-tier key resolution:
    //   - user has personal kie_api_key  → use it, NO trippleschool credit charge
    //   - no personal key + system env   → use system key, CHARGE trippleschool credits
    //   - neither                        → 400
    const userKey = await getUserKieKey(userId);
    const systemKey = process.env.KIE_API_KEY || null;
    const useSystemKey = !userKey && !!systemKey;
    const kieKey = (userKey || systemKey) as string | null;
    if (!kieKey) {
      return res.status(400).json({ error: 'KIE API key not configured. Set it in your profile first.' });
    }

    // Pre-charge if using system key. Cost formula:
    //   IMAGE_CREDITS['gpt-image-2'][resolution] * count
    // Resolution body values are '1K'/'2K'/'4K' (uppercase); pricing keys are lowercase.
    // Default resolution = '1k', count = 1 (gpt-image-2 returns a single image per task).
    let charge: { cost: number; tempRef: string; balanceAfter: number } | null = null;
    if (useSystemKey) {
      const resRaw = (resolution || '1k').toString().toLowerCase();
      const resKey: ImageResolution = (['1k', '2k', '4k'].includes(resRaw) ? resRaw : '1k') as ImageResolution;
      const count = 1;
      const perImage = IMAGE_CREDITS['gpt-image-2']?.[resKey] ?? IMAGE_CREDITS['gpt-image-2']['1k'];
      const cost = chargeCredits(perImage * count);
      const tempRef = `pending_gpt_image_2_${userId}_${Date.now()}`;
      const summary = `${effectiveMode} · ${aspect_ratio || 'auto'} · ${resKey.toUpperCase()}`;
      const deduct = await deductCreditsWithRetry(
        userId,
        cost,
        GPT_IMAGE_2_REF_TYPE,
        tempRef,
        `GPT Image 2 image gen · ${summary}`
      );
      if (!deduct.success) {
        return res.status(400).json({
          error: deduct.error,
          errorCode: 'insufficient_credits',
          required: cost,
          current: deduct.balanceAfter,
        });
      }
      charge = { cost, tempRef, balanceAfter: deduct.balanceAfter };
    }

    // Refund helper closure — call on any failure after pre-charge.
    const refundOnFailure = async (msg: string) => {
      if (charge) {
        await refundCreditsWithRetry(
          userId,
          charge.cost,
          GPT_IMAGE_2_REF_TYPE,
          charge.tempRef,
          `Refund: ${msg}`
        ).catch((err) => console.error('[gptImage2:refund]', err));
      }
    };

    // Upload files to S3 → signed URLs (for image-to-image)
    let inputUrls: string[] = [];
    if (effectiveMode === 'image-to-image') {
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const ext = f.originalname.split('.').pop() || 'png';
          const key = `gpt-image2/${userId}/${Date.now()}_${i}.${ext}`;
          await uploadFile(f.buffer, key, f.mimetype);
          const signed = await getSignedFileUrl(key, 7200); // 2 hours
          inputUrls.push(signed);
        }
      } catch (err: any) {
        await refundOnFailure(`image upload — ${err?.message || 'unknown'}`);
        return res.status(502).json({
          error: `Failed to upload image: ${err?.message || 'unknown'}`,
          stage: 'image_upload',
        });
      }
    }

    // Call KIE create task
    const kieModel = effectiveMode === 'text-to-image' ? 'gpt-image-2-text-to-image' : 'gpt-image-2-image-to-image';
    // Normalize prompt: strip Windows \r line endings (\r\n → \n) — KIE worker can choke on \r
    // when rendering Thai text overlays. Also collapse 3+ blank lines.
    const cleanPrompt = prompt
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    // KIE gpt-image-2 worker crashes with code 500 on portrait aspect + 2K/4K combo (9:16/3:4/4:5/2:3 × 2K+).
    // Reproduced via direct API: same prompt+key, 9:16+2K fails in 10s, auto+1K succeeds in 35s.
    // RESPECT the user's resolution choice — instead change aspect_ratio to a KIE-compatible one (auto)
    // so they get the high-res image they asked for.
    let safeAspect = aspect_ratio;
    let safeResolution = resolution;
    if ((resolution === '2K' || resolution === '4K') && aspect_ratio && /^(9:16|3:4|4:5|2:3)$/.test(aspect_ratio)) {
      safeAspect = 'auto';
      console.warn(`[gptImage2:generate] aspect ${aspect_ratio} → auto (KIE worker crashes on portrait + ${resolution}, keeping ${resolution})`);
    }

    const kieBody: any = {
      model: kieModel,
      input: {
        prompt: cleanPrompt,
        ...(safeAspect ? { aspect_ratio: safeAspect } : {}),
        ...(safeResolution ? { resolution: safeResolution } : {}),
        ...(mode === 'image-to-image' ? { input_urls: inputUrls } : {}),
      },
    };

    // Debug log so we can compare with playground's working request byte-for-byte
    console.log(`[gptImage2:generate] kieBody:`, JSON.stringify(kieBody).substring(0, 2000));

    let kieRes: globalThis.Response;
    let kieData: any;
    try {
      kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${kieKey}`,
        },
        body: JSON.stringify(kieBody),
      });
      kieData = await kieRes.json().catch(() => ({}));
    } catch (err: any) {
      await refundOnFailure(`KIE createTask exception — ${err?.message || 'unknown'}`);
      return res.status(502).json({
        error: `KIE createTask failed: ${err?.message || 'unknown'}`,
        stage: 'kie_create_task',
      });
    }

    if (!kieRes.ok || kieData.code !== 200 || !kieData.data?.taskId) {
      await refundOnFailure(`KIE createTask — ${kieData?.msg || `HTTP ${kieRes.status}`}`);
      return res.status(502).json({
        error: kieData.msg || `KIE error (HTTP ${kieRes.status})`,
        details: kieData,
      });
    }

    const taskId: string = kieData.data.taskId;

    // Rewrite the temp_ref deduction row's reference_id to the real KIE task_id
    // so the refund-on-async-failure path can find it later.
    if (charge) {
      try {
        await pool.query(
          `UPDATE credit_transactions
              SET reference_id = $1
            WHERE user_id = $2 AND reference_type = $3 AND reference_id = $4 AND type = 'deduct'`,
          [taskId, userId, GPT_IMAGE_2_REF_TYPE, charge.tempRef]
        );
      } catch (e: any) {
        console.warn('[gptImage2:updateRef] failed:', e?.message);
      }
      // Also stash KIE task id in metadata for audit
      await updateKieTaskId(userId, taskId, 'deduct').catch(() => {});
    }

    // Save row
    const insert = await pool.query(
      `INSERT INTO gpt_image2_tasks
       (user_id, task_id, mode, prompt, aspect_ratio, resolution, input_urls, status, channel_id, template_slug, credit_cost, system_charged)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11)
       RETURNING id, task_id, mode, prompt, aspect_ratio, resolution, status, channel_id, template_slug, credit_cost, system_charged, created_at`,
      [
        userId,
        taskId,
        mode,
        cleanPrompt,
        aspect_ratio || null,
        resolution || null,
        JSON.stringify(inputUrls),
        channelId,
        templateSlug,
        charge?.cost ?? null,
        !!charge,
      ]
    );
    const insertedId = insert.rows[0].id;
    await appendLog(insertedId, '🚀', `เริ่มสร้างภาพ (${mode}, ${aspect_ratio || 'auto'} ${resolution || ''})`);
    await appendLog(insertedId, '🖼️', `ส่งไป KIE — Task ID: ${taskId}`);

    return res.json({
      success: true,
      task: insert.rows[0],
      ...(charge ? { creditCost: charge.cost, creditsRemaining: charge.balanceAfter } : {}),
    });
  } catch (err: any) {
    console.error('[gptImage2:generate] Error:', err);
    return res.status(500).json({ error: err?.message || 'Generate failed' });
  }
});

/**
 * Auto-refund helper for async failures discovered during status polling.
 * Idempotent via hasBeenRefunded — safe to call repeatedly on the same taskId.
 */
async function maybeAutoRefund(
  userId: number,
  task: { id: number; task_id: string; credit_cost: number | null; system_charged: boolean | null },
  reason: string
): Promise<void> {
  if (!task.system_charged || !task.credit_cost) return;
  const already = await hasBeenRefunded(GPT_IMAGE_2_REF_TYPE, task.task_id).catch(() => false);
  if (already) return;
  await refundCreditsWithRetry(
    userId,
    task.credit_cost,
    GPT_IMAGE_2_REF_TYPE,
    task.task_id,
    `Auto-refund: ${reason}`
  ).catch((err) => console.error('[gptImage2:autoRefund]', err));
}

// GET /api/gpt-image-2/status/:taskId
router.get('/status/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { taskId } = req.params;

    const row = await pool.query(
      `SELECT id, task_id, mode, prompt, aspect_ratio, resolution, input_urls, status, result_url, dropbox_url, channel_id, template_slug, retry_count, credit_cost, system_charged, error, logs, created_at, updated_at
       FROM gpt_image2_tasks WHERE user_id = $1 AND task_id = $2`,
      [userId, taskId]
    );
    if (row.rowCount === 0) {
      return res.status(404).json({ error: 'task not found' });
    }
    const task = row.rows[0];

    // If already done/failed, return cached
    if (task.status === 'success' || task.status === 'failed') {
      return res.json({ task });
    }

    // Hybrid key resolution mirrors POST /generate — system key used iff user has no personal key.
    const userKey = await getUserKieKey(userId);
    const systemKey = process.env.KIE_API_KEY || null;
    const kieKey = userKey || systemKey;
    if (!kieKey) return res.status(400).json({ error: 'KIE API key not configured' });

    const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${kieKey}` },
    });
    const raw: any = await kieRes.json().catch(() => ({}));
    console.log(`[gptImage2:status] taskId=${taskId} KIE response:`, JSON.stringify(raw).substring(0, 1500));
    const data = raw?.data || raw || {};
    // KIE inconsistently uses different keys/casing across models. Normalize aggressively.
    const stateRaw: string = String(data.state || data.status || data.taskState || data.taskStatus || data.state_code || raw?.state || raw?.status || '').trim();
    const state = stateRaw.toLowerCase();
    if (stateRaw) console.log(`[gptImage2:status] taskId=${taskId} state=${stateRaw}`);

    // Helper: deep-search for the first http(s) URL in any nested object/array
    const findUrl = (obj: any): string | null => {
      if (!obj) return null;
      if (typeof obj === 'string') {
        return /^https?:\/\//.test(obj) ? obj : null;
      }
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

    if (['success', 'completed', 'done', 'finished', 'ok', '2', 'complete'].includes(state)) {
      let url: string | null = null;
      // 1) Parse resultJson (string or object)
      if (data.resultJson) {
        try {
          const rd = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
          url = rd.resultUrls?.[0] || rd.result_urls?.[0] || rd.imageUrls?.[0] || rd.image_urls?.[0]
              || rd.urls?.[0] || rd.url || rd.image_url || rd.imageUrl || null;
          if (!url) url = findUrl(rd);
        } catch {}
      }
      // 2) Top-level fallback fields
      if (!url) {
        url = data.resultUrl || data.imageUrl || data.image_url || data.url
            || data.resultUrls?.[0] || data.result_urls?.[0]
            || data.imageUrls?.[0] || data.image_urls?.[0] || null;
      }
      // 3) Last-resort: deep search anywhere in response
      if (!url) url = findUrl(data) || findUrl(raw);

      if (url) {
        // Upload to Dropbox (best-effort, don't fail the whole task if Dropbox fails)
        let dropboxUrl: string | null = null;
        let dbxLogEntry: { emoji: string; text: string } | null = null;
        if (isDropboxConfigured()) {
          try {
            const ext = (url.match(/\.(png|jpg|jpeg|webp)(\?|$)/i)?.[1] || 'png').toLowerCase();
            const dbxResult = await uploadImageToDropbox(url, userId, task.id, ext);
            dropboxUrl = dbxResult.sharedUrl;
            console.log(`[gptImage2:status] Uploaded to Dropbox: ${dbxResult.dropboxPath}`);
            dbxLogEntry = { emoji: '📦', text: 'บันทึกไป Dropbox สำเร็จ' };
          } catch (dbxErr: any) {
            console.error(`[gptImage2:status] Dropbox upload failed for task ${taskId}:`, dbxErr?.message);
            dbxLogEntry = { emoji: '⚠️', text: `Dropbox upload ล้มเหลว: ${(dbxErr?.message || 'unknown').substring(0, 80)}` };
          }
        } else {
          dbxLogEntry = { emoji: '⏭️', text: 'ไม่ได้บันทึก Dropbox (ไม่ได้ตั้งค่า DROPBOX_TOKEN)' };
        }

        // Update task with both URLs
        await pool.query(
          `UPDATE gpt_image2_tasks SET status = 'success', result_url = $1, dropbox_url = $2, updated_at = NOW() WHERE id = $3`,
          [url, dropboxUrl, task.id]
        );
        await appendLog(task.id, '✅', 'สร้างภาพสำเร็จ');
        if (dbxLogEntry) await appendLog(task.id, dbxLogEntry.emoji, dbxLogEntry.text);

        // Sync into content_history (so it shows in /app/history with channel filter).
        // Carry template_slug forward so Image Template-generated images can be distinguished
        // from direct gpt-image-2 generations downstream (separate filter buckets).
        try {
          const r = await pool.query(
            `INSERT INTO content_history (user_id, channel_id, video_url, prompt, aspect_ratio, source, template_slug, created_at)
             VALUES ($1, $2, $3, $4, $5, 'gpt_image_2', $6, NOW())
             ON CONFLICT (user_id, video_url) DO NOTHING
             RETURNING id`,
            [userId, task.channel_id, dropboxUrl || url, task.prompt, task.aspect_ratio, task.template_slug || null]
          );
          if ((r.rowCount || 0) > 0) {
            await appendLog(task.id, '📑', 'บันทึกลงประวัติแล้ว');
          }
        } catch (chErr: any) {
          console.error(`[gptImage2:status] content_history insert failed:`, chErr?.message);
          await appendLog(task.id, '⚠️', `บันทึกประวัติล้มเหลว: ${(chErr?.message || 'unknown').substring(0, 80)}`);
        }

        // Re-fetch logs so the response includes "✅ สร้างภาพสำเร็จ", "📦 บันทึกไป Dropbox สำเร็จ",
        // "📑 บันทึกลงประวัติแล้ว" — these were appended after the initial SELECT so the cached
        // `task.logs` is stale. Frontend replaces local logs with this response, so freshness matters.
        const refreshed = await pool.query(`SELECT logs FROM gpt_image2_tasks WHERE id = $1`, [task.id]);
        const freshLogs = refreshed.rows[0]?.logs ?? task.logs;
        return res.json({
          task: { ...task, status: 'success', result_url: url, dropbox_url: dropboxUrl, logs: freshLogs },
        });
      }
      console.log(`[gptImage2:status] state=${state} but no URL found in response for taskId=${taskId}`);
      await appendLog(task.id, '⚠️', 'KIE success แต่ไม่พบ URL ในผลลัพธ์');
      await pool.query(
        `UPDATE gpt_image2_tasks SET status = 'failed', error = 'No image URL in result', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
      await maybeAutoRefund(userId, task, 'No image URL in result');
      return res.json({ task: { ...task, status: 'failed', error: 'No image URL in result' } });
    }

    if (['fail', 'failed', 'error', 'rejected', '3'].includes(state)) {
      const errMsg = data.failMsg || data.fail_msg || data.errorMessage || data.error || 'Generation failed';
      const errCode = data.errorCode ?? data.code;

      // Auto-retry transient errors: KIE returns 500 / Internal Error randomly for the same prompt that
      // works on next attempt. Resubmit a new createTask up to 3 times before giving up.
      const isTransient = /internal error|please try again|server exception|try again later|timeout|rate limit/i.test(errMsg)
        || errCode === 500;
      const MAX_RETRY = 3;
      if (isTransient && (task.retry_count ?? 0) < MAX_RETRY) {
        try {
          const kieModelRetry = task.mode === 'text-to-image' ? 'gpt-image-2-text-to-image' : 'gpt-image-2-image-to-image';
          const inputUrlsRetry: string[] = Array.isArray(task.input_urls) ? task.input_urls : [];
          const kieBodyRetry: any = {
            model: kieModelRetry,
            input: {
              prompt: task.prompt,
              ...(task.aspect_ratio ? { aspect_ratio: task.aspect_ratio } : {}),
              ...(task.resolution ? { resolution: task.resolution } : {}),
              ...(task.mode === 'image-to-image' ? { input_urls: inputUrlsRetry } : {}),
            },
          };
          const subRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${kieKey}` },
            body: JSON.stringify(kieBodyRetry),
          });
          const subData: any = await subRes.json().catch(() => ({}));
          if (subRes.ok && subData.code === 200 && subData.data?.taskId) {
            const newTaskId = subData.data.taskId as string;
            await pool.query(
              `UPDATE gpt_image2_tasks
               SET task_id = $1, status = 'pending', error = NULL, retry_count = COALESCE(retry_count, 0) + 1, updated_at = NOW()
               WHERE id = $2`,
              [newTaskId, task.id]
            );
            await appendLog(task.id, '🔄', `Auto-retry ${(task.retry_count ?? 0) + 1}/${MAX_RETRY} (KIE transient error: ${errMsg.substring(0, 60)}) — Task ID ใหม่: ${newTaskId}`);
            console.log(`[gptImage2:status] auto-retry ${(task.retry_count ?? 0) + 1}/${MAX_RETRY} for task ${task.id}, new kie task: ${newTaskId}`);
            return res.json({ task: { ...task, task_id: newTaskId, status: 'pending', retry_count: (task.retry_count ?? 0) + 1 } });
          }
          console.warn(`[gptImage2:status] auto-retry submit failed for task ${task.id}: ${subData.msg || subRes.status}`);
        } catch (retryErr: any) {
          console.warn(`[gptImage2:status] auto-retry exception for task ${task.id}:`, retryErr?.message);
        }
      }

      await appendLog(task.id, '❌', `ล้มเหลว: ${errMsg.substring(0, 100)}`);
      await pool.query(
        `UPDATE gpt_image2_tasks SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
        [errMsg, task.id]
      );
      await maybeAutoRefund(userId, task, errMsg);
      return res.json({ task: { ...task, status: 'failed', error: errMsg } });
    }

    // Still running — emit "⏳ ยังประมวลผลอยู่... (Xs)" heartbeat with elapsed seconds (idol-pipeline pattern).
    // Every poll = 1 log entry so user sees continuous progress in the activity panel.
    try {
      const createdMs = task.created_at ? new Date(task.created_at).getTime() : Date.now();
      const elapsedSec = Math.max(0, Math.round((Date.now() - createdMs) / 1000));
      await appendLog(task.id, '⏳', `ยังประมวลผลอยู่... (${elapsedSec}s)`);
    } catch {}
    return res.json({ task: { ...task, status: 'pending' } });
  } catch (err: any) {
    console.error('[gptImage2:status] Error:', err);
    return res.status(500).json({ error: err?.message || 'Status check failed' });
  }
});

// GET /api/gpt-image-2/history
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
      `SELECT id, task_id, mode, prompt, aspect_ratio, resolution, status, result_url, dropbox_url, channel_id, template_slug, error, created_at, updated_at
       FROM gpt_image2_tasks ${where}
       ORDER BY created_at DESC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      params
    );
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM gpt_image2_tasks ${where}`,
      params.slice(0, params.length - 2)
    );

    return res.json({ items: rows.rows, total: parseInt(countRes.rows[0].count) });
  } catch (err: any) {
    console.error('[gptImage2:history] Error:', err);
    return res.status(500).json({ error: err?.message || 'History fetch failed' });
  }
});

// DELETE /api/gpt-image-2/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const r = await pool.query(
      `DELETE FROM gpt_image2_tasks WHERE user_id = $1 AND id = $2 RETURNING id`,
      [userId, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[gptImage2:delete] Error:', err);
    return res.status(500).json({ error: err?.message || 'Delete failed' });
  }
});

export default router;
