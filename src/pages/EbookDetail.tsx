import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type EbookDto } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PublicHeader from '@/components/PublicHeader';
import EbookSamplesGallery from '@/components/ebooks/EbookSamplesGallery';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  BookOpen,
  Check,
  CheckCircle2,
  Crown,
  Download,
  Link2,
  Loader2,
  Lock,
  Play,
  Share2,
} from 'lucide-react';

// ตัวอ่านตัวอย่างแบบเลื่อนต่อเนื่องลาก pdf.js (~400KB) มาด้วย — โหลดเฉพาะตอนกด "อ่านตัวอย่างฟรี"
const EbookWebtoonPreview = lazy(() => import('@/components/ebooks/EbookWebtoonPreview'));

// หน้ารายละเอียด Ebook /ebooks/:slug — โครงตามดีไซน์อ้างอิง fuzionhub:
// ปกใหญ่ + ชื่อ + ผู้เขียน + ประโยคขาย (hook) + "X หน้า · อ่านออนไลน์ได้ทันที"
// + กล่อง CTA + section "ข้างในมีอะไร" (highlights)
// โหมดต่อเล่ม (เลิกขายรายเล่มแล้ว 7 ก.ย. 2026): ฟรี / สมาชิกเท่านั้น
// สิทธิ์การเข้าถึงจริงมาจาก server เสมอ — ปุ่มที่เห็นแค่สะท้อนสิทธิ์นั้น ไม่ใช่ตัวตัดสินเอง
// (entitled = อ่านได้ · can_download = ดาวน์โหลดได้ — เล่มสมาชิกโหลดได้เฉพาะสมาชิกรายปี)
const EbookDetail = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const { slug } = useParams<{ slug: string }>();
  const [ebook, setEbook] = useState<EbookDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showReader, setShowReader] = useState(false);
  // ตัวอ่าน "ตัวอย่างจำกัดหน้า" สำหรับคนยังไม่มีสิทธิ์ (ไฟล์ที่ได้มีแค่หน้าตัวอย่างจริงๆ)
  const [showPreview, setShowPreview] = useState(false);
  // เลื่อนต่อเนื่อง (ค่าเริ่มต้น) → ถ้าเรนเดอร์ไม่ได้ ตกไปใช้ iframe PDF แบบเดิม
  const [previewMode, setPreviewMode] = useState<'webtoon' | 'pdf'>('webtoon');
  const previewRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // แชร์ Ebook: ลิงก์สั้น /ebooks/{share_code} (เล่มเก่าที่ยังไม่มีรหัสตกไปใช้ slug)
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const loadEbook = useCallback(async () => {
    if (!slug) return;
    try {
      const e = await api.getEbook(slug);
      setEbook(e);
    } catch (err) {
      console.error('Failed to load ebook:', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setShowReader(false);
    setShowPreview(false);
    setPreviewMode('webtoon');
    setAccessToken(null);
    window.scrollTo(0, 0);
    void loadEbook();
  }, [loadEbook]);

  // เข้าจากลิงก์สั้น (/ebooks/{share_code}) → พอโหลดเสร็จเปลี่ยนแถบที่อยู่เป็น slug
  // ปกติ (replaceState — ไม่ให้ route param เปลี่ยนจนโหลดซ้ำ และไม่เพิ่ม history entry)
  useEffect(() => {
    if (!slug || !ebook?.slug || slug === ebook.slug) return;
    const { search, hash } = window.location;
    window.history.replaceState(window.history.state, '', `/ebooks/${encodeURIComponent(ebook.slug)}${search}${hash}`);
  }, [slug, ebook?.slug]);

  // มือถือ: ใช้ share sheet ของเครื่อง · เดสก์ท็อป: dialog คัดลอกลิงก์ (แบบเดียวกับคอร์ส)
  const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin;
  const shareUrl = ebook ? `${SITE_URL}/ebooks/${ebook.share_code || ebook.slug}` : '';

  const handleShare = async () => {
    if (!ebook) return;
    const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (isTouch && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: ebook.title, text: ebook.hook || ebook.title, url: shareUrl });
        return;
      } catch {
        /* ผู้ใช้กดยกเลิก / เบราว์เซอร์ไม่รองรับ → ตกไปใช้ dialog */
      }
    }
    setLinkCopied(false);
    setShareDialogOpen(true);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      toast.success('คัดลอกลิงก์แล้ว');
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      toast.error('คัดลอกไม่สำเร็จ');
    }
  };

  const requiresEntitlement = !!ebook && ebook.members_only;
  const entitled = ebook?.entitled === true;
  const locked = requiresEntitlement && !entitled;

  // ไฟล์ของเล่มสมาชิกต้องใช้ token สั้นๆ เฉพาะเล่ม — <a>/<iframe> ธรรมดา
  // ส่ง Authorization header ไม่ได้ และฝัง session token ยาว 7 วันลง URL จะรั่ว
  // เข้า download history ของเบราว์เซอร์ เล่มฟรีไม่ต้องใช้เลย
  useEffect(() => {
    if (!ebook || !requiresEntitlement || locked) {
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
  }, [ebook, requiresEntitlement, locked]);

  // ปุ่ม "อ่านตัวอย่าง" อยู่ใน hero เหนือตัวอ่าน → เปิดแล้วเลื่อนลงไปให้เห็นทันที
  useEffect(() => {
    if (!showPreview) return;
    const t = window.setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    return () => window.clearTimeout(t);
  }, [showPreview]);

  const openPreview = () => {
    // อุ่น pdf.js ไว้ตั้งแต่กดปุ่ม — ไม่ต้องรอ chunk ตัวอ่าน → chunk pdf.js → worker เป็นทอดๆ
    void import('@/lib/pdfjs').then((m) => m.loadPdfjs()).catch(() => { /* ตัวอ่านจะรายงาน error เอง */ });
    setShowPreview(true);
  };
  const closePreview = () => {
    setShowPreview(false);
    heroRef.current?.scrollIntoView({ block: 'start' });
  };

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
  const tokenReady = !requiresEntitlement || !!accessToken;
  const waitingForAccess = !locked && hasFile && !tokenReady;
  // สิทธิ์ดาวน์โหลดมาจาก server (can_download) — เล่มสมาชิก: รายปีเท่านั้น
  const canDownload = !locked && hasFile && ebook.can_download === true && tokenReady;
  // อ่านได้แต่โหลดไม่ได้เพราะเป็นสมาชิกรายเดือน (เล่มเปิดให้โหลด แต่ server ไม่ให้สิทธิ์)
  const downloadNeedsYearly = !locked && hasFile && requiresEntitlement && ebook.allow_download && ebook.can_download === false;
  const canView = !locked && hasFile && ebook.is_pdf && tokenReady;
  const downloadHref = canDownload ? api.ebookFileUrl(ebook.slug, 'download', accessToken || undefined) : '';
  const viewHref = canView ? api.ebookFileUrl(ebook.slug, 'view', accessToken || undefined) : '';

  const metaParts: string[] = [];
  if (ebook.pages) metaParts.push(`${ebook.pages} หน้า`);
  if (ebook.is_pdf && hasFile) metaParts.push('อ่านออนไลน์ได้ทันที');
  if (ebook.allow_download && hasFile) metaParts.push(ebook.members_only ? 'สมาชิกรายปีดาวน์โหลดเก็บไว้ได้' : 'ดาวน์โหลดเก็บไว้ได้');

  // ปุ่ม "อ่านตัวอย่างฟรี N หน้า" — โผล่เฉพาะคนที่ยังไม่มีสิทธิ์และเล่มมีตัวอย่าง
  const previewPagesNum = Number(ebook.preview_pages) || 0;
  const previewButton = locked && ebook.has_preview ? (
    <Button
      variant="outline"
      onClick={() => (showPreview ? closePreview() : openPreview())}
      className="w-full sm:w-auto h-11 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
    >
      <BookOpen className="h-4 w-4 mr-1.5" />
      {showPreview ? 'ซ่อนตัวอย่าง' : `อ่านตัวอย่างฟรี${previewPagesNum > 0 ? ` ${previewPagesNum} หน้าแรก` : ''}`}
    </Button>
  ) : null;

  // บล็อกท้ายตัวอย่าง — ชวนสมัครสมาชิก (ปุ่มเดียว → /pricing); รับจำนวนหน้าจริงที่ตัวอ่านเรนเดอร์ได้
  const previewCta = (renderedPages: number) => (
    <div className="text-center space-y-5">
      <div className="space-y-2">
        <p className="text-2xl sm:text-3xl font-bold text-white text-balance">
          คุณอ่านตัวอย่างครบ{renderedPages > 0 ? ` ${renderedPages} หน้า` : ''}แล้ว 🎉
        </p>
        <p className="text-base sm:text-lg text-gray-300">
          {ebook.pages ? `เล่มเต็มมี ${ebook.pages} หน้า — ` : ''}
          สมัครสมาชิกเพื่ออ่านต่อจนจบ
        </p>
        <p className="text-sm sm:text-base text-gray-400">อ่าน Ebook ได้ทุกเล่ม + เข้าเรียนได้ทุกคอร์ส · สมาชิกรายปีดาวน์โหลด Ebook เก็บไว้ได้</p>
      </div>
      <Button
        onClick={() => navigate('/pricing')}
        className="w-full sm:w-auto h-14 sm:h-16 px-8 sm:px-12 text-lg sm:text-xl font-bold bg-purple-600 hover:bg-purple-700 shadow-lg shadow-purple-900/40"
      >
        <Crown className="h-6 w-6 mr-2.5" />
        สมัครสมาชิก อ่านต่อได้เลย
      </Button>
      {!isAuthenticated && (
        <p className="text-sm text-gray-500">
          มีบัญชีอยู่แล้ว?{' '}
          <Link to={`/login?redirect=${encodeURIComponent(`/ebooks/${ebook.slug}`)}`} className="text-[#FFB300] hover:underline">
            เข้าสู่ระบบ
          </Link>
        </p>
      )}
    </div>
  );

  // ปุ่มอ่าน/ดาวน์โหลด (ใช้ซ้ำทั้งเคสฟรีและเคสมีสิทธิ์แล้ว)
  const readerButtons = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        {canDownload && (
          <Button asChild className="flex-1 basis-48 h-11 bg-purple-600 hover:bg-purple-700">
            <a href={downloadHref} download>
              <Download className="h-4 w-4 mr-2" />
              ดาวน์โหลด Ebook
            </a>
          </Button>
        )}
        {downloadNeedsYearly && (
          <Button
            variant="outline"
            onClick={() => navigate('/pricing')}
            className="flex-1 basis-48 h-11 border-[#FFB300]/40 text-[#FFB300] hover:bg-[#FFB300]/10 hover:text-[#FFB300]"
            title="สมาชิกรายเดือนอ่านในเว็บได้อย่างเดียว — อัปเกรดเป็นรายปีเพื่อดาวน์โหลด"
          >
            <Lock className="h-4 w-4 mr-2" />
            ดาวน์โหลดได้เฉพาะสมาชิกรายปี
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
      {downloadNeedsYearly && (
        <p className="text-xs text-gray-500">
          สมาชิกรายเดือนอ่านในเว็บได้อย่างเดียว ·{' '}
          <Link to="/pricing" className="text-[#FFB300] hover:underline">อัปเกรดเป็นรายปี</Link>{' '}
          เพื่อดาวน์โหลดเก็บไว้อ่านออฟไลน์
        </p>
      )}
    </div>
  );

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

        {/* overflow-clip (ไม่ใช่ hidden): ตัดมุมโค้งได้เหมือนกัน แต่ไม่กลายเป็น scrollport
            ของ position:sticky — แถบสถานะของตัวอ่านตัวอย่างข้างในต้องติดใต้ header ได้ */}
        <div ref={heroRef} className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-clip scroll-mt-14 lg:scroll-mt-16">
          <div className="grid lg:grid-cols-5 gap-0">
            {/* Cover — รองรับทั้งปกแนวนอน 16:9 และปกหนังสือแนวตั้ง: รูปจริง object-contain
                ไม่โดน crop ส่วนพื้นหลังเป็นปกเดียวกันเบลอๆ ให้กรอบไม่โล่งตอนปกแนวตั้ง */}
            <div className="relative lg:col-span-2 bg-[#0d0d14] p-4 lg:p-6 flex items-center justify-center overflow-hidden">
              {ebook.cover_url ? (
                <>
                  <img
                    src={api.mediaUrl(ebook.cover_url, 'card')}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40"
                  />
                  <img
                    src={api.mediaUrl(ebook.cover_url, 'hero')}
                    alt={ebook.title}
                    className="relative w-full max-h-[420px] rounded-lg border border-gray-800 object-contain drop-shadow-2xl"
                  />
                </>
              ) : (
                <div className="w-full aspect-video rounded-lg border border-dashed border-gray-800 flex items-center justify-center">
                  <BookMarked className="h-12 w-12 text-gray-600" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="lg:col-span-3 p-6 lg:p-8 flex flex-col min-w-0">
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

              <h1 className="text-2xl lg:text-3xl font-bold text-white leading-tight mb-3">{ebook.title}</h1>

              {(ebook.author_name || ebook.author_avatar_url) && (
                <div className="flex items-center gap-2.5 mb-4">
                  {ebook.author_avatar_url ? (
                    <img
                      src={api.mediaUrl(ebook.author_avatar_url, 'card')}
                      alt={ebook.author_name || 'ผู้เขียน'}
                      className="h-9 w-9 rounded-full object-cover border border-gray-700"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-gray-800 flex items-center justify-center text-gray-500 text-xs">✍️</div>
                  )}
                  <div className="leading-tight">
                    <p className="text-white text-sm font-medium">{ebook.author_name || 'ผู้เขียน'}</p>
                    <p className="text-gray-500 text-xs">ผู้เขียน</p>
                  </div>
                </div>
              )}

              {ebook.hook && (
                <p className="text-white font-semibold text-base lg:text-lg leading-relaxed mb-3">{ebook.hook}</p>
              )}

              {metaParts.length > 0 && (
                <p className="text-gray-400 text-sm mb-4">{metaParts.join(' · ')}</p>
              )}

              <div className="mt-auto space-y-4">
                {/* กล่อง CTA ตามโหมด+สถานะ */}
                {ebook.members_only && locked ? (
                  <div className="rounded-xl border border-[#FFB300]/30 bg-[#FFB300]/5 p-4 text-center space-y-3">
                    <p className="text-sm text-yellow-200/90">
                      <Crown className="inline h-4 w-4 mr-1.5 text-[#FFB300]" />
                      Ebook เล่มนี้สำหรับสมาชิกรายเดือน/รายปีเท่านั้น
                    </p>
                    <Button onClick={() => navigate('/pricing')} className="w-full sm:w-auto h-12 px-8 text-base font-semibold bg-purple-600 hover:bg-purple-700">
                      ดูแพ็กเกจสมาชิก
                      <ArrowRight className="h-4 w-4 ml-1.5" />
                    </Button>
                    {previewButton && <div>{previewButton}</div>}
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
                  readerButtons
                )}

                {/* แชร์ Ebook — มือถือเปิด share sheet ของเครื่อง, เดสก์ท็อปเปิด dialog คัดลอกลิงก์ */}
                <Button
                  variant="outline"
                  onClick={handleShare}
                  className="w-full h-11 md:h-9 text-sm border-gray-600 text-gray-300 hover:bg-gray-800 hover:text-white"
                >
                  <Share2 className="h-4 w-4 mr-1.5" />
                  แชร์ E-book เล่มนี้
                </Button>
              </div>
            </div>
          </div>

          {showReader && canView && (
            <div className="border-t border-gray-800 bg-[#0d0d14]">
              {/* #toolbar=0 hides the browser's own PDF viewer chrome (incl. its
                  built-in Download/Print buttons) — a UI-level deterrent only,
                  not real DRM (Ctrl+S / dev tools still work), but removes the
                  obvious one-click download affordance from the reader itself. */}
              <iframe src={`${viewHref}#toolbar=0`} title={`อ่าน ${ebook.title}`} className="w-full h-[60vh] md:h-[80vh] bg-white" />
            </div>
          )}

          {/* ตัวอ่าน "ตัวอย่างจำกัดหน้า" — ไฟล์ที่โหลดมามีแค่หน้าตัวอย่างจริงๆ ไม่ใช่ไฟล์เต็ม
              ค่าเริ่มต้นเลื่อนอ่านต่อเนื่อง (จบแล้วเจอบล็อกชวนสมัคร) — พังค่อยตกไป iframe PDF */}
          {showPreview && locked && ebook.has_preview && (
            <div ref={previewRef} className="border-t border-gray-800 bg-[#0d0d14] scroll-mt-14 lg:scroll-mt-16">
              {previewMode === 'webtoon' ? (
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
                      <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดตัวอ่าน…
                    </div>
                  }
                >
                  <EbookWebtoonPreview
                    slug={ebook.slug}
                    version={`${previewPagesNum}-${ebook.updated_at}`}
                    title={ebook.title}
                    previewPages={previewPagesNum}
                    totalPages={ebook.pages ? Number(ebook.pages) : null}
                    cta={previewCta}
                    onClose={closePreview}
                    onFallback={() => setPreviewMode('pdf')}
                  />
                </Suspense>
              ) : (
                <>
                  <iframe
                    src={`${api.ebookPreviewUrl(ebook.slug, `${previewPagesNum}-${ebook.updated_at}`)}#toolbar=0`}
                    title={`ตัวอย่าง ${ebook.title}`}
                    className="w-full h-[60vh] md:h-[80vh] bg-white"
                  />
                  <div className="px-4 py-8 border-t border-gray-800">{previewCta(previewPagesNum)}</div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ลำดับ block ใต้ hero (user เคาะ): รายละเอียด → ข้างในมีอะไร → ตัวอย่างผลงาน */}
        {ebook.description && (
          <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-6 lg:p-8">
            <h2 className="text-lg font-bold text-white mb-4">📄 รายละเอียด</h2>
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">{ebook.description}</p>
          </div>
        )}

        {/* ข้างในมีอะไร */}
        {ebook.highlights.length > 0 && (
          <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-6 lg:p-8">
            <h2 className="text-lg font-bold text-white mb-4">📖 ข้างในมีอะไร</h2>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {ebook.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-gray-300 leading-relaxed">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                  {h}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ตัวอย่างผลงาน — ปิดท้ายเป็นโชว์เคส: แนวนอนใหญ่แถวละ 1 · แนวตั้งแถวละ 2 */}
        {ebook.samples.length > 0 && (
          <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-6 lg:p-8">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Play className="h-4 w-4 text-[#FFB300]" />
              ตัวอย่างผลงานจาก E-book เล่มนี้
            </h2>
            <EbookSamplesGallery samples={ebook.samples} />
          </div>
        )}
      </div>

      {/* แชร์ Ebook (เดสก์ท็อป / เครื่องที่ไม่มี share sheet) — โครงเดียวกับ dialog แชร์คอร์ส */}
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-purple-400" />
              แชร์ E-book เล่มนี้
            </DialogTitle>
          </DialogHeader>

          {/* min-w-0 ทั้งสองชั้น: กัน dialog ถูกดันจนมี scrollbar แนวนอน ·
              ปุ่มตรึงความกว้างกันเลย์เอาต์กระตุกตอนป้ายเปลี่ยน "คัดลอก" → "คัดลอกแล้ว" */}
          <div className="flex flex-col sm:flex-row gap-2 min-w-0">
            <div className="flex-1 min-w-0 flex items-center gap-2 rounded-md bg-gray-800/60 border border-gray-700 px-3 h-11 md:h-10">
              <Link2 className="h-4 w-4 text-gray-500 shrink-0" />
              <span className="text-sm text-gray-200 truncate">{shareUrl}</span>
            </div>
            <Button
              onClick={handleCopyLink}
              className={`h-11 md:h-10 shrink-0 w-full sm:w-[132px] justify-center ${linkCopied ? 'bg-green-600 hover:bg-green-600' : 'bg-purple-600 hover:bg-purple-700'}`}
            >
              {linkCopied ? <Check className="h-4 w-4 mr-1.5" /> : <Link2 className="h-4 w-4 mr-1.5" />}
              {linkCopied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EbookDetail;
