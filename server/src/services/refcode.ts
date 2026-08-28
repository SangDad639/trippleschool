// Refcode ตอน checkout — โค้ดผู้แนะนำ 1 โค้ดทำ 2 หน้าที่:
//   1) ผู้ซื้อได้ส่วนลด (% จาก affiliate_settings.refcode_discount_percent, default 5)
//   2) ผูก users.referrer_id ให้เจ้าของโค้ด (เฉพาะครั้งแรก — โค้ด valid โค้ดแรกชนะ)
// ใช้ร่วมกันทั้งซื้อรายคอร์ส (enrollments) และสมัครสมาชิก (subscription v2).
import pool from '../db.js';

export interface RefcodeCheck {
  valid: boolean;
  discountPercent: number;
  referrerId: number | null;
  reason?: 'EMPTY' | 'NOT_FOUND' | 'OWN_CODE';
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

/** ตรวจโค้ด: ต้องมีเจ้าของจริง + ไม่ใช่โค้ดของผู้ซื้อเอง (case-insensitive) */
export async function checkRefcode(code: string, userId: number): Promise<RefcodeCheck> {
  const clean = String(code || '').trim().toLowerCase();
  if (!clean) return { valid: false, discountPercent: 0, referrerId: null, reason: 'EMPTY' };
  const r = await pool.query(`SELECT id FROM users WHERE LOWER(refcode) = $1 LIMIT 1`, [clean]);
  if (r.rows.length === 0) return { valid: false, discountPercent: 0, referrerId: null, reason: 'NOT_FOUND' };
  const ownerId = Number(r.rows[0].id);
  if (ownerId === Number(userId)) return { valid: false, discountPercent: 0, referrerId: null, reason: 'OWN_CODE' };
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
