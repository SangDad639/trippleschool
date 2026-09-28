/**
 * Program tutorial clips (/programs/:slug). Mounted at /api/programs.
 *
 * The programs themselves (name, features, download buttons) stay hardcoded in
 * src/components/programs/programsData.ts; only the clips are admin-managed, so
 * a new clip goes live without a frontend deploy. Rows are keyed by slug.
 *
 * Reading is public — the detail page is open to visitors who are not logged in.
 * Writing is admin-only.
 */
import { Router, Response } from 'express';
import type { PoolClient } from 'pg';
import pool from '../db.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { isProgramSlug, parseVideoId, readProgramVideoBody, PROGRAM_VIDEOS_MAX } from '../utils/programVideos.js';

const router = Router();

const VIDEO_COLUMNS = `id, program_slug, title, url, is_active, display_order`;

/** Public — active clips for one program, in display order. */
router.get('/:slug/videos', async (req, res: Response) => {
  const { slug } = req.params;
  if (!isProgramSlug(slug)) return res.status(400).json({ error: 'Invalid program' });

  try {
    const result = await pool.query(
      `SELECT ${VIDEO_COLUMNS} FROM program_videos
        WHERE program_slug = $1 AND is_active = true
        ORDER BY display_order ASC, id ASC`,
      [slug]
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[programs] list videos failed:', err?.message);
    res.status(500).json({ error: 'Failed to load program videos' });
  }
});

/** Admin — every clip of one program, hidden ones included. */
router.get('/:slug/videos/admin', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { slug } = req.params;
  if (!isProgramSlug(slug)) return res.status(400).json({ error: 'Invalid program' });

  try {
    const result = await pool.query(
      `SELECT ${VIDEO_COLUMNS}, created_at, updated_at FROM program_videos
        WHERE program_slug = $1
        ORDER BY display_order ASC, id ASC`,
      [slug]
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[programs] admin list videos failed:', err?.message);
    res.status(500).json({ error: 'Failed to load program videos' });
  }
});

router.post('/:slug/videos', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { slug } = req.params;
  if (!isProgramSlug(slug)) return res.status(400).json({ error: 'Invalid program' });

  const { error, values } = readProgramVideoBody(req.body);
  if (error || !values) return res.status(400).json({ error });

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialise creates per program: without it, two saves at once both pass the
    // cap check and land on the same display_order.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`program_videos:${slug}`]);
    const stats = await client.query(
      `SELECT COUNT(*)::int AS count, COALESCE(MAX(display_order), -1) + 1 AS next
         FROM program_videos WHERE program_slug = $1`,
      [slug]
    );
    if (stats.rows[0].count >= PROGRAM_VIDEOS_MAX) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `ใส่คลิปได้สูงสุด ${PROGRAM_VIDEOS_MAX} คลิปต่อโปรแกรม` });
    }

    // New clips land at the end of the list.
    const result = await client.query(
      `INSERT INTO program_videos (program_slug, title, url, is_active, display_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${VIDEO_COLUMNS}`,
      [slug, values.title, values.url, values.is_active, stats.rows[0].next]
    );
    await client.query('COMMIT');
    console.log(`[AUDIT] program video ${result.rows[0].id} created for ${slug} by user ${req.userId}`);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    await client?.query('ROLLBACK').catch(() => undefined);
    console.error('[programs] create video failed:', err?.message);
    res.status(500).json({ error: 'Failed to create program video' });
  } finally {
    client?.release();
  }
});

router.put('/videos/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = parseVideoId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid id' });

  const { error, values } = readProgramVideoBody(req.body);
  if (error || !values) return res.status(400).json({ error });

  try {
    const result = await pool.query(
      `UPDATE program_videos
          SET title = $1, url = $2, is_active = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING ${VIDEO_COLUMNS}`,
      [values.title, values.url, values.is_active, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Video not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[programs] update video failed:', err?.message);
    res.status(500).json({ error: 'Failed to update program video' });
  }
});

router.delete('/videos/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = parseVideoId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid id' });

  try {
    const result = await pool.query('DELETE FROM program_videos WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Video not found' });
    console.log(`[AUDIT] program video ${id} deleted by user ${req.userId}`);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[programs] delete video failed:', err?.message);
    res.status(500).json({ error: 'Failed to delete program video' });
  }
});

/**
 * Admin — persist a new clip order for one program. Takes the full id list in
 * display order; positions are rewritten from the array index. Scoped to the
 * slug so a stray id from another program is never touched.
 */
router.post('/:slug/videos/reorder', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { slug } = req.params;
  if (!isProgramSlug(slug)) return res.status(400).json({ error: 'Invalid program' });

  const rawIds: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (rawIds.length === 0) return res.status(400).json({ error: 'ต้องส่งลำดับ id มาด้วย' });
  // One bad id rejects the whole list — dropping it would silently shift every position after it.
  const ids = rawIds.map(parseVideoId);
  if (ids.some((id) => id === null)) return res.status(400).json({ error: 'ลำดับ id ไม่ถูกต้อง' });

  let client: PoolClient | undefined;
  try {
    // connect() inside try: a rejected connect in an async Express 4 handler is
    // an unhandled rejection, which kills the whole API process.
    client = await pool.connect();
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        'UPDATE program_videos SET display_order = $1, updated_at = NOW() WHERE id = $2 AND program_slug = $3',
        [i, ids[i], slug]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err: any) {
    // ROLLBACK can fail on a dead connection too — it must not throw out of the handler.
    await client?.query('ROLLBACK').catch(() => undefined);
    console.error('[programs] reorder failed:', err?.message);
    res.status(500).json({ error: 'Failed to reorder program videos' });
  } finally {
    client?.release();
  }
});

export default router;
