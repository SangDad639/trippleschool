import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Loader2,
  BookOpen,
  Clock,
  User,
  Play,
  Lock,
  Unlock,
  CheckCircle,
  ArrowLeft,
  GraduationCap,
  FolderOpen,
} from 'lucide-react';

interface Lesson {
  id: number;
  title: string;
  description: string;
  youtube_id: string;
  youtube_url: string;
  duration_minutes: number;
  lesson_order: number;
  is_preview: boolean;
  section_id: number | null;
}

interface Section {
  id: number;
  title: string;
  description: string;
  section_order: number;
  lessons: Lesson[];
}

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
  lessons: Lesson[];
  sections?: Section[];
  unassigned_lessons?: Lesson[];
  price: number;
  discount_price: number | null;
}

interface Enrollment {
  id: number;
  status: string;
  progress_percent: number;
  completed_lessons: number[];
  last_lesson_id: number;
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

const CourseDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasSubscription } = useSubscription();
  const isAuthenticated = !!user;
  // Membership: an active subscription (or admin) unlocks every paid lesson.
  const hasAccess = hasSubscription || !!user?.isAdmin;
  const [course, setCourse] = useState<Course | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLesson, setPreviewLesson] = useState<Lesson | null>(null);

  useEffect(() => {
    if (slug) loadCourse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isAuthenticated, hasAccess]);

  const loadCourse = async () => {
    try {
      setLoading(true);
      if (isAuthenticated) {
        const data = await api.getCourseFull(slug!);
        setCourse(data);
        setEnrollment(data.enrollment);
      } else {
        const data = await api.getCourse(slug!);
        setCourse(data);
      }
    } catch (error) {
      console.error('Failed to load course:', error);
      toast.error('โหลดคอร์สไม่สำเร็จ');
      navigate('/courses');
    } finally {
      setLoading(false);
    }
  };

  const goToSubscribe = () => navigate('/subscription/transfer-v2');

  const handleStartLearning = () => {
    if (course && course.lessons.length > 0) {
      const firstLesson = course.lessons[0]!;
      navigate(`/app/courses/${course.slug}/learn/${firstLesson.id}`);
    }
  };

  const handleContinueLearning = () => {
    if (course && enrollment?.last_lesson_id) {
      navigate(`/app/courses/${course.slug}/learn/${enrollment.last_lesson_id}`);
    } else {
      handleStartLearning();
    }
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} นาที`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} ชม. ${mins} นาที` : `${hours} ชม.`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-gray-400">ไม่พบคอร์สเรียน</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <Button variant="ghost" onClick={() => navigate('/courses')} className="mb-4 text-gray-400 hover:text-white">
          <ArrowLeft className="h-4 w-4 mr-2" />
          กลับไปหน้าคอร์สทั้งหมด
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2">
            <div className="relative aspect-video bg-gray-800 rounded-lg overflow-hidden">
              {previewLesson ? (
                <iframe
                  src={`https://www.youtube.com/embed/${previewLesson.youtube_id}?autoplay=1`}
                  title={previewLesson.title}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : course.thumbnail_url ? (
                <img src={course.thumbnail_url} alt={course.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <BookOpen className="h-20 w-20 text-gray-600" />
                </div>
              )}
            </div>
          </div>

          <div>
            <Card className="h-full">
              <CardContent className="p-4">
                <h1 className="text-lg font-bold text-white mb-2">{course.name}</h1>
                {course.short_description && <p className="text-gray-400 text-sm mb-3">{course.short_description}</p>}

                {course.instructor_name && (
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-700">
                    {course.instructor_avatar ? (
                      <img src={course.instructor_avatar} alt={course.instructor_name} className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center">
                        <User className="h-4 w-4 text-gray-400" />
                      </div>
                    )}
                    <div>
                      <p className="text-white text-sm font-medium">{course.instructor_name}</p>
                      <p className="text-gray-400 text-xs">ผู้สอน</p>
                    </div>
                  </div>
                )}

                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-gray-400 text-sm">
                    <span className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />บทเรียน</span>
                    <span className="text-white">{course.lessons?.length || 0} บท</span>
                  </div>
                  {course.duration_hours > 0 && (
                    <div className="flex items-center justify-between text-gray-400 text-sm">
                      <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />ระยะเวลา</span>
                      <span className="text-white">{course.duration_hours} ชม.</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-gray-400 text-sm">
                    <span className="flex items-center gap-1.5"><GraduationCap className="h-3.5 w-3.5" />ระดับ</span>
                    <Badge className={`${difficultyColors[course.difficulty]} border text-xs`}>
                      {difficultyLabels[course.difficulty] || 'เริ่มต้น'}
                    </Badge>
                  </div>
                </div>

                <div className="mb-4 pt-3 border-t border-gray-700 text-center">
                  <span className="text-purple-400 text-sm font-medium">เข้าถึงด้วยสมาชิกรายเดือน / รายปี</span>
                </div>

                {hasAccess ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-green-400 text-sm mb-1">
                      <CheckCircle className="h-3.5 w-3.5" /><span>คุณเป็นสมาชิก เข้าถึงได้ทุกบทเรียน</span>
                    </div>
                    {enrollment && enrollment.progress_percent > 0 && (
                      <div className="mb-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-400">ความคืบหน้า</span>
                          <span className="text-white">{enrollment.progress_percent}%</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-1.5">
                          <div className="bg-purple-500 h-1.5 rounded-full transition-all" style={{ width: `${enrollment.progress_percent}%` }} />
                        </div>
                      </div>
                    )}
                    <Button onClick={enrollment?.last_lesson_id ? handleContinueLearning : handleStartLearning} className="w-full bg-purple-600 hover:bg-purple-700 h-8 text-sm">
                      <Play className="h-3.5 w-3.5 mr-1.5" />
                      {enrollment?.last_lesson_id ? 'เรียนต่อ' : 'เริ่มเรียน'}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button onClick={goToSubscribe} className="w-full bg-purple-600 hover:bg-purple-700 h-8 text-sm">
                      <Lock className="h-3.5 w-3.5 mr-1.5" />
                      สมัครสมาชิกเพื่อปลดล็อก
                    </Button>
                    <p className="text-gray-500 text-xs text-center">ดูบทเรียนตัวอย่างฟรี • สมาชิกดูได้ทุกคอร์ส</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {course.description && (
          <Card className="mb-6">
            <CardHeader className="py-3 px-4"><CardTitle className="text-white text-base">รายละเอียดคอร์ส</CardTitle></CardHeader>
            <CardContent className="px-4 pb-4 pt-0"><p className="text-gray-300 text-sm whitespace-pre-wrap">{course.description}</p></CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-white text-base flex items-center gap-2"><BookOpen className="h-4 w-4" />เนื้อหาคอร์ส</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {(() => {
              const sections = course.sections || [];
              const unassignedLessons = course.unassigned_lessons || [];
              const allLessons = course.lessons || [];
              const hasSections = sections.length > 0;

              const renderLessonRow = (lesson: Lesson, index: number) => {
                const canAccess = lesson.is_preview || hasAccess;
                const isCompleted = enrollment?.completed_lessons?.includes(lesson.id);
                return (
                  <div
                    key={lesson.id}
                    className={`flex items-center justify-between p-2.5 rounded-md transition-colors ${canAccess ? 'bg-gray-800/50 hover:bg-gray-800 cursor-pointer' : 'bg-gray-800/30'}`}
                    onClick={() => {
                      if (lesson.is_preview && lesson.youtube_id) {
                        setPreviewLesson(previewLesson?.id === lesson.id ? null : lesson);
                      } else if (hasAccess) {
                        navigate(`/app/courses/${course.slug}/learn/${lesson.id}`);
                      } else {
                        goToSubscribe();
                      }
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-700 text-white text-xs font-medium">
                        {isCompleted ? <CheckCircle className="h-4 w-4 text-green-400" /> : index + 1}
                      </div>
                      <div>
                        <h4 className="text-white text-sm font-medium">{lesson.title}</h4>
                        {lesson.description && <p className="text-gray-400 text-xs line-clamp-1">{lesson.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {lesson.duration_minutes > 0 && <span className="text-gray-400 text-xs">{formatDuration(lesson.duration_minutes)}</span>}
                      {lesson.is_preview ? (
                        <Badge className="bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs px-1.5 py-0.5">
                          <Unlock className="h-3 w-3 mr-1" />Preview
                        </Badge>
                      ) : !hasAccess ? (
                        <Lock className="h-3.5 w-3.5 text-gray-500" />
                      ) : null}
                    </div>
                  </div>
                );
              };

              const getSectionStats = (sectionLessons: Lesson[]) => {
                const completedCount = sectionLessons.filter(l => enrollment?.completed_lessons?.includes(l.id)).length;
                const totalDuration = sectionLessons.reduce((acc, l) => acc + (l.duration_minutes || 0), 0);
                return { completedCount, totalDuration };
              };

              if (allLessons.length === 0) {
                return <p className="text-gray-400 text-center py-8">ยังไม่มีบทเรียน</p>;
              }

              if (hasSections) {
                return (
                  <div className="space-y-2">
                    <Accordion type="multiple" defaultValue={sections.map(s => s.id.toString())} className="space-y-2">
                      {sections.map((section) => {
                        const sectionLessons = section.lessons || [];
                        const { completedCount, totalDuration } = getSectionStats(sectionLessons);
                        return (
                          <AccordionItem key={section.id} value={section.id.toString()} className="border border-gray-700 rounded-md overflow-hidden bg-gray-800/30">
                            <AccordionTrigger className="px-3 py-2 hover:no-underline hover:bg-gray-800/50">
                              <div className="flex items-center justify-between w-full mr-3">
                                <div className="flex items-center gap-2">
                                  <FolderOpen className="h-4 w-4 text-purple-400" />
                                  <div className="text-left">
                                    <h3 className="text-white text-sm font-medium">{section.title}</h3>
                                    {section.description && <p className="text-gray-400 text-xs">{section.description}</p>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 text-gray-400 text-xs">
                                  <span>{sectionLessons.length} บท</span>
                                  {totalDuration > 0 && <span>{formatDuration(totalDuration)}</span>}
                                  {hasAccess && completedCount > 0 && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{completedCount}/{sectionLessons.length}</Badge>
                                  )}
                                </div>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-3 pb-3 pt-1">
                              <div className="space-y-1.5">
                                {sectionLessons.length > 0 ? (
                                  sectionLessons.map((lesson, idx) => renderLessonRow(lesson, idx))
                                ) : (
                                  <p className="text-gray-500 text-center py-2 text-xs">ยังไม่มีบทเรียนในหมวดนี้</p>
                                )}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        );
                      })}
                    </Accordion>

                    {unassignedLessons.length > 0 && (
                      <div className="border border-gray-700 rounded-md overflow-hidden bg-gray-800/20">
                        <div className="px-3 py-2 flex items-center justify-between border-b border-gray-700">
                          <div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-gray-400" /><span className="text-gray-300 text-sm font-medium">บทเรียนอื่นๆ</span></div>
                          <span className="text-gray-400 text-xs">{unassignedLessons.length} บท</span>
                        </div>
                        <div className="p-3 space-y-1.5">{unassignedLessons.map((lesson, idx) => renderLessonRow(lesson, idx))}</div>
                      </div>
                    )}
                  </div>
                );
              }

              return <div className="space-y-1.5">{allLessons.map((lesson, index) => renderLessonRow(lesson, index))}</div>;
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CourseDetail;
