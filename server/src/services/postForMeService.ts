/**
 * Post For Me API client — Stage 8 of the AI Agent pipeline.
 *
 * Publishes the assembled video + cover to Facebook Reels and/or TikTok in one call.
 * Flow:
 *   1. createUploadUrl(api_key)         → signed PUT URL + media_url
 *   2. PUT file bytes to the signed URL
 *   3. POST /v1/social-posts with media list + platform_configurations
 *
 * Per-user keys are stored in users.postforme_api_key (already in trippleviral schema).
 * AI-disclosure flag (is_ai_generated=true) is set on TikTok per their compliance policy.
 */
import fs from 'fs';

const API_BASE = 'https://api.postforme.dev/v1';
const REQUEST_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 600_000;

export interface PostForMeAccounts {
  facebook?: string;  // Facebook social account ID from Post For Me
  tiktok?: string;    // TikTok social account ID from Post For Me
}

export interface PostForMePublishOpts {
  apiKey: string;
  videoPath: string;             // local path to MP4
  coverPath: string;             // local path to PNG/JPG cover image
  captionFacebook: string;
  captionTiktok: string;
  accounts: PostForMeAccounts;
  scheduledAt?: string | null;   // ISO 8601 with offset; null = post now
}

export interface PostForMeResult {
  post_id?: string;
  status?: string;
  platforms: Record<string, any>;
  raw: any;
}

async function createUploadUrl(apiKey: string): Promise<{ upload_url: string; media_url: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/media/create-upload-url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
  }, REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Post For Me create-upload-url HTTP ${res.status}: ${t.substring(0, 200)}`);
  }
  const j: any = await res.json();
  if (!j.upload_url || !j.media_url) {
    throw new Error(`Post For Me create-upload-url returned no URLs: ${JSON.stringify(j).substring(0, 200)}`);
  }
  return { upload_url: j.upload_url, media_url: j.media_url };
}

async function putFile(uploadUrl: string, filePath: string, contentType: string): Promise<void> {
  const buf = fs.readFileSync(filePath);
  const res = await fetchWithTimeout(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: buf,
  }, UPLOAD_TIMEOUT_MS);
  if (![200, 201, 204].includes(res.status)) {
    const t = await res.text().catch(() => '');
    throw new Error(`Upload ${filePath} HTTP ${res.status}: ${t.substring(0, 200)}`);
  }
}

export async function publishPost(opts: PostForMePublishOpts): Promise<PostForMeResult> {
  if (!opts.apiKey) throw new Error('POSTFORME_API_KEY is required');
  if (!opts.accounts.facebook && !opts.accounts.tiktok) {
    throw new Error('At least one platform account ID is required');
  }
  if (!fs.existsSync(opts.videoPath)) throw new Error(`Video not found: ${opts.videoPath}`);
  if (!fs.existsSync(opts.coverPath)) throw new Error(`Cover not found: ${opts.coverPath}`);

  // 1) Upload video
  const v = await createUploadUrl(opts.apiKey);
  await putFile(v.upload_url, opts.videoPath, 'video/mp4');

  // 2) Upload cover
  const c = await createUploadUrl(opts.apiKey);
  await putFile(c.upload_url, opts.coverPath, 'image/png');

  // 3) Build body
  const accounts: string[] = [];
  if (opts.accounts.facebook) accounts.push(opts.accounts.facebook);
  if (opts.accounts.tiktok) accounts.push(opts.accounts.tiktok);

  const body: any = {
    caption: opts.captionFacebook,
    social_accounts: accounts,
    media: [{ url: v.media_url, thumbnail_url: c.media_url }],
    platform_configurations: {},
  };
  if (opts.scheduledAt) body.scheduled_at = opts.scheduledAt;

  if (opts.accounts.facebook) {
    body.platform_configurations.facebook = {
      placement: 'reels',
      caption: opts.captionFacebook,
    };
  }
  if (opts.accounts.tiktok) {
    body.platform_configurations.tiktok = {
      caption: opts.captionTiktok,
      privacy_status: 'public',
      is_ai_generated: true,         // required disclosure for AI-assisted content
      allow_comment: true,
      allow_duet: true,
      allow_stitch: true,
    };
  }

  // 4) POST
  const res = await fetchWithTimeout(`${API_BASE}/social-posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, REQUEST_TIMEOUT_MS);

  const raw: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Post For Me social-posts HTTP ${res.status}: ${JSON.stringify(raw).substring(0, 400)}`
    );
  }
  return {
    post_id: raw.id || raw.post_id,
    status: raw.status,
    platforms: raw.platforms || raw.platform_results || {},
    raw,
  };
}

// Tiny fetch wrapper with timeout (Node 18+ fetch + AbortController)
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
