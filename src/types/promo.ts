/**
 * โฆษณาแทรกในวิดีโอบทเรียน (backend: routes/promos.ts · migration 065)
 */

/** meta ที่ผู้เรียนได้จาก GET /api/promos/:id — ไม่มี video_key */
export interface PromoMeta {
  id: number;
  title: string;
  /** 'youtube' = คลิป YouTube (เล่นผ่าน IFrame API) · 'file' = ไฟล์ที่อัปโหลด (เล่นผ่าน <video> จาก video_url) */
  source_type: 'youtube' | 'file';
  youtube_id: string | null;
  /** เฉพาะ file: /api/promos/:id/video?v=… (รองรับ HTTP Range) */
  video_url: string | null;
  poster_url: string | null;
  click_url: string | null;
  /** วินาทีที่ข้ามได้ · null = ห้ามข้าม · 0 = ข้ามได้ทันที */
  skip_after_sec: number | null;
  duration_sec: number | null;
}

/** แถวในหน้าแอดมิน (GET /api/promos/admin/all) */
export interface PromoAdmin extends PromoMeta {
  youtube_url: string | null;
  content_type: string;
  size_bytes: number | null;
  is_active: boolean;
  /** จำนวนจุดแทรกที่ใช้โฆษณานี้ */
  usage_count: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/** body ของ POST/PUT /api/promos — ส่ง youtube_url หรือ video_key อย่างใดอย่างหนึ่ง */
export interface PromoInput {
  title?: string;
  youtube_url?: string | null;
  video_key?: string | null;
  size_bytes?: number | null;
  content_type?: string;
  duration_sec?: number | null;
  poster_url?: string | null;
  click_url?: string | null;
  skip_after_sec?: number | null;
  is_active?: boolean;
}

/** จุดแทรกของบทเรียน — offset_sec 0 = ก่อนเริ่ม, ≥ 5 = กลางคลิป */
export interface LessonPromoSlot {
  promo_id: number;
  offset_sec: number;
}
