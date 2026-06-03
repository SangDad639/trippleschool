import express, { Response } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

// ============================================
// GET /api/content-history — Consolidated content history
// ============================================

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  try {
    const userId = req.userId!;
    const {
      type,
      source,
      channel_id,
      date_from,
      date_to,
      limit = '50',
      offset = '0',
      skip_count,
    } = req.query as Record<string, string>;

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const offsetNum = parseInt(offset) || 0;

    // Build WHERE conditions for each sub-query
    const params: any[] = [userId];
    let paramIndex = 2;

    let channelCondViral = '';
    let channelCondViralJobFilter = '';
    let channelCondIdolJobFilter = '';
    let channelCondIdol = '';
    let channelCondQueue = '';
    if (channel_id) {
      // Use subquery to filter job_ids BEFORE JSONB unnesting (much faster)
      channelCondViralJobFilter = ` AND t.job_id IN (SELECT id FROM viral_template_jobs WHERE user_id = $1 AND channel_id = $${paramIndex})`;
      channelCondIdolJobFilter = ` AND t.job_id IN (SELECT id FROM idol_template_jobs WHERE user_id = $1 AND channel_id = $${paramIndex})`;
      channelCondViral = ` AND j.channel_id = $${paramIndex}`;
      channelCondIdol = ` AND j.channel_id = $${paramIndex}`;
      channelCondQueue = ` AND sq.channel_id = $${paramIndex}`;
      params.push(parseInt(channel_id));
      paramIndex++;
    }

    let dateFromCond = '';
    if (date_from) {
      dateFromCond = ` AND created_at >= $${paramIndex}::date`;
      params.push(date_from);
      paramIndex++;
    }

    let dateToCond = '';
    if (date_to) {
      dateToCond = ` AND created_at <= ($${paramIndex}::date + interval '1 day')`;
      params.push(date_to);
      paramIndex++;
    }

    // Sub-queries for each content type
    const viralImageQuery = `
      SELECT
        'viral-img-' || t.id || '-' || (elem->>'scene') AS id,
        'image'::text AS type,
        'viral_image'::text AS source,
        elem->>'image_url' AS url,
        elem->>'image_url' AS thumbnail_url,
        j.channel_id,
        c.name AS channel_name,
        t.updated_at AS created_at,
        t.character_name,
        CASE WHEN (elem->>'scene') ~ '^\d+$' THEN (elem->>'scene')::int ELSE NULL END AS scene_number,
        t.id AS task_id,
        t.job_id,
        NULL::int AS queue_item_id,
        'portrait'::text AS aspect_ratio,
        (SELECT p->>'image_prompt' FROM jsonb_array_elements(t.ai_prompts) AS p WHERE (p->>'scene') ~ '^\d+$' AND (elem->>'scene') ~ '^\d+$' AND (p->>'scene')::int = (elem->>'scene')::int LIMIT 1) AS prompt
      FROM viral_template_tasks t
      JOIN viral_template_jobs j ON t.job_id = j.id
      LEFT JOIN scheduler_channels c ON j.channel_id = c.id
      CROSS JOIN LATERAL jsonb_array_elements(t.image_tasks) AS elem
      WHERE t.user_id = $1
        ${channelCondViralJobFilter}
        AND elem->>'image_url' IS NOT NULL
        AND elem->>'image_url' != ''
        ${channelCondViral}
    `;

    const viralSceneVideoQuery = `
      SELECT
        'viral-vid-' || t.id || '-' || (elem->>'scene') AS id,
        'video'::text AS type,
        'viral_scene_video'::text AS source,
        elem->>'video_url' AS url,
        elem->>'thumbnail_url' AS thumbnail_url,
        j.channel_id,
        c.name AS channel_name,
        t.updated_at AS created_at,
        t.character_name,
        CASE WHEN (elem->>'scene') ~ '^\d+$' THEN (elem->>'scene')::int ELSE NULL END AS scene_number,
        t.id AS task_id,
        t.job_id,
        NULL::int AS queue_item_id,
        'portrait'::text AS aspect_ratio,
        (SELECT p->>'video_prompt' FROM jsonb_array_elements(t.ai_prompts) AS p WHERE (p->>'scene') ~ '^\d+$' AND (elem->>'scene') ~ '^\d+$' AND (p->>'scene')::int = (elem->>'scene')::int LIMIT 1) AS prompt
      FROM viral_template_tasks t
      JOIN viral_template_jobs j ON t.job_id = j.id
      LEFT JOIN scheduler_channels c ON j.channel_id = c.id
      CROSS JOIN LATERAL jsonb_array_elements(t.video_tasks) AS elem
      WHERE t.user_id = $1
        ${channelCondViralJobFilter}
        AND elem->>'video_url' IS NOT NULL
        AND elem->>'video_url' != ''
        AND (elem->>'status') = 'done'
        ${channelCondViral}
    `;

    const viralFinalVideoQuery = `
      SELECT
        'viral-final-' || t.id AS id,
        'video'::text AS type,
        'viral_final_video'::text AS source,
        t.final_video_url AS url,
        t.thumbnail_url AS thumbnail_url,
        j.channel_id,
        c.name AS channel_name,
        t.updated_at AS created_at,
        t.character_name,
        NULL::int AS scene_number,
        t.id AS task_id,
        t.job_id,
        NULL::int AS queue_item_id,
        'portrait'::text AS aspect_ratio,
        (SELECT string_agg(p->>'video_prompt', ' | ' ORDER BY CASE WHEN (p->>'scene') ~ '^\d+$' THEN (p->>'scene')::int ELSE 999 END) FROM jsonb_array_elements(t.ai_prompts) AS p) AS prompt
      FROM viral_template_tasks t
      JOIN viral_template_jobs j ON t.job_id = j.id
      LEFT JOIN scheduler_channels c ON j.channel_id = c.id
      WHERE t.user_id = $1
        ${channelCondViralJobFilter}
        AND t.final_video_url IS NOT NULL
        AND t.final_video_url != ''
        AND t.status = 'done'
        ${channelCondViral}
    `;

    // ---- Idol template queries (same structure as viral) ----
    const idolImageQuery = `
      SELECT
        'idol-img-' || t.id || '-' || (elem->>'scene') AS id,
        'image'::text AS type,
        'idol_image'::text AS source,
        elem->>'image_url' AS url,
        elem->>'image_url' AS thumbnail_url,
        j.channel_id,
        c.name AS channel_name,
        t.updated_at AS created_at,
        t.character_name,
        CASE WHEN (elem->>'scene') ~ '^\d+$' THEN (elem->>'scene')::int ELSE NULL END AS scene_number,
        t.id AS task_id,
        t.job_id,
        NULL::int AS queue_item_id,
        'portrait'::text AS aspect_ratio,
        (SELECT p->>'image_prompt' FROM jsonb_array_elements(t.ai_prompts) AS p WHERE (p->>'scene') ~ '^\d+$' AND (elem->>'scene') ~ '^\d+$' AND (p->>'scene')::int = (elem->>'scene')::int LIMIT 1) AS prompt
      FROM idol_template_tasks t
      JOIN idol_template_jobs j ON t.job_id = j.id
      LEFT JOIN scheduler_channels c ON j.channel_id = c.id
      CROSS JOIN LATERAL jsonb_array_elements(t.image_tasks) AS elem
      WHERE t.user_id = $1
        ${channelCondIdolJobFilter}
        AND elem->>'image_url' IS NOT NULL
        AND elem->>'image_url' != ''
        ${channelCondIdol}
    `;

    const idolSceneVideoQuery = `
      SELECT
        'idol-vid-' || t.id || '-' || (elem->>'scene') AS id,
        'video'::text AS type,
        'idol_scene_video'::text AS source,
        elem->>'video_url' AS url,
        elem->>'thumbnail_url' AS thumbnail_url,
        j.channel_id,
        c.name AS channel_name,
        t.updated_at AS created_at,
        t.character_name,
        CASE WHEN (elem->>'scene') ~ '^\d+$' THEN (elem->>'scene')::int ELSE NULL END AS scene_number,
        t.id AS task_id,
        t.job_id,
        NULL::int AS queue_item_id,
        'portrait'::text AS aspect_ratio,
        (SELECT p->>'video_prompt' FROM jsonb_array_elements(t.ai_prompts) AS p WHERE (p->>'scene') ~ '^\d+$' AND (elem->>'scene') ~ '^\d+$' AND (p->>'scene')::int = (elem->>'scene')::int LIMIT 1) AS prompt
      FROM idol_template_tasks t
      JOIN idol_template_jobs j ON t.job_id = j.id
      LEFT JOIN scheduler_channels c ON j.channel_id = c.id
      CROSS JOIN LATERAL jsonb_array_elements(t.video_tasks) AS elem
      WHERE t.user_id = $1
        ${channelCondIdolJobFilter}
        AND elem->>'video_url' IS NOT NULL
        AND elem->>'video_url' != ''
        AND (elem->>'status') = 'done'
        ${channelCondIdol}
    `;

    const idolFinalVideoQuery = `
      SELECT
        'idol-final-' || t.id AS id,
        'video'::text AS type,
        'idol_final_video'::text AS source,
        t.final_video_url AS url,
        t.thumbnail_url AS thumbnail_url,
        j.channel_id,
        c.name AS channel_name,
        t.updated_at AS created_at,
        t.character_name,
        NULL::int AS scene_number,
        t.id AS task_id,
        t.job_id,
        NULL::int AS queue_item_id,
        'portrait'::text AS aspect_ratio,
        (SELECT string_agg(p->>'video_prompt', ' | ' ORDER BY CASE WHEN (p->>'scene') ~ '^\d+$' THEN (p->>'scene')::int ELSE 999 END) FROM jsonb_array_elements(t.ai_prompts) AS p) AS prompt
      FROM idol_template_tasks t
      JOIN idol_template_jobs j ON t.job_id = j.id
      LEFT JOIN scheduler_channels c ON j.channel_id = c.id
      WHERE t.user_id = $1
        ${channelCondIdolJobFilter}
        AND t.final_video_url IS NOT NULL
        AND t.final_video_url != ''
        AND t.status = 'done'
        ${channelCondIdol}
    `;

    // Query จาก content_history (persist แยกจาก schedule_queue — ลบ task ไม่ทำให้ video หาย)
    const scheduleQueueQuery = `
      SELECT
        'ch-' || ch.id AS id,
        'video'::text AS type,
        'schedule_queue'::text AS source,
        ch.video_url AS url,
        ch.thumbnail_url AS thumbnail_url,
        ch.channel_id,
        c.name AS channel_name,
        ch.created_at AS created_at,
        NULL::text AS character_name,
        NULL::int AS scene_number,
        NULL::int AS task_id,
        NULL::int AS job_id,
        ch.queue_item_id AS queue_item_id,
        ch.aspect_ratio AS aspect_ratio,
        ch.prompt AS prompt
      FROM content_history ch
      LEFT JOIN scheduler_channels c ON ch.channel_id = c.id
      WHERE ch.user_id = $1
        AND ch.source = 'schedule_queue'
        ${channelCondQueue.replace(/sq\./g, 'ch.')}
    `;

    // GPT Image 2 — direct generations only (NOT from Image Template). Distinguished via template_slug.
    // template_slug IS NULL = generated from /image/gpt-image-2 page (no template).
    const gptImage2Query = `
      SELECT
        'ch-' || ch.id AS id,
        'image'::text AS type,
        'gpt_image_2'::text AS source,
        ch.video_url AS url,
        ch.thumbnail_url AS thumbnail_url,
        ch.channel_id,
        c.name AS channel_name,
        ch.created_at AS created_at,
        NULL::text AS character_name,
        NULL::int AS scene_number,
        NULL::int AS task_id,
        NULL::int AS job_id,
        ch.queue_item_id AS queue_item_id,
        ch.aspect_ratio AS aspect_ratio,
        ch.prompt AS prompt
      FROM content_history ch
      LEFT JOIN scheduler_channels c ON ch.channel_id = c.id
      WHERE ch.user_id = $1
        AND ch.source = 'gpt_image_2'
        AND (ch.template_slug IS NULL OR ch.template_slug = '')
        ${channelCondQueue.replace(/sq\./g, 'ch.')}
    `;

    // Image Template — gpt_image_2 rows with template_slug NOT NULL (generated via /admin/image-templates).
    // Surfaces as `source='image_template'` to the client so it's a distinct filter bucket.
    const imageTemplateQuery = `
      SELECT
        'ch-' || ch.id AS id,
        'image'::text AS type,
        'image_template'::text AS source,
        ch.video_url AS url,
        ch.thumbnail_url AS thumbnail_url,
        ch.channel_id,
        c.name AS channel_name,
        ch.created_at AS created_at,
        NULL::text AS character_name,
        NULL::int AS scene_number,
        NULL::int AS task_id,
        NULL::int AS job_id,
        ch.queue_item_id AS queue_item_id,
        ch.aspect_ratio AS aspect_ratio,
        ch.prompt AS prompt
      FROM content_history ch
      LEFT JOIN scheduler_channels c ON ch.channel_id = c.id
      WHERE ch.user_id = $1
        AND ch.source = 'gpt_image_2'
        AND ch.template_slug IS NOT NULL
        AND ch.template_slug <> ''
        ${channelCondQueue.replace(/sq\./g, 'ch.')}
    `;

    // Kling 3.0 Motion Control generated videos (source='kling_3_motion_control')
    const kling3MotionControlQuery = `
      SELECT
        'ch-' || ch.id AS id,
        'video'::text AS type,
        'kling_3_motion_control'::text AS source,
        ch.video_url AS url,
        ch.thumbnail_url AS thumbnail_url,
        ch.channel_id,
        c.name AS channel_name,
        ch.created_at AS created_at,
        NULL::text AS character_name,
        NULL::int AS scene_number,
        NULL::int AS task_id,
        NULL::int AS job_id,
        ch.queue_item_id AS queue_item_id,
        ch.aspect_ratio AS aspect_ratio,
        ch.prompt AS prompt
      FROM content_history ch
      LEFT JOIN scheduler_channels c ON ch.channel_id = c.id
      WHERE ch.user_id = $1
        AND ch.source = 'kling_3_motion_control'
        ${channelCondQueue.replace(/sq\./g, 'ch.')}
    `;

    // Moved clips — viral/idol clips that were detached from their original task
    // and re-attached to a different channel via the /move endpoint. Source is preserved
    // so the badge in the destination channel still shows the original (Viral/Idol/etc).
    const makeMovedClipsQuery = (sources: string[]) => `
      SELECT
        'ch-' || ch.id AS id,
        CASE WHEN ch.source IN ('viral_image', 'idol_image') THEN 'image'::text ELSE 'video'::text END AS type,
        ch.source AS source,
        ch.video_url AS url,
        ch.thumbnail_url AS thumbnail_url,
        ch.channel_id,
        c.name AS channel_name,
        ch.created_at AS created_at,
        NULL::text AS character_name,
        NULL::int AS scene_number,
        NULL::int AS task_id,
        NULL::int AS job_id,
        ch.queue_item_id AS queue_item_id,
        ch.aspect_ratio AS aspect_ratio,
        ch.prompt AS prompt
      FROM content_history ch
      LEFT JOIN scheduler_channels c ON ch.channel_id = c.id
      WHERE ch.user_id = $1
        AND ch.source IN (${sources.map((s) => `'${s}'`).join(',')})
        ${channelCondQueue.replace(/sq\./g, 'ch.')}
    `;
    const ALL_MOVED_SOURCES = ['viral_image', 'viral_scene_video', 'viral_final_video', 'idol_image', 'idol_scene_video', 'idol_final_video'];
    const IMG_MOVED_SOURCES = ['viral_image', 'idol_image'];
    const VID_MOVED_SOURCES = ['viral_scene_video', 'viral_final_video', 'idol_scene_video', 'idol_final_video'];

    // Build type + source filter
    let subQueries: string[] = [];
    if (source === 'viral_final_video') {
      subQueries = [viralFinalVideoQuery, makeMovedClipsQuery(['viral_final_video'])];
    } else if (source === 'viral_scene_video') {
      subQueries = [viralSceneVideoQuery, makeMovedClipsQuery(['viral_scene_video'])];
    } else if (source === 'idol_final_video') {
      subQueries = [idolFinalVideoQuery, makeMovedClipsQuery(['idol_final_video'])];
    } else if (source === 'idol_scene_video') {
      subQueries = [idolSceneVideoQuery, makeMovedClipsQuery(['idol_scene_video'])];
    } else if (source === 'gpt_image_2') {
      subQueries = [gptImage2Query];
    } else if (source === 'image_template') {
      subQueries = [imageTemplateQuery];
    } else if (source === 'kling_3_motion_control') {
      subQueries = [kling3MotionControlQuery];
    } else if (!type || type === 'all') {
      subQueries = [viralImageQuery, viralSceneVideoQuery, viralFinalVideoQuery, idolImageQuery, idolSceneVideoQuery, idolFinalVideoQuery, scheduleQueueQuery, gptImage2Query, imageTemplateQuery, kling3MotionControlQuery, makeMovedClipsQuery(ALL_MOVED_SOURCES)];
    } else if (type === 'image') {
      subQueries = [viralImageQuery, idolImageQuery, gptImage2Query, imageTemplateQuery, makeMovedClipsQuery(IMG_MOVED_SOURCES)];
    } else if (type === 'video') {
      subQueries = [viralSceneVideoQuery, viralFinalVideoQuery, idolSceneVideoQuery, idolFinalVideoQuery, scheduleQueueQuery, kling3MotionControlQuery, makeMovedClipsQuery(VID_MOVED_SOURCES)];
    }

    const unionQuery = subQueries.join(' UNION ALL ');

    // Wrap in outer query: dedup by url (prefer viral sources over schedule), then date filter, sort, pagination
    const dedupQuery = `
      SELECT DISTINCT ON (url) *
      FROM (${unionQuery}) AS all_items
      ORDER BY url,
        CASE source
          WHEN 'viral_final_video' THEN 1
          WHEN 'idol_final_video' THEN 2
          WHEN 'viral_scene_video' THEN 3
          WHEN 'idol_scene_video' THEN 4
          WHEN 'viral_image' THEN 5
          WHEN 'idol_image' THEN 6
          ELSE 7
        END,
        created_at ASC
    `;

    const dataQuery = `
      SELECT * FROM (${dedupQuery}) AS combined
      WHERE 1=1 ${dateFromCond} ${dateToCond}
      ORDER BY created_at DESC, task_id DESC NULLS LAST,
        CASE source
          WHEN 'viral_final_video' THEN 1
          WHEN 'idol_final_video' THEN 2
          WHEN 'viral_scene_video' THEN 3
          WHEN 'idol_scene_video' THEN 4
          WHEN 'viral_image' THEN 5
          WHEN 'idol_image' THEN 6
          ELSE 7
        END,
        scene_number ASC NULLS LAST
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `;

    const countQuery = `
      SELECT COUNT(*) as total FROM (${dedupQuery}) AS combined
      WHERE 1=1 ${dateFromCond} ${dateToCond}
    `;

    // Skip COUNT query when caller doesn't need total (e.g., dialog popup uses items.length < limit to detect "has more")
    let dataResult;
    let countTotal = -1;
    if (skip_count) {
      dataResult = await pool.query(dataQuery, params);
    } else {
      const [data, countResult] = await Promise.all([
        pool.query(dataQuery, params),
        pool.query(countQuery, params),
      ]);
      dataResult = data;
      countTotal = parseInt(countResult.rows[0].total);
    }

    // Mark items whose video_url has been successfully posted in any schedule_queue item
    const items = dataResult.rows;
    if (items.length > 0) {
      const urls = items.map((r: any) => r.url).filter(Boolean);
      if (urls.length > 0) {
        const postedResult = await pool.query(`
          SELECT DISTINCT video_url FROM schedule_queue
          WHERE user_id = $1 AND video_url = ANY($2)
            AND (
              blotato_post_ids::text LIKE '%"success"%'
              OR late_post_ids::text LIKE '%"success"%'
              OR postforme_post_ids::text LIKE '%"success"%'
            )
        `, [userId, urls]);
        const postedUrls = new Set(postedResult.rows.map((r: any) => r.video_url));
        for (const item of items) {
          item.posted = postedUrls.has(item.url);
        }
      }
    }

    console.log(`[ContentHistory] Query took ${Date.now() - startTime}ms (${items.length} items, limit=${limitNum}, offset=${offsetNum})`);
    res.json({
      items,
      total: countTotal,
      limit: limitNum,
      offset: offsetNum,
    });
  } catch (error: any) {
    console.error('[ContentHistory] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch content history' });
  }
});

// ============================================
// GET /api/content-history/download — Streaming proxy for cross-origin downloads
// ============================================
// Bypasses browser CORS + Content-Type issues by proxying the file through our server.
// Uses streaming (no buffering) — minimal memory/CPU usage.
router.get('/download', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { url, filename } = req.query as Record<string, string>;
    if (!url) return res.status(400).json({ error: 'url is required' });

    // Whitelist domains (prevent SSRF)
    const allowed = [
      'dropbox.com', 'dropboxusercontent.com',
      't3.storageapi.dev',
      'myhuaweicloud.com',
      'kie.ai', 'tempfile.aiquickdraw.com',
      'doculator.org',
    ];
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    const hostOk = allowed.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
    if (!hostOk) return res.status(400).json({ error: 'URL domain not allowed' });

    // Fetch with timeout
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'follow' });
    if (!response.ok || !response.body) {
      return res.status(response.status).json({ error: `Source returned ${response.status}` });
    }

    // Sanitize filename
    const safeName = (filename || 'download').replace(/[^\w.\-]/g, '_').substring(0, 200);

    // Determine proper Content-Type (force video/mp4 or image/* if we know)
    const sourceType = response.headers.get('content-type') || '';
    let contentType = sourceType;
    if (safeName.endsWith('.mp4')) contentType = 'video/mp4';
    else if (safeName.endsWith('.jpg') || safeName.endsWith('.jpeg')) contentType = 'image/jpeg';
    else if (safeName.endsWith('.png')) contentType = 'image/png';
    else if (safeName.endsWith('.webp')) contentType = 'image/webp';
    else if (!contentType || contentType.includes('binary')) contentType = 'application/octet-stream';

    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Type', contentType);
    const len = response.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    // Stream response body to client
    const reader = response.body.getReader();
    res.on('close', () => reader.cancel().catch(() => {}));
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) {
          await new Promise<void>(r => res.once('drain', () => r()));
        }
      }
    } catch (streamErr: any) {
      console.error('[ContentHistory:download] Stream error:', streamErr.message);
    }
    res.end();
  } catch (error: any) {
    console.error('[ContentHistory:download] Error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Download failed' });
    } else {
      res.end();
    }
  }
});

/**
 * Bulk delete content history items.
 * Body: { ids: string[] } — IDs use prefixes: ch-<n>, viral-final-<n>, viral-img-<n>-<scene>,
 * viral-vid-<n>-<scene>, idol-final-<n>, idol-img-..., idol-vid-...
 * Only deletes rows owned by the authenticated user.
 */
router.post('/delete', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((v: any) => typeof v === 'string') : [];
    if (ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }

    const chIds: number[] = [];
    const viralFinalIds: number[] = [];
    const idolFinalIds: number[] = [];
    type SceneRef = { taskId: number; scene: string };
    const viralImgRefs: SceneRef[] = [];
    const viralVidRefs: SceneRef[] = [];
    const idolImgRefs: SceneRef[] = [];
    const idolVidRefs: SceneRef[] = [];

    for (const raw of ids) {
      const m = raw.match(/^(ch|viral-final|idol-final|viral-img|viral-vid|idol-img|idol-vid)-(\d+)(?:-(.+))?$/);
      if (!m) continue;
      const prefix = m[1];
      const taskId = parseInt(m[2], 10);
      const scene = m[3];
      if (!Number.isFinite(taskId)) continue;

      if (prefix === 'ch') chIds.push(taskId);
      else if (prefix === 'viral-final') viralFinalIds.push(taskId);
      else if (prefix === 'idol-final') idolFinalIds.push(taskId);
      else if (prefix === 'viral-img' && scene) viralImgRefs.push({ taskId, scene });
      else if (prefix === 'viral-vid' && scene) viralVidRefs.push({ taskId, scene });
      else if (prefix === 'idol-img' && scene) idolImgRefs.push({ taskId, scene });
      else if (prefix === 'idol-vid' && scene) idolVidRefs.push({ taskId, scene });
    }

    let deleted = 0;

    if (chIds.length > 0) {
      const r = await pool.query(
        `DELETE FROM content_history WHERE user_id = $1 AND id = ANY($2::int[]) RETURNING id`,
        [userId, chIds]
      );
      deleted += r.rowCount || 0;
    }

    if (viralFinalIds.length > 0) {
      const r = await pool.query(
        `UPDATE viral_template_tasks
         SET final_video_url = NULL, thumbnail_url = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND id = ANY($2::int[]) RETURNING id`,
        [userId, viralFinalIds]
      );
      deleted += r.rowCount || 0;
    }

    if (idolFinalIds.length > 0) {
      const r = await pool.query(
        `UPDATE idol_template_tasks
         SET final_video_url = NULL, thumbnail_url = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND id = ANY($2::int[]) RETURNING id`,
        [userId, idolFinalIds]
      );
      deleted += r.rowCount || 0;
    }

    // Per-scene refs: clear the matching scene's url inside the JSONB array
    const clearJsonScene = async (
      table: 'viral_template_tasks' | 'idol_template_tasks',
      column: 'image_tasks' | 'video_tasks',
      urlField: 'image_url' | 'video_url',
      refs: SceneRef[]
    ) => {
      if (refs.length === 0) return;
      // Group by taskId to update each task once
      const byTask = new Map<number, Set<string>>();
      for (const r of refs) {
        if (!byTask.has(r.taskId)) byTask.set(r.taskId, new Set());
        byTask.get(r.taskId)!.add(r.scene);
      }
      for (const [taskId, scenes] of byTask) {
        const sceneList = Array.from(scenes);
        const r = await pool.query(
          `UPDATE ${table}
           SET ${column} = (
             SELECT COALESCE(jsonb_agg(
               CASE WHEN (elem->>'scene') = ANY($3::text[])
                    THEN elem - '${urlField}'
                    ELSE elem END
             ), '[]'::jsonb)
             FROM jsonb_array_elements(${column}) AS elem
           ),
           updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND id = $2 RETURNING id`,
          [userId, taskId, sceneList]
        );
        deleted += (r.rowCount || 0) > 0 ? sceneList.length : 0;
      }
    };

    await clearJsonScene('viral_template_tasks', 'image_tasks', 'image_url', viralImgRefs);
    await clearJsonScene('viral_template_tasks', 'video_tasks', 'video_url', viralVidRefs);
    await clearJsonScene('idol_template_tasks', 'image_tasks', 'image_url', idolImgRefs);
    await clearJsonScene('idol_template_tasks', 'video_tasks', 'video_url', idolVidRefs);

    return res.json({ success: true, deleted });
  } catch (error: any) {
    console.error('[ContentHistory:delete] Error:', error.message);
    return res.status(500).json({ error: error.message || 'Delete failed' });
  }
});

/**
 * Bulk move content history items to a different channel.
 * Body: { ids: string[], target_channel_id: number }
 * - For ch-<n> rows in content_history → simply UPDATE channel_id
 * - For viral/idol final/scene clips → INSERT into content_history with the original
 *   source preserved + clear the URL ref in the original task. Sibling clips in the
 *   same task are not affected.
 */
router.post('/move', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((v: any) => typeof v === 'string') : [];
    const targetChannelId = parseInt(req.body?.target_channel_id);

    if (ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    if (!Number.isFinite(targetChannelId)) {
      return res.status(400).json({ error: 'target_channel_id required' });
    }

    // Verify target channel belongs to this user
    const chCheck = await pool.query(
      `SELECT id FROM scheduler_channels WHERE id = $1 AND user_id = $2`,
      [targetChannelId, userId]
    );
    if (chCheck.rowCount === 0) {
      return res.status(403).json({ error: 'Target channel not found' });
    }

    let moved = 0;

    for (const rawId of ids) {
      // Case 1: ch-<n> — already in content_history, just update channel_id
      let m = rawId.match(/^ch-(\d+)$/);
      if (m) {
        const chId = parseInt(m[1]);
        const r = await pool.query(
          `UPDATE content_history SET channel_id = $1 WHERE id = $2 AND user_id = $3`,
          [targetChannelId, chId, userId]
        );
        moved += r.rowCount || 0;
        continue;
      }

      // Case 2: viral-final-<n> / idol-final-<n>
      m = rawId.match(/^(viral|idol)-final-(\d+)$/);
      if (m) {
        const family = m[1];
        const taskId = parseInt(m[2]);
        const table = family === 'viral' ? 'viral_template_tasks' : 'idol_template_tasks';
        const sourceLabel = family === 'viral' ? 'viral_final_video' : 'idol_final_video';

        const sel = await pool.query(
          `SELECT final_video_url, thumbnail_url FROM ${table} WHERE user_id = $1 AND id = $2`,
          [userId, taskId]
        );
        const row = sel.rows[0];
        if (!row?.final_video_url) continue;

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO content_history (user_id, channel_id, video_url, thumbnail_url, source, aspect_ratio, created_at)
             VALUES ($1, $2, $3, $4, $5, 'portrait', NOW())
             ON CONFLICT (user_id, video_url) DO UPDATE
               SET channel_id = EXCLUDED.channel_id`,
            [userId, targetChannelId, row.final_video_url, row.thumbnail_url || null, sourceLabel]
          );
          await client.query(
            `UPDATE ${table}
             SET final_video_url = NULL, thumbnail_url = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND id = $2`,
            [userId, taskId]
          );
          await client.query('COMMIT');
          moved++;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
        continue;
      }

      // Case 3: viral-img-<n>-<scene>, viral-vid-<n>-<scene>, idol-img-..., idol-vid-...
      m = rawId.match(/^(viral|idol)-(img|vid)-(\d+)-(.+)$/);
      if (m) {
        const family = m[1];
        const kind = m[2];
        const taskId = parseInt(m[3]);
        const scene = m[4];
        const table = family === 'viral' ? 'viral_template_tasks' : 'idol_template_tasks';
        const column = kind === 'img' ? 'image_tasks' : 'video_tasks';
        const urlField = kind === 'img' ? 'image_url' : 'video_url';
        const thumbField = kind === 'img' ? 'image_url' : 'thumbnail_url';
        const sourceLabel =
          family === 'viral'
            ? kind === 'img' ? 'viral_image' : 'viral_scene_video'
            : kind === 'img' ? 'idol_image' : 'idol_scene_video';

        const sel = await pool.query(
          `SELECT
             (SELECT elem->>'${urlField}' FROM jsonb_array_elements(${column}) AS elem WHERE elem->>'scene' = $3 LIMIT 1) AS url,
             (SELECT elem->>'${thumbField}' FROM jsonb_array_elements(${column}) AS elem WHERE elem->>'scene' = $3 LIMIT 1) AS thumb
           FROM ${table}
           WHERE user_id = $1 AND id = $2`,
          [userId, taskId, scene]
        );
        const row = sel.rows[0];
        if (!row?.url) continue;

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO content_history (user_id, channel_id, video_url, thumbnail_url, source, aspect_ratio, created_at)
             VALUES ($1, $2, $3, $4, $5, 'portrait', NOW())
             ON CONFLICT (user_id, video_url) DO UPDATE
               SET channel_id = EXCLUDED.channel_id`,
            [userId, targetChannelId, row.url, row.thumb || null, sourceLabel]
          );
          await client.query(
            `UPDATE ${table}
             SET ${column} = (
               SELECT COALESCE(jsonb_agg(
                 CASE WHEN (elem->>'scene') = $3
                      THEN elem - '${urlField}'
                      ELSE elem END
               ), '[]'::jsonb)
               FROM jsonb_array_elements(${column}) AS elem
             ),
             updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND id = $2`,
            [userId, taskId, scene]
          );
          await client.query('COMMIT');
          moved++;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
        continue;
      }
    }

    return res.json({ success: true, moved });
  } catch (error: any) {
    console.error('[ContentHistory:move] Error:', error.message);
    return res.status(500).json({ error: error.message || 'Move failed' });
  }
});

export default router;
