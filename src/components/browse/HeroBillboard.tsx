import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BookOpen, Clock, Info, PlayCircle, Star } from 'lucide-react';
import { type BrowseCourse, difficultyLabels } from './browseRows';

// Full-bleed Netflix billboard: featured course backdrop + gradient overlays +
// title / synopsis / CTA in the lower-left. Sits under the overlay header.
const HeroBillboard = ({ course }: { course: BrowseCourse }) => {
  const navigate = useNavigate();
  const rating = course.avg_rating && Number(course.avg_rating) > 0 ? Number(course.avg_rating) : null;
  const lessonCount = course.lesson_count || course.total_lessons || 0;

  return (
    <section className="relative h-[65vh] min-h-[440px] w-full overflow-hidden">
      {course.thumbnail_url ? (
        <img
          src={api.mediaUrl(course.thumbnail_url)}
          alt={course.name}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gray-800" />
      )}
      {/* Netflix-style double gradient: left→right for text legibility, bottom fade into page */}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-black/30" />

      <div className="absolute inset-x-0 bottom-0 px-4 md:px-12 pb-14 max-w-2xl">
        <Badge className="bg-purple-600 text-white text-xs mb-3">คอร์สแนะนำ</Badge>
        <h1 className="text-white text-3xl md:text-5xl lg:text-6xl font-extrabold leading-tight mb-3 drop-shadow-lg text-balance">
          {course.name}
        </h1>
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
