import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Loader2,
  BookOpen,
  Play,
  CheckCircle,
  GraduationCap,
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
  status: string;
  progress_percent: number;
  completed_lessons: number[];
  enrolled_at: string;
}

const MyCourses = () => {
  const navigate = useNavigate();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('in-progress');

  useEffect(() => {
    loadEnrollments();
  }, []);

  const loadEnrollments = async () => {
    try {
      setLoading(true);
      const data = await api.getMyEnrollments();
      setEnrollments(data);
    } catch (error) {
      console.error('Failed to load enrollments:', error);
      toast.error('โหลดคอร์สของฉันไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  // Subscription model: every returned row is an active membership progress row.
  const inProgressCourses = enrollments.filter((e) => e.progress_percent < 100);
  const completedCourses = enrollments.filter((e) => e.progress_percent >= 100);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">
          <GraduationCap className="inline-block mr-2 h-7 w-7 text-purple-400" />
          คอร์สของฉัน
        </h1>
        <p className="text-gray-400 text-sm">คอร์สที่คุณกำลังเรียน</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-white">{inProgressCourses.length}</p>
            <p className="text-gray-400 text-sm">กำลังเรียน</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{completedCourses.length}</p>
            <p className="text-gray-400 text-sm">เรียนจบ</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-400">{enrollments.length}</p>
            <p className="text-gray-400 text-sm">ทั้งหมด</p>
          </CardContent>
        </Card>
      </div>

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
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {inProgressCourses.map((enrollment) => (
                <EnrollmentCard key={enrollment.id} enrollment={enrollment} onContinue={() => navigate(`/courses/${enrollment.course_slug}`)} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed">
          {completedCourses.length === 0 ? (
            <EmptyState icon={<CheckCircle className="h-12 w-12" />} title="ยังไม่มีคอร์สที่เรียนจบ" description="คอร์สที่คุณเรียนจบทุกบทเรียนจะแสดงที่นี่" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {completedCourses.map((enrollment) => (
                <EnrollmentCard key={enrollment.id} enrollment={enrollment} onContinue={() => navigate(`/courses/${enrollment.course_slug}`)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

const EnrollmentCard = ({ enrollment, onContinue }: { enrollment: Enrollment; onContinue: () => void }) => {
  const isCompleted = enrollment.progress_percent >= 100;

  return (
    <Card className="overflow-hidden group">
      <div className="relative aspect-video bg-gray-800 overflow-hidden">
        {enrollment.thumbnail_url ? (
          <img src={api.mediaUrl(enrollment.thumbnail_url)} alt={enrollment.course_name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookOpen className="h-12 w-12 text-gray-600" />
          </div>
        )}
        <Badge className={`absolute top-2 left-2 border ${isCompleted ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-purple-500/10 text-purple-400 border-purple-500/20'}`}>
          {isCompleted ? <CheckCircle className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          <span className="ml-1">{isCompleted ? 'เรียนจบแล้ว' : 'กำลังเรียน'}</span>
        </Badge>
      </div>

      <CardContent className="p-4">
        <h3 className="font-semibold text-white text-lg mb-2 line-clamp-2">{enrollment.course_name}</h3>
        {enrollment.instructor_name && <p className="text-gray-400 text-sm mb-3">{enrollment.instructor_name}</p>}

        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">ความคืบหน้า</span>
            <span className="text-white">{enrollment.progress_percent}%</span>
          </div>
          <Progress value={enrollment.progress_percent} className="h-2" />
        </div>

        <Button onClick={onContinue} className="w-full bg-purple-600 hover:bg-purple-700">
          <Play className="h-4 w-4 mr-2" />
          {isCompleted ? 'ดูอีกครั้ง' : 'เรียนต่อ'}
        </Button>
      </CardContent>
    </Card>
  );
};

const EmptyState = ({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => (
  <div className="text-center py-12">
    <div className="text-gray-500 mb-4 inline-flex">{icon}</div>
    <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
    <p className="text-gray-400 mb-4">{description}</p>
  </div>
);

export default MyCourses;
