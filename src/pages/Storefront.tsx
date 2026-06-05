import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import PublicHeader from '@/components/PublicHeader';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Loader2,
  Search,
  BookOpen,
  Clock,
  User,
  Star,
  ArrowRight,
  GraduationCap,
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

function PriceTag({ course, size = 'sm' }: { course: Course; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'text-xl' : 'text-sm';
  if (course.price > 0) {
    const discounted = course.discount_price !== null && course.discount_price < course.price;
    return (
      <div className="flex items-center gap-2">
        <span className={`text-primary font-bold ${cls}`}>
          ฿{(discounted ? course.discount_price! : course.price).toLocaleString()}
        </span>
        {discounted && (
          <span className="text-muted-foreground text-xs line-through">฿{course.price.toLocaleString()}</span>
        )}
      </div>
    );
  }
  return <span className={`text-green-400 font-bold ${cls}`}>ฟรี</span>;
}

const Storefront = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
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

  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? courses.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query) ||
          c.instructor_name?.toLowerCase().includes(query)
      )
    : courses;

  const featured = !query ? courses.filter((c) => c.is_featured) : [];
  const heroCourse = featured[0];
  const sideFeatured = featured.slice(1, 4);

  return (
    <div className="page-wrapper min-h-screen">
      <PublicHeader />

      <main className="container mx-auto px-4 pt-28 pb-16 max-w-6xl">
        {/* Heading + search */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-3 flex items-center justify-center gap-2">
            <GraduationCap className="h-8 w-8 text-primary" />
            {language === 'th' ? 'คอร์สเรียนทั้งหมด' : 'All Courses'}
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto mb-6">
            {language === 'th'
              ? 'เรียนรู้ทักษะใหม่ๆ กับคอร์สคุณภาพจากผู้เชี่ยวชาญ — ดูได้เลยไม่ต้องสมัคร'
              : 'Level up with expert-led courses — browse freely, no sign-up required'}
          </p>
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder={language === 'th' ? 'ค้นหาคอร์สเรียน...' : 'Search for courses...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 h-12 rounded-full bg-card/60 border-border text-base"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Featured bento (only when not searching) */}
            {heroCourse && (
              <section className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                  <Star className="h-5 w-5 text-yellow-500" />
                  <h2 className="text-lg font-semibold">
                    {language === 'th' ? 'คอร์สแนะนำ' : 'Featured'}
                  </h2>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Big hero card */}
                  <button
                    onClick={() => openCourse(heroCourse.slug)}
                    className="group relative lg:col-span-2 lg:row-span-2 rounded-2xl overflow-hidden border border-border text-left min-h-[260px] lg:min-h-[420px]"
                  >
                    {heroCourse.thumbnail_url ? (
                      <img
                        src={heroCourse.thumbnail_url}
                        alt={heroCourse.name}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-purple-600/20 to-background" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                    <Badge className="absolute top-4 left-4 bg-yellow-500 text-black">
                      <Star className="h-3 w-3 mr-1" />
                      {language === 'th' ? 'แนะนำ' : 'Featured'}
                    </Badge>
                    <div className="absolute bottom-0 left-0 right-0 p-6">
                      <h3 className="text-2xl font-bold text-white mb-2 line-clamp-2">{heroCourse.name}</h3>
                      {heroCourse.short_description && (
                        <p className="text-gray-200 text-sm mb-4 line-clamp-2 max-w-xl">{heroCourse.short_description}</p>
                      )}
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <PriceTag course={heroCourse} size="lg" />
                        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm group-hover:opacity-90">
                          {language === 'th' ? 'ดูคอร์ส' : 'View course'}
                          <ArrowRight className="h-4 w-4" />
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Side featured cards */}
                  {sideFeatured.map((course) => (
                    <button
                      key={course.id}
                      onClick={() => openCourse(course.slug)}
                      className="group relative rounded-2xl overflow-hidden border border-border text-left min-h-[200px]"
                    >
                      {course.thumbnail_url ? (
                        <img
                          src={course.thumbnail_url}
                          alt={course.name}
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-purple-600/20 to-background" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-4">
                        <h3 className="text-base font-semibold text-white mb-1 line-clamp-2">{course.name}</h3>
                        <PriceTag course={course} />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* All courses */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  {query
                    ? language === 'th' ? 'ผลการค้นหา' : 'Search results'
                    : language === 'th' ? 'คอร์สทั้งหมด' : 'All courses'}
                </h2>
                <span className="text-muted-foreground text-sm">
                  {filtered.length} {language === 'th' ? 'คอร์ส' : 'courses'}
                </span>
              </div>

              {filtered.length === 0 ? (
                <div className="text-center py-16">
                  <BookOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    {language === 'th' ? 'ไม่พบคอร์สเรียน' : 'No courses found'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {filtered.map((course) => (
                    <CourseCard key={course.id} course={course} onClick={() => openCourse(course.slug)} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
};

const CourseCard = ({ course, onClick }: { course: Course; onClick: () => void }) => {
  const lessonCount = course.lesson_count || course.total_lessons || 0;

  return (
    <button
      onClick={onClick}
      className="group text-left rounded-2xl overflow-hidden border border-border bg-card hover:border-primary/50 transition-all duration-300"
    >
      <div className="relative aspect-[4/3] bg-muted overflow-hidden">
        {course.thumbnail_url ? (
          <img
            src={course.thumbnail_url}
            alt={course.name}
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

      <div className="p-3">
        <h3 className="font-medium text-sm mb-1.5 line-clamp-2 group-hover:text-primary transition-colors">
          {course.name}
        </h3>

        {course.instructor_name && (
          <div className="flex items-center gap-2 mb-2">
            {course.instructor_avatar ? (
              <img src={course.instructor_avatar} alt={course.instructor_name} className="h-5 w-5 rounded-full object-cover" />
            ) : (
              <User className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-muted-foreground text-xs">{course.instructor_name}</span>
          </div>
        )}

        <div className="mb-2">
          <PriceTag course={course} />
        </div>

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" />
              {lessonCount} บท
            </span>
            {course.duration_hours > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {course.duration_hours}ชม.
              </span>
            )}
          </div>
          <Badge className={`${difficultyColors[course.difficulty] || difficultyColors.beginner} border text-xs px-2 py-0.5`}>
            {difficultyLabels[course.difficulty] || 'เริ่มต้น'}
          </Badge>
        </div>
      </div>
    </button>
  );
};

export default Storefront;
