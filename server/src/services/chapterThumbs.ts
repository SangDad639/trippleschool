/**
 * ภาพเฟรมต่อ "บทในคลิป" (แบบ YouTube) — ตัดจาก storyboard ของ YouTube (utils/youtubeStoryboard.ts) ด้วย ffmpeg
 * แล้วเก็บบน S3 ใต้ `lesson-chapters/<lessonId>/<youtubeId>-<sec>.webp` (160×90 ≈ 4-8 KB) เสิร์ฟผ่าน /api/courses/thumbnails/*
 * - เขียนกลับใน lessons.chapters เป็น field `thumb` ("/api/courses/thumbnails/<key>") — key ฝัง youtubeId ไว้ → เปลี่ยนคลิปแล้วภาพเก่าไม่ถูกใช้
 * - ของแถม best-effort: ไม่มี storyboard / ffmpeg ไม่มี / YouTube บล็อก → ไม่มีภาพ รายการบทยังใช้ได้
 * - ทำเบื้องหลังหลังบทถูกบันทึก (queueChapterThumbs) และสคริปต์ sync-chapter-thumbs.ts สำหรับของเดิม
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import pool from '../db.js';
import { uploadFile, deleteFile } from '../utils/s3.js';
import { resolveFfmpeg } from '../utils/imageResize.js';
import { fetchStoryboardSpec, pickThumbLevel, frameLocation, sheetUrl, fetchSheet, type StoryboardSpec, type StoryboardLevel } from '../utils/youtubeStoryboard.js';
import type { LessonChapter } from './lessonChapters.js';

export const CHAPTER_THUMB_PREFIX = 'lesson-chapters/';
const THUMB_URL_PREFIX = '/api/courses/thumbnails/';
const WEBP_QUALITY = 78;

export const thumbKey = (lessonId: number, youtubeId: string, sec: number) => `${CHAPTER_THUMB_PREFIX}${lessonId}/${youtubeId}-${sec}.webp`;
export const thumbUrl = (key: string) => `${THUMB_URL_PREFIX}${key}`;
/** thumb นี้เป็นของคลิปนี้ไหม (key ฝัง youtubeId) */
export const thumbBelongsTo = (thumb: string | undefined, youtubeId: string) => !!thumb && thumb.includes(`/${youtubeId}-`);

/** เก็บ thumb เดิมไว้ให้บทที่เวลาเท่าเดิม (แอดมินแก้แค่ชื่อ) — เฉพาะของคลิปเดียวกัน */
export function mergeThumbs(next: LessonChapter[], prev: LessonChapter[] | null | undefined, youtubeId: string | null | undefined): LessonChapter[] {
  if (!youtubeId || !Array.isArray(prev) || prev.length === 0) return next.map((c) => ({ sec: c.sec, title: c.title }));
  const bySec = new Map<number, string>();
  for (const p of prev) if (thumbBelongsTo(p.thumb, youtubeId)) bySec.set(p.sec, p.thumb!);
  return next.map((c) => (bySec.has(c.sec) ? { sec: c.sec, title: c.title, thumb: bySec.get(c.sec)! } : { sec: c.sec, title: c.title }));
}

function cropWithFfmpeg(sheetPath: string, x: number, y: number, w: number, h: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const bin = resolveFfmpeg();
    if (!bin) return resolve(null);
    const outPath = path.join(os.tmpdir(), `chthumb-${crypto.randomUUID()}.webp`);
    const proc = spawn(bin, [
      '-hide_banner', '-loglevel', 'error',
      '-i', sheetPath,
      '-vf', `crop=${w}:${h}:${x}:${y}`,
      '-frames:v', '1',
      '-c:v', 'libwebp', '-quality', String(WEBP_QUALITY),
      '-y', outPath,
    ]);
    let done = false;
    const finish = (buf: Buffer | null) => { if (done) return; done = true; fs.unlink(outPath, () => {}); resolve(buf); };
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* noop */ } finish(null); }, 20000);
    proc.on('error', () => { clearTimeout(timer); finish(null); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return finish(null);
      fs.readFile(outPath, (err, data) => finish(err || !data?.length ? null : data));
    });
  });
}

export type ThumbsReason = 'not_found' | 'no_video' | 'no_chapters' | 'no_storyboard' | 'no_ffmpeg' | 'edited_meanwhile';
export interface ThumbsResult {
  ok: boolean;
  lesson_id: number;
  /** ภาพที่ทำใหม่รอบนี้ */
  generated: number;
  /** บทที่มีภาพแล้วหลังจบ */
  with_thumb: number;
  total: number;
  reason?: ThumbsReason;
}

/**
 * ทำภาพให้ทุกบทของบทเรียนที่ยังไม่มี (หรือทั้งหมดเมื่อ force) — โหลดแผ่นละครั้ง ตัดทีละเฟรม อัปโหลด แล้วเขียน thumb กลับ
 * ไม่ทับถ้าบทถูกแก้ระหว่างทำ (เทียบ sec+title ก่อนเขียน)
 */
export async function generateChapterThumbs(lessonId: number, opts: { force?: boolean } = {}): Promise<ThumbsResult> {
  const base = { lesson_id: lessonId, generated: 0, with_thumb: 0, total: 0 };
  const row = (await pool.query(`SELECT youtube_id, chapters FROM lessons WHERE id = $1`, [lessonId])).rows[0];
  if (!row) return { ok: false, ...base, reason: 'not_found' };
  const youtubeId: string | null = row.youtube_id || null;
  const chapters: LessonChapter[] = Array.isArray(row.chapters) ? row.chapters : [];
  if (!youtubeId) return { ok: false, ...base, reason: 'no_video' };
  if (!chapters.length) return { ok: false, ...base, reason: 'no_chapters' };
  const signature = JSON.stringify(chapters.map((c) => [c.sec, c.title]));
  const need = chapters.filter((c) => opts.force || !thumbBelongsTo(c.thumb, youtubeId));
  const countWith = (list: LessonChapter[]) => list.filter((c) => thumbBelongsTo(c.thumb, youtubeId)).length;
  if (need.length === 0) return { ok: true, ...base, with_thumb: countWith(chapters), total: chapters.length };
  if (!resolveFfmpeg()) return { ok: false, ...base, total: chapters.length, with_thumb: countWith(chapters), reason: 'no_ffmpeg' };

  const spec: StoryboardSpec | null = await fetchStoryboardSpec(youtubeId);
  const level: StoryboardLevel | null = spec ? pickThumbLevel(spec) : null;
  if (!spec || !level) return { ok: false, ...base, total: chapters.length, with_thumb: countWith(chapters), reason: 'no_storyboard' };

  const sheetFiles = new Map<number, string | null>();
  const tmpFiles: string[] = [];
  const getSheet = async (idx: number): Promise<string | null> => {
    if (sheetFiles.has(idx)) return sheetFiles.get(idx)!;
    const buf = await fetchSheet(sheetUrl(spec, level, idx));
    let p: string | null = null;
    if (buf) {
      p = path.join(os.tmpdir(), `chsheet-${lessonId}-${idx}-${crypto.randomUUID()}.webp`);
      fs.writeFileSync(p, buf);
      tmpFiles.push(p);
    }
    sheetFiles.set(idx, p);
    return p;
  };

  const updated: LessonChapter[] = chapters.map((c) => ({ ...c }));
  let generated = 0;
  try {
    for (const c of updated) {
      if (!need.some((n) => n.sec === c.sec)) continue;
      const loc = frameLocation(level, c.sec);
      const sheetPath = await getSheet(loc.sheet);
      if (!sheetPath) continue;
      const buf = await cropWithFfmpeg(sheetPath, loc.x, loc.y, loc.width, loc.height);
      if (!buf) continue;
      const key = thumbKey(lessonId, youtubeId, c.sec);
      try {
        await uploadFile(buf, key, 'image/webp', { contentDisposition: 'inline' });
        c.thumb = thumbUrl(key);
        generated++;
      } catch (error) {
        console.error(`[ChapterThumbs] upload failed ${key}:`, error);
      }
    }
  } finally {
    for (const p of tmpFiles) fs.unlink(p, () => {});
  }
  if (generated === 0) return { ok: false, ...base, total: chapters.length, with_thumb: countWith(chapters), reason: 'no_storyboard' };

  // เขียนกลับเฉพาะเมื่อบทยังเหมือนตอนเริ่ม (แอดมินอาจแก้ระหว่างทำ → รอบหน้าทำใหม่)
  const now = (await pool.query(`SELECT chapters FROM lessons WHERE id = $1`, [lessonId])).rows[0];
  const nowSig = JSON.stringify((Array.isArray(now?.chapters) ? now.chapters : []).map((c: LessonChapter) => [c.sec, c.title]));
  if (nowSig !== signature) return { ok: false, ...base, generated, total: chapters.length, with_thumb: countWith(chapters), reason: 'edited_meanwhile' };
  await pool.query(`UPDATE lessons SET chapters = $1::jsonb WHERE id = $2`, [JSON.stringify(updated), lessonId]);
  // ภาพของบทที่ไม่มีแล้ว (เวลาเปลี่ยน/ลบ) — ลบ best-effort (คีย์ของคลิปนี้ที่ไม่อยู่ในชุดใหม่)
  const keep = new Set(updated.map((c) => c.thumb).filter(Boolean));
  for (const old of chapters) {
    if (old.thumb && thumbBelongsTo(old.thumb, youtubeId) && !keep.has(old.thumb)) {
      deleteFile(old.thumb.replace(THUMB_URL_PREFIX, '')).catch(() => {});
    }
  }
  console.log(`[ChapterThumbs] lesson=${lessonId} generated=${generated}/${need.length} level=${level.width}x${level.height}`);
  return { ok: true, ...base, generated, total: updated.length, with_thumb: countWith(updated) };
}

/** ทำเบื้องหลังหลังบทถูกบันทึก — กันยิงซ้ำระหว่างทำ · ปิดด้วย CHAPTERS_THUMBS=0 */
const inFlight = new Set<number>();
export function queueChapterThumbs(lessonId: number, delayMs = 800): void {
  if (process.env.CHAPTERS_THUMBS === '0') return;
  if (inFlight.has(lessonId)) return;
  inFlight.add(lessonId);
  setTimeout(() => {
    generateChapterThumbs(lessonId)
      .then((r) => { if (!r.ok && r.reason !== 'no_chapters') console.log(`[ChapterThumbs] lesson=${lessonId} skipped: ${r.reason}`); })
      .catch((e) => console.error(`[ChapterThumbs] lesson=${lessonId} error:`, e))
      .finally(() => inFlight.delete(lessonId));
  }, delayMs);
}
