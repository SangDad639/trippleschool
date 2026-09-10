/**
 * โฆษณาก่อนเริ่มวิดีโอบทเรียน (backend: routes/promos.ts · migration 065/066/070; 071 ถอดจุดแทรกรายบทแล้ว)
 * ทางเดียว: promo_settings (การ์ด ⚙️) → โฆษณาตัวเดียวเล่นก่อนเริ่มทุกคลิป · payload คอร์สส่ง pre_roll_promo_id
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
  created_by: number | null;
  created_at: string;
  updated_at: string;
  /** แอดมินคนนี้เคยเห็นโฆษณานี้ล่าสุดเมื่อ (ISO) — null = ไม่เคย */
  seen_by_me_at?: string | null;
  /** ยังติด cooldown ตามตั้งค่าปัจจุบันไหม (ในรอบ + ยังไม่ครบ N วัน) */
  seen_by_me_active?: boolean;
}

/** ตั้งค่าโฆษณาก่อนเริ่มทุกคลิป (promo_settings · migration 070) */
export interface PromoSettings {
  is_enabled: boolean;
  promo_id: number | null;
  /** ผู้เรียน 1 คนเห็นซ้ำได้เมื่อครบ N วัน · 0 = ทุกครั้ง */
  cooldown_days: number;
  /** เวลาเริ่มรอบปัจจุบัน — ประวัติเห็นแล้วก่อนหน้านี้ไม่นับ */
  cycle_started_at: string;
  updated_at: string | null;
}
export interface PromoSettingsInput {
  is_enabled?: boolean;
  promo_id?: number | null;
  cooldown_days?: number;
  /** true = เริ่มรอบใหม่ทันที (ทุกคนเห็นอีกครั้ง) */
  reset_cycle?: boolean;
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
