import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type EbookDto } from '@/lib/api';
import PublicHeader from '@/components/PublicHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, BookMarked, Download, Loader2 } from 'lucide-react';

// หน้ารายละเอียด Ebook /ebooks/:slug — ปก + คำอธิบาย + ปุ่มดาวน์โหลด
// (จังหวะเดียวกับ ProgramDetail แต่ตัดวิดีโอ/สกรีนช็อต/ฟีเจอร์/แถบชวนสมัครสมาชิกออก
// เพราะ Ebook ดาวน์โหลดได้ฟรีทุกคน ไม่ต้องล็อกอิน)
const EbookDetail = () => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [ebook, setEbook] = useState<EbookDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    window.scrollTo(0, 0);
    (async () => {
      try {
        const e = await api.getEbook(slug);
        if (!cancelled) setEbook(e);
      } catch (err) {
        console.error('Failed to load ebook:', err);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (notFound || !ebook) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader />
        <div className="max-w-6xl mx-auto px-4 py-24 text-center space-y-4">
          <p className="text-gray-400">ไม่พบ Ebook ที่ต้องการ</p>
          <Button onClick={() => navigate('/ebooks')} className="bg-purple-600 hover:bg-purple-700">
            กลับไปหน้า Ebook
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
          to="/ebooks"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-5"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับไปหน้า Ebook
        </Link>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden">
          <div className="grid lg:grid-cols-2 gap-0">
            {/* Cover */}
            <div className="relative bg-[#0d0d14] p-4 lg:p-6 flex items-center justify-center">
              {ebook.cover_url ? (
                <img
                  src={api.mediaUrl(ebook.cover_url, 'hero')}
                  alt={ebook.title}
                  className="w-full aspect-video rounded-lg border border-gray-800 object-cover"
                />
              ) : (
                <div className="w-full aspect-video rounded-lg border border-dashed border-gray-800 flex items-center justify-center">
                  <BookMarked className="h-12 w-12 text-gray-600" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="p-6 lg:p-8 flex flex-col min-w-0">
              <Badge className="self-start bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 mb-4">
                <Download className="h-3.5 w-3.5 mr-1" /> ดาวน์โหลดฟรี ไม่ต้องเป็นสมาชิก
              </Badge>

              <h1 className="text-2xl font-bold text-white leading-tight mb-3">{ebook.title}</h1>

              {ebook.description && (
                <p className="text-gray-300 text-sm leading-relaxed mb-6 whitespace-pre-line">{ebook.description}</p>
              )}

              <div className="mt-auto">
                {ebook.file_url ? (
                  <Button asChild className="w-full sm:w-auto h-11 bg-purple-600 hover:bg-purple-700">
                    <a href={api.mediaUrl(ebook.file_url)} download>
                      <Download className="h-4 w-4 mr-2" />
                      ดาวน์โหลด Ebook
                    </a>
                  </Button>
                ) : (
                  <Button disabled className="w-full sm:w-auto h-11 bg-purple-600 disabled:opacity-60">
                    <Download className="h-4 w-4 mr-2" />
                    ยังไม่มีไฟล์ให้ดาวน์โหลด
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EbookDetail;
