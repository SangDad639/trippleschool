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
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";
import SubscriptionWarningBanner from "@/components/SubscriptionWarningBanner";
import AdminNotificationBanner from "@/components/AdminNotificationBanner";
import AgentChatWidget from "@/components/AgentChatWidget";
import PublicHeader from "@/components/PublicHeader";
import Storefront from "@/pages/Storefront";
import PublicCatalog from "@/pages/PublicCatalog";
import TipsCatalog from "@/pages/TipsCatalog";
import Programs from "@/pages/Programs";
import Pricing from "@/pages/Pricing";
import Subscription from "@/pages/Subscription";
import SubscriptionSuccess from "@/pages/SubscriptionSuccess";
import Admin from "@/pages/Admin";
import AdminAffiliate from "@/pages/AdminAffiliate";
import AdminBanners from "@/pages/AdminBanners";
import AdminBannerEditor from "@/pages/AdminBannerEditor";
import Profile from "@/pages/Profile";
import Affiliate from "@/pages/Affiliate";
import Tutorials from "@/pages/Tutorials";
import AffiliateInfo from "@/pages/AffiliateInfo";
import Update, { UpdateDetail } from "@/pages/Update";
import SubscriptionTransferV2 from "@/pages/SubscriptionTransferV2";
import CheckoutComplete from "@/pages/CheckoutComplete";
import PendingApproval from "@/pages/PendingApproval";
import CourseDetail from "@/pages/CourseDetail";
import CourseLearn from "@/pages/CourseLearn";
import MyCourses from "@/pages/MyCourses";
import AdminCourses from "@/pages/AdminCourses";
import AdminEnrollments from "@/pages/AdminEnrollments";
import AdminChats from "@/pages/AdminChats";

// Login/Register page
const AuthPage = () => {
  const { login, register, googleLogin } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const refcode = searchParams.get('ref');
  const isLogin = location.pathname === "/login";

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
      <Route path="/programs" element={<Programs />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/courses/:slug" element={<CourseDetail />} />
      <Route path="/tutorials" element={<Tutorials />} />
      <Route path="/affiliate-info" element={<AffiliateInfo />} />
      <Route path="/update" element={<Update />} />
      <Route path="/update/:id" element={<UpdateDetail />} />

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
      <Route path="/admin/enrollments" element={<ProtectedRoute><AdminEnrollments /></ProtectedRoute>} />
      <Route path="/admin/chats" element={<ProtectedRoute><AdminChats /></ProtectedRoute>} />

      {/* ---------- User ---------- */}
      <Route path="/affiliate" element={<ProtectedRoute><Affiliate /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

      {/* ---------- In-app course area ---------- */}
      <Route path="/app/my-courses" element={<ProtectedRoute><AppShell><MyCourses /></AppShell></ProtectedRoute>} />
      <Route path="/app/courses/:slug/learn/:lessonId" element={<ProtectedRoute><CourseLearn /></ProtectedRoute>} />
      {/* Old in-app detail paths now resolve to the single public detail page. */}
      <Route path="/app/courses/:slug" element={<RedirectToCourse />} />
      <Route path="/app/courses" element={<Navigate to="/courses" replace />} />
      <Route path="/app" element={<Navigate to="/app/my-courses" replace />} />
      <Route path="/app/*" element={<Navigate to="/app/my-courses" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Preserve the :slug when redirecting the legacy /app/courses/:slug → /courses/:slug.
function RedirectToCourse() {
  const location = useLocation();
  const slug = location.pathname.split('/').pop() || '';
  return <Navigate to={`/courses/${slug}`} replace />;
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
              <AppRoutes />
              <AgentChatWidget />
              <Toaster />
            </LanguageProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}

export default App;
