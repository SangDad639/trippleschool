import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { api, type ArticleDto } from '@/lib/api';
import { BookOpen, ArrowRight, Newspaper, Sparkles } from 'lucide-react';

interface ArticleCardProps {
  article: ArticleDto;
}

const isNewArticle = (createdAt?: string) =>
  !!createdAt && Date.now() - new Date(createdAt).getTime() < 14 * 24 * 60 * 60 * 1000;

// การ์ดบทความในหน้า /content — จังหวะเดียวกับการ์ดคอร์ส/โปรแกรม (16:9, ชื่อบน
// แถบไล่สี, รายละเอียดโผล่ตอน hover) เพื่อให้ตะแกรงทั้งเว็บอ่านเป็นระบบเดียวกัน
const ArticleCard = ({ article }: ArticleCardProps) => (
  <Link
    to={`/content/${article.slug}`}
    className="relative block aspect-video rounded-md overflow-hidden bg-gray-800 group/card transition-transform duration-300 hover:scale-105 hover:z-10 hover:shadow-2xl hover:shadow-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
  >
    {article.cover_url ? (
      <img
        src={api.mediaUrl(article.cover_url, 'card')}
        alt={article.title}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
      />
    ) : (
      <div className="absolute inset-0 flex items-center justify-center">
        <Newspaper className="h-10 w-10 text-gray-600" />
      </div>
    )}

    {/* Permanent bottom gradient + title */}
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-12 pb-2.5 px-3">
      <h3 className="text-white text-sm font-semibold line-clamp-2 leading-snug drop-shadow">{article.title}</h3>

      {/* Meta revealed on hover */}
      <div className="max-h-0 opacity-0 group-hover/card:max-h-24 group-hover/card:opacity-100 group-hover/card:mt-1.5 transition-all duration-300 overflow-hidden">
        {article.excerpt && <p className="text-[11px] text-gray-300 line-clamp-2">{article.excerpt}</p>}
        <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary">
          อ่านบทความ
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </div>

    {/* Hover read glyph — คู่ขนานกับปุ่ม play บนการ์ดคอร์ส */}
    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 pointer-events-none">
      <BookOpen className="h-10 w-10 text-white/90 drop-shadow-lg -translate-y-4" />
    </div>

    {isNewArticle(article.created_at) && (
      <Badge className="absolute top-2 left-2 bg-green-500/90 text-white text-[10px] px-1.5 py-0.5">
        <Sparkles className="h-2.5 w-2.5 mr-1" /> ใหม่
      </Badge>
    )}
  </Link>
);

export default ArticleCard;
