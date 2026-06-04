import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowLeft, Copy, MessageCircle, Banknote, QrCode, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';

const SubscriptionTransfer = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, refreshUser } = useAuth();
  const { language, setLanguage } = useLanguage();

  // Check subscription status every 10 seconds
  useEffect(() => {
    const checkSubscription = async () => {
      await refreshUser();
    };

    // Check immediately
    checkSubscription();

    // Then check every 10 seconds
    const interval = setInterval(checkSubscription, 10000);

    return () => clearInterval(interval);
  }, [refreshUser]);

  // Redirect to dashboard if subscription is active
  useEffect(() => {
    if (user?.subscriptionExpiresAt) {
      const expiresAt = new Date(user.subscriptionExpiresAt);
      if (expiresAt > new Date()) {
        toast.success(language === 'th' ? 'สมัครสมาชิกสำเร็จ!' : 'Subscription activated!');
        navigate('/scheduler');
      }
    }
  }, [user?.subscriptionExpiresAt, navigate, language]);
  const [copied, setCopied] = useState<string | null>(null);

  const l = (th: string, en: string) => language === 'th' ? th : en;

  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>(
    (searchParams.get('plan') as 'monthly' | 'yearly') || 'yearly'
  );
  const isMonthly = selectedPlan === 'monthly';
  const planName = isMonthly ? 'Triple School Monthly' : 'Triple School Yearly';
  const price = isMonthly ? '600' : '3000';
  const priceDisplay = isMonthly ? '฿600' : '฿3,000';
  const originalPrice = isMonthly ? null : '฿7,200';
  const period = isMonthly ? l('/เดือน', '/month') : l('/ปี', '/year');
  const discount = isMonthly ? null : '-58%';

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(l(`คัดลอก ${label} แล้ว`, `Copied ${label}`));
    setTimeout(() => setCopied(null), 2000);
  };

  const BANK_ACCOUNT = '511-1-00622-0';
  const BANK_NAME = l('ธนาคารกสิกรไทย', 'Kasikorn Bank (KBank)');
  const ACCOUNT_NAME = l('นาย อิสรชน อินทรโยธิน', 'Mr. Itsarachon Intarayotin');

  return (
    <div className="page-wrapper">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition-colors">
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

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">

        {/* Plan Toggle */}
        <div className="max-w-md mx-auto flex bg-card border border-border rounded-xl p-1 gap-1">
          <button
            onClick={() => setSelectedPlan('monthly')}
            className={`flex-1 py-3 rounded-lg text-sm font-semibold transition-all ${
              isMonthly
                ? 'bg-[#FFB300] text-black shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {l('รายเดือน', 'Monthly')}
            <span className="block text-xs font-normal mt-0.5 opacity-80">฿600/{l('เดือน', 'mo')}</span>
          </button>
          <button
            onClick={() => setSelectedPlan('yearly')}
            className={`flex-1 py-3 rounded-lg text-sm font-semibold transition-all relative ${
              !isMonthly
                ? 'bg-[#FFB300] text-black shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {l('รายปี', 'Yearly')}
            <span className="block text-xs font-normal mt-0.5 opacity-80">฿3,000/{l('ปี', 'yr')}</span>
            <span className="absolute -top-2 -right-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">-58%</span>
          </button>
        </div>

        {/* Plan Info */}
        <div className="bg-card border border-[#FFB300]/30 rounded-xl px-5 py-3 space-y-1.5 max-w-2xl mx-auto">
          <div className="flex items-center justify-center gap-3">
            <div className="p-1.5 rounded-lg bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500]">
              <Banknote className="h-4 w-4 text-black" />
            </div>
            <span className="font-bold">{planName}</span>
            {originalPrice && <span className="text-gray-500 line-through text-sm">{originalPrice}</span>}
            <span className="text-2xl font-bold bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] bg-clip-text text-transparent">
              {priceDisplay}
            </span>
            <span className="text-gray-400 text-sm">{period}</span>
            {discount && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-xs font-bold">{discount}</span>}
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
            {[
              l('โพสต์ไม่จำกัด', 'Unlimited posts'),
              l('ทุกแพลตฟอร์ม', 'All platforms'),
              l('AI ตั้งเวลาอัตโนมัติ', 'AI scheduling'),
              l('ยกเลิกได้ตลอด', 'Cancel anytime'),
            ].map((f, i) => (
              <span key={i} className="flex items-center gap-1">
                <Check className="h-3 w-3 text-green-500" />{f}
              </span>
            ))}
          </div>
        </div>

        {/* Payment + Upload Slip (left) | Bank + LINE (right) */}
        <div className="grid md:grid-cols-2 gap-4">

          {/* Left: Payment QR + Upload Slip */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4 self-start">
            <div className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-[#FFB300]" />
              <h3 className="font-bold">{l('ชำระเงิน', 'Payment')}</h3>
            </div>

            <div className="flex justify-center">
              <div className="bg-white rounded-lg p-4 inline-block">
                <img
                  src="/payment/qr-promptpay.jpg"
                  alt="Thai QR Payment"
                  className="w-64 h-auto"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            </div>
            <p className="text-center text-xs text-gray-400">{l('สแกน QR เพื่อโอนเงินเข้าบัญชี', 'Scan QR to transfer')}</p>
          </div>

          {/* Right: Bank Info + LINE Contact */}
          <div className="space-y-4">
            {/* Bank Info */}
            <div className="bg-card border border-green-500/20 rounded-2xl p-5 bg-green-500/5 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-white text-[10px] font-bold">K+</div>
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
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-500">{l('จำนวนเงิน', 'Amount')}</p>
                    <p className="text-base font-bold text-[#FFB300]">{priceDisplay}</p>
                  </div>
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

            {/* LINE Contact */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-green-500" />
                <h3 className="font-bold text-sm">{l('แอดไลน์เพื่อแจ้งการชำระเงิน', 'Add LINE to confirm payment')}</h3>
              </div>

              <div className="flex justify-center">
                <div className="bg-white rounded-lg p-3 inline-block">
                  <img
                    src="/payment/qr-line.png"
                    alt="LINE QR Code"
                    className="w-36 h-auto"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              </div>
              <p className="text-center text-xs text-gray-400">{l('สแกน QR Code เพื่อเพิ่มเพื่อน', 'Scan QR Code to add friend')}</p>

              <a
                href="https://line.me/R/ti/p/@442dnfxt"
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <Button className="w-full h-10 text-sm font-bold bg-[#06C755] hover:bg-[#05b34d] text-white rounded-lg">
                  <MessageCircle className="h-4 w-4 mr-2" />
                  {l('เพิ่มเพื่อน LINE', 'Add LINE Friend')}
                </Button>
              </a>

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-center">
                <p className="text-xs text-yellow-300 font-medium">
                  {l('หลังจากโอนเงินแล้ว กรุณาส่งสลิปทาง LINE', 'After transferring, please send the slip via LINE')}
                </p>
                <p className="text-[10px] text-yellow-400/70">
                  {l('ระบบจะเปิดใช้งานภายใน 24 ชั่วโมง', 'Your account will be activated within 24 hours')}
                </p>
              </div>
            </div>
          </div>

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

export default SubscriptionTransfer;
