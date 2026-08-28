import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { api, type EbookDto } from '@/lib/api';
import { BookMarked, ArrowRight, Download, BookOpen, Lock, Crown } from 'lucide-react';

interface EbookCardProps {
  ebook: EbookDto;
}

// การ์ด Ebook ในหน้า /ebooks — จังหวะเดียวกับการ์ดโปรแกรม/บทความ (16:9, ชื่อบน
// แถบไล่สี, รายละเอียดโผล่ตอน hover) ป้าย/ไอคอนเปลี่ยนตามสิทธิ์จริงของเล่มนั้นๆ:
// เฉพาะสมาชิก (ล็อก), อ่านอย่างเดียว (ห้ามโหลด), หรือฟรีดาวน์โหลดได้ (ค่าเริ่มต้น)
const EbookCard = ({ ebook }: EbookCardProps) => {
  const locked = ebook.members_only && ebook.entitled === false;
  const viewOnly = !locked && ebook.allow_download === false;

  return (
    <Link
      to={`/ebooks/${ebook.slug}`}
      className="relative block aspect-video rounded-md overflow-hidden bg-gray-800 group/card transition-transform duration-300 hover:scale-105 hover:z-10 hover:shadow-2xl hover:shadow-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70"
    >
      {ebook.cover_url ? (
        <img
          src={api.mediaUrl(ebook.cover_url, 'card')}
          alt={ebook.title}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <BookMarked className="h-10 w-10 text-gray-600" />
        </div>
      )}

      {/* Permanent bottom gradient + title */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-12 pb-2.5 px-3">
        <h3 className="text-white text-sm font-semibold line-clamp-2 leading-snug drop-shadow">{ebook.title}</h3>

        {/* Meta revealed on hover */}
        <div className="max-h-0 opacity-0 group-hover/card:max-h-24 group-hover/card:opacity-100 group-hover/card:mt-1.5 transition-all duration-300 overflow-hidden">
          {ebook.description && <p className="text-[11px] text-gray-300 line-clamp-2">{ebook.description}</p>}
          <span className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${locked ? 'text-[#FFB300]' : 'text-emerald-400'}`}>
            {locked ? 'สำหรับสมาชิก' : viewOnly ? 'อ่านในเว็บ' : 'ดาวน์โหลดฟรี'}
            <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>

      {/* Hover glyph — คู่ขนานกับปุ่ม play บนการ์ดคอร์ส */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 pointer-events-none">
        {locked ? (
          <Lock className="h-10 w-10 text-white/90 drop-shadow-lg -translate-y-4" />
        ) : viewOnly ? (
          <BookOpen className="h-10 w-10 text-white/90 drop-shadow-lg -translate-y-4" />
        ) : (
          <Download className="h-10 w-10 text-white/90 drop-shadow-lg -translate-y-4" />
        )}
      </div>

      {locked ? (
        <Badge className="absolute top-2 left-2 bg-[#FFB300]/15 text-[#FFB300] border border-[#FFB300]/40 text-[10px] px-1.5 py-0.5 backdrop-blur">
          <Crown className="h-2.5 w-2.5 mr-1" /> สมาชิก
        </Badge>
      ) : (
        <Badge className="absolute top-2 left-2 bg-emerald-500/90 text-white border-0 text-[10px] px-1.5 py-0.5">
          ฟรี
        </Badge>
      )}
    </Link>
  );
};

export default EbookCard;
