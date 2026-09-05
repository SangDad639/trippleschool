/**
 * Ebooks — under the "Ebook" menu. Access modes per ebook (mutually exclusive):
 *   - ฟรี:      price = 0, members_only = false → anyone, no login
 *   - สมาชิก:   members_only = true             → active subscription required
 *   - ขายรายเล่ม: price > 0, members_only = false → bought (ebook_purchases
 *     approved) OR active subscription (สมาชิกอ่านเล่มขายได้เลย — กติกาธุรกิจ)
 * Extra flag: allow_download: false → view-only, no attachment download.
 *
 * List/detail responses never include the raw file_url/file_name to the
 * public — only /:slug/file streams bytes, re-checking entitlement on every
 * request (a stored URL alone must never be enough to get the file; see the
 * gated route below). Cover images and the ebook file itself are uploaded
 * via the existing courses endpoints (/upload-thumbnail, /upload-material);
 * this router only stores the returned pointer and re-serves it itself.
 * การสั่งซื้อ/อนุมัติอยู่ที่ routes/ebookPurchases.ts (/api/ebook-purchases).
 */
import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { authenticate, optionalAuth, optionalAuthQueryOrHeader, requireAdmin, JWT_SECRET, AuthRequest } from '../middleware/auth.js';
import { hasActiveSubscription } from '../services/stripeService.js';
import { getFile, uploadFile } from '../utils/s3.js';
import { makePreviewPdf } from '../utils/pdfPreview.js';
import { sanitizeCourseSamples } from './courses.js';

const router = Router();
const EBOOK_FILE_TOKEN_PURPOSE = 'ebook-file';

/**
 * Short-lived (10min), single-ebook-scoped token for members_only files.
 * Deliberately NOT the user's normal session JWT: that token is long-lived
 * (7d) and grants full account access, so embedding it in a plain <a>/<iframe>
 * URL would leak it into browser download history for every ebook — even
 * free ones. This token can only ever be used to fetch one specific ebook's
 * file, and only after hasActiveSubscription was already re-checked at mint
 * time (see /:slug/access-token below).
 */
function verifyEbookFileToken(token: string, slug: string): boolean {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { purpose?: string; slug?: string };
    return decoded.purpose === EBOOK_FILE_TOKEN_PURPOSE && decoded.slug === slug;
  } catch {
    return false;
  }
}

const MATERIALS_PREFIX = '/api/courses/materials/';

function sanitizeSlug(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9฀-๿-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

/** "ข้างในมีอะไร" — bullet หน้า detail: string ล้วน ตัดว่าง จำกัด 20 ข้อ/ข้อละ 200 ตัว */
function sanitizeHighlights(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 20);
}

/** ราคา ≥ 0 ปัด 2 ตำแหน่ง — คืน null เมื่อค่าที่ส่งมาใช้ไม่ได้ (ให้ caller ตอบ 400) */
function sanitizePrice(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** จำนวนหน้า: int > 0 หรือ null (ไม่กรอก/ล้างค่า) */
function sanitizePages(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * รหัสลิงก์สั้นประจำเล่ม (/ebooks/{code}) — ชุดอักขระเดียวกับคอร์ส (migration 048/058):
 * ตัด 0/o/1/l/i ที่อ่านสับสน และตัวแรกเป็นตัวอักษรเสมอ
 */
function generateShareCode(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function uniqueShareCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateShareCode();
    const clash = await pool.query(
      `SELECT 1 FROM ebooks WHERE share_code = $1 OR slug = $1 LIMIT 1`,
      [code]
    );
    if (clash.rows.length === 0) return code;
  }
  throw new Error('generate ebook share code failed');
}

/** Extracts the S3 key from a stored courses-materials proxy URL. */
function materialsKey(fileUrl: unknown): string | null {
  if (typeof fileUrl !== 'string' || !fileUrl.startsWith(MATERIALS_PREFIX)) return null;
  return fileUrl.slice(MATERIALS_PREFIX.length);
}

function isPdfFile(row: { file_name: string | null; file_url: string | null }): boolean {
  return (row.file_name || row.file_url || '').toLowerCase().endsWith('.pdf');
}

/** เล่มที่ต้องมีสิทธิ์ก่อนถึงจะเข้าไฟล์ได้ = สมาชิกเท่านั้น หรือ เล่มขายรายเล่ม */
function requiresEntitlement(ebook: { members_only: boolean; price?: number | string | null }): boolean {
  // NUMERIC จาก pg มาเป็น string — ต้อง Number() ก่อนเทียบเสมอ
  return ebook.members_only || Number(ebook.price) > 0;
}

/**
 * สิทธิ์ของ viewer ต่อ "หลายเล่ม" ในคำขอเดียว — โหลดครั้งเดียวแล้วใช้ซ้ำทุกแถว
 * (list ยาวจะได้ไม่ยิง subscription/purchase query ซ้ำต่อเล่ม)
 */
type EntitleCtx = { isSubscriber: boolean; purchased: Set<number> };
async function loadEntitleCtx(req: AuthRequest): Promise<EntitleCtx> {
  if (!req.userId) return { isSubscriber: false, purchased: new Set() };
  const [sub, bought] = await Promise.all([
    hasActiveSubscription(req.userId),
    pool.query(`SELECT ebook_id FROM ebook_purchases WHERE user_id = $1 AND status = 'approved'`, [req.userId]),
  ]);
  return { isSubscriber: sub, purchased: new Set(bought.rows.map((r: any) => Number(r.ebook_id))) };
}

/**
 * Admins always qualify; free ebooks need no check. เล่มขาย: ซื้อแล้ว (approved)
 * หรือเป็นสมาชิกก็เข้าได้ — เช็คแถวซื้อเสมอไม่ผูกโหมด กันเคสแอดมินสลับโหมด
 * เล่มทีหลังแล้วคนที่จ่ายเงินไปแล้วหลุดสิทธิ์
 */
function entitledFor(req: AuthRequest, ebook: any, ctx: EntitleCtx): boolean {
  if (!requiresEntitlement(ebook) || req.isAdmin) return true;
  if (!req.userId) return false;
  return ctx.isSubscriber || ctx.purchased.has(Number(ebook.id));
}

/** สิทธิ์ต่อเล่มเดียว (detail / file / access-token) */
async function computeEntitled(req: AuthRequest, ebook: any): Promise<boolean> {
  if (!requiresEntitlement(ebook) || req.isAdmin) return true;
  if (!req.userId) return false;
  return entitledFor(req, ebook, await loadEntitleCtx(req));
}

/** Public-facing row: strips the raw file pointer, adds viewer-relative flags. */
function publicRow(row: any, entitled: boolean, myPurchase?: any) {
  // preview_*_url ก็ถูก strip เหมือน file_url — ประตูเดียวที่เสิร์ฟตัวอย่างคือ /:slug/preview-file
  const { file_url, file_name, preview_file_url, preview_cache_url, ...rest } = row;
  return {
    ...rest,
    has_file: !!file_url,
    is_pdf: isPdfFile(row),
    // มีตัวอย่างให้อ่านไหม: ไฟล์ตัวอย่างอัพเอง หรือ ตั้งจำนวนหน้าไว้และมีไฟล์เต็มให้ตัด
    has_preview: !!preview_file_url || (Number(row.preview_pages) > 0 && !!file_url),
    entitled,
    // คำสั่งซื้อของ viewer เอง (เฉพาะหน้า detail) — ให้ FE โชว์สถานะ รออนุมัติ/ถูกปฏิเสธ
    my_purchase: myPurchase
      ? {
          status: myPurchase.status,
          paid_amount: myPurchase.paid_amount,
          refcode: myPurchase.refcode,
          rejection_reason: myPurchase.rejection_reason,
        }
      : null,
  };
}

// ============ Admin: list all (incl. inactive) ============
// NOTE: named routes must be registered before /:slug.
router.get('/admin/all', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM ebooks ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin ebooks:', error);
    res.status(500).json({ error: 'โหลด Ebook ไม่สำเร็จ' });
  }
});

// ============ Public: list active ebooks ============
router.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM ebooks WHERE is_active = true ORDER BY display_order ASC, created_at DESC`
    );
    const ctx = await loadEntitleCtx(req);
    res.json(result.rows.map((row) => publicRow(row, entitledFor(req, row, ctx))));
  } catch (error) {
    console.error('Error fetching ebooks:', error);
    res.status(500).json({ error: 'โหลด Ebook ไม่สำเร็จ' });
  }
});

// ============ Public: one ebook ============
// Admins may open inactive ebooks (preview before publishing).
router.get('/:slug', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    // รับทั้ง slug ปกติและรหัสลิงก์สั้น (/ebooks/{share_code}) — แบบเดียวกับคอร์ส
    const result = await pool.query(`SELECT * FROM ebooks WHERE slug = $1 OR share_code = LOWER($1)`, [req.params.slug]);
    const ebook = result.rows[0];
    if (!ebook || (!ebook.is_active && !req.isAdmin)) {
      return res.status(404).json({ error: 'ไม่พบ Ebook' });
    }
    const entitled = await computeEntitled(req, ebook);
    // แนบสถานะคำสั่งซื้อของ viewer (ถ้ามี) ให้หน้า detail โชว์ รออนุมัติ/ถูกปฏิเสธ ได้
    let myPurchase: any = null;
    if (req.userId) {
      const p = await pool.query(
        `SELECT status, paid_amount, refcode, rejection_reason FROM ebook_purchases WHERE user_id = $1 AND ebook_id = $2`,
        [req.userId, ebook.id]
      );
      myPurchase = p.rows[0] || null;
    }
    res.json(publicRow(ebook, entitled, myPurchase));
  } catch (error) {
    console.error('Error fetching ebook:', error);
    res.status(500).json({ error: 'โหลด Ebook ไม่สำเร็จ' });
  }
});

// ============ Public (gated): stream the file itself ============
// The only door to the actual bytes — re-validates members_only and
// allow_download on every request, so a previously-seen URL is never enough
// on its own (unlike the generic /api/courses/materials/* proxy, which is
// intentionally dumb/always-public). ?token= lets a plain <a>/<iframe>
// navigation (which can't set an Authorization header) still prove who's
// logged in when the ebook is members_only.
router.get('/:slug/file', optionalAuthQueryOrHeader, async (req: AuthRequest, res: Response) => {
  try {
    // รับทั้ง slug ปกติและรหัสลิงก์สั้น (/ebooks/{share_code}) — แบบเดียวกับคอร์ส
    const result = await pool.query(`SELECT * FROM ebooks WHERE slug = $1 OR share_code = LOWER($1)`, [req.params.slug]);
    const ebook = result.rows[0];
    if (!ebook || (!ebook.is_active && !req.isAdmin)) {
      return res.status(404).json({ error: 'ไม่พบ Ebook' });
    }
    const key = materialsKey(ebook.file_url);
    if (!key) return res.status(404).json({ error: 'ยังไม่มีไฟล์' });

    const mode = req.query.mode === 'view' ? 'view' : 'download';
    if (mode === 'download' && !ebook.allow_download) {
      return res.status(403).json({ error: 'Ebook นี้เปิดให้อ่านอย่างเดียว ดาวน์โหลดไม่ได้' });
    }
    // ครอบทั้งเล่มสมาชิกและเล่มขายรายเล่ม — เล่มขายที่หลุด gate นี้ = โหลดฟรีได้
    if (requiresEntitlement(ebook) && !req.isAdmin) {
      const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
      const scopedTokenOk = queryToken ? verifyEbookFileToken(queryToken, ebook.slug) : false;
      if (!scopedTokenOk) {
        // Fall back to the normal session (covers an admin/logged-in member
        // browsing the API directly without going through the minted-token flow).
        if (!req.userId) {
          return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน', code: 'AUTH_REQUIRED' });
        }
        if (!(await computeEntitled(req, ebook))) {
          if (ebook.members_only) {
            return res.status(403).json({ error: 'Ebook นี้สำหรับสมาชิกเท่านั้น', code: 'MEMBERS_ONLY', subscriptionUrl: '/pricing' });
          }
          return res.status(403).json({ error: 'ต้องซื้อ Ebook เล่มนี้ก่อนถึงจะเข้าถึงไฟล์ได้', code: 'PURCHASE_REQUIRED' });
        }
      }
    }

    const obj = await getFile(key);
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    const dispositionType = mode === 'view' ? 'inline' : 'attachment';
    const name = typeof ebook.file_name === 'string' && ebook.file_name ? ebook.file_name : '';
    res.setHeader(
      'Content-Disposition',
      name ? `${dispositionType}; filename*=UTF-8''${encodeURIComponent(name)}` : dispositionType
    );
    // Access is re-checked per request (membership can expire) — never cache.
    res.setHeader('Cache-Control', 'private, no-store');
    (obj.Body as any).pipe(res);
  } catch (error) {
    console.error('Error streaming ebook file:', error);
    res.status(500).json({ error: 'โหลดไฟล์ไม่สำเร็จ' });
  }
});

// ============ Public: อ่านตัวอย่างจำกัดหน้า (เล่มสมาชิก/เล่มขาย) ============
// เปิดสาธารณะโดยตั้งใจ — ไฟล์ที่เสิร์ฟมีแค่หน้าตัวอย่างจริงๆ (ตัดด้วย pdf-lib หรือ
// ไฟล์ที่แอดมินอัพเอง) ไฟล์เต็มยังอยู่หลัง gate /:slug/file ตามเดิม
// ลำดับ: ① ไฟล์ตัวอย่างอัพเอง (override) ② แคชที่เคยตัดไว้ ③ ตัดสดจากไฟล์เต็มแล้วแคช
router.get('/:slug/preview-file', async (req, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM ebooks WHERE slug = $1 OR share_code = LOWER($1)`, [req.params.slug]);
    const ebook = result.rows[0];
    if (!ebook || !ebook.is_active) return res.status(404).json({ error: 'ไม่พบ Ebook' });
    // เล่มฟรีไม่มีตัวอย่าง — อ่านเต็มได้อยู่แล้ว
    if (!requiresEntitlement(ebook)) return res.status(404).json({ error: 'เล่มนี้อ่านได้เต็มเล่มอยู่แล้ว' });

    const sendPdf = (body: Buffer | NodeJS.ReadableStream) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      // ตัวอย่างเป็นของสาธารณะโดยนิยาม — แคชได้ (ต่างจากไฟล์เต็มที่ no-store)
      res.setHeader('Cache-Control', 'public, max-age=3600');
      if (Buffer.isBuffer(body)) res.end(body);
      else (body as any).pipe(res);
    };

    // ① ไฟล์ตัวอย่างที่แอดมินอัพเอง — ใช้แทนการตัดอัตโนมัติเสมอ
    const overrideKey = materialsKey(ebook.preview_file_url);
    if (overrideKey) {
      const obj = await getFile(overrideKey);
      return sendPdf(obj.Body as any);
    }

    const previewPages = Number(ebook.preview_pages) || 0;
    const fullKey = materialsKey(ebook.file_url);
    if (previewPages <= 0 || !fullKey) {
      return res.status(404).json({ error: 'เล่มนี้ไม่มีตัวอย่างให้อ่าน' });
    }

    // ② แคชที่ตัดไว้แล้ว (พังค่อยตกไปตัดใหม่ — เช่น object ถูกลบ)
    if (ebook.preview_cache_url) {
      try {
        const cached = await getFile(ebook.preview_cache_url);
        return sendPdf(cached.Body as any);
      } catch {
        /* แคชหาย → ตัดใหม่ด้านล่าง */
      }
    }

    // ③ ตัดสดจากไฟล์เต็ม แล้วแคชลง S3 (ครั้งเดียวต่อการตั้งค่า)
    const obj = await getFile(fullKey);
    const chunks: Buffer[] = [];
    for await (const c of obj.Body as any) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const out = await makePreviewPdf(Buffer.concat(chunks), previewPages);
    if (!out) {
      // ไฟล์เข้ารหัส/เสีย หรือทั้งเล่มสั้นกว่าจำนวนหน้าตัวอย่างจนตัดแล้วเท่ากับแจกทั้งเล่ม
      return res.status(404).json({ error: 'ทำไฟล์ตัวอย่างไม่ได้ — ลองอัพไฟล์ตัวอย่างเองในหน้าแอดมิน' });
    }
    const rand = Math.random().toString(36).slice(2, 10);
    const cacheKey = `ebook-preview/${ebook.id}-${previewPages}p-${rand}.pdf`;
    await uploadFile(out, cacheKey, 'application/pdf', { contentDisposition: 'inline' });
    await pool.query(`UPDATE ebooks SET preview_cache_url = $1 WHERE id = $2`, [cacheKey, ebook.id]);
    return sendPdf(out);
  } catch (error) {
    console.error('Error serving ebook preview:', error);
    res.status(500).json({ error: 'โหลดตัวอย่างไม่สำเร็จ' });
  }
});

// ============ Mint a scoped file token for a members_only ebook ============
// Requires a real session (Authorization header) — re-checks the subscription
// right now, then issues the short-lived single-ebook token /:slug/file
// accepts, so a plain <a>/<iframe> link never needs the long-lived session JWT.
router.get('/:slug/access-token', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // รับทั้ง slug ปกติและรหัสลิงก์สั้น (/ebooks/{share_code}) — แบบเดียวกับคอร์ส
    const result = await pool.query(`SELECT * FROM ebooks WHERE slug = $1 OR share_code = LOWER($1)`, [req.params.slug]);
    const ebook = result.rows[0];
    if (!ebook || (!ebook.is_active && !req.isAdmin)) {
      return res.status(404).json({ error: 'ไม่พบ Ebook' });
    }
    if (!requiresEntitlement(ebook)) {
      return res.status(400).json({ error: 'Ebook นี้ไม่ต้องขอสิทธิ์เข้าถึง' });
    }
    if (!req.isAdmin && !(await computeEntitled(req, ebook))) {
      if (ebook.members_only) {
        return res.status(403).json({ error: 'Ebook นี้สำหรับสมาชิกเท่านั้น', code: 'MEMBERS_ONLY', subscriptionUrl: '/pricing' });
      }
      return res.status(403).json({ error: 'ต้องซื้อ Ebook เล่มนี้ก่อนถึงจะเข้าถึงไฟล์ได้', code: 'PURCHASE_REQUIRED' });
    }
    const token = jwt.sign({ purpose: EBOOK_FILE_TOKEN_PURPOSE, slug: ebook.slug }, JWT_SECRET, { expiresIn: '10m' });
    res.json({ token });
  } catch (error) {
    console.error('Error minting ebook access token:', error);
    res.status(500).json({ error: 'ขอสิทธิ์เข้าถึงไม่สำเร็จ' });
  }
});

// ============ Admin: create ============
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, cover_url, file_url, file_name, is_active, display_order, allow_download, members_only, author_name, author_avatar_url, hook, cover_orientation } = req.body;
    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'กรุณาใส่ชื่อ Ebook' });
    const slug = sanitizeSlug(req.body.slug) || sanitizeSlug(title);
    if (!slug) return res.status(400).json({ error: 'สร้าง slug จากชื่อไม่ได้ — กรุณากำหนด slug เอง (a-z, 0-9, -)' });
    const price = req.body.price === undefined || req.body.price === '' ? 0 : sanitizePrice(req.body.price);
    if (price === null) return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' });
    const membersOnly = typeof members_only === 'boolean' ? members_only : false;
    // โหมดต่อเล่มต้องชัดทางเดียว: สมาชิกเท่านั้น กับ ขายรายเล่ม ตั้งพร้อมกันไม่ได้
    if (membersOnly && price > 0) {
      return res.status(400).json({ error: 'เลือกได้อย่างเดียว: "สมาชิกเท่านั้น" หรือ "ขายรายเล่ม (ตั้งราคา)"' });
    }
    const result = await pool.query(
      `INSERT INTO ebooks (title, slug, description, cover_url, file_url, file_name, is_active, display_order, allow_download, members_only,
                           price, pages, author_name, author_avatar_url, hook, highlights, samples, share_code, cover_orientation,
                           preview_pages, preview_file_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19, $20, $21) RETURNING *`,
      [
        title.trim(),
        slug,
        typeof description === 'string' && description ? description : null,
        typeof cover_url === 'string' && cover_url ? cover_url : null,
        typeof file_url === 'string' && file_url ? file_url : null,
        typeof file_name === 'string' && file_name ? file_name : null,
        typeof is_active === 'boolean' ? is_active : true,
        Number.isInteger(display_order) ? display_order : 0,
        typeof allow_download === 'boolean' ? allow_download : true,
        membersOnly,
        price,
        req.body.pages === undefined ? null : sanitizePages(req.body.pages),
        typeof author_name === 'string' && author_name.trim() ? author_name.trim().slice(0, 255) : null,
        typeof author_avatar_url === 'string' && author_avatar_url ? author_avatar_url : null,
        typeof hook === 'string' && hook.trim() ? hook.trim().slice(0, 1000) : null,
        JSON.stringify(sanitizeHighlights(req.body.highlights)),
        JSON.stringify(sanitizeCourseSamples(req.body.samples)),
        await uniqueShareCode(),
        cover_orientation === 'portrait' ? 'portrait' : 'landscape',
        Number.isInteger(Number(req.body.preview_pages)) && Number(req.body.preview_pages) > 0 ? Number(req.body.preview_pages) : 0,
        typeof req.body.preview_file_url === 'string' && req.body.preview_file_url ? req.body.preview_file_url : null,
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    if ((error as any).code === '23505') return res.status(400).json({ error: 'slug นี้ถูกใช้แล้ว — เปลี่ยน slug ใหม่' });
    console.error('Error creating ebook:', error);
    res.status(500).json({ error: 'สร้าง Ebook ไม่สำเร็จ' });
  }
});

// ============ Admin: update ============
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad ebook id' });
    const { title, description, cover_url, file_url, file_name, is_active, display_order, allow_download, members_only, author_name, author_avatar_url, hook, cover_orientation } = req.body;
    const slug = req.body.slug !== undefined ? sanitizeSlug(req.body.slug) : undefined;
    if (slug === '') return res.status(400).json({ error: 'slug ไม่ถูกต้อง (a-z, 0-9, -)' });
    // ราคา: '' = ล้างเป็น 0 (เลิกขาย), ค่าเพี้ยน → 400
    let price: number | null | undefined = undefined;
    if (req.body.price !== undefined) {
      price = req.body.price === '' || req.body.price === null ? 0 : sanitizePrice(req.body.price);
      if (price === null) return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' });
    }
    // กันโหมดชนกันแบบ partial update: ต้องรู้ค่าปลายทางจริงทั้งคู่ก่อนตัดสิน
    if (price !== undefined || typeof members_only === 'boolean') {
      const cur = await pool.query(`SELECT price, members_only FROM ebooks WHERE id = $1`, [id]);
      if (cur.rows.length === 0) return res.status(404).json({ error: 'ไม่พบ Ebook' });
      const nextPrice = price !== undefined ? price : Number(cur.rows[0].price) || 0;
      const nextMembers = typeof members_only === 'boolean' ? members_only : cur.rows[0].members_only;
      if (nextMembers && nextPrice > 0) {
        return res.status(400).json({ error: 'เลือกได้อย่างเดียว: "สมาชิกเท่านั้น" หรือ "ขายรายเล่ม (ตั้งราคา)"' });
      }
    }
    // Unspecified fields stay untouched; sending '' explicitly clears a nullable field.
    const nullable = (v: unknown) => (v === undefined ? undefined : typeof v === 'string' && v === '' ? null : v);
    const sets: string[] = [];
    const params: any[] = [];
    const add = (col: string, value: unknown) => {
      if (value === undefined) return;
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };
    add('title', typeof title === 'string' && title.trim() ? title.trim() : undefined);
    add('slug', slug);
    add('description', nullable(description));
    add('cover_url', nullable(cover_url));
    add('file_url', nullable(file_url));
    add('file_name', nullable(file_name));
    add('is_active', typeof is_active === 'boolean' ? is_active : undefined);
    add('display_order', Number.isInteger(display_order) ? display_order : undefined);
    add('allow_download', typeof allow_download === 'boolean' ? allow_download : undefined);
    add('members_only', typeof members_only === 'boolean' ? members_only : undefined);
    add('price', price);
    if (req.body.pages !== undefined) add('pages', sanitizePages(req.body.pages));
    add('author_name', nullable(typeof author_name === 'string' ? author_name.trim().slice(0, 255) : author_name));
    add('author_avatar_url', nullable(author_avatar_url));
    add('hook', nullable(typeof hook === 'string' ? hook.trim().slice(0, 1000) : hook));
    if (req.body.highlights !== undefined) {
      params.push(JSON.stringify(sanitizeHighlights(req.body.highlights)));
      sets.push(`highlights = $${params.length}::jsonb`);
    }
    if (req.body.samples !== undefined) {
      params.push(JSON.stringify(sanitizeCourseSamples(req.body.samples)));
      sets.push(`samples = $${params.length}::jsonb`);
    }
    if (cover_orientation !== undefined) {
      add('cover_orientation', cover_orientation === 'portrait' ? 'portrait' : 'landscape');
    }
    if (req.body.preview_pages !== undefined) {
      const pv = Number(req.body.preview_pages);
      add('preview_pages', Number.isInteger(pv) && pv > 0 ? pv : 0);
    }
    add('preview_file_url', nullable(req.body.preview_file_url));
    // ไฟล์เต็มหรือจำนวนหน้าตัวอย่างเปลี่ยน → แคชที่ตัดไว้ใช้ไม่ได้แล้ว ล้างทิ้งให้ตัดใหม่รอบหน้า
    if (file_url !== undefined || req.body.preview_pages !== undefined) {
      add('preview_cache_url', null);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' });
    params.push(id);
    const result = await pool.query(
      `UPDATE ebooks SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบ Ebook' });
    res.json(result.rows[0]);
  } catch (error) {
    if ((error as any).code === '23505') return res.status(400).json({ error: 'slug นี้ถูกใช้แล้ว — เปลี่ยน slug ใหม่' });
    console.error('Error updating ebook:', error);
    res.status(500).json({ error: 'แก้ไข Ebook ไม่สำเร็จ' });
  }
});

// ============ Admin: delete ============
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad ebook id' });
    const result = await pool.query(`DELETE FROM ebooks WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบ Ebook' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting ebook:', error);
    res.status(500).json({ error: 'ลบ Ebook ไม่สำเร็จ' });
  }
});

export default router;
