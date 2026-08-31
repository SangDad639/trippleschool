import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { ArrowLeft, Copy, Check, Upload, Loader2, CheckCircle2, AlertCircle, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import { PRICING, VAT_RATE, perMonthOfYearly } from '@/lib/pricing';

const SubscriptionTransferV2 = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, refreshUser } = useAuth();
  const { refreshSubscription } = useSubscription();
  const { language, setLanguage } = useLanguage();

  const l = (th: string, en: string) => language === 'th' ? th : en;

  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>(
    (searchParams.get('plan') as 'monthly' | 'yearly') || 'yearly'
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // โค้ดผู้แนะนำ — valid แล้วยอดโอนลด % (server ตรวจซ้ำและคาดหวังยอดลดตอน verify สลิป)
  const [refCode, setRefCode] = useState(() => localStorage.getItem('ts_ref') || '');
  const [refCheck, setRefCheck] = useState<{ valid: boolean; pct: number; reason?: string; code: string } | null>(null);
  const [refChecking, setRefChecking] = useState(false);

  const isMonthly = selectedPlan === 'monthly';

  // Fetch active plans from DB (subscription_plans table via /api/subscription/plans).
  // Single source of truth: admin updates DB → all pricing flows pick it up.
  type ApiPlan = Awaited<ReturnType<typeof api.getSubscriptionPlans>>['plans'][number];
  const [apiPlans, setApiPlans] = useState<ApiPlan[] | null>(null);
  useEffect(() => {
    api.getSubscriptionPlans()
      .then((res) => setApiPlans(res.plans))
      .catch(() => { /* fall back to hardcoded PRICING */ });
  }, []);

  // Resolve a plan by slug — prefer live DB, fall back to PRICING constants if
  // API is unreachable so the page still works.
  const getPlanPricing = (slug: 'monthly' | 'yearly') => {
    const apiPlan = apiPlans?.find((p) => p.slug === slug);
    if (apiPlan) {
      return { subtotal: apiPlan.subtotal, vat: apiPlan.vat, total: apiPlan.total };
    }
    return slug === 'yearly' ? PRICING.yearly : PRICING.monthly;
  };

  // The number user transfers is the *vat-inclusive total*.
  // โค้ด valid → ลด % จาก subtotal แล้วบวก VAT ใหม่ — สูตร round2 ต้องตรงกับ server เป๊ะ
  const planPricing = getPlanPricing(selectedPlan);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const refValid = refCheck?.valid ?? false;
  const effSubtotal = refValid ? round2(planPricing.subtotal * (1 - refCheck!.pct / 100)) : planPricing.subtotal;
  const effTotal = refValid ? round2(effSubtotal * (1 + VAT_RATE / 100)) : planPricing.total;
  const effVat = round2(effTotal - effSubtotal);
  const refDiscountAmt = round2(planPricing.subtotal - effSubtotal);
  const price = String(effTotal);
  const priceDisplay = `฿${effTotal.toLocaleString()}`;
  const subtotalDisplay = `฿${planPricing.subtotal.toLocaleString()}`;
  const vatDisplay = `฿${effVat.toLocaleString()}`;

  const validateCode = async (raw: string, silent = false) => {
    const code = raw.trim();
    if (!code) { setRefCheck(null); return; }
    try {
      setRefChecking(true);
      const r = await api.validateRefcode(code);
      setRefCheck({ valid: r.valid, pct: r.discount_percent, reason: r.reason, code: code.toLowerCase() });
      if (!silent) {
        if (r.valid) toast.success(l(`ใช้โค้ดสำเร็จ 🎉 ลด ${r.discount_percent}%`, `Code applied 🎉 ${r.discount_percent}% off`));
        else toast.error(r.reason === 'OWN_CODE' ? l('ใช้โค้ดของตัวเองไม่ได้', 'Cannot use your own code') : l('ไม่พบโค้ดนี้', 'Code not found'));
      }
    } catch {
      if (!silent) toast.error(l('ตรวจสอบโค้ดไม่สำเร็จ ลองใหม่อีกครั้ง', 'Could not validate code, please retry'));
    } finally {
      setRefChecking(false);
    }
  };
  const handleCheckRefCode = () => void validateCode(refCode);

  // โค้ดที่ prefill จากลิงก์แนะนำ → validate อัตโนมัติ ให้ยอดโอนบนจอถูกตั้งแต่เข้าเพจ
  // (ไม่งั้น user เห็นโค้ดอยู่ในช่อง เข้าใจว่านับแล้ว → โอนราคาเต็ม เสียส่วนลดเงียบๆ)
  useEffect(() => {
    if (refCode.trim()) void validateCode(refCode, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const BANK_ACCOUNT = '231-3-08816-5';
  const BANK_NAME = l('ธนาคารกสิกรไทย', 'Kasikorn Bank (KBank)');
  const ACCOUNT_NAME = l('บจก. ทริปเปิล สปาร์ค เทค', 'Triple Spark Tech Co., Ltd.');

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(l(`คัดลอก ${label} แล้ว`, `Copied ${label}`));
    setTimeout(() => setCopied(null), 2000);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(l('ไฟล์ใหญ่เกิน 5MB', 'File too large (max 5MB)'));
      return;
    }
    setSlipFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setErrorMessage(null);
  };

  const errorMessages: Record<string, { th: string; en: string }> = {
    // Thunder API error codes (lowercase)
    invalid_payload: {
      th: 'ข้อมูลสลิปไม่ถูกต้อง\nกรุณาลองอัปโหลดใหม่',
      en: 'Invalid slip data.\nPlease try uploading again.',
    },
    invalid_image: {
      th: 'รูปภาพไม่ถูกต้อง กรุณาใช้ไฟล์ JPEG, PNG หรือ WebP',
      en: 'Invalid image format. Please use JPEG, PNG, or WebP.',
    },
    invalid_url: {
      th: 'URL ของรูปภาพไม่ถูกต้อง\nกรุณาลองอัปโหลดใหม่',
      en: 'Invalid image URL.\nPlease try uploading again.',
    },
    image_size_too_large: {
      th: 'รูปภาพใหญ่เกินไป\nกรุณาลดขนาดรูปให้ไม่เกิน 4 MB',
      en: 'Image too large.\nPlease reduce the file size to under 4 MB.',
    },
    qrcode_not_found: {
      th: 'ไม่พบ QR Code ในรูปสลิป\nกรุณาถ่ายภาพสลิปใหม่ให้เห็น QR Code ชัดเจน',
      en: 'QR code not found in the slip image.\nPlease take a clear photo showing the QR code.',
    },
    slip_not_found: {
      th: 'ไม่พบข้อมูลสลิป สลิปอาจหมดอายุหรือถูกลบแล้ว\nกรุณาใช้สลิปที่ยังไม่หมดอายุ',
      en: 'Slip data not found. The slip may have expired.\nPlease use a valid, unexpired slip.',
    },
    slip_pending: {
      th: 'สลิปธนาคารกรุงเทพยังรอดำเนินการอยู่\nกรุณารอ 5 นาที แล้วลองใหม่อีกครั้ง',
      en: 'Bangkok Bank slip is still being processed.\nPlease wait 5 minutes and try again.',
    },
    slip_expired: {
      th: 'สลิปหมดอายุแล้ว ไม่สามารถใช้ได้\nกรุณาโอนเงินใหม่แล้วอัปโหลดสลิปล่าสุด',
      en: 'Slip has expired and cannot be used.\nPlease make a new transfer and upload the latest slip.',
    },
    duplicate_slip: {
      th: 'สลิปนี้เคยถูกใช้ยืนยันแล้ว ไม่สามารถใช้ซ้ำได้\nกรุณาโอนเงินใหม่แล้วใช้สลิปใหม่',
      en: 'This slip has already been used for verification.\nPlease make a new transfer and use the new slip.',
    },
    // Our custom error codes (UPPERCASE)
    INVALID_BANK: {
      th: 'สลิปนี้ไม่ใช่การโอนเข้าธนาคารกสิกรไทย (KBank)\nกรุณาโอนเงินเข้าบัญชี KBank ที่ระบุด้านบนแล้วลองใหม่',
      en: 'This slip is not a transfer to Kasikorn Bank (KBank).\nPlease transfer to the KBank account shown above and try again.',
    },
    INVALID_ACCOUNT: {
      th: `บัญชีปลายทางในสลิปไม่ตรงกับบัญชีที่กำหนด (หรือระบบตรวจสอบบัญชีไม่ผ่าน)\nกรุณาโอนเข้าบัญชี ${BANK_ACCOUNT} เท่านั้น แล้วอัปโหลดสลิปใหม่`,
      en: `Recipient account on the slip does not match (or could not be verified).\nPlease transfer to account ${BANK_ACCOUNT} only and upload the new slip.`,
    },
    INVALID_AMOUNT: {
      th: `จำนวนเงินในสลิปไม่ตรงกับแพ็กเกจที่เลือก\nกรุณาโอนจำนวน ${priceDisplay} แล้วอัปโหลดสลิปใหม่`,
      en: `The amount on the slip does not match the selected plan.\nPlease transfer exactly ${priceDisplay} and upload the new slip.`,
    },
    INVALID_REFCODE: {
      th: 'โค้ดผู้แนะนำไม่ถูกต้อง\nกรุณาตรวจสอบโค้ดหรือลบโค้ดออกแล้วลองใหม่',
      en: 'Invalid referral code.\nPlease check the code or remove it and try again.',
    },
    DUPLICATE_SLIP: {
      th: 'สลิปนี้เคยถูกใช้ยืนยันแล้ว ไม่สามารถใช้ซ้ำได้\nกรุณาโอนเงินใหม่แล้วใช้สลิปใหม่',
      en: 'This slip has already been used for verification.\nPlease make a new transfer and use the new slip.',
    },
    EXPIRED_SLIP: {
      th: 'สลิปนี้เก่าเกิน 24 ชั่วโมง ไม่สามารถใช้ได้\nกรุณาโอนเงินใหม่แล้วอัปโหลดสลิปล่าสุด',
      en: 'This slip is older than 24 hours and cannot be used.\nPlease make a new transfer and upload the latest slip.',
    },
    TIMEOUT: {
      th: 'ระบบตรวจสลิปใช้เวลานานเกินไป\nกรุณาลองใหม่อีกครั้ง',
      en: 'Slip verification timed out.\nPlease try again.',
    },
    NETWORK_ERROR: {
      th: 'เชื่อมต่อระบบตรวจสลิปไม่สำเร็จ\nกรุณาลองใหม่อีกครั้ง',
      en: 'Could not reach the slip verification service.\nPlease try again.',
    },
    RATE_LIMITED: {
      th: 'คุณลองยืนยันสลิปถี่เกินไป\nกรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
      en: 'Too many verification attempts.\nPlease wait a moment and try again.',
    },
    CONFIG_ERROR: {
      th: 'ระบบตรวจสลิปยังไม่พร้อมใช้งาน\nกรุณาติดต่อทีมงาน',
      en: 'Slip verification is not configured.\nPlease contact support.',
    },
    INTERNAL_ERROR: {
      th: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง\nหากยังไม่สำเร็จ กรุณาติดต่อทีมงาน',
      en: 'A system error occurred. Please try again.\nIf the problem persists, please contact support.',
    },
  };

  const handleVerify = async () => {
    if (!slipFile) {
      toast.error(l('กรุณาเลือกไฟล์สลิป', 'Please select slip file'));
      return;
    }
    // มีโค้ดในช่องแต่ยังไม่ validate (แตะช่องหลัง apply / reload หน้า) → ห้ามส่งเงียบๆ
    // เพราะ server จะคาดหวังยอดเต็มทั้งที่ user โอนยอดลดไปแล้ว → INVALID_AMOUNT + สลิปเสี่ยงติด duplicate
    const typed = refCode.trim().toLowerCase();
    if (typed && !(refCheck?.valid && refCheck.code === typed)) {
      setErrorMessage(l('คุณกรอกโค้ดไว้แต่ยังไม่ได้กด "ใช้โค้ด"\nกดใช้โค้ดเพื่อยืนยันยอดโอน หรือลบโค้ดออกจากช่องก่อน', 'You typed a code but haven\'t applied it.\nPress "Apply" to confirm the amount, or clear the code field.'));
      return;
    }
    setVerifying(true);
    setErrorMessage(null);
    try {
      const result = await api.verifyAndApproveSlip(slipFile, selectedPlan, refValid ? refCheck!.code : undefined);
      if (result.success) {
        await refreshUser();
        navigate(`/subscription/checkout-complete?plan=${selectedPlan}&amount=${price}`);
      } else {
        const rawCode = result.errorCode || '';
        if (rawCode === 'INVALID_REFCODE') setRefCheck(null); // เคลียร์ ✅ ค้าง ไม่ให้ยอดลดโชว์ผิด
        const msg = errorMessages[rawCode] || errorMessages[rawCode.toLowerCase()] || errorMessages['INTERNAL_ERROR'];
        setErrorMessage(l(msg.th, msg.en));
      }
    } catch (err: any) {
      const rawCode = err?.errorCode || '';
      if (rawCode === 'INVALID_REFCODE') setRefCheck(null);
      const msg = errorMessages[rawCode] || errorMessages[rawCode.toLowerCase()] || errorMessages['INTERNAL_ERROR'];
      setErrorMessage(l(msg.th, msg.en));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="page-wrapper">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} aria-label="ย้อนกลับ" className="p-2 -m-2 text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-bold">{l('สมัครสมาชิก', 'Subscribe')}</h1>
          </div>
          <button
            onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
            className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
          >
            {language === 'th' ? 'TH' : 'EN'}
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Plan Toggle */}
        <div className="flex bg-card border border-border rounded-xl p-1 gap-1">
          <button
            onClick={() => setSelectedPlan('monthly')}
            className={`flex-1 py-5 rounded-lg text-lg font-semibold transition-all ${
              isMonthly
                ? 'bg-[#FFB300] text-black shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {l('รายเดือน', 'Monthly')}
            <span className="block text-sm font-normal mt-1 opacity-80">
              <span className="line-through opacity-60 mr-1">฿{(getPlanPricing('monthly').subtotal * 2).toLocaleString()}</span>
              ฿{getPlanPricing('monthly').subtotal.toLocaleString()}/{l('เดือน', 'mo')}
            </span>
          </button>
          <button
            onClick={() => setSelectedPlan('yearly')}
            className={`flex-1 py-5 rounded-lg text-lg font-semibold transition-all relative ${
              !isMonthly
                ? 'bg-[#FFB300] text-black shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {l('รายปี', 'Yearly')}
            {/* สไตล์ TradingView: โชว์ /เดือน (ปีหาร 12) + ยอดจริงบรรทัดล่าง — ยอดโอนจริงดูที่สรุปด้านล่าง */}
            <span className="block text-sm font-normal mt-1 opacity-80">
              <span className="line-through opacity-60 mr-1">฿{perMonthOfYearly(getPlanPricing('yearly').subtotal * 2).toLocaleString()}</span>
              ฿{perMonthOfYearly(getPlanPricing('yearly').subtotal).toLocaleString()}/{l('เดือน', 'mo')}
            </span>
            <span className="block text-xs sm:text-[11px] font-normal opacity-90 sm:opacity-70">
              {l('ชำระเป็นรายปี', 'Billed annually')} ฿{getPlanPricing('yearly').subtotal.toLocaleString()}
            </span>
            <span className="absolute -top-2 -right-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold">-50%</span>
          </button>
        </div>

        {/* Step 1: Bank Info */}
        <div className="bg-card border border-green-500/20 rounded-2xl p-5 bg-green-500/5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-white text-[10px] font-bold">1</div>
            <span className="font-semibold text-green-300">{l('โอนเงินเข้าบัญชี', 'Transfer to account')}</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center text-white text-[9px] font-bold">K+</div>
            <span className="font-semibold text-green-300 text-sm">{BANK_NAME}</span>
          </div>

          <div className="space-y-1.5">
            <div>
              <p className="text-[10px] text-gray-500">{l('ชื่อบัญชี', 'Account name')}</p>
              <p className="text-sm font-medium">{ACCOUNT_NAME}</p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-500">{l('เลขบัญชี', 'Account number')}</p>
                <p className="text-base font-bold text-green-400 tracking-wider">{BANK_ACCOUNT}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(BANK_ACCOUNT.replace(/-/g, ''), l('เลขบัญชี', 'Account number'))}
                className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
              >
                {copied === l('เลขบัญชี', 'Account number') ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
            {/* โค้ดผู้แนะนำ = ส่วนลด + เจ้าของโค้ดได้ค่าคอม */}
            <div className="pt-1.5 border-t border-green-500/20 space-y-1.5">
              <p className="text-[10px] text-gray-500">{l('🎟️ โค้ดผู้แนะนำ (ถ้ามี)', '🎟️ Referral code (optional)')}</p>
              <div className="flex gap-2">
                <input
                  value={refCode}
                  onChange={(e) => { setRefCode(e.target.value); setRefCheck(null); }}
                  placeholder={l('กรอกโค้ดเพื่อรับส่วนลด', 'Enter code for a discount')}
                  disabled={verifying}
                  className="flex-1 h-11 md:h-9 rounded-lg bg-gray-900/60 border border-gray-700 px-3 text-base md:text-sm font-mono text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500/50"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCheckRefCode}
                  disabled={refChecking || !refCode.trim() || verifying}
                  className="h-11 md:h-9 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                >
                  {refChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : l('ใช้โค้ด', 'Apply')}
                </Button>
              </div>
              {refCheck?.valid && (
                <p className="text-green-400 text-xs">✅ {l(`ใช้โค้ดแล้ว ลด ${refCheck.pct}%`, `Code applied — ${refCheck.pct}% off`)}</p>
              )}
              {refCheck && !refCheck.valid && (
                <p className="text-red-400 text-xs">❌ {refCheck.reason === 'OWN_CODE' ? l('ใช้โค้ดของตัวเองไม่ได้', 'Cannot use your own code') : l('ไม่พบโค้ดนี้ ตรวจสอบอีกครั้ง', 'Code not found')}</p>
              )}
            </div>

            <div className="pt-1.5 border-t border-green-500/20">
              <p className="text-[10px] text-gray-500 mb-1.5">{l('จำนวนเงิน', 'Amount')}</p>
              <div className="space-y-1 text-sm">
                <div className="flex items-center justify-between text-gray-400">
                  <span>{l('ยอดก่อนภาษีมูลค่าเพิ่ม', 'Sub total')}</span>
                  <span>{subtotalDisplay}</span>
                </div>
                {refValid && refDiscountAmt > 0 && (
                  <div className="flex items-center justify-between text-green-400">
                    <span>{l(`ส่วนลดโค้ดผู้แนะนำ ${refCheck!.pct}%`, `Referral code ${refCheck!.pct}% off`)}</span>
                    <span>-฿{refDiscountAmt.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-gray-400">
                  <span>{l(`ภาษีมูลค่าเพิ่ม ${VAT_RATE}%`, `VAT ${VAT_RATE}%`)}</span>
                  <span>{vatDisplay}</span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-green-500/20">
                  <span className="font-semibold text-gray-200">{l('ยอดรวม', 'Total')}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-[#FFB300]">{priceDisplay}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(price, l('จำนวนเงิน', 'Amount'))}
                      className="h-7 text-xs border-[#FFB300]/30 text-[#FFB300] hover:bg-[#FFB300]/10"
                    >
                      {copied === l('จำนวนเงิน', 'Amount') ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tax invoice notice — contact admin via LINE */}
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm text-gray-300">
              {l('ต้องการใบกำกับภาษีรบกวนแจ้งแอดมิน', 'Need a tax invoice? Please contact admin')}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {l('LINE ID: ', 'LINE ID: ')}<span className="text-[#06C755] font-semibold">@tpn639</span>
            </p>
          </div>
          <a
            href="https://lin.ee/YNaPjfV"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm" variant="outline" className="h-9 text-xs font-bold border-[#06C755] text-[#06C755] hover:bg-[#06C755]/10 hover:text-[#06C755] rounded-lg">
              <MessageCircle className="h-4 w-4 mr-1.5 text-[#06C755]" />
              LINE
            </Button>
          </a>
        </div>

        {/* Step 2: Upload Slip */}
        <div className="bg-card border border-[#FFB300]/30 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[#FFB300] flex items-center justify-center text-black text-[10px] font-bold">2</div>
            <span className="font-semibold text-[#FFB300]">{l('อัปโหลดสลิปเพื่อเปิดใช้งานทันที', 'Upload slip for instant activation')}</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!slipFile ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-[#FFB300]/40 rounded-xl p-8 hover:bg-[#FFB300]/5 transition-colors flex flex-col items-center gap-2"
            >
              <Upload className="h-8 w-8 text-[#FFB300]" />
              <span className="text-sm text-gray-300">{l('คลิกเพื่อเลือกไฟล์สลิป', 'Click to select slip file')}</span>
              <span className="text-[10px] text-gray-500">JPEG / PNG / WebP (max 5MB)</span>
            </button>
          ) : (
            <div className="space-y-3">
              {previewUrl && (
                <div className="rounded-xl overflow-hidden border border-border">
                  <img src={previewUrl} alt="Slip preview" className="w-full max-h-80 object-contain bg-zinc-900" />
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-400 truncate">{slipFile.name}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSlipFile(null);
                    setPreviewUrl(null);
                    setErrorMessage(null);
                  }}
                  disabled={verifying}
                  className="h-7 text-xs"
                >
                  {l('เปลี่ยนไฟล์', 'Change')}
                </Button>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm text-red-300 whitespace-pre-line">{errorMessage}</div>
            </div>
          )}

          <Button
            onClick={handleVerify}
            disabled={!slipFile || verifying}
            className="w-full h-11 text-sm font-bold bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] hover:opacity-90 text-black rounded-lg disabled:opacity-50"
          >
            {verifying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {l('กำลังตรวจสอบสลิป...', 'Verifying slip...')}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {l('ตรวจสอบและสมัครสมาชิก', 'Verify & Subscribe')}
              </>
            )}
          </Button>

          <p className="text-[10px] text-gray-500 text-center">
            {l('ระบบจะตรวจสอบสลิปอัตโนมัติและเปิดใช้งานภายใน 5 วินาที', 'Slip verified automatically — activated within 5 seconds')}
          </p>
        </div>

        {/* User info */}
        {user && (
          <p className="text-center text-xs text-gray-600">
            {l('สมัครด้วยอีเมล', 'Subscribing with email')}: {user.email}
          </p>
        )}
      </div>
    </div>
  );
};

export default SubscriptionTransferV2;
