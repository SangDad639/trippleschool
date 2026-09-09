import { useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { PromoPlayer } from '@/components/course/PromoPlayer';
import { loadYouTubeIframeApi, type YTPlayer } from '@/lib/youtubeIframeApi';
import { isPromoOnCooldown, markPromoSeen } from '@/lib/promoFrequency';
import type { LessonPromoSlot } from '@/types/promo';

/**
 * player ของบทเรียนที่ "มีโฆษณาแทรก" (บทที่ไม่มี → CourseLearn ยังใช้ iframe เดิมเป๊ะ)
 *
 *   poster (ปกบท + ▶ อย่างเดียว)  →  pre-roll <PromoPlayer>  →  YouTube iframe (+autoplay)
 *                                                                  └─ mid-roll: IFrame API จับเวลา → pause → overlay → play ต่อ
 * กติกา (user 8-9 ก.ย.):
 * - กด ▶ ก่อน = user gesture → โฆษณามีเสียงบนมือถือ
 * - **1 โฆษณา / 1 ผู้เรียน / 7 วัน** (นับแยกต่อโฆษณา): ดูจบ/ข้ามแล้ว → `markPromoSeen` (localStorage + เซิร์ฟเวอร์ถ้าล็อกอิน)
 *   CourseLearn กรอง slot ที่โฆษณาอยู่ในช่วง 7 วันออกก่อนส่งมา; ที่นี่กรองซ้ำตอนถึง cue อีกชั้น (เผื่อเพิ่งดูไปในบทนี้)
 * - ต่อบทยังกันซ้ำในแท็บด้วย `sessionStorage['ts_promo_seen:<lessonId>']` (offset ที่เล่นแล้ว) · refresh กลางโฆษณา = เล่นใหม่
 * - ไม่มีปุ่มเต็มจอของเรา (user ตัดออก) → คง allowFullScreen ของ YouTube ทุกบท · ถึงจุดแทรกขณะเต็มจอ → ออกจากเต็มจอก่อนแล้วค่อยแสดงโฆษณา
 * - fail-open: API โหลดไม่ได้/โฆษณาพัง → บทเรียนเล่นตามปกติ
 */
export interface StageLesson { id: number; title: string; youtube_id: string }
interface Props {
  lesson: StageLesson;
  /** slot ที่ยังแสดงได้ (CourseLearn กรองโฆษณาที่อยู่ในช่วง 7 วันออกแล้ว) */
  promos: LessonPromoSlot[];
  /** ปกบทสำหรับหน้า poster (เช่น /api/courses/lessons/:id/thumb) */
  posterUrl: string;
  /** หยุดโฆษณาชั่วคราว (drawer รายการบทเปิดทับบนมือถือ) */
  paused?: boolean;
}

const seenKey = (lessonId: number) => `ts_promo_seen:${lessonId}`;
function readSeen(lessonId: number): Set<number> {
  try {
    const raw = sessionStorage.getItem(seenKey(lessonId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map((n: unknown) => Number(n)) : []);
  } catch {
    return new Set();
  }
}
function writeSeen(lessonId: number, set: Set<number>) {
  try { sessionStorage.setItem(seenKey(lessonId), JSON.stringify([...set])); } catch { /* private mode */ }
}
/** ใช้ทดสอบ/แสดงผล: บทนี้ดู pre-roll ไปแล้วในแท็บนี้หรือยัง */
export function wasPromoSeen(lessonId: number, offset = 0): boolean {
  return readSeen(lessonId).has(offset);
}

export function LessonVideoStage({ lesson, promos, posterUrl, paused = false }: Props) {
  const seenRef = useRef<Set<number>>(readSeen(lesson.id));
  const pre = useMemo(() => promos.find((p) => p.offset_sec === 0) ?? null, [promos]);
  const mids = useMemo(() => promos.filter((p) => p.offset_sec >= 5).sort((a, b) => a.offset_sec - b.offset_sec), [promos]);
  const hasMid = mids.length > 0;

  const [phase, setPhase] = useState<'poster' | 'pre' | 'video'>(() =>
    pre && !seenRef.current.has(0) && !isPromoOnCooldown(pre.promo_id) ? 'poster' : 'video'
  );
  const [autoplay, setAutoplay] = useState(false);
  const [activeMid, setActiveMid] = useState<LessonPromoSlot | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const activeMidRef = useRef<LessonPromoSlot | null>(null);

  const markSeen = (offset: number) => {
    seenRef.current.add(offset);
    writeSeen(lesson.id, seenRef.current);
  };
  /** โฆษณาจบ/ข้าม → เริ่มนับ 7 วันของโฆษณาตัวนี้สำหรับผู้เรียนคนนี้ */
  const markAdShown = (offset: number, promoId: number) => {
    markSeen(offset);
    markPromoSeen(promoId);
  };

  // src ของ iframe บทเรียน — เหมือนเดิม (?rel=0) + autoplay หลังโฆษณา + jsapi เฉพาะบทที่มี mid-roll (ไม่ใส่ fs=0 — คงปุ่มเต็มจอของ YouTube)
  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams({ rel: '0', playsinline: '1' });
    if (autoplay) params.set('autoplay', '1');
    if (hasMid) {
      params.set('enablejsapi', '1');
      params.set('origin', window.location.origin);
    }
    return `https://www.youtube.com/embed/${lesson.youtube_id}?${params.toString()}`;
  }, [lesson.youtube_id, autoplay, hasMid]);

  // mid-roll: ผูก YT.Player กับ iframe เดิม → poll เวลา → ถึง cue = (ออกจากเต็มจอ) + pause + overlay
  useEffect(() => {
    if (phase !== 'video' || !hasMid || !iframeRef.current) return;
    let cancelled = false;
    let poll: number | undefined;
    const stopPoll = () => { if (poll) { window.clearInterval(poll); poll = undefined; } };
    const exitFullscreenIfAny = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
      if (doc.fullscreenElement) { try { void doc.exitFullscreen?.()?.catch?.(() => { /* noop */ }); } catch { /* noop */ } }
      else if (doc.webkitFullscreenElement) { try { doc.webkitExitFullscreen?.(); } catch { /* noop */ } }
    };
    const check = () => {
      const p = playerRef.current;
      if (!p || activeMidRef.current) return;
      let t = 0;
      try { t = p.getCurrentTime() || 0; } catch { return; }
      const crossed = mids.filter((m) => !seenRef.current.has(m.offset_sec) && t >= m.offset_sec);
      if (crossed.length === 0) return;
      // seek ข้ามหลายจุด → ยิงเฉพาะจุดสุดท้าย (ทุกจุดที่ข้ามถือว่าเล่นแล้ว) · rewind ไม่เล่นซ้ำ
      crossed.forEach((m) => markSeen(m.offset_sec));
      const last = crossed[crossed.length - 1];
      // โฆษณาตัวนี้เพิ่งดูไป (ในบทนี้/ที่อื่น) ภายใน 7 วัน → ข้ามจุดนี้เงียบๆ
      if (isPromoOnCooldown(last.promo_id)) return;
      exitFullscreenIfAny();
      try { p.pauseVideo(); } catch { /* noop */ }
      activeMidRef.current = last;
      setActiveMid(last);
    };
    const startPoll = () => { if (!poll) poll = window.setInterval(check, 300); };
    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !iframeRef.current) return;
        playerRef.current = new YT.Player(iframeRef.current, {
          events: {
            onStateChange: (e) => {
              if (e.data === YT.PlayerState.PLAYING) startPoll();
              else stopPoll();
            },
          },
        });
        if (import.meta.env.DEV) (window as any).__lessonPlayer = playerRef.current; // debug เฉพาะ dev
      })
      .catch(() => { /* fail-open: ไม่มี mid-roll บทนี้ */ });
    return () => {
      cancelled = true;
      stopPoll();
      // ไม่เรียก destroy(): iframe เป็นของ React — destroy จะถอด node ออกเองแล้ว React unmount พัง
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hasMid, mids, lesson.id]);

  const handlePreDone = (result: 'ended' | 'skipped' | 'error') => {
    if (result !== 'error' && pre) markAdShown(0, pre.promo_id);
    setAutoplay(true);
    setPhase('video');
  };
  const handleMidDone = (result: 'ended' | 'skipped' | 'error') => {
    const slot = activeMidRef.current;
    if (result !== 'error' && slot) markAdShown(slot.offset_sec, slot.promo_id);
    activeMidRef.current = null;
    setActiveMid(null);
    try { playerRef.current?.playVideo(); } catch { /* noop */ }
  };

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

      {phase === 'pre' && pre && (
        <PromoPlayer key={`pre-${pre.promo_id}`} promoId={pre.promo_id} mode="pre" paused={paused} onDone={handlePreDone} />
      )}

      {phase === 'video' && (
        <>
          <iframe
            ref={iframeRef}
            key={lesson.id}
            id={`lesson-yt-${lesson.id}`}
            src={iframeSrc}
            title={lesson.title}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
          {activeMid && (
            <PromoPlayer key={`mid-${activeMid.offset_sec}`} promoId={activeMid.promo_id} mode="mid" paused={paused} onDone={handleMidDone} />
          )}
        </>
      )}
    </div>
  );
}

export default LessonVideoStage;
