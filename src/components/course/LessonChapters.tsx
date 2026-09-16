import { useEffect, useState, type RefObject } from 'react';
import { ChevronDown, ChevronUp, ListVideo } from 'lucide-react';
import { api } from '@/lib/api';
import { activeChapterIndex, formatSec } from '@/lib/chapters';
import type { LessonChapter } from '@/types/lesson';

/**
 * รายการ "📑 บทในคลิป" ใต้วิดีโอ — ผู้เรียนกดชื่อบทแล้ว player ข้ามไปเวลานั้น (onSeek) · ไฮไลต์บทที่ถึงแล้ว (currentSec)
 * ใช้ซ้ำในพรีวิวของแอดมิน (LessonChaptersEditor) · > 8 บทยุบไว้ กด "ดูทั้งหมด" (บทที่กำลังเล่นไม่ถูกซ่อน)
 */
interface Props {
  chapters: LessonChapter[];
  /** เวลาปัจจุบันของคลิป · null = ยังไม่ได้เล่น (ไม่ไฮไลต์อะไร) */
  currentSec: number | null;
  /** กำลังเล่นอยู่ → ป้าย "กำลังเล่น" · หยุด/ยังไม่เริ่ม → แค่ไฮไลต์ตำแหน่ง */
  playing?: boolean;
  onSeek: (sec: number) => void;
  /** จำนวนบทที่โชว์ก่อนยุบ (ค่าเริ่มต้น 8) · 0 = ไม่ยุบ */
  collapseAfter?: number;
  className?: string;
}

export function LessonChapters({ chapters, currentSec, playing = false, onSeek, collapseAfter = 8, className = '' }: Props) {
  /** null = ผู้ใช้ยังไม่ได้เลือก → ยุบตามค่าเริ่มต้น */
  const [expanded, setExpanded] = useState<boolean | null>(null);
  if (!chapters.length) return null;
  const active = activeChapterIndex(chapters, currentSec);
  const collapsible = collapseAfter > 0 && chapters.length > collapseAfter;
  const showAll = !collapsible || (expanded ?? false);
  // ยุบอยู่แต่บทที่ถึงแล้วอยู่เลยขอบ → โชว์แถวนั้นต่อท้ายให้เห็นว่าอยู่ตรงไหน
  const visible = showAll
    ? chapters.map((c, i) => ({ c, i }))
    : [
        ...chapters.slice(0, collapseAfter).map((c, i) => ({ c, i })),
        ...(active >= collapseAfter ? [{ c: chapters[active], i: active }] : []),
      ];

  return (
    <div className={className} data-testid="lesson-chapters">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-white flex items-center gap-1.5">
          <ListVideo className="h-4 w-4 text-purple-400" /> บทในคลิป
          <span className="text-xs text-gray-500 font-normal">({chapters.length})</span>
        </p>
        <span className="text-[11px] text-gray-500">กดเพื่อข้ามไปช่วงนั้น</span>
      </div>
      <ul className="flex flex-col gap-1 m-0 p-0 list-none">
        {visible.map(({ c, i }) => {
          const isActive = i === active;
          return (
            <li key={`${c.sec}-${i}`}>
              <button
                type="button"
                onClick={() => onSeek(c.sec)}
                aria-current={isActive ? 'true' : undefined}
                data-testid="chapter-row"
                data-sec={c.sec}
                className={`w-full min-h-11 flex items-center gap-3 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                  isActive
                    ? 'bg-purple-500/15 border-purple-400/50'
                    : 'border-transparent hover:bg-white/5 active:bg-white/10'
                }`}
              >
                {/* ภาพเฟรมจาก storyboard ของ YouTube (ถ้ามี) — แบบเดียวกับแผง Chapters ของ YouTube */}
                {c.thumb && (
                  <img
                    src={api.mediaUrl(c.thumb)}
                    alt=""
                    loading="lazy"
                    className={`shrink-0 w-16 h-9 sm:w-20 sm:h-[45px] rounded object-cover bg-black/40 border ${isActive ? 'border-purple-400/60' : 'border-white/10'}`}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <span
                  className={`shrink-0 min-w-[52px] text-center rounded px-1.5 py-0.5 text-xs tabular-nums ${
                    isActive ? 'bg-purple-600 text-white' : 'bg-purple-500/10 text-purple-300 border border-purple-400/30'
                  }`}
                >
                  {formatSec(c.sec)}
                </span>
                <span className={`flex-1 text-sm leading-snug ${isActive ? 'text-white' : 'text-gray-200'}`}>{c.title}</span>
                {isActive && playing && <span className="shrink-0 text-[11px] text-purple-300">กำลังเล่น</span>}
              </button>
            </li>
          );
        })}
        {collapsible && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(!showAll)}
              className="w-full min-h-9 flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-white"
              data-testid="chapters-toggle"
            >
              {showAll ? (
                <><ChevronUp className="h-3.5 w-3.5" /> ย่อรายการ</>
              ) : (
                <><ChevronDown className="h-3.5 w-3.5" /> ดูทั้งหมด ({chapters.length} บท)</>
              )}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/** สิ่งที่ player ต้องมีให้แผงนี้ (LessonVideoStageHandle) — ใช้ structural type จะได้ไม่ import วน */
interface StageLike {
  seekTo(sec: number): void;
  /** null = ยังไม่ได้เริ่มเล่น (ปก/โฆษณา/ยังไม่กด) */
  getPlayback(): { sec: number; playing: boolean } | null;
}

/**
 * แผงบทในคลิปสำหรับหน้าเรียน — poll เวลาจาก player เองทุก 500 ms (state อยู่ในนี้ ไม่ re-render ทั้งหน้า)
 * กดบท → stage.seekTo · เวลาใน state อัปเดตทันทีให้ไฮไลต์ไม่หน่วง · ก่อนเริ่มเล่นไม่ไฮไลต์บทไหนเลย
 */
export function LessonChaptersPanel({ chapters, stageRef, className }: { chapters: LessonChapter[]; stageRef: RefObject<StageLike | null>; className?: string }) {
  const [pb, setPb] = useState<{ sec: number; playing: boolean } | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => {
      const p = stageRef.current?.getPlayback() ?? null;
      setPb((prev) => {
        if (!p) return prev; // ยังไม่ได้เล่น หรือ player หาย → คงค่าล่าสุด (ไม่กระโดดกลับ 0)
        if (prev && Math.abs(prev.sec - p.sec) < 0.5 && prev.playing === p.playing) return prev;
        return p;
      });
    }, 500);
    return () => window.clearInterval(t);
  }, [stageRef]);
  return (
    <LessonChapters
      chapters={chapters}
      currentSec={pb ? pb.sec : null}
      playing={!!pb?.playing}
      onSeek={(s) => { stageRef.current?.seekTo(s); setPb({ sec: s, playing: true }); }}
      className={className}
    />
  );
}

export default LessonChapters;
