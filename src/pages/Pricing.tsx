import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PublicHeader from '@/components/PublicHeader';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { PRICING } from '@/lib/pricing';
import { Calendar, Crown, Check, X, Sparkles, ArrowRight, ShoppingCart } from 'lucide-react';

type ApiPlan = Awaited<ReturnType<typeof api.getSubscriptionPlans>>['plans'][number];

interface PlanPricingInfo {
  subtotal: number;
  originalPrice: number; // pre-discount (subtotal × 2), shown struck-through
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/*
 * สิทธิ์ของแต่ละรูปแบบ — copy ตามที่เจ้าของระบบกำหนด (เฉพาะหน้านี้)
 * per-course มีทั้ง "ได้รับ" และ "ไม่ได้รับ" เพื่อกันเข้าใจผิดเรื่องสิทธิ์สมาชิก
 */
const PER_COURSE_GETS = [
  'สิทธิ์เข้าเรียนเฉพาะคอร์สที่ซื้อ',
  'ไฟล์ประกอบที่รวมอยู่ในคอร์สนั้น',
  'สิทธิ์ตามเงื่อนไขที่แจ้งไว้ในวันที่ซื้อ',
];
const PER_COURSE_NOT_GETS = [
  'คอร์สอื่นในระบบ',
  'คอร์สใหม่ที่เพิ่มภายหลัง',
  'สิทธิ์สมาชิก และโปรแกรมที่สงวนไว้สำหรับสมาชิก',
  'การเข้าถึงทุกคอร์สแบบรายเดือนหรือรายปี',
];
const MONTHLY_GETS = [
  'เข้าเรียนทุกคอร์สที่เปิดอยู่ใน Triple School ตามระยะเวลาแพ็กเกจ',
  'คอร์สพื้นฐานเครื่องมือ AI',
  'คอร์สสร้างผลงาน',
  'คอร์สใหม่ที่เพิ่มระหว่างสมาชิกยังไม่หมดอายุ',
  'เนื้อหาอัปเดตที่เปิดให้สมาชิก',
  'โปรแกรมหรือสิทธิ์อื่นตามรายละเอียดแพ็กเกจ',
];
const MONTHLY_NOTE = 'เมื่อสมาชิกหมดอายุ สิทธิ์เข้าเรียนทุกคอร์สและสิทธิ์สมาชิกจะสิ้นสุดลง';
const YEARLY_GETS = [
  'เข้าเรียนทุกคอร์สที่เปิดอยู่ใน Triple School ตลอดระยะเวลา 1 ปี',
  'คอร์สทั้งหมดที่มีอยู่ในวันที่สมัคร',
  'คอร์สใหม่ที่เพิ่มเข้ามาระหว่างสมาชิกยังไม่หมดอายุ',
  'เนื้อหาอัปเดต',
  'โปรแกรมหรือสิทธิ์สำหรับสมาชิกรายปีตามที่กำหนด',
];
const YEARLY_NOTE = 'เมื่อสมาชิกหมดอายุ ต้องต่ออายุจึงจะเข้าเรียนและใช้สิทธิ์สมาชิกต่อได้';

const Pricing = () => {
  const navigate = useNavigate();
  const [apiPlans, setApiPlans] = useState<ApiPlan[] | null>(null);

  useEffect(() => {
    api
      .getSubscriptionPlans()
      .then((res) => setApiPlans(res.plans))
      .catch(() => setApiPlans(null));
  }, []);

  // Live DB price per slug, falling back to the hardcoded PRICING constants.
  const priceFor = (slug: 'monthly' | 'yearly'): PlanPricingInfo => {
    const p = apiPlans?.find((x) => x.slug === slug);
    if (p) return { subtotal: p.subtotal, originalPrice: p.subtotal * 2 };
    const base = PRICING[slug];
    return { subtotal: base.subtotal, originalPrice: base.subtotal * 2 };
  };
  const monthly = priceFor('monthly');
  const yearly = priceFor('yearly');

  const goCheckout = (plan: 'monthly' | 'yearly') => navigate(`/subscription/transfer-v2?plan=${plan}`);

  const CheckItem = ({ text }: { text: string }) => (
    <li className="flex items-start gap-2 text-sm">
      <Check className="h-4 w-4 flex-shrink-0 mt-0.5 text-green-500" />
      <span className="text-gray-200">{text}</span>
    </li>
  );
  const CrossItem = ({ text }: { text: string }) => (
    <li className="flex items-start gap-2 text-sm">
      <X className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-400/70" />
      <span className="text-gray-500">{text}</span>
    </li>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      <div className="container mx-auto px-4 py-12 md:py-16">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-[#FFB300]/50 mb-4">
            <Sparkles className="h-4 w-4 text-[#FFB300] animate-glow-pulse" />
            <span className="text-sm text-muted-foreground">แพ็กเกจและราคา</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            เลือกรูปแบบที่เหมาะกับ
            <span className="bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] bg-clip-text text-transparent">
              คุณ
            </span>
          </h1>
          <p className="text-muted-foreground">
            Triple School มี 3 รูปแบบ — ซื้อคอร์สรายชิ้น, สมาชิกรายเดือน หรือสมาชิกรายปีเข้าเรียนได้ทุกคอร์ส
          </p>
          <div className="inline-flex items-center gap-2 mt-4 px-3 py-1 rounded-full bg-red-500/15 text-red-400 text-sm font-medium">
            🔥 สมาชิกโปรเปิดตัว ลด 50% ทุกแพ็กเกจ
          </div>
        </div>

        {/* 3 Cards */}
        <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto items-start">
          {/* ---- 1. ซื้อคอร์สรายชิ้น ---- */}
          <div className="relative bg-card p-7 rounded-2xl border border-border/50 transition-all hover:scale-[1.01]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-[#FFB300]/15">
                <ShoppingCart className="h-5 w-5 text-[#FFB300]" />
              </div>
              <div>
                <h2 className="text-xl font-bold">ซื้อคอร์สรายชิ้น</h2>
                <p className="text-xs text-muted-foreground">จ่ายครั้งเดียว เฉพาะคอร์สที่เลือก</p>
              </div>
            </div>

            <div className="mb-1">
              <span className="text-3xl font-bold bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] bg-clip-text text-transparent">
                ตามราคาแต่ละคอร์ส
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70 mb-5">ดูราคาได้ที่หน้าคอร์สแต่ละอัน</p>

            <Button
              onClick={() => navigate('/courses')}
              className="w-full h-12 text-base font-bold mb-6"
            >
              เลือกซื้อคอร์ส
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>

            <p className="text-xs font-semibold text-green-400 mb-2">✓ สิ่งที่ได้รับ</p>
            <ul className="space-y-2 mb-4">
              {PER_COURSE_GETS.map((t) => <CheckItem key={t} text={t} />)}
            </ul>
            <p className="text-xs font-semibold text-red-400/80 mb-2">✗ ไม่รวมอยู่ในสิทธิ์</p>
            <ul className="space-y-2">
              {PER_COURSE_NOT_GETS.map((t) => <CrossItem key={t} text={t} />)}
            </ul>
          </div>

          {/* ---- 2. สมาชิกรายเดือน ---- */}
          <div className="relative bg-card p-7 rounded-2xl border border-border/50 transition-all hover:scale-[1.01]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-[#FFB300]/15">
                <Calendar className="h-5 w-5 text-[#FFB300]" />
              </div>
              <div>
                <h2 className="text-xl font-bold">สมาชิกรายเดือน</h2>
                <p className="text-xs text-muted-foreground">เข้าเรียนได้ทุกคอร์สตลอดอายุสมาชิก</p>
              </div>
            </div>

            <div className="flex items-baseline gap-1 flex-wrap mb-1">
              <span className="text-lg text-gray-500 line-through mr-1">฿{fmt(monthly.originalPrice)}</span>
              <span className="text-4xl font-bold bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] bg-clip-text text-transparent">
                ฿{fmt(monthly.subtotal)}
              </span>
              <span className="text-muted-foreground">/เดือน</span>
              <span className="ml-2 px-2 py-1 rounded-md bg-red-500/20 text-red-400 text-sm font-medium">-50%</span>
            </div>

            <Button onClick={() => goCheckout('monthly')} className="w-full h-12 text-base font-bold mb-6 mt-4">
              สมัครรายเดือน
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>

            <p className="text-xs font-semibold text-green-400 mb-2">✓ สิทธิ์ที่ได้รับ</p>
            <ul className="space-y-2 mb-4">
              {MONTHLY_GETS.map((t) => <CheckItem key={t} text={t} />)}
            </ul>
            <p className="text-[11px] text-muted-foreground/70 border-t border-border pt-3">{MONTHLY_NOTE}</p>
          </div>

          {/* ---- 3. สมาชิกรายปี (Best value) ---- */}
          <div className="relative bg-card p-7 rounded-2xl border border-yellow-500/60 glow-border shadow-2xl shadow-yellow-500/20 bg-gradient-to-b from-yellow-500/5 to-transparent transition-all hover:scale-[1.01]">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
              <span className="px-5 py-1.5 rounded-full bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] text-black text-sm font-bold shadow-lg shadow-yellow-500/40 flex items-center gap-1.5">
                <Crown className="h-4 w-4" /> คุ้มที่สุด
              </span>
            </div>

            <div className="flex items-center gap-3 mb-4 mt-2">
              <div className="p-2 rounded-xl bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500]">
                <Crown className="h-5 w-5 text-black" />
              </div>
              <div>
                <h2 className="text-xl font-bold">สมาชิกรายปี</h2>
                <p className="text-xs text-muted-foreground">ทุกคอร์ส ตลอด 1 ปีเต็ม</p>
              </div>
            </div>

            <div className="flex items-baseline gap-1 flex-wrap mb-1">
              <span className="text-lg text-gray-500 line-through mr-1">฿{fmt(yearly.originalPrice)}</span>
              <span className="text-4xl font-bold bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] bg-clip-text text-transparent">
                ฿{fmt(yearly.subtotal)}
              </span>
              <span className="text-muted-foreground">/ปี</span>
              <span className="ml-2 px-2 py-1 rounded-md bg-red-500/20 text-red-400 text-sm font-medium">-50%</span>
            </div>

            <Button
              onClick={() => goCheckout('yearly')}

              className="w-full h-12 text-base font-bold mb-6 mt-4 bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] text-black"
            >
              สมัครรายปี
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>

            <p className="text-xs font-semibold text-green-400 mb-2">✓ สิทธิ์ที่ได้รับ</p>
            <ul className="space-y-2 mb-4">
              {YEARLY_GETS.map((t) => <CheckItem key={t} text={t} />)}
            </ul>
            <p className="text-[11px] text-muted-foreground/70 border-t border-border pt-3">{YEARLY_NOTE}</p>
          </div>
        </div>

        {/* เงื่อนไขสำคัญ */}
        <div className="max-w-3xl mx-auto mt-10 rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-5 py-4 text-sm text-yellow-200">
          <p className="font-semibold mb-1">📌 โปรดเลือกรูปแบบก่อนชำระเงิน</p>
          <p className="text-yellow-200/90 font-semibold">
            หากเลือกซื้อคอร์สรายชิ้นแล้ว ภายหลังต้องการเรียนหลายคอร์ส จะไม่สามารถนำยอดรายชิ้นไปหักจากค่าสมาชิกรายเดือนหรือรายปีได้
          </p>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
