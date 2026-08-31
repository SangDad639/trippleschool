import NetflixCard from './NetflixCard';
import type { BrowseCourse } from './browseRows';

interface FeaturedRowProps {
  title: string;
  courses: BrowseCourse[];
  onOpen: (course: BrowseCourse) => void;
}

/**
 * Mosaic block for the "มาใหม่ล่าสุด" row: the newest item gets a big cell
 * (2 columns × 2 rows) on the left, the rest flow as normal 16:9 cards in the
 * remaining columns — the small cards' aspect ratio defines the row heights and
 * the hero cell stretches to match (NetflixCard fill).
 */
const FeaturedRow = ({ title, courses, onOpen }: FeaturedRowProps) => {
  if (courses.length === 0) return null;
  return (
    <section className="mb-7 px-4 md:px-12">
      <h2 className="text-white text-base md:text-lg font-semibold mb-2">{title}</h2>
      {/* mosaic ทำงานเฉพาะ lg+ และต้องมีการ์ดใบเล็กมากำหนดความสูงแถวอย่างน้อย 1 ใบ
          ไม่งั้นการ์ดใบใหญ่ (fill) จะเหลือแค่ min-h ทำให้สัดส่วนเพี้ยนผิดจากใบอื่น */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        {courses.map((course, i) => {
          const isHero = i === 0 && courses.length > 1;
          return (
            <div key={course.id} className={isHero ? 'lg:col-span-2 lg:row-span-2' : ''}>
              <NetflixCard
                course={course}
                variant="grid"
                fill={isHero}
                onClick={() => onOpen(course)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default FeaturedRow;
