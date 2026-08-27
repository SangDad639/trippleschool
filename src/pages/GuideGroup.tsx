import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PublicHeader from '@/components/PublicHeader';
import { api, type GuideClipDto, type GuideGroupDto } from '@/lib/api';
import { clipEmbedUrl, clipThumbnail } from '@/components/guide/clipsData';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowLeft,
  Loader2,
  Play,
  PlayCircle,
  BookOpen,
  ExternalLink,
} from 'lucide-react';

/**
 * /guide/:slug — one manual group, shaped like a course detail page: cover and
 * summary up top, then the clip list where a course lists its lessons.
 *
 * Public like the rest of /guide (no login, no plan). A clip plays in a popup
 * instead of its own page: the iframe mounts on click and is torn down on close,
 * so nothing keeps playing behind the page.
 */
const GuideGroup = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GuideGroupDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<GuideClipDto | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api
      .getGuideGroup(slug)
      .then(setGroup)
      .catch(() => setGroup(null))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader />
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#FFB300]" />
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-gray-400">ไม่พบคู่มือชุดนี้</p>
          <Button onClick={() => navigate('/guide')} className="bg-[#FFB300] text-black hover:bg-[#FFB300]/90">
            กลับหน้าคู่มือ
          </Button>
        </div>
      </div>
    );
  }

  const clips = group.clips || [];

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <PublicHeader />

      {/* ── หัวเรื่อง: ปก + ชื่อ + คำอธิบาย (ทรงเดียวกับหัวหน้าคอร์ส) ── */}
      <section className="border-b border-gray-800 bg-gradient-to-b from-gray-900/60 to-background">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-12">
          <button
            onClick={() => navigate('/guide')}
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> คู่มือทั้งหมด
          </button>

          <div className="flex flex-col gap-5 md:flex-row">
            <div className="aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-gray-800 md:w-72">
              {group.cover_url ? (
                <img
                  src={api.mediaUrl(group.cover_url, 'hero')}
                  alt={group.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                  <BookOpen className="h-10 w-10 text-zinc-600" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold md:text-3xl">{group.title}</h1>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-400">
                <PlayCircle className="h-4 w-4 text-[#FFB300]" />
                {clips.length} คลิป · ดูฟรีทุกคน
              </p>
              {group.description && (
                <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{group.description}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── รายการคลิป: แถวแบบเดียวกับ "เนื้อหาคอร์ส" ── */}
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-12">
        <Card>
          <CardHeader className="px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <BookOpen className="h-4 w-4" /> คลิปในคู่มือชุดนี้
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {clips.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">ยังไม่มีคลิปในชุดนี้</p>
            ) : (
              <div className="space-y-2">
                {clips.map((clip, index) => (
                  <ClipRow key={clip.id} clip={clip} index={index} onPlay={() => setPlaying(clip)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ปิดป๊อปอัป = iframe ถูกถอด วิดีโอจึงหยุดเองทันที */}
      <Dialog open={!!playing} onOpenChange={(open) => !open && setPlaying(null)}>
        <DialogContent
          className="max-w-4xl border-zinc-800 bg-zinc-950 p-0 sm:rounded-2xl"
          // กันโฟกัสวิ่งเข้า iframe ตอนเปิด ไม่งั้น Esc จะไปตกในเฟรมข้ามโดเมนแล้วปิดไม่ได้
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-describedby={undefined}
        >
          {playing && (
            <>
              <DialogTitle className="px-5 pb-3 pr-12 pt-5 text-base text-white">
                {playing.title || 'คลิปคู่มือ'}
              </DialogTitle>
              <div className="aspect-video w-full overflow-hidden rounded-b-2xl bg-black">
                <iframe
                  src={clipEmbedUrl(playing)}
                  title={playing.title || 'คลิปคู่มือ'}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

/** แถวคลิป — ปกซ้าย ข้อมูลขวา เหมือนแถวบทเรียนในหน้าคอร์ส */
const ClipRow = ({ clip, index, onPlay }: { clip: GuideClipDto; index: number; onPlay: () => void }) => {
  const thumb = clipThumbnail(clip);

  return (
    // คลิกได้ทั้งแถว — ปุ่มลิงก์ข้างในกัน bubble ไว้แล้ว จึงไม่เปิดคลิปตามไปด้วย
    <div
      onClick={onPlay}
      className="group flex cursor-pointer gap-3 rounded-lg bg-gray-800/40 p-2 transition-colors hover:bg-gray-800"
    >
      <div className="relative aspect-video w-28 flex-none overflow-hidden rounded-md bg-gradient-to-br from-gray-700 to-gray-800 sm:w-36 md:w-44">
        {thumb && (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              // คลิปเก่าบางตัวไม่มี maxresdefault — ถอยไปใช้ hqdefault
              const img = e.currentTarget;
              if (img.src.includes('maxresdefault')) img.src = img.src.replace('maxresdefault', 'hqdefault');
            }}
          />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/45">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FFB300] shadow-lg transition-transform group-hover:scale-110">
            <Play className="ml-0.5 h-4 w-4 fill-black text-black" />
          </span>
        </span>
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        <p className="line-clamp-2 text-sm font-medium text-white">
          <span className="mr-1.5 text-gray-500">{index + 1}.</span>
          {clip.title || `คลิปที่ ${index + 1}`}
        </p>
        {clip.subtitle && <p className="mt-0.5 text-xs text-gray-400">{clip.subtitle}</p>}

        {clip.links?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {clip.links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-full border border-[#FFB300]/30 bg-[#FFB300]/10 px-2.5 py-1 text-[11px] font-medium text-[#FFB300] transition-colors hover:bg-[#FFB300]/20"
              >
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GuideGroup;
