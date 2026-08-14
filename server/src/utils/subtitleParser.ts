/**
 * Parse subtitle files (text + timestamps) into plain text for the course
 * assistant's knowledge base. Supports every format YouTube Studio exports:
 *   .srt  — "1\n00:00:01,000 --> 00:00:04,000\nข้อความ"
 *   .vtt  — "WEBVTT\n\n00:01.000 --> 00:04.000\nข้อความ" (+ inline <c> tags)
 *   .sbv  — "0:00:01.000,0:00:04.000\nข้อความ"  (YouTube's own format)
 *   .txt  — plain transcript (no timestamps) — stored as-is
 */

export type SubtitleFormat = 'srt' | 'vtt' | 'sbv' | 'txt';

const SRT_TIME_RE = /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;
const VTT_TIME_RE = /^\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
const SBV_TIME_RE = /^\s*\d{1,2}:\d{2}:\d{2}\.\d{1,3}\s*,\s*\d{1,2}:\d{2}:\d{2}\.\d{1,3}\s*$/;

function detectFormat(filename: string, raw: string): SubtitleFormat {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'srt') return 'srt';
  if (ext === 'vtt') return 'vtt';
  if (ext === 'sbv') return 'sbv';
  if (ext === 'txt') {
    // A "txt" can still secretly be a timed transcript — sniff it.
    if (/^WEBVTT/m.test(raw)) return 'vtt';
    if (raw.split(/\r?\n/).some((l) => SBV_TIME_RE.test(l))) return 'sbv';
    if (raw.split(/\r?\n/).some((l) => SRT_TIME_RE.test(l))) return 'srt';
    return 'txt';
  }
  // Unknown extension — sniff content.
  if (/^WEBVTT/m.test(raw)) return 'vtt';
  if (raw.split(/\r?\n/).some((l) => SBV_TIME_RE.test(l))) return 'sbv';
  if (raw.split(/\r?\n/).some((l) => SRT_TIME_RE.test(l))) return 'srt';
  return 'txt';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function cleanLine(line: string): string {
  return decodeEntities(
    line
      // inline cue tags: <c>, </c>, <c.color>, <v Speaker>, <00:00:01.000>, <i>, <b>
      .replace(/<[^>]*>/g, '')
      // ASS-style positioning tags {\an8} etc.
      .replace(/\{\\[^}]*\}/g, '')
  ).trim();
}

/**
 * Timestamped subtitle → plain text.
 * Returns null when nothing readable is left (wrong file, empty, binary).
 */
export function parseSubtitleFile(
  filename: string,
  raw: string
): { format: SubtitleFormat; text: string } | null {
  if (!raw || raw.includes(String.fromCharCode(0))) return null; // binary guard
  const format = detectFormat(filename, raw);
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/);

  const parts: string[] = [];
  let prev = '';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Headers / metadata
    if (/^WEBVTT/.test(line)) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) continue;
    if (/^(Kind|Language):/i.test(line)) continue;
    // Timestamp lines (all formats)
    if (SRT_TIME_RE.test(line) || VTT_TIME_RE.test(line) || SBV_TIME_RE.test(line)) continue;
    // SRT cue index — a bare number line
    if (format !== 'txt' && /^\d+$/.test(line)) continue;

    const cleaned = cleanLine(line);
    if (!cleaned) continue;
    // Rolling captions repeat the previous line — drop consecutive duplicates.
    if (cleaned === prev) continue;
    parts.push(cleaned);
    prev = cleaned;
  }

  const text = parts.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!text) return null;
  return { format, text };
}
