import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Crown, Plus, Pencil, Trash2, Loader2, Eye, EyeOff, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { AffiliateTierRecord, TierEditInput } from '@/types/affiliate';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Admin tab for managing affiliate tiers (affiliate_tiers table).
 *
 * Read access: any admin.
 * Write access: super admin only — buttons hide for normal admins.
 *
 * Edit dialog has 2 main sections per spec:
 *   1. Commission % (REQUIRED, 0–100 validation)
 *   2. Text detail (description textarea)
 *
 * Delete: rejects with 409 if any user is still assigned to the tier.
 */

interface FormState {
  name: string;
  name_th: string;
  commission_percent: string;
  description: string;
  display_order: string;
  badge_color: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  name: '', name_th: '', commission_percent: '', description: '',
  display_order: '0', badge_color: 'gray', is_active: true,
};

const BADGE_COLORS = ['gray', 'gold', 'diamond'] as const;

export default function AdminTiersPanel() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isTh = language === 'th';
  const l = (th: string, en: string) => (isTh ? th : en);
  const isSuperAdmin = !!user?.isSuperAdmin;
  const [tiers, setTiers] = useState<AffiliateTierRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AffiliateTierRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [commissionError, setCommissionError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res: any = await api.getAdminTiersV2();
      setTiers(res.tiers || []);
    } catch (err) {
      console.error('Load tiers:', err);
      toast.error(l('โหลด tiers ไม่สำเร็จ', 'Failed to load tiers'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setCreating(true); setForm(emptyForm); setCommissionError(''); };
  const openEdit = (t: AffiliateTierRecord) => {
    setEditing(t);
    setCreating(false);
    setForm({
      name: t.name,
      name_th: t.name_th || '',
      commission_percent: String(t.commission_percent),
      description: t.description || '',
      display_order: String(t.display_order),
      badge_color: t.badge_color || 'gray',
      is_active: t.is_active,
    });
    setCommissionError('');
  };
  const closeDialog = () => { setEditing(null); setCreating(false); };

  const validateCommission = (val: string): string => {
    if (val.trim() === '') return l('จำเป็นต้องใส่', 'Required');
    const n = Number(val);
    if (!Number.isFinite(n)) return l('ต้องเป็นตัวเลข', 'Must be a number');
    if (n < 0 || n > 100) return l('ต้องอยู่ระหว่าง 0–100', 'Must be between 0–100');
    return '';
  };

  const handleSave = async () => {
    const cErr = validateCommission(form.commission_percent);
    if (cErr) { setCommissionError(cErr); return; }
    if (!form.name.trim()) return toast.error(l('กรุณาใส่ชื่อ', 'Name is required'));

    const payload: TierEditInput = {
      name: form.name.trim(),
      name_th: form.name_th.trim() || null,
      commission_percent: Number(form.commission_percent),
      description: form.description.trim() || null,
      display_order: Number(form.display_order) || 0,
      badge_color: form.badge_color,
      is_active: form.is_active,
    };

    setSaving(true);
    try {
      if (creating) {
        await api.createTier(payload);
        toast.success(l('สร้าง tier เรียบร้อย', 'Tier created'));
      } else if (editing) {
        await api.updateTierV2(editing.id, payload);
        toast.success(l('บันทึก tier เรียบร้อย', 'Tier saved'));
      }
      closeDialog();
      load();
    } catch (err: any) {
      toast.error(err?.message || l('บันทึกไม่สำเร็จ', 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: AffiliateTierRecord) => {
    if (t.user_count && t.user_count > 0) {
      toast.error(l(
        `ลบไม่ได้ — มี user ${t.user_count} คนใน tier นี้ ย้าย user ก่อนนะ`,
        `Cannot delete — ${t.user_count} user(s) assigned to this tier. Reassign them first.`,
      ));
      return;
    }
    if (!confirm(l(
      `ลบ tier "${t.name}"? การลบจะถาวร (ถ้ามีประวัติ commission ยังคงอยู่)`,
      `Delete tier "${t.name}"? This is permanent (commission history is kept).`,
    ))) return;
    try {
      await api.deleteTierV2(t.id);
      toast.success(l('ลบเรียบร้อย', 'Deleted'));
      load();
    } catch (err: any) {
      if (err?.errorCode === 'TIER_IN_USE') {
        toast.error(err.message || l('ยังมี user ใน tier นี้', 'Users are still assigned to this tier'));
      } else {
        toast.error(err?.message || l('ลบไม่สำเร็จ', 'Delete failed'));
      }
    }
  };

  const badgeClass = (color: string) =>
    color === 'gold' ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 text-yellow-500'
    : color === 'diamond' ? 'bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-cyan-400'
    : 'bg-gray-500/20 text-gray-400';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Crown className="h-5 w-5 text-[#FFB300]" />
          {l('ระดับผู้แนะนำ', 'Affiliate Tiers')}
        </h2>
        {isSuperAdmin && (
          <Button onClick={openCreate} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
            <Plus className="h-4 w-4 mr-1" /> {l('เพิ่ม Tier', 'Add Tier')}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" /></div>
      ) : tiers.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">{l('ยังไม่มี tier', 'No tiers yet')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-2 text-left">{l('ชื่อ', 'Name')}</th>
                <th className="p-2 text-right">{l('ค่าคอม', 'Commission')}</th>
                <th className="p-2 text-center">{l('ป้าย', 'Badge')}</th>
                <th className="p-2 text-right">{l('ลำดับ', 'Order')}</th>
                <th className="p-2 text-right">{l('ผู้ใช้', 'Users')}</th>
                <th className="p-2 text-center">{l('เปิดใช้', 'Active')}</th>
                {isSuperAdmin && <th className="p-2 text-right">{l('การจัดการ', 'Actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.id} className={`border-b last:border-0 ${t.is_active ? '' : 'opacity-50'}`}>
                  <td className="p-2">
                    <div className="font-medium">{t.name}</div>
                    {t.name_th && isTh && <div className="text-xs text-muted-foreground">{t.name_th}</div>}
                  </td>
                  <td className="p-2 text-right text-yellow-400 font-semibold">{t.commission_percent}%</td>
                  <td className="p-2 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${badgeClass(t.badge_color)}`}>
                      {t.badge_color}
                    </span>
                  </td>
                  <td className="p-2 text-right">{t.display_order}</td>
                  <td className="p-2 text-right">
                    <span className="text-xs inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {t.user_count ?? 0}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    {t.is_active ? <Eye className="h-4 w-4 text-green-500 inline" /> : <EyeOff className="h-4 w-4 text-gray-500 inline" />}
                  </td>
                  {isSuperAdmin && (
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => handleDelete(t)}
                          disabled={!!(t.user_count && t.user_count > 0)}
                          className="text-red-400 hover:text-red-500 disabled:opacity-30"
                          title={t.user_count && t.user_count > 0
                            ? l('มี user อยู่ — ลบไม่ได้', 'Users assigned — cannot delete')
                            : l('ลบ tier', 'Delete tier')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
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
        {/* max-h + flex-col so header/footer stay docked, only middle scrolls. */}
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
            <DialogTitle>
              {creating
                ? l('เพิ่ม Tier', 'Add Tier')
                : l(`แก้ไข ${editing?.name}`, `Edit ${editing?.name}`)}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">{l('ชื่อ (EN) *', 'Name (EN) *')}</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Diamond" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{l('ชื่อ (TH)', 'Name (TH)')}</label>
                <Input value={form.name_th} onChange={(e) => setForm({ ...form, name_th: e.target.value })} placeholder="ระดับเพชร" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{l('ลำดับการแสดง', 'Display order')}</label>
                <Input type="number" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{l('สีป้าย', 'Badge color')}</label>
                <select
                  value={form.badge_color}
                  onChange={(e) => setForm({ ...form, badge_color: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                >
                  {BADGE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Section 1: Commission */}
            <div className="border-l-2 border-yellow-500/40 pl-3 space-y-2">
              <h3 className="text-sm font-medium text-yellow-400">
                {l('ส่วนที่ 1: ค่าคอมมิชชั่น', 'Section 1: Commission')}
              </h3>
              <div>
                <label className="text-xs text-muted-foreground">{l('Commission % (0–100) *', 'Commission % (0–100) *')}</label>
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
                  placeholder="30"
                  className={commissionError ? 'border-red-500' : ''}
                />
                {commissionError && <p className="text-xs text-red-400 mt-1">{commissionError}</p>}
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
                placeholder={l('เกณฑ์การได้ tier นี้ / สิทธิประโยชน์ / หมายเหตุ...', 'Criteria / benefits / notes...')}
                rows={5}
              />
            </div>

            {!creating && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                {l('Active (ใช้งานได้)', 'Active (enabled)')}
              </label>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border">
            <Button variant="outline" onClick={closeDialog}>{l('ยกเลิก', 'Cancel')}</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !!commissionError}
              className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {l('บันทึก', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
