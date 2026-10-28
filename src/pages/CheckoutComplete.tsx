import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { CheckCircle2, Sparkles, ArrowRight, FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { AffiliateStats } from '@/types/affiliate';
import { isTaxInfoIncomplete } from '@/components/profile/TaxInfoSection';
import PurchaseSurvey from '@/components/PurchaseSurvey';

const COUNTDOWN_SECONDS = 3;

/** localStorage key to remember user dismissed the tax-info prompt for this
 *  payment cycle. Cleared automatically next time user lands here from a new
 *  payment (we key on subscription_expires_at — change → fresh cycle). */
const DISMISS_KEY = 'taxInfoPromptDismissedAt';

const CheckoutComplete = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [showTaxPrompt, setShowTaxPrompt] = useState(false);
  // 079: แบบสอบถามหลังซื้อ — ?log=<extension_log_id> มาจาก SubscriptionTransferV2 หลังสลิปผ่าน
  // แสดงเฉพาะยังไม่เคยตอบ/ข้ามรายการนี้ (รีเฟรชแล้วไม่ถามซ้ำ) · ระหว่างแสดง countdown หยุด เหมือนกล่องภาษี
  const [survey, setSurvey] = useState<{ extensionLogId: number; planSlug: 'monthly' | 'yearly' } | null>(null);

  const l = (th: string, en: string) => language === 'th' ? th : en;

  // Pixel Tracking: Purchase (Bank transfer)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const purchaseValue = Number(params.get('amount')) || 0;
    window.ttq?.track('Purchase', { value: purchaseValue, currency: 'THB' });
    window.fbq?.('track', 'Purchase', { value: purchaseValue, currency: 'THB' });
    window.gtag?.('event', 'purchase', { value: purchaseValue, currency: 'THB' });
  }, []);

  // 079: เช็กว่าการซื้อนี้ตอบแบบสอบถามแล้วหรือยัง — เช็กไม่ได้ = ไม่ถาม ไม่บล็อกหน้า
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const log = Number(params.get('log'));
    if (!Number.isInteger(log) || log <= 0) return;
    const planSlug: 'monthly' | 'yearly' = params.get('plan') === 'yearly' ? 'yearly' : 'monthly';
    let cancelled = false;
    api.getPurchaseSurveyStatus({ extension_log_id: log })
      // eligible=false = log ไม่ใช่ของผู้ใช้นี้ (เช่น แก้ URL เอง) → ไม่โชว์
      .then((r) => { if (!cancelled && !r.answered && r.eligible !== false) setSurvey({ extensionLogId: log, planSlug }); })
      .catch((err) => console.error('Purchase survey status check failed:', err));
    return () => { cancelled = true; };
  }, []);

  // Check user's tax info — if incomplete + not dismissed this cycle, show prompt
  // (pauses the auto-redirect countdown so user can act).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stats = await (api.getAffiliateStats() as Promise<AffiliateStats>);
        if (cancelled) return;
        const dismissedAt = localStorage.getItem(DISMISS_KEY);
        const now = Date.now();
        const dismissedRecently = dismissedAt && now - Number(dismissedAt) < 30 * 60 * 1000; // 30 min
        if (isTaxInfoIncomplete(stats.thai_bank_info) && !dismissedRecently) {
          setShowTaxPrompt(true);
        }
      } catch (err) {
        // Stats fetch failed — fail-safe to *not* show prompt (don't block
        // success page render on an unrelated network issue).
        console.error('Tax info check failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-redirect countdown — paused while the tax prompt or the purchase survey is visible
  useEffect(() => {
    if (showTaxPrompt || survey) return;
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [navigate, showTaxPrompt, survey]);

  const handleSkipTaxPrompt = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShowTaxPrompt(false);  // resumes countdown via the effect above
  };

  const handleFillTaxNow = () => {
    navigate('/profile#tax-info');
  };

  return (
    <div className="page-wrapper">
      <main className="container mx-auto px-4 py-16">
        <div className="max-w-lg mx-auto text-center space-y-8">
          {/* Success icon */}
          <div className="animate-scale-in">
            <div className="w-28 h-28 mx-auto rounded-full bg-gradient-to-r from-green-500 to-emerald-600 flex items-center justify-center shadow-2xl shadow-green-500/40">
              <CheckCircle2 className="h-14 w-14 text-white" />
            </div>
          </div>

          {/* Title */}
          <div className="animate-scale-in space-y-3" style={{ animationDelay: '100ms' }}>
            <h1 className="text-2xl sm:text-3xl font-bold">
              {l('สมัครสมาชิกสำเร็จ!', 'Subscription Activated!')}
            </h1>
            <p className="text-muted-foreground text-lg">
              {l(
                'ยินดีต้อนรับเข้าสู่ Triple School',
                'Welcome to Triple School'
              )}
            </p>
          </div>

          {/* Features */}
          <div className="bg-card p-6 rounded-2xl border border-green-500/20 animate-scale-in" style={{ animationDelay: '200ms' }}>
            <div className="flex items-center justify-center gap-2 mb-4">
              <Sparkles className="h-5 w-5 text-[#FFB300]" />
              <span className="font-semibold">{l('สิ่งที่คุณได้รับ', "What's included")}</span>
            </div>
            <ul className="text-left space-y-3 text-sm">
              {[
                l('สร้างวิดีโอ AI ไม่จำกัด', 'Unlimited AI video generation'),
                l('ตั้งเวลาโพสต์อัตโนมัติ', 'Auto-scheduled posting'),
                l('เครื่องมือ AI ทั้งหมด', 'All AI tools'),
              ].map((feat, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 079: แบบสอบถามหลังซื้อ — มาก่อนกล่องภาษี · ตอบ/ข้ามแล้ว countdown เดินต่อ */}
          {survey && (
            <div className="animate-scale-in" style={{ animationDelay: '250ms' }}>
              <PurchaseSurvey
                purchase={{ type: 'subscription', extensionLogId: survey.extensionLogId, planSlug: survey.planSlug }}
                onDone={() => setSurvey(null)}
              />
            </div>
          )}

          {/* Tax info prompt — only when info incomplete + not dismissed this cycle.
              When visible, pauses the auto-redirect so user can choose. */}
          {!survey && showTaxPrompt && (
            <div
              className="bg-card p-5 rounded-2xl border border-[#FFB300]/30 text-left animate-scale-in space-y-3"
              style={{ animationDelay: '250ms' }}
            >
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-[#FFB300] mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold">
                    {l('เพิ่มข้อมูลภาษี (ไม่บังคับ)', 'Add tax info (optional)')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {l(
                      'กรอกข้อมูลภาษีของคุณเพื่อให้ออกใบกำกับภาษี + หนังสือรับรองภาษีหัก ณ ที่จ่าย ได้รวดเร็วขึ้นในอนาคต กรอกตอนนี้หรือมากรอกที่ /profile ภายหลังก็ได้',
                      'Provide tax info now to speed up VAT invoices + Withholding Tax certificates later. You can also fill this in /profile any time.',
                    )}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  onClick={handleFillTaxNow}
                  className="flex-1 bg-[#FFB300] hover:bg-[#FF9D00] text-black"
                >
                  {l('กรอกตอนนี้', 'Fill now')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleSkipTaxPrompt}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4 mr-1" />
                  {l('ข้ามไปก่อน', 'Skip for now')}
                </Button>
              </div>
            </div>
          )}

          {/* Countdown + redirect — hidden while a prompt is open */}
          {!survey && !showTaxPrompt && (
            <div className="space-y-4 animate-scale-in" style={{ animationDelay: '300ms' }}>
              <p className="text-sm text-muted-foreground">
                {l(
                  `กำลังพาคุณไปหน้าหลักใน ${countdown} วินาที...`,
                  `Redirecting to main page in ${countdown} second${countdown !== 1 ? 's' : ''}...`
                )}
              </p>

              {/* Progress bar */}
              <div className="w-48 h-1.5 mx-auto bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${(countdown / COUNTDOWN_SECONDS) * 100}%` }}
                />
              </div>

              <Button
                onClick={() => navigate('/')}
                className="h-12 px-8 text-base font-bold bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] hover:opacity-90"
              >
                {l('เริ่มใช้งานเลย', 'Start Now')}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default CheckoutComplete;
