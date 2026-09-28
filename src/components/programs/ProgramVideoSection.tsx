import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import ProgramVideo from './ProgramVideo';
import type { Program } from './programsData';
import { PlayCircle, BookOpen, ExternalLink } from 'lucide-react';

type ClipLink = { label: string; url: string };
type Clip = { id: number | string; title: string; url: string; links: ClipLink[] };

/** server ตรวจไว้แล้ว — กันซ้ำฝั่งนี้อีกชั้นเพราะค่าไปลง href ตรงๆ */
const isSafeHref = (url: string) => /^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url);

interface ProgramVideoSectionProps {
  program: Program;
}

// คลิปคู่มือบนหน้า /programs/:slug — แอดมินใส่เองที่ /admin/programs (ตาราง program_videos)
// มีคลิปเดียว = โชว์เหมือนเดิม · หลายคลิป = มีรายการให้กดสลับใต้ตัวเล่น
const ProgramVideoSection = ({ program }: ProgramVideoSectionProps) => {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [activeId, setActiveId] = useState<Clip['id'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setClips(null);
    setActiveId(null);

    api
      .getProgramVideos(program.slug)
      .then((rows) =>
        rows.map(
          (r): Clip => ({
            id: r.id,
            title: r.title,
            url: r.url,
            links: (Array.isArray(r.links) ? r.links : []).filter((l) => l?.url && isSafeHref(l.url)),
          }),
        ),
      )
      .catch((err) => {
        // โหลดจาก API ไม่ได้ ไม่ต้องให้ผู้เข้าชมเห็น error — ตกไปใช้ลิงก์สำรองด้านล่างแทน
        console.warn('[programs] load videos failed:', err?.message);
        return [] as Clip[];
      })
      .then((fromApi) => {
        if (cancelled) return;
        // ลิงก์สำรองจาก env var ใน programsData.ts ใช้เฉพาะตอนที่ยังไม่มีคลิปใน DB
        const fallback: Clip[] = program.videoUrl
          ? [{ id: 'fallback', title: '', url: program.videoUrl, links: [] }]
          : [];
        setClips(fromApi.length > 0 ? fromApi : fallback);
      });

    return () => {
      cancelled = true;
    };
  }, [program.slug, program.videoUrl]);

  // กรอบเปล่าระหว่างโหลด — ไม่โชว์ "เร็วๆ นี้" แวบขึ้นมาก่อนคลิปจริง
  if (clips === null) {
    return <div className="w-full aspect-video rounded-lg border border-gray-800 bg-gray-900/40 animate-pulse" />;
  }

  const active = clips.find((c) => c.id === activeId) ?? clips[0];
  const titleOf = (clip: Clip, index: number) => clip.title || `คลิปที่ ${index + 1}`;

  return (
    <>
      <ProgramVideo
        key={active?.id}
        url={active?.url}
        title={active?.title || `วิดีโอตัวอย่าง ${program.name}`}
        poster={program.thumbnail}
      />

      {/* ลิงก์คู่มือของคลิปที่กำลังเล่น */}
      {active && active.links.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="program-clip-links">
          {active.links.map((link, i) => (
            <a
              key={`${link.url}-${i}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[#FFB300]/40 bg-[#FFB300]/5 px-3 py-1.5 text-xs font-medium text-[#FFB300] transition-colors hover:bg-[#FFB300]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB300]/70"
            >
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{link.label}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
            </a>
          ))}
        </div>
      )}

      {clips.length > 1 && (
        <div data-testid="program-clip-list">
          <p className="text-xs font-semibold text-gray-400 mb-1.5">
            คลิปคู่มือการใช้งาน · {clips.length} คลิป
          </p>
          <div className="flex flex-col gap-1.5">
            {clips.map((clip, index) => {
              const isActive = clip.id === active?.id;
              return (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => setActiveId(clip.id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB300]/70 ${
                    isActive
                      ? 'border-[#FFB300]/50 bg-[#FFB300]/10 text-white'
                      : 'border-gray-800 bg-gray-900/40 text-gray-300 hover:border-gray-700 hover:text-white'
                  }`}
                >
                  <span className="w-5 shrink-0 text-center text-xs text-gray-500">{index + 1}</span>
                  <PlayCircle className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#FFB300]' : 'text-gray-500'}`} />
                  <span className="min-w-0 flex-1 truncate">{titleOf(clip, index)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};

export default ProgramVideoSection;
