/**
 * helper "บทในคลิป" ฝั่ง FE — parse/format ข้อความรูปแบบ YouTube (`mm:ss ชื่อบท` ต่อบรรทัด) แบบเดียวกับเซิร์ฟเวอร์
 * (services/lessonChapters.ts) + ตรวจสดสำหรับกล่องแอดมิน
 */
import type { LessonChapter } from '@/types/lesson';

export const MAX_CHAPTER_TITLE = 120;
/** ชื่อยาวกว่านี้อ่านยากในรายการใต้วิดีโอ — เตือนเฉยๆ ไม่ห้ามบันทึก */
export const WARN_TITLE_LEN = 60;
/** วินาที 00-59 เท่านั้น (ถ้ามีชั่วโมง นาทีก็ 00-59) — เหมือนเซิร์ฟเวอร์ */
const TS_LINE_RE = /^\s*[([]?((?:\d{1,2}:[0-5]\d|\d{1,3}):[0-5]\d)[)\]]?\s*[-–—:.|]?\s*(.+?)\s*$/;

/** id คลิปจากลิงก์ YouTube (watch?v= / youtu.be / embed / shorts / live) หรือ id 11 ตัวตรงๆ · ไม่ใช่ = null */
const YT_URL_RE = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})|^([a-zA-Z0-9_-]{11})$/;
export function ytIdFromUrl(url: string | null | undefined): string | null {
  const m = String(url ?? '').trim().match(YT_URL_RE);
  return m ? (m[1] || m[2]) : null;
}

export function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(x).padStart(2, '0')}`;
}
const toSec = (ts: string) => {
  const p = ts.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

export function formatChapterText(chapters: LessonChapter[]): string {
  return chapters.map((c) => `${formatSec(c.sec)} ${c.title}`).join('\n');
}

export interface ChapterLineCheck {
  line: number;
  raw: string;
  sec: number | null;
  title: string;
  /** null = ใช้ได้ */
  error: string | null;
  /** เตือน (ยังบันทึกได้) */
  warn?: string;
}

export interface LengthHint {
  /** ความยาวคลิป (วินาที) */
  sec: number;
  /** true = ความยาวจริงจาก YouTube → เกิน = ผิด · false = ประมาณจากจบซับ → เกิน = แค่เตือน */
  exact: boolean;
}

/** ตรวจทีละบรรทัด — ให้กล่องแอดมินโชว์บรรทัดที่ผิดพร้อมเหตุผล · บรรทัดว่างข้าม */
export function checkChapterText(text: string, length?: LengthHint | null): ChapterLineCheck[] {
  const out: ChapterLineCheck[] = [];
  const seen = new Set<number>();
  let prev = -1;
  String(text ?? '').split(/\r?\n/).forEach((raw, idx) => {
    if (!raw.trim()) return;
    const m = raw.match(TS_LINE_RE);
    if (!m) {
      out.push({ line: idx + 1, raw, sec: null, title: raw.trim(), error: 'ไม่ใช่รูปแบบ นาที:วินาที ชื่อบท' });
      return;
    }
    const sec = toSec(m[1]);
    const title = m[2].trim();
    let error: string | null = null;
    let warn: string | undefined;
    if (!title) error = 'ยังไม่มีชื่อบท';
    else if (length && length.exact && length.sec > 0 && sec >= length.sec) error = `เกินความยาวคลิป (${formatSec(length.sec)})`;
    else if (seen.has(sec)) error = 'เวลาซ้ำกับบรรทัดอื่น';
    else if (sec < prev) error = 'ไม่เรียงเวลา — กด "เรียงเวลา"';
    else if (title.length > MAX_CHAPTER_TITLE) error = `ชื่อยาวเกิน ${MAX_CHAPTER_TITLE} ตัวอักษร`;
    else if (length && !length.exact && length.sec > 0 && sec >= length.sec) warn = `เลยช่วงที่มีซับ (${formatSec(length.sec)}) — เช็คว่าไม่เกินคลิป`;
    else if (title.length > WARN_TITLE_LEN) warn = 'ชื่อยาว อาจถูกตัดในมือถือ';
    if (!error) {
      seen.add(sec);
      prev = Math.max(prev, sec);
    }
    out.push({ line: idx + 1, raw, sec, title, error, warn });
  });
  return out;
}

/** เฉพาะบรรทัดที่ใช้ได้ → รายการบทเรียงเวลา */
export function parseChapterText(text: string, length?: LengthHint | null): LessonChapter[] {
  return checkChapterText(text, length)
    .filter((r) => !r.error && r.sec !== null)
    .map((r) => ({ sec: r.sec as number, title: r.title.slice(0, MAX_CHAPTER_TITLE) }))
    .sort((a, b) => a.sec - b.sec);
}

/** บทที่กำลังเล่นอยู่ = บทสุดท้ายที่เริ่มก่อนหรือเท่ากับเวลาปัจจุบัน · currentSec null = ยังไม่ได้เล่น → -1 */
export function activeChapterIndex(chapters: LessonChapter[], currentSec: number | null): number {
  if (currentSec === null) return -1;
  let idx = -1;
  chapters.forEach((c, i) => { if (c.sec <= currentSec) idx = i; });
  return idx;
}
