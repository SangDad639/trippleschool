import { api } from '@/lib/api';

export interface EbookSampleItem {
  type: 'image' | 'youtube';
  url?: string;
  youtube_id?: string;
  orientation: 'landscape' | 'portrait';
  title?: string;
}

// แกลเลอรี "ตัวอย่างผลงาน" ของหน้า Ebook — แยก component จากฝั่งคอร์สตามที่ user สั่ง
// (โครงเริ่มจากตัวคอร์ส แต่ต่อจากนี้ปรับฝั่งไหนไม่กระทบอีกฝั่ง)
// จัดกลุ่ม: แนวนอนก่อนแล้วค่อยแนวตั้ง — แนวนอนใหญ่เต็มความกว้าง "แถวละ 1"
// (คลิป YouTube ดูชัดกดเล่นได้เลย) · แนวตั้ง "แถวละ 2" ทุกขนาดจอ
const EbookSamplesGallery = ({ samples }: { samples: EbookSampleItem[] }) => {
  const landscape = samples.filter((s) => s.orientation !== 'portrait');
  const portrait = samples.filter((s) => s.orientation === 'portrait');

  const renderItem = (s: EbookSampleItem, i: number) => (
    <figure key={`${s.orientation}-${i}`} className="min-w-0">
      <div
        className={`dark-stage relative rounded-xl overflow-hidden border border-gray-700 bg-gray-900 ${
          s.orientation === 'portrait' ? 'aspect-[9/16]' : 'aspect-video'
        }`}
      >
        {s.type === 'youtube' ? (
          <iframe
            src={`https://www.youtube.com/embed/${s.youtube_id}?rel=0`}
            title={s.title || 'ตัวอย่างผลงาน'}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <img
            src={api.mediaUrl(s.url)}
            alt={s.title || 'ตัวอย่างผลงาน'}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
      </div>
      {s.title && (
        <figcaption className="mt-1.5 text-xs text-gray-400 line-clamp-2">{s.title}</figcaption>
      )}
    </figure>
  );

  return (
    <div className="space-y-3 sm:space-y-4">
      {landscape.length > 0 && (
        <div className="grid gap-4 grid-cols-1">
          {landscape.map(renderItem)}
        </div>
      )}
      {portrait.length > 0 && (
        <div className="grid gap-3 sm:gap-4 grid-cols-2">
          {portrait.map(renderItem)}
        </div>
      )}
    </div>
  );
};

export default EbookSamplesGallery;
