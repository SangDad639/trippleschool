/**
 * Apply watermark to a video file using FFmpeg.
 * Supports text, image, or both types of watermarks.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Thai-supporting font (bundled) — ffmpeg default font ไม่รองรับ glyph ไทย ต้องชี้ fontfile เอง
// dist/ (compiled) → ../../assets/fonts | src/ (tsx) → ../../assets/fonts
const FONT_PATH = path.resolve(__dirname, '../../assets/fonts/NotoSansThai-Regular.ttf');

// ffmpeg drawtext fontfile: ต้องใช้ '/' และ escape ':' บน Windows (e.g. "C\:/path")
function escapeFFmpegFontPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// ใช้ system ffmpeg ก่อน (Railway ติดตั้งผ่าน nixpacks) → fallback ไป ffmpeg-static
function getFFmpegPath(): string {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return 'ffmpeg'; // system ffmpeg ใช้ได้
  } catch {
    try {
      // @ts-ignore - ffmpeg-static types don't match ESM default export
      const mod = require('ffmpeg-static');
      if (typeof mod === 'string') return mod;
    } catch {}
    return 'ffmpeg'; // fallback
  }
}
const ffmpegPath = getFFmpegPath();

export interface WatermarkSettings {
  enabled: boolean;
  type: 'text' | 'image' | 'both';
  text?: string;
  imageUrl?: string; // Dropbox shared URL (download on-the-fly)
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number; // 0-100
  imageSize: 'small' | 'medium' | 'large';
  circular?: boolean;
}

const IMAGE_SIZE_PX = { small: 64, medium: 120, large: 200 };

// Image-only หรือ Text-only positions (เมื่อมีแค่ตัวใดตัวหนึ่ง)
function getImageOverlayPosition(pos: string): string {
  switch (pos) {
    case 'top-left': return '20:20';
    case 'top-right': return 'W-w-20:20';
    case 'bottom-left': return '20:H-h-20';
    case 'bottom-right':
    default: return 'W-w-20:H-h-20';
  }
}

function getTextDrawPosition(pos: string): string {
  switch (pos) {
    case 'top-left': return 'x=20:y=30';
    case 'top-right': return 'x=w-text_w-20:y=30';
    case 'bottom-left': return 'x=20:y=h-30';
    case 'bottom-right':
    default: return 'x=w-text_w-20:y=h-30';
  }
}

// เมื่อมีทั้ง image + text (type='both') ให้ stack แบบ preview: image บน, text ล่าง (+ gap)
// Top positions: image ที่มุม, text ใต้ image
// Bottom positions: text ที่มุมล่าง, image เหนือ text
function getBothPositions(pos: string, sizePx: number) {
  const pad = 20;
  const gap = 8;
  switch (pos) {
    case 'top-left':
      return {
        image: `${pad}:${pad}`,
        text: `x=${pad}:y=${pad + sizePx + gap}`,
      };
    case 'top-right':
      return {
        image: `W-w-${pad}:${pad}`,
        text: `x=w-text_w-${pad}:y=${pad + sizePx + gap}`,
      };
    case 'bottom-left':
      return {
        image: `${pad}:H-h-${pad}-text_h-${gap}`,
        text: `x=${pad}:y=h-text_h-${pad}`,
      };
    case 'bottom-right':
    default:
      return {
        image: `W-w-${pad}:H-h-${pad}-text_h-${gap}`,
        text: `x=w-text_w-${pad}:y=h-text_h-${pad}`,
      };
  }
}

function escapeFFmpegText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

/**
 * Apply watermark to input video → write to output path.
 * Throws on FFmpeg failure.
 */
export async function applyWatermark(
  inputVideoPath: string,
  outputVideoPath: string,
  settings: WatermarkSettings,
  workDir?: string
): Promise<void> {
  if (!settings.enabled) {
    // Just copy (no watermark)
    fs.copyFileSync(inputVideoPath, outputVideoPath);
    return;
  }

  const opacity = Math.max(0, Math.min(100, settings.opacity)) / 100;
  const sizePx = IMAGE_SIZE_PX[settings.imageSize] || 120;
  const ff = ffmpegPath;
  // On Windows, wrapping `"ffmpeg"` conflicts with `cmd /c` outer quoting → quote only when path has spaces
  const ffQuoted = /\s/.test(ff) ? `"${ff}"` : ff;
  const input = inputVideoPath.replace(/\\/g, '/');
  const output = outputVideoPath.replace(/\\/g, '/');

  const hasImage = settings.type !== 'text' && !!settings.imageUrl;
  const hasText = settings.type !== 'image' && !!settings.text && settings.text.trim().length > 0;

  // Download watermark image if needed
  let wmImagePath: string | null = null;
  const tmpDir = workDir || path.join(os.tmpdir(), `wm-${Date.now()}`);
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  if (hasImage) {
    try {
      const resp = await fetch(settings.imageUrl!, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) throw new Error(`Watermark image fetch failed: ${resp.status}`);
      const ext = settings.imageUrl!.toLowerCase().includes('.png') ? 'png' : 'jpg';
      wmImagePath = path.join(tmpDir, `watermark.${ext}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(wmImagePath, buffer);
    } catch (err: any) {
      console.error('[Watermark] Failed to download image:', err.message);
      wmImagePath = null;
    }
  }

  // ถ้ามีทั้ง image + text ให้ stack ตามที่ preview แสดง (image บน, text ล่าง)
  // ถ้ามีแค่อย่างเดียว ใช้ตำแหน่งมุมปกติ
  const hasBoth = hasImage && hasText;
  const bothPos = hasBoth ? getBothPositions(settings.position, sizePx) : null;
  const overlayPos = bothPos ? bothPos.image : getImageOverlayPosition(settings.position);
  const textPos = bothPos ? bothPos.text : getTextDrawPosition(settings.position);
  const textEscaped = hasText ? escapeFFmpegText(settings.text!) : '';

  // Build FFmpeg command
  const commonEncode = `-c:v libx264 -preset fast -crf 23 -c:a copy -movflags +faststart -y`;

  let cmd: string;

  // Circular: สร้าง PGM circle mask file (ไม่ต้องพึ่ง geq filter — ทำงานทุก ffmpeg build)
  let circleMaskPath: string | null = null;
  if (settings.circular && wmImagePath) {
    const cx = sizePx / 2, cy = sizePx / 2, r = sizePx / 2;
    const header = `P5\n${sizePx} ${sizePx}\n255\n`;
    const pixels = Buffer.alloc(sizePx * sizePx);
    for (let y = 0; y < sizePx; y++) {
      for (let x = 0; x < sizePx; x++) {
        const dx = x - cx, dy = y - cy;
        pixels[y * sizePx + x] = (dx * dx + dy * dy <= r * r) ? 255 : 0;
      }
    }
    circleMaskPath = path.join(tmpDir, 'circle_mask.pgm').replace(/\\/g, '/');
    fs.writeFileSync(circleMaskPath, Buffer.concat([Buffer.from(header), pixels]));
  }

  if (wmImagePath) {
    const wm = wmImagePath.replace(/\\/g, '/');
    let logoFilter: string;
    let inputs: string;

    if (circleMaskPath) {
      // Circular: scale logo → alphamerge กับ circle mask → ได้ logo วงกลม
      logoFilter = `[1:v]scale=${sizePx}:${sizePx}:force_original_aspect_ratio=decrease,pad=${sizePx}:${sizePx}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba[logo_raw];[2:v]scale=${sizePx}:${sizePx},format=gray[mask];[logo_raw][mask]alphamerge,colorchannelmixer=aa=${opacity}[logo]`;
      inputs = `${ffQuoted} -i "${input}" -i "${wm}" -i "${circleMaskPath}"`;
    } else {
      // Square: scale logo ปกติ
      logoFilter = `[1:v]scale=${sizePx}:${sizePx}:force_original_aspect_ratio=decrease,pad=${sizePx}:${sizePx}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,colorchannelmixer=aa=${opacity}[logo]`;
      inputs = `${ffQuoted} -i "${input}" -i "${wm}"`;
    }

    if (hasText) {
      const fontArg = fs.existsSync(FONT_PATH) ? `fontfile='${escapeFFmpegFontPath(FONT_PATH)}':` : '';
      const filter = `${logoFilter};[0:v][logo]overlay=${overlayPos}[tmp];[tmp]drawtext=${fontArg}text='${textEscaped}':fontsize=28:fontcolor=white@${opacity}:${textPos}[v]`;
      cmd = `${inputs} -filter_complex "${filter}" -map "[v]" -map 0:a? ${commonEncode} "${output}"`;
    } else {
      const filter = `${logoFilter};[0:v][logo]overlay=${overlayPos}[v]`;
      cmd = `${inputs} -filter_complex "${filter}" -map "[v]" -map 0:a? ${commonEncode} "${output}"`;
    }
  } else if (hasText) {
    // Text only
    const fontArg = fs.existsSync(FONT_PATH) ? `fontfile='${escapeFFmpegFontPath(FONT_PATH)}':` : '';
    const filter = `drawtext=${fontArg}text='${textEscaped}':fontsize=28:fontcolor=white@${opacity}:${textPos}`;
    cmd = `${ffQuoted} -i "${input}" -vf "${filter}" ${commonEncode} "${output}"`;
  } else {
    // Nothing to apply — just copy
    fs.copyFileSync(inputVideoPath, outputVideoPath);
    return;
  }

  console.log('[Watermark] Applying:', settings.type, settings.position, `${settings.opacity}%`, settings.circular ? '(circular)' : '');
  try {
    execSync(cmd, { timeout: 300_000, stdio: ['ignore', 'ignore', 'pipe'] });
    console.log('[Watermark] ✅ Done');
  } catch (err: any) {
    console.error('[Watermark] FFmpeg failed:', err.message);
    throw new Error(`Watermark apply failed: ${err.message}`);
  } finally {
    // Clean up downloaded watermark image
    if (wmImagePath && !workDir) {
      try { fs.unlinkSync(wmImagePath); } catch {}
    }
  }
}
