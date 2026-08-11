import { useNavigate } from 'react-router-dom';
import PublicHeader from '@/components/PublicHeader';
import { Button } from '@/components/ui/button';
import { AppWindow, Crown, ArrowRight } from 'lucide-react';

// Placeholder: member-only apps/tools ("Program") — coming soon.
const Programs = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-[#FFB300]/15 mb-6">
          <AppWindow className="h-10 w-10 text-[#FFB300]" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold mb-3">Program สำหรับสมาชิก</h1>
        <p className="text-gray-400 mb-2">
          แอปและเครื่องมือพิเศษ แจกให้เฉพาะสมาชิกรายเดือนและรายปี
        </p>
        <p className="text-2xl font-semibold text-[#FFB300] mb-8">เร็วๆ นี้ 🚧</p>
        <Button
          size="lg"
          onClick={() => navigate('/pricing')}
          className="bg-purple-600 hover:bg-purple-700 h-11 px-6"
        >
          <Crown className="h-5 w-5 mr-2" />
          ดูแพ็กเกจสมาชิก
          <ArrowRight className="h-4 w-4 ml-1.5" />
        </Button>
      </div>
    </div>
  );
};

export default Programs;
