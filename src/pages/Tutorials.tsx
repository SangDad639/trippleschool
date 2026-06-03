import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, Lock, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const STORAGE_KEY = 'tutorials_countdown_start';
const COUNTDOWN_SECONDS = 48 * 60 * 60;

const Tutorials = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [timeLeft, setTimeLeft] = useState({ days: 2, hours: 0, minutes: 0, seconds: 0 });
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [resetTick, setResetTick] = useState(0);

  const isExpired =
    timeLeft.days === 0 && timeLeft.hours === 0 && timeLeft.minutes === 0 && timeLeft.seconds === 0;

  useEffect(() => {
    let startTime = localStorage.getItem(STORAGE_KEY);
    if (!startTime) {
      startTime = Date.now().toString();
      localStorage.setItem(STORAGE_KEY, startTime);
    }

    const updateCountdown = () => {
      const start = parseInt(localStorage.getItem(STORAGE_KEY) || startTime!);
      const elapsed = Date.now() - start;
      const totalSeconds = Math.max(0, COUNTDOWN_SECONDS - Math.floor(elapsed / 1000));
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setTimeLeft({ days, hours, minutes, seconds });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [resetTick]);

  const handleUnlockSubmit = async () => {
    if (!passwordInput.trim()) return;
    setIsUnlocking(true);
    try {
      const res = await fetch(`${api.getApiUrl()}/api/tutorials/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput.trim() }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        toast.error(language === 'th' ? 'รหัสไม่ถูกต้อง' : 'Invalid password');
        return;
      }
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
      setResetTick((n) => n + 1);
      setUnlockOpen(false);
      setPasswordInput('');
      toast.success(language === 'th' ? 'ปลดล็อค! เพิ่มเวลา 2 วัน' : 'Unlocked! +2 days');
    } catch (err: any) {
      toast.error(err?.message || (language === 'th' ? 'เกิดข้อผิดพลาด' : 'Error'));
    } finally {
      setIsUnlocking(false);
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
              <div className="h-8 w-8 rounded-[10px] flex items-center justify-center shadow-lg" style={{ background: 'radial-gradient(circle farthest-corner at 35% 90%, #fec564, transparent 50%), radial-gradient(circle farthest-corner at 0 140%, #fec564, transparent 50%), radial-gradient(ellipse farthest-corner at 0 -25%, #5258cf, transparent 50%), radial-gradient(ellipse farthest-corner at 20% -50%, #5258cf, transparent 50%), radial-gradient(ellipse farthest-corner at 100% 0, #893dc2, transparent 50%), radial-gradient(ellipse farthest-corner at 60% -20%, #893dc2, transparent 50%), radial-gradient(ellipse farthest-corner at 100% 100%, #d9317a, transparent), linear-gradient(#6559ca, #bc318f 30%, #e33f5f 50%, #f77638 70%, #fec66d 100%)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13 2L4.5 13.5H11.5L11 22L19.5 10.5H12.5L13 2Z" fill="#FFD700" stroke="#FFD700" strokeWidth="0.5" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className="text-base font-bold">Triple Viral</span>
            </div>
          </div>
          <Button onClick={() => navigate('/register')} className="gap-2" size="sm">
            {language === 'th' ? 'สมัครเลย' : 'Sign Up'}
          </Button>
        </div>
      </nav>

      {/* Content */}
      <div className="container px-4 md:px-6 pt-[30px] pb-16 max-w-4xl mx-auto">
        {/* Hero Image */}
        <div className="mb-10">
          <img
            src="/ChatGPT Image Apr 24, 2026, 12_03_53 PM.png"
            alt="Triple Viral Course"
            className="w-full rounded-2xl"
          />
        </div>

        {/* Countdown Banner */}
        <div className="glass-card rounded-2xl p-6 md:p-8 mb-10 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">
            {language === 'th' ? 'ดูให้จบก่อนหมดเวลา!' : 'Watch before time runs out!'}
          </h2>
          <div className="flex items-center justify-center gap-3 md:gap-5">
            {[
              { value: timeLeft.days, label: language === 'th' ? 'วัน' : 'DAYS' },
              { value: timeLeft.hours, label: language === 'th' ? 'ชั่วโมง' : 'HOURS' },
              { value: timeLeft.minutes, label: language === 'th' ? 'นาที' : 'MINUTES' },
              { value: timeLeft.seconds, label: language === 'th' ? 'วินาที' : 'SECONDS' },
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <span className="text-[10px] md:text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                  {item.label}
                </span>
                <div className="relative w-16 h-20 md:w-[88px] md:h-[104px] rounded-lg overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                  {/* Card background */}
                  <div className="absolute inset-0 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg" />
                  {/* Center divider line */}
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-px h-px bg-[#1a1a1a] z-10" />
                  <div className="absolute left-0 right-0 top-1/2 translate-y-px h-px bg-[#3a3a3a]/30 z-10" />
                  {/* Number */}
                  <div className="relative z-[5] flex items-center justify-center h-full font-mono text-3xl md:text-5xl font-bold text-white">
                    {String(item.value).padStart(2, '0')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* YouTube Video 1 */}
        <div className="glass-card rounded-2xl p-4 mb-6 ">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Play className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-base md:text-lg font-semibold text-white">
              {language === 'th' ? 'บทเรียนที่ 1 - ความลับและเทคนิคการสร้างเงินล้าน ด้วย Facebook Reels' : 'Lesson 1 - Secrets & Techniques to Make Millions with Facebook Reels'}
            </h3>
          </div>
          <div className="aspect-video rounded-xl overflow-hidden relative">
            {isExpired ? (
              <div
                onClick={() => setUnlockOpen(true)}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-md text-white z-10 cursor-pointer"
              >
                <div className="h-14 w-14 rounded-full bg-white/10 flex items-center justify-center">
                  <Lock className="h-7 w-7" />
                </div>
                <p className="text-base md:text-lg font-semibold">
                  {language === 'th' ? 'หมดเวลาเรียนแล้วค่ะ' : 'Study time has expired'}
                </p>
                <p className="text-sm text-zinc-400">
                  {language === 'th' ? '(ท่านมีเวลาเรียน 48 ชม.)' : '(You have 48 hours of study time)'}
                </p>
              </div>
            ) : (
              <iframe
                src="https://www.youtube.com/embed/tm7lfySa6cM"
                title="Triple Viral Tutorial"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            )}
          </div>
        </div>

        {/* YouTube Video 2 */}
        <div className="glass-card rounded-2xl p-4 mb-6 ">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Play className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-base md:text-lg font-semibold text-white">
              {language === 'th' ? 'บทเรียนที่ 2 - โปรแกรมโกงการสร้างคลิปแบบ AutoMation' : 'Lesson 2 - Cheat Program for Automated Clip Creation'}
            </h3>
          </div>
          <div className="aspect-video rounded-xl overflow-hidden relative">
            {isExpired ? (
              <div
                onClick={() => setUnlockOpen(true)}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-md text-white z-10 cursor-pointer"
              >
                <div className="h-14 w-14 rounded-full bg-white/10 flex items-center justify-center">
                  <Lock className="h-7 w-7" />
                </div>
                <p className="text-base md:text-lg font-semibold">
                  {language === 'th' ? 'หมดเวลาเรียนแล้วค่ะ' : 'Study time has expired'}
                </p>
                <p className="text-sm text-zinc-400">
                  {language === 'th' ? '(ท่านมีเวลาเรียน 48 ชม.)' : '(You have 48 hours of study time)'}
                </p>
              </div>
            ) : (
              <iframe
                src="https://www.youtube.com/embed/q9d9Bp1Fyp8"
                title="Triple Viral Tutorial 2"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            )}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-12">
          <button
            onClick={() => navigate('/register')}
            className="relative inline-flex items-center gap-3 text-xl font-bold px-12 py-5 rounded-full text-black overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-[0_0_40px_rgba(255,179,0,0.5)] active:scale-95 group"
            style={{ background: 'linear-gradient(135deg, #FFD700 0%, #FFB300 50%, #FF9800 100%)' }}
          >
            <span className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 rounded-full" />
            <span className="relative z-10 flex items-center gap-3">
              {language === 'th' ? 'สมัครใช้งาน' : 'Sign Up'}
              <ArrowLeft className="h-6 w-6 rotate-180 group-hover:translate-x-1 transition-transform" />
            </span>
          </button>
          <p className="text-sm text-zinc-500 mt-3">{language === 'th' ? 'เริ่มสร้างรายได้จากคลิป AI วันนี้' : 'Start earning from AI clips today'}</p>
        </div>

        {/* Bottom Banner */}
        <div className="mt-10">
          <img
            src="/ChatGPT Image Apr 24, 2026, 01_00_22 PM.png"
            alt="Triple Viral Banner"
            className="w-full rounded-2xl"
          />
        </div>

        {/* Bottom Banner 2 */}
        <div className="mt-6">
          <img
            src="/ChatGPT Image Apr 24, 2026, 01_26_41 PM.png"
            alt="Triple Viral Banner 2"
            className="w-full rounded-2xl"
          />
        </div>

        {/* YouTube Video 3 - Idol Template Guide */}
        <div className="glass-card rounded-2xl p-4 mb-6 mt-10">
          <div className="flex items-center gap-2 mb-3 px-2">
            <span className="px-3 py-1 rounded-full text-xs font-bold text-black" style={{ background: 'linear-gradient(135deg, #FFD700, #FF9800)' }}>NEW</span>
            <span className="px-3 py-1 rounded-full text-xs font-bold text-white border border-white/20 bg-white/10">อัพเดทล่าสุด</span>
          </div>
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Play className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-base md:text-lg font-semibold text-white">
              {language === 'th' ? 'คู่มือการใช้งาน Idol Template' : 'Idol Template User Guide'}
            </h3>
          </div>
          <div className="aspect-video rounded-xl overflow-hidden relative">
            <iframe
              src="https://www.youtube.com/embed/uXiK24GiadU"
              title="Idol Template Guide"
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>

        {/* Bottom CTA 2 */}
        <div className="text-center mt-12">
          <button
            onClick={() => navigate('/register')}
            className="relative inline-flex items-center gap-3 text-xl font-bold px-12 py-5 rounded-full text-black overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-[0_0_40px_rgba(255,179,0,0.5)] active:scale-95 group"
            style={{ background: 'linear-gradient(135deg, #FFD700 0%, #FFB300 50%, #FF9800 100%)' }}
          >
            <span className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 rounded-full" />
            <span className="relative z-10 flex items-center gap-3">
              {language === 'th' ? 'สมัครใช้งาน' : 'Sign Up'}
              <ArrowLeft className="h-6 w-6 rotate-180 group-hover:translate-x-1 transition-transform" />
            </span>
          </button>
          <p className="text-sm text-zinc-500 mt-3">{language === 'th' ? 'เริ่มสร้างรายได้จากคลิป AI วันนี้' : 'Start earning from AI clips today'}</p>
        </div>
      </div>

      <AlertDialog open={unlockOpen} onOpenChange={(o) => { setUnlockOpen(o); if (!o) setPasswordInput(''); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'th' ? 'ใส่รหัสผ่านเพื่อปลดล็อควิดีโอ' : 'Enter password to unlock videos'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'th'
                ? 'รหัสสามารถขอได้จาก Admin'
                : 'Request the password from Admin.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isUnlocking) handleUnlockSubmit(); }}
            placeholder={language === 'th' ? 'รหัสผ่าน' : 'Password'}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnlocking}>
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleUnlockSubmit(); }}
              disabled={isUnlocking || !passwordInput.trim()}
            >
              {isUnlocking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {language === 'th' ? 'ปลดล็อค' : 'Unlock'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>

    {/* Floating CTA Button - outside page-wrapper to avoid z-index issues */}
    <div className="fixed bottom-6 left-0 right-0 z-[9999] flex justify-center pointer-events-none">
      <button
        onClick={() => navigate('/register')}
        className="pointer-events-auto relative inline-flex items-center gap-3 text-lg font-bold px-10 py-4 rounded-full text-black overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-[0_0_40px_rgba(255,179,0,0.5)] active:scale-95 group shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
        style={{ background: 'linear-gradient(135deg, #FFD700 0%, #FFB300 50%, #FF9800 100%)' }}
      >
        <span className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 rounded-full" />
        <span className="relative z-10 flex items-center gap-3">
          {language === 'th' ? 'สมัครใช้งาน' : 'Sign Up'}
          <ArrowLeft className="h-5 w-5 rotate-180 group-hover:translate-x-1 transition-transform" />
        </span>
      </button>
    </div>
    </>
  );
};

export default Tutorials;
