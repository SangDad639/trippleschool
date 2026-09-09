/**
 * ความถี่โฆษณาแทรก: 1 โฆษณา แสดงต่อผู้เรียน 1 คน ได้ครั้งเดียวต่อ 7 วัน (user เคาะ 9 ก.ย. 2026)
 * - ล็อกอิน: เซิร์ฟเวอร์จำใน promo_views (payload /:slug/full ส่ง `promos_seen` = id ที่ยังอยู่ในช่วง 7 วัน)
 *   และ FE จำใน localStorage ด้วย (ให้บทถัดไปในหน้าเดิมรู้ทันทีโดยไม่ต้องโหลดคอร์สใหม่)
 * - ไม่ล็อกอิน: localStorage อย่างเดียว (ต่อเบราว์เซอร์)
 */
import { api } from '@/lib/api';

export const PROMO_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const KEY = 'ts_promo_seen_map'; // { [promoId]: ms ที่ดูล่าสุด }

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

/** โฆษณานี้อยู่ในช่วง 7 วันหลังดูครั้งล่าสุดไหม (จาก localStorage + รายการที่เซิร์ฟเวอร์ส่งมา) */
export function isPromoOnCooldown(promoId: number, serverSeen?: number[] | null): boolean {
  if (Array.isArray(serverSeen) && serverSeen.includes(promoId)) return true;
  const at = readMap()[String(promoId)];
  return typeof at === 'number' && Date.now() - at < PROMO_COOLDOWN_MS;
}

/** บันทึกว่าดูโฆษณานี้แล้ว — localStorage ทันที + แจ้งเซิร์ฟเวอร์แบบ best-effort (ล็อกอินถึงจะถูกเก็บ) */
export function markPromoSeen(promoId: number): void {
  try {
    const map = readMap();
    map[String(promoId)] = Date.now();
    // กันโต: เก็บเฉพาะที่ยังอยู่ในช่วง 7 วัน
    for (const k of Object.keys(map)) if (Date.now() - map[k] >= PROMO_COOLDOWN_MS) delete map[k];
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* private mode */ }
  api.markPromoSeen(promoId).catch(() => { /* fail-open — localStorage ยังกันซ้ำในเบราว์เซอร์นี้ */ });
}
