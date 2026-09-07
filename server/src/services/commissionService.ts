/**
 * Commission resolution service.
 *
 * กติกา R2 (docs/AFFILIATE-SYSTEM.md §1): ค่าคอม % คงที่ทุกคน ทุกสินค้า (แพ็กเกจ/คอร์ส/ebook)
 * อ่านจาก affiliate_settings.commission_percent (migration 062, default 15 — super admin แก้ได้ที่ /admin/affiliate)
 *
 * chain เดิม (matrix → plan → users.commission_percent → affiliate_tiers → tier1_percent → 20)
 * เลิกใช้แล้ว: user_package_commissions / affiliate_tiers / users.commission_percent เป็นซากจาก fork
 * ไม่มีผลกับเงินอีก (matrix CRUD ด้านล่างคงไว้ให้ route แอดมินเดิม compile ได้เท่านั้น)
 */

import pool from '../db.js';

export interface CommissionResolution {
  percent: number;          // 0-100
  source: 'settings_flat' | 'default';
  planId: number | null;
  planSlug: string | null;
}

export const DEFAULT_COMMISSION_PERCENT = 15;

/** % คอมคงที่จาก affiliate_settings แถว 1 — fallback 15 ถ้าคอลัมน์ยังไม่มี/อ่านไม่ได้ */
export async function getCommissionPercentSetting(): Promise<Pick<CommissionResolution, 'percent' | 'source'>> {
  try {
    const r = await pool.query<{ commission_percent: string | null }>(
      'SELECT commission_percent FROM affiliate_settings WHERE id = 1'
    );
    const v = r.rows[0]?.commission_percent;
    if (v != null && Number.isFinite(parseFloat(v))) {
      return { percent: parseFloat(v), source: 'settings_flat' };
    }
  } catch { /* ก่อน migration 062 — ใช้ default */ }
  return { percent: DEFAULT_COMMISSION_PERCENT, source: 'default' };
}

/**
 * % คอมที่ referrer ได้จากการซื้อครั้งนี้ — คงที่ทุกคนตาม R2
 * (รับ referrerId/planSlug/planId ไว้เพื่อ signature เดิมของ caller และ echo กลับใน log เท่านั้น)
 */
export async function resolveCommissionPercent(opts: {
  referrerId: number;
  planSlug?: string | null;
  planId?: number | null;
}): Promise<CommissionResolution> {
  const { percent, source } = await getCommissionPercentSetting();
  return { percent, source, planId: opts.planId ?? null, planSlug: opts.planSlug ?? null };
}

/* ------------------------------------------------------------------ */
/*  User × Package matrix CRUD                                         */
/* ------------------------------------------------------------------ */

export interface UserPackageCommission {
  id: number;
  user_id: number;
  plan_id: number;
  commission_percent: number;
  created_at: string;
  updated_at: string;
}

export async function listUserOverrides(userId: number): Promise<UserPackageCommission[]> {
  const r = await pool.query(
    `SELECT id, user_id, plan_id, commission_percent::float AS commission_percent,
            created_at, updated_at
       FROM user_package_commissions
      WHERE user_id = $1
      ORDER BY plan_id ASC`,
    [userId]
  );
  return r.rows;
}

export async function upsertUserOverride(
  userId: number,
  planId: number,
  commissionPercent: number
): Promise<UserPackageCommission> {
  const r = await pool.query(
    `INSERT INTO user_package_commissions (user_id, plan_id, commission_percent)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, plan_id) DO UPDATE
       SET commission_percent = EXCLUDED.commission_percent,
           updated_at = NOW()
     RETURNING id, user_id, plan_id, commission_percent::float AS commission_percent,
               created_at, updated_at`,
    [userId, planId, commissionPercent]
  );
  return r.rows[0];
}

export async function deleteUserOverride(userId: number, planId: number): Promise<boolean> {
  const r = await pool.query(
    'DELETE FROM user_package_commissions WHERE user_id = $1 AND plan_id = $2',
    [userId, planId]
  );
  return (r.rowCount ?? 0) > 0;
}
