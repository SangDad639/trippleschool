import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type EbookDto, type EbookPurchaseAdminDto } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  Check,
  X,
  BookMarked,
  Clock,
  CheckCircle,
  XCircle,
  ArrowLeft,
  RefreshCcw,
  Image as ImageIcon,
  Search,
  Undo2,
} from 'lucide-react';

interface Stats {
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  total_count: number;
}

// อนุมัติการซื้อ Ebook รายเล่ม (/admin/ebook-purchases) — โครงเดียวกับหน้า
// อนุมัติสมัครเรียน (AdminEnrollments) ตัดส่วน progress/bulk ออก:
// stat cards + filter (สถานะ/เล่ม/อีเมล) + ตาราง + อนุมัติ/ปฏิเสธ/เพิกถอน + ดูสลิป
const AdminEbookPurchases = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<EbookPurchaseAdminDto[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [ebooks, setEbooks] = useState<EbookDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState('pending');
  const [ebookFilter, setEbookFilter] = useState('all');
  const [emailSearch, setEmailSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Reject / revoke dialog
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<EbookPurchaseAdminDto | null>(null);
  const [actionMode, setActionMode] = useState<'reject' | 'revoke'>('reject');
  const [actionReason, setActionReason] = useState('');
  const [processing, setProcessing] = useState(false);

  // Slip preview dialog
  const [slipPreviewOpen, setSlipPreviewOpen] = useState(false);
  const [previewSlipUrl, setPreviewSlipUrl] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(emailSearch.trim()), 400);
    return () => clearTimeout(t);
  }, [emailSearch]);

  useEffect(() => {
    if (!user?.isAdmin) return;
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, statusFilter, ebookFilter, debouncedSearch, page]);

  useEffect(() => {
    if (!user?.isAdmin) return;
    void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadMeta = async () => {
    try {
      const [s, eb] = await Promise.all([api.getEbookPurchaseStats(), api.getAdminEbooks()]);
      setStats({
        pending_count: Number(s.pending_count),
        approved_count: Number(s.approved_count),
        rejected_count: Number(s.rejected_count),
        total_count: Number(s.total_count),
      });
      setEbooks(eb);
    } catch (e: any) {
      toast.error(e?.message || 'โหลดข้อมูลไม่สำเร็จ');
    }
  };

  const loadList = async () => {
    try {
      setLoading(true);
      const r = await api.getAdminEbookPurchases({
        status: statusFilter === 'all' ? undefined : statusFilter,
        ebook_id: ebookFilter === 'all' ? undefined : Number(ebookFilter),
        search: debouncedSearch || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setPurchases(r.purchases);
      setTotal(r.total);
    } catch (e: any) {
      toast.error(e?.message || 'โหลดรายการซื้อไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    void loadList();
    void loadMeta();
  };

  const handleApprove = async (p: EbookPurchaseAdminDto) => {
    try {
      setProcessing(true);
      await api.approveEbookPurchase(p.id);
      toast.success(`อนุมัติ "${p.ebook_title}" ให้ ${p.user_email} แล้ว`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'อนุมัติไม่สำเร็จ');
    } finally {
      setProcessing(false);
    }
  };

  const openAction = (p: EbookPurchaseAdminDto, mode: 'reject' | 'revoke') => {
    setActionTarget(p);
    setActionMode(mode);
    setActionReason('');
    setActionDialogOpen(true);
  };

  const handleConfirmAction = async () => {
    if (!actionTarget) return;
    try {
      setProcessing(true);
      if (actionMode === 'reject') {
        await api.rejectEbookPurchase(actionTarget.id, actionReason || undefined);
        toast.success('ปฏิเสธคำสั่งซื้อแล้ว');
      } else {
        await api.revokeEbookPurchase(actionTarget.id, actionReason || undefined);
        toast.success('เพิกถอนสิทธิ์แล้ว');
      }
      setActionDialogOpen(false);
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'ดำเนินการไม่สำเร็จ');
    } finally {
      setProcessing(false);
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'approved') return <Badge className="bg-green-600/20 text-green-400 border border-green-600/40">อนุมัติแล้ว</Badge>;
    if (status === 'rejected') return <Badge className="bg-red-600/20 text-red-400 border border-red-600/40">ปฏิเสธ</Badge>;
    return <Badge className="bg-yellow-600/20 text-yellow-400 border border-yellow-600/40">รออนุมัติ</Badge>;
  };

  if (!user?.isAdmin) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึง</div>;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Button variant="ghost" onClick={() => navigate('/admin')} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          กลับ
        </Button>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <BookMarked className="h-6 w-6 text-[#FFB300]" />
              อนุมัติการซื้อ Ebook
            </h1>
            <p className="text-gray-400">ตรวจสลิปการซื้อ Ebook รายเล่ม — อนุมัติแล้วผู้ซื้ออ่าน/ดาวน์โหลดได้ทันที</p>
          </div>
          <Button variant="outline" onClick={refresh}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            รีเฟรช
          </Button>
        </div>

        {/* Stat cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'รออนุมัติ', value: stats.pending_count, icon: Clock, tone: 'text-yellow-400' },
              { label: 'อนุมัติแล้ว', value: stats.approved_count, icon: CheckCircle, tone: 'text-green-400' },
              { label: 'ปฏิเสธ', value: stats.rejected_count, icon: XCircle, tone: 'text-red-400' },
              { label: 'ทั้งหมด', value: stats.total_count, icon: BookMarked, tone: 'text-gray-300' },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="py-4 flex items-center gap-3">
                  <s.icon className={`h-6 w-6 ${s.tone}`} />
                  <div>
                    <p className="text-xl font-bold text-white leading-none">{s.value}</p>
                    <p className="text-gray-400 text-xs mt-1">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">รออนุมัติ</SelectItem>
              <SelectItem value="approved">อนุมัติแล้ว</SelectItem>
              <SelectItem value="rejected">ปฏิเสธ</SelectItem>
              <SelectItem value="all">ทุกสถานะ</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ebookFilter} onValueChange={(v) => { setEbookFilter(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกเล่ม</SelectItem>
              {ebooks.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>{e.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <Input
              value={emailSearch}
              onChange={(e) => { setEmailSearch(e.target.value); setPage(1); }}
              placeholder="ค้นหาอีเมลผู้ซื้อ..."
              className="pl-8"
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#FFB300]" />
          </div>
        ) : purchases.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-400">ไม่มีรายการในเงื่อนไขนี้</CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border border-gray-800 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ผู้ซื้อ</TableHead>
                  <TableHead>Ebook</TableHead>
                  <TableHead className="text-right">ยอดโอน</TableHead>
                  <TableHead>สลิป</TableHead>
                  <TableHead>วันที่</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[220px]">
                      <p className="text-white text-sm truncate">{p.user_email}</p>
                      {p.refcode && (
                        <p className="text-xs text-green-400/80 font-mono">🎟️ {p.refcode}</p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="text-sm truncate">{p.ebook_title}</p>
                      <p className="text-xs text-gray-500">ราคาปัจจุบัน ฿{Number(p.price).toLocaleString()}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      {/* ยอด ณ ตอนสั่ง (snapshot) — ราคาเล่มเปลี่ยนทีหลังไม่กระทบ */}
                      <span className="text-[#FFB300] font-semibold">
                        ฿{Number(p.paid_amount ?? p.price).toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      {p.slip_url ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setPreviewSlipUrl(api.mediaUrl(p.slip_url!)); setSlipPreviewOpen(true); }}
                        >
                          <ImageIcon className="h-4 w-4 mr-1.5" />
                          ดูสลิป
                        </Button>
                      ) : (
                        <span className="text-gray-600 text-xs">ไม่มีสลิป</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-gray-400 whitespace-nowrap">
                      {new Date(p.updated_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </TableCell>
                    <TableCell>
                      {statusBadge(p.status)}
                      {p.status === 'rejected' && p.rejection_reason && (
                        <p className="text-xs text-red-400/70 mt-1 max-w-[160px] truncate" title={p.rejection_reason}>{p.rejection_reason}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {p.status === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 mr-1.5"
                            disabled={processing}
                            onClick={() => handleApprove(p)}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            อนุมัติ
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-400 border-red-500/40 hover:bg-red-500/10" disabled={processing} onClick={() => openAction(p, 'reject')}>
                            <X className="h-4 w-4 mr-1" />
                            ปฏิเสธ
                          </Button>
                        </>
                      )}
                      {p.status === 'approved' && (
                        <Button size="sm" variant="outline" className="text-red-400 border-red-500/40 hover:bg-red-500/10" disabled={processing} onClick={() => openAction(p, 'revoke')}>
                          <Undo2 className="h-4 w-4 mr-1" />
                          เพิกถอน
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</Button>
            <span className="text-sm text-gray-400">หน้า {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>ถัดไป</Button>
          </div>
        )}
      </div>

      {/* Reject / revoke dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={(o) => !processing && setActionDialogOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionMode === 'reject' ? 'ปฏิเสธคำสั่งซื้อ' : 'เพิกถอนสิทธิ์'} — {actionTarget?.ebook_title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-gray-400">
              ผู้ซื้อ: <span className="text-white">{actionTarget?.user_email}</span>
            </p>
            <Textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              rows={3}
              placeholder="เหตุผล (ผู้ซื้อจะเห็นข้อความนี้) — ไม่บังคับ"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialogOpen(false)} disabled={processing}>ยกเลิก</Button>
            <Button onClick={handleConfirmAction} disabled={processing} className="bg-red-600 hover:bg-red-700">
              {processing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {actionMode === 'reject' ? 'ยืนยันปฏิเสธ' : 'ยืนยันเพิกถอน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Slip preview */}
      <Dialog open={slipPreviewOpen} onOpenChange={setSlipPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>สลิปการโอนเงิน</DialogTitle>
          </DialogHeader>
          {previewSlipUrl && (
            <img src={previewSlipUrl} alt="สลิปการโอนเงิน" className="max-h-[70vh] w-full object-contain rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminEbookPurchases;
