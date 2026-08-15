import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PublicHeader from '@/components/PublicHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ProgramVideo from '@/components/programs/ProgramVideo';
import { getProgram, isDirectFileUrl } from '@/components/programs/programsData';
import { Crown, ArrowRight, ArrowLeft, CheckCircle2, Download } from 'lucide-react';

// หน้ารายละเอียดโปรแกรม /programs/:slug — ภาพ + ฟีเจอร์ + ปุ่มดาวน์โหลด
const ProgramDetail = () => {
  const navigate = useNavigate();
  const { slug } = useParams();
  const program = getProgram(slug);

  // เข้ามาจากการ์ดกลางหน้า /programs ถ้าไม่รีเซ็ต จะเปิดหน้าใหม่ค้างอยู่ตรงกลางหน้า
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!program) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader />
        <div className="max-w-6xl mx-auto px-4 py-24 text-center space-y-4">
          <p className="text-gray-400">ไม่พบโปรแกรมที่ต้องการ</p>
          <Button onClick={() => navigate('/programs')} className="bg-purple-600 hover:bg-purple-700">
            กลับไปหน้า Program
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      <div className="max-w-6xl mx-auto px-4 md:px-12 pt-6 pb-16">
        <Link
          to="/programs"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-5"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับไปหน้า Program
        </Link>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden">
          <div className="grid lg:grid-cols-2 gap-0">
            {/* Media — วิดีโอเป็นสื่อหลัก ภาพหน้าจอลดชั้นลงเป็นแถวย่อยด้านล่าง */}
            <div className="relative bg-[#0d0d14] p-4 lg:p-6 flex flex-col justify-center gap-3">
              <ProgramVideo
                url={program.videoUrl}
                title={`วิดีโอตัวอย่าง ${program.name}`}
                poster={program.thumbnail}
              />

              <div className="grid grid-cols-2 gap-3">
                {program.screenshots.map((shot) => (
                  <img
                    key={shot.src}
                    src={shot.src}
                    alt={shot.alt}
                    loading="lazy"
                    className="w-full aspect-video rounded-lg border border-gray-800 object-cover object-top opacity-90 hover:opacity-100 transition-opacity"
                  />
                ))}
              </div>
            </div>

            {/* Info — min-w-0 กัน grid column ถูกดันกว้างตามเนื้อหาที่ไม่ยอมหด */}
            <div className="p-6 lg:p-8 flex flex-col min-w-0">
              <Badge className="self-start bg-[#FFB300]/15 text-[#FFB300] border border-[#FFB300]/30 mb-4">
                <Crown className="h-3.5 w-3.5 mr-1" /> สิทธิพิเศษสมาชิก
              </Badge>

              <div className="flex items-center gap-3 mb-3">
                <img src={program.logo} alt="" className="h-12 w-auto" />
                <div>
                  <h1 className="text-2xl font-bold text-white leading-tight">{program.name}</h1>
                  <p className="text-gray-500 text-xs">
                    {program.tagline} · {program.version}
                  </p>
                </div>
              </div>

              <p className="text-gray-300 text-sm leading-relaxed mb-5">{program.summary}</p>

              <ul className="space-y-3 mb-6">
                {program.features.map((f) => (
                  <li key={f.text} className="flex items-start gap-2.5 text-sm text-gray-300">
                    <f.icon className="h-4 w-4 text-[#FFB300] mt-0.5 shrink-0" />
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>

              {/* Download buttons */}
              <div className="mt-auto">
                {/* flex-wrap + basis: ปุ่มยืดเต็มแถวเองเมื่อพื้นที่ไม่พอ แทนที่จะล้นออกนอกการ์ด
                    (ข้อความในปุ่มเป็น whitespace-nowrap จึงหดตามคอลัมน์ไม่ได้) */}
                <div className="flex flex-wrap gap-3">
                  {program.downloads.map((d) =>
                    d.url ? (
                      <Button
                        key={d.key}
                        asChild
                        className="flex-1 basis-48 h-11 bg-purple-600 hover:bg-purple-700"
                      >
                        {isDirectFileUrl(d.url) ? (
                          // ลิงก์ไฟล์ตรง: กดแล้วดาวน์โหลดทันที ไม่เด้งออกจากหน้าเว็บ
                          <a href={d.url} download>
                            <d.icon className="h-4 w-4 mr-2" />
                            {d.label}
                            <Download className="h-4 w-4 ml-2" />
                          </a>
                        ) : (
                          // ลิงก์หน้าเว็บฝากไฟล์ (MediaFire): ต้องเปิดแท็บใหม่ ไม่งั้นผู้ใช้
                          // จะถูกพาออกจากเว็บเราไปเลย — หน้าตาปุ่มเหมือนกันทุกอย่าง
                          <a href={d.url} target="_blank" rel="noopener noreferrer">
                            <d.icon className="h-4 w-4 mr-2" />
                            {d.label}
                            <Download className="h-4 w-4 ml-2" />
                          </a>
                        )}
                      </Button>
                    ) : (
                      <Button
                        key={d.key}
                        disabled
                        className="flex-1 basis-48 h-11 bg-purple-600 disabled:opacity-60"
                      >
                        <d.icon className="h-4 w-4 mr-2" />
                        {d.label}
                        <Download className="h-4 w-4 ml-2" />
                      </Button>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Member gate strip */}
          <div className="border-t border-gray-800 bg-[#FFB300]/5 px-6 py-4 flex flex-col sm:flex-row items-center gap-3">
            <p className="flex-1 text-sm text-yellow-200/90 text-center sm:text-left">
              <Crown className="inline h-4 w-4 mr-1.5 text-[#FFB300]" />
              โปรแกรมนี้แจกเฉพาะสมาชิกรายเดือนและรายปีเท่านั้น — สมัครวันนี้ เข้าเรียนได้ทุกคอร์สพร้อมรับโปรแกรมฟรี
            </p>
            <Button size="sm" onClick={() => navigate('/pricing')} className="bg-purple-600 hover:bg-purple-700 shrink-0">
              ดูแพ็กเกจสมาชิก
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>

        {/* Highlights row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          {program.highlights.map((h) => (
            <div key={h.label} className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 text-center">
              <p className="text-sm font-semibold text-white flex items-center justify-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-400" /> {h.label}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{h.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProgramDetail;
