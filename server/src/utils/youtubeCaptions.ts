/**
 * Fetch YouTube auto-generated captions (no API key, no extra deps).
 *
 * The plain watch-page + timedtext route now returns empty 200s to non-browser
 * clients (proof-of-origin tokens), so we use the InnerTube player API with an
 * ANDROID client instead — its caption baseUrls are fetchable directly. The
 * response is srv XML (`<text start dur>…</text>`), not json3, regardless of
 * the fmt param.
 *
 * YouTube can change this at any time — every failure path returns null
 * instead of throwing so a broken video never kills a whole course sync.
 */

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // 'asr' = auto-generated
}

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';

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

export async function fetchAutoCaptions(
  youtubeId: string
): Promise<{ language: string; text: string } | null> {
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
      signal: AbortSignal.timeout(20000),
    });
    if (!playerRes.ok) return null;
    const data = (await playerRes.json()) as {
      playabilityStatus?: { status?: string };
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
    };
    if (data.playabilityStatus?.status !== 'OK') return null;
    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;

    const track = pickTrack(tracks);
    if (!track?.baseUrl) return null;

    const capRes = await fetch(track.baseUrl, {
      headers: { 'User-Agent': ANDROID_UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!capRes.ok) return null;
    const body = await capRes.text();
    if (!body) return null;

    const text = xmlToPlainText(body);
    if (!text) return null;

    return { language: track.languageCode, text };
  } catch {
    return null;
  }
}
