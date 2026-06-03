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
import { IMAGE_CREDITS, ImageResolution, chargeCredits } from '../config/generationPricing.js';

/** Reference type stored in credit_transactions for nano-banana-2 image gen charges. */
const NANO_BANANA_2_REF_TYPE = 'nano_banana_2_task';

const router = express.Router();

// Nano Banana 2: max 14 images @ 30MB each
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 14 },
});

const KIE_BASE = 'https://api.kie.ai';
const KIE_FILE_BASE = 'https://kieai.redpandaai.co';

// Ensure table exists at startup
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nano_banana2_tasks (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        prompt TEXT NOT NULL,
        aspect_ratio TEXT,
        resolution TEXT,
        output_format TEXT,
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
      ALTER TABLE nano_banana2_tasks ADD COLUMN IF NOT EXISTS logs JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE nano_banana2_tasks ADD COLUMN IF NOT EXISTS credit_cost INT;
      ALTER TABLE nano_banana2_tasks ADD COLUMN IF NOT EXISTS system_charged BOOLEAN DEFAULT FALSE;
      CREATE INDEX IF NOT EXISTS idx_nano_banana2_user ON nano_banana2_tasks(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_nano_banana2_task ON nano_banana2_tasks(task_id);
      CREATE INDEX IF NOT EXISTS idx_nano_banana2_template ON nano_banana2_tasks(user_id, template_slug);
    `);
    console.log('✅ nano_banana2_tasks table ready');
  } catch (err) {
    console.error('Failed to create nano_banana2_tasks table:', err);
  }
})();

// Append a log entry to the task's logs JSONB array.
async function appendLog(taskRowId: number, emoji: string, text: string) {
  try {
    await pool.query(
      `UPDATE nano_banana2_tasks SET logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify([{ time: Date.now(), emoji, text }]), taskRowId]
    );
  } catch (e: any) {
    console.warn('[nanoBanana2:appendLog] failed:', e?.message);
  }
}

async function getUserKieKey(userId: number): Promise<string | null> {
  const r = await pool.query(`SELECT kie_api_key FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.kie_api_key || null;
}

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

// POST /api/nano-banana-2/generate
router.post('/generate', authenticate, upload.array('files', 14), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { prompt, mode, aspect_ratio, resolution, output_format, channel_id, template_slug, template_thumbnail_url } = req.body as {
      prompt?: string;
      mode?: string;
      aspect_ratio?: string;
      resolution?: string;
      output_format?: string;
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
    // If user attached no images BUT a template thumbnail is available, use it as the reference.
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
          console.log(`[nanoBanana2:generate] Using template thumbnail as reference (no user images attached)`);
        } else {
          console.warn(`[nanoBanana2:generate] Failed to fetch template thumbnail: HTTP ${thumbResp.status}`);
        }
      } catch (e: any) {
        console.warn(`[nanoBanana2:generate] Template thumbnail fetch error:`, e?.message);
      }
    }
    if (effectiveMode !== 'text-to-image' && effectiveMode !== 'image-to-image') {
      return res.status(400).json({ error: 'mode must be text-to-image or image-to-image' });
    }
    if (effectiveMode === 'image-to-image' && files.length === 0) {
      return res.status(400).json({ error: 'image-to-image requires at least 1 image file' });
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
        error: 'KIE API key not configured. Set it in your profile first.',
      });
    }

    // Pre-charge if using system key. Cost = IMAGE_CREDITS['nano-banana-2'][resolution] * outputCount.
    // resolution from req.body; default '1k'; clamp to known keys.
    // outputCount default 1 (FE currently does not expose a count param).
    let charge: { cost: number; tempRef: string; balanceAfter: number } | null = null;
    if (useSystemKey) {
      const allowedRes: ImageResolution[] = ['1k', '2k', '4k'];
      const resRaw = String(resolution || '1k').toLowerCase();
      const resKey: ImageResolution = (allowedRes as string[]).includes(resRaw)
        ? (resRaw as ImageResolution)
        : '1k';
      const countRaw = parseInt(String((req.body as Record<string, string>).count || (req.body as Record<string, string>).num_images || '')) || 1;
      const outputCount = Math.min(Math.max(countRaw, 1), 14);
      const perImage = IMAGE_CREDITS['nano-banana-2'][resKey];
      const cost = chargeCredits(perImage * outputCount);
      const tempRef = `pending_nano_banana_2_${userId}_${Date.now()}`;
      const deduct = await deductCreditsWithRetry(
        userId,
        cost,
        NANO_BANANA_2_REF_TYPE,
        tempRef,
        `Nano Banana 2 image gen · ${effectiveMode} · ${resKey} · x${outputCount}`
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

    // Refund-on-failure closure — used for any failure AFTER pre-charge.
    const refundOnFailure = async (msg: string) => {
      if (charge) {
        await refundCreditsWithRetry(
          userId,
          charge.cost,
          NANO_BANANA_2_REF_TYPE,
          charge.tempRef,
          `Refund: ${msg}`
        ).catch((err) => console.error('[nanoBanana2:refund]', err));
      }
    };

    let inputUrls: string[] = [];
    if (effectiveMode === 'image-to-image') {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ext = f.originalname.split('.').pop() || 'png';
        const fileName = `nano2-${userId}-${Date.now()}-${i}.${ext}`;
        try {
          const url = await uploadToKieFileApi(
            kieKey,
            f.buffer,
            fileName,
            f.mimetype,
            `nano-banana2-${userId}`
          );
          inputUrls.push(url);
        } catch (err: any) {
          await refundOnFailure(`image upload — ${err?.message || 'unknown'}`);
          return res.status(502).json({
            error: `Failed to upload image to KIE: ${err?.message || 'unknown'}`,
            stage: 'image_upload',
            fileName,
            mimetype: f.mimetype,
            size: f.size,
          });
        }
      }
    }

    const trimmedPrompt = prompt.trim();
    const fmt = output_format === 'png' || output_format === 'jpg' ? output_format : 'jpg';

    // Nano Banana uses ONE model string for both t2i and i2i — image_input array (empty for t2i) is the differentiator
    const kieBody: any = {
      model: 'nano-banana-2',
      input: {
        prompt: trimmedPrompt,
        ...(inputUrls.length > 0 ? { image_input: inputUrls } : {}),
        ...(aspect_ratio ? { aspect_ratio } : { aspect_ratio: 'auto' }),
        ...(resolution ? { resolution } : { resolution: '1K' }),
        output_format: fmt,
      },
    };

    let kieRes: Awaited<ReturnType<typeof fetch>>;
    let kieData: any;
    try {
      kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kieKey}` },
        body: JSON.stringify(kieBody),
      });
      kieData = await kieRes.json().catch(() => ({}));
    } catch (err: any) {
      await refundOnFailure(`KIE createTask network — ${err?.message || 'unknown'}`);
      return res.status(502).json({
        error: `KIE createTask failed: ${err?.message || 'network error'}`,
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
          [taskId, userId, NANO_BANANA_2_REF_TYPE, charge.tempRef]
        );
      } catch (e: any) {
        console.warn('[nanoBanana2:updateRef] failed:', e?.message);
      }
      await updateKieTaskId(userId, taskId, 'deduct').catch(() => {});
    }

    const insert = await pool.query(
      `INSERT INTO nano_banana2_tasks
       (user_id, task_id, mode, prompt, aspect_ratio, resolution, output_format, input_urls, status, channel_id, template_slug, credit_cost, system_charged)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12)
       RETURNING id, task_id, mode, prompt, aspect_ratio, resolution, output_format, status, channel_id, template_slug, credit_cost, system_charged, created_at`,
      [userId, taskId, mode, trimmedPrompt, aspect_ratio || null, resolution || null, fmt, JSON.stringify(inputUrls), channelId, templateSlug, charge?.cost ?? null, !!charge]
    );
    const insertedId = insert.rows[0].id;
    await appendLog(insertedId, '🚀', `เริ่มสร้างภาพ (${effectiveMode}, ${aspect_ratio || 'auto'} ${resolution || ''})`);
    await appendLog(insertedId, '📤', `ส่งไป KIE — Task ID: ${taskId.substring(0, 12)}...`);

    return res.json({
      success: true,
      task: insert.rows[0],
      ...(charge ? { creditCost: charge.cost, creditsRemaining: charge.balanceAfter } : {}),
    });
  } catch (err: any) {
    console.error('[nanoBanana2:generate] Error:', err);
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
  const already = await hasBeenRefunded(NANO_BANANA_2_REF_TYPE, task.task_id).catch(() => false);
  if (already) return;
  await refundCreditsWithRetry(
    userId,
    task.credit_cost,
    NANO_BANANA_2_REF_TYPE,
    task.task_id,
    `Auto-refund: ${reason}`
  ).catch((err) => console.error('[nanoBanana2:autoRefund]', err));
}

// GET /api/nano-banana-2/status/:taskId
router.get('/status/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { taskId } = req.params;

    const row = await pool.query(
      `SELECT id, task_id, mode, prompt, aspect_ratio, resolution, output_format, status, result_url, dropbox_url, channel_id, template_slug, credit_cost, system_charged, error, logs, created_at, updated_at
       FROM nano_banana2_tasks WHERE user_id = $1 AND task_id = $2`,
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
    console.log(`[nanoBanana2:status] taskId=${taskId} KIE response:`, JSON.stringify(raw).substring(0, 1500));
    const data = raw?.data || raw || {};
    // KIE inconsistently uses different keys/casing across models. Normalize aggressively.
    const stateRaw: string = String(data.state || data.status || data.taskState || data.taskStatus || data.state_code || raw?.state || raw?.status || '').trim();
    const state = stateRaw.toLowerCase();
    if (stateRaw) console.log(`[nanoBanana2:status] taskId=${taskId} state=${stateRaw}`);

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

    if (['success', 'completed', 'done', 'finished', 'ok', '2', 'complete'].includes(state)) {
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
        let dbxLogEntry: { emoji: string; text: string } | null = null;
        if (isDropboxConfigured()) {
          try {
            const ext = (url.match(/\.(png|jpg|jpeg|webp)(\?|$)/i)?.[1] || task.output_format || 'png').toLowerCase();
            const dbxResult = await uploadImageToDropbox(url, userId, task.id, ext);
            dropboxUrl = dbxResult.sharedUrl;
            console.log(`[nanoBanana2:status] Uploaded to Dropbox: ${dbxResult.dropboxPath}`);
            dbxLogEntry = { emoji: '📦', text: 'บันทึกไป Dropbox สำเร็จ' };
          } catch (dbxErr: any) {
            console.error(`[nanoBanana2:status] Dropbox upload failed for task ${taskId}:`, dbxErr?.message);
            dbxLogEntry = { emoji: '⚠️', text: `Dropbox upload ล้มเหลว: ${(dbxErr?.message || 'unknown').substring(0, 80)}` };
          }
        } else {
          dbxLogEntry = { emoji: '⏭️', text: 'ไม่ได้บันทึก Dropbox (ไม่ได้ตั้งค่า DROPBOX_TOKEN)' };
        }

        await pool.query(
          `UPDATE nano_banana2_tasks SET status = 'success', result_url = $1, dropbox_url = $2, updated_at = NOW() WHERE id = $3`,
          [url, dropboxUrl, task.id]
        );
        await appendLog(task.id, '✅', 'สร้างภาพสำเร็จ');
        if (dbxLogEntry) await appendLog(task.id, dbxLogEntry.emoji, dbxLogEntry.text);

        try {
          const r = await pool.query(
            `INSERT INTO content_history (user_id, channel_id, video_url, prompt, aspect_ratio, source, created_at)
             VALUES ($1, $2, $3, $4, $5, 'nano_banana_2', NOW())
             ON CONFLICT (user_id, video_url) DO NOTHING
             RETURNING id`,
            [userId, task.channel_id, dropboxUrl || url, task.prompt, task.aspect_ratio]
          );
          if ((r.rowCount || 0) > 0) {
            await appendLog(task.id, '📑', 'บันทึกลงประวัติแล้ว');
          }
        } catch (chErr: any) {
          console.error(`[nanoBanana2:status] content_history insert failed:`, chErr?.message);
          await appendLog(task.id, '⚠️', `บันทึกประวัติล้มเหลว: ${(chErr?.message || 'unknown').substring(0, 80)}`);
        }

        const refreshed = await pool.query(`SELECT logs FROM nano_banana2_tasks WHERE id = $1`, [task.id]);
        const freshLogs = refreshed.rows[0]?.logs ?? task.logs;
        return res.json({
          task: { ...task, status: 'success', result_url: url, dropbox_url: dropboxUrl, logs: freshLogs },
        });
      }
      console.log(`[nanoBanana2:status] state=${state} but no URL found in response for taskId=${taskId}`);
      await appendLog(task.id, '⚠️', 'KIE success แต่ไม่พบ URL ในผลลัพธ์');
      await pool.query(
        `UPDATE nano_banana2_tasks SET status = 'failed', error = 'No image URL in result', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
      await maybeAutoRefund(userId, task, 'No image URL in result');
      return res.json({ task: { ...task, status: 'failed', error: 'No image URL in result' } });
    }

    if (['fail', 'failed', 'error', 'rejected', '3'].includes(state)) {
      const errMsg = data.failMsg || data.fail_msg || data.errorMessage || data.error || 'Generation failed';
      await appendLog(task.id, '❌', `KIE error: ${errMsg.substring(0, 80)}`);
      await pool.query(
        `UPDATE nano_banana2_tasks SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
        [errMsg, task.id]
      );
      await maybeAutoRefund(userId, task, errMsg);
      return res.json({ task: { ...task, status: 'failed', error: errMsg } });
    }

    // Still pending — append a heartbeat log every poll so UI shows progress.
    const elapsedSec = Math.round((Date.now() - new Date(task.created_at).getTime()) / 1000);
    await appendLog(task.id, '⏳', `ยังประมวลผลอยู่... (${elapsedSec}s)`);
    const refreshed = await pool.query(`SELECT logs FROM nano_banana2_tasks WHERE id = $1`, [task.id]);
    const freshLogs = refreshed.rows[0]?.logs ?? task.logs;
    return res.json({ task: { ...task, status: 'pending', logs: freshLogs } });
  } catch (err: any) {
    console.error('[nanoBanana2:status] Error:', err);
    return res.status(500).json({ error: err?.message || 'Status check failed' });
  }
});

// GET /api/nano-banana-2/history
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
      `SELECT id, task_id, mode, prompt, aspect_ratio, resolution, output_format, status, result_url, dropbox_url, channel_id, template_slug, error, created_at, updated_at
       FROM nano_banana2_tasks ${where}
       ORDER BY created_at DESC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      params
    );
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM nano_banana2_tasks ${where}`,
      params.slice(0, params.length - 2)
    );

    return res.json({ items: rows.rows, total: parseInt(countRes.rows[0].count) });
  } catch (err: any) {
    console.error('[nanoBanana2:history] Error:', err);
    return res.status(500).json({ error: err?.message || 'History fetch failed' });
  }
});

// DELETE /api/nano-banana-2/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const r = await pool.query(
      `DELETE FROM nano_banana2_tasks WHERE user_id = $1 AND id = $2 RETURNING id`,
      [userId, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[nanoBanana2:delete] Error:', err);
    return res.status(500).json({ error: err?.message || 'Delete failed' });
  }
});

export default router;
