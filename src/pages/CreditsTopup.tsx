/**
 * /credits/topup — slip-based credit recharge page.
 *
 * Flow:
 *   1. Fetch packages from /api/credit-purchase/packages
 *   2. User picks one → sees expected amount + bank info
 *   3. User uploads slip → POST /verify-and-approve
 *   4. On success → toast + navigate back to /credits with refreshed balance
 *
 * Mirrors SubscriptionTransferV2 UX pattern. Standalone page.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CircleDollarSign,
  Coins,
  Upload,
  Check,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Pkg {
  slug: string;
  name: string;
  name_th: string | null;
  credits: number;
  price_thb: number;
  description: string | null;
}

const BANK_INFO = {
  bank: 'กสิกรไทย (KBANK)',
  accountName: 'บจก. ทริปเปิล สปาร์ค เทค',
  accountNumber: '2313088165',
};

export default function CreditsTopup() {
  const navigate = useNavigate();
  const { setCredits } = useAuth();
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const { items } = await api.getCreditPackages();
        setPackages(items);
      } catch (err: any) {
        toast.error(err?.message || 'โหลดแพ็คเกจไม่สำเร็จ');
      }
    })();
  }, []);

  const pickedPkg = packages.find((p) => p.slug === selected) || null;

  const handleFile = (f: File | null) => {
    setError(null);
    setSlipFile(f);
    if (slipPreview) URL.revokeObjectURL(slipPreview);
    setSlipPreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async () => {
    if (!selected || !slipFile) {
      setError('เลือกแพ็คเกจและอัปโหลด slip ก่อน');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('slip', slipFile);
      fd.append('package_slug', selected);
      const result = (await api.creditPurchaseVerifyAndApprove(fd)) as {
        success: boolean;
        credits_added: number;
        new_balance: number;
        message?: string;
      };
      setCredits(result.new_balance);
      toast.success(result.message || `✅ เติม ${result.credits_added.toLocaleString()} credits สำเร็จ`);
      navigate('/credits');
    } catch (err: any) {
      const msg = err?.message || 'ตรวจสอบ slip ไม่ผ่าน';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          กลับ
        </Button>
        <CircleDollarSign className="h-5 w-5 text-[#FFB300]" />
        <h1 className="text-xl md:text-2xl font-bold">เติมเครดิต</h1>
      </div>

      {/* Step 1: Pick package */}
      <Card className="p-4 mb-4">
        <div className="text-sm font-semibold mb-3">1. เลือกแพ็คเกจ</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {packages.map((p) => (
            <button
              key={p.slug}
              onClick={() => setSelected(p.slug)}
              className={`relative text-left p-3 rounded-lg border-2 transition ${
                selected === p.slug
                  ? 'border-[#FFB300] bg-[#FFB300]/10'
                  : 'border-border hover:border-[#FFB300]/40'
              }`}
            >
              {selected === p.slug && (
                <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-[#FFB300] flex items-center justify-center">
                  <Check className="h-3 w-3 text-black" />
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[#FFB300] mb-1">
                <Coins className="h-4 w-4" />
                <span className="font-bold tabular-nums">{p.credits.toLocaleString()}</span>
              </div>
              <div className="text-xs text-muted-foreground mb-1">{p.name_th || p.name}</div>
              <div className="text-lg font-semibold tabular-nums">
                ฿{p.price_thb.toLocaleString()}
              </div>
              {p.description && (
                <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                  {p.description}
                </div>
              )}
            </button>
          ))}
        </div>
      </Card>

      {/* Step 2: Bank info */}
      {pickedPkg && (
        <Card className="p-4 mb-4 bg-card/40 border-[#FFB300]/15">
          <div className="text-sm font-semibold mb-3">2. โอนเงิน ฿{pickedPkg.price_thb.toLocaleString()} ไปที่</div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between border-b border-border py-1.5">
              <span className="text-muted-foreground">ธนาคาร</span>
              <span className="font-medium">{BANK_INFO.bank}</span>
            </div>
            <div className="flex justify-between border-b border-border py-1.5">
              <span className="text-muted-foreground">ชื่อบัญชี</span>
              <span className="font-medium">{BANK_INFO.accountName}</span>
            </div>
            <div className="flex justify-between border-b border-border py-1.5">
              <span className="text-muted-foreground">เลขที่บัญชี</span>
              <span className="font-mono font-bold text-[#FFB300] tabular-nums">
                {BANK_INFO.accountNumber}
              </span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-muted-foreground">จำนวน</span>
              <span className="font-bold tabular-nums">
                ฿{pickedPkg.price_thb.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
            ⚠️ โอนยอดให้ <strong>ตรง</strong> ตามที่ระบุ — ระบบตรวจจาก slip อัตโนมัติ. โอนเกิน/ขาด → reject
          </div>
        </Card>
      )}

      {/* Step 3: Upload slip */}
      {pickedPkg && (
        <Card className="p-4 mb-4">
          <div className="text-sm font-semibold mb-3">3. อัปโหลด slip</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
            className="hidden"
          />
          {!slipPreview ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-border hover:border-[#FFB300]/60 rounded-lg p-8 text-center transition"
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <div className="text-sm">คลิกเพื่อเลือกไฟล์</div>
              <div className="text-[11px] text-muted-foreground mt-1">JPEG / PNG / WebP, ≤ 5MB</div>
            </button>
          ) : (
            <div className="space-y-2">
              <img
                src={slipPreview}
                alt="slip preview"
                className="max-h-64 mx-auto rounded-lg border border-border"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="w-full"
              >
                เปลี่ยนไฟล์
              </Button>
            </div>
          )}
          {error && (
            <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/30 text-xs text-destructive flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}
        </Card>
      )}

      {/* Submit */}
      {pickedPkg && slipFile && (
        <Button
          onClick={submit}
          disabled={submitting}
          className="w-full bg-[#FFB300] hover:bg-[#FFB300]/85 text-black"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              กำลังตรวจสอบ...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              ยืนยัน + รับ {pickedPkg.credits.toLocaleString()} credits
            </>
          )}
        </Button>
      )}
    </div>
  );
}
