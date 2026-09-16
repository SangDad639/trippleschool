import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { PromoPlayer } from '@/components/course/PromoPlayer';
import { loadYouTubeIframeApi, type YTPlayer } from '@/lib/youtubeIframeApi';
import { markPromoSeen } from '@/lib/promoFrequency';

/**
 * player ของบทเรียน — ทางเดียวสำหรับทุกบท (072 รวม 2 ทางเดิมของ CourseLearn เข้าด้วยกัน)
 *
 *   promoId != null:  poster (ปกบท + ▶ อย่างเดียว)  →  pre-roll <PromoPlayer>  →  YouTube iframe (+autoplay)
 *   promoId == null:  YouTube iframe เดิมเป๊ะ (?rel=0) ทันที
 *   chaptersEnabled:  iframe ใส่ enablejsapi+origin → ผูก YT.Player หลัง mount → seekTo() / getCurrentTime() ให้ "บทในคลิป"
 *
 * กติกา:
 * - โฆษณามี "ก่อนเริ่มคลิป" อย่างเดียว ตัวเดียวทุกคลิป (071) · กด ▶ ก่อน = user gesture → มีเสียงบนมือถือ · ปุ่มอย่างเดียวไม่มีข้อความ
 * - ความถี่นับต่อผู้เรียน: โฆษณาเริ่มเล่น 1 ครั้ง → `markPromoSeen` ทันที (onStart) → ไม่เห็นอีกจนครบ N วัน
 * - กดบทตอนยังอยู่ปก/โฆษณา → จำไว้ (pendingSeek) แล้วข้ามให้เมื่อเข้าบทเรียน
 * - fail-open: IFrame API โหลดไม่ได้ → seek ด้วยการโหลด iframe ใหม่ `?start=sec&autoplay=1` · โฆษณาพัง → ข้ามเข้าบทเรียน
 * - ไม่มีปุ่มเต็มจอของเรา (user ตัดออก) → คง allowFullScreen ของ YouTube · ไม่เรียก destroy() บน iframe ของ React
 */
export interface StageLesson { id: number; title: string; youtube_id: string }
export interface LessonVideoStageHandle {
  /** ข้ามไปเวลานั้นแล้วเล่นต่อ (วินาที) */
  seekTo(sec: number): void;
  /** เวลาปัจจุบัน + กำลังเล่นไหม · null = ยังไม่ได้เริ่มเล่น (ปก/โฆษณา/unstarted) หรือไม่มี API */
  getPlayback(): { sec: number; playing: boolean } | null;
}
interface Props {
  lesson: StageLesson;
  /** โฆษณาก่อนเริ่ม (จาก course.pre_roll_promo_id) · null = ไม่มีโฆษณา */
  promoId: number | null;
  /** ปกบทสำหรับหน้า poster (เช่น /api/courses/lessons/:id/thumb) */
  posterUrl: string;
  /** หยุดโฆษณาชั่วคราว (drawer รายการบทเปิดทับบนมือถือ) */
  paused?: boolean;
  /** บทนี้มี "บทในคลิป" → เปิด IFrame API เพื่อ seek/จับเวลา (บทที่ไม่มีไม่โหลด script ใดๆ) */
  chaptersEnabled?: boolean;
}

export const LessonVideoStage = forwardRef<LessonVideoStageHandle, Props>(function LessonVideoStage(
  { lesson, promoId, posterUrl, paused = false, chaptersEnabled = false },
  ref
) {
  // ล็อกโฆษณาไว้ตลอดอายุ stage (key ตามบท): CourseLearn คำนวณ showAd ใหม่ทุก render และ markPromoSeen ตอนโฆษณาเริ่ม
  // ทำให้ prop promoId กลายเป็น null กลางโฆษณา — ถ้าใช้ prop ตรงๆ PromoPlayer จะหายไปทั้งที่ยังอยู่ phase 'pre' (จอดำ)
  const [promo] = useState<number | null>(promoId);
  const [phase, setPhase] = useState<'poster' | 'pre' | 'video'>(promo != null ? 'poster' : 'video');
  const [autoplay, setAutoplay] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  /** fallback seek เมื่อไม่มี API: โหลด iframe ใหม่ที่วินาทีนี้ (key เปลี่ยนตาม) */
  const [startAt, setStartAt] = useState<{ sec: number; n: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const apiFailedRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  /** seek ที่ทำตอน onReady รอยืนยันตอนเริ่มเล่นจริง (YouTube อาจ resume ตำแหน่งค้างทับ) */
  const confirmSeekRef = useRef<number | null>(null);
  /** กัน POST /seen ซ้ำ (onStart + fallback ตอนจบ/ข้าม) */
  const markedRef = useRef(false);

  const markAdShown = () => {
    if (markedRef.current || promo == null) return;
    markedRef.current = true;
    markPromoSeen(promo);
  };
  const handlePreDone = (result: 'ended' | 'skipped' | 'error') => {
    // เผื่อกรณีเล่นไม่ได้แล้วข้าม (ไม่เคย playing) — ข้าม = เห็นแล้วเหมือนกัน · error = ไม่นับ
    if (result !== 'error') markAdShown();
    setAutoplay(true);
    setPhase('video');
  };

  // src ของ iframe บทเรียน — ไม่มีโฆษณา/บท = `?rel=0` เดิมเป๊ะ · ต่อจากโฆษณา = autoplay · มีบทในคลิป = jsapi (ไม่ใส่ fs=0)
  const params = new URLSearchParams({ rel: '0' });
  if (autoplay || startAt) { params.set('autoplay', '1'); params.set('playsinline', '1'); }
  if (startAt) params.set('start', String(startAt.sec));
  if (chaptersEnabled) {
    params.set('enablejsapi', '1');
    params.set('origin', window.location.origin);
  }
  const iframeSrc = `https://www.youtube.com/embed/${lesson.youtube_id}?${params.toString()}`;
  const iframeKey = `${lesson.id}-${startAt?.n ?? 0}`;

  const doSeek = (sec: number) => {
    const p = playerRef.current;
    if (p) {
      try { p.seekTo(sec, true); p.playVideo(); return; } catch { /* ตกไป fallback */ }
    }
    if (apiFailedRef.current || !chaptersEnabled) {
      playerRef.current = null;
      setStartAt((s) => ({ sec, n: (s?.n ?? 0) + 1 }));
      return;
    }
    // API ยังโหลดไม่เสร็จ → ทำตอน onReady
    pendingSeekRef.current = sec;
  };

  useImperativeHandle(ref, () => ({
    seekTo(sec: number) {
      const s = Math.max(0, Math.floor(sec));
      if (phase !== 'video') { pendingSeekRef.current = s; return; }
      doSeek(s);
    },
    getPlayback() {
      const p = playerRef.current;
      if (!p || phase !== 'video') return null;
      try {
        const state = p.getPlayerState(); // -1 unstarted · 0 ended · 1 playing · 2 paused · 3 buffering · 5 cued
        if (state === -1 || state === 5) return null;
        return { sec: p.getCurrentTime() || 0, playing: state === 1 || state === 3 };
      } catch { return null; }
    },
  }), [phase, chaptersEnabled]);

  // ผูก YT.Player กับ iframe บทเรียนเมื่อมีบทในคลิป (บทที่ไม่มี → ไม่โหลด script)
  useEffect(() => {
    if (phase !== 'video' || !chaptersEnabled || !iframeRef.current) return;
    let cancelled = false;
    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !iframeRef.current) return;
        playerRef.current = new YT.Player(iframeRef.current, {
          events: {
            onReady: () => {
              const pending = pendingSeekRef.current;
              pendingSeekRef.current = null;
              if (pending != null) {
                confirmSeekRef.current = pending;
                try { playerRef.current?.seekTo(pending, true); playerRef.current?.playVideo(); } catch { /* noop */ }
              }
            },
            onStateChange: (e) => {
              // YouTube "เล่นต่อจากที่ค้าง" ทับ seek ที่ทำตอน onReady ได้ → พอเริ่มเล่นจริงเช็คอีกรอบแล้ว seek ซ้ำถ้าเพี้ยน
              if (e.data !== YT.PlayerState.PLAYING || confirmSeekRef.current == null) return;
              const target = confirmSeekRef.current;
              confirmSeekRef.current = null;
              try {
                if (Math.abs((playerRef.current?.getCurrentTime() ?? target) - target) > 3) playerRef.current?.seekTo(target, true);
              } catch { /* noop */ }
            },
          },
        });
        if (import.meta.env.DEV) (window as any).__lessonPlayer = playerRef.current; // debug เฉพาะ dev
      })
      .catch(() => {
        apiFailedRef.current = true;
        const pending = pendingSeekRef.current;
        pendingSeekRef.current = null;
        if (pending != null) setStartAt((s) => ({ sec: pending, n: (s?.n ?? 0) + 1 }));
      });
    return () => {
      cancelled = true;
      // ไม่เรียก destroy(): iframe เป็นของ React — destroy จะถอด node ออกเองแล้ว React unmount พัง
      playerRef.current = null;
    };
  }, [phase, chaptersEnabled, lesson.id, iframeKey]);

  return (
    <div className="relative w-full h-full bg-black" data-testid="lesson-stage">
      {phase === 'poster' && (
        <div className="absolute inset-0" data-testid="promo-poster">
          {!posterFailed && (
            <img src={posterUrl} alt="" className="absolute inset-0 w-full h-full object-cover" onError={() => setPosterFailed(true)} />
          )}
          <div className="absolute inset-0 bg-black/45" />
          {/* ปุ่ม ▶ อย่างเดียว ไม่มีข้อความ (user สั่ง) */}
          <button
            type="button"
            onClick={() => setPhase('pre')}
            className="absolute inset-0 flex items-center justify-center text-white"
            aria-label="เล่น"
            data-testid="promo-poster-play"
          >
            <span className="h-16 w-16 rounded-full bg-white/90 text-black flex items-center justify-center shadow-lg">
              <Play className="h-7 w-7 ml-1" />
            </span>
          </button>
        </div>
      )}

      {phase === 'pre' && promo != null && (
        <PromoPlayer
          key={`pre-${promo}`}
          promoId={promo}
          paused={paused}
          onStart={markAdShown}
          onDone={handlePreDone}
        />
      )}

      {phase === 'video' && (
        <iframe
          ref={iframeRef}
          key={iframeKey}
          id={`lesson-yt-${lesson.id}`}
          src={iframeSrc}
          title={lesson.title}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      )}
    </div>
  );
});

export default LessonVideoStage;
