/**
 * ElevenLabs TTS service — per-line Thai/English narration for the AI Agent pipeline.
 *
 * Uses the `/v1/text-to-speech/{voice_id}/with-timestamps` endpoint to get
 * character-level alignment, from which we compute the exact audio duration.
 * That duration drives downstream scene timing — if a line is longer than 6s,
 * the orchestrator can flag it for shortening.
 *
 * Output: each line's MP3 is uploaded to S3 and a long-lived signed URL is
 * returned alongside the duration in seconds.
 */
import { uploadFile, getSignedFileUrl } from '../utils/s3.js';

const ELEVEN_BASE = 'https://api.elevenlabs.io';
const MODEL_ID = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
const REQUEST_TIMEOUT_MS = 180_000;

// Public ElevenLabs voices (any account has access). Override per-user via DB.
const DEFAULT_VOICE_ID_TH = '21m00Tcm4TlvDq8ikWAM'; // Rachel — multilingual, OK for Thai
const DEFAULT_VOICE_ID_EN = '21m00Tcm4TlvDq8ikWAM'; // Rachel

export interface TtsLineResult {
  scene: number;
  audio_url: string;       // signed S3 URL valid for 7 days
  duration_sec: number;    // actual TTS duration from character alignment
}

export interface TtsBatchOpts {
  apiKey: string;
  voiceId?: string;
  language: 'th' | 'en';
  userId: number;
  jobId: number;
}

/**
 * Generate TTS for a single line. Returns the S3 URL + actual duration.
 */
export async function synthesizeLine(
  text: string,
  scene: number,
  opts: TtsBatchOpts
): Promise<TtsLineResult> {
  if (!opts.apiKey) throw new Error('ELEVENLABS_API_KEY is required');
  const voiceId =
    opts.voiceId ||
    (opts.language === 'en' ? DEFAULT_VOICE_ID_EN : DEFAULT_VOICE_ID_TH);

  const url = `${ELEVEN_BASE}/v1/text-to-speech/${encodeURIComponent(
    voiceId
  )}/with-timestamps?output_format=${OUTPUT_FORMAT}`;

  // eleven_multilingual_v2 auto-detects language from input text; it rejects
  // the `language_code` field (HTTP 400 unsupported_language). Only the
  // turbo_v2_5 / flash_v2_5 models accept that parameter.
  const body = {
    text,
    model_id: MODEL_ID,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    },
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': opts.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`ElevenLabs HTTP ${resp.status}: ${errText.substring(0, 300)}`);
  }

  const json: any = await resp.json();
  // Schema: { audio_base64, alignment: { characters[], character_start_times_seconds[], character_end_times_seconds[] } }
  const audioB64 = json.audio_base64;
  const endTimes: number[] | undefined = json.alignment?.character_end_times_seconds;
  if (!audioB64) throw new Error('ElevenLabs response missing audio_base64');

  const duration =
    Array.isArray(endTimes) && endTimes.length > 0
      ? endTimes[endTimes.length - 1]
      : 0;
  const audioBuf = Buffer.from(audioB64, 'base64');

  // Upload to S3 → 7-day signed URL
  const key = `story-agent/${opts.userId}/${opts.jobId}/voice/scene-${String(scene).padStart(2, '0')}.mp3`;
  await uploadFile(audioBuf, key, 'audio/mpeg');
  const audioUrl = await getSignedFileUrl(key, 7 * 24 * 60 * 60);

  return { scene, audio_url: audioUrl, duration_sec: duration };
}
