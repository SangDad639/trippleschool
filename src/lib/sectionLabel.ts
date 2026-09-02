import type { Language } from '@/lib/translations';

/**
 * ชื่อหมวดที่จะแสดงให้ผู้ใช้เห็น
 *
 * หมวดในคอร์สตั้งชื่อได้ 2 ทาง:
 *   1. เลือกจาก "หมวดหมู่กลาง" — มีทั้งไทย/อังกฤษ สลับตามภาษาที่ผู้ใช้เลือก (ทางหลัก)
 *   2. พิมพ์ชื่อเอง — สำหรับหมวดเฉพาะกิจที่ไม่เข้าหมวดหมู่ไหน (มีภาษาเดียว)
 *
 * หมวดหมู่มาก่อนเสมอ ถ้าเลือกไว้ — ไม่งั้นหมวดที่ backfill ผูกหมวดหมู่ให้แล้วแต่ยังมี
 * ชื่อเดิมค้างอยู่จะไม่ยอมสลับภาษา ซึ่งคือเหตุผลทั้งหมดที่ทำหมวดหมู่ขึ้นมา
 */
export function sectionLabel(
  section: { title?: string | null; category_en?: string | null; category_th?: string | null } | null | undefined,
  language: Language
): string {
  if (!section) return '';
  const fromCategory = language === 'en' ? section.category_en : section.category_th;
  if (fromCategory) return fromCategory;
  return section.title?.trim() || '';
}
