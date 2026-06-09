import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2,
  Search,
  BookOpen,
  Clock,
  User,
  GraduationCap,
  Star,
  PlayCircle,
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

// basePath lets the same grid power both the in-app catalog (/app/courses) and
// the public catalog/storefront (/courses).
const Courses = ({ basePath = '/app/courses' }: { basePath?: string } = {}) => {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [filteredCourses, setFilteredCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadCourses();
  }, []);

  useEffect(() => {
    let filtered = [...courses];
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (course) =>
          course.name.toLowerCase().includes(query) ||
          course.description?.toLowerCase().includes(query) ||
          course.instructor_name?.toLowerCase().includes(query)
      );
    }
    setFilteredCourses(filtered);
  }, [courses, searchQuery]);

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

  const featuredCourses = courses.filter((course) => course.is_featured);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Hero Section */}
      <div className="mb-6">
        <div className="text-center mb-4">
          <h1 className="text-xl md:text-2xl font-bold text-white mb-2">
            <GraduationCap className="inline-block mr-2 h-6 w-6 text-purple-400" />
            คอร์สเรียน
          </h1>
          <p className="text-gray-400 text-sm max-w-xl mx-auto">
            เรียนรู้ทักษะใหม่ๆ กับคอร์สคุณภาพจากผู้เชี่ยวชาญ
          </p>
        </div>

        {/* Search */}
        <div className="flex justify-center max-w-md mx-auto">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="ค้นหาคอร์สเรียน..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-gray-800/50 border-gray-700 text-white h-9 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Featured Courses */}
      {featuredCourses.length > 0 && !searchQuery && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Star className="h-4 w-4 text-yellow-500" />
            <h2 className="text-base font-semibold text-white">คอร์สแนะนำ</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {featuredCourses.map((course) => (
              <CourseCard key={course.id} course={course} onClick={() => navigate(`${basePath}/${course.slug}`)} />
            ))}
          </div>
        </div>
      )}

      {/* All Courses */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-white">
            {searchQuery ? 'ผลการค้นหา' : 'คอร์สทั้งหมด'}
          </h2>
          <span className="text-gray-400 text-sm">{filteredCourses.length} คอร์ส</span>
        </div>

        {filteredCourses.length === 0 ? (
          <div className="text-center py-8">
            <BookOpen className="h-8 w-8 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">ไม่พบคอร์สเรียน</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredCourses.map((course) => (
              <CourseCard key={course.id} course={course} onClick={() => navigate(`${basePath}/${course.slug}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const CourseCard = ({ course, onClick }: { course: Course; onClick: () => void }) => {
  const lessonCount = course.lesson_count || course.total_lessons || 0;

  return (
    <Card
      className="cursor-pointer hover:border-purple-500/50 transition-all duration-300 overflow-hidden group"
      onClick={onClick}
    >
      <div className="relative aspect-[4/3] bg-gray-800 overflow-hidden">
        {course.thumbnail_url ? (
          <img
            src={course.thumbnail_url}
            alt={course.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookOpen className="h-10 w-10 text-gray-600" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <PlayCircle className="h-12 w-12 text-white" />
        </div>
        {course.is_featured && (
          <Badge className="absolute top-2 left-2 bg-yellow-500 text-black text-xs px-2 py-0.5">
            <Star className="h-3 w-3 mr-1" />
            แนะนำ
          </Badge>
        )}
      </div>

      <CardContent className="p-3">
        <h3 className="font-medium text-white text-sm mb-1.5 line-clamp-2 group-hover:text-purple-400 transition-colors">
          {course.name}
        </h3>

        {course.short_description && (
          <p className="text-gray-400 text-xs mb-2 line-clamp-2">{course.short_description}</p>
        )}

        {course.instructor_name && (
          <div className="flex items-center gap-2 mb-2">
            {course.instructor_avatar ? (
              <img src={course.instructor_avatar} alt={course.instructor_name} className="h-5 w-5 rounded-full object-cover" />
            ) : (
              <User className="h-3.5 w-3.5 text-gray-400" />
            )}
            <span className="text-gray-400 text-xs">{course.instructor_name}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3 text-gray-400">
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
      </CardContent>
    </Card>
  );
};

export default Courses;
