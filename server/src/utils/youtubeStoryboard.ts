/**
 * YouTube "storyboard" = แผ่นภาพเฟรมทุก N วินาที ที่ YouTube ใช้โชว์ตอนเอาเมาส์ชี้แถบเวลา (และภาพเล็กต่อ chapter)
 * InnerTube player (ANDROID client เดียวกับ utils/youtubeCaptions.ts) ส่ง spec มาใน `storyboards.playerStoryboardSpecRenderer.spec`:
 *   `<base ?sqp=…>|w#h#count#cols#rows#intervalMs#name#sigh|…`  (level 0 = default ภาพเดียวทั้งคลิป, level 1-2 = M$M ทีละแผ่น)
 *   URL แผ่น = base.replace('$L', level).replace('$N', name.replace('$M', sheetIndex)) + '&sigh=' + sigh   (ตอบเป็น webp)
 * ไม่ต้องใช้ API key · ทุกฟังก์ชันไม่ throw — คืน null ให้ caller ข้าม (ภาพเป็นของแถม ไม่ใช่ของจำเป็น)
 */
export interface StoryboardLevel {
  index: number;
  width: number;
  height: number;
  /** จำนวนเฟรมทั้งหมดของ level นี้ */
  count: number;
  cols: number;
  rows: number;
  /** ระยะห่างระหว่างเฟรม (ms) · 0 = level "default" (เฟรมกระจายเท่าๆ กันทั้งคลิป) */
  intervalMs: number;
  name: string;
  sigh: string;
}
export interface StoryboardSpec {
  base: string;
  levels: StoryboardLevel[];
  lengthSeconds: number;
}
export interface FrameLocation {
  sheet: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
const TIMEOUT_MS = 20000;

export function parseStoryboardSpec(spec: string, lengthSeconds: number): StoryboardSpec | null {
  const parts = String(spec || '').split('|');
  if (parts.length < 2 || !parts[0].startsWith('http')) return null;
  const levels: StoryboardLevel[] = [];
  parts.slice(1).forEach((p, index) => {
    const f = p.split('#');
    if (f.length < 8) return;
    const [w, h, count, cols, rows, interval, name, sigh] = f;
    const lvl = { index, width: +w, height: +h, count: +count, cols: +cols, rows: +rows, intervalMs: +interval, name, sigh };
    if ([lvl.width, lvl.height, lvl.count, lvl.cols, lvl.rows].every((n) => Number.isFinite(n) && n > 0) && sigh) levels.push(lvl);
  });
  return levels.length ? { base: parts[0], levels, lengthSeconds } : null;
}

/** เลือก level 160px (ภาพเล็กต่อบท) · ไม่มี → ใหญ่สุดที่ ≤ 320 และมี interval · ไม่มีเลย → null */
export function pickThumbLevel(spec: StoryboardSpec): StoryboardLevel | null {
  const timed = spec.levels.filter((l) => l.intervalMs > 0);
  return timed.find((l) => l.width === 160) || [...timed].filter((l) => l.width <= 320).sort((a, b) => b.width - a.width)[0] || null;
}

/** ตำแหน่งเฟรมของวินาทีที่ต้องการ: แผ่นไหน + ตัดตรงไหน (clamp ไม่ให้เกินเฟรมสุดท้าย) */
export function frameLocation(level: StoryboardLevel, sec: number): FrameLocation {
  const perSheet = level.cols * level.rows;
  const raw = level.intervalMs > 0 ? Math.floor((Math.max(0, sec) * 1000) / level.intervalMs) : 0;
  const idx = Math.min(Math.max(0, raw), Math.max(0, level.count - 1));
  const sheet = Math.floor(idx / perSheet);
  const pos = idx % perSheet;
  return { sheet, x: (pos % level.cols) * level.width, y: Math.floor(pos / level.cols) * level.height, width: level.width, height: level.height };
}

export function sheetUrl(spec: StoryboardSpec, level: StoryboardLevel, sheet: number): string {
  return `${spec.base.replace('$L', String(level.index)).replace('$N', level.name.replace('$M', String(sheet)))}&sigh=${encodeURIComponent(level.sigh)}`;
}

export async function fetchStoryboardSpec(youtubeId: string): Promise<StoryboardSpec | null> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'th' } },
        videoId: youtubeId,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      playabilityStatus?: { status?: string };
      storyboards?: { playerStoryboardSpecRenderer?: { spec?: string } };
      videoDetails?: { lengthSeconds?: string | number };
    };
    if (data.playabilityStatus?.status !== 'OK') return null;
    const spec = data.storyboards?.playerStoryboardSpecRenderer?.spec;
    if (!spec) return null;
    return parseStoryboardSpec(spec, Math.max(0, Math.floor(Number(data.videoDetails?.lengthSeconds ?? 0) || 0)));
  } catch {
    return null;
  }
}

/** โหลดแผ่นภาพ (webp) · ล้มเหลว → null */
export async function fetchSheet(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ANDROID_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}
