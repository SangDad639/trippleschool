import { parseVideoUrl } from '@/lib/parseVideoUrl';
import { PlayCircle, ExternalLink } from 'lucide-react';

interface ProgramVideoProps {
  /** เว้นว่างได้ — จะขึ้นกรอบ "เร็วๆ นี้" กันหลุมในเลย์เอาต์ */
  url?: string;
  title: string;
  /** ภาพนิ่งที่โชว์ก่อนกดเล่น (ใช้กับไฟล์วิดีโอตรงเท่านั้น) */
  poster?: string;
}

const FRAME = 'w-full aspect-video rounded-lg border border-gray-800 bg-black shadow-2xl shadow-black/50';

// วิดีโอตัวอย่างการใช้งานโปรแกรม — รองรับทั้ง YouTube และไฟล์วิดีโอตรง (mp4/webm/mov)
// ตั้งใจไม่ autoplay เพราะเป็นคลิปเดโมเสียงพากย์ ต้องให้ผู้ใช้กดเล่นเองถึงจะได้ยิน
const ProgramVideo = ({ url, title, poster }: ProgramVideoProps) => {
  // ยังไม่มีลิงก์ — วางกรอบเปล่าไว้แทน ให้เลย์เอาต์นิ่งตั้งแต่วันนี้
  // ใช้ขอบประ + พื้นจุดชุดเดียวกับการ์ด "เร็วๆ นี้" ในหน้า /programs
  if (!url) {
    return (
      <div
        className="w-full aspect-video rounded-lg border border-dashed border-gray-700/80 bg-gray-900/20 flex flex-col items-center justify-center gap-2 text-center px-6"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,179,0,0.07) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      >
        <PlayCircle className="h-10 w-10 text-[#FFB300]" />
        <p className="text-sm font-semibold text-gray-300">วิดีโอตัวอย่างเร็วๆ นี้</p>
        <p className="text-xs text-gray-500 max-w-[18rem] leading-relaxed">
          กำลังตัดคลิปสาธิตการใช้งานอยู่ — ระหว่างนี้ดูภาพหน้าจอด้านล่างไปก่อนได้เลย
        </p>
      </div>
    );
  }

  const { type, embedUrl, videoId } = parseVideoUrl(url);

  if (type === 'youtube' && videoId) {
    return (
      <div className={`${FRAME} overflow-hidden`}>
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?rel=0`}
          title={title}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  if (type === 'direct' && embedUrl) {
    return (
      <video
        src={embedUrl}
        poster={poster}
        title={title}
        controls
        preload="metadata"
        playsInline
        className={`${FRAME} object-contain`}
      />
    );
  }

  // ลิงก์ที่ฝังในหน้าไม่ได้ (เช่น Sora) หรือรูปแบบที่ยังไม่รองรับ — อย่างน้อยต้องกดเปิดดูได้
  // ไม่ปล่อยให้หายเงียบจนคนแปะลิงก์ผิดแล้วไม่รู้ตัว
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${FRAME} flex flex-col items-center justify-center gap-2 text-gray-300 hover:text-white hover:border-[#FFB300]/50 transition-colors`}
    >
      <PlayCircle className="h-10 w-10 text-[#FFB300]" />
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {title}
        <ExternalLink className="h-3.5 w-3.5" />
      </span>
    </a>
  );
};

export default ProgramVideo;
