import PublicHeader from '@/components/PublicHeader';
import Courses from '@/pages/Courses';
import { Button } from '@/components/ui/button';
import { GraduationCap, PlayCircle, Sparkles } from 'lucide-react';

// Public landing / storefront (no login required). Hero + per-course pitch,
// then the full course grid pointing at public detail pages.
const Storefront = () => {
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
            คอร์สออนไลน์คุณภาพ เลือกซื้อเป็นรายคอร์ส
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-5">
            <GraduationCap className="inline-block h-10 w-10 md:h-14 md:w-14 text-purple-400 mb-2 mr-2" />
            <span className="bg-gradient-to-r from-purple-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
              คอร์สเรียนออนไลน์
            </span>
          </h1>
          <p className="text-gray-300 text-base md:text-lg max-w-2xl mx-auto mb-8">
            ดูบทเรียนตัวอย่างได้ฟรี — เลือกซื้อเฉพาะคอร์สที่สนใจ ปลดล็อกแล้วเรียนได้ตลอด
          </p>
          <div className="flex items-center justify-center">
            <Button size="lg" onClick={scrollToCourses} className="bg-purple-600 hover:bg-purple-700">
              <PlayCircle className="h-5 w-5 mr-2" />
              ดูคอร์สทั้งหมด
            </Button>
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
