// โค้ดส่วนลดของแอดมิน (admin_codes · migration 069) — mount ที่ /api/admin-codes
//   · ลดราคาเท่าโค้ดผู้แนะนำ (affiliate_settings.refcode_discount_percent) · ไม่ผูก referrer · ไม่สร้างค่าคอม
//   · ผูกกับบทเรียน (Video) หรือคอร์ส = ป้าย funnel (ไม่จำกัดว่าต้องซื้อคอร์สนั้น ใช้ได้ทั้งคอร์ส/สมาชิก)
//   · ไม่มีวันหมดอายุ/จำกัดครั้ง แค่เปิด/ปิดใช้งาน · โค้ดเปลี่ยนไม่ได้หลังสร้าง (กัน funnel เพี้ยน)
//   · ตาราง Video | Code | Count: Count = จำนวนคน (DISTINCT) ที่ชำระสำเร็จผ่านโค้ด (คอร์ส approved + สมาชิกที่ verify แล้ว)
import express, { Response } from 'express';
import pool from '../db.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { normalizeRefcode, validateCustomRefcode, RefcodeError } from '../services/refcode.js';

const router = express.Router();

/** approval_method ที่นับว่า "ชำระสำเร็จ" (เกณฑ์เดียวกับรายงานรายได้ใน admin.ts) */
const PAID_METHODS = `('autoapprove','admin','stripe')`;

const LIST_SELECT = `
  SELECT ac.*, c.name AS course_name, l.title AS lesson_title, l.lesson_order, l.share_code AS lesson_share_code,
    (SELECT COUNT(DISTINCT e.user_id)::int FROM course_enrollments e WHERE e.admin_code_id = ac.id AND e.status = 'approved') AS count_course,
    (SELECT COUNT(*)::int FROM course_enrollments e WHERE e.admin_code_id = ac.id AND e.status = 'pending') AS count_pending,
    (SELECT COUNT(DISTINCT s.user_id)::int FROM subscription_extension_logs s WHERE s.admin_code_id = ac.id AND s.approval_method IN ${PAID_METHODS}) AS count_sub,
    (SELECT COUNT(*)::int FROM (
        SELECT e.user_id FROM course_enrollments e WHERE e.admin_code_id = ac.id AND e.status = 'approved'
        UNION
        SELECT s.user_id FROM subscription_extension_logs s WHERE s.admin_code_id = ac.id AND s.approval_method IN ${PAID_METHODS}
      ) x) AS count_success,
    (SELECT COALESCE(SUM(e.paid_amount), 0) FROM course_enrollments e WHERE e.admin_code_id = ac.id AND e.status = 'approved')
      + (SELECT COALESCE(SUM(s.subtotal), 0) FROM subscription_extension_logs s WHERE s.admin_code_id = ac.id AND s.approval_method IN ${PAID_METHODS}) AS revenue,
    GREATEST(
      (SELECT MAX(e.updated_at) FROM course_enrollments e WHERE e.admin_code_id = ac.id),
      (SELECT MAX(s.created_at) FROM subscription_extension_logs s WHERE s.admin_code_id = ac.id)
    ) AS last_used_at
  FROM admin_codes ac
  LEFT JOIN courses c ON c.id = ac.course_id
  LEFT JOIN lessons l ON l.id = ac.lesson_id`;

function toAdmin(r: any) {
  return {
    id: Number(r.id),
    code: String(r.code),
    label: r.label ?? null,
    course_id: r.course_id == null ? null : Number(r.course_id),
    course_name: r.course_name ?? null,
    lesson_id: r.lesson_id == null ? null : Number(r.lesson_id),
    lesson_title: r.lesson_title ?? null,
    lesson_order: r.lesson_order == null ? null : Number(r.lesson_order),
    lesson_share_code: r.lesson_share_code ?? null,
    is_active: !!r.is_active,
    count_success: Number(r.count_success ?? 0),
    count_course: Number(r.count_course ?? 0),
    count_sub: Number(r.count_sub ?? 0),
    count_pending: Number(r.count_pending ?? 0),
    revenue: Number(r.revenue ?? 0),
    last_used_at: r.last_used_at ?? null,
    created_by: r.created_by == null ? null : Number(r.created_by),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** สุ่มโค้ด 6 ตัว (ตัวแรกเป็นอักษร ไม่มี 0/o/1/l/i เหมือน share code) ที่ยังไม่ชนทั้ง admin_codes และ users.refcode */
async function uniqueAdminCode(): Promise<string> {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const gen = () => {
    let s = letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };
  for (let i = 0; i < 10; i++) {
    const code = gen();
    const taken = await pool.query(
      `SELECT 1 FROM admin_codes WHERE LOWER(code) = $1 UNION ALL SELECT 1 FROM users WHERE LOWER(refcode) = $1 LIMIT 1`,
      [code]
    );
    if (taken.rows.length === 0) return code;
  }
  return gen() + Math.floor(Math.random() * 90 + 10);
}

/** ตรวจการผูกบท/คอร์ส: ผูกบท → คอร์สของบทนั้นชนะ · คืน {course_id, lesson_id} หรือ error ไทย */
async function resolveBinding(body: any): Promise<{ course_id: number | null; lesson_id: number | null } | { error: string }> {
  const lessonRaw = body.lesson_id;
  const courseRaw = body.course_id;
  const lessonId = lessonRaw == null || lessonRaw === '' ? null : Number(lessonRaw);
  const courseId = courseRaw == null || courseRaw === '' ? null : Number(courseRaw);
  if (lessonId != null) {
    if (!Number.isInteger(lessonId) || lessonId <= 0) return { error: 'บทเรียนไม่ถูกต้อง' };
    const l = await pool.query(`SELECT course_id FROM lessons WHERE id = $1`, [lessonId]);
    if (l.rows.length === 0) return { error: 'ไม่พบบทเรียนที่เลือก' };
    return { course_id: Number(l.rows[0].course_id), lesson_id: lessonId };
  }
  if (courseId != null) {
    if (!Number.isInteger(courseId) || courseId <= 0) return { error: 'คอร์สไม่ถูกต้อง' };
    const c = await pool.query(`SELECT id FROM courses WHERE id = $1`, [courseId]);
    if (c.rows.length === 0) return { error: 'ไม่พบคอร์สที่เลือก' };
    return { course_id: courseId, lesson_id: null };
  }
  return { course_id: null, lesson_id: null };
}

const parseLabel = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s ? s.slice(0, 255) : null;
};

/** จำนวนแถวที่อ้างโค้ดนี้ (ทุกสถานะ) — ใช้กันลบโค้ดที่มีประวัติ */
async function usageRows(id: number): Promise<number> {
  const r = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM course_enrollments WHERE admin_code_id = $1)
          + (SELECT COUNT(*)::int FROM subscription_extension_logs WHERE admin_code_id = $1) AS n`,
    [id]
  );
  return Number(r.rows[0]?.n ?? 0);
}

/* ------------------------------------------------------------------ */
/*  Admin CRUD + funnel                                                */
/* ------------------------------------------------------------------ */
router.get('/admin/all', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(`${LIST_SELECT} ORDER BY count_success DESC, ac.id DESC LIMIT 500`);
    res.json({ codes: r.rows.map(toAdmin) });
  } catch (error) {
    console.error('[admin-codes] list error:', error);
    res.status(500).json({ error: 'โหลดรายการโค้ดไม่สำเร็จ' });
  }
});

router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    let code = normalizeRefcode(body.code);
    if (!code) {
      code = await uniqueAdminCode();
    } else {
      try {
        // รูปแบบเดียวกับ refcode (4-20 ตัว a-z 0-9 - _ มีตัวอักษร) แต่แอดมินใช้คำสงวนได้
        validateCustomRefcode(code, { bypassReserved: true });
      } catch (e) {
        if (e instanceof RefcodeError) return res.status(400).json({ error: e.message, errorCode: e.errorCode });
        throw e;
      }
      const clash = await pool.query(`SELECT 1 FROM users WHERE LOWER(refcode) = $1 LIMIT 1`, [code]);
      if (clash.rows.length > 0) {
        return res.status(409).json({ error: 'โค้ดนี้ซ้ำกับโค้ดผู้แนะนำของสมาชิก กรุณาใช้โค้ดอื่น', errorCode: 'CODE_TAKEN' });
      }
    }
    const bind = await resolveBinding(body);
    if ('error' in bind) return res.status(400).json({ error: bind.error });
    const label = parseLabel(body.label);
    const isActive = body.is_active === undefined ? true : body.is_active === true;
    const ins = await pool.query(
      `INSERT INTO admin_codes (code, label, course_id, lesson_id, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [code, label, bind.course_id, bind.lesson_id, isActive, req.userId ?? null]
    );
    const r = await pool.query(`${LIST_SELECT} WHERE ac.id = $1`, [ins.rows[0].id]);
    console.log(`[admin-codes][AUDIT] created #${ins.rows[0].id} "${code}" (${label ?? '-'}) course=${bind.course_id ?? '-'} lesson=${bind.lesson_id ?? '-'} by admin #${req.userId}`);
    res.json({ code: toAdmin(r.rows[0]) });
  } catch (error: any) {
    if (error?.code === '23505') return res.status(409).json({ error: 'โค้ดนี้มีอยู่แล้ว กรุณาใช้โค้ดอื่น', errorCode: 'CODE_TAKEN' });
    console.error('[admin-codes] create error:', error);
    res.status(500).json({ error: 'สร้างโค้ดไม่สำเร็จ' });
  }
});

router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
    const cur = await pool.query(`SELECT code FROM admin_codes WHERE id = $1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'ไม่พบโค้ด' });
    const body = req.body ?? {};
    if (body.code !== undefined && normalizeRefcode(body.code) !== String(cur.rows[0].code)) {
      return res.status(400).json({ error: 'เปลี่ยนตัวโค้ดไม่ได้ (กันสถิติ funnel เพี้ยน) — สร้างโค้ดใหม่แทน' });
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.label !== undefined) { values.push(parseLabel(body.label)); sets.push(`label = $${values.length}`); }
    if (body.lesson_id !== undefined || body.course_id !== undefined) {
      const bind = await resolveBinding(body);
      if ('error' in bind) return res.status(400).json({ error: bind.error });
      values.push(bind.course_id); sets.push(`course_id = $${values.length}`);
      values.push(bind.lesson_id); sets.push(`lesson_id = $${values.length}`);
    }
    if (body.is_active !== undefined) { values.push(body.is_active === true); sets.push(`is_active = $${values.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'ไม่มีอะไรให้แก้' });
    sets.push('updated_at = NOW()');
    values.push(id);
    await pool.query(`UPDATE admin_codes SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    const r = await pool.query(`${LIST_SELECT} WHERE ac.id = $1`, [id]);
    console.log(`[admin-codes][AUDIT] updated #${id} (${sets.join(',')}) by admin #${req.userId}`);
    res.json({ code: toAdmin(r.rows[0]) });
  } catch (error) {
    console.error('[admin-codes] update error:', error);
    res.status(500).json({ error: 'บันทึกโค้ดไม่สำเร็จ' });
  }
});

router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
    const used = await usageRows(id);
    if (used > 0) {
      return res.status(409).json({ error: `โค้ดนี้ถูกใช้ไปแล้ว ${used} รายการ — ลบไม่ได้ ให้ปิดใช้งานแทน`, errorCode: 'CODE_USED', used });
    }
    const del = await pool.query(`DELETE FROM admin_codes WHERE id = $1 RETURNING code`, [id]);
    if (del.rows.length === 0) return res.status(404).json({ error: 'ไม่พบโค้ด' });
    console.log(`[admin-codes][AUDIT] deleted #${id} "${del.rows[0].code}" by admin #${req.userId}`);
    res.json({ ok: true });
  } catch (error) {
    console.error('[admin-codes] delete error:', error);
    res.status(500).json({ error: 'ลบโค้ดไม่สำเร็จ' });
  }
});

/** รายการใช้ล่าสุดของโค้ด (funnel รายคน) — อีเมล mask กลาง */
router.get('/:id/usage', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const r = await pool.query(
      `SELECT * FROM (
         SELECT 'course'::text AS type, e.id AS ref_id, u.email, c.name::text AS item, e.paid_amount::numeric AS amount,
                e.status::text AS status, e.updated_at AS at
           FROM course_enrollments e JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id
          WHERE e.admin_code_id = $1
         UNION ALL
         SELECT 'subscription'::text, s.id, u.email, ('สมาชิก ' || s.days_added || ' วัน')::text, s.subtotal::numeric,
                s.approval_method::text, s.created_at
           FROM subscription_extension_logs s JOIN users u ON u.id = s.user_id
          WHERE s.admin_code_id = $1
       ) x ORDER BY at DESC LIMIT $2`,
      [id, limit]
    );
    const mask = (email: string) => {
      const [name, domain] = String(email).split('@');
      if (!domain) return email;
      const head = name.slice(0, 2);
      return `${head}${'*'.repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
    };
    res.json({
      usage: r.rows.map((row) => ({
        type: row.type,
        ref_id: Number(row.ref_id),
        user_email: mask(row.email),
        item: row.item,
        amount: row.amount == null ? null : Number(row.amount),
        status: row.status,
        created_at: row.at,
      })),
    });
  } catch (error) {
    console.error('[admin-codes] usage error:', error);
    res.status(500).json({ error: 'โหลดรายการใช้โค้ดไม่สำเร็จ' });
  }
});

export default router;
