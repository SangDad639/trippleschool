// ที่คั่นหน้า "เรียนถึงบทไหน" — สำเนาฝั่ง FE ของกติกาใน server/src/services/lessonRefs.ts (074)
//   ใช้ตอนหน้าเรียนได้ :lessonId ที่ไม่มีในคอร์สแล้ว (บทถูกลบ/ปิด/แทนที่, URL เก่า) → หาบทที่ควรพาไปแทน
//     1. id ที่จำไว้ยังอยู่ในคอร์ส → บทนั้น
//     2. มีลำดับที่จำไว้ → บทที่ lesson_order เท่ากับหรือถัดจากลำดับเดิมที่ใกล้ที่สุด → ไม่มี → บทสุดท้าย
//     3. ไม่มีลำดับ → บทแรกที่ยังไม่อยู่ในรายการเรียนจบ → จบหมด → บทสุดท้าย
//     4. คอร์สไม่มีบท → null

export type ResumeLessonRef = { id: number; lesson_order: number };

export type ResumeEnrollmentRef = {
  last_lesson_id?: number | null;
  last_lesson_order?: number | null;
  completed_lessons?: Array<number | string> | null;
} | null | undefined;

const toInt = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function resumeLessonId(lessons: ResumeLessonRef[], enrollment: ResumeEnrollmentRef): number | null {
  const sorted = lessons
    .map((l) => ({ id: Number(l.id), lesson_order: Number(l.lesson_order) }))
    .sort((a, b) => (a.lesson_order - b.lesson_order) || (a.id - b.id));
  if (sorted.length === 0) return null;
  const last = sorted[sorted.length - 1]!;
  const id = toInt(enrollment?.last_lesson_id);
  if (id != null && sorted.some((l) => l.id === id)) return id;
  const order = toInt(enrollment?.last_lesson_order);
  if (order != null) {
    const next = sorted.find((l) => l.lesson_order >= order);
    return (next ?? last).id;
  }
  const done = new Set((enrollment?.completed_lessons ?? []).map((c) => Number(c)));
  const firstIncomplete = sorted.find((l) => !done.has(l.id));
  return (firstIncomplete ?? last).id;
}
