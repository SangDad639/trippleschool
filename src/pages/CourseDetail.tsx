import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
  AlertCircle,
  Upload,
  X,
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
  rejection_reason: string;
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
  const location = useLocation();
  const { user } = useAuth();
  const isAuthenticated = !!user;
  // Public visitors reach this page at /courses/:slug; logged-in users reach it
  // at /app/courses/:slug. Send "back" to the matching course list.
  const isAppContext = location.pathname.startsWith('/app');
  const coursesListPath = isAppContext ? '/app/courses' : '/';
  const [course, setCourse] = useState<Course | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [previewLesson, setPreviewLesson] = useState<Lesson | null>(null);

  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (slug) loadCourse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isAuthenticated]);

  const loadCourse = async () => {
    try {
      setLoading(true);
      if (isAuthenticated) {
        const data = await api.getCourseFull(slug!);
        setCourse(data);
        setEnrollment(data.enrollment);
        setIsEnrolled(data.isEnrolled);
      } else {
        const data = await api.getCourse(slug!);
        setCourse(data);
      }
    } catch (error) {
      console.error('Failed to load course:', error);
      toast.error('โหลดคอร์สไม่สำเร็จ');
      navigate(coursesListPath);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEnrollDialog = () => {
    // Browsing is public, but enrolling requires an account — send unauthenticated
    // visitors to login and bring them back to this course afterwards.
    if (!isAuthenticated) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    setSlipFile(null);
    setSlipPreview(null);
    setEnrollDialogOpen(true);
  };

  const handleSlipFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        toast.error('กรุณาอัพโหลดไฟล์รูปภาพ (JPG, PNG, GIF, WebP)');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error('กรุณาอัพโหลดไฟล์ขนาดไม่เกิน 10MB');
        return;
      }
      setSlipFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setSlipPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveSlip = () => {
    setSlipFile(null);
    setSlipPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleEnroll = async () => {
    if (!slipFile) {
      toast.error('กรุณาอัพโหลดสลิปการชำระเงินก่อนลงทะเบียน');
      return;
    }
    try {
      setEnrolling(true);
      setUploading(true);
      await api.enrollCourse(course!.id, slipFile);
      setUploading(false);
      toast.success('ลงทะเบียนสำเร็จ — รอการอนุมัติจาก Admin');
      setEnrollDialogOpen(false);
      loadCourse();
    } catch (error: any) {
      toast.error(error.message || 'ลงทะเบียนไม่สำเร็จ');
    } finally {
      setEnrolling(false);
      setUploading(false);
    }
  };

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
        <Button variant="ghost" onClick={() => navigate(coursesListPath)} className="mb-4 text-gray-400 hover:text-white">
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

                <div className="mb-4 pt-3 border-t border-gray-700">
                  {course.price > 0 ? (
                    <div className="text-center">
                      {course.discount_price !== null && course.discount_price < course.price ? (
                        <div>
                          <span className="text-purple-400 font-bold text-xl">฿{course.discount_price.toLocaleString()}</span>
                          <span className="text-gray-500 text-sm line-through ml-2">฿{course.price.toLocaleString()}</span>
                          <div className="text-green-400 text-xs mt-0.5">ลด {Math.round((1 - course.discount_price / course.price) * 100)}%</div>
                        </div>
                      ) : (
                        <span className="text-purple-400 font-bold text-xl">฿{course.price.toLocaleString()}</span>
                      )}
                    </div>
                  ) : (
                    <div className="text-center"><span className="text-green-400 font-bold text-xl">ฟรี</span></div>
                  )}
                </div>

                {enrollment ? (
                  <div className="space-y-2">
                    {enrollment.status === 'approved' && (
                      <>
                        <div className="flex items-center gap-1.5 text-green-400 text-sm mb-1">
                          <CheckCircle className="h-3.5 w-3.5" /><span>ลงทะเบียนแล้ว</span>
                        </div>
                        {enrollment.progress_percent > 0 && (
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
                        <Button onClick={enrollment.last_lesson_id ? handleContinueLearning : handleStartLearning} className="w-full bg-purple-600 hover:bg-purple-700 h-8 text-sm">
                          <Play className="h-3.5 w-3.5 mr-1.5" />
                          {enrollment.last_lesson_id ? 'เรียนต่อ' : 'เริ่มเรียน'}
                        </Button>
                      </>
                    )}
                    {enrollment.status === 'pending' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-yellow-400 text-sm"><AlertCircle className="h-3.5 w-3.5" /><span>รอการอนุมัติ</span></div>
                        <Button variant="outline" onClick={handleOpenEnrollDialog} className="w-full h-8 text-sm" disabled={enrolling}>
                          {enrolling && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}อัพเดทสลิป
                        </Button>
                      </div>
                    )}
                    {enrollment.status === 'rejected' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-red-400 text-sm"><AlertCircle className="h-3.5 w-3.5" /><span>ถูกปฏิเสธ</span></div>
                        {enrollment.rejection_reason && <p className="text-gray-400 text-xs">{enrollment.rejection_reason}</p>}
                        <Button onClick={handleOpenEnrollDialog} className="w-full h-8 text-sm" disabled={enrolling}>
                          {enrolling && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}ลงทะเบียนใหม่
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <Button onClick={handleOpenEnrollDialog} className="w-full bg-purple-600 hover:bg-purple-700 h-8 text-sm">
                    ลงทะเบียนคอร์สนี้
                  </Button>
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
                const canAccess = isEnrolled || lesson.is_preview;
                const isCompleted = enrollment?.completed_lessons?.includes(lesson.id);
                return (
                  <div
                    key={lesson.id}
                    className={`flex items-center justify-between p-2.5 rounded-md transition-colors ${canAccess ? 'bg-gray-800/50 hover:bg-gray-800 cursor-pointer' : 'bg-gray-800/30'}`}
                    onClick={() => {
                      if (lesson.is_preview && lesson.youtube_id) {
                        setPreviewLesson(previewLesson?.id === lesson.id ? null : lesson);
                      } else if (isEnrolled) {
                        navigate(`/app/courses/${course.slug}/learn/${lesson.id}`);
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
                      ) : !isEnrolled ? (
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
                                  {isEnrolled && completedCount > 0 && (
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

      <Dialog open={enrollDialogOpen} onOpenChange={setEnrollDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-xl">ลงทะเบียนคอร์ส</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="text-center pb-4 border-b border-gray-700">
              <h3 className="text-lg font-medium text-white">{course?.name}</h3>
              <p className="text-gray-400 text-sm mt-1">กรุณาแนบสลิปการชำระเงินเพื่อลงทะเบียน</p>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-300">สลิปการชำระเงิน <span className="text-red-400">*</span></label>
              {slipPreview ? (
                <div className="relative">
                  <img src={slipPreview} alt="Payment slip preview" className="w-full max-h-64 object-contain rounded-lg border border-gray-700 bg-gray-800" />
                  <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-8 w-8" onClick={handleRemoveSlip}><X className="h-4 w-4" /></Button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-purple-500 transition-colors" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-10 w-10 text-gray-500 mx-auto mb-3" />
                  <p className="text-gray-400 mb-1">คลิกเพื่ออัพโหลดสลิป</p>
                  <p className="text-gray-500 text-sm">รองรับ JPG, PNG, GIF, WebP (ไม่เกิน 10MB)</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={handleSlipFileChange} className="hidden" />
            </div>

            <p className="text-gray-500 text-xs">* หลังจากส่งคำขอลงทะเบียนแล้ว Admin จะตรวจสอบสลิปและอนุมัติการเข้าถึงคอร์สให้</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollDialogOpen(false)} disabled={enrolling}>ยกเลิก</Button>
            <Button onClick={handleEnroll} disabled={enrolling || !slipFile} className="bg-purple-600 hover:bg-purple-700">
              {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {uploading ? 'กำลังอัพโหลด...' : enrolling ? 'กำลังลงทะเบียน...' : 'ยืนยันลงทะเบียน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CourseDetail;
