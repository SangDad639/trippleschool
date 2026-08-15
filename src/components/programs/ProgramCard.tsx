import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Crown, ArrowRight, Download } from 'lucide-react';
import type { Program } from './programsData';

interface ProgramCardProps {
  program: Program;
}

// การ์ดโปรแกรมในหน้า /programs — จังหวะเดียวกับการ์ดคอร์ส (16:9, ชื่อวางบนแถบไล่สี,
// รายละเอียดโผล่ตอน hover) เพื่อให้ตะแกรงทั้งเว็บอ่านเป็นระบบเดียวกัน
const ProgramCard = ({ program }: ProgramCardProps) => (
  <Link
    to={`/programs/${program.slug}`}
    className="relative block aspect-video rounded-md overflow-hidden bg-gray-800 group/card transition-transform duration-300 hover:scale-105 hover:z-10 hover:shadow-2xl hover:shadow-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB300]/70"
  >
    <img
      src={program.thumbnail}
      alt={program.name}
      loading="lazy"
      className="absolute inset-0 w-full h-full object-cover object-top"
    />

    {/* Permanent bottom gradient + identity */}
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-12 pb-2.5 px-3">
      <div className="flex items-center gap-2">
        <img src={program.logo} alt="" className="h-5 w-auto shrink-0" />
        <h3 className="text-white text-sm font-semibold truncate drop-shadow">{program.name}</h3>
      </div>
      <p className="text-[11px] text-gray-400 truncate mt-0.5">{program.tagline}</p>

      {/* Meta revealed on hover */}
      <div className="max-h-0 opacity-0 group-hover/card:max-h-24 group-hover/card:opacity-100 group-hover/card:mt-2 transition-all duration-300 overflow-hidden">
        <div className="flex items-center gap-1.5 flex-wrap">
          {program.downloads.map((d) => (
            <span
              key={d.key}
              className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-200"
            >
              <d.icon className="h-2.5 w-2.5" />
              {d.platform}
            </span>
          ))}
        </div>
        <span className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-[#FFB300]">
          ดูรายละเอียด
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </div>

    {/* Hover download glyph — คู่ขนานกับปุ่ม play บนการ์ดคอร์ส */}
    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 pointer-events-none">
      <Download className="h-10 w-10 text-white/90 drop-shadow-lg -translate-y-4" />
    </div>

    <Badge className="absolute top-2 left-2 bg-black/60 backdrop-blur text-[#FFB300] border border-[#FFB300]/40 text-[10px] px-1.5 py-0.5">
      <Crown className="h-2.5 w-2.5 mr-1" /> สมาชิก
    </Badge>
  </Link>
);

export default ProgramCard;
