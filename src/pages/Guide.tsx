import { useEffect, useState } from 'react';
import PublicHeader from '@/components/PublicHeader';
import ClipCard from '@/components/guide/ClipCard';
import { CLIPS, clipEmbedUrl, type GuideClip } from '@/components/guide/clipsData';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';

/**
 * /guide - hidden clip page. Not in PublicHeader's NAV_ITEMS, no auth gate,
 * no subscription gate: anyone with the link can watch. It is linked from the
 * Triple Bot desktop app's login screen, where the reader has no session yet.
 *
 * Clips come from the DB (admin manages them at /admin/guide), so publishing a
 * clip needs no deploy. CLIPS in clipsData.ts is the fallback rendered when the
 * API is unreachable, and the source of the build-time /guide-clips.json.
 *
 * Cards load thumbnails only; the YouTube iframe mounts on click and is torn
 * down on close, so a page full of clips stays light and a closed clip stops.
 */
const Guide = () => {
  const [clips, setClips] = useState<GuideClip[]>(CLIPS);
  const [playing, setPlaying] = useState<GuideClip | null>(null);

  useEffect(() => {
    api
      .getGuideClips()
      .then((rows) => {
        // An empty table means the admin cleared it on purpose - show nothing
        // rather than resurrecting the hardcoded fallback list.
        if (Array.isArray(rows)) setClips(rows as GuideClip[]);
      })
      .catch(() => {
        /* keep the bundled fallback */
      });
  }, []);

  return (
    <>
      <PublicHeader />
      <div className="page-wrapper">
        <div className="mx-auto min-h-[70vh] max-w-6xl px-4 py-10 md:px-6">
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {clips.map((clip, i) => (
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
          // ป๊อปอัปนี้มีแค่วิดีโอ ไม่มีคำอธิบายให้อ่าน — บอก Radix ว่าตั้งใจ ไม่ใช่ลืม
          aria-describedby={undefined}
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
