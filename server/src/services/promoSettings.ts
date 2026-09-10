// ตั้งค่าโฆษณาก่อนเริ่มทุกคลิป (promo_settings แถวเดียว id=1 · migration 070; 071 ถอดจุดแทรกรายบททิ้ง — นี่คือทางเดียว)
//   is_enabled + promo_id  → ทุกบทที่มีวิดีโอ ทุกคอร์ส (รวมบทที่สร้างทีหลัง) ได้ pre-roll — courses.ts ส่ง pre_roll_promo_id ใน payload คอร์ส
//   cooldown_days          → ผู้เรียน 1 คนเห็นโฆษณาซ้ำได้เมื่อครบ N วัน (0 = ทุกครั้ง) นับต่อผู้เรียน ไม่ใช่ต่อคลิป
//   cycle_started_at       → รอบปัจจุบัน: ประวัติ "เห็นแล้ว" ก่อนเวลานี้ไม่นับ (แอดมินเปลี่ยนวัน/โฆษณา/กดรีเซ็ต = NOW())
// แยกไฟล์จาก routes/promos.ts เพื่อไม่ให้ courses.ts ↔ promos.ts import วนกัน
import pool from '../db.js';

export interface PromoSettings {
  is_enabled: boolean;
  promo_id: number | null;
  /** โฆษณาที่เลือกยังเปิดใช้อยู่ไหม (LEFT JOIN promo_videos) — ปิดใช้/ถูกลบ = false */
  promo_is_active: boolean;
  cooldown_days: number;
  cycle_started_at: Date;
  updated_at: Date | null;
}

export const DEFAULT_PROMO_COOLDOWN_DAYS = 7;
const CACHE_MS = 30_000;
let cache: { at: number; value: PromoSettings } | null = null;

const FALLBACK: PromoSettings = {
  is_enabled: false,
  promo_id: null,
  promo_is_active: false,
  cooldown_days: DEFAULT_PROMO_COOLDOWN_DAYS,
  cycle_started_at: new Date(0),
  updated_at: null,
};

/** อ่านตั้งค่า (cache 30 วิ) — ตารางยังไม่มี/อ่านพัง → fallback ปิดใช้ + 7 วัน (fail-open) */
export async function getPromoSettings(): Promise<PromoSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const r = await pool.query(
      `SELECT ps.is_enabled, ps.promo_id, ps.cooldown_days, ps.cycle_started_at, ps.updated_at,
              COALESCE(pv.is_active, false) AS promo_is_active
         FROM promo_settings ps LEFT JOIN promo_videos pv ON pv.id = ps.promo_id
        WHERE ps.id = 1`
    );
    const row = r.rows[0];
    const value: PromoSettings = row
      ? {
          is_enabled: !!row.is_enabled,
          promo_id: row.promo_id == null ? null : Number(row.promo_id),
          promo_is_active: !!row.promo_is_active,
          cooldown_days: Number(row.cooldown_days ?? DEFAULT_PROMO_COOLDOWN_DAYS),
          cycle_started_at: row.cycle_started_at ? new Date(row.cycle_started_at) : new Date(0),
          updated_at: row.updated_at ? new Date(row.updated_at) : null,
        }
      : FALLBACK;
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    console.error('[promo-settings] read failed (fail-open):', e);
    return FALLBACK;
  }
}

/** ต้องเรียกทุกครั้งที่ promo_settings เปลี่ยน หรือ promo_videos ถูกปิดใช้/ลบ (cache ถือ promo_is_active ด้วย) */
export function invalidatePromoSettingsCache(): void {
  cache = null;
}

/** id โฆษณาที่จะเล่นก่อนเริ่ม "ทุกคลิป" ตอนนี้ — null = ไม่มี (ปิดใช้ / ไม่ได้เลือก / โฆษณาปิดใช้หรือถูกลบ) */
export function preRollPromoId(s: PromoSettings): number | null {
  return s.is_enabled && s.promo_id != null && s.promo_is_active ? s.promo_id : null;
}

/**
 * id โฆษณาที่ผู้เรียนคนนี้ "เห็นแล้ว" ในรอบปัจจุบันและยังไม่ครบ N วัน → FE ไม่แสดงซ้ำ
 * cooldown 0 = ไม่มีอะไรติด (แสดงทุกครั้ง) · เช็คทั้ง N วัน และ cycle_started_at
 */
export async function getPromosSeenByUser(userId: number, settings?: PromoSettings): Promise<number[]> {
  const s = settings ?? (await getPromoSettings());
  if (s.cooldown_days <= 0) return [];
  const r = await pool.query<{ promo_id: number }>(
    `SELECT promo_id FROM promo_views
      WHERE user_id = $1
        AND last_seen_at > NOW() - ($2::int * INTERVAL '1 day')
        AND last_seen_at >= $3`,
    [userId, s.cooldown_days, s.cycle_started_at]
  );
  return r.rows.map((x) => Number(x.promo_id));
}
