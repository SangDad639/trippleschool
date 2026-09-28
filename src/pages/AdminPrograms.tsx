import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PROGRAMS, getProgram } from '@/components/programs/programsData';
import ProgramVideosPanel from '@/components/programs/ProgramVideosPanel';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Film } from 'lucide-react';

/**
 * /admin/programs — คลิปคู่มือของแต่ละโปรแกรมในหน้า /programs/:slug
 * ตัวโปรแกรม (ชื่อ ฟีเจอร์ ปุ่มดาวน์โหลด) ยังอยู่ใน programsData.ts — หน้านี้จัดการแค่คลิป
 * โปรแกรมที่เลือกอยู่ใน ?slug= เพื่อให้ปุ่มลัดบนหน้าโปรแกรมพามาตรงตัวได้
 */
const AdminPrograms = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const program = getProgram(searchParams.get('slug') ?? undefined) ?? PROGRAMS[0];

  if (!user?.isAdmin) {
    return (
      <div className="page-wrapper flex items-center justify-center">
        <p className="text-muted-foreground">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      {/* ชั้นเพิ่มอีกชั้น: .page-wrapper > * โดนบังคับ position: relative จน sticky ไม่ติด */}
      <div>
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
          <div className="container mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')} aria-label="ย้อนกลับ">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 truncate text-lg font-semibold">
                <Film className="h-5 w-5 shrink-0 text-[#FFB300]" />
                คลิปโปรแกรม
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                ใส่คลิปสอนใช้งานให้แต่ละโปรแกรม — เรียงลำดับได้ แก้แล้วขึ้นทันที
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`/programs/${program.slug}`, '_blank')}
              className="shrink-0 gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" /> ดูหน้าจริง
            </Button>
          </div>
        </div>

        <div className="container mx-auto max-w-5xl px-4 py-6">
          {/* เลือกโปรแกรม — มีไม่กี่ตัว ใช้ปุ่มแถวเดียวพอ */}
          <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="เลือกโปรแกรม">
            {PROGRAMS.map((p) => {
              const isSelected = p.slug === program.slug;
              return (
                <button
                  key={p.slug}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSearchParams({ slug: p.slug }, { replace: true })}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    isSelected
                      ? 'border-[#FFB300]/60 bg-[#FFB300]/10 text-foreground'
                      : 'border-border text-muted-foreground hover:border-gray-600 hover:text-foreground'
                  }`}
                >
                  <img src={p.logo} alt="" className="h-5 w-auto" />
                  {p.name}
                </button>
              );
            })}
          </div>

          <ProgramVideosPanel key={program.slug} program={program} />
        </div>
      </div>
    </div>
  );
};

export default AdminPrograms;
