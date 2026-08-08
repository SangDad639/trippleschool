import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PublicHeader from '@/components/PublicHeader';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { PRICING, VAT_RATE } from '@/lib/pricing';
import { baseFeatures, yearlyBonusFeatures, type FeatureItem } from '@/lib/planFeatures';
import { Calendar, Crown, Check, Sparkles, ArrowRight } from 'lucide-react';

type ApiPlan = Awaited<ReturnType<typeof api.getSubscriptionPlans>>['plans'][number];

type PricingCard = {
  slug: string;
  name: string;
  subtotal: number;
  total: number;
  originalPrice: number; // pre-discount (subtotal × 2), shown struck-through
  period: string;
  description: string;
  features: FeatureItem[];
  popular: boolean;
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// Build cards from live API plans (public, already ordered by display_order).
// The longest-duration plan (yearly) is flagged as "popular / best value".
function buildFromApi(apiPlans: ApiPlan[]): PricingCard[] {
  const longestDays = apiPlans.length ? Math.max(...apiPlans.map((p) => p.days)) : 0;
  return apiPlans.map((p) => {
    const popular = p.days === longestDays && apiPlans.length > 1;
    return {
      slug: p.slug,
      name: p.name_th || p.name,
      subtotal: p.subtotal,
      total: p.total,
      originalPrice: p.subtotal * 2,
      period: p.days === 30 ? '/เดือน' : p.days === 365 ? '/ปี' : `/${p.days} วัน`,
      description: p.description || '',
      features: popular ? [...baseFeatures, ...yearlyBonusFeatures] : baseFeatures,
      popular,
    };
  });
}

// Fallback when /api/subscription/plans is unreachable — mirror PRICING.
function buildFallback(): PricingCard[] {
  return [
    {
      slug: 'monthly',
      name: 'รายเดือน',
      subtotal: PRICING.monthly.subtotal,
      total: PRICING.monthly.total,
      originalPrice: PRICING.monthly.subtotal * 2,
      period: '/เดือน',
      description: 'เหมาะกับผู้เริ่มต้น',
      features: baseFeatures,
      popular: false,
    },
    {
      slug: 'yearly',
      name: 'รายปี',
      subtotal: PRICING.yearly.subtotal,
      total: PRICING.yearly.total,
      originalPrice: PRICING.yearly.subtotal * 2,
      period: '/ปี',
      description: 'คุ้มที่สุด จ่ายครั้งเดียวทั้งปี',
      features: [...baseFeatures, ...yearlyBonusFeatures],
      popular: true,
    },
  ];
}

const Pricing = () => {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PricingCard[] | null>(null);

  useEffect(() => {
    api
      .getSubscriptionPlans()
      .then((res) => setPlans(buildFromApi(res.plans)))
      .catch(() => setPlans(buildFallback()));
  }, []);

  const cards = plans ?? buildFallback();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      <div className="container mx-auto px-4 py-12 md:py-16">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-[#FFB300]/50 mb-4">
            <Sparkles className="h-4 w-4 text-[#FFB300] animate-glow-pulse" />
            <span className="text-sm text-muted-foreground">แพ็กเกจสมาชิก</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            สมัครสมาชิก{' '}
            <span className="bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] bg-clip-text text-transparent">
              เข้าเรียนได้ทุกคอร์ส
            </span>
          </h1>
          <p className="text-muted-foreground">
            เลือกแพ็กเกจที่เหมาะกับคุณ — ปลดล็อกทุกคอร์ส ทุกบทเรียน และอัปเดตเนื้อหาใหม่ตลอด
          </p>
          <div className="inline-flex items-center gap-2 mt-4 px-3 py-1 rounded-full bg-red-500/15 text-red-400 text-sm font-medium">
            🔥 โปรเปิดตัว ลด 50% ทุกแพ็กเกจ
          </div>
        </div>

        {/* Cards */}
        <div className="grid md:grid-cols-2 gap-6 md:gap-8 max-w-4xl mx-auto items-start">
          {cards.map((p) => (
            <div
              key={p.slug}
              className={`relative bg-card p-8 rounded-2xl border transition-all hover:scale-[1.02] ${
                p.popular
                  ? 'border-yellow-500/60 glow-border shadow-2xl shadow-yellow-500/20 bg-gradient-to-b from-yellow-500/5 to-transparent'
                  : 'border-border/50'
              }`}
            >
              {p.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                  <span className="px-5 py-1.5 rounded-full bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] text-black text-sm font-bold shadow-lg shadow-yellow-500/40 flex items-center gap-1.5">
                    <Crown className="h-4 w-4" /> คุ้มที่สุด
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3 mb-4">
                <div
                  className={`p-2 rounded-xl ${
                    p.popular ? 'bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500]' : 'bg-[#FFB300]/15'
                  }`}
                >
                  {p.popular ? (
                    <Crown className="h-5 w-5 text-black" />
                  ) : (
                    <Calendar className="h-5 w-5 text-[#FFB300]" />
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-bold">{p.name}</h2>
                  {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                </div>
              </div>

              <div className="flex items-baseline gap-1 flex-wrap mb-1">
                <span className="text-lg text-gray-500 line-through mr-1">฿{fmt(p.originalPrice)}</span>
                <span
                  className={`text-5xl font-bold bg-gradient-to-r ${
                    p.popular ? 'from-[#FFD700] via-[#FFB300] to-[#FFA500]' : 'from-[#FFB300] via-[#FFC233] to-[#FF9D00]'
                  } bg-clip-text text-transparent`}
                >
                  ฿{fmt(p.subtotal)}
                </span>
                <span className="text-xs text-gray-500 ml-0.5">THB</span>
                <span className="text-muted-foreground">{p.period}</span>
                <span className="ml-2 px-2 py-1 rounded-md bg-red-500/20 text-red-400 text-sm font-medium">-50%</span>
              </div>
              <p className="text-xs text-muted-foreground/70 mb-5">รวม VAT {VAT_RATE}% แล้ว ฿{fmt(p.total)}</p>

              <Button
                onClick={() => navigate(`/subscription/transfer-v2?plan=${p.slug}`)}
                className={`w-full h-12 text-base font-bold mb-6 ${
                  p.popular ? 'bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] text-black' : ''
                }`}
              >
                สมัคร{p.name}
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>

              <ul className="space-y-2">
                {p.features.map((f, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-2 text-sm ${
                      f.highlight ? 'bg-primary/10 -mx-2 px-2 py-1.5 rounded-lg border border-primary/20' : ''
                    }`}
                  >
                    <Check
                      className={`h-4 w-4 flex-shrink-0 mt-0.5 ${p.popular ? 'text-yellow-500' : 'text-green-500'}`}
                    />
                    <span>
                      <span className="font-semibold text-foreground">{f.title}</span>
                      <span className="text-muted-foreground/60 text-xs"> — {f.desc}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Coexist note — per-course purchase still available */}
        <p className="text-center text-sm text-muted-foreground mt-10">
          หรือเลือก
          <button onClick={() => navigate('/courses')} className="text-[#FFB300] hover:underline mx-1">
            ซื้อแยกเป็นรายคอร์ส
          </button>
          ได้ที่หน้าคอร์สแต่ละอัน
        </p>
      </div>
    </div>
  );
};

export default Pricing;
