/**
 * Dropbox utility for uploading generated videos and creating shared links.
 * Videos are stored at /trippleviral/videos/{userId}/{date}_{itemId}.mp4
 *
 * Auth modes (checked in order):
 * 1. Refresh Token (production): DROPBOX_APP_KEY + DROPBOX_APP_SECRET + DROPBOX_REFRESH_TOKEN
 * 2. Access Token (dev):         DROPBOX_ACCESS_TOKEN
 */

import { Dropbox, DropboxResponseError } from 'dropbox';
import fs from 'fs';

let dbxClient: Dropbox | null = null;

/**
 * Wrap a Dropbox SDK call so its generic "Response failed with a X code" error
 * is rethrown with the actual Dropbox error payload (error_summary / tag).
 * Also invalidates the cached client on 401 so the next call re-inits auth.
 */
async function dbxCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err instanceof DropboxResponseError) {
      const status = err.status;
      const summary = (err.error as any)?.error_summary
        || (err.error as any)?.error?.['.tag']
        || JSON.stringify(err.error)?.substring(0, 200)
        || 'unknown';
      console.error(`[Dropbox:${label}] ${status} — ${summary}`);
      if (status === 401) {
        // Force re-init next call (in case cached client's token is bad)
        dbxClient = null;
      }
      const wrapped = new Error(`Dropbox ${label} failed (${status}): ${summary}`);
      (wrapped as any).status = status;
      (wrapped as any).dropboxError = err.error;
      throw wrapped;
    }
    throw err;
  }
}

function getDropboxClient(): Dropbox {
  if (!dbxClient) {
    const appKey = process.env.DROPBOX_APP_KEY;
    const appSecret = process.env.DROPBOX_APP_SECRET;
    const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
    const accessToken = process.env.DROPBOX_ACCESS_TOKEN;

    if (appKey && appSecret && refreshToken) {
      // Production: auto-refresh access token via refresh token
      dbxClient = new Dropbox({
        clientId: appKey,
        clientSecret: appSecret,
        refreshToken,
      });
    } else if (accessToken) {
      // Dev: short-lived access token (expires ~4h)
      dbxClient = new Dropbox({ accessToken });
    } else {
      throw new Error('Dropbox not configured: set DROPBOX_REFRESH_TOKEN (prod) or DROPBOX_ACCESS_TOKEN (dev)');
    }
  }
  return dbxClient;
}

/**
 * Check if Dropbox is configured (any auth method).
 */
export function isDropboxConfigured(): boolean {
  return !!(
    (process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN) ||
    process.env.DROPBOX_ACCESS_TOKEN
  );
}

/**
 * Download video from URL and upload to Dropbox.
 * Returns a direct download link (dl=1).
 */
export async function uploadVideoToDropbox(
  videoUrl: string,
  userId: number,
  itemId: number,
  customPath?: string
): Promise<{ dropboxPath: string; sharedUrl: string }> {
  const dbx = getDropboxClient();

  // Download video from provider URL
  const response = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  // Build path: custom or default /trippleviral/videos/{userId}/{date}_{itemId}.mp4
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dropboxPath = customPath || `/trippleviral/videos/${userId}/${date}_${itemId}.mp4`;

  // Upload to Dropbox (files up to 150MB via simple upload)
  await dbxCall('filesUpload', () => dbx.filesUpload({
    path: dropboxPath,
    contents: buffer,
    mode: { '.tag': 'overwrite' },
  }));

  // Create shared link
  let sharedUrl: string;
  try {
    const linkResult = await dbxCall('createSharedLink', () => dbx.sharingCreateSharedLinkWithSettings({
      path: dropboxPath,
      settings: {
        requested_visibility: { '.tag': 'public' },
        audience: { '.tag': 'public' },
        access: { '.tag': 'viewer' },
      },
    }));
    sharedUrl = linkResult.result.url;
  } catch (err: any) {
    // If link already exists, get existing one
    const summary = (err as any)?.dropboxError?.error_summary || '';
    if (summary.startsWith('shared_link_already_exists')) {
      const existing = await dbxCall('listSharedLinks', () => dbx.sharingListSharedLinks({ path: dropboxPath, direct_only: true }));
      sharedUrl = existing.result.links[0]?.url || '';
    } else {
      throw err;
    }
  }

  // Convert to direct download link: ?dl=0 → ?dl=1
  sharedUrl = sharedUrl.replace(/\?dl=0$/, '?dl=1').replace(/&dl=0/, '&dl=1');
  if (!sharedUrl.includes('dl=1')) {
    sharedUrl += (sharedUrl.includes('?') ? '&' : '?') + 'dl=1';
  }

  return { dropboxPath, sharedUrl };
}

/**
 * Upload an image (downloaded from URL) to Dropbox and return a direct download link.
 * Mirrors uploadVideoToDropbox but for images.
 */
export async function uploadImageToDropbox(
  imageUrl: string,
  userId: number,
  taskId: number | string,
  ext: string = 'png',
  customPath?: string
): Promise<{ dropboxPath: string; sharedUrl: string }> {
  const dbx = getDropboxClient();

  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const date = new Date().toISOString().slice(0, 10);
  const dropboxPath = customPath || `/trippleviral/gpt-image-2/${userId}/${date}_${taskId}.${ext}`;

  await dbxCall('filesUpload', () => dbx.filesUpload({
    path: dropboxPath,
    contents: buffer,
    mode: { '.tag': 'overwrite' },
  }));

  let sharedUrl: string;
  try {
    const linkResult = await dbxCall('createSharedLink', () => dbx.sharingCreateSharedLinkWithSettings({
      path: dropboxPath,
      settings: {
        requested_visibility: { '.tag': 'public' },
        audience: { '.tag': 'public' },
        access: { '.tag': 'viewer' },
      },
    }));
    sharedUrl = linkResult.result.url;
  } catch (err: any) {
    const summary = (err as any)?.dropboxError?.error_summary || '';
    if (summary.startsWith('shared_link_already_exists')) {
      const existing = await dbxCall('listSharedLinks', () => dbx.sharingListSharedLinks({ path: dropboxPath, direct_only: true }));
      sharedUrl = existing.result.links[0]?.url || '';
    } else {
      throw err;
    }
  }

  sharedUrl = sharedUrl.replace(/\?dl=0$/, '?dl=1').replace(/&dl=0/, '&dl=1');
  if (!sharedUrl.includes('dl=1')) {
    sharedUrl += (sharedUrl.includes('?') ? '&' : '?') + 'dl=1';
  }

  return { dropboxPath, sharedUrl };
}

/**
 * Upload an in-memory buffer (e.g. from multer.memoryStorage) to Dropbox
 * and return a direct download link. Used by admin endpoints that accept
 * uploaded files via multipart form data.
 */
export async function uploadBufferToDropbox(
  buffer: Buffer,
  dropboxPath: string
): Promise<{ dropboxPath: string; sharedUrl: string }> {
  const dbx = getDropboxClient();
  await dbxCall('filesUpload', () => dbx.filesUpload({
    path: dropboxPath,
    contents: buffer,
    mode: { '.tag': 'overwrite' },
  }));
  let sharedUrl: string;
  try {
    const linkResult = await dbxCall('createSharedLink', () => dbx.sharingCreateSharedLinkWithSettings({
      path: dropboxPath,
      settings: {
        requested_visibility: { '.tag': 'public' },
        audience: { '.tag': 'public' },
        access: { '.tag': 'viewer' },
      },
    }));
    sharedUrl = linkResult.result.url;
  } catch (err: any) {
    const summary = (err as any)?.dropboxError?.error_summary || '';
    if (summary.startsWith('shared_link_already_exists')) {
      const existing = await dbxCall('listSharedLinks', () => dbx.sharingListSharedLinks({ path: dropboxPath, direct_only: true }));
      sharedUrl = existing.result.links[0]?.url || '';
    } else {
      throw err;
    }
  }
  // ?raw=1 → inline-streamable URL so <img>/<video> can render it directly (?dl=1 forces download).
  sharedUrl = sharedUrl.replace(/\?dl=0$/, '?raw=1').replace(/&dl=0/, '&raw=1');
  if (!sharedUrl.includes('raw=1')) {
    sharedUrl += (sharedUrl.includes('?') ? '&' : '?') + 'raw=1';
  }
  return { dropboxPath, sharedUrl };
}

/**
 * Upload a local file to Dropbox and return a direct download link.
 * Used by viral-pipeline for concatenated videos.
 */
export async function uploadLocalFileToDropbox(
  localFilePath: string,
  dropboxPath: string
): Promise<{ dropboxPath: string; sharedUrl: string }> {
  const dbx = getDropboxClient();

  const buffer = fs.readFileSync(localFilePath);
  console.log(`[Dropbox] Uploading local file to ${dropboxPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)...`);

  await dbxCall('filesUpload', () => dbx.filesUpload({
    path: dropboxPath,
    contents: buffer,
    mode: { '.tag': 'overwrite' },
  }));
  console.log(`[Dropbox] Upload done`);

  // Create shared link
  let sharedUrl: string;
  try {
    const linkResult = await dbxCall('createSharedLink', () => dbx.sharingCreateSharedLinkWithSettings({
      path: dropboxPath,
      settings: {
        requested_visibility: { '.tag': 'public' },
        audience: { '.tag': 'public' },
        access: { '.tag': 'viewer' },
      },
    }));
    sharedUrl = linkResult.result.url;
  } catch (err: any) {
    const summary = (err as any)?.dropboxError?.error_summary || '';
    if (summary.startsWith('shared_link_already_exists')) {
      const existing = await dbxCall('listSharedLinks', () => dbx.sharingListSharedLinks({ path: dropboxPath, direct_only: true }));
      sharedUrl = existing.result.links[0]?.url || '';
    } else {
      throw err;
    }
  }
  console.log(`[Dropbox] Step 3 done: ${sharedUrl.substring(0, 60)}...`);

  sharedUrl = sharedUrl.replace(/\?dl=0$/, '?dl=1').replace(/&dl=0/, '&dl=1');
  if (!sharedUrl.includes('dl=1')) {
    sharedUrl += (sharedUrl.includes('?') ? '&' : '?') + 'dl=1';
  }

  return { dropboxPath, sharedUrl };
}

/**
 * Delete a video from Dropbox by its path.
 */
export async function deleteVideoFromDropbox(dropboxPath: string): Promise<void> {
  const dbx = getDropboxClient();
  try {
    await dbxCall('filesDelete', () => dbx.filesDeleteV2({ path: dropboxPath }));
  } catch (err: any) {
    // Ignore "not found" errors
    const summary = (err as any)?.dropboxError?.error_summary || '';
    if (!summary.startsWith('path_lookup')) {
      throw err;
    }
  }
}

/**
 * Get existing shared link for a Dropbox path, or create a new one.
 * Returns direct-download URL (dl=1).
 */
export async function getSharedLinkFromPath(dropboxPath: string): Promise<string> {
  const dbx = getDropboxClient();
  let sharedUrl: string;
  try {
    // Try to list existing shared links first (cheaper than create)
    const existing = await dbxCall('listSharedLinks', () => dbx.sharingListSharedLinks({ path: dropboxPath, direct_only: true }));
    if (existing.result.links.length > 0) {
      sharedUrl = existing.result.links[0].url;
    } else {
      // Create new shared link
      const created = await dbxCall('createSharedLink', () => dbx.sharingCreateSharedLinkWithSettings({
        path: dropboxPath,
        settings: {
          requested_visibility: { '.tag': 'public' },
          audience: { '.tag': 'public' },
          access: { '.tag': 'viewer' },
        },
      }));
      sharedUrl = created.result.url;
    }
  } catch (err: any) {
    const summary = (err as any)?.dropboxError?.error_summary || '';
    if (summary.startsWith('shared_link_already_exists')) {
      const existing = await dbxCall('listSharedLinks', () => dbx.sharingListSharedLinks({ path: dropboxPath, direct_only: true }));
      sharedUrl = existing.result.links[0]?.url || '';
      if (!sharedUrl) throw new Error('Failed to get existing shared link');
    } else {
      throw err;
    }
  }

  // Force dl=1 for direct download
  sharedUrl = sharedUrl.replace(/\?dl=0$/, '?dl=1').replace(/&dl=0/, '&dl=1');
  if (!sharedUrl.includes('dl=1')) {
    sharedUrl += (sharedUrl.includes('?') ? '&' : '?') + 'dl=1';
  }
  return sharedUrl;
}
