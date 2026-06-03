import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Receipt, Loader2, Eye, Download, FileText, Clock, CheckCircle2,
  XCircle, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import type { PaymentHistoryRow } from '@/types/payment';

/**
 * Profile → ประวัติการชำระเงิน (Payment History) + Tax Invoice request.
 *
 * Fetches the caller's paid extension log + invoice-request join. Shows one
 * row per extension with a status-aware action:
 *   • no request yet   → [ขอใบกำกับภาษี]
 *   • status='pending' → ⏳ รอออก (disabled badge)
 *   • status='issued'  → [ดู] [ดาวน์โหลด] (proxy preview + download)
 *   • status='rejected'→ ❌ ไม่อนุมัติ (tooltip with admin_notes)
 *
 * 1 invoice / 1 row ตลอดชีพ — re-request is intentionally blocked by the
 * BE UNIQUE constraint on extension_log_id.
 */

export default function PaymentHistorySection() {
  const { language } = useLanguage();
  const isTh = language === 'th';
  const l = (th: string, en: string) => (isTh ? th : en);

  const [rows, setRows] = useState<PaymentHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestingId, setRequestingId] = useState<number | null>(null);
  const [confirmRow, setConfirmRow] = useState<PaymentHistoryRow | null>(null);

  // Preview dialog (issued invoice)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMime, setPreviewMime] = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getMyExtensionHistory();
      setRows(r.history || []);
    } catch (err: any) {
      console.error('Load history:', err);
      toast.error(l('โหลดประวัติไม่สำเร็จ', 'Failed to load history'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const handleConfirmRequest = async () => {
    if (!confirmRow) return;
    setRequestingId(confirmRow.id);
    try {
      await api.requestTaxInvoice(confirmRow.id);
      toast.success(l('ส่งคำขอใบกำกับภาษีแล้ว', 'Tax invoice request submitted'));
      setConfirmRow(null);
      await load();
    } catch (err: any) {
      // BE may return { error: 'already_requested' | 'not_eligible' | 'not_found' }
      const code = (err?.errorCode || err?.code || err?.message || '').toString();
      const msg = code.includes('already_requested')
        ? l('รายการนี้เคยขอแล้ว ไม่สามารถขอซ้ำได้', 'Invoice was already requested for this row')
        : code.includes('not_eligible')
          ? l('รายการนี้ไม่สามารถขอใบกำกับภาษีได้', 'This row is not eligible for an invoice')
          : (err?.message || l('ขอใบกำกับภาษีไม่สำเร็จ', 'Failed to request invoice'));
      toast.error(msg);
    } finally {
      setRequestingId(null);
    }
  };

  const handlePreview = async (requestId: number) => {
    setPreviewLoading(true);
    try {
      // Fetch via proxy → blob URL. We probe the response Content-Type so the
      // dialog can pick <iframe> for PDF or <img> for image.
      const blobUrl = await api.getInvoicePreviewBlobUrl(requestId);
      if (!blobUrl) {
        toast.error(l('ยังไม่มีไฟล์ใบกำกับ', 'No invoice file available'));
        return;
      }
      // Get blob to inspect mime
      const resp = await fetch(blobUrl);
      const blob = await resp.blob();
      setPreviewMime(blob.type || 'application/pdf');
      setPreviewUrl(blobUrl);
    } catch (err: any) {
      toast.error(err?.message || l('เปิดใบกำกับไม่สำเร็จ', 'Failed to open invoice'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewMime('');
  };

  const handleDownload = async (requestId: number) => {
    try {
      // Pick a sensible filename — include date for clarity
      const filename = `invoice-${requestId}.pdf`;
      await api.downloadInvoice(requestId, filename);
    } catch (err: any) {
      toast.error(err?.message || l('ดาวน์โหลดไม่สำเร็จ', 'Download failed'));
    }
  };

  // ── Row action: status-aware button group ──
  const renderInvoiceAction = (row: PaymentHistoryRow) => {
    const req = row.invoice_request;
    const busy = requestingId === row.id;

    if (req == null) {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirmRow(row)}
          disabled={busy}
          className="border-[#FFB300]/40 text-[#FFB300] hover:bg-[#FFB300]/10"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Receipt className="h-3.5 w-3.5 mr-1" />}
          {l('ขอใบกำกับภาษี', 'Request invoice')}
        </Button>
      );
    }

    if (req.status === 'pending') {
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-yellow-500/20 text-yellow-400">
          <Clock className="h-3.5 w-3.5" />
          {l('รอออก', 'Pending')}
        </span>
      );
    }

    if (req.status === 'rejected') {
      return (
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-500/20 text-red-400"
          title={req.admin_notes || l('ไม่อนุมัติ', 'Rejected')}
        >
          <XCircle className="h-3.5 w-3.5" />
          {l('ไม่อนุมัติ', 'Rejected')}
        </span>
      );
    }

    // issued
    return (
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-green-500/20 text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {l('ออกแล้ว', 'Issued')}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handlePreview(req.id)}
          disabled={previewLoading}
          title={l('ดูใบกำกับ', 'View invoice')}
          className="h-7 px-2"
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleDownload(req.id)}
          title={l('ดาวน์โหลด', 'Download')}
          className="h-7 px-2"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  };

  return (
    <div className="bg-card p-6 rounded-xl border border-border space-y-4">
      <div className="flex items-center gap-3">
        <FileText className="h-5 w-5 text-[#FFB300]" />
        <div>
          <h2 className="text-lg font-semibold">
            {l('ประวัติการชำระเงิน', 'Payment History')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {l(
              'ดูค่าสมัครสมาชิกที่เคยจ่าย และขอใบกำกับภาษีของแต่ละรายการ',
              'See your subscription payments and request tax invoices',
            )}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[#FFB300]" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-start gap-2 text-xs p-3 rounded-lg bg-muted/50 border border-border text-muted-foreground">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            {l(
              'ยังไม่มีประวัติการชำระเงิน — รายการจะแสดงเมื่อมีการต่ออายุสมาชิก',
              'No payment history yet — entries appear after a subscription extension',
            )}
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr className="text-xs text-muted-foreground">
                <th className="p-2 text-left font-medium">{l('วันที่', 'Date')}</th>
                <th className="p-2 text-right font-medium">{l('วัน', 'Days')}</th>
                <th className="p-2 text-right font-medium">{l('ยอด', 'Amount')}</th>
                <th className="p-2 text-left font-medium">{l('ใบกำกับภาษี', 'Tax Invoice')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-2 text-xs">
                    {new Date(r.created_at).toLocaleString(isTh ? 'th-TH' : 'en-US', {
                      day: 'numeric', month: 'short', year: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="p-2 text-right">+{r.days_added}</td>
                  <td className="p-2 text-right">
                    <div className="font-medium">฿{Number(r.amount).toLocaleString()}</div>
                    {r.subtotal != null && r.vat_amount != null && (
                      <div className="text-[10px] text-muted-foreground">
                        ฿{r.subtotal.toLocaleString()} + VAT ฿{r.vat_amount.toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="p-2">{renderInvoiceAction(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm request dialog */}
      <AlertDialog
        open={!!confirmRow}
        onOpenChange={(o) => { if (!o && !requestingId) setConfirmRow(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{l('ขอใบกำกับภาษี?', 'Request tax invoice?')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>{l(
                  'ระบบจะส่งคำขอไปที่ admin — ขอได้ครั้งเดียวต่อรายการเท่านั้น',
                  'A request will be sent to the admin — one request per row, lifetime.',
                )}</p>
                {confirmRow && (
                  <div className="bg-muted/50 px-3 py-2 rounded text-xs">
                    {new Date(confirmRow.created_at).toLocaleDateString(isTh ? 'th-TH' : 'en-US')} · +{confirmRow.days_added} {l('วัน', 'days')} · ฿{Number(confirmRow.amount).toLocaleString()}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {l(
                    'admin จะออกใบกำกับตามข้อมูลภาษีที่บันทึกในโปรไฟล์ของคุณ — โปรดตรวจสอบให้ครบก่อนยืนยัน',
                    'The admin will use the tax information saved in your profile — please complete it before confirming.',
                  )}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!requestingId}>{l('ยกเลิก', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmRequest(); }}
              disabled={!!requestingId}
              className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
            >
              {requestingId ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {l('ส่งคำขอ', 'Submit request')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invoice preview dialog (iframe for PDF, img for image) */}
      <Dialog open={!!previewUrl} onOpenChange={(o) => { if (!o) closePreview(); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{l('ใบกำกับภาษี', 'Tax Invoice')}</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <div className="w-full h-[70vh]">
              {previewMime.startsWith('image/') ? (
                <img
                  src={previewUrl}
                  alt="Invoice"
                  className="w-full h-full object-contain bg-zinc-900 rounded"
                />
              ) : (
                <iframe
                  src={previewUrl}
                  className="w-full h-full bg-white rounded"
                  title="Invoice preview"
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
