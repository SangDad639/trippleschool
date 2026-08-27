import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, type GuideGroupDto } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Plus,
  Loader2,
  BookOpen,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  PlayCircle,
  Upload,
  Trash,
} from 'lucide-react';

const emptyForm = { title: '', description: '', cover_url: '', is_active: true };

interface GuideGroupsPanelProps {
  /** กดเข้าไปจัดการคลิปในกลุ่มนั้น */
  onSelect: (group: GuideGroupDto) => void;
}

/**
 * กลุ่มคู่มือ (ชั้นเดียวกับ "คอร์ส")
 * สร้างกลุ่มก่อน แล้วค่อยเข้าไปใส่คลิปข้างใน — โครงเดียวกับคอร์ส/บทเรียน
 */
const GuideGroupsPanel = ({ onSelect }: GuideGroupsPanelProps) => {
  const [groups, setGroups] = useState<GuideGroupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GuideGroupDto | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GuideGroupDto | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setGroups(await api.getAdminGuideGroups());
    } catch (err: any) {
      toast.error(err?.message || 'โหลดกลุ่มคู่มือไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (group: GuideGroupDto) => {
    setEditing(group);
    setForm({
      title: group.title,
      description: group.description || '',
      cover_url: group.cover_url || '',
      is_active: group.is_active,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) {
      toast.error('ต้องใส่ชื่อกลุ่ม');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        cover_url: form.cover_url.trim(),
        is_active: form.is_active,
      };
      if (editing) {
        await api.updateGuideGroup(editing.id, payload);
        toast.success('บันทึกแล้ว');
      } else {
        await api.createGuideGroup(payload);
        toast.success('สร้างกลุ่มแล้ว — กดเข้าไปใส่คลิปได้เลย');
      }
      setDialogOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (group: GuideGroupDto) => {
    try {
      await api.updateGuideGroup(group.id, { ...group, is_active: !group.is_active });
      setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, is_active: !g.is_active } : g)));
    } catch (err: any) {
      toast.error(err?.message || 'เปลี่ยนสถานะไม่สำเร็จ');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteGuideGroup(deleteTarget.id);
      toast.success('ลบกลุ่มแล้ว');
      setGroups((prev) => prev.filter((g) => g.id !== deleteTarget.id));
    } catch (err: any) {
      toast.error(err?.message || 'ลบไม่สำเร็จ');
    } finally {
      setDeleteTarget(null);
    }
  };

  /** อัปโหลดปกกลุ่ม — ท่อเดียวกับปกคอร์ส (S3 + ย่อ variant card/hero) */
  const handleCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('รองรับเฉพาะไฟล์รูปภาพ');
      return;
    }
    setCoverBusy(true);
    try {
      const { url } = await api.uploadGuideImage(file);
      setForm((f) => ({ ...f, cover_url: url }));
      toast.success('อัปโหลดปกแล้ว');
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดปกไม่สำเร็จ');
    } finally {
      setCoverBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= groups.length) return;
    const next = [...groups];
    [next[index], next[target]] = [next[target], next[index]];
    setGroups(next);
    setSavingOrder(true);
    try {
      await api.reorderGuideGroups(next.map((g) => g.id));
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกลำดับไม่สำเร็จ');
      await load(); // ลำดับบนจอกับใน DB ต้องไม่หลุดจากกัน
    } finally {
      setSavingOrder(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">กลุ่มคู่มือ</h2>
        <Button size="sm" onClick={openCreate} className="gap-1.5 bg-[#FFB300] text-black hover:bg-[#FFB300]/90">
          <Plus className="h-4 w-4" /> สร้างกลุ่ม
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              ยังไม่มีกลุ่มคู่มือ — กด "สร้างกลุ่ม" ก่อน แล้วค่อยใส่คลิปข้างใน
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {groups.map((group, index) => (
            <Card key={group.id} className={group.is_active ? '' : 'opacity-60'}>
              <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
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
                    disabled={index === groups.length - 1 || savingOrder}
                    onClick={() => move(index, 1)}
                    aria-label="เลื่อนลง"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>

                <button
                  onClick={() => onSelect(group)}
                  className="aspect-video w-full shrink-0 overflow-hidden rounded-md border border-border bg-muted sm:w-40"
                  aria-label={`จัดการคลิปใน ${group.title}`}
                >
                  {group.cover_url ? (
                    <img src={api.mediaUrl(group.cover_url, 'card')} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <BookOpen className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </button>

                <button onClick={() => onSelect(group)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{group.title}</p>
                    {!group.is_active && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        ซ่อนอยู่
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <PlayCircle className="h-3 w-3" />
                    {Number(group.clip_count) || 0} คลิป · /guide/{group.slug}
                  </p>
                  {group.description && (
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/70">{group.description}</p>
                  )}
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSelect(group)}
                    className="gap-1 text-xs"
                  >
                    จัดการคลิป <ChevronRight className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleActive(group)}
                    title={group.is_active ? 'ซ่อนจากหน้า /guide' : 'แสดงบนหน้า /guide'}
                  >
                    {group.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(group)} title="แก้ไข">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(group)}
                    title="ลบ"
                    className="text-red-400 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไขกลุ่มคู่มือ' : 'สร้างกลุ่มคู่มือ'}</DialogTitle>
            <DialogDescription>
              กลุ่มทำหน้าที่เหมือนคอร์ส — สร้างกลุ่มแล้วเข้าไปใส่คลิปข้างในได้เลย
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>ชื่อกลุ่ม *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="เช่น คู่มือเชื่อมต่อแพลตฟอร์ม"
                className="mt-1"
              />
              {editing && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  ลิงก์ของกลุ่มนี้คือ /guide/{editing.slug} (เปลี่ยนชื่อแล้วลิงก์เดิมยังใช้ได้เหมือนเดิม)
                </p>
              )}
            </div>

            <div>
              <Label>คำอธิบาย</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="อธิบายสั้นๆ ว่ากลุ่มนี้สอนอะไร (ไม่ใส่ก็ได้)"
                className="mt-1"
                rows={3}
              />
            </div>

            {/* ปกกลุ่ม — ทรงเดียวกับปกคอร์สในหน้าจัดการคอร์ส */}
            <div>
              <Label>ภาพปก</Label>
              <div className="mt-1 flex items-center gap-3">
                {form.cover_url.trim() ? (
                  <img
                    src={api.mediaUrl(form.cover_url.trim(), 'card')}
                    alt="ภาพปก"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = '0.2';
                    }}
                    className="aspect-video w-32 rounded-md border border-gray-700 bg-gray-800 object-cover"
                  />
                ) : (
                  <div className="flex aspect-video w-32 items-center justify-center rounded-md border border-gray-700 bg-gray-800 text-[10px] text-muted-foreground">
                    ยังไม่มีปก
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={coverBusy}
                    onClick={() => coverInputRef.current?.click()}
                    className="gap-1.5"
                  >
                    {coverBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    อัปโหลดปก
                  </Button>
                  {form.cover_url.trim() && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={coverBusy}
                      onClick={() => setForm((f) => ({ ...f, cover_url: '' }))}
                      className="gap-1.5 text-gray-400"
                    >
                      <Trash className="h-3.5 w-3.5" /> เอาปกออก
                    </Button>
                  )}
                  <p className="text-[11px] text-gray-500">แนะนำอัตราส่วน 16:9 · ไม่เกิน 5MB</p>
                </div>
                <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverFile} />
              </div>
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
              {editing ? 'บันทึก' : 'สร้างกลุ่ม'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบกลุ่มนี้?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" มี {Number(deleteTarget?.clip_count) || 0} คลิป —{' '}
              <b>คลิปทั้งหมดในกลุ่มจะถูกลบไปด้วย</b> และกู้คืนไม่ได้
              (ถ้าแค่อยากพักไว้ ให้กดไอคอนรูปตาเพื่อซ่อนแทน)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              ลบทั้งกลุ่ม
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default GuideGroupsPanel;
