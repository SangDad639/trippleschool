import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import DOMPurify from 'dompurify';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Circle,
  PlayCircle,
  ArrowLeft,
  BookOpen,
  Menu,
  X,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  Download,
  Lock,
} from 'lucide-react';

interface LessonMaterial {
  title: string;
  url: string;
  type: 'link' | 'pdf' | 'html';
  enabled?: boolean;
  content?: string;
  fileName?: string;
}

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
  materials?: LessonMaterial[];
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
  lessons: Lesson[];
  sections?: Section[];
  unassigned_lessons?: Lesson[];
}

interface Enrollment {
  id: number;
  status: string;
  progress_percent: number;
  completed_lessons: number[];
  last_lesson_id: number;
}

const CourseLearn = () => {
  const { slug, lessonId } = useParams<{ slug: string; lessonId: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});
  // Purchased (or admin) → full access. Non-buyers may still watch preview lessons.
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    if (slug) loadCourse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (course && lessonId) {
      const lesson = course.lessons.find((l) => l.id === parseInt(lessonId));
      if (lesson) {
        setCurrentLesson(lesson);
        if (enrollment?.id) {
          api.updateEnrollmentProgress(enrollment.id, { last_lesson_id: lesson.id });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, lessonId, enrollment?.id]);

  const loadCourse = async () => {
    try {
      setLoading(true);
      const data = await api.getCourseFull(slug!);
      // isEnrolled = has an APPROVED purchase for THIS course (or is admin).
      // Non-buyers are NOT redirected away — they can still watch preview lessons;
      // paid lessons render a locked overlay instead of the video.
      const access = !!data.isEnrolled;
      const previewLessons = (data.lessons || []).filter((l: Lesson) => l.is_preview);
      if (!access && previewLessons.length === 0) {
        toast.error('กรุณาซื้อคอร์สนี้ก่อน');
        navigate('/app/courses/' + slug);
        return;
      }
      setHasAccess(access);
      setCourse(data);
      // data.enrollment is the approved row (or null for admins/non-buyers). When
      // null we simply skip progress writes — don't crash.
      setEnrollment(data.enrollment ?? null);
    } catch (error) {
      console.error('Failed to load course:', error);
      toast.error('โหลดคอร์สไม่สำเร็จ');
      navigate('/courses');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!enrollment || !currentLesson) return;
    try {
      setCompleting(true);
      const result = await api.updateEnrollmentProgress(enrollment.id, {
        completed_lesson_id: currentLesson.id,
        last_lesson_id: currentLesson.id,
      });
      setEnrollment(result);
      toast.success('เรียนจบบทเรียนนี้แล้ว');
    } catch (error) {
      console.error('Failed to mark complete:', error);
    } finally {
      setCompleting(false);
    }
  };

  const goToLesson = (lesson: Lesson) => navigate(`/app/courses/${slug}/learn/${lesson.id}`);

  const goToPreviousLesson = () => {
    if (!course || !currentLesson) return;
    const currentIndex = course.lessons.findIndex((l) => l.id === currentLesson.id);
    const prevLesson = course.lessons[currentIndex - 1];
    if (currentIndex > 0 && prevLesson) goToLesson(prevLesson);
  };

  const goToNextLesson = () => {
    if (!course || !currentLesson) return;
    const currentIndex = course.lessons.findIndex((l) => l.id === currentLesson.id);
    const nextLesson = course.lessons[currentIndex + 1];
    if (currentIndex < course.lessons.length - 1 && nextLesson) goToLesson(nextLesson);
  };

  const isLessonCompleted = (id: number) => enrollment?.completed_lessons?.includes(id) || false;

  const toggleSection = (sectionId: number) => setExpandedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));

  useEffect(() => {
    if (currentLesson && course?.sections) {
      const currentSection = course.sections.find((s) => s.lessons.some((l) => l.id === currentLesson.id));
      if (currentSection && !expandedSections[currentSection.id]) {
        setExpandedSections((prev) => ({ ...prev, [currentSection.id]: true }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLesson, course?.sections]);

  const currentIndex = course?.lessons.findIndex((l) => l.id === currentLesson?.id) ?? -1;
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < (course?.lessons.length ?? 0) - 1;
  const isCurrentCompleted = currentLesson ? isLessonCompleted(currentLesson.id) : false;

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!course || !currentLesson) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-gray-400">ไม่พบบทเรียน</p>
      </div>
    );
  }

  const renderLessonRow = (lesson: Lesson, index: number) => {
    const isActive = lesson.id === currentLesson.id;
    const completed = isLessonCompleted(lesson.id);
    return (
      <div
        key={lesson.id}
        onClick={() => goToLesson(lesson)}
        className={`flex items-center gap-2.5 py-2.5 px-4 cursor-pointer border-b border-gray-800/50 transition-colors ${isActive ? 'bg-purple-500/10 border-l-2 border-l-purple-500' : 'hover:bg-gray-800/50'}`}
      >
        <div className="flex-shrink-0">
          {!hasAccess && !lesson.is_preview ? (
            <Lock className="h-4 w-4 text-gray-500" />
          ) : completed ? (
            <CheckCircle className="h-4 w-4 text-green-400" />
          ) : isActive ? (
            <PlayCircle className="h-4 w-4 text-purple-400" />
          ) : (
            <Circle className="h-4 w-4 text-gray-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${isActive ? 'text-purple-400' : 'text-white'}`}>
            {index + 1}. {lesson.title}
            {!hasAccess && lesson.is_preview && <span className="ml-1.5 text-xs text-yellow-400">(ตัวอย่าง)</span>}
          </p>
          {lesson.duration_minutes > 0 && <p className="text-xs text-gray-400">{lesson.duration_minutes} นาที</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex flex-col lg:flex-row min-h-screen">
        {/* Main Content */}
        <div className={`flex-1 ${sidebarOpen ? 'lg:mr-[320px]' : ''} transition-all duration-300`}>
          <div className="p-4 lg:p-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <Button variant="ghost" onClick={() => navigate(`/courses/${slug}`)} className="text-gray-400 hover:text-white h-8">
                <ArrowLeft className="h-4 w-4 mr-2" />กลับไปหน้าคอร์ส
              </Button>
              <Button variant="ghost" onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden text-gray-400 h-8 w-8 p-0">
                {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>

            {enrollment && (
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-gray-400">ความคืบหน้าของคุณ</span>
                  <span className="text-white font-medium">{enrollment.progress_percent}%</span>
                </div>
                <Progress value={enrollment.progress_percent} className="h-2" />
              </div>
            )}

            {!hasAccess && (
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3">
                <p className="text-sm text-yellow-200">
                  คุณกำลังดู <span className="font-semibold">ตัวอย่างคอร์ส</span> — ซื้อคอร์สเพื่อปลดล็อกทุกบทเรียน
                </p>
                <Button size="sm" className="bg-yellow-500 text-black hover:bg-yellow-400" onClick={() => navigate(`/courses/${slug}`)}>
                  ซื้อคอร์ส
                </Button>
              </div>
            )}

            <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden mb-5">
              {!hasAccess && !currentLesson.is_preview ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <Lock className="h-10 w-10 text-gray-500" />
                  <p className="text-gray-300 text-sm">บทเรียนนี้สำหรับผู้ที่ซื้อคอร์สแล้ว</p>
                  <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => navigate(`/courses/${slug}`)}>
                    ซื้อคอร์สเพื่อดูบทนี้
                  </Button>
                </div>
              ) : currentLesson.youtube_id ? (
                <iframe
                  key={currentLesson.id}
                  src={`https://www.youtube.com/embed/${currentLesson.youtube_id}?rel=0`}
                  title={currentLesson.title}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><p className="text-gray-400 text-sm">ไม่พบวิดีโอ</p></div>
              )}
            </div>

            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="text-purple-400 text-sm font-medium">บทที่ {currentIndex + 1}</span>
                    <h1 className="text-lg font-bold text-white mt-1">{currentLesson.title}</h1>
                  </div>
                  {enrollment && (
                    <Button onClick={handleMarkComplete} disabled={completing || isCurrentCompleted} variant={isCurrentCompleted ? 'outline' : 'default'} size="sm" className={`h-8 text-sm ${isCurrentCompleted ? 'text-green-400 border-green-400/50' : ''}`}>
                      {completing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                      {isCurrentCompleted ? 'เรียนจบแล้ว' : 'เรียนจบบทนี้'}
                    </Button>
                  )}
                </div>
                {currentLesson.description && <p className="text-gray-300 text-sm whitespace-pre-wrap">{currentLesson.description}</p>}

                {(() => {
                  const visible = (currentLesson.materials || []).filter((m) => m.enabled !== false);
                  const downloads = visible.filter((m) => m.type !== 'html' && (m.url || '').trim());
                  const htmlDocs = visible.filter((m) => m.type === 'html' && (m.content || '').trim());
                  if (downloads.length === 0 && htmlDocs.length === 0) return null;
                  return (
                    <div className="mt-4 pt-4 border-t border-gray-800">
                      <p className="text-sm font-medium text-white mb-2">เอกสารประกอบ</p>
                      {downloads.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {downloads.map((m, idx) => {
                            const isFolder = /\/drive\/folders\//.test(m.url);
                            const isOurFile = m.url.startsWith('/api/courses/materials/');
                            const href = api.mediaUrl(m.url) + (isOurFile && m.fileName ? `?name=${encodeURIComponent(m.fileName)}` : '');
                            return (
                              <a
                                key={idx}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-sm text-purple-300 transition-colors hover:bg-purple-500/20 hover:text-purple-200"
                              >
                                {isFolder ? <FolderOpen className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                                {isFolder ? 'เปิดโฟลเดอร์เอกสาร' : 'ดาวน์โหลด'}
                              </a>
                            );
                          })}
                        </div>
                      )}
                      {htmlDocs.map((m, idx) => {
                        const clean = DOMPurify.sanitize(m.content || '');
                        // Uploaded docs (Word/Docs exports) carry their own dark text colors,
                        // so render on a white "paper" surface to stay readable regardless.
                        const hasVisibleText = clean.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
                        return (
                          <div key={idx} className="mt-3 rounded-lg border border-gray-800 overflow-hidden">
                            {m.title && <p className="text-sm font-semibold text-white bg-gray-900/60 px-4 py-2">{m.title}</p>}
                            <div className="bg-white text-gray-900 p-4 max-h-[600px] overflow-auto">
                              {hasVisibleText ? (
                                <div
                                  className="prose prose-sm max-w-none select-text"
                                  dangerouslySetInnerHTML={{ __html: clean }}
                                />
                              ) : (
                                <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 select-text font-sans">
                                  {(m.content || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() || 'ไม่มีเนื้อหา'}
                                </pre>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button onClick={goToPreviousLesson} disabled={!hasPrevious} variant="outline" className="text-gray-300 h-9">
                <ChevronLeft className="h-4 w-4 mr-1.5" />บทก่อนหน้า
              </Button>
              <Button onClick={goToNextLesson} disabled={!hasNext} className="bg-purple-600 hover:bg-purple-700 h-9">
                บทถัดไป<ChevronRight className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Sidebar - Lesson List */}
        <div className={`fixed right-0 top-0 bottom-0 w-[320px] bg-gray-900 border-l border-gray-800 overflow-hidden transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'} z-40`}>
          <div className="p-4 border-b border-gray-800">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white flex items-center gap-2"><BookOpen className="h-4 w-4" />เนื้อหาคอร์ส</h3>
              <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(false)} className="lg:hidden h-7 w-7 p-0"><X className="h-4 w-4" /></Button>
            </div>
            <p className="text-gray-400 text-sm mt-1 truncate">{course.name}</p>
          </div>

          <div className="overflow-y-auto h-[calc(100%-72px)]">
            {(() => {
              const sections = course.sections || [];
              const unassignedLessons = course.unassigned_lessons || [];
              const hasSections = sections.length > 0;

              if (hasSections) {
                return (
                  <div>
                    {sections.map((section) => {
                      const sectionLessons = section.lessons || [];
                      const isExpanded = expandedSections[section.id] !== false;
                      const completedCount = sectionLessons.filter((l) => isLessonCompleted(l.id)).length;
                      const hasCurrentLesson = sectionLessons.some((l) => l.id === currentLesson.id);
                      return (
                        <div key={section.id}>
                          <div onClick={() => toggleSection(section.id)} className={`flex items-center justify-between py-2.5 px-4 cursor-pointer border-b border-gray-800 bg-gray-800/50 hover:bg-gray-800/70 ${hasCurrentLesson ? 'border-l-2 border-l-purple-500' : ''}`}>
                            <div className="flex items-center gap-2"><FolderOpen className="h-4 w-4 text-purple-400" /><span className="text-sm font-medium text-white truncate">{section.title}</span></div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400">{completedCount}/{sectionLessons.length}</span>
                              {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="bg-gray-900/50">
                              {sectionLessons.length > 0 ? sectionLessons.map((lesson, idx) => renderLessonRow(lesson, idx)) : <p className="text-xs text-gray-500 text-center py-3">ยังไม่มีบทเรียน</p>}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {unassignedLessons.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 py-2.5 px-4 bg-gray-800/30 border-b border-gray-800">
                          <BookOpen className="h-4 w-4 text-gray-400" /><span className="text-sm font-medium text-gray-300">อื่นๆ</span>
                          <span className="text-xs text-gray-500 ml-auto">{unassignedLessons.length} บท</span>
                        </div>
                        <div>{unassignedLessons.map((lesson, idx) => renderLessonRow(lesson, idx))}</div>
                      </div>
                    )}
                  </div>
                );
              }

              return course.lessons.map((lesson, index) => renderLessonRow(lesson, index));
            })()}
          </div>
        </div>

        {!sidebarOpen && (
          <Button onClick={() => setSidebarOpen(true)} className="fixed right-4 bottom-4 lg:right-6 lg:bottom-6 z-50 rounded-full w-12 h-12 bg-purple-600 hover:bg-purple-700 shadow-lg">
            <Menu className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default CourseLearn;
