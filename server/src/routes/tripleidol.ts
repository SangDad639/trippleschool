import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { OAuth2Client } from 'google-auth-library';
import pool from '../db.js';
import { authenticate, AuthRequest, JWT_SECRET } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  APP_KEY,
  IDOL_USER_COLUMNS,
  bindIdolDevice,
  buildIdolUser,
  deviceMismatch,
  ensureGoogleUser,
  loadIdolAccess,
  releaseIdolDevice,
  type Db,
  type IdolUserRow,
} from '../services/tripleidolAccess.js';

// Triple Idol (โปรแกรม desktop · repo Triple-Idol) — mount ที่ /api/tripleidol
//   เส้นล็อกอินของแอป ใช้บัญชี Triple School เดียวกับเว็บ (ตาราง users) แต่ตอบในรูปที่แอปอ่าน
//   (services/tripleidolAccess.ts) และผูกเซสชันกับเครื่อง (desktop_app_access · migration 078)
//
//   POST /auth/login   {email, password, device_id}  → {token, user}
//   POST /auth/google  {credential, device_id}       → {token, user} · credential = Google ID token จาก desktop OAuth
//                                                      (PKCE + loopback ในแอป) · ยังไม่มีบัญชี → สร้างให้เหมือนเว็บ
//   GET  /auth/me      Bearer + X-Device-Id          → {user}        · 401 DEVICE_CHANGED เมื่อเครื่องอื่นล็อกอินทับ
//   POST /auth/refresh Bearer + X-Device-Id          → {token, user} · ต่ออายุ token ที่ยังไม่หมด (แอปโพสต์เองไม่มีคนเฝ้า)
//   POST /auth/logout  Bearer + X-Device-Id          → {ok}          · ปล่อยเครื่อง
//
//   ไม่มี register/forgot ที่นี่ — สมัครที่เว็บ school (/register) ที่เดียว · รีเซ็ตรหัสผ่านยังไม่มีทั้งระบบ
//   บัญชีที่สมัครด้วย Google ไม่มีรหัสผ่าน → login ด้วยรหัสตอบ 401 GOOGLE_ONLY ให้แอปชี้ไปปุ่ม Google

const USER_BY_EMAIL = `SELECT ${IDOL_USER_COLUMNS} FROM users WHERE email = $1`;
const USER_BY_ID = `SELECT ${IDOL_USER_COLUMNS} FROM users WHERE id = $1`;

// OAuth client ชนิด Desktop ของแอป desktop (ใช้ร่วมกับ Triple Music) — client id เป็นค่าสาธารณะ จึงใส่เป็น
// fallback ได้ · GOOGLE_DESKTOP_CLIENT_ID บน Railway (ถ้าตั้ง) ยังถูกรับด้วย แบบเดียวกับ routes/auth.ts
const DESKTOP_GOOGLE_CLIENT_ID =
  '1033381804439-p9nk559r3b38p73rk5sjda24msnb3919.apps.googleusercontent.com';
const googleClient = new OAuth2Client();

export interface GoogleIdentity {
  email: string;
  googleId: string;
}

/** ตรวจ Google ID token กับ Google แล้วคืนอีเมล + sub · โยน error เมื่อ token ปลอม/หมดอายุ/คนละ client */
export async function verifyGoogleIdToken(credential: string): Promise<GoogleIdentity> {
  const audience = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_DESKTOP_CLIENT_ID,
    DESKTOP_GOOGLE_CLIENT_ID,
  ].filter(Boolean) as string[];
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.sub || payload.email_verified === false) {
    throw new Error('google token without a verified email');
  }
  return { email: payload.email.toLowerCase(), googleId: payload.sub };
}

export interface IdolDeps {
  verifyGoogle: (credential: string) => Promise<GoogleIdentity>;
}

type UserRow = IdolUserRow & { password_hash: string | null; is_guide_admin: boolean | null };

export function signIdolToken(user: UserRow): string {
  // claims ชุดเดียวกับ routes/auth.ts (middleware/auth.ts อ่าน) + app ไว้ดูใน log ว่า token นี้ออกให้แอป
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      isAdmin: user.is_admin === true,
      isSuperAdmin: !!user.is_super_admin,
      isGuideAdmin: !!user.is_guide_admin,
      app: APP_KEY,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function deviceHeader(req: Request): string | undefined {
  const raw = req.headers['x-device-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length <= 64 ? value : undefined;
}

/** handler ทั้งชุด รับ db (+ ตัวตรวจ Google) เพื่อให้เทสต์ยัดของปลอมได้ — router ด้านล่างใช้ของจริง */
export function idolHandlers(db: Db, deps: IdolDeps = { verifyGoogle: verifyGoogleIdToken }) {
  async function login(req: Request, res: Response) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'กรอกอีเมลและรหัสผ่านให้ถูกต้อง', code: 'INVALID_INPUT' });
      }
      const { email, password } = req.body as { email: string; password: string };
      const deviceId = typeof req.body?.device_id === 'string' ? req.body.device_id : null;

      const found = await db.query(USER_BY_EMAIL, [email]);
      const user = found.rows[0] as UserRow | undefined;
      if (!user) {
        return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', code: 'INVALID_CREDENTIALS' });
      }
      if (!user.password_hash) {
        return res.status(401).json({
          error: 'บัญชีนี้สมัครด้วย Google — กดปุ่ม “เข้าสู่ระบบด้วย Google” แทน',
          code: 'GOOGLE_ONLY',
        });
      }
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', code: 'INVALID_CREDENTIALS' });
      }
      // เว็บ school auto-approve ตอนล็อกอินเหมือนกัน (routes/auth.ts) — ทำให้เท่ากัน
      if (!user.is_approved) {
        await db.query('UPDATE users SET is_approved = true WHERE id = $1', [user.id]);
        user.is_approved = true;
      }
      await bindIdolDevice(db, user.id, deviceId);
      const shaped = await buildIdolUser(db, user);
      return res.json({ token: signIdolToken(user), user: shaped });
    } catch (error) {
      console.error('[tripleidol] login error:', error);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  /** ปุ่ม Google ในแอป: แอปทำ desktop OAuth (PKCE + loopback) เองแล้วส่ง ID token มาที่นี่ */
  async function google(req: Request, res: Response) {
    try {
      const credential = typeof req.body?.credential === 'string' ? req.body.credential.trim() : '';
      const deviceId = typeof req.body?.device_id === 'string' ? req.body.device_id : null;
      if (!credential || credential.length > 8192) {
        return res.status(400).json({ error: 'ไม่พบข้อมูลจาก Google', code: 'INVALID_INPUT' });
      }
      let identity: GoogleIdentity;
      try {
        identity = await deps.verifyGoogle(credential);
      } catch (error) {
        console.warn('[tripleidol] google token rejected:', (error as Error)?.message);
        return res.status(401).json({
          error: 'ยืนยันตัวตนกับ Google ไม่สำเร็จ กรุณาลองใหม่',
          code: 'GOOGLE_INVALID',
        });
      }
      const id = await ensureGoogleUser(db, identity.email, identity.googleId);
      const found = await db.query(USER_BY_ID, [id]);
      const user = found.rows[0] as UserRow | undefined;
      if (!user) {
        return res.status(500).json({ error: 'Server error' });
      }
      await bindIdolDevice(db, user.id, deviceId);
      return res.json({ token: signIdolToken(user), user: await buildIdolUser(db, user) });
    } catch (error) {
      console.error('[tripleidol] google error:', error);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  /** โหลดบัญชีของ token + ตรวจเครื่อง — คืน null เมื่อตอบ error ไปแล้ว */
  async function currentUser(req: AuthRequest, res: Response): Promise<UserRow | null> {
    const found = await db.query(USER_BY_ID, [req.userId]);
    const user = found.rows[0] as UserRow | undefined;
    if (!user) {
      res.status(401).json({ error: 'ไม่พบบัญชีนี้แล้ว', code: 'UNAUTHORIZED' });
      return null;
    }
    const access = await loadIdolAccess(db, user.id);
    if (deviceMismatch(access?.device_id, deviceHeader(req))) {
      res.status(401).json({ error: 'บัญชีนี้ถูกใช้งานบนเครื่องอื่น', code: 'DEVICE_CHANGED' });
      return null;
    }
    return user;
  }

  async function me(req: AuthRequest, res: Response) {
    try {
      const user = await currentUser(req, res);
      if (!user) return;
      return res.json({ user: await buildIdolUser(db, user) });
    } catch (error) {
      console.error('[tripleidol] me error:', error);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  async function refresh(req: AuthRequest, res: Response) {
    try {
      const user = await currentUser(req, res);
      if (!user) return;
      return res.json({ token: signIdolToken(user), user: await buildIdolUser(db, user) });
    } catch (error) {
      console.error('[tripleidol] refresh error:', error);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  async function logout(req: AuthRequest, res: Response) {
    try {
      await releaseIdolDevice(db, req.userId as number, deviceHeader(req));
      return res.json({ ok: true });
    } catch (error) {
      console.error('[tripleidol] logout error:', error);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return { login, google, me, refresh, logout };
}

const router = express.Router();
const handlers = idolHandlers(pool);

// กันเดารหัสผ่าน: นับต่อ "อีเมล + IP" — ไม่ได้ตั้ง trust proxy บน Railway จึง req.ip อาจเป็น IP ของ proxy
// เหมือนกันทุกคน คีย์ด้วย IP อย่างเดียวจะทำให้ผู้ใช้ทั้งหมดแชร์ bucket เดียว (แอปหนึ่งเครื่องล็อกอินไม่กี่ครั้ง/วัน)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyBy: (req) => `${String(req.body?.email ?? '').trim().toLowerCase()}|${req.ip ?? ''}`,
  message: 'ลองเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
});

// ปุ่ม Google ไม่มีอีเมลให้คีย์ (มีแต่ ID token) → นับต่อ IP แต่หลวมกว่า เพราะ token ปลอมเดาไม่ได้อยู่แล้ว
const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'ลองเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
});

router.post(
  '/auth/login',
  loginLimiter,
  [
    body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }),
    body('password').notEmpty(),
  ],
  handlers.login
);
router.post('/auth/google', googleLimiter, handlers.google);
router.get('/auth/me', authenticate, handlers.me);
router.post('/auth/refresh', authenticate, handlers.refresh);
router.post('/auth/logout', authenticate, handlers.logout);

export default router;
