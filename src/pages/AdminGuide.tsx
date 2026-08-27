import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type GuideClipDto } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import GuideAdminsPanel from '@/components/guide/GuideAdminsPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  Plus,
  Loader2,
  Youtube,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  X,
} from 'lucide-react';

// ── ตัวช่วยเล็กๆ ที่ใช้ร่วมกับหน้า /guide ────────────────────────────────
const YT_ID = /(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/;

/** ภาพปกพรีวิวในหน้า admin — ใช้ตรรกะเดียวกับการ์ดบนหน้า /guide */
const previewThumb = (clip: { url?: string; thumbnail?: string | null }): string | null => {
  if (clip.thumbnail) return clip.thumbnail;
  const id = clip.url?.match(YT_ID)?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
};

type LinkRow = { label: string; url: string };

const emptyForm = {
  title: '',
  subtitle: '',
  url: '',
  thumbnail: '',
  is_active: true,
  links: [] as LinkRow[],
};

/**
 * ระบบจัดการคลิปคู่มือ (/admin/guide)
 *
 * แก้แล้วขึ้นหน้า /guide ทันทีโดยไม่ต้อง deploy ใหม่ — หน้า /guide อ่านจาก
 * /api/guide/clips ส่วนไฟล์ clipsData.ts ในโค้ดเหลือไว้เป็นตัวสำรองตอน API ล่ม
 */
const AdminGuide = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [clips, setClips] = useState<GuideClipDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GuideClipDto | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GuideClipDto | null>(null);

  const load = async () => {
    try {
      setClips(await api.getAdminGuideClips());
    } catch (err: any) {
      toast.error(err?.message || 'โหลดคลิปไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  // ผู้ดูแลคู่มือ (is_guide_admin) เข้าหน้านี้ได้ แต่เห็นเฉพาะส่วนจัดการคลิป
  const canEditClips = !!(user?.isAdmin || user?.isSuperAdmin || user?.isGuideAdmin);
  const isFullAdmin = !!(user?.isAdmin || user?.isSuperAdmin);

  useEffect(() => {
    if (!canEditClips) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!canEditClips) {
    return (
      <div className="page-wrapper flex items-center justify-center">
        <p className="text-muted-foreground">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
      </div>
    );
  }

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (clip: GuideClipDto) => {
    setEditing(clip);
    setForm({
      title: clip.title || '',
      subtitle: clip.subtitle || '',
      url: clip.url || '',
      thumbnail: clip.thumbnail || '',
      is_active: clip.is_active,
      links: Array.isArray(clip.links) ? clip.links.map((l) => ({ ...l })) : [],
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.url.trim()) {
      toast.error('ต้องใส่ลิงก์คลิป');
      return;
    }
    setSaving(true);
    try {
      // ปุ่มลิงก์ที่กรอกไม่ครบทั้งชื่อและ URL ตัดทิ้ง ไม่ต้องให้ผู้ใช้มาลบเอง
      const payload = {
        ...form,
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        url: form.url.trim(),
        thumbnail: form.thumbnail.trim(),
        links: form.links.filter((l) => l.label.trim() && l.url.trim()),
      };
      if (editing) {
        await api.updateGuideClip(editing.id, payload);
        toast.success('บันทึกแล้ว');
      } else {
        await api.createGuideClip(payload);
        toast.success('เพิ่มคลิปแล้ว');
      }
      setDialogOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (clip: GuideClipDto) => {
    try {
      await api.updateGuideClip(clip.id, { ...clip, is_active: !clip.is_active });
      setClips((prev) => prev.map((c) => (c.id === clip.id ? { ...c, is_active: !c.is_active } : c)));
    } catch (err: any) {
      toast.error(err?.message || 'เปลี่ยนสถานะไม่สำเร็จ');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteGuideClip(deleteTarget.id);
      toast.success('ลบคลิปแล้ว');
      setClips((prev) => prev.filter((c) => c.id !== deleteTarget.id));
    } catch (err: any) {
      toast.error(err?.message || 'ลบไม่สำเร็จ');
    } finally {
      setDeleteTarget(null);
    }
  };

  /** สลับตำแหน่งกับใบข้างเคียง แล้วบันทึกลำดับใหม่ทั้งชุด */
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= clips.length) return;
    const next = [...clips];
    [next[index], next[target]] = [next[target], next[index]];
    setClips(next);
    setSavingOrder(true);
    try {
      await api.reorderGuideClips(next.map((c) => c.id));
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกลำดับไม่สำเร็จ');
      await load(); // ลำดับบนจอกับใน DB ต้องไม่หลุดจากกัน
    } finally {
      setSavingOrder(false);
    }
  };

  const updateLink = (index: number, patch: Partial<LinkRow>) =>
    setForm((f) => ({ ...f, links: f.links.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));

  return (
    <div className="page-wrapper">
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="container mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(isFullAdmin ? '/admin' : '/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Youtube className="h-5 w-5 text-[#FFB300]" /> จัดการคลิปคู่มือ
            </h1>
            <p className="text-xs text-muted-foreground">
              คลิปที่แสดงบนหน้า /guide — แก้แล้วขึ้นทันที ไม่ต้อง deploy ใหม่
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.open('/guide', '_blank')} className="gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" /> ดูหน้าจริง
          </Button>
          <Button size="sm" onClick={openCreate} className="gap-1.5 bg-[#FFB300] text-black hover:bg-[#FFB300]/90">
            <Plus className="h-4 w-4" /> เพิ่มคลิป
          </Button>
        </div>
      </div>

      <div className="container mx-auto max-w-5xl px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : clips.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <Youtube className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">ยังไม่มีคลิป — กด "เพิ่มคลิป" เพื่อเริ่ม</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {clips.map((clip, index) => {
              const thumb = previewThumb(clip);
              return (
                <Card key={clip.id} className={clip.is_active ? '' : 'opacity-60'}>
                  <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                    {/* ลำดับการแสดงผลบนหน้า /guide */}
                    <div className="flex shrink-0 flex-row items-center gap-1 sm:flex-col">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={index === 0 || savingOrder}
                        onClick={() => move(index, -1)}
                        aria-label="เลื่อนขึ้น"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <span className="w-6 text-center text-xs text-muted-foreground">{index + 1}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={index === clips.length - 1 || savingOrder}
                        onClick={() => move(index, 1)}
                        aria-label="เลื่อนลง"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="aspect-video w-full shrink-0 overflow-hidden rounded-md border border-border bg-muted sm:w-40">
                      {thumb ? (
                        <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                          ไม่มีภาพปก
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{clip.title || '(ไม่มีชื่อคลิป)'}</p>
                        {!clip.is_active && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            ซ่อนอยู่
                          </Badge>
                        )}
                      </div>
                      {clip.subtitle && <p className="text-xs text-muted-foreground">{clip.subtitle}</p>}
                      <p className="mt-0.5 truncate text-xs text-muted-foreground/70">{clip.url}</p>
                      {clip.links?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {clip.links.map((link, i) => (
                            <Badge key={i} variant="outline" className="gap-1 text-[10px] text-[#FFB300]">
                              {link.label} <ExternalLink className="h-2.5 w-2.5" />
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleActive(clip)}
                        title={clip.is_active ? 'ซ่อนจากหน้า /guide' : 'แสดงบนหน้า /guide'}
                      >
                        {clip.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(clip)} title="แก้ไข">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(clip)}
                        title="ลบ"
                        className="text-red-400 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {isFullAdmin && <GuideAdminsPanel />}
      </div>

      {/* ── ฟอร์มเพิ่ม / แก้ไขคลิป ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไขคลิป' : 'เพิ่มคลิป'}</DialogTitle>
            <DialogDescription>
              ใส่ลิงก์ YouTube แล้วกดบันทึก — คลิปจะขึ้นบนหน้า /guide ทันทีโดยไม่ต้อง deploy ใหม่
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>ลิงก์ YouTube *</Label>
              <Input
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://www.youtube.com/watch?v=..."
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                ใส่ได้ทุกแบบ: watch?v= / youtu.be / embed / shorts — ภาพปกดึงจาก YouTube ให้เอง
              </p>
            </div>

            {previewThumb(form) && (
              <img
                src={previewThumb(form)!}
                alt=""
                className="aspect-video w-full rounded-md border border-border object-cover"
              />
            )}

            <div>
              <Label>ชื่อคลิป</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="เช่น Ep 6. คู่มือการเชื่อมต่อ YouTube"
                className="mt-1"
              />
            </div>

            <div>
              <Label>คำอธิบายสั้น</Label>
              <Input
                value={form.subtitle}
                onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
                placeholder="บรรทัดเล็กใต้ชื่อคลิป (ไม่ใส่ก็ได้)"
                className="mt-1"
              />
            </div>

            <div>
              <Label>ภาพปกเอง (ไม่ใส่ = ใช้ของ YouTube)</Label>
              <Input
                value={form.thumbnail}
                onChange={(e) => setForm((f) => ({ ...f, thumbnail: e.target.value }))}
                placeholder="/banner1.jpg หรือ https://..."
                className="mt-1"
              />
            </div>

            {/* ปุ่มลิงก์ใต้การ์ด */}
            <div>
              <div className="flex items-center justify-between">
                <Label>ปุ่มลิงก์ใต้การ์ด</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setForm((f) => ({ ...f, links: [...f.links, { label: '', url: '' }] }))}
                >
                  <Plus className="h-3 w-3" /> เพิ่มปุ่ม
                </Button>
              </div>
              {form.links.length === 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  ยังไม่มีปุ่ม — เช่น "ไฟล์แนบ" หรือ "ดูบน YouTube" (กดแล้วเปิดแท็บใหม่)
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {form.links.map((link, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={link.label}
                        onChange={(e) => updateLink(i, { label: e.target.value })}
                        placeholder="ชื่อปุ่ม"
                        className="w-32 shrink-0"
                      />
                      <Input
                        value={link.url}
                        onChange={(e) => updateLink(i, { url: e.target.value })}
                        placeholder="https://..."
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => setForm((f) => ({ ...f, links: f.links.filter((_, j) => j !== i) }))}
                        aria-label="ลบปุ่ม"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v === true }))}
              />
              <span className="text-sm">แสดงบนหน้า /guide</span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button onClick={save} disabled={saving} className="bg-[#FFB300] text-black hover:bg-[#FFB300]/90">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {editing ? 'บันทึก' : 'เพิ่มคลิป'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบคลิปนี้?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.title || deleteTarget?.url} — ลบแล้วจะหายจากหน้า /guide ทันที และกู้คืนไม่ได้
              (ถ้าแค่อยากพักไว้ ให้กดไอคอนรูปตาเพื่อซ่อนแทน)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              ลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminGuide;
