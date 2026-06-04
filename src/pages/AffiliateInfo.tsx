import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Gift, Copy, Check, GraduationCap } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

const TRIAL_CODE = 'P78FS2QN';

const AffiliateInfo = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [codeOpen, setCodeOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(TRIAL_CODE);
      setCopied(true);
      toast.success(language === 'th' ? 'คัดลอกโค้ดแล้ว' : 'Code copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(language === 'th' ? 'คัดลอกไม่สำเร็จ' : 'Copy failed');
    }
  };

  return (
    <>
      <div className="page-wrapper">
        {/* Header */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
          <div className="max-w-4xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                {language === 'th' ? 'กลับ' : 'Back'}
              </Button>
              <div className="h-px w-6 bg-border rotate-[30deg]" />
              <div className="flex items-center gap-2">
                <div
                  className="h-8 w-8 rounded-[10px] flex items-center justify-center shadow-lg"
                  style={{
                    background:
                      'radial-gradient(circle farthest-corner at 35% 90%, #fec564, transparent 50%), radial-gradient(circle farthest-corner at 0 140%, #fec564, transparent 50%), radial-gradient(ellipse farthest-corner at 0 -25%, #5258cf, transparent 50%), radial-gradient(ellipse farthest-corner at 20% -50%, #5258cf, transparent 50%), radial-gradient(ellipse farthest-corner at 100% 0, #893dc2, transparent 50%), radial-gradient(ellipse farthest-corner at 60% -20%, #893dc2, transparent 50%), radial-gradient(ellipse farthest-corner at 100% 100%, #d9317a, transparent), linear-gradient(#6559ca, #bc318f 30%, #e33f5f 50%, #f77638 70%, #fec66d 100%)',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M13 2L4.5 13.5H11.5L11 22L19.5 10.5H12.5L13 2Z"
                      fill="#FFD700"
                      stroke="#FFD700"
                      strokeWidth="0.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <span className="text-base font-bold">Triple School</span>
              </div>
            </div>
            <Button onClick={() => navigate('/register')} className="gap-2" size="sm">
              {language === 'th' ? 'สมัครเลย' : 'Sign Up'}
            </Button>
          </div>
        </nav>

        {/* Content */}
        <div className="container px-4 md:px-6 pt-[30px] pb-24 max-w-4xl mx-auto">
          {/* Page Title */}
          <div className="text-center mb-8 mt-4">
            <h1 className="text-3xl md:text-4xl font-bold text-white">
              {language === 'th' ? 'ตัวแทนจำหน่าย Affiliate' : 'Affiliate Program'}
            </h1>
            <p className="text-sm md:text-base text-zinc-400 mt-3">
              {language === 'th'
                ? 'ร่วมเป็นตัวแทนจำหน่ายกับเรา สร้างรายได้แบบ Passive Income'
                : 'Become our affiliate partner and earn passive income'}
            </p>
          </div>

          {/* Hero Image (top) */}
          <div className="mb-8">
            <img
              src="/ChatGPT Image 20 พ.ค. 2569 15_46_07.png"
              alt="Affiliate Hero"
              className="w-full rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.3)]"
            />
          </div>

          {/* Image 2 */}
          <div className="mb-8">
            <img
              src="/ChatGPT Image 20 พ.ค. 2569 11_56_52.png"
              alt="Affiliate Benefits"
              className="w-full rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.3)]"
            />
          </div>

          {/* Image 3 */}
          <div className="mb-10">
            <img
              src="/ChatGPT Image 20 พ.ค. 2569 11_56_45.png"
              alt="Affiliate Details"
              className="w-full rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.3)]"
            />
          </div>

          {/* Get Trial Code CTA + How-to-Use side by side (same width so gradient renders identically) */}
          <div className="text-center mt-12">
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <button
                onClick={() => setCodeOpen(true)}
                className="relative inline-flex items-center justify-center gap-3 text-xl font-bold px-12 py-5 rounded-full text-black overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-[0_0_40px_rgba(255,179,0,0.5)] active:scale-95 group min-w-[22rem]"
                style={{ background: 'linear-gradient(135deg, #FFD700 0%, #FFB300 50%, #FF9800 100%)' }}
              >
                <span className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 rounded-full" />
                <span className="relative z-10 flex items-center gap-3">
                  <Gift className="h-6 w-6" />
                  {language === 'th' ? 'รับโค๊ดทดลองฟรี 7 วัน' : 'Get 7-Day Free Trial Code'}
                </span>
              </button>
              <button
                onClick={() => navigate('/tutorials')}
                className="relative inline-flex items-center justify-center gap-3 text-xl font-bold px-12 py-5 rounded-full text-black overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-[0_0_40px_rgba(255,179,0,0.5)] active:scale-95 group whitespace-nowrap min-w-[22rem]"
                style={{ background: 'linear-gradient(135deg, #FFD700 0%, #FFB300 50%, #FF9800 100%)' }}
              >
                <span className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 rounded-full" />
                <span className="relative z-10 flex items-center gap-3">
                  <GraduationCap className="h-6 w-6" />
                  {language === 'th' ? 'วิธีใช้โปรแกรม' : 'How to Use'}
                </span>
              </button>
            </div>
            <p className="text-sm text-zinc-500 mt-3">
              {language === 'th' ? 'เริ่มสร้างรายได้กับ Triple School วันนี้' : 'Start earning with Triple School today'}
            </p>
          </div>
        </div>
      </div>

      {/* Floating CTA Button - Join Affiliate (only this one floats) */}
      <div className="fixed bottom-6 left-0 right-0 z-[9999] flex justify-center pointer-events-none">
        <button
          onClick={() => navigate('/register')}
          className="pointer-events-auto relative inline-flex items-center gap-3 text-lg font-bold px-10 py-4 rounded-full text-black overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-[0_0_40px_rgba(255,179,0,0.5)] active:scale-95 group shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
          style={{ background: 'linear-gradient(135deg, #FFD700 0%, #FFB300 50%, #FF9800 100%)' }}
        >
          <span className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 rounded-full" />
          <span className="relative z-10 flex items-center gap-3">
            {language === 'th' ? 'สมัครเป็นตัวแทน' : 'Join Affiliate'}
            <ArrowLeft className="h-5 w-5 rotate-180 group-hover:translate-x-1 transition-transform" />
          </span>
        </button>
      </div>

      {/* Trial Code Dialog */}
      <Dialog open={codeOpen} onOpenChange={(o) => { setCodeOpen(o); if (!o) setCopied(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Gift className="h-5 w-5 text-yellow-500" />
              {language === 'th' ? 'โค้ดทดลองฟรี 7 วัน' : '7-Day Free Trial Code'}
            </DialogTitle>
            <DialogDescription>
              {language === 'th'
                ? 'คัดลอกโค้ดด้านล่าง แล้วนำไปกรอกตอนสมัครสมาชิกเพื่อรับสิทธิ์ทดลองใช้งานฟรี 7 วัน'
                : 'Copy the code below and enter it during sign up to claim your free 7-day trial.'}
            </DialogDescription>
          </DialogHeader>

          <div
            onClick={handleCopy}
            className="relative cursor-pointer group rounded-xl p-5 my-2 border-2 border-dashed border-yellow-500/40 hover:border-yellow-500/80 transition-all"
            style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.08), rgba(255,152,0,0.08))' }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-2xl md:text-3xl font-bold tracking-[0.25em] text-yellow-400">
                {TRIAL_CODE}
              </span>
              <div className="h-10 w-10 rounded-lg bg-yellow-500/15 group-hover:bg-yellow-500/25 flex items-center justify-center transition-colors">
                {copied ? <Check className="h-5 w-5 text-green-400" /> : <Copy className="h-5 w-5 text-yellow-400" />}
              </div>
            </div>
            <p className="text-xs text-zinc-500 mt-2 text-center">
              {language === 'th' ? 'คลิกเพื่อคัดลอกโค้ด' : 'Click to copy code'}
            </p>
          </div>

          <Button
            onClick={() => {
              setCodeOpen(false);
              navigate('/register');
            }}
            className="w-full font-bold text-black"
            style={{ background: 'linear-gradient(135deg, #FFD700 0%, #FFB300 50%, #FF9800 100%)' }}
          >
            {language === 'th' ? 'ไปที่หน้าสมัครสมาชิก' : 'Go to Sign Up'}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AffiliateInfo;
