/**
 * Articles (บทความ) — free-to-read content under the "Content" menu.
 * Mounted at /api/articles.
 *
 * Reading is public (no auth). Writing is admin-only. Cover images and big
 * HTML bodies reuse the courses upload endpoints (/upload-thumbnail,
 * /upload-html) — this router stores only the returned URLs.
 */
import { Router, Response } from 'express';
import pool from '../db.js';
import { authenticate, optionalAuth, requireAdmin, AuthRequest } from '../middleware/auth.js';

const router = Router();

/**
 * Pasted HTML goes into the DB row, so cap it — one course once ballooned to
 * 66MB of inline base64 images and every page that touched the column paid for
 * it. Bigger bodies belong on S3 via the upload-html flow (content_url).
 */
const CONTENT_HTML_MAX = 2 * 1024 * 1024;

/** List payloads: metadata only — content columns must never cross the wire here. */
const LIST_COLUMNS = `id, title, slug, excerpt, cover_url, is_active, display_order, created_at, updated_at`;

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

function contentTooBig(html: unknown): boolean {
  return typeof html === 'string' && html.length > CONTENT_HTML_MAX;
}

// ============ Admin: list all (incl. inactive) ============
// NOTE: named routes must be registered before /:slug.
router.get('/admin/all', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT ${LIST_COLUMNS}, COALESCE(LENGTH(content_html), 0) AS content_chars,
              (content_url IS NOT NULL AND content_url <> '') AS has_content_file
       FROM articles ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin articles:', error);
    res.status(500).json({ error: 'โหลดบทความไม่สำเร็จ' });
  }
});

// ============ Public: list active articles (metadata only) ============
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${LIST_COLUMNS} FROM articles WHERE is_active = true
       ORDER BY display_order ASC, created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ error: 'โหลดบทความไม่สำเร็จ' });
  }
});

// ============ Public: one article with its body ============
// Admins may open inactive articles (preview before publishing).
router.get('/:slug', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM articles WHERE slug = $1`, [req.params.slug]);
    const article = result.rows[0];
    if (!article || (!article.is_active && !req.isAdmin)) {
      return res.status(404).json({ error: 'ไม่พบบทความ' });
    }
    res.json(article);
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({ error: 'โหลดบทความไม่สำเร็จ' });
  }
});

// ============ Admin: create ============
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { title, excerpt, cover_url, content_html, content_url, is_active, display_order } = req.body;
    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'กรุณาใส่ชื่อบทความ' });
    const slug = sanitizeSlug(req.body.slug) || sanitizeSlug(title);
    if (!slug) return res.status(400).json({ error: 'สร้าง slug จากชื่อไม่ได้ — กรุณากำหนด slug เอง (a-z, 0-9, -)' });
    if (contentTooBig(content_html)) {
      return res.status(400).json({ error: 'เนื้อหาที่วางใหญ่เกิน 2MB — กรุณาอัปโหลดเป็นไฟล์ HTML แทน' });
    }
    const result = await pool.query(
      `INSERT INTO articles (title, slug, excerpt, cover_url, content_html, content_url, is_active, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        title.trim(),
        slug,
        typeof excerpt === 'string' ? excerpt : null,
        typeof cover_url === 'string' && cover_url ? cover_url : null,
        typeof content_html === 'string' && content_html ? content_html : null,
        typeof content_url === 'string' && content_url ? content_url : null,
        typeof is_active === 'boolean' ? is_active : true,
        Number.isInteger(display_order) ? display_order : 0,
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    if ((error as any).code === '23505') return res.status(400).json({ error: 'slug นี้ถูกใช้แล้ว — เปลี่ยน slug ใหม่' });
    console.error('Error creating article:', error);
    res.status(500).json({ error: 'สร้างบทความไม่สำเร็จ' });
  }
});

// ============ Admin: update ============
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad article id' });
    const { title, excerpt, cover_url, content_html, content_url, is_active, display_order } = req.body;
    if (contentTooBig(content_html)) {
      return res.status(400).json({ error: 'เนื้อหาที่วางใหญ่เกิน 2MB — กรุณาอัปโหลดเป็นไฟล์ HTML แทน' });
    }
    const slug = req.body.slug !== undefined ? sanitizeSlug(req.body.slug) : undefined;
    if (slug === '') return res.status(400).json({ error: 'slug ไม่ถูกต้อง (a-z, 0-9, -)' });
    // COALESCE keeps unspecified fields; cover/content columns accept explicit
    // clearing by sending '' (stored as NULL) so the admin can remove them.
    const nullable = (v: unknown) => (v === undefined ? undefined : typeof v === 'string' && v === '' ? null : v);
    const sets: string[] = [];
    const params: any[] = [];
    const add = (col: string, value: unknown, coalesce = false) => {
      if (value === undefined) return;
      params.push(value);
      sets.push(coalesce ? `${col} = COALESCE($${params.length}, ${col})` : `${col} = $${params.length}`);
    };
    add('title', typeof title === 'string' && title.trim() ? title.trim() : undefined);
    add('slug', slug);
    add('excerpt', nullable(excerpt));
    add('cover_url', nullable(cover_url));
    add('content_html', nullable(content_html));
    add('content_url', nullable(content_url));
    add('is_active', typeof is_active === 'boolean' ? is_active : undefined);
    add('display_order', Number.isInteger(display_order) ? display_order : undefined);
    if (sets.length === 0) return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' });
    params.push(id);
    const result = await pool.query(
      `UPDATE articles SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบบทความ' });
    res.json(result.rows[0]);
  } catch (error) {
    if ((error as any).code === '23505') return res.status(400).json({ error: 'slug นี้ถูกใช้แล้ว — เปลี่ยน slug ใหม่' });
    console.error('Error updating article:', error);
    res.status(500).json({ error: 'แก้ไขบทความไม่สำเร็จ' });
  }
});

// ============ Admin: delete ============
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad article id' });
    const result = await pool.query(`DELETE FROM articles WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบบทความ' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting article:', error);
    res.status(500).json({ error: 'ลบบทความไม่สำเร็จ' });
  }
});

export default router;
