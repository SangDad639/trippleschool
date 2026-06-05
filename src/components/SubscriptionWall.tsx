import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Crown, Check, Calendar, Loader2, Sparkles, LogOut, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

// Allow override via ?mode=stripe query param for testing
const getPaymentMode = () => {
  const params = new URLSearchParams(window.location.search);
  const modeOverride = params.get('mode');
  if (modeOverride === 'stripe' || modeOverride === 'transfer') {
    return modeOverride;
  }
  return import.meta.env.VITE_PAYMENT_MODE || 'stripe';
};
const PAYMENT_MODE = getPaymentMode();

const SubscriptionWall = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasSubscription, loading: subscriptionLoading, createCheckout } = useSubscription();
  const { user, logout, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [processingPlan, setProcessingPlan] = useState<'monthly' | 'yearly' | null>(null);
  const [showTermsDialog, setShowTermsDialog] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [pendingPlanType, setPendingPlanType] = useState<'monthly' | 'yearly' | null>(null);

  // Debug log
  console.log('[SubscriptionWall]', { authLoading, subscriptionLoading, user: user?.id, isAdmin: user?.isAdmin, hasSubscription, pathname: location.pathname });

  // Don't show wall if loading, no user, admin, has subscription, not approved, or on transfer page
  if (authLoading || subscriptionLoading || !user || user.isAdmin || hasSubscription) return null;
  if (!user.isApproved) return null; // Unapproved users should see pending approval page, not subscription wall
  if (location.pathname.startsWith('/subscription')) return null;

  // Same FeatureItem shape as Landing/Subscription. See those files for context.
  type FeatureItem = { title: string; desc: string; highlight?: boolean };
  const baseFeatures: FeatureItem[] = [
    { title: t('landing.feat.channels'), desc: t('landing.feat.channelsDesc') },
    { title: t('landing.feat.aiPrompt'), desc: t('landing.feat.aiPromptDesc') },
    { title: t('landing.feat.variable'), desc: t('landing.feat.variableDesc') },
    { title: t('landing.feat.caption'), desc: t('landing.feat.captionDesc') },
    { title: t('landing.feat.schedule'), desc: t('landing.feat.scheduleDesc') },
    { title: t('landing.feat.bulk'), desc: t('landing.feat.bulkDesc') },
    { title: t('landing.feat.retry'), desc: t('landing.feat.retryDesc') },
    { title: t('landing.feat.videoApi'), desc: t('landing.feat.videoApiDesc') },
    { title: t('landing.feat.postApi'), desc: t('landing.feat.postApiDesc') },
  ];

  const yearlyBonusFeatures: FeatureItem[] = [
    { title: t('landing.bonus.prompts'), desc: t('landing.bonus.promptsDesc'), highlight: true },
    { title: t('landing.bonus.custom'), desc: t('landing.bonus.customDesc'), highlight: true },
    { title: t('landing.bonus.save'), desc: t('landing.bonus.saveDesc'), highlight: true },
    { title: t('landing.bonus.lock'), desc: t('landing.bonus.lockDesc'), highlight: true },
  ];

  const plans = [
    {
      id: 'monthly' as const,
      name: t('subscription.monthly'),
      price: '฿600',
      currency: 'THB',
      period: t('landing.perMonth'),
      description: t('landing.monthlyDesc'),
      features: baseFeatures,
      icon: Calendar,
    },
    {
      id: 'yearly' as const,
      name: t('subscription.yearly'),
      price: '฿3,990',
      currency: 'THB',
      period: t('landing.perYear'),
      description: t('landing.yearlyDesc'),
      features: [...baseFeatures, ...yearlyBonusFeatures],
      icon: Crown,
      popular: true,
      savings: '-58%',
    },
  ];

  const handleSelectPlan = async (planType: 'monthly' | 'yearly') => {
    if (PAYMENT_MODE === 'transfer') {
      setPendingPlanType(planType);
      setTermsAccepted(false);
      setShowTermsDialog(true);
      return;
    }
    setProcessingPlan(planType);
    try {
      await createCheckout(planType);
    } catch {
      // Error handled in context
    } finally {
      setProcessingPlan(null);
    }
  };

  const handleConfirmTransfer = () => {
    if (pendingPlanType && termsAccepted) {
      setShowTermsDialog(false);
      navigate(`/subscription/transfer?plan=${pendingPlanType}`);
    }
  };

  console.log('[SubscriptionWall] SHOWING WALL!');

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-3xl my-8">
        {/* Header */}
        <div className="text-center space-y-3 mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-[#FFB300]/50">
            <Sparkles className="h-5 w-5 text-[#FFB300]" />
            <span className="font-medium text-white">Triple School</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('subwall.chooseYourPlan')}</h1>
          <p className="text-gray-400 max-w-md mx-auto">
            {t('subwall.subscribeToUnlock')}
          </p>
        </div>

        {/* Plans */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative bg-card p-6 rounded-2xl border transition-all hover:scale-[1.02] ${
                plan.popular
                  ? 'border-yellow-500/60 shadow-2xl shadow-yellow-500/20 bg-gradient-to-b from-yellow-500/5 to-transparent'
                  : 'border-border/50'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                  <span className="px-4 py-1.5 rounded-full bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] text-white text-sm font-bold shadow-lg shadow-yellow-500/50 flex items-center gap-1.5">
                    <Crown className="h-4 w-4" />
                    {t('landing.mostPopular')}
                  </span>
                </div>
              )}

              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl ${
                    plan.popular
                      ? 'bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500]'
                      : 'bg-gradient-to-r from-[#FFB300]/20 to-[#FFB300]/10'
                  }`}>
                    <plan.icon className={`h-5 w-5 ${plan.popular ? 'text-black' : 'text-[#FFB300]'}`} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{plan.name}</h2>
                    <p className="text-xs text-muted-foreground">{plan.description}</p>
                  </div>
                </div>

                <div className="flex items-baseline gap-1">
                  <span className={`text-3xl sm:text-4xl font-bold bg-gradient-to-r ${
                    plan.popular
                      ? 'from-[#FFD700] via-[#FFB300] to-[#FFA500]'
                      : 'from-[#FFB300] via-[#FFC233] to-[#FF9D00]'
                  } bg-clip-text text-transparent`}>
                    {plan.price}
                  </span>
                  <span className="text-xs text-gray-500 ml-0.5">THB</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                  {plan.savings && (
                    <span className="ml-2 px-2 py-0.5 rounded-md bg-green-500/20 text-green-500 text-xs font-medium">
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

                <div className="text-[11px] text-red-400/90 mt-3 mb-3 px-3 py-2.5 rounded-lg bg-red-500/5 border border-red-500/10">
                  <p className="font-semibold mb-1.5">*หมายเหตุ — ไม่รวมค่าบริการ API</p>
                  <ul className="space-y-1 list-none">
                    <li>• <span className="font-medium text-red-300">Openrouter</span> — คิด Caption เริ่มต้น ~1xx บาท/เดือน</li>
                    <li>• <span className="font-medium text-red-300">KIE AI</span> — สร้างภาพและ VDO เริ่มต้น ~1xx บาท</li>
                    <li>• <span className="font-medium text-red-300">Post for ME</span> — โพสต์ Platform ต่างๆ 0.4 บาท/โพสต์</li>
                  </ul>
                </div>

                <Button
                  disabled={processingPlan === plan.id}
                  onClick={() => handleSelectPlan(plan.id)}
                  className={`w-full h-12 text-base font-bold ${
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

        {/* Footer */}
        <div className="text-center space-y-3">
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t('nav.logout')}
          </button>
        </div>
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
              id="wall-terms-accept"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-yellow-500 cursor-pointer"
            />
            <label htmlFor="wall-terms-accept" className="text-sm cursor-pointer select-none">
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

export default SubscriptionWall;
