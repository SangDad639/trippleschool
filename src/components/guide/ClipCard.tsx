import { Play, Youtube, ExternalLink } from 'lucide-react';
import { clipThumbnail, hasClip, type GuideClip } from './clipsData';

interface ClipCardProps {
  clip: GuideClip;
  /** ลำดับช่อง (1, 2, 3...) โชว์บนกรอบว่างให้รู้ว่าตรงกับสล็อตไหนใน clipsData */
  slot: number;
  onPlay: (clip: GuideClip) => void;
}

/**
 * การ์ดคลิปบนหน้า /guide
 * - ยังไม่ใส่ลิงก์คลิป → กรอบประ "รอใส่คลิป" กดไม่ได้
 * - ใส่แล้ว → ภาพปกจาก YouTube + ปุ่มเล่น กดที่ภาพหรือชื่อคลิปเพื่อเปิดป๊อปอัป
 * - ถ้าคลิปนั้นมี `links` จะมีปุ่มลิงก์ใต้การ์ด กดแล้วเปิดแท็บใหม่
 *
 * หมายเหตุโครงสร้าง: ปุ่มเล่นกับปุ่มลิงก์ต้องแยกอิลิเมนต์กัน ห้ามเอา <a> ไปซ้อนใน
 * <button> (HTML ไม่ให้ซ้อน interactive element และคลิกจะชนกันเอง)
 */
const ClipCard = ({ clip, slot, onPlay }: ClipCardProps) => {
  if (!hasClip(clip)) {
    return (
      <div>
        <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700/80 bg-zinc-900/30">
          <Youtube className="h-6 w-6 text-zinc-600" />
          <p className="text-xs text-zinc-600">รอใส่คลิป</p>
        </div>
        <div className="px-0.5 pt-2.5">
          <p className="text-sm font-medium text-zinc-600">ช่องที่ {slot}</p>
        </div>
      </div>
    );
  }

  const thumb = clipThumbnail(clip);
  const title = clip.title || `ช่องที่ ${slot}`;
  const links = clip.links || [];

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => onPlay(clip)}
        className="block w-full"
        aria-label={`เล่นคลิป ${title}`}
      >
        <div className="relative aspect-video overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-colors group-hover:border-[#FFB300]/60">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              onError={(e) => {
                // คลิปเก่าบางตัวไม่มี maxresdefault — ถอยไปใช้ hqdefault
                const img = e.currentTarget;
                if (img.src.includes('maxresdefault')) img.src = img.src.replace('maxresdefault', 'hqdefault');
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">ไม่มีภาพปก</div>
          )}

          {/* ฟิล์มดำบางๆ ให้ปุ่มเล่นเด่นขึ้น เข้มขึ้นตอน hover */}
          <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/45" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFB300] shadow-lg transition-transform duration-300 group-hover:scale-110">
              <Play className="ml-0.5 h-5 w-5 fill-black text-black" />
            </span>
          </span>
        </div>
      </button>

      <div className="px-0.5 pt-2.5">
        <button
          type="button"
          onClick={() => onPlay(clip)}
          className="line-clamp-2 block text-left text-sm font-medium leading-snug text-white transition-colors group-hover:text-[#FFB300]"
        >
          {title}
        </button>
        {clip.subtitle && <p className="mt-1 text-xs text-zinc-500">{clip.subtitle}</p>}

        {links.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
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

export default ClipCard;
