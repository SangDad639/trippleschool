// แบบสอบถามหลังซื้อ (purchase_surveys + purchase_survey_courses · migration 079) — mount ที่ /api/purchase-surveys
//   ถาม 2 ข้อทันทีหลังซื้อ: reason (free text ≤ 500) + คอร์สที่สนใจ (หลายคอร์ส ≤ 20)
//   นับ 2 แบบ: 'subscription' (ผูก subscription_extension_logs ของผู้ใช้เอง — รายเดือน/รายปี)
//              'course' (ผูก course_enrollments ที่ user ซื้อเอง source='purchase' และจ่ายเงิน — คอร์สฟรีไม่ถาม)
//   1 แถวต่อ 1 การซื้อ (upsert) · ข้ามได้ (skipped=true) แต่ "ข้าม" ไม่ทับคำตอบที่เคยตอบแล้ว
//   FE: components/PurchaseSurvey.tsx (CheckoutComplete + CourseDetail) · แอดมินดู /admin/purchase-surveys
import express, { Response } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

const REASON_MAX = 500;
const COURSES_MAX = 20;
const PLANS = new Set(['monthly', 'yearly']);

function cleanReason(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\r\n/g, '\n').trim().slice(0, REASON_MAX);
  return s ? s : null;
}

function cleanCourseIds(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = Number(x);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length >= COURSES_MAX) break;
  }
  return out;
}

function toPositiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * POST / — บันทึก/อัปเดตคำตอบของการซื้อ 1 รายการ
 * body: { purchase_type: 'subscription', extension_log_id, plan_slug? } | { purchase_type: 'course', course_id }
 *       + reason?, course_ids?, skipped?
 */
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const purchaseType = req.body?.purchase_type;
  const reason = cleanReason(req.body?.reason);
  const courseIds = cleanCourseIds(req.body?.course_ids);
  // ว่างทั้ง 2 ข้อ = นับเป็นข้าม (ไม่ต้องพึ่ง FE ส่ง flag)
  const skipped = req.body?.skipped === true || (reason == null && courseIds.length === 0);

  let extensionLogId: number | null = null;
  let planSlug: string | null = null;
  let enrollmentId: number | null = null;
  let courseId: number | null = null;

  try {
    if (purchaseType === 'subscription') {
      const id = toPositiveInt(req.body?.extension_log_id);
      if (!id) return res.status(400).json({ error: 'extension_log_id ไม่ถูกต้อง' });
      const log = await pool.query(`SELECT id, user_id, days_added FROM subscription_extension_logs WHERE id = $1`, [id]);
      if (log.rows.length === 0) return res.status(404).json({ error: 'ไม่พบรายการสมัครสมาชิก' });
      if (Number(log.rows[0].user_id) !== userId) return res.status(403).json({ error: 'ไม่ใช่รายการของคุณ' });
      extensionLogId = id;
      const p = String(req.body?.plan_slug || '').toLowerCase();
      // ไม่ส่ง plan มา → เดาจากจำนวนวัน (รายปี ≥ 300 วัน)
      planSlug = PLANS.has(p) ? p : (Number(log.rows[0].days_added) >= 300 ? 'yearly' : 'monthly');
    } else if (purchaseType === 'course') {
      const cid = toPositiveInt(req.body?.course_id);
      if (!cid) return res.status(400).json({ error: 'course_id ไม่ถูกต้อง' });
      const enr = await pool.query(
        `SELECT id, paid_amount, source FROM course_enrollments WHERE user_id = $1 AND course_id = $2`,
        [userId, cid]
      );
      const row = enr.rows[0];
      if (!row || row.source === 'subscription') return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อคอร์สนี้' });
      if (!(Number(row.paid_amount) > 0)) return res.status(400).json({ error: 'คอร์สฟรีไม่มีแบบสอบถาม', errorCode: 'FREE_COURSE' });
      enrollmentId = Number(row.id);
      courseId = cid;
    } else {
      return res.status(400).json({ error: 'purchase_type ต้องเป็น subscription หรือ course' });
    }

    // "ข้าม" ต้องไม่ทับคำตอบที่เคยส่งแล้ว (เช่น ปิดกล่องหลังส่งคำตอบไปแล้ว)
    const existing = await pool.query(
      purchaseType === 'subscription'
        ? `SELECT id, skipped FROM purchase_surveys WHERE extension_log_id = $1`
        : `SELECT id, skipped FROM purchase_surveys WHERE enrollment_id = $1`,
      [purchaseType === 'subscription' ? extensionLogId : enrollmentId]
    );
    if (existing.rows[0] && existing.rows[0].skipped === false && skipped) {
      return res.json({ id: Number(existing.rows[0].id), skipped: false, unchanged: true });
    }

    // คอร์สที่สนใจ: ต้องมีอยู่จริง + ไม่ใช่คอร์สที่เพิ่งซื้อ
    let interested: number[] = [];
    if (courseIds.length > 0) {
      const found = await pool.query(`SELECT id FROM courses WHERE id = ANY($1::int[])`, [courseIds]);
      const valid = new Set(found.rows.map((r) => Number(r.id)));
      interested = courseIds.filter((id) => valid.has(id) && id !== courseId);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const up = await client.query(
        purchaseType === 'subscription'
          ? `INSERT INTO purchase_surveys (user_id, purchase_type, extension_log_id, plan_slug, reason, skipped)
             VALUES ($1, 'subscription', $2, $3, $4, $5)
             ON CONFLICT (extension_log_id) WHERE extension_log_id IS NOT NULL
             DO UPDATE SET reason = EXCLUDED.reason, skipped = EXCLUDED.skipped, plan_slug = EXCLUDED.plan_slug, updated_at = NOW()
             RETURNING id`
          : `INSERT INTO purchase_surveys (user_id, purchase_type, enrollment_id, course_id, reason, skipped)
             VALUES ($1, 'course', $2, $3, $4, $5)
             ON CONFLICT (enrollment_id) WHERE enrollment_id IS NOT NULL
             DO UPDATE SET reason = EXCLUDED.reason, skipped = EXCLUDED.skipped, course_id = EXCLUDED.course_id, updated_at = NOW()
             RETURNING id`,
        purchaseType === 'subscription'
          ? [userId, extensionLogId, planSlug, reason, skipped]
          : [userId, enrollmentId, courseId, reason, skipped]
      );
      const surveyId = Number(up.rows[0].id);
      await client.query(`DELETE FROM purchase_survey_courses WHERE survey_id = $1`, [surveyId]);
      if (interested.length > 0) {
        await client.query(
          `INSERT INTO purchase_survey_courses (survey_id, course_id) SELECT $1, unnest($2::int[])`,
          [surveyId, interested]
        );
      }
      await client.query('COMMIT');
      res.json({ id: surveyId, skipped, course_ids: interested });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error saving purchase survey:', error);
    res.status(500).json({ error: 'Failed to save survey' });
  }
});

/**
 * GET /mine?extension_log_id=  |  ?course_id=  — เคยตอบ/ข้ามการซื้อนี้แล้วหรือยัง (กันถามซ้ำตอนรีเฟรชหน้า)
 *   eligible=false = การซื้อนี้ถามไม่ได้ (log ไม่ใช่ของตัวเอง/ไม่มี · ไม่มี enrollment ที่จ่ายเงิน) → FE ไม่โชว์แบบสอบถาม
 */
router.get('/mine', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const extId = toPositiveInt(req.query.extension_log_id);
    const courseId = toPositiveInt(req.query.course_id);
    if (!extId && !courseId) return res.status(400).json({ error: 'ต้องระบุ extension_log_id หรือ course_id' });
    if (extId) {
      const own = await pool.query(`SELECT 1 FROM subscription_extension_logs WHERE id = $1 AND user_id = $2`, [extId, userId]);
      if (own.rows.length === 0) return res.json({ answered: false, eligible: false });
    } else {
      const enr = await pool.query(
        `SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2 AND source <> 'subscription' AND COALESCE(paid_amount, 0) > 0`,
        [userId, courseId]
      );
      if (enr.rows.length === 0) return res.json({ answered: false, eligible: false });
    }
    const r = extId
      ? await pool.query(`SELECT id, skipped FROM purchase_surveys WHERE user_id = $1 AND extension_log_id = $2`, [userId, extId])
      : await pool.query(`SELECT id, skipped FROM purchase_surveys WHERE user_id = $1 AND purchase_type = 'course' AND course_id = $2`, [userId, courseId]);
    if (r.rows.length === 0) return res.json({ answered: false, eligible: true });
    res.json({ answered: true, eligible: true, skipped: r.rows[0].skipped === true });
  } catch (error) {
    console.error('Error reading purchase survey status:', error);
    res.status(500).json({ error: 'Failed to read survey status' });
  }
});

/**
 * GET /admin/all — แอดมิน: คำตอบทุกคน เรียงใหม่ → เก่า + คอร์สที่คนสนใจมากสุด + ยอดรวม (หน้า /admin/purchase-surveys)
 */
router.get('/admin/all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const [surveys, top, totals] = await Promise.all([
      pool.query(`
        SELECT ps.id, ps.purchase_type, ps.plan_slug, ps.reason, ps.skipped, ps.created_at, ps.updated_at,
          ps.user_id, u.email AS user_email,
          ps.course_id, c.name AS course_name, c.slug AS course_slug,
          ps.extension_log_id, ps.enrollment_id,
          COALESCE((
            SELECT json_agg(json_build_object('id', c2.id, 'name', c2.name, 'slug', c2.slug) ORDER BY c2.name)
            FROM purchase_survey_courses psc JOIN courses c2 ON c2.id = psc.course_id
            WHERE psc.survey_id = ps.id
          ), '[]'::json) AS interested
        FROM purchase_surveys ps
        JOIN users u ON u.id = ps.user_id
        LEFT JOIN courses c ON c.id = ps.course_id
        ORDER BY ps.created_at DESC, ps.id DESC
      `),
      pool.query(`
        SELECT c.id, c.name, c.slug, COUNT(*)::int AS n
        FROM purchase_survey_courses psc
        JOIN courses c ON c.id = psc.course_id
        GROUP BY c.id, c.name, c.slug
        ORDER BY n DESC, c.name ASC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE NOT skipped)::int AS answered,
          COUNT(*) FILTER (WHERE skipped)::int AS skipped,
          COUNT(*) FILTER (WHERE purchase_type = 'subscription')::int AS subscription,
          COUNT(*) FILTER (WHERE purchase_type = 'course')::int AS course
        FROM purchase_surveys
      `),
    ]);
    res.json({ surveys: surveys.rows, top_courses: top.rows, totals: totals.rows[0] });
  } catch (error) {
    console.error('Error listing purchase surveys:', error);
    res.status(500).json({ error: 'Failed to list surveys' });
  }
});

export default router;
