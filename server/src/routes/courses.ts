// Course Learning System — courses, sections, lessons + thumbnail upload/proxy.
// Ported from sora-spark-forge, adapted to trippleschool:
//   - pool (default import), authenticate/requireAdmin (req.isAdmin/req.userId)
//   - thumbnails stored as a backend-proxy URL (/api/courses/thumbnails/<key>);
//     served via a public GET proxy (S3/OBS has no public ACL).
import { Router, Request, Response } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { uploadFile, getFile } from '../utils/s3.js';

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

const thumbUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

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
    const { featured, difficulty, search } = req.query;
    let query = `
      SELECT c.*, COUNT(DISTINCT l.id) as lesson_count
      FROM courses c
      LEFT JOIN lessons l ON c.id = l.course_id AND l.is_active = true
      WHERE c.is_active = true
    `;
    const params: any[] = [];
    let paramIndex = 1;
    if (featured === 'true') query += ` AND c.is_featured = true`;
    if (difficulty) { query += ` AND c.difficulty = $${paramIndex}`; params.push(difficulty); paramIndex++; }
    if (search) { query += ` AND (c.name ILIKE $${paramIndex} OR c.description ILIKE $${paramIndex})`; params.push(`%${search}%`); paramIndex++; }
    query += ` GROUP BY c.id ORDER BY c.display_order ASC, c.created_at DESC`;
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
      is_featured, display_order, price, discount_price,
    } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required' });
    const result = await pool.query(`
      INSERT INTO courses (
        name, slug, description, short_description, thumbnail_url,
        instructor_name, instructor_avatar, difficulty, duration_hours,
        is_featured, display_order, price, discount_price
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      name, slug, description || null, short_description || null, thumbnail_url || null,
      instructor_name || null, instructor_avatar || null, difficulty || 'beginner', duration_hours || 0,
      is_featured || false, display_order || 0, price || 0, discount_price || null,
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
      is_featured, is_active, display_order, price, discount_price,
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
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
      RETURNING *
    `, [
      name, slug, description, short_description, thumbnail_url,
      instructor_name, instructor_avatar, difficulty, duration_hours,
      is_featured, is_active, display_order, price, discount_price, id,
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

router.get('/:courseId/sections', async (req, res) => {
  try {
    const { courseId } = req.params;
    const sectionsResult = await pool.query(`
      SELECT * FROM course_sections WHERE course_id = $1 AND is_active = true ORDER BY section_order ASC
    `, [courseId]);
    const sections = await Promise.all(sectionsResult.rows.map(async (section) => {
      const lessonsResult = await pool.query(`
        SELECT id, title, description, youtube_id, duration_minutes, lesson_order, is_preview, section_id
        FROM lessons WHERE section_id = $1 AND is_active = true ORDER BY lesson_order ASC
      `, [section.id]);
      return { ...section, lessons: lessonsResult.rows };
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
    const { title, description, section_order } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    let order = section_order;
    if (order === undefined || order === null) {
      const maxOrderResult = await pool.query(`
        SELECT COALESCE(MAX(section_order), 0) + 1 as next_order FROM course_sections WHERE course_id = $1
      `, [courseId]);
      order = maxOrderResult.rows[0].next_order;
    }
    const result = await pool.query(`
      INSERT INTO course_sections (course_id, title, description, section_order)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [courseId, title, description || null, order]);
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
    const result = await pool.query(`
      UPDATE course_sections SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        section_order = COALESCE($3, section_order),
        is_active = COALESCE($4, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 RETURNING *
    `, [title, description, section_order, is_active, id]);
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

router.get('/:courseId/lessons', async (req, res) => {
  try {
    const { courseId } = req.params;
    const result = await pool.query(`
      SELECT * FROM lessons WHERE course_id = $1 AND is_active = true ORDER BY lesson_order ASC
    `, [courseId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching lessons:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

router.post('/:courseId/lessons', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { courseId } = req.params;
    const { title, description, youtube_url, duration_minutes, lesson_order, is_preview, section_id } = req.body;
    if (!title || !youtube_url) return res.status(400).json({ error: 'Title and YouTube URL are required' });
    const youtube_id = extractYoutubeId(youtube_url);
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
      INSERT INTO lessons (course_id, section_id, title, description, youtube_url, youtube_id, duration_minutes, lesson_order, is_preview)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `, [courseId, section_id || null, title, description || null, youtube_url, youtube_id, duration_minutes || 0, order, is_preview || false]);
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
    const { title, description, youtube_url, duration_minutes, lesson_order, is_preview, is_active, section_id } = req.body;
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
    `;
    const params: any[] = [title, description, youtube_url, youtube_id, duration_minutes, lesson_order, is_preview, is_active];
    if (section_id !== undefined) { query += `section_id = $9,`; params.push(section_id); }
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
    const hasAccess = lesson.is_preview || req.isAdmin || (await hasApprovedEnrollment(req.userId, courseId));
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

// ============ Public: course by slug, full (auth) variant ============
// NOTE: keep these single/double-segment :slug routes LAST so they don't shadow
// the literal routes above (admin, sections, lessons, thumbnails).

router.get('/:slug/full', authenticate, async (req: AuthRequest, res) => {
  try {
    const { slug } = req.params;
    const userId = req.userId;
    const courseResult = await pool.query(`SELECT * FROM courses WHERE slug = $1 AND is_active = true`, [slug]);
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    const course = courseResult.rows[0];
    // Per-course access: an APPROVED purchase for this course (or admin) unlocks paid lessons.
    const hasAccess = req.isAdmin || (await hasApprovedEnrollment(userId, course.id));
    const enrollmentResult = await pool.query(
      `SELECT * FROM course_enrollments WHERE user_id = $1 AND course_id = $2`,
      [userId, course.id]
    );
    const enrollment = enrollmentResult.rows[0] || null;
    const sectionsResult = await pool.query(`
      SELECT id, title, description, section_order FROM course_sections WHERE course_id = $1 AND is_active = true ORDER BY section_order ASC
    `, [course.id]);
    const lessonsResult = await pool.query(`
      SELECT id, title, description, youtube_url, youtube_id, duration_minutes, lesson_order, is_preview, section_id
      FROM lessons WHERE course_id = $1 AND is_active = true ORDER BY lesson_order ASC
    `, [course.id]);
    const lessons = lessonsResult.rows.map((lesson) => {
      if (!hasAccess && !lesson.is_preview) return { ...lesson, youtube_url: null, youtube_id: null };
      return lesson;
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
    const courseResult = await pool.query(`SELECT * FROM courses WHERE slug = $1 AND is_active = true`, [slug]);
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    const course = courseResult.rows[0];
    const sectionsResult = await pool.query(`
      SELECT id, title, description, section_order FROM course_sections WHERE course_id = $1 AND is_active = true ORDER BY section_order ASC
    `, [course.id]);
    const lessonsResult = await pool.query(`
      SELECT id, title, description, youtube_id, youtube_url, duration_minutes, lesson_order, is_preview, section_id
      FROM lessons WHERE course_id = $1 AND is_active = true ORDER BY lesson_order ASC
    `, [course.id]);
    // Public payload: only preview lessons expose youtube; paid lessons are nulled
    // so their video id never reaches an unauthenticated visitor.
    const lessons = lessonsResult.rows.map((l) => (l.is_preview ? l : { ...l, youtube_id: null, youtube_url: null }));
    const sections = sectionsResult.rows.map((section) => ({ ...section, lessons: lessons.filter(l => l.section_id === section.id) }));
    const unassignedLessons = lessons.filter(l => l.section_id === null);
    res.json({ ...course, sections, unassigned_lessons: unassignedLessons, lessons });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

export default router;
