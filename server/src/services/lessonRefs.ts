// ที่คั่นหน้า "เรียนถึงบทไหน" (074) — ทำให้ตำแหน่งที่ผู้เรียนค้างอยู่ไม่หายเมื่อบทถูกลบ/ปิด/แทนที่
//   course_enrollments เก็บ last_lesson_id (บทที่เปิดล่าสุด) + last_lesson_order (ลำดับของบทนั้น) + completed_lessons
//   กติกาเลือกบทที่จะ "เรียนต่อ" (ใช้เหมือนกันทุกจุด: /enrollments/mine, /courses/:slug/full, หน้าเรียน — src/lib/lessons.ts เป็นสำเนาฝั่ง FE):
//     1. id ยังเป็นบท active ในคอร์ส → บทนั้น
//     2. id หาย/ปิด แต่มีลำดับ → บท active ที่ lesson_order เท่ากับหรือถัดจากลำดับเดิมที่ใกล้ที่สุด → ไม่มี (คอร์สสั้นลง) → บทสุดท้าย
//     3. ไม่มีลำดับ (แถวเก่าก่อน 074) → บทแรกตามลำดับที่ยังไม่อยู่ในรายการเรียนจบ → จบหมด → บทสุดท้าย
//     4. คอร์สไม่มีบท → null
//   ไฟล์นี้ต้องไม่แตะ pool ตอน import (สคริปต์ทดสอบ import ฟังก์ชัน pure มาเช็คได้)
import type pg from 'pg';

/** Pool หรือ PoolClient (ใน transaction) ก็ได้ */
export type Db = { query: (text: string, values?: any[]) => Promise<pg.QueryResult<any>> };

export type LessonRef = { id: number; lesson_order: number };

export type EnrollmentRef = {
  id: number;
  course_id: number;
  last_lesson_id?: number | null;
  last_lesson_order?: number | null;
  completed_lessons?: number[] | null;
};

const toInt = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** เรียงตามที่ payload คอร์ส/ปุ่ม "บทถัดไป" ใช้: lesson_order แล้ว id */
export function sortLessonRefs<T extends LessonRef>(lessons: T[]): T[] {
  return [...lessons]
    .map((l) => ({ ...l, id: Number(l.id), lesson_order: Number(l.lesson_order) }))
    .sort((a, b) => (a.lesson_order - b.lesson_order) || (a.id - b.id));
}

/** เลือก id บทที่จะเรียนต่อตามกติกาด้านบน (pure) */
export function resumeLessonId(
  lessons: LessonRef[],
  lastId: number | null | undefined,
  lastOrder: number | null | undefined,
  completed: Array<number | string> | null | undefined,
): number | null {
  const sorted = sortLessonRefs(lessons);
  if (sorted.length === 0) return null;
  const last = sorted[sorted.length - 1]!;
  const id = toInt(lastId);
  if (id != null && sorted.some((l) => l.id === id)) return id;
  const order = toInt(lastOrder);
  if (order != null) {
    const next = sorted.find((l) => l.lesson_order >= order);
    return (next ?? last).id;
  }
  const done = new Set((completed ?? []).map((c) => Number(c)));
  const firstIncomplete = sorted.find((l) => !done.has(l.id));
  return (firstIncomplete ?? last).id;
}

/** บท active ของคอร์ส (id + ลำดับ) เรียงแล้ว */
export async function activeLessonRefs(db: Db, courseId: number): Promise<LessonRef[]> {
  const r = await db.query(
    `SELECT id, lesson_order FROM lessons WHERE course_id = $1 AND is_active = true ORDER BY lesson_order ASC, id ASC`,
    [courseId],
  );
  return r.rows.map((l: any) => ({ id: Number(l.id), lesson_order: Number(l.lesson_order) }));
}

/** เฉพาะ id ที่เป็นบท active ของคอร์สนี้จริง (ใช้ตรวจก่อนบันทึกความคืบหน้า) */
export async function validLessonIds(db: Db, courseId: number, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const r = await db.query(
    `SELECT id FROM lessons WHERE course_id = $1 AND is_active = true AND id = ANY($2::int[])`,
    [courseId, ids],
  );
  return new Set(r.rows.map((l: any) => Number(l.id)));
}

/** แถวนี้ "เคยเรียน" ไหม — ไม่เคยเลยก็ไม่ต้องซ่อม (null = ปุ่ม "เริ่มเรียน" ตามเดิม) */
function hasProgressSignal(e: EnrollmentRef): boolean {
  return e.last_lesson_id != null || e.last_lesson_order != null || (Array.isArray(e.completed_lessons) && e.completed_lessons.length > 0);
}

/**
 * ซ่อมที่คั่นหน้าของ enrollment ให้ชี้บท active เสมอ แล้วเขียนกลับ DB (ไม่แตะ updated_at)
 * - id ใช้ได้แต่ยังไม่มีลำดับ (แถวก่อน 074) → เติมลำดับให้
 * - id หาย/ปิด/คนละคอร์ส → เลือกบทใหม่ตามกติกา แล้วบันทึกทั้ง id + ลำดับ
 * คืน enrollment ที่แก้แล้ว (object ใหม่) — ส่ง `lessons` มาได้ถ้าโหลดไว้แล้ว (เช่น /full)
 */
export async function healEnrollment<T extends EnrollmentRef>(db: Db, enrollment: T, lessons?: LessonRef[]): Promise<T> {
  if (!hasProgressSignal(enrollment)) return enrollment;
  const refs = lessons ?? (await activeLessonRefs(db, Number(enrollment.course_id)));
  const currentId = toInt(enrollment.last_lesson_id);
  const current = currentId != null ? refs.find((l) => Number(l.id) === currentId) : undefined;
  if (current) {
    if (enrollment.last_lesson_order != null) return enrollment;
    await db.query(
      `UPDATE course_enrollments SET last_lesson_order = $1 WHERE id = $2 AND last_lesson_id = $3 AND last_lesson_order IS NULL`,
      [current.lesson_order, enrollment.id, currentId],
    );
    return { ...enrollment, last_lesson_order: Number(current.lesson_order) };
  }
  const resumeId = resumeLessonId(refs, currentId, enrollment.last_lesson_order, enrollment.completed_lessons);
  const resumeOrder = resumeId != null ? (refs.find((l) => Number(l.id) === resumeId)?.lesson_order ?? null) : null;
  // WHERE last_lesson_id IS NOT DISTINCT FROM ค่าที่เห็น: ถ้าผู้เรียนเพิ่งบันทึกบทใหม่ระหว่างนี้ ไม่ทับ
  await db.query(
    `UPDATE course_enrollments SET last_lesson_id = $1, last_lesson_order = $2
      WHERE id = $3 AND last_lesson_id IS NOT DISTINCT FROM $4`,
    [resumeId, resumeOrder, enrollment.id, currentId],
  );
  return { ...enrollment, last_lesson_id: resumeId, last_lesson_order: resumeOrder };
}

/**
 * บทกำลังจะถูกลบ/ปิด → เอา id ออกจากรายการ "เรียนจบ" ของทุกคนในคอร์ส + คิด % ใหม่จากจำนวนบทที่จะเหลือ
 * เรียก "ก่อน" ลบ/ปิด (จึงนับบทที่เหลือด้วย l.id <> lessonId) · last_lesson_id ไม่ต้องย้าย —
 * ลบจริง: FK ON DELETE SET NULL ทำให้ว่างเอง · ปิด: id ยังอยู่แต่ไม่ active → healEnrollment ตอนอ่านพาไปตามลำดับ
 * คืนจำนวนแถวที่แตะ
 */
export async function detachLessonRefs(db: Db, lessonId: number, courseId: number): Promise<number> {
  const r = await db.query(
    `UPDATE course_enrollments e SET
       completed_lessons = array_remove(COALESCE(e.completed_lessons, '{}'), $1::int),
       progress_percent = LEAST(100, ROUND(
         cardinality(array_remove(COALESCE(e.completed_lessons, '{}'), $1::int)) * 100.0
         / GREATEST((SELECT COUNT(*) FROM lessons l WHERE l.course_id = $2 AND l.is_active = true AND l.id <> $1), 1)))
     WHERE e.course_id = $2 AND $1 = ANY(COALESCE(e.completed_lessons, '{}'))`,
    [lessonId, courseId],
  );
  return r.rowCount ?? 0;
}
