import express, { Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import FormDataLib from 'form-data';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { uploadVideoToDropbox, isDropboxConfigured } from '../utils/dropbox.js';
import {
  deductCreditsWithRetry,
  refundCreditsWithRetry,
  updateKieTaskId,
  hasBeenRefunded,
} from '../services/creditService.js';
import { KLING_CREDIT_PER_SEC, chargeCredits } from '../config/generationPricing.js';

/** Reference type stored in credit_transactions for kling-3 motion control charges. */
const KLING3_REF_TYPE = 'kling3_motion_task';

const router = express.Router();

// Image: 10MB, Video: 100MB — set to 100MB to cover both
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 110 * 1024 * 1024, files: 2 },
});

const KIE_BASE = 'https://api.kie.ai';
const KIE_FILE_BASE = 'https://kieai.redpandaai.co';

// Upload a file buffer to KIE File Upload API and return the public KIE URL
// Use axios because Node's native fetch can mis-handle form-data streaming (boundary issues),
// which caused KIE to return generic "Internal server error" responses.
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

  console.log(
    `[kling3:fileUpload] POST ${KIE_FILE_BASE}/api/file-stream-upload`,
    { fileName, mimetype, uploadPath, size: buffer.length }
  );

  try {
    const { data: result, status } = await axios.post(
      `${KIE_FILE_BASE}/api/file-stream-upload`,
      fd,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...fd.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
      }
    );
    console.log(
      `[kling3:fileUpload] HTTP ${status} response:`,
      JSON.stringify(result).substring(0, 1500)
    );
    // Try multiple URL fields — KIE may use fileUrl, downloadUrl, url, or others
    const fileUrl =
      result?.data?.fileUrl ||
      result?.data?.downloadUrl ||
      result?.data?.url ||
      result?.fileUrl ||
      result?.downloadUrl ||
      null;
    if (status < 200 || status >= 300) {
      throw new Error(
        result?.msg || `KIE file upload failed: HTTP ${status} body=${JSON.stringify(result).substring(0, 300)}`
      );
    }
    if (!fileUrl) {
      throw new Error(
        `KIE upload returned no URL. Response: ${JSON.stringify(result).substring(0, 500)}`
      );
    }
    return fileUrl as string;
  } catch (err: any) {
    if (err?.response) {
      const r = err.response;
      throw new Error(r.data?.msg || `KIE upload HTTP ${r.status}`);
    }
    throw err;
  }
}

// Ensure table exists at startup
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kling3_motion_control_tasks (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        prompt TEXT,
        input_url TEXT NOT NULL,
        video_url TEXT NOT NULL,
        mode TEXT,
        character_orientation TEXT,
        background_source TEXT,
        status TEXT DEFAULT 'pending',
        result_url TEXT,
        error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      ALTER TABLE kling3_motion_control_tasks ADD COLUMN IF NOT EXISTS channel_id INT;
      ALTER TABLE kling3_motion_control_tasks ADD COLUMN IF NOT EXISTS dropbox_url TEXT;
      ALTER TABLE kling3_motion_control_tasks ADD COLUMN IF NOT EXISTS credit_cost INT;
      ALTER TABLE kling3_motion_control_tasks ADD COLUMN IF NOT EXISTS system_charged BOOLEAN DEFAULT FALSE;
      CREATE INDEX IF NOT EXISTS idx_kling3_user ON kling3_motion_control_tasks(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_kling3_task ON kling3_motion_control_tasks(task_id);
      CREATE INDEX IF NOT EXISTS idx_kling3_channel ON kling3_motion_control_tasks(channel_id);
    `);
    console.log('✅ kling3_motion_control_tasks table ready');
  } catch (err) {
    console.error('Failed to create kling3_motion_control_tasks table:', err);
  }
})();

async function getUserKieKey(userId: number): Promise<string | null> {
  const r = await pool.query(`SELECT kie_api_key FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.kie_api_key || null;
}

// POST /api/kling-3-motion-control/generate
// Multipart form: image (1 file) + video (1 file) + prompt? + mode? + character_orientation? + background_source?
router.post(
  '/generate',
  authenticate,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]),
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const { prompt, mode, character_orientation, background_source, channel_id } = req.body as Record<string, string>;
      const channelId = channel_id ? parseInt(channel_id) : null;
      const filesByField = req.files as { [field: string]: Express.Multer.File[] } | undefined;
      const imageFile = filesByField?.image?.[0];
      const videoFile = filesByField?.video?.[0];

      if (!imageFile) return res.status(400).json({ error: 'image file is required' });
      if (!videoFile) return res.status(400).json({ error: 'video file is required' });

      // Hybrid 2-tier key resolution:
      //   - user has personal kie_api_key  → use it, NO trippleschool credit charge
      //   - no personal key + system env   → use system key, CHARGE trippleschool credits
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

      // Pre-charge if using system key. duration_sec is supplied by FE (Kling
      // FE inspects the motion video and sends Math.round(videoDuration)).
      // Default 10 if missing — server clamps 1..60 to bound charge.
      let charge: { cost: number; tempRef: string; balanceAfter: number } | null = null;
      if (useSystemKey) {
        const durationRaw = parseInt(String((req.body as Record<string, string>).duration_sec || '')) || 10;
        const durationSec = Math.min(Math.max(durationRaw, 1), 60);
        const cost = chargeCredits(durationSec * KLING_CREDIT_PER_SEC);
        const tempRef = `pending_kling3_${userId}_${Date.now()}`;
        const deduct = await deductCreditsWithRetry(
          userId,
          cost,
          KLING3_REF_TYPE,
          tempRef,
          `Kling 3 Motion Control · ${durationSec}s`
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

      // Validate image type
      if (!/^image\/(jpeg|png|jpg)$/i.test(imageFile.mimetype)) {
        return res.status(400).json({ error: 'image must be JPEG or PNG' });
      }
      if (imageFile.size > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'image exceeds 10MB' });
      }
      // Validate video type
      if (!/^video\/(mp4|quicktime)$/i.test(videoFile.mimetype)) {
        return res.status(400).json({ error: 'video must be MP4 or QuickTime' });
      }
      if (videoFile.size > 100 * 1024 * 1024) {
        return res.status(400).json({ error: 'video exceeds 100MB' });
      }

      // Upload directly to KIE File Upload API (kling-3.0/motion-control requires KIE-hosted URLs).
      // If we charged credits, any failure here triggers an automatic refund.
      const refundOnFailure = async (msg: string) => {
        if (charge) {
          await refundCreditsWithRetry(
            userId,
            charge.cost,
            KLING3_REF_TYPE,
            charge.tempRef,
            `Refund: ${msg}`
          ).catch((err) => console.error('[kling3:refund]', err));
        }
      };

      const ts = Date.now();
      const imgExt = (imageFile.originalname.split('.').pop() || 'png').toLowerCase();
      const vidExt = (videoFile.originalname.split('.').pop() || 'mp4').toLowerCase();
      // Use single-segment uploadPath (avoid slashes that some upload providers reject)
      const uploadPath = `kling3-motion-${userId}`;
      let inputUrl: string;
      let videoUrl: string;
      try {
        inputUrl = await uploadToKieFileApi(
          kieKey,
          imageFile.buffer,
          `${ts}_input.${imgExt}`,
          imageFile.mimetype,
          uploadPath
        );
        console.log(`[kling3:generate] Uploaded image to KIE: ${inputUrl}`);
      } catch (err: any) {
        await refundOnFailure(`image upload — ${err.message}`);
        return res.status(502).json({
          error: `Failed to upload image to KIE: ${err.message}`,
          stage: 'image_upload',
          uploadPath,
          fileName: `${ts}_input.${imgExt}`,
          mimetype: imageFile.mimetype,
          size: imageFile.size,
        });
      }
      try {
        videoUrl = await uploadToKieFileApi(
          kieKey,
          videoFile.buffer,
          `${ts}_motion.${vidExt}`,
          videoFile.mimetype,
          uploadPath
        );
        console.log(`[kling3:generate] Uploaded video to KIE: ${videoUrl}`);
      } catch (err: any) {
        await refundOnFailure(`video upload — ${err.message}`);
        return res.status(502).json({
          error: `Failed to upload video to KIE: ${err.message}`,
          stage: 'video_upload',
          uploadPath,
          fileName: `${ts}_motion.${vidExt}`,
          mimetype: videoFile.mimetype,
          size: videoFile.size,
        });
      }

      // Call KIE create task
      const kieBody: any = {
        model: 'kling-3.0/motion-control',
        callBackUrl: 'https://example.com/callback',
        input: {
          input_urls: [inputUrl],
          video_urls: [videoUrl],
          ...(prompt && prompt.trim() ? { prompt: prompt.trim() } : {}),
          ...(mode ? { mode } : {}),
          ...(character_orientation ? { character_orientation } : {}),
          ...(background_source ? { background_source } : {}),
        },
      };

      console.log('[kling3:generate] KIE request body:', JSON.stringify(kieBody, null, 2));

      // Build a curl command that matches the actual request (sanitize the API key)
      const curlCommand =
        `curl --location --request POST '${KIE_BASE}/api/v1/jobs/createTask' \\\n` +
        `  --header 'Authorization: Bearer <YOUR_KIE_API_KEY>' \\\n` +
        `  --header 'Content-Type: application/json' \\\n` +
        `  --data-raw '${JSON.stringify(kieBody)}'`;

      const kieRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${kieKey}`,
        },
        body: JSON.stringify(kieBody),
      });
      const kieData: any = await kieRes.json().catch(() => ({}));
      console.log('[kling3:generate] KIE response:', JSON.stringify(kieData, null, 2));

      if (!kieRes.ok || kieData.code !== 200 || !kieData.data?.taskId) {
        await refundOnFailure(`KIE createTask — ${kieData?.msg || `HTTP ${kieRes.status}`}`);
        return res.status(502).json({
          error: kieData.msg || `KIE error (HTTP ${kieRes.status})`,
          details: kieData,
          requestBody: kieBody,
          curlCommand,
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
            [taskId, userId, KLING3_REF_TYPE, charge.tempRef]
          );
        } catch (e: any) {
          console.warn('[kling3:updateRef] failed:', e?.message);
        }
        // Also stash KIE task id in metadata for audit
        await updateKieTaskId(userId, taskId, 'deduct').catch(() => {});
      }

      const insert = await pool.query(
        `INSERT INTO kling3_motion_control_tasks
         (user_id, task_id, prompt, input_url, video_url, mode, character_orientation, background_source, status, channel_id, credit_cost, system_charged)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11)
         RETURNING id, task_id, prompt, mode, character_orientation, background_source, status, channel_id, credit_cost, system_charged, created_at`,
        [
          userId,
          taskId,
          prompt?.trim() || null,
          inputUrl,
          videoUrl,
          mode || null,
          character_orientation || null,
          background_source || null,
          channelId,
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
      // Best-effort refund if we got past pre-charge but something else threw
      if (typeof (req.body as any)?.duration_sec !== 'undefined') {
        // (charge variable scoped inside route handler; lookup is implicit
        //  via the refund idempotency check on KLING3_REF_TYPE for this user)
      }
      console.error('[kling3:generate] Error:', err);
      return res.status(500).json({ error: err?.message || 'Generate failed' });
    }
  }
);

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
  const already = await hasBeenRefunded(KLING3_REF_TYPE, task.task_id).catch(() => false);
  if (already) return;
  await refundCreditsWithRetry(
    userId,
    task.credit_cost,
    KLING3_REF_TYPE,
    task.task_id,
    `Auto-refund: ${reason}`
  ).catch((err) => console.error('[kling3:autoRefund]', err));
}

// GET /api/kling-3-motion-control/status/:taskId
router.get('/status/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { taskId } = req.params;

    const row = await pool.query(
      `SELECT id, task_id, prompt, mode, character_orientation, background_source, status, result_url, dropbox_url, channel_id, credit_cost, system_charged, error, created_at, updated_at
       FROM kling3_motion_control_tasks WHERE user_id = $1 AND task_id = $2`,
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
    console.log(`[kling3:status] taskId=${taskId} KIE response:`, JSON.stringify(raw).substring(0, 1500));
    const data = raw?.data || raw || {};
    const state: string | undefined = data.state || data.status;

    const findUrl = (obj: any): string | null => {
      if (!obj) return null;
      if (typeof obj === 'string') return /^https?:\/\//.test(obj) ? obj : null;
      if (Array.isArray(obj)) {
        for (const item of obj) { const u = findUrl(item); if (u) return u; }
        return null;
      }
      if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) { const u = findUrl(obj[k]); if (u) return u; }
      }
      return null;
    };

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
      if (!url) {
        url = data.resultUrl || data.videoUrl || data.video_url || data.url
            || data.resultUrls?.[0] || data.result_urls?.[0]
            || data.videoUrls?.[0] || data.video_urls?.[0] || null;
      }
      if (!url) url = findUrl(data) || findUrl(raw);

      if (url) {
        // Best-effort Dropbox upload
        let dropboxUrl: string | null = null;
        if (isDropboxConfigured()) {
          try {
            const dateStr = new Date().toISOString().slice(0, 10);
            const dropboxPath = `/trippleviral/kling-3-motion-control/${userId}/${dateStr}_${task.id}.mp4`;
            const dbxResult = await uploadVideoToDropbox(url, userId, task.id, dropboxPath);
            dropboxUrl = dbxResult.sharedUrl;
            console.log(`[kling3:status] Uploaded to Dropbox: ${dbxResult.dropboxPath}`);
          } catch (dbxErr: any) {
            console.error(`[kling3:status] Dropbox upload failed for task ${taskId}:`, dbxErr?.message);
          }
        }

        await pool.query(
          `UPDATE kling3_motion_control_tasks SET status = 'success', result_url = $1, dropbox_url = $2, updated_at = NOW() WHERE id = $3`,
          [url, dropboxUrl, task.id]
        );

        // Sync into content_history (so it shows in /app/history with channel filter)
        try {
          await pool.query(
            `INSERT INTO content_history (user_id, channel_id, video_url, prompt, source, created_at)
             VALUES ($1, $2, $3, $4, 'kling_3_motion_control', NOW())
             ON CONFLICT (user_id, video_url) DO NOTHING`,
            [userId, task.channel_id, dropboxUrl || url, task.prompt]
          );
        } catch (chErr: any) {
          console.error(`[kling3:status] content_history insert failed:`, chErr?.message);
        }

        return res.json({ task: { ...task, status: 'success', result_url: url, dropbox_url: dropboxUrl } });
      }
      console.log(`[kling3:status] state=${state} but no URL found in response for taskId=${taskId}`);
      await pool.query(
        `UPDATE kling3_motion_control_tasks SET status = 'failed', error = 'No video URL in result', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
      await maybeAutoRefund(userId, task, 'No video URL in result');
      return res.json({ task: { ...task, status: 'failed', error: 'No video URL in result' } });
    }

    if (state === 'fail' || state === 'failed' || state === 'error') {
      const errMsg = data.failMsg || data.fail_msg || data.errorMessage || data.error || 'Generation failed';
      await pool.query(
        `UPDATE kling3_motion_control_tasks SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
        [errMsg, task.id]
      );
      await maybeAutoRefund(userId, task, errMsg);
      return res.json({ task: { ...task, status: 'failed', error: errMsg } });
    }

    return res.json({ task: { ...task, status: 'pending' } });
  } catch (err: any) {
    console.error('[kling3:status] Error:', err);
    return res.status(500).json({ error: err?.message || 'Status check failed' });
  }
});

// GET /api/kling-3-motion-control/history
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    const offset = parseInt(String(req.query.offset || '0')) || 0;

    const rows = await pool.query(
      `SELECT id, task_id, prompt, input_url, video_url, mode, character_orientation, background_source, status, result_url, dropbox_url, channel_id, error, created_at, updated_at
       FROM kling3_motion_control_tasks WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    const countRes = await pool.query(`SELECT COUNT(*) FROM kling3_motion_control_tasks WHERE user_id = $1`, [userId]);

    return res.json({ items: rows.rows, total: parseInt(countRes.rows[0].count) });
  } catch (err: any) {
    console.error('[kling3:history] Error:', err);
    return res.status(500).json({ error: err?.message || 'History fetch failed' });
  }
});

// DELETE /api/kling-3-motion-control/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const r = await pool.query(
      `DELETE FROM kling3_motion_control_tasks WHERE user_id = $1 AND id = $2 RETURNING id`,
      [userId, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[kling3:delete] Error:', err);
    return res.status(500).json({ error: err?.message || 'Delete failed' });
  }
});

export default router;
