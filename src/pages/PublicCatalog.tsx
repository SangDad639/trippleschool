import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import PublicHeader from '@/components/PublicHeader';
import NetflixRow from '@/components/browse/NetflixRow';
import FeaturedRow from '@/components/browse/FeaturedRow';
import NetflixCard from '@/components/browse/NetflixCard';
import { buildRows, type BrowseCourse } from '@/components/browse/browseRows';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Search } from 'lucide-react';

// Radix Select disallows empty values — sentinel for "no sort".
const SORT_DEFAULT = 'default';

// Netflix-style catalog: rails while browsing, search flips to a results grid.
const PublicCatalog = () => {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<BrowseCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<string>(SORT_DEFAULT);

  useEffect(() => {
    setLoading(true);
    api
      .getCourses({ type: 'course', ...(sort !== SORT_DEFAULT ? { sort } : {}) })
      .then(setCourses)
      .catch((e) => {
        console.error('Failed to load courses:', e);
        toast.error('โหลดคอร์สเรียนไม่สำเร็จ');
      })
      .finally(() => setLoading(false));
  }, [sort]);

  const query = searchQuery.trim().toLowerCase();
  const searchResults = query
    ? courses.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query) ||
          c.instructor_name?.toLowerCase().includes(query)
      )
    : [];
  const rows = buildRows(courses);

  const openCourse = (course: BrowseCourse) => navigate(`/courses/${course.slug}`);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <PublicHeader />

      {/* Top bar: title + search */}
      <div className="px-4 md:px-12 pt-8 pb-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <h1 className="text-2xl md:text-3xl font-bold flex-1">คอร์สเรียน</h1>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาคอร์สเรียน..."
            className="pl-10 bg-gray-800/50 border-gray-700 text-white h-9 text-sm"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
        </div>
      ) : query ? (
        /* Search mode — Netflix search results grid */
        <div className="px-4 md:px-12 pb-16">
          <p className="text-gray-400 text-sm mb-4">
            ผลการค้นหา "{searchQuery}" — {searchResults.length} คอร์ส
          </p>
          {searchResults.length === 0 ? (
            <p className="text-center text-gray-400 py-20">ไม่พบคอร์สที่ค้นหา ลองคำอื่นดูนะ</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {searchResults.map((course) => (
                <NetflixCard key={course.id} course={course} variant="grid" onClick={() => openCourse(course)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Rails */}
          {rows.map((row) =>
            // แถวมาใหม่ = mosaic: ใบใหม่สุดเป็นการ์ดใหญ่ซ้าย ที่เหลือกริดเล็กขวา
            row.key === 'new' ? (
              <FeaturedRow key={row.key} title={row.title} courses={row.courses} onOpen={openCourse} />
            ) : (
              <NetflixRow key={row.key} title={row.title}>
                {row.courses.map((course) => (
                  <NetflixCard
                    key={`${row.key}-${course.id}`}
                    course={course}
                    variant="grid"
                    onClick={() => openCourse(course)}
                  />
                ))}
              </NetflixRow>
            )
          )}

          {/* Full catalog grid */}
          <div className="px-4 md:px-12 pb-16">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-base md:text-lg font-semibold flex-1">คอร์สทั้งหมด</h2>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-40 h-9 bg-gray-800/50 border-gray-700 text-white text-sm">
                  <SelectValue placeholder="เรียงลำดับ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SORT_DEFAULT}>✨ แนะนำ</SelectItem>
                  <SelectItem value="popular">🔥 ยอดนิยม</SelectItem>
                  <SelectItem value="new">🆕 ใหม่ล่าสุด</SelectItem>
                  <SelectItem value="price_asc">⬆️ ราคาน้อย→มาก</SelectItem>
                  <SelectItem value="price_desc">⬇️ ราคามาก→น้อย</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-gray-400 text-sm whitespace-nowrap">{courses.length} คอร์ส</span>
            </div>
            {courses.length === 0 ? (
              <p className="text-center text-gray-400 py-16">ยังไม่มีคอร์สเปิดสอนในขณะนี้</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {courses.map((course) => (
                  <NetflixCard key={course.id} course={course} variant="grid" onClick={() => openCourse(course)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default PublicCatalog;
