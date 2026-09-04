import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PublicHeader from '@/components/PublicHeader';
import HeroBillboard from '@/components/browse/HeroBillboard';
import NetflixRow from '@/components/browse/NetflixRow';
import NetflixCard from '@/components/browse/NetflixCard';
import FeaturedRow from '@/components/browse/FeaturedRow';
import type { BrowseCourse } from '@/components/browse/browseRows';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Loader2 } from 'lucide-react';

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

  // หน้า Home โชว์เฉพาะคอร์สที่ "เปิดแล้ว" (มีบทเรียนอย่างน้อย 1 บท) — คอร์สเปล่า
  // (Coming Soon) ยังอยู่ใน /courses ตามปกติ แต่ไม่ถูกเอามาขึ้น Billboard/rail ใดๆ
  const launched = courses.filter((c) => Number(c.lesson_count) > 0);

  // Billboard: an admin-pinned course wins; otherwise the newest course
  // (created_at DESC). Tips are single-episode extras — they never take the
  // billboard automatically, but an admin may still pin one deliberately.
  const billboard =
    launched.find((c) => c.is_billboard) ||
    [...launched]
      .filter((c) => c.content_type !== 'tip')
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0] ||
    launched[0] ||
    null;
  // หน้า Home เหลือ 2 หมวดใหญ่ — หมวดย่อยอื่นๆ (Tip/ยอดนิยม/ตามระดับ) ดูได้ที่ /courses
  // "มาใหม่ล่าสุด" เอาคอร์สล่าสุด 5 ตัวเสมอ (ไม่จำกัดอายุ 30 วันแบบเดิม — กันหมวด
  // หายทั้งแถวช่วงไม่มีคอร์สใหม่) และไม่นับ Tip ให้ตรงกับหน้า /courses ที่ปุ่มพาไป
  // 5 ใบทำให้โมเสกเต็มพอดีทั้งสองจอ: desktop hero 2×2 + เล็ก 4 / มือถือ hero เต็มแถว + 2×2
  const newest5 = [...launched]
    .filter((c) => c.content_type !== 'tip')
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 5);
  // "คอร์สแนะนำ" กติกาเดิม: is_featured ตามลำดับ display_order จาก backend
  const featured = launched.filter((c) => c.is_featured);

  const seeAllButton = (
    <button
      onClick={() => navigate('/courses')}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#FFB300]/40 px-3 py-1 text-xs md:text-sm font-semibold text-[#FFB300] transition-colors hover:bg-[#FFB300]/10"
    >
      ดูทั้งหมด
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  );

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
                  onClick={() => navigate(`/courses/${course.slug}?ep=latest`)}
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
                variant="grid"
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

        {/* หมวด 1: มาใหม่ล่าสุด — mosaic ใบใหม่สุดเป็นการ์ดใหญ่ซ้าย ที่เหลือกริดเล็กขวา */}
        <FeaturedRow
          title="มาใหม่ล่าสุด"
          action={seeAllButton}
          courses={newest5}
          onOpen={(course) => navigate(`/courses/${course.slug}?ep=latest`)}
        />

        {/* หมวด 2: คอร์สแนะนำ — เหมือนเดิม เพิ่มแค่ปุ่มดูทั้งหมด */}
        {featured.length > 0 && (
          <NetflixRow title="คอร์สแนะนำ" action={seeAllButton}>
            {featured.map((course) => (
              <NetflixCard
                key={`featured-${course.id}`}
                course={course}
                variant="grid"
                onClick={() => navigate(`/courses/${course.slug}?ep=latest`)}
              />
            ))}
          </NetflixRow>
        )}

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
