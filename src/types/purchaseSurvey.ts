/**
 * แบบสอบถามหลังซื้อ (backend: routes/purchaseSurveys.ts · migration 079)
 *   ถาม 2 ข้อทันทีหลังซื้อ — สมาชิกรายเดือน/รายปี (หน้า checkout-complete) และคอร์สเดี่ยว (กล่องหลังส่งสลิป)
 *   ข้อ 1 เหตุผลที่ซื้อ (free text ≤ 500) · ข้อ 2 คอร์สที่สนใจ (เลือกหลายคอร์ส ≤ 20) · ข้ามได้
 */

export const PURCHASE_SURVEY_REASON_MAX = 500;
export const PURCHASE_SURVEY_COURSES_MAX = 20;

/** การซื้อที่กำลังถาม — ใช้ระบุแถวใน purchase_surveys (1 แถวต่อ 1 การซื้อ) */
export type PurchaseRef =
  | { type: 'subscription'; extensionLogId: number; planSlug: 'monthly' | 'yearly' }
  | { type: 'course'; courseId: number; courseName: string };

/** body ของ POST /api/purchase-surveys */
export interface PurchaseSurveyInput {
  purchase_type: 'subscription' | 'course';
  extension_log_id?: number;
  plan_slug?: 'monthly' | 'yearly';
  course_id?: number;
  reason?: string;
  course_ids?: number[];
  /** true = ข้าม (บันทึกไว้กันถามซ้ำ — server ไม่ทับคำตอบที่เคยส่งแล้ว) */
  skipped?: boolean;
}

/** แปลง PurchaseRef → ฟิลด์ระบุการซื้อใน body */
export function purchaseRefToInput(ref: PurchaseRef): PurchaseSurveyInput {
  return ref.type === 'subscription'
    ? { purchase_type: 'subscription', extension_log_id: ref.extensionLogId, plan_slug: ref.planSlug }
    : { purchase_type: 'course', course_id: ref.courseId };
}

/** แถวในหน้า /admin/purchase-surveys (GET /api/purchase-surveys/admin/all) */
export interface AdminPurchaseSurvey {
  id: number;
  purchase_type: 'subscription' | 'course';
  plan_slug: string | null;
  reason: string | null;
  skipped: boolean;
  created_at: string;
  updated_at: string;
  user_id: number;
  user_email: string;
  /** คอร์สที่ซื้อ (เฉพาะ purchase_type = 'course') */
  course_id: number | null;
  course_name: string | null;
  course_slug: string | null;
  extension_log_id: number | null;
  enrollment_id: number | null;
  /** คอร์สที่บอกว่าสนใจ */
  interested: { id: number; name: string; slug: string }[];
}

export interface AdminPurchaseSurveyList {
  surveys: AdminPurchaseSurvey[];
  top_courses: { id: number; name: string; slug: string; n: number }[];
  totals: { answered: number; skipped: number; subscription: number; course: number };
}
