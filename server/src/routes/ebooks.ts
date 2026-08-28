/**
 * Ebooks — free downloads under the "Ebook" menu. Each ebook is public by
 * default (no login/membership required), but an admin can flip either:
 *   - allow_download: false → view-only, no attachment download
 *   - members_only: true    → must be logged in with an active subscription
 *
 * List/detail responses never include the raw file_url/file_name to the
 * public — only /:slug/file streams bytes, re-checking both flags on every
 * request (a stored URL alone must never be enough to get the file; see the
 * gated route below). Cover images and the ebook file itself are uploaded
 * via the existing courses endpoints (/upload-thumbnail, /upload-material);
 * this router only stores the returned pointer and re-serves it itself.
 */
import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { authenticate, optionalAuth, optionalAuthQueryOrHeader, requireAdmin, JWT_SECRET, AuthRequest } from '../middleware/auth.js';
import { hasActiveSubscription } from '../services/stripeService.js';
import { getFile } from '../utils/s3.js';

const router = Router();
const EBOOK_FILE_TOKEN_PURPOSE = 'ebook-file';

/**
 * Short-lived (10min), single-ebook-scoped token for members_only files.
 * Deliberately NOT the user's normal session JWT: that token is long-lived
 * (7d) and grants full account access, so embedding it in a plain <a>/<iframe>
 * URL would leak it into browser download history for every ebook — even
 * free ones. This token can only ever be used to fetch one specific ebook's
 * file, and only after hasActiveSubscription was already re-checked at mint
 * time (see /:slug/access-token below).
 */
function verifyEbookFileToken(token: string, slug: string): boolean {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { purpose?: string; slug?: string };
    return decoded.purpose === EBOOK_FILE_TOKEN_PURPOSE && decoded.slug === slug;
  } catch {
    return false;
  }
}

const MATERIALS_PREFIX = '/api/courses/materials/';

function sanitizeSlug(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9฀-๿-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

/** Extracts the S3 key from a stored courses-materials proxy URL. */
function materialsKey(fileUrl: unknown): string | null {
  if (typeof fileUrl !== 'string' || !fileUrl.startsWith(MATERIALS_PREFIX)) return null;
  return fileUrl.slice(MATERIALS_PREFIX.length);
}

function isPdfFile(row: { file_name: string | null; file_url: string | null }): boolean {
  return (row.file_name || row.file_url || '').toLowerCase().endsWith('.pdf');
}

/** Admins always qualify; non-members_only ebooks need no check. */
async function computeEntitled(req: AuthRequest, membersOnly: boolean): Promise<boolean> {
  if (!membersOnly || req.isAdmin) return true;
  if (!req.userId) return false;
  return hasActiveSubscription(req.userId);
}

/** Public-facing row: strips the raw file pointer, adds viewer-relative flags. */
function publicRow(row: any, entitled: boolean) {
  const { file_url, file_name, ...rest } = row;
  return { ...rest, has_file: !!file_url, is_pdf: isPdfFile(row), entitled };
}

// ============ Admin: list all (incl. inactive) ============
// NOTE: named routes must be registered before /:slug.
router.get('/admin/all', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM ebooks ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin ebooks:', error);
    res.status(500).json({ error: 'โหลด Ebook ไม่สำเร็จ' });
  }
});

// ============ Public: list active ebooks ============
router.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM ebooks WHERE is_active = true ORDER BY display_order ASC, created_at DESC`
    );
    const rows = await Promise.all(
      result.rows.map(async (row) => publicRow(row, await computeEntitled(req, row.members_only)))
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching ebooks:', error);
    res.status(500).json({ error: 'โหลด Ebook ไม่สำเร็จ' });
  }
});

// ============ Public: one ebook ============
// Admins may open inactive ebooks (preview before publishing).
router.get('/:slug', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM ebooks WHERE slug = $1`, [req.params.slug]);
    const ebook = result.rows[0];
    if (!ebook || (!ebook.is_active && !req.isAdmin)) {
      return res.status(404).json({ error: 'ไม่พบ Ebook' });
    }
    const entitled = await computeEntitled(req, ebook.members_only);
    res.json(publicRow(ebook, entitled));
  } catch (error) {
    console.error('Error fetching ebook:', error);
    res.status(500).json({ error: 'โหลด Ebook ไม่สำเร็จ' });
  }
});

// ============ Public (gated): stream the file itself ============
// The only door to the actual bytes — re-validates members_only and
// allow_download on every request, so a previously-seen URL is never enough
// on its own (unlike the generic /api/courses/materials/* proxy, which is
// intentionally dumb/always-public). ?token= lets a plain <a>/<iframe>
// navigation (which can't set an Authorization header) still prove who's
// logged in when the ebook is members_only.
router.get('/:slug/file', optionalAuthQueryOrHeader, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM ebooks WHERE slug = $1`, [req.params.slug]);
    const ebook = result.rows[0];
    if (!ebook || (!ebook.is_active && !req.isAdmin)) {
      return res.status(404).json({ error: 'ไม่พบ Ebook' });
    }
    const key = materialsKey(ebook.file_url);
    if (!key) return res.status(404).json({ error: 'ยังไม่มีไฟล์' });

    const mode = req.query.mode === 'view' ? 'view' : 'download';
    if (mode === 'download' && !ebook.allow_download) {
      return res.status(403).json({ error: 'Ebook นี้เปิดให้อ่านอย่างเดียว ดาวน์โหลดไม่ได้' });
    }
    if (ebook.members_only && !req.isAdmin) {
      const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
      const scopedTokenOk = queryToken ? verifyEbookFileToken(queryToken, ebook.slug) : false;
      if (!scopedTokenOk) {
        // Fall back to the normal session (covers an admin/logged-in member
        // browsing the API directly without going through the minted-token flow).
        if (!req.userId) {
          return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน', code: 'AUTH_REQUIRED' });
        }
        const active = await hasActiveSubscription(req.userId);
        if (!active) {
          return res.status(403).json({ error: 'Ebook นี้สำหรับสมาชิกเท่านั้น', code: 'MEMBERS_ONLY', subscriptionUrl: '/pricing' });
        }
      }
    }

    const obj = await getFile(key);
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    const dispositionType = mode === 'view' ? 'inline' : 'attachment';
    const name = typeof ebook.file_name === 'string' && ebook.file_name ? ebook.file_name : '';
    res.setHeader(
      'Content-Disposition',
      name ? `${dispositionType}; filename*=UTF-8''${encodeURIComponent(name)}` : dispositionType
    );
    // Access is re-checked per request (membership can expire) — never cache.
    res.setHeader('Cache-Control', 'private, no-store');
    (obj.Body as any).pipe(res);
  } catch (error) {
    console.error('Error streaming ebook file:', error);
    res.status(500).json({ error: 'โหลดไฟล์ไม่สำเร็จ' });
  }
});

// ============ Mint a scoped file token for a members_only ebook ============
// Requires a real session (Authorization header) — re-checks the subscription
// right now, then issues the short-lived single-ebook token /:slug/file
// accepts, so a plain <a>/<iframe> link never needs the long-lived session JWT.
router.get('/:slug/access-token', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM ebooks WHERE slug = $1`, [req.params.slug]);
    const ebook = result.rows[0];
    if (!ebook || (!ebook.is_active && !req.isAdmin)) {
      return res.status(404).json({ error: 'ไม่พบ Ebook' });
    }
    if (!ebook.members_only) {
      return res.status(400).json({ error: 'Ebook นี้ไม่ต้องขอสิทธิ์เข้าถึง' });
    }
    if (!req.isAdmin) {
      const active = await hasActiveSubscription(req.userId!);
      if (!active) {
        return res.status(403).json({ error: 'Ebook นี้สำหรับสมาชิกเท่านั้น', code: 'MEMBERS_ONLY', subscriptionUrl: '/pricing' });
      }
    }
    const token = jwt.sign({ purpose: EBOOK_FILE_TOKEN_PURPOSE, slug: ebook.slug }, JWT_SECRET, { expiresIn: '10m' });
    res.json({ token });
  } catch (error) {
    console.error('Error minting ebook access token:', error);
    res.status(500).json({ error: 'ขอสิทธิ์เข้าถึงไม่สำเร็จ' });
  }
});

// ============ Admin: create ============
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, cover_url, file_url, file_name, is_active, display_order, allow_download, members_only } = req.body;
    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'กรุณาใส่ชื่อ Ebook' });
    const slug = sanitizeSlug(req.body.slug) || sanitizeSlug(title);
    if (!slug) return res.status(400).json({ error: 'สร้าง slug จากชื่อไม่ได้ — กรุณากำหนด slug เอง (a-z, 0-9, -)' });
    const result = await pool.query(
      `INSERT INTO ebooks (title, slug, description, cover_url, file_url, file_name, is_active, display_order, allow_download, members_only)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        title.trim(),
        slug,
        typeof description === 'string' && description ? description : null,
        typeof cover_url === 'string' && cover_url ? cover_url : null,
        typeof file_url === 'string' && file_url ? file_url : null,
        typeof file_name === 'string' && file_name ? file_name : null,
        typeof is_active === 'boolean' ? is_active : true,
        Number.isInteger(display_order) ? display_order : 0,
        typeof allow_download === 'boolean' ? allow_download : true,
        typeof members_only === 'boolean' ? members_only : false,
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    if ((error as any).code === '23505') return res.status(400).json({ error: 'slug นี้ถูกใช้แล้ว — เปลี่ยน slug ใหม่' });
    console.error('Error creating ebook:', error);
    res.status(500).json({ error: 'สร้าง Ebook ไม่สำเร็จ' });
  }
});

// ============ Admin: update ============
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad ebook id' });
    const { title, description, cover_url, file_url, file_name, is_active, display_order, allow_download, members_only } = req.body;
    const slug = req.body.slug !== undefined ? sanitizeSlug(req.body.slug) : undefined;
    if (slug === '') return res.status(400).json({ error: 'slug ไม่ถูกต้อง (a-z, 0-9, -)' });
    // Unspecified fields stay untouched; sending '' explicitly clears a nullable field.
    const nullable = (v: unknown) => (v === undefined ? undefined : typeof v === 'string' && v === '' ? null : v);
    const sets: string[] = [];
    const params: any[] = [];
    const add = (col: string, value: unknown) => {
      if (value === undefined) return;
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };
    add('title', typeof title === 'string' && title.trim() ? title.trim() : undefined);
    add('slug', slug);
    add('description', nullable(description));
    add('cover_url', nullable(cover_url));
    add('file_url', nullable(file_url));
    add('file_name', nullable(file_name));
    add('is_active', typeof is_active === 'boolean' ? is_active : undefined);
    add('display_order', Number.isInteger(display_order) ? display_order : undefined);
    add('allow_download', typeof allow_download === 'boolean' ? allow_download : undefined);
    add('members_only', typeof members_only === 'boolean' ? members_only : undefined);
    if (sets.length === 0) return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' });
    params.push(id);
    const result = await pool.query(
      `UPDATE ebooks SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบ Ebook' });
    res.json(result.rows[0]);
  } catch (error) {
    if ((error as any).code === '23505') return res.status(400).json({ error: 'slug นี้ถูกใช้แล้ว — เปลี่ยน slug ใหม่' });
    console.error('Error updating ebook:', error);
    res.status(500).json({ error: 'แก้ไข Ebook ไม่สำเร็จ' });
  }
});

// ============ Admin: delete ============
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad ebook id' });
    const result = await pool.query(`DELETE FROM ebooks WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบ Ebook' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting ebook:', error);
    res.status(500).json({ error: 'ลบ Ebook ไม่สำเร็จ' });
  }
});

export default router;
