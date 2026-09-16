/**
 * "บทในคลิป" (chapters) ของบทเรียน — backend: services/lessonChapters.ts · migration 072
 * แหล่ง: manual (แอดมินแก้เอง) > youtube (timestamp ในคำอธิบายคลิป) > ai (สรุปจากซับแบบมีเวลา)
 */
export interface LessonChapter {
  /** เวลาเริ่มบท (วินาที) */
  sec: number;
  title: string;
  /** ภาพเฟรมของบท (path ใต้ /api/courses/thumbnails/ — ห่อ api.mediaUrl) · ไม่มี = ยังไม่ได้ทำ */
  thumb?: string;
}
export type ChaptersSource = 'manual' | 'youtube' | 'ai';

/** GET /api/courses/lessons/:id/chapters/status (admin) */
export interface LessonChaptersStatus {
  lesson_id: number;
  has_video: boolean;
  chapters: LessonChapter[];
  chapters_source: ChaptersSource | null;
  chapters_updated_at: string | null;
  has_subtitle: boolean;
  segments_count: number;
  segments_fetched_at: string | null;
  /** ความยาวคลิป (วินาที): จริงจาก YouTube ถ้ามี ไม่งั้นประมาณจากจบซับ · null = ยังไม่รู้ */
  length_sec: number | null;
  /** true = ความยาวจริง (เกิน = ผิดแน่) · false = ประมาณจากซับ (เกิน = แค่เตือน) */
  length_exact: boolean;
}

/** POST /api/courses/lessons/:id/chapters/auto (admin) — สำเร็จ */
export interface AutoChaptersResult {
  ok: true;
  lesson_id: number;
  chapters: LessonChapter[];
  source: ChaptersSource;
  /** true = บันทึกลงบทเรียนแล้ว · false = แค่คืนผลให้แก้ต่อ (save:false) */
  saved: boolean;
  segments_count?: number;
  length_sec?: number | null;
}
