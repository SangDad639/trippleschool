import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PublicHeader from '@/components/PublicHeader';
import HeroBillboard from '@/components/browse/HeroBillboard';
import NetflixRow from '@/components/browse/NetflixRow';
import NetflixCard from '@/components/browse/NetflixCard';
import { buildRows, type BrowseCourse } from '@/components/browse/browseRows';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface ContinueItem {
  course_id: number;
  course_slug: string;
  course_name: string;
  thumbnail_url: string;
  total_lessons: number;
  progress_percent: number;
  last_lesson_id: number | null;
  updated_at: string;
}

// Netflix-style storefront: full-bleed billboard + horizontal rails.
// Typing in the header search crossfades the whole browse surface into a
// results grid (Netflix idiom); clearing restores it. Query lives in ?q=.
const Storefront = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [courses, setCourses] = useState<BrowseCourse[]>([]);
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');

  // Keep ?q= in the URL so refresh/share preserves the search.
  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (current === searchQuery) return;
    setSearchParams(searchQuery ? { q: searchQuery } : {}, { replace: true });
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api
      .getCourses()
      .then(setCourses)
      .catch((e) => console.error('Failed to load courses:', e))
      .finally(() => setLoading(false));
  }, []);

  // Continue-watching rail (logged-in only, most recent first).
  useEffect(() => {
    if (!user) {
      setContinueItems([]);
      return;
    }
    api
      .getMyEnrollments('approved')
      .then((rows: ContinueItem[]) =>
        setContinueItems(
          rows
            .filter((r) => r.progress_percent > 0 && r.progress_percent < 100)
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        )
      )
      .catch(() => setContinueItems([]));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const featured = courses.filter((c) => c.is_featured);
  const billboard = featured[0] || courses[0] || null;
  const rows = buildRows(courses);

  const query = searchQuery.trim().toLowerCase();
  const searchResults = query
    ? courses.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query) ||
          c.instructor_name?.toLowerCase().includes(query)
      )
    : [];

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader />
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
        </div>
      </div>
    );
  }

  if (query) {
    return (
      <div className="min-h-screen bg-background text-foreground overflow-x-clip">
        <PublicHeader overlay search={{ query: searchQuery, onChange: setSearchQuery }} />
        <div key="results" className="pt-24 px-4 md:px-12 pb-16 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <p className="text-gray-400 text-sm mb-4">
            ผลการค้นหา "{searchQuery.trim()}" — {searchResults.length} รายการ
          </p>
          {searchResults.length === 0 ? (
            <p className="text-center text-gray-400 py-24">ไม่พบคอร์สที่ค้นหา ลองคำอื่นดูนะ</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {searchResults.map((course) => (
                <NetflixCard
                  key={course.id}
                  course={course}
                  variant="grid"
                  statusBadge={
                    course.content_type === 'tip' ? (
                      <Badge className="bg-sky-500/90 text-white text-[10px] px-1.5 py-0.5">💡 Tip</Badge>
                    ) : undefined
                  }
                  onClick={() => navigate(`/courses/${course.slug}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <PublicHeader overlay search={{ query: searchQuery, onChange: setSearchQuery }} />

      <div key="browse" className="animate-in fade-in duration-300">
      {billboard && <HeroBillboard course={billboard} />}

      {/* Rails overlap the billboard's bottom fade, Netflix-style */}
      <div className={billboard ? 'relative z-10 -mt-12' : 'pt-20'}>
        {continueItems.length > 0 && (
          <NetflixRow title="เรียนต่อของฉัน">
            {continueItems.map((item) => (
              <NetflixCard
                key={`cont-${item.course_id}`}
                course={{
                  id: item.course_id,
                  name: item.course_name,
                  slug: item.course_slug,
                  thumbnail_url: item.thumbnail_url,
                  total_lessons: item.total_lessons,
                } as BrowseCourse}
                progressPercent={item.progress_percent}
                onClick={() =>
                  item.last_lesson_id
                    ? navigate(`/app/courses/${item.course_slug}/learn/${item.last_lesson_id}`)
                    : navigate(`/courses/${item.course_slug}`)
                }
              />
            ))}
          </NetflixRow>
        )}

        {rows.map((row) => (
          <NetflixRow key={row.key} title={row.title}>
            {row.courses.map((course) => (
              <NetflixCard
                key={`${row.key}-${course.id}`}
                course={course}
                onClick={() => navigate(`/courses/${course.slug}`)}
              />
            ))}
          </NetflixRow>
        ))}

        {courses.length === 0 && (
          <p className="text-center text-gray-400 py-24">ยังไม่มีคอร์สเปิดสอนในขณะนี้</p>
        )}
      </div>

      <footer className="px-4 md:px-12 py-10 text-center text-gray-500 text-xs">
        Triple School — คอร์สเรียนออนไลน์
      </footer>
      </div>
    </div>
  );
};

export default Storefront;
