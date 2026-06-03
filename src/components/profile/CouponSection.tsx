import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Ticket, Loader2, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Profile → Coupon redemption section.
 *
 * Single text input + redeem button. Posts to /api/coupons/redeem.
 * On success, calls `onRedeemed(days, expires_at)` so parent can refresh
 * the subscription card (and any other things that read /me/stats).
 *
 * Validation:
 *   - normalises input (trim, uppercase)
 *   - regex check 4–20 alnum (matches BE service)
 *
 * Errors from BE map to user-readable toasts (i18n).
 */
interface Props {
  onRedeemed?: (days: number, expiresAt: string) => void;
}

export default function CouponSection({ onRedeemed }: Props) {
  const { language } = useLanguage();
  const isTh = language === 'th';
  const l = (th: string, en: string) => (isTh ? th : en);

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastSuccess, setLastSuccess] = useState<{ days: number; expires_at: string } | null>(null);

  const handleRedeem = async () => {
    const norm = code.trim().toUpperCase().replace(/\s+/g, '');
    if (!norm) {
      toast.error(l('โปรดใส่โค้ด', 'Please enter a code'));
      return;
    }
    setSubmitting(true);
    try {
      const r: any = await api.redeemCoupon(norm);
      const success = { days: r.days as number, expires_at: r.expires_at as string };
      setLastSuccess(success);
      setCode('');
      toast.success(l(`เปิดใช้งานเพิ่ม ${r.days} วันแล้ว`, `+${r.days} day(s) added`));
      onRedeemed?.(success.days, success.expires_at);
    } catch (err: any) {
      // BE returns { error, errorCode } — pick a friendly message
      const code = (err?.errorCode || err?.code || '').toString();
      const message =
        code === 'invalid'              ? l('ไม่พบโค้ดนี้ — กรุณาตรวจสอบใหม่', 'Code not found — please double-check') :
        code === 'already_used_by_you'  ? l('คุณใช้โค้ดนี้ไปแล้ว ใช้ซ้ำไม่ได้', 'You have already used this code') :
        // Legacy single-use alias (BE may return for codes created before migration 015).
        code === 'already_used'         ? l('โค้ดนี้ถูกใช้ไปแล้ว', 'This code has already been used') :
        code === 'limit_reached'        ? l('โค้ดนี้ถูกใช้เต็มจำนวนแล้ว', 'This code has reached its usage limit') :
        code === 'disabled'             ? l('โค้ดนี้ถูกปิดใช้งาน', 'This code is disabled') :
        (err?.message || l('ใช้โค้ดไม่สำเร็จ', 'Failed to redeem code'));
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-card p-6 rounded-xl border border-border space-y-3">
      <div className="flex items-center gap-3">
        <Ticket className="h-5 w-5 text-[#FFB300]" />
        <div>
          <h2 className="text-lg font-semibold">
            {l('ผูกโค้ด', 'Redeem coupon')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {l(
              'ใส่โค้ดที่ได้รับเพื่อเพิ่มวันใช้งาน — โค้ดยาว 8 ตัว ตัวอักษรพิมพ์ใหญ่ + ตัวเลข',
              'Enter a code to add subscription days — 8 chars, uppercase + digits',
            )}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD2345"
          maxLength={20}
          className="font-mono tracking-widest"
          onKeyDown={(e) => e.key === 'Enter' && !submitting && handleRedeem()}
        />
        <Button
          onClick={handleRedeem}
          disabled={submitting || !code.trim()}
          className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
          {l('ใช้โค้ด', 'Redeem')}
        </Button>
      </div>

      {lastSuccess && (
        <div className="flex items-start gap-2 text-xs p-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium text-green-500">
              {l(`เพิ่ม ${lastSuccess.days} วันสำเร็จ`, `+${lastSuccess.days} day(s) added`)}
            </div>
            <div className="text-muted-foreground mt-0.5">
              {l('หมดอายุ', 'Expires')}{' '}
              {new Date(lastSuccess.expires_at).toLocaleString(isTh ? 'th-TH' : 'en-US')}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
        <span>
          {l(
            'โค้ดแต่ละอันใช้ได้ครั้งเดียวเท่านั้น และไม่สามารถใช้ซ้ำได้',
            'Each code is single-use and cannot be reused',
          )}
        </span>
      </div>
    </div>
  );
}
