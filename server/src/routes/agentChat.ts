/**
 * Agent Chat routes — FAB chat widget (AI answers + human escalation).
 * Mounted at /api/agent-chat.
 *
 * User side runs under optionalAuth: logged-in users are keyed by req.userId,
 * guests by a client-generated guest_id (localStorage uuid). Every endpoint
 * ownership-checks the conversation against that identity.
 * Admin side: authenticate + requireAdmin.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { optionalAuth, authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { runAgentTurn } from '../services/agentChatService.js';
import { hasActiveSubscription } from '../services/stripeService.js';
import { fetchAutoCaptions } from '../utils/youtubeCaptions.js';
import { parseSubtitleFile } from '../utils/subtitleParser.js';
import { uploadFile, getFile } from '../utils/s3.js';
import crypto from 'crypto';

const router = Router();

// Optional image attached to a chat question. Stored in S3 (same pattern as
// enrollment slips) under a random key, served back via the proxy below.
const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_IMAGE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์รูปภาพ'));
  },
});

function uploadChatImage(req: Request, res: Response, next: () => void) {
  chatImageUpload.single('image')(req, res, (err: any) => {
    if (err) {
      const msg = err?.code === 'LIMIT_FILE_SIZE' ? 'รูปใหญ่เกิน 5MB' : (err?.message || 'อัปโหลดรูปไม่สำเร็จ');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

// Manual subtitle upload (.srt/.vtt/.sbv/.txt — YouTube Studio export formats).
const subtitleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// Same JSON-error wrapper pattern as courses.ts uploadSingle.
function uploadSubtitleSingle(field: string) {
  return (req: Request, res: Response, next: () => void) =>
    subtitleUpload.single(field)(req, res, (err: any) => {
      if (err) {
        const msg = err?.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ใหญ่เกิน 2MB' : (err?.message || 'อัปโหลดไม่สำเร็จ');
        return res.status(400).json({ error: msg });
      }
      next();
    });
}

/** Course access = admin || active subscription || approved purchase (same gate as courses.ts). */
async function hasCourseAccess(req: AuthRequest, courseId: number): Promise<boolean> {
  if (req.isAdmin) return true;
  if (!req.userId) return false;
  if (await hasActiveSubscription(req.userId)) return true;
  const r = await pool.query(
    `SELECT 1 FROM course_enrollments WHERE user_id = $1 AND course_id = $2 AND status = 'approved' LIMIT 1`,
    [req.userId, courseId]
  );
  return r.rows.length > 0;
}

// Two-layer cost cap: burst (15 / 10 min) + daily ceiling (60 / 24 h) per
// user (guests fall back to per-IP). In-memory — resets on restart, which is
// fine: this bounds spend per abuser, it is not a security control.
const chatRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  keyBy: (req) => (req.userId ? `chat:${req.userId}` : undefined),
  message: 'ส่งข้อความถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
});
const chatDailyLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 60,
  keyBy: (req) => (req.userId ? `chat-daily:${req.userId}` : undefined),
  message: 'ใช้แชทครบโควต้าของวันนี้แล้ว พรุ่งนี้ลองใหม่ หรือกดปุ่ม "คุยกับแอดมิน" เพื่อติดต่อทีมงานได้เลยค่ะ',
});

const MAX_TEXT = 2000;

// AI sessions expire 1 hour after the LAST message — the next message then
// starts a fresh thread (fresh context). Applies to status='ai' only:
// escalated/answered threads are waiting on a human and must survive long
// gaps so the user still sees the admin's reply in the same thread.
const SESSION_TTL_MINUTES = 60;

function sessionExpired(conv: { status: string; last_message_at: string | Date }): boolean {
  if (conv.status !== 'ai') return false;
  return Date.now() - new Date(conv.last_message_at).getTime() > SESSION_TTL_MINUTES * 60 * 1000;
}

function cleanGuestId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const g = raw.trim();
  return g && g.length <= 64 ? g : null;
}

async function getThread(convId: number) {
  const conv =
    (
      await pool.query(
        `SELECT c.*, co.name AS course_name
         FROM chat_conversations c
         LEFT JOIN courses co ON co.id = c.course_id
         WHERE c.id = $1`,
        [convId]
      )
    ).rows[0] || null;
  if (!conv) return null;
  const messages = (
    await pool.query(
      `SELECT id, sender_type, body, image_url, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC`,
      [convId]
    )
  ).rows;
  return { conversation: conv, messages };
}

function ownsConversation(conv: any, userId: number | undefined, guestId: string | null): boolean {
  if (userId && conv.user_id === userId) return true;
  if (!conv.user_id && guestId && conv.guest_id === guestId) return true;
  return false;
}

// ============ User: image proxy (random keys — same public-proxy pattern as slips) ============
router.get('/images/*', async (req: Request, res: Response) => {
  try {
    const key = (req.params as any)[0] as string;
    if (!key || !key.startsWith('chat-images/')) return res.status(404).end();
    const obj = await getFile(key);
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    (obj.Body as any).pipe(res);
  } catch {
    res.status(404).end();
  }
});

/* ============ Shared message pipeline (used by /message and /message/stream) ============ */

type PreparedMessage =
  | { error: { status: number; msg: string } }
  | { conv: any; courseId: number; image: Express.Multer.File | null };

/** Validate → expire stale sessions → resolve conversation → store image + user message. */
async function prepareIncomingMessage(req: AuthRequest): Promise<PreparedMessage> {
  const userId = req.userId;
  const guestId = cleanGuestId(req.body.guest_id);
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  const image = req.file || null;
  if (!text && !image) return { error: { status: 400, msg: 'ข้อความว่างเปล่า' } };
  if (text.length > MAX_TEXT) return { error: { status: 400, msg: `ข้อความยาวเกิน ${MAX_TEXT} ตัวอักษร` } };
  if (!userId && !guestId) return { error: { status: 400, msg: 'Missing identity' } };

  // Per-course sessions: every message belongs to exactly one course.
  const courseId = Number(req.body.course_id);
  if (!Number.isInteger(courseId) || courseId <= 0) return { error: { status: 400, msg: 'Missing course_id' } };
  const course = (
    await pool.query(`SELECT id FROM courses WHERE id = $1 AND is_active = true`, [courseId])
  ).rows[0];
  if (!course) return { error: { status: 404, msg: 'Course not found' } };

  // Expire stale AI sessions (1h after last message) for this identity+course.
  await pool.query(
    userId
      ? `UPDATE chat_conversations SET status = 'closed'
         WHERE user_id = $1 AND course_id = $2 AND status = 'ai'
           AND last_message_at < NOW() - INTERVAL '${SESSION_TTL_MINUTES} minutes'`
      : `UPDATE chat_conversations SET status = 'closed'
         WHERE user_id IS NULL AND guest_id = $1 AND course_id = $2 AND status = 'ai'
           AND last_message_at < NOW() - INTERVAL '${SESSION_TTL_MINUTES} minutes'`,
    [userId ?? guestId, courseId]
  );

  // Resolve conversation: explicit id (ownership + course checked) → latest open for this course → create.
  let conv: any = null;
  if (req.body.conversation_id) {
    conv = (await pool.query(`SELECT * FROM chat_conversations WHERE id = $1`, [req.body.conversation_id])).rows[0];
    if (!conv || !ownsConversation(conv, userId, guestId) || conv.course_id !== courseId) {
      return { error: { status: 404, msg: 'Conversation not found' } };
    }
    if (conv.status === 'closed' || sessionExpired(conv)) conv = null; // closed/expired → start fresh
  }
  if (!conv) {
    const existing = await pool.query(
      userId
        ? `SELECT * FROM chat_conversations WHERE user_id = $1 AND course_id = $2 AND status <> 'closed' ORDER BY last_message_at DESC LIMIT 1`
        : `SELECT * FROM chat_conversations WHERE user_id IS NULL AND guest_id = $1 AND course_id = $2 AND status <> 'closed' ORDER BY last_message_at DESC LIMIT 1`,
      [userId ?? guestId, courseId]
    );
    conv = existing.rows[0] || null;
    if (conv && sessionExpired(conv)) conv = null;
  }
  if (!conv) {
    conv = (
      await pool.query(
        `INSERT INTO chat_conversations (user_id, guest_id, course_id) VALUES ($1, $2, $3) RETURNING *`,
        [userId ?? null, userId ? null : guestId, courseId]
      )
    ).rows[0];
  }

  // Store the attached image (if any) in S3 under an unguessable key.
  let imageUrl: string | null = null;
  if (image) {
    const ext = (image.originalname?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const key = `chat-images/${conv.id}/${crypto.randomUUID()}.${ext}`;
    await uploadFile(image.buffer, key, image.mimetype, { contentDisposition: 'inline' });
    imageUrl = `/api/agent-chat/images/${key}`;
  }

  await pool.query(
    `INSERT INTO chat_messages (conversation_id, sender_type, body, image_url) VALUES ($1, 'user', $2, $3)`,
    [conv.id, text || '(ส่งรูปภาพ)', imageUrl]
  );

  return { conv, courseId, image };
}

/** Run the bot (or the waiting-on-human branch) and persist the outcome. */
async function processBotTurn(
  req: AuthRequest,
  conv: any,
  courseId: number,
  image: Express.Multer.File | null,
  onDelta?: (text: string) => void
): Promise<void> {
  if (conv.status === 'ai') {
    const history = (
      await pool.query(
        `SELECT sender_type, body, image_url FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC`,
        [conv.id]
      )
    ).rows;
    const hasAccess = await hasCourseAccess(req, courseId);
    const reply = await runAgentTurn(
      history,
      {
        courseId,
        hasAccess,
        // Only the current turn's image goes to the model (as base64).
        image: image ? { base64: image.buffer.toString('base64'), mimeType: image.mimetype } : undefined,
      },
      onDelta
    );
    await pool.query(
      `INSERT INTO chat_messages (conversation_id, sender_type, body) VALUES ($1, 'ai', $2)`,
      [conv.id, reply.text]
    );
    if (reply.escalated) {
      await pool.query(
        `UPDATE chat_conversations SET status = 'escalated', escalate_reason = COALESCE($2, escalate_reason), last_message_at = NOW() WHERE id = $1`,
        [conv.id, reply.escalateReason]
      );
    } else {
      await pool.query(`UPDATE chat_conversations SET last_message_at = NOW() WHERE id = $1`, [conv.id]);
    }
  } else {
    // Waiting on a human — store the message; an 'answered' thread reopens.
    await pool.query(
      `UPDATE chat_conversations SET status = CASE WHEN status = 'answered' THEN 'escalated' ELSE status END, last_message_at = NOW() WHERE id = $1`,
      [conv.id]
    );
  }
}

// ============ User: send a message (JSON, or multipart when an image is attached) ============
router.post('/message', optionalAuth, chatRateLimit, chatDailyLimit, uploadChatImage, async (req: AuthRequest, res: Response) => {
  try {
    const prepared = await prepareIncomingMessage(req);
    if ('error' in prepared) return res.status(prepared.error.status).json({ error: prepared.error.msg });
    await processBotTurn(req, prepared.conv, prepared.courseId, prepared.image);
    res.json(await getThread(prepared.conv.id));
  } catch (error) {
    console.error('[AgentChat] send error:', error);
    res.status(500).json({ error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' });
  }
});

// ============ User: send a message with a STREAMED reply (SSE) ============
// Same pipeline as /message but the bot's text arrives token-by-token:
//   event: delta {"text": "..."}   — appended chunks while the model writes
//   event: done  {thread}          — final authoritative thread (after DB writes)
//   event: error {"error": "..."}  — client should fall back to POST /message
router.post(
  '/message/stream',
  optionalAuth,
  chatRateLimit,
  chatDailyLimit,
  uploadChatImage,
  async (req: AuthRequest, res: Response) => {
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as any).flush?.();
    };
    try {
      const prepared = await prepareIncomingMessage(req);
      if ('error' in prepared) {
        return res.status(prepared.error.status).json({ error: prepared.error.msg });
      }
      // Switch to SSE only after validation passed (errors above stay plain JSON).
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      await processBotTurn(req, prepared.conv, prepared.courseId, prepared.image, (text) =>
        send('delta', { text })
      );
      send('done', await getThread(prepared.conv.id));
      res.end();
    } catch (error) {
      console.error('[AgentChat] stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' });
      } else {
        send('error', { error: 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่' });
        res.end();
      }
    }
  }
);

// ============ User: load latest conversation (open widget / polling) ============
router.get('/conversation', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const guestId = cleanGuestId(req.query.guest_id);
    const courseId = Number(req.query.course_id);
    if (!userId && !guestId) return res.json({ conversation: null, messages: [] });
    if (!Number.isInteger(courseId) || courseId <= 0) return res.json({ conversation: null, messages: [] });
    // Same 1h-TTL rule as /message (read-only here: expired AI threads are
    // simply not returned, so the widget greets fresh after a long gap).
    const existing = await pool.query(
      userId
        ? `SELECT id FROM chat_conversations
           WHERE user_id = $1 AND course_id = $2 AND status <> 'closed'
             AND (status <> 'ai' OR last_message_at > NOW() - INTERVAL '${SESSION_TTL_MINUTES} minutes')
           ORDER BY last_message_at DESC LIMIT 1`
        : `SELECT id FROM chat_conversations
           WHERE user_id IS NULL AND guest_id = $1 AND course_id = $2 AND status <> 'closed'
             AND (status <> 'ai' OR last_message_at > NOW() - INTERVAL '${SESSION_TTL_MINUTES} minutes')
           ORDER BY last_message_at DESC LIMIT 1`,
      [userId ?? guestId, courseId]
    );
    if (!existing.rows[0]) return res.json({ conversation: null, messages: [] });
    res.json(await getThread(existing.rows[0].id));
  } catch (error) {
    console.error('[AgentChat] load error:', error);
    res.status(500).json({ error: 'โหลดบทสนทนาไม่สำเร็จ' });
  }
});

// ============ User: manual escalate ("คุยกับแอดมิน") ============
router.post('/escalate', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const guestId = cleanGuestId(req.body.guest_id);
    const convId = Number(req.body.conversation_id);
    if (!convId) return res.status(400).json({ error: 'Missing conversation_id' });
    const conv = (await pool.query(`SELECT * FROM chat_conversations WHERE id = $1`, [convId])).rows[0];
    if (!conv || !ownsConversation(conv, userId, guestId)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const contact = typeof req.body.contact_info === 'string' ? req.body.contact_info.trim().slice(0, 255) : null;
    await pool.query(
      `UPDATE chat_conversations SET status = 'escalated',
        escalate_reason = COALESCE(escalate_reason, 'ผู้ใช้กดขอคุยกับแอดมิน'),
        contact_info = COALESCE($2, contact_info), last_message_at = NOW() WHERE id = $1`,
      [convId, contact]
    );
    await pool.query(
      `INSERT INTO chat_messages (conversation_id, sender_type, body) VALUES ($1, 'ai', $2)`,
      [convId, 'ส่งเรื่องต่อให้ทีมงานแล้วค่ะ 🙋 ทีมงานจะตอบกลับในแชทนี้โดยเร็วที่สุด']
    );
    res.json(await getThread(convId));
  } catch (error) {
    console.error('[AgentChat] escalate error:', error);
    res.status(500).json({ error: 'ส่งเรื่องไม่สำเร็จ' });
  }
});

// ============ User: back to the bot ("กลับไปคุยกับน้องทริปเปิ้ล") ============
// Escalated/answered threads wait on a human — this hands the thread back to
// the AI so the user can keep asking without waiting for the admin.
router.post('/back-to-ai', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const guestId = cleanGuestId(req.body.guest_id);
    const convId = Number(req.body.conversation_id);
    if (!convId) return res.status(400).json({ error: 'Missing conversation_id' });
    const conv = (await pool.query(`SELECT * FROM chat_conversations WHERE id = $1`, [convId])).rows[0];
    if (!conv || !ownsConversation(conv, userId, guestId)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    if (conv.status === 'escalated' || conv.status === 'answered') {
      await pool.query(
        `UPDATE chat_conversations SET status = 'ai', last_message_at = NOW() WHERE id = $1`,
        [convId]
      );
      await pool.query(
        `INSERT INTO chat_messages (conversation_id, sender_type, body) VALUES ($1, 'ai', $2)`,
        [convId, 'น้องทริปเปิ้ลกลับมาแล้วค่ะ 🤖 ถามต่อได้เลยนะคะ (ถ้าต้องการทีมงานอีกครั้ง กด "คุยกับแอดมิน" ได้เสมอค่ะ)']
      );
    }
    res.json(await getThread(convId));
  } catch (error) {
    console.error('[AgentChat] back-to-ai error:', error);
    res.status(500).json({ error: 'สลับกลับไม่สำเร็จ' });
  }
});

/* =====================  ADMIN  ===================== */

// Badge polling — cheap count of chats waiting on a human.
router.get('/admin/counts', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'escalated')::int AS escalated,
              COUNT(*) FILTER (WHERE status = 'answered')::int AS answered
       FROM chat_conversations`
    );
    res.json(r.rows[0]);
  } catch (error) {
    console.error('[AgentChat] counts error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/list', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { status, search } = req.query;
    const params: any[] = [];
    let where = ` WHERE 1=1`;
    let i = 1;
    if (status && status !== 'all') { where += ` AND c.status = $${i++}`; params.push(status); }
    if (search) {
      where += ` AND (u.email ILIKE $${i} OR c.contact_info ILIKE $${i} OR c.guest_id ILIKE $${i})`;
      params.push(`%${search}%`); i++;
    }
    const rows = (
      await pool.query(
        `SELECT c.*, u.email AS user_email, co.name AS course_name,
                (SELECT body FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
                (SELECT sender_type FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sender,
                (SELECT COUNT(*)::int FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count
         FROM chat_conversations c
         LEFT JOIN users u ON c.user_id = u.id
         LEFT JOIN courses co ON co.id = c.course_id
         ${where}
         ORDER BY (c.status = 'escalated') DESC, c.last_message_at DESC
         LIMIT 200`,
        params
      )
    ).rows;
    const counts = (
      await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'ai')::int AS ai,
                COUNT(*) FILTER (WHERE status = 'escalated')::int AS escalated,
                COUNT(*) FILTER (WHERE status = 'answered')::int AS answered,
                COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
         FROM chat_conversations`
      )
    ).rows[0];
    res.json({ conversations: rows, counts });
  } catch (error) {
    console.error('[AgentChat] admin list error:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// ============ Admin: sync YouTube auto-subtitles for a course ============
// Reads youtube_id straight from the DB (public APIs strip it for paid
// lessons). Per-lesson failures don't abort the batch.
// NOTE: must be registered BEFORE /admin/:id like the other named admin routes.
router.post(
  '/admin/course/:courseId/sync-subtitles',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const courseId = Number(req.params.courseId);
      if (!Number.isInteger(courseId) || courseId <= 0) return res.status(400).json({ error: 'Bad course id' });
      const lessons = (
        await pool.query(
          `SELECT id, title, youtube_id FROM lessons
           WHERE course_id = $1 AND is_active = true AND youtube_id IS NOT NULL AND youtube_id <> ''
           ORDER BY lesson_order`,
          [courseId]
        )
      ).rows as Array<{ id: number; title: string; youtube_id: string }>;

      const results: Array<{ lesson_id: number; title: string; status: 'ok' | 'no_captions'; chars?: number }> = [];
      for (const l of lessons) {
        const cap = await fetchAutoCaptions(l.youtube_id);
        if (cap) {
          await pool.query(
            `INSERT INTO lesson_subtitles (lesson_id, course_id, language, content, fetched_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (lesson_id) DO UPDATE
               SET course_id = EXCLUDED.course_id, language = EXCLUDED.language,
                   content = EXCLUDED.content, fetched_at = NOW()`,
            [l.id, courseId, cap.language, cap.text]
          );
          results.push({ lesson_id: l.id, title: l.title, status: 'ok', chars: cap.text.length });
        } else {
          results.push({ lesson_id: l.id, title: l.title, status: 'no_captions' });
        }
      }
      res.json({
        total: lessons.length,
        ok: results.filter((r) => r.status === 'ok').length,
        no_captions: results.filter((r) => r.status === 'no_captions').length,
        results,
      });
    } catch (error) {
      console.error('[AgentChat] sync subtitles error:', error);
      res.status(500).json({ error: 'ดึงซับไตเติลไม่สำเร็จ' });
    }
  }
);

// ============ Admin: per-lesson subtitle status for a course ============
router.get(
  '/admin/course/:courseId/subtitles',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const courseId = Number(req.params.courseId);
      if (!Number.isInteger(courseId) || courseId <= 0) return res.status(400).json({ error: 'Bad course id' });
      const rows = (
        await pool.query(
          `SELECT l.id AS lesson_id, l.title, l.lesson_order,
                  (l.youtube_id IS NOT NULL AND l.youtube_id <> '') AS has_youtube,
                  (ls.id IS NOT NULL) AS has_sub,
                  COALESCE(LENGTH(ls.content), 0) AS chars,
                  ls.language, ls.fetched_at
           FROM lessons l
           LEFT JOIN lesson_subtitles ls ON ls.lesson_id = l.id
           WHERE l.course_id = $1 AND l.is_active = true
           ORDER BY l.lesson_order`,
          [courseId]
        )
      ).rows;
      res.json({ lessons: rows });
    } catch (error) {
      console.error('[AgentChat] subtitle status error:', error);
      res.status(500).json({ error: 'โหลดสถานะซับไม่สำเร็จ' });
    }
  }
);

// ============ Admin: upload a subtitle file for one lesson ============
// Accepts YouTube Studio export formats (.srt / .vtt / .sbv) or plain .txt —
// timestamps and cue markup are stripped, only the text is stored.
router.post(
  '/admin/lessons/:lessonId/subtitle',
  authenticate,
  requireAdmin,
  uploadSubtitleSingle('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const lessonId = Number(req.params.lessonId);
      if (!Number.isInteger(lessonId) || lessonId <= 0) return res.status(400).json({ error: 'Bad lesson id' });
      const lesson = (
        await pool.query(`SELECT id, course_id, title FROM lessons WHERE id = $1`, [lessonId])
      ).rows[0];
      if (!lesson) return res.status(404).json({ error: 'ไม่พบบทเรียน' });
      if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์ซับไตเติล (.srt/.vtt/.sbv/.txt)' });

      const raw = req.file.buffer.toString('utf8');
      const parsed = parseSubtitleFile(req.file.originalname || 'subtitle.txt', raw);
      if (!parsed) {
        return res.status(400).json({ error: 'อ่านไฟล์ไม่ได้ — รองรับ .srt .vtt .sbv .txt (ข้อความ UTF-8)' });
      }

      const language = typeof req.body.language === 'string' && req.body.language.trim()
        ? req.body.language.trim().slice(0, 10)
        : 'th';
      await pool.query(
        `INSERT INTO lesson_subtitles (lesson_id, course_id, language, content, fetched_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (lesson_id) DO UPDATE
           SET course_id = EXCLUDED.course_id, language = EXCLUDED.language,
               content = EXCLUDED.content, fetched_at = NOW()`,
        [lesson.id, lesson.course_id, language, parsed.text]
      );
      res.json({ ok: true, lesson_id: lesson.id, format: parsed.format, chars: parsed.text.length });
    } catch (error) {
      console.error('[AgentChat] subtitle upload error:', error);
      res.status(500).json({ error: 'อัปโหลดซับไม่สำเร็จ' });
    }
  }
);

// ============ Admin: fetch auto-captions for ONE lesson ============
router.post(
  '/admin/lessons/:lessonId/sync-subtitle',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const lessonId = Number(req.params.lessonId);
      if (!Number.isInteger(lessonId) || lessonId <= 0) return res.status(400).json({ error: 'Bad lesson id' });
      const lesson = (
        await pool.query(
          `SELECT id, course_id, title, youtube_id FROM lessons WHERE id = $1`,
          [lessonId]
        )
      ).rows[0];
      if (!lesson) return res.status(404).json({ error: 'ไม่พบบทเรียน' });
      if (!lesson.youtube_id) return res.status(400).json({ error: 'บทเรียนนี้ไม่มีวิดีโอ YouTube' });

      const cap = await fetchAutoCaptions(lesson.youtube_id);
      if (!cap) {
        return res.status(404).json({ error: 'ไม่พบซับอัตโนมัติของวิดีโอนี้ — ลองอัปโหลดไฟล์ซับเองแทน' });
      }
      await pool.query(
        `INSERT INTO lesson_subtitles (lesson_id, course_id, language, content, fetched_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (lesson_id) DO UPDATE
           SET course_id = EXCLUDED.course_id, language = EXCLUDED.language,
               content = EXCLUDED.content, fetched_at = NOW()`,
        [lesson.id, lesson.course_id, cap.language, cap.text]
      );
      res.json({ ok: true, lesson_id: lesson.id, language: cap.language, chars: cap.text.length });
    } catch (error) {
      console.error('[AgentChat] single sync error:', error);
      res.status(500).json({ error: 'ดึงซับไม่สำเร็จ' });
    }
  }
);

// ============ Admin: delete a lesson's subtitle ============
router.delete(
  '/admin/lessons/:lessonId/subtitle',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const lessonId = Number(req.params.lessonId);
      if (!Number.isInteger(lessonId) || lessonId <= 0) return res.status(400).json({ error: 'Bad lesson id' });
      await pool.query(`DELETE FROM lesson_subtitles WHERE lesson_id = $1`, [lessonId]);
      res.json({ ok: true });
    } catch (error) {
      console.error('[AgentChat] subtitle delete error:', error);
      res.status(500).json({ error: 'ลบซับไม่สำเร็จ' });
    }
  }
);

// NOTE: must be registered BEFORE GET /admin/:id or ':id' would capture "knowledge".
router.get('/admin/knowledge', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = (
      await pool.query(`SELECT * FROM agent_knowledge ORDER BY display_order, id`)
    ).rows;
    res.json({ knowledge: rows });
  } catch (error) {
    console.error('[AgentChat] knowledge list error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const thread = await getThread(Number(req.params.id));
    if (!thread) return res.status(404).json({ error: 'Not found' });
    const u = thread.conversation.user_id
      ? (await pool.query(`SELECT email FROM users WHERE id = $1`, [thread.conversation.user_id])).rows[0]
      : null;
    res.json({ ...thread, user_email: u?.email || null });
  } catch (error) {
    console.error('[AgentChat] admin get error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/admin/:id/reply', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const convId = Number(req.params.id);
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'ข้อความว่างเปล่า' });
    const conv = (await pool.query(`SELECT id FROM chat_conversations WHERE id = $1`, [convId])).rows[0];
    if (!conv) return res.status(404).json({ error: 'Not found' });
    await pool.query(
      `INSERT INTO chat_messages (conversation_id, sender_type, admin_id, body) VALUES ($1, 'admin', $2, $3)`,
      [convId, req.userId, text]
    );
    await pool.query(
      `UPDATE chat_conversations SET status = 'answered', last_message_at = NOW() WHERE id = $1`,
      [convId]
    );
    res.json(await getThread(convId));
  } catch (error) {
    console.error('[AgentChat] admin reply error:', error);
    res.status(500).json({ error: 'ตอบกลับไม่สำเร็จ' });
  }
});

/* ---------- Admin: knowledge base (คลังความรู้บอท) ---------- */

router.post('/admin/knowledge', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    if (!title || !content) return res.status(400).json({ error: 'ต้องใส่หัวข้อและเนื้อหา' });
    const row = (
      await pool.query(
        `INSERT INTO agent_knowledge (title, content) VALUES ($1, $2) RETURNING *`,
        [title.slice(0, 200), content]
      )
    ).rows[0];
    res.json({ knowledge: row });
  } catch (error) {
    console.error('[AgentChat] knowledge create error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

router.put('/admin/knowledge/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { title, content, is_active, display_order } = req.body;
    const row = (
      await pool.query(
        `UPDATE agent_knowledge SET
           title = COALESCE($2, title),
           content = COALESCE($3, content),
           is_active = COALESCE($4, is_active),
           display_order = COALESCE($5, display_order),
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [
          id,
          typeof title === 'string' ? title.trim().slice(0, 200) : null,
          typeof content === 'string' ? content.trim() : null,
          typeof is_active === 'boolean' ? is_active : null,
          typeof display_order === 'number' ? display_order : null,
        ]
      )
    ).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ knowledge: row });
  } catch (error) {
    console.error('[AgentChat] knowledge update error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

router.delete('/admin/knowledge/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(`DELETE FROM agent_knowledge WHERE id = $1 RETURNING id`, [Number(req.params.id)]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('[AgentChat] knowledge delete error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/admin/:id/status', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const convId = Number(req.params.id);
    const status = String(req.body.status || '');
    if (!['ai', 'escalated', 'answered', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const r = await pool.query(
      `UPDATE chat_conversations SET status = $2 WHERE id = $1 RETURNING id`,
      [convId, status]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, status });
  } catch (error) {
    console.error('[AgentChat] status error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

export default router;
