import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { SubscriptionPlan, UserPackageCommission } from '@/types/pricing';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Per-(user × package) commission override editor.
 *
 * Opened from the user's row in /admin → Users tab (super admin only).
 *
 * Behaviour:
 *   - Lists every active subscription plan as one row.
 *   - Empty input = "no override" → resolution falls back to plan/tier/snapshot.
 *   - Filled input (0–100) = the % to pay this user when someone they refer
 *     buys this specific plan.
 *
 * Bulk save: we send PUT for every changed row, DELETE for rows the user
 * cleared. Idempotent on the backend (UPSERT / soft delete).
 */
interface Props {
  userId: number | null;
  userEmail?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RowState {
  planId: number;
  slug: string;
  name: string;
  /** The persisted override value (null = none). Used to detect deletes. */
  initial: number | null;
  /** The current input value as a string ('' = no override). */
  draft: string;
  error: string;
}

export default function UserCommissionDialog({ userId, userEmail, open, onOpenChange }: Props) {
  const { language } = useLanguage();
  const isTh = language === 'th';
  const l = (th: string, en: string) => (isTh ? th : en);
  // We only need the row list; plans is derived once at load.
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reload when the dialog opens for a user
  useEffect(() => {
    if (!open || userId == null) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        // Plans + existing overrides in parallel.
        const [pkgsRes, ovrRes] = await Promise.all([
          api.getAdminPackages() as Promise<any>,
          api.getUserCommissionOverrides(userId) as Promise<any>,
        ]);
        if (cancelled) return;
        const allPlans: SubscriptionPlan[] = (pkgsRes.packages || []).filter((p: any) => p.is_active);
        const overrides: UserPackageCommission[] = ovrRes.overrides || [];
        const byPlan = new Map<number, UserPackageCommission>();
        for (const o of overrides) byPlan.set(o.plan_id, o);
        setRows(
          allPlans.map((p) => {
            const v = byPlan.get(p.id);
            return {
              planId: p.id,
              slug: p.slug,
              name: p.name,
              initial: v ? Number(v.commission_percent) : null,
              draft: v ? String(v.commission_percent) : '',
              error: '',
            };
          })
        );
      } catch (err) {
        console.error('Load user commissions:', err);
        toast.error(l('โหลดข้อมูล commission ไม่สำเร็จ', 'Failed to load commission data'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, userId]);

  const updateRow = (planId: number, draft: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.planId !== planId) return r;
        let error = '';
        if (draft.trim() !== '') {
          const n = Number(draft);
          if (!Number.isFinite(n) || n < 0 || n > 100) {
            error = l('ต้องอยู่ระหว่าง 0–100', 'Must be between 0–100');
          }
        }
        return { ...r, draft, error };
      })
    );
  };

  const clearRow = (planId: number) => updateRow(planId, '');

  const handleSave = async () => {
    if (userId == null) return;
    if (rows.some((r) => r.error)) {
      toast.error(l('แก้ค่าผิดให้ถูกต้องก่อนบันทึก', 'Fix validation errors before saving'));
      return;
    }
    setSaving(true);
    try {
      const ops: Promise<unknown>[] = [];
      for (const r of rows) {
        const trimmed = r.draft.trim();
        if (trimmed === '') {
          // Row is now empty
          if (r.initial != null) {
            ops.push(api.deleteUserCommissionOverride(userId, r.planId));
          }
        } else {
          const n = Number(trimmed);
          // Save when the value actually changed (or no row existed yet)
          if (r.initial == null || n !== r.initial) {
            ops.push(api.setUserCommissionOverride(userId, r.planId, n));
          }
        }
      }
      if (ops.length === 0) {
        toast.info(l('ไม่มีการเปลี่ยนแปลง', 'No changes'));
      } else {
        await Promise.all(ops);
        toast.success(l(`บันทึก ${ops.length} รายการเรียบร้อย`, `Saved ${ops.length} item(s)`));
      }
      onOpenChange(false);
    } catch (err: any) {
      console.error('Save user commissions:', err);
      toast.error(err?.message || l('บันทึกไม่สำเร็จ', 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
          <DialogTitle>{l('Commission ต่อ Package', 'Commission per package')}</DialogTitle>
          {userEmail && (
            <p className="text-sm text-muted-foreground mt-1">{userEmail}</p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
            {l(
              'เว้นว่าง = ใช้ commission ตาม tier ของ user ปกติ',
              'Empty = use the user\'s tier commission as usual',
            )}
            <br />
            {l(
              'ใส่ตัวเลข (0–100) = override commission สำหรับ package นั้นโดยเฉพาะ',
              'Enter a number (0–100) to override commission for that specific package',
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {l('ไม่มี package', 'No packages')}
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.planId} className="grid grid-cols-[1fr_140px_auto] gap-2 items-center">
                  <div>
                    <div className="text-sm font-medium">{r.name}</div>
                  </div>
                  <div>
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={r.draft}
                        onChange={(e) => updateRow(r.planId, e.target.value)}
                        placeholder={l('ใช้ tier', 'use tier')}
                        className={`pr-7 ${r.error ? 'border-red-500' : ''}`}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        %
                      </span>
                    </div>
                    {r.error && <p className="text-xs text-red-400 mt-1">{r.error}</p>}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-500 disabled:opacity-30"
                    disabled={r.draft.trim() === ''}
                    onClick={() => clearRow(r.planId)}
                    title={l('ล้าง override (ใช้ tier)', 'Clear override (use tier)')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {l('ยกเลิก', 'Cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || loading || rows.some((r) => r.error)}
            className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            {l('บันทึก', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
