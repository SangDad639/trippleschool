import { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { PromoPlayer } from '@/components/course/PromoPlayer';
import { markPromoSeen } from '@/lib/promoFrequency';

/**
 * player ของบทเรียนที่ "มีโฆษณาก่อนเริ่ม" (CourseLearn ตัดสินแล้วว่าบทนี้ต้องเล่นโฆษณา — ไม่ต้อง → ใช้ iframe เดิมเป๊ะ)
 *
 *   poster (ปกบท + ▶ อย่างเดียว)  →  pre-roll <PromoPlayer>  →  YouTube iframe (+autoplay)
 *
 * กติกา (user 8-10 ก.ย. 2026):
 * - โฆษณามี "ก่อนเริ่มคลิป" อย่างเดียว ตัวเดียวทุกคลิป (071 ถอด mid-roll/จุดแทรกรายบทแล้ว)
 * - กด ▶ ก่อน = user gesture → โฆษณามีเสียงบนมือถือ · ปุ่มอย่างเดียว ไม่มีข้อความ
 * - ความถี่นับต่อ "ผู้เรียน": โฆษณาเริ่มเล่น 1 ครั้ง → `markPromoSeen` ทันที (localStorage + เซิร์ฟเวอร์ถ้าล็อกอิน) → ไม่เห็นอีกจนครบ N วัน
 * - ไม่มีปุ่มเต็มจอของเรา (user ตัดออก) → คง allowFullScreen ของ YouTube
 * - fail-open: โฆษณาพัง/โหลดไม่ได้ → ข้ามเข้าบทเรียนทันที
 */
export interface StageLesson { id: number; title: string; youtube_id: string }
interface Props {
  lesson: StageLesson;
  /** โฆษณาที่จะเล่นก่อนเริ่ม (จาก course.pre_roll_promo_id) */
  promoId: number;
  /** ปกบทสำหรับหน้า poster (เช่น /api/courses/lessons/:id/thumb) */
  posterUrl: string;
  /** หยุดโฆษณาชั่วคราว (drawer รายการบทเปิดทับบนมือถือ) */
  paused?: boolean;
}

export function LessonVideoStage({ lesson, promoId, posterUrl, paused = false }: Props) {
  const [phase, setPhase] = useState<'poster' | 'pre' | 'video'>('poster');
  const [posterFailed, setPosterFailed] = useState(false);
  /** กัน POST /seen ซ้ำ (onStart + fallback ตอนจบ/ข้าม) */
  const markedRef = useRef(false);

  /** โฆษณาเริ่มเล่น = เห็นแล้ว 1 ครั้ง → เริ่มนับ N วันสำหรับผู้เรียนคนนี้ */
  const markAdShown = () => {
    if (markedRef.current) return;
    markedRef.current = true;
    markPromoSeen(promoId);
  };
  const handlePreDone = (result: 'ended' | 'skipped' | 'error') => {
    // เผื่อกรณีเล่นไม่ได้แล้วข้าม (ไม่เคย playing) — ข้าม = เห็นแล้วเหมือนกัน · error = ไม่นับ
    if (result !== 'error') markAdShown();
    setPhase('video');
  };

  // iframe บทเรียน — เหมือนเดิม (?rel=0) + autoplay ต่อจากโฆษณา (ไม่ใส่ fs=0 — คงปุ่มเต็มจอของ YouTube)
  const iframeSrc = `https://www.youtube.com/embed/${lesson.youtube_id}?rel=0&playsinline=1&autoplay=1`;

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

      {phase === 'pre' && (
        <PromoPlayer
          key={`pre-${promoId}`}
          promoId={promoId}
          paused={paused}
          onStart={markAdShown}
          onDone={handlePreDone}
        />
      )}

      {phase === 'video' && (
        <iframe
          key={lesson.id}
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
}

export default LessonVideoStage;
