import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatCurrency, type CurrencyCode } from '@/lib/currency';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Users,
  Wallet,
  Clock,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  Save,
  Building2,
  Crown,
  FileText,
  Download,
  Pencil,
} from 'lucide-react';
import type { AffiliateStats, Referee, AffiliateTransfer, PayoutMethod, ThaiBankInfo } from '@/types/affiliate';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import TaxInfoSection from '@/components/profile/TaxInfoSection';

// โค้ดกำหนดเอง — mirror กติกาฝั่ง server (services/refcode.ts) ไว้แค่ hint ระหว่างพิมพ์; server เป็นผู้ตัดสิน (รูปแบบ/คำสงวน/ซ้ำ)
const CODE_RE = /^[a-z0-9](?:[a-z0-9_-]{2,18})[a-z0-9]$/;
const cleanCodeInput = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
function codeHint(code: string, th: boolean): { ok: boolean; text: string } {
  if (code.length < 4) return { ok: false, text: th ? '❌ สั้นเกินไป (อย่างน้อย 4 ตัว)' : '❌ Too short (min 4 characters)' };
  if (!/[a-z]/.test(code)) return { ok: false, text: th ? '❌ ต้องมีตัวอักษร a-z อย่างน้อย 1 ตัว' : '❌ Needs at least one letter a-z' };
  if (!CODE_RE.test(code)) return { ok: false, text: th ? '❌ ขึ้นต้นและลงท้ายต้องเป็นตัวอักษรหรือตัวเลข' : '❌ Must start and end with a letter or digit' };
  return { ok: true, text: th ? '✅ รูปแบบถูกต้อง — กดบันทึกเพื่อตรวจว่าโค้ดว่างอยู่' : '✅ Looks good — save to check availability' };
}

// Thai bank list
const THAI_BANKS = [
  { value: 'kbank', label: 'ธนาคารกสิกรไทย (KBANK)' },
  { value: 'scb', label: 'ธนาคารไทยพาณิชย์ (SCB)' },
  { value: 'bbl', label: 'ธนาคารกรุงเทพ (BBL)' },
  { value: 'ktb', label: 'ธนาคารกรุงไทย (KTB)' },
  { value: 'bay', label: 'ธนาคารกรุงศรีอยุธยา (BAY)' },
  { value: 'ttb', label: 'ธนาคารทหารไทยธนชาต (TTB)' },
  { value: 'gsb', label: 'ธนาคารออมสิน (GSB)' },
  { value: 'baac', label: 'ธนาคาร ธ.ก.ส. (BAAC)' },
  { value: 'cimb', label: 'ธนาคารซีไอเอ็มบีไทย (CIMB)' },
  { value: 'uob', label: 'ธนาคารยูโอบี (UOB)' },
  { value: 'lhbank', label: 'ธนาคารแลนด์ แอนด์ เฮ้าส์ (LH Bank)' },
  { value: 'other', label: 'อื่นๆ' },
];

const Affiliate = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { refreshUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [transfers, setTransfers] = useState<AffiliateTransfer[]>([]);
  const [referees, setReferees] = useState<Referee[]>([]);

  const [copied, setCopied] = useState(false);
  // ตั้งโค้ดแนะนำเอง (custom code)
  const [editCodeOpen, setEditCodeOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [codeSaving, setCodeSaving] = useState(false);
  const [refereeSearch, setRefereeSearch] = useState('');
  // Generic file preview state — used by both proof of transfer and WHT cert.
  // `url` is a short-lived signed URL; `downloadName` is suggested filename
  // when the user clicks the Download button in the modal.
  // url = blob URL จาก fetch แบบมี auth (proxy /proofs/* ต้องล็อกอินแล้ว) → ไม่มีนามสกุล
  // จึงต้องพก isPdf จากชื่อไฟล์ต้นทางมาด้วย
  const [previewFile, setPreviewFile] = useState<
    | { url: string; title: string; downloadName: string; isPdf: boolean }
    | null
  >(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const openProtectedPreview = async (sourceUrl: string, title: string, downloadName: string) => {
    try {
      setPreviewLoading(true);
      const blobUrl = await api.getProtectedFileBlobUrl(sourceUrl);
      if (!blobUrl) {
        toast.error(language === 'th' ? 'ไม่พบไฟล์' : 'File not found');
        return;
      }
      const isPdf = sourceUrl.split('?')[0].toLowerCase().endsWith('.pdf');
      setPreviewFile({ url: blobUrl, title, downloadName: isPdf ? `${downloadName}.pdf` : downloadName, isPdf });
    } catch (e: any) {
      toast.error(e?.message || (language === 'th' ? 'เปิดไฟล์ไม่สำเร็จ' : 'Failed to open file'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (previewFile) URL.revokeObjectURL(previewFile.url);
    setPreviewFile(null);
  };

  // Geo-detection
  const [isThailand, setIsThailand] = useState(false);
  const [geoDetected, setGeoDetected] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);

  // Payout method state — defaults to 'thai_bank' since Wise UI is hidden.
  // (Wise still supported on backend for users that already have it set.)
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('thai_bank');

  // Wise email state
  const [wiseEmail, setWiseEmail] = useState('');
  const [wiseEmailSaving, setWiseEmailSaving] = useState(false);

  // Thai bank state
  const [bankInfo, setBankInfo] = useState<ThaiBankInfo>({
    bank_name: '',
    branch: null,
    account_number: '',
    account_holder: '',
    phone: null,
    tax_id: null,
    tax_name: null,
    tax_address: null,
  });
  const [bankSaving, setBankSaving] = useState(false);


  // Geo-detection on mount
  useEffect(() => {
    const detectCountry = async () => {
      try {
        const res = await fetch('https://api.country.is/');
        const data = await res.json();
        console.log('[Geo]', data.country, data);
        setIsThailand(data.country === 'TH');
        setDetectedCountry(data.country || 'unknown');
      } catch (err) {
        console.error('[Geo] Error:', err);
        setIsThailand(false);
        setDetectedCountry('error');
      } finally {
        setGeoDetected(true);
      }
    };
    detectCountry();
    loadData();
  }, []);

  useEffect(() => {
    if (stats) {
      setWiseEmail(stats.wise_email || '');
      setPayoutMethod(stats.preferred_payout_method || 'thai_bank');
      if (stats.thai_bank_info) {
        setBankInfo(stats.thai_bank_info);
      }
    }
  }, [stats]);

  const loadData = async () => {
    try {
      const [announcementRes, statsRes, refereesRes, transfersRes] = await Promise.all([
        api.getAffiliateAnnouncement(),
        api.getAffiliateStats(),
        api.getAffiliateReferees(),
        api.getAffiliateTransfers(),
      ]);

      setAnnouncement(announcementRes.announcement || '');
      setStats(statsRes);
      setReferees(refereesRes.referees || []);
      setTransfers(transfersRes.transfers || []);
    } catch (error) {
      console.error('Failed to load affiliate data:', error);
    } finally {
      setLoading(false);
    }
  };

  // flow ใหม่ใช้ "กรอกโค้ดตอนชำระเงิน" — คัดลอกเฉพาะตัวโค้ด ไม่ใช่ลิงก์ register
  const handleCopyCode = async () => {
    if (!stats?.refcode) return;
    try {
      await navigator.clipboard.writeText(stats.refcode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // R2: ค่าคอม % คงที่ทุกคน — ไม่มี tier แล้ว (BE ส่ง tier = null)
  const commissionPct = stats?.commission_percent ?? 0;
  const clawbackNet = stats?.clawback_net ?? 0;

  const openEditCode = () => {
    setNewCode(stats?.refcode || '');
    setEditCodeOpen(true);
  };

  // บันทึกโค้ดใหม่ — server ตรวจรูปแบบ/คำสงวน/ซ้ำ แล้วส่งข้อความไทยกลับมาใน err.message
  const handleSaveCode = async () => {
    const hint = codeHint(newCode, language === 'th');
    if (!hint.ok) {
      toast.error(hint.text);
      return;
    }
    setCodeSaving(true);
    try {
      const res = await api.updateMyRefcode(newCode);
      toast.success(language === 'th'
        ? `เปลี่ยนโค้ดแล้ว 🎉 โค้ดใหม่ของคุณคือ ${res.refcode}`
        : `Code updated 🎉 Your new code is ${res.refcode}`);
      if (stats) setStats({ ...stats, refcode: res.refcode });
      // sync user.refcode ใน AuthContext (/me) ให้หน้าอื่นเห็นโค้ดใหม่ทันที
      refreshUser().catch(() => {});
      setEditCodeOpen(false);
    } catch (error: any) {
      toast.error(error?.message || t('affiliate.saveFailed'));
    } finally {
      setCodeSaving(false);
    }
  };

  const handleSaveWiseEmail = async () => {
    if (!wiseEmail || !wiseEmail.includes('@')) {
      toast.error(t('affiliate.invalidEmail'));
      return;
    }
    setWiseEmailSaving(true);
    try {
      await api.updateWiseEmail(wiseEmail);
      toast.success(t('affiliate.wiseEmailSaved'));
      if (stats) {
        setStats({ ...stats, wise_email: wiseEmail });
      }
    } catch (error) {
      toast.error(t('affiliate.saveFailed'));
    } finally {
      setWiseEmailSaving(false);
    }
  };

  const handleSaveBankInfo = async () => {
    if (!bankInfo.bank_name || !bankInfo.account_number || !bankInfo.account_holder) {
      toast.error(t('affiliate.bankRequired'));
      return;
    }
    setBankSaving(true);
    try {
      await api.saveThaiBankAccount({
        bank_name: bankInfo.bank_name,
        branch: bankInfo.branch || undefined,
        account_number: bankInfo.account_number,
        account_holder: bankInfo.account_holder,
        phone: bankInfo.phone || undefined,
        tax_id: bankInfo.tax_id || undefined,
        tax_name: bankInfo.tax_name || undefined,
        tax_address: bankInfo.tax_address || undefined,
      });
      toast.success(t('affiliate.bankSaved'));
      if (stats) {
        setStats({ ...stats, thai_bank_info: bankInfo });
      }
    } catch (error) {
      toast.error(t('affiliate.saveFailed'));
    } finally {
      setBankSaving(false);
    }
  };

  const handlePayoutMethodChange = async (method: PayoutMethod) => {
    setPayoutMethod(method);
    try {
      await api.setPreferredPayoutMethod(method);
      if (stats) {
        setStats({ ...stats, preferred_payout_method: method });
      }
    } catch (error) {
      toast.error(t('affiliate.payoutChangeFailed'));
    }
  };

  // Geo-based currency: THB for Thailand, USD for others
  const currency: CurrencyCode = isThailand ? 'THB' : 'USD';
  const fmt = (amount: number) => formatCurrency(amount, currency);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'transferred':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  // R8: cancelled = ยกเลิกก่อนจ่าย · clawback = จ่ายแล้วแต่คำสั่งซื้อถูกยกเลิก (ยอดหักคืน)
  const getStatusText = (status: string) => {
    switch (status) {
      case 'transferred':
        return t('affiliate.statusTransferred');
      case 'pending':
        return t('affiliate.statusPending');
      case 'cancelled':
        return language === 'th' ? 'ยกเลิก' : 'Cancelled';
      case 'clawback':
        return language === 'th' ? 'หักคืน' : 'Clawback';
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <div className="page-wrapper flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#FFB300]" />
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/app')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{t('affiliate.title')}</h1>
              <p className="text-muted-foreground">{t('affiliate.subtitle')}</p>
            </div>
            {/* Debug: Geo detection — ซ่อนบนมือถือ (เบียดหัวเรื่องจนล้น) */}
            {detectedCountry && (
              <span className="ml-auto hidden md:inline text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                Geo: {detectedCountry} → {currency}
              </span>
            )}
          </div>

          {/* Affiliate Tier — moved from /profile. Single home for affiliate-related info. */}
          <div className="bg-card p-6 rounded-xl border border-border space-y-4">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-[#FFB300]" />
              <h2 className="text-lg font-semibold">
                {language === 'th' ? 'ค่าคอมมิชชั่นของคุณ' : 'Your Commission'}
              </h2>
            </div>

            <div className="space-y-4">
              {/* ค่าคอม % คงที่ทุกคน (R2) */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-border">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-[#FFB300]/15">
                    <Users className="h-5 w-5 text-[#FFB300]" />
                  </div>
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      <span className="text-[#FFB300] text-xl">{commissionPct}%</span>
                      {language === 'th' ? 'ต่อคำสั่งซื้อ' : 'per order'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {language === 'th'
                        ? 'จากยอดที่ผู้ซื้อจ่ายจริง (ก่อน VAT) เท่ากันทุกแพ็กเกจ · เฉพาะการสมัครครั้งแรกของผู้ซื้อ'
                        : 'of the amount actually paid (pre-VAT), same for every package · first subscription only'}
                    </div>
                    {clawbackNet > 0 && (
                      <div className="text-[11px] text-red-400 mt-1">
                        {language === 'th'
                          ? `มียอดหักคืนค้าง ฿${clawbackNet.toLocaleString('th-TH', { minimumFractionDigits: 2 })} (คำสั่งซื้อถูกยกเลิก/คืนเงินหลังจ่ายค่าคอมแล้ว — ทีมงานจะติดต่อ)`
                          : `Outstanding clawback ฿${clawbackNet.toLocaleString('en-US', { minimumFractionDigits: 2 })} (order cancelled/refunded after payout — we will contact you)`}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Refcode + referrals — มือถือวางซ้อนกัน (โค้ด 8 ตัวตัวใหญ่ล้นออกนอกช่องเมื่อบีบ 2 คอลัมน์) */}
              <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg border border-border text-center">
                  <div className="text-xs text-muted-foreground mb-1">
                    {language === 'th' ? 'ผู้แนะนำมา' : 'Referrals'}
                  </div>
                  <div className="text-2xl font-bold text-[#FFB300]">
                    {stats?.total_referrals ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-border text-center">
                  <div className="text-xs text-muted-foreground mb-1">
                    {language === 'th' ? '🎟️ โค้ดแนะนำของฉัน' : '🎟️ My Code'}
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="w-full flex items-center justify-center gap-2 group"
                    disabled={!stats?.refcode}
                    title={language === 'th' ? 'คัดลอกโค้ด' : 'Copy code'}
                  >
                    {/* โค้ดกำหนดเองยาวได้ถึง 20 ตัว → break-all + ย่อฟอนต์ แทน truncate (จอแคบเคยตัดโค้ด) */}
                    <span
                      className={`${(stats?.refcode?.length ?? 0) > 10 ? 'text-base xs:text-lg' : 'text-xl xs:text-2xl'} font-bold font-mono text-[#FFB300] tracking-wide break-all`}
                      data-testid="my-refcode"
                    >
                      {stats?.refcode || '—'}
                    </span>
                    {stats?.refcode && (
                      copied
                        ? <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                        : <Copy className="h-4 w-4 text-muted-foreground group-hover:text-foreground flex-shrink-0" />
                    )}
                  </button>
                  {stats?.refcode && (
                    <button
                      type="button"
                      onClick={openEditCode}
                      className="mt-1 text-[11px] text-muted-foreground hover:text-[#FFB300] inline-flex items-center gap-1 transition-colors"
                      data-testid="edit-refcode"
                    >
                      <Pencil className="h-3 w-3" />
                      {language === 'th' ? 'แก้ไขโค้ด' : 'Edit code'}
                    </button>
                  )}
                </div>
              </div>

              {stats?.refcode && (
                <p className="text-[11px] text-muted-foreground">
                  {language === 'th'
                    ? '💡 บอกเพื่อนกรอกโค้ดนี้ตอนชำระเงิน (ซื้อคอร์สหรือสมัครสมาชิก) — เพื่อนได้ส่วนลดทันที และคุณได้ค่าคอมมิชชั่นเมื่อการชำระได้รับอนุมัติ · ตั้งโค้ดเองได้ที่ "แก้ไขโค้ด"'
                    : '💡 Have friends enter this code at checkout (course purchase or subscription) — they get an instant discount and you earn commission once the payment is approved. · Set your own code via "Edit code"'}
                </p>
              )}
            </div>
          </div>

          {/* Announcement */}
          {announcement && (
            <div className="bg-card p-5 rounded-xl border border-border space-y-3">
              <h2 className="font-semibold">{t('affiliate.announcement')}</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{announcement}</p>
            </div>
          )}

          {/* Stats Cards — ตัวเลขเงินแบบ ฿12,500.00 ล้นช่องเมื่อบีบ 3 คอลัมน์บนจอเล็ก */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <div className="bg-card p-4 rounded-xl border border-border text-center">
              <Clock className="h-5 w-5 text-yellow-500 mx-auto mb-2" />
              <div className="text-xl sm:text-2xl font-bold text-yellow-500 tabular-nums">{stats?.pending_transfers || 0}</div>
              <div className="text-xs text-muted-foreground">{t('affiliate.pendingTransfers')}</div>
              {stats?.pending_wht != null && stats.pending_wht > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  {fmt(stats.pending_net ?? stats.pending_amount)} สุทธิ
                </div>
              )}
            </div>
            <div className="bg-card p-4 rounded-xl border border-border text-center">
              <Users className="h-5 w-5 text-green-500 mx-auto mb-2" />
              <div className="text-xl sm:text-2xl font-bold text-green-500 tabular-nums">{stats?.completed_transfers || 0}</div>
              <div className="text-xs text-muted-foreground">{t('affiliate.completed')}</div>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border text-center">
              <Wallet className="h-5 w-5 text-[#FFB300] mx-auto mb-2" />
              <div className="text-sm sm:text-xl font-bold text-[#FFB300] tabular-nums break-all">{fmt(stats?.total_earnings || 0)}</div>
              <div className="text-xs text-muted-foreground">{t('affiliate.totalEarnings')}</div>
            </div>
          </div>

          {/* Tabs — main content area: รายการผู้แนะนำ / ประวัติการโอนเงิน /
              วิธีรับเงินค่าคอมมิชชั่น / ข้อมูลภาษี. Default tab = referees (top
              of user's list, matches reading order). */}
          <Tabs defaultValue="referees" className="space-y-4">
            {/* มือถือ: เลื่อนแนวนอน (grid 4 ช่องทำให้ป้ายไทยทับกันจนอ่านไม่ออก), เดสก์ท็อปเป็น grid เท่ากันเหมือนเดิม */}
            <TabsList className="w-full flex md:grid md:grid-cols-4 justify-start h-auto rounded-xl p-1">
              <TabsTrigger value="referees" className="shrink-0 text-xs md:text-sm py-2.5 rounded-lg">
                {language === 'th' ? 'รายการผู้แนะนำ' : 'Referees'}
              </TabsTrigger>
              <TabsTrigger value="transfers" className="shrink-0 text-xs md:text-sm py-2.5 rounded-lg">
                {language === 'th' ? 'ประวัติการโอนเงิน' : 'Transfer History'}
              </TabsTrigger>
              <TabsTrigger value="payout" className="shrink-0 text-xs md:text-sm py-2.5 rounded-lg">
                {language === 'th' ? 'วิธีรับเงินค่าคอมมิชชั่น' : 'Payout Method'}
              </TabsTrigger>
              <TabsTrigger value="tax" className="shrink-0 text-xs md:text-sm py-2.5 rounded-lg">
                {language === 'th' ? 'ข้อมูลภาษี' : 'Tax Info'}
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: Referees (list of people who clicked my referral link) */}
            <TabsContent value="referees" className="mt-4">
              <div className="bg-card p-5 rounded-xl border border-border space-y-4">
                {referees.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {language === 'th' ? 'ยังไม่มีผู้แนะนำ' : 'No referees yet'}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {/* Header row: title + count badge */}
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Users className="h-4 w-4 text-[#FFB300]" />
                        {language === 'th' ? 'ผู้แนะนำของฉัน' : 'My Referees'}
                      </h3>
                      <span className="px-2.5 py-0.5 rounded-full bg-[#FFB300]/15 text-[#FFB300] text-xs font-semibold">
                        {referees.length} {t('affiliate.persons')}
                      </span>
                    </div>
                    <Input
                      value={refereeSearch}
                      onChange={(e) => setRefereeSearch(e.target.value)}
                      placeholder={t('affiliate.searchEmail')}
                      className="h-11 md:h-9"
                    />
                    {referees.filter(r => r.email.toLowerCase().includes(refereeSearch.toLowerCase())).map((referee) => (
                      <div key={referee.id} className="flex items-center justify-between text-sm p-2 rounded-lg bg-muted/30">
                        <span className="truncate flex-1">{referee.email}</span>
                        <div className="flex items-center gap-2">
                          {referee.commission_status && (
                            <span className="flex items-center gap-1">
                              {getStatusIcon(referee.commission_status)}
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            referee.has_subscription
                              ? 'bg-green-500/20 text-green-500'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}>
                            {referee.has_subscription ? t('affiliate.subscribed') : t('affiliate.notSubscribed')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tab 3: Payout Method (bank form + warning) */}
            <TabsContent value="payout" className="mt-4">
              <div className="bg-card p-5 rounded-xl border border-border space-y-4">
                {/* Required-info + WHT warning */}
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 space-y-1.5">
                  <p className="text-xs text-yellow-300 flex items-start gap-1.5">
                    <span aria-hidden>⚠️</span>
                    <span>
                      {language === 'th'
                        ? 'เพื่อดำเนินการโอนค่าคอมมิชชั่น โปรดระบุข้อมูลบัญชีธนาคารและเอกสารภาษีให้ครบถ้วนสมบูรณ์'
                        : 'To process commission payments, please provide complete bank account and tax information.'}
                    </span>
                  </p>
                  <p className="text-xs text-yellow-300/80 flex items-start gap-1.5">
                    <span aria-hidden>ℹ️</span>
                    <span>
                      {language === 'th'
                        ? 'ค่าคอมมิชชั่นจะถูกหักภาษี ณ ที่จ่าย 3%'
                        : 'Commission payments are subject to 3% Withholding Tax.'}
                    </span>
                  </p>
                </div>

                {/* Wise option hidden — only Thai bank supported for now.
                    Backend still accepts 'wise' if a user already has it set. */}

                {/* Thai Bank Form — always shown (toggle removed) */}
                <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('affiliate.bankInfoDesc')}
                </p>

                {/* Bank Name Dropdown */}
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('affiliate.bankLabel')}</label>
                  <select
                    value={bankInfo.bank_name}
                    onChange={(e) => setBankInfo({ ...bankInfo, bank_name: e.target.value })}
                    className="w-full p-2 rounded-md border border-border bg-background text-foreground"
                  >
                    <option value="">{t('affiliate.selectBank')}</option>
                    {THAI_BANKS.map((bank) => (
                      <option key={bank.value} value={bank.value}>
                        {bank.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Account Number */}
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('affiliate.accountNumber')}</label>
                  <Input
                    placeholder={t('affiliate.accountNumberPlaceholder')}
                    value={bankInfo.account_number}
                    onChange={(e) => setBankInfo({ ...bankInfo, account_number: e.target.value })}
                  />
                </div>

                {/* Account Holder Name */}
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('affiliate.accountHolder')}</label>
                  <Input
                    placeholder={t('affiliate.accountHolderPlaceholder')}
                    value={bankInfo.account_holder}
                    onChange={(e) => setBankInfo({ ...bankInfo, account_holder: e.target.value })}
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{t('affiliate.phone')}</label>
                  <Input
                    placeholder="08x-xxx-xxxx"
                    value={bankInfo.phone || ''}
                    onChange={(e) => setBankInfo({ ...bankInfo, phone: e.target.value || null })}
                  />
                </div>

                {/* Tax Info Section - Hidden for now, uncomment when needed */}
                {/*
                <div className="border-t border-border pt-4 mt-4 space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {t('affiliate.taxInfoTitle')}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {t('affiliate.taxInfoDesc')}
                  </p>

                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">{t('affiliate.taxId')}</label>
                    <Input
                      placeholder="เลขบัตรประชาชน 13 หลัก"
                      value={bankInfo.tax_id || ''}
                      maxLength={13}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '');
                        setBankInfo({ ...bankInfo, tax_id: value || null });
                      }}
                    />
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">{t('affiliate.taxName')}</label>
                    <Input
                      placeholder="ชื่อ-นามสกุล (ตามบัตรประชาชน)"
                      value={bankInfo.tax_name || ''}
                      onChange={(e) => setBankInfo({ ...bankInfo, tax_name: e.target.value || null })}
                    />
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">{t('affiliate.taxAddress')}</label>
                    <textarea
                      className="w-full p-2 rounded-md border border-border bg-background text-foreground text-sm min-h-[80px]"
                      placeholder="ที่อยู่สำหรับออกหนังสือรับรองหักภาษี ณ ที่จ่าย"
                      value={bankInfo.tax_address || ''}
                      onChange={(e) => setBankInfo({ ...bankInfo, tax_address: e.target.value || null })}
                    />
                  </div>
                </div>
                */}

                {/* Save Button */}
                <Button
                  onClick={handleSaveBankInfo}
                  disabled={bankSaving}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {bankSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {t('affiliate.saveBankInfo')}
                </Button>

                {stats?.thai_bank_info?.bank_name && (
                  <div className="flex items-center gap-2 text-green-500 text-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      {t('affiliate.saved')}: {THAI_BANKS.find(b => b.value === stats.thai_bank_info?.bank_name)?.label || stats.thai_bank_info.bank_name}
                      {stats.thai_bank_info.account_number && ` - ${stats.thai_bank_info.account_number}`}
                    </span>
                  </div>
                )}
                </div>
              </div>
            </TabsContent>

            {/* Tab 4: Tax Info — required for VAT invoice + WHT ภงด.3/53 */}
            <TabsContent value="tax" className="mt-4">
              <TaxInfoSection
                bankInfo={stats?.thai_bank_info ?? null}
                onSaved={() => {
                  (api.getAffiliateStats() as Promise<AffiliateStats>)
                    .then((s) => setStats(s))
                    .catch((err) => console.error('Failed to refresh stats:', err));
                }}
              />
            </TabsContent>

            {/* Tab 2: Transfer History */}
            <TabsContent value="transfers" className="mt-4">
              <div className="bg-card p-5 rounded-xl border border-border space-y-4">
                {transfers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {t('affiliate.noTransfers')}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {transfers.map((transfer) => {
                      const isTransferred = transfer.status === 'transferred';
                      const isVoided = transfer.status === 'cancelled' || transfer.status === 'clawback';
                      const statusColor = isVoided ? 'text-red-400 line-through' : isTransferred ? 'text-green-500' : 'text-yellow-500';
                      const netAmount = transfer.net_amount ?? transfer.amount;
                      const hasFiles = transfer.proof_signed_url || transfer.wht_cert_signed_url;
                      return (
                        <div key={transfer.id} className="p-3 rounded-lg bg-muted/30 border border-border/40 space-y-1.5">
                          {/* Row 1: status (left) + net amount (right) */}
                          <div className="flex items-start justify-between gap-2">
                            <span className={`flex items-center gap-1 text-xs font-medium ${statusColor}`}>
                              {getStatusIcon(transfer.status)}
                              {getStatusText(transfer.status)}
                            </span>
                            <span className={`text-xl font-bold leading-none ${statusColor}`}>
                              {fmt(netAmount)}
                            </span>
                          </div>

                          {/* Row 2: referee email (truncated) + date */}
                          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span className="truncate">{transfer.referee_email}</span>
                            <span className="flex-shrink-0">
                              {formatDate(transfer.transferred_at ?? transfer.created_at)}
                            </span>
                          </div>

                          {/* Row 3: inline breakdown — sale → commission% → WHT → ref → GXVG */}
                          {(transfer.sale_amount || transfer.wht_amount != null || transfer.payment_reference || transfer.gxvg_tokens) && (
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground pt-0.5">
                              {transfer.sale_amount && (
                                <>
                                  <span>{t('affiliate.saleAmount')} <span className="text-foreground">{fmt(transfer.sale_amount)}</span></span>
                                  {transfer.commission_percent && (
                                    <span className="text-green-500">({transfer.commission_percent}%)</span>
                                  )}
                                </>
                              )}
                              {transfer.wht_amount != null && transfer.wht_rate != null && (
                                <>
                                  <span className="opacity-50">·</span>
                                  <span>WHT {transfer.wht_rate}% <span className="text-red-400">−{fmt(transfer.wht_amount)}</span></span>
                                </>
                              )}
                              {transfer.payment_reference && (
                                <>
                                  <span className="opacity-50">·</span>
                                  <span className="font-mono">{transfer.payment_reference}</span>
                                </>
                              )}
                              {transfer.gxvg_tokens && (
                                <>
                                  <span className="opacity-50">·</span>
                                  <span className="text-[#FFB300]">+{transfer.gxvg_tokens.toLocaleString()} GXVG</span>
                                </>
                              )}
                            </div>
                          )}

                          {/* Row 4: pill action buttons */}
                          {hasFiles && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {transfer.proof_signed_url && (
                                <button
                                  disabled={previewLoading}
                                  onClick={() => void openProtectedPreview(
                                    transfer.proof_signed_url!,
                                    language === 'th' ? 'หลักฐานการโอน' : 'Transfer Proof',
                                    `transfer-proof-${transfer.id}`,
                                  )}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#FFB300]/30 text-[11px] text-[#FFB300] hover:bg-[#FFB300]/10 transition-colors disabled:opacity-50"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  {language === 'th' ? 'หลักฐาน' : 'Proof'}
                                </button>
                              )}
                              {transfer.wht_cert_signed_url && (
                                <button
                                  disabled={previewLoading}
                                  onClick={() => void openProtectedPreview(
                                    transfer.wht_cert_signed_url!,
                                    language === 'th' ? 'เอกสารหักภาษี ณ ที่จ่าย (50ทวิ)' : 'WHT Certificate (Form 50bis)',
                                    `wht-cert-${transfer.id}`,
                                  )}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#FFB300]/30 text-[11px] text-[#FFB300] hover:bg-[#FFB300]/10 transition-colors disabled:opacity-50"
                                >
                                  <FileText className="h-3 w-3" />
                                  50ทวิ
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* ตั้งโค้ดแนะนำเอง (custom code) — เปลี่ยนได้ไม่จำกัด โค้ดเก่าใช้ไม่ได้ทันที */}
      <Dialog open={editCodeOpen} onOpenChange={(o) => { if (!codeSaving) setEditCodeOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{language === 'th' ? '✏️ ตั้งโค้ดแนะนำของคุณเอง' : '✏️ Set your own referral code'}</DialogTitle>
          </DialogHeader>
          {(() => {
            const th = language === 'th';
            const hint = newCode ? codeHint(newCode, th) : null;
            const isSame = !!stats?.refcode && newCode === stats.refcode;
            return (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {th
                    ? 'ตั้งโค้ดที่จำง่าย เช่น ชื่อร้านหรือชื่อเล่น — เพื่อนกรอกโค้ดนี้ตอนชำระเงินได้เลย'
                    : 'Pick something easy to remember, like your shop name — friends enter it at checkout.'}
                </p>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">{th ? 'โค้ดใหม่' : 'New code'}</label>
                  <Input
                    value={newCode}
                    onChange={(e) => setNewCode(cleanCodeInput(e.target.value))}
                    maxLength={20}
                    placeholder={th ? 'เช่น somchai-shop' : 'e.g. somchai-shop'}
                    className="h-11 font-mono tracking-wider"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={codeSaving}
                    data-testid="refcode-input"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {th
                      ? 'ใช้ได้ a-z, 0-9 และ - หรือ _ คั่นกลาง · ยาว 4-20 ตัว · ต้องมีตัวอักษรอย่างน้อย 1 ตัว · ระบบแปลงเป็นตัวพิมพ์เล็กให้'
                      : 'a-z, 0-9 and - or _ in the middle · 4-20 characters · at least one letter · stored in lowercase'}
                  </p>
                  {hint && !isSame && (
                    <p className={`text-xs mt-1 ${hint.ok ? 'text-green-500' : 'text-red-400'}`} data-testid="refcode-hint">{hint.text}</p>
                  )}
                  {isSame && (
                    <p className="text-xs mt-1 text-muted-foreground">{th ? 'ยังเป็นโค้ดเดิม' : 'Same as your current code'}</p>
                  )}
                </div>
                {stats?.refcode && newCode && !isSame && (
                  <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-500 leading-relaxed">
                    {th
                      ? <>⚠️ โค้ดเดิม <span className="font-mono font-semibold">{stats.refcode}</span> จะใช้ไม่ได้ทันที — เพื่อนที่มีโค้ด/ลิงก์เก่าต้องใช้โค้ดใหม่ · คำสั่งซื้อที่ส่งไว้แล้วด้วยโค้ดเดิมยังนับเป็นของคุณ · เปลี่ยนได้อีกเมื่อไหร่ก็ได้</>
                      : <>⚠️ Your current code <span className="font-mono font-semibold">{stats.refcode}</span> stops working immediately — friends with the old code/link must use the new one · orders already submitted with the old code still count for you · you can change it again anytime</>}
                  </div>
                )}
                <div className="flex gap-2 justify-end pt-1">
                  <Button variant="outline" onClick={() => setEditCodeOpen(false)} disabled={codeSaving}>
                    {th ? 'ยกเลิก' : 'Cancel'}
                  </Button>
                  <Button
                    onClick={handleSaveCode}
                    disabled={codeSaving || !hint?.ok || isSame}
                    className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
                    data-testid="refcode-save"
                  >
                    {codeSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    {th ? '💾 บันทึกโค้ด' : '💾 Save code'}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* File Preview Dialog — handles both image (proof of transfer) and PDF
          (WHT certificate 50ทวิ). Detects type by URL extension; falls back to
          <img> which gracefully fails to "broken image" if MIME is unexpected. */}
      <Dialog open={!!previewFile} onOpenChange={(o) => { if (!o) closePreview(); }}>
        <DialogContent className="max-w-2xl p-3">
          <DialogHeader>
            <DialogTitle>{previewFile?.title}</DialogTitle>
          </DialogHeader>
          {previewFile && (() => {
            // url เป็น blob (ไม่มีนามสกุล) → ใช้ isPdf ที่อ่านจากชื่อไฟล์ต้นทางตอนเปิด
            const isPdf = previewFile.isPdf;
            return (
              <>
                {isPdf ? (
                  <iframe
                    src={previewFile.url}
                    title={previewFile.title}
                    className="w-full h-[65vh] rounded-lg border border-border bg-white"
                  />
                ) : (
                  <img
                    src={previewFile.url}
                    alt={previewFile.title}
                    className="w-full max-h-[65vh] object-contain rounded-lg"
                  />
                )}
                <div className="flex justify-end pt-2">
                  <a
                    href={previewFile.url}
                    download={previewFile.downloadName}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FFB300] hover:bg-[#FF9D00] text-black text-sm font-semibold transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    {language === 'th' ? 'ดาวน์โหลด' : 'Download'}
                  </a>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Affiliate;
