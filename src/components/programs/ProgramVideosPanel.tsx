import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, type ProgramVideoDto, type ProgramVideoInput } from '@/lib/api';
import { parseVideoUrl } from '@/lib/parseVideoUrl';
import ProgramVideo from './ProgramVideo';
import { isEmbeddableVideoUrl } from './videoLinks';
import type { Program } from './programsData';
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
import { Plus, Loader2, Film, Pencil, Trash2, Eye, EyeOff, ChevronUp, ChevronDown } from 'lucide-react';

/** ปกในรายการ — มีเฉพาะคลิป YouTube (Drive / .mp4 ไม่มีภาพปกให้ดึง) */
const youtubeThumb = (url: string): string | null => {
  const { type, videoId } = parseVideoUrl(url);
  return type === 'youtube' && videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
};

const emptyForm: ProgramVideoInput = { title: '', url: '', is_active: true };

interface ProgramVideosPanelProps {
  program: Program;
}

/**
 * คลิปคู่มือของโปรแกรมหนึ่งตัว — แก้แล้วขึ้นหน้า /programs/<slug> ทันทีโดยไม่ต้อง deploy
 * คลิปแรกคือคลิปที่เล่นก่อน · มีหลายคลิปหน้าเว็บจะมีรายการให้กดสลับ
 */
const ProgramVideosPanel = ({ program }: ProgramVideosPanelProps) => {
  const [videos, setVideos] = useState<ProgramVideoDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProgramVideoDto | null>(null);
  const [form, setForm] = useState<ProgramVideoInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProgramVideoDto | null>(null);

  const load = async () => {
    try {
      setVideos(await api.getAdminProgramVideos(program.slug));
    } catch (err: any) {
      toast.error(err?.message || 'โหลดคลิปไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program.slug]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (video: ProgramVideoDto) => {
    setEditing(video);
    setForm({ title: video.title || '', url: video.url, is_active: video.is_active });
    setDialogOpen(true);
  };

  const save = async () => {
    const payload = { ...form, title: form.title.trim(), url: form.url.trim() };
    if (!payload.url) {
      toast.error('ต้องใส่ลิงก์คลิป');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateProgramVideo(editing.id, payload);
        toast.success('บันทึกแล้ว');
      } else {
        await api.createProgramVideo(program.slug, payload);
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

  const toggleActive = async (video: ProgramVideoDto) => {
    try {
      const updated = await api.updateProgramVideo(video.id, {
        title: video.title,
        url: video.url,
        is_active: !video.is_active,
      });
      setVideos((prev) => prev.map((v) => (v.id === video.id ? updated : v)));
    } catch (err: any) {
      toast.error(err?.message || 'เปลี่ยนสถานะไม่สำเร็จ');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteProgramVideo(deleteTarget.id);
      toast.success('ลบคลิปแล้ว');
      setVideos((prev) => prev.filter((v) => v.id !== deleteTarget.id));
    } catch (err: any) {
      toast.error(err?.message || 'ลบไม่สำเร็จ');
    } finally {
      setDeleteTarget(null);
    }
  };

  /** สลับกับคลิปข้างเคียงแล้วบันทึกลำดับใหม่ทั้งชุด */
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= videos.length) return;
    const next = [...videos];
    [next[index], next[target]] = [next[target], next[index]];
    setVideos(next);
    setSavingOrder(true);
    try {
      await api.reorderProgramVideos(program.slug, next.map((v) => v.id));
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกลำดับไม่สำเร็จ');
      await load(); // ลำดับบนจอกับใน DB ต้องไม่หลุดจากกัน
    } finally {
      setSavingOrder(false);
    }
  };

  const previewUrl = form.url.trim();
  // ลิงก์ที่ฝังในหน้าไม่ได้ (เช่น หน้าเว็บทั่วไป) หน้าจริงจะขึ้นเป็นปุ่มเปิดลิงก์แทน — เตือนไว้ก่อนบันทึก
  const isEmbeddable = !previewUrl || isEmbeddableVideoUrl(previewUrl);

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">คลิปคู่มือของ {program.name}</h2>
        <Button size="sm" onClick={openCreate} className="gap-1.5 bg-[#FFB300] text-black hover:bg-[#FFB300]/90">
          <Plus className="h-4 w-4" /> เพิ่มคลิป
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : videos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Film className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              ยังไม่มีคลิป — หน้าโปรแกรมจะขึ้นกรอบ "วิดีโอตัวอย่างเร็วๆ นี้" อยู่ กด "เพิ่มคลิป" เพื่อเริ่ม
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {videos.map((video, index) => {
            const thumb = youtubeThumb(video.url);
            return (
              <Card key={video.id} className={video.is_active ? '' : 'opacity-60'}>
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
                      disabled={index === videos.length - 1 || savingOrder}
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
                      <div className="flex h-full items-center justify-center">
                        <Film className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{video.title || `คลิปที่ ${index + 1}`}</p>
                      {index === 0 && video.is_active && (
                        <Badge variant="outline" className="text-[10px] text-[#FFB300]">
                          เล่นเป็นคลิปแรก
                        </Badge>
                      )}
                      {!video.is_active && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          ซ่อนอยู่
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground/70">{video.url}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleActive(video)}
                      title={video.is_active ? 'ซ่อนจากหน้าโปรแกรม' : 'แสดงบนหน้าโปรแกรม'}
                      aria-label={video.is_active ? 'ซ่อนคลิป' : 'แสดงคลิป'}
                    >
                      {video.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(video)} title="แก้ไข" aria-label="แก้ไข">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(video)}
                      title="ลบ"
                      aria-label="ลบ"
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

      {/* ── ฟอร์มเพิ่ม / แก้ไขคลิป ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไขคลิป' : `เพิ่มคลิปคู่มือ ${program.name}`}</DialogTitle>
            <DialogDescription>ใส่ลิงก์แล้วกดบันทึก — ขึ้นบนหน้าโปรแกรมทันทีโดยไม่ต้อง deploy ใหม่</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>ลิงก์คลิป *</Label>
              <Input
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://www.youtube.com/watch?v=..."
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                รองรับ YouTube (watch / youtu.be / shorts), Google Drive (ต้องแชร์แบบ "ทุกคนที่มีลิงก์") หรือไฟล์ .mp4 / .webm / .mov ตรงๆ
              </p>
              {!isEmbeddable && (
                <p className="mt-1 text-[11px] text-amber-400">
                  ลิงก์นี้ฝังเล่นในหน้าไม่ได้ — หน้าโปรแกรมจะขึ้นเป็นปุ่มให้กดเปิดลิงก์แทน
                </p>
              )}
            </div>

            {previewUrl && (
              <div>
                <Label>ตัวอย่าง</Label>
                <div className="mt-1">
                  <ProgramVideo url={previewUrl} title={form.title || program.name} poster={program.thumbnail} />
                </div>
              </div>
            )}

            <div>
              <Label>ชื่อคลิป</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="เช่น วิธีติดตั้งและเริ่มใช้งาน"
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                โชว์ในรายการคลิปใต้ตัวเล่น (เห็นเมื่อมีมากกว่า 1 คลิป)
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v === true }))}
              />
              <span className="text-sm">แสดงบนหน้าโปรแกรม</span>
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
              {deleteTarget?.title || deleteTarget?.url} — ลบแล้วจะหายจากหน้าโปรแกรมทันที และกู้คืนไม่ได้
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
    </>
  );
};

export default ProgramVideosPanel;
