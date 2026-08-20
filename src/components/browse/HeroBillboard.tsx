import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BookOpen, Clock, Info, PlayCircle, Star } from 'lucide-react';
import { type BrowseCourse, difficultyLabels } from './browseRows';

// Full-bleed Netflix billboard: featured course backdrop + gradient overlays +
// title / synopsis / CTA in the lower-left. Sits under the overlay header.
// ฟอนต์ย่อตามความยาวชื่อ (แบบ Netflix) — ชื่อยาวบนฟอนต์ 6xl ในกรอบแคบเคยแตก
// 4 บรรทัดและหักกลางวลีไทย ("(ศึก" ค้างท้ายบรรทัด)
function titleSizeClass(name: string): string {
  if (name.length > 70) return 'text-xl md:text-3xl lg:text-4xl';
  if (name.length > 40) return 'text-2xl md:text-4xl lg:text-5xl';
  return 'text-3xl md:text-5xl lg:text-6xl';
}

/** ชื่อรูปแบบ "English Title (คำแปลไทย)" → { main, sub } — รูปแบบอื่นคืน null */
function splitBilingualTitle(name: string): { main: string; sub: string } | null {
  const m = name.match(/^(.*?)\s*\((.+?)\)\s*$/);
  if (!m || !m[1].trim() || !m[2].trim()) return null;
  return { main: m[1].trim(), sub: m[2].trim() };
}

const HeroBillboard = ({ course }: { course: BrowseCourse }) => {
  const navigate = useNavigate();
  const rating = course.avg_rating && Number(course.avg_rating) > 0 ? Number(course.avg_rating) : null;
  const lessonCount = course.lesson_count || course.total_lessons || 0;
  const titleParts = splitBilingualTitle(course.name);

  return (
    <section className="relative h-[65vh] min-h-[440px] w-full overflow-hidden">
      {course.thumbnail_url ? (
        <img
          src={api.mediaUrl(course.thumbnail_url, 'hero')}
          alt={course.name}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gray-800" />
      )}
      {/* Netflix-style double gradient: left→right for text legibility, bottom fade into page */}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-black/30" />

      <div className="absolute inset-x-0 bottom-0 px-4 md:px-12 pb-14 max-w-3xl">
        <Badge className="bg-purple-600 text-white text-xs mb-3">คอร์สแนะนำ</Badge>
        {/* ชื่อแบบ "English (คำแปลไทย)" แยกเป็นหัวใหญ่ + บรรทัดรอง — แต่ละบรรทัด
            เป็นภาษาเดียว การตัดคำไทยปนอังกฤษจึงไม่เกิด (แบบเดียวกับชื่อแปลบน Netflix);
            ชื่อที่ไม่มีวงเล็บแสดงเป็นหัวเดียว ฟอนต์ย่อตามความยาว */}
        {titleParts ? (
          <>
            <h1
              lang="th"
              className={`text-white ${titleSizeClass(titleParts.main)} font-extrabold leading-tight drop-shadow-lg text-balance`}
            >
              {titleParts.main}
            </h1>
            <p lang="th" className="text-gray-200 text-base md:text-xl lg:text-2xl font-semibold mt-2 mb-3 drop-shadow text-balance">
              {titleParts.sub}
            </p>
          </>
        ) : (
          <h1
            lang="th"
            className={`text-white ${titleSizeClass(course.name)} font-extrabold leading-tight mb-3 drop-shadow-lg text-balance`}
          >
            {course.name}
          </h1>
        )}
        {course.short_description && (
          <p className="text-gray-200 text-sm md:text-base line-clamp-3 max-w-xl mb-4 drop-shadow">
            {course.short_description}
          </p>
        )}
        <div className="flex items-center gap-3 flex-wrap text-xs md:text-sm text-gray-300 mb-5">
          {rating && (
            <span className="flex items-center gap-1 text-yellow-400">
              <Star className="h-4 w-4 fill-yellow-400" />
              {rating.toFixed(1)}
            </span>
          )}
          {lessonCount > 0 && (
            <span className="flex items-center gap-1">
              <BookOpen className="h-4 w-4" />
              {lessonCount} บทเรียน
            </span>
          )}
          {course.duration_hours > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {course.duration_hours} ชม.
            </span>
          )}
          <span className="border border-gray-500 rounded px-1.5 py-0.5 text-[11px]">
            {difficultyLabels[course.difficulty] || 'เริ่มต้น'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="lg"
            onClick={() => navigate(`/courses/${course.slug}`)}
            className="bg-purple-600 hover:bg-purple-700 text-white font-semibold h-11 px-6"
          >
            <PlayCircle className="h-5 w-5 mr-2" />
            ดูคอร์สนี้
          </Button>
          <Button
            size="lg"
            onClick={() => navigate('/courses')}
            className="bg-gray-600/60 hover:bg-gray-600/80 text-white font-semibold h-11 px-6 backdrop-blur-sm"
          >
            <Info className="h-5 w-5 mr-2" />
            คอร์สทั้งหมด
          </Button>
        </div>
      </div>
    </section>
  );
};

export default HeroBillboard;
