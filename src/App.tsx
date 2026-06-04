import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useState, useEffect, useRef } from "react";

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
import { toast } from "sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SchedulerProvider } from "@/contexts/SchedulerContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";
import SubscriptionWall from "@/components/SubscriptionWall";
import SubscriptionWarningBanner from "@/components/SubscriptionWarningBanner";
import AdminNotificationBanner from "@/components/AdminNotificationBanner";
import { LateDeprecationBanner } from "@/components/LateDeprecationBanner";
import Landing from "@/pages/Landing";
import ContentScheduler from "@/pages/ContentScheduler";
import Subscription from "@/pages/Subscription";
import SubscriptionSuccess from "@/pages/SubscriptionSuccess";
import Admin from "@/pages/Admin";
import AdminPrompts from "@/pages/AdminPrompts";
import PromptDirectDetail from "@/pages/PromptDirectDetail";
import AdminAffiliate from "@/pages/AdminAffiliate";
import AdminBanners from "@/pages/AdminBanners";
import AdminBannerEditor from "@/pages/AdminBannerEditor";
import AdminViralTemplates from "@/pages/AdminViralTemplates";
import AdminLingTemplateNew from "@/pages/AdminLingTemplateNew";
import AdminIdolTemplates from "@/pages/AdminIdolTemplates";
import AdminStoryTemplates from "@/pages/AdminStoryTemplates";
import AdminImageTemplates from "@/pages/AdminImageTemplates";
import Settings from "@/pages/Settings";
import Profile from "@/pages/Profile";
import Affiliate from "@/pages/Affiliate";
import Guide from "@/pages/Guide";
import History from "@/pages/History";
import Tutorials from "@/pages/Tutorials";
import AffiliateInfo from "@/pages/AffiliateInfo";
import GPTImage2 from "@/pages/GPTImage2";
import ImageTemplateDetail from "@/pages/ImageTemplateDetail";
import StoryTemplateDetail from "@/pages/StoryTemplateDetail";
import ImageCustomPromptForm from "@/pages/ImageCustomPromptForm";
import Kling3MotionControl from "@/pages/Kling3MotionControl";
import Credits from "@/pages/Credits";
import CreditsTopup from "@/pages/CreditsTopup";
import Update, { UpdateDetail } from "@/pages/Update";
import SubscriptionTransfer from "@/pages/SubscriptionTransfer";
import SubscriptionTransferV2 from "@/pages/SubscriptionTransferV2";
import CheckoutComplete from "@/pages/CheckoutComplete";
import PendingApproval from "@/pages/PendingApproval";
import ViralTemplateDetail from "@/pages/ViralTemplateDetail";
import IdolTemplateDetail from "@/pages/IdolTemplateDetail";
import CourseDetail from "@/pages/CourseDetail";
import CourseLearn from "@/pages/CourseLearn";
import AdminCourses from "@/pages/AdminCourses";
import AdminEnrollments from "@/pages/AdminEnrollments";
import GuideButton from "@/components/GuideButton";
import WelcomePopup from "@/components/WelcomePopup";

// Login/Register page
const AuthPage = () => {
  const { login, register, googleLogin } = useAuth();
  const { t, language } = useLanguage();
  const isTh = language === 'th';
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const refcode = searchParams.get('ref');
  const isLogin = location.pathname === "/login";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  /** Optional coupon code field — only used on register. BE redeems best-effort
   *  and returns `coupon_applied | coupon_error` so we can surface a toast. */
  const [couponCode, setCouponCode] = useState("");
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
      } else {
        const result = await register(
          email,
          password,
          refcode || undefined,
          couponCode.trim().toUpperCase().replace(/\s+/g, '') || undefined,
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
        } else {
          setError(t('auth.registerFailed'));
        }
        // Surface coupon outcome — applied OR error message (inline i18n)
        if (result.couponApplied) {
          toast.success(isTh
            ? `เปิดใช้งานเพิ่ม ${result.couponApplied.days} วันจากโค้ด`
            : `+${result.couponApplied.days} day(s) added from coupon`);
        } else if (result.couponError) {
          const errorMsg =
            result.couponError === 'invalid'      ? (isTh ? 'โค้ดไม่ถูกต้อง'         : 'Coupon code is invalid') :
            result.couponError === 'already_used' ? (isTh ? 'โค้ดถูกใช้ไปแล้ว'        : 'Coupon already used') :
                                                    (isTh ? 'โค้ดถูกปิดใช้งาน'        : 'Coupon is disabled');
          toast.error(errorMsg);
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
          <p className="text-muted-foreground mt-2">Content Scheduler</p>
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

          {/* Optional coupon code (register only). Auto-uppercase to match
              BE expected format. Empty = no redemption attempt. */}
          {!isLogin && (
            <div>
              <label className="block text-sm font-medium mb-1">
                {isTh ? 'โค้ดคูปอง (ไม่บังคับ)' : 'Coupon code (optional)'}
              </label>
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="ABCD2345"
                maxLength={20}
                className="w-full p-2 rounded bg-input border border-border font-mono tracking-widest"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {isTh
                  ? 'หากมีโค้ดทดลองใช้ ใส่ที่นี่เพื่อรับวันใช้งานทันที'
                  : 'If you have a trial code, enter it here for instant subscription days'}
              </p>
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

          <div className="flex justify-center">
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
              width={350}
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

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Check if user is approved (admin always approved)
  if (!user.isApproved && !user.isAdmin && !allowPending) {
    return <Navigate to="/pending-approval" replace />;
  }

  return <>{children}</>;
};

/**
 * Listens for `subscription:required` events from the API layer (api.ts) and
 * performs an SPA navigation to /subscription. Replaces the old hard
 * `window.location.href` redirect which caused refresh loops on slow devices:
 *   • Burst of parallel 403s → multiple hard reloads queued
 *   • Each reload re-mounts WelcomePopup → popup spam
 *   • Pending fetches that 403 after the reload → another redirect → loop
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
      navigate('/subscription', { replace: true });
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
  const { user, loading } = useAuth();
  usePageTracking(); // Track page views on route change

  console.log('[AppRoutes]', { loading, user: user?.id });

  if (loading) {
    return (
      <div className="page-wrapper flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public landing page - accessible to everyone */}
      <Route
        path="/"
        element={<Landing />}
      />
      <Route
        path="/login"
        element={user ? <Navigate to="/app" replace /> : <AuthPage />}
      />
      <Route
        path="/register"
        element={user ? <Navigate to="/app" replace /> : <AuthPage />}
      />
      <Route
        path="/pending-approval"
        element={
          user ? (
            user.isApproved || user.isAdmin ? (
              <Navigate to="/app" replace />
            ) : (
              <PendingApproval />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/subscription"
        element={
          <ProtectedRoute>
            <Subscription />
          </ProtectedRoute>
        }
      />
      <Route
        path="/subscription/success"
        element={
          <ProtectedRoute>
            <SubscriptionSuccess />
          </ProtectedRoute>
        }
      />
      <Route
        path="/subscription/transfer"
        element={
          <ProtectedRoute>
            <SubscriptionTransfer />
          </ProtectedRoute>
        }
      />
      <Route
        path="/subscription/transfer-v2"
        element={
          <ProtectedRoute>
            <SubscriptionTransferV2 />
          </ProtectedRoute>
        }
      />
      <Route
        path="/subscription/checkout-complete"
        element={
          <ProtectedRoute>
            <CheckoutComplete />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <Admin />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/prompts"
        element={
          <ProtectedRoute>
            <AdminPrompts />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/affiliate"
        element={
          <ProtectedRoute>
            <AdminAffiliate />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/banners"
        element={
          <ProtectedRoute>
            <AdminBanners />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/banners/:id/edit"
        element={
          <ProtectedRoute>
            <AdminBannerEditor />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/viral-templates"
        element={
          <ProtectedRoute>
            <AdminViralTemplates />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/viral-templates/ling/new"
        element={
          <ProtectedRoute>
            <AdminLingTemplateNew />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/idol-templates"
        element={
          <ProtectedRoute>
            <AdminIdolTemplates />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/story-templates"
        element={
          <ProtectedRoute>
            <AdminStoryTemplates />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/image-templates"
        element={
          <ProtectedRoute>
            <AdminImageTemplates />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/courses"
        element={
          <ProtectedRoute>
            <AdminCourses />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/enrollments"
        element={
          <ProtectedRoute>
            <AdminEnrollments />
          </ProtectedRoute>
        }
      />
      <Route
        path="/affiliate"
        element={
          <ProtectedRoute>
            <Affiliate />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      {/* Prompt Direct Detail - generate video from prompt library */}
      <Route
        path="/app/prompt-direct/:slug"
        element={
          <ProtectedRoute>
            <SchedulerProvider>
              <PromptDirectDetail />
            </SchedulerProvider>
          </ProtectedRoute>
        }
      />
      {/* Viral Template Detail - separate page before wildcard */}
      <Route
        path="/app/viral-templates/:templateSlug"
        element={
          <ProtectedRoute>
            <SchedulerProvider>
              <ViralTemplateDetail />
            </SchedulerProvider>
          </ProtectedRoute>
        }
      />
      {/* Idol Template Detail - separate page before wildcard */}
      <Route
        path="/app/idol-templates/:templateSlug"
        element={
          <ProtectedRoute>
            <SchedulerProvider>
              <IdolTemplateDetail />
            </SchedulerProvider>
          </ProtectedRoute>
        }
      />
      {/* Feature pages - separate routes before /app/* wildcard */}
      <Route
        path="/app/images/gpt-image-2"
        element={
          <ProtectedRoute>
            <SchedulerProvider>
              <GPTImage2 />
            </SchedulerProvider>
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/images-template/:slug"
        element={
          <ProtectedRoute>
            <SchedulerProvider>
              <ImageTemplateDetail />
            </SchedulerProvider>
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/stories-template/:slug"
        element={
          <ProtectedRoute>
            <SchedulerProvider>
              <StoryTemplateDetail />
            </SchedulerProvider>
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/images/custom-prompt/new"
        element={
          <ProtectedRoute>
            <SchedulerProvider>
              <ImageCustomPromptForm />
            </SchedulerProvider>
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/videos/kling-3-motion-control"
        element={
          <ProtectedRoute>
            <SchedulerProvider>
              <Kling3MotionControl />
            </SchedulerProvider>
          </ProtectedRoute>
        }
      />
      {/* Course detail + learn - separate routes before /app/* wildcard */}
      <Route
        path="/app/courses/:slug"
        element={
          <ProtectedRoute>
            <CourseDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/courses/:slug/learn/:lessonId"
        element={
          <ProtectedRoute>
            <CourseLearn />
          </ProtectedRoute>
        }
      />
      {/* Main app - protected, with sub-routes for tabs */}
      <Route
        path="/app/*"
        element={
          <ProtectedRoute>
            <SchedulerProvider>
              <ContentScheduler />
            </SchedulerProvider>
          </ProtectedRoute>
        }
      />
      <Route
        path="/guide"
        element={
          <ProtectedRoute>
            <Guide />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history"
        element={
          <ProtectedRoute>
            <History />
          </ProtectedRoute>
        }
      />
      <Route
        path="/credits"
        element={
          <ProtectedRoute>
            <Credits />
          </ProtectedRoute>
        }
      />
      <Route
        path="/credits/topup"
        element={
          <ProtectedRoute>
            <CreditsTopup />
          </ProtectedRoute>
        }
      />
      <Route path="/tutorials" element={<Tutorials />} />
      <Route path="/affiliate-info" element={<AffiliateInfo />} />
      <Route path="/update" element={<Update />} />
      <Route path="/update/:id" element={<UpdateDetail />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <BrowserRouter>
        <AuthProvider>
          <SubscriptionProvider>
            <LanguageProvider>
              <SubscriptionRedirectHandler />
              <SubscriptionWarningBanner />
              <AdminNotificationBanner />
              <LateDeprecationBanner />
              <AppRoutes />
              <GuideButton />
              <WelcomePopup />
              <SubscriptionWall />
              <Toaster />
            </LanguageProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}

export default App;
