import express, { Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import FormDataLib from 'form-data';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { uploadImageToDropbox, isDropboxConfigured } from '../utils/dropbox.js';
import {
  deductCreditsWithRetry,
  refundCreditsWithRetry,
  updateKieTaskId,
  hasBeenRefunded,
} from '../services/creditService.js';
import {
  IMAGE_CREDITS,
  GROK_VIDEO_CREDIT_PER_SEC,
  GROK_EXTEND_CREDITS,
  ImageResolution,
  chargeCredits,
} from '../config/generationPricing.js';

/** Reference type stored in credit_transactions for grok imagine (image+video+extend) charges. */
const GROK_IMAGINE_REF_TYPE = 'grok_task';

const router = express.Router();

// Grok Imagine i2i max 1 image @ 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const KIE_BASE = 'https://api.kie.ai';
const KIE_FILE_BASE = 'https://kieai.redpandaai.co';

// Ensure table exists at startup
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS grok_imagine_tasks (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        prompt TEXT NOT NULL,
        aspect_ratio TEXT,
        enable_pro BOOLEAN DEFAULT FALSE,
        input_urls JSONB,
        status TEXT DEFAULT 'pending',
        result_url TEXT,
        dropbox_url TEXT,
        channel_id INT,
        template_slug TEXT,
        error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      ALTER TABLE grok_imagine_tasks ADD COLUMN IF NOT EXISTS credit_cost INT;
      ALTER TABLE grok_imagine_tasks ADD COLUMN IF NOT EXISTS system_charged BOOLEAN DEFAULT FALSE;
      CREATE INDEX IF NOT EXISTS idx_grok_imagine_user ON grok_imagine_tasks(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_grok_imagine_task ON grok_imagine_tasks(task_id);
      CREATE INDEX IF NOT EXISTS idx_grok_imagine_template ON grok_imagine_tasks(user_id, template_slug);
    `);
    console.log('✅ grok_imagine_tasks table ready');
  } catch (err) {
    console.error('Failed to create grok_imagine_tasks table:', err);
  }
})();

async function getUserKieKey(userId: number): Promise<string | null> {
  const r = await pool.query(`SELECT kie_api_key FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.kie_api_key || null;
}

// Upload a file buffer to KIE File Upload API → returns public URL
async function uploadToKieFileApi(
  apiKey: string,
  buffer: Buffer,
  fileName: string,
  mimetype: string,
  uploadPath: string
): Promise<string> {
  const fd = new FormDataLib();
  fd.append('file', buffer, { filename: fileName, contentType: mimetype });
  fd.append('uploadPath', uploadPath);
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
    throw new Error(
      result?.msg || `KIE file upload failed: HTTP ${status} body=${JSON.stringify(result).substring(0, 300)}`
    );
  }
  const fileUrl =
    result?.data?.fileUrl ||
    result?.data?.downloadUrl ||
    result?.data?.url ||
    result?.fileUrl ||
    result?.downloadUrl ||
    null;
  if (!fileUrl) {
    throw new Error(`KIE upload returned no URL. Response: ${JSON.stringify(result).substring(0, 500)}`);
  }
  return fileUrl as string;
}

// POST /api/grok-imagine/generate
router.post('/generate', authenticate, upload.array('files', 1), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const body = (req.body || {}) as Record<string, any>;
    const {
      prompt,
      mode,
      aspect_ratio,
      enable_pro,
      channel_id,
      template_slug,
      action,
      is_video,
      duration_sec,
      seconds,
      resolution,
    } = body as {
      prompt?: string;
      mode?: string;
      aspect_ratio?: string;
      enable_pro?: string | boolean;
      channel_id?: string;
      template_slug?: string;
      action?: string;
      is_video?: string | boolean;
      duration_sec?: string | number;
      seconds?: string | number;
      resolution?: string;
    };
    const channelId = channel_id ? parseInt(channel_id) : null;
    const templateSlug = template_slug && template_slug.trim() ? template_slug.trim() : null;
    const enablePro = enable_pro === true || enable_pro === 'true';
    const files = (req.files as Express.Multer.File[]) || [];

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (mode !== 'text-to-image' && mode !== 'image-to-image') {
      return res.status(400).json({ error: 'mode must be text-to-image or image-to-image' });
    }
    if (mode === 'image-to-image' && files.length === 0) {
      return res.status(400).json({ error: 'image-to-image requires 1 image file' });
    }

    // Hybrid 2-tier key resolution:
    //   - user has personal kie_api_key  → use it, NO trippleviral credit charge
    //   - no personal key + system env   → use system key, CHARGE trippleviral credits
    //   - neither                        → 400
    const userKey = await getUserKieKey(userId);
    const systemKey = process.env.KIE_API_KEY || null;
    const useSystemKey = !userKey && !!systemKey;
    const kieKey = (userKey || systemKey) as string | null;
    if (!kieKey) {
      return res.status(400).json({
        error: 'KIE API key not configured. Add it in your profile or contact admin.',
      });
    }

    // Pre-charge if using system key.
    // Grok has 3 modes — detect from req.body:
    //   - action='extend' OR mode='extend' → cost = GROK_EXTEND_CREDITS (one block)
    //   - mode='video' OR is_video=true OR has duration_sec/seconds → cost = (duration clamped 1..30) * GROK_VIDEO_CREDIT_PER_SEC
    //   - default (image) → cost = IMAGE_CREDITS['grok-imagine'][resolution] (flat 4 across resolutions, default '1k')
    // TODO(human): confirm grok mode-detection keys with FE — currently best-effort.
    // NOTE: read raw mode string from body to avoid the narrowed `mode` type above
    // (validation has already asserted text-to-image|image-to-image, but pricing
    //  must still detect alt grok modes like 'extend' / 'video' if FE sends them).
    const rawModeStr = typeof body.mode === 'string' ? body.mode : '';
    let charge: { cost: number; tempRef: string; balanceAfter: number } | null = null;
    let pricingSummary = 'image';
    if (useSystemKey) {
      const isExtend = action === 'extend' || rawModeStr === 'extend';
      const durationRaw =
        duration_sec !== undefined && duration_sec !== ''
          ? parseInt(String(duration_sec))
          : seconds !== undefined && seconds !== ''
          ? parseInt(String(seconds))
          : NaN;
      const isVideo =
        rawModeStr === 'video' ||
        is_video === true ||
        is_video === 'true' ||
        Number.isFinite(durationRaw);

      let cost: number;
      if (isExtend) {
        cost = chargeCredits(GROK_EXTEND_CREDITS);
        pricingSummary = 'extend';
      } else if (isVideo) {
        const dur = Math.min(Math.max(Number.isFinite(durationRaw) ? durationRaw : 10, 1), 30);
        cost = chargeCredits(dur * GROK_VIDEO_CREDIT_PER_SEC);
        pricingSummary = `video ${dur}s`;
      } else {
        const res: ImageResolution = (
          resolution === '2k' || resolution === '4k' ? resolution : '1k'
        ) as ImageResolution;
        cost = chargeCredits(IMAGE_CREDITS['grok-imagine'][res]);
        pricingSummary = `image ${res}`;
      }

      const tempRef = `pending_grok_${userId}_${Date.now()}`;
      const deduct = await deductCreditsWithRetry(
        userId,
        cost,
        GROK_IMAGINE_REF_TYPE,
        tempRef,
        `Grok Imagine (image+video+extend) · ${pricingSummary}`
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

    // Refund-on-failure helper closure — no-op when no charge was made.
    const refundOnFailure = async (msg: string) => {
      if (charge) {
        await refundCreditsWithRetry(
          userId,
          charge.cost,
          GROK_IMAGINE_REF_TYPE,
          charge.tempRef,
          `Refund: ${msg}`
        ).catch((err) => console.error('[grokImagine:refund]', err));
      }
    };

    // Upload files to KIE File API for i2i (Grok requires KIE-hosted URLs)
    let inputUrls: string[] = [];
    if (mode === 'image-to-image') {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ext = f.originalname.split('.').pop() || 'png';
        const fileName = `grok-${userId}-${Date.now()}-${i}.${ext}`;
        try {
          const url = await uploadToKieFileApi(
            kieKey,
            f.buffer,
            fileName,
            f.mimetype,
            `grok-imagine-${userId}`
          );
          inputUrls.push(url);
        } catch (err: any) {
          await refundOnFailure(`image upload — ${err?.message || 'unknown error'}`);
          return res.status(502).json({
            error: `Failed to upload image to KIE: ${err?.message || 'unknown error'}`,
            stage: 'image_upload',
            fileName,
          });
        }
      }
    }

    // Auto-prepend @image1 reference for i2i prompt (per Grok i2i spec)
    const trimmedPrompt = prompt.trim();
    const finalPrompt =
      mode === 'image-to-image' && !/^@image\d/i.test(trimmedPrompt)
        ? `@image1 ${trimmedPrompt}`
        : trimmedPrompt;

    const kieModel = mode === 'text-to-image' ? 'grok-imagine/text-to-image' : 'grok-imagine/image-to-image';
    const kieBody: any = {
      model: kieModel,
      input:
        mode === 'text-to-image'
          ? {
              prompt: finalPrompt,
              ...(aspect_ratio ? { aspect_ratio } : {}),
              ...(enablePro ? { enable_pro: true } : {}),
            }
          : {
              prompt: finalPrompt,
              image_urls: inputUrls,
            },
    };

    let kieRes: any;
    let kieData: any;
    try {
      kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kieKey}` },
        body: JSON.stringify(kieBody),
      });
      kieData = await kieRes.json().catch(() => ({}));
    } catch (err: any) {
      await refundOnFailure(`KIE createTask — ${err?.message || 'network error'}`);
      return res.status(502).json({
        error: `KIE createTask network error: ${err?.message || 'unknown'}`,
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
          [taskId, userId, GROK_IMAGINE_REF_TYPE, charge.tempRef]
        );
      } catch (e: any) {
        console.warn('[grokImagine:updateRef] failed:', e?.message);
      }
      await updateKieTaskId(userId, taskId, 'deduct').catch(() => {});
    }

    const insert = await pool.query(
      `INSERT INTO grok_imagine_tasks
       (user_id, task_id, mode, prompt, aspect_ratio, enable_pro, input_urls, status, channel_id, template_slug, credit_cost, system_charged)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11)
       RETURNING id, task_id, mode, prompt, aspect_ratio, enable_pro, status, channel_id, template_slug, credit_cost, system_charged, created_at`,
      [
        userId,
        taskId,
        mode,
        trimmedPrompt,
        aspect_ratio || null,
        enablePro,
        JSON.stringify(inputUrls),
        channelId,
        templateSlug,
        charge?.cost ?? null,
        !!charge,
      ]
    );

    return res.json({
      success: true,
      task: insert.rows[0],
      ...(charge ? { creditCost: charge.cost, creditsRemaining: charge.balanceAfter } : {}),
    });
  } catch (err: any) {
    console.error('[grokImagine:generate] Error:', err);
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
  const already = await hasBeenRefunded(GROK_IMAGINE_REF_TYPE, task.task_id).catch(() => false);
  if (already) return;
  await refundCreditsWithRetry(
    userId,
    task.credit_cost,
    GROK_IMAGINE_REF_TYPE,
    task.task_id,
    `Auto-refund: ${reason}`
  ).catch((err) => console.error('[grokImagine:autoRefund]', err));
}

// GET /api/grok-imagine/status/:taskId
router.get('/status/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { taskId } = req.params;

    const row = await pool.query(
      `SELECT id, task_id, mode, prompt, aspect_ratio, enable_pro, status, result_url, dropbox_url, channel_id, template_slug, credit_cost, system_charged, error, created_at, updated_at
       FROM grok_imagine_tasks WHERE user_id = $1 AND task_id = $2`,
      [userId, taskId]
    );
    if (row.rowCount === 0) return res.status(404).json({ error: 'task not found' });
    const task = row.rows[0];

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
    console.log(`[grokImagine:status] taskId=${taskId} KIE response:`, JSON.stringify(raw).substring(0, 1500));
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
            console.log(`[grokImagine:status] Uploaded to Dropbox: ${dbxResult.dropboxPath}`);
          } catch (dbxErr: any) {
            console.error(`[grokImagine:status] Dropbox upload failed for task ${taskId}:`, dbxErr?.message);
          }
        }

        await pool.query(
          `UPDATE grok_imagine_tasks SET status = 'success', result_url = $1, dropbox_url = $2, updated_at = NOW() WHERE id = $3`,
          [url, dropboxUrl, task.id]
        );

        try {
          await pool.query(
            `INSERT INTO content_history (user_id, channel_id, video_url, prompt, aspect_ratio, source, created_at)
             VALUES ($1, $2, $3, $4, $5, 'grok_imagine', NOW())
             ON CONFLICT (user_id, video_url) DO NOTHING`,
            [userId, task.channel_id, dropboxUrl || url, task.prompt, task.aspect_ratio]
          );
        } catch (chErr: any) {
          console.error(`[grokImagine:status] content_history insert failed:`, chErr?.message);
        }

        return res.json({
          task: { ...task, status: 'success', result_url: url, dropbox_url: dropboxUrl },
        });
      }
      console.log(`[grokImagine:status] state=${state} but no URL found in response for taskId=${taskId}`);
      await pool.query(
        `UPDATE grok_imagine_tasks SET status = 'failed', error = 'No image URL in result', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
      await maybeAutoRefund(userId, task, 'No image URL in result');
      return res.json({ task: { ...task, status: 'failed', error: 'No image URL in result' } });
    }

    if (state === 'fail' || state === 'failed' || state === 'error') {
      const errMsg = data.failMsg || data.fail_msg || data.errorMessage || data.error || 'Generation failed';
      await pool.query(
        `UPDATE grok_imagine_tasks SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
        [errMsg, task.id]
      );
      await maybeAutoRefund(userId, task, errMsg);
      return res.json({ task: { ...task, status: 'failed', error: errMsg } });
    }

    return res.json({ task: { ...task, status: 'pending' } });
  } catch (err: any) {
    console.error('[grokImagine:status] Error:', err);
    return res.status(500).json({ error: err?.message || 'Status check failed' });
  }
});

// GET /api/grok-imagine/history
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
      `SELECT id, task_id, mode, prompt, aspect_ratio, enable_pro, status, result_url, dropbox_url, channel_id, template_slug, error, created_at, updated_at
       FROM grok_imagine_tasks ${where}
       ORDER BY created_at DESC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      params
    );
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM grok_imagine_tasks ${where}`,
      params.slice(0, params.length - 2)
    );

    return res.json({ items: rows.rows, total: parseInt(countRes.rows[0].count) });
  } catch (err: any) {
    console.error('[grokImagine:history] Error:', err);
    return res.status(500).json({ error: err?.message || 'History fetch failed' });
  }
});

// DELETE /api/grok-imagine/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const r = await pool.query(
      `DELETE FROM grok_imagine_tasks WHERE user_id = $1 AND id = $2 RETURNING id`,
      [userId, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[grokImagine:delete] Error:', err);
    return res.status(500).json({ error: err?.message || 'Delete failed' });
  }
});

export default router;
