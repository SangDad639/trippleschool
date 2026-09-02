import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useState, useEffect, useRef, lazy, Suspense } from "react";

declare global {
  interface Window {
    ttq: any;
    fbq: any;
    gtag: any;
  }
}

// Google Analytics page tracking
const usePageTracking = () => {
  const location = useLocation();

  useEffect(() => {
    if (typeof window.gtag === 'function') {
      window.gtag('config', 'G-X91J5T18HX', {
        page_path: location.pathname + location.search,
      });
    }
  }, [location]);
};
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";
import SubscriptionWarningBanner from "@/components/SubscriptionWarningBanner";
import AdminNotificationBanner from "@/components/AdminNotificationBanner";
import PublicHeader from "@/components/PublicHeader";
// Eager: public surfaces every visitor hits (fast first paint, no extra roundtrip).
import Storefront from "@/pages/Storefront";
import PublicCatalog from "@/pages/PublicCatalog";
import TipsCatalog from "@/pages/TipsCatalog";
import ArticlesCatalog from "@/pages/ArticlesCatalog";
import ArticleDetail from "@/pages/ArticleDetail";
import Programs from "@/pages/Programs";
import ProgramDetail from "@/pages/ProgramDetail";
import EbooksCatalog from "@/pages/EbooksCatalog";
import EbookDetail from "@/pages/EbookDetail";
import Pricing from "@/pages/Pricing";
import CourseDetail from "@/pages/CourseDetail";
// Lazy: heavy / logged-in / admin pages — split out of the initial bundle so
// casual visitors never download them.
const Subscription = lazy(() => import("@/pages/Subscription"));
const SubscriptionSuccess = lazy(() => import("@/pages/SubscriptionSuccess"));
const Admin = lazy(() => import("@/pages/Admin"));
const AdminAffiliate = lazy(() => import("@/pages/AdminAffiliate"));
const AdminBanners = lazy(() => import("@/pages/AdminBanners"));
const AdminBannerEditor = lazy(() => import("@/pages/AdminBannerEditor"));
const Profile = lazy(() => import("@/pages/Profile"));
const Affiliate = lazy(() => import("@/pages/Affiliate"));
const Tutorials = lazy(() => import("@/pages/Tutorials"));
const AffiliateInfo = lazy(() => import("@/pages/AffiliateInfo"));
const Update = lazy(() => import("@/pages/Update"));
const UpdateDetail = lazy(() => import("@/pages/Update").then((m) => ({ default: m.UpdateDetail })));
const SubscriptionTransferV2 = lazy(() => import("@/pages/SubscriptionTransferV2"));
const CheckoutComplete = lazy(() => import("@/pages/CheckoutComplete"));
const PendingApproval = lazy(() => import("@/pages/PendingApproval"));
const CourseLearn = lazy(() => import("@/pages/CourseLearn"));
const MyCourses = lazy(() => import("@/pages/MyCourses"));
const AdminCourses = lazy(() => import("@/pages/AdminCourses"));
const AdminArticles = lazy(() => import("@/pages/AdminArticles"));
const AdminEbooks = lazy(() => import("@/pages/AdminEbooks"));
const GuideGroup = lazy(() => import("@/pages/GuideGroup"));
const AdminGuide = lazy(() => import("@/pages/AdminGuide"));
const AdminEnrollments = lazy(() => import("@/pages/AdminEnrollments"));
const AdminChats = lazy(() => import("@/pages/AdminChats"));
// Hidden page (/guide) — no nav tab, fully public. Clips are admin-managed (/admin/guide).
const Guide = lazy(() => import("@/pages/Guide"));

// Login/Register page
const AuthPage = () => {
  const { login, register, googleLogin } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const refcode = searchParams.get('ref');
  const isLogin = location.pathname === "/login";

  // เก็บโค้ดจากลิงก์แนะนำไว้ prefill ช่องโค้ดตอน checkout (ซื้อคอร์ส/สมัครสมาชิก)
  useEffect(() => {
    if (refcode) localStorage.setItem('ts_ref', refcode);
  }, [refcode]);

  // ปุ่ม Google รับความกว้างเป็น px — คำนวณจากจอจริงกันล้นการ์ดบนมือถือ (การ์ด max-w-md + padding)
  const [googleBtnWidth, setGoogleBtnWidth] = useState(() =>
    typeof window === 'undefined' ? 350 : Math.min(350, window.innerWidth - 80)
  );
  useEffect(() => {
    const onResize = () => setGoogleBtnWidth(Math.min(350, window.innerWidth - 80));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPendingApproval(false);

    if (!isLogin && password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
        navigate('/courses', { replace: true });
      } else {
        const result = await register(
          email,
          password,
          refcode || undefined,
        );
        if (result.pendingApproval) {
          setPendingApproval(true);
          window.ttq?.track('CompleteRegistration');
          window.fbq?.('track', 'CompleteRegistration');
          window.gtag?.('event', 'sign_up', { method: 'email' });
        } else if (result.success) {
          window.ttq?.track('CompleteRegistration');
          window.fbq?.('track', 'CompleteRegistration');
          window.gtag?.('event', 'sign_up', { method: 'email' });
          navigate('/courses', { replace: true });
        } else {
          setError(t('auth.registerFailed'));
        }
      }
    } catch (err: any) {
      if (err.message === "Account pending approval") {
        setPendingApproval(true);
      } else {
        setError(err.message || (isLogin ? t('auth.loginFailed') : t('auth.registerFailed')));
      }
    }
    setLoading(false);
  };

  const switchMode = () => {
    setError("");
    setPendingApproval(false);
    setConfirmPassword("");
    navigate(isLogin ? "/register" : "/login", { replace: true });
  };

  return (
    <div className="page-wrapper flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-primary">Triple School</h1>
          <p className="text-muted-foreground mt-2">คอร์สเรียนออนไลน์</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card p-6 rounded-lg border">
          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-2 rounded bg-input border border-border"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('auth.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-2 rounded bg-input border border-border"
              required
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-sm font-medium mb-1">{t('auth.confirmPassword')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full p-2 rounded bg-input border border-border"
                required
              />
            </div>
          )}

          {error && <p className="text-destructive text-sm">{error}</p>}

          {pendingApproval && (
            <div className="p-4 rounded bg-yellow-500/10 border border-yellow-500/30">
              <p className="text-yellow-500 text-sm text-center">
                {isLogin
                  ? t('auth.pendingApprovalLogin')
                  : t('auth.pendingApprovalRegister')}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground p-2 rounded font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? t('common.loading') : isLogin ? t('auth.login') : t('auth.register')}
          </button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <div className="flex justify-center w-full overflow-hidden">
            <GoogleLogin
              onSuccess={async (credentialResponse) => {
                if (credentialResponse.credential) {
                  setLoading(true);
                  setError("");
                  try {
                    await googleLogin(credentialResponse.credential, refcode || undefined);
                    if (!isLogin) {
                      window.ttq?.track('CompleteRegistration');
                      window.fbq?.('track', 'CompleteRegistration');
                      window.gtag?.('event', 'sign_up', { method: 'google' });
                    }
                    navigate('/courses', { replace: true });
                  } catch (err: any) {
                    setError(err.message || 'Google login failed');
                  }
                  setLoading(false);
                }
              }}
              onError={() => {
                setError('Google login failed');
              }}
              theme="filled_black"
              size="large"
              // ปุ่ม Google รับ width เป็น px เท่านั้น — 350 คงที่ล้นการ์ดบนจอ 360
              width={googleBtnWidth}
              text={isLogin ? "signin_with" : "signup_with"}
            />
          </div>

          <p className="text-center text-sm text-muted-foreground">
            {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}{" "}
            <button
              type="button"
              onClick={switchMode}
              className="text-primary hover:underline"
            >
              {isLogin ? t('auth.register') : t('auth.login')}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
};

// Protected route wrapper
const ProtectedRoute = ({ children, allowPending = false }: { children: React.ReactNode; allowPending?: boolean }) => {
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="page-wrapper flex items-center justify-center">
        <div className="text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  // A token that survived bootstrap means the session is probably fine and the
  // check just failed (offline, 5xx). Offer a retry instead of dumping the user
  // on /login, which reads as "the site logged me out".
  if (!user && api.getToken()) {
    return (
      <div className="page-wrapper flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-semibold">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ชั่วคราว</p>
        <p className="text-sm text-muted-foreground">
          บัญชีของคุณยังอยู่ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="bg-primary text-primary-foreground px-4 py-2 rounded font-medium hover:opacity-90"
          >
            ลองใหม่
          </button>
          <button
            onClick={() => {
              api.setToken(null);
              window.location.assign('/login');
            }}
            className="border border-border px-4 py-2 rounded font-medium hover:bg-muted"
          >
            เข้าสู่ระบบใหม่
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Check if user is approved (admin always approved)
  if (!user.isApproved && !user.isAdmin && !allowPending) {
    return <Navigate to="/pending-approval" replace />;
  }

  return <>{children}</>;
};

// Logged-in page chrome for the in-app course pages (My Courses).
const AppShell = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-background text-foreground">
    <PublicHeader />
    <div className="px-4 py-8">{children}</div>
  </div>
);

/**
 * Listens for `subscription:required` events from the API layer (api.ts) and
 * performs an SPA navigation to /subscription. Replaces the old hard
 * `window.location.href` redirect which caused refresh loops on slow devices.
 *
 * `firedRef` dedups bursts so navigate() runs at most once per visit to a
 * protected route. The flag resets once the user reaches /subscription* so
 * subsequent excursions to protected pages still redirect.
 */
function SubscriptionRedirectHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const firedRef = useRef(false);

  useEffect(() => {
    const onRequired = () => {
      if (firedRef.current) return;
      if (location.pathname.startsWith('/subscription')) return;
      firedRef.current = true;
      navigate('/subscription/transfer-v2', { replace: true });
    };
    window.addEventListener('subscription:required', onRequired as EventListener);
    return () => window.removeEventListener('subscription:required', onRequired as EventListener);
  }, [navigate, location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/subscription')) firedRef.current = false;
  }, [location.pathname]);

  return null;
}

function AppRoutes() {
  const { loading } = useAuth();
  usePageTracking(); // Track page views on route change

  if (loading) {
    return (
      <div className="page-wrapper flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <Routes>
      {/* ---------- Public (no login) ---------- */}
      <Route path="/" element={<Storefront />} />
      <Route path="/courses" element={<PublicCatalog />} />
      <Route path="/tips" element={<TipsCatalog />} />
      <Route path="/content" element={<ArticlesCatalog />} />
      <Route path="/content/:slug" element={<ArticleDetail />} />
      <Route path="/ebooks" element={<EbooksCatalog />} />
      <Route path="/ebooks/:slug" element={<EbookDetail />} />
      <Route path="/programs" element={<Programs />} />
      <Route path="/programs/:slug" element={<ProgramDetail />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/courses/:slug" element={<CourseDetail />} />
      <Route path="/tutorials" element={<Tutorials />} />
      <Route path="/affiliate-info" element={<AffiliateInfo />} />
      <Route path="/update" element={<Update />} />
      <Route path="/update/:id" element={<UpdateDetail />} />

      {/* Hidden from the nav, open to everyone (no login, no plan). Blank for now. */}
      <Route path="/guide" element={<Guide />} />
      <Route path="/guide/:slug" element={<GuideGroup />} />
      <Route path="/help" element={<Navigate to="/guide" replace />} />

      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage />} />
      <Route
        path="/pending-approval"
        element={<PendingApproval />}
      />

      {/* ---------- Subscription (manual transfer) ---------- */}
      <Route path="/subscription" element={<ProtectedRoute><Subscription /></ProtectedRoute>} />
      <Route path="/subscription/success" element={<ProtectedRoute><SubscriptionSuccess /></ProtectedRoute>} />
      <Route path="/subscription/transfer-v2" element={<ProtectedRoute><SubscriptionTransferV2 /></ProtectedRoute>} />
      <Route path="/subscription/checkout-complete" element={<ProtectedRoute><CheckoutComplete /></ProtectedRoute>} />

      {/* ---------- Admin ---------- */}
      <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
      <Route path="/admin/affiliate" element={<ProtectedRoute><AdminAffiliate /></ProtectedRoute>} />
      <Route path="/admin/banners" element={<ProtectedRoute><AdminBanners /></ProtectedRoute>} />
      <Route path="/admin/banners/:id/edit" element={<ProtectedRoute><AdminBannerEditor /></ProtectedRoute>} />
      <Route path="/admin/courses" element={<ProtectedRoute><AdminCourses /></ProtectedRoute>} />
      <Route path="/admin/articles" element={<ProtectedRoute><AdminArticles /></ProtectedRoute>} />
      <Route path="/admin/ebooks" element={<ProtectedRoute><AdminEbooks /></ProtectedRoute>} />
      <Route path="/admin/guide" element={<ProtectedRoute><AdminGuide /></ProtectedRoute>} />
      <Route path="/admin/enrollments" element={<ProtectedRoute><AdminEnrollments /></ProtectedRoute>} />
      <Route path="/admin/chats" element={<ProtectedRoute><AdminChats /></ProtectedRoute>} />

      {/* ---------- User ---------- */}
      <Route path="/affiliate" element={<ProtectedRoute><Affiliate /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

      {/* ---------- In-app course area ---------- */}
      <Route path="/app/my-courses" element={<ProtectedRoute><AppShell><MyCourses /></AppShell></ProtectedRoute>} />
      {/* หน้าเรียนเปิด public — บท "ดูฟรี" ดูได้โดยไม่ต้อง login; บทล็อกโชว์ overlay ชวนซื้อ/สมัครแทน */}
      <Route path="/app/courses/:slug/learn/:lessonId" element={<CourseLearn />} />
      {/* Old in-app detail paths now resolve to the single public detail page. */}
      <Route path="/app/courses/:slug" element={<ResolveShareRef fallback="course" />} />
      <Route path="/app/courses" element={<Navigate to="/courses" replace />} />
      <Route path="/app" element={<Navigate to="/app/my-courses" replace />} />
      <Route path="/app/*" element={<Navigate to="/app/my-courses" replace />} />

      {/* ลิงก์สั้นแบบ bitly — triple-school.com/{รหัส} เด้งเข้าวิดีโอ/คอร์สทันที
          (เส้นทาง static ทั้งหมดข้างบนชนะ dynamic segment เสมอ จึงไม่ทับ /login /pricing ฯลฯ
           ref ที่ไขไม่ออกจะถูกพากลับหน้าแรก = พฤติกรรม catch-all เดิมของ path เดี่ยว) */}
      <Route path="/:ref" element={<ResolveShareRef fallback="home" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ตัวไขลิงก์สั้น — ref อาจเป็นรหัสบทเรียน (→ หน้าเรียนของบทนั้นทันที) หรือ slug/รหัสคอร์ส
// (→ หน้ารายละเอียดคอร์ส) ต้องถาม server เพราะรหัสสุ่มจากเนมสเปซเดียวกัน แยกด้วยตาไม่ได้
// ใช้กับ 2 เส้นทาง: /{ref} แบบ bitly (ลิงก์แชร์หลัก) และ /app/courses/{ref} (เส้นทาง in-app เดิม)
function ResolveShareRef({ fallback }: { fallback: 'course' | 'home' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const ref = location.pathname.split('/').pop() || '';
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.resolveShareRef(ref);
        if (cancelled) return;
        if (r.type === 'lesson') {
          navigate(`/app/courses/${r.slug}/learn/${r.lesson_id}`, { replace: true });
          return;
        }
        navigate(`/courses/${r.slug}`, { replace: true });
      } catch {
        // resolve ไม่ติด (offline/404):
        //   เส้นทาง in-app เดิม → เดาว่าเป็นคอร์ส (พฤติกรรมก่อนมีลิงก์สั้น)
        //   เส้นทาง root → กลับหน้าแรก (แทน catch-all * เดิมของ path เดี่ยวที่ไม่รู้จัก)
        if (!cancelled) navigate(fallback === 'course' ? `/courses/${ref}` : '/', { replace: true });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
    </div>
  );
}

/**
 * วัดความสูงรวมของแบนเนอร์ (เตือนสมาชิก/ประกาศแอดมิน) แล้วเผยแพร่เป็น CSS var `--banner-h`
 * — header แบบลอยทับ (PublicHeader overlay) ใช้ค่านี้ตรึงตัวเองใต้แบนเนอร์
 * ไม่มีแบนเนอร์ = 0px (header กลับไปชิดขอบบนเหมือนเดิม)
 */
const BannerStack = ({ children }: { children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty('--banner-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--banner-h', '0px');
    };
  }, []);
  return <div ref={ref}>{children}</div>;
};

function App() {
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <BrowserRouter>
        <AuthProvider>
          <SubscriptionProvider>
            <LanguageProvider>
              <SubscriptionRedirectHandler />
              {/* แบนเนอร์อยู่ในโฟลว์หัวเอกสาร แล้วบอกความสูงจริงผ่าน --banner-h ให้ header
                  แบบลอยทับ (หน้าแรก/หน้าคอร์ส) เลื่อนลงพอดี ไม่ไปทับแบนเนอร์ */}
              <BannerStack>
                <SubscriptionWarningBanner />
                <AdminNotificationBanner />
              </BannerStack>
              <Suspense
                fallback={
                  <div className="min-h-screen bg-background flex items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
                  </div>
                }
              >
                <AppRoutes />
              </Suspense>
              <Toaster />
            </LanguageProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}

export default App;
