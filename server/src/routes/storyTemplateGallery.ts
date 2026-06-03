import express, { Response } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { uploadBufferToDropbox, isDropboxConfigured } from '../utils/dropbox.js';

const router = express.Router();

// Story gallery: max 1 image per upload @ 30MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
});

const VALID_CATEGORIES = ['main', 'outfit', 'background', 'object'] as const;
type GalleryCategory = (typeof VALID_CATEGORIES)[number];

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS story_template_gallery (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        image_key TEXT NOT NULL,
        image_url TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_story_gallery_user_cat
        ON story_template_gallery(user_id, category, created_at DESC);
    `);
    console.log('✅ story_template_gallery table ready');
  } catch (err) {
    console.error('Failed to create story_template_gallery table:', err);
  }
})();

// POST /api/story-template-gallery/upload
router.post('/upload', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const category = String(req.body.category || '').trim();
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'file is required' });
    if (!VALID_CATEGORIES.includes(category as GalleryCategory)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }
    if (!isDropboxConfigured()) {
      return res.status(500).json({ error: 'Dropbox not configured on server' });
    }

    const ext = (file.originalname.split('.').pop() || 'png').toLowerCase();
    const dropboxPath = `/trippleviral/story-gallery/${userId}/${category}/${Date.now()}.${ext}`;
    const { sharedUrl } = await uploadBufferToDropbox(file.buffer, dropboxPath);

    const insert = await pool.query(
      `INSERT INTO story_template_gallery (user_id, category, image_key, image_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, category, image_key, image_url, created_at`,
      [userId, category, dropboxPath, sharedUrl]
    );

    return res.json({ success: true, item: insert.rows[0] });
  } catch (err: any) {
    console.error('[storyGallery:upload] Error:', err);
    return res.status(500).json({ error: err?.message || 'Upload failed' });
  }
});

// GET /api/story-template-gallery/list?category=main|outfit|background|object
router.get('/list', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const category = typeof req.query.category === 'string' ? req.query.category : '';

    let where = `WHERE user_id = $1`;
    const params: any[] = [userId];
    if (category && VALID_CATEGORIES.includes(category as GalleryCategory)) {
      params.push(category);
      where += ` AND category = $${params.length}`;
    }

    const rows = await pool.query(
      `SELECT id, category, image_key, image_url, created_at
       FROM story_template_gallery ${where}
       ORDER BY created_at DESC LIMIT 200`,
      params
    );
    // Dropbox shared links don't expire — no re-sign needed
    return res.json({ items: rows.rows });
  } catch (err: any) {
    console.error('[storyGallery:list] Error:', err);
    return res.status(500).json({ error: err?.message || 'List failed' });
  }
});

// DELETE /api/story-template-gallery/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    const r = await pool.query(
      `DELETE FROM story_template_gallery WHERE user_id = $1 AND id = $2 RETURNING id`,
      [userId, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[storyGallery:delete] Error:', err);
    return res.status(500).json({ error: err?.message || 'Delete failed' });
  }
});

export default router;
