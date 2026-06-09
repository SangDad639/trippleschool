import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { PRICING } from '@/lib/pricing';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { Calendar, Check, Crown, Loader2, Sparkles, CalendarDays, CreditCard, AlertCircle, XCircle, LogOut, ShieldAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

// Payment is bank-transfer / PromptPay slip upload only (Stripe removed).
const PAYMENT_MODE = 'transfer';

const Subscription = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, openAuthModal, logout } = useAuth();

  // Pixel Tracking: ViewContent
  useEffect(() => {
    window.ttq?.track('ViewContent', { content_type: 'product', content_name: 'Subscription Plans' });
    window.fbq?.('track', 'ViewContent', { content_type: 'product', content_name: 'Subscription Plans' });
    window.gtag?.('event', 'view_item', { content_type: 'product', content_name: 'Subscription Plans' });
  }, []);
  const { t, language } = useLanguage();
  const { subscription, hasSubscription, loading, refreshSubscription } = useSubscription();
  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [showTermsDialog, setShowTermsDialog] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [pendingPlanType, setPendingPlanType] = useState<string | null>(null);
  const [showExpiredMessage, setShowExpiredMessage] = useState(false);

  // Check if redirected from expired subscription
  // Only show expired message if user actually had a subscription before
  useEffect(() => {
    if (searchParams.get('expired') === 'true' && user?.subscriptionExpiresAt) {
      setShowExpiredMessage(true);
      window.history.replaceState({}, '', '/subscription');
    } else if (searchParams.get('expired') === 'true') {
      // New user without subscription - clean URL, don't show expired message
      window.history.replaceState({}, '', '/subscription');
    }
  }, [searchParams, user]);

  // Auto redirect to app if user has active subscription (and not managing
  // existing subscription).
  //
  // Stability gate (100ms) — wait one beat before navigating. Avoids race
  // where `hasSubscription` briefly flips true during context init / polling
  // tick and immediately triggers /subscription → /app, which can ping-pong
  // with the 403 redirect that bounces back here. ~100ms covers ~6 React
  // render frames; if the value reverts within that window we never navigate.
  useEffect(() => {
    if (loading || !hasSubscription || subscription?.cancelAtPeriodEnd) return;
    if (searchParams.get('manage') === 'true') return;
    const t = setTimeout(() => {
      navigate('/courses', { replace: true });
    }, 100);
    return () => clearTimeout(t);
  }, [loading, hasSubscription, subscription?.cancelAtPeriodEnd, searchParams, navigate]);

  // Poll for subscription status when waiting for admin approval
  useEffect(() => {
    // Only poll if user is logged in but doesn't have subscription yet
    if (!user || hasSubscription || loading) return;

    const pollInterval = setInterval(() => {
      refreshSubscription();
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [user, hasSubscription, loading, refreshSubscription]);

  // Pricing-card feature entry — same shape as Landing.tsx. `highlight` is set
  // only on the yearly-bonus rows. Annotated so the spread in `features:
  // [...base, ...bonus]` doesn't widen the union and drop the highlight field.
  type FeatureItem = { title: string; desc: string; highlight?: boolean };
  const baseFeatures: FeatureItem[] = [
    { title: 'เข้าถึงทุกคอร์ส', desc: 'ปลดล็อกทุกบทเรียนที่เสียเงินทั้งหมด' },
    { title: 'วิดีโอความละเอียดสูง', desc: 'เรียนได้ทุกที่ทุกเวลา' },
    { title: 'อัปเดตเนื้อหาใหม่', desc: 'คอร์สใหม่เพิ่มเรื่อย ๆ ไม่มีค่าใช้จ่ายเพิ่ม' },
    { title: 'ติดตามความคืบหน้า', desc: 'บันทึกบทเรียนที่เรียนจบอัตโนมัติ' },
  ];

  const yearlyBonusFeatures: FeatureItem[] = [
    { title: 'คุ้มกว่ารายเดือน', desc: 'จ่ายครั้งเดียวใช้ได้ทั้งปี', highlight: true },
    { title: 'ราคาคงที่ทั้งปี', desc: 'ไม่ต้องต่ออายุทุกเดือน', highlight: true },
  ];

  // Plan selection — show subtotal (before VAT) to match marketing /#pricing.
  // VAT is revealed at the actual checkout step (/subscription/transfer-v2).

  // Fetch dynamic plans from `/api/subscription/plans` so any admin-created
  // package (e.g. Premium, Quarterly) shows up here automatically. Falls back
  // to the hardcoded monthly+yearly constants if the API call fails (so the
  // page doesn't go blank for marketing visitors).
  type ApiPlan = Awaited<ReturnType<typeof api.getSubscriptionPlans>>['plans'][number];
  const [apiPlans, setApiPlans] = useState<ApiPlan[] | null>(null);
  useEffect(() => {
    api.getSubscriptionPlans()
      .then((res) => setApiPlans(res.plans))
      .catch(() => { /* fall back to hardcoded plans */ });
  }, []);

  // Resolve a plan by slug — prefer live DB, fall back to PRICING.
  const getPlanPricing = (slug: 'monthly' | 'yearly') => {
    const apiPlan = apiPlans?.find((p) => p.slug === slug);
    if (apiPlan) {
      return { subtotal: apiPlan.subtotal, vat: apiPlan.vat, total: apiPlan.total };
    }
    return slug === 'yearly' ? PRICING.yearly : PRICING.monthly;
  };

  // Build the buy-view plan cards. Mark the longest-duration plan as
  // "popular" so the yearly (or any future "lifetime") card stays featured.
  type BuyViewPlan = {
    id: string;
    name: string;
    price: string;
    period: string;
    description: string;
    features: typeof baseFeatures;
    icon: typeof Calendar;
    popular?: boolean;
    savings?: string;
  };
  const plans: BuyViewPlan[] = apiPlans
    ? (() => {
        const longestDays = Math.max(...apiPlans.map((p) => p.days));
        return apiPlans.map((p) => {
          const isLongest = p.days === longestDays && apiPlans.length > 1;
          return {
            id: p.slug,
            name: p.name,
            price: `฿${p.subtotal.toLocaleString()}`,
            period: p.days === 30 ? '/month' : p.days === 365 ? '/year' : `/${p.days}d`,
            description: p.description || '',
            // Longest plan gets the bonus-features list (same convention as Landing).
            features: isLongest ? [...baseFeatures, ...yearlyBonusFeatures] : baseFeatures,
            icon: isLongest ? Crown : Calendar,
            popular: isLongest,
            // Only the legacy monthly→yearly pair has a stable "-58%" anchor.
            // Skip savings badge for other plans (would need known reference).
            savings: isLongest && p.slug === 'yearly' ? '-52%' : undefined,
          };
        });
      })()
    : [
        {
          id: 'monthly',
          name: t('subscription.monthly'),
          price: `฿${PRICING.monthly.subtotal.toLocaleString()}`,
          period: '/month',
          description: t('landing.monthlyDesc'),
          features: baseFeatures,
          icon: Calendar,
        },
        {
          id: 'yearly',
          name: t('subscription.yearly'),
          price: `฿${PRICING.yearly.subtotal.toLocaleString()}`,
          period: '/year',
          description: t('landing.yearlyDesc'),
          features: [...baseFeatures, ...yearlyBonusFeatures],
          icon: Crown,
          popular: true,
          savings: '-52%',
        },
      ];

  const handleSelectPlan = (planType: string) => {
    if (!user) {
      openAuthModal();
      return;
    }
    // Manual bank-transfer / PromptPay only — confirm terms, then go to the
    // slip-upload page.
    setPendingPlanType(planType);
    setTermsAccepted(false);
    setShowTermsDialog(true);
  };

  const handleConfirmTransfer = () => {
    if (pendingPlanType && termsAccepted) {
      setShowTermsDialog(false);
      navigate(`/subscription/transfer-v2?plan=${pendingPlanType}`);
    }
  };

  // Renew / switch plan = upload a new transfer slip for the chosen plan.
  const handleChangePlan = (newPlan: 'monthly' | 'yearly') => {
    navigate(`/subscription/transfer-v2?plan=${newPlan}`);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Show current subscription status if subscribed
  if (hasSubscription && subscription) {
    const currentPlan = subscription.planType;
    const otherPlan = currentPlan === 'monthly' ? 'yearly' : 'monthly';

    return (
      <div className="page-wrapper">
        <div>
          <main className="container mx-auto px-4 py-12">
            <div className="max-w-4xl mx-auto space-y-8">
              <div className="text-center space-y-4">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-green-500/50">
                  <Check className="h-5 w-5 text-green-500" />
                  <span className="font-medium text-green-500">{t('subscription.activeSubscription')}</span>
                </div>
                <h1 className="text-4xl font-bold">Triple School</h1>
                <div className="flex items-center justify-center gap-3 text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  <span>{t('subscription.nextBilling')}: {formatDate(subscription.currentPeriodEnd)}</span>
                </div>
              </div>

              {subscription.cancelAtPeriodEnd && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 max-w-2xl mx-auto">
                  <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0" />
                  <div>
                    <p className="font-medium text-yellow-500">{t('subscription.cancelScheduled')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('subscription.endOnDate', { date: formatDate(subscription.currentPeriodEnd) })}
                    </p>
                  </div>
                </div>
              )}

              {/* Plan cards side by side */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Monthly Plan */}
                <div className={`relative bg-card p-6 rounded-2xl border transition-all ${
                  currentPlan === 'monthly'
                    ? 'border-green-500/60 shadow-lg shadow-green-500/10'
                    : 'border-border/50 hover:border-[#FFB300]/50'
                }`}>
                  {currentPlan === 'monthly' && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="px-4 py-1 rounded-full bg-green-500 text-white text-sm font-bold">
                        {t('subscription.currentPlan')}
                      </span>
                    </div>
                  )}
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-gradient-to-r from-[#FFB300]/20 to-[#FFB300]/10">
                        <Calendar className="h-5 w-5 text-[#FFB300]" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold">{t('subscription.monthly')}</h2>
                        <p className="text-sm text-muted-foreground">{t('subscription.perfectForTrying')}</p>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">฿{getPlanPricing('monthly').subtotal.toLocaleString()}</span>
                      <span className="text-xs text-gray-500 ml-0.5">THB</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                    {currentPlan !== 'monthly' && (
                      <Button
                        onClick={() => handleChangePlan('monthly')}
                        variant="outline"
                        className="w-full border-[#FFB300]/50 hover:bg-[#FFB300]/10"
                      >
                        {t('subscription.downgradeToMonthly')}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Yearly Plan */}
                <div className={`relative bg-card p-6 rounded-2xl border transition-all ${
                  currentPlan === 'yearly'
                    ? 'border-green-500/60 shadow-lg shadow-green-500/10'
                    : 'border-yellow-500/60 hover:shadow-lg hover:shadow-yellow-500/10'
                }`}>
                  {currentPlan === 'yearly' ? (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="px-4 py-1 rounded-full bg-green-500 text-white text-sm font-bold">
                        {t('subscription.currentPlan')}
                      </span>
                    </div>
                  ) : (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="px-4 py-1 rounded-full bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] text-white text-sm font-bold flex items-center gap-1">
                        <Crown className="h-3 w-3" /> {t('subscription.bestValue')}
                      </span>
                    </div>
                  )}
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500]">
                        <Crown className="h-5 w-5 text-black" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold">{t('subscription.yearly')}</h2>
                        <p className="text-sm text-muted-foreground">{t('subscription.save140annually')}</p>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">฿{getPlanPricing('yearly').subtotal.toLocaleString()}</span>
                      <span className="text-xs text-gray-500 ml-0.5">THB</span>
                      <span className="text-muted-foreground">/year</span>
                      <span className="ml-2 px-2 py-1 rounded-md bg-green-500/20 text-green-500 text-xs font-medium">
                        {t('subscription.save140')}
                      </span>
                    </div>
                    {currentPlan !== 'yearly' && (
                      <Button
                        onClick={() => handleChangePlan('yearly')}
                        className="w-full bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] hover:opacity-90 text-black font-bold"
                      >
                        {t('subscription.upgradeToYearly')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions — manual transfer membership: renew by uploading a new
                  slip; no recurring billing to manage or cancel. */}
              <div className="max-w-md mx-auto flex flex-col gap-3">
                <Button
                  onClick={() => navigate('/subscription/transfer-v2')}
                  variant="outline"
                  className="w-full"
                >
                  <CalendarDays className="h-4 w-4 mr-2" />
                  ต่ออายุสมาชิก
                </Button>

                <Button
                  onClick={() => navigate('/courses')}
                  className="w-full bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] hover:opacity-90"
                >
                  ไปที่คอร์สเรียน
                </Button>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <div>

        <main className="container mx-auto px-4 py-12">
          <div className="max-w-4xl mx-auto space-y-12">
            {/* Expired subscription message */}
            {showExpiredMessage && (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                <XCircle className="h-6 w-6 text-red-500 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-red-400">
                    {t('subscription.expired')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('subscription.expiredDesc')}
                  </p>
                </div>
                <button
                  onClick={() => setShowExpiredMessage(false)}
                  className="p-1 rounded hover:bg-white/10 text-red-400"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
            )}

            <div className="text-center space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-[#FFB300]/50">
                <Sparkles className="h-5 w-5 text-[#FFB300] animate-glow-pulse" />
                <span className="font-medium">Triple School</span>
              </div>
              <h1 className="text-4xl font-bold">{t('subscription.unlock')}</h1>
              <p className="text-muted-foreground max-w-xl mx-auto">
                {t('subscription.unlockDesc')}
              </p>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-[#FFB300]" />
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-8">
                {plans.map((plan, index) => (
                  <div
                    key={plan.id}
                    className={`relative bg-card p-8 rounded-2xl border transition-all hover:scale-[1.02] animate-scale-in ${
                      plan.popular
                        ? 'border-yellow-500/60 glow-border shadow-2xl shadow-yellow-500/30 bg-gradient-to-b from-yellow-500/5 to-transparent'
                        : 'border-border/50'
                    }`}
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    {plan.popular && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                        <span className="px-6 py-2 rounded-full bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] text-white text-base font-bold shadow-lg shadow-yellow-500/50 animate-pulse flex items-center gap-2">
                          <Crown className="h-5 w-5" />
                          {t('subscription.bestValue')}
                        </span>
                      </div>
                    )}

                    <div className="space-y-6">
                      <div className="flex items-center gap-3">
                        <div className={`p-3 rounded-xl ${
                          plan.popular
                            ? 'bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500]'
                            : 'bg-gradient-to-r from-[#FFB300]/20 to-[#FFB300]/10'
                        }`}>
                          <plan.icon className={`h-6 w-6 ${plan.popular ? 'text-black' : 'text-[#FFB300]'}`} />
                        </div>
                        <div>
                          <h2 className="text-2xl font-bold">{plan.name}</h2>
                          <p className="text-sm text-muted-foreground">{plan.description}</p>
                        </div>
                      </div>

                      <div className="flex items-baseline gap-1">
                        <span className={`text-5xl font-bold bg-gradient-to-r ${
                          plan.popular
                            ? 'from-[#FFD700] via-[#FFB300] to-[#FFA500]'
                            : 'from-[#FFB300] via-[#FFC233] to-[#FF9D00]'
                        } bg-clip-text text-transparent`}>
                          {plan.price}
                        </span>
                        <span className="text-xs text-gray-500 ml-0.5">THB</span>
                        <span className="text-muted-foreground">{plan.period}</span>
                        {plan.savings && (
                          <span className="ml-2 px-2 py-1 rounded-md bg-green-500/20 text-green-500 text-sm font-medium">
                            {plan.savings}
                          </span>
                        )}
                      </div>

                      <ul className="space-y-2">
                        {plan.features.map((feature, i) => (
                          <li
                            key={i}
                            className={`flex items-start gap-2 text-sm ${
                              feature.highlight
                                ? 'bg-primary/10 -mx-2 px-2 py-1.5 rounded-lg border border-primary/20'
                                : ''
                            }`}
                          >
                            <Check className={`h-4 w-4 flex-shrink-0 mt-0.5 ${plan.popular ? 'text-yellow-500' : 'text-green-500'}`} />
                            <div>
                              <span className="font-bold text-foreground">{feature.title}</span>
                              {feature.desc && (
                                <span className="text-muted-foreground/60 text-xs"> - {feature.desc}</span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>

                      <Button
                        disabled={processingPlan === plan.id}
                        onClick={() => handleSelectPlan(plan.id)}
                        className={`w-full h-14 text-lg font-bold ${
                          plan.popular
                            ? 'bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] text-black'
                            : 'bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00]'
                        }`}
                      >
                        {processingPlan === plan.id ? '⏳ กำลังดำเนินการ...' : t('subscription.subscribePlan', { name: plan.name })}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Footer with logout */}
            <div className="flex justify-center pt-4">
              <button
                onClick={() => { logout(); navigate('/'); }}
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                {t('nav.logout')}
              </button>
            </div>

          </div>
        </main>
      </div>

      {/* Terms & Conditions Dialog */}
      <AlertDialog open={showTermsDialog} onOpenChange={setShowTermsDialog}>
        <AlertDialogContent className="max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-xl">
              <ShieldAlert className="h-5 w-5 text-yellow-500" />
              เงื่อนไขการสมัครสมาชิก
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>กรุณาอ่านเงื่อนไขต่อไปนี้อย่างละเอียดก่อนดำเนินการชำระเงิน</p>
                <ol className="space-y-2 list-none">
                  <li className="flex gap-2">
                    <span className="text-red-500 font-bold shrink-0">1.</span>
                    <span><strong className="text-red-500">ไม่มีการคืนเงินทุกกรณี</strong> — เมื่อชำระเงินแล้ว ไม่สามารถขอคืนเงินได้ไม่ว่ากรณีใดๆ</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-foreground font-bold shrink-0">2.</span>
                    <span><strong className="text-foreground">สิทธิ์การใช้งาน</strong> — บัญชีสมาชิกเป็นสิทธิ์ส่วนบุคคล ไม่สามารถโอนหรือแชร์ให้ผู้อื่นได้</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-foreground font-bold shrink-0">3.</span>
                    <span><strong className="text-foreground">ลิขสิทธิ์ซอฟต์แวร์</strong> — ห้ามคัดลอก ทำซ้ำ ดัดแปลง หรือจำหน่ายตัวโปรแกรมไม่ว่าส่วนใดส่วนหนึ่ง</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-foreground font-bold shrink-0">4.</span>
                    <span><strong className="text-foreground">การเปลี่ยนแปลงบริการ</strong> — ผู้ให้บริการขอสงวนสิทธิ์ในการปรับปรุงหรือเปลี่ยนแปลงฟีเจอร์โดยไม่ต้องแจ้งล่วงหน้า</span>
                  </li>
                </ol>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex items-start gap-3 mt-2 p-3 rounded-lg bg-muted/50 border border-border">
            <input
              type="checkbox"
              id="terms-accept"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-yellow-500 cursor-pointer"
            />
            <label htmlFor="terms-accept" className="text-sm cursor-pointer select-none">
              ข้าพเจ้าได้อ่านและยอมรับเงื่อนไขการสมัครสมาชิกแล้ว
            </label>
          </div>

          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <Button
              disabled={!termsAccepted}
              onClick={handleConfirmTransfer}
              className="bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] text-black font-bold disabled:opacity-40"
            >
              ยืนยันและดำเนินการชำระเงิน
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Subscription;
