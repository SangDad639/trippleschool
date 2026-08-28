/**
 * Ebooks — free downloads under the "Ebook" menu, no login/membership required.
 * Mounted at /api/ebooks.
 *
 * Reading is public (no auth). Writing is admin-only. Cover images and the
 * ebook file itself reuse the courses upload endpoints (/upload-thumbnail,
 * /upload-material) — this router stores only the returned URLs. The actual
 * download goes through the courses materials proxy (/api/courses/materials/*),
 * which is public and forces Content-Disposition: attachment.
 */
import { Router, Response } from 'express';
import pool from '../db.js';
import { authenticate, optionalAuth, requireAdmin, AuthRequest } from '../middleware/auth.js';

const router = Router();

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
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM ebooks WHERE is_active = true ORDER BY display_order ASC, created_at DESC`
    );
    res.json(result.rows);
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
    res.json(ebook);
  } catch (error) {
    console.error('Error fetching ebook:', error);
    res.status(500).json({ error: 'โหลด Ebook ไม่สำเร็จ' });
  }
});

// ============ Admin: create ============
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, cover_url, file_url, file_name, is_active, display_order } = req.body;
    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'กรุณาใส่ชื่อ Ebook' });
    const slug = sanitizeSlug(req.body.slug) || sanitizeSlug(title);
    if (!slug) return res.status(400).json({ error: 'สร้าง slug จากชื่อไม่ได้ — กรุณากำหนด slug เอง (a-z, 0-9, -)' });
    const result = await pool.query(
      `INSERT INTO ebooks (title, slug, description, cover_url, file_url, file_name, is_active, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        title.trim(),
        slug,
        typeof description === 'string' && description ? description : null,
        typeof cover_url === 'string' && cover_url ? cover_url : null,
        typeof file_url === 'string' && file_url ? file_url : null,
        typeof file_name === 'string' && file_name ? file_name : null,
        typeof is_active === 'boolean' ? is_active : true,
        Number.isInteger(display_order) ? display_order : 0,
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
    const { title, description, cover_url, file_url, file_name, is_active, display_order } = req.body;
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
