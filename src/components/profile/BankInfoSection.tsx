import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Banknote, Save, Loader2, Wallet, Building2, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import type { AffiliateStats, PayoutMethod } from '@/types/affiliate';

/**
 * Profile → Bank Account Section
 *
 * Form ที่ให้ user กรอก/แก้ไขข้อมูลบัญชีรับเงิน (สำหรับ admin โอน commission).
 * แยกจาก TaxInfoSection เพราะมีบทบาทต่างกัน:
 *   • BankInfoSection — สำหรับ "รับเงิน" (admin โอนเข้าบัญชีนี้)
 *   • TaxInfoSection — สำหรับ "เอกสารภาษี" (VAT invoice + WHT ภงด.3/53)
 *
 * Both share `user_bank_accounts` row but are conceptually independent
 * partial-updates.
 *
 * Backed by:
 *   - GET /api/affiliate/my-stats (read)
 *   - PUT /api/affiliate/bank-account  → api.saveThaiBankAccount()
 *   - PUT /api/affiliate/payout-method → api.setPreferredPayoutMethod()
 */
interface Props {
  stats: AffiliateStats | null;
  onSaved?: () => void;
}

// Thai banks — match the same list used elsewhere in the app. Free-text
// fallback ผ่าน <input> ไม่ใส่เพราะ admin transfer ต้องการชื่อมาตรฐาน.
const THAI_BANKS = [
  'KBank', 'SCB', 'BBL', 'KTB', 'TTB', 'BAY', 'CIMB', 'UOB', 'GSB', 'TISCO',
  'KKP', 'LH Bank', 'ICBC', 'Standard Chartered', 'Citibank', 'Other',
];

export default function BankInfoSection({ stats, onSaved }: Props) {
  const { language } = useLanguage();
  const isTh = language === 'th';
  const bank = stats?.thai_bank_info;

  // Form state
  const [bankName, setBankName] = useState('');
  const [branch, setBranch] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [phone, setPhone] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('thai_bank');
  const [wiseEmail, setWiseEmail] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (bank) {
      setBankName(bank.bank_name || '');
      setBranch(bank.branch || '');
      setAccountNumber(bank.account_number || '');
      setAccountHolder(bank.account_holder || '');
      setPhone(bank.phone || '');
    }
    setPayoutMethod((stats?.preferred_payout_method as PayoutMethod) || 'thai_bank');
    setWiseEmail(stats?.wise_email || '');
  }, [bank, stats?.preferred_payout_method, stats?.wise_email]);

  const handleSave = async () => {
    // Thai bank requires bank_name + account_number + account_holder (BE enforces too).
    if (payoutMethod === 'thai_bank') {
      if (!bankName.trim() || !accountNumber.trim() || !accountHolder.trim()) {
        toast.error(isTh
          ? 'กรอกธนาคาร เลขบัญชี และชื่อบัญชีให้ครบ'
          : 'Bank, account number, and account holder are required');
        return;
      }
    }
    if (payoutMethod === 'wise' && !wiseEmail.trim()) {
      toast.error(isTh ? 'กรอก email Wise' : 'Wise email is required');
      return;
    }

    setSaving(true);
    try {
      // Save in a sensible order — bank account first (validates), then prefs.
      if (bankName.trim()) {
        await api.saveThaiBankAccount({
          bank_name: bankName.trim(),
          branch: branch.trim() || undefined,
          account_number: accountNumber.trim(),
          account_holder: accountHolder.trim(),
          phone: phone.trim() || undefined,
        });
      }
      if (wiseEmail.trim() && wiseEmail !== stats?.wise_email) {
        await api.updateWiseEmail(wiseEmail.trim());
      }
      await api.setPreferredPayoutMethod(payoutMethod);

      toast.success(isTh ? 'บันทึกข้อมูลบัญชีเรียบร้อย' : 'Bank account saved');
      onSaved?.();
    } catch (err: any) {
      toast.error(err?.message || (isTh ? 'บันทึกไม่สำเร็จ' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card p-6 rounded-xl border border-border space-y-4">
      <div className="flex items-center gap-3">
        <Banknote className="h-5 w-5 text-[#FFB300]" />
        <h2 className="text-lg font-semibold">
          {isTh ? 'บัญชีรับเงิน' : 'Payout Account'}
        </h2>
      </div>

      {/* Payout method toggle */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">
          {isTh ? 'วิธีรับเงิน' : 'Payout method'}
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setPayoutMethod('thai_bank')}
            className={`p-3 rounded-lg border text-sm transition flex items-center justify-center gap-2 ${
              payoutMethod === 'thai_bank'
                ? 'border-[#FFB300] bg-[#FFB300]/10 text-[#FFB300]'
                : 'border-border hover:border-[#FFB300]/40'
            }`}
          >
            <Building2 className="h-4 w-4" />
            {isTh ? 'ธนาคารไทย' : 'Thai bank'}
          </button>
          <button
            type="button"
            onClick={() => setPayoutMethod('wise')}
            className={`p-3 rounded-lg border text-sm transition flex items-center justify-center gap-2 ${
              payoutMethod === 'wise'
                ? 'border-[#FFB300] bg-[#FFB300]/10 text-[#FFB300]'
                : 'border-border hover:border-[#FFB300]/40'
            }`}
          >
            <Globe className="h-4 w-4" />
            Wise
          </button>
        </div>
      </div>

      {/* Thai bank form */}
      {payoutMethod === 'thai_bank' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">
                {isTh ? 'ธนาคาร' : 'Bank'}
              </Label>
              <select
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{isTh ? '— เลือกธนาคาร —' : '— Select bank —'}</option>
                {THAI_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                {isTh ? 'สาขา' : 'Branch'}
              </Label>
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder={isTh ? 'สีลม' : 'Silom'}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">
              {isTh ? 'เลขบัญชี' : 'Account number'}
            </Label>
            <Input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
              placeholder="1234567890"
              inputMode="numeric"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">
              {isTh ? 'ชื่อบัญชี' : 'Account holder'}
            </Label>
            <Input
              value={accountHolder}
              onChange={(e) => setAccountHolder(e.target.value)}
              placeholder={isTh ? 'นาย สมชาย ใจดี' : 'Mr. Somchai Jaidee'}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {isTh
                ? 'ใส่ชื่อให้ตรงกับสมุดบัญชีจริง'
                : 'Must match the actual bank account name'}
            </p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">
              {isTh ? 'เบอร์โทร (ไม่บังคับ)' : 'Phone (optional)'}
            </Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0812345678"
              inputMode="tel"
            />
          </div>
        </div>
      )}

      {/* Wise form */}
      {payoutMethod === 'wise' && (
        <div>
          <Label className="text-xs text-muted-foreground">
            {isTh ? 'อีเมล Wise' : 'Wise email'}
          </Label>
          <Input
            type="email"
            value={wiseEmail}
            onChange={(e) => setWiseEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          {isTh ? 'บันทึกบัญชีรับเงิน' : 'Save payout account'}
        </Button>
      </div>

      {/* Hint about secondary lucide import — keep at bottom so unused warning */}
      <div className="hidden"><Wallet /></div>
    </div>
  );
}
