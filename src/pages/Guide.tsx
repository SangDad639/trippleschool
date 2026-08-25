import { useState } from 'react';
import PublicHeader from '@/components/PublicHeader';
import ClipCard from '@/components/guide/ClipCard';
import { CLIPS, clipEmbedUrl, type GuideClip } from '@/components/guide/clipsData';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * /guide - hidden clip page. Not in PublicHeader's NAV_ITEMS, no auth gate,
 * no subscription gate, no API calls: anyone with the link can watch.
 *
 * Clips live in src/components/guide/clipsData.ts (edit CLIPS to add/remove).
 * Cards load thumbnails only; the YouTube iframe mounts after a click, so a
 * page full of clips stays light on mobile.
 *
 * The earlier 12-article manual is parked, unused, in components/guide/
 * (see GuideCenter.tsx for how to switch it back on).
 */
const Guide = () => {
  const [playing, setPlaying] = useState<GuideClip | null>(null);

  return (
    <>
      <PublicHeader />
      <div className="page-wrapper">
        <div className="mx-auto min-h-[70vh] max-w-6xl px-4 py-10 md:px-6">
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {CLIPS.map((clip, i) => (
              <ClipCard key={clip.id} clip={clip} slot={i + 1} onPlay={setPlaying} />
            ))}
          </div>
        </div>
      </div>

      {/* เล่นคลิปในป๊อปอัป - ปิดแล้ว iframe ถูกถอดออก วิดีโอจึงหยุดเองทันที */}
      <Dialog open={!!playing} onOpenChange={(open) => !open && setPlaying(null)}>
        <DialogContent
          className="max-w-4xl border-zinc-800 bg-zinc-950 p-0 sm:rounded-2xl"
          // กันโฟกัสวิ่งเข้า iframe ของ YouTube ตอนเปิด ไม่งั้นปุ่ม Esc จะไปตกในเฟรม
          // ข้ามโดเมนและปิดป๊อปอัปไม่ได้ (ปุ่ม X กับคลิกพื้นหลังยังใช้ได้เหมือนเดิม)
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {playing && (
            <>
              <DialogTitle className="px-5 pb-3 pt-5 pr-12 text-base text-white">{playing.title}</DialogTitle>
              <div className="aspect-video w-full overflow-hidden rounded-b-2xl bg-black">
                <iframe
                  src={clipEmbedUrl(playing)}
                  title={playing.title}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Guide;
