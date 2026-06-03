import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Ticket, Plus, Loader2, Copy, Check, Pause, Play, Pencil, Trash2, User, Users } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { CouponCode, CouponListResponse } from '@/types/coupon';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Admin tab for managing coupon codes (migrations 012 + 015).
 *
 * Two modes per code (set at create time via max_uses):
 *   - Single-use (max_uses=1, default)  — 1 user globally
 *   - Multi-use (max_uses=null|N)        — many users, but 1 per user
 *
 * Bulk-create dialog accepts `days` + `count` (1–100) + max_uses + optional
 * notes. Generated codes are shown as a read-only textarea so admin can copy
 * + paste them into an email / marketing tool.
 *
 * List supports status filter (all/active/exhausted/inactive) + free-text
 * search on code + notes. Edit is intentionally minimal: toggle is_active,
 * update notes/max_uses only — codes/days are immutable after creation.
 */

type Status = 'all' | 'active' | 'exhausted' | 'inactive';
type UseType = 'single' | 'multi';

export default function AdminCouponsPanel() {
  const { user } = useAuth();
  const isSuperAdmin = !!user?.isSuperAdmin;
  const { language } = useLanguage();
  const isTh = language === 'th';
  const l = (th: string, en: string) => (isTh ? th : en);

  const [coupons, setCoupons] = useState<CouponCode[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchActive, setSearchActive] = useState('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  // Create dialog
  const [creating, setCreating] = useState(false);
  const [days, setDays] = useState('30');
  const [count, setCount] = useState('10');
  const [notes, setNotes] = useState('');
  const [useType, setUseType] = useState<UseType>('single');
  // For multi-use: blank string = unlimited; numeric string = capped to N total.
  const [maxUsesInput, setMaxUsesInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  // Edit dialog (notes + max_uses)
  const [editing, setEditing] = useState<CouponCode | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editUseType, setEditUseType] = useState<UseType>('single');
  const [editMaxUses, setEditMaxUses] = useState('');

  // Delete confirmation
  const [deleting, setDeleting] = useState<CouponCode | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = (await api.listCoupons({ status, q: searchActive, limit, offset })) as CouponListResponse;
      setCoupons(res.coupons || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error('Load coupons:', err);
      toast.error(l('โหลดคูปองไม่สำเร็จ', 'Failed to load coupons'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, searchActive, offset]);

  const onSearch = () => { setOffset(0); setSearchActive(searchInput.trim()); };

  const resetCreateForm = () => {
    setDays('30');
    setCount('10');
    setNotes('');
    setUseType('single');
    setMaxUsesInput('');
    setGeneratedCodes(null);
    setCopied(false);
  };

  const handleCreate = async () => {
    const d = Number(days);
    const c = Number(count);
    if (!Number.isInteger(d) || d <= 0 || d > 3650) {
      return toast.error(l('จำนวนวันต้องเป็น 1–3650', 'Days must be 1–3650'));
    }
    if (!Number.isInteger(c) || c <= 0 || c > 100) {
      return toast.error(l('จำนวนโค้ดต้องเป็น 1–100', 'Count must be 1–100'));
    }
    // Resolve max_uses from UI: single → 1; multi+blank → null (unlimited);
    // multi+N → positive integer.
    let maxUses: number | null = 1;
    if (useType === 'multi') {
      const raw = maxUsesInput.trim();
      if (raw === '') {
        maxUses = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1) {
          return toast.error(l('จำนวนครั้งสูงสุดต้องเป็นจำนวนเต็มบวก (เว้นว่าง = unlimited)', 'Max uses must be a positive integer (blank = unlimited)'));
        }
        maxUses = n;
      }
    }
    setSaving(true);
    try {
      const res: any = await api.createCoupons({
        days: d,
        count: c,
        max_uses: maxUses,
        notes: notes.trim() || undefined,
      });
      setGeneratedCodes((res.created || []).map((x: any) => x.code));
      toast.success(l(`สร้าง ${c} โค้ดเรียบร้อย`, `Created ${c} code(s)`));
      setOffset(0);
      load();
    } catch (err: any) {
      toast.error(err?.message || l('สร้างไม่สำเร็จ', 'Create failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (c: CouponCode) => {
    try {
      await api.patchCoupon(c.id, { is_active: !c.is_active });
      toast.success(c.is_active
        ? l('ปิดใช้งานโค้ดแล้ว', 'Coupon deactivated')
        : l('เปิดใช้งานโค้ดแล้ว', 'Coupon activated'));
      load();
    } catch (err: any) {
      toast.error(err?.message || l('ไม่สำเร็จ', 'Failed'));
    }
  };

  const handleSaveEdits = async () => {
    if (!editing) return;
    // Resolve max_uses from edit form (same logic as create).
    let maxUses: number | null = 1;
    if (editUseType === 'multi') {
      const raw = editMaxUses.trim();
      if (raw === '') {
        maxUses = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1) {
          return toast.error(l('จำนวนครั้งสูงสุดต้องเป็นจำนวนเต็มบวก', 'Max uses must be a positive integer'));
        }
        // Block dropping cap below existing usage_count.
        if (n < editing.usage_count) {
          return toast.error(l(
            `ลดได้ต่ำสุด ${editing.usage_count} (ใช้ไปแล้ว)`,
            `Cannot drop below ${editing.usage_count} (already used)`,
          ));
        }
        maxUses = n;
      }
    }
    try {
      await api.patchCoupon(editing.id, {
        notes: editNotes.trim() || null,
        max_uses: maxUses,
      });
      toast.success(l('บันทึกแล้ว', 'Saved'));
      setEditing(null);
      load();
    } catch (err: any) {
      toast.error(err?.message || l('บันทึกไม่สำเร็จ', 'Save failed'));
    }
  };

  const openEditDialog = (c: CouponCode) => {
    setEditing(c);
    setEditNotes(c.notes || '');
    // Reconstruct UI state from max_uses: 1 = single; anything else = multi.
    if (c.max_uses === 1) {
      setEditUseType('single');
      setEditMaxUses('');
    } else {
      setEditUseType('multi');
      setEditMaxUses(c.max_uses == null ? '' : String(c.max_uses));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.deleteCoupon(deleting.id);
      toast.success(l('ลบโค้ดแล้ว', 'Coupon deleted'));
      setDeleting(null);
      load();
    } catch (err: any) {
      // BE returns 409 with error='already_redeemed' for redeemed codes
      const msg = err?.message === 'already_redeemed'
        ? l('โค้ดนี้ถูกใช้ไปแล้ว — ลบไม่ได้ ให้กดปิดใช้งานแทน', 'This coupon was redeemed — cannot delete. Deactivate instead.')
        : (err?.message || l('ลบไม่สำเร็จ', 'Delete failed'));
      toast.error(msg);
    } finally {
      setDeletingBusy(false);
    }
  };

  const copyAllGenerated = () => {
    if (!generatedCodes) return;
    navigator.clipboard.writeText(generatedCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusLabel = useMemo(() => ({
    all:       l('ทั้งหมด', 'All'),
    active:    l('ใช้ได้', 'Active'),
    exhausted: l('ใช้เต็มแล้ว', 'Exhausted'),
    inactive:  l('ปิดใช้งาน', 'Inactive'),
  }), [isTh]); // eslint-disable-line react-hooks/exhaustive-deps

  /** "3 / 10" or "3 / ∞" for usage display. */
  const usageText = (c: CouponCode) =>
    c.max_uses == null ? `${c.usage_count} / ∞` : `${c.usage_count} / ${c.max_uses}`;

  const statusBadge = (c: CouponCode) => {
    const cap = c.max_uses;
    const exhausted = cap != null && c.usage_count >= cap;
    if (!c.is_active) return <span className="text-xs px-2 py-0.5 rounded bg-gray-500/20 text-gray-400">{l('ปิดใช้งาน', 'Inactive')}</span>;
    if (exhausted)    return <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">{l('ใช้เต็มแล้ว', 'Exhausted')}</span>;
    return <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">{l('ใช้ได้', 'Active')}</span>;
  };

  /** Label for the coupon type (single-use vs multi-use) with icon. */
  const typeLabel = (c: CouponCode) => {
    if (c.max_uses === 1) {
      return (
        <span className="inline-flex items-center gap-1 text-blue-400">
          <User className="h-3 w-3" />
          {l('ครั้งเดียว', 'Single')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[#FFB300]">
        <Users className="h-3 w-3" />
        {l('หลายครั้ง', 'Multi')}
      </span>
    );
  };

  /** "Redeemers" cell — varies by type and count. */
  const redeemersCell = (c: CouponCode) => {
    if (c.usage_count === 0) {
      return <span className="text-muted-foreground">—</span>;
    }
    const dateStr = c.redeemed_at ? new Date(c.redeemed_at).toLocaleString(isTh ? 'th-TH' : 'en-US') : '';
    const email = c.redeemed_by_email;
    // Single-use → show THE user clearly
    if (c.max_uses === 1) {
      return (
        <>
          <div>{email || '—'}</div>
          {dateStr && <div className="text-muted-foreground">{dateStr}</div>}
        </>
      );
    }
    // Multi-use → show count + first redeemer hint
    const extras = c.usage_count - 1;
    return (
      <>
        <div className="font-medium text-[#FFB300]">
          {c.usage_count} {l('คน', 'people')}
        </div>
        {email && (
          <div className="text-muted-foreground text-[11px]">
            {email}{extras > 0 ? ` +${extras} ${l('คน', 'more')}` : ''}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Ticket className="h-5 w-5 text-[#FFB300]" />
          {l('โค้ดคูปอง', 'Coupon Codes')}
        </h2>
        {isSuperAdmin && (
          <Button
            onClick={() => { resetCreateForm(); setCreating(true); }}
            className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
          >
            <Plus className="h-4 w-4 mr-1" /> {l('สร้างโค้ด', 'Create codes')}
          </Button>
        )}
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={status}
          onChange={(e) => { setOffset(0); setStatus(e.target.value as Status); }}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="all">{statusLabel.all}</option>
          <option value="active">{statusLabel.active}</option>
          <option value="exhausted">{statusLabel.exhausted}</option>
          <option value="inactive">{statusLabel.inactive}</option>
        </select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          placeholder={l('ค้นหาโค้ด / notes', 'Search code / notes')}
          className="max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={onSearch}>{l('ค้นหา', 'Search')}</Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {l('ทั้งหมด', 'Total')}: {total}
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" />
        </div>
      ) : coupons.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">{l('ยังไม่มีคูปอง', 'No coupons yet')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-2 text-left font-mono text-xs">{l('โค้ด', 'Code')}</th>
                <th className="p-2 text-right">{l('วัน', 'Days')}</th>
                <th className="p-2 text-left">{l('ประเภท', 'Type')}</th>
                <th className="p-2 text-center">{l('ใช้แล้ว', 'Usage')}</th>
                <th className="p-2 text-left">{l('Notes', 'Notes')}</th>
                <th className="p-2 text-center">{l('สถานะ', 'Status')}</th>
                <th className="p-2 text-left">{l('ผู้ใช้', 'Redeemers')}</th>
                <th className="p-2 text-left">{l('สร้างเมื่อ', 'Created')}</th>
                <th className="p-2 text-right">{l('การจัดการ', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => {
                const exhausted = c.max_uses != null && c.usage_count >= c.max_uses;
                const hasRedemption = c.usage_count > 0;
                const isMulti = c.max_uses !== 1;
                // Subtle left-border accent so single vs multi reads at a glance:
                //   blue = single-use (1 user globally)
                //   gold = multi-use (many users, 1 per account)
                const rowAccent = isMulti
                  ? 'border-l-2 border-l-[#FFB300]/40'
                  : 'border-l-2 border-l-blue-500/40';
                return (
                  <tr key={c.id} className={`border-b last:border-0 ${rowAccent} ${exhausted ? 'opacity-70' : ''}`}>
                    <td className="p-2 font-mono text-xs font-bold">{c.code}</td>
                    <td className="p-2 text-right">{c.days}</td>
                    <td className="p-2 text-xs">{typeLabel(c)}</td>
                    <td className="p-2 text-center font-mono text-xs">{usageText(c)}</td>
                    <td className="p-2 text-xs text-muted-foreground max-w-[200px] truncate" title={c.notes ?? undefined}>
                      {c.notes || '—'}
                    </td>
                    <td className="p-2 text-center">{statusBadge(c)}</td>
                    <td className="p-2 text-xs">{redeemersCell(c)}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString(isTh ? 'th-TH' : 'en-US')}
                    </td>
                    {/* Edit + pause/resume always available. Delete hidden once any
                        redemption exists (BE refuses anyway — preserve audit trail). */}
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => openEditDialog(c)}
                          title={l('แก้ไข', 'Edit')}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => handleToggleActive(c)}
                          className={c.is_active ? 'text-yellow-400' : 'text-green-400'}
                          title={c.is_active
                            ? l('ปิดใช้งาน', 'Deactivate')
                            : l('เปิดใช้งาน', 'Activate')}
                        >
                          {c.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                        {!hasRedemption && (
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => setDeleting(c)}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            title={l('ลบโค้ด', 'Delete coupon')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={(o) => { if (!o) { setCreating(false); resetCreateForm(); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
            <DialogTitle>{l('สร้างโค้ดคูปอง', 'Create Coupon Codes')}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {!generatedCodes ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {l('จำนวนวันที่ให้', 'Days granted')}
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                      placeholder="30"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {l('จำนวนโค้ด (1–100)', 'Code count (1–100)')}
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={count}
                      onChange={(e) => setCount(e.target.value)}
                      placeholder="10"
                    />
                  </div>
                </div>
                {/* Type — single vs multi. Multi reveals an optional cap input. */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">
                    {l('ประเภทการใช้งาน', 'Usage type')}
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="useType"
                        checked={useType === 'single'}
                        onChange={() => setUseType('single')}
                        className="mt-1"
                      />
                      <div className="text-sm">
                        <div>{l('ใช้ได้ครั้งเดียว', 'Single-use')}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {l('1 ผู้ใช้ทั่วโลก (แบบเดิม)', '1 user globally (legacy default)')}
                        </div>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="useType"
                        checked={useType === 'multi'}
                        onChange={() => setUseType('multi')}
                        className="mt-1"
                      />
                      <div className="text-sm flex-1">
                        <div>{l('ใช้ได้หลายครั้ง · คนละ 1 ครั้ง', 'Multi-use · once per account')}</div>
                        <div className="text-[11px] text-muted-foreground mb-1">
                          {l(
                            'หลายคน redeem ได้ — แต่ 1 บัญชี = 1 ครั้ง',
                            'Many users can redeem — each account once',
                          )}
                        </div>
                        {useType === 'multi' && (
                          <Input
                            type="number"
                            min={1}
                            value={maxUsesInput}
                            onChange={(e) => setMaxUsesInput(e.target.value)}
                            placeholder={l('เว้นว่าง = unlimited', 'Blank = unlimited')}
                            className="mt-1 max-w-[200px]"
                          />
                        )}
                      </div>
                    </label>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">
                    {l('หมายเหตุ (ระบุชื่อ campaign ก็ได้)', 'Notes (campaign name etc.)')}
                  </label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={l('ตัวอย่าง: Influencer Q2', 'e.g. Influencer Q2')}
                    rows={2}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {l(
                    'โค้ดที่สร้างจะเป็นตัวอักษร 8 ตัว (A-Z, 2-9). ไม่หมดอายุ — ปิดใช้งานเอาทีหลังได้.',
                    'Each code is 8 characters (A-Z, 2-9). No expiry — deactivate manually any time.',
                  )}
                </p>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-3 text-sm">
                  ✅ {l(`สร้างสำเร็จ ${generatedCodes.length} โค้ด`, `Generated ${generatedCodes.length} code(s) successfully`)}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-muted-foreground">
                      {l('โค้ดทั้งหมด (copy ได้)', 'All codes (copyable)')}
                    </label>
                    <Button variant="outline" size="sm" onClick={copyAllGenerated}>
                      {copied
                        ? <><Check className="h-3 w-3 mr-1 text-green-500" /> {l('คัดลอกแล้ว', 'Copied')}</>
                        : <><Copy className="h-3 w-3 mr-1" /> {l('คัดลอกทั้งหมด', 'Copy all')}</>}
                    </Button>
                  </div>
                  <Textarea
                    readOnly
                    value={generatedCodes.join('\n')}
                    rows={Math.min(generatedCodes.length, 12)}
                    className="font-mono text-sm"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border">
            {generatedCodes ? (
              <Button onClick={() => { setCreating(false); resetCreateForm(); }} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
                {l('เสร็จสิ้น', 'Done')}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setCreating(false); resetCreateForm(); }}>
                  {l('ยกเลิก', 'Cancel')}
                </Button>
                <Button onClick={handleCreate} disabled={saving} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  {l('สร้าง', 'Create')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation — destructive, so route through AlertDialog rather
          than relying on a single click. Only fires for unredeemed codes (button
          is hidden otherwise); BE also enforces the same rule defensively. */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o && !deletingBusy) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{l('ลบโค้ดคูปอง?', 'Delete coupon?')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{l(
                  'การลบไม่สามารถย้อนกลับได้ — โค้ดนี้จะหายไปจากระบบ',
                  'This action cannot be undone — the code will be removed permanently.',
                )}</p>
                {deleting && (
                  <p className="font-mono text-sm bg-muted px-2 py-1 rounded">
                    {deleting.code} · {deleting.days} {l('วัน', 'days')}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBusy}>{l('ยกเลิก', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
              disabled={deletingBusy}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deletingBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {l('ลบ', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit dialog — notes + max_uses */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{l('แก้ไขโค้ด', 'Edit coupon')}</DialogTitle>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {editing?.code} · {editing?.usage_count} {l('ครั้งที่ใช้แล้ว', 'used')}
            </p>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Usage type — same control as Create */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">
                {l('ประเภทการใช้งาน', 'Usage type')}
              </label>
              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="editUseType"
                    checked={editUseType === 'single'}
                    onChange={() => setEditUseType('single')}
                    disabled={(editing?.usage_count ?? 0) > 1}
                    className="mt-1"
                  />
                  <div className="text-sm">
                    <div>{l('ใช้ได้ครั้งเดียว', 'Single-use')}</div>
                    {(editing?.usage_count ?? 0) > 1 && (
                      <div className="text-[11px] text-muted-foreground">
                        {l('เปลี่ยนเป็น single ไม่ได้ — ใช้ไปหลายคนแล้ว', 'Cannot revert to single — already used by multiple')}
                      </div>
                    )}
                  </div>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="editUseType"
                    checked={editUseType === 'multi'}
                    onChange={() => setEditUseType('multi')}
                    className="mt-1"
                  />
                  <div className="text-sm flex-1">
                    <div>{l('ใช้ได้หลายครั้ง · คนละ 1 ครั้ง', 'Multi-use · once per account')}</div>
                    {editUseType === 'multi' && (
                      <Input
                        type="number"
                        min={editing?.usage_count ?? 1}
                        value={editMaxUses}
                        onChange={(e) => setEditMaxUses(e.target.value)}
                        placeholder={l('เว้นว่าง = unlimited', 'Blank = unlimited')}
                        className="mt-1 max-w-[200px]"
                      />
                    )}
                  </div>
                </label>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{l('หมายเหตุ', 'Notes')}</label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder={l('หมายเหตุ', 'Notes')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{l('ยกเลิก', 'Cancel')}</Button>
            <Button onClick={handleSaveEdits} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
              {l('บันทึก', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
