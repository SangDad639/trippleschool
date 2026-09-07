// สถานะสมาชิกของผู้ใช้ — แยก "รายเดือน" กับ "รายปี" ได้ (กติกา 7 ก.ย. 2026: รายเดือนอ่าน Ebook ได้อย่างเดียว
// รายปีดาวน์โหลดได้) · การมีสิทธิ์อยู่ที่ users.subscription_expires_at เหมือนเดิม ส่วนประเภทแผนอ่านจาก
// subscriptions.plan_type (slug ของ subscription_plans — monthly / yearly / แผนที่แอดมินสร้าง)
import type { Pool, PoolClient } from 'pg';
import pool from '../db.js';

export interface Membership {
  active: boolean;
  /** slug แผนปัจจุบัน (null ถ้าไม่ active หรือไม่มีแถว subscriptions) */
  planSlug: string | null;
  /** แผนระยะ ≥ 365 วัน หรือ slug 'yearly' — แผนรายปีที่แอดมินสร้างเองก็นับ */
  isYearly: boolean;
  expiresAt: string | null;
}

const YEARLY_MIN_DAYS = 365;

export async function getMembership(userId: number, db: Pool | PoolClient = pool): Promise<Membership> {
  const r = await db.query(
    `SELECT u.subscription_expires_at, s.plan_type, p.days AS plan_days
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       LEFT JOIN subscription_plans p ON p.slug = s.plan_type
      WHERE u.id = $1
      ORDER BY s.updated_at DESC NULLS LAST
      LIMIT 1`,
    [userId]
  );
  const row = r.rows[0];
  if (!row) return { active: false, planSlug: null, isYearly: false, expiresAt: null };
  const active = !!row.subscription_expires_at && new Date(row.subscription_expires_at) > new Date();
  const planSlug = row.plan_type ? String(row.plan_type) : null;
  const days = row.plan_days != null ? Number(row.plan_days) : null;
  const isYearly = active && (planSlug === 'yearly' || (days != null && days >= YEARLY_MIN_DAYS));
  return {
    active,
    planSlug: active ? planSlug : null,
    isYearly,
    expiresAt: row.subscription_expires_at ? new Date(row.subscription_expires_at).toISOString() : null,
  };
}
