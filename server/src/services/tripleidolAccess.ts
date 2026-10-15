// สิทธิ์ใช้ Triple Idol (โปรแกรม desktop · repo Triple-Idol) ของบัญชี Triple School
//
//   กติกา 15 ต.ค. 2026 — บัญชี school ทุกคนล็อกอินเข้าแอปได้ ไม่ต้องเป็นสมาชิกก่อน
//     ฟรี    : 1 การ์ด · Facebook / Instagram / TikTok แพลตฟอร์มละ 1 บัญชี · เชื่อมบัญชีแล้วลบ/เปลี่ยนไม่ได้
//     สมาชิก : subscription ของ school ยัง active (users.subscription_expires_at) หรือเป็นแอดมิน
//              → 100 การ์ด · ไม่จำกัดบัญชี · ปลดล็อกเองทันทีที่แอปถาม /me รอบถัดไป (ทุก 60 วิ)
//   ตาราง desktop_app_access (migration 078) เก็บเครื่องที่ถือเซสชัน + card_limit_override ของแอดมิน
//
//   ฟังก์ชันที่รับ `db` ทดสอบได้โดยไม่ต่อ DB (routes/__tests__/tripleidol.test.ts ยัด DB ปลอม)
import type { Pool } from 'pg';
import { getMembership } from './membership.js';

export const APP_KEY = 'tripleidol';
export const FREE_CARD_LIMIT = 1;
export const MEMBER_CARD_LIMIT = 100;
export const FREE_ACCOUNTS_PER_PLATFORM = 1;
/**
 * สิทธิ์ "เข้าแอป" ไม่มีวันหมด — ระดับสิทธิ์ (ฟรี/สมาชิก) อยู่ใน permissions.tier แทน
 * แอปตีความปี ≥ 2100 ว่า lifetime (models.UserAuth.lifetime) จึงไม่ล็อกหน้าจอเพราะ "หมดอายุ"
 * เมื่อสมาชิกหมด แต่ลดเหลือระดับฟรีแทน
 */
export const ACCESS_NO_END = '2999-12-31T00:00:00.000Z';

/** พอสำหรับ route/service นี้ — pg.Pool/PoolClient เข้าได้ และเทสต์เขียน DB ปลอมได้โดยไม่ต้องเลียน overload ของ pg */
export interface Db {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export type IdolTier = 'free' | 'member';

export interface IdolUserRow {
  id: number;
  email: string;
  is_admin: boolean | null;
  is_super_admin: boolean | null;
  is_approved: boolean | null;
  join_date?: Date | string | null;
}

export interface IdolAccessRow {
  device_id: string | null;
  card_limit_override: number | null;
}

export interface IdolPermissions {
  tier: IdolTier;
  cardLimit: number;
  /** วันหมดสมาชิก school (ISO) — null เมื่อไม่ได้เป็นสมาชิก · แอดมินได้ 'member' โดยไม่มีวัน */
  memberUntil: string | null;
  /** จำนวนบัญชีต่อแพลตฟอร์มที่เชื่อมได้ · null = ไม่จำกัด */
  accountsPerPlatform: number | null;
  /** true = เชื่อมบัญชีแล้วลบ/เปลี่ยนไม่ได้ (ระดับฟรี) */
  accountsLocked: boolean;
}

/** คอลัมน์ที่ route ต้องใช้ — อ่าน is_guide_admin ผ่าน to_jsonb แบบเดียวกับ routes/auth.ts (คอลัมน์อาจยังไม่มี) */
export const IDOL_USER_COLUMNS = `
  id, email, password_hash, is_admin, is_approved, join_date,
  COALESCE(is_super_admin, false) AS is_super_admin,
  COALESCE((to_jsonb(users.*) ->> 'is_guide_admin')::boolean, false) AS is_guide_admin`;

export function isAdminRow(row: Pick<IdolUserRow, 'is_admin' | 'is_super_admin'>): boolean {
  return row.is_admin === true || row.is_super_admin === true;
}

export function idolPermissions(input: {
  isAdmin: boolean;
  memberActive: boolean;
  memberUntil: string | null;
  override: number | null | undefined;
}): IdolPermissions {
  const member = input.isAdmin || input.memberActive;
  const base = member ? MEMBER_CARD_LIMIT : FREE_CARD_LIMIT;
  const override = input.override;
  const cardLimit =
    typeof override === 'number' && Number.isInteger(override) && override >= 0 ? override : base;
  return {
    tier: member ? 'member' : 'free',
    cardLimit,
    memberUntil: input.memberActive ? input.memberUntil : null,
    accountsPerPlatform: member ? null : FREE_ACCOUNTS_PER_PLATFORM,
    accountsLocked: !member,
  };
}

/**
 * รูปที่แอปอ่าน (Triple-Idol: auth.py → idol_hub._store_session)
 * ห้ามตัด appAllowed ออก — แอป fail-closed: ไม่มีฟิลด์นี้ = ออกจากระบบทันที
 */
export function shapeIdolUser(row: IdolUserRow, permissions: IdolPermissions) {
  return {
    id: row.id,
    email: row.email,
    name: '',
    role: isAdminRow(row) ? 'admin' : 'user',
    accountStatus: 'active',
    appAllowed: true,
    subscriptionEnd: ACCESS_NO_END,
    app: APP_KEY,
    permissions,
  };
}

export async function loadIdolAccess(db: Db, userId: number): Promise<IdolAccessRow | null> {
  const r = await db.query(
    `SELECT device_id, card_limit_override FROM desktop_app_access WHERE user_id = $1 AND app_key = $2`,
    [userId, APP_KEY]
  );
  return (r.rows[0] as IdolAccessRow | undefined) ?? null;
}

/**
 * ล็อกอินสำเร็จ: จดเครื่องที่ถือเซสชัน (เครื่องล่าสุดชนะ — เครื่องเก่าจะได้ DEVICE_CHANGED ที่ /me รอบถัดไป)
 * ไม่ส่ง device_id มา (เช่น ยิงจาก curl) = ไม่แตะการผูกเครื่องเดิม
 */
export async function bindIdolDevice(db: Db, userId: number, deviceId: string | null): Promise<void> {
  const dev = deviceId && deviceId.length <= 64 ? deviceId : null;
  await db.query(
    `INSERT INTO desktop_app_access (user_id, app_key, device_id, device_bound_at, last_login_at)
     VALUES ($1, $2, $3, CASE WHEN $3::varchar IS NULL THEN NULL ELSE NOW() END, NOW())
     ON CONFLICT (user_id, app_key) DO UPDATE SET
       device_id       = COALESCE(EXCLUDED.device_id, desktop_app_access.device_id),
       device_bound_at = CASE WHEN EXCLUDED.device_id IS NULL
                              THEN desktop_app_access.device_bound_at ELSE NOW() END,
       last_login_at   = NOW(),
       updated_at      = NOW()`,
    [userId, APP_KEY, dev]
  );
}

/** ออกจากระบบ: ปล่อยเครื่องเฉพาะเมื่อเป็นเครื่องที่ถืออยู่ (หรือไม่บอกเครื่อง) — เครื่องอื่นสั่ง logout แทนกันไม่ได้ */
export async function releaseIdolDevice(db: Db, userId: number, deviceId: string | undefined): Promise<void> {
  await db.query(
    `UPDATE desktop_app_access
        SET device_id = NULL, device_bound_at = NULL, updated_at = NOW()
      WHERE user_id = $1 AND app_key = $2
        AND ($3::varchar IS NULL OR device_id IS NULL OR device_id = $3)`,
    [userId, APP_KEY, deviceId ?? null]
  );
}

/** เครื่องที่ถามมาไม่ใช่เครื่องที่ถือเซสชัน — เฉพาะเมื่อรู้ทั้งสองฝั่ง (คำขอที่ไม่ส่ง header ไม่ถูกเตะ) */
export function deviceMismatch(bound: string | null | undefined, presented: string | undefined): boolean {
  return !!bound && !!presented && bound !== presented;
}

export async function buildIdolUser(db: Db, row: IdolUserRow, access?: IdolAccessRow | null) {
  const membership = await getMembership(row.id, db as unknown as Pool);
  const acc = access === undefined ? await loadIdolAccess(db, row.id) : access;
  const permissions = idolPermissions({
    isAdmin: isAdminRow(row),
    memberActive: membership.active,
    memberUntil: membership.expiresAt,
    override: acc?.card_limit_override ?? null,
  });
  return shapeIdolUser(row, permissions);
}
