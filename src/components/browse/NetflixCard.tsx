import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import StarRating from '@/components/StarRating';
import CoursePrice from '@/components/CoursePrice';
import { Badge } from '@/components/ui/badge';
import { BookOpen, PlayCircle, Star, Sparkles } from 'lucide-react';
import {
  type BrowseCourse,
  difficultyColors,
  difficultyLabels,
  isBestseller,
  isNewCourse,
} from './browseRows';

interface NetflixCardProps {
  course: BrowseCourse;
  onClick: () => void;
  /** Rail card (fixed width, snap) vs grid card (fluid). */
  variant?: 'rail' | 'grid';
  /** Continue-watching progress (0-100) — renders a bottom progress bar. */
  progressPercent?: number;
  /** Extra badge (enrollment status ฯลฯ) rendered on top of the badge stack. */
  statusBadge?: ReactNode;
  /** Owned-course contexts (my courses): the price line makes no sense there. */
  hidePrice?: boolean;
}

// 16:9 Netflix-style card. Title sits on a permanent bottom gradient; hover
// scales the card up and reveals meta (rating / lessons / level / price).
const NetflixCard = ({ course, onClick, variant = 'rail', progressPercent, statusBadge, hidePrice }: NetflixCardProps) => {
  const reviewCount = Number(course.review_count) || 0;
  const lessonCount = course.lesson_count || course.total_lessons || 0;
  const width = variant === 'rail' ? 'w-[230px] md:w-[270px] flex-none snap-start' : 'w-full';

  return (
    <div
      onClick={onClick}
      className={`${width} relative aspect-video rounded-md overflow-hidden bg-gray-800 cursor-pointer group/card transition-transform duration-300 hover:scale-105 hover:z-10 hover:shadow-2xl hover:shadow-black/60`}
    >
      {course.thumbnail_url ? (
        <img
          src={api.mediaUrl(course.thumbnail_url, 'card')}
          alt={course.name}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <BookOpen className="h-10 w-10 text-gray-600" />
        </div>
      )}

      {/* Permanent bottom gradient + title */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-10 pb-2 px-3">
        <h3 className="text-white text-sm font-semibold line-clamp-2 leading-snug drop-shadow">
          {course.name}
        </h3>
        {/* Meta revealed on hover */}
        <div className="max-h-0 opacity-0 group-hover/card:max-h-24 group-hover/card:opacity-100 group-hover/card:mt-1.5 transition-all duration-300 overflow-hidden">
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-300">
            {reviewCount > 0 && (
              <StarRating value={course.avg_rating ?? 0} count={reviewCount} size={11} />
            )}
            <span className="flex items-center gap-1">
              <BookOpen className="h-3 w-3" />
              {lessonCount} บท
            </span>
            <Badge className={`${difficultyColors[course.difficulty] || difficultyColors.beginner} border text-[10px] px-1.5 py-0`}>
              {difficultyLabels[course.difficulty] || 'เริ่มต้น'}
            </Badge>
          </div>
          {!hidePrice && (
            <div className="mt-1">
              <CoursePrice price={course.price} discountPrice={course.discount_price} size="sm" />
            </div>
          )}
        </div>
      </div>

      {/* Hover play glyph */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 pointer-events-none">
        <PlayCircle className="h-11 w-11 text-white/90 drop-shadow-lg -translate-y-3" />
      </div>

      {/* Badges */}
      <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
        {statusBadge}
        {isBestseller(course) && (
          <Badge className="bg-orange-500 text-white text-[10px] px-1.5 py-0.5 flex items-center gap-0.5">
            <Star className="h-2.5 w-2.5 fill-white" />
            ขายดี
          </Badge>
        )}
        {isNewCourse(course.created_at) && (
          <Badge className="bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 flex items-center gap-0.5">
            <Sparkles className="h-2.5 w-2.5" />
            ใหม่
          </Badge>
        )}
      </div>

      {/* Continue-watching progress bar */}
      {typeof progressPercent === 'number' && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-600/70">
          <div
            className="h-full bg-purple-500"
            style={{ width: `${Math.min(100, Math.max(2, progressPercent))}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default NetflixCard;
