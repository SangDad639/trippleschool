import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  FileText, Loader2, Upload, X, Eye, Clock, CheckCircle2, XCircle, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import type { AdminTaxInvoiceRequest, AdminTaxInvoiceListResponse, InvoiceStatus } from '@/types/payment';

/**
 * Admin tab — ใบกำกับภาษี (Tax Invoices).
 *
 * Lists user-submitted invoice requests with the user's saved tax info (so
 * admin can prepare the PDF without context-switching). Per-row actions:
 *   • pending  → [Upload file] / [Reject + reason]
 *   • issued   → [View] / [Replace file]
 *   • rejected → [View reason] (immutable — 1 invoice / 1 row ตลอดชีพ)
 *
 * Schema: migration 013_tax_invoice_requests
 */

type StatusFilter = 'all' | InvoiceStatus;

export default function AdminTaxInvoicesPanel() {
  const { language } = useLanguage();
  const isTh = language === 'th';
  const l = (th: string, en: string) => (isTh ? th : en);

  const [rows, setRows] = useState<AdminTaxInvoiceRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Admin opens straight to "pending" — main task is to issue invoices.
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [searchInput, setSearchInput] = useState('');
  const [searchActive, setSearchActive] = useState('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<AdminTaxInvoiceRequest | null>(null);

  // Reject dialog
  const [rejecting, setRejecting] = useState<AdminTaxInvoiceRequest | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);

  // Preview dialog
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = (await api.listTaxInvoiceRequests({
        status: status as any,
        q: searchActive,
        limit,
        offset,
      })) as AdminTaxInvoiceListResponse;
      setRows(res.requests || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error('Load invoice requests:', err);
      toast.error(l('โหลดคำขอไม่สำเร็จ', 'Failed to load invoice requests'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, searchActive, offset]);

  const onSearch = () => { setOffset(0); setSearchActive(searchInput.trim()); };

  const handlePickFile = (row: AdminTaxInvoiceRequest) => {
    setUploadTarget(row);
    // Trigger the hidden input — uploadTarget tells handleFileChange which row
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be picked again
    if (!file || !uploadTarget) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(l('ไฟล์ใหญ่เกิน 10MB', 'File too large (max 10MB)'));
      return;
    }
    setUploadingId(uploadTarget.id);
    try {
      await api.uploadTaxInvoice(uploadTarget.id, file);
      toast.success(l('อัปโหลดใบกำกับสำเร็จ', 'Invoice uploaded'));
      setUploadTarget(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || l('อัปโหลดไม่สำเร็จ', 'Upload failed'));
    } finally {
      setUploadingId(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejecting) return;
    if (!rejectNotes.trim()) {
      toast.error(l('โปรดระบุเหตุผล', 'Please provide a reason'));
      return;
    }
    setRejectBusy(true);
    try {
      await api.rejectTaxInvoice(rejecting.id, rejectNotes.trim());
      toast.success(l('ปฏิเสธคำขอแล้ว', 'Request rejected'));
      setRejecting(null);
      setRejectNotes('');
      await load();
    } catch (err: any) {
      const code = (err?.errorCode || err?.code || err?.message || '').toString();
      const msg = code.includes('already_issued')
        ? l('คำขอนี้ออกใบไปแล้ว ปฏิเสธไม่ได้', 'This request was already issued — cannot reject')
        : (err?.message || l('ปฏิเสธไม่สำเร็จ', 'Reject failed'));
      toast.error(msg);
    } finally {
      setRejectBusy(false);
    }
  };

  const handlePreview = async (requestId: number) => {
    setPreviewLoading(true);
    try {
      const blobUrl = await api.getAdminInvoicePreviewBlobUrl(requestId);
      if (!blobUrl) {
        toast.error(l('ยังไม่มีไฟล์ใบกำกับ', 'No invoice file available'));
        return;
      }
      const resp = await fetch(blobUrl);
      const blob = await resp.blob();
      setPreviewMime(blob.type || 'application/pdf');
      setPreviewUrl(blobUrl);
    } catch (err: any) {
      toast.error(err?.message || l('เปิดไฟล์ไม่สำเร็จ', 'Failed to open file'));
    } finally {
      setPreviewLoading(false);
    }
  };
  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewMime('');
  };

  const statusLabel = useMemo(() => ({
    all:      l('ทั้งหมด', 'All'),
    pending:  l('รอออก', 'Pending'),
    issued:   l('ออกแล้ว', 'Issued'),
    rejected: l('ไม่อนุมัติ', 'Rejected'),
  }), [isTh]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusBadge = (s: InvoiceStatus) => {
    if (s === 'pending') return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
        <Clock className="h-3 w-3" /> {statusLabel.pending}
      </span>
    );
    if (s === 'issued') return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">
        <CheckCircle2 className="h-3 w-3" /> {statusLabel.issued}
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">
        <XCircle className="h-3 w-3" /> {statusLabel.rejected}
      </span>
    );
  };

  // Format tax info as multiline preview
  const renderTaxInfo = (t: AdminTaxInvoiceRequest['tax_info']) => {
    if (!t) {
      return (
        <span className="text-xs text-yellow-500">
          ⚠ {l('user ยังไม่ได้กรอกข้อมูลภาษี', 'User has not filled tax info yet')}
        </span>
      );
    }
    const entity = t.entity_type === 'juristic'
      ? l('นิติบุคคล (ภงด.53)', 'Juristic (P.N.D.53)')
      : t.entity_type === 'individual'
        ? l('บุคคลธรรมดา (ภงด.3)', 'Individual (P.N.D.3)')
        : l('—', '—');
    const nameLine = [t.title_prefix, t.tax_name].filter(Boolean).join(' ') || '—';
    const addrLine = [t.address_line, t.subdistrict, t.district, t.province, t.postal_code]
      .filter(Boolean).join(' ');
    return (
      <div className="text-xs space-y-0.5">
        <div>▸ {entity} · <span className="font-medium">{nameLine}</span></div>
        {t.tax_id && <div>▸ TaxID: <span className="font-mono">{t.tax_id}</span>{t.tax_branch && ` · สาขา ${t.tax_branch}`}</div>}
        {addrLine && <div>▸ {addrLine}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#FFB300]" />
          {l('ใบกำกับภาษี', 'Tax Invoices')}
        </h2>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={status}
          onChange={(e) => { setOffset(0); setStatus(e.target.value as StatusFilter); }}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="all">{statusLabel.all}</option>
          <option value="pending">{statusLabel.pending}</option>
          <option value="issued">{statusLabel.issued}</option>
          <option value="rejected">{statusLabel.rejected}</option>
        </select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          placeholder={l('ค้นหา email', 'Search email')}
          className="max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={onSearch}>{l('ค้นหา', 'Search')}</Button>
        <Button variant="ghost" size="sm" onClick={() => load()} title={l('รีเฟรช', 'Refresh')}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {l('ทั้งหมด', 'Total')}: {total}
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">
          {l('ไม่มีคำขอใบกำกับภาษี', 'No invoice requests')}
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const busy = uploadingId === r.id;
            return (
              <div key={r.id} className="p-4 rounded-lg border border-border bg-card space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{r.user_email}</span>
                    {statusBadge(r.status)}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {l('ขอเมื่อ', 'Requested')}: {new Date(r.requested_at).toLocaleString(isTh ? 'th-TH' : 'en-US')}
                  </span>
                </div>

                {/* Extension log */}
                <div className="text-sm">
                  <span className="text-muted-foreground">{l('รายการ:', 'Payment:')}</span>{' '}
                  +{r.log_days_added} {l('วัน', 'days')} ·{' '}
                  <span className="font-medium">฿{Number(r.log_amount).toLocaleString()}</span>
                  {r.log_subtotal != null && (
                    <span className="text-xs text-muted-foreground ml-2">
                      (฿{r.log_subtotal.toLocaleString()} + VAT)
                    </span>
                  )}
                  {' · '}
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.log_created_at).toLocaleDateString(isTh ? 'th-TH' : 'en-US')}
                  </span>
                </div>

                {/* Tax info snapshot */}
                <div className="bg-muted/30 px-3 py-2 rounded">
                  <p className="text-[11px] text-muted-foreground mb-1">
                    {l('ข้อมูลภาษีของ user (จาก /profile)', 'User tax info (from /profile)')}
                  </p>
                  {renderTaxInfo(r.tax_info)}
                </div>

                {/* Rejection reason */}
                {r.status === 'rejected' && r.admin_notes && (
                  <div className="bg-red-500/10 border border-red-500/30 px-3 py-2 rounded text-xs text-red-400">
                    <span className="font-medium">{l('เหตุผล:', 'Reason:')}</span> {r.admin_notes}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {r.status === 'pending' && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => handlePickFile(r)}
                        disabled={busy}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                        {l('อัปโหลดใบกำกับ', 'Upload invoice')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setRejecting(r); setRejectNotes(''); }}
                        className="border-red-500/40 text-red-400 hover:bg-red-500/10"
                      >
                        <X className="h-4 w-4 mr-1" />
                        {l('ไม่อนุมัติ', 'Reject')}
                      </Button>
                    </>
                  )}
                  {r.status === 'issued' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handlePreview(r.id)}
                        disabled={previewLoading}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        {l('ดูไฟล์', 'View file')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handlePickFile(r)}
                        disabled={busy}
                        className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
                        title={l('แทนที่ไฟล์เดิม (ถ้าออกผิด)', 'Replace file (if mistaken)')}
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                        {l('แทนที่ไฟล์', 'Replace file')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden file input (triggered by handlePickFile) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Pagination */}
      {total > limit && (
        <div className="flex justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            ←
          </Button>
          <span className="text-xs text-muted-foreground self-center">
            {offset + 1}–{Math.min(offset + limit, total)} / {total}
          </span>
          <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
            →
          </Button>
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={!!rejecting} onOpenChange={(o) => { if (!o && !rejectBusy) setRejecting(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{l('ปฏิเสธคำขอใบกำกับภาษี', 'Reject Invoice Request')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {rejecting && (
              <div className="bg-muted/50 px-3 py-2 rounded text-xs">
                {rejecting.user_email} · +{rejecting.log_days_added} {l('วัน', 'days')} · ฿{Number(rejecting.log_amount).toLocaleString()}
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">
                {l('เหตุผล (จำเป็น) — จะแสดงให้ user เห็น', 'Reason (required) — shown to the user')}
              </label>
              <Textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder={l('ตัวอย่าง: ข้อมูลภาษียังไม่ครบ', 'e.g. Tax info is incomplete')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={rejectBusy}>
              {l('ยกเลิก', 'Cancel')}
            </Button>
            <Button
              onClick={handleConfirmReject}
              disabled={rejectBusy || !rejectNotes.trim()}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {rejectBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {l('ยืนยันปฏิเสธ', 'Confirm reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice preview dialog */}
      <Dialog open={!!previewUrl} onOpenChange={(o) => { if (!o) closePreview(); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{l('ตัวอย่างใบกำกับภาษี', 'Invoice Preview')}</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <div className="w-full h-[70vh]">
              {previewMime.startsWith('image/') ? (
                <img src={previewUrl} alt="Invoice" className="w-full h-full object-contain bg-zinc-900 rounded" />
              ) : (
                <iframe src={previewUrl} className="w-full h-full bg-white rounded" title="Invoice preview" />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
