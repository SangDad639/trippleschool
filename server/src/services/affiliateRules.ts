// กติกา affiliate ทางการ (docs/AFFILIATE-SYSTEM.md §1) — helper ที่ route หลายตัวใช้ร่วมกัน
//   R3 เจ้าของโค้ดต้องเป็นสมาชิกที่ยังไม่หมดอายุ ณ เวลาที่ผู้ซื้อชำระเงิน/ถูกอนุมัติ
//   R7 ค่าคอมเฉพาะ "สมัครครั้งแรก" = บัญชีไม่เคยมี subscription มาก่อนเลย (ต่ออายุไม่ได้คอม)
//   R8 ยกเลิก/คืนเงิน → pending ยกเลิก (cancelled), จ่ายแล้วบันทึกเป็นยอดหักคืน (clawback) ให้แอดมินตามเอง
import type { Pool, PoolClient } from 'pg';
import pool from '../db.js';

type Db = Pool | PoolClient;

/** สมาชิกที่ยังไม่หมดอายุ ณ ตอนนี้ */
export async function isActiveMember(userId: number, db: Db = pool): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM users WHERE id = $1 AND subscription_expires_at > NOW()`,
    [userId]
  );
  return r.rows.length > 0;
}

/**
 * บัญชีนี้เคยมี subscription มาก่อนไหม (ใช้ตัดสิน R7) — ต้องเรียก "ก่อน" บันทึกการชำระรอบปัจจุบัน
 * นับทั้ง subscription_expires_at ที่เคยถูกตั้ง (แม้หมดอายุแล้ว) และประวัติต่ออายุทุกช่องทาง
 */
export async function hasSubscriptionHistory(userId: number, db: Db = pool): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM users u
      WHERE u.id = $1
        AND (u.subscription_expires_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM subscription_extension_logs l WHERE l.user_id = u.id))`,
    [userId]
  );
  return r.rows.length > 0;
}

export interface CancelledCommission {
  id: number;
  referrer_id: number;
  status: 'cancelled' | 'clawback';
  net_amount: number;
}

// pending → cancelled (ยังไม่จ่าย ตัดทิ้งได้เลย) · transferred → clawback (จ่ายไปแล้ว บันทึกยอดติดลบไว้ให้แอดมินตาม)
const CANCEL_SQL = `
  UPDATE affiliate_commissions
     SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE 'clawback' END,
         cancelled_at = NOW(), cancelled_by = $2, cancel_reason = $3
   WHERE %WHERE% AND status IN ('pending', 'transferred')
   RETURNING id, referrer_id, status, COALESCE(net_amount, amount)::float AS net_amount`;

/** ยกเลิกค่าคอมทุกแถวของคำสั่งซื้อเดียว (key = stripe_invoice_id เช่น course_12 / ebook_3 / sub_45) */
export async function cancelCommissionsBySource(
  sourceKey: string, reason: string, adminId: number | null, db: Db = pool
): Promise<CancelledCommission[]> {
  const r = await db.query(CANCEL_SQL.replace('%WHERE%', 'stripe_invoice_id = $1'), [sourceKey, adminId, reason]);
  for (const row of r.rows) {
    console.log(`[Affiliate][AUDIT] commission #${row.id} → ${row.status} (source=${sourceKey}, by admin ${adminId ?? '-'}): ${reason}`);
  }
  return r.rows;
}

/** ยกเลิกค่าคอมรายแถว (แอดมินกดเอง) — คืน null ถ้าไม่พบหรือถูกยกเลิกไปแล้ว */
export async function cancelCommissionById(
  id: number, reason: string, adminId: number | null, db: Db = pool
): Promise<CancelledCommission | null> {
  const r = await db.query(CANCEL_SQL.replace('%WHERE%', 'id = $1'), [id, adminId, reason]);
  const row = r.rows[0] ?? null;
  if (row) console.log(`[Affiliate][AUDIT] commission #${row.id} → ${row.status} (by admin ${adminId ?? '-'}): ${reason}`);
  return row;
}
