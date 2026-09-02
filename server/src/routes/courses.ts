// Course Learning System — courses, sections, lessons + thumbnail upload/proxy.
// Ported from sora-spark-forge, adapted to trippleschool:
//   - pool (default import), authenticate/requireAdmin (req.isAdmin/req.userId)
//   - thumbnails stored as a backend-proxy URL (/api/courses/thumbnails/<key>);
//     served via a public GET proxy (S3/OBS has no public ACL).
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import pool from '../db.js';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth.js';
import { uploadFile, getFile } from '../utils/s3.js';
import { makeThumbnailVariant, variantKey, type ThumbVariant } from '../utils/imageResize.js';
import { hasActiveSubscription } from '../services/stripeService.js';

const router = Router();

/** Per-course access: an APPROVED purchase for THIS course (or admin). */
async function hasApprovedEnrollment(userId: number | undefined, courseId: number): Promise<boolean> {
  if (!userId) return false;
  const r = await pool.query(
    `SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'approved' LIMIT 1`,
    [userId, courseId]
  );
  return r.rows.length > 0;
}

/** Course access: admin, active subscription (unlocks ALL courses), or approved purchase. */
async function hasSubscriptionOrEnrollment(userId: number | undefined, courseId: number): Promise<boolean> {
  if (!userId) return false;
  if (await hasActiveSubscription(userId)) return true;
  return hasApprovedEnrollment(userId, courseId);
}

/** คอร์สฟรี = flag is_free (admin ติ๊กเอง) → ทุกคนดูได้ทุกบท ไม่ต้อง login/ซื้อ/สมัคร — ไม่ผูกกับราคา */
function isFreeCourse(course: { is_free?: boolean | null } | undefined | null): boolean {
  return !!course && course.is_free === true;
}

/** เช็ค flag ฟรีจาก id (ใช้ใน gate ที่ยังไม่ได้ SELECT คอร์สมาก่อน) — คอร์สปิด (inactive) ไม่นับฟรี */
async function isCourseFreeById(courseId: number): Promise<boolean> {
  if (!Number.isFinite(courseId)) return false;
  const r = await pool.query(`SELECT is_free FROM courses WHERE id = $1 AND is_active = true`, [courseId]);
  return r.rows[0]?.is_free === true;
}

const thumbUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

// Lesson documents: common document/media types, up to 50MB. Served as an
// attachment (forced download) via the /materials proxy.
const ALLOWED_MATERIAL_EXTS = new Set([
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt',
  'zip', 'rar', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'mp4',
]);
const materialUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (ALLOWED_MATERIAL_EXTS.has(ext)) cb(null, true);
    else cb(new Error('ชนิดไฟล์นี้ไม่รองรับ'));
  },
});

// HTML document: stored on S3 (only a pointer goes into lessons.materials).
// 50MB — Word/Docs exports embed base64 images and get large.
const htmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isHtml = /text\/html|htm/i.test(file.mimetype) || /\.(html?|htm)$/i.test(file.originalname);
    if (isHtml) cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์ .html'));
  },
});

// Wrap a multer .single() so filter/size errors return JSON (not an HTML error
// page) — the client can then show the real reason instead of "Request failed".
function uploadSingle(mw: multer.Multer, field: string) {
  return (req: Request, res: Response, next: () => void) =>
    mw.single(field)(req, res, (err: any) => {
      if (err) {
        const msg = err?.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ใหญ่เกินกำหนด' : (err?.message || 'อัปโหลดไม่สำเร็จ');
        return res.status(400).json({ error: msg });
      }
      next();
    });
}

// A lesson material as accepted from the client / stored in the lessons.materials JSONB.
//   link/pdf → downloadable (uses `url`)
//   html     → inline content shown in the lesson page (uses `content`; sanitized on render)
interface LessonMaterial {
  title: string;
  url: string;
  type: 'link' | 'pdf' | 'html';
  enabled: boolean; // false = hidden from students (admin keeps the row)
  content?: string;
  fileName?: string; // original name of an uploaded HTML file (for the admin "attached" badge)
}

/**
 * List payloads must NOT carry inline html `content` — a single course can hold
 * tens of MB of embedded HTML (base64 images), which made the course page take
 * forever to load. Lists get metadata + `has_content`; the full material is
 * fetched per-lesson via GET /lessons/:lessonId/materials only when needed
 * (learn page, admin edit dialog).
 */
function stripMaterialContent(materials: unknown): any[] {
  if (!Array.isArray(materials)) return [];
  return materials.map((m: any) =>
    m?.type === 'html'
      ? {
          ...m,
          content: '',
          // Idempotent: rows already stripped in SQL carry has_content — keep it.
          has_content: m.has_content ?? !!(m.content && String(m.content).trim()),
        }
      : m
  );
}

/**
 * SQL fragment doing the same strip INSIDE Postgres — the DB is remote, so the
 * heavy content must never cross the wire for list queries at all (that was
 * the actual 5s: pulling 66MB from the DB per request, even though the API
 * response was already small).
 */
const MATERIALS_META_SQL = `(
  SELECT COALESCE(jsonb_agg(
    CASE WHEN elem->>'type' = 'html'
         THEN (elem - 'content') || jsonb_build_object('content', '', 'has_content', COALESCE(LENGTH(elem->>'content'), 0) > 0)
         ELSE elem END), '[]'::jsonb)
  FROM jsonb_array_elements(%COL%) elem
)`;

function materialsMetaSql(column: string): string {
  return MATERIALS_META_SQL.replace('%COL%', column);
}

// Guard rails for future courses: inline html docs ballooned one course to
// 66MB of JSONB (base64 images inside exported HTML). Pages are now safe via
// SQL-side stripping, but the per-lesson fetch still pulls the real thing —
// so cap what admins can save and point them at PDF/Drive links instead.
const HTML_MATERIAL_MAX = 10 * 1024 * 1024; // per doc
const MATERIALS_TOTAL_MAX = 20 * 1024 * 1024; // per lesson
function validateMaterialsSize(materials: LessonMaterial[]): string | null {
  let total = 0;
  for (const m of materials) {
    const size = (m.content || '').length;
    total += size;
    if (size > HTML_MATERIAL_MAX) {
      return `เอกสาร "${m.title || 'ไม่มีชื่อ'}" ใหญ่เกิน ${Math.round(HTML_MATERIAL_MAX / 1024 / 1024)}MB — แนะนำแนบเป็นไฟล์ PDF หรือลิงก์ Google Drive แทน (ไฟล์ HTML ที่ฝังรูปจะใหญ่มากและทำให้หน้าเรียนช้า)`;
    }
  }
  if (total > MATERIALS_TOTAL_MAX) {
    return `เอกสารรวมของบทเรียนนี้ใหญ่เกิน ${Math.round(MATERIALS_TOTAL_MAX / 1024 / 1024)}MB — แนะนำย้ายบางส่วนเป็นไฟล์ PDF หรือลิงก์ Google Drive`;
  }
  return null;
}

// Convert a Google Drive "share/view" link into a direct-download link so the
// student's download button fetches the file instead of opening Drive's UI.
function normalizeMaterialUrl(url: string): string {
  const fileMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  const openMatch = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return `https://drive.google.com/uc?export=download&id=${openMatch[1]}`;
  return url;
}

// Keep only well-formed rows with a non-empty url; coerce shape defensively.
function sanitizeMaterials(input: unknown): LessonMaterial[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m): LessonMaterial => {
      const type = m.type === 'pdf' ? 'pdf' : m.type === 'html' ? 'html' : 'link';
      const url = typeof m.url === 'string' ? m.url.trim() : '';
      return {
        title: typeof m.title === 'string' ? m.title.trim() : '',
        // Only normalize pasted links; uploaded PDFs already point at our proxy.
        url: type === 'link' ? normalizeMaterialUrl(url) : url,
        type,
        enabled: typeof m.enabled === 'boolean' ? m.enabled : true,
        content: type === 'html' && typeof m.content === 'string' ? m.content : '',
        fileName: typeof m.fileName === 'string' ? m.fileName : undefined,
      };
    })
    // html rows are kept by inline content (legacy) or an uploaded S3 file (url);
    // link/pdf rows by their url.
    .filter((m) => (m.type === 'html' ? (m.content || '').trim().length > 0 || m.url.length > 0 : m.url.length > 0));
}

// Extract YouTube ID from common URL formats (or a bare 11-char id).
// Covers watch?v= (with any leading query params), youtu.be, /embed/, /shorts/,
// /live/ and /v/. An unmatched form returns null so callers reject the URL
// instead of silently keeping a stale id.
function extractYoutubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const patterns = [
    /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// ============ Public thumbnail proxy (no auth so <img> can load) ============
// ?v=card|hero serves the pre-generated webp variant (a fraction of the
// original size); missing variants fall back to the original transparently,
// so old thumbnails keep working until the backfill script has run.
// prefix ที่ยอมให้ดึงผ่าน proxy สาธารณะนี้ — เดิมรับ key อะไรก็ได้ ทำให้ object อื่น
// ในบัคเก็ต (เช่นสลิปโอนเงิน payment-slips/…) ถูกดึงได้ถ้ารู้คีย์
const PUBLIC_IMAGE_PREFIXES = ['course-thumb/', 'lesson-cover/', 'lesson-thumb-cache/', 'course-cover-cache/'];

router.get('/thumbnails/*', async (req: Request, res: Response) => {
  try {
    const key = (req.params as any)[0];
    if (!PUBLIC_IMAGE_PREFIXES.some((p) => key.startsWith(p))) {
      return res.status(404).json({ error: 'Not found' });
    }
    const v = req.query.v;
    if (v === 'card' || v === 'hero') {
      try {
        const varObj = await getFile(variantKey(key, v));
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        (varObj.Body as any).pipe(res);
        return;
      } catch {
        /* variant not generated yet — fall back to original below */
      }
    }
    const obj = await getFile(key);
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    (obj.Body as any).pipe(res);
  } catch (error) {
    res.status(404).json({ error: 'Not found' });
  }
});

// ============ Public: per-lesson cover image ============
// Serves the lesson's cover WITHOUT ever exposing youtube_id to the client:
//   1. custom cover uploaded by admin (lessons.cover_url → S3)
//   2. else the YouTube thumbnail, fetched server-side and cached in S3
//      (cache key embeds a hash of youtube_id → changing the video busts it)
//   3. else 404 — the FE renders a placeholder.
router.get('/lessons/:lessonId/thumb', async (req: Request, res: Response) => {
  try {
    const lessonId = Number(req.params.lessonId);
    if (!Number.isInteger(lessonId) || lessonId <= 0) return res.status(404).end();
    const lesson = (
      await pool.query(`SELECT id, youtube_id, cover_url FROM lessons WHERE id = $1`, [lessonId])
    ).rows[0];
    if (!lesson) return res.status(404).end();

    const serve = (body: any, contentType: string) => {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      body.pipe(res);
    };

    // 1) custom cover
    if (lesson.cover_url && typeof lesson.cover_url === 'string') {
      const key = lesson.cover_url.replace('/api/courses/thumbnails/', '');
      try {
        const obj = await getFile(key);
        return serve(obj.Body, obj.ContentType || 'image/webp');
      } catch {
        /* stale pointer — fall through to YouTube */
      }
    }

    // 2) YouTube thumbnail via server-side fetch + S3 cache
    if (lesson.youtube_id) {
      const hash = crypto.createHash('md5').update(String(lesson.youtube_id)).digest('hex').slice(0, 8);
      const cacheKey = `lesson-thumb-cache/${lesson.id}-${hash}.jpg`;
      try {
        const cached = await getFile(cacheKey);
        return serve(cached.Body, 'image/jpeg');
      } catch {
        /* not cached yet */
      }
      const yt = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(lesson.youtube_id)}/mqdefault.jpg`, {
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
      if (yt?.ok) {
        const buf = Buffer.from(await yt.arrayBuffer());
        // Cache best-effort; still serve even if the S3 write fails.
        uploadFile(buf, cacheKey, 'image/jpeg', { contentDisposition: 'inline' }).catch(() => {});
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.end(buf);
      }
    }

    res.status(404).end();
  } catch (error) {
    res.status(404).end();
  }
});

// ============ Public: course cover = ภาพของ "วิดีโอล่าสุด" ในคอร์ส ============
// กติกา (ตามที่ตกลง): ปกคอร์สไม่ใช่ไฟล์ที่อัปแช่ไว้ แต่มาจากบทเรียนล่าสุดเสมอ
// และเปลี่ยนตามทันทีเมื่อเพิ่ม/แก้วิดีโอ (FE ต่อ ?r=<cover_rev> ให้ URL เปลี่ยนเอง)
//   1. บทล่าสุดที่มีภาพได้ → ปกที่แอดมินอัปให้บทนั้น (lessons.cover_url)
//   2. ไม่มี → ดึงจาก YouTube (maxresdefault 1280x720 → hqdefault) แคชลง S3 + ทำ variant
//   3. คอร์สยังไม่มีวิดีโอเลย → ใช้ courses.thumbnail_url ที่อัปไว้เป็น "ปกสำรอง"
//   4. ไม่มีอะไรเลย → 404 ให้ FE วาดไอคอนแทน
// ไม่เผย youtube_id ให้ client เหมือน /lessons/:id/thumb
router.get('/:courseId/cover', async (req: Request, res: Response) => {
  try {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId) || courseId <= 0) return res.status(404).end();
    const variant: ThumbVariant | null =
      req.query.v === 'card' || req.query.v === 'hero' ? (req.query.v as ThumbVariant) : null;

    const lesson = (
      await pool.query(
        `SELECT id, youtube_id, cover_url FROM lessons
          WHERE course_id = $1 AND is_active = true
            AND (cover_url IS NOT NULL OR (youtube_id IS NOT NULL AND youtube_id <> ''))
          ORDER BY created_at DESC NULLS LAST, lesson_order DESC, id DESC
          LIMIT 1`,
        [courseId]
      )
    ).rows[0];

    // ปกเปลี่ยนได้เมื่อมีวิดีโอใหม่ → immutable ไม่ได้ ใช้ ETag + อายุสั้นแทน
    const sendImage = (body: Buffer | NodeJS.ReadableStream, contentType: string, etag: string) => {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('ETag', `"${etag}"`);
      if (Buffer.isBuffer(body)) return res.end(body);
      (body as any).pipe(res);
    };

    // 1) ปกที่แอดมินอัปให้บทล่าสุด (ย่อเป็น webp ตั้งแต่ตอนอัปแล้ว)
    if (lesson?.cover_url && typeof lesson.cover_url === 'string') {
      const key = lesson.cover_url.replace('/api/courses/thumbnails/', '');
      try {
        const obj = await getFile(key);
        return sendImage(obj.Body as any, obj.ContentType || 'image/webp', `c${courseId}-l${lesson.id}-cover`);
      } catch {
        /* ตัวชี้ค้าง — ตกไปใช้ YouTube */
      }
    }

    // 2) ภาพจาก YouTube ของบทล่าสุด (แคชต้นฉบับ + variant ไว้ที่ S3 ครั้งเดียว)
    if (lesson?.youtube_id) {
      const hash = crypto.createHash('md5').update(String(lesson.youtube_id)).digest('hex').slice(0, 8);
      const baseKey = `course-cover-cache/${courseId}-${lesson.id}-${hash}.jpg`;
      const etag = `c${courseId}-l${lesson.id}-${hash}-${variant || 'orig'}`;
      const wantKey = variant ? variantKey(baseKey, variant) : baseKey;
      try {
        const cached = await getFile(wantKey);
        return sendImage(cached.Body as any, variant ? 'image/webp' : 'image/jpeg', etag);
      } catch {
        /* ยังไม่แคช */
      }
      // maxresdefault คมพอสำหรับ hero (1280x720); คลิปเก่าบางตัวไม่มี → hqdefault
      let buf: Buffer | null = null;
      for (const name of ['maxresdefault', 'hqdefault']) {
        const yt = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(lesson.youtube_id)}/${name}.jpg`, {
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);
        if (yt?.ok) {
          const b = Buffer.from(await yt.arrayBuffer());
          // YouTube คืนภาพ placeholder เทาขนาดเล็กเมื่อไม่มีความละเอียดนั้น
          if (b.length > 3000) { buf = b; break; }
        }
      }
      if (buf) {
        uploadFile(buf, baseKey, 'image/jpeg', { contentDisposition: 'inline' }).catch(() => {});
        if (variant) {
          const resized = await makeThumbnailVariant(buf, variant);
          if (resized) {
            uploadFile(resized, wantKey, 'image/webp', { contentDisposition: 'inline' }).catch(() => {});
            return sendImage(resized, 'image/webp', etag);
          }
        }
        return sendImage(buf, 'image/jpeg', etag);
      }
    }

    // 3) ปกสำรองที่แอดมินอัปให้คอร์ส (คอร์สที่ยังไม่มีวิดีโอ)
    const course = (await pool.query(`SELECT thumbnail_url FROM courses WHERE id = $1`, [courseId])).rows[0];
    if (course?.thumbnail_url && typeof course.thumbnail_url === 'string') {
      if (/^https?:\/\//i.test(course.thumbnail_url)) return res.redirect(302, course.thumbnail_url);
      const key = course.thumbnail_url.replace('/api/courses/thumbnails/', '');
      try {
        const obj = await getFile(variant ? variantKey(key, variant) : key);
        return sendImage(obj.Body as any, variant ? 'image/webp' : obj.ContentType || 'image/jpeg', `c${courseId}-fallback`);
      } catch {
        try {
          const obj = await getFile(key);
          return sendImage(obj.Body as any, obj.ContentType || 'image/jpeg', `c${courseId}-fallback-orig`);
        } catch {
          /* ไม่มีไฟล์จริง */
        }
      }
    }

    res.status(404).end();
  } catch (error) {
    res.status(404).end();
  }
});

// ============ Admin: upload custom lesson cover ============
router.post(
  '/lessons/:lessonId/cover',
  authenticate,
  uploadSingle(thumbUpload, 'cover'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const lessonId = Number(req.params.lessonId);
      if (!Number.isInteger(lessonId) || lessonId <= 0) return res.status(400).json({ error: 'Bad lesson id' });
      const lesson = (await pool.query(`SELECT id FROM lessons WHERE id = $1`, [lessonId])).rows[0];
      if (!lesson) return res.status(404).json({ error: 'ไม่พบบทเรียน' });
      if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์รูป' });

      // Resize to card size (covers render at ~176px wide — 640px webp is plenty).
      const resized = await makeThumbnailVariant(req.file.buffer, 'card');
      const rand = Math.random().toString(36).slice(2, 10);
      const key = resized
        ? `lesson-cover/${lessonId}-${rand}.webp`
        : `lesson-cover/${lessonId}-${rand}.${(req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'}`;
      await uploadFile(resized ?? req.file.buffer, key, resized ? 'image/webp' : req.file.mimetype, {
        contentDisposition: 'inline',
      });
      const url = `/api/courses/thumbnails/${key}`;
      await pool.query(`UPDATE lessons SET cover_url = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
        lessonId,
        url,
      ]);
      res.json({ ok: true, cover_url: url });
    } catch (error) {
      console.error('Error uploading lesson cover:', error);
      res.status(500).json({ error: 'อัปโหลดปกไม่สำเร็จ' });
    }
  }
);

// ============ Admin: remove custom cover (revert to YouTube auto) ============
router.delete('/lessons/:lessonId/cover', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const lessonId = Number(req.params.lessonId);
    if (!Number.isInteger(lessonId) || lessonId <= 0) return res.status(400).json({ error: 'Bad lesson id' });
    await pool.query(`UPDATE lessons SET cover_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [lessonId]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error removing lesson cover:', error);
    res.status(500).json({ error: 'ลบปกไม่สำเร็จ' });
  }
});

// ============ Admin: upload course thumbnail ============
router.post('/upload-thumbnail', authenticate, thumbUpload.single('thumbnail'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const rand = Math.random().toString(36).slice(2, 10);
    const key = `course-thumb/${Date.now()}-${rand}.${ext}`;
    await uploadFile(req.file.buffer, key, req.file.mimetype, { contentDisposition: 'inline' });
    // Pre-generate small webp variants (2MB PNG → ~40-150KB). Failures are
    // non-fatal: the proxy falls back to the original.
    for (const v of ['card', 'hero'] as const) {
      try {
        const out = await makeThumbnailVariant(req.file.buffer, v);
        if (out) await uploadFile(out, variantKey(key, v), 'image/webp', { contentDisposition: 'inline' });
      } catch (e) {
        console.error(`[thumb] ${v} variant failed:`, e);
      }
    }
    res.json({ url: `/api/courses/thumbnails/${key}` });
  } catch (error) {
    console.error('Error uploading thumbnail:', error);
    res.status(500).json({ error: 'Failed to upload thumbnail' });
  }
});

// ============ Public material proxy (unguessable key; forces download by default) ============
// Access control lives in the lesson payload: paid-lesson material URLs are never
// sent to non-purchasers, so this proxy stays public like /thumbnails.
// ?view=1 opts into Content-Disposition: inline so PDFs render in the browser
// (e.g. the Ebook "read online" viewer) instead of downloading — default
// behavior is unchanged so existing lesson-material download links still work.
router.get('/materials/*', async (req: Request, res: Response) => {
  try {
    const key = (req.params as any)[0];
    const rawName = typeof req.query.name === 'string' ? req.query.name : '';
    const safeName = rawName.replace(/[\r\n"\\]/g, '').slice(0, 200);
    const obj = await getFile(key);
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    // ?view=1 (ebook อ่านในเบราว์เซอร์) อนุญาตเฉพาะไฟล์ที่ไม่ใช่ HTML — HTML ต้อง
    // ดาวน์โหลดเสมอ ไม่งั้นถูกสั่ง render บน origin ของ API (ข้าม sanitize ฝั่งเว็บ)
    const isHtml = (obj.ContentType || '').toLowerCase().includes('text/html') || key.toLowerCase().endsWith('.html');
    const inline = req.query.view === '1' && !isHtml;
    const dispositionType = inline ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      safeName ? `${dispositionType}; filename*=UTF-8''${encodeURIComponent(safeName)}` : dispositionType
    );
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    (obj.Body as any).pipe(res);
  } catch (error) {
    res.status(404).json({ error: 'Not found' });
  }
});

// Multer decodes multipart filenames as latin1, mangling Thai names — undo it.
// ASCII names pass through unchanged; if the round-trip produces replacement
// chars the original was already UTF-8, so keep it.
function decodeUploadName(name: string): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

// ============ Admin: upload lesson document (PDF) ============
router.post('/upload-material', authenticate, uploadSingle(materialUpload, 'file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const rand = Math.random().toString(36).slice(2, 10);
    const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const key = `course-materials/${Date.now()}-${rand}.${ext}`;
    await uploadFile(req.file.buffer, key, req.file.mimetype, { contentDisposition: 'attachment' });
    res.json({ url: `/api/courses/materials/${key}`, name: decodeUploadName(req.file.originalname) });
  } catch (error) {
    console.error('Error uploading material:', error);
    res.status(500).json({ error: 'Failed to upload material' });
  }
});

// ============ Admin: upload HTML doc → store on S3, return a pointer ============
// Only { url } goes into lessons.materials (keeps the DB small); the client
// fetches the text through /materials/* and sanitizes it (DOMPurify) before
// rendering. Disposition stays "attachment" so opening the URL directly
// downloads instead of rendering unsanitized HTML.
router.post('/upload-html', authenticate, uploadSingle(htmlUpload, 'file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const rand = Math.random().toString(36).slice(2, 10);
    const key = `course-materials/html/${Date.now()}-${rand}.html`;
    await uploadFile(req.file.buffer, key, 'text/html; charset=utf-8', { contentDisposition: 'attachment' });
    res.json({ url: `/api/courses/materials/${key}`, name: decodeUploadName(req.file.originalname) });
  } catch (error) {
    console.error('Error uploading HTML:', error);
    res.status(500).json({ error: 'Failed to upload HTML' });
  }
});

// ============ Tags (ชื่อย่อขึ้นเมนู header — คลังกลางใช้ร่วม Course/Tip) ============
// NOTE: named routes must be registered before /:slug.
/** ถัง tag มีสองใบ: ของคอร์ส กับ ของทิป — คนละเรื่องกัน ห้ามใช้ข้ามถัง */
type TagKind = 'course' | 'tip';
const asTagKind = (v: unknown): TagKind | null =>
  v === 'course' || v === 'tip' ? v : null;

/** tag ที่ส่งมาต้องมีอยู่จริงและอยู่ถังที่ถูก (null = ไม่ได้เลือก ก็ผ่าน) */
async function tagIdOfKind(id: unknown, kind: TagKind): Promise<number | null | false> {
  if (id === null || id === undefined || id === '') return null;
  if (!Number.isInteger(id)) return false;
  const r = await pool.query(`SELECT 1 FROM tags WHERE id = $1 AND kind = $2`, [id, kind]);
  return r.rows.length ? (id as number) : false;
}

router.get('/tags', async (req, res) => {
  try {
    const kind = asTagKind(req.query.kind);
    // นับการใช้งานให้ตรงถัง: tag ของคอร์สผูกผ่าน tag_id, ของทิปผูกผ่าน tip_tag_id
    const result = await pool.query(
      `SELECT t.*,
         CASE WHEN t.kind = 'tip'
           THEN (SELECT COUNT(*) FROM courses c WHERE c.tip_tag_id = t.id)
           ELSE (SELECT COUNT(*) FROM courses c WHERE c.tag_id = t.id)
         END::int AS usage_count
       FROM tags t
       WHERE $1::text IS NULL OR t.kind = $1
       ORDER BY t.kind ASC, t.display_order ASC, t.name ASC`,
      [kind]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'โหลด tag ไม่สำเร็จ' });
  }
});

router.post('/tags', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 40) : '';
    if (!name) return res.status(400).json({ error: 'กรุณาใส่ชื่อ tag' });
    const kind = req.body.kind === undefined ? 'course' : asTagKind(req.body.kind);
    if (!kind) return res.status(400).json({ error: 'kind ต้องเป็น course หรือ tip' });
    const result = await pool.query(
      `INSERT INTO tags (name, kind) VALUES ($1, $2) RETURNING *`, [name, kind]
    );
    res.json(result.rows[0]);
  } catch (error) {
    if ((error as any).code === '23505') {
      const where = req.body.kind === 'tip' ? 'ถัง Tag Tip' : 'ถัง Tag Course';
      return res.status(400).json({ error: `มี tag ชื่อนี้อยู่แล้วใน${where}` });
    }
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'สร้าง tag ไม่สำเร็จ' });
  }
});

router.delete('/tags/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad tag id' });
    // FK ON DELETE SET NULL — คอร์ส/ทิปที่ใช้อยู่จะกลายเป็นไม่มี tag เอง
    const result = await pool.query(`DELETE FROM tags WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบ tag' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting tag:', error);
    res.status(500).json({ error: 'ลบ tag ไม่สำเร็จ' });
  }
});

// ============ หมวดหมู่กลาง (2 ภาษา) — ใช้ตั้งชื่อหมวดในคอร์ส ============
// ต้องประกาศก่อน router.get('/:slug') ท้ายไฟล์ ไม่งั้น '/categories' โดนมองเป็น slug คอร์ส

/** ตัดช่องว่าง + จำกัดความยาว; คืน '' ถ้าไม่ใช่ข้อความที่ใช้ได้ */
const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');

router.get('/categories', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM course_sections s WHERE s.category_id = c.id) AS usage_count
       FROM categories c ORDER BY c.display_order ASC, c.name_en ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'โหลดหมวดหมู่ไม่สำเร็จ' });
  }
});

router.post('/categories', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const nameEn = cleanName(req.body.name_en);
    const nameTh = cleanName(req.body.name_th);
    if (!nameEn || !nameTh) return res.status(400).json({ error: 'ต้องใส่ชื่อทั้งภาษาอังกฤษและภาษาไทย' });
    // ต่อท้ายรายการเสมอ ให้ลำดับที่แอดมินเห็นตรงกับลำดับที่เพิ่ม
    const result = await pool.query(
      `INSERT INTO categories (name_en, name_th, display_order)
       VALUES ($1, $2, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM categories)) RETURNING *`,
      [nameEn, nameTh]
    );
    res.json(result.rows[0]);
  } catch (error) {
    if ((error as any).code === '23505') return res.status(400).json({ error: 'มีหมวดหมู่ชื่อนี้อยู่แล้ว' });
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'สร้างหมวดหมู่ไม่สำเร็จ' });
  }
});

router.put('/categories/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad category id' });
    const nameEn = req.body.name_en === undefined ? null : cleanName(req.body.name_en);
    const nameTh = req.body.name_th === undefined ? null : cleanName(req.body.name_th);
    // ส่งมาแล้วต้องไม่ว่าง (ไม่ส่งมาเลย = ไม่แก้ช่องนั้น)
    if (nameEn === '' || nameTh === '') return res.status(400).json({ error: 'ชื่อหมวดหมู่ว่างไม่ได้' });
    const order = Number.isInteger(req.body.display_order) ? req.body.display_order : null;
    const result = await pool.query(
      `UPDATE categories SET
         name_en = COALESCE($1, name_en),
         name_th = COALESCE($2, name_th),
         display_order = COALESCE($3, display_order)
       WHERE id = $4 RETURNING *`,
      [nameEn, nameTh, order, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบหมวดหมู่' });
    res.json(result.rows[0]);
  } catch (error) {
    if ((error as any).code === '23505') return res.status(400).json({ error: 'มีหมวดหมู่ชื่อนี้อยู่แล้ว' });
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'แก้ไขหมวดหมู่ไม่สำเร็จ' });
  }
});

router.delete('/categories/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad category id' });
    // FK ON DELETE SET NULL — หมวดที่ใช้อยู่จะกลับไปแสดงชื่อที่พิมพ์เองแทน ไม่พัง
    const result = await pool.query(`DELETE FROM categories WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบหมวดหมู่' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'ลบหมวดหมู่ไม่สำเร็จ' });
  }
});

/** category_id ที่ส่งมาต้องมีอยู่จริง (null = ไม่ได้เลือก ก็ผ่าน) */
async function validCategoryId(id: unknown): Promise<number | null | false> {
  if (id === null || id === undefined || id === '') return null;
  if (!Number.isInteger(id)) return false;
  const r = await pool.query(`SELECT 1 FROM categories WHERE id = $1`, [id]);
  return r.rows.length ? (id as number) : false;
}

/**
 * course_sections.title เป็น NOT NULL มาแต่เดิม และเราไม่ปลด เพราะมันกลายเป็น
 * "สำเนาสำรองของชื่อ" ที่มีประโยชน์: ถ้าวันหนึ่งหมวดหมู่ถูกลบ (FK SET NULL)
 * หมวดในคอร์สจะยังมีชื่อแสดงอยู่ ไม่กลายเป็นหมวดไร้ชื่อ
 * เลือกหมวดหมู่แล้วไม่พิมพ์ชื่อเอง → ก๊อปชื่อไทยของหมวดหมู่มาเก็บไว้
 * (ตอนแสดงผลหมวดหมู่ชนะอยู่แล้ว สำเนานี้จึงไม่บังการสลับภาษา)
 */
/**
 * กล่องหมวด "พื้นฐาน" ของคอร์สนี้ — ไม่มีก็สร้างให้ (คืน null ถ้าไม่มีหมวดหมู่ Basics ในระบบ)
 * ใช้เป็นที่ลงของบทเรียนที่ไม่ได้ระบุหมวด เพราะ UI ไม่มีตัวเลือก "ไม่จัดหมวด" แล้ว
 */
async function basicsSectionId(courseId: number): Promise<number | null> {
  const cat = await pool.query(`SELECT id, name_th FROM categories WHERE name_en = 'Basics'`);
  if (cat.rows.length === 0) return null;
  const { id: catId, name_th } = cat.rows[0];
  const existing = await pool.query(
    `SELECT id FROM course_sections WHERE course_id = $1 AND category_id = $2 AND is_active = true ORDER BY id LIMIT 1`,
    [courseId, catId]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const created = await pool.query(
    `INSERT INTO course_sections (course_id, title, section_order, mode, category_id)
     VALUES ($1, $2, (SELECT COALESCE(MAX(section_order), -1) + 1 FROM course_sections WHERE course_id = $1), 'basic', $3)
     RETURNING id`,
    [courseId, name_th, catId]
  );
  return created.rows[0].id;
}

async function sectionTitleFallback(title: unknown, categoryId: number | null): Promise<string | null> {
  const typed = typeof title === 'string' && title.trim() ? title.trim() : null;
  if (typed) return typed;
  if (categoryId === null) return null;
  const r = await pool.query(`SELECT name_th FROM categories WHERE id = $1`, [categoryId]);
  return r.rows[0]?.name_th ?? null;
}

// ============ Admin: list all courses (incl. inactive) ============
router.get('/admin/all', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const result = await pool.query(`
      SELECT c.*, t.name AS tag, tt.name AS tip_tag,
        GREATEST(MAX(l.created_at) FILTER (WHERE l.is_active = true), MAX(l.updated_at) FILTER (WHERE l.is_active = true)) AS cover_rev,
        COUNT(DISTINCT l.id) as lesson_count,
        COUNT(DISTINCT e.id) as enrollment_count
      FROM courses c
      LEFT JOIN tags t ON t.id = c.tag_id
      LEFT JOIN tags tt ON tt.id = c.tip_tag_id
      LEFT JOIN lessons l ON c.id = l.course_id
      LEFT JOIN course_enrollments e ON c.id = e.course_id
      GROUP BY c.id, t.name, tt.name
      ORDER BY c.display_order ASC, c.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// ============ Public: list active courses ============
router.get('/', async (req, res) => {
  try {
    const { featured, difficulty, search, sort, type } = req.query;
    let query = `
      SELECT c.*, t.name AS tag, tt.name AS tip_tag,
        MAX(l.created_at) FILTER (WHERE l.is_active = true) as last_lesson_at,
        -- cover_rev: ปกคอร์สมาจากวิดีโอล่าสุด → ค่านี้เปลี่ยนเมื่อเพิ่ม/แก้บทเรียน
        -- FE เอาไปต่อท้าย URL ปกเพื่อให้เบราว์เซอร์โหลดภาพใหม่ทันที
        GREATEST(
          MAX(l.created_at) FILTER (WHERE l.is_active = true),
          MAX(l.updated_at) FILTER (WHERE l.is_active = true)
        ) as cover_rev,
        (SELECT l2.id FROM lessons l2 WHERE l2.course_id = c.id AND l2.is_active = true ORDER BY l2.created_at DESC NULLS LAST, l2.lesson_order DESC, l2.id DESC LIMIT 1) AS latest_lesson_id,
        COUNT(DISTINCT l.id) FILTER (WHERE l.is_active = true) as lesson_count,
        COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'approved') as enrollment_count,
        COALESCE(AVG(r.rating), 0)::numeric(3,2) as avg_rating,
        COUNT(DISTINCT r.id) as review_count
      FROM courses c
      LEFT JOIN tags t ON t.id = c.tag_id
      LEFT JOIN tags tt ON tt.id = c.tip_tag_id
      LEFT JOIN lessons l ON c.id = l.course_id
      LEFT JOIN course_enrollments e ON c.id = e.course_id
      LEFT JOIN course_reviews r ON c.id = r.course_id
      WHERE c.is_active = true
    `;
    const params: any[] = [];
    let paramIndex = 1;
    if (featured === 'true') query += ` AND c.is_featured = true`;
    if (type === 'course' || type === 'tip') { query += ` AND c.content_type = $${paramIndex}`; params.push(type); paramIndex++; }
    if (difficulty) { query += ` AND c.difficulty = $${paramIndex}`; params.push(difficulty); paramIndex++; }
    if (search) { query += ` AND (c.name ILIKE $${paramIndex} OR c.description ILIKE $${paramIndex})`; params.push(`%${search}%`); paramIndex++; }
    query += ` GROUP BY c.id, t.name, tt.name`;
    const order = sort === 'popular' ? `enrollment_count DESC, c.created_at DESC`
      : sort === 'new' ? `c.created_at DESC`
      : sort === 'price_asc' ? `COALESCE(c.discount_price, c.price) ASC`
      : sort === 'price_desc' ? `COALESCE(c.discount_price, c.price) DESC`
      : `c.display_order ASC, c.created_at DESC`;
    query += ` ORDER BY ${order}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

/** เครื่องมือที่ใช้ในคอร์ส: กรองเป็น [{name, price}] เท่านั้น — ตัดแถวไม่มีชื่อ + จำกัดความยาว */
function sanitizeCourseTools(input: unknown): { name: string; price: string }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((t: any) => ({
      name: typeof t?.name === 'string' ? t.name.trim().slice(0, 80) : '',
      price: typeof t?.price === 'string' ? t.price.trim().slice(0, 60) : '',
    }))
    .filter((t) => t.name);
}

/**
 * รหัสลิงก์สั้นประจำคอร์ส (https://www.triple-school.com/courses/{code})
 * ชุดอักขระเดียวกับ migration 048: ตัด 0/o/1/l/i ที่อ่านสับสน และตัวแรกเป็นตัวอักษร
 * เสมอ เพื่อไม่ให้รหัสตัวเลขล้วนไปชนกับ route ที่รับ course id
 */
function generateShareCode(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** สุ่มรหัสที่ยังไม่ถูกใช้ (กันชนทั้ง share_code และ slug) */
async function uniqueShareCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateShareCode();
    const taken = await pool.query(`SELECT 1 FROM courses WHERE share_code = $1 OR slug = $1 LIMIT 1`, [code]);
    if (taken.rows.length === 0) return code;
  }
  // โอกาสชน 10 ครั้งติดแทบเป็นศูนย์ (660M ความเป็นไปได้) — เผื่อไว้ด้วยรหัสยาวขึ้น
  return generateShareCode() + Math.floor(Math.random() * 90 + 10);
}

// ============ Admin: create course ============
router.post('/', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const {
      name, slug, description, short_description, thumbnail_url,
      instructor_name, instructor_avatar, difficulty, duration_hours,
      is_featured, display_order, price, discount_price, learning_outcomes, requirements,
      content_type, tag_id, tip_tag_id, tools, is_free,
    } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required' });
    const isTip = content_type === 'tip';
    // tag ต้องมาจากถังที่ถูก · คอร์สไม่มี Tag Tip (มีแต่ทิป) จึงบังคับเป็น null
    const tagId = await tagIdOfKind(tag_id, 'course');
    if (tagId === false) return res.status(400).json({ error: 'Tag Course ไม่ถูกต้อง' });
    const tipTagId = isTip ? await tagIdOfKind(tip_tag_id, 'tip') : null;
    if (tipTagId === false) return res.status(400).json({ error: 'Tag Tip ไม่ถูกต้อง' });
    const result = await pool.query(`
      INSERT INTO courses (
        name, slug, description, short_description, thumbnail_url,
        instructor_name, instructor_avatar, difficulty, duration_hours,
        is_featured, display_order, price, discount_price, learning_outcomes, requirements,
        content_type, tag_id, tip_tag_id, tools, is_free, share_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `, [
      name, slug, description || null, short_description || null, thumbnail_url || null,
      instructor_name || null, instructor_avatar || null, difficulty || 'beginner', duration_hours || 0,
      is_featured || false, display_order || 0, price || 0, discount_price || null,
      JSON.stringify(Array.isArray(learning_outcomes) ? learning_outcomes : []),
      JSON.stringify(Array.isArray(requirements) ? requirements : []),
      isTip ? 'tip' : 'course',
      tagId,
      tipTagId,
      JSON.stringify(sanitizeCourseTools(tools)),
      is_free === true,
      await uniqueShareCode(),
    ]);
    const created = result.rows[0];
    // การปักคือ "ปรับชั่วคราว" — คอร์สใหม่ (ที่เข้าเกณฑ์ Billboard อัตโนมัติ: เป็น
    // course และ active) ต้องขึ้น Billboard เสมอ จึงถอดปักเก่าทิ้งให้ตอนสร้าง
    // (สร้าง Tip หรือฉบับร่างไม่แตะปัก เพราะไม่เข้าเกณฑ์อัตโนมัติอยู่แล้ว)
    if (created.content_type === 'course' && created.is_active) {
      await pool.query(`UPDATE courses SET is_billboard = false WHERE is_billboard = true`);
      created.is_billboard = false;
    }
    res.json(created);
  } catch (error) {
    console.error('Error creating course:', error);
    if ((error as any).code === '23505') return res.status(400).json({ error: 'Course slug already exists' });
    res.status(500).json({ error: 'Failed to create course' });
  }
});

// ============ Admin: update course ============
router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const {
      name, slug, description, short_description, thumbnail_url,
      instructor_name, instructor_avatar, difficulty, duration_hours,
      is_featured, is_active, display_order, price, discount_price, learning_outcomes, requirements,
      content_type, tag_id, tip_tag_id, tools, is_free,
    } = req.body;
    // tag_id/tip_tag_id/tools/is_free ตั้งเฉพาะเมื่อส่งมา และรองรับส่ง null/'' = ล้างค่า (COALESCE ทำไม่ได้)
    const extraSets: string[] = [];
    const extraParams: any[] = [];
    if (tag_id !== undefined) {
      const tagId = await tagIdOfKind(tag_id, 'course');
      if (tagId === false) return res.status(400).json({ error: 'Tag Course ไม่ถูกต้อง' });
      extraParams.push(tagId);
      extraSets.push(`tag_id = $${18 + extraParams.length}`);
    }
    // ชนิดหลังอัปเดต — ไม่ได้ส่งมาก็ต้องไปดูของเดิม เพราะกฎ "คอร์สห้ามมี Tag Tip"
    // ต้องบังคับได้แม้แอดมินแค่สลับประเภทเฉยๆ โดยไม่ได้แตะช่อง tag
    if (content_type !== undefined || tip_tag_id !== undefined) {
      const cur = await pool.query(`SELECT content_type FROM courses WHERE id = $1`, [id]);
      if (cur.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
      const nextType = content_type === 'tip' || content_type === 'course'
        ? content_type : cur.rows[0].content_type;
      if (nextType !== 'tip') {
        extraParams.push(null);
        extraSets.push(`tip_tag_id = $${18 + extraParams.length}`);
      } else if (tip_tag_id !== undefined) {
        const tipTagId = await tagIdOfKind(tip_tag_id, 'tip');
        if (tipTagId === false) return res.status(400).json({ error: 'Tag Tip ไม่ถูกต้อง' });
        extraParams.push(tipTagId);
        extraSets.push(`tip_tag_id = $${18 + extraParams.length}`);
      }
    }
    if (tools !== undefined) {
      extraParams.push(JSON.stringify(sanitizeCourseTools(tools)));
      extraSets.push(`tools = $${18 + extraParams.length}::jsonb`);
    }
    if (is_free !== undefined) {
      extraParams.push(is_free === true);
      extraSets.push(`is_free = $${18 + extraParams.length}`);
    }
    const tagSet = extraSets.length ? `, ${extraSets.join(', ')}` : '';
    const result = await pool.query(`
      UPDATE courses SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        description = COALESCE($3, description),
        short_description = COALESCE($4, short_description),
        thumbnail_url = COALESCE($5, thumbnail_url),
        instructor_name = COALESCE($6, instructor_name),
        instructor_avatar = COALESCE($7, instructor_avatar),
        difficulty = COALESCE($8, difficulty),
        duration_hours = COALESCE($9, duration_hours),
        is_featured = COALESCE($10, is_featured),
        is_active = COALESCE($11, is_active),
        display_order = COALESCE($12, display_order),
        price = COALESCE($13, price),
        discount_price = $14,
        learning_outcomes = COALESCE($15, learning_outcomes),
        requirements = COALESCE($16, requirements),
        content_type = COALESCE($17, content_type),
        updated_at = CURRENT_TIMESTAMP${tagSet}
      WHERE id = $18
      RETURNING *
    `, [
      name, slug, description, short_description, thumbnail_url,
      instructor_name, instructor_avatar, difficulty, duration_hours,
      is_featured, is_active, display_order, price, discount_price,
      learning_outcomes !== undefined ? JSON.stringify(learning_outcomes) : null,
      requirements !== undefined ? JSON.stringify(requirements) : null,
      content_type === 'tip' || content_type === 'course' ? content_type : null,
      id,
      ...extraParams,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating course:', error);
    if ((error as any).code === '23505') return res.status(400).json({ error: 'Course slug already exists' });
    res.status(500).json({ error: 'Failed to update course' });
  }
});

// ============ Admin: pin / unpin the home-page billboard ============
// Only one course may be pinned, so pinning clears the previous one in the same
// transaction. Unpinned (no row pinned at all) = the storefront falls back to
// its automatic rule: newest course, tips excluded.
router.put('/:id/billboard', authenticate, async (req: AuthRequest, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  const { id } = req.params;
  const pinned = req.body?.pinned !== false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE courses SET is_billboard = false WHERE is_billboard = true`);
    let course = null;
    if (pinned) {
      const result = await client.query(
        `UPDATE courses SET is_billboard = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
        [id]
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Course not found' });
      }
      course = result.rows[0];
    }
    await client.query('COMMIT');
    res.json({ pinned, course });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error setting billboard:', error);
    res.status(500).json({ error: 'Failed to set billboard' });
  } finally {
    client.release();
  }
});

// ============ Admin: delete course (cascades) ============
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM courses WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// =====================  SECTION ENDPOINTS  =====================

router.get('/:courseId/sections', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const { courseId } = req.params;
    // Reveal paid-lesson youtube_id only to admins / enrolled owners. Anonymous
    // or non-owner callers get it masked (preview lessons stay visible).
    // คอร์สฟรี (flag is_free) = เปิดหมด
    const hasAccess = !!req.isAdmin ||
      (await isCourseFreeById(Number(courseId))) ||
      (await hasSubscriptionOrEnrollment(req.userId, Number(courseId)));
    const sectionsResult = await pool.query(`
      SELECT s.*, cat.name_en AS category_en, cat.name_th AS category_th
      FROM course_sections s LEFT JOIN categories cat ON cat.id = s.category_id
      WHERE s.course_id = $1 AND s.is_active = true ORDER BY s.section_order ASC
    `, [courseId]);
    const sections = await Promise.all(sectionsResult.rows.map(async (section) => {
      const lessonsResult = await pool.query(`
        SELECT id, title, description, youtube_id, duration_minutes, lesson_order, is_preview, section_id
        FROM lessons WHERE section_id = $1 AND is_active = true ORDER BY lesson_order ASC
      `, [section.id]);
      const lessons = lessonsResult.rows.map((l) =>
        hasAccess || l.is_preview ? l : { ...l, youtube_id: null }
      );
      return { ...section, lessons };
    }));
    res.json(sections);
  } catch (error) {
    console.error('Error fetching sections:', error);
    res.status(500).json({ error: 'Failed to fetch sections' });
  }
});

router.post('/:courseId/sections', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { courseId } = req.params;
    const { title, description, section_order, mode, category_id } = req.body;
    const categoryId = await validCategoryId(category_id);
    if (categoryId === false) return res.status(400).json({ error: 'หมวดหมู่ไม่ถูกต้อง' });
    // ชื่อมาจากหมวดหมู่กลางก็ได้ พิมพ์เองก็ได้ แต่ต้องมีอย่างน้อยหนึ่งอย่าง
    // ไม่งั้นหมวดจะไม่มีชื่ออะไรให้แสดงเลย
    if (!title && categoryId === null) {
      return res.status(400).json({ error: 'ต้องเลือกหมวดหมู่ หรือใส่ชื่อที่แสดงเอง' });
    }
    const sectionMode = mode === 'update' ? 'update' : 'basic';
    let order = section_order;
    if (order === undefined || order === null) {
      const maxOrderResult = await pool.query(`
        SELECT COALESCE(MAX(section_order), 0) + 1 as next_order FROM course_sections WHERE course_id = $1
      `, [courseId]);
      order = maxOrderResult.rows[0].next_order;
    }
    const result = await pool.query(`
      INSERT INTO course_sections (course_id, title, description, section_order, mode, category_id)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [courseId, await sectionTitleFallback(title, categoryId), description || null, order, sectionMode, categoryId]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating section:', error);
    res.status(500).json({ error: 'Failed to create section' });
  }
});

router.put('/:courseId/sections/reorder', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { courseId } = req.params;
    const { sectionIds } = req.body;
    if (!Array.isArray(sectionIds)) return res.status(400).json({ error: 'sectionIds must be an array' });
    for (let i = 0; i < sectionIds.length; i++) {
      await pool.query(`
        UPDATE course_sections SET section_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND course_id = $3
      `, [i + 1, sectionIds[i], courseId]);
    }
    res.json({ message: 'Sections reordered successfully' });
  } catch (error) {
    console.error('Error reordering sections:', error);
    res.status(500).json({ error: 'Failed to reorder sections' });
  }
});

router.put('/sections/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const { title, description, section_order, is_active } = req.body;
    const mode = req.body.mode === 'basic' || req.body.mode === 'update' ? req.body.mode : null;

    // title/category_id ต้องจัดการแยกจาก COALESCE เพราะทั้งคู่ "ล้างค่าได้"
    // (ส่ง '' หรือ null = เอาออก) ซึ่ง COALESCE ตีความเป็น "ไม่แก้" ไม่ได้
    const cur = (await pool.query(
      `SELECT title, category_id FROM course_sections WHERE id = $1`, [id]
    )).rows[0];
    if (!cur) return res.status(404).json({ error: 'Section not found' });

    let nextCategory = cur.category_id;
    if (req.body.category_id !== undefined) {
      const v = await validCategoryId(req.body.category_id);
      if (v === false) return res.status(400).json({ error: 'หมวดหมู่ไม่ถูกต้อง' });
      nextCategory = v;
    }
    const nextTitle = title === undefined
      ? cur.title
      : await sectionTitleFallback(title, nextCategory);
    if (!nextTitle && nextCategory === null) {
      return res.status(400).json({ error: 'ต้องเลือกหมวดหมู่ หรือใส่ชื่อที่แสดงเอง' });
    }

    const result = await pool.query(`
      UPDATE course_sections SET
        title = $1,
        description = COALESCE($2, description),
        section_order = COALESCE($3, section_order),
        is_active = COALESCE($4, is_active),
        mode = COALESCE($6, mode),
        category_id = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 RETURNING *
    `, [nextTitle, description, section_order, is_active, id, mode, nextCategory]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Section not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating section:', error);
    res.status(500).json({ error: 'Failed to update section' });
  }
});

router.delete('/sections/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM course_sections WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Section not found' });
    res.json({ message: 'Section deleted successfully' });
  } catch (error) {
    console.error('Error deleting section:', error);
    res.status(500).json({ error: 'Failed to delete section' });
  }
});

router.put('/sections/:sectionId/lessons/assign', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { sectionId } = req.params;
    const { lessonIds } = req.body;
    if (!Array.isArray(lessonIds)) return res.status(400).json({ error: 'lessonIds must be an array' });
    const sectionResult = await pool.query(`SELECT id FROM course_sections WHERE id = $1`, [sectionId]);
    if (sectionResult.rows.length === 0) return res.status(404).json({ error: 'Section not found' });
    for (let i = 0; i < lessonIds.length; i++) {
      await pool.query(`
        UPDATE lessons SET section_id = $1, lesson_order = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3
      `, [sectionId, i + 1, lessonIds[i]]);
    }
    res.json({ message: 'Lessons assigned to section successfully' });
  } catch (error) {
    console.error('Error assigning lessons to section:', error);
    res.status(500).json({ error: 'Failed to assign lessons to section' });
  }
});

router.put('/lessons/:lessonId/unassign', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { lessonId } = req.params;
    const result = await pool.query(`
      UPDATE lessons SET section_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *
    `, [lessonId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Lesson not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error unassigning lesson:', error);
    res.status(500).json({ error: 'Failed to unassign lesson' });
  }
});

// =====================  LESSON ENDPOINTS  =====================

router.get('/:courseId/lessons', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const { courseId } = req.params;
    // Reveal paid-lesson youtube_id/youtube_url only to admins / enrolled owners.
    // คอร์สฟรี (flag is_free) = เปิดหมด
    const hasAccess = !!req.isAdmin ||
      (await isCourseFreeById(Number(courseId))) ||
      (await hasSubscriptionOrEnrollment(req.userId, Number(courseId)));
    const result = await pool.query(`
      SELECT id, course_id, section_id, title, description, youtube_url, youtube_id,
             duration_minutes, lesson_order, is_preview, is_active, created_at, updated_at, cover_url,
             ${materialsMetaSql('materials')} AS materials
      FROM lessons WHERE course_id = $1 AND is_active = true ORDER BY lesson_order ASC
    `, [courseId]);
    // บทที่ล็อกต้องล้าง materials ด้วย (ลิงก์เอกสาร = เนื้อหาขายเช่นกัน) — ให้เหมือน /:slug/full;
    // แถวที่เข้าถึงได้และไม่ใช่ admin เห็นเฉพาะเอกสารที่เปิดใช้ (enabled !== false)
    const lessons = result.rows.map((l) => {
      if (!(hasAccess || l.is_preview)) return { ...l, youtube_id: null, youtube_url: null, materials: [] };
      if (req.isAdmin) return l;
      const mats = Array.isArray(l.materials) ? l.materials.filter((m: any) => m?.enabled !== false) : [];
      return { ...l, materials: mats };
    });
    res.json(lessons);
  } catch (error) {
    console.error('Error fetching lessons:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

// Full materials for ONE lesson (learn page + admin edit dialog fetch this on
// demand — inline html content can be MBs, so it never rides in list payloads).
// Same access gate as the video endpoint: preview OR admin OR sub/enrollment.
router.get('/lessons/:lessonId/materials', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const lessonId = Number(req.params.lessonId);
    if (!Number.isInteger(lessonId) || lessonId <= 0) return res.status(400).json({ error: 'Bad lesson id' });
    const lesson = (
      await pool.query(`SELECT id, course_id, is_preview, materials FROM lessons WHERE id = $1`, [lessonId])
    ).rows[0];
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    const hasAccess =
      lesson.is_preview || !!req.isAdmin ||
      (await isCourseFreeById(lesson.course_id)) ||
      (await hasSubscriptionOrEnrollment(req.userId, lesson.course_id));
    if (!hasAccess) return res.status(403).json({ error: 'ต้องซื้อคอร์สหรือเป็นสมาชิกก่อน' });
    const all = Array.isArray(lesson.materials) ? lesson.materials : [];
    // Students only see enabled rows; admins get everything (edit dialog).
    const materials = req.isAdmin ? all : all.filter((m: any) => m?.enabled !== false);
    res.json({ lesson_id: lesson.id, materials });
  } catch (error) {
    console.error('Error fetching lesson materials:', error);
    res.status(500).json({ error: 'Failed to fetch materials' });
  }
});

router.post('/:courseId/lessons', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { courseId } = req.params;
    const { title, description, youtube_url, duration_minutes, lesson_order, is_preview, section_id, materials } = req.body;
    if (!title || !youtube_url) return res.status(400).json({ error: 'Title and YouTube URL are required' });
    const youtube_id = extractYoutubeId(youtube_url);
    if (!youtube_id) return res.status(400).json({ error: 'ลิงก์ YouTube ไม่ถูกต้อง (รองรับ watch?v=, youtu.be, /embed/, /shorts/, /live/)' });
    const cleanMaterials = sanitizeMaterials(materials);
    const sizeError = validateMaterialsSize(cleanMaterials);
    if (sizeError) return res.status(400).json({ error: sizeError });
    // ทุกบทต้องมีหมวด — ไม่ส่งมาก็ลงหมวดหมู่ "พื้นฐาน" ให้ (สร้างกล่องถ้าคอร์สยังไม่มี)
    // UI ไม่มีตัวเลือก "ไม่จัดหมวด" แล้ว อันนี้กันบทหลุดจากทางอื่นที่เรียก API ตรงๆ
    const sectionId = section_id ?? (await basicsSectionId(Number(courseId)));
    let order = lesson_order;
    if (order === undefined || order === null) {
      if (sectionId) {
        const r = await pool.query(`SELECT COALESCE(MAX(lesson_order), 0) + 1 as next_order FROM lessons WHERE section_id = $1`, [sectionId]);
        order = r.rows[0].next_order;
      } else {
        const r = await pool.query(`SELECT COALESCE(MAX(lesson_order), 0) + 1 as next_order FROM lessons WHERE course_id = $1`, [courseId]);
        order = r.rows[0].next_order;
      }
    }
    const result = await pool.query(`
      INSERT INTO lessons (course_id, section_id, title, description, youtube_url, youtube_id, duration_minutes, lesson_order, is_preview, materials)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [courseId, sectionId, title, description || null, youtube_url, youtube_id, duration_minutes || 0, order, is_preview || false, JSON.stringify(cleanMaterials)]);
    await pool.query(`
      UPDATE courses SET total_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = $1 AND is_active = true), updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [courseId]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating lesson:', error);
    res.status(500).json({ error: 'Failed to create lesson' });
  }
});

router.put('/lessons/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const { title, description, youtube_url, duration_minutes, lesson_order, is_preview, is_active, section_id, materials } = req.body;
    const youtube_id = youtube_url ? extractYoutubeId(youtube_url) : undefined;
    // Reject an unparseable URL: the COALESCE below would otherwise store the
    // new youtube_url while keeping the old youtube_id, leaving the player on
    // the previous (or dead) video.
    if (youtube_url && !youtube_id) return res.status(400).json({ error: 'ลิงก์ YouTube ไม่ถูกต้อง (รองรับ watch?v=, youtu.be, /embed/, /shorts/, /live/)' });
    if (materials !== undefined) {
      const sizeError = validateMaterialsSize(sanitizeMaterials(materials));
      if (sizeError) return res.status(400).json({ error: sizeError });
    }
    let query = `
      UPDATE lessons SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        youtube_url = COALESCE($3, youtube_url),
        youtube_id = COALESCE($4, youtube_id),
        duration_minutes = COALESCE($5, duration_minutes),
        lesson_order = COALESCE($6, lesson_order),
        is_preview = COALESCE($7, is_preview),
        is_active = COALESCE($8, is_active),
        materials = COALESCE($9, materials),
    `;
    const params: any[] = [title, description, youtube_url, youtube_id, duration_minutes, lesson_order, is_preview, is_active,
      materials !== undefined ? JSON.stringify(sanitizeMaterials(materials)) : null];
    if (section_id !== undefined) { query += `section_id = $10,`; params.push(section_id); }
    query += ` updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length + 1} RETURNING *`;
    params.push(id);
    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Lesson not found' });
    const lesson = result.rows[0];
    await pool.query(`
      UPDATE courses SET total_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = $1 AND is_active = true), updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [lesson.course_id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating lesson:', error);
    res.status(500).json({ error: 'Failed to update lesson' });
  }
});

router.delete('/lessons/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const lessonResult = await pool.query(`SELECT course_id FROM lessons WHERE id = $1`, [id]);
    if (lessonResult.rows.length === 0) return res.status(404).json({ error: 'Lesson not found' });
    const courseId = lessonResult.rows[0].course_id;
    await pool.query(`DELETE FROM lessons WHERE id = $1`, [id]);
    await pool.query(`
      UPDATE courses SET total_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = $1 AND is_active = true), updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [courseId]);
    res.json({ message: 'Lesson deleted successfully' });
  } catch (error) {
    console.error('Error deleting lesson:', error);
    res.status(500).json({ error: 'Failed to delete lesson' });
  }
});

router.put('/:courseId/lessons/reorder', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { courseId } = req.params;
    const { lessonIds } = req.body;
    if (!Array.isArray(lessonIds)) return res.status(400).json({ error: 'lessonIds must be an array' });
    for (let i = 0; i < lessonIds.length; i++) {
      await pool.query(`
        UPDATE lessons SET lesson_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND course_id = $3
      `, [i + 1, lessonIds[i], courseId]);
    }
    res.json({ message: 'Lessons reordered successfully' });
  } catch (error) {
    console.error('Error reordering lessons:', error);
    res.status(500).json({ error: 'Failed to reorder lessons' });
  }
});

// ============ Authed: single lesson video (subscription-gated) ============
// Authoritative gate for paid lesson playback. Free (is_preview) lessons return
// youtube to any authenticated user; paid lessons require an active subscription
// (or admin). Paid youtube ids are never included in any list/detail payload —
// the player fetches them one lesson at a time through this endpoint.
// optionalAuth: บท "ดูฟรี" (is_preview) ดูได้โดยไม่ต้อง login — logic ข้างล่าง
// อนุญาต preview ให้ทุกคนอยู่แล้ว แค่เดิม middleware บล็อก guest ที่ 401 ก่อนถึง
router.get('/:slug/lessons/:lessonId/video', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const { slug, lessonId } = req.params;
    const courseResult = await pool.query(`SELECT id, is_free FROM courses WHERE (slug = $1 OR share_code = LOWER($1)) AND is_active = true`, [slug]);
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    const courseId = courseResult.rows[0].id;
    const lessonResult = await pool.query(
      `SELECT id, title, youtube_id, youtube_url, is_preview FROM lessons WHERE id = $1 AND course_id = $2 AND is_active = true`,
      [lessonId, courseId]
    );
    if (lessonResult.rows.length === 0) return res.status(404).json({ error: 'Lesson not found' });
    const lesson = lessonResult.rows[0];
    const hasAccess =
      lesson.is_preview || isFreeCourse(courseResult.rows[0]) || req.isAdmin ||
      (await hasSubscriptionOrEnrollment(req.userId, courseId));
    if (!hasAccess) {
      return res.status(403).json({
        error: 'กรุณาซื้อคอร์สนี้ก่อนรับชมบทเรียน',
        code: 'NOT_PURCHASED',
      });
    }
    res.json({ id: lesson.id, title: lesson.title, youtube_id: lesson.youtube_id, youtube_url: lesson.youtube_url });
  } catch (error) {
    console.error('Error fetching lesson video:', error);
    res.status(500).json({ error: 'Failed to fetch lesson video' });
  }
});

// ============ Reviews (public list / owner upsert / admin delete) ============
router.get('/:slug/reviews', async (req, res) => {
  try {
    const { slug } = req.params;
    const cr = await pool.query(`SELECT id FROM courses WHERE slug = $1 OR share_code = LOWER($1)`, [slug]);
    if (cr.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    const courseId = cr.rows[0].id;
    const reviews = await pool.query(`
      SELECT rv.id, rv.rating, rv.comment, rv.created_at, SPLIT_PART(u.email, '@', 1) AS reviewer
      FROM course_reviews rv JOIN users u ON rv.user_id = u.id
      WHERE rv.course_id = $1 ORDER BY rv.created_at DESC
    `, [courseId]);
    const agg = await pool.query(
      `SELECT COALESCE(AVG(rating), 0)::numeric(3,2) AS avg, COUNT(*)::int AS count FROM course_reviews WHERE course_id = $1`,
      [courseId]
    );
    res.json({ reviews: reviews.rows, avg: Number(agg.rows[0].avg), count: agg.rows[0].count });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

router.post('/:courseId/reviews', authenticate, async (req: AuthRequest, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.userId!;
    const { rating, comment } = req.body;
    const r = parseInt(rating, 10);
    if (!(r >= 1 && r <= 5)) return res.status(400).json({ error: 'rating must be 1..5' });
    // รีวิวได้ถ้าเข้าเรียนได้จริง: ซื้อแล้ว / สมาชิก active / คอร์สฟรี — ให้ตรงกับฟอร์มที่ FE โชว์
    const canReview =
      (await hasSubscriptionOrEnrollment(userId, Number(courseId))) ||
      (await isCourseFreeById(Number(courseId)));
    if (!canReview) {
      return res.status(403).json({ error: 'ต้องซื้อคอร์สนี้หรือเป็นสมาชิกก่อนจึงจะรีวิวได้' });
    }
    const result = await pool.query(`
      INSERT INTO course_reviews (course_id, user_id, rating, comment)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (course_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [courseId, userId, r, comment || null]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

router.delete('/reviews/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    await pool.query(`DELETE FROM course_reviews WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Review deleted' });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// ============ Public: course by slug, full (auth) variant ============
// NOTE: keep these single/double-segment :slug routes LAST so they don't shadow
// the literal routes above (admin, sections, lessons, thumbnails).

router.get('/:slug/full', authenticate, async (req: AuthRequest, res) => {
  try {
    const { slug } = req.params;
    const userId = req.userId;
    const courseResult = await pool.query(`SELECT c.*,
        (SELECT GREATEST(MAX(created_at), MAX(updated_at)) FROM lessons WHERE course_id = c.id AND is_active = true) AS cover_rev,
        -- id ของบทล่าสุด: การ์ดที่โชว์ปกคลิปใหม่ ลิงก์มาที่บทนี้โดยตรง
        (SELECT l.id FROM lessons l WHERE l.course_id = c.id AND l.is_active = true ORDER BY l.created_at DESC NULLS LAST, l.lesson_order DESC, l.id DESC LIMIT 1) AS latest_lesson_id,
        (SELECT COUNT(*) FROM course_enrollments WHERE course_id = c.id AND status = 'approved') AS enrollment_count,
        (SELECT COALESCE(AVG(rating), 0)::numeric(3,2) FROM course_reviews WHERE course_id = c.id) AS avg_rating,
        (SELECT COUNT(*) FROM course_reviews WHERE course_id = c.id) AS review_count
      FROM courses c WHERE (c.slug = $1 OR c.share_code = LOWER($1)) AND c.is_active = true`, [slug]);
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    const course = courseResult.rows[0];
    // Access: admin, active subscription (unlocks ALL courses), or approved purchase.
    const isSubscriber = userId ? await hasActiveSubscription(userId) : false;
    const enrollmentResult = await pool.query(
      `SELECT * FROM course_enrollments WHERE user_id = $1 AND course_id = $2`,
      [userId, course.id]
    );
    let enrollment = enrollmentResult.rows[0] || null;
    // Subscribers get an auto 'approved' enrollment (source='subscription') so access,
    // progress, "my courses" and the "เริ่มเรียน" CTA all flow through the normal path.
    if (isSubscriber && !enrollment && userId) {
      await pool.query(
        `INSERT INTO course_enrollments (user_id, course_id, status, source, approved_at)
         VALUES ($1, $2, 'approved', 'subscription', CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, course_id) DO NOTHING`,
        [userId, course.id]
      );
      const re = await pool.query(`SELECT * FROM course_enrollments WHERE user_id = $1 AND course_id = $2`, [userId, course.id]);
      enrollment = re.rows[0] || null;
    }
    // คอร์สฟรี (ราคา 0) = ทุกคนเข้าถึงทุกบทได้ ไม่ต้องซื้อ/สมัคร
    const hasAccess = req.isAdmin || isSubscriber || (enrollment?.status === 'approved') || isFreeCourse(course);
    const sectionsResult = await pool.query(`
      SELECT s.id, s.title, s.description, s.section_order, s.mode, s.category_id,
             cat.name_en AS category_en, cat.name_th AS category_th
      FROM course_sections s LEFT JOIN categories cat ON cat.id = s.category_id
      WHERE s.course_id = $1 AND s.is_active = true ORDER BY s.section_order ASC
    `, [course.id]);
    const lessonsResult = await pool.query(`
      SELECT id, title, description, youtube_url, youtube_id, duration_minutes, lesson_order, is_preview, section_id, cover_url,
             ${materialsMetaSql('materials')} AS materials
      FROM lessons WHERE course_id = $1 AND is_active = true ORDER BY lesson_order ASC
    `, [course.id]);
    const lessons = lessonsResult.rows.map((lesson) => {
      if (!hasAccess && !lesson.is_preview) return { ...lesson, youtube_url: null, youtube_id: null, materials: [] };
      // Students only see materials flagged enabled (admin can hide without deleting).
      // Metadata only — inline html content is fetched per-lesson on demand.
      const materials = Array.isArray(lesson.materials) ? lesson.materials.filter((m: any) => m?.enabled !== false) : [];
      return { ...lesson, materials: stripMaterialContent(materials) };
    });
    const sections = sectionsResult.rows.map((section) => ({ ...section, lessons: lessons.filter(l => l.section_id === section.id) }));
    const unassignedLessons = lessons.filter(l => l.section_id === null);
    res.json({ ...course, sections, unassigned_lessons: unassignedLessons, lessons, enrollment, hasAccess, isEnrolled: hasAccess });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const courseResult = await pool.query(`SELECT c.*,
        (SELECT GREATEST(MAX(created_at), MAX(updated_at)) FROM lessons WHERE course_id = c.id AND is_active = true) AS cover_rev,
        -- id ของบทล่าสุด: การ์ดที่โชว์ปกคลิปใหม่ ลิงก์มาที่บทนี้โดยตรง
        (SELECT l.id FROM lessons l WHERE l.course_id = c.id AND l.is_active = true ORDER BY l.created_at DESC NULLS LAST, l.lesson_order DESC, l.id DESC LIMIT 1) AS latest_lesson_id,
        (SELECT COUNT(*) FROM course_enrollments WHERE course_id = c.id AND status = 'approved') AS enrollment_count,
        (SELECT COALESCE(AVG(rating), 0)::numeric(3,2) FROM course_reviews WHERE course_id = c.id) AS avg_rating,
        (SELECT COUNT(*) FROM course_reviews WHERE course_id = c.id) AS review_count
      FROM courses c WHERE (c.slug = $1 OR c.share_code = LOWER($1)) AND c.is_active = true`, [slug]);
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    const course = courseResult.rows[0];
    const sectionsResult = await pool.query(`
      SELECT s.id, s.title, s.description, s.section_order, s.mode, s.category_id,
             cat.name_en AS category_en, cat.name_th AS category_th
      FROM course_sections s LEFT JOIN categories cat ON cat.id = s.category_id
      WHERE s.course_id = $1 AND s.is_active = true ORDER BY s.section_order ASC
    `, [course.id]);
    const lessonsResult = await pool.query(`
      SELECT id, title, description, youtube_id, youtube_url, duration_minutes, lesson_order, is_preview, section_id, cover_url,
             ${materialsMetaSql('materials')} AS materials
      FROM lessons WHERE course_id = $1 AND is_active = true ORDER BY lesson_order ASC
    `, [course.id]);
    // Public payload: only preview lessons expose youtube + materials; paid lessons
    // are nulled so their video id / documents never reach an unauthenticated visitor.
    // คอร์สฟรี (ราคา 0) = ทุกบทเปิดเหมือน preview
    const free = isFreeCourse(course);
    const lessons = lessonsResult.rows.map((l) => {
      if (!l.is_preview && !free) return { ...l, youtube_id: null, youtube_url: null, materials: [] };
      const materials = Array.isArray(l.materials) ? l.materials.filter((m: any) => m?.enabled !== false) : [];
      return { ...l, materials: stripMaterialContent(materials) };
    });
    const sections = sectionsResult.rows.map((section) => ({ ...section, lessons: lessons.filter(l => l.section_id === section.id) }));
    const unassignedLessons = lessons.filter(l => l.section_id === null);
    res.json({ ...course, sections, unassigned_lessons: unassignedLessons, lessons });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

export default router;
