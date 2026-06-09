import { useNavigate } from 'react-router-dom';
import PublicHeader from '@/components/PublicHeader';
import Courses from '@/pages/Courses';
import { Button } from '@/components/ui/button';
import { PRICING } from '@/lib/pricing';
import { GraduationCap, PlayCircle, Lock, Sparkles } from 'lucide-react';

// Public landing / storefront (no login required). Hero + membership pitch,
// then the full course grid pointing at public detail pages.
const Storefront = () => {
  const navigate = useNavigate();

  const scrollToCourses = () => {
    document.getElementById('courses')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-600/10 via-fuchsia-500/5 to-transparent" />
        <div className="relative max-w-5xl mx-auto px-4 py-20 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-300 text-xs mb-5">
            <Sparkles className="h-3.5 w-3.5" />
            เรียนได้ทุกคอร์สด้วยสมาชิกเดียว
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-5">
            <GraduationCap className="inline-block h-10 w-10 md:h-14 md:w-14 text-purple-400 mb-2 mr-2" />
            <span className="bg-gradient-to-r from-purple-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
              คอร์สเรียนออนไลน์
            </span>
          </h1>
          <p className="text-gray-300 text-base md:text-lg max-w-2xl mx-auto mb-8">
            ดูบทเรียนตัวอย่างได้ฟรีโดยไม่ต้องสมัคร — เป็นสมาชิกเพื่อปลดล็อกทุกคอร์ส ทุกบทเรียน
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" onClick={scrollToCourses} className="bg-purple-600 hover:bg-purple-700">
              <PlayCircle className="h-5 w-5 mr-2" />
              ดูคอร์สทั้งหมด
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/subscription/transfer-v2')} className="border-purple-500/40">
              <Lock className="h-5 w-5 mr-2" />
              สมัครสมาชิก
            </Button>
          </div>

          {/* Pricing strip */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4 text-sm">
            <div className="px-4 py-2 rounded-xl border border-border/60 bg-card/50">
              <span className="text-gray-400">รายเดือน </span>
              <span className="text-white font-bold">฿{PRICING.monthly.subtotal.toLocaleString()}</span>
              <span className="text-gray-500 text-xs"> +VAT</span>
            </div>
            <div className="px-4 py-2 rounded-xl border border-purple-500/40 bg-purple-500/10">
              <span className="text-gray-400">รายปี </span>
              <span className="text-white font-bold">฿{PRICING.yearly.subtotal.toLocaleString()}</span>
              <span className="text-gray-500 text-xs"> +VAT</span>
              <span className="ml-2 text-green-400 text-xs font-medium">คุ้มกว่า</span>
            </div>
          </div>
        </div>
      </section>

      {/* Courses */}
      <section id="courses" className="px-4 pb-20">
        <Courses basePath="/courses" />
      </section>
    </div>
  );
};

export default Storefront;
