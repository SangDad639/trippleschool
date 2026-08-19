// Shared types + row-building logic for the Netflix-style browse surfaces
// (Storefront "/" and PublicCatalog "/courses"). No categories exist in the DB,
// so rails are derived from is_featured / created_at / enrollment_count /
// difficulty. A course may appear in several rows — that's the Netflix idiom.

export interface BrowseCourse {
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
  /** Admin pinned this course to the home-page billboard (at most one course). */
  is_billboard?: boolean;
  lesson_count: number;
  price: number;
  discount_price: number | null;
  created_at?: string;
  enrollment_count?: string; // bigint serialized as string
  avg_rating?: number;
  review_count?: string; // bigint serialized as string
  content_type?: 'course' | 'tip';
}

export interface BrowseRow {
  key: string;
  title: string;
  courses: BrowseCourse[];
}

export const difficultyColors: Record<string, string> = {
  beginner: 'bg-green-500/10 text-green-500 border-green-500/20',
  intermediate: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  advanced: 'bg-red-500/10 text-red-500 border-red-500/20',
};

export const difficultyLabels: Record<string, string> = {
  beginner: 'เริ่มต้น',
  intermediate: 'ปานกลาง',
  advanced: 'ขั้นสูง',
};

/** Course created within the last 30 days. */
export function isNewCourse(createdAt?: string): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  return Date.now() - created < 30 * 24 * 60 * 60 * 1000;
}

export function isBestseller(course: BrowseCourse): boolean {
  return Number(course.enrollment_count) >= 50 || course.is_featured;
}

/** Build the Netflix rails from the flat catalog. Empty rows are dropped. */
export function buildRows(courses: BrowseCourse[]): BrowseRow[] {
  const byNewest = [...courses].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
  const byPopular = [...courses].sort(
    (a, b) => Number(b.enrollment_count || 0) - Number(a.enrollment_count || 0)
  );
  const rows: BrowseRow[] = [
    { key: 'featured', title: 'คอร์สแนะนำ', courses: courses.filter((c) => c.is_featured) },
    { key: 'tips', title: '💡 Tip — เรียนจบในตอนเดียว', courses: courses.filter((c) => c.content_type === 'tip') },
    { key: 'new', title: 'มาใหม่ล่าสุด', courses: byNewest.filter((c) => isNewCourse(c.created_at)) },
    { key: 'popular', title: 'ยอดนิยม', courses: byPopular.filter((c) => Number(c.enrollment_count) > 0) },
    { key: 'beginner', title: 'สำหรับผู้เริ่มต้น', courses: courses.filter((c) => c.difficulty === 'beginner') },
    {
      key: 'advanced',
      title: 'ระดับกลางถึงขั้นสูง',
      courses: courses.filter((c) => c.difficulty === 'intermediate' || c.difficulty === 'advanced'),
    },
  ];
  return rows.filter((r) => r.courses.length > 0);
}
