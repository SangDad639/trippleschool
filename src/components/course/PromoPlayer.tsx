import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Loader2, Play, SkipForward, VolumeX } from 'lucide-react';
import { api } from '@/lib/api';
import type { PromoMeta } from '@/types/promo';
import { loadYouTubeIframeApi, type YTPlayer } from '@/lib/youtubeIframeApi';

/**
 * ตัวเล่นโฆษณาก่อนเริ่มคลิป (071: ไม่มี mid-roll แล้ว) — แทน player บทเรียนภายใน stage 16:9 จนกว่าจะจบ/ข้าม
 *   - source 'youtube' → YouTube IFrame API (controls=0 + แผ่นกันคลิก) — โฆษณาที่ user ให้มาเป็นคลิป YouTube
 *   - source 'file'    → <video> ของเราเอง (ไฟล์บน S3 ผ่าน Range proxy)
 * UI (user รีวิว 8 ก.ย.): ไม่มีป้าย/ชื่อโฆษณา ไม่มีปุ่มลิงก์ ไม่มีข้อความบอกให้แตะ — เหลือปุ่มข้าม (หลัง skip_after_sec, null = ห้ามข้าม),
 *   progress bar, pill เปิดเสียง (เมื่อถูกบังคับ muted) และปุ่ม ▶ เมื่อ autoplay ถูกบล็อก (ไฟล์) / ถอดแผ่นกันคลิก (YouTube)
 * fail-open ทุกทาง: meta พัง / เล่นไม่ได้ / API โหลดไม่ได้ → onDone('error') ให้บทเรียนเล่นต่อ
 * class ห้ามขึ้นต้นด้วย "ad" (cosmetic filter ของ adblock ซ่อน) — ใช้คำว่า promo
 */
export interface PromoPlayerProps {
  promoId: number;
  /** หยุดชั่วคราว (เช่น drawer รายการบทเปิดทับบนมือถือ) */
  paused?: boolean;
  onDone: (result: 'ended' | 'skipped' | 'error') => void;
  /** โฆษณาเริ่มเล่นครั้งแรก (เห็นแล้ว 1 ครั้ง = นับความถี่ทันที ไม่ต้องรอจบ/ข้าม) — เรียกครั้งเดียว */
  onStart?: () => void;
}

type EngineEvent = 'playing' | 'muted' | 'blocked' | 'stalled' | 'ended' | 'error';
interface EngineControls { play(): void; pause(): void; unmute(): void }
interface EngineProps {
  paused: boolean;
  ctrl: MutableRefObject<EngineControls | null>;
  onTick: (elapsed: number, duration: number) => void;
  onEvent: (e: EngineEvent) => void;
}

/* meta cache ต่อ promoId (บทติดกันที่ใช้โฆษณาเดียวกันไม่ยิงซ้ำ) */
const metaCache = new Map<number, Promise<PromoMeta>>();
function fetchPromoMeta(id: number): Promise<PromoMeta> {
  let p = metaCache.get(id);
  if (!p) {
    p = api.getPromo(id).then((r) => r.promo);
    metaCache.set(id, p);
    p.catch(() => metaCache.delete(id));
  }
  return p;
}

/* ---------------- YouTube engine ---------------- */
function YoutubeEngine({ youtubeId, paused, ctrl, onTick, onEvent }: EngineProps & { youtubeId: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const onTickRef = useRef(onTick);
  const onEventRef = useRef(onEvent);
  onTickRef.current = onTick;
  onEventRef.current = onEvent;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let cancelled = false;
    let player: YTPlayer | null = null;
    let poll: number | undefined;
    let t1: number | undefined;
    let t2: number | undefined;
    let playing = false;
    // YT.Player แทนที่ element ที่ส่งให้ด้วย iframe → ต้องเป็น node ที่เราสร้างเอง ไม่ใช่ของ React
    const host = document.createElement('div');
    host.className = 'w-full h-full';
    wrap.appendChild(host);

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) return;
        player = new YT.Player(host, {
          videoId: youtubeId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1,
            playsinline: 1, fs: 0, iv_load_policy: 3, start: 0, origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled || !player) return;
              readyRef.current = true;
              // YouTube จำตำแหน่งที่ดูค้างของคลิปเดิมในเบราว์เซอร์ → โฆษณาจะ "จบทันที" รอบถัดไป · บังคับเริ่ม 0 เสมอ
              try { player.seekTo(0, true); } catch { /* noop */ }
              try { player.playVideo(); } catch { /* noop */ }
              // ไม่เล่นใน 2.5 วิ = โดนนโยบาย autoplay → ลอง muted · ยังไม่เล่น = ให้ผู้ใช้แตะเอง
              t1 = window.setTimeout(() => {
                if (playing || !player) return;
                try { player.mute(); player.playVideo(); } catch { /* noop */ }
                onEventRef.current('muted');
                t2 = window.setTimeout(() => { if (!playing) onEventRef.current('blocked'); }, 2500);
              }, 2500);
              poll = window.setInterval(() => {
                if (!player) return;
                try {
                  onTickRef.current(player.getCurrentTime() || 0, player.getDuration() || 0);
                  if (playing && player.getPlayerState() === YT.PlayerState.ENDED) onEventRef.current('ended');
                } catch { /* player ยังไม่พร้อม */ }
              }, 250);
            },
            onStateChange: (e) => {
              if (e.data === YT.PlayerState.PLAYING) { playing = true; onEventRef.current('playing'); }
              else if (e.data === YT.PlayerState.ENDED) {
                // ENDED ทั้งที่ยังไม่เคย PLAYING = ตำแหน่งค้างท้ายคลิป → เริ่มใหม่จาก 0 แทนที่จะถือว่าจบ
                if (!playing) { try { player?.seekTo(0, true); player?.playVideo(); } catch { /* noop */ } return; }
                onEventRef.current('ended');
              }
            },
            onError: () => onEventRef.current('error'),
          },
        });
        ctrl.current = {
          play: () => { try { player?.playVideo(); } catch { /* noop */ } },
          pause: () => { try { player?.pauseVideo(); } catch { /* noop */ } },
          unmute: () => { try { player?.unMute(); } catch { /* noop */ } },
        };
        if (import.meta.env.DEV) (window as any).__promoPlayer = player; // debug เฉพาะ dev
      })
      .catch(() => { if (!cancelled) onEventRef.current('error'); });

    return () => {
      cancelled = true;
      if (poll) window.clearInterval(poll);
      if (t1) window.clearTimeout(t1);
      if (t2) window.clearTimeout(t2);
      ctrl.current = null;
      try { player?.destroy(); } catch { /* noop */ }
      wrap.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeId]);

  useEffect(() => {
    if (!readyRef.current) return;
    if (paused) ctrl.current?.pause(); else ctrl.current?.play();
  }, [paused, ctrl]);

  return <div ref={wrapRef} className="absolute inset-0 w-full h-full bg-black" />;
}

/* ---------------- File (<video>) engine ---------------- */
function FileEngine({ src, poster, paused, ctrl, onTick, onEvent }: EngineProps & { src: string; poster?: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onTickRef = useRef(onTick);
  const onEventRef = useRef(onEvent);
  onTickRef.current = onTick;
  onEventRef.current = onEvent;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let playing = false;
    let disposed = false;
    const started = Date.now();
    let watchdog: number | undefined;
    let stallTimer: number | undefined;
    // 10 วิไม่เริ่มเล่น → ยืดได้เมื่อ bytes ยังมา (progress) เพดานรวม 25 วิ → ปล่อยผ่าน
    const armWatchdog = () => {
      if (watchdog) window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        if (disposed || playing) return;
        if (Date.now() - started > 25_000) onEventRef.current('error');
        else { onEventRef.current('stalled'); armWatchdog(); }
      }, 10_000);
    };
    const tryPlay = () => {
      el.muted = false;
      el.play().catch(() => {
        if (disposed) return;
        el.muted = true;
        onEventRef.current('muted');
        el.play().catch(() => { if (!disposed) onEventRef.current('blocked'); });
      });
    };
    const onPlaying = () => { playing = true; if (stallTimer) window.clearTimeout(stallTimer); onEventRef.current('playing'); };
    const onTime = () => {
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      onTickRef.current(el.currentTime, d);
      // บาง browser ไม่ยิง ended เมื่อ stream ถูกตัด — เกือบจบถือว่าจบ
      if (d > 0 && el.currentTime >= d - 0.25) onEventRef.current('ended');
    };
    const onWaiting = () => {
      if (stallTimer) window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => { if (!disposed) onEventRef.current('stalled'); }, 6000);
    };
    const onProgress = () => { if (!playing) armWatchdog(); };
    el.addEventListener('playing', onPlaying);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', () => onEventRef.current('ended'));
    el.addEventListener('error', () => onEventRef.current('error'));
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('stalled', onWaiting);
    el.addEventListener('progress', onProgress);
    ctrl.current = {
      play: () => { el.play().catch(() => { /* noop */ }); },
      pause: () => el.pause(),
      unmute: () => { el.muted = false; },
    };
    armWatchdog();
    tryPlay();
    return () => {
      disposed = true;
      if (watchdog) window.clearTimeout(watchdog);
      if (stallTimer) window.clearTimeout(stallTimer);
      ctrl.current = null;
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    if (paused) ctrl.current?.pause(); else ctrl.current?.play();
  }, [paused, ctrl]);

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster || undefined}
      playsInline
      preload="auto"
      disablePictureInPicture
      controlsList="nodownload noplaybackrate"
      onContextMenu={(e) => e.preventDefault()}
      className="absolute inset-0 w-full h-full object-contain bg-black"
    />
  );
}

/* ---------------- ตัวเล่นโฆษณา + chrome ---------------- */
export function PromoPlayer({ promoId, paused = false, onDone, onStart }: PromoPlayerProps) {
  const [meta, setMeta] = useState<PromoMeta | null>(null);
  const [status, setStatus] = useState<'loading' | 'playing' | 'blocked'>('loading');
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [stalledLong, setStalledLong] = useState(false);
  const ctrl = useRef<EngineControls | null>(null);
  const doneRef = useRef(false);
  const startedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const notifyStart = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    onStartRef.current?.();
  };

  const finish = (r: 'ended' | 'skipped' | 'error') => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current(r);
  };

  useEffect(() => {
    let alive = true;
    fetchPromoMeta(promoId)
      .then((m) => { if (alive) setMeta(m); })
      .catch(() => { if (alive) finish('error'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoId]);

  const handleEvent = (e: EngineEvent) => {
    switch (e) {
      case 'playing': setStatus('playing'); setStalledLong(false); notifyStart(); break;
      case 'muted': setMuted(true); break;
      case 'blocked': setStatus('blocked'); break;
      case 'stalled': setStalledLong(true); break;
      case 'ended': finish('ended'); break;
      case 'error': finish('error'); break;
    }
  };
  const handleTick = (t: number, d: number) => {
    setElapsed(t);
    if (d > 0) setDuration(d);
  };

  const skipAfter = meta?.skip_after_sec ?? null;
  const canSkip = stalledLong || status === 'blocked' || (skipAfter !== null && elapsed >= skipAfter);
  const skipCountdown = skipAfter !== null ? Math.max(0, Math.ceil(skipAfter - elapsed)) : null;
  const totalSec = duration > 0 ? duration : (meta?.duration_sec ?? 0);
  const progress = totalSec > 0 ? Math.min(100, (elapsed / totalSec) * 100) : 0;
  const isYoutube = meta?.source_type === 'youtube' && !!meta.youtube_id;
  const isFile = meta?.source_type === 'file' && !!meta.video_url;

  useEffect(() => {
    // ไม่มีแหล่งวิดีโอที่เล่นได้ (ข้อมูลเสีย) → ปล่อยผ่าน
    if (meta && !isYoutube && !isFile) finish('error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  return (
    <div
      className="absolute inset-0 z-10 bg-black text-white select-none"
      data-testid="promo-player"
      data-status={status}
      data-elapsed={Math.round(elapsed)}
      data-source={meta?.source_type ?? ''}
    >
      {meta && isYoutube && (
        <YoutubeEngine youtubeId={meta.youtube_id!} paused={paused} ctrl={ctrl} onTick={handleTick} onEvent={handleEvent} />
      )}
      {meta && isFile && (
        <FileEngine src={api.mediaUrl(meta.video_url!)} poster={meta.poster_url ? api.mediaUrl(meta.poster_url) : null} paused={paused} ctrl={ctrl} onTick={handleTick} onEvent={handleEvent} />
      )}

      {/* แผ่นกันคลิก — ห้าม pause/scrub/คลิกเข้า YouTube · ถอดออกตอน blocked ให้แตะปุ่ม ▶ ของ YouTube ได้ */}
      {status !== 'blocked' && <div className="absolute inset-0" aria-hidden="true" />}

      {/* กำลังโหลด */}
      {status === 'loading' && elapsed === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="h-8 w-8 animate-spin text-white/80" />
        </div>
      )}

      {/* โดนบล็อก autoplay: YouTube → แผ่นกันคลิกถูกถอดแล้ว ผู้ใช้แตะปุ่ม ▶ ของ YouTube เอง (ไม่มีข้อความ) · ไฟล์ → ปุ่ม ▶ ของเรา */}
      {status === 'blocked' && isFile && (
        <button
          type="button"
          onClick={() => { setStatus('loading'); ctrl.current?.play(); }}
          className="absolute inset-0 flex items-center justify-center"
          aria-label="เล่น"
        >
          <span className="h-16 w-16 rounded-full bg-white/90 text-black flex items-center justify-center shadow-lg"><Play className="h-7 w-7 ml-1" /></span>
        </button>
      )}

      {/* เปิดเสียง */}
      {muted && status !== 'blocked' && (
        <button
          type="button"
          onClick={() => { ctrl.current?.unmute(); setMuted(false); }}
          className="absolute top-2 right-2 h-9 rounded-full bg-black/70 px-3 text-xs font-medium flex items-center gap-1.5 hover:bg-black/85"
        >
          <VolumeX className="h-4 w-4" /> แตะเพื่อเปิดเสียง
        </button>
      )}

      {/* ปุ่มข้าม (ขวาล่าง) */}
      <div className="absolute inset-x-0 bottom-3 flex items-end justify-end px-3 gap-2">
        <div>
          {(skipAfter !== null || stalledLong || status === 'blocked') ? (
            <button
              type="button"
              disabled={!canSkip}
              onClick={() => finish('skipped')}
              className="inline-flex h-11 min-w-[7.5rem] items-center justify-center gap-1.5 rounded-lg border border-white/30 bg-black/70 px-4 text-sm font-semibold disabled:opacity-70 hover:bg-black/85 disabled:hover:bg-black/70"
              data-testid="promo-skip"
            >
              {canSkip ? (<>ข้ามโฆษณา <SkipForward className="h-4 w-4" /></>) : `ข้ามได้ใน ${skipCountdown} วิ`}
            </button>
          ) : (
            <span className="inline-flex h-9 items-center rounded-lg bg-black/60 px-3 text-xs text-white/80">
              {totalSec > 0 ? `โฆษณา · เหลือ ${Math.max(0, Math.ceil(totalSec - elapsed))} วิ` : 'โฆษณา'}
            </span>
          )}
        </div>
      </div>

      {/* progress */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20 pointer-events-none">
        <div className="h-full bg-yellow-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

export default PromoPlayer;
