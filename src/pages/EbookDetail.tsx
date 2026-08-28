import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type EbookDto } from '@/lib/api';
import PublicHeader from '@/components/PublicHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, BookMarked, BookOpen, Crown, Download, Loader2 } from 'lucide-react';

// หน้ารายละเอียด Ebook /ebooks/:slug — ปก + คำอธิบาย + ปุ่มดาวน์โหลด/อ่านในเว็บ
// สิทธิ์การเข้าถึงจริง (สมาชิกเท่านั้น / ห้ามดาวน์โหลด) มาจาก server เสมอ —
// ปุ่มที่เห็นแค่สะท้อนสิทธิ์นั้น ไม่ใช่ตัวตัดสินเอง
const EbookDetail = () => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [ebook, setEbook] = useState<EbookDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showReader, setShowReader] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setShowReader(false);
    setAccessToken(null);
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

  const locked = !!ebook && ebook.members_only && ebook.entitled === false;

  // Members-only files need a short-lived, single-ebook-scoped token — a
  // plain <a>/<iframe> can't send the app's session Authorization header,
  // and embedding the long-lived session token itself would leak it into
  // browser download history. Non-members-only ebooks never need this.
  useEffect(() => {
    if (!ebook || !ebook.members_only || locked) {
      setAccessToken(null);
      return;
    }
    let cancelled = false;
    api
      .getEbookAccessToken(ebook.slug)
      .then((r) => {
        if (!cancelled) setAccessToken(r.token);
      })
      .catch(() => {
        if (!cancelled) setAccessToken(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ebook, locked]);

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

  const hasFile = !!ebook.has_file;
  const tokenReady = !ebook.members_only || !!accessToken;
  const waitingForAccess = !locked && hasFile && !tokenReady;
  const canDownload = !locked && hasFile && ebook.allow_download && tokenReady;
  const canView = !locked && hasFile && ebook.is_pdf && tokenReady;
  const downloadHref = canDownload ? api.ebookFileUrl(ebook.slug, 'download', accessToken || undefined) : '';
  const viewHref = canView ? api.ebookFileUrl(ebook.slug, 'view', accessToken || undefined) : '';

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
              <div className="flex flex-wrap gap-2 mb-4">
                {ebook.members_only ? (
                  <Badge className="bg-[#FFB300]/15 text-[#FFB300] border border-[#FFB300]/30">
                    <Crown className="h-3.5 w-3.5 mr-1" /> {locked ? 'สำหรับสมาชิกเท่านั้น' : 'สิทธิพิเศษสมาชิก'}
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <Download className="h-3.5 w-3.5 mr-1" /> ดาวน์โหลดฟรี ไม่ต้องเป็นสมาชิก
                  </Badge>
                )}
                {!locked && hasFile && !ebook.allow_download && (
                  <Badge variant="secondary">อ่านอย่างเดียว ดาวน์โหลดไม่ได้</Badge>
                )}
              </div>

              <h1 className="text-2xl font-bold text-white leading-tight mb-3">{ebook.title}</h1>

              {ebook.description && (
                <p className="text-gray-300 text-sm leading-relaxed mb-6 whitespace-pre-line">{ebook.description}</p>
              )}

              <div className="mt-auto">
                {locked ? (
                  <div className="rounded-xl border border-[#FFB300]/30 bg-[#FFB300]/5 p-4 text-center space-y-3">
                    <p className="text-sm text-yellow-200/90">
                      <Crown className="inline h-4 w-4 mr-1.5 text-[#FFB300]" />
                      Ebook เล่มนี้สำหรับสมาชิกรายเดือน/รายปีเท่านั้น
                    </p>
                    <Button onClick={() => navigate('/pricing')} className="bg-purple-600 hover:bg-purple-700">
                      ดูแพ็กเกจสมาชิก
                      <ArrowRight className="h-4 w-4 ml-1.5" />
                    </Button>
                  </div>
                ) : !hasFile ? (
                  <Button disabled className="flex-1 basis-48 h-11 bg-purple-600 disabled:opacity-60">
                    <Download className="h-4 w-4 mr-2" />
                    ยังไม่มีไฟล์ให้เข้าถึง
                  </Button>
                ) : waitingForAccess ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 h-11">
                    <Loader2 className="h-4 w-4 animate-spin" /> กำลังตรวจสอบสิทธิ์...
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {canDownload && (
                      <Button asChild className="flex-1 basis-48 h-11 bg-purple-600 hover:bg-purple-700">
                        <a href={downloadHref} download>
                          <Download className="h-4 w-4 mr-2" />
                          ดาวน์โหลด Ebook
                        </a>
                      </Button>
                    )}
                    {canView && (
                      <Button
                        variant="outline"
                        className="flex-1 basis-48 h-11 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                        onClick={() => setShowReader((v) => !v)}
                      >
                        <BookOpen className="h-4 w-4 mr-2" />
                        {showReader ? 'ซ่อนตัวอ่าน' : 'อ่านในเว็บ'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {showReader && canView && (
            <div className="border-t border-gray-800 bg-[#0d0d14]">
              {/* #toolbar=0 hides the browser's own PDF viewer chrome (incl. its
                  built-in Download/Print buttons) — a UI-level deterrent only,
                  not real DRM (Ctrl+S / dev tools still work), but removes the
                  obvious one-click download affordance from the reader itself. */}
              <iframe src={`${viewHref}#toolbar=0`} title={`อ่าน ${ebook.title}`} className="w-full h-[80vh] bg-white" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EbookDetail;
