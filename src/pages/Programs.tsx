import { useNavigate } from 'react-router-dom';
import PublicHeader from '@/components/PublicHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ProgramCard from '@/components/programs/ProgramCard';
import { PROGRAMS } from '@/components/programs/programsData';
import { Crown, ArrowRight } from 'lucide-react';

// คลังโปรแกรมสำหรับสมาชิก — วางเลย์เอาต์ชุดเดียวกับหน้า /courses
// (full-bleed px-12, หัวข้อชิดซ้าย, ตะแกรง 2/3/4 คอลัมน์) กดการ์ดเข้าหน้ารายละเอียด
const Programs = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <PublicHeader />

      {/* Top bar: title + member badge */}
      <div className="px-4 md:px-12 pt-8 pb-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-2xl md:text-3xl font-bold">Program สำหรับสมาชิก</h1>
          <p className="text-gray-400 text-sm mt-1">
            แอปและเครื่องมือพิเศษ ดาวน์โหลดใช้ได้ฟรีสำหรับสมาชิก Triple School
          </p>
        </div>
        <Badge className="self-start sm:self-auto bg-[#FFB300]/15 text-[#FFB300] border border-[#FFB300]/30 shrink-0">
          <Crown className="h-3.5 w-3.5 mr-1" /> สิทธิพิเศษสมาชิกรายเดือน / รายปี
        </Badge>
      </div>

      <div className="px-4 md:px-12 pb-16">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-base md:text-lg font-semibold flex-1">โปรแกรมทั้งหมด</h2>
          <span className="text-gray-400 text-sm whitespace-nowrap">{PROGRAMS.length} โปรแกรม</span>
        </div>

        {/* Program cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {PROGRAMS.map((program) => (
            <ProgramCard key={program.slug} program={program} />
          ))}
        </div>

        {/* Member gate strip */}
        <div className="mt-8 rounded-2xl border border-gray-800 bg-[#FFB300]/5 px-6 py-4 flex flex-col sm:flex-row items-center gap-3">
          <p className="flex-1 text-sm text-yellow-200/90 text-center sm:text-left">
            <Crown className="inline h-4 w-4 mr-1.5 text-[#FFB300]" />
            โปรแกรมเหล่านี้แจกเฉพาะสมาชิกรายเดือนและรายปีเท่านั้น — สมัครวันนี้ เข้าเรียนได้ทุกคอร์สพร้อมรับโปรแกรมฟรี
          </p>
          <Button size="sm" onClick={() => navigate('/pricing')} className="bg-purple-600 hover:bg-purple-700 shrink-0">
            ดูแพ็กเกจสมาชิก
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Programs;
