// Offline unit tests for routes/desktopVersion.ts (no DB, no S3, no JWT_SECRET needed)
// Run: npm run test:desktop   (tsx --test src/routes/__tests__/desktopVersion.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import {
  UPDATE_URL_TTL_S,
  artifactKeyOf,
  desktopVersionHandler,
  manifestKeyFor,
  parseManifest,
  shapeResponse,
  type DesktopVersionDeps,
} from '../desktopVersion.js';

const PREFIX = 'triplemusic';
const WIN_KEY = 'triplemusic/2.3.0/TripleMusic-Windows-x64-Setup.exe';

function fakeReq(userId: number | undefined, headers: Record<string, string> = {}): AuthRequest {
  return { userId, headers } as unknown as AuthRequest;
}

interface FakeRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  res: Response;
}

function fakeRes(): FakeRes {
  const state: FakeRes = { statusCode: 200, body: undefined, headers: {}, res: undefined as unknown as Response };
  const res = {
    status(code: number) { state.statusCode = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    set(name: string, value: string) { state.headers[name] = value; return res; },
  };
  state.res = res as unknown as Response;
  return state;
}

function deps(options: { raw?: Buffer | null; url?: string; db?: DesktopVersionDeps['db'] } = {}) {
  const readCalls: string[] = [];
  const signCalls: Array<[string, number]> = [];
  const d: DesktopVersionDeps = {
    readObject: async (key) => { readCalls.push(key); return options.raw ?? null; },
    signUrl: async (key, ttl) => { signCalls.push([key, ttl]); return options.url ?? 'https://signed.example/x'; },
    db: options.db === undefined ? null : options.db,
  };
  return { d, readCalls, signCalls };
}

const FULL = {
  latest: '2.3.0', exeKey: WIN_KEY, sha256: 'ab'.repeat(32), signature: '', notes: 'แก้บั๊ก',
  mandatory: false, min_supported_version: '2.2.0', size: 31611203, published_at: '2026-09-26T12:00:00+00:00',
  platform: 'win-x64',
};

test('manifestKeyFor: Windows, empty and unknown platforms use the canonical manifest', () => {
  assert.equal(manifestKeyFor(PREFIX, 'win-x64'), 'triplemusic/manifest.json');
  assert.equal(manifestKeyFor(PREFIX, ''), 'triplemusic/manifest.json');
  assert.equal(manifestKeyFor(PREFIX, 'freebsd'), 'triplemusic/manifest.json');
  assert.equal(manifestKeyFor(PREFIX, 'mac-arm64'), 'triplemusic/manifest-mac-arm64.json');
  assert.equal(manifestKeyFor(PREFIX, 'linux-x64'), 'triplemusic/manifest-linux-x64.json');
});

test('parseManifest: null, broken JSON, arrays and objects', () => {
  assert.deepEqual(parseManifest(null), { kind: 'none' });
  assert.deepEqual(parseManifest(Buffer.from('{')), { kind: 'malformed' });
  assert.deepEqual(parseManifest(Buffer.from('[]')), { kind: 'malformed' });
  assert.deepEqual(parseManifest(Buffer.from('"x"')), { kind: 'malformed' });
  assert.deepEqual(parseManifest(Buffer.from(JSON.stringify(FULL))), { kind: 'ok', manifest: FULL });
});

test('artifactKeyOf prefers exeKey, accepts legacy key, rejects blanks', () => {
  assert.equal(artifactKeyOf({ exeKey: 'a', key: 'b' }), 'a');
  assert.equal(artifactKeyOf({ key: 'b' }), 'b');
  assert.equal(artifactKeyOf({ exeKey: '  ' }), null);
  assert.equal(artifactKeyOf({}), null);
});

test('shapeResponse normalises every field', () => {
  assert.deepEqual(shapeResponse(FULL, 'https://u'), {
    latest: '2.3.0', url: 'https://u', sha256: 'ab'.repeat(32), signature: '', notes: 'แก้บั๊ก',
    mandatory: false, min_supported_version: '2.2.0', size: 31611203, published_at: '2026-09-26T12:00:00+00:00',
  });
  assert.deepEqual(shapeResponse({ latest: '', size: Number.NaN, mandatory: 1 as unknown as boolean }, null), {
    latest: null, url: null, sha256: null, signature: null, notes: '', mandatory: true,
    min_supported_version: null, size: null, published_at: null,
  });
});

test('handler: 401 without a user, S3 untouched', async () => {
  const { d, readCalls } = deps();
  const r = fakeRes();
  await desktopVersionHandler({ app: PREFIX }, d)(fakeReq(undefined), r.res);
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.body, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
  assert.deepEqual(readCalls, []);
});

test('handler: no manifest → { latest: null } with no-store and no presign', async () => {
  const { d, readCalls, signCalls } = deps({ raw: null });
  const r = fakeRes();
  await desktopVersionHandler({ app: PREFIX }, d)(fakeReq(7, { 'x-app-platform': 'win-x64' }), r.res);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { latest: null });
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.deepEqual(readCalls, ['triplemusic/manifest.json']);
  assert.deepEqual(signCalls, []);
});

test('handler: malformed manifest → 500 MALFORMED_MANIFEST', async () => {
  const { d } = deps({ raw: Buffer.from('{not json') });
  const r = fakeRes();
  await desktopVersionHandler({ app: PREFIX }, d)(fakeReq(7), r.res);
  assert.equal(r.statusCode, 500);
  assert.deepEqual(r.body, { error: 'Malformed release manifest', code: 'MALFORMED_MANIFEST' });
});

test('handler: full manifest → shaped response with a presigned url (1h)', async () => {
  const { d, signCalls } = deps({ raw: Buffer.from(JSON.stringify(FULL)), url: 'https://s3.example/signed' });
  const r = fakeRes();
  await desktopVersionHandler({ app: PREFIX }, d)(fakeReq(7, { 'x-app-platform': 'win-x64' }), r.res);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, {
    latest: '2.3.0', url: 'https://s3.example/signed', sha256: 'ab'.repeat(32), signature: '', notes: 'แก้บั๊ก',
    mandatory: false, min_supported_version: '2.2.0', size: 31611203, published_at: '2026-09-26T12:00:00+00:00',
  });
  assert.deepEqual(signCalls, [[WIN_KEY, UPDATE_URL_TTL_S]]);
  assert.equal(UPDATE_URL_TTL_S, 3600);
});

test('handler: legacy key alias is presigned; missing key → url null', async () => {
  const legacy = deps({ raw: Buffer.from(JSON.stringify({ latest: '1.0.0', key: 'p/1.0.0/a.exe' })) });
  const r1 = fakeRes();
  await desktopVersionHandler({ app: PREFIX }, legacy.d)(fakeReq(7), r1.res);
  assert.deepEqual(legacy.signCalls, [['p/1.0.0/a.exe', 3600]]);
  assert.equal((r1.body as { url: string }).url, 'https://signed.example/x');

  const none = deps({ raw: Buffer.from(JSON.stringify({ latest: '1.0.0' })) });
  const r2 = fakeRes();
  await desktopVersionHandler({ app: PREFIX }, none.d)(fakeReq(7), r2.res);
  assert.deepEqual(none.signCalls, []);
  assert.equal((r2.body as { url: string | null }).url, null);
});

test('handler: mac client reads its own manifest key; manifestPrefix overrides app', async () => {
  const { d, readCalls } = deps({ raw: null });
  const r = fakeRes();
  await desktopVersionHandler({ app: PREFIX, manifestPrefix: 'tm-beta' }, d)(
    fakeReq(7, { 'x-app-platform': 'mac-arm64' }), r.res,
  );
  assert.deepEqual(readCalls, ['tm-beta/manifest-mac-arm64.json']);
});

test('handler: telemetry upsert is best-effort and keyed by user/app', async () => {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const db = { query: async (text: string, params?: unknown[]) => { calls.push([text, params]); return {}; } };
  const { d } = deps({ raw: null, db });
  const r = fakeRes();
  await desktopVersionHandler({ app: PREFIX }, d)(
    fakeReq(7, { 'x-app-version': '2.3.0', 'x-device-id': 'dev-1', 'x-app-platform': 'win-x64' }), r.res,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /INSERT INTO desktop_app_versions/);
  assert.deepEqual(calls[0][1], [7, 'triplemusic', '2.3.0', 'dev-1', 'win-x64']);
  assert.equal(r.statusCode, 200);

  // no X-App-Version → no telemetry row
  calls.length = 0;
  await desktopVersionHandler({ app: PREFIX }, d)(fakeReq(7), fakeRes().res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);

  // a failing DB never breaks the response
  const failing = deps({ raw: null, db: { query: async () => { throw new Error('db down'); } } });
  const r3 = fakeRes();
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    await desktopVersionHandler({ app: PREFIX }, failing.d)(fakeReq(7, { 'x-app-version': '2.3.0' }), r3.res);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = original;
  }
  assert.equal(r3.statusCode, 200);
  assert.deepEqual(r3.body, { latest: null });
  assert.equal(errors.length, 1);
});

test('handler: readObject failure → 500 without leaking details', async () => {
  const d: DesktopVersionDeps = {
    readObject: async () => { throw new Error('s3 down'); },
    signUrl: async () => 'x',
    db: null,
  };
  const r = fakeRes();
  const original = console.error;
  console.error = () => {};
  try {
    await desktopVersionHandler({ app: PREFIX }, d)(fakeReq(7), r.res);
  } finally {
    console.error = original;
  }
  assert.equal(r.statusCode, 500);
  assert.deepEqual(r.body, { error: 'Internal server error' });
});
