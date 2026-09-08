import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Package, Plus, Pencil, Trash2, Loader2, Eye, EyeOff, X, CalendarClock, History, AlertTriangle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { SubscriptionPlan, PackageEditInput, AdminAltPrice, PlanPriceSchedule } from '@/types/pricing';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

interface TierRow { id: number; name: string; name_th?: string; commission_percent: number; is_active: boolean; }
interface AltRow { label: string; label_th: string; subtotal: string; } // FE form shape (strings so empty != 0)

/* ---------- ตั้งเวลาเปลี่ยนราคา: helpers เวลาไทย (ไทยไม่มี DST → offset +07:00 ตายตัว) ---------- */
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Date → ค่าของ <input type="datetime-local"> ในเวลาไทย (YYYY-MM-DDTHH:mm) */
const toBangkokLocal = (d: Date) => new Date(d.getTime() + BKK_OFFSET_MS).toISOString().slice(0, 16);
/** ค่าจาก datetime-local (เวลาไทย) → ISO UTC สำหรับส่ง server */
const bangkokLocalToIso = (local: string) => new Date(`${local}:00+07:00`).toISOString();
/** ค่าเริ่มต้นของฟอร์ม = เที่ยงคืนถัดไป (เวลาไทย) */
const nextMidnightBangkok = () => {
  const t = new Date(Date.now() + BKK_OFFSET_MS + 24 * 60 * 60 * 1000);
  return `${t.toISOString().slice(0, 10)}T00:00`;
};
const fmtBkk = (iso: string, withYear = true) =>
  new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit',
  });
const fmtMoney = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 });

/**
 * Admin tab for managing subscription packages (subscription_plans table).
 *
 * Read access: any admin.
 * Write access: super admin only — buttons hide for normal admins (the BE
 * also enforces this, so this is a UX-only gate).
 *
 * Each package edit dialog has 2 main sections per spec:
 *   1. Commission % (0–100 validation, NULL = use tier-based)
 *   2. Text detail (description textarea)
 */
const VAT_RATE = 7;

interface FormState {
  slug: string;
  name: string;
  name_th: string;
  subtotal: string;
  days: string;
  commission_percent: string;   // '' means NULL (use tier-based)
  description: string;
  display_order: string;
  features: string;             // newline-separated; converted to array on save
  is_active: boolean;
  /** Admin-only alt prices. Not shown on Landing — usable only via admin extend. */
  admin_alt_prices: AltRow[];
  /** When set, buying this plan auto-promotes the user to this tier (promote-only). */
  tier_id: string;              // '' = no auto-tier
  /** When true, the whole package is hidden from Landing / Subscription page. */
  admin_only: boolean;
}

const emptyForm: FormState = {
  slug: '', name: '', name_th: '', subtotal: '', days: '', commission_percent: '',
  description: '', display_order: '0', features: '', is_active: true,
  admin_alt_prices: [], tier_id: '', admin_only: false,
};

export default function AdminPackagesPanel() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isTh = language === 'th';
  /** Shorthand: l('คำไทย', 'English word') — same pattern used in Profile/Bank/Tax sections. */
  const l = (th: string, en: string) => (isTh ? th : en);
  const isSuperAdmin = !!user?.isSuperAdmin;
  const [packages, setPackages] = useState<SubscriptionPlan[]>([]);
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [commissionError, setCommissionError] = useState('');

  // ---- ตั้งเวลาเปลี่ยนราคา (docs/PLAN-SCHEDULED-PRICE-CHANGE.md) ----
  const [schedules, setSchedules] = useState<PlanPriceSchedule[]>([]);
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedEff, setSchedEff] = useState<string>(nextMidnightBangkok);
  const [schedNote, setSchedNote] = useState('');
  /** plan_id → ราคาใหม่ (string ในฟอร์ม) — prefill ด้วยราคาปัจจุบัน ส่งเฉพาะแถวที่เปลี่ยน */
  const [schedPrices, setSchedPrices] = useState<Record<number, string>>({});

  const loadSchedules = async () => {
    try {
      const res = await api.getPriceSchedules();
      setSchedules(res.schedules || []);
    } catch (err) {
      console.error('Load price schedules:', err);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      // Run in parallel — tiers feeds the tier_id dropdown in the edit dialog.
      const [pkgsRes, tiersRes] = await Promise.all([
        api.getAdminPackages() as Promise<any>,
        api.getAdminTiersV2().catch(() => ({ tiers: [] })) as Promise<any>,
        loadSchedules(),
      ]);
      const pkgs: SubscriptionPlan[] = pkgsRes.packages || [];
      setPackages(pkgs);
      setTiers(tiersRes.tiers || []);
      // ฟอร์มตั้งเวลา prefill ราคาปัจจุบัน (ทับค่าเดิมทุกครั้งที่โหลด — ราคาอาจเพิ่งมีผล)
      setSchedPrices(Object.fromEntries(pkgs.map((p) => [p.id, String(p.subtotal)])));
    } catch (err) {
      console.error('Load packages:', err);
      toast.error(l('โหลด packages ไม่สำเร็จ', 'Failed to load packages'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  /** แพ็กเกจที่ตั้งเวลาได้ = สาธารณะ + เปิดใช้ (ราคาพิเศษ/admin-only ไม่เกี่ยวกับราคาหน้าเว็บ) */
  const schedulablePlans = packages.filter((p) => p.is_active && !p.admin_only);
  const schedChanges = schedulablePlans
    .map((p) => ({ plan: p, subtotal: Number(schedPrices[p.id] ?? p.subtotal) }))
    .filter((it) => Number.isFinite(it.subtotal) && it.subtotal >= 0 && Math.abs(it.subtotal - it.plan.subtotal) > 0.001);
  const schedEffIso = schedEff ? bangkokLocalToIso(schedEff) : '';
  const schedEffValid = !!schedEff && !Number.isNaN(new Date(schedEffIso).getTime());

  const handleCreateSchedules = async () => {
    if (!schedEffValid) return toast.error(l('กรุณาเลือกวัน-เวลาที่มีผล', 'Pick the effective date/time'));
    if (new Date(schedEffIso).getTime() < Date.now() + 2 * 60 * 1000) {
      return toast.error(l('เวลาที่มีผลต้องเป็นอนาคตอย่างน้อย 2 นาที', 'Effective time must be at least 2 minutes in the future'));
    }
    if (schedChanges.length === 0) {
      return toast.warning(l('ยังไม่ได้เปลี่ยนราคาแพ็กเกจไหนเลย — แก้ตัวเลขในช่อง "ราคาใหม่" ก่อน', 'No package price changed — edit a "New price" first'));
    }
    setSchedSaving(true);
    try {
      await api.createPriceSchedules({
        effective_at: schedEffIso,
        note: schedNote.trim() || null,
        items: schedChanges.map((it) => ({ plan_id: it.plan.id, subtotal: it.subtotal })),
      });
      const summary = schedChanges
        .map((it) => `${isTh ? (it.plan.name_th || it.plan.name) : it.plan.name} ${fmtMoney(it.plan.subtotal)}→${fmtMoney(it.subtotal)}`)
        .join(' · ');
      toast.success(`⏰ ${fmtBkk(schedEffIso)} · ${summary}`, { duration: 8000 });
      setSchedNote('');
      await load();
    } catch (err: any) {
      const code = err?.errorCode as string | undefined;
      const msg: Record<string, string> = {
        PAST_EFFECTIVE_AT: l('เวลาที่มีผลต้องเป็นอนาคต (อย่างน้อย ~1 นาที)', 'Effective time must be in the future'),
        NO_CHANGE: l('มีแพ็กเกจที่ราคาใหม่เท่ากับราคาปัจจุบัน', 'A package has the same price as now'),
        SCHEDULE_EXISTS: l('มีรายการตั้งเวลา ณ เวลานี้อยู่แล้ว — ยกเลิกรายการเดิมก่อน', 'A schedule already exists at this time — cancel it first'),
      };
      toast.error(code && msg[code] ? `${msg[code]}${err?.message ? ` (${err.message})` : ''}` : (err?.message || l('ตั้งเวลาไม่สำเร็จ', 'Failed to schedule')));
    } finally {
      setSchedSaving(false);
    }
  };

  // ยกเลิกรายการตั้งเวลา — เปิด dialog ยืนยันของเราเอง (ไม่ใช้ window.confirm) โชว์รายละเอียดครบก่อนกด
  const [cancelTarget, setCancelTarget] = useState<PlanPriceSchedule | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const handleCancelSchedule = (s: PlanPriceSchedule) => setCancelTarget(s);
  const confirmCancelSchedule = async () => {
    if (!cancelTarget) return;
    const s = cancelTarget;
    const planLabel = isTh ? (s.plan_name_th || s.plan_name) : s.plan_name;
    setCancelling(true);
    try {
      await api.cancelPriceSchedule(s.id);
      toast.success(l(`ยกเลิกแล้ว — ${planLabel} คงราคาเดิม`, `Cancelled — ${planLabel} keeps its current price`));
      setCancelTarget(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || l('ยกเลิกไม่สำเร็จ', 'Cancel failed'));
      // ALREADY_APPLIED / ALREADY_CANCELLED = สถานะเปลี่ยนไปแล้วระหว่างเปิด dialog → ปิดแล้วโหลดใหม่
      if (err?.errorCode === 'ALREADY_APPLIED' || err?.errorCode === 'ALREADY_CANCELLED') {
        setCancelTarget(null);
        await load();
      }
    } finally {
      setCancelling(false);
    }
  };
  const cancelTargetPlan = cancelTarget ? packages.find((p) => p.id === cancelTarget.plan_id) : undefined;

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm(emptyForm);
    setCommissionError('');
  };
  const openEdit = (pkg: SubscriptionPlan) => {
    setEditing(pkg);
    setCreating(false);
    setForm({
      slug: pkg.slug,
      name: pkg.name,
      name_th: pkg.name_th || '',
      subtotal: String(pkg.subtotal),
      days: String(pkg.days),
      commission_percent: pkg.commission_percent == null ? '' : String(pkg.commission_percent),
      description: pkg.description || '',
      display_order: String(pkg.display_order),
      features: (pkg.features || []).join('\n'),
      is_active: pkg.is_active,
      admin_alt_prices: (pkg.admin_alt_prices || []).map((a) => ({
        label: a.label,
        label_th: a.label_th || '',
        subtotal: String(a.subtotal),
      })),
      tier_id: pkg.tier_id == null ? '' : String(pkg.tier_id),
      admin_only: !!pkg.admin_only,
    });
    setCommissionError('');
  };
  const closeDialog = () => { setEditing(null); setCreating(false); };

  const validateCommission = (val: string): string => {
    if (val.trim() === '') return ''; // optional — empty means use tier
    const n = Number(val);
    if (!Number.isFinite(n)) return l('ต้องเป็นตัวเลข', 'Must be a number');
    if (n < 0 || n > 100) return l('ต้องอยู่ระหว่าง 0–100', 'Must be between 0–100');
    return '';
  };

  const handleSave = async () => {
    // Final validation gate before sending to BE (BE also checks)
    const cErr = validateCommission(form.commission_percent);
    if (cErr) { setCommissionError(cErr); return; }
    if (!form.name.trim()) return toast.error(l('กรุณาใส่ชื่อ', 'Name is required'));
    if (creating && !/^[a-z0-9_-]+$/.test(form.slug)) {
      return toast.error(l('slug ใช้ a-z, 0-9, _ และ - เท่านั้น', 'slug must use a-z, 0-9, _ and - only'));
    }
    const subtotal = Number(form.subtotal);
    const days = Number(form.days);
    if (!Number.isFinite(subtotal) || subtotal < 0) return toast.error(l('subtotal ไม่ถูกต้อง', 'Invalid subtotal'));
    if (!Number.isInteger(days) || days <= 0) return toast.error(l('days ไม่ถูกต้อง', 'Invalid days'));

    // Clean alt prices — drop blank rows; validate the rest
    const cleanedAlts: AdminAltPrice[] = [];
    for (const row of form.admin_alt_prices) {
      const label = row.label.trim();
      const sub = Number(row.subtotal);
      if (!label && !row.subtotal) continue; // blank row — skip
      if (!label) return toast.error(l('Alt price ต้องมี label', 'Alt price requires a label'));
      if (!Number.isFinite(sub) || sub <= 0) {
        return toast.error(l(`Alt price "${label}" — subtotal ไม่ถูกต้อง`, `Alt price "${label}" — invalid subtotal`));
      }
      cleanedAlts.push({
        label,
        label_th: row.label_th.trim() || undefined,
        subtotal: sub,
      });
    }

    const payload: PackageEditInput = {
      name: form.name.trim(),
      name_th: form.name_th.trim() || null,
      subtotal,
      days,
      commission_percent: form.commission_percent.trim() === '' ? null : Number(form.commission_percent),
      description: form.description.trim() || null,
      features: form.features.split('\n').map(s => s.trim()).filter(Boolean),
      display_order: Number(form.display_order) || 0,
      is_active: form.is_active,
      admin_alt_prices: cleanedAlts,
      tier_id: form.tier_id.trim() === '' ? null : Number(form.tier_id),
      admin_only: form.admin_only,
    };
    if (creating) (payload as any).slug = form.slug.trim().toLowerCase();
    // optimistic check: ราคาที่เห็นตอนเปิดฟอร์ม — ถ้าตั้งเวลามีผลไประหว่างเปิด dialog ค้าง server ตอบ 409
    if (!creating && editing) payload.expected_subtotal = editing.subtotal;

    setSaving(true);
    try {
      if (creating) {
        await api.createPackage(payload);
        toast.success(l('สร้าง package เรียบร้อย', 'Package created'));
      } else if (editing) {
        await api.updatePackage(editing.id, payload);
        toast.success(l('บันทึก package เรียบร้อย', 'Package saved'));
      }
      closeDialog();
      load();
    } catch (err: any) {
      if (err?.errorCode === 'PRICE_CHANGED') {
        toast.error(l(
          `ราคาของแพ็กเกจนี้เปลี่ยนไปแล้วระหว่างที่เปิดฟอร์ม (ตอนนี้ ฿${fmtMoney(Number(err?.data?.current_subtotal ?? 0))}) — โหลดข้อมูลใหม่ให้แล้ว กรุณาแก้อีกครั้ง`,
          `This package's price changed while the form was open (now ฿${fmtMoney(Number(err?.data?.current_subtotal ?? 0))}) — reloaded, please edit again`,
        ), { duration: 8000 });
        closeDialog();
        load();
        return;
      }
      toast.error(err?.message || l('บันทึกไม่สำเร็จ', 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pkg: SubscriptionPlan) => {
    if (!confirm(l(
      `ปิดการใช้งาน package "${pkg.name}"? (soft-delete — ยังเก็บ history)`,
      `Deactivate package "${pkg.name}"? (soft-delete — history kept)`,
    ))) return;
    try {
      await api.deactivatePackage(pkg.id);
      toast.success(l('ปิดการใช้งานเรียบร้อย', 'Deactivated'));
      load();
    } catch (err: any) {
      toast.error(err?.message || l('ไม่สำเร็จ', 'Failed'));
    }
  };

  // VAT/total preview while editing
  const previewSubtotal = Number(form.subtotal) || 0;
  const previewVat = +(previewSubtotal * VAT_RATE / 100).toFixed(2);
  const previewTotal = +(previewSubtotal + previewVat).toFixed(2);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Package className="h-5 w-5 text-[#FFB300]" />
          {l('แพ็กเกจสมาชิก', 'Subscription Packages')}
        </h2>
        {isSuperAdmin && (
          <Button onClick={openCreate} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
            <Plus className="h-4 w-4 mr-1" /> {l('เพิ่ม Package', 'Add package')}
          </Button>
        )}
      </div>

      {/* ===== ตั้งเวลาเปลี่ยนราคา (super admin เขียน / admin อ่านอย่างเดียว) ===== */}
      {!loading && schedulablePlans.length > 0 && (
        <div className="rounded-xl border border-[#FFB300]/40 bg-[#FFB300]/5 p-4 space-y-3">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[#FFB300]" />
              {l('⏰ ตั้งเวลาเปลี่ยนราคา', '⏰ Schedule a price change')}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {l(
                'ถึงเวลาที่ตั้ง ราคาบนเว็บจะเปลี่ยนเองเงียบๆ (ไม่มีแถบประกาศ) · ไม่มีช่วงรับราคาเก่า — หลังเวลานี้รับเฉพาะยอดใหม่ · ป้าย -50% และราคาขีดฆ่า ×2 คงเดิม',
                'At the scheduled time the site price switches silently (no banner) · no grace period — only the new amount is accepted afterwards · the -50% badge stays as is',
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">{l('วัน-เวลาที่มีผล (เวลาไทย)', 'Effective date/time (Thai time)')}</label>
              <Input
                type="datetime-local"
                step={60}
                min={toBangkokLocal(new Date(Date.now() + 2 * 60 * 1000))}
                value={schedEff}
                onChange={(e) => setSchedEff(e.target.value)}
                disabled={!isSuperAdmin || schedSaving}
              />
              <p className="text-[10px] text-muted-foreground mt-1">{l('ต้องเป็นอนาคตอย่างน้อย 2 นาที', 'Must be at least 2 minutes in the future')}</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{l('หมายเหตุ (เห็นเฉพาะแอดมิน)', 'Note (admins only)')}</label>
              <Input
                value={schedNote}
                onChange={(e) => setSchedNote(e.target.value)}
                placeholder={l('เช่น ขึ้นราคารอบ ก.ย.', 'e.g. September price increase')}
                disabled={!isSuperAdmin || schedSaving}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="p-2 text-left">{l('แพ็กเกจ (สาธารณะ)', 'Package (public)')}</th>
                  <th className="p-2 text-right">{l('ราคาปัจจุบัน', 'Current')}<div className="text-[10px] font-normal text-muted-foreground">{l('ก่อน VAT', 'before VAT')}</div></th>
                  <th className="p-2 text-right">{l('ราคาใหม่', 'New price')}<div className="text-[10px] font-normal text-muted-foreground">{l('ก่อน VAT · ตัวเลขเต็ม', 'before VAT · full number')}</div></th>
                  <th className="p-2 text-right">{l('ยอดโอนใหม่', 'New total')}<div className="text-[10px] font-normal text-muted-foreground">{l('รวม VAT 7%', 'incl. VAT 7%')}</div></th>
                  <th className="p-2 text-right">{l('เปลี่ยนแปลง', 'Change')}</th>
                </tr>
              </thead>
              <tbody>
                {schedulablePlans.map((p) => {
                  const np = Number(schedPrices[p.id] ?? p.subtotal);
                  const valid = Number.isFinite(np) && np >= 0;
                  const diff = valid ? +(np - p.subtotal).toFixed(2) : 0;
                  const newTotal = valid ? +(np + +(np * VAT_RATE / 100).toFixed(2)).toFixed(2) : 0;
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="p-2">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.name_th ? `${p.name_th} · ` : ''}{p.days} {l('วัน', 'days')}</div>
                      </td>
                      <td className="p-2 text-right">
                        ฿{fmtMoney(p.subtotal)}
                        <div className="text-[10px] text-muted-foreground">{l('ยอดโอน', 'total')} ฿{fmtMoney(p.total)}</div>
                      </td>
                      <td className="p-2 text-right">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={schedPrices[p.id] ?? String(p.subtotal)}
                          onChange={(e) => setSchedPrices({ ...schedPrices, [p.id]: e.target.value })}
                          disabled={!isSuperAdmin || schedSaving}
                          className="w-28 ml-auto text-right font-semibold"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <span className="line-through text-muted-foreground text-xs mr-1">฿{fmtMoney(p.total)}</span>
                        <span className="font-semibold text-[#FFB300]">฿{fmtMoney(newTotal)}</span>
                      </td>
                      <td className={`p-2 text-right font-semibold ${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-muted-foreground font-normal'}`}>
                        {!valid ? '—' : diff === 0 ? l('ไม่เปลี่ยน', 'unchanged') : `${diff > 0 ? '+' : '−'}${fmtMoney(Math.abs(diff))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {schedChanges.length > 0 && schedEffValid ? (
            <div className="text-xs rounded-lg border border-[#FFB300]/30 bg-[#FFB300]/10 p-2">
              📅 <strong className="text-[#FFB300]">{fmtBkk(schedEffIso)}</strong>
              {' · '}
              {schedChanges.map((it) => `${isTh ? (it.plan.name_th || it.plan.name) : it.plan.name} ฿${fmtMoney(it.plan.subtotal)} → ฿${fmtMoney(it.subtotal)}`).join(' · ')}
              <div className="text-muted-foreground mt-1">
                {l(`ก่อน ${fmtBkk(schedEffIso, false)} รับยอดเดิม · ตั้งแต่เวลานั้นรับเฉพาะยอดใหม่ (สลิปยอดเดิมจะไม่ผ่าน)`,
                   `Before ${fmtBkk(schedEffIso, false)} the old amount is accepted · from then on only the new amount (old-amount slips are rejected)`)}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 p-2">
              {l('ยังไม่ได้เปลี่ยนราคาแพ็กเกจไหน — แก้ตัวเลขในช่อง "ราคาใหม่"', 'No package changed yet — edit a "New price"')}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={handleCreateSchedules}
              disabled={!isSuperAdmin || schedSaving || schedChanges.length === 0 || !schedEffValid}
              className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
            >
              {schedSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CalendarClock className="h-4 w-4 mr-1" />}
              {l('ตั้งเวลา', 'Schedule')}
            </Button>
            {!isSuperAdmin && (
              <span className="text-xs text-pink-400">{l('super admin เท่านั้นที่ตั้งเวลาได้ — คุณดูได้อย่างเดียว', 'Super admin only — read-only for you')}</span>
            )}
          </div>

          {/* รายการที่ตั้งไว้ */}
          <div className="pt-2 border-t border-[#FFB300]/20">
            <h4 className="text-sm font-medium flex items-center gap-2 mb-1">
              <History className="h-4 w-4 text-muted-foreground" />
              {l('รายการที่ตั้งไว้', 'Scheduled changes')}
              <span className="text-[10px] text-muted-foreground font-normal">
                {l('รอมีผล = ยกเลิกได้ · มีผลแล้ว = ประวัติ (ตั้งรอบใหม่แทน)', 'pending = cancellable · applied = history (schedule a new one instead)')}
              </span>
            </h4>
            {schedules.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">{l('ยังไม่มีรายการตั้งเวลา', 'No schedules yet')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="p-2 text-left">{l('สถานะ', 'Status')}</th>
                      <th className="p-2 text-left">{l('แพ็กเกจ', 'Package')}</th>
                      <th className="p-2 text-right">{l('ราคา (ก่อน VAT)', 'Price (before VAT)')}</th>
                      <th className="p-2 text-right">{l('ยอดโอน', 'Total')}</th>
                      <th className="p-2 text-left">{l('มีผล (เวลาไทย)', 'Effective (Thai time)')}</th>
                      <th className="p-2 text-left">{l('หมายเหตุ', 'Note')}</th>
                      <th className="p-2 text-left">{l('ผู้ตั้ง', 'By')}</th>
                      {isSuperAdmin && <th className="p-2 text-right"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s) => {
                      const pill = {
                        pending: { cls: 'bg-yellow-500/15 text-yellow-400', txt: l('⏳ รอมีผล', '⏳ Pending') },
                        applied: { cls: 'bg-green-500/15 text-green-400', txt: l('✅ มีผลแล้ว', '✅ Applied') },
                        superseded: { cls: 'bg-purple-500/15 text-purple-400', txt: l('ถูกแทนที่', 'Superseded') },
                        cancelled: { cls: 'bg-muted text-muted-foreground line-through', txt: l('ยกเลิก', 'Cancelled') },
                      }[s.status];
                      return (
                        <tr key={s.id} className={`border-b last:border-0 ${s.status === 'cancelled' ? 'opacity-50' : ''}`}>
                          <td className="p-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${pill.cls}`}>{pill.txt}</span></td>
                          <td className="p-2">
                            <div className="font-medium">{s.plan_name}</div>
                            {s.plan_name_th && isTh && <div className="text-[10px] text-muted-foreground">{s.plan_name_th}</div>}
                          </td>
                          <td className="p-2 text-right">
                            {s.previous_subtotal != null && <span className="line-through text-muted-foreground mr-1">฿{fmtMoney(s.previous_subtotal)}</span>}
                            ฿{fmtMoney(s.subtotal)}
                          </td>
                          <td className="p-2 text-right font-semibold text-[#FFB300]">฿{fmtMoney(s.total)}</td>
                          <td className="p-2 whitespace-nowrap">{fmtBkk(s.effective_at)}</td>
                          <td className="p-2 text-muted-foreground">{s.note || '—'}</td>
                          <td className="p-2 text-muted-foreground">
                            {s.created_by_email || '—'}
                            <div className="text-[10px]">{fmtBkk(s.created_at, false)}</div>
                            {s.status === 'cancelled' && s.cancelled_by_email && (
                              <div className="text-[10px]">{l('ยกเลิกโดย', 'cancelled by')} {s.cancelled_by_email}</div>
                            )}
                          </td>
                          {isSuperAdmin && (
                            <td className="p-2 text-right">
                              {s.status === 'pending' && (
                                <Button variant="ghost" size="sm" onClick={() => handleCancelSchedule(s)} className="h-7 text-xs text-red-400 hover:text-red-500">
                                  <X className="h-3 w-3 mr-1" /> {l('ยกเลิก', 'Cancel')}
                                </Button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" /></div>
      ) : packages.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">{l('ยังไม่มี package', 'No packages yet')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-2 text-left">{l('ชื่อ', 'Name')}</th>
                <th className="p-2 text-right">{l('ราคา', 'Subtotal')}</th>
                <th className="p-2 text-right">VAT 7%</th>
                <th className="p-2 text-right">{l('รวม', 'Total')}</th>
                <th className="p-2 text-right">{l('วัน', 'Days')}</th>
                <th className="p-2 text-right">{l('ค่าคอม', 'Commission')}</th>
                <th className="p-2 text-center">{l('Tier อัตโนมัติ', 'Auto Tier')}</th>
                <th className="p-2 text-center">{l('ราคาพิเศษ', 'Alt prices')}</th>
                <th className="p-2 text-center">{l('การมองเห็น', 'Visibility')}</th>
                <th className="p-2 text-center">{l('เปิดใช้', 'Active')}</th>
                {isSuperAdmin && <th className="p-2 text-right">{l('การจัดการ', 'Actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.id} className={`border-b last:border-0 ${p.is_active ? '' : 'opacity-50'}`}>
                  <td className="p-2">
                    <div className="font-medium">{p.name}</div>
                    {p.name_th && isTh && <div className="text-xs text-muted-foreground">{p.name_th}</div>}
                  </td>
                  <td className="p-2 text-right">
                    ฿{p.subtotal.toLocaleString()}
                    {p.pending_schedule && (
                      <div className="text-[11px] text-yellow-400 whitespace-nowrap" title={l('ตั้งเวลาเปลี่ยนราคาไว้', 'Scheduled price change')}>
                        ⏰ ฿{fmtMoney(p.pending_schedule.subtotal)} · {fmtBkk(p.pending_schedule.effective_at, false)}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-right text-muted-foreground">฿{p.vat.toLocaleString()}</td>
                  <td className="p-2 text-right font-semibold">฿{p.total.toLocaleString()}</td>
                  <td className="p-2 text-right">{p.days}</td>
                  <td className="p-2 text-right">
                    {(() => {
                      // Show the effective commission % the affiliate will earn:
                      //   1. plan override (commission_percent on the row)
                      //   2. tier rate (from the linked tier_id)
                      //   3. dash if neither — caller falls back to user snapshot / default at runtime
                      if (p.commission_percent != null) {
                        return <span className="text-yellow-400">{p.commission_percent}%</span>;
                      }
                      const linkedTier = p.tier_id != null
                        ? tiers.find((t) => t.id === p.tier_id)
                        : undefined;
                      if (linkedTier) {
                        return (
                          <span className="text-green-400" title={`Inherited from ${linkedTier.name}`}>
                            {linkedTier.commission_percent}%
                            <span className="text-[10px] text-muted-foreground ml-0.5">(tier)</span>
                          </span>
                        );
                      }
                      return <span className="text-xs text-muted-foreground">—</span>;
                    })()}
                  </td>
                  <td className="p-2 text-center">
                    {p.tier_id == null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <span className="text-xs text-green-400">
                        {tiers.find((t) => t.id === p.tier_id)?.name || `#${p.tier_id}`}
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {(p.admin_alt_prices?.length || 0) === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-col gap-0.5 items-center">
                        {p.admin_alt_prices.map((a, i) => (
                          <span key={i} className="text-[11px] text-purple-400 whitespace-nowrap">
                            <span className="text-muted-foreground">{a.label}:</span>{' '}
                            ฿{Number(a.subtotal).toLocaleString()}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {p.admin_only ? (
                      <span className="text-xs text-pink-400 font-medium" title={l('ซ่อนจาก Landing — admin เท่านั้น', 'Hidden from Landing — admin only')}>
                        🔒 {l('Admin', 'Admin')}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">{l('สาธารณะ', 'Public')}</span>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {p.is_active
                      ? <Eye className="h-4 w-4 text-green-500 inline" />
                      : <EyeOff className="h-4 w-4 text-gray-500 inline" />}
                  </td>
                  {isSuperAdmin && (
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {p.is_active && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(p)} className="text-red-400 hover:text-red-500">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={creating || !!editing} onOpenChange={(o) => !o && closeDialog()}>
        {/* max-h + flex-col ทำให้ header/footer ค้างที่ขอบบน-ล่าง, ส่วนกลาง
            scroll ได้เมื่อเนื้อหายาว (มี 5 sections — เกินจอบนหลายเครื่อง) */}
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
            <DialogTitle>
              {creating
                ? l('เพิ่ม Package', 'Add Package')
                : l(`แก้ไข ${editing?.name}`, `Edit ${editing?.name}`)}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Basic fields */}
            <div className="grid grid-cols-2 gap-3">
              {/* Slug — แสดงเฉพาะตอน create เท่านั้น (เป็น immutable id หลัง create แล้ว;
                  ใน edit mode ไม่มีประโยชน์ทาง UI — BE ยังใช้). */}
              {creating && (
                <div>
                  <label className="text-xs text-muted-foreground">
                    {l('รหัส (slug) *', 'Slug *')}
                    <span className="ml-1 text-[10px] text-muted-foreground/70">
                      {l('(ใช้ภายในระบบ — แก้ภายหลังไม่ได้)', '(internal id — cannot be changed later)')}
                    </span>
                  </label>
                  <Input
                    value={form.slug}
                    placeholder="quarterly"
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    className="font-mono"
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground">{l('ลำดับการแสดง', 'Display order')}</label>
                <Input
                  type="number"
                  value={form.display_order}
                  onChange={(e) => setForm({ ...form, display_order: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{l('ชื่อ (EN) *', 'Name (EN) *')}</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Quarterly" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{l('ชื่อ (TH)', 'Name (TH)')}</label>
                <Input value={form.name_th} onChange={(e) => setForm({ ...form, name_th: e.target.value })} placeholder="รายไตรมาส" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{l('ราคา (฿, ก่อนภาษีมูลค่าเพิ่ม) *', 'Subtotal (฿, before VAT) *')}</label>
                <Input type="number" value={form.subtotal} onChange={(e) => setForm({ ...form, subtotal: e.target.value })} placeholder="1500" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{l('จำนวนวัน *', 'Days *')}</label>
                <Input type="number" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} placeholder="90" />
              </div>
            </div>

            <div className="text-xs bg-muted/30 p-2 rounded">
              <span className="text-muted-foreground">{l('สรุป: ', 'Preview: ')}</span>
              ฿{previewSubtotal.toLocaleString()} + VAT 7% ฿{previewVat.toLocaleString()} = <strong>฿{previewTotal.toLocaleString()}</strong>
            </div>

            {/* Section 1: Commission */}
            <div className="border-l-2 border-yellow-500/40 pl-3 space-y-2">
              <h3 className="text-sm font-medium text-yellow-400">
                {l('ส่วนที่ 1: ค่าคอมมิชชั่น', 'Section 1: Commission')}
              </h3>
              <div>
                <label className="text-xs text-muted-foreground">
                  {l(
                    'Commission % (0–100) — เว้นว่างเพื่อใช้ tier ของ user',
                    'Commission % (0–100) — leave blank to use user tier',
                  )}
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.commission_percent}
                  onChange={(e) => {
                    setForm({ ...form, commission_percent: e.target.value });
                    setCommissionError(validateCommission(e.target.value));
                  }}
                  placeholder={l('ว่าง = ใช้ tier-based', 'Empty = use tier-based')}
                  className={commissionError ? 'border-red-500' : ''}
                />
                {commissionError && <p className="text-xs text-red-400 mt-1">{commissionError}</p>}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {l(
                    'ถ้าใส่ค่า — จะ override commission ของ user tier เมื่อมีคนซื้อ package นี้',
                    'If set, overrides the user tier commission when someone buys this package',
                  )}
                </p>
              </div>
            </div>

            {/* Section 2: Text detail */}
            <div className="border-l-2 border-blue-500/40 pl-3 space-y-2">
              <h3 className="text-sm font-medium text-blue-400">
                {l('ส่วนที่ 2: รายละเอียด', 'Section 2: Description')}
              </h3>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={l('รายละเอียดของแพ็กเกจ...', 'Package description...')}
                rows={4}
              />
              <div>
                <label className="text-xs text-muted-foreground">
                  {l('คุณสมบัติ (บรรทัดละ 1 รายการ)', 'Features (one per line)')}
                </label>
                <Textarea
                  value={form.features}
                  onChange={(e) => setForm({ ...form, features: e.target.value })}
                  placeholder="Feature 1&#10;Feature 2"
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            {/* Section 3: Admin-only alt prices (e.g. Yearly Promo ฿2,800).
                These NEVER show on Landing; only the admin extend flow accepts
                them as a valid slip amount. */}
            <div className="border-l-2 border-purple-500/40 pl-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-purple-400">
                  {l('ส่วนที่ 3: ราคาพิเศษ (Admin only)', 'Section 3: Alt prices (Admin only)')}
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({
                      ...form,
                      admin_alt_prices: [
                        ...form.admin_alt_prices,
                        { label: '', label_th: '', subtotal: '' },
                      ],
                    })
                  }
                >
                  <Plus className="h-3 w-3 mr-1" /> {l('เพิ่ม', 'Add')}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {l(
                  'ราคาเหล่านี้จะไม่แสดงในหน้า Landing — admin ใช้ตอน upload slip เพื่อให้รับยอดอื่นได้ (เช่น Promo)',
                  'Hidden from Landing — admin uses these to accept alternative amounts (e.g. Promo) when uploading a slip',
                )}
              </p>
              {form.admin_alt_prices.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  {l('ไม่มีราคาพิเศษ', 'No alt prices')}
                </p>
              ) : (
                <div className="space-y-2">
                  {form.admin_alt_prices.map((row, idx) => {
                    const sub = Number(row.subtotal) || 0;
                    const vat = +(sub * VAT_RATE / 100).toFixed(2);
                    const total = +(sub + vat).toFixed(2);
                    return (
                      <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                        <div>
                          <label className="text-[10px] text-muted-foreground">{l('ป้ายชื่อ', 'Label')}</label>
                          <Input
                            value={row.label}
                            onChange={(e) => {
                              const next = [...form.admin_alt_prices];
                              next[idx] = { ...row, label: e.target.value };
                              setForm({ ...form, admin_alt_prices: next });
                            }}
                            placeholder="Promo"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">{l('ป้ายชื่อ (TH)', 'Label (TH)')}</label>
                          <Input
                            value={row.label_th}
                            onChange={(e) => {
                              const next = [...form.admin_alt_prices];
                              next[idx] = { ...row, label_th: e.target.value };
                              setForm({ ...form, admin_alt_prices: next });
                            }}
                            placeholder="โปรโมชั่น"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">
                            {l('ราคา', 'Subtotal')} → ฿{total.toLocaleString()}
                          </label>
                          <Input
                            type="number"
                            value={row.subtotal}
                            onChange={(e) => {
                              const next = [...form.admin_alt_prices];
                              next[idx] = { ...row, subtotal: e.target.value };
                              setForm({ ...form, admin_alt_prices: next });
                            }}
                            placeholder="2800"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-red-400 hover:text-red-500"
                          onClick={() => {
                            const next = form.admin_alt_prices.filter((_, i) => i !== idx);
                            setForm({ ...form, admin_alt_prices: next });
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section 4: Auto-tier on purchase (promote-only). */}
            <div className="border-l-2 border-green-500/40 pl-3 space-y-2">
              <h3 className="text-sm font-medium text-green-400">
                {l('ส่วนที่ 4: Tier อัตโนมัติ (เลื่อนขึ้นเท่านั้น)', 'Section 4: Auto Tier (Promote only)')}
              </h3>
              <label className="text-xs text-muted-foreground">
                {l(
                  'Tier ที่จะกำหนดให้ user เมื่อซื้อ package นี้ — ไม่ลดระดับ',
                  'Tier to assign when user buys this package — never demotes',
                )}
              </label>
              <select
                value={form.tier_id}
                onChange={(e) => setForm({ ...form, tier_id: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              >
                <option value="">
                  {l('— ไม่ auto-assign (manual only) —', '— No auto-assign (manual only) —')}
                </option>
                {tiers
                  .filter((t) => t.is_active)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.commission_percent}%)
                      {t.name_th && isTh ? ` — ${t.name_th}` : ''}
                    </option>
                  ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                {l(
                  '• ถ้า user มี tier สูงกว่าอยู่แล้ว — ไม่เปลี่ยน',
                  '• If user already has a higher tier — no change',
                )}
                <br />
                {l('• Tier list มาจาก /admin → Tiers tab', '• Tier list comes from /admin → Tiers tab')}
              </p>
            </div>

            {/* Section 5: Admin-only visibility flag. */}
            <div className="border-l-2 border-pink-500/40 pl-3 space-y-2">
              <h3 className="text-sm font-medium text-pink-400">
                {l('ส่วนที่ 5: Admin only (ซ่อนจาก Landing)', 'Section 5: Admin only (Hidden from Landing)')}
              </h3>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.admin_only}
                  onChange={(e) => setForm({ ...form, admin_only: e.target.checked })}
                />
                <span>
                  {l('ซ่อนจาก Landing / Subscription page', 'Hide from Landing / Subscription page')}
                  <span className="text-[11px] text-muted-foreground">
                    {l(' ( admin จัดการเอง )', ' ( managed by admin )')}
                  </span>
                </span>
              </label>
            </div>

            {!creating && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                {l('Active (เปิดใช้งานแพ็กเกจ)', 'Active (enable this package)')}
              </label>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border">
            <Button variant="outline" onClick={closeDialog}>{l('ยกเลิก', 'Cancel')}</Button>
            <Button onClick={handleSave} disabled={saving || !!commissionError} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {l('บันทึก', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== ยืนยันยกเลิกรายการตั้งเวลา ===== */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => { if (!o && !cancelling) setCancelTarget(null); }}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          {cancelTarget && (() => {
            const s = cancelTarget;
            const planLabel = isTh ? (s.plan_name_th || s.plan_name) : s.plan_name;
            const currentSub = cancelTargetPlan?.subtotal ?? s.previous_subtotal ?? null;
            const currentTotal = cancelTargetPlan?.total ?? (currentSub != null ? +(currentSub + +(currentSub * VAT_RATE / 100).toFixed(2)).toFixed(2) : null);
            return (
              <>
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
                  <DialogTitle className="flex items-center gap-2 text-red-400">
                    <AlertTriangle className="h-5 w-5" />
                    {l('ยกเลิกการตั้งเวลาเปลี่ยนราคา?', 'Cancel this scheduled price change?')}
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    {l(
                      'รายการนี้จะไม่มีผล ราคาบนเว็บคงเดิมจนกว่าจะตั้งใหม่ · ประวัติยังเก็บไว้ (สถานะ "ยกเลิก")',
                      'This schedule will not take effect; the site price stays as is until you schedule again · kept in history as "Cancelled"',
                    )}
                  </DialogDescription>
                </DialogHeader>

                <div className="px-6 py-4 space-y-3">
                  <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{l('แพ็กเกจ', 'Package')}</span>
                      <span className="font-semibold">{planLabel} <span className="text-xs text-muted-foreground font-normal">({s.plan_slug})</span></span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{l('ราคา (ก่อน VAT)', 'Price (before VAT)')}</span>
                      <span className="flex items-center gap-2 font-semibold">
                        {currentSub != null && <span className="text-muted-foreground">฿{fmtMoney(currentSub)}</span>}
                        {currentSub != null && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className="line-through text-red-400/80">฿{fmtMoney(s.subtotal)}</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{l('ยอดโอน (รวม VAT)', 'Total (incl. VAT)')}</span>
                      <span className="flex items-center gap-2">
                        {currentTotal != null && <span className="text-muted-foreground">฿{fmtMoney(currentTotal)}</span>}
                        {currentTotal != null && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className="line-through text-red-400/80">฿{fmtMoney(s.total)}</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{l('เวลามีผล (เวลาไทย)', 'Effective (Thai time)')}</span>
                      <span className="font-medium">{fmtBkk(s.effective_at)}</span>
                    </div>
                    {s.note && (
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-xs text-muted-foreground shrink-0">{l('หมายเหตุ', 'Note')}</span>
                        <span className="text-sm text-right">{s.note}</span>
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-xs text-muted-foreground shrink-0">{l('ตั้งโดย', 'Set by')}</span>
                      <span className="text-xs text-right break-all">
                        {s.created_by_email || '—'}
                        <span className="block text-muted-foreground">{fmtBkk(s.created_at, false)}</span>
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                    {currentSub != null
                      ? l(
                          `หลังยกเลิก ${planLabel} จะยังขาย ฿${fmtMoney(currentSub)} (ยอดโอน ฿${fmtMoney(currentTotal!)}) ต่อไป — อยากเปลี่ยนเวลา/ราคา ให้ยกเลิกแล้วตั้งใหม่`,
                          `After cancelling, ${planLabel} keeps selling at ฿${fmtMoney(currentSub)} (total ฿${fmtMoney(currentTotal!)}) — to change the time/price, cancel and schedule again`,
                        )
                      : l('หลังยกเลิก ราคาปัจจุบันของแพ็กเกจจะคงเดิม', 'After cancelling, the current package price stays as is')}
                  </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t border-border gap-2">
                  <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                    {l('เก็บรายการไว้', 'Keep it')}
                  </Button>
                  {/* variant=destructive — variant default เป็น gradient ทอง (background-image) ทับ bg-red-* */}
                  <Button variant="destructive" onClick={confirmCancelSchedule} disabled={cancelling} className="bg-red-600 hover:bg-red-700 text-white font-bold">
                    {cancelling ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <X className="h-4 w-4 mr-1" />}
                    {l('ยืนยันยกเลิก', 'Yes, cancel it')}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
