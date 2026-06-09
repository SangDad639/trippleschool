// Course enrollments — now a lightweight PROGRESS-TRACKING layer.
//
// Access to paid lessons is governed by the user's SUBSCRIPTION (membership),
// not by a per-course purchase. So `course_enrollments` no longer carries a
// payment slip or an admin approval step: a row is auto-created (status='active')
// the first time a subscriber opens a course, and only stores learning progress.
//   - mounted at /api/enrollments (own namespace; avoids /api/admin clash).
import { Router, Response } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { hasActiveSubscription } from '../services/stripeService.js';

const router = Router();

// ============ User: start a course (auto-create progress row) ============
// Subscription-gated: only an active member (or admin) can begin tracking
// progress. Idempotent via UNIQUE(user_id, course_id).
router.post('/:courseId/start', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { courseId } = req.params;
    const userId = req.userId!;

    const courseResult = await pool.query(`SELECT id FROM courses WHERE id = $1 AND is_active = true`, [courseId]);
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });

    const hasAccess = req.isAdmin || (await hasActiveSubscription(userId));
    if (!hasAccess) {
      return res.status(403).json({
        error: 'กรุณาสมัครสมาชิกเพื่อเริ่มเรียน',
        code: 'NO_SUBSCRIPTION',
        subscriptionUrl: '/subscription/transfer-v2',
      });
    }

    const result = await pool.query(`
      INSERT INTO course_enrollments (user_id, course_id, status)
      VALUES ($1, $2, 'active')
      ON CONFLICT (user_id, course_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [userId, courseId]);
    res.json({ enrollment: result.rows[0] });
  } catch (error) {
    console.error('Error starting course:', error);
    res.status(500).json({ error: 'Failed to start course' });
  }
});

// ============ User: my courses (started progress rows) ============
router.get('/mine', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const result = await pool.query(`
      SELECT e.*, c.name as course_name, c.slug as course_slug, c.thumbnail_url,
             c.instructor_name, c.difficulty, c.total_lessons, c.duration_hours
      FROM course_enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE e.user_id = $1 AND e.status IN ('active', 'approved')
      ORDER BY e.updated_at DESC
    `, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching enrollments:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

// ============ User: progress row for a course ============
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

// ============ User: update learning progress ============
// Subscription-gated (membership) rather than per-course approval.
router.put('/:id/progress', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const { completed_lesson_id, last_lesson_id } = req.body;

    const hasAccess = req.isAdmin || (await hasActiveSubscription(userId));
    if (!hasAccess) {
      return res.status(403).json({ error: 'กรุณาสมัครสมาชิก', code: 'NO_SUBSCRIPTION', subscriptionUrl: '/subscription/transfer-v2' });
    }

    const enrollmentResult = await pool.query(`
      SELECT e.*, c.total_lessons FROM course_enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE e.id = $1 AND e.user_id = $2
    `, [id, userId]);
    if (enrollmentResult.rows.length === 0) return res.status(404).json({ error: 'Enrollment not found' });
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
