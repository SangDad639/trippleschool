import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import PublicHeader from '@/components/PublicHeader';
import NetflixCard from '@/components/browse/NetflixCard';
import { type BrowseCourse } from '@/components/browse/browseRows';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Lightbulb } from 'lucide-react';

// Tip catalog (/tips): single-episode quick lessons — Netflix "movies" to the
// multi-episode courses' "series". One results grid is enough at this scale.
const TipsCatalog = () => {
  const navigate = useNavigate();
  const [tips, setTips] = useState<BrowseCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    api
      .getCourses({ type: 'tip' })
      .then(setTips)
      .catch((e) => console.error('Failed to load tips:', e))
      .finally(() => setLoading(false));
  }, []);

  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? tips.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query) ||
          c.instructor_name?.toLowerCase().includes(query)
      )
    : tips;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <PublicHeader />

      <div className="px-4 md:px-12 pt-8 pb-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Lightbulb className="h-7 w-7 text-[#FFB300]" />
            Tip
          </h1>
          <p className="text-gray-400 text-sm mt-1">บทเรียนสั้น เรียนจบในตอนเดียว</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหา Tip..."
            className="pl-10 bg-gray-800/50 border-gray-700 text-white h-11 md:h-9"
          />
        </div>
      </div>

      <div className="px-4 md:px-12 pb-16">
        {loading ? (
          <div className="flex items-center justify-center min-h-[40vh]">
            <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-center text-gray-400 py-20">
            {query ? 'ไม่พบ Tip ที่ค้นหา' : 'ยังไม่มี Tip ในตอนนี้ — กลับมาดูใหม่เร็วๆ นี้ 💡'}
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {visible.map((tip) => (
              <NetflixCard key={tip.id} course={tip} variant="grid" onClick={() => navigate(`/courses/${tip.slug}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TipsCatalog;
