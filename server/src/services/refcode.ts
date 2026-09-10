// Refcode ตอน checkout — โค้ดผู้แนะนำ 1 โค้ดทำ 2 หน้าที่:
//   1) ผู้ซื้อได้ส่วนลด (% จาก affiliate_settings.refcode_discount_percent, default 5)
//   2) ผูก users.referrer_id ให้เจ้าของโค้ด (เฉพาะครั้งแรก — โค้ด valid โค้ดแรกชนะ)
// ใช้ร่วมกันทั้งซื้อรายคอร์ส (enrollments) และสมัครสมาชิก (subscription v2).
import pool from '../db.js';

export interface RefcodeCheck {
  valid: boolean;
  discountPercent: number;
  referrerId: number | null;
  // OWNER_INACTIVE = เจ้าของโค้ดไม่ได้เป็นสมาชิกที่ยังไม่หมดอายุ (กติกา R3)
  reason?: 'EMPTY' | 'NOT_FOUND' | 'OWN_CODE' | 'OWNER_INACTIVE';
}

/** % ส่วนลดจากการกรอกโค้ด (แถว singleton id=1) — fallback 5 ถ้าอ่านไม่ได้ */
export async function getRefcodeDiscountPercent(): Promise<number> {
  try {
    const r = await pool.query(`SELECT refcode_discount_percent FROM affiliate_settings WHERE id = 1`);
    const v = r.rows[0]?.refcode_discount_percent;
    return v != null ? parseFloat(v) : 5;
  } catch {
    return 5;
  }
}

/** normalize โค้ดทุกทาง (validate / checkout / ตั้งโค้ดเอง) — เก็บและเทียบเป็น lowercase เสมอ */
export function normalizeRefcode(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

/** ตรวจโค้ด: ต้องมีเจ้าของจริง + ไม่ใช่โค้ดของผู้ซื้อเอง (case-insensitive) + เจ้าของต้องเป็นสมาชิก active (R3) */
export async function checkRefcode(code: string, userId: number): Promise<RefcodeCheck> {
  const clean = normalizeRefcode(code);
  if (!clean) return { valid: false, discountPercent: 0, referrerId: null, reason: 'EMPTY' };
  const r = await pool.query(
    `SELECT id, (subscription_expires_at > NOW()) AS active FROM users WHERE LOWER(refcode) = $1 LIMIT 1`,
    [clean]
  );
  if (r.rows.length === 0) return { valid: false, discountPercent: 0, referrerId: null, reason: 'NOT_FOUND' };
  const ownerId = Number(r.rows[0].id);
  if (ownerId === Number(userId)) return { valid: false, discountPercent: 0, referrerId: null, reason: 'OWN_CODE' };
  if (!r.rows[0].active) return { valid: false, discountPercent: 0, referrerId: null, reason: 'OWNER_INACTIVE' };
  return { valid: true, discountPercent: await getRefcodeDiscountPercent(), referrerId: ownerId };
}

/** ผูกผู้แนะนำครั้งแรกเท่านั้น — ไม่ทับ referrer เดิม, กันชี้ตัวเอง */
export async function bindReferrerIfEmpty(userId: number, referrerId: number): Promise<void> {
  await pool.query(
    `UPDATE users SET referrer_id = $2 WHERE id = $1 AND referrer_id IS NULL AND id <> $2`,
    [userId, referrerId]
  );
}

/** ลดราคาแล้วปัดเป็นทศนิยม 2 ตำแหน่ง (ฝั่ง FE ต้องคำนวณสูตรเดียวกันเป๊ะ) */
export function applyRefDiscount(amount: number, pct: number): number {
  return Math.round(amount * (1 - pct / 100) * 100) / 100;
}

// ============================================================
// โค้ดส่วนลดของแอดมิน (admin_codes) — migration 069
//   ช่องกรอกโค้ดตอน checkout รับได้ 2 แบบ: โค้ดแอดมิน (ลดเท่ากัน · ไม่ผูก referrer · ไม่สร้างค่าคอม · เก็บ funnel)
//   หรือโค้ดผู้แนะนำของสมาชิก (checkRefcode เดิม) · namespace ไม่ชนกัน (ตรวจตอนสร้างทั้งสองทาง)
// ============================================================
export type CheckoutCodeKind = 'affiliate' | 'admin' | 'none';
export interface CheckoutCodeCheck {
  valid: boolean;
  kind: CheckoutCodeKind;
  discountPercent: number;
  /** เจ้าของโค้ดผู้แนะนำ (affiliate) — โค้ดแอดมินเป็น null เสมอ */
  referrerId: number | null;
  /** id ของ admin_codes เมื่อเป็นโค้ดแอดมิน — ใช้เก็บ funnel บนออเดอร์ */
  adminCodeId: number | null;
  adminCode?: { id: number; code: string; label: string | null };
  reason?: RefcodeCheck['reason'] | 'CODE_INACTIVE';
}

/** ตรวจโค้ดตอน checkout: โค้ดแอดมินก่อน (active → ใช้ได้ · inactive → CODE_INACTIVE) ไม่พบค่อยตกไป checkRefcode */
export async function checkCheckoutCode(code: string, userId: number): Promise<CheckoutCodeCheck> {
  const clean = normalizeRefcode(code);
  const none = (reason: CheckoutCodeCheck['reason']): CheckoutCodeCheck =>
    ({ valid: false, kind: 'none', discountPercent: 0, referrerId: null, adminCodeId: null, reason });
  if (!clean) return none('EMPTY');
  const a = await pool.query(`SELECT id, code, label, is_active FROM admin_codes WHERE LOWER(code) = $1 LIMIT 1`, [clean]);
  if (a.rows.length > 0) {
    const row = a.rows[0];
    if (!row.is_active) return none('CODE_INACTIVE');
    return {
      valid: true,
      kind: 'admin',
      discountPercent: await getRefcodeDiscountPercent(), // เท่ากับโค้ดผู้แนะนำ (user เคาะ)
      referrerId: null,
      adminCodeId: Number(row.id),
      adminCode: { id: Number(row.id), code: String(row.code), label: row.label ?? null },
    };
  }
  const r = await checkRefcode(clean, userId);
  return { valid: r.valid, kind: r.valid ? 'affiliate' : 'none', discountPercent: r.discountPercent, referrerId: r.referrerId, adminCodeId: null, reason: r.reason };
}

// ============================================================
// โค้ดกำหนดเอง (custom refcode) — migration 067
//   ผู้ใช้เปลี่ยน users.refcode เป็นโค้ดของตัวเองได้ไม่จำกัดครั้ง · โค้ดเก่าใช้ไม่ได้ทันที
//   เก็บ lowercase เสมอ → lookup เดิมทุกจุด (LOWER(refcode)) ทำงานต่อโดยไม่แก้
//   ความซ้ำตัดสินที่ DB (unique index users_refcode_lower_key → 23505) ไม่มี pre-check SELECT
//   ออเดอร์/log ที่ใช้โค้ดไปแล้วเก็บ referrer_user_id เป็น id → เปลี่ยนโค้ดไม่กระทบเงินของรายการเก่า
// ============================================================

/** รูปแบบโค้ด: 4-20 ตัว a-z 0-9, `-`/`_` ได้เฉพาะตรงกลาง (โค้ดวิ่งใน ?ref= และ FormData) — FE mirror regex นี้เพื่อ hint เท่านั้น */
export const REFCODE_RE = /^[a-z0-9](?:[a-z0-9_-]{2,18})[a-z0-9]$/;
export const REFCODE_MIN_LEN = 4;
export const REFCODE_MAX_LEN = 20;

/** คำสงวน (exact match หลัง normalize) — ผู้ใช้ทั่วไปตั้งไม่ได้ แอดมินตั้งให้บัญชีทีมงานได้ */
export const REFCODE_RESERVED = new Set([
  'admin', 'administrator', 'superadmin', 'root', 'staff', 'support', 'official', 'system',
  'test', 'null', 'undefined', 'api', 'www', 'login', 'register', 'affiliate', 'ref', 'refcode',
  'code', 'free', 'promo', 'discount', 'sale', 'vip', 'owner',
  'triple', 'tripleschool', 'triple-school', 'tripleviral', 'triplebot', 'triplegen',
]);

export type RefcodeErrorCode = 'REFCODE_INVALID_FORMAT' | 'REFCODE_RESERVED' | 'REFCODE_TAKEN' | 'USER_NOT_FOUND';

/** error ที่ route แปลงเป็น HTTP ได้ตรงๆ: `{ error: message, errorCode }` */
export class RefcodeError extends Error {
  constructor(public errorCode: RefcodeErrorCode, public status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = 'RefcodeError';
  }
}

export const REFCODE_FORMAT_MESSAGE =
  'โค้ดต้องยาว 4-20 ตัว ใช้ได้เฉพาะ a-z, 0-9 และ - หรือ _ คั่นกลาง และต้องมีตัวอักษรอย่างน้อย 1 ตัว';

/** ตรวจรูปแบบโค้ดที่ผู้ใช้เลือกเอง (โค้ดสุ่มเดิม 8 hex ไม่ถูก re-validate — อาจเป็นเลขล้วน) */
export function validateCustomRefcode(code: string, opts: { bypassReserved?: boolean } = {}): void {
  // ต้องมีตัวอักษรอย่างน้อย 1 ตัว — กันเอาเบอร์โทร/เลขบัตรมาเป็นโค้ดสาธารณะ
  if (!REFCODE_RE.test(code) || !/[a-z]/.test(code)) {
    throw new RefcodeError('REFCODE_INVALID_FORMAT', 400, REFCODE_FORMAT_MESSAGE);
  }
  if (!opts.bypassReserved && REFCODE_RESERVED.has(code)) {
    throw new RefcodeError('REFCODE_RESERVED', 400, 'โค้ดนี้สงวนไว้ กรุณาใช้โค้ดอื่น');
  }
}

/**
 * ตั้งโค้ดใหม่ให้ผู้ใช้ (ตัวเองหรือแอดมิน) ใน transaction เดียว:
 *   FOR UPDATE แถวตัวเอง (กัน double-click) → UPDATE → บันทึก refcode_changes → COMMIT
 *   ซ้ำกับคนอื่น → unique index โยน 23505 → REFCODE_TAKEN 409 (ไม่มี TOCTOU)
 *   โค้ดเดิม == ใหม่ → { changed: false } ไม่บันทึกอะไร
 */
export async function setUserRefcode(
  userId: number,
  raw: unknown,
  opts: { changedBy: number; bypassReserved: boolean }
): Promise<{ refcode: string; changed: boolean }> {
  const next = normalizeRefcode(raw);
  validateCustomRefcode(next, { bypassReserved: opts.bypassReserved });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT refcode FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    if (cur.rows.length === 0) throw new RefcodeError('USER_NOT_FOUND', 404, 'ไม่พบผู้ใช้');
    const old: string | null = cur.rows[0].refcode ? String(cur.rows[0].refcode).toLowerCase() : null;
    if (old === next) {
      await client.query('ROLLBACK');
      return { refcode: next, changed: false };
    }
    // 069: ห้ามจับจองโค้ดที่เป็นโค้ดส่วนลดของแอดมิน (ทั้ง active/inactive) — namespace เดียวกันตอน checkout
    const clash = await client.query(`SELECT 1 FROM admin_codes WHERE LOWER(code) = $1 LIMIT 1`, [next]);
    if (clash.rows.length > 0) throw new RefcodeError('REFCODE_TAKEN', 409, 'โค้ดนี้มีคนใช้แล้ว กรุณาใช้โค้ดอื่น');
    await client.query(`UPDATE users SET refcode = $1 WHERE id = $2`, [next, userId]);
    await client.query(
      `INSERT INTO refcode_changes (user_id, old_refcode, new_refcode, changed_by) VALUES ($1, $2, $3, $4)`,
      [userId, old, next, opts.changedBy]
    );
    await client.query('COMMIT');
    console.log(
      `[Affiliate][AUDIT] refcode ${old ?? '(none)'} → ${next} user ${userId} by ${opts.changedBy}${opts.bypassReserved ? ' (admin)' : ''}`
    );
    return { refcode: next, changed: true };
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* ไม่มี txn ค้าง */ }
    if (err?.code === '23505') throw new RefcodeError('REFCODE_TAKEN', 409, 'โค้ดนี้มีคนใช้แล้ว กรุณาใช้โค้ดอื่น');
    throw err;
  } finally {
    client.release();
  }
}
