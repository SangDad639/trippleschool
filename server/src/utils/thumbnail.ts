/**
 * Extract a thumbnail frame from a video URL using FFmpeg,
 * then upload to Dropbox and return a permanent shared link.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { uploadLocalFileToDropbox } from './dropbox.js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
let ffmpegPath: string = 'ffmpeg';
try {
  // @ts-ignore - ffmpeg-static types don't match ESM default export
  const mod = await import('ffmpeg-static');
  const resolved = String(mod.default || mod);
  if (resolved && resolved !== '[object Object]') ffmpegPath = resolved;
} catch {}

/**
 * Download video → FFmpeg extract frame at 0.5s → upload jpg to Dropbox → return shared URL
 */
export async function generateThumbnail(
  videoUrl: string,
  userId: number,
  itemId: number
): Promise<string | null> {
  const tmpDir = path.join(os.tmpdir(), `thumb-${itemId}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Download video
    const videoPath = path.join(tmpDir, 'input.mp4');
    const response = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(videoPath, buffer);

    // Extract frame at 0.5s
    const thumbPath = path.join(tmpDir, 'thumb.jpg');
    const ff = ffmpegPath || 'ffmpeg';
    const input = videoPath.replace(/\\/g, '/');
    const output = thumbPath.replace(/\\/g, '/');
    execSync(`"${ff}" -i "${input}" -ss 0.5 -frames:v 1 -q:v 2 -y "${output}"`, { timeout: 30000 });

    if (!fs.existsSync(thumbPath)) throw new Error('FFmpeg failed to extract frame');

    // Upload to Dropbox
    const date = new Date().toISOString().slice(0, 10);
    const dropboxPath = `/trippleviral/thumbnails/${userId}/${date}_${itemId}.jpg`;
    const { sharedUrl } = await uploadLocalFileToDropbox(thumbPath, dropboxPath);

    console.log(`[Thumbnail] ✅ Generated for item ${itemId}`);
    return sharedUrl;
  } catch (err: any) {
    console.error(`[Thumbnail] Failed for item ${itemId}:`, err.message);
    return null;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
