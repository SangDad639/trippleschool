// Course enrollments = per-user PROGRESS records (completed_lessons / progress_percent).
// Course access is granted by an active SUBSCRIPTION (gating lives in courses.ts).
// Subscribers get an auto 'approved' enrollment row (source='subscription') the first
// time they open a course; this router reads/updates it for progress + "my courses".
// No per-course purchase or admin approval. Mounted at /api/enrollments.
import { Router, Response } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

// ============ User: my courses ============
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

export default router;
