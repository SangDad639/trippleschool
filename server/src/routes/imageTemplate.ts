/**
 * Image Template — admin-managed templates with custom variables.
 * Each template has a prompt_template (with {{variable}} placeholders) and a
 * template_variables array describing what fields the user fills in:
 *   [{ name, label_th, label_en, type: 'text'|'textarea'|'image', default_value, placeholder, order, required }]
 */

import express, { Response } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { authenticate, AuthRequest, requireAdmin } from '../middleware/auth.js';
import { extractS3Key, resolveS3Value, uploadFile, getSignedFileUrl, deleteFile } from '../utils/s3.js';

// Multer for in-memory image uploads (gallery)
const galleryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Only image files allowed'));
    cb(null, true);
  },
});

const router = express.Router();

/**
 * Parse `prompt_template` and auto-extract template_variables from `{{Label: Default}}` syntax.
 * Supported forms (admin only types `{{...}}` blocks — no separate variables editor):
 *   {{Label}}                  → text field, no default
 *   {{Label: default value}}   → text field with pre-filled default
 *
 * Variable internal `name` = the literal text inside `{{}}` (so renderPrompt regex matches it back).
 * Label/default are split on the FIRST `: ` (colon-space) so admin can use ":" in labels/defaults freely.
 * Type auto-promotes to 'textarea' if default has newlines or > 60 chars.
 * Each unique block becomes one variable; duplicates of the same {{block}} share one variable.
 */
// Syntax extensions:
//   {{Label}}                                       → label only, no default
//   {{Label: Default}}                              → label + default (default also used as placeholder)
//   {{Label: Default | Thai example}}               → label + default + Thai placeholder
//   {{Label: Default | Thai example | image}}       → also lets user attach a reference image instead of text
function extractVariablesFromPrompt(promptTemplate: string, prevVariables?: Array<any>): Array<{
  name: string;
  label_th: string;
  label_en: string;
  type: 'text' | 'textarea';
  default_value: string;
  placeholder?: string;
  supports_image?: boolean;
  order: number;
  x_pct?: number | null;
  y_pct?: number | null;
}> {
  const positionsByName = new Map<string, { x_pct?: number | null; y_pct?: number | null }>();
  if (Array.isArray(prevVariables)) {
    for (const v of prevVariables) {
      if (v?.name && (v.x_pct != null || v.y_pct != null)) {
        positionsByName.set(v.name, { x_pct: v.x_pct ?? null, y_pct: v.y_pct ?? null });
      }
    }
  }
  const seen = new Set<string>();
  const out: Array<any> = [];
  // Multiline-friendly: a placeholder may span multiple lines so admins can put both Thai and English
  // versions of the SAME headline / price / CTA inside ONE placeholder (separated by newline) instead
  // of having two placeholders (Headline + HeadlineEn).
  const re = /\{\{([\s\S]+?)\}\}/g;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = re.exec(promptTemplate))) {
    const inner = m[1].trim();
    if (seen.has(inner)) continue;
    seen.add(inner);
    order += 1;
    let label = inner;
    let defaultValue = '';
    let placeholder = '';
    let supportsImage = false;
    const sepIdx = inner.indexOf(': ');
    if (sepIdx >= 0) {
      label = inner.slice(0, sepIdx).trim();
      const valuePart = inner.slice(sepIdx + 2);
      // Split by ' | ' (max 3 parts: default, placeholder, flags)
      const parts = valuePart.split(' | ');
      defaultValue = parts[0];
      if (parts.length >= 2) placeholder = parts[1];
      if (parts.length >= 3 && /\bimage\b/i.test(parts[2])) supportsImage = true;
    }
    const type: 'text' | 'textarea' =
      (defaultValue.includes('\n') || defaultValue.length > 60) ? 'textarea' : 'text';
    const pos = positionsByName.get(inner);
    out.push({
      name: inner,
      label_th: label,
      label_en: label,
      type,
      default_value: defaultValue,
      placeholder,
      supports_image: supportsImage,
      order,
      x_pct: pos?.x_pct ?? null,
      y_pct: pos?.y_pct ?? null,
    });
  }
  return out;
}

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS image_templates (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        name_th TEXT,
        description TEXT,
        description_th TEXT,
        thumbnail_url TEXT,
        model TEXT NOT NULL DEFAULT 'gpt-image-2',
        aspect TEXT DEFAULT 'auto',
        resolution TEXT DEFAULT '1K',
        prompt_template TEXT NOT NULL,
        template_variables JSONB DEFAULT '[]'::jsonb,
        display_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        uses INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_image_templates_active
        ON image_templates(is_active, display_order);
      CREATE TABLE IF NOT EXISTS image_template_drafts (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_slug TEXT NOT NULL,
        state JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (user_id, template_slug)
      );
      CREATE TABLE IF NOT EXISTS image_template_user_gallery (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        s3_key TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_image_template_user_gallery_user
        ON image_template_user_gallery(user_id, created_at DESC);
    `);
    console.log('✅ image_templates table ready');

    // Seed templates removed — admin manages all templates via /admin/image-templates UI.
  } catch (err) {
    console.error('Failed to create image_templates table:', err);
  }
})();

// ============ Public ============

// GET /api/image-template/list — public list of active templates
router.get('/list', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT slug, name, name_th, description, description_th, thumbnail_url, model, aspect, resolution,
              prompt_template, template_variables, display_order, uses, created_at
       FROM image_templates WHERE is_active = TRUE ORDER BY display_order ASC, created_at DESC`
    );
    const items = await Promise.all(r.rows.map(async (row: any) => ({
      ...row,
      thumbnail_url: await resolveS3Value(row.thumbnail_url),
    })));
    res.json({ items });
  } catch (err: any) {
    console.error('[imageTemplate:list] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to list templates' });
  }
});

// GET /api/image-template/by-slug/:slug — single template (for detail page)
router.get('/by-slug/:slug', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT slug, name, name_th, description, description_th, thumbnail_url, model, aspect, resolution,
              prompt_template, template_variables, display_order, is_active, uses, created_at, updated_at
       FROM image_templates WHERE slug = $1`,
      [req.params.slug]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    const row = r.rows[0];
    res.json({ ...row, thumbnail_url: await resolveS3Value(row.thumbnail_url) });
  } catch (err: any) {
    console.error('[imageTemplate:by-slug] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch template' });
  }
});

// ============ Draft state (per-user, per-template) ============
// User's current task list + shared options for a given template — persists across refresh & devices.

// GET /api/image-template/draft-state/:slug
router.get('/draft-state/:slug', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { slug } = req.params;
    const r = await pool.query(
      `SELECT state, updated_at FROM image_template_drafts WHERE user_id = $1 AND template_slug = $2`,
      [userId, slug]
    );
    res.json({ state: r.rows[0]?.state || null, updated_at: r.rows[0]?.updated_at || null });
  } catch (err: any) {
    console.error('[imageTemplate:draft:get] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to load draft' });
  }
});

// POST /api/image-template/draft-state — body: { template_slug, state }
router.post('/draft-state', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { template_slug, state } = req.body as { template_slug?: string; state?: any };
    if (!template_slug) return res.status(400).json({ error: 'template_slug required' });
    if (state == null || typeof state !== 'object') return res.status(400).json({ error: 'state required' });
    await pool.query(
      `INSERT INTO image_template_drafts (user_id, template_slug, state, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (user_id, template_slug) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
      [userId, template_slug, JSON.stringify(state)]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('[imageTemplate:draft:save] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to save draft' });
  }
});

// DELETE /api/image-template/draft-state/:slug
router.delete('/draft-state/:slug', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { slug } = req.params;
    await pool.query(`DELETE FROM image_template_drafts WHERE user_id = $1 AND template_slug = $2`, [userId, slug]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[imageTemplate:draft:delete] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to clear draft' });
  }
});

// ============ Admin ============

// GET /api/image-template/admin — full list including inactive
router.get('/admin', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT * FROM image_templates ORDER BY display_order ASC, created_at DESC`
    );
    const items = await Promise.all(r.rows.map(async (row: any) => ({
      ...row,
      thumbnail_url: await resolveS3Value(row.thumbnail_url),
    })));
    res.json(items);
  } catch (err: any) {
    console.error('[imageTemplate:admin:list] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to list templates' });
  }
});

// POST /api/image-template/admin — create. template_variables auto-derived from prompt_template.
router.post('/admin', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const {
      slug, name, name_th, description, description_th, thumbnail_url,
      model, aspect, resolution, prompt_template,
      display_order, is_active,
    } = req.body;
    if (!slug || !name || !prompt_template) {
      return res.status(400).json({ error: 'slug, name, prompt_template are required' });
    }
    const derived = extractVariablesFromPrompt(prompt_template);
    const r = await pool.query(
      `INSERT INTO image_templates
       (slug, name, name_th, description, description_th, thumbnail_url, model, aspect, resolution,
        prompt_template, template_variables, display_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
       RETURNING *`,
      [
        slug, name, name_th ?? null, description ?? null, description_th ?? null, extractS3Key(thumbnail_url),
        model || 'gpt-image-2', aspect || 'auto', resolution || '1K',
        prompt_template, JSON.stringify(derived),
        display_order ?? 0, is_active !== false,
      ]
    );
    const row = r.rows[0];
    res.json({ ...row, thumbnail_url: await resolveS3Value(row.thumbnail_url) });
  } catch (err: any) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug already exists' });
    console.error('[imageTemplate:admin:create] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to create template' });
  }
});

// PUT /api/image-template/admin/:slug — update. template_variables auto-derived from prompt_template.
// Optional `field_positions: { name: {x_pct, y_pct} }` in body lets admin save marker placements on the thumbnail.
router.put('/admin/:slug', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug: oldSlug } = req.params;
    const {
      slug, name, name_th, description, description_th, thumbnail_url,
      model, aspect, resolution, prompt_template,
      display_order, is_active, field_positions,
    } = req.body;
    // Re-derive variables every save (preserve x_pct/y_pct from existing row + apply admin-sent field_positions)
    let derived: any = null;
    if (prompt_template) {
      const existing = await pool.query(`SELECT template_variables FROM image_templates WHERE slug = $1`, [oldSlug]);
      const prevVars: any[] = existing.rows[0]?.template_variables || [];
      derived = extractVariablesFromPrompt(prompt_template, prevVars);
      if (field_positions && typeof field_positions === 'object') {
        derived = derived.map((v: any) => {
          const pos = field_positions[v.name];
          if (pos && (typeof pos.x_pct === 'number' || pos.x_pct === null) && (typeof pos.y_pct === 'number' || pos.y_pct === null)) {
            return { ...v, x_pct: pos.x_pct, y_pct: pos.y_pct };
          }
          return v;
        });
      }
    }
    const r = await pool.query(
      `UPDATE image_templates SET
         slug = COALESCE($1, slug),
         name = COALESCE($2, name),
         name_th = $3,
         description = $4,
         description_th = $5,
         thumbnail_url = $6,
         model = COALESCE($7, model),
         aspect = COALESCE($8, aspect),
         resolution = COALESCE($9, resolution),
         prompt_template = COALESCE($10, prompt_template),
         template_variables = COALESCE($11, template_variables),
         display_order = COALESCE($12, display_order),
         is_active = COALESCE($13, is_active),
         updated_at = NOW()
       WHERE slug = $14
       RETURNING *`,
      [
        slug, name, name_th ?? null, description ?? null, description_th ?? null, extractS3Key(thumbnail_url),
        model, aspect, resolution, prompt_template,
        derived ? JSON.stringify(derived) : null,
        display_order, is_active,
        oldSlug,
      ]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    const row = r.rows[0];
    res.json({ ...row, thumbnail_url: await resolveS3Value(row.thumbnail_url) });
  } catch (err: any) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug already exists' });
    console.error('[imageTemplate:admin:update] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to update template' });
  }
});

// DELETE /api/image-template/admin/:slug
router.delete('/admin/:slug', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(`DELETE FROM image_templates WHERE slug = $1 RETURNING id`, [req.params.slug]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[imageTemplate:admin:delete] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete template' });
  }
});

// ============ User-uploaded Gallery (per-user S3, separate from idol/banner galleries) ============

// POST /api/image-template/gallery/upload — upload image to S3, save record, return signed URL
router.post('/gallery/upload', authenticate, galleryUpload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No image uploaded' });
    const userId = req.userId!;
    const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `image-template/user-gallery/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    await uploadFile(file.buffer, key, file.mimetype || 'image/jpeg');
    const ins = await pool.query(
      `INSERT INTO image_template_user_gallery (user_id, filename, s3_key)
       VALUES ($1, $2, $3) RETURNING id, filename, s3_key, created_at`,
      [userId, file.originalname, key]
    );
    const row = ins.rows[0];
    const sharedUrl = await getSignedFileUrl(key, 86400);
    res.json({ id: row.id, filename: row.filename, shared_url: sharedUrl, category: 'image-template', created_at: row.created_at });
  } catch (err: any) {
    console.error('[imageTemplate:gallery:upload] Error:', err.message);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// GET /api/image-template/gallery — list current user's uploads (latest first), with fresh signed URLs
router.get('/gallery', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const r = await pool.query(
      `SELECT id, filename, s3_key, created_at FROM image_template_user_gallery
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [userId]
    );
    const items = await Promise.all(r.rows.map(async (row: any) => ({
      id: row.id,
      filename: row.filename,
      shared_url: await getSignedFileUrl(row.s3_key, 86400),
      category: 'image-template',
      created_at: row.created_at,
    })));
    res.json(items);
  } catch (err: any) {
    console.error('[imageTemplate:gallery:list] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to list gallery' });
  }
});

// GET /api/image-template/gallery/:id/file — same-origin proxy: stream the S3 file back to the browser
// (avoids CORS preflight failures when the frontend wants to fetch() the image as a blob)
router.get('/gallery/:id/file', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const r = await pool.query(
      `SELECT s3_key FROM image_template_user_gallery WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const key: string = r.rows[0].s3_key;
    const obj: any = await (await import('../utils/s3.js')).getFile(key);
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    if (obj.ContentLength) res.setHeader('Content-Length', String(obj.ContentLength));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (obj.Body && typeof obj.Body.pipe === 'function') {
      obj.Body.pipe(res);
    } else if (obj.Body && typeof obj.Body.transformToByteArray === 'function') {
      const bytes = await obj.Body.transformToByteArray();
      res.end(Buffer.from(bytes));
    } else {
      res.status(500).json({ error: 'Unsupported S3 body type' });
    }
  } catch (err: any) {
    console.error('[imageTemplate:gallery:file] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to stream file' });
  }
});

// DELETE /api/image-template/gallery/:id — remove from DB + delete from S3
router.delete('/gallery/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const r = await pool.query(
      `DELETE FROM image_template_user_gallery WHERE id = $1 AND user_id = $2 RETURNING s3_key`,
      [id, userId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Image not found' });
    const key = r.rows[0]?.s3_key;
    if (key) deleteFile(key).catch((e) => console.warn('[imageTemplate:gallery:delete] S3 delete failed:', e?.message));
    res.json({ success: true });
  } catch (err: any) {
    console.error('[imageTemplate:gallery:delete] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to delete image' });
  }
});

export default router;
