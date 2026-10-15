// Offline unit tests for routes/tripleidol.ts + services/tripleidolAccess.ts (DB ปลอม ไม่ต่อ Postgres)
// Run: npm run test:tripleidol   (tsx --test src/routes/__tests__/tripleidol.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';

// middleware/auth.ts ออกจาก process ถ้าไม่มี JWT_SECRET · db.ts สร้าง Pool จาก DATABASE_URL (ไม่ต่อจนกว่าจะ query)
// ตั้งก่อน import เพื่อให้เทสต์ไม่แตะ server/.env ซึ่งชี้ DB production
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/none';

const { idolHandlers } = await import('../tripleidol.js');
const {
  ACCESS_NO_END,
  FREE_CARD_LIMIT,
  MEMBER_CARD_LIMIT,
  deviceMismatch,
  idolPermissions,
  shapeIdolUser,
} = await import('../../services/tripleidolAccess.js');

const HASH = bcrypt.hashSync('442285', 4);
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();
const PAST = new Date(Date.now() - 86400000).toISOString();

interface State {
  user?: Record<string, unknown>;
  access?: { device_id: string | null; card_limit_override: number | null } | null;
  expires?: string | null;
}

function fakeDb(state: State) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM users WHERE email')) {
        return { rows: state.user && state.user.email === params[0] ? [{ ...state.user }] : [] };
      }
      if (sql.includes('FROM users WHERE id')) {
        return { rows: state.user && state.user.id === params[0] ? [{ ...state.user }] : [] };
      }
      if (sql.includes('FROM desktop_app_access')) return { rows: state.access ? [state.access] : [] };
      if (sql.includes('FROM users u')) {
        // services/membership.getMembership
        return { rows: [{ subscription_expires_at: state.expires ?? null, plan_type: null, plan_days: null }] };
      }
      if (/^\s*INSERT INTO desktop_app_access/.test(sql)) return { rows: [] };
      if (/^\s*UPDATE desktop_app_access/.test(sql)) return { rows: [] };
      if (/^\s*UPDATE users SET is_approved/.test(sql)) return { rows: [] };
      throw new Error('unexpected sql: ' + sql.slice(0, 60));
    },
  };
  return { db, calls };
}

function user(over: Record<string, unknown> = {}) {
  return {
    id: 42, email: 'aet@example.com', password_hash: HASH, is_admin: false, is_super_admin: false,
    is_guide_admin: false, is_approved: true, join_date: '2026-10-01T00:00:00.000Z', ...over,
  };
}

function req(body: Record<string, unknown> = {}, headers: Record<string, string> = {}, userId?: number) {
  return { body, headers, userId } as unknown as Request & AuthRequest;
}

function res() {
  const state = { statusCode: 200, body: undefined as unknown };
  const r = {
    status(code: number) { state.statusCode = code; return r; },
    json(value: unknown) { state.body = value; return r; },
  };
  return { state, res: r as unknown as Response };
}

// ---- pure rules ----------------------------------------------------------------------------

test('idolPermissions: ฟรี = 1 การ์ด แพลตฟอร์มละ 1 บัญชี ล็อกบัญชี', () => {
  const p = idolPermissions({ isAdmin: false, memberActive: false, memberUntil: null, override: null });
  assert.deepEqual(p, {
    tier: 'free', cardLimit: FREE_CARD_LIMIT, memberUntil: null, accountsPerPlatform: 1, accountsLocked: true,
  });
});

test('idolPermissions: สมาชิก school = 100 การ์ด ไม่จำกัดบัญชี พร้อมวันหมด', () => {
  const p = idolPermissions({ isAdmin: false, memberActive: true, memberUntil: FUTURE, override: null });
  assert.deepEqual(p, {
    tier: 'member', cardLimit: MEMBER_CARD_LIMIT, memberUntil: FUTURE, accountsPerPlatform: null, accountsLocked: false,
  });
});

test('idolPermissions: แอดมินได้ระดับสมาชิกโดยไม่ต้องมี subscription (ไม่มีวันหมด)', () => {
  const p = idolPermissions({ isAdmin: true, memberActive: false, memberUntil: null, override: null });
  assert.equal(p.tier, 'member');
  assert.equal(p.cardLimit, MEMBER_CARD_LIMIT);
  assert.equal(p.memberUntil, null);
});

test('idolPermissions: card_limit_override ของแอดมินทับค่าตามระดับ · ค่าเพี้ยนถูกเมิน', () => {
  const base = { isAdmin: false, memberActive: false, memberUntil: null };
  assert.equal(idolPermissions({ ...base, override: 5 }).cardLimit, 5);
  assert.equal(idolPermissions({ ...base, override: 0 }).cardLimit, 0);
  assert.equal(idolPermissions({ ...base, override: -1 }).cardLimit, FREE_CARD_LIMIT);
  assert.equal(idolPermissions({ ...base, override: 2.5 }).cardLimit, FREE_CARD_LIMIT);
  assert.equal(idolPermissions({ ...base, override: undefined }).cardLimit, FREE_CARD_LIMIT);
});

test('shapeIdolUser: ส่ง appAllowed เสมอ (แอป fail-closed) และสิทธิ์เข้าแอปไม่มีวันหมด', () => {
  const p = idolPermissions({ isAdmin: false, memberActive: false, memberUntil: null, override: null });
  const u = shapeIdolUser(user(), p);
  assert.equal(u.appAllowed, true);
  assert.equal(u.subscriptionEnd, ACCESS_NO_END);
  assert.equal(new Date(u.subscriptionEnd).getUTCFullYear() >= 2100, true, 'แอปตีความปี ≥ 2100 ว่า lifetime');
  assert.equal(u.role, 'user');
  assert.equal(shapeIdolUser(user({ is_super_admin: true }), p).role, 'admin');
  assert.equal('token' in u, false);
});

test('deviceMismatch: เตะเฉพาะเมื่อรู้ทั้งสองฝั่งและไม่ตรงกัน', () => {
  assert.equal(deviceMismatch('a', 'b'), true);
  assert.equal(deviceMismatch('a', 'a'), false);
  assert.equal(deviceMismatch(null, 'b'), false);
  assert.equal(deviceMismatch('a', undefined), false);
  assert.equal(deviceMismatch(undefined, undefined), false);
});

// ---- handlers ------------------------------------------------------------------------------

test('login: รหัสผิด / ไม่มีบัญชี → 401 INVALID_CREDENTIALS ไม่บอกว่าอีเมลมีไหม', async () => {
  const { db } = fakeDb({ user: user() });
  const h = idolHandlers(db);
  for (const body of [{ email: 'aet@example.com', password: 'nope' }, { email: 'ghost@example.com', password: '442285' }]) {
    const r = res();
    await h.login(req(body), r.res);
    assert.equal(r.state.statusCode, 401);
    assert.equal((r.state.body as { code: string }).code, 'INVALID_CREDENTIALS');
  }
});

test('login: บัญชี Google (ไม่มี password_hash) → 401 GOOGLE_ONLY', async () => {
  const { db } = fakeDb({ user: user({ password_hash: null }) });
  const r = res();
  await idolHandlers(db).login(req({ email: 'aet@example.com', password: 'x' }), r.res);
  assert.equal(r.state.statusCode, 401);
  assert.equal((r.state.body as { code: string }).code, 'GOOGLE_ONLY');
});

test('login: สำเร็จ → token ที่ middleware ตรวจได้ + ผูกเครื่อง + user ระดับฟรี', async () => {
  const { db, calls } = fakeDb({ user: user(), access: null });
  const r = res();
  await idolHandlers(db).login(req({ email: 'aet@example.com', password: '442285', device_id: 'dev-1' }), r.res);
  assert.equal(r.state.statusCode, 200);
  const body = r.state.body as { token: string; user: { appAllowed: boolean; permissions: { tier: string; cardLimit: number } } };
  const claims = jwt.verify(body.token, 'test-secret') as { userId: number; app: string; isAdmin: boolean };
  assert.equal(claims.userId, 42);
  assert.equal(claims.app, 'tripleidol');
  assert.equal(claims.isAdmin, false);
  assert.equal(body.user.appAllowed, true);
  assert.equal(body.user.permissions.tier, 'free');
  assert.equal(body.user.permissions.cardLimit, 1);
  const bind = calls.find((c) => /INSERT INTO desktop_app_access/.test(c.sql));
  assert.ok(bind, 'login ต้องจดเครื่องที่ถือเซสชัน');
  assert.deepEqual(bind!.params, [42, 'tripleidol', 'dev-1']);
});

test('login: ไม่ส่ง device_id → ไม่ทับการผูกเครื่องเดิม (ส่ง NULL ให้ COALESCE)', async () => {
  const { db, calls } = fakeDb({ user: user(), access: { device_id: 'old', card_limit_override: null } });
  await idolHandlers(db).login(req({ email: 'aet@example.com', password: '442285' }), res().res);
  const bind = calls.find((c) => /INSERT INTO desktop_app_access/.test(c.sql));
  assert.deepEqual(bind!.params, [42, 'tripleidol', null]);
});

test('login: บัญชีที่ยังไม่ approve ถูก approve ให้เหมือนเว็บ', async () => {
  const { db, calls } = fakeDb({ user: user({ is_approved: false }) });
  const r = res();
  await idolHandlers(db).login(req({ email: 'aet@example.com', password: '442285' }), r.res);
  assert.equal(r.state.statusCode, 200);
  assert.ok(calls.some((c) => /UPDATE users SET is_approved/.test(c.sql)));
});

test('me: เครื่องอื่นล็อกอินทับ → 401 DEVICE_CHANGED · เครื่องเดิม/ไม่บอกเครื่อง → ผ่าน', async () => {
  const { db } = fakeDb({ user: user(), access: { device_id: 'dev-1', card_limit_override: null } });
  const h = idolHandlers(db);
  const kicked = res();
  await h.me(req({}, { 'x-device-id': 'dev-2' }, 42), kicked.res);
  assert.equal(kicked.state.statusCode, 401);
  assert.equal((kicked.state.body as { code: string }).code, 'DEVICE_CHANGED');

  const same = res();
  await h.me(req({}, { 'x-device-id': 'dev-1' }, 42), same.res);
  assert.equal(same.state.statusCode, 200);
  assert.equal((same.state.body as { user: { appAllowed: boolean } }).user.appAllowed, true);

  const blind = res();
  await h.me(req({}, {}, 42), blind.res);
  assert.equal(blind.state.statusCode, 200);
});

test('me: สมาชิก school ยัง active → tier member 100 การ์ด · หมดแล้ว → กลับเป็นฟรี ไม่ใช่ล็อกแอป', async () => {
  const active = fakeDb({ user: user(), access: null, expires: FUTURE });
  const a = res();
  await idolHandlers(active.db).me(req({}, {}, 42), a.res);
  const au = (a.state.body as { user: { subscriptionEnd: string; permissions: { tier: string; cardLimit: number; memberUntil: string | null; accountsLocked: boolean } } }).user;
  assert.equal(au.permissions.tier, 'member');
  assert.equal(au.permissions.cardLimit, 100);
  assert.equal(au.permissions.memberUntil, FUTURE);
  assert.equal(au.permissions.accountsLocked, false);

  const lapsed = fakeDb({ user: user(), access: null, expires: PAST });
  const l = res();
  await idolHandlers(lapsed.db).me(req({}, {}, 42), l.res);
  const lu = (l.state.body as { user: { appAllowed: boolean; subscriptionEnd: string; permissions: { tier: string; cardLimit: number; memberUntil: string | null } } }).user;
  assert.equal(lu.appAllowed, true);
  assert.equal(lu.subscriptionEnd, ACCESS_NO_END, 'สมาชิกหมด = ลดระดับ ไม่ใช่หมดสิทธิ์เข้าแอป');
  assert.equal(lu.permissions.tier, 'free');
  assert.equal(lu.permissions.cardLimit, 1);
  assert.equal(lu.permissions.memberUntil, null);
});

test('me: card_limit_override จาก DB ทับโควตา', async () => {
  const { db } = fakeDb({ user: user(), access: { device_id: null, card_limit_override: 7 } });
  const r = res();
  await idolHandlers(db).me(req({}, {}, 42), r.res);
  assert.equal((r.state.body as { user: { permissions: { cardLimit: number } } }).user.permissions.cardLimit, 7);
});

test('me: บัญชีถูกลบไปแล้ว → 401 UNAUTHORIZED (แอปออกจากระบบ)', async () => {
  const { db } = fakeDb({ user: undefined });
  const r = res();
  await idolHandlers(db).me(req({}, {}, 42), r.res);
  assert.equal(r.state.statusCode, 401);
  assert.equal((r.state.body as { code: string }).code, 'UNAUTHORIZED');
});

test('refresh: ออก token ใหม่ให้เครื่องที่ถือเซสชัน · เครื่องอื่นถูกปฏิเสธ', async () => {
  const { db } = fakeDb({ user: user(), access: { device_id: 'dev-1', card_limit_override: null } });
  const h = idolHandlers(db);
  const ok = res();
  await h.refresh(req({}, { 'x-device-id': 'dev-1' }, 42), ok.res);
  assert.equal(ok.state.statusCode, 200);
  const body = ok.state.body as { token: string; user: { appAllowed: boolean } };
  assert.equal((jwt.verify(body.token, 'test-secret') as { userId: number }).userId, 42);
  assert.equal(body.user.appAllowed, true);

  const no = res();
  await h.refresh(req({}, { 'x-device-id': 'dev-9' }, 42), no.res);
  assert.equal(no.state.statusCode, 401);
});

test('logout: ปล่อยเครื่องด้วย device ที่ส่งมา (SQL ปล่อยเฉพาะเครื่องที่ตรง)', async () => {
  const { db, calls } = fakeDb({ user: user() });
  const r = res();
  await idolHandlers(db).logout(req({}, { 'x-device-id': 'dev-1' }, 42), r.res);
  assert.equal(r.state.statusCode, 200);
  const rel = calls.find((c) => /UPDATE desktop_app_access/.test(c.sql));
  assert.ok(rel);
  assert.deepEqual(rel!.params, [42, 'tripleidol', 'dev-1']);
  assert.match(rel!.sql, /device_id = \$3/);
});

test('ทุก handler ตอบ 500 แทนที่จะพัง เมื่อ DB ล้ม', async () => {
  const db = { async query() { throw new Error('db down'); } };
  const h = idolHandlers(db);
  const orig = console.error;
  console.error = () => {};
  try {
    for (const run of [
      () => h.login(req({ email: 'aet@example.com', password: 'x' }), res().res),
      () => h.me(req({}, {}, 42), res().res),
      () => h.refresh(req({}, {}, 42), res().res),
      () => h.logout(req({}, {}, 42), res().res),
    ]) {
      await run();
    }
  } finally {
    console.error = orig;
  }
  const r = res();
  await h.me(req({}, {}, 42), r.res);
  assert.equal(r.state.statusCode, 500);
});
