/**
 * รีวิวคอร์สจากผู้เรียน (ตาราง course_reviews · routes/courses.ts)
 *   หน้าคอร์ส: GET /api/courses/:slug/reviews (public, เฉพาะคอร์สนั้น)
 *   หน้าแอดมิน /admin/reviews: GET /api/courses/admin/reviews (ทุกคอร์ส เรียงใหม่ → เก่า)
 */

/** แถวในหน้า /admin/reviews — รีวิว 1 ใบ + ข้อมูลคอร์ส/ผู้รีวิวที่แอดมินต้องใช้ */
export interface AdminReview {
  id: number;
  rating: number;
  comment: string | null;
  created_at: string;
  /** ผู้เรียนแก้รีวิวซ้ำได้ (upsert) — ถ้าหลัง created_at = เคยแก้ */
  updated_at: string;
  user_id: number;
  /** ส่วนหน้า @ ของอีเมล (ชื่อที่โชว์ในหน้าคอร์ส) */
  reviewer: string;
  reviewer_email: string;
  course_id: number;
  course_name: string;
  course_slug: string;
  course_is_active: boolean;
}
