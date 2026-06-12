// Course enrollments — PER-COURSE PURCHASE + admin approval.
//   - User buys ONE course: uploads a payment slip → row status='pending'.
//   - Admin approves → status='approved' → that course unlocks (per-course access).
//   - Progress (completed_lessons / progress_percent) tracked on the same row.
//   - Slips stored in S3; served via a public proxy (/api/enrollments/slips/*).
//   - Mounted at /api/enrollments.
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { uploadFile, getFile } from '../utils/s3.js';
import { createAffiliateCommission } from '../services/stripeService.js';

const router = Router();

/** Best-effort affiliate commission on course purchase (base = price actually paid). */
async function createCourseCommission(enrollment: { id: number; user_id: number; course_id: number }): Promise<void> {
  try {
    const cr = await pool.query(`SELECT price, discount_price FROM courses WHERE id = $1`, [enrollment.course_id]);
    const c = cr.rows[0];
    if (!c) return;
    const paid = (c.discount_price != null ? c.discount_price : c.price) || 0;
    if (paid <= 0) return; // free course → no commission
    // Unique-per-enrollment id (idempotent on re-approve). planSlug omitted → referrer tier %.
    await createAffiliateCommission(enrollment.user_id, `course_${enrollment.id}`, Math.round(paid * 100), 'THB');
  } catch (e) {
    console.error('[Affiliate] course commission failed:', e);
  }
}

const SLIP_MAX_BYTES = 5 * 1024 * 1024;
const slipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SLIP_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

/**
 * Wraps slipUpload.single('slip') so multer errors return a clean 4xx instead of
 * bubbling to Express's default handler (which yields an HTML 500). Oversize →
 * 413, wrong type / other upload errors → 400, all with Thai messages.
 */
function uploadSlip(req: Request, res: Response, next: NextFunction) {
  slipUpload.single('slip')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'ไฟล์สลิปใหญ่เกินไป (สูงสุด 5MB)' });
      }
      return res.status(400).json({ error: `อัปโหลดไฟล์ไม่สำเร็จ (${err.code})` });
    }
    const msg = err instanceof Error && err.message === 'Only image files allowed'
      ? 'อัปโหลดได้เฉพาะไฟล์รูปภาพ (เช่น jpg, png)'
      : 'อัปโหลดไฟล์ไม่สำเร็จ';
    return res.status(400).json({ error: msg });
  });
}

// ============ Public slip proxy (no auth so admin <img> loads) ============
router.get('/slips/*', async (req: Request, res: Response) => {
  try {
    const key = (req.params as any)[0];
    const obj = await getFile(key);
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    (obj.Body as any).pipe(res);
  } catch (error) {
    res.status(404).json({ error: 'Not found' });
  }
});

// ============ User: buy a course (upload payment slip) ============
router.post('/:courseId/enroll', authenticate, uploadSlip, async (req: AuthRequest, res: Response) => {
  try {
    const { courseId } = req.params;
    const userId = req.userId!;

    const courseResult = await pool.query(`SELECT id FROM courses WHERE id = $1 AND is_active = true`, [courseId]);
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });

    let slipUrl: string | null = null;
    if (req.file) {
      const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const rand = Math.random().toString(36).slice(2, 10);
      const key = `course-slip/${Date.now()}-${rand}.${ext}`;
      await uploadFile(req.file.buffer, key, req.file.mimetype, { contentDisposition: 'inline' });
      slipUrl = `/api/enrollments/slips/${key}`;
    }

    const existing = await pool.query(`SELECT * FROM course_enrollments WHERE user_id = $1 AND course_id = $2`, [userId, courseId]);
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.status === 'approved') return res.status(400).json({ error: 'คุณซื้อคอร์สนี้แล้ว' });
      // pending or rejected → (re)submit slip, back to pending
      await pool.query(
        `UPDATE course_enrollments SET status='pending', rejection_reason=NULL, slip_url=COALESCE($2, slip_url), updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [row.id, slipUrl]
      );
      return res.json({ message: 'ส่งคำขอแล้ว รอการอนุมัติ', status: 'pending' });
    }

    const result = await pool.query(
      `INSERT INTO course_enrollments (user_id, course_id, status, slip_url) VALUES ($1, $2, 'pending', $3) RETURNING *`,
      [userId, courseId, slipUrl]
    );
    res.json({ message: 'ส่งคำขอแล้ว รอการอนุมัติ', enrollment: result.rows[0] });
  } catch (error) {
    console.error('Error enrolling in course:', error);
    res.status(500).json({ error: 'Failed to enroll in course' });
  }
});

// ============ User: my courses (all statuses) ============
router.get('/mine', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { status } = req.query;
    let query = `
      SELECT e.*, c.name as course_name, c.slug as course_slug, c.thumbnail_url,
             c.instructor_name, c.difficulty, c.total_lessons, c.duration_hours
      FROM course_enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE e.user_id = $1
    `;
    const params: any[] = [userId];
    if (status) { query += ` AND e.status = $2`; params.push(status); }
    query += ` ORDER BY e.updated_at DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching enrollments:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

// ============ User: enrollment status for a course ============
router.get('/status/:courseId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { courseId } = req.params;
    const userId = req.userId;
    const result = await pool.query(`SELECT * FROM course_enrollments WHERE user_id = $1 AND course_id = $2`, [userId, courseId]);
    if (result.rows.length === 0) return res.json({ enrolled: false, status: null });
    res.json({ enrolled: true, ...result.rows[0] });
  } catch (error) {
    console.error('Error fetching enrollment status:', error);
    res.status(500).json({ error: 'Failed to fetch enrollment status' });
  }
});

// ============ User: update learning progress (must own the course) ============
router.put('/:id/progress', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const { completed_lesson_id, last_lesson_id } = req.body;

    const enrollmentResult = await pool.query(`
      SELECT e.*, c.total_lessons FROM course_enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE e.id = $1 AND e.user_id = $2 AND (e.status = 'approved' OR $3 = true)
    `, [id, userId, req.isAdmin === true]);
    if (enrollmentResult.rows.length === 0) return res.status(403).json({ error: 'ยังไม่ได้เป็นเจ้าของคอร์สนี้' });
    const enrollment = enrollmentResult.rows[0];
    const completedLessons: number[] = enrollment.completed_lessons || [];
    if (completed_lesson_id && !completedLessons.includes(completed_lesson_id)) completedLessons.push(completed_lesson_id);
    const totalLessons = enrollment.total_lessons || 1;
    const progressPercent = Math.round((completedLessons.length / totalLessons) * 100);
    const result = await pool.query(`
      UPDATE course_enrollments SET
        completed_lessons = $1,
        last_lesson_id = COALESCE($2, last_lesson_id),
        progress_percent = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 RETURNING *
    `, [completedLessons, last_lesson_id, progressPercent, id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// =====================  ADMIN ENROLLMENT (purchase approval)  =====================

router.get('/admin/all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { status, course_id, limit = 50, offset = 0 } = req.query;
    let where = ` WHERE 1=1`;
    const params: any[] = [];
    let i = 1;
    if (status) { where += ` AND e.status = $${i}`; params.push(status); i++; }
    if (course_id) { where += ` AND e.course_id = $${i}`; params.push(course_id); i++; }
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM course_enrollments e${where}`, params);
    const result = await pool.query(`
      SELECT e.*, u.email as user_email, c.name as course_name, c.slug as course_slug, c.price, c.discount_price,
             approver.email as approved_by_email
      FROM course_enrollments e
      JOIN users u ON e.user_id = u.id
      JOIN courses c ON e.course_id = c.id
      LEFT JOIN users approver ON e.approved_by = approver.id
      ${where}
      ORDER BY e.updated_at DESC LIMIT $${i} OFFSET $${i + 1}
    `, [...params, limit, offset]);
    res.json({ enrollments: result.rows, total: countResult.rows[0].total, limit: parseInt(limit as string), offset: parseInt(offset as string) });
  } catch (error) {
    console.error('Error fetching admin enrollments:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

router.get('/admin/stats', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')  AS pending_count,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
        COUNT(*) AS total_count
      FROM course_enrollments
    `);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching enrollment stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.put('/admin/:id/approve', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const result = await pool.query(`
      UPDATE course_enrollments SET status='approved', approved_by=$1, approved_at=CURRENT_TIMESTAMP, rejection_reason=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND status='pending' RETURNING *
    `, [req.userId, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Enrollment not found or already processed' });
    await createCourseCommission(result.rows[0]);
    res.json({ message: 'Enrollment approved', enrollment: result.rows[0] });
  } catch (error) {
    console.error('Error approving enrollment:', error);
    res.status(500).json({ error: 'Failed to approve enrollment' });
  }
});

router.put('/admin/:id/reject', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const { reason } = req.body;
    const result = await pool.query(`
      UPDATE course_enrollments SET status='rejected', rejection_reason=$1, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND status='pending' RETURNING *
    `, [reason || null, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Enrollment not found or already processed' });
    res.json({ message: 'Enrollment rejected', enrollment: result.rows[0] });
  } catch (error) {
    console.error('Error rejecting enrollment:', error);
    res.status(500).json({ error: 'Failed to reject enrollment' });
  }
});

router.put('/admin/:id/revoke', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const { reason } = req.body;
    const result = await pool.query(`
      UPDATE course_enrollments SET status='rejected', rejection_reason=$1, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND status='approved' RETURNING *
    `, [reason || 'ถูกเพิกถอนสิทธิ์โดยแอดมิน', id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Enrollment not found or not approved' });
    res.json({ message: 'Enrollment revoked', enrollment: result.rows[0] });
  } catch (error) {
    console.error('Error revoking enrollment:', error);
    res.status(500).json({ error: 'Failed to revoke enrollment' });
  }
});

router.post('/admin/bulk-approve', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { enrollment_ids } = req.body;
    if (!Array.isArray(enrollment_ids) || enrollment_ids.length === 0) {
      return res.status(400).json({ error: 'enrollment_ids must be a non-empty array' });
    }
    const result = await pool.query(`
      UPDATE course_enrollments SET status='approved', approved_by=$1, approved_at=CURRENT_TIMESTAMP, rejection_reason=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE id = ANY($2) AND status='pending' RETURNING id, user_id, course_id
    `, [req.userId, enrollment_ids]);
    for (const row of result.rows) await createCourseCommission(row);
    res.json({ message: `${result.rowCount} enrollments approved`, approved_ids: result.rows.map(r => r.id) });
  } catch (error) {
    console.error('Error bulk approving enrollments:', error);
    res.status(500).json({ error: 'Failed to approve enrollments' });
  }
});

export default router;
