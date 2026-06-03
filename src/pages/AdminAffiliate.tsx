import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/currency';
import {
  ArrowLeft,
  Users,
  Wallet,
  Settings,
  Loader2,
  Save,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Building2,
  Globe,
  Crown,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AdminTransfer, AdminPendingPayout } from '@/types/affiliate';

// Thai bank list for display
const THAI_BANKS: Record<string, string> = {
  kbank: 'กสิกร',
  scb: 'ไทยพาณิชย์',
  bbl: 'กรุงเทพ',
  ktb: 'กรุงไทย',
  bay: 'กรุงศรี',
  ttb: 'ทหารไทยธนชาต',
  gsb: 'ออมสิน',
  baac: 'ธ.ก.ส.',
  cimb: 'CIMB',
  uob: 'UOB',
  lhbank: 'LH Bank',
  other: 'อื่นๆ',
};

const getBankDisplayName = (bankCode: string) => {
  return THAI_BANKS[bankCode] || bankCode;
};

const AdminAffiliate = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const [announcementSaving, setAnnouncementSaving] = useState(false);

  // Tier settings (percentage-based)
  const [tier1Percent, setTier1Percent] = useState(10);
  const [tier2Percent, setTier2Percent] = useState(15);
  const [tiersSaving, setTiersSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<'pending' | 'transfers'>('pending');
  const [transfers, setTransfers] = useState<AdminTransfer[]>([]);
  const [pendingPayouts, setPendingPayouts] = useState<AdminPendingPayout[]>([]);
  // Transferred payouts — same grouped-by-referrer shape as pending, status=transferred
  const [transferredPayouts, setTransferredPayouts] = useState<AdminPendingPayout[]>([]);
  const [transferFilter, setTransferFilter] = useState<'all' | 'pending' | 'transferred'>('all');
  const [markingPaid, setMarkingPaid] = useState<number | null>(null);

  // Mark as Paid dialog state
  const [markPaidDialogOpen, setMarkPaidDialogOpen] = useState(false);
  const [selectedPayout, setSelectedPayout] = useState<AdminPendingPayout | null>(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  // Proof upload state
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofSignedUrl, setProofSignedUrl] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [previewProofUrl, setPreviewProofUrl] = useState<string | null>(null);
  // ID card preview — blob URL from authed proxy fetch (separate from proof
  // dialog because blob URLs lack a .pdf extension → use <iframe> for both).
  const [idCardPreviewUrl, setIdCardPreviewUrl] = useState<string | null>(null);
  const [idCardLoading, setIdCardLoading] = useState<number | null>(null);

  // WHT certificate (50ทวิ) upload state — mirrors proof upload pattern
  const [whtCertFile, setWhtCertFile] = useState<File | null>(null);
  const [whtCertUrl, setWhtCertUrl] = useState<string | null>(null);
  const [whtCertSignedUrl, setWhtCertSignedUrl] = useState<string | null>(null);
  const [whtCertUploading, setWhtCertUploading] = useState(false);

  // Expanded payout details
  // Keyed by card key (referrer_id for pending, group_key for transferred)
  const [expandedPayouts, setExpandedPayouts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.isAdmin) {
      navigate('/');
      return;
    }
    loadData();
  }, [user, navigate]);

  const loadData = async () => {
    try {
      const [announcementRes, tiersRes, transfersRes, pendingRes, transferredRes] = await Promise.all([
        api.getAffiliateAnnouncement(),
        api.getAdminTiers(),
        api.getAdminTransfers(),
        api.getAdminPendingPayouts(),
        api.getAdminPendingPayouts('transferred'),
      ]);

      setAnnouncement(announcementRes.announcement || '');
      setTier1Percent(tiersRes.tier1_percent || 10);
      setTier2Percent(tiersRes.tier2_percent || 15);
      setTransfers(transfersRes.transfers || []);
      setPendingPayouts(pendingRes.pending_payouts || []);
      setTransferredPayouts(transferredRes.pending_payouts || []);
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error('Failed to load affiliate data');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAnnouncement = async () => {
    setAnnouncementSaving(true);
    try {
      await api.updateAdminAffiliateAnnouncement(announcement);
      toast.success('Announcement saved');
    } catch (error) {
      toast.error('Failed to save announcement');
    } finally {
      setAnnouncementSaving(false);
    }
  };

  const handleSaveTiers = async () => {
    setTiersSaving(true);
    try {
      const res = await api.updateTiers(tier1Percent, tier2Percent);
      toast.success(`Commission tiers updated (Tier1: ${res.tier1_updated}, Tier2: ${res.tier2_updated} users)`);
    } catch (error) {
      toast.error('Failed to update tiers');
    } finally {
      setTiersSaving(false);
    }
  };

  const openMarkPaidDialog = (payout: AdminPendingPayout) => {
    setSelectedPayout(payout);
    setPaymentReference('');
    setPaymentNotes('');
    setProofFile(null);
    setProofUrl(null);
    setProofSignedUrl(null);
    setWhtCertFile(null);
    setWhtCertUrl(null);
    setWhtCertSignedUrl(null);
    setMarkPaidDialogOpen(true);
  };

  const handleProofUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB');
      return;
    }

    setProofFile(file);
    setProofUploading(true);

    try {
      const result = await api.uploadPaymentProof(file);
      setProofUrl(result.url);
      setProofSignedUrl(result.signed_url);
      toast.success('Uploaded successfully');
    } catch (error: any) {
      toast.error(error.message || 'Upload failed');
      setProofFile(null);
    } finally {
      setProofUploading(false);
    }
  };

  // Reuses the same /upload-proof endpoint as proof of transfer — backend
  // doesn't care what the file represents, only the S3 key gets stored in
  // a different column (wht_cert_url) when we call adminMarkAsPaid.
  const handleWhtCertUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB');
      return;
    }

    setWhtCertFile(file);
    setWhtCertUploading(true);

    try {
      const result = await api.uploadPaymentProof(file);
      setWhtCertUrl(result.url);
      setWhtCertSignedUrl(result.signed_url);
      toast.success('Uploaded successfully');
    } catch (error: any) {
      toast.error(error.message || 'Upload failed');
      setWhtCertFile(null);
    } finally {
      setWhtCertUploading(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!selectedPayout) return;

    setMarkingPaid(selectedPayout.referrer_id);
    try {
      const res = await api.adminMarkAsPaid(
        selectedPayout.referrer_id,
        paymentReference.trim(),  // empty string OK — backend treats as null
        paymentNotes.trim() || undefined,
        proofUrl || undefined,
        whtCertUrl || undefined,
      );
      toast.success(`Marked ${res.commission_count} commissions as paid`);
      setMarkPaidDialogOpen(false);
      // Reload data
      const [transfersRes, pendingRes, transferredRes] = await Promise.all([
        api.getAdminTransfers(),
        api.getAdminPendingPayouts(),
        api.getAdminPendingPayouts('transferred'),
      ]);
      setTransfers(transfersRes.transfers || []);
      setPendingPayouts(pendingRes.pending_payouts || []);
      setTransferredPayouts(transferredRes.pending_payouts || []);
    } catch (error: any) {
      toast.error(error.message || 'Failed to mark as paid');
    } finally {
      setMarkingPaid(null);
    }
  };

  const handleCopyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleViewIdCard = async (payout: AdminPendingPayout) => {
    const path = payout.thai_bank_info?.id_card_preview_path;
    if (!path) {
      toast.error('ลูกค้ายังไม่ได้อัปโหลดสำเนาบัตรประชาชน');
      return;
    }
    setIdCardLoading(payout.referrer_id);
    try {
      const url = await api.getIdCardPreviewBlobUrl(path);
      if (!url) {
        toast.error('ไม่พบไฟล์สำเนาบัตรประชาชน');
        return;
      }
      setIdCardPreviewUrl(url);
    } catch (err: any) {
      toast.error(err?.message || 'เปิดสำเนาบัตรไม่สำเร็จ');
    } finally {
      setIdCardLoading(null);
    }
  };

  const closeIdCardPreview = () => {
    if (idCardPreviewUrl) URL.revokeObjectURL(idCardPreviewUrl);
    setIdCardPreviewUrl(null);
  };

  // Use THB for all amounts (admin is Thailand-based)
  const fmt = (amount: number) => formatCurrency(amount, 'THB');

  // Shared payout card — used by BOTH Pending & Transfers tabs (same layout,
  // grouped by referrer). mode='pending' → จ่ายเงิน button + id-card docs.
  // mode='transferred' → "จ่ายแล้ว" badge, no pay button, no uploaded docs.
  const renderPayoutCard = (payout: AdminPendingPayout, mode: 'pending' | 'transferred') => {
    const cardKey = payout.group_key ?? String(payout.referrer_id);
    const isExpanded = expandedPayouts.has(cardKey);
    const isPending = mode === 'pending';
    const t = payout.thai_bank_info;
    const isJuristic = t?.entity_type === 'juristic';
    const addr = [t?.address_line, t?.subdistrict, t?.district, t?.province, t?.postal_code]
      .filter(Boolean).join(' ');
    const incomplete = !t?.tax_id || !t?.tax_name;
    return (
      <div
        key={cardKey}
        className={`p-4 rounded-lg border ${
          isPending ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-green-500/30 bg-green-500/5'
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <p className="font-medium">{payout.referrer_email}</p>

            {/* Payment method badge (Thai bank หลัก) */}
            <div className="flex items-center gap-1 mb-2">
              {t?.bank_name ? (
                <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                  <Building2 className="h-3 w-3 inline mr-1" />ธนาคารไทย
                </span>
              ) : payout.wise_email ? (
                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  <Globe className="h-3 w-3 inline mr-1" />Wise (สำรอง)
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {t?.bank_name && (
                <div className="text-xs space-y-0.5">
                  <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/20 text-blue-400">
                    <Building2 className="h-3 w-3" />
                    <span>{getBankDisplayName(t.bank_name)}</span>
                    <span className="font-mono">{t.account_number}</span>
                  </div>
                  <div className="text-muted-foreground px-2">
                    ชื่อบัญชี: {t.account_holder}
                    {t.branch && <> | สาขา: {t.branch}</>}
                    {t.phone && <> | โทร: {t.phone}</>}
                  </div>
                </div>
              )}

              {payout.wise_email && !t?.bank_name && (
                <button
                  onClick={() => handleCopyEmail(payout.wise_email!)}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
                >
                  {copiedEmail === payout.wise_email ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  Wise: {payout.wise_email}
                </button>
              )}

              {!t?.bank_name && !payout.wise_email && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-500">
                  ยังไม่ได้ตั้งค่าบัญชีรับเงิน
                </span>
              )}

              <button
                onClick={() => togglePayoutExpanded(cardKey)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {payout.pending_count} รายการ
              </button>
            </div>

            <p className={`text-lg font-bold mt-2 ${isPending ? 'text-green-500' : 'text-green-500'}`}>
              {fmt(payout.pending_net ?? payout.pending_amount)}
              <span className="text-xs text-muted-foreground ml-1">สุทธิ</span>
            </p>
            {payout.pending_wht != null && payout.pending_wht > 0 && (
              <p className="text-[11px] text-muted-foreground">
                ยอดเต็ม {fmt(payout.pending_gross ?? payout.pending_amount)} − หัก ณ ที่จ่าย 3% ({fmt(payout.pending_wht)})
              </p>
            )}
            {!isPending && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                จ่ายเมื่อ {payout.transferred_at ? formatDate(payout.transferred_at) : '—'}
                {payout.payment_reference && <> · อ้างอิง: {payout.payment_reference}</>}
                {payout.admin_notes && <> · หมายเหตุ: {payout.admin_notes}</>}
              </p>
            )}
          </div>

          {isPending ? (
            <Button
              onClick={() => openMarkPaidDialog(payout)}
              disabled={markingPaid === payout.referrer_id}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {markingPaid === payout.referrer_id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  จ่ายเงิน
                </>
              )}
            </Button>
          ) : (
            <span className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-green-500/20 text-green-500 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              จ่ายแล้ว
            </span>
          )}
        </div>

        {/* รายละเอียด Commission */}
        {isExpanded && payout.details && payout.details.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border/40 space-y-2">
            <div className="grid grid-cols-5 gap-2 text-xs font-medium text-muted-foreground px-2">
              <span>อีเมลผู้ถูกแนะนำ</span>
              <span className="text-right">ยอดขาย</span>
              <span className="text-right">ยอดเต็ม</span>
              <span className="text-right">หัก ณ ที่จ่าย</span>
              <span className="text-right">สุทธิ</span>
            </div>
            {payout.details.map((detail) => (
              <div key={detail.id} className="grid grid-cols-5 gap-2 text-xs px-2 py-1 rounded bg-muted/30">
                <span className="truncate">{detail.referee_email}</span>
                <span className="text-right">{detail.sale_amount ? fmt(detail.sale_amount) : '-'}</span>
                <span className="text-right text-yellow-500">{fmt(detail.amount)}</span>
                <span className="text-right text-red-400">
                  {detail.wht_amount != null ? fmt(detail.wht_amount) : '-'}
                </span>
                <span className="text-right text-green-500 font-semibold">
                  {fmt(detail.net_amount ?? detail.amount)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Tax info — สำหรับออกใบ 50ทวิ. โหมด transferred ไม่แสดงเอกสารที่ upload */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-border/40 space-y-1.5 text-xs">
            <p className="font-medium text-muted-foreground">
              ข้อมูลภาษี (สำหรับออกใบหัก ณ ที่จ่าย 50ทวิ)
            </p>
            {incomplete && (
              <p className="px-2 py-1 rounded bg-yellow-500/15 text-yellow-500">
                ⚠️ ลูกค้ายังกรอกข้อมูลภาษีไม่ครบ — ตรวจสอบก่อนออกใบ
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span>
                <span className="text-muted-foreground">ประเภท: </span>
                {t?.entity_type ? (isJuristic ? 'นิติบุคคล (ภงด.53)' : 'บุคคลธรรมดา (ภงด.3)') : '—'}
              </span>
              <span>
                <span className="text-muted-foreground">ชื่อ: </span>
                {[t?.title_prefix, t?.tax_name].filter(Boolean).join(' ') || '—'}
              </span>
              <span>
                <span className="text-muted-foreground">เลขผู้เสียภาษี: </span>
                <span className="font-mono">{t?.tax_id || '—'}</span>
              </span>
              {isJuristic && (
                <span>
                  <span className="text-muted-foreground">สาขา: </span>
                  {t?.tax_branch || '—'}
                </span>
              )}
              <span className="col-span-2">
                <span className="text-muted-foreground">ที่อยู่: </span>
                {addr || '—'}
              </span>
            </div>
            <div className="pt-1">
              {t?.id_card_preview_path ? (
                <button
                  onClick={() => handleViewIdCard(payout)}
                  disabled={idCardLoading === payout.referrer_id}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50"
                >
                  {idCardLoading === payout.referrer_id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Eye className="h-3 w-3" />}
                  ดูสำเนาบัตรประชาชน
                  {t.id_card_uploaded_at && (
                    <span className="text-muted-foreground ml-1">
                      ({new Date(t.id_card_uploaded_at).toLocaleDateString('th-TH')})
                    </span>
                  )}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-yellow-500/15 text-yellow-500 font-medium">
                  ⚠️ ลูกค้ายังไม่ได้อัปโหลดสำเนาบัตรประชาชน
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const togglePayoutExpanded = (cardKey: string) => {
    setExpandedPayouts(prev => {
      const next = new Set(prev);
      if (next.has(cardKey)) {
        next.delete(cardKey);
      } else {
        next.add(cardKey);
      }
      return next;
    });
  };

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

  const filteredTransfers = transfers.filter(t =>
    transferFilter === 'all' ? true : t.status === transferFilter
  );

  // Stats
  const totalTransferred = transfers
    .filter(t => t.status === 'transferred')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalPending = transfers
    .filter(t => t.status === 'pending')
    .reduce((sum, t) => sum + t.amount, 0);

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
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Users className="h-6 w-6 text-[#FFB300]" />
                Affiliate Management
              </h1>
              <p className="text-muted-foreground">Wise Manual Payout</p>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card p-4 rounded-xl border border-border text-center">
              <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto mb-2" />
              <div className="text-xl font-bold text-green-500">{fmt(totalTransferred)}</div>
              <div className="text-xs text-muted-foreground">โอนแล้ว</div>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border text-center">
              <Clock className="h-5 w-5 text-yellow-500 mx-auto mb-2" />
              <div className="text-xl font-bold text-yellow-500">{fmt(totalPending)}</div>
              <div className="text-xs text-muted-foreground">รอโอน</div>
            </div>
          </div>

          {/* Announcement */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Announcement
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                className="w-full min-h-[100px] p-3 rounded-lg bg-muted/50 border border-border resize-y"
                placeholder="Enter affiliate program announcement..."
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
              />
              <Button
                onClick={handleSaveAnnouncement}
                disabled={announcementSaving}
                className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
              >
                {announcementSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </CardContent>
          </Card>

          {/* Commission Tiers — moved to /admin → Tiers tab.
              N-tier CRUD lives there (admin can add Tier 3, 4, 5, …).
              Old 2-tier widget removed to avoid stale state. */}

          {/* Referrers & Transfers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Affiliate Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Tabs */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant={activeTab === 'pending' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveTab('pending')}
                  className={activeTab === 'pending' ? 'bg-[#FFB300] text-black hover:bg-[#FFB300]/90' : ''}
                >
                  รอจ่าย ({pendingPayouts.length})
                </Button>
                <Button
                  variant={activeTab === 'transfers' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveTab('transfers')}
                  className={activeTab === 'transfers' ? 'bg-[#FFB300] text-black hover:bg-[#FFB300]/90' : ''}
                >
                  จ่ายแล้ว ({transferredPayouts.length})
                </Button>
              </div>

              {/* Pending Payouts Tab */}
              {activeTab === 'pending' && (
                <div className="space-y-3">
                  {pendingPayouts.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      ไม่มีรายการรอจ่าย
                    </p>
                  ) : (
                    pendingPayouts.map((payout) => renderPayoutCard(payout, 'pending'))
                  )}
                </div>
              )}

              {activeTab === 'transfers' && (
                <div className="space-y-3">
                  {transferredPayouts.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      ไม่มีรายการที่จ่ายแล้ว
                    </p>
                  ) : (
                    transferredPayouts.map((payout) => renderPayoutCard(payout, 'transferred'))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* File Preview Dialog — handles both image and PDF. Auto-detects type
          from URL extension (strips ?query first since signed URLs append
          ?X-Amz-... params). Includes Download button. */}
      <Dialog open={!!previewProofUrl} onOpenChange={() => setPreviewProofUrl(null)}>
        <DialogContent className="max-w-2xl p-3">
          <DialogHeader>
            <DialogTitle>ดูเอกสาร</DialogTitle>
          </DialogHeader>
          {previewProofUrl && (() => {
            const cleanUrl = previewProofUrl.split('?')[0].toLowerCase();
            const isPdf = cleanUrl.endsWith('.pdf');
            return (
              <>
                {isPdf ? (
                  <iframe
                    src={previewProofUrl}
                    title="File preview"
                    className="w-full h-[65vh] rounded-lg border border-border bg-white"
                  />
                ) : (
                  <img
                    src={previewProofUrl}
                    alt="File preview"
                    className="w-full max-h-[65vh] object-contain rounded-lg"
                  />
                )}
                <div className="flex justify-end pt-2">
                  <a
                    href={previewProofUrl}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FFB300] hover:bg-[#FF9D00] text-black text-sm font-semibold transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    ดาวน์โหลด
                  </a>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ID Card Preview — blob URL (no extension) so always use <iframe>;
          works for both image and PDF. Revoke object URL on close. */}
      <Dialog open={!!idCardPreviewUrl} onOpenChange={(o) => { if (!o) closeIdCardPreview(); }}>
        <DialogContent className="max-w-2xl p-3">
          <DialogHeader>
            <DialogTitle>สำเนาบัตรประชาชน</DialogTitle>
          </DialogHeader>
          {idCardPreviewUrl && (
            <>
              <iframe
                src={idCardPreviewUrl}
                title="ID card preview"
                className="w-full h-[70vh] rounded-lg border border-border bg-white"
              />
              <div className="flex justify-end pt-2">
                <a
                  href={idCardPreviewUrl}
                  download="id-card"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FFB300] hover:bg-[#FF9D00] text-black text-sm font-semibold transition-colors"
                >
                  <Download className="h-4 w-4" />
                  ดาวน์โหลด
                </a>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Mark as Paid Dialog */}
      <Dialog open={markPaidDialogOpen} onOpenChange={setMarkPaidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันการจ่ายเงิน</DialogTitle>
          </DialogHeader>
          {selectedPayout && (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="text-muted-foreground">ผู้รับเงิน:</span> {selectedPayout.referrer_email}
                </p>
                {selectedPayout.wise_email && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">อีเมล Wise:</span> {selectedPayout.wise_email}
                  </p>
                )}
                {/* Tax breakdown — net is what we actually transfer */}
                <div className="bg-muted/40 rounded-lg p-3 space-y-1 text-sm">
                  {selectedPayout.pending_wht != null && selectedPayout.pending_wht > 0 ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ยอดคอมมิชชั่นเต็ม ({selectedPayout.pending_count} รายการ)</span>
                        <span>{fmt(selectedPayout.pending_gross ?? selectedPayout.pending_amount)}</span>
                      </div>
                      <div className="flex justify-between text-red-400">
                        <span>− หัก ณ ที่จ่าย 3%</span>
                        <span>−{fmt(selectedPayout.pending_wht)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-green-500 pt-1 border-t border-border/50">
                        <span>ยอดจ่ายจริง</span>
                        <span>{fmt(selectedPayout.pending_net ?? selectedPayout.pending_amount)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-yellow-500">
                      ยอดจ่าย: {fmt(selectedPayout.pending_amount)} ({selectedPayout.pending_count} รายการ)
                    </p>
                  )}
                </div>
                {selectedPayout.pending_wht != null && selectedPayout.pending_wht > 0 && (
                  <p className="text-[11px] text-yellow-500 bg-yellow-500/10 border border-yellow-500/30 rounded px-2 py-1">
                    ⚠️ แนบเอกสาร 50ทวิ ด้านล่างเพื่อให้ผู้รับเงินดาวน์โหลดได้เอง (
                    {selectedPayout.thai_bank_info?.entity_type === 'juristic' ? 'ภงด.53' : 'ภงด.3'})
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">เลขอ้างอิงการโอน (ไม่บังคับ)</label>
                <Input
                  placeholder="P123456789"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">หมายเหตุ (ไม่บังคับ)</label>
                <Input
                  placeholder="หมายเหตุเพิ่มเติม..."
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">หลักฐานการโอน (ไม่บังคับ)</label>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleProofUpload}
                  disabled={proofUploading}
                  className="cursor-pointer"
                />
                {proofUploading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    กำลังอัปโหลด...
                  </div>
                )}
                {proofUrl && !proofUploading && (
                  <div className="flex items-center gap-2 text-sm text-green-500">
                    <CheckCircle2 className="h-4 w-4" />
                    {proofFile?.type?.includes('pdf') ? 'อัปโหลด PDF แล้ว' : 'อัปโหลดรูปแล้ว'}
                    {proofSignedUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewProofUrl(proofSignedUrl)}
                        className="underline hover:text-green-400"
                      >
                        ดูตัวอย่าง
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* WHT certificate (50ทวิ) upload — separate file slot. User can
                  download it from /affiliate Transfer History after we save. */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  หนังสือรับรองหักภาษี ณ ที่จ่าย (50ทวิ) (ไม่บังคับ)
                </label>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleWhtCertUpload}
                  disabled={whtCertUploading}
                  className="cursor-pointer"
                />
                <p className="text-[11px] text-muted-foreground">แนบไฟล์ PDF/รูปภาพ ≤ 5 MB</p>
                {whtCertUploading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    กำลังอัปโหลด...
                  </div>
                )}
                {whtCertUrl && !whtCertUploading && (
                  <div className="flex items-center gap-2 text-sm text-green-500">
                    <CheckCircle2 className="h-4 w-4" />
                    {whtCertFile?.type?.includes('pdf') ? 'อัปโหลด PDF แล้ว' : 'อัปโหลดรูปแล้ว'}
                    {whtCertSignedUrl && (
                      <button
                        type="button"
                        onClick={() => setPreviewProofUrl(whtCertSignedUrl)}
                        className="underline hover:text-green-400"
                      >
                        ดูตัวอย่าง
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              onClick={handleMarkAsPaid}
              disabled={markingPaid !== null}
              className="bg-green-600 hover:bg-green-700"
            >
              {markingPaid !== null ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'ยืนยันการจ่ายเงิน'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminAffiliate;
