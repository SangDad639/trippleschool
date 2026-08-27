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
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import pool from '../db.js';
import { uploadFile } from '../utils/s3.js';
import { makeThumbnailVariant, variantKey } from '../utils/imageResize.js';
import { authenticate, requireAdmin, requireGuideAdmin, AuthRequest } from '../middleware/auth.js';

const router = Router();

/** thumbnail_url is exposed as `thumbnail` — the shape clipsData.ts already uses on the FE. */
const CLIP_COLUMNS = `id, group_id, title, subtitle, url, thumbnail_url AS thumbnail, links, is_active, display_order`;

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
      group_id: Number.isInteger(Number(body?.group_id)) ? Number(body.group_id) : null,
    },
  };
}

/** Public — clips shown on /guide, active only, in display order. */
router.get('/clips', async (req, res: Response) => {
  const groupId = Number(req.query.group_id);
  try {
    const result = Number.isInteger(groupId)
      ? await pool.query(
          `SELECT ${CLIP_COLUMNS} FROM guide_clips WHERE is_active = true AND group_id = $1 ORDER BY display_order ASC, id ASC`,
          [groupId]
        )
      : await pool.query(
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
router.get('/clips/admin/all', authenticate, requireGuideAdmin, async (req: AuthRequest, res: Response) => {
  const groupId = Number(req.query.group_id);
  try {
    const result = Number.isInteger(groupId)
      ? await pool.query(
          `SELECT ${CLIP_COLUMNS}, created_at, updated_at FROM guide_clips WHERE group_id = $1 ORDER BY display_order ASC, id ASC`,
          [groupId]
        )
      : await pool.query(
      `SELECT ${CLIP_COLUMNS}, created_at, updated_at FROM guide_clips ORDER BY display_order ASC, id ASC`
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[guide] admin list failed:', err?.message);
    res.status(500).json({ error: 'Failed to load guide clips' });
  }
});

router.post('/clips', authenticate, requireGuideAdmin, async (req: AuthRequest, res: Response) => {
  const { error, values } = readClipBody(req.body);
  if (error) return res.status(400).json({ error });

  try {
    // New clips land at the end of the grid unless the caller pins an order.
    const orderRow = values.group_id
      ? await pool.query('SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM guide_clips WHERE group_id = $1', [values.group_id])
      : await pool.query('SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM guide_clips');
    const displayOrder = Number.isFinite(Number(req.body?.display_order))
      ? Number(req.body.display_order)
      : orderRow.rows[0].next;

    const result = await pool.query(
      `INSERT INTO guide_clips (title, subtitle, url, thumbnail_url, links, is_active, display_order, group_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING ${CLIP_COLUMNS}`,
      [values.title, values.subtitle, values.url, values.thumbnail_url, values.links, values.is_active, displayOrder, values.group_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[guide] create clip failed:', err?.message);
    res.status(500).json({ error: 'Failed to create guide clip' });
  }
});

router.put('/clips/:id', authenticate, requireGuideAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const { error, values } = readClipBody(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const result = await pool.query(
      `UPDATE guide_clips
          SET title = $1, subtitle = $2, url = $3, thumbnail_url = $4,
              links = $5::jsonb, is_active = $6,
              group_id = COALESCE($7, group_id), updated_at = NOW()
        WHERE id = $8
        RETURNING ${CLIP_COLUMNS}`,
      [values.title, values.subtitle, values.url, values.thumbnail_url, values.links, values.is_active, values.group_id, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Clip not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[guide] update clip failed:', err?.message);
    res.status(500).json({ error: 'Failed to update guide clip' });
  }
});

router.delete('/clips/:id', authenticate, requireGuideAdmin, async (req: AuthRequest, res: Response) => {
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
router.post('/clips/reorder', authenticate, requireGuideAdmin, async (req: AuthRequest, res: Response) => {
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

// ── อัปโหลดภาพปก ────────────────────────────────────────────────────────────
// คู่มือใช้ท่อเดียวกับปกคอร์ส (S3 + variant card/hero + เสิร์ฟผ่าน proxy สาธารณะ
// /api/courses/thumbnails/*) แต่ต้องมี endpoint ของตัวเอง เพราะของคอร์สบังคับ
// req.isAdmin — ผู้ดูแลคู่มือจะอัปโหลดไม่ได้
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

router.post(
  '/upload-image',
  authenticate,
  requireGuideAdmin,
  imageUpload.single('image'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const rand = Math.random().toString(36).slice(2, 10);
      const key = `course-thumb/${Date.now()}-${rand}.${ext}`;
      await uploadFile(req.file.buffer, key, req.file.mimetype, { contentDisposition: 'inline' });

      // ย่อไว้ล่วงหน้าเหมือนปกคอร์ส — ถ้าย่อไม่สำเร็จ proxy จะ fallback เป็นไฟล์เดิม
      for (const v of ['card', 'hero'] as const) {
        try {
          const out = await makeThumbnailVariant(req.file.buffer, v);
          if (out) await uploadFile(out, variantKey(key, v), 'image/webp', { contentDisposition: 'inline' });
        } catch (e) {
          console.error(`[guide] ${v} variant failed:`, e);
        }
      }
      res.json({ url: `/api/courses/thumbnails/${key}` });
    } catch (err: any) {
      console.error('[guide] upload image failed:', err?.message);
      res.status(500).json({ error: 'อัปโหลดภาพไม่สำเร็จ' });
    }
  }
);

// ── กลุ่มคู่มือ (guide groups) ──────────────────────────────────────────────
// โครงเดียวกับคอร์ส: กลุ่ม = คอร์ส, คลิปข้างใน = บทเรียน
const GROUP_COLUMNS = `id, title, slug, description, cover_url, is_active, display_order`;

/** slug ไทย/อังกฤษ/ตัวเลข — ตรงกับ sanitizeSlug ของบทความ */
function toSlug(raw: unknown, fallback: string): string {
  const base = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9฀-๿-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
  return base || fallback;
}

/** Public — groups shown on /guide, with the number of clips inside each. */
router.get('/groups', async (_req, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.title, g.slug, g.description, g.cover_url, g.is_active, g.display_order,
              COUNT(c.id) FILTER (WHERE c.is_active) AS clip_count
         FROM guide_groups g
         LEFT JOIN guide_clips c ON c.group_id = g.id
        WHERE g.is_active = true
        GROUP BY g.id
        ORDER BY g.display_order ASC, g.id ASC`
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[guide] list groups failed:', err?.message);
    res.status(500).json({ error: 'Failed to load guide groups' });
  }
});

/** Public — one group plus its clips, the /guide/:slug page in a single round trip. */
router.get('/groups/:slug', async (req, res: Response) => {
  try {
    const groupRes = await pool.query(
      `SELECT ${GROUP_COLUMNS} FROM guide_groups WHERE slug = $1 AND is_active = true`,
      [req.params.slug]
    );
    if (groupRes.rows.length === 0) return res.status(404).json({ error: 'Group not found' });

    const clipsRes = await pool.query(
      `SELECT ${CLIP_COLUMNS} FROM guide_clips
        WHERE group_id = $1 AND is_active = true
        ORDER BY display_order ASC, id ASC`,
      [groupRes.rows[0].id]
    );
    res.json({ ...groupRes.rows[0], clips: clipsRes.rows });
  } catch (err: any) {
    console.error('[guide] group detail failed:', err?.message);
    res.status(500).json({ error: 'Failed to load guide group' });
  }
});

router.get('/groups/admin/all', authenticate, requireGuideAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.title, g.slug, g.description, g.cover_url, g.is_active, g.display_order,
              COUNT(c.id) AS clip_count
         FROM guide_groups g
         LEFT JOIN guide_clips c ON c.group_id = g.id
        GROUP BY g.id
        ORDER BY g.display_order ASC, g.id ASC`
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[guide] admin groups failed:', err?.message);
    res.status(500).json({ error: 'Failed to load guide groups' });
  }
});

router.post('/groups', authenticate, requireGuideAdmin, async (req: AuthRequest, res: Response) => {
  const title = trimmed(req.body?.title, TITLE_MAX);
  if (!title) return res.status(400).json({ error: 'ต้องใส่ชื่อกลุ่ม' });

  try {
    const orderRow = await pool.query('SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM guide_groups');
    // Slug must stay unique: fall back to the row order, then let a collision retry once.
    let slug = toSlug(req.body?.slug || title, `group-${orderRow.rows[0].next}`);
    const clash = await pool.query('SELECT 1 FROM guide_groups WHERE slug = $1', [slug]);
    if (clash.rowCount) slug = `${slug}-${orderRow.rows[0].next}`;

    const result = await pool.query(
      `INSERT INTO guide_groups (title, slug, description, cover_url, is_active, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${GROUP_COLUMNS}`,
      [
        title,
        slug,
        trimmed(req.body?.description, 2000) || null,
        trimmed(req.body?.cover_url, URL_MAX) || null,
        req.body?.is_active !== false,
        orderRow.rows[0].next,
      ]
    );
    res.status(201).json({ ...result.rows[0], clip_count: 0 });
  } catch (err: any) {
    console.error('[guide] create group failed:', err?.message);
    res.status(500).json({ error: 'Failed to create guide group' });
  }
});

router.put('/groups/:id', authenticate, requireGuideAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const title = trimmed(req.body?.title, TITLE_MAX);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!title) return res.status(400).json({ error: 'ต้องใส่ชื่อกลุ่ม' });

  try {
    const result = await pool.query(
      `UPDATE guide_groups
          SET title = $1, description = $2, cover_url = $3, is_active = $4, updated_at = NOW()
        WHERE id = $5
        RETURNING ${GROUP_COLUMNS}`,
      [
        title,
        trimmed(req.body?.description, 2000) || null,
        trimmed(req.body?.cover_url, URL_MAX) || null,
        req.body?.is_active !== false,
        id,
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Group not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[guide] update group failed:', err?.message);
    res.status(500).json({ error: 'Failed to update guide group' });
  }
});

/** Deleting a group takes its clips with it (FK ON DELETE CASCADE) — the UI warns first. */
router.delete('/groups/:id', authenticate, requireGuideAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const result = await pool.query('DELETE FROM guide_groups WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Group not found' });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[guide] delete group failed:', err?.message);
    res.status(500).json({ error: 'Failed to delete guide group' });
  }
});

router.post('/groups/reorder', authenticate, requireGuideAdmin, async (req: AuthRequest, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ต้องส่งลำดับ id มาด้วย' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE guide_groups SET display_order = $1, updated_at = NOW() WHERE id = $2', [i, ids[i]]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[guide] reorder groups failed:', err?.message);
    res.status(500).json({ error: 'Failed to reorder guide groups' });
  } finally {
    client.release();
  }
});

// ── ผู้ดูแลคู่มือ (guide admins) ────────────────────────────────────────────
// จัดการโดยแอดมินเต็มเท่านั้น — ผู้ดูแลคู่มือแต่งตั้งกันเองไม่ได้
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

/** เลขอ้างอิงผู้แนะนำ — คอลัมน์นี้ unique ทุกบัญชีต้องมี */
const generateRefcode = () => crypto.randomUUID().slice(0, 8).toLowerCase();

router.get('/admins', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, email, join_date, COALESCE(is_admin, false) AS is_admin
         FROM users
        WHERE COALESCE(is_guide_admin, false) = true
        ORDER BY email ASC`
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[guide] list admins failed:', err?.message);
    res.status(500).json({ error: 'Failed to load guide admins' });
  }
});

/**
 * Grant the guide-admin flag. An existing account is flagged in place; an unknown
 * email creates a fresh member account, which is why a password is required then.
 * The flag lives in the JWT, so the account picks it up at its next sign-in.
 */
router.post('/admins', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);

    if (existing.rows.length > 0) {
      const result = await pool.query(
        `UPDATE users SET is_guide_admin = true WHERE id = $1 RETURNING id, email, join_date, COALESCE(is_admin, false) AS is_admin`,
        [existing.rows[0].id]
      );
      return res.json({ ...result.rows[0], created: false });
    }

    if (password.length < PASSWORD_MIN) {
      return res.status(400).json({ error: `บัญชีใหม่ต้องตั้งรหัสผ่านอย่างน้อย ${PASSWORD_MIN} ตัวอักษร` });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, credits, is_approved, refcode, is_guide_admin)
       VALUES ($1, $2, 0, true, $3, true)
       RETURNING id, email, join_date, COALESCE(is_admin, false) AS is_admin`,
      [email, passwordHash, generateRefcode()]
    );
    res.status(201).json({ ...result.rows[0], created: true });
  } catch (err: any) {
    console.error('[guide] grant admin failed:', err?.message);
    res.status(500).json({ error: 'Failed to grant guide admin' });
  }
});

/** Revoke the flag only — the account itself stays, as an ordinary member. */
router.delete('/admins/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const result = await pool.query('UPDATE users SET is_guide_admin = false WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[guide] revoke admin failed:', err?.message);
    res.status(500).json({ error: 'Failed to revoke guide admin' });
  }
});

/** Reset a guide admin's password — there is no self-serve reset in the app. */
router.post('/admins/:id/password', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const password = String(req.body?.password || '');
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  if (password.length < PASSWORD_MIN) {
    return res.status(400).json({ error: `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN} ตัวอักษร` });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 AND COALESCE(is_guide_admin, false) = true',
      [passwordHash, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Guide admin not found' });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[guide] reset password failed:', err?.message);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

export default router;
