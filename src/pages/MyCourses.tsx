import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import NetflixCard from '@/components/browse/NetflixCard';
import { type BrowseCourse } from '@/components/browse/browseRows';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2,
  BookOpen,
  CheckCircle,
  GraduationCap,
  Clock,
  XCircle,
} from 'lucide-react';

interface Enrollment {
  id: number;
  course_id: number;
  course_name: string;
  course_slug: string;
  thumbnail_url: string;
  instructor_name: string;
  difficulty: string;
  total_lessons: number;
  duration_hours: number;
  status: string; // 'approved' | 'pending' | 'rejected'
  progress_percent: number;
  last_lesson_id?: number | null;
  enrolled_at: string;
  updated_at: string;
}

const toBrowseCourse = (e: Enrollment) =>
  ({
    id: e.course_id,
    name: e.course_name,
    slug: e.course_slug,
    thumbnail_url: e.thumbnail_url,
    instructor_name: e.instructor_name,
    difficulty: e.difficulty,
    total_lessons: e.total_lessons,
  }) as BrowseCourse;

const byRecent = (a: Enrollment, b: Enrollment) =>
  new Date(b.updated_at || b.enrolled_at).getTime() - new Date(a.updated_at || a.enrolled_at).getTime();

// My library, Netflix-style. Purchases that aren't approved yet must NOT look
// playable — pending/rejected slips get their own sections above the tabs.
const MyCourses = () => {
  const navigate = useNavigate();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('in-progress');

  useEffect(() => {
    api
      .getMyEnrollments()
      .then(setEnrollments)
      .catch((error) => {
        console.error('Failed to load enrollments:', error);
        toast.error('โหลดคอร์สของฉันไม่สำเร็จ');
      })
      .finally(() => setLoading(false));
  }, []);

  const approved = enrollments.filter((e) => e.status === 'approved');
  const pending = enrollments.filter((e) => e.status === 'pending').sort(byRecent);
  const rejected = enrollments.filter((e) => e.status === 'rejected').sort(byRecent);
  const inProgressCourses = approved.filter((e) => e.progress_percent < 100).sort(byRecent);
  const completedCourses = approved.filter((e) => e.progress_percent >= 100).sort(byRecent);

  // Approved → jump straight back into the lesson (like the Home continue rail).
  const continueLearning = (e: Enrollment) =>
    e.last_lesson_id
      ? navigate(`/app/courses/${e.course_slug}/learn/${e.last_lesson_id}`)
      : navigate(`/courses/${e.course_slug}`);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white mb-1">
            <GraduationCap className="inline-block mr-2 h-7 w-7 text-purple-400" />
            คอร์สของฉัน
          </h1>
          <p className="text-gray-400 text-sm">คอร์สที่คุณกำลังเรียนและเรียนจบแล้ว</p>
        </div>
        {/* Stats */}
        <div className="flex gap-3">
          <StatBox label="กำลังเรียน" value={inProgressCourses.length} valueClass="text-white" />
          <StatBox label="เรียนจบ" value={completedCourses.length} valueClass="text-green-400" />
          <StatBox label="ทั้งหมด" value={approved.length} valueClass="text-gray-300" />
        </div>
      </div>

      {/* รออนุมัติสลิป */}
      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base md:text-lg font-semibold text-yellow-300 flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4" /> รออนุมัติสลิป ({pending.length})
          </h2>
          <p className="text-gray-400 text-sm mb-3">
            แอดมินกำลังตรวจสอบสลิปของคุณ — กดที่การ์ดเพื่อดูสถานะหรืออัปเดตสลิป
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {pending.map((e) => (
              <NetflixCard
                key={`pending-${e.id}`}
                course={toBrowseCourse(e)}
                variant="grid"
                hidePrice
                statusBadge={
                  <Badge className="bg-yellow-500/90 text-black text-[10px] px-1.5 py-0.5 flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" /> รออนุมัติ
                  </Badge>
                }
                onClick={() => navigate(`/courses/${e.course_slug}`)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ถูกปฏิเสธ */}
      {rejected.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base md:text-lg font-semibold text-red-400 flex items-center gap-2 mb-1">
            <XCircle className="h-4 w-4" /> การซื้อถูกปฏิเสธ ({rejected.length})
          </h2>
          <p className="text-gray-400 text-sm mb-3">
            สลิปไม่ผ่านการตรวจสอบ — กดที่การ์ดเพื่อดูรายละเอียดหรือซื้อใหม่
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {rejected.map((e) => (
              <NetflixCard
                key={`rejected-${e.id}`}
                course={toBrowseCourse(e)}
                variant="grid"
                statusBadge={
                  <Badge className="bg-red-500/90 text-white text-[10px] px-1.5 py-0.5 flex items-center gap-0.5">
                    <XCircle className="h-2.5 w-2.5" /> ถูกปฏิเสธ
                  </Badge>
                }
                onClick={() => navigate(`/courses/${e.course_slug}`)}
              />
            ))}
          </div>
        </section>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-gray-800/50 mb-6">
          <TabsTrigger value="in-progress" className="data-[state=active]:bg-purple-600">
            กำลังเรียน ({inProgressCourses.length})
          </TabsTrigger>
          <TabsTrigger value="completed" className="data-[state=active]:bg-purple-600">
            เรียนจบ ({completedCourses.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="in-progress">
          {inProgressCourses.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-12 w-12" />}
              title="ยังไม่มีคอร์สที่กำลังเรียน"
              description="เลือกคอร์สเพื่อเริ่มเรียน"
              onBrowse={() => navigate('/courses')}
            />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {inProgressCourses.map((e) => (
                <NetflixCard
                  key={`learning-${e.id}`}
                  course={toBrowseCourse(e)}
                  variant="grid"
                  hidePrice
                  progressPercent={e.progress_percent}
                  onClick={() => continueLearning(e)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed">
          {completedCourses.length === 0 ? (
            <EmptyState
              icon={<CheckCircle className="h-12 w-12" />}
              title="ยังไม่มีคอร์สที่เรียนจบ"
              description="คอร์สที่คุณเรียนจบทุกบทเรียนจะแสดงที่นี่"
            />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {completedCourses.map((e) => (
                <NetflixCard
                  key={`done-${e.id}`}
                  course={toBrowseCourse(e)}
                  variant="grid"
                  hidePrice
                  statusBadge={
                    <Badge className="bg-green-500/90 text-white text-[10px] px-1.5 py-0.5 flex items-center gap-0.5">
                      <CheckCircle className="h-2.5 w-2.5" /> เรียนจบแล้ว
                    </Badge>
                  }
                  onClick={() => navigate(`/courses/${e.course_slug}`)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

const StatBox = ({ label, value, valueClass }: { label: string; value: number; valueClass: string }) => (
  <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-2 text-center min-w-[84px]">
    <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
    <p className="text-gray-400 text-xs">{label}</p>
  </div>
);

const EmptyState = ({
  icon,
  title,
  description,
  onBrowse,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onBrowse?: () => void;
}) => (
  <div className="text-center py-12">
    <div className="text-gray-500 mb-4 inline-flex">{icon}</div>
    <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
    <p className="text-gray-400 mb-4">{description}</p>
    {onBrowse && (
      <Button onClick={onBrowse} className="bg-purple-600 hover:bg-purple-700">
        ดูคอร์สทั้งหมด
      </Button>
    )}
  </div>
);

export default MyCourses;
