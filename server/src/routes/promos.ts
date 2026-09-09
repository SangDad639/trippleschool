/**
 * โฆษณาแทรกแบบ YouTube ในวิดีโอบทเรียน (migration 065 · docs/PLAN-PROMO-VIDEOS.md)
 *
 * - คลังโฆษณา `promo_videos` มี 2 แบบ (source_type):
 *   · 'youtube' (หลัก — user ให้คลิป YouTube มาเป็นโฆษณา): เก็บ youtube_id, ฝั่ง client เล่นผ่าน YouTube IFrame API
 *   · 'file': ไฟล์วิดีโอของเราเอง (mp4/webm) บน S3 ใต้ `promo-videos/…` → เสิร์ฟผ่าน GET/HEAD /api/promos/:id/video
 *     ซึ่งรองรับ HTTP Range/206 (ตัวแรกของ repo — iOS Safari ไม่เล่นวิดีโอเลยถ้า probe `bytes=0-1` ไม่ได้ 206) · Tigris ไม่มี public URL
 * - จุดแทรกต่อบทเรียนอยู่ที่ `lesson_promos` (จัดการผ่าน POST/PUT lessons ใน routes/courses.ts)
 * - ชื่อ path/prefix ใช้ "promo" ไม่ใช่ "ad" — filter list ของ adblock บล็อก /ads/ ทั้ง path
 * - meta สาธารณะ (GET /:id) ไม่ส่ง video_key ออกไป · โฆษณาไม่ใช่เนื้อหาขาย video endpoint จึง public
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import type { Readable } from 'stream';
import pool from '../db.js';
import { authenticate, optionalAuth, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { uploadFileFromPath, getFile, getFileRange, getFileSize, deleteFile } from '../utils/s3.js';
import { extractYoutubeId } from './courses.js';

const router = Router();
const MB = 1024 * 1024;
const PROMO_MAX_MB = 200;
export const PROMO_PREFIX = 'promo-videos/';
/** open-ended range (`bytes=N-`) ตอบทีละก้อน — ไม่ให้ผู้ชมที่กำลัง seek ตรึง stream Tigris→Railway ทั้งไฟล์ */
const OPEN_RANGE_CHUNK = 8 * MB;

// ffmpeg-static (optional): remux ให้ moov อยู่หัวไฟล์ (faststart) → เริ่มเล่นเร็วขึ้นบนเน็ตช้า
// server อาจติดตั้งด้วย --ignore-scripts แล้วไม่มี binary → best-effort เสมอ
let ffmpegPath: string | null = null;
(async () => {
  try {
    // @ts-ignore - ffmpeg-static types don't match ESM default export
    const mod = await import('ffmpeg-static');
    const resolved = (mod as any).default || mod;
    if (typeof resolved === 'string' && resolved && fs.existsSync(resolved)) ffmpegPath = resolved;
  } catch {
    ffmpegPath = null;
  }
})();

/* ------------------------------------------------------------------ */
/*  Upload                                                             */
/* ------------------------------------------------------------------ */
const promoUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),   // ห้าม memoryStorage — RAM บน Railway
  limits: { fileSize: PROMO_MAX_MB * MB },
  fileFilter: (_req, file, cb) => {
    if (/\.(mp4|m4v|webm)$/i.test(file.originalname) || /^video\/(mp4|webm|x-m4v)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์ mp4 / webm'));
  },
});
function uploadPromoSingle(field: string) {
  return (req: Request, res: Response, next: NextFunction) =>
    promoUpload.single(field)(req, res, (err: any) => {
      if (err) {
        const msg = err?.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${PROMO_MAX_MB} MB` : (err?.message || 'อัปโหลดไม่สำเร็จ');
        return res.status(400).json({ error: msg });
      }
      next();
    });
}
/** multer ให้ชื่อไฟล์เป็น latin1 — แปลงกลับเป็น UTF-8 (ชื่อไทย) */
function decodeUploadName(name: string): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

/** remux mp4 เป็น faststart (copy stream ไม่ encode ใหม่) — ล้มเหลว = ใช้ไฟล์เดิม */
function tryFaststart(tmpPath: string): { path: string; size: number; remuxed: boolean } {
  const original = { path: tmpPath, size: fs.statSync(tmpPath).size, remuxed: false };
  if (!ffmpegPath) return original;
  const out = `${tmpPath}.faststart.mp4`;
  try {
    execFileSync(ffmpegPath, ['-y', '-i', tmpPath, '-c', 'copy', '-movflags', '+faststart', out], { timeout: 120_000, stdio: 'ignore' });
    const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
    if (size > 0) return { path: out, size, remuxed: true };
  } catch (e: any) {
    console.warn('[promos] faststart remux skipped:', e?.message || e);
  }
  fs.promises.unlink(out).catch(() => { /* ไม่มี */ });
  return original;
}

// NOTE: literal routes ต้องมาก่อน /:id
router.post('/upload-video', authenticate, requireAdmin, uploadPromoSingle('file'), async (req: AuthRequest, res: Response) => {
  const tmpPath = req.file?.path;
  let remuxPath: string | null = null;
  try {
    if (!req.file || !tmpPath) return res.status(400).json({ error: 'No file uploaded' });
    const isWebm = /\.webm$/i.test(req.file.originalname) || req.file.mimetype === 'video/webm';
    const ext = isWebm ? 'webm' : 'mp4';
    const contentType = isWebm ? 'video/webm' : 'video/mp4';
    let src = { path: tmpPath, size: req.file.size, remuxed: false };
    if (!isWebm) {
      src = tryFaststart(tmpPath);
      if (src.remuxed) remuxPath = src.path;
    }
    const rand = Math.random().toString(36).slice(2, 10);
    const key = `${PROMO_PREFIX}${Date.now()}-${rand}.${ext}`;
    // ต้อง 'inline' — disposition ถูก bake ตอนอัปโหลด (s3.ts) ถ้าเป็น attachment เบราว์เซอร์จะดาวน์โหลดแทนเล่น
    await uploadFileFromPath(src.path, src.size, key, contentType, { contentDisposition: 'inline' });
    res.json({
      video_key: key,
      size_bytes: src.size,
      content_type: contentType,
      name: decodeUploadName(req.file.originalname),
      faststart: src.remuxed,
    });
  } catch (error) {
    console.error('[promos] upload error:', error);
    res.status(500).json({ error: 'อัปโหลดวิดีโอไม่สำเร็จ' });
  } finally {
    if (tmpPath) fs.promises.unlink(tmpPath).catch(() => { /* ไม่มีแล้ว */ });
    if (remuxPath) fs.promises.unlink(remuxPath).catch(() => { /* ไม่มีแล้ว */ });
  }
});

/* ------------------------------------------------------------------ */
/*  Shapes + validation                                                */
/* ------------------------------------------------------------------ */
interface PromoRow {
  id: number;
  title: string;
  source_type: 'youtube' | 'file';
  youtube_id: string | null;
  video_key: string | null;
  content_type: string;
  size_bytes: number | string | null;
  duration_sec: number | null;
  poster_url: string | null;
  click_url: string | null;
  skip_after_sec: number | null;
  is_active: boolean;
  created_by: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  usage_count?: number;
}

const toMs = (v: Date | string) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
/** URL วิดีโอสำหรับ <video src> — `?v=` = cache-bust เมื่อแอดมินเปลี่ยนไฟล์ (endpoint ตอบ immutable) */
const videoUrlOf = (r: PromoRow) => `/api/promos/${r.id}/video?v=${toMs(r.updated_at) || 0}`;

/** meta ที่ผู้เรียนเห็น — ไม่มี video_key · youtube → youtube_id · file → video_url (Range proxy) */
function toPublic(r: PromoRow) {
  const isYoutube = r.source_type === 'youtube';
  return {
    id: r.id,
    title: r.title,
    source_type: isYoutube ? 'youtube' : 'file',
    youtube_id: isYoutube ? r.youtube_id : null,
    video_url: isYoutube ? null : videoUrlOf(r),
    poster_url: r.poster_url,
    click_url: r.click_url,
    skip_after_sec: r.skip_after_sec == null ? null : Number(r.skip_after_sec),
    duration_sec: r.duration_sec == null ? null : Number(r.duration_sec),
  };
}
function toAdmin(r: PromoRow) {
  return {
    ...toPublic(r),
    youtube_url: r.source_type === 'youtube' && r.youtube_id ? `https://youtu.be/${r.youtube_id}` : null,
    content_type: r.content_type,
    size_bytes: r.size_bytes == null ? null : Number(r.size_bytes),
    is_active: !!r.is_active,
    usage_count: Number(r.usage_count ?? 0),
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const isHttpUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);
const isPosterUrl = (v: string) => v.startsWith('/api/courses/thumbnails/') || isHttpUrl(v);
const isPromoKey = (v: string | null | undefined) => !!v && v.startsWith(PROMO_PREFIX) && !v.includes('..') && v.length < 300;

type FieldSpec = { col: string; value: unknown } | { error: string };
/**
 * แปลง body → รายการคอลัมน์ที่จะเขียน (ทั้ง create และ update) · คืน error ไทยถ้าไม่ผ่าน
 * แหล่งวิดีโอ: ส่ง `youtube_url` (หรือ `youtube_id`) = โฆษณาแบบ YouTube · ส่ง `video_key` = ไฟล์ที่อัปโหลด
 * (create ต้องมีอย่างใดอย่างหนึ่ง · update เปลี่ยนแหล่งได้ — อีกฝั่งถูกล้าง)
 */
function parsePromoFields(body: any, isUpdate: boolean): FieldSpec[] {
  const out: FieldSpec[] = [];
  if (!isUpdate || body.title !== undefined) {
    const t = String(body.title ?? '').trim();
    if (!t) return [{ error: 'กรุณาใส่ชื่อโฆษณา' }];
    if (t.length > 255) return [{ error: 'ชื่อยาวเกิน 255 ตัวอักษร' }];
    out.push({ col: 'title', value: t });
  }
  const ytRaw = body.youtube_url ?? body.youtube_id;
  const hasYt = ytRaw !== undefined && ytRaw !== null && String(ytRaw).trim() !== '';
  const hasKey = body.video_key !== undefined && body.video_key !== null && String(body.video_key).trim() !== '';
  if (hasYt && hasKey) return [{ error: 'เลือกแหล่งวิดีโอได้อย่างเดียว: ลิงก์ YouTube หรือไฟล์ที่อัปโหลด' }];
  if (!isUpdate && !hasYt && !hasKey) return [{ error: 'กรุณาใส่ลิงก์ YouTube หรืออัปโหลดไฟล์วิดีโอ' }];
  if (hasYt) {
    const ytId = extractYoutubeId(String(ytRaw));
    if (!ytId) return [{ error: 'ลิงก์ YouTube ไม่ถูกต้อง (รองรับ watch?v=, youtu.be, /embed/, /shorts/)' }];
    out.push({ col: 'source_type', value: 'youtube' });
    out.push({ col: 'youtube_id', value: ytId });
    out.push({ col: 'video_key', value: null });
    out.push({ col: 'size_bytes', value: null });
  } else if (hasKey) {
    const k = String(body.video_key).trim();
    if (!isPromoKey(k)) return [{ error: 'video_key ไม่ถูกต้อง — ต้องอัปโหลดผ่าน /api/promos/upload-video' }];
    out.push({ col: 'source_type', value: 'file' });
    out.push({ col: 'youtube_id', value: null });
    out.push({ col: 'video_key', value: k });
    const ct = String(body.content_type ?? 'video/mp4');
    out.push({ col: 'content_type', value: /^video\/(mp4|webm)$/.test(ct) ? ct : 'video/mp4' });
    const sz = body.size_bytes == null || body.size_bytes === '' ? null : Number(body.size_bytes);
    if (sz !== null && (!Number.isFinite(sz) || sz < 0)) return [{ error: 'size_bytes ไม่ถูกต้อง' }];
    out.push({ col: 'size_bytes', value: sz });
  }
  if (body.duration_sec !== undefined) {
    const d = body.duration_sec == null || body.duration_sec === '' ? null : Math.round(Number(body.duration_sec));
    if (d !== null && (!Number.isFinite(d) || d < 0)) return [{ error: 'duration_sec ไม่ถูกต้อง' }];
    out.push({ col: 'duration_sec', value: d && d > 0 ? d : null });
  }
  if (body.poster_url !== undefined) {
    const p = body.poster_url == null ? '' : String(body.poster_url).trim();
    if (p && !isPosterUrl(p)) return [{ error: 'ปกก่อนเล่นต้องเป็นรูปที่อัปโหลดผ่านระบบ หรือลิงก์ http(s)' }];
    out.push({ col: 'poster_url', value: p || null });
  }
  if (body.click_url !== undefined) {
    const c = body.click_url == null ? '' : String(body.click_url).trim();
    if (c && !isHttpUrl(c)) return [{ error: 'ลิงก์เมื่อคลิกต้องขึ้นต้นด้วย http:// หรือ https://' }];
    out.push({ col: 'click_url', value: c || null });
  }
  if (body.skip_after_sec !== undefined) {
    const s = body.skip_after_sec === null || body.skip_after_sec === '' ? null : Number(body.skip_after_sec);
    if (s !== null && (!Number.isInteger(s) || s < 0 || s > 120)) return [{ error: 'ข้ามได้หลัง ต้องเป็น 0-120 วินาที หรือว่าง (ห้ามข้าม)' }];
    out.push({ col: 'skip_after_sec', value: s });
  }
  if (body.is_active !== undefined) out.push({ col: 'is_active', value: body.is_active === true });
  return out;
}

const ADMIN_SELECT = `
  SELECT p.*, (SELECT COUNT(*)::int FROM lesson_promos lp WHERE lp.promo_id = p.id) AS usage_count
    FROM promo_videos p`;

/* ------------------------------------------------------------------ */
/*  Admin CRUD                                                         */
/* ------------------------------------------------------------------ */
router.get('/admin/all', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query<PromoRow>(`${ADMIN_SELECT} ORDER BY p.id DESC LIMIT 500`);
    res.json({ promos: r.rows.map(toAdmin), max_mb: PROMO_MAX_MB });
  } catch (error) {
    console.error('[promos] list error:', error);
    res.status(500).json({ error: 'โหลดรายการโฆษณาไม่สำเร็จ' });
  }
});

router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const specs = parsePromoFields(req.body ?? {}, false);
    const bad = specs.find((s): s is { error: string } => 'error' in s);
    if (bad) return res.status(400).json({ error: bad.error });
    const cols = specs.filter((s): s is { col: string; value: unknown } => 'col' in s);
    if (!cols.some((c) => c.col === 'skip_after_sec')) cols.push({ col: 'skip_after_sec', value: 5 });
    cols.push({ col: 'created_by', value: req.userId ?? null });
    const names = cols.map((c) => c.col);
    const values = cols.map((c) => c.value);
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO promo_videos (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      values,
    );
    const r = await pool.query<PromoRow>(`${ADMIN_SELECT} WHERE p.id = $1`, [ins.rows[0].id]);
    console.log(`[promos][AUDIT] created #${ins.rows[0].id} "${r.rows[0].title}" by admin #${req.userId}`);
    res.json({ promo: toAdmin(r.rows[0]) });
  } catch (error) {
    console.error('[promos] create error:', error);
    res.status(500).json({ error: 'สร้างโฆษณาไม่สำเร็จ' });
  }
});

router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
    const specs = parsePromoFields(req.body ?? {}, true);
    const bad = specs.find((s): s is { error: string } => 'error' in s);
    if (bad) return res.status(400).json({ error: bad.error });
    const cols = specs.filter((s): s is { col: string; value: unknown } => 'col' in s);
    if (cols.length === 0) return res.status(400).json({ error: 'ไม่มีอะไรให้แก้' });
    const cur = await pool.query<PromoRow>(`SELECT video_key FROM promo_videos WHERE id = $1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'ไม่พบโฆษณา' });
    const sets = cols.map((c, i) => `${c.col} = $${i + 1}`);
    sets.push('updated_at = NOW()');
    const values = cols.map((c) => c.value);
    values.push(id);
    await pool.query(`UPDATE promo_videos SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    // เปลี่ยนไฟล์ / สลับไป YouTube → ลบ object เก่า (best-effort)
    const keySpec = cols.find((c) => c.col === 'video_key');
    const oldKey = cur.rows[0].video_key;
    if (keySpec && keySpec.value !== oldKey && isPromoKey(oldKey)) {
      deleteFile(oldKey!).catch((e) => console.warn('[promos] delete old object failed:', e?.message || e));
    }
    const r = await pool.query<PromoRow>(`${ADMIN_SELECT} WHERE p.id = $1`, [id]);
    console.log(`[promos][AUDIT] updated #${id} (${cols.map((c) => c.col).join(',')}) by admin #${req.userId}`);
    res.json({ promo: toAdmin(r.rows[0]) });
  } catch (error) {
    console.error('[promos] update error:', error);
    res.status(500).json({ error: 'บันทึกโฆษณาไม่สำเร็จ' });
  }
});

router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
    const usage = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM lesson_promos WHERE promo_id = $1`, [id]);
    const del = await pool.query<{ video_key: string; title: string }>(
      `DELETE FROM promo_videos WHERE id = $1 RETURNING video_key, title`, [id]
    );
    if (del.rows.length === 0) return res.status(404).json({ error: 'ไม่พบโฆษณา' });
    if (isPromoKey(del.rows[0].video_key)) {
      deleteFile(del.rows[0].video_key!).catch((e) => console.warn('[promos] delete object failed:', e?.message || e));
    }
    console.log(`[promos][AUDIT] deleted #${id} "${del.rows[0].title}" (was used in ${usage.rows[0].n} slots) by admin #${req.userId}`);
    res.json({ ok: true, usage_count: usage.rows[0].n });
  } catch (error) {
    console.error('[promos] delete error:', error);
    res.status(500).json({ error: 'ลบโฆษณาไม่สำเร็จ' });
  }
});

/* ------------------------------------------------------------------ */
/*  Learner: meta + video stream + บันทึกว่าดูแล้ว                    */
/* ------------------------------------------------------------------ */
/** 1 โฆษณา / 1 ผู้เรียน / 7 วัน (migration 066) */
export const PROMO_COOLDOWN_DAYS = 7;

/**
 * POST /api/promos/:id/seen — ผู้เรียนดูโฆษณานี้จบ/ข้ามแล้ว
 * ล็อกอิน → upsert promo_views (จำข้ามอุปกรณ์) · guest → ตอบ ok เฉยๆ (FE จำใน localStorage เอง)
 */
router.post('/:id/seen', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'ไม่พบโฆษณา' });
    if (!req.userId) return res.json({ ok: true, stored: false, cooldown_days: PROMO_COOLDOWN_DAYS });
    const r = await pool.query<{ last_seen_at: Date }>(
      `INSERT INTO promo_views (user_id, promo_id, last_seen_at, view_count)
       SELECT $1, id, NOW(), 1 FROM promo_videos WHERE id = $2
       ON CONFLICT (user_id, promo_id) DO UPDATE SET last_seen_at = NOW(), view_count = promo_views.view_count + 1
       RETURNING last_seen_at`,
      [req.userId, id],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'ไม่พบโฆษณา' });
    const next = new Date(new Date(r.rows[0].last_seen_at).getTime() + PROMO_COOLDOWN_DAYS * 86400_000);
    res.json({ ok: true, stored: true, cooldown_days: PROMO_COOLDOWN_DAYS, next_at: next.toISOString() });
  } catch (error) {
    console.error('[promos] mark seen error:', error);
    res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  }
});

router.get('/:id', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'ไม่พบโฆษณา' });
    const r = await pool.query<PromoRow>(`SELECT * FROM promo_videos WHERE id = $1`, [id]);
    const p = r.rows[0];
    if (!p || (!p.is_active && !req.isAdmin)) return res.status(404).json({ error: 'ไม่พบโฆษณา' });
    res.set('Cache-Control', 'no-store');
    res.json({ promo: toPublic(p) });
  } catch (error) {
    console.error('[promos] meta error:', error);
    res.status(500).json({ error: 'โหลดโฆษณาไม่สำเร็จ' });
  }
});

/**
 * GET/HEAD /api/promos/:id/video — สตรีมไฟล์โฆษณาพร้อม HTTP Range (206)
 * public (key เดาไม่ได้, ไม่ใช่เนื้อหาขาย) · immutable cache เพราะ URL มี ?v=updated_at
 * Express ส่ง HEAD เข้า handler GET — ตอบ header อย่างเดียว ไม่ยิง S3
 */
router.get('/:id/video', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).end();
    const r = await pool.query<PromoRow>(`SELECT id, source_type, video_key, content_type, size_bytes FROM promo_videos WHERE id = $1`, [id]);
    const p = r.rows[0];
    if (!p || p.source_type !== 'file' || !isPromoKey(p.video_key)) return res.status(404).end();
    const videoKey = p.video_key!;
    const total = p.size_bytes != null ? Number(p.size_bytes) : await getFileSize(videoKey);
    if (total == null || !Number.isFinite(total) || total <= 0) return res.status(404).end();

    res.setHeader('Content-Type', p.content_type || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', String(total));
      return res.status(200).end();
    }

    const rangeHdr = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    let start = 0;
    let end = total - 1;
    let partial = false;
    if (rangeHdr) {
      const parsed = req.range(total);
      if (parsed === -1) {
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }
      // -2 (malformed) หรือ multi-range → ตอบ 200 เต็มไฟล์ (เบราว์เซอร์ทุกตัวรับได้)
      if (Array.isArray(parsed) && parsed.type === 'bytes' && parsed.length === 1) {
        start = parsed[0].start;
        end = parsed[0].end;
        partial = true;
        if (/^bytes=\d+-$/.test(rangeHdr)) end = Math.min(end, start + OPEN_RANGE_CHUNK - 1);
      }
    }

    const obj = partial ? await getFileRange(videoKey, `bytes=${start}-${end}`) : await getFile(videoKey);
    const body = obj.Body as Readable | undefined;
    if (!body || typeof (body as any).pipe !== 'function') return res.status(502).end();
    // client ยกเลิก (seek / ปิดแท็บ / Safari probe) → ปิด stream จาก Tigris ทันที ไม่ปล่อยค้าง
    res.on('close', () => { try { body.destroy(); } catch { /* noop */ } });
    if (partial) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(total));
    }
    body.on('error', (e: any) => {
      console.error('[promos] stream error:', e?.message || e);
      if (!res.headersSent) res.status(502);
      res.end();
    });
    body.pipe(res);
  } catch (error: any) {
    console.error('[promos] video error:', error?.message || error);
    if (!res.headersSent) res.status(error?.$metadata?.httpStatusCode === 404 ? 404 : 500).end();
    else res.end();
  }
});

export default router;
