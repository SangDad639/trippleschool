/**
 * Thumbnail resizing via ffmpeg-static (spawned binary — deliberately NOT a
 * native node module like sharp, because the dev machine runs 32-bit node).
 *
 * Admin-uploaded thumbnails arrive as multi-MB PNGs; the storefront needs
 * ~60-150KB. Two variants cover every surface:
 *   card — 640px wide webp (Netflix cards, grids)
 *   hero — 1440px wide webp (billboard, course-detail backdrop)
 * Variants live next to the original in S3 as `{key}.card.webp` / `{key}.hero.webp`.
 * Every failure returns null — callers fall back to the original image.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import ffmpegPath from 'ffmpeg-static';

// ffmpeg-static's postinstall can't fetch a binary for 32-bit node (this dev
// machine) — a manually-downloaded x64 exe lives in server/bin as fallback.
// Prod (Railway linux x64) gets the binary from postinstall normally.
const LOCAL_FFMPEG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/ffmpeg.exe');

function resolveFfmpeg(): string | null {
  if (ffmpegPath && fs.existsSync(ffmpegPath as unknown as string)) return ffmpegPath as unknown as string;
  if (fs.existsSync(LOCAL_FFMPEG)) return LOCAL_FFMPEG;
  return null;
}

export const THUMB_VARIANTS = {
  card: { width: 640, quality: 80 },
  hero: { width: 1440, quality: 82 },
} as const;

export type ThumbVariant = keyof typeof THUMB_VARIANTS;

export function variantKey(originalKey: string, variant: ThumbVariant): string {
  return `${originalKey}.${variant}.webp`;
}

function runFfmpeg(input: Buffer, width: number, quality: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const bin = resolveFfmpeg();
    if (!bin) return resolve(null);
    // Output MUST be a real file, not pipe:1 — the webp muxer needs to seek
    // back and patch the RIFF size header. Piped output leaves size=0, which
    // Chromium's decoder rejects (images arrive but render blank).
    const outPath = path.join(os.tmpdir(), `thumb-${crypto.randomUUID()}.webp`);
    const proc = spawn(bin, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      // -2 keeps aspect ratio with an even height (webp requirement).
      '-vf', `scale='min(${width},iw)':-2`,
      '-frames:v', '1',
      '-c:v', 'libwebp',
      '-quality', String(quality),
      '-y', outPath,
    ]);
    let failed = false;
    const finish = (buf: Buffer | null) => {
      fs.unlink(outPath, () => {});
      resolve(buf);
    };
    proc.on('error', () => { failed = true; finish(null); });
    proc.on('close', (code) => {
      if (failed) return;
      if (code !== 0) return finish(null);
      fs.readFile(outPath, (err, data) => {
        if (err || !data || data.length === 0) return finish(null);
        finish(data);
      });
    });
    const t = setTimeout(() => { failed = true; proc.kill(); finish(null); }, 30000);
    proc.on('close', () => clearTimeout(t));
    proc.stdin.on('error', () => { /* EPIPE when ffmpeg exits early */ });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

export async function makeThumbnailVariant(
  original: Buffer,
  variant: ThumbVariant
): Promise<Buffer | null> {
  const { width, quality } = THUMB_VARIANTS[variant];
  try {
    return await runFfmpeg(original, width, quality);
  } catch {
    return null;
  }
}
