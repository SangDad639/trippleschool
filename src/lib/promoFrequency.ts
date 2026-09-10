/**
 * ความถี่โฆษณาแทรก (user เคาะ 10 ก.ย. 2026): ผู้เรียน 1 คน เห็นโฆษณา 1 ตัวซ้ำได้เมื่อครบ N วัน — แอดมินตั้ง N เอง (0 = ทุกครั้ง)
 * - นับต่อ "ผู้เรียน" ไม่ใช่ต่อคลิป: เห็นโฆษณาเริ่มเล่น 1 ครั้งจากบท/คอร์สไหนก็ได้ = เห็นแล้ว
 * - รอบ (cycle): แอดมินเปลี่ยนวัน/โฆษณา/กดรีเซ็ต → cycle_started_at ใหม่ → ประวัติก่อนหน้านั้นไม่นับ (ทุกคนเห็นอีกครั้ง)
 * - ล็อกอิน: เซิร์ฟเวอร์จำใน promo_views (payload คอร์สส่ง `promos_seen` ที่ยังติดอยู่ + `promo_cooldown_days` + `promo_cycle_started_at`)
 *   และ FE จำใน localStorage ด้วย (ให้บทถัดไปในหน้าเดิมรู้ทันทีโดยไม่ต้องโหลดคอร์สใหม่)
 * - ไม่ล็อกอิน: localStorage อย่างเดียว (ต่อเบราว์เซอร์) ใช้ N วัน + รอบ จาก payload คอร์สเหมือนกัน
 */
import { api } from '@/lib/api';

export const DEFAULT_PROMO_COOLDOWN_DAYS = 7;
const KEY = 'ts_promo_seen_map'; // { [promoId]: ms ที่เห็นล่าสุด }

export interface PromoCooldown {
  /** N วัน (0 = แสดงทุกครั้ง) */
  cooldownDays?: number | null;
  /** ISO เวลาเริ่มรอบปัจจุบัน — ประวัติที่เก่ากว่านี้ไม่นับ */
  cycleStartedAt?: string | null;
}

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}
function writeMap(map: Record<string, number>) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* private mode */ }
}
const daysOf = (c?: PromoCooldown) => {
  const n = Number(c?.cooldownDays);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PROMO_COOLDOWN_DAYS;
};
const cycleMsOf = (c?: PromoCooldown) => {
  const t = c?.cycleStartedAt ? Date.parse(c.cycleStartedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** โฆษณานี้ยัง "ติด cooldown" ไหม — เซิร์ฟเวอร์บอก (ล็อกอิน) หรือ localStorage (ทุกคน) ตาม N วัน + รอบปัจจุบัน */
export function isPromoOnCooldown(promoId: number, serverSeen?: number[] | null, cooldown?: PromoCooldown): boolean {
  const days = daysOf(cooldown);
  if (days <= 0) return false; // 0 = ทุกครั้ง
  if (Array.isArray(serverSeen) && serverSeen.includes(promoId)) return true;
  const at = readMap()[String(promoId)];
  if (typeof at !== 'number') return false;
  if (at < cycleMsOf(cooldown)) return false; // เห็นก่อนรอบปัจจุบัน → ไม่นับ
  return Date.now() - at < days * 86400_000;
}

/** บันทึกว่าเห็นโฆษณานี้แล้ว (เรียกตอนโฆษณาเริ่มเล่น) — localStorage ทันที + แจ้งเซิร์ฟเวอร์ best-effort (ล็อกอินถึงถูกเก็บ) */
export function markPromoSeen(promoId: number): void {
  const map = readMap();
  map[String(promoId)] = Date.now();
  // กันโต: เก็บไม่เกิน 1 ปีย้อนหลัง (N สูงสุด 365)
  for (const k of Object.keys(map)) if (Date.now() - map[k] >= 366 * 86400_000) delete map[k];
  writeMap(map);
  api.markPromoSeen(promoId).catch(() => { /* fail-open — localStorage ยังกันซ้ำในเบราว์เซอร์นี้ */ });
}

/** ล้างประวัติ "เห็นแล้ว" ของโฆษณานี้ (ของตัวเอง) — localStorage + เซิร์ฟเวอร์ · ใช้ปุ่ม 🔁 ในหน้าแอดมิน */
export async function clearPromoSeen(promoId: number): Promise<void> {
  const map = readMap();
  delete map[String(promoId)];
  writeMap(map);
  await api.clearPromoSeen(promoId);
}
