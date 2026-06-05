import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import PublicHeader from '@/components/PublicHeader';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Loader2,
  Search,
  BookOpen,
  User,
  Star,
  ArrowRight,
  ArrowUpRight,
  GraduationCap,
  Presentation,
  Sparkles,
} from 'lucide-react';

interface Course {
  id: number;
  name: string;
  slug: string;
  description: string;
  short_description: string;
  thumbnail_url: string;
  instructor_name: string;
  instructor_avatar: string;
  difficulty: string;
  duration_hours: number;
  total_lessons: number;
  is_featured: boolean;
  lesson_count: number;
  price: number;
  discount_price: number | null;
}

const difficultyColors: Record<string, string> = {
  beginner: 'bg-green-500/10 text-green-500 border-green-500/20',
  intermediate: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  advanced: 'bg-red-500/10 text-red-500 border-red-500/20',
};

const difficultyLabels: Record<string, string> = {
  beginner: 'เริ่มต้น',
  intermediate: 'ปานกลาง',
  advanced: 'ขั้นสูง',
};

const PLATFORMS = ['TikTok', 'YouTube Shorts', 'Instagram Reels', 'Facebook Reels', 'X'];

function PriceTag({ course }: { course: Course }) {
  if (course.price > 0) {
    const discounted = course.discount_price !== null && course.discount_price < course.price;
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-primary font-bold text-sm">
          ฿{(discounted ? course.discount_price! : course.price).toLocaleString()}
        </span>
        {discounted && (
          <span className="text-muted-foreground text-xs line-through">฿{course.price.toLocaleString()}</span>
        )}
      </div>
    );
  }
  return <span className="text-green-400 font-bold text-sm">ฟรี</span>;
}

const Storefront = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const isTh = language === 'th';
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadCourses();
  }, []);

  const loadCourses = async () => {
    try {
      setLoading(true);
      const data = await api.getCourses();
      setCourses(data);
    } catch (error) {
      console.error('Failed to load courses:', error);
      toast.error('โหลดคอร์สเรียนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const openCourse = (slug: string) => navigate(`/courses/${slug}`);
  const scrollToCourses = () =>
    document.getElementById('courses')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? courses.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query) ||
          c.instructor_name?.toLowerCase().includes(query)
      )
    : courses;

  // Featured courses lead the grid, then the rest — keeps "popular" up top.
  const sorted = [...filtered].sort((a, b) => Number(b.is_featured) - Number(a.is_featured));

  return (
    <div className="page-wrapper min-h-screen">
      <PublicHeader />

      <main className="container mx-auto px-4 pt-28 md:pt-32 pb-20 max-w-6xl">
        {/* ===== HERO ===== */}
        <section className="relative text-center mb-16 md:mb-24">
          {/* Decorative flanking avatars (desktop only) */}
          <div className="hidden lg:flex flex-col items-center gap-2 absolute left-0 top-1/2 -translate-y-1/2">
            <div className="h-24 w-24 rounded-full p-[3px] bg-gradient-to-br from-primary to-amber-300 shadow-xl">
              <div className="h-full w-full rounded-full bg-card flex items-center justify-center overflow-hidden">
                {sorted[0]?.instructor_avatar ? (
                  <img
                    src={sorted[0].instructor_avatar}
                    alt={sorted[0].instructor_name}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <Presentation className="h-10 w-10 text-primary" />
                )}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{isTh ? 'ผู้สอน' : 'Instructor'}</span>
          </div>
          <div className="hidden lg:flex flex-col items-center gap-2 absolute right-0 top-1/2 -translate-y-1/2">
            <div className="h-24 w-24 rounded-full p-[3px] bg-gradient-to-br from-purple-500 to-purple-400 shadow-xl">
              <div className="h-full w-full rounded-full bg-card flex items-center justify-center">
                <GraduationCap className="h-10 w-10 text-purple-400" />
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{isTh ? 'ผู้เรียน' : 'Student'}</span>
          </div>

          <div className="max-w-3xl mx-auto">
            <Badge className="mb-6 bg-primary/10 text-primary border-primary/20 px-4 py-1.5">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              {isTh ? 'แพลตฟอร์มเรียนรู้ AI' : 'AI Learning Platform'}
            </Badge>

            <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
              {isTh ? (
                <>
                  เรียนรู้ทักษะ<span className="text-primary">แห่งอนาคต</span>
                  <br />
                  ได้ตั้งแต่<span className="text-purple-400">วันนี้</span>
                </>
              ) : (
                <>
                  Learn <span className="text-primary">tomorrow's skills</span>
                  <br />
                  <span className="text-purple-400">today</span>
                </>
              )}
            </h1>

            <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
              {isTh
                ? 'คอร์สคุณภาพจากผู้เชี่ยวชาญตัวจริง สร้างวิดีโอ AI และทำคอนเทนต์ไวรัล — เปิดดูได้เลย ไม่ต้องสมัครสมาชิก'
                : 'Quality courses from real experts — make AI videos and viral content. Browse freely, no sign-up required.'}
            </p>

            <div className="flex justify-center">
              <Button
                size="lg"
                onClick={scrollToCourses}
                className="gap-2 text-base px-8 py-6 w-full sm:w-auto"
              >
                {isTh ? 'เริ่มเรียนเลย' : 'Start Learning'}
                <ArrowRight className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </section>

        {/* ===== Trust / supported platforms strip ===== */}
        <section className="mb-16 md:mb-20">
          <p className="text-center text-xs uppercase tracking-wider text-muted-foreground mb-4">
            {isTh ? 'แพลตฟอร์มที่รองรับ' : 'Supported platforms'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 opacity-70">
            {PLATFORMS.map((name) => (
              <span key={name} className="text-muted-foreground font-semibold text-sm md:text-base">
                {name}
              </span>
            ))}
          </div>
        </section>

        {/* ===== Popular courses ===== */}
        <section id="courses" className="scroll-mt-28">
          <div className="flex items-end justify-between gap-4 mb-2">
            <h2 className="text-2xl md:text-3xl font-bold">
              {isTh ? (
                <>คอร์ส<span className="text-purple-400">ยอดนิยม</span></>
              ) : (
                <>Most <span className="text-purple-400">Popular</span> Courses</>
              )}
            </h2>
            <button
              type="button"
              onClick={() =>
                document.getElementById('course-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              className="hidden sm:inline-flex items-center gap-1 text-sm text-primary hover:underline whitespace-nowrap"
            >
              {isTh ? 'ดูคอร์สทั้งหมด' : 'Explore Courses'}
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>
          <p className="text-muted-foreground text-sm mb-6">
            {isTh
              ? 'เลือกเรียนกับคอร์สคุณภาพจากผู้เชี่ยวชาญและสถาบันชั้นนำ'
              : "Join our best classes from top instructors and institutes"}
          </p>

          {/* Search */}
          <div className="relative max-w-sm mb-8">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label={isTh ? 'ค้นหาคอร์สเรียน' : 'Search for courses'}
              placeholder={isTh ? 'ค้นหาคอร์สเรียน...' : 'Search for courses...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 h-11 rounded-full bg-card/60 border-border"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center min-h-[300px]">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-16">
              <BookOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">{isTh ? 'ไม่พบคอร์สเรียน' : 'No courses found'}</p>
            </div>
          ) : (
            <div id="course-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {sorted.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  onClick={() => openCourse(course.slug)}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

const CourseCard = ({ course, onClick }: { course: Course; onClick: () => void }) => {
  const lessonCount = course.lesson_count || course.total_lessons || 0;

  return (
    <button
      onClick={onClick}
      className="group text-left rounded-2xl border border-border bg-card hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
    >
      {/* Thumbnail (padded, inner rounded — matches reference card) */}
      <div className="p-2.5">
        <div className="relative aspect-[16/10] rounded-xl overflow-hidden bg-muted">
          {course.thumbnail_url ? (
            <img
              src={course.thumbnail_url}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-purple-600/10">
              <BookOpen className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          {course.is_featured && (
            <Badge className="absolute top-2 left-2 bg-yellow-500 text-black text-xs px-2 py-0.5">
              <Star className="h-3 w-3 mr-1" />
              แนะนำ
            </Badge>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        {/* Meta row: lessons + price */}
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 rounded-full px-2.5 py-1">
            <BookOpen className="h-3.5 w-3.5" />
            {lessonCount} บท
          </span>
          <PriceTag course={course} />
        </div>

        {/* Title */}
        <h3 className="font-semibold text-base mb-3 line-clamp-2 group-hover:text-primary transition-colors min-h-[2.75rem]">
          {course.name}
        </h3>

        {/* Footer: instructor + category */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/60">
          {course.instructor_name ? (
            <div className="flex items-center gap-2 min-w-0">
              {course.instructor_avatar ? (
                <img
                  src={course.instructor_avatar}
                  alt={course.instructor_name}
                  className="h-6 w-6 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
              <span className="text-muted-foreground text-xs truncate">{course.instructor_name}</span>
            </div>
          ) : (
            <span />
          )}
          <Badge
            className={`${difficultyColors[course.difficulty] || difficultyColors.beginner} border text-xs px-2 py-0.5 shrink-0`}
          >
            {difficultyLabels[course.difficulty] || 'เริ่มต้น'}
          </Badge>
        </div>
      </div>
    </button>
  );
};

export default Storefront;
