// Course Learning System — courses, sections, lessons + thumbnail upload/proxy.
// Ported from sora-spark-forge, adapted to trippleschool:
//   - pool (default import), authenticate/requireAdmin (req.isAdmin/req.userId)
//   - thumbnails stored as a backend-proxy URL (/api/courses/thumbnails/<key>);
//     served via a public GET proxy (S3/OBS has no public ACL).
import { Router, Request, Response } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth.js';
import { uploadFile, getFile } from '../utils/s3.js';
import { hasActiveSubscription } from '../services/stripeService.js';

const router = Router();

/** Per-course access: an APPROVED purchase for THIS course (or admin). */
async function hasApprovedEnrollment(userId: number | undefined, courseId: number): Promise<boolean> {
  if (!userId) return false;
  const r = await pool.query(
    `SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'approved' LIMIT 1`,
    [userId, courseId]
  );
  return r.rows.length > 0;
}

/** Course access: admin, active subscription (unlocks ALL courses), or approved purchase. */
async function hasSubscriptionOrEnrollment(userId: number | undefined, courseId: number): Promise<boolean> {
  if (!userId) return false;
  if (await hasActiveSubscription(userId)) return true;
  return hasApprovedEnrollment(userId, courseId);
}

const thumbUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

// Lesson documents: common document/media types, up to 50MB. Served as an
// attachment (forced download) via the /materials proxy.
const ALLOWED_MATERIAL_EXTS = new Set([
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt',
  'zip', 'rar', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'mp4',
]);
const materialUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (ALLOWED_MATERIAL_EXTS.has(ext)) cb(null, true);
    else cb(new Error('ชนิดไฟล์นี้ไม่รองรับ'));
  },
});

// HTML document: read as inline content (shown in the lesson, not downloaded).
// 25MB — Word/Docs exports embed base64 images and get large.
const htmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isHtml = /text\/html|htm/i.test(file.mimetype) || /\.(html?|htm)$/i.test(file.originalname);
    if (isHtml) cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์ .html'));
  },
});

// Wrap a multer .single() so filter/size errors return JSON (not an HTML error
// page) — the client can then show the real reason instead of "Request failed".
function uploadSingle(mw: multer.Multer, field: string) {
  return (req: Request, res: Response, next: () => void) =>
    mw.single(field)(req, res, (err: any) => {
      if (err) {
        const msg = err?.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ใหญ่เกินกำหนด' : (err?.message || 'อัปโหลดไม่สำเร็จ');
        return res.status(400).json({ error: msg });
      }
      next();
    });
}

// A lesson material as accepted from the client / stored in the lessons.materials JSONB.
//   link/pdf → downloadable (uses `url`)
//   html     → inline content shown in the lesson page (uses `content`; sanitized on render)
interface LessonMaterial {
  title: string;
  url: string;
  type: 'link' | 'pdf' | 'html';
  enabled: boolean; // false = hidden from students (admin keeps the row)
  content?: string;
  fileName?: string; // original name of an uploaded HTML file (for the admin "attached" badge)
}

// Convert a Google Drive "share/view" link into a direct-download link so the
// student's download button fetches the file instead of opening Drive's UI.
function normalizeMaterialUrl(url: string): string {
  const fileMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  const openMatch = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return `https://drive.google.com/uc?export=download&id=${openMatch[1]}`;
  return url;
}

// Keep only well-formed rows with a non-empty url; coerce shape defensively.
function sanitizeMaterials(input: unknown): LessonMaterial[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m): LessonMaterial => {
      const type = m.type === 'pdf' ? 'pdf' : m.type === 'html' ? 'html' : 'link';
      const url = typeof m.url === 'string' ? m.url.trim() : '';
      return {
        title: typeof m.title === 'string' ? m.title.trim() : '',
        // Only normalize pasted links; uploaded PDFs already point at our proxy.
        url: type === 'link' ? normalizeMaterialUrl(url) : url,
        type,
        enabled: typeof m.enabled === 'boolean' ? m.enabled : true,
        content: type === 'html' && typeof m.content === 'string' ? m.content : '',
        fileName: typeof m.fileName === 'string' ? m.fileName : undefined,
      };
    })
    // html rows are kept by their content; link/pdf rows by their url.
    .filter((m) => (m.type === 'html' ? (m.content || '').trim().length > 0 : m.url.length > 0));
}

// Extract YouTube ID from common URL formats (or a bare 11-char id)
function extractYoutubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// ============ Public thumbnail proxy (no auth so <img> can load) ============
router.get('/thumbnails/*', async (req: Request, res: Response) => {
  try {
    const key = (req.params as any)[0];
    const obj = await getFile(key);
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    (obj.Body as any).pipe(res);
  } catch (error) {
    res.status(404).json({ error: 'Not found' });
  }
});

// ============ Admin: upload course thumbnail ============
router.post('/upload-thumbnail', authenticate, thumbUpload.single('thumbnail'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const rand = Math.random().toString(36).slice(2, 10);
    const key = `course-thumb/${Date.now()}-${rand}.${ext}`;
    await uploadFile(req.file.buffer, key, req.file.mimetype, { contentDisposition: 'inline' });
    res.json({ url: `/api/courses/thumbnails/${key}` });
  } catch (error) {
    console.error('Error uploading thumbnail:', error);
    res.status(500).json({ error: 'Failed to upload thumbnail' });
  }
});

// ============ Public material proxy (unguessable key; forces download) ============
// Access control lives in the lesson payload: paid-lesson material URLs are never
// sent to non-purchasers, so this proxy stays public like /thumbnails.
router.get('/materials/*', async (req: Request, res: Response) => {
  try {
    const key = (req.params as any)[0];
    const rawName = typeof req.query.name === 'string' ? req.query.name : '';
    const safeName = rawName.replace(/[\r\n"\\]/g, '').slice(0, 200);
    const obj = await getFile(key);
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    res.setHeader(
      'Content-Disposition',
      safeName ? `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}` : 'attachment'
    );
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    (obj.Body as any).pipe(res);
  } catch (error) {
    res.status(404).json({ error: 'Not found' });
  }
});

// ============ Admin: upload lesson document (PDF) ============
router.post('/upload-material', authenticate, uploadSingle(materialUpload, 'file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const rand = Math.random().toString(36).slice(2, 10);
    const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const key = `course-materials/${Date.now()}-${rand}.${ext}`;
    await uploadFile(req.file.buffer, key, req.file.mimetype, { contentDisposition: 'attachment' });
    res.json({ url: `/api/courses/materials/${key}`, name: req.file.originalname });
  } catch (error) {
    console.error('Error uploading material:', error);
    res.status(500).json({ error: 'Failed to upload material' });
  }
});

// ============ Admin: upload HTML doc → return its text as inline content ============
// The file itself isn't stored; its content goes into lessons.materials and is
// sanitized (DOMPurify) on the client before rendering.
router.post('/upload-html', authenticate, uploadSingle(htmlUpload, 'file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const content = req.file.buffer.toString('utf-8');
    res.json({ content, name: req.file.originalname });
  } catch (error) {
    console.error('Error uploading HTML:', error);
    res.status(500).json({ error: 'Failed to upload HTML' });
  }
});

// ============ Admin: list all courses (incl. inactive) ============
router.get('/admin/all', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const result = await pool.query(`
      SELECT c.*,
        COUNT(DISTINCT l.id) as lesson_count,
        COUNT(DISTINCT e.id) as enrollment_count
      FROM courses c
      LEFT JOIN lessons l ON c.id = l.course_id
      LEFT JOIN course_enrollments e ON c.id = e.course_id
      GROUP BY c.id
      ORDER BY c.display_order ASC, c.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// ============ Public: list active courses ============
router.get('/', async (req, res) => {
  try {
    const { featured, difficulty, search, sort } = req.query;
    let query = `
      SELECT c.*,
        COUNT(DISTINCT l.id) FILTER (WHERE l.is_active = true) as lesson_count,
        COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'approved') as enrollment_count,
        COALESCE(AVG(r.rating), 0)::numeric(3,2) as avg_rating,
        COUNT(DISTINCT r.id) as review_count
      FROM courses c
      LEFT JOIN lessons l ON c.id = l.course_id
      LEFT JOIN course_enrollments e ON c.id = e.course_id
      LEFT JOIN course_reviews r ON c.id = r.course_id
      WHERE c.is_active = true
    `;
    const params: any[] = [];
    let paramIndex = 1;
    if (featured === 'true') query += ` AND c.is_featured = true`;
    if (difficulty) { query += ` AND c.difficulty = $${paramIndex}`; params.push(difficulty); paramIndex++; }
    if (search) { query += ` AND (c.name ILIKE $${paramIndex} OR c.description ILIKE $${paramIndex})`; params.push(`%${search}%`); paramIndex++; }
    query += ` GROUP BY c.id`;
    const order = sort === 'popular' ? `enrollment_count DESC, c.created_at DESC`
      : sort === 'new' ? `c.created_at DESC`
      : sort === 'price_asc' ? `COALESCE(c.discount_price, c.price) ASC`
      : sort === 'price_desc' ? `COALESCE(c.discount_price, c.price) DESC`
      : `c.display_order ASC, c.created_at DESC`;
    query += ` ORDER BY ${order}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// ============ Admin: create course ============
router.post('/', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const {
      name, slug, description, short_description, thumbnail_url,
      instructor_name, instructor_avatar, difficulty, duration_hours,
      is_featured, display_order, price, discount_price, learning_outcomes, requirements,
    } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required' });
    const result = await pool.query(`
      INSERT INTO courses (
        name, slug, description, short_description, thumbnail_url,
        instructor_name, instructor_avatar, difficulty, duration_hours,
        is_featured, display_order, price, discount_price, learning_outcomes, requirements
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      name, slug, description || null, short_description || null, thumbnail_url || null,
      instructor_name || null, instructor_avatar || null, difficulty || 'beginner', duration_hours || 0,
      is_featured || false, display_order || 0, price || 0, discount_price || null,
      JSON.stringify(Array.isArray(learning_outcomes) ? learning_outcomes : []),
      JSON.stringify(Array.isArray(requirements) ? requirements : []),
    ]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating course:', error);
    if ((error as any).code === '23505') return res.status(400).json({ error: 'Course slug already exists' });
    res.status(500).json({ error: 'Failed to create course' });
  }
});

// ============ Admin: update course ============
router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const {
      name, slug, description, short_description, thumbnail_url,
      instructor_name, instructor_avatar, difficulty, duration_hours,
      is_featured, is_active, display_order, price, discount_price, learning_outcomes, requirements,
    } = req.body;
    const result = await pool.query(`
      UPDATE courses SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        description = COALESCE($3, description),
        short_description = COALESCE($4, short_description),
        thumbnail_url = COALESCE($5, thumbnail_url),
        instructor_name = COALESCE($6, instructor_name),
        instructor_avatar = COALESCE($7, instructor_avatar),
        difficulty = COALESCE($8, difficulty),
        duration_hours = COALESCE($9, duration_hours),
        is_featured = COALESCE($10, is_featured),
        is_active = COALESCE($11, is_active),
        display_order = COALESCE($12, display_order),
        price = COALESCE($13, price),
        discount_price = $14,
        learning_outcomes = COALESCE($15, learning_outcomes),
        requirements = COALESCE($16, requirements),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $17
      RETURNING *
    `, [
      name, slug, description, short_description, thumbnail_url,
      instructor_name, instructor_avatar, difficulty, duration_hours,
      is_featured, is_active, display_order, price, discount_price,
      learning_outcomes !== undefined ? JSON.stringify(learning_outcomes) : null,
      requirements !== undefined ? JSON.stringify(requirements) : null,
      id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating course:', error);
    if ((error as any).code === '23505') return res.status(400).json({ error: 'Course slug already exists' });
    res.status(500).json({ error: 'Failed to update course' });
  }
});

// ============ Admin: delete course (cascades) ============
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM courses WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// =====================  SECTION ENDPOINTS  =====================

router.get('/:courseId/sections', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const { courseId } = req.params;
    // Reveal paid-lesson youtube_id only to admins / enrolled owners. Anonymous
    // or non-owner callers get it masked (preview lessons stay visible).
    const hasAccess = !!req.isAdmin || (await hasSubscriptionOrEnrollment(req.userId, Number(courseId)));
    const sectionsResult = await pool.query(`
      SELECT * FROM course_sections WHERE course_id = $1 AND is_active = true ORDER BY section_order ASC
    `, [courseId]);
    const sections = await Promise.all(sectionsResult.rows.map(async (section) => {
      const lessonsResult = await pool.query(`
        SELECT id, title, description, youtube_id, duration_minutes, lesson_order, is_preview, section_id
        FROM lessons WHERE section_id = $1 AND is_active = true ORDER BY lesson_order ASC
      `, [section.id]);
      const lessons = lessonsResult.rows.map((l) =>
        hasAccess || l.is_preview ? l : { ...l, youtube_id: null }
      );
      return { ...section, lessons };
    }));
    res.json(sections);
  } catch (error) {
    console.error('Error fetching sections:', error);
    res.status(500).json({ error: 'Failed to fetch sections' });
  }
});

router.post('/:courseId/sections', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { courseId } = req.params;
    const { title, description, section_order, mode } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const sectionMode = mode === 'update' ? 'update' : 'basic';
    let order = section_order;
    if (order === undefined || order === null) {
      const maxOrderResult = await pool.query(`
        SELECT COALESCE(MAX(section_order), 0) + 1 as next_order FROM course_sections WHERE course_id = $1
      `, [courseId]);
      order = maxOrderResult.rows[0].next_order;
    }
    const result = await pool.query(`
      INSERT INTO course_sections (course_id, title, description, section_order, mode)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [courseId, title, description || null, order, sectionMode]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating section:', error);
    res.status(500).json({ error: 'Failed to create section' });
  }
});

router.put('/:courseId/sections/reorder', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { courseId } = req.params;
    const { sectionIds } = req.body;
    if (!Array.isArray(sectionIds)) return res.status(400).json({ error: 'sectionIds must be an array' });
    for (let i = 0; i < sectionIds.length; i++) {
      await pool.query(`
        UPDATE course_sections SET section_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND course_id = $3
      `, [i + 1, sectionIds[i], courseId]);
    }
    res.json({ message: 'Sections reordered successfully' });
  } catch (error) {
    console.error('Error reordering sections:', error);
    res.status(500).json({ error: 'Failed to reorder sections' });
  }
});

router.put('/sections/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const { title, description, section_order, is_active } = req.body;
    const mode = req.body.mode === 'basic' || req.body.mode === 'update' ? req.body.mode : null;
    const result = await pool.query(`
      UPDATE course_sections SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        section_order = COALESCE($3, section_order),
        is_active = COALESCE($4, is_active),
        mode = COALESCE($6, mode),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 RETURNING *
    `, [title, description, section_order, is_active, id, mode]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Section not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating section:', error);
    res.status(500).json({ error: 'Failed to update section' });
  }
});

router.delete('/sections/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM course_sections WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Section not found' });
    res.json({ message: 'Section deleted successfully' });
  } catch (error) {
    console.error('Error deleting section:', error);
    res.status(500).json({ error: 'Failed to delete section' });
  }
});

router.put('/sections/:sectionId/lessons/assign', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { sectionId } = req.params;
    const { lessonIds } = req.body;
    if (!Array.isArray(lessonIds)) return res.status(400).json({ error: 'lessonIds must be an array' });
    const sectionResult = await pool.query(`SELECT id FROM course_sections WHERE id = $1`, [sectionId]);
    if (sectionResult.rows.length === 0) return res.status(404).json({ error: 'Section not found' });
    for (let i = 0; i < lessonIds.length; i++) {
      await pool.query(`
        UPDATE lessons SET section_id = $1, lesson_order = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3
      `, [sectionId, i + 1, lessonIds[i]]);
    }
    res.json({ message: 'Lessons assigned to section successfully' });
  } catch (error) {
    console.error('Error assigning lessons to section:', error);
    res.status(500).json({ error: 'Failed to assign lessons to section' });
  }
});

router.put('/lessons/:lessonId/unassign', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { lessonId } = req.params;
    const result = await pool.query(`
      UPDATE lessons SET section_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *
    `, [lessonId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Lesson not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error unassigning lesson:', error);
    res.status(500).json({ error: 'Failed to unassign lesson' });
  }
});

// =====================  LESSON ENDPOINTS  =====================

router.get('/:courseId/lessons', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const { courseId } = req.params;
    // Reveal paid-lesson youtube_id/youtube_url only to admins / enrolled owners.
    const hasAccess = !!req.isAdmin || (await hasSubscriptionOrEnrollment(req.userId, Number(courseId)));
    const result = await pool.query(`
      SELECT * FROM lessons WHERE course_id = $1 AND is_active = true ORDER BY lesson_order ASC
    `, [courseId]);
    const lessons = result.rows.map((l) =>
      hasAccess || l.is_preview ? l : { ...l, youtube_id: null, youtube_url: null }
    );
    res.json(lessons);
  } catch (error) {
    console.error('Error fetching lessons:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

router.post('/:courseId/lessons', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { courseId } = req.params;
    const { title, description, youtube_url, duration_minutes, lesson_order, is_preview, section_id, materials } = req.body;
    if (!title || !youtube_url) return res.status(400).json({ error: 'Title and YouTube URL are required' });
    const youtube_id = extractYoutubeId(youtube_url);
    const cleanMaterials = sanitizeMaterials(materials);
    let order = lesson_order;
    if (order === undefined || order === null) {
      if (section_id) {
        const r = await pool.query(`SELECT COALESCE(MAX(lesson_order), 0) + 1 as next_order FROM lessons WHERE section_id = $1`, [section_id]);
        order = r.rows[0].next_order;
      } else {
        const r = await pool.query(`SELECT COALESCE(MAX(lesson_order), 0) + 1 as next_order FROM lessons WHERE course_id = $1`, [courseId]);
        order = r.rows[0].next_order;
      }
    }
    const result = await pool.query(`
      INSERT INTO lessons (course_id, section_id, title, description, youtube_url, youtube_id, duration_minutes, lesson_order, is_preview, materials)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [courseId, section_id || null, title, description || null, youtube_url, youtube_id, duration_minutes || 0, order, is_preview || false, JSON.stringify(cleanMaterials)]);
    await pool.query(`
      UPDATE courses SET total_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = $1 AND is_active = true), updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [courseId]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating lesson:', error);
    res.status(500).json({ error: 'Failed to create lesson' });
  }
});

router.put('/lessons/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const { title, description, youtube_url, duration_minutes, lesson_order, is_preview, is_active, section_id, materials } = req.body;
    const youtube_id = youtube_url ? extractYoutubeId(youtube_url) : undefined;
    let query = `
      UPDATE lessons SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        youtube_url = COALESCE($3, youtube_url),
        youtube_id = COALESCE($4, youtube_id),
        duration_minutes = COALESCE($5, duration_minutes),
        lesson_order = COALESCE($6, lesson_order),
        is_preview = COALESCE($7, is_preview),
        is_active = COALESCE($8, is_active),
        materials = COALESCE($9, materials),
    `;
    const params: any[] = [title, description, youtube_url, youtube_id, duration_minutes, lesson_order, is_preview, is_active,
      materials !== undefined ? JSON.stringify(sanitizeMaterials(materials)) : null];
    if (section_id !== undefined) { query += `section_id = $10,`; params.push(section_id); }
    query += ` updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length + 1} RETURNING *`;
    params.push(id);
    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Lesson not found' });
    const lesson = result.rows[0];
    await pool.query(`
      UPDATE courses SET total_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = $1 AND is_active = true), updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [lesson.course_id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating lesson:', error);
    res.status(500).json({ error: 'Failed to update lesson' });
  }
});

router.delete('/lessons/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const lessonResult = await pool.query(`SELECT course_id FROM lessons WHERE id = $1`, [id]);
    if (lessonResult.rows.length === 0) return res.status(404).json({ error: 'Lesson not found' });
    const courseId = lessonResult.rows[0].course_id;
    await pool.query(`DELETE FROM lessons WHERE id = $1`, [id]);
    await pool.query(`
      UPDATE courses SET total_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = $1 AND is_active = true), updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [courseId]);
    res.json({ message: 'Lesson deleted successfully' });
  } catch (error) {
    console.error('Error deleting lesson:', error);
    res.status(500).json({ error: 'Failed to delete lesson' });
  }
});

router.put('/:courseId/lessons/reorder', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { courseId } = req.params;
    const { lessonIds } = req.body;
    if (!Array.isArray(lessonIds)) return res.status(400).json({ error: 'lessonIds must be an array' });
    for (let i = 0; i < lessonIds.length; i++) {
      await pool.query(`
        UPDATE lessons SET lesson_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND course_id = $3
      `, [i + 1, lessonIds[i], courseId]);
    }
    res.json({ message: 'Lessons reordered successfully' });
  } catch (error) {
    console.error('Error reordering lessons:', error);
    res.status(500).json({ error: 'Failed to reorder lessons' });
  }
});

// ============ Authed: single lesson video (subscription-gated) ============
// Authoritative gate for paid lesson playback. Free (is_preview) lessons return
// youtube to any authenticated user; paid lessons require an active subscription
// (or admin). Paid youtube ids are never included in any list/detail payload —
// the player fetches them one lesson at a time through this endpoint.
router.get('/:slug/lessons/:lessonId/video', authenticate, async (req: AuthRequest, res) => {
  try {
    const { slug, lessonId } = req.params;
    const courseResult = await pool.query(`SELECT id FROM courses WHERE slug = $1 AND is_active = true`, [slug]);
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    const courseId = courseResult.rows[0].id;
    const lessonResult = await pool.query(
      `SELECT id, title, youtube_id, youtube_url, is_preview FROM lessons WHERE id = $1 AND course_id = $2 AND is_active = true`,
      [lessonId, courseId]
    );
    if (lessonResult.rows.length === 0) return res.status(404).json({ error: 'Lesson not found' });
    const lesson = lessonResult.rows[0];
    const hasAccess = lesson.is_preview || req.isAdmin || (await hasSubscriptionOrEnrollment(req.userId, courseId));
    if (!hasAccess) {
      return res.status(403).json({
        error: 'กรุณาซื้อคอร์สนี้ก่อนรับชมบทเรียน',
        code: 'NOT_PURCHASED',
      });
    }
    res.json({ id: lesson.id, title: lesson.title, youtube_id: lesson.youtube_id, youtube_url: lesson.youtube_url });
  } catch (error) {
    console.error('Error fetching lesson video:', error);
    res.status(500).json({ error: 'Failed to fetch lesson video' });
  }
});

// ============ Reviews (public list / owner upsert / admin delete) ============
router.get('/:slug/reviews', async (req, res) => {
  try {
    const { slug } = req.params;
    const cr = await pool.query(`SELECT id FROM courses WHERE slug = $1`, [slug]);
    if (cr.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    const courseId = cr.rows[0].id;
    const reviews = await pool.query(`
      SELECT rv.id, rv.rating, rv.comment, rv.created_at, SPLIT_PART(u.email, '@', 1) AS reviewer
      FROM course_reviews rv JOIN users u ON rv.user_id = u.id
      WHERE rv.course_id = $1 ORDER BY rv.created_at DESC
    `, [courseId]);
    const agg = await pool.query(
      `SELECT COALESCE(AVG(rating), 0)::numeric(3,2) AS avg, COUNT(*)::int AS count FROM course_reviews WHERE course_id = $1`,
      [courseId]
    );
    res.json({ reviews: reviews.rows, avg: Number(agg.rows[0].avg), count: agg.rows[0].count });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

router.post('/:courseId/reviews', authenticate, async (req: AuthRequest, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.userId!;
    const { rating, comment } = req.body;
    const r = parseInt(rating, 10);
    if (!(r >= 1 && r <= 5)) return res.status(400).json({ error: 'rating must be 1..5' });
    if (!(await hasApprovedEnrollment(userId, Number(courseId)))) {
      return res.status(403).json({ error: 'ต้องซื้อคอร์สนี้ก่อนจึงจะรีวิวได้' });
    }
    const result = await pool.query(`
      INSERT INTO course_reviews (course_id, user_id, rating, comment)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (course_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [courseId, userId, r, comment || null]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

router.delete('/reviews/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    await pool.query(`DELETE FROM course_reviews WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Review deleted' });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// ============ Public: course by slug, full (auth) variant ============
// NOTE: keep these single/double-segment :slug routes LAST so they don't shadow
// the literal routes above (admin, sections, lessons, thumbnails).

router.get('/:slug/full', authenticate, async (req: AuthRequest, res) => {
  try {
    const { slug } = req.params;
    const userId = req.userId;
    const courseResult = await pool.query(`SELECT c.*,
        (SELECT COUNT(*) FROM course_enrollments WHERE course_id = c.id AND status = 'approved') AS enrollment_count,
        (SELECT COALESCE(AVG(rating), 0)::numeric(3,2) FROM course_reviews WHERE course_id = c.id) AS avg_rating,
        (SELECT COUNT(*) FROM course_reviews WHERE course_id = c.id) AS review_count
      FROM courses c WHERE c.slug = $1 AND c.is_active = true`, [slug]);
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    const course = courseResult.rows[0];
    // Access: admin, active subscription (unlocks ALL courses), or approved purchase.
    const isSubscriber = userId ? await hasActiveSubscription(userId) : false;
    const enrollmentResult = await pool.query(
      `SELECT * FROM course_enrollments WHERE user_id = $1 AND course_id = $2`,
      [userId, course.id]
    );
    let enrollment = enrollmentResult.rows[0] || null;
    // Subscribers get an auto 'approved' enrollment (source='subscription') so access,
    // progress, "my courses" and the "เริ่มเรียน" CTA all flow through the normal path.
    if (isSubscriber && !enrollment && userId) {
      await pool.query(
        `INSERT INTO course_enrollments (user_id, course_id, status, source, approved_at)
         VALUES ($1, $2, 'approved', 'subscription', CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, course_id) DO NOTHING`,
        [userId, course.id]
      );
      const re = await pool.query(`SELECT * FROM course_enrollments WHERE user_id = $1 AND course_id = $2`, [userId, course.id]);
      enrollment = re.rows[0] || null;
    }
    const hasAccess = req.isAdmin || isSubscriber || (enrollment?.status === 'approved');
    const sectionsResult = await pool.query(`
      SELECT id, title, description, section_order, mode FROM course_sections WHERE course_id = $1 AND is_active = true ORDER BY section_order ASC
    `, [course.id]);
    const lessonsResult = await pool.query(`
      SELECT id, title, description, youtube_url, youtube_id, duration_minutes, lesson_order, is_preview, section_id, materials
      FROM lessons WHERE course_id = $1 AND is_active = true ORDER BY lesson_order ASC
    `, [course.id]);
    const lessons = lessonsResult.rows.map((lesson) => {
      if (!hasAccess && !lesson.is_preview) return { ...lesson, youtube_url: null, youtube_id: null, materials: [] };
      // Students only see materials flagged enabled (admin can hide without deleting).
      const materials = Array.isArray(lesson.materials) ? lesson.materials.filter((m: any) => m?.enabled !== false) : [];
      return { ...lesson, materials };
    });
    const sections = sectionsResult.rows.map((section) => ({ ...section, lessons: lessons.filter(l => l.section_id === section.id) }));
    const unassignedLessons = lessons.filter(l => l.section_id === null);
    res.json({ ...course, sections, unassigned_lessons: unassignedLessons, lessons, enrollment, hasAccess, isEnrolled: hasAccess });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const courseResult = await pool.query(`SELECT c.*,
        (SELECT COUNT(*) FROM course_enrollments WHERE course_id = c.id AND status = 'approved') AS enrollment_count,
        (SELECT COALESCE(AVG(rating), 0)::numeric(3,2) FROM course_reviews WHERE course_id = c.id) AS avg_rating,
        (SELECT COUNT(*) FROM course_reviews WHERE course_id = c.id) AS review_count
      FROM courses c WHERE c.slug = $1 AND c.is_active = true`, [slug]);
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    const course = courseResult.rows[0];
    const sectionsResult = await pool.query(`
      SELECT id, title, description, section_order, mode FROM course_sections WHERE course_id = $1 AND is_active = true ORDER BY section_order ASC
    `, [course.id]);
    const lessonsResult = await pool.query(`
      SELECT id, title, description, youtube_id, youtube_url, duration_minutes, lesson_order, is_preview, section_id, materials
      FROM lessons WHERE course_id = $1 AND is_active = true ORDER BY lesson_order ASC
    `, [course.id]);
    // Public payload: only preview lessons expose youtube + materials; paid lessons
    // are nulled so their video id / documents never reach an unauthenticated visitor.
    const lessons = lessonsResult.rows.map((l) => {
      if (!l.is_preview) return { ...l, youtube_id: null, youtube_url: null, materials: [] };
      const materials = Array.isArray(l.materials) ? l.materials.filter((m: any) => m?.enabled !== false) : [];
      return { ...l, materials };
    });
    const sections = sectionsResult.rows.map((section) => ({ ...section, lessons: lessons.filter(l => l.section_id === section.id) }));
    const unassignedLessons = lessons.filter(l => l.section_id === null);
    res.json({ ...course, sections, unassigned_lessons: unassignedLessons, lessons });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

export default router;
