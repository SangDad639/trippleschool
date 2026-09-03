import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import StarRating from '@/components/StarRating';
import CoursePrice from '@/components/CoursePrice';
import { Badge } from '@/components/ui/badge';
import { BookOpen, PlayCircle, Star, Sparkles, Clock } from 'lucide-react';
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
  /** Mosaic hero cell: stretch to wrapper height instead of fixed 16:9. */
  fill?: boolean;
}

// 16:9 Netflix-style card. Title sits on a permanent bottom gradient; hover
// scales the card up and reveals meta (rating / lessons / level / price).
const NetflixCard = ({ course, onClick, variant = 'rail', progressPercent, statusBadge, hidePrice, fill }: NetflixCardProps) => {
  const reviewCount = Number(course.review_count) || 0;
  // COUNT() จาก pg มาเป็น string — ต้องแปลงเป็นตัวเลข ไม่งั้น "0" เป็น truthy
  // แล้วเงื่อนไข Coming Soon (=== 0) ไม่ทำงาน
  const lessonCount = Number(course.lesson_count ?? course.total_lessons ?? 0);
  const width = variant === 'rail' ? 'w-[230px] md:w-[270px] flex-none snap-start' : 'w-full';
  // fill = stretch to the wrapper's height (mosaic hero cell) instead of the
  // fixed 16:9 — the wrapper's grid row-span decides how tall this card is.
  // fill = ยืดเต็ม cell ของ mosaic — แต่ mosaic มีเฉพาะ lg+ ต่ำกว่านั้นต้องเป็น 16:9
  // เหมือนใบอื่น ไม่งั้นการ์ดใบแรกบนมือถือกลายเป็นเกือบจัตุรัส + เว้นช่องว่างข้างๆ
  const shape = fill ? 'aspect-video lg:aspect-auto lg:h-full lg:min-h-[200px]' : 'aspect-video';

  return (
    <div
      onClick={onClick}
      className={`${width} ${shape} dark-stage relative rounded-md overflow-hidden bg-gray-800 cursor-pointer group/card transition-transform duration-300 hover:scale-105 hover:z-10 hover:shadow-2xl hover:shadow-black/60`}
    >
      {/* ชั้นสำรองอยู่ใต้รูปเสมอ — รูปพัง/ไม่มีปก จะซ่อนตัวเองแล้วเผยชั้นนี้
          คอร์ส Coming Soon (ยังไม่มีบท) ได้ปกออกแบบเอง ไม่ใช่กล่องเทาไอคอนหนังสือ */}
      {lessonCount === 0 ? (
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/70 via-gray-900 to-black flex flex-col items-center justify-center gap-1.5 overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -top-8 right-0 h-32 w-32 rounded-full bg-purple-500/25 blur-2xl" />
          <div aria-hidden className="pointer-events-none absolute bottom-0 -left-6 h-24 w-24 rounded-full bg-[#FFB300]/10 blur-2xl" />
          <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-purple-400/40 bg-purple-500/15">
            <Clock className="h-5 w-5 text-purple-300" />
          </div>
          <span className="relative text-sm font-extrabold tracking-widest bg-gradient-to-r from-purple-300 via-purple-200 to-[#FFB300] bg-clip-text text-transparent">
            COMING SOON
          </span>
          <span className="relative text-[10px] text-gray-400">เปิดให้เรียนเร็วๆ นี้</span>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <BookOpen className="h-10 w-10 text-gray-600" />
        </div>
      )}
      <img
        src={api.courseCoverUrl(course, 'card')}
        alt={course.name}
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Permanent bottom gradient + title
          มือถือ: การ์ดสูงแค่ ~90px — ลด padding บน + ชื่อบรรทัดเดียว ไม่ให้ทับรูปทั้งใบ */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-6 md:pt-10 pb-2 px-3">
        <h3 className="text-white text-sm font-semibold line-clamp-1 md:line-clamp-2 leading-snug drop-shadow">
          {course.name}
        </h3>
        {/* Meta: จอสัมผัสไม่มี hover → เดิมราคาจึงไม่เคยแสดงบนมือถือเลย
            มือถือแสดง "ราคา" ถาวร (ข้อมูลที่ใช้ตัดสินใจซื้อ), เดสก์ท็อปยังเผยทั้งชุดตอน hover เหมือนเดิม */}
        {!hidePrice && (
          <div className="mt-1 md:hidden">
            <CoursePrice price={course.price} discountPrice={course.discount_price} isFree={course.is_free === true} size="sm" />
          </div>
        )}
        <div className="hidden md:block max-h-0 opacity-0 group-hover/card:max-h-24 group-hover/card:opacity-100 group-hover/card:mt-1.5 transition-all duration-300 overflow-hidden">
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-300">
            {reviewCount > 0 && (
              <StarRating value={course.avg_rating ?? 0} count={reviewCount} size={11} />
            )}
            {lessonCount > 0 && (
              <span className="flex items-center gap-1">
                <BookOpen className="h-3 w-3" />
                {lessonCount} บท
              </span>
            )}
            <Badge className={`${difficultyColors[course.difficulty] || difficultyColors.beginner} border text-[10px] px-1.5 py-0`}>
              {difficultyLabels[course.difficulty] || 'เริ่มต้น'}
            </Badge>
          </div>
          {!hidePrice && (
            <div className="mt-1">
              <CoursePrice price={course.price} discountPrice={course.discount_price} isFree={course.is_free === true} size="sm" />
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
        {lessonCount === 0 && (
          <Badge className="bg-[#FFB300] text-black text-[10px] font-semibold px-1.5 py-0.5 flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            เร็วๆ นี้
          </Badge>
        )}
        {lessonCount > 0 && isNewCourse(course.created_at) && (
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
