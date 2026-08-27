import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { sanitizeMaterialHtml } from '@/lib/sanitizeMaterialHtml';
import { MaterialHtmlFrame } from '@/components/MaterialHtmlFrame';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  RefreshCw,
  WifiOff,
} from 'lucide-react';

interface LessonMaterial {
  title: string;
  url: string;
  type: 'link' | 'pdf' | 'html';
  enabled?: boolean;
  content?: string;
  fileName?: string;
  /** List payloads strip html `content` and set this flag; full content is fetched per lesson. */
  has_content?: boolean;
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
  mode?: 'basic' | 'update';
  lessons: Lesson[];
}

interface Course {
  id: number;
  name: string;
  slug: string;
  description: string;
  price?: number;
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
  const { user } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});
  // Purchased (or admin) → full access. Non-buyers may still watch preview lessons.
  const [hasAccess, setHasAccess] = useState(false);
  // Full materials per lesson (html content is stripped from list payloads and
  // fetched here on demand — a course can carry tens of MB of inline docs).
  const [fullMaterials, setFullMaterials] = useState<Record<number, LessonMaterial[]>>({});
  const [materialsLoading, setMaterialsLoading] = useState(false);
  // Load failures stay on the page (with a retry) instead of bouncing the user
  // to /courses — a single flaky mobile request used to look like a logout.
  const [loadError, setLoadError] = useState<{ expired: boolean } | null>(null);

  useEffect(() => {
    const lesson = currentLesson;
    if (!lesson) return;
    const base = lesson.materials || [];
    const missingHtml = (m: LessonMaterial) => m.type === 'html' && !(m.content || '').trim();
    // Legacy rows embed content in the DB (list payload strips it, flags has_content);
    // newer rows store the file on S3 and only carry a url.
    const needsDb = base.some((m) => missingHtml(m) && m.has_content);
    const needsS3 = base.some((m) => missingHtml(m) && (m.url || '').trim());
    if ((!needsDb && !needsS3) || fullMaterials[lesson.id]) return;
    let cancelled = false;
    setMaterialsLoading(true);
    (async () => {
      try {
        let materials = base;
        if (needsDb) {
          const r = await api.getLessonMaterials(lesson.id);
          materials = r.materials;
        }
        materials = await Promise.all(
          materials.map(async (m) => {
            if (!missingHtml(m) || !(m.url || '').trim()) return m;
            try {
              const res = await fetch(api.mediaUrl(m.url));
              return res.ok ? { ...m, content: await res.text() } : m;
            } catch {
              return m;
            }
          })
        );
        if (!cancelled) setFullMaterials((prev) => ({ ...prev, [lesson.id]: materials }));
      } catch (e) {
        console.error('Failed to load materials:', e);
      } finally {
        if (!cancelled) setMaterialsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLesson?.id]);

  useEffect(() => {
    if (slug) loadCourse();
    // user เปลี่ยน (token hydrate หลัง mount) → โหลดใหม่ให้ได้สิทธิ์/ความคืบหน้าจริง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, user?.id]);

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
      setLoadError(null);
      // Guest ใช้ endpoint public (บทดูฟรียังได้ youtube_id, บทล็อกถูก mask ฝั่ง server) —
      // ดูฟรีจึงไม่ต้อง login; บทล็อกโชว์ overlay ชวนซื้อ/สมัครเหมือนเดิม
      const data = user ? await api.getCourseFull(slug!) : await api.getCourse(slug!);
      // hasAccess = active subscription or admin. Non-members are NOT redirected away —
      // they can still watch preview lessons; member-only lessons render a locked
      // overlay with a "subscribe" CTA instead of the video.
      // คอร์สฟรี (ราคา 0) = ทุกคนดูได้ทุกบท (server เปิด youtube_id ให้แล้ว)
      const access = !!data.isEnrolled || Number(data.price) === 0;
      setHasAccess(access);
      setCourse(data);
      // data.enrollment is the progress row (or null for non-members). When null we
      // simply skip progress writes — don't crash.
      setEnrollment(data.enrollment ?? null);
    } catch (error) {
      console.error('Failed to load course:', error);
      setLoadError({ expired: (error as any)?.status === 401 });
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

  // Failed to load — stay put and let the user retry (bouncing to /courses read
  // as "the site logged me out" whenever a mobile request hiccupped).
  if (loadError) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-4 px-4 text-center">
        <WifiOff className="h-12 w-12 text-gray-500" />
        <div>
          <p className="text-lg font-semibold text-white">
            {loadError.expired ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' : 'โหลดบทเรียนไม่สำเร็จ'}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {loadError.expired
              ? 'เข้าสู่ระบบอีกครั้งเพื่อเรียนต่อ — ความคืบหน้าของคุณถูกบันทึกไว้แล้ว'
              : 'อาจเป็นเพราะสัญญาณอินเทอร์เน็ตสะดุด ลองกดโหลดใหม่อีกครั้ง'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {loadError.expired ? (
            <Button onClick={() => navigate('/login')} className="bg-purple-600 hover:bg-purple-700">
              เข้าสู่ระบบ
            </Button>
          ) : (
            <Button onClick={loadCourse} className="bg-purple-600 hover:bg-purple-700">
              <RefreshCw className="h-4 w-4 mr-2" />
              ลองใหม่
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate(`/courses/${slug}`)}>
            กลับหน้าคอร์ส
          </Button>
        </div>
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
                  คุณกำลังดู <span className="font-semibold">ตัวอย่างคอร์ส</span> — ซื้อคอร์สนี้ หรือสมัครสมาชิกเพื่อปลดล็อกทุกบทเรียน
                </p>
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="sm" variant="outline" className="border-yellow-500/50 text-yellow-200 hover:bg-yellow-500/20" onClick={() => navigate(`/courses/${slug}`)}>
                    ซื้อคอร์ส
                  </Button>
                  <Button size="sm" className="bg-yellow-500 text-black hover:bg-yellow-400" onClick={() => navigate('/subscription')}>
                    สมัครสมาชิก
                  </Button>
                </div>
              </div>
            )}

            <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden mb-5">
              {!hasAccess && !currentLesson.is_preview ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <Lock className="h-10 w-10 text-gray-500" />
                  <p className="text-gray-300 text-sm">บทเรียนนี้สำหรับผู้ที่ซื้อคอร์ส หรือสมาชิกเท่านั้น</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="border-purple-500/50 text-purple-300 hover:bg-purple-500/10" onClick={() => navigate(`/courses/${slug}`)}>
                      ซื้อคอร์สนี้
                    </Button>
                    <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => navigate('/subscription')}>
                      สมัครสมาชิก
                    </Button>
                  </div>
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
                  const source = fullMaterials[currentLesson.id] ?? currentLesson.materials ?? [];
                  const visible = source.filter((m) => m.enabled !== false);
                  const downloads = visible.filter((m) => m.type !== 'html' && (m.url || '').trim());
                  const htmlDocs = visible.filter((m) => m.type === 'html' && (m.content || '').trim());
                  if (downloads.length === 0 && htmlDocs.length === 0 && !materialsLoading) return null;
                  return (
                    <div className="mt-4 pt-4 border-t border-gray-800">
                      <p className="text-sm font-medium text-white mb-2">เอกสารประกอบ</p>
                      {materialsLoading && htmlDocs.length === 0 && (
                        <p className="text-gray-400 text-sm flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดเอกสาร...
                        </p>
                      )}
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
                        const clean = sanitizeMaterialHtml(m.content || '');
                        const hasVisibleText = clean.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
                        return (
                          <div key={idx} className="mt-3 rounded-lg border border-gray-800 overflow-hidden">
                            <div className="bg-gray-900/60 px-4 py-2">
                              <p className="text-sm font-semibold text-white truncate">{m.title || 'เอกสารประกอบ'}</p>
                            </div>
                            {hasVisibleText ? (
                              <MaterialHtmlFrame html={clean} maxHeight={600} />
                            ) : (
                              <pre className="bg-white text-gray-800 p-4 max-h-[600px] overflow-auto whitespace-pre-wrap break-words text-sm select-text font-sans">
                                {(m.content || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() || 'ไม่มีเนื้อหา'}
                              </pre>
                            )}
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

              // One collapsible section group (reused by both tabs).
              const renderSectionGroup = (section: Section) => {
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
              };

              const unassignedGroup = unassignedLessons.length > 0 ? (
                <div>
                  <div className="flex items-center gap-2 py-2.5 px-4 bg-gray-800/30 border-b border-gray-800">
                    <BookOpen className="h-4 w-4 text-gray-400" /><span className="text-sm font-medium text-gray-300">อื่นๆ</span>
                    <span className="text-xs text-gray-500 ml-auto">{unassignedLessons.length} บท</span>
                  </div>
                  <div>{unassignedLessons.map((lesson, idx) => renderLessonRow(lesson, idx))}</div>
                </div>
              ) : null;

              if (hasSections) {
                const basicSections = sections.filter((s) => (s.mode ?? 'basic') === 'basic');
                const updateSections = sections.filter((s) => s.mode === 'update');

                // No update sections → keep the original single-list sidebar (no tabs).
                if (updateSections.length === 0) {
                  return (
                    <div>
                      {sections.map(renderSectionGroup)}
                      {unassignedGroup}
                    </div>
                  );
                }

                // Default to the tab that holds the currently-playing lesson (fallback พื้นฐาน).
                const currentSection = sections.find((s) => s.lessons.some((l) => l.id === currentLesson.id));
                const defaultTab = currentSection?.mode === 'update' ? 'update' : 'basic';

                return (
                  <Tabs key={defaultTab} defaultValue={defaultTab} className="w-full">
                    <TabsList className="grid grid-cols-2 w-[calc(100%-1.5rem)] mx-3 my-3">
                      <TabsTrigger value="basic">พื้นฐาน</TabsTrigger>
                      <TabsTrigger value="update">อัพเดท</TabsTrigger>
                    </TabsList>
                    <TabsContent value="basic" className="mt-0">
                      {basicSections.map(renderSectionGroup)}
                      {unassignedGroup}
                    </TabsContent>
                    <TabsContent value="update" className="mt-0">
                      {updateSections.map(renderSectionGroup)}
                    </TabsContent>
                  </Tabs>
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
