/**
 * Guide clips (/guide) — the how-to clip grid. Mounted at /api/guide.
 *
 * Reading is public and unauthenticated on purpose: /guide is linked from the
 * Triple Bot desktop app's login screen, where the reader has no session yet.
 * Writing is admin-only.
 *
 * GET /api/guide/clips.json returns the same envelope as the build-time
 * /guide-clips.json asset ({ clips: [...] }), so the desktop app can be pointed
 * at this URL instead and pick up admin edits without a frontend deploy.
 */
import { Router, Response } from 'express';
import pool from '../db.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';

const router = Router();

/** thumbnail_url is exposed as `thumbnail` — the shape clipsData.ts already uses on the FE. */
const CLIP_COLUMNS = `id, title, subtitle, url, thumbnail_url AS thumbnail, links, is_active, display_order`;

const TITLE_MAX = 255;
const URL_MAX = 2048;
/** A card shows these as pill buttons; more than a handful stops fitting under a card. */
const LINKS_MAX = 5;

function trimmed(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** http(s) only — a clip or button URL ends up in an iframe src / href. */
function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Drop anything that is not a usable {label, url} pair rather than failing the whole save. */
function sanitizeLinks(raw: unknown): { label: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      label: trimmed((item as any)?.label, TITLE_MAX),
      url: trimmed((item as any)?.url, URL_MAX),
    }))
    .filter((link) => link.label && isWebUrl(link.url))
    .slice(0, LINKS_MAX);
}

/** Shared body parser for create/update. Returns an error string when unusable. */
function readClipBody(body: any): { error?: string; values?: any } {
  const url = trimmed(body?.url, URL_MAX);
  if (!url) return { error: 'ต้องใส่ลิงก์คลิป' };
  if (!isWebUrl(url)) return { error: 'ลิงก์คลิปต้องขึ้นต้นด้วย http:// หรือ https://' };

  const thumbnail = trimmed(body?.thumbnail ?? body?.thumbnail_url, URL_MAX);
  // A thumbnail may be a site-relative path ('/banner1.jpg') or a full URL.
  if (thumbnail && !isWebUrl(thumbnail) && !thumbnail.startsWith('/')) {
    return { error: 'ลิงก์ภาพปกต้องเป็น URL เต็ม หรือขึ้นต้นด้วย /' };
  }

  return {
    values: {
      title: trimmed(body?.title, TITLE_MAX),
      subtitle: trimmed(body?.subtitle, TITLE_MAX) || null,
      url,
      thumbnail_url: thumbnail || null,
      links: JSON.stringify(sanitizeLinks(body?.links)),
      is_active: body?.is_active !== false,
    },
  };
}

/** Public — clips shown on /guide, active only, in display order. */
router.get('/clips', async (_req, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT ${CLIP_COLUMNS} FROM guide_clips WHERE is_active = true ORDER BY display_order ASC, id ASC`
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[guide] list clips failed:', err?.message);
    res.status(500).json({ error: 'Failed to load guide clips' });
  }
});

/**
 * Public — same envelope as the static /guide-clips.json asset so the desktop
 * app can swap one URL for the other.
 */
router.get('/clips.json', async (_req, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT ${CLIP_COLUMNS} FROM guide_clips WHERE is_active = true ORDER BY display_order ASC, id ASC`
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ clips: result.rows });
  } catch (err: any) {
    console.error('[guide] clips.json failed:', err?.message);
    res.status(500).json({ error: 'Failed to load guide clips' });
  }
});

/** Admin — every clip including hidden ones. */
router.get('/clips/admin/all', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT ${CLIP_COLUMNS}, created_at, updated_at FROM guide_clips ORDER BY display_order ASC, id ASC`
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[guide] admin list failed:', err?.message);
    res.status(500).json({ error: 'Failed to load guide clips' });
  }
});

router.post('/clips', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { error, values } = readClipBody(req.body);
  if (error) return res.status(400).json({ error });

  try {
    // New clips land at the end of the grid unless the caller pins an order.
    const orderRow = await pool.query('SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM guide_clips');
    const displayOrder = Number.isFinite(Number(req.body?.display_order))
      ? Number(req.body.display_order)
      : orderRow.rows[0].next;

    const result = await pool.query(
      `INSERT INTO guide_clips (title, subtitle, url, thumbnail_url, links, is_active, display_order)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING ${CLIP_COLUMNS}`,
      [values.title, values.subtitle, values.url, values.thumbnail_url, values.links, values.is_active, displayOrder]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[guide] create clip failed:', err?.message);
    res.status(500).json({ error: 'Failed to create guide clip' });
  }
});

router.put('/clips/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const { error, values } = readClipBody(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const result = await pool.query(
      `UPDATE guide_clips
          SET title = $1, subtitle = $2, url = $3, thumbnail_url = $4,
              links = $5::jsonb, is_active = $6, updated_at = NOW()
        WHERE id = $7
        RETURNING ${CLIP_COLUMNS}`,
      [values.title, values.subtitle, values.url, values.thumbnail_url, values.links, values.is_active, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Clip not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[guide] update clip failed:', err?.message);
    res.status(500).json({ error: 'Failed to update guide clip' });
  }
});

router.delete('/clips/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const result = await pool.query('DELETE FROM guide_clips WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Clip not found' });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[guide] delete clip failed:', err?.message);
    res.status(500).json({ error: 'Failed to delete guide clip' });
  }
});

/**
 * Admin — persist a new card order. Takes the full id list in the order the
 * admin arranged it; positions are rewritten from the array index so the rows
 * cannot drift into duplicate display_order values.
 */
router.post('/clips/reorder', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ต้องส่งลำดับ id มาด้วย' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE guide_clips SET display_order = $1, updated_at = NOW() WHERE id = $2', [i, ids[i]]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[guide] reorder failed:', err?.message);
    res.status(500).json({ error: 'Failed to reorder guide clips' });
  } finally {
    client.release();
  }
});

export default router;
