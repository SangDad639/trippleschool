import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type EbookDto } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PublicHeader from '@/components/PublicHeader';
import EbookSamplesGallery from '@/components/ebooks/EbookSamplesGallery';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Play,
  Share2,
  ShoppingCart,
  Upload,
} from 'lucide-react';

const MAX_SLIP_BYTES = 5 * 1024 * 1024;

// หน้ารายละเอียด Ebook /ebooks/:slug — โครงตามดีไซน์อ้างอิง fuzionhub:
// ปกใหญ่ + ชื่อ + ผู้เขียน + ประโยคขาย (hook) + "X หน้า · อ่านออนไลน์ได้ทันที"
// + กล่องราคา/CTA + section "ข้างในมีอะไร" (highlights)
// โหมดต่อเล่ม: ฟรี / สมาชิกเท่านั้น / ขายรายเล่ม (ซื้อด้วยสลิป+แอดมินอนุมัติ เหมือนคอร์ส)
// สิทธิ์การเข้าถึงจริงมาจาก server เสมอ — ปุ่มที่เห็นแค่สะท้อนสิทธิ์นั้น ไม่ใช่ตัวตัดสินเอง
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
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // ซื้อรายเล่ม — dialog โค้ดผู้แนะนำ + สลิป (mirror โฟลว์ซื้อคอร์สใน CourseDetail)
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // แชร์ Ebook: ลิงก์สั้น /ebooks/{share_code} (เล่มเก่าที่ยังไม่มีรหัสตกไปใช้ slug)
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState('');
  const [refCode, setRefCode] = useState('');
  const [refCheck, setRefCheck] = useState<{ valid: boolean; pct: number; reason?: string; code: string } | null>(null);
  const [refChecking, setRefChecking] = useState(false);
  const slipInputRef = useRef<HTMLInputElement>(null);

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

  const price = Number(ebook?.price) || 0;
  const forSale = !!ebook && price > 0 && !ebook.members_only;
  const requiresEntitlement = !!ebook && (ebook.members_only || price > 0);
  const entitled = ebook?.entitled === true;
  const locked = requiresEntitlement && !entitled;
  const myPurchase = ebook?.my_purchase ?? null;

  // ไฟล์ของเล่มสมาชิก/เล่มขาย ต้องใช้ token สั้นๆ เฉพาะเล่ม — <a>/<iframe> ธรรมดา
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

  const validateCode = async (raw: string, silent = false) => {
    const code = raw.trim();
    if (!code) { setRefCheck(null); return null; }
    try {
      setRefChecking(true);
      const r = await api.validateRefcode(code);
      const state = { valid: r.valid, pct: r.discount_percent, reason: r.reason, code: code.toLowerCase() };
      setRefCheck(state);
      if (!silent) {
        if (r.valid) toast.success(`ใช้โค้ดสำเร็จ 🎉 ลด ${r.discount_percent}%`);
        else toast.error(r.reason === 'OWN_CODE' ? 'ใช้โค้ดของตัวเองไม่ได้' : 'ไม่พบโค้ดนี้');
      }
      return state;
    } catch {
      if (!silent) toast.error('ตรวจสอบโค้ดไม่สำเร็จ ลองใหม่อีกครั้ง');
      return null;
    } finally {
      setRefChecking(false);
    }
  };

  const openBuyDialog = () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    setSlipFile(null);
    setSlipPreview('');
    // prefill: โค้ดที่เคยใช้กับคำสั่งซื้อนี้ (resubmit) มาก่อนโค้ดจากลิงก์แนะนำ
    const prefill = myPurchase?.refcode || localStorage.getItem('ts_ref') || '';
    setRefCode(prefill);
    setRefCheck(null);
    setBuyDialogOpen(true);
    if (prefill.trim()) void validateCode(prefill, true);
  };

  // ยอดโอนจริง: โค้ด valid → ลดสด (สูตร round2 ตรง server); ไม่กรอกโค้ดแต่คำสั่งซื้อเดิม
  // บันทึกยอดลดไว้ (resubmit สลิป) → ใช้ยอดที่บันทึก (server คงค่าเดิมเมื่อไม่ส่งโค้ด)
  const storedPaid =
    myPurchase && (myPurchase.status === 'pending' || myPurchase.status === 'rejected') && myPurchase.paid_amount != null
      ? Number(myPurchase.paid_amount)
      : null;
  const effectiveBuyAmount = refCheck?.valid
    ? Math.round(price * (1 - refCheck.pct / 100) * 100) / 100
    : (storedPaid ?? price);

  const handleSlipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ');
      return;
    }
    if (file.size > MAX_SLIP_BYTES) {
      toast.error('ไฟล์ใหญ่เกิน 5MB');
      return;
    }
    setSlipFile(file);
    setSlipPreview(URL.createObjectURL(file));
  };

  const handleConfirmBuy = async () => {
    if (!ebook) return;
    if (!slipFile) {
      toast.error('กรุณาอัปโหลดสลิปการโอนเงิน');
      return;
    }
    // มีโค้ดในช่องแต่ยังไม่ validate → ห้ามส่งเงียบๆ (ยอดบนจออาจไม่ตรงยอดหลังลด)
    const typed = refCode.trim().toLowerCase();
    if (typed && !(refCheck?.valid && refCheck.code === typed)) {
      toast.error('กดปุ่ม "ใช้โค้ด" เพื่อตรวจสอบโค้ดก่อน หรือลบโค้ดออกจากช่อง');
      return;
    }
    try {
      setSubmitting(true);
      await api.purchaseEbook(ebook.id, slipFile, refCheck?.valid ? refCheck.code : undefined);
      toast.success('ส่งคำขอแล้ว รอแอดมินอนุมัติ');
      setBuyDialogOpen(false);
      await loadEbook();
    } catch (error: any) {
      console.error('Failed to purchase ebook:', error);
      if (error?.errorCode === 'INVALID_REFCODE' || error?.errorCode === 'REFCODE_LOCKED') {
        setRefCheck(null);
      }
      toast.error(error?.message || 'ส่งคำขอไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
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
  const canDownload = !locked && hasFile && ebook.allow_download && tokenReady;
  const canView = !locked && hasFile && ebook.is_pdf && tokenReady;
  const downloadHref = canDownload ? api.ebookFileUrl(ebook.slug, 'download', accessToken || undefined) : '';
  const viewHref = canView ? api.ebookFileUrl(ebook.slug, 'view', accessToken || undefined) : '';

  const metaParts: string[] = [];
  if (ebook.pages) metaParts.push(`${ebook.pages} หน้า`);
  if (ebook.is_pdf && hasFile) metaParts.push('อ่านออนไลน์ได้ทันที');
  if (ebook.allow_download && hasFile) metaParts.push('ดาวน์โหลดเก็บไว้ได้');

  // ปุ่ม "อ่านตัวอย่างฟรี N หน้า" — โผล่เฉพาะคนที่ยังไม่มีสิทธิ์และเล่มมีตัวอย่าง
  const previewPagesNum = Number(ebook.preview_pages) || 0;
  const previewButton = locked && ebook.has_preview ? (
    <Button
      variant="outline"
      onClick={() => setShowPreview((v) => !v)}
      className="w-full sm:w-auto h-10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
    >
      <BookOpen className="h-4 w-4 mr-1.5" />
      {showPreview ? 'ซ่อนตัวอย่าง' : `อ่านตัวอย่างฟรี${previewPagesNum > 0 ? ` ${previewPagesNum} หน้าแรก` : ''}`}
    </Button>
  ) : null;

  // ปุ่มอ่าน/ดาวน์โหลด (ใช้ซ้ำทั้งเคสฟรีและเคสมีสิทธิ์แล้ว)
  const readerButtons = (
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

        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden">
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
                ) : forSale ? (
                  <Badge className="bg-[#FFB300]/15 text-[#FFB300] border border-[#FFB300]/30">
                    <ShoppingCart className="h-3.5 w-3.5 mr-1" /> E-book ขายรายเล่ม
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <Download className="h-3.5 w-3.5 mr-1" /> ดาวน์โหลดฟรี ไม่ต้องเป็นสมาชิก
                  </Badge>
                )}
                {forSale && entitled && (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    {myPurchase?.status === 'approved' ? 'ซื้อแล้ว' : 'อ่านได้ด้วยสิทธิ์สมาชิก'}
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
                    <Button onClick={() => navigate('/pricing')} className="bg-purple-600 hover:bg-purple-700">
                      ดูแพ็กเกจสมาชิก
                      <ArrowRight className="h-4 w-4 ml-1.5" />
                    </Button>
                    {previewButton && <div>{previewButton}</div>}
                  </div>
                ) : forSale && locked ? (
                  myPurchase?.status === 'pending' ? (
                    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-3">
                      <p className="text-sm text-yellow-200/90">
                        ⏳ ส่งคำสั่งซื้อแล้ว (ยอดโอน ฿{Number(myPurchase.paid_amount ?? price).toLocaleString()}) — รอแอดมินตรวจสอบสลิป
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={openBuyDialog}>
                          <Upload className="h-4 w-4 mr-1.5" />
                          อัปเดตสลิปใหม่
                        </Button>
                        {previewButton}
                      </div>
                    </div>
                  ) : myPurchase?.status === 'rejected' ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
                      <p className="text-sm text-red-300">
                        ❌ คำสั่งซื้อถูกปฏิเสธ{myPurchase.rejection_reason ? ` — ${myPurchase.rejection_reason}` : ''}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={openBuyDialog} className="bg-purple-600 hover:bg-purple-700">
                          <ShoppingCart className="h-4 w-4 mr-2" />
                          ส่งคำสั่งซื้อใหม่
                        </Button>
                        {previewButton}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex items-end gap-2">
                        <span className="text-3xl font-bold text-[#FFB300]">฿{price.toLocaleString()}</span>
                        <span className="text-gray-500 text-sm pb-1">จ่ายครั้งเดียว อ่านได้ตลอด</span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button onClick={openBuyDialog} className="w-full sm:w-auto h-11 px-8 bg-purple-600 hover:bg-purple-700">
                          <ShoppingCart className="h-4 w-4 mr-2" />
                          ซื้อ E-book เล่มนี้
                        </Button>
                        {previewButton}
                      </div>
                      <p className="text-gray-500 text-xs">
                        หรือ{' '}
                        <Link to="/pricing" className="text-[#FFB300] hover:underline">
                          สมัครสมาชิก
                        </Link>{' '}
                        อ่านได้ทุกเล่ม + เข้าเรียนได้ทุกคอร์ส
                      </p>
                    </div>
                  )
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

                {/* แชร์ Ebook — มือถือเปิด share sheet ของเครื่อง, เดสก์ท็อปเปิด dialog คัดลอกลิงก์
                    (รายละเอียดถูกย้ายไปเป็น block ของตัวเองใต้ hero — hero โล่ง ปุ่มซื้อเด่น) */}
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

          {/* ตัวอ่าน "ตัวอย่างจำกัดหน้า" — ไฟล์ที่โหลดมามีแค่หน้าตัวอย่างจริงๆ ไม่ใช่ไฟล์เต็ม */}
          {showPreview && locked && ebook.has_preview && (
            <div className="border-t border-gray-800 bg-[#0d0d14]">
              <iframe
                src={`${api.ebookPreviewUrl(ebook.slug)}#toolbar=0`}
                title={`ตัวอย่าง ${ebook.title}`}
                className="w-full h-[60vh] md:h-[80vh] bg-white"
              />
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 px-4 py-3 border-t border-gray-800">
                <p className="text-sm text-gray-300">
                  📖 นี่คือตัวอย่างบางส่วนเท่านั้น{previewPagesNum > 0 ? ` (${previewPagesNum} หน้าแรก)` : ''} — อ่านเต็มเล่มได้เลย
                </p>
                {forSale ? (
                  <Button size="sm" onClick={openBuyDialog} className="bg-purple-600 hover:bg-purple-700">
                    <ShoppingCart className="h-4 w-4 mr-1.5" />
                    ซื้อ ฿{price.toLocaleString()}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => navigate('/pricing')} className="bg-purple-600 hover:bg-purple-700">
                    <Crown className="h-4 w-4 mr-1.5" />
                    สมัครสมาชิก
                  </Button>
                )}
              </div>
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

      {/* Buy / slip-upload dialog (mirror ซื้อคอร์ส) */}
      <Dialog open={buyDialogOpen} onOpenChange={(open) => { if (!submitting) setBuyDialogOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-purple-400" />
              ซื้อ E-book เล่มนี้
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-md bg-gray-800/50 px-3 py-2.5">
              <span className="text-white text-sm font-medium truncate">{ebook.title}</span>
              <span className="text-[#FFB300] font-bold whitespace-nowrap">฿{price.toLocaleString()}</span>
            </div>

            {/* โค้ดผู้แนะนำ = ส่วนลดตอนซื้อ + เจ้าของโค้ดได้ค่าคอม */}
            <div className="space-y-1.5">
              <p className="text-gray-300 text-xs font-medium">🎟️ โค้ดผู้แนะนำ (ถ้ามี)</p>
              <div className="flex gap-2">
                <Input
                  value={refCode}
                  onChange={(e) => { setRefCode(e.target.value); setRefCheck(null); }}
                  placeholder="กรอกโค้ดเพื่อรับส่วนลด"
                  className="h-11 md:h-9 font-mono"
                  disabled={submitting}
                />
                <Button
                  variant="outline"
                  onClick={() => void validateCode(refCode)}
                  disabled={refChecking || !refCode.trim() || submitting}
                  className="h-11 md:h-9 text-xs shrink-0 border-purple-500/40 text-purple-300 hover:bg-purple-500/10"
                >
                  {refChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'ใช้โค้ด'}
                </Button>
              </div>
              {refCheck?.valid && (
                <p className="text-green-400 text-xs">
                  ✅ ใช้โค้ดแล้ว ลด {refCheck.pct}% (−฿{(price - effectiveBuyAmount).toLocaleString()})
                </p>
              )}
              {refCheck && !refCheck.valid && (
                <p className="text-red-400 text-xs">
                  ❌ {refCheck.reason === 'OWN_CODE' ? 'ใช้โค้ดของตัวเองไม่ได้' : 'ไม่พบโค้ดนี้ ตรวจสอบอีกครั้ง'}
                </p>
              )}
            </div>

            <p className="text-gray-400 text-sm">
              โอนเงินจำนวน{' '}
              {effectiveBuyAmount !== price && (
                <span className="line-through text-gray-500 mr-1">฿{price.toLocaleString()}</span>
              )}
              <span className="text-purple-400 font-semibold">฿{effectiveBuyAmount.toLocaleString()}</span> แล้วอัปโหลดสลิปการโอนเงินเพื่อให้แอดมินตรวจสอบ
            </p>
            {storedPaid != null && !refCheck?.valid && myPurchase?.refcode && (
              <p className="text-green-400/80 text-xs">
                🎟️ คำสั่งซื้อนี้ใช้โค้ด <span className="font-mono">{myPurchase.refcode}</span> ไปแล้ว — ยอดโอนตามส่วนลดเดิม
              </p>
            )}

            <input ref={slipInputRef} type="file" accept="image/*" className="hidden" onChange={handleSlipChange} />

            {slipPreview ? (
              <div className="space-y-2">
                <div className="flex items-center justify-center bg-gray-900 rounded-lg p-3">
                  <img src={slipPreview} alt="สลิปการโอนเงิน" className="max-h-72 max-w-full object-contain rounded" />
                </div>
                <Button variant="outline" onClick={() => slipInputRef.current?.click()} className="w-full">
                  <Upload className="h-4 w-4 mr-2" />
                  เลือกรูปอื่น
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => slipInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-700 hover:border-purple-500/50 bg-gray-800/30 py-8 transition-colors"
              >
                <Upload className="h-7 w-7 text-gray-400" />
                <span className="text-gray-300 text-sm">อัปโหลดสลิปการโอนเงิน</span>
                <span className="text-gray-500 text-xs">รูปภาพ ขนาดไม่เกิน 5MB</span>
              </button>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBuyDialogOpen(false)} disabled={submitting}>
              ยกเลิก
            </Button>
            <Button onClick={handleConfirmBuy} disabled={submitting} className="bg-purple-600 hover:bg-purple-700">
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              ยืนยัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
