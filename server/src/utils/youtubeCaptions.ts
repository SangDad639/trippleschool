/**
 * Fetch YouTube auto-generated captions (no API key, no extra deps).
 *
 * The plain watch-page + timedtext route now returns empty 200s to non-browser
 * clients (proof-of-origin tokens), so we use the InnerTube player API with an
 * ANDROID client instead — its caption baseUrls are fetchable directly. The
 * response is srv XML (`<p t><s>…</s></p>` word segments in practice), not
 * json3, regardless of the fmt param.
 *
 * Nothing here throws — a broken video must never kill a whole course sync.
 * But failures are NOT interchangeable: "this video has no captions" and "we
 * got throttled" need different words in the admin UI, so every path returns a
 * reason instead of a bare null (which used to make every failure read as
 * "ไม่พบซับอัตโนมัติ" and sent us hunting for the wrong bug).
 */

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // 'asr' = auto-generated
}

export type CaptionFailReason =
  | 'no_captions' // video has no caption tracks at all
  | 'unavailable' // private / removed / geo-blocked (playabilityStatus ≠ OK)
  | 'blocked' // YouTube refused us: 429 / 403 (rate limit or bot check)
  | 'http_error' // any other non-2xx
  | 'timeout' // request aborted
  | 'empty'; // track existed but parsed to nothing

export interface CaptionFetchOk {
  ok: true;
  language: string;
  /** true when the track is YouTube's own speech recognition */
  auto: boolean;
  text: string;
}
export interface CaptionFetchFail {
  ok: false;
  reason: CaptionFailReason;
  /** extra context for logs/UI: YouTube's reason text or the HTTP status */
  detail?: string;
}
export type CaptionFetchResult = CaptionFetchOk | CaptionFetchFail;

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
const TIMEOUT_MS = 20000;
/** reasons worth one more attempt — the video itself is probably fine */
const RETRYABLE: CaptionFailReason[] = ['blocked', 'timeout', 'http_error'];

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  return (
    tracks.find((t) => t.languageCode === 'th' && t.kind === 'asr') ||
    tracks.find((t) => t.languageCode === 'th') ||
    tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr') ||
    tracks.find((t) => t.languageCode === 'en') ||
    tracks[0] ||
    null
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * srv XML → plain text. Handles both shapes YouTube serves:
 * srv3: <p t="…"><s>คำ</s><s>คำ</s></p>  (word-level segments)
 * srv1: <text start="…">ประโยค</text>
 */
function xmlToPlainText(xml: string): string {
  const parts: string[] = [];
  const re = /<(p|text)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const t = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    if (t) parts.push(t);
  }
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

function httpFail(status: number): CaptionFetchFail {
  const reason: CaptionFailReason = status === 429 || status === 403 ? 'blocked' : 'http_error';
  return { ok: false, reason, detail: `HTTP ${status}` };
}

async function attempt(youtubeId: string): Promise<CaptionFetchResult> {
  try {
    const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA },
      body: JSON.stringify({
        context: {
          client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'th' },
        },
        videoId: youtubeId,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!playerRes.ok) return httpFail(playerRes.status);
    const data = (await playerRes.json()) as {
      playabilityStatus?: { status?: string; reason?: string };
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
    };
    if (data.playabilityStatus?.status !== 'OK') {
      return {
        ok: false,
        reason: 'unavailable',
        detail: [data.playabilityStatus?.status, data.playabilityStatus?.reason].filter(Boolean).join(': '),
      };
    }
    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    // No track list = YouTube has not produced captions for this video (yet).
    // Fresh uploads land here until speech recognition finishes.
    if (!Array.isArray(tracks) || tracks.length === 0) return { ok: false, reason: 'no_captions' };

    const track = pickTrack(tracks);
    if (!track?.baseUrl) return { ok: false, reason: 'no_captions' };

    const capRes = await fetch(track.baseUrl, {
      headers: { 'User-Agent': ANDROID_UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!capRes.ok) return httpFail(capRes.status);
    const body = await capRes.text();
    if (!body) return { ok: false, reason: 'empty' };

    const text = xmlToPlainText(body);
    if (!text) return { ok: false, reason: 'empty' };

    return { ok: true, language: track.languageCode, auto: track.kind === 'asr', text };
  } catch (error) {
    const name = (error as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'http_error', detail: String(error).slice(0, 120) };
  }
}

/** Thai wording for the admin UI — one message per failure reason. */
export function captionFailMessage(reason: CaptionFailReason, detail?: string): string {
  switch (reason) {
    case 'no_captions':
      return 'YouTube ยังไม่มีซับอัตโนมัติของคลิปนี้ (คลิปที่เพิ่งอัปต้องรอระบบสร้างซับ ~นาที–ชั่วโมง) — ลองกดใหม่ภายหลัง หรืออัปโหลดไฟล์ซับเอง';
    case 'unavailable':
      return `เปิดคลิปนี้ไม่ได้ (อาจเป็นคลิปส่วนตัว/ถูกลบ/จำกัดพื้นที่)${detail ? ` — ${detail}` : ''}`;
    case 'blocked':
      return 'YouTube ปฏิเสธคำขอชั่วคราว (ดึงถี่เกินไป) — รอสักครู่แล้วลองใหม่';
    case 'http_error':
      return `ติดต่อ YouTube ไม่สำเร็จ${detail ? ` (${detail})` : ''} — ลองใหม่อีกครั้ง`;
    case 'timeout':
      return 'ดึงซับนานเกินกำหนด (timeout) — ลองใหม่อีกครั้ง';
    case 'empty':
      return 'YouTube ส่งซับกลับมาว่างเปล่า — ลองใหม่ภายหลัง หรืออัปโหลดไฟล์ซับเอง';
  }
}

/**
 * Fetch the best caption track for a video. Retries once for reasons that look
 * like our side of the wire (throttling/timeouts) rather than the video's.
 */
export async function fetchAutoCaptions(youtubeId: string): Promise<CaptionFetchResult> {
  const first = await attempt(youtubeId);
  if (first.ok || !RETRYABLE.includes(first.reason)) return first;
  await new Promise((r) => setTimeout(r, 1500));
  return attempt(youtubeId);
}
