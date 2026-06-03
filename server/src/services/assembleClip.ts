/**
 * Assemble final clip — Stage 7 of the AI Agent pipeline.
 *
 * Downloads all scene videos + voice clips, concatenates videos, overlays voice
 * track (trimmed to match video duration), and burns Thai/English captions per
 * scene as a hard-subtitle. Uploads result to Dropbox and returns the shared URL.
 *
 * Reuses ffmpeg-static + Dropbox utility already in trippleviral.
 *
 * Caption rendering: ffmpeg `subtitles` filter consumes an SRT file we generate
 * on the fly from per-scene { text, start, duration } tuples.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
// ffmpeg-static's type declaration exports the namespace; at runtime it's a string path.
const FFMPEG_PATH: string = (ffmpegPath as unknown as string) || 'ffmpeg';
import { uploadLocalFileToDropbox } from '../utils/dropbox.js';

export interface SceneInput {
  scene: number;
  video_url: string;
  voice_url: string;
  voice_duration: number;
  caption_text: string;
}

export interface AssembleResult {
  localVideoPath: string;       // tmp local mp4 (deleted after caller is done)
  localCoverPath: string;       // tmp local png (first frame extracted)
  dropboxVideoUrl?: string;     // shared URL when Dropbox is configured
  durationSec: number;
}

export interface AssembleOpts {
  userId: number;
  jobId: number;
  scenes: SceneInput[];
  uploadToDropbox?: boolean;
}

const FF = FFMPEG_PATH;

export async function assembleClip(opts: AssembleOpts): Promise<AssembleResult> {
  if (opts.scenes.length === 0) throw new Error('No scenes to assemble');
  const sorted = [...opts.scenes].sort((a, b) => a.scene - b.scene);

  const tmpDir = path.join(os.tmpdir(), `story-agent-${opts.jobId}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const cleanup = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  };

  try {
    // 1) Download all scene videos and voices
    const sceneVideos: string[] = [];
    const sceneVoices: string[] = [];
    for (const s of sorted) {
      const vidPath = path.join(tmpDir, `scene-${s.scene}.mp4`);
      const voicePath = path.join(tmpDir, `scene-${s.scene}.mp3`);
      await downloadTo(s.video_url, vidPath);
      await downloadTo(s.voice_url, voicePath);
      sceneVideos.push(vidPath);
      sceneVoices.push(voicePath);
    }

    // 2) Concat videos via ffmpeg concat demuxer (stream copy first, re-encode if needed)
    const concatList = path.join(tmpDir, 'concat.txt');
    fs.writeFileSync(
      concatList,
      sceneVideos.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n')
    );
    const concatVideo = path.join(tmpDir, 'concat.mp4');
    try {
      execFileSync(
        FF,
        ['-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', '-y', concatVideo],
        { timeout: 120_000, stdio: 'pipe' }
      );
    } catch {
      // Stream copy failed (codec mismatch), re-encode
      execFileSync(
        FF,
        [
          '-f', 'concat', '-safe', '0', '-i', concatList,
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          '-an', // drop original audio (will overlay voice next)
          '-y', concatVideo,
        ],
        { timeout: 300_000, stdio: 'pipe' }
      );
    }

    // 3) Concat voice tracks in scene order
    const voiceList = path.join(tmpDir, 'voice-list.txt');
    fs.writeFileSync(
      voiceList,
      sceneVoices.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n')
    );
    const concatVoice = path.join(tmpDir, 'voice.mp3');
    execFileSync(
      FF,
      ['-f', 'concat', '-safe', '0', '-i', voiceList, '-c', 'copy', '-y', concatVoice],
      { timeout: 60_000, stdio: 'pipe' }
    );

    // 4) Build SRT subtitles from per-scene captions + voice durations
    const srtPath = path.join(tmpDir, 'captions.srt');
    fs.writeFileSync(srtPath, buildSrt(sorted), 'utf-8');

    // 5) Mux: video + voice + burned subtitles
    const finalPath = path.join(tmpDir, 'final.mp4');
    const srtArg = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    execFileSync(
      FF,
      [
        '-i', concatVideo,
        '-i', concatVoice,
        '-vf', `subtitles='${srtArg}':force_style='Fontsize=24,Outline=2,BorderStyle=1,Alignment=2,MarginV=80'`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-map', '0:v:0', '-map', '1:a:0',
        '-shortest',
        '-movflags', '+faststart',
        '-y', finalPath,
      ],
      { timeout: 600_000, stdio: 'pipe' }
    );

    // 6) Extract cover (first frame)
    const coverPath = path.join(tmpDir, 'cover.png');
    execFileSync(
      FF,
      ['-i', finalPath, '-vframes', '1', '-q:v', '2', '-y', coverPath],
      { timeout: 30_000, stdio: 'pipe' }
    );

    // 7) Optional Dropbox upload — non-fatal. The local mp4 is still produced
    // and post stage uses _local_video_path, so an expired/missing token must
    // not fail the whole pipeline. Caller can inspect dropboxVideoUrl=undefined
    // to know upload was skipped.
    let dropboxVideoUrl: string | undefined;
    if (opts.uploadToDropbox) {
      const date = new Date().toISOString().slice(0, 10);
      const dbPath = `/trippleviral/story-agent/${opts.userId}/${date}_job-${opts.jobId}_final.mp4`;
      try {
        const dbRes = await uploadLocalFileToDropbox(finalPath, dbPath);
        dropboxVideoUrl = dbRes.sharedUrl;
      } catch (err: any) {
        console.warn(
          `[assembleClip] Dropbox upload failed for job ${opts.jobId}, continuing with local-only:`,
          err?.message
        );
      }
    }

    const durationSec = sorted.reduce((s, x) => s + x.voice_duration, 0);

    // NOTE: caller is responsible for moving files out of tmpDir before cleanup.
    // We copy to a persistent tmp location so caller can use them.
    const persistDir = path.join(os.tmpdir(), `story-agent-out-${opts.jobId}-${Date.now()}`);
    fs.mkdirSync(persistDir, { recursive: true });
    const outVideo = path.join(persistDir, 'final.mp4');
    const outCover = path.join(persistDir, 'cover.png');
    fs.copyFileSync(finalPath, outVideo);
    fs.copyFileSync(coverPath, outCover);

    return {
      localVideoPath: outVideo,
      localCoverPath: outCover,
      dropboxVideoUrl,
      durationSec,
    };
  } finally {
    cleanup();
  }
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url.substring(0, 80)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function buildSrt(scenes: SceneInput[]): string {
  const lines: string[] = [];
  let cursor = 0;
  scenes.forEach((s, idx) => {
    const start = cursor;
    const end = cursor + s.voice_duration;
    lines.push(String(idx + 1));
    lines.push(`${srtTime(start)} --> ${srtTime(end)}`);
    lines.push(s.caption_text || '');
    lines.push('');
    cursor = end;
  });
  return lines.join('\n');
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(millis).padStart(3, '0')}`;
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}
