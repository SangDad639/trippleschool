import { useEffect, useState, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { FileText, Save, Loader2, Check, AlertTriangle, Upload, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import type { AffiliateStats, ThaiBankInfo } from '@/types/affiliate';

/**
 * Profile → Tax Info Section
 *
 * Form ที่ให้ user กรอกข้อมูลภาษี (ใช้ได้ทั้ง:
 *   • VAT side  — ใบกำกับภาษีจาก subscription purchase
 *   • WHT side  — หนังสือรับรองหัก ณ ที่จ่าย (ภงด.3 / ภงด.53) ตอนรับ commission
 * เพราะ user คนเดียวเล่นทั้ง 2 บทบาท)
 *
 * Backed by `user_bank_accounts` ที่ extend ด้วย structured address (migration 010).
 *
 * Behaviour:
 *   - Load initial values จาก stats prop (parent ส่งมาให้ — ไม่ต้อง re-fetch)
 *   - Inline edit + Save button (ไม่มี modal)
 *   - Partial submit OK — user กรอกแค่บาง field ก็บันทึกได้ ที่เหลือเก็บ null
 *   - On save success: toast + เรียก onSaved() ให้ parent reload stats
 *
 * Props:
 *   - bankInfo:    `AffiliateStats['thai_bank_info']` (null ถ้ายังไม่เคยตั้ง)
 *   - onSaved?():  callback หลัง save สำเร็จ (เพื่อให้ parent refetch stats)
 */
interface Props {
  bankInfo: AffiliateStats['thai_bank_info'];
  onSaved?: () => void;
}

type EntityType = 'individual' | 'juristic';

const INDIVIDUAL_PREFIXES = ['นาย', 'นาง', 'นางสาว'] as const;
const JURISTIC_PREFIXES = ['บริษัท', 'ห้างหุ้นส่วนจำกัด', 'ห้างหุ้นส่วนสามัญ', 'มูลนิธิ', 'สมาคม'] as const;

export default function TaxInfoSection({ bankInfo, onSaved }: Props) {
  const { language } = useLanguage();
  const isTh = language === 'th';

  // ── form state ──
  const [entityType, setEntityType] = useState<EntityType>('individual');
  const [titlePrefix, setTitlePrefix] = useState('');
  const [taxName, setTaxName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [subdistrict, setSubdistrict] = useState('');
  const [district, setDistrict] = useState('');
  const [province, setProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [taxBranch, setTaxBranch] = useState('');
  const [saving, setSaving] = useState(false);
  // ── ID card upload state ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingIdCard, setUploadingIdCard] = useState(false);
  // Shadow server fields for instant UI feedback.
  // `previewPath` is the BE proxy path returned by /my-stats — fetching it
  // produces a Blob URL we can stick into <iframe src>. Bypasses HWC OBS's
  // attachment-disposition quirk on extensionless keys.
  const [idCardPreviewPath, setIdCardPreviewPath] = useState<string | null>(null);
  const [idCardUploadedAt, setIdCardUploadedAt] = useState<string | null>(null);
  // Preview dialog state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Populate / re-sync form when bankInfo loads or changes
  useEffect(() => {
    if (!bankInfo) return;
    setEntityType((bankInfo.entity_type as EntityType) || 'individual');
    setTitlePrefix(bankInfo.title_prefix || '');
    setTaxName(bankInfo.tax_name || '');
    setTaxId(bankInfo.tax_id || '');
    setAddressLine(bankInfo.address_line || '');
    setSubdistrict(bankInfo.subdistrict || '');
    setDistrict(bankInfo.district || '');
    setProvince(bankInfo.province || '');
    setPostalCode(bankInfo.postal_code || '');
    setTaxBranch(bankInfo.tax_branch || '');
    setIdCardPreviewPath(bankInfo.id_card_preview_path || null);
    setIdCardUploadedAt(bankInfo.id_card_uploaded_at || null);
  }, [bankInfo]);

  // Fetch the preview as Blob URL when the dialog opens; revoke on close so
  // the blob is GC'd. Loading state shows a spinner while the proxy streams.
  useEffect(() => {
    if (!previewOpen || !idCardPreviewPath) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setPreviewLoading(true);
    api.getIdCardPreviewBlobUrl(idCardPreviewPath)
      .then((url) => {
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setPreviewBlobUrl(url);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err?.message || 'Failed to load preview');
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      setPreviewBlobUrl(null);
    };
  }, [previewOpen, idCardPreviewPath]);

  const handleIdCardUpload = async (file: File) => {
    // Light client-side guards — BE enforces the same.
    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(isTh ? `ขนาดไฟล์เกิน ${MAX_MB} MB` : `File exceeds ${MAX_MB} MB`);
      return;
    }
    setUploadingIdCard(true);
    try {
      const r = await api.uploadIdCard(file);
      setIdCardUploadedAt(r.uploaded_at);
      toast.success(isTh ? 'อัปโหลดบัตรประชาชนเรียบร้อย' : 'ID card uploaded');
      onSaved?.(); // refresh parent stats so other places (incl. preview path) update
    } catch (err: any) {
      toast.error(err?.message || (isTh ? 'อัปโหลดไม่สำเร็จ' : 'Upload failed'));
    } finally {
      setUploadingIdCard(false);
      if (fileInputRef.current) fileInputRef.current.value = '';  // allow re-selecting same filename
    }
  };

  const prefixOptions = entityType === 'individual' ? INDIVIDUAL_PREFIXES : JURISTIC_PREFIXES;

  // Validation (live, non-blocking — only blocks Save)
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (taxId && !/^\d{13}$/.test(taxId)) e.taxId = isTh ? 'ต้องเป็นตัวเลข 13 หลัก' : 'Must be 13 digits';
    if (postalCode && !/^\d{5}$/.test(postalCode)) e.postalCode = isTh ? 'ต้องเป็นตัวเลข 5 หลัก' : 'Must be 5 digits';
    return e;
  }, [taxId, postalCode, isTh]);

  const hasLegacyAddress = !!bankInfo?.tax_address && !addressLine;

  const handleSave = async () => {
    if (Object.keys(errors).length > 0) {
      toast.error(isTh ? 'ตรวจสอบข้อมูลให้ถูกต้องก่อน' : 'Please fix validation errors');
      return;
    }
    setSaving(true);
    try {
      await api.saveTaxInfo({
        entity_type: entityType,
        title_prefix: titlePrefix.trim() || null,
        tax_name: taxName.trim() || null,
        tax_id: taxId.trim() || null,
        address_line: addressLine.trim() || null,
        subdistrict: subdistrict.trim() || null,
        district: district.trim() || null,
        province: province.trim() || null,
        postal_code: postalCode.trim() || null,
        tax_branch: entityType === 'juristic' ? (taxBranch.trim() || null) : null,
      });
      toast.success(isTh ? 'บันทึกข้อมูลภาษีเรียบร้อย' : 'Tax info saved');
      onSaved?.();
    } catch (err: any) {
      toast.error(err?.message || (isTh ? 'บันทึกไม่สำเร็จ' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card p-6 rounded-xl border border-border space-y-4" id="tax-info">
      <div className="flex items-center gap-3">
        <FileText className="h-5 w-5 text-[#FFB300]" />
        <div>
          <h2 className="text-lg font-semibold">
            {isTh ? 'ข้อมูลภาษี' : 'Tax Information'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isTh
              ? 'ใช้สำหรับออกใบกำกับภาษี (VAT) + หนังสือรับรองหัก ณ ที่จ่าย (ภงด.3 / ภงด.53)'
              : 'For VAT invoice + Withholding Tax Certificate (ภงด.3 / ภงด.53)'}
          </p>
        </div>
      </div>

      {/* Legacy address warning */}
      {hasLegacyAddress && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <div className="font-medium text-yellow-500">
              {isTh ? 'ที่อยู่เดิมเป็นรูปแบบเก่า' : 'Legacy address format'}
            </div>
            <div className="text-muted-foreground mt-1">
              {isTh ? 'โปรดกรอกใหม่แยกฟิลด์เพื่อให้ออกเอกสารภาษีได้ถูกต้อง' : 'Please re-enter using structured fields for tax document export'}
            </div>
            <div className="font-mono text-[11px] mt-2 p-2 bg-background rounded">
              {bankInfo!.tax_address}
            </div>
          </div>
        </div>
      )}

      {/* Entity type — radio group */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">
          {isTh ? 'ประเภทผู้รับเงิน' : 'Recipient type'}
        </Label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setEntityType('individual')}
            className={`flex-1 p-3 rounded-lg border text-sm transition ${
              entityType === 'individual'
                ? 'border-[#FFB300] bg-[#FFB300]/10 text-[#FFB300]'
                : 'border-border hover:border-[#FFB300]/40'
            }`}
          >
            {entityType === 'individual' && <Check className="h-3.5 w-3.5 inline mr-1" />}
            {isTh ? 'บุคคลธรรมดา (ภงด.3)' : 'Individual (PND.3)'}
          </button>
          <button
            type="button"
            onClick={() => setEntityType('juristic')}
            className={`flex-1 p-3 rounded-lg border text-sm transition ${
              entityType === 'juristic'
                ? 'border-[#FFB300] bg-[#FFB300]/10 text-[#FFB300]'
                : 'border-border hover:border-[#FFB300]/40'
            }`}
          >
            {entityType === 'juristic' && <Check className="h-3.5 w-3.5 inline mr-1" />}
            {isTh ? 'นิติบุคคล (ภงด.53)' : 'Juristic (PND.53)'}
          </button>
        </div>
      </div>

      {/* Name + ID */}
      <div className="grid grid-cols-[140px_1fr] gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">
            {isTh ? 'คำนำหน้า' : 'Title'}
          </Label>
          <select
            value={titlePrefix}
            onChange={(e) => setTitlePrefix(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {prefixOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            {entityType === 'individual'
              ? (isTh ? 'ชื่อ-นามสกุล' : 'Full name')
              : (isTh ? 'ชื่อนิติบุคคล' : 'Company name')}
          </Label>
          <Input
            value={taxName}
            onChange={(e) => setTaxName(e.target.value)}
            placeholder={entityType === 'individual' ? 'สมชาย ใจดี' : 'บริษัท ABC จำกัด'}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">
            {entityType === 'individual'
              ? (isTh ? 'เลขประจำตัวประชาชน (13 หลัก)' : 'National ID (13 digits)')
              : (isTh ? 'เลขประจำตัวผู้เสียภาษี (13 หลัก)' : 'Tax ID (13 digits)')}
          </Label>
          <Input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value.replace(/\D/g, '').slice(0, 13))}
            placeholder="1234567890123"
            inputMode="numeric"
            maxLength={13}
            className={errors.taxId ? 'border-red-500' : ''}
          />
          {errors.taxId && <p className="text-xs text-red-400 mt-1">{errors.taxId}</p>}
        </div>
        {entityType === 'juristic' && (
          <div>
            <Label className="text-xs text-muted-foreground">
              {isTh ? 'สาขา (รหัส 5 หลัก)' : 'Branch (5-digit code)'}
            </Label>
            <Input
              value={taxBranch}
              onChange={(e) => setTaxBranch(e.target.value)}
              placeholder="00000 = สำนักงานใหญ่"
            />
          </div>
        )}
      </div>

      {/* Address */}
      <div>
        <Label className="text-xs text-muted-foreground">
          {isTh ? 'ที่อยู่ (บ้านเลขที่ ซอย ถนน)' : 'Address (number, soi, road)'}
        </Label>
        <Input
          value={addressLine}
          onChange={(e) => setAddressLine(e.target.value)}
          placeholder="123/45 ถ.สุขุมวิท"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">
            {isTh ? 'ตำบล / แขวง' : 'Subdistrict'}
          </Label>
          <Input
            value={subdistrict}
            onChange={(e) => setSubdistrict(e.target.value)}
            placeholder={isTh ? 'คลองตัน' : ''}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            {isTh ? 'อำเภอ / เขต' : 'District'}
          </Label>
          <Input
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            placeholder={isTh ? 'วัฒนา' : ''}
          />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_140px] gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">
            {isTh ? 'จังหวัด' : 'Province'}
          </Label>
          <Input
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            placeholder={isTh ? 'กรุงเทพมหานคร' : ''}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            {isTh ? 'รหัสไปรษณีย์' : 'Postal code'}
          </Label>
          <Input
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
            placeholder="10110"
            inputMode="numeric"
            maxLength={5}
            className={errors.postalCode ? 'border-red-500' : ''}
          />
          {errors.postalCode && <p className="text-xs text-red-400 mt-1">{errors.postalCode}</p>}
        </div>
      </div>

      {/* Divider + Optional ID card upload section.
          Stored as a fixed key per user (server overwrites on re-upload —
          no orphaned files). Used by admin to verify identity when paying
          out commissions; *not required* to receive payment. */}
      <div className="pt-2 border-t border-border">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h3 className="text-sm font-medium">
              {isTh
                ? 'สำเนาบัตรประชาชน (เซ็นรับรองสำเนา)'
                : 'National ID copy (certified-true-copy signed)'}
              <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                {isTh ? '(รองรับ JPG/PNG/PDF ≤ 5 MB)' : '(JPG/PNG/PDF ≤ 5 MB)'}
              </span>
            </h3>
            <p className="text-[10px] text-yellow-500/80 mt-1">
              ⚠️ {isTh
                ? 'อย่าลืมเซ็นรับรองสำเนาถูกต้องบนเอกสารก่อนถ่าย/สแกน'
                : 'Remember to sign "Certified true copy" on the document before scanning'}
            </p>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleIdCardUpload(f);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploadingIdCard}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadingIdCard ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Upload className="h-3.5 w-3.5 mr-1.5" />
            )}
            {idCardUploadedAt
              ? (isTh ? 'อัปโหลดใหม่ทับรูปเดิม' : 'Replace uploaded file')
              : (isTh ? 'อัปโหลดไฟล์' : 'Upload file')}
          </Button>

          {idCardPreviewPath && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPreviewOpen(true)}
              className="h-7 px-2 text-xs text-[#FFB300] hover:bg-[#FFB300]/10"
            >
              <Eye className="h-3 w-3 mr-1" />
              {isTh ? 'เปิดดูที่อัปโหลดไว้' : 'View uploaded file'}
            </Button>
          )}

          {idCardUploadedAt && (
            <span className="text-[11px] text-muted-foreground">
              {isTh ? 'อัปโหลดเมื่อ' : 'Uploaded'} {new Date(idCardUploadedAt).toLocaleString(isTh ? 'th-TH' : 'en-US')}
            </span>
          )}
        </div>

      </div>

      {/* Save */}
      <div className="flex justify-end pt-2">
        <Button
          onClick={handleSave}
          disabled={saving || Object.keys(errors).length > 0}
          className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {isTh ? 'บันทึกข้อมูลภาษี' : 'Save tax info'}
        </Button>
      </div>

      {/* ID card preview dialog — opens inline instead of a new browser tab.
          Uses <iframe> so it renders both images (JPG/PNG/WebP) and PDF without
          us needing to know the mime type up front. "Open in new tab" link is
          kept as a fallback for users who want to download/zoom. */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#FFB300]" />
              {isTh ? 'สำเนาบัตรประชาชน' : 'National ID copy'}
            </DialogTitle>
            {idCardUploadedAt && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {isTh ? 'อัปโหลดเมื่อ' : 'Uploaded'}{' '}
                {new Date(idCardUploadedAt).toLocaleString(isTh ? 'th-TH' : 'en-US')}
              </p>
            )}
          </DialogHeader>
          {previewLoading ? (
            <div className="flex-1 flex items-center justify-center min-h-[60vh] bg-muted/30">
              <Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" />
            </div>
          ) : previewBlobUrl ? (
            <iframe
              src={previewBlobUrl}
              title={isTh ? 'สำเนาบัตรประชาชน' : 'National ID copy'}
              className="flex-1 w-full bg-muted/30 min-h-[60vh]"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center min-h-[60vh] bg-muted/30 text-sm text-muted-foreground">
              {isTh ? 'โหลดไฟล์ไม่ได้' : 'Cannot load file'}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Helper: บอกว่า tax info ของ user "ขาดข้อมูล" อยู่ไหม
 * (ใช้ตัดสินใจว่าจะแสดง prompt หลัง payment success หรือไม่)
 */
export function isTaxInfoIncomplete(bankInfo: ThaiBankInfo | null | undefined): boolean {
  if (!bankInfo) return true;
  const required = [
    bankInfo.title_prefix,
    bankInfo.tax_name,
    bankInfo.tax_id,
    bankInfo.address_line,
    bankInfo.subdistrict,
    bankInfo.district,
    bankInfo.province,
    bankInfo.postal_code,
  ];
  return required.some((v) => !v);
}
