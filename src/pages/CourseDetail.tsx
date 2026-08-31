import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PublicHeader from '@/components/PublicHeader';
import AgentChatWidget from '@/components/AgentChatWidget';
import CoursePrice from '@/components/CoursePrice';
import StarRating from '@/components/StarRating';
import ReviewList, { type Review } from '@/components/ReviewList';
import WriteReviewForm from '@/components/WriteReviewForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  Star,
  Users,
  Upload,
  ShoppingCart,
  CheckCircle2,
  ListChecks,
  Wrench,
  MessageSquare,
  RefreshCw,
  WifiOff,
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
  mode?: 'basic' | 'update';
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
  /** คอร์สฟรี (flag admin ติ๊ก): ทุกบทดูได้ไม่ต้อง login — ไม่ผูกกับราคา */
  is_free?: boolean;
  /** บทล่าสุด = ตัวที่ปกคอร์สใช้ภาพอยู่ → เข้ามาจากการ์ดแล้วเลื่อนไปหาให้เลย */
  latest_lesson_id?: number | null;
  cover_rev?: string | null;
  // SkillLane-style enrichment fields (see backend contract).
  learning_outcomes?: string[];
  requirements?: string[];
  /** เครื่องมือที่ใช้ในคอร์ส — price เป็นข้อความอิสระ, ราคาคิดตามเครดิต/แพ็กเกจรายเดือน */
  tools?: { name: string; price: string }[];
  enrollment_count?: string; // bigint serialized as string
  avg_rating?: number;
  review_count?: string; // bigint serialized as string
  content_type?: 'course' | 'tip';
  /** tag เดียวกัน = Tip เกาะคอร์สนี้ (ระบบ Tag) */
  tag_id?: number | null;
}

/** Tip ที่เกาะคอร์สนี้ (จาก list payload) + เนื้อหาที่โหลด lazy ตอนเปิด tab */
interface RelatedTip {
  id: number;
  name: string;
  slug: string;
  created_at?: string;
  tag_id?: number | null;
  /** ชื่อย่อของ Tip เอง — ใช้เป็นชื่อ tab (สั้นกว่า title) */
  tag_name?: string | null;
}
interface TipTabData {
  loading: boolean;
  error: boolean;
  course?: Course & { hasAccess?: boolean; isEnrolled?: boolean; enrollment?: Enrollment | null };
}

/** บริบทของแถวบทเรียน — คอร์สแม่กับ Tip แต่ละตัวมี slug/สิทธิ์/ความคืบหน้าของตัวเอง */
interface LessonRowCtx {
  slug: string;
  hasAccess: boolean;
  enrollment: Enrollment | null;
}

interface Enrollment {
  id: number;
  status: string;
  progress_percent: number;
  completed_lessons: number[];
  last_lesson_id: number;
  rejection_reason?: string | null;
  paid_amount?: number | string | null;
  refcode?: string | null;
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

const MAX_SLIP_BYTES = 10 * 1024 * 1024; // 10MB

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
  // Load failures stay on the page (with a retry) instead of bouncing the user
  // to /courses — a single flaky mobile request used to look like a logout.
  const [loadError, setLoadError] = useState<{ expired: boolean } | null>(null);
  // token ตายแต่ fallback public สำเร็จ → โชว์เนื้อหาแบบ guest + banner บอกให้ login ใหม่
  // (ไม่บล็อกทั้งจอ — คนซื้อแล้วจะได้รู้ว่าทำไมเห็นปุ่มซื้อ ไม่งงว่าสิทธิ์หาย)
  const [sessionExpired, setSessionExpired] = useState(false);

  // Slip-upload (buy) dialog state
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // โค้ดผู้แนะนำตอน checkout — valid แล้วราคาลด % (ตรวจกับ server ก่อนใช้)
  const [refCode, setRefCode] = useState('');
  const [refCheck, setRefCheck] = useState<{ valid: boolean; pct: number; reason?: string; code: string } | null>(null);
  const [refChecking, setRefChecking] = useState(false);

  // มาจากการ์ดที่โชว์ปกคลิปล่าสุด (?ep=latest) → เลื่อนไปที่แถวของคลิปนั้นแล้วไฮไลต์ไว้
  // ไม่งั้นผู้ใช้ต้องไล่เลื่อนหาเองในคอร์สที่มี 20 บท
  const [highlightLessonId, setHighlightLessonId] = useState<number | null>(null);

  // Tip ที่เกาะคอร์สนี้ผ่าน tag เดียวกัน → แสดงเป็น tab ต่อจาก "พื้นฐาน"
  const [relatedTips, setRelatedTips] = useState<RelatedTip[]>([]);
  const [tipData, setTipData] = useState<Record<number, TipTabData>>({});

  // Reviews (public read).
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewAvg, setReviewAvg] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

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

  // ?ep=latest (มาจากการ์ด) หรือ ?ep=<id> → เลื่อนไปที่บทนั้น + ไฮไลต์ 3 วินาที
  useEffect(() => {
    if (!course) return;
    const ep = new URLSearchParams(window.location.search).get('ep');
    if (!ep) return;
    const targetId = ep === 'latest'
      ? course.latest_lesson_id ?? course.lessons?.[course.lessons.length - 1]?.id
      : Number(ep);
    if (!targetId) return;
    setHighlightLessonId(targetId);
    // รอ DOM วาดแถวบทเรียนเสร็จก่อน (accordion/tab render หลัง course พร้อม)
    const t = setTimeout(() => {
      const el = document.getElementById(`lesson-${targetId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 350);
    const clear = setTimeout(() => setHighlightLessonId(null), 4000);
    return () => { clearTimeout(t); clearTimeout(clear); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  // หา Tip ที่เกาะคอร์สนี้ (tag_id เดียวกัน) — เฉพาะหน้าที่เป็น course และมี tag
  useEffect(() => {
    setRelatedTips([]);
    setTipData({});
    if (!course || course.content_type === 'tip' || course.tag_id == null) return;
    let cancelled = false;
    api
      .getCourses({ type: 'tip' })
      .then((tips: RelatedTip[]) => {
        if (cancelled) return;
        setRelatedTips(
          tips
            .filter((t) => t.tag_id != null && t.tag_id === course.tag_id)
            .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
        );
      })
      .catch((e) => console.error('Failed to load related tips:', e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id, course?.tag_id]);

  // โหลดเนื้อหา tip ครั้งแรกที่เปิด tab (สิทธิ์/ความคืบหน้าเป็นของ tip เอง)
  const loadTipTab = async (tip: RelatedTip) => {
    if (tipData[tip.id]?.course || tipData[tip.id]?.loading) return;
    setTipData((prev) => ({ ...prev, [tip.id]: { loading: true, error: false } }));
    try {
      const data = isAuthenticated ? await api.getCourseFull(tip.slug) : await api.getCourse(tip.slug);
      setTipData((prev) => ({ ...prev, [tip.id]: { loading: false, error: false, course: data } }));
    } catch (e) {
      console.error('Failed to load tip content:', e);
      setTipData((prev) => ({ ...prev, [tip.id]: { loading: false, error: true } }));
    }
  };

  const loadCourse = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      setSessionExpired(false);
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
      const status = (error as any)?.status;
      // Fallback ไป public view เสมอ (รวม 401 = token ตาย) — คอร์สฟรี/บท preview
      // guest ล้วนยังดูได้ ไม่ควรตันที่จอ "เซสชันหมดอายุ" ทั้งหน้า; แค่สถานะสิทธิ์หายไป
      if (isAuthenticated) {
        try {
          const data = await api.getCourse(slug!);
          setCourse(data);
          setEnrollment(null);
          setHasAccess(false);
          if (status === 401) setSessionExpired(true);
          return;
        } catch (fallbackError) {
          console.error('Public fallback also failed:', fallbackError);
        }
      }
      setLoadError({ expired: status === 401 });
    } finally {
      setLoading(false);
    }
  };

  // ฟรีตาม flag is_free (admin ติ๊ก) — ไม่ผูกกับราคาแล้ว
  const isFree = course?.is_free === true;
  // คอร์สฟรี = ไม่มียอดโอน (แม้ตั้งราคาไว้) → dialog ลงทะเบียนฟรีซ่อนช่องโค้ด/สลิป/ยอดโอนเอง
  const buyAmount = isFree ? 0 : (course ? (course.discount_price ?? course.price) : 0);
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

  const validateCode = async (raw: string, silent = false) => {
    const code = raw.trim();
    if (!code) { setRefCheck(null); return null; }
    try {
      setRefChecking(true);
      const r = await api.validateRefcode(code);
      const state = { valid: r.valid, pct: r.discount_percent, reason: r.reason, code: code.toLowerCase() };
      setRefCheck(state);
      if (!silent) {
        if (r.valid) toast.success(`ใช้โค้ดสำเร็จ 🎉 ลด ${r.discount_percent}%`);
        else toast.error(r.reason === 'OWN_CODE' ? 'ใช้โค้ดของตัวเองไม่ได้' : 'ไม่พบโค้ดนี้');
      }
      return state;
    } catch {
      if (!silent) toast.error('ตรวจสอบโค้ดไม่สำเร็จ ลองใหม่อีกครั้ง');
      return null;
    } finally {
      setRefChecking(false);
    }
  };

  const openBuyDialog = () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    setSlipFile(null);
    setSlipPreview('');
    // prefill: โค้ดที่เคยใช้กับคำสั่งซื้อนี้ (resubmit) มาก่อนโค้ดจากลิงก์แนะนำ
    const prefill = enrollment?.refcode || localStorage.getItem('ts_ref') || '';
    setRefCode(prefill);
    setRefCheck(null);
    setBuyDialogOpen(true);
    // auto-validate โค้ดที่ prefill — ให้ยอดโอนบนจอถูกตั้งแต่แรก ไม่ต้องรอกดใช้โค้ดเอง
    if (prefill.trim()) void validateCode(prefill, true);
  };

  // ยอดโอนจริง: โค้ด valid → คำนวณลดสด; ยังไม่ valid แต่คำสั่งซื้อเดิมบันทึกยอดลดไว้
  // (resubmit สลิป) → ใช้ยอดที่บันทึก (server คงค่าเดิมเมื่อไม่ส่งโค้ด) — สูตร round2 ตรงกับ server
  const storedPaid = enrollment && (enrollment.status === 'pending' || enrollment.status === 'rejected') && enrollment.paid_amount != null
    ? Number(enrollment.paid_amount)
    : null;
  const effectiveBuyAmount = refCheck?.valid
    ? Math.round(buyAmount * (1 - refCheck.pct / 100) * 100) / 100
    : (storedPaid ?? buyAmount);

  const handleCheckRefCode = () => void validateCode(refCode);

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
    if (buyAmount > 0 && !slipFile) {
      toast.error('กรุณาอัปโหลดสลิปการโอนเงิน');
      return;
    }
    // มีโค้ดในช่องแต่ยังไม่ validate (หรือแก้ข้อความหลัง validate) → ห้ามส่งเงียบๆ
    // ไม่ auto-apply เพราะยอดบนจอ/ยอดที่โอนไปแล้วอาจไม่ตรงกับยอดหลังลด
    const typed = refCode.trim().toLowerCase();
    if (typed && !(refCheck?.valid && refCheck.code === typed)) {
      toast.error('กดปุ่ม "ใช้โค้ด" เพื่อตรวจสอบโค้ดก่อน หรือลบโค้ดออกจากช่อง');
      return;
    }
    try {
      setSubmitting(true);
      await api.enrollCourse(course.id, slipFile ?? undefined, refCheck?.valid ? refCheck.code : undefined);
      toast.success('ส่งคำขอแล้ว รอแอดมินอนุมัติ');
      setBuyDialogOpen(false);
      await loadCourse();
    } catch (error: any) {
      console.error('Failed to enroll:', error);
      // โค้ดใช้ไม่ได้/สลับโค้ดไม่ได้ → เคลียร์สถานะ ✅ ค้าง ไม่ให้ราคาลดโชว์ผิดๆ
      if (error?.errorCode === 'INVALID_REFCODE' || error?.errorCode === 'REFCODE_LOCKED') {
        setRefCheck(null);
      }
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

  // Failed to load — stay put and let the user retry (bouncing to /courses read
  // as "the site logged me out" whenever a mobile request hiccupped).
  if (loadError) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader />
        <div className="flex flex-col items-center justify-center gap-4 px-4 py-24 text-center">
          <WifiOff className="h-12 w-12 text-gray-500" />
          <div>
            <p className="text-lg font-semibold text-white">
              {loadError.expired ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' : 'โหลดข้อมูลคอร์สไม่สำเร็จ'}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {loadError.expired
                ? 'เข้าสู่ระบบอีกครั้งเพื่อดูคอร์สนี้ต่อ — คอร์สที่ซื้อไว้ยังอยู่ครบ'
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
            <Button variant="outline" onClick={() => navigate('/courses')}>
              กลับหน้าคอร์สทั้งหมด
            </Button>
          </div>
        </div>
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
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <PublicHeader overlay />

      {/* token ตาย → โชว์เนื้อหาแบบ guest ได้ แต่ต้องบอกชัดว่าสิทธิ์ที่ซื้อไว้แค่มองไม่เห็น */}
      {sessionExpired && (
        <div className="relative z-20 bg-yellow-500/15 border-b border-yellow-500/30 px-4 py-2.5">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 text-sm text-yellow-200">
            <span>⚠️ เซสชันหมดอายุ — กำลังแสดงแบบผู้เยี่ยมชม สิทธิ์/ความคืบหน้าของคุณจะกลับมาหลังเข้าสู่ระบบใหม่</span>
            <Button size="sm" onClick={() => navigate('/login')} className="h-10 sm:h-7 text-xs bg-yellow-500 hover:bg-yellow-400 text-black shrink-0 w-full sm:w-auto">
              เข้าสู่ระบบใหม่
            </Button>
          </div>
        </div>
      )}

      {/* Netflix-style backdrop hero
          มือถือ: ปล่อยให้สูงตามเนื้อหา (h-auto) — เดิมตรึง 56vh แล้ววางเนื้อหาแบบ absolute
          ทำให้หัวคอร์ส/ปุ่ม "คอร์สทั้งหมด" ทะลุขึ้นไปโดนตัดใต้ header; เดสก์ท็อปคงเดิม */}
      <section className="relative h-auto min-h-[56vh] md:h-[56vh] md:min-h-[440px] w-full overflow-hidden">
        <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
          <BookOpen className="h-20 w-20 text-gray-600" />
        </div>
        <img
          src={api.courseCoverUrl(course, 'hero')}
          alt={course.name}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-black/40" />

        <div className="relative md:absolute inset-x-0 bottom-0 pt-20 md:pt-0 pb-8">
          <div className="max-w-6xl mx-auto px-4 md:px-12">
          <div className="max-w-2xl">
            <button onClick={() => navigate('/courses')} className="flex items-center gap-1 text-gray-300 hover:text-white text-sm mb-3 drop-shadow">
              <ArrowLeft className="h-4 w-4" />
              คอร์สทั้งหมด
            </button>
            <h1 className="text-white text-3xl md:text-5xl font-extrabold leading-tight mb-2 drop-shadow-lg text-balance">{course.name}</h1>
            {course.short_description && <p className="text-gray-200 text-sm md:text-base line-clamp-2 mb-3 drop-shadow">{course.short_description}</p>}

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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs md:text-sm mb-3 drop-shadow">{stats}</div>
                  ) : null;
                })()}

                {course.instructor_name && (
                  <div className="flex items-center gap-2 mb-4">
                    {course.instructor_avatar ? (
                      <img src={course.instructor_avatar} alt={course.instructor_name} className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-gray-700 flex items-center justify-center">
                        <User className="h-3.5 w-3.5 text-gray-400" />
                      </div>
                    )}
                    <p className="text-gray-300 text-sm">ผู้สอน: <span className="text-white font-medium">{course.instructor_name}</span></p>
                  </div>
                )}

                <div className="mb-3">
                  <CoursePrice price={course.price} discountPrice={course.discount_price} isFree={course.is_free === true} size="lg" />
                </div>

                <div className="max-w-sm">
                {hasAccess || status === 'approved' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-green-400 text-sm mb-1">
                      <CheckCircle className="h-3.5 w-3.5" /><span>✓ เข้าเรียนได้</span>
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
                    <Button onClick={enrollment?.last_lesson_id ? handleContinueLearning : handleStartLearning} className="w-full bg-purple-600 hover:bg-purple-700 h-11 md:h-8 text-sm">
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
                    <Button onClick={openBuyDialog} className="w-full bg-purple-600 hover:bg-purple-700 h-11 md:h-8 text-sm">
                      <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
                      ซื้อใหม่
                    </Button>
                  </div>
                ) : isFree ? (
                  /* คอร์สฟรี: กดเรียนได้ทันทีไม่ต้อง login — login มีไว้เก็บความคืบหน้าเท่านั้น */
                  <div className="space-y-2">
                    <Button onClick={handleStartLearning} className="w-full bg-purple-600 hover:bg-purple-700 h-11 md:h-8 text-sm">
                      <Play className="h-3.5 w-3.5 mr-1.5" />
                      เริ่มเรียนฟรีเลย
                    </Button>
                    {isAuthenticated ? (
                      <Button variant="outline" onClick={openBuyDialog} className="w-full h-11 md:h-8 text-sm border-purple-500/40 text-purple-300 hover:bg-purple-500/10">
                        <GraduationCap className="h-3.5 w-3.5 mr-1.5" />
                        ลงทะเบียนคอร์สนี้ (บันทึกความคืบหน้า)
                      </Button>
                    ) : (
                      <p className="text-gray-400 text-xs text-center">
                        เรียนได้เลยไม่ต้องสมัคร — <button onClick={() => navigate('/login')} className="text-purple-400 hover:underline">เข้าสู่ระบบ</button> ถ้าอยากบันทึกความคืบหน้า
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button onClick={openBuyDialog} className="w-full bg-purple-600 hover:bg-purple-700 h-11 md:h-8 text-sm">
                      <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
                      ซื้อคอร์สนี้ ฿{buyAmount.toLocaleString()}
                    </Button>
                    <div className="py-1 text-center"><span className="text-gray-500 text-xs">— หรือ —</span></div>
                    <Button variant="outline" onClick={() => navigate('/subscription')} className="w-full h-11 md:h-8 text-sm border-purple-500/40 text-purple-300 hover:bg-purple-500/10">
                      <GraduationCap className="h-3.5 w-3.5 mr-1.5" />
                      สมัครสมาชิก เข้าเรียนได้ทุกคอร์ส
                    </Button>
                    <p className="text-gray-400 text-xs">ดูบทเรียนตัวอย่างฟรี • ซื้อคอร์สนี้ หรือสมัครสมาชิกเพื่อปลดล็อกทั้งหมด</p>
                  </div>
                )}
                </div>
          </div>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 md:px-12 py-8">
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

        {course.tools && course.tools.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Wrench className="h-4 w-4 text-purple-400" />เครื่องมือที่ใช้ในคอร์ส
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
              <ul className="space-y-2">
                {course.tools.map((tool, idx) => (
                  <li key={idx} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-start gap-2 text-gray-300 min-w-0">
                      <span className="text-purple-400 mt-0.5">🛠️</span>
                      <span>{tool.name}</span>
                    </span>
                    {tool.price && (
                      <span className="text-[#FFB300] font-medium whitespace-nowrap">เริ่มต้น {tool.price}</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2.5 text-xs text-yellow-200/90">
                ⚠️ หมายเหตุ: ราคาเริ่มต้นคิดตามเครดิต / แพ็กเกจรายเดือนของแต่ละเครื่องมือ
              </div>
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

              // Netflix-style episode row: video cover left (YouTube thumb via
              // our proxy — the video id never reaches the client), info right.
              // ctx = คอร์สแม่หรือ Tip แต่ละตัว (คนละ slug/สิทธิ์/ความคืบหน้า)
              const rowCtx: LessonRowCtx = { slug: course.slug, hasAccess: hasAccess || isFree, enrollment };
              const renderLessonRow = (lesson: Lesson, index: number, ctx: LessonRowCtx = rowCtx) => {
                const isCompleted = ctx.enrollment?.completed_lessons?.includes(lesson.id);
                const locked = !lesson.is_preview && !ctx.hasAccess;
                const isLatest = lesson.id === course.latest_lesson_id;
                const isHighlighted = lesson.id === highlightLessonId;
                return (
                  <div
                    key={lesson.id}
                    id={`lesson-${lesson.id}`}
                    className={`group flex gap-3 p-2 rounded-lg transition-all cursor-pointer ${
                      isHighlighted
                        ? 'bg-purple-500/20 ring-2 ring-purple-400 shadow-lg shadow-purple-500/20'
                        : 'bg-gray-800/40 hover:bg-gray-800'
                    }`}
                    onClick={() => navigate(`/app/courses/${ctx.slug}/learn/${lesson.id}`)}
                  >
                    {/* Cover */}
                    <div className="relative w-28 sm:w-36 md:w-44 aspect-video flex-none rounded-md overflow-hidden bg-gradient-to-br from-gray-700 to-gray-800">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <BookOpen className="h-6 w-6 text-gray-600" />
                      </div>
                      <img
                        src={api.mediaUrl(`/api/courses/lessons/${lesson.id}/thumb`)}
                        alt=""
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        className={`absolute inset-0 w-full h-full object-cover ${locked ? 'opacity-50' : ''}`}
                      />
                      {locked ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Lock className="h-5 w-5 text-white/90 drop-shadow" />
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="w-9 h-9 rounded-full bg-black/60 flex items-center justify-center">
                            <Play className="h-4 w-4 text-white ml-0.5" />
                          </div>
                        </div>
                      )}
                      {isCompleted && (
                        <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                          <CheckCircle className="h-3.5 w-3.5 text-white" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 py-0.5 flex flex-col">
                      <h4 className="text-white text-sm font-medium leading-snug line-clamp-2">
                        <span className="text-purple-400 font-semibold mr-1.5">EP.{index + 1}</span>
                        {/* บทล่าสุด = ตัวที่ปกคอร์สใช้ภาพอยู่ ทำป้ายให้หาเจอง่ายแม้ไม่ได้มาจากการ์ด */}
                        {isLatest && (
                          <Badge className="mr-1.5 bg-purple-500/20 text-purple-300 border border-purple-400/40 text-[10px] px-1.5 py-0 align-middle">
                            ล่าสุด
                          </Badge>
                        )}
                        {lesson.title}
                      </h4>
                      {lesson.description && (
                        <p className="text-gray-400 text-xs mt-0.5 line-clamp-1 sm:line-clamp-2">{lesson.description}</p>
                      )}
                      <div className="mt-auto pt-1 flex items-center gap-2 text-xs">
                        {lesson.duration_minutes > 0 && (
                          <span className="text-gray-400 flex items-center gap-1">
                            <Play className="h-3 w-3" />{formatDuration(lesson.duration_minutes)}
                          </span>
                        )}
                        {lesson.is_preview && (
                          <Badge className="bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] px-1.5 py-0">
                            <Unlock className="h-2.5 w-2.5 mr-1" />ดูฟรี
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              };

              const getSectionStats = (sectionLessons: Lesson[]) => {
                const completedCount = sectionLessons.filter(l => enrollment?.completed_lessons?.includes(l.id)).length;
                const totalDuration = sectionLessons.reduce((acc, l) => acc + (l.duration_minutes || 0), 0);
                return { completedCount, totalDuration };
              };

              // Accordion for an arbitrary list of sections (reused by both tabs).
              const renderSectionAccordion = (list: Section[]) => (
                <Accordion type="multiple" defaultValue={list.map(s => s.id.toString())} className="space-y-2">
                  {list.map((section) => {
                    const sectionLessons = section.lessons || [];
                    const { completedCount, totalDuration } = getSectionStats(sectionLessons);
                    return (
                      <AccordionItem key={section.id} value={section.id.toString()} className="border border-gray-700 rounded-md overflow-hidden bg-gray-800/30">
                        <AccordionTrigger className="px-3 py-2 hover:no-underline hover:bg-gray-800/50">
                          <div className="flex items-center justify-between gap-2 w-full mr-3 min-w-0">
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
              );

              const unassignedBlock = unassignedLessons.length > 0 ? (
                <div className="border border-gray-700 rounded-md overflow-hidden bg-gray-800/20">
                  <div className="px-3 py-2 flex items-center justify-between border-b border-gray-700">
                    <div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-gray-400" /><span className="text-gray-300 text-sm font-medium">บทเรียนอื่นๆ</span></div>
                    <span className="text-gray-400 text-xs">{unassignedLessons.length} บท</span>
                  </div>
                  <div className="p-3 space-y-1.5">{unassignedLessons.map((lesson, idx) => renderLessonRow(lesson, idx))}</div>
                </div>
              ) : null;

              // ---------- เนื้อหาของคอร์สนี้เอง (= tab "พื้นฐาน" เมื่อมี tip เกาะ) ----------
              const basicContent = (() => {
                if (allLessons.length === 0) {
                  return <p className="text-gray-400 text-center py-8">ยังไม่มีบทเรียน</p>;
                }
                if (hasSections) {
                  const basicSections = sections.filter(s => (s.mode ?? 'basic') === 'basic');
                  const updateSections = sections.filter(s => s.mode === 'update');

                  // No update sections → render exactly as before (no inner tabs).
                  if (updateSections.length === 0) {
                    return (
                      <div className="space-y-2">
                        {renderSectionAccordion(sections)}
                        {unassignedBlock}
                      </div>
                    );
                  }

                  // Mixed basic/update → two inner tabs; unassigned lessons live under พื้นฐาน.
                  return (
                    <Tabs defaultValue="basic">
                      <TabsList className="mb-3">
                        <TabsTrigger value="basic">พื้นฐาน</TabsTrigger>
                        <TabsTrigger value="update">อัพเดท</TabsTrigger>
                      </TabsList>
                      <TabsContent value="basic" className="mt-0 space-y-2">
                        {renderSectionAccordion(basicSections)}
                        {unassignedBlock}
                      </TabsContent>
                      <TabsContent value="update" className="mt-0 space-y-2">
                        {renderSectionAccordion(updateSections)}
                      </TabsContent>
                    </Tabs>
                  );
                }
                return <div className="space-y-1.5">{allLessons.map((lesson, index) => renderLessonRow(lesson, index))}</div>;
              })();

              // ไม่มี Tip เกาะ → หน้าตาเดิมทุกอย่าง ไม่มี tab bar
              if (relatedTips.length === 0) return basicContent;

              // มี Tip เกาะ (tag เดียวกัน) → tab นอก: "พื้นฐาน" + Tip แต่ละตัว
              // ชื่อ tab = tag_name ของ tip เอง (admin ตั้ง) → ไม่มีค่อยตัด title
              const tipLabel = (t: RelatedTip) => {
                if (t.tag_name) return t.tag_name;
                const n = t.name.trim();
                return n.length > 20 ? `${n.slice(0, 20)}…` : n;
              };
              return (
                <Tabs
                  defaultValue="basic"
                  onValueChange={(v) => {
                    const tip = relatedTips.find((t) => `tip-${t.id}` === v);
                    if (tip) loadTipTab(tip);
                  }}
                >
                  <TabsList className="mb-3 flex-wrap h-auto gap-1">
                    <TabsTrigger value="basic">พื้นฐาน</TabsTrigger>
                    {relatedTips.map((t) => (
                      <TabsTrigger key={t.id} value={`tip-${t.id}`} title={t.name}>
                        {tipLabel(t)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <TabsContent value="basic" className="mt-0">
                    {basicContent}
                  </TabsContent>
                  {relatedTips.map((t) => {
                    const data = tipData[t.id];
                    return (
                      <TabsContent key={t.id} value={`tip-${t.id}`} className="mt-0">
                        {!data || data.loading ? (
                          <div className="flex justify-center py-10">
                            <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                          </div>
                        ) : data.error || !data.course ? (
                          <div className="text-center py-8">
                            <p className="text-gray-400 text-sm mb-3">โหลดเนื้อหาไม่สำเร็จ</p>
                            <Button size="sm" variant="outline" onClick={() => loadTipTab(t)}>
                              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />ลองใหม่
                            </Button>
                          </div>
                        ) : (
                          (() => {
                            const tc = data.course;
                            // สิทธิ์/ความคืบหน้า/ปลายทาง = ของ tip เอง ไม่ใช่คอร์สแม่ (ฟรีตาม flag is_free)
                            const tipCtx: LessonRowCtx = {
                              slug: tc.slug,
                              hasAccess: !!(tc.isEnrolled || tc.hasAccess) || tc.is_free === true,
                              enrollment: tc.enrollment ?? null,
                            };
                            const tipLessons = tc.lessons || [];
                            return tipLessons.length === 0 ? (
                              <p className="text-gray-400 text-center py-8">ยังไม่มีบทเรียน</p>
                            ) : (
                              <div className="space-y-1.5">
                                {tipLessons.map((l, i) => renderLessonRow(l, i, tipCtx))}
                              </div>
                            );
                          })()
                        )}
                      </TabsContent>
                    );
                  })}
                </Tabs>
              );
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
              <CoursePrice price={course.price} discountPrice={course.discount_price} isFree={course.is_free === true} size="sm" />
            </div>

            {buyAmount > 0 && (
              <>
                {/* โค้ดผู้แนะนำ = ส่วนลดตอนซื้อ + เจ้าของโค้ดได้ค่าคอม */}
                <div className="space-y-1.5">
                  <p className="text-gray-300 text-xs font-medium">🎟️ โค้ดผู้แนะนำ (ถ้ามี)</p>
                  <div className="flex gap-2">
                    <Input
                      value={refCode}
                      onChange={(e) => { setRefCode(e.target.value); setRefCheck(null); }}
                      placeholder="กรอกโค้ดเพื่อรับส่วนลด"
                      className="h-11 md:h-9 font-mono"
                      disabled={submitting}
                    />
                    <Button
                      variant="outline"
                      onClick={handleCheckRefCode}
                      disabled={refChecking || !refCode.trim() || submitting}
                      className="h-11 md:h-9 text-xs shrink-0 border-purple-500/40 text-purple-300 hover:bg-purple-500/10"
                    >
                      {refChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'ใช้โค้ด'}
                    </Button>
                  </div>
                  {refCheck?.valid && (
                    <p className="text-green-400 text-xs">
                      ✅ ใช้โค้ดแล้ว ลด {refCheck.pct}% (−฿{(buyAmount - effectiveBuyAmount).toLocaleString()})
                    </p>
                  )}
                  {refCheck && !refCheck.valid && (
                    <p className="text-red-400 text-xs">
                      ❌ {refCheck.reason === 'OWN_CODE' ? 'ใช้โค้ดของตัวเองไม่ได้' : 'ไม่พบโค้ดนี้ ตรวจสอบอีกครั้ง'}
                    </p>
                  )}
                </div>

                <p className="text-gray-400 text-sm">
                  โอนเงินจำนวน{' '}
                  {effectiveBuyAmount !== buyAmount && (
                    <span className="line-through text-gray-500 mr-1">฿{buyAmount.toLocaleString()}</span>
                  )}
                  <span className="text-purple-400 font-semibold">฿{effectiveBuyAmount.toLocaleString()}</span> แล้วอัปโหลดสลิปการโอนเงินเพื่อให้แอดมินตรวจสอบ
                </p>
                {storedPaid != null && !refCheck?.valid && enrollment?.refcode && (
                  <p className="text-green-400/80 text-xs">
                    🎟️ คำสั่งซื้อนี้ใช้โค้ด <span className="font-mono">{enrollment.refcode}</span> ไปแล้ว — ยอดโอนตามส่วนลดเดิม
                  </p>
                )}

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

      {/* Per-course AI assistant — separate chat session for each course */}
      <AgentChatWidget courseId={course.id} courseName={course.name} />
    </div>
  );
};

export default CourseDetail;
