import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';

// Desktop auto-update feed — ใช้ร่วมกันได้ทุกโปรแกรม desktop (ตอนนี้: Triple Music)
// ผู้จัดทำแอปอัปโหลด artifact + manifest ขึ้น S3 ใต้ prefix ของโปรแกรม (yue-lab/scripts/publish_release.py)
// แอปบนเครื่องผู้ใช้เรียก GET /api/<app>/version → handler นี้อ่าน manifest ตาม platform
// แล้ว presign key ของ artifact ให้ (ไฟล์วิ่งตรงจาก S3 ไม่ผ่าน backend)
//
// ไฟล์นี้ตั้งใจให้ "ไม่มี side effect ตอน import" (ไม่ import db/s3/auth จริง — รับผ่าน deps)
// เพื่อให้ unit test รันแบบ offline ได้ · คู่มือผู้จัดทำ: yue-lab/docs/auto-update.md
//
// รูปแบบ <prefix>/manifest.json ที่ publish script เขียน:
//   { "latest": "2.4.0", "exeKey": "triplemusic/2.4.0/TripleMusic-Windows-x64-Setup.exe",
//     "sha256": "<hex>", "signature": "", "notes": "...", "mandatory": false,
//     "min_supported_version": null, "size": 31611203, "published_at": "...", "platform": "win-x64" }
// `key` ยอมรับเป็น alias ของ `exeKey`

/** presigned URL ของ artifact มีอายุ 1 ชม. (แอปดาวน์โหลดทันทีหลังเช็ค) */
export const UPDATE_URL_TTL_S = 60 * 60;

// Windows / ไม่ส่ง header → manifest.json ตัวหลัก; platform อื่นอ่านไฟล์พี่น้อง manifest-<platform>.json
// platform ที่ยังไม่มี manifest → readObject คืน null → { latest: null } (ไม่ส่ง exe ให้เครื่อง mac)
const DESKTOP_PLATFORMS = new Set(['win-x64', 'mac-arm64', 'mac-x64', 'linux-x64']);

export function manifestKeyFor(prefix: string, platform: string): string {
  if (!platform || !DESKTOP_PLATFORMS.has(platform) || platform.startsWith('win')) {
    return `${prefix}/manifest.json`;
  }
  return `${prefix}/manifest-${platform}.json`;
}

export interface ReleaseManifest {
  latest?: string | null;
  exeKey?: string;
  key?: string;
  sha256?: string;
  signature?: string;
  notes?: string;
  mandatory?: boolean;
  min_supported_version?: string | null;
  size?: number | null;
  published_at?: string;
  platform?: string;
}

export interface DesktopVersionResponse {
  latest: string | null;
  url: string | null;
  sha256: string | null;
  signature: string | null;
  notes: string;
  mandatory: boolean;
  min_supported_version: string | null;
  size: number | null;
  published_at: string | null;
}

export type ParsedManifest =
  | { kind: 'none' }
  | { kind: 'malformed' }
  | { kind: 'ok'; manifest: ReleaseManifest };

export function parseManifest(raw: Buffer | null): ParsedManifest {
  if (!raw) return { kind: 'none' };
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf-8'));
  } catch {
    return { kind: 'malformed' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'malformed' };
  return { kind: 'ok', manifest: value as ReleaseManifest };
}

export function artifactKeyOf(manifest: ReleaseManifest): string | null {
  const key = manifest.exeKey || manifest.key;
  return typeof key === 'string' && key.trim() ? key : null;
}

export function shapeResponse(manifest: ReleaseManifest, url: string | null): DesktopVersionResponse {
  return {
    latest: typeof manifest.latest === 'string' && manifest.latest ? manifest.latest : null,
    url,
    sha256: typeof manifest.sha256 === 'string' ? manifest.sha256 : null,
    signature: typeof manifest.signature === 'string' ? manifest.signature : null,
    notes: typeof manifest.notes === 'string' ? manifest.notes : '',
    mandatory: !!manifest.mandatory,
    min_supported_version:
      typeof manifest.min_supported_version === 'string' && manifest.min_supported_version
        ? manifest.min_supported_version
        : null,
    size: typeof manifest.size === 'number' && Number.isFinite(manifest.size) ? manifest.size : null,
    published_at: typeof manifest.published_at === 'string' ? manifest.published_at : null,
  };
}

export interface DesktopVersionDeps {
  /** อ่าน object ทั้งก้อน (prod: utils/s3 getObjectBuffer) — null = key ไม่มี */
  readObject: (key: string) => Promise<Buffer | null>;
  /** presigned GET URL (prod: utils/s3 getSignedFileUrl) */
  signUrl: (key: string, expiresInS: number) => Promise<string>;
  /** pg pool สำหรับ telemetry — null = ปิด telemetry */
  db: { query: (text: string, params?: unknown[]) => Promise<unknown> } | null;
}

export interface DesktopVersionOptions {
  /** app_key ของโปรแกรม เช่น 'triplemusic' (ใช้เป็น tag ของแถว telemetry ด้วย) */
  app: string;
  /** S3 prefix ของ channel ปล่อยรุ่น — ค่าเริ่มต้นเท่ากับ app */
  manifestPrefix?: string;
}

export const TELEMETRY_UPSERT_SQL = `
  INSERT INTO desktop_app_versions (user_id, app_key, version, device_id, platform, updated_at)
  VALUES ($1, $2, $3, $4, $5, NOW())
  ON CONFLICT (user_id, app_key) DO UPDATE
    SET version = EXCLUDED.version,
        device_id = EXCLUDED.device_id,
        platform = EXCLUDED.platform,
        updated_at = NOW()`;

// บันทึกว่าบัญชีไหนใช้รุ่นไหน (best-effort) — ห้ามให้ telemetry ทำให้ตอบ manifest ช้าหรือล้ม
async function recordVersion(
  db: NonNullable<DesktopVersionDeps['db']>,
  userId: number,
  app: string,
  version: string,
  deviceId: string,
  platform: string,
): Promise<void> {
  try {
    await db.query(TELEMETRY_UPSERT_SQL, [userId, app, version, deviceId || null, platform || null]);
  } catch (error) {
    console.error(`Desktop version log error (${app}):`, error);
  }
}

function header(req: AuthRequest, name: string, max: number): string {
  const value = req.headers[name];
  const text = Array.isArray(value) ? value[0] : value;
  return String(text || '').slice(0, max);
}

/**
 * GET /api/<app>/version — รุ่นล่าสุดของโปรแกรม desktop หนึ่งตัว
 * ต้อง mount หลัง authenticate + requireSubscription (ไฟล์เป็นของสมาชิกเท่านั้น)
 * คืน { latest: null } เมื่อยังไม่มีรุ่นสำหรับ platform นั้น — แอปถือว่า "ล่าสุดแล้ว" ไม่ใช่ error
 */
export function desktopVersionHandler(options: DesktopVersionOptions, deps: DesktopVersionDeps) {
  const app = options.app;
  const prefix = options.manifestPrefix ?? options.app;

  return async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
        return;
      }
      const platform = header(req, 'x-app-platform', 32);
      const appVersion = header(req, 'x-app-version', 32);
      const deviceId = header(req, 'x-device-id', 64);
      if (deps.db && appVersion) {
        void recordVersion(deps.db, req.userId, app, appVersion, deviceId, platform);
      }

      const manifestKey = manifestKeyFor(prefix, platform);
      const parsed = parseManifest(await deps.readObject(manifestKey));
      // presigned URL ไม่มี bearer — ห้ามให้ cache ระหว่างทางเก็บไว้
      res.set('Cache-Control', 'no-store');
      if (parsed.kind === 'none') {
        res.json({ latest: null });
        return;
      }
      if (parsed.kind === 'malformed') {
        console.error(`Desktop version: malformed ${manifestKey} in S3`);
        res.status(500).json({ error: 'Malformed release manifest', code: 'MALFORMED_MANIFEST' });
        return;
      }
      const key = artifactKeyOf(parsed.manifest);
      const url = key ? await deps.signUrl(key, UPDATE_URL_TTL_S) : null;
      res.json(shapeResponse(parsed.manifest, url));
    } catch (error) {
      console.error(`Desktop version error (${app}):`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
