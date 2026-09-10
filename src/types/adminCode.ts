/**
 * โค้ดส่วนลดของแอดมิน (backend: routes/adminCodes.ts · migration 069)
 *   ลดราคาเท่าโค้ดผู้แนะนำ · ไม่มีค่าคอม · ผูกกับบทเรียน/คอร์สเพื่อเก็บ funnel · ไม่มีวันหมดอายุ
 */

/** แถวในตาราง Video | Code | Count (GET /api/admin-codes/admin/all) */
export interface AdminCode {
  id: number;
  code: string;
  label: string | null;
  course_id: number | null;
  course_name: string | null;
  lesson_id: number | null;
  lesson_title: string | null;
  lesson_order: number | null;
  lesson_share_code: string | null;
  is_active: boolean;
  /** จำนวนคน (distinct) ที่ชำระสำเร็จผ่านโค้ดนี้ = คอร์สอนุมัติแล้ว + สมัครสมาชิกผ่านสลิปแล้ว */
  count_success: number;
  count_course: number;
  count_sub: number;
  /** คอร์สที่รออนุมัติ — ไม่นับใน count_success */
  count_pending: number;
  /** ยอดรวมที่จ่ายจริง (คอร์ส paid_amount + สมาชิก subtotal ก่อน VAT) */
  revenue: number;
  last_used_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/** body ของ POST/PUT /api/admin-codes — code ว่างตอนสร้าง = ระบบสุ่มให้ · PUT เปลี่ยน code ไม่ได้ */
export interface AdminCodeInput {
  code?: string;
  label?: string | null;
  course_id?: number | null;
  lesson_id?: number | null;
  is_active?: boolean;
}

/** รายการใช้โค้ด (GET /api/admin-codes/:id/usage) */
export interface AdminCodeUsage {
  type: 'course' | 'subscription';
  ref_id: number;
  /** อีเมล mask กลาง เช่น so****@gmail.com */
  user_email: string;
  item: string;
  amount: number | null;
  status: string;
  created_at: string;
}
