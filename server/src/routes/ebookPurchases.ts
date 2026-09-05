// Ebook purchases — ซื้อ Ebook รายเล่ม + แอดมินอนุมัติ (mirror โฟลว์ซื้อคอร์สใน
// enrollments.ts ตัดส่วน progress ออก):
//   - User ซื้อเล่มขาย (price > 0): อัปสลิป → แถว status='pending'
//   - Admin อนุมัติ → 'approved' → เล่มปลดล็อกผ่าน computeEntitled ฝั่ง ebooks.ts
//   - refcode ลด 5% + affiliate commission ตอนอนุมัติ — กติกาเดียวกับซื้อคอร์ส
//   - สลิปขึ้น S3 (ebook-slip/) เสิร์ฟผ่าน proxy สาธารณะ /api/ebook-purchases/slips/*
//   - Mounted at /api/ebook-purchases.
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { uploadFile, getFile } from '../utils/s3.js';
import { createAffiliateCommission, hasActiveSubscription } from '../services/stripeService.js';
import { checkRefcode, bindReferrerIfEmpty, applyRefDiscount } from '../services/refcode.js';

const router = Router();

/**
 * ผูก referrer จากโค้ดบนคำสั่งซื้อ — เรียกตอน admin อนุมัติเท่านั้น (จ่ายเงินจริงแล้ว)
 * เหมือน bindReferrerFromEnrollment ฝั่งคอร์สทุกประการ
 */
async function bindReferrerFromPurchase(purchase: { user_id: number; refcode?: string | null }): Promise<void> {
  if (!purchase.refcode) return;
  try {
    const r = await pool.query(`SELECT id FROM users WHERE LOWER(refcode) = $1 LIMIT 1`, [purchase.refcode]);
    const ownerId = r.rows[0]?.id;
    if (ownerId && Number(ownerId) !== Number(purchase.user_id)) {
      await bindReferrerIfEmpty(purchase.user_id, Number(ownerId));
    }
  } catch (e) {
    console.error('[Affiliate] bind referrer on ebook approve failed:', e);
  }
}

/** Best-effort affiliate commission (ฐาน = ยอดที่จ่ายจริงตอน checkout, id กันซ้ำต่อคำสั่งซื้อ) */
async function createEbookCommission(purchase: { id: number; user_id: number; paid_amount?: number | string | null }): Promise<void> {
  try {
    const paid = Number(purchase.paid_amount) || 0;
    if (paid <= 0) return;
    await createAffiliateCommission(purchase.user_id, `ebook_${purchase.id}`, Math.round(paid * 100), 'THB');
  } catch (e) {
    console.error('[Affiliate] ebook commission failed:', e);
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

/** ห่อ multer ให้ error ออกเป็น 4xx ภาษาไทย ไม่หลุดเป็น HTML 500 (ลอกจาก enrollments) */
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

// ============ User: buy an ebook (upload payment slip) ============
router.post('/:ebookId/purchase', authenticate, uploadSlip, async (req: AuthRequest, res: Response) => {
  try {
    const ebookId = Number(req.params.ebookId);
    const userId = req.userId!;
    if (!Number.isInteger(ebookId) || ebookId <= 0) return res.status(400).json({ error: 'Bad ebook id' });

    const er = await pool.query(`SELECT id, price, members_only, is_active FROM ebooks WHERE id = $1 AND is_active = true`, [ebookId]);
    if (er.rows.length === 0) return res.status(404).json({ error: 'ไม่พบ Ebook' });
    const ebook = er.rows[0];
    const baseAmount = Number(ebook.price) || 0;
    // ซื้อได้เฉพาะเล่มโหมดขาย — เล่มฟรีไม่มีอะไรให้จ่าย เล่มสมาชิกให้ไปสมัคร /pricing
    if (baseAmount <= 0 || ebook.members_only) {
      return res.status(400).json({ error: 'Ebook เล่มนี้ไม่ได้เปิดขายรายเล่ม' });
    }
    // สมาชิก subscription อ่านเล่มขายได้อยู่แล้ว — กันจ่ายซ้ำซ้อนโดยไม่จำเป็น
    if (await hasActiveSubscription(userId)) {
      return res.status(400).json({ error: 'คุณเป็นสมาชิกอยู่แล้ว อ่าน Ebook เล่มนี้ได้เลยไม่ต้องซื้อ' });
    }

    // โค้ดผู้แนะนำ (optional): valid → ราคาลด % + เก็บโค้ดลงคำสั่งซื้อ
    // ⚠️ ไม่ผูก referrer ตรงนี้ — ผูกตอน admin อนุมัติเท่านั้น (จ่ายเงินจริงแล้ว)
    const rawRef = String(req.body?.refcode || '').trim();
    let paidAmount = baseAmount;
    let appliedRef: string | null = null;
    if (rawRef) {
      const chk = await checkRefcode(rawRef, userId);
      if (!chk.valid) {
        const msg = chk.reason === 'OWN_CODE' ? 'ใช้โค้ดของตัวเองไม่ได้' : 'โค้ดผู้แนะนำไม่ถูกต้อง';
        return res.status(400).json({ error: msg, errorCode: 'INVALID_REFCODE' });
      }
      paidAmount = applyRefDiscount(baseAmount, chk.discountPercent);
      appliedRef = rawRef.toLowerCase();
    }

    let slipUrl: string | null = null;
    if (req.file) {
      const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const rand = Math.random().toString(36).slice(2, 10);
      const key = `ebook-slip/${Date.now()}-${rand}.${ext}`;
      await uploadFile(req.file.buffer, key, req.file.mimetype, { contentDisposition: 'inline' });
      slipUrl = `/api/ebook-purchases/slips/${key}`;
    }

    const existing = await pool.query(`SELECT * FROM ebook_purchases WHERE user_id = $1 AND ebook_id = $2`, [userId, ebookId]);
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.status === 'approved') return res.status(400).json({ error: 'คุณซื้อ Ebook เล่มนี้แล้ว' });
      // โค้ดแรกชนะ: คำสั่งซื้อที่เคยใช้โค้ด A แล้ว ห้ามสลับเป็นโค้ด B ตอน resubmit
      if (appliedRef && row.refcode && row.refcode !== appliedRef) {
        return res.status(400).json({
          error: `คำสั่งซื้อนี้ใช้โค้ด ${row.refcode} ไปแล้ว เปลี่ยนโค้ดไม่ได้ — ลบโค้ดใหม่ออกแล้วส่งอีกครั้ง`,
          errorCode: 'REFCODE_LOCKED',
        });
      }
      // pending or rejected → (re)submit slip, back to pending
      // ราคา/โค้ด: อัปเดตเฉพาะเมื่อรอบนี้กรอกโค้ด (ไม่กรอก = คงของเดิม เผื่อโอนตามยอดลดไปแล้ว)
      await pool.query(
        `UPDATE ebook_purchases SET status='pending', rejection_reason=NULL, slip_url=COALESCE($2, slip_url),
           paid_amount=COALESCE($3, paid_amount, $5), refcode=COALESCE($4, refcode), updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [row.id, slipUrl, appliedRef ? paidAmount : null, appliedRef, baseAmount]
      );
      return res.json({ message: 'ส่งคำขอแล้ว รอการอนุมัติ', status: 'pending', paid_amount: appliedRef ? paidAmount : (row.paid_amount ?? baseAmount) });
    }

    const result = await pool.query(
      `INSERT INTO ebook_purchases (user_id, ebook_id, status, slip_url, paid_amount, refcode) VALUES ($1, $2, 'pending', $3, $4, $5) RETURNING *`,
      [userId, ebookId, slipUrl, paidAmount, appliedRef]
    );
    res.json({ message: 'ส่งคำขอแล้ว รอการอนุมัติ', purchase: result.rows[0] });
  } catch (error) {
    console.error('Error purchasing ebook:', error);
    res.status(500).json({ error: 'สั่งซื้อ Ebook ไม่สำเร็จ' });
  }
});

// ============ User: my purchases ============
router.get('/mine', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT p.*, b.title AS ebook_title, b.slug AS ebook_slug, b.cover_url
      FROM ebook_purchases p
      JOIN ebooks b ON p.ebook_id = b.id
      WHERE p.user_id = $1
      ORDER BY p.updated_at DESC
    `, [req.userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching my ebook purchases:', error);
    res.status(500).json({ error: 'โหลดรายการซื้อไม่สำเร็จ' });
  }
});

// =====================  ADMIN (purchase approval)  =====================

router.get('/admin/all', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { status, ebook_id, search, limit = 50, offset = 0 } = req.query;
    let where = ` WHERE 1=1`;
    const params: any[] = [];
    let i = 1;
    if (status) { where += ` AND p.status = $${i}`; params.push(status); i++; }
    if (ebook_id) { where += ` AND p.ebook_id = $${i}`; params.push(ebook_id); i++; }
    if (search) { where += ` AND u.email ILIKE $${i}`; params.push(`%${search}%`); i++; }
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM ebook_purchases p JOIN users u ON p.user_id = u.id${where}`, params);
    const result = await pool.query(`
      SELECT p.*, u.email AS user_email, b.title AS ebook_title, b.slug AS ebook_slug, b.price,
             approver.email AS approved_by_email
      FROM ebook_purchases p
      JOIN users u ON p.user_id = u.id
      JOIN ebooks b ON p.ebook_id = b.id
      LEFT JOIN users approver ON p.approved_by = approver.id
      ${where}
      ORDER BY p.updated_at DESC LIMIT $${i} OFFSET $${i + 1}
    `, [...params, limit, offset]);
    res.json({ purchases: result.rows, total: countResult.rows[0].total, limit: parseInt(limit as string), offset: parseInt(offset as string) });
  } catch (error) {
    console.error('Error fetching admin ebook purchases:', error);
    res.status(500).json({ error: 'โหลดรายการซื้อไม่สำเร็จ' });
  }
});

router.get('/admin/stats', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')  AS pending_count,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
        COUNT(*) AS total_count
      FROM ebook_purchases
    `);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching ebook purchase stats:', error);
    res.status(500).json({ error: 'โหลดสถิติไม่สำเร็จ' });
  }
});

router.put('/admin/:id/approve', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      UPDATE ebook_purchases SET status='approved', approved_by=$1, approved_at=CURRENT_TIMESTAMP, rejection_reason=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND status='pending' RETURNING *
    `, [req.userId, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ หรือถูกจัดการไปแล้ว' });
    await bindReferrerFromPurchase(result.rows[0]);
    await createEbookCommission(result.rows[0]);
    res.json({ message: 'อนุมัติแล้ว', purchase: result.rows[0] });
  } catch (error) {
    console.error('Error approving ebook purchase:', error);
    res.status(500).json({ error: 'อนุมัติไม่สำเร็จ' });
  }
});

router.put('/admin/:id/reject', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const result = await pool.query(`
      UPDATE ebook_purchases SET status='rejected', rejection_reason=$1, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND status='pending' RETURNING *
    `, [reason || null, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ หรือถูกจัดการไปแล้ว' });
    res.json({ message: 'ปฏิเสธแล้ว', purchase: result.rows[0] });
  } catch (error) {
    console.error('Error rejecting ebook purchase:', error);
    res.status(500).json({ error: 'ปฏิเสธไม่สำเร็จ' });
  }
});

router.put('/admin/:id/revoke', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const result = await pool.query(`
      UPDATE ebook_purchases SET status='rejected', rejection_reason=$1, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND status='approved' RETURNING *
    `, [reason || 'ถูกเพิกถอนสิทธิ์โดยแอดมิน', id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ หรือยังไม่ถูกอนุมัติ' });
    res.json({ message: 'เพิกถอนแล้ว', purchase: result.rows[0] });
  } catch (error) {
    console.error('Error revoking ebook purchase:', error);
    res.status(500).json({ error: 'เพิกถอนไม่สำเร็จ' });
  }
});

export default router;
