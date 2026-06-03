import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ImageIcon, Plus, Loader2, Upload, Pencil, Trash2, CheckCircle2, Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

/**
 * Admin → /admin/banners → "Welcome popup" tab.
 *
 * Manages the swap library of images shown by `<WelcomePopup>`. Schema
 * is light (image_url + link_url + label + is_active) — distinct from
 * the rich `update_banners` content system on the other tab.
 *
 * Invariants:
 *   • Exactly one row can be active at a time (enforced by partial unique
 *     index server-side).
 *   • Deleting the active row is blocked — admin must activate another
 *     first.
 *   • Each row has a stable image URL (Dropbox); replacing the file means
 *     uploading new + updating the row (or creating a new row).
 */

type Banner = {
  id: number;
  image_url: string;
  link_url: string | null;     // optional — null = popup is non-clickable (display-only)
  label: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

// Suggested default for new banners (placeholder in input) — admin can clear
// it to publish a display-only popup with no click destination.
const SUGGESTED_LINK = '/app/image-templates';

export default function WelcomeBannersPanel() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Create/edit dialog state
  const [editing, setEditing] = useState<Banner | (Omit<Banner, 'id'> & { id?: number }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Activate confirm
  const [activating, setActivating] = useState<Banner | null>(null);
  // Delete confirm
  const [deleting, setDeleting] = useState<Banner | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.listWelcomeBanners();
      setBanners(r.banners);
    } catch (err: any) {
      toast.error(err?.message || 'โหลด banner ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing({
      image_url: '',
      link_url: '',          // empty by default — admin can paste a path or leave blank
      label: '',
      is_active: false,
      display_order: 0,
      created_at: '',
      updated_at: '',
    });
  };

  const handleUpload = async (file: File) => {
    if (!editing) return;
    setUploading(true);
    try {
      const r = await api.uploadBannerImage(file);
      setEditing({ ...editing, image_url: r.url });
      toast.success('อัปโหลดสำเร็จ');
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดล้มเหลว');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.image_url.trim()) {
      toast.error('กรุณาอัปโหลดรูปหรือใส่ URL');
      return;
    }
    setSaving(true);
    try {
      // Normalize link_url — empty / whitespace → null (BE stores SQL NULL).
      // The input field accepts empty as a valid "display-only" submission.
      const normalizedLink = editing.link_url?.trim() ? editing.link_url.trim() : null;
      if ((editing as Banner).id) {
        await api.updateWelcomeBanner((editing as Banner).id, {
          image_url: editing.image_url,
          link_url: normalizedLink,
          label: editing.label,
          display_order: editing.display_order,
        });
        toast.success('บันทึกแล้ว');
      } else {
        await api.createWelcomeBanner({
          image_url: editing.image_url,
          link_url: normalizedLink,
          label: editing.label || undefined,
          display_order: editing.display_order,
        });
        toast.success('สร้างแล้ว');
      }
      setEditing(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmActivate = async () => {
    if (!activating) return;
    setBusyId(activating.id);
    try {
      await api.activateWelcomeBanner(activating.id);
      toast.success('สลับ active แล้ว');
      setActivating(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'สลับไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await api.deleteWelcomeBanner(deleting.id);
      toast.success('ลบแล้ว');
      setDeleting(null);
      await load();
    } catch (err: any) {
      const msg = (err?.message || '').toString();
      if (msg.includes('cannot_delete_active') || msg.includes('active')) {
        toast.error('ลบไม่ได้ — กรุณาตั้ง banner อื่นเป็น active ก่อน');
      } else {
        toast.error(err?.message || 'ลบไม่สำเร็จ');
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-[#FFB300]" />
            Welcome Popup
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            รูป popup ที่เด้งเมื่อ user login. มีได้หลายรูป แต่ active ได้ทีละ 1 รูปเท่านั้น —
            เก็บรูปเดิมไว้ใน list เผื่อสลับกลับ
          </p>
        </div>
        <Button onClick={openCreate} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
          <Plus className="h-4 w-4 mr-1" /> เพิ่มรูปใหม่
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" />
        </div>
      ) : banners.length === 0 ? (
        <p className="text-center py-12 text-muted-foreground">ยังไม่มีรูป — กด "เพิ่มรูปใหม่"</p>
      ) : (
        <div className="space-y-2">
          {banners.map((b) => {
            const busy = busyId === b.id;
            return (
              <div
                key={b.id}
                className={`flex items-center gap-3 p-3 rounded-lg border bg-card transition-colors ${
                  b.is_active ? 'border-green-500/40 bg-green-500/5' : 'hover:border-[#FFB300]/40'
                }`}
              >
                {/* Thumbnail */}
                <div className="w-32 h-20 rounded overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                  {b.image_url ? (
                    <img src={b.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">no image</span>
                  )}
                </div>

                {/* Meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {b.is_active && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </span>
                    )}
                    <span className="font-semibold truncate">
                      {b.label || <span className="text-muted-foreground italic">(ไม่มี label)</span>}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {b.link_url ? (
                      <>→ {b.link_url}</>
                    ) : (
                      <span className="italic">ไม่มี destination (popup แสดงอย่างเดียว)</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(b.created_at).toLocaleString('th-TH')}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {!b.is_active && (
                    <Button
                      size="sm"
                      onClick={() => setActivating(b)}
                      disabled={busy}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Set active'}
                    </Button>
                  )}
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setEditing(b)}
                    title="แก้ไข"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!b.is_active && (
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setDeleting(b)}
                      className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                      title="ลบ"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o && !saving) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {(editing as Banner | null)?.id ? 'แก้ไข Welcome banner' : 'เพิ่ม Welcome banner'}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              {/* Image preview + upload */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  รูป Banner <span className="text-[10px] opacity-70">— แนะนำ 1200×675 (16:9)</span>
                </label>
                <div className="flex items-center gap-3">
                  <div className="w-40 h-24 rounded border border-zinc-700 bg-zinc-800 overflow-hidden flex items-center justify-center">
                    {editing.image_url ? (
                      <img src={editing.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-muted-foreground">ยังไม่มีรูป</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload(f);
                      }}
                    />
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                      อัปโหลด
                    </Button>
                    <Input
                      value={editing.image_url}
                      onChange={(e) => setEditing({ ...editing, image_url: e.target.value })}
                      placeholder="หรือใส่ URL ตรงๆ"
                      className="text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Label */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Label (ไว้ดูเองว่าเป็นรูปอะไร)</label>
                <Input
                  value={editing.label || ''}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder="เช่น Promo May 2026"
                />
              </div>

              {/* Destination link (optional) */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Destination (ตอน user คลิกรูป) — <span className="italic">ปล่อยว่างได้</span>
                </label>
                <Input
                  value={editing.link_url ?? ''}
                  onChange={(e) => setEditing({ ...editing, link_url: e.target.value })}
                  placeholder={SUGGESTED_LINK}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  ใส่ path ภายใน (เช่น <code>/app/image-templates</code>) หรือ URL เต็ม (https://…).
                  <b className="text-foreground"> ถ้าปล่อยว่าง</b> — คลิกรูปจะแค่ปิด popup เฉยๆ ไม่ navigate
                </p>
              </div>

              {!(editing as Banner).id && (
                <p className="text-xs text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded border border-yellow-500/30">
                  💡 รูปใหม่จะถูกสร้างเป็น <b>inactive</b> — กด "Set active" ในรายการเพื่อเริ่มใช้งาน
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !editing?.image_url?.trim()}
              className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate confirm */}
      <AlertDialog open={!!activating} onOpenChange={(o) => { if (!o && !busyId) setActivating(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ตั้งเป็น Active?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>รูปนี้จะแสดงเป็น Welcome popup ทันที — รูปเดิมจะถูก deactivate</p>
                <p className="text-xs text-muted-foreground">
                  User ที่เคยกด "ไม่ต้องแสดงอีก" สำหรับรูปเดิม จะเห็น popup เด้งใหม่
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmActivate(); }}
              disabled={!!busyId}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {busyId ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              ตั้งเป็น Active
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o && !busyId) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบ banner นี้?</AlertDialogTitle>
            <AlertDialogDescription>
              การลบไม่สามารถย้อนกลับได้ — รูปจะหายจาก list แต่ไฟล์รูปบน Dropbox ไม่ถูกลบตาม
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
              disabled={!!busyId}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {busyId ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              ลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
