/**
 * "บทในคลิป" (chapters) ของบทเรียน — migration 072/073 · docs/PLAN-LESSON-CHAPTERS.md
 *
 * แหล่งของบท (ลำดับความสำคัญ):  manual (แอดมินแก้เอง)  >  youtube (timestamp ในคำอธิบายคลิป)  >  ai (สรุปจากซับแบบมีเวลา)
 * - ค่าเริ่มต้นคือ "อัตโนมัติ": ดึงซับมีเวลาจาก YouTube (utils/youtubeCaptions.ts) → ถ้าคำอธิบายมี timestamp ≥ 3 บรรทัดใช้เลย
 *   ไม่งั้นให้โมเดล OpenAI-compatible ตัวเดียวกับผู้ช่วยประจำคอร์ส (env AGENT_CHAT_*) แบ่งบท → ตรวจ/ปรับ (บทแรก 0, เรียง, ไม่เกินความยาว,
 *   ห่างกัน ≥ 20 วิ) → บันทึกลง lessons.chapters
 * - บทที่แอดมินแก้เอง (source 'manual') อัตโนมัติจะไม่ทับ เว้นแต่สั่ง force (ปุ่ม 🪄 ในแอดมิน) — เช็คซ้ำตอนเขียนด้วย (กัน race กับที่แอดมินบันทึกระหว่างรอ AI)
 * - ซับมีเวลา/คำอธิบาย/ความยาว เก็บใน lesson_subtitles (คอลัมน์ 072/073) — **ไม่แตะ content** ที่ผู้ช่วยประจำคอร์สใช้ (อาจเป็นไฟล์ที่แอดมินอัปเอง)
 * - ทุกฟังก์ชันไม่ throw ออกไปหา caller ที่เป็น route/queue — คืน reason ให้แสดงข้อความไทยแทน
 * - ทดสอบ: env CHAPTERS_AI_MOCK=1 → ไม่เรียกโมเดล คืนบทคงที่ (ไม่จ่ายเงิน/ไม่พึ่งเน็ต)
 */
import OpenAI from 'openai';
import pool from '../db.js';
import { fetchAutoCaptions, captionFailMessage, type CaptionSegment } from '../utils/youtubeCaptions.js';
import { queueChapterThumbs } from './chapterThumbs.js';

export interface LessonChapter {
  sec: number;
  title: string;
  /** ภาพเฟรมของบท (services/chapterThumbs.ts) — path ใต้ /api/courses/thumbnails/ · ไม่มี = ยังไม่ได้ทำ/ทำไม่ได้ */
  thumb?: string;
}
export type ChaptersSource = 'manual' | 'youtube' | 'ai';
export const MAX_CHAPTERS = 100;
export const MAX_CHAPTER_TITLE = 120;
/** ซับสั้นกว่านี้ = คลิปแทบไม่มีเสียงพูด ไม่พอให้ AI แบ่งบท (เท่ากับ MIN_USEFUL_SUBTITLE_CHARS ของซับบอท) */
const MIN_TRANSCRIPT_CHARS = 300;
/** บทห่างกันน้อยกว่านี้ถือว่าซ้ำ (AI บางทีแบ่งถี่เกิน) */
const MIN_GAP_SEC = 20;
const TRANSCRIPT_BUCKET_SEC = 20;
const TRANSCRIPT_MAX_CHARS = 12000;
/** ให้ทั้ง pipeline จบใน ~90 วิ (YouTube 2×20 วิ + AI 45 วิ) — FE รอ 150 วิ */
const AI_TIMEOUT_MS = 45000;

/* ------------------------------------------------------------------ */
/*  แปลงข้อความ ↔ รายการบท                                            */
/* ------------------------------------------------------------------ */
/**
 * `mm:ss ชื่อ` · `h:mm:ss ชื่อ` · ยอมมีวงเล็บ/วงเล็บเหลี่ยม/ขีดคั่น เช่น `(2:30) - ชื่อ` · บรรทัดอื่นถูกข้าม
 * วินาที 00-59 เท่านั้น (ถ้ามีชั่วโมง นาทีก็ 00-59) — `2:75` ไม่ใช่เวลา
 */
const TS_LINE_RE = /^\s*[([]?((?:\d{1,2}:[0-5]\d|\d{1,3}):[0-5]\d)[)\]]?\s*[-–—:.|]?\s*(.+?)\s*$/;

export function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(x).padStart(2, '0')}`;
}

function toSec(ts: string): number {
  const parts = ts.split(':').map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

/** ข้อความหลายบรรทัด (รูปแบบคำอธิบาย YouTube) → บทเรียงตามเวลา ตัดเวลาซ้ำ (เก็บบรรทัดแรก) */
export function parseChapterText(text: string): LessonChapter[] {
  const out: LessonChapter[] = [];
  const seen = new Set<number>();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(TS_LINE_RE);
    if (!m) continue;
    const sec = toSec(m[1]);
    const title = m[2].trim().slice(0, MAX_CHAPTER_TITLE);
    if (!Number.isFinite(sec) || !title || seen.has(sec)) continue;
    seen.add(sec);
    out.push({ sec, title });
    if (out.length >= MAX_CHAPTERS) break;
  }
  return out.sort((a, b) => a.sec - b.sec);
}

export function formatChapterText(chapters: LessonChapter[]): string {
  return chapters.map((c) => `${formatSec(c.sec)} ${c.title}`).join('\n');
}

/**
 * ตรวจ body.chapters จาก POST/PUT lessons — undefined = ไม่แตะ · [] = ล้าง (PUT) · คืน error ไทยถ้าไม่ผ่าน
 * (ไม่เช็คความยาวคลิปที่นี่ — แอดมิน UI เช็คให้จาก /chapters/status)
 */
export function validateChapters(raw: unknown): { list?: LessonChapter[]; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (!Array.isArray(raw)) return { error: 'chapters ต้องเป็นรายการ' };
  if (raw.length > MAX_CHAPTERS) return { error: `บทในคลิปได้ไม่เกิน ${MAX_CHAPTERS} บทต่อคลิป` };
  const list: LessonChapter[] = [];
  const seen = new Set<number>();
  for (const it of raw) {
    const sec = Number((it as any)?.sec);
    const title = String((it as any)?.title ?? '').trim();
    if (!Number.isInteger(sec) || sec < 0) return { error: 'เวลาเริ่มบทต้องเป็นวินาที (จำนวนเต็ม ≥ 0)' };
    if (!title) return { error: `บทที่เวลา ${formatSec(sec)} ยังไม่มีชื่อ` };
    if (title.length > MAX_CHAPTER_TITLE) return { error: `ชื่อบทที่ ${formatSec(sec)} ยาวเกิน ${MAX_CHAPTER_TITLE} ตัวอักษร` };
    if (seen.has(sec)) return { error: `มีบทซ้ำที่เวลา ${formatSec(sec)}` };
    seen.add(sec);
    list.push({ sec, title });
  }
  list.sort((a, b) => a.sec - b.sec);
  return { list };
}

/** แหล่งที่ FE ส่งกลับมาตอนบันทึกผล 🪄 โดยไม่ได้แก้ — รับเฉพาะ ai/youtube, อย่างอื่น = manual */
export function normalizeSourceInput(raw: unknown): ChaptersSource {
  return raw === 'ai' || raw === 'youtube' ? raw : 'manual';
}

export const chaptersEqual = (a: LessonChapter[] | null | undefined, b: LessonChapter[] | null | undefined) =>
  JSON.stringify((a ?? []).map((c) => [c.sec, c.title])) === JSON.stringify((b ?? []).map((c) => [c.sec, c.title]));

/* ------------------------------------------------------------------ */
/*  ปรับผลลัพธ์ให้เข้ากติกา                                            */
/* ------------------------------------------------------------------ */
/** บทแรก 0:00 · เรียง · ตัดที่เกินความยาวคลิป · ตัดที่ชิดกันเกินไป · จำกัดจำนวน */
export function normalizeChapters(input: LessonChapter[], lengthSec?: number | null): LessonChapter[] {
  const cleaned = input
    .map((c) => ({ sec: Math.max(0, Math.floor(Number(c.sec) || 0)), title: String(c.title ?? '').trim().slice(0, MAX_CHAPTER_TITLE) }))
    .filter((c) => c.title && Number.isFinite(c.sec))
    .filter((c) => !(lengthSec && lengthSec > 0 && c.sec >= lengthSec))
    .sort((a, b) => a.sec - b.sec);
  const out: LessonChapter[] = [];
  for (const c of cleaned) {
    const prev = out[out.length - 1];
    if (prev && c.sec - prev.sec < MIN_GAP_SEC) continue;
    out.push(c);
  }
  if (out.length && out[0].sec !== 0) {
    if (out[0].sec <= 60) out[0] = { ...out[0], sec: 0 };
    else out.unshift({ sec: 0, title: 'เริ่มต้น' });
  }
  return out.slice(0, MAX_CHAPTERS);
}

/* ------------------------------------------------------------------ */
/*  AI                                                                  */
/* ------------------------------------------------------------------ */
function transcriptLines(segments: CaptionSegment[]): string {
  const buckets: { b: number; parts: string[] }[] = [];
  let cur: { b: number; parts: string[] } | null = null;
  for (const s of segments) {
    const b = Math.floor(s.t / TRANSCRIPT_BUCKET_SEC) * TRANSCRIPT_BUCKET_SEC;
    if (!cur || cur.b !== b) {
      cur = { b, parts: [] };
      buckets.push(cur);
    }
    cur.parts.push(s.text);
  }
  let lines = buckets.map((l) => `[${formatSec(l.b)}] ${l.parts.join(' ')}`);
  let joined = lines.join('\n');
  if (joined.length > TRANSCRIPT_MAX_CHARS) {
    // คลิปยาว → เก็บบรรทัดกระจายทั้งคลิป (ไม่ตัดท้ายทิ้ง ไม่งั้น AI ไม่รู้ตอนจบ)
    const keep = Math.max(20, Math.floor(lines.length * (TRANSCRIPT_MAX_CHARS / joined.length)));
    const step = lines.length / keep;
    lines = Array.from({ length: keep }, (_, i) => lines[Math.floor(i * step)]);
    joined = lines.join('\n');
  }
  return joined;
}

function aiClient(): { client: OpenAI; model: string; extraBody: Record<string, unknown> } | null {
  const apiKey = process.env.CHAPTERS_AI_API_KEY || process.env.AGENT_CHAT_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.CHAPTERS_AI_BASE_URL || process.env.AGENT_CHAT_BASE_URL || undefined;
  const model = process.env.CHAPTERS_AI_MODEL || process.env.AGENT_CHAT_MODEL || 'gpt-4o-mini';
  // ไม่ retry: ปุ่มในแอดมินกดซ้ำได้เอง และ FE รอไม่เกิน 150 วิ
  const client = new OpenAI({ baseURL, apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 0 });
  // ปิด hidden thinking ของ MiMo เหมือนผู้ช่วยประจำคอร์ส (provider อื่นไม่รู้จัก param นี้ → ปิดด้วย env)
  const extraBody = process.env.AGENT_CHAT_DISABLE_THINKING ? { chat_template_kwargs: { enable_thinking: false } } : {};
  return { client, model, extraBody };
}

function mockChapters(lengthSec: number): LessonChapter[] {
  const len = lengthSec > 0 ? lengthSec : 600;
  const n = Math.max(3, Math.min(6, Math.round(len / 120)));
  return Array.from({ length: n }, (_, i) => ({ sec: Math.floor((len / n) * i), title: `บททดสอบ ${i + 1}` }));
}

export async function generateChaptersAI(
  segments: CaptionSegment[],
  meta: { title: string; lengthSec: number }
): Promise<{ chapters: LessonChapter[] } | { error: 'ai_not_configured' | 'ai_failed'; detail?: string }> {
  if (process.env.CHAPTERS_AI_MOCK === '1') return { chapters: mockChapters(meta.lengthSec) };
  const ai = aiClient();
  if (!ai) return { error: 'ai_not_configured' };
  const transcript = transcriptLines(segments);
  const minutes = Math.max(1, Math.round(meta.lengthSec / 60));
  const target = Math.max(3, Math.min(12, Math.round(minutes / 3)));
  const system = 'คุณคือผู้ช่วยทำ "บทในคลิป" (YouTube chapters) ของวิดีโอคอร์สเรียนภาษาไทย ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น';
  const user = [
    `คลิป: "${meta.title}" ความยาว ${formatSec(meta.lengthSec)} นาที`,
    'ด้านล่างคือซับอัตโนมัติ (อาจสะกดผิดบ้าง) แต่ละบรรทัดขึ้นต้นด้วยเวลาเริ่มช่วงในวงเล็บเหลี่ยม',
    '',
    `แบ่งเป็นบทประมาณ ${target} บท (อย่างน้อย 3 ไม่เกิน 12) ตามจุดที่หัวข้อเปลี่ยนจริงในเนื้อหา`,
    'กติกา:',
    '- sec = เวลาเริ่มบทเป็นวินาที (integer) ต้องเป็นเวลาที่มีอยู่ในวงเล็บเหลี่ยมของซับเท่านั้น ห้ามปัดเป็นเลขกลม',
    `- บทแรก sec=0 · เรียงจากน้อยไปมาก · ห่างกันอย่างน้อย 30 วินาที · ไม่เกิน ${meta.lengthSec} วินาที`,
    '- title ภาษาไทย สั้น กระชับ ≤ 50 ตัวอักษร บอกว่าช่วงนั้นสอนอะไร ไม่ต้องขึ้นต้นด้วย "บทที่"',
    'ตอบ JSON รูปแบบ {"chapters":[{"sec":0,"title":"..."}]} เท่านั้น',
    '',
    transcript,
  ].join('\n');
  try {
    const res = await ai.client.chat.completions.create({
      model: ai.model,
      temperature: 0.3,
      max_tokens: 900,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(ai.extraBody as any),
    });
    const raw = String(res.choices?.[0]?.message?.content ?? '');
    const text = raw.replace(/```json|```/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return { error: 'ai_failed', detail: `no JSON: ${raw.slice(0, 120)}` };
    const parsed = JSON.parse(text.slice(start, end + 1)) as { chapters?: unknown };
    if (!Array.isArray(parsed.chapters)) return { error: 'ai_failed', detail: 'no chapters array' };
    const chapters = parsed.chapters
      .map((c: any) => ({ sec: Number(c?.sec), title: String(c?.title ?? '').trim() }))
      .filter((c) => Number.isFinite(c.sec) && c.title);
    return { chapters };
  } catch (error) {
    return { error: 'ai_failed', detail: String((error as Error)?.message ?? error).slice(0, 160) };
  }
}

/* ------------------------------------------------------------------ */
/*  Pipeline ต่อบทเรียน                                               */
/* ------------------------------------------------------------------ */
export type BuildReason =
  | 'manual_kept' // มีของแอดมินแก้เอง ไม่ทับ
  | 'no_video'
  | 'no_captions' // YouTube ยังไม่มีซับ
  | 'unavailable' // คลิปเปิดไม่ได้
  | 'fetch_failed' // ติดต่อ YouTube ไม่ได้/ถูกบล็อก
  | 'too_short' // ซับสั้นเกิน (คลิปไม่มีเสียงพูด)
  | 'ai_not_configured'
  | 'ai_failed'
  | 'not_found';

export interface BuildResult {
  ok: boolean;
  lesson_id: number;
  chapters: LessonChapter[];
  source: ChaptersSource | null;
  saved: boolean;
  reason?: BuildReason;
  /** ข้อความไทยสำหรับแอดมิน */
  message?: string;
  segments_count?: number;
  length_sec?: number | null;
}

export function buildReasonMessage(reason: BuildReason, detail?: string): string {
  switch (reason) {
    case 'manual_kept': return 'บทนี้แอดมินแก้เองไว้ — คงของเดิม (กด 🪄 เพื่อสร้างใหม่ทับ)';
    case 'no_video': return 'บทเรียนนี้ไม่มีวิดีโอ YouTube';
    case 'no_captions': return captionFailMessage('no_captions');
    case 'unavailable': return captionFailMessage('unavailable', detail);
    case 'fetch_failed': return `ติดต่อ YouTube ไม่สำเร็จ${detail ? ` (${detail})` : ''} — ลองใหม่อีกครั้ง`;
    case 'too_short': return 'คลิปนี้แทบไม่มีเสียงพูด — ซับสั้นเกินกว่าจะแบ่งบทได้ พิมพ์บทเองได้ในกล่องด้านล่าง';
    case 'ai_not_configured': return 'ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์ (AGENT_CHAT_* / CHAPTERS_AI_*)';
    case 'ai_failed': return `AI แบ่งบทไม่สำเร็จ${detail ? ` (${detail})` : ''} — ลองใหม่อีกครั้ง หรือพิมพ์บทเอง`;
    case 'not_found': return 'ไม่พบบทเรียน';
  }
}

/**
 * เก็บซับมีเวลา + คำอธิบาย + ความยาวจริง (072/073) — **ไม่แตะ content/language** (ของผู้ช่วยประจำคอร์ส; อาจเป็นไฟล์ที่แอดมินอัปเอง)
 * แถวยังไม่มี → สร้างใหม่พร้อม content เฉพาะเมื่อซับยาวพอ (≥ 300 ตัว) ไม่งั้นข้าม (ไม่ให้บอทเชื่อว่ามีความรู้จากคลิปไม่มีเสียงพูด)
 */
async function storeSegments(lessonId: number, courseId: number, cap: { language: string; text: string; segments: CaptionSegment[]; description: string; lengthSeconds: number }) {
  const segments = JSON.stringify(cap.segments);
  const len = cap.lengthSeconds > 0 ? cap.lengthSeconds : null;
  const updated = await pool.query(
    `UPDATE lesson_subtitles SET segments = $2::jsonb, segments_fetched_at = NOW(), description = $3, length_seconds = COALESCE($4, length_seconds)
      WHERE lesson_id = $1`,
    [lessonId, segments, cap.description, len]
  );
  if (updated.rowCount) return;
  if (cap.text.length < MIN_TRANSCRIPT_CHARS) return;
  await pool.query(
    `INSERT INTO lesson_subtitles (lesson_id, course_id, language, content, fetched_at, segments, segments_fetched_at, description, length_seconds)
     VALUES ($1, $2, $3, $4, NOW(), $5::jsonb, NOW(), $6, $7)
     ON CONFLICT (lesson_id) DO UPDATE SET segments = EXCLUDED.segments, segments_fetched_at = NOW(), description = EXCLUDED.description,
       length_seconds = COALESCE(EXCLUDED.length_seconds, lesson_subtitles.length_seconds)`,
    [lessonId, courseId, cap.language, cap.text, segments, cap.description, len]
  );
}

/** เปลี่ยนคลิปของบท → ซับ/ความยาวเดิมใช้ไม่ได้แล้ว (PUT lessons เรียก) */
export async function invalidateLessonSubtitle(lessonId: number): Promise<void> {
  await pool.query(`DELETE FROM lesson_subtitles WHERE lesson_id = $1`, [lessonId]);
}

export async function buildChaptersForLesson(
  lessonId: number,
  opts: { force?: boolean; save?: boolean } = {}
): Promise<BuildResult> {
  const save = opts.save !== false;
  const base = { lesson_id: lessonId, chapters: [] as LessonChapter[], source: null as ChaptersSource | null, saved: false };
  const fail = (reason: BuildReason, detail?: string, extra: Partial<BuildResult> = {}): BuildResult =>
    ({ ok: false, ...base, reason, message: buildReasonMessage(reason, detail), ...extra });

  const lesson = (
    await pool.query(
      `SELECT id, course_id, title, youtube_id, duration_minutes, chapters, chapters_source FROM lessons WHERE id = $1`,
      [lessonId]
    )
  ).rows[0];
  if (!lesson) return fail('not_found');
  if (!lesson.youtube_id) return fail('no_video');
  if (lesson.chapters_source === 'manual' && !opts.force) {
    return { ok: true, ...base, chapters: Array.isArray(lesson.chapters) ? lesson.chapters : [], source: 'manual', reason: 'manual_kept', message: buildReasonMessage('manual_kept') };
  }

  // 1) ซับแบบมีเวลา — ใช้ที่เก็บไว้ ไม่งั้นดึงใหม่ (และเก็บ)
  const sub = (
    await pool.query(`SELECT segments, description, length_seconds FROM lesson_subtitles WHERE lesson_id = $1`, [lessonId])
  ).rows[0];
  let segments: CaptionSegment[] = Array.isArray(sub?.segments) ? sub.segments : [];
  let description: string = typeof sub?.description === 'string' ? sub.description : '';
  let lengthSec = Number(sub?.length_seconds || 0);
  if (segments.length === 0) {
    const cap = await fetchAutoCaptions(lesson.youtube_id);
    if (!cap.ok) {
      if (cap.reason === 'no_captions' || cap.reason === 'empty') return fail('no_captions');
      if (cap.reason === 'unavailable') return fail('unavailable', cap.detail);
      return fail('fetch_failed', cap.detail);
    }
    segments = cap.segments;
    description = cap.description;
    lengthSec = cap.lengthSeconds;
    try {
      await storeSegments(lessonId, Number(lesson.course_id), cap);
    } catch (error) {
      console.error(`[Chapters] store segments failed (lesson ${lessonId}):`, error);
    }
  }
  if (!lengthSec) {
    // ไม่รู้ความยาวจริง → ใช้ที่ยาวสุดระหว่างจบซับกับที่แอดมินกรอก (ซับมักจบก่อนท้ายคลิป — อย่าตัดบทท้ายๆ ทิ้ง)
    const last = segments[segments.length - 1];
    lengthSec = Math.max(last ? Math.ceil(last.t + (last.d || 0)) : 0, Number(lesson.duration_minutes || 0) * 60);
  }

  // 2) timestamp ในคำอธิบายคลิป (กติกา YouTube: ≥ 3 บรรทัด เริ่ม 0:00)
  let chapters: LessonChapter[] = [];
  let source: ChaptersSource;
  const fromYt = parseChapterText(description);
  if (fromYt.length >= 3 && fromYt[0].sec === 0) {
    chapters = normalizeChapters(fromYt, lengthSec);
    source = 'youtube';
  } else {
    // 3) AI จากซับ
    const chars = segments.reduce((n, s) => n + s.text.length, 0);
    if (chars < MIN_TRANSCRIPT_CHARS) return fail('too_short', undefined, { segments_count: segments.length, length_sec: lengthSec });
    const ai = await generateChaptersAI(segments, { title: lesson.title, lengthSec });
    if ('error' in ai) return fail(ai.error, ai.detail, { segments_count: segments.length, length_sec: lengthSec });
    chapters = normalizeChapters(ai.chapters, lengthSec);
    if (chapters.length < 2) return fail('ai_failed', `ได้แค่ ${chapters.length} บท`, { segments_count: segments.length, length_sec: lengthSec });
    source = 'ai';
  }

  let saved = false;
  if (save) {
    // ระหว่างรอ AI แอดมินอาจบันทึกบทเองไปแล้ว → ไม่ทับ (ยกเว้น force = กด 🪄 เอง)
    const up = await pool.query(
      `UPDATE lessons SET chapters = $1::jsonb, chapters_source = $2, chapters_updated_at = NOW()
        WHERE id = $3 AND ($4::boolean OR COALESCE(chapters_source, '') <> 'manual')`,
      [JSON.stringify(chapters), source, lessonId, !!opts.force]
    );
    saved = (up.rowCount ?? 0) > 0;
    if (!saved) {
      const now = (await pool.query(`SELECT chapters FROM lessons WHERE id = $1`, [lessonId])).rows[0];
      return { ok: true, ...base, chapters: Array.isArray(now?.chapters) ? now.chapters : [], source: 'manual', reason: 'manual_kept', message: buildReasonMessage('manual_kept'), segments_count: segments.length, length_sec: lengthSec };
    }
    // ภาพเฟรมต่อบท (storyboard) ทำเบื้องหลัง
    queueChapterThumbs(lessonId);
  }
  console.log(`[Chapters] lesson=${lessonId} source=${source} n=${chapters.length} saved=${saved} len=${lengthSec}s`);
  return { ok: true, lesson_id: lessonId, chapters, source, saved, segments_count: segments.length, length_sec: lengthSec };
}

/** สถานะสำหรับกล่องแอดมิน */
export async function getLessonChaptersStatus(lessonId: number) {
  const r = (
    await pool.query(
      `SELECT l.id, l.youtube_id, l.chapters, l.chapters_source, l.chapters_updated_at, l.duration_minutes,
              (ls.id IS NOT NULL) AS has_subtitle,
              COALESCE(jsonb_array_length(ls.segments), 0) AS segments_count,
              ls.segments_fetched_at, ls.length_seconds,
              (SELECT (elem->>'t')::float + COALESCE((elem->>'d')::float, 0)
                 FROM jsonb_array_elements(ls.segments) elem ORDER BY (elem->>'t')::float DESC LIMIT 1) AS caption_end
         FROM lessons l LEFT JOIN lesson_subtitles ls ON ls.lesson_id = l.id
        WHERE l.id = $1`,
      [lessonId]
    )
  ).rows[0];
  if (!r) return null;
  const exact = Number(r.length_seconds || 0);
  const captionEnd = r.caption_end != null ? Math.ceil(Number(r.caption_end)) : 0;
  return {
    lesson_id: Number(r.id),
    has_video: !!r.youtube_id,
    chapters: Array.isArray(r.chapters) ? (r.chapters as LessonChapter[]) : [],
    chapters_source: (r.chapters_source ?? null) as ChaptersSource | null,
    chapters_updated_at: r.chapters_updated_at ? new Date(r.chapters_updated_at).toISOString() : null,
    has_subtitle: !!r.has_subtitle,
    segments_count: Number(r.segments_count ?? 0),
    segments_fetched_at: r.segments_fetched_at ? new Date(r.segments_fetched_at).toISOString() : null,
    /** ความยาวคลิป (วินาที): จริงจาก YouTube ถ้ามี ไม่งั้นประมาณจากจบซับ · null = ยังไม่รู้ */
    length_sec: exact > 0 ? exact : captionEnd > 0 ? captionEnd : null,
    /** true = ความยาวจริงจาก YouTube (เกิน = ผิดแน่) · false = ประมาณจากซับ (เกิน = แค่เตือน) */
    length_exact: exact > 0,
  };
}

/** ค่าเริ่มต้น: สร้างบทเบื้องหลังหลังเพิ่มบทเรียน/เปลี่ยนคลิป — best-effort, กันยิงซ้ำระหว่างทำ */
const inFlight = new Set<number>();
export function queueAutoChapters(lessonId: number, delayMs = 1500): void {
  if (process.env.CHAPTERS_AUTO === '0') return;
  if (inFlight.has(lessonId)) return;
  inFlight.add(lessonId);
  setTimeout(() => {
    buildChaptersForLesson(lessonId, { force: false })
      .then((r) => { if (!r.ok || !r.saved) console.log(`[Chapters] auto lesson=${lessonId} skipped: ${r.reason}`); })
      .catch((e) => console.error(`[Chapters] auto lesson=${lessonId} error:`, e))
      .finally(() => inFlight.delete(lessonId));
  }, delayMs);
}
