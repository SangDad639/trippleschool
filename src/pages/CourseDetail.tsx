import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import CoursePrice from '@/components/CoursePrice';
import StarRating from '@/components/StarRating';
import ReviewList, { type Review } from '@/components/ReviewList';
import WriteReviewForm from '@/components/WriteReviewForm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  BookOpen,
  Clock,
  User,
  Play,
  Lock,
  Unlock,
  CheckCircle,
  XCircle,
  ArrowLeft,
  GraduationCap,
  FolderOpen,
  Upload,
  ShoppingCart,
  Star,
  Users,
  CheckCircle2,
  ListChecks,
  MessageSquare,
} from 'lucide-react';

const MAX_SLIP_BYTES = 10 * 1024 * 1024; // 10MB

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
  lesson_count?: number;
  // SkillLane-style enrichment fields (see backend contract).
  learning_outcomes?: string[];
  requirements?: string[];
  enrollment_count?: string; // bigint serialized as string
  avg_rating?: number;
  review_count?: string; // bigint serialized as string
}

interface Enrollment {
  id: number;
  status: string;
  progress_percent: number;
  completed_lessons: number[];
  last_lesson_id: number;
  rejection_reason?: string | null;
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
  const isAuthenticated = !!user;
  const [course, setCourse] = useState<Course | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  // hasAccess = approved purchase for THIS course (or admin) — comes from the BE.
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewLesson, setPreviewLesson] = useState<Lesson | null>(null);

  // Reviews (public read).
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewAvg, setReviewAvg] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  // Slip-upload (buy) dialog state
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (slug) {
      loadCourse();
      loadReviews();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isAuthenticated]);

  const loadReviews = async () => {
    if (!slug) return;
    try {
      const data = await api.getCourseReviews(slug);
      setReviews(data.reviews || []);
      setReviewAvg(data.avg || 0);
      setReviewCount(Number(data.count) || 0);
    } catch (error) {
      console.error('Failed to load reviews:', error);
    }
  };

  const loadCourse = async () => {
    try {
      setLoading(true);
      if (isAuthenticated) {
        const data = await api.getCourseFull(slug!);
        setCourse(data);
        setEnrollment(data.enrollment ?? null);
        setHasAccess(!!(data.isEnrolled || data.hasAccess));
      } else {
        const data = await api.getCourse(slug!);
        setCourse(data);
        setEnrollment(null);
        setHasAccess(false);
      }
    } catch (error) {
      console.error('Failed to load course:', error);
      toast.error('โหลดคอร์สไม่สำเร็จ');
      navigate('/courses');
    } finally {
      setLoading(false);
    }
  };

  const isFree = !!course && course.price === 0;
  const buyAmount = course ? (course.discount_price ?? course.price) : 0;
  const status = enrollment?.status ?? null;

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

  const openBuyDialog = () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    setSlipFile(null);
    setSlipPreview('');
    setBuyDialogOpen(true);
  };

  const handleSlipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ');
      return;
    }
    if (file.size > MAX_SLIP_BYTES) {
      toast.error('ไฟล์ใหญ่เกิน 10MB');
      return;
    }
    setSlipFile(file);
    setSlipPreview(URL.createObjectURL(file));
  };

  const handleConfirmBuy = async () => {
    if (!course) return;
    // Paid courses require a slip; free courses can confirm without one.
    if (!isFree && !slipFile) {
      toast.error('กรุณาอัปโหลดสลิปการโอนเงิน');
      return;
    }
    try {
      setSubmitting(true);
      await api.enrollCourse(course.id, slipFile ?? undefined);
      toast.success('ส่งคำขอแล้ว รอแอดมินอนุมัติ');
      setBuyDialogOpen(false);
      await loadCourse();
    } catch (error: any) {
      console.error('Failed to enroll:', error);
      toast.error(error?.message || 'ส่งคำขอไม่สำเร็จ');
    } finally {
      setSubmitting(false);
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

                {/* Stats bar */}
                {(() => {
                  const enrollCount = Number(course.enrollment_count) || 0;
                  const lessonCount = course.lesson_count || course.total_lessons || course.lessons?.length || 0;
                  const avg = course.avg_rating ?? reviewAvg;
                  const rCount = Number(course.review_count) || reviewCount;
                  const stats: React.ReactNode[] = [];
                  if (avg > 0) {
                    stats.push(
                      <span key="rating" className="flex items-center gap-1 text-yellow-400">
                        <Star className="h-3.5 w-3.5 fill-yellow-400" />
                        {avg.toFixed(1)}
                        {rCount > 0 && <span className="text-gray-400">({rCount})</span>}
                      </span>
                    );
                  }
                  if (enrollCount > 0) {
                    stats.push(
                      <span key="enroll" className="flex items-center gap-1 text-gray-300">
                        <Users className="h-3.5 w-3.5" />ผู้เรียน {enrollCount.toLocaleString()} คน
                      </span>
                    );
                  }
                  if (course.duration_hours > 0) {
                    stats.push(
                      <span key="duration" className="flex items-center gap-1 text-gray-300">
                        <Clock className="h-3.5 w-3.5" />{course.duration_hours} ชม.
                      </span>
                    );
                  }
                  if (lessonCount > 0) {
                    stats.push(
                      <span key="lessons" className="flex items-center gap-1 text-gray-300">
                        <BookOpen className="h-3.5 w-3.5" />{lessonCount} บทเรียน
                      </span>
                    );
                  }
                  stats.push(
                    <Badge key="level" className={`${difficultyColors[course.difficulty]} border text-[11px] px-1.5 py-0`}>
                      {difficultyLabels[course.difficulty] || 'เริ่มต้น'}
                    </Badge>
                  );
                  return stats.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs mb-3">{stats}</div>
                  ) : null;
                })()}

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
                  <CoursePrice price={course.price} discountPrice={course.discount_price} size="lg" className="justify-center" />
                </div>

                {hasAccess || status === 'approved' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-green-400 text-sm mb-1">
                      <CheckCircle className="h-3.5 w-3.5" /><span>✓ ซื้อคอร์สแล้ว</span>
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
                ) : status === 'pending' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-yellow-400 text-sm mb-1 rounded-md bg-yellow-500/10 border border-yellow-500/20 px-2 py-1.5">
                      <Clock className="h-3.5 w-3.5" /><span>⏳ รออนุมัติ</span>
                    </div>
                    <Button variant="outline" onClick={openBuyDialog} className="w-full h-8 text-sm border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10">
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      อัปเดตสลิป
                    </Button>
                  </div>
                ) : status === 'rejected' ? (
                  <div className="space-y-2">
                    <div className="rounded-md bg-red-500/10 border border-red-500/20 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 text-red-400 text-sm">
                        <XCircle className="h-3.5 w-3.5" /><span>ถูกปฏิเสธ</span>
                      </div>
                      {enrollment?.rejection_reason && (
                        <p className="text-red-300/80 text-xs mt-1">{enrollment.rejection_reason}</p>
                      )}
                    </div>
                    <Button onClick={openBuyDialog} className="w-full bg-purple-600 hover:bg-purple-700 h-8 text-sm">
                      <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
                      ซื้อใหม่
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button onClick={openBuyDialog} className="w-full bg-purple-600 hover:bg-purple-700 h-8 text-sm">
                      {isFree ? <Play className="h-3.5 w-3.5 mr-1.5" /> : <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />}
                      {isFree ? 'ลงทะเบียนเรียนฟรี' : `ซื้อคอร์สนี้ ฿${buyAmount.toLocaleString()}`}
                    </Button>
                    <p className="text-gray-500 text-xs text-center">ดูบทเรียนตัวอย่างฟรี • ซื้อเพื่อปลดล็อกทุกบทเรียน</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {course.learning_outcomes && course.learning_outcomes.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-400" />สิ่งที่จะได้เรียนรู้
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                {course.learning_outcomes.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-gray-300 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {course.requirements && course.requirements.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-purple-400" />พื้นฐานที่ควรมี
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <ul className="space-y-2">
                {course.requirements.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-gray-300 text-sm">
                    <span className="text-purple-400 mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

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
                        openBuyDialog();
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

        {/* Reviews */}
        <Card className="mt-6">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-purple-400" />
              รีวิวจากผู้เรียน
              {reviewCount > 0 && (
                <span className="flex items-center gap-2 ml-1">
                  <StarRating value={reviewAvg} size={14} />
                  <span className="text-gray-400 text-sm font-normal">({reviewCount} รีวิว)</span>
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 space-y-4">
            {(hasAccess || status === 'approved') && (
              <WriteReviewForm courseId={course.id} onSubmitted={loadReviews} />
            )}
            <ReviewList reviews={reviews} />
          </CardContent>
        </Card>
      </div>

      {/* Buy / slip-upload dialog */}
      <Dialog open={buyDialogOpen} onOpenChange={(open) => { if (!submitting) setBuyDialogOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-purple-400" />
              {isFree ? 'ลงทะเบียนเรียนฟรี' : 'ซื้อคอร์สนี้'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md bg-gray-800/50 px-3 py-2.5">
              <span className="text-white text-sm font-medium">{course.name}</span>
              <CoursePrice price={course.price} discountPrice={course.discount_price} size="sm" />
            </div>

            {!isFree && (
              <>
                <p className="text-gray-400 text-sm">
                  โอนเงินจำนวน <span className="text-purple-400 font-semibold">฿{buyAmount.toLocaleString()}</span> แล้วอัปโหลดสลิปการโอนเงินเพื่อให้แอดมินตรวจสอบ
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleSlipChange}
                />

                {slipPreview ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center bg-gray-900 rounded-lg p-3">
                      <img src={slipPreview} alt="สลิปการโอนเงิน" className="max-h-72 max-w-full object-contain rounded" />
                    </div>
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full">
                      <Upload className="h-4 w-4 mr-2" />
                      เลือกรูปอื่น
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-700 hover:border-purple-500/50 bg-gray-800/30 py-8 transition-colors"
                  >
                    <Upload className="h-7 w-7 text-gray-400" />
                    <span className="text-gray-300 text-sm">อัปโหลดสลิปการโอนเงิน</span>
                    <span className="text-gray-500 text-xs">รูปภาพ ขนาดไม่เกิน 10MB</span>
                  </button>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBuyDialogOpen(false)} disabled={submitting}>
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmBuy} disabled={submitting} className="bg-purple-600 hover:bg-purple-700">
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              ยืนยัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CourseDetail;
