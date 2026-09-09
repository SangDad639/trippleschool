import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Upload, Youtube, Film, Eye, EyeOff, Clapperboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { invalidatePromoCache } from '@/components/admin/LessonPromosEditor';
import type { PromoAdmin, PromoInput } from '@/types/promo';

/**
 * /admin/promos — คลังโฆษณาแทรกในวิดีโอบทเรียน (migration 065 · routes/promos.ts)
 * แหล่งวิดีโอ 2 แบบ: ลิงก์ YouTube (หลัก — user ให้คลิป YouTube มา) หรืออัปโหลดไฟล์ mp4/webm ≤ 200 MB
 * การ์ดพรีวิว = smoke test ของการเล่นจริง (YouTube embed / Range endpoint) บน prod
 * ผูกโฆษณากับบทเรียนที่ /admin/courses → แก้ไขบทเรียน → "🎬 โฆษณาแทรก"
 */
type SkipChoice = 'none' | '0' | '5' | '10' | '15';
interface Form {
  id?: number;
  title: string;
  source: 'youtube' | 'file';
  youtube_url: string;
  video_key: string;
  size_bytes: number | null;
  content_type: string;
  file_name: string;
  duration_sec: string;
  poster_url: string;
  click_url: string;
  skip: SkipChoice;
  is_active: boolean;
}
const emptyForm: Form = {
  title: '', source: 'youtube', youtube_url: '', video_key: '', size_bytes: null, content_type: 'video/mp4', file_name: '',
  duration_sec: '', poster_url: '', click_url: '', skip: '5', is_active: true,
};
const SKIP_OPTIONS: { value: SkipChoice; label: string }[] = [
  { value: '0', label: 'ข้ามได้ทันที' },
  { value: '5', label: 'ข้ามได้หลัง 5 วิ (แบบ YouTube)' },
  { value: '10', label: 'ข้ามได้หลัง 10 วิ' },
  { value: '15', label: 'ข้ามได้หลัง 15 วิ' },
  { value: 'none', label: 'ห้ามข้าม (ต้องดูจนจบ)' },
];
const YT_RE = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})|^([a-zA-Z0-9_-]{11})$/;
const ytIdOf = (s: string): string | null => { const m = s.trim().match(YT_RE); return m ? (m[1] || m[2]) : null; };
const fmtDur = (s: number | null) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const fmtMb = (b: number | null) => (b == null ? '' : `${(b / 1048576).toFixed(1)} MB`);
const skipLabel = (s: number | null) => (s === null ? 'ห้ามข้าม' : s === 0 ? 'ข้ามได้ทันที' : `ข้ามได้หลัง ${s} วิ`);

/** อ่านความยาวไฟล์ (วินาที) จากเบราว์เซอร์ก่อนอัปโหลด — ไม่ได้ = null */
function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(url); resolve(Number.isFinite(d) && d > 0 ? Math.round(d) : null); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    v.src = url;
  });
}

export default function AdminPromos() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [promos, setPromos] = useState<PromoAdmin[]>([]);
  const [maxMb, setMaxMb] = useState(200);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<PromoAdmin | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.listPromosAdmin();
      setPromos(r.promos);
      setMaxMb(r.max_mb || 200);
    } catch (err: any) {
      toast.error(err?.message || 'โหลดรายการโฆษณาไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-gray-400">ไม่มีสิทธิ์เข้าถึง</p>
      </div>
    );
  }

  const openCreate = () => setForm({ ...emptyForm });
  const openEdit = (p: PromoAdmin) => setForm({
    id: p.id,
    title: p.title,
    source: p.source_type,
    youtube_url: p.youtube_url || '',
    video_key: '',
    size_bytes: p.size_bytes,
    content_type: p.content_type,
    file_name: p.source_type === 'file' ? `ไฟล์เดิม${p.size_bytes ? ` (${fmtMb(p.size_bytes)})` : ''}` : '',
    duration_sec: p.duration_sec == null ? '' : String(p.duration_sec),
    poster_url: p.poster_url || '',
    click_url: p.click_url || '',
    skip: p.skip_after_sec === null ? 'none' : ((['0', '5', '10', '15'] as SkipChoice[]).includes(String(p.skip_after_sec) as SkipChoice) ? (String(p.skip_after_sec) as SkipChoice) : '5'),
    is_active: p.is_active,
  });

  const handleUploadVideo = async (file: File) => {
    if (!form) return;
    if (file.size > maxMb * 1048576) return toast.error(`ไฟล์ใหญ่เกิน ${maxMb} MB`);
    setUploading(true);
    const t = toast.loading('กำลังอัปโหลดวิดีโอ… ไฟล์ใหญ่อาจใช้เวลาหลายนาที');
    try {
      const [r, dur] = await Promise.all([api.uploadPromoVideo(file), readVideoDuration(file)]);
      setForm((f) => f && ({
        ...f, source: 'file', video_key: r.video_key, size_bytes: r.size_bytes, content_type: r.content_type,
        file_name: `${r.name} (${fmtMb(r.size_bytes)})`, duration_sec: dur != null ? String(dur) : f.duration_sec,
      }));
      toast.success(r.faststart ? 'อัปโหลดสำเร็จ (ปรับ faststart ให้แล้ว)' : 'อัปโหลดสำเร็จ', { id: t });
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดไม่สำเร็จ', { id: t });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const handleUploadPoster = async (file: File) => {
    if (!form) return;
    if (file.size > 10 * 1048576) return toast.error('รูปปกต้องไม่เกิน 10 MB');
    try {
      const r = await api.uploadCourseSample(file);
      setForm((f) => f && ({ ...f, poster_url: r.url }));
      toast.success('อัปโหลดปกแล้ว');
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดปกไม่สำเร็จ');
    } finally {
      if (posterRef.current) posterRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!form) return;
    if (!form.title.trim()) return toast.error('กรุณาใส่ชื่อโฆษณา');
    const body: PromoInput = {
      title: form.title.trim(),
      duration_sec: form.duration_sec.trim() === '' ? null : Number(form.duration_sec),
      poster_url: form.poster_url.trim() || null,
      // click_url: user ตัดปุ่ม "ดูรายละเอียด" ออก (8 ก.ย.) — ไม่ส่ง คอลัมน์คงไว้ใน DB
      skip_after_sec: form.skip === 'none' ? null : Number(form.skip),
      is_active: form.is_active,
    };
    if (form.source === 'youtube') {
      if (!ytIdOf(form.youtube_url)) return toast.error('ลิงก์ YouTube ไม่ถูกต้อง');
      body.youtube_url = form.youtube_url.trim();
    } else if (form.video_key) {
      body.video_key = form.video_key;
      body.size_bytes = form.size_bytes;
      body.content_type = form.content_type;
    } else if (!form.id) {
      return toast.error('กรุณาอัปโหลดไฟล์วิดีโอก่อน');
    }
    setSaving(true);
    try {
      if (form.id) {
        await api.updatePromo(form.id, body);
        toast.success('บันทึกโฆษณาแล้ว');
      } else {
        await api.createPromo(body);
        toast.success('เพิ่มโฆษณาแล้ว — ไปผูกกับบทเรียนที่ คอร์สเรียน → แก้ไขบทเรียน → 🎬 โฆษณาแทรก', { duration: 7000 });
      }
      invalidatePromoCache();
      setForm(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: PromoAdmin) => {
    setBusyId(p.id);
    try {
      await api.updatePromo(p.id, { is_active: !p.is_active });
      invalidatePromoCache();
      toast.success(p.is_active ? 'ปิดใช้แล้ว — จุดแทรกที่ใช้โฆษณานี้จะไม่แสดง' : 'เปิดใช้แล้ว');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'ไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      const r = await api.deletePromo(deleting.id);
      invalidatePromoCache();
      toast.success(`ลบแล้ว${r.usage_count ? ` — จุดแทรก ${r.usage_count} จุดถูกถอดออก` : ''}`);
      setDeleting(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'ลบไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Clapperboard className="h-6 w-6 text-yellow-400" /> 🎬 โฆษณาแทรก</h1>
        <Button onClick={openCreate} className="ml-auto bg-[#FFB300] hover:bg-[#FF9D00] text-black">
          <Plus className="h-4 w-4 mr-1" /> เพิ่มโฆษณา
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        คลิปโฆษณาที่จะแทรกก่อนเริ่ม/กลางวิดีโอบทเรียน — ใส่ลิงก์ YouTube หรืออัปโหลดไฟล์ · ผูกกับบทเรียนที่ <button className="underline text-yellow-400" onClick={() => navigate('/admin/courses')}>คอร์สเรียน</button> → แก้ไขบทเรียน → "🎬 โฆษณาแทรก"
      </p>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" /></div>
      ) : promos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          ยังไม่มีโฆษณา — กด "เพิ่มโฆษณา" แล้ววางลิงก์ YouTube ของคลิปโฆษณา
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {promos.map((p) => (
            <div key={p.id} className={`rounded-xl border border-border bg-card p-4 space-y-3 ${p.is_active ? '' : 'opacity-60'}`}>
              <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
                {p.source_type === 'youtube' && p.youtube_id ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${p.youtube_id}?rel=0`}
                    title={p.title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : p.video_url ? (
                  <video controls preload="metadata" playsInline src={api.mediaUrl(p.video_url)} poster={p.poster_url ? api.mediaUrl(p.poster_url) : undefined} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">ไม่มีวิดีโอ</div>
                )}
              </div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{p.title}</div>
                  <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                    <span className="inline-flex items-center gap-1">
                      {p.source_type === 'youtube' ? <Youtube className="h-3.5 w-3.5 text-red-500" /> : <Film className="h-3.5 w-3.5" />}
                      {p.source_type === 'youtube' ? 'YouTube' : `ไฟล์ ${fmtMb(p.size_bytes)}`}
                    </span>
                    <span>⏱ {fmtDur(p.duration_sec)}</span>
                    <span>{skipLabel(p.skip_after_sec)}</span>
                    <span className={p.usage_count ? 'text-green-400' : ''}>ใช้ใน {p.usage_count} จุด</span>
                  </div>
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.is_active ? 'bg-green-500/15 text-green-400' : 'bg-muted text-muted-foreground'}`}>
                  {p.is_active ? <><Eye className="h-3 w-3" /> เปิดใช้</> : <><EyeOff className="h-3 w-3" /> ปิดอยู่</>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => toggleActive(p)} disabled={busyId === p.id}>
                  {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : p.is_active ? 'ปิดใช้' : 'เปิดใช้'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5 mr-1" /> แก้ไข</Button>
                <Button variant="ghost" size="sm" className="ml-auto text-red-400 hover:text-red-500" onClick={() => setDeleting(p)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> ลบ
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== เพิ่ม/แก้ไข ===== */}
      <Dialog open={!!form} onOpenChange={(o) => { if (!o && !saving && !uploading) setForm(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
            <DialogTitle>{form?.id ? 'แก้ไขโฆษณา' : 'เพิ่มโฆษณา'}</DialogTitle>
            <DialogDescription className="text-xs">คลิปสั้น 15-30 วิ กำลังดี · ผู้เรียนกด ▶ ก่อนแล้วโฆษณาจะเล่นมีเสียง</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <Label>ชื่อโฆษณา *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="เช่น โปรโมทคอร์สใหม่ ก.ย." />
              </div>

              <div className="space-y-2">
                <Label>แหล่งวิดีโอ *</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={form.source === 'youtube' ? 'default' : 'outline'} onClick={() => setForm({ ...form, source: 'youtube' })}>
                    <Youtube className="h-4 w-4 mr-1" /> ลิงก์ YouTube
                  </Button>
                  <Button type="button" size="sm" variant={form.source === 'file' ? 'default' : 'outline'} onClick={() => setForm({ ...form, source: 'file' })}>
                    <Film className="h-4 w-4 mr-1" /> อัปโหลดไฟล์
                  </Button>
                </div>
                {form.source === 'youtube' ? (
                  <div>
                    <Input value={form.youtube_url} onChange={(e) => setForm({ ...form, youtube_url: e.target.value })} placeholder="https://youtu.be/aY7GY9rgWSY" />
                    {ytIdOf(form.youtube_url) ? (
                      <div className="mt-2 aspect-video w-full max-w-xs overflow-hidden rounded-lg bg-black">
                        <iframe src={`https://www.youtube.com/embed/${ytIdOf(form.youtube_url)}?rel=0`} title="preview" className="w-full h-full" allow="encrypted-media" />
                      </div>
                    ) : form.youtube_url.trim() ? (
                      <p className="text-xs text-red-400 mt-1">ลิงก์ YouTube ไม่ถูกต้อง (รองรับ watch?v=, youtu.be, /embed/, /shorts/)</p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground mt-1">คลิปต้องเปิด "อนุญาตให้ฝัง (embed)" บน YouTube · ผู้เรียนจะกด/เลื่อนคลิปโฆษณาไม่ได้ (มีแผ่นกัน)</p>
                  </div>
                ) : (
                  <div>
                    <input ref={fileRef} type="file" accept="video/mp4,video/webm,.mp4,.m4v,.webm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadVideo(f); }} />
                    <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                      {uploading ? 'กำลังอัปโหลด…' : `อัปโหลด mp4/webm (≤ ${maxMb} MB)`}
                    </Button>
                    {form.file_name && <p className="text-xs text-green-400 mt-1">✓ {form.file_name}</p>}
                    <p className="text-[11px] text-muted-foreground mt-1">แนะนำ H.264 + AAC, 720p, ≤ 20 MB — ทุก byte วิ่งผ่านเซิร์ฟเวอร์เรา</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>ข้ามได้หลัง</Label>
                  <select
                    value={form.skip}
                    onChange={(e) => setForm({ ...form, skip: e.target.value as SkipChoice })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {SKIP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label>ความยาว (วินาที)</Label>
                  <Input type="number" min={0} value={form.duration_sec} onChange={(e) => setForm({ ...form, duration_sec: e.target.value })} placeholder="ไม่บังคับ" />
                </div>
              </div>

              <div>
                <Label>ปกก่อนเล่น (ไม่บังคับ — ใช้กับไฟล์ที่อัปโหลด)</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input ref={posterRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadPoster(f); }} />
                  <Button type="button" variant="outline" size="sm" onClick={() => posterRef.current?.click()}><Upload className="h-4 w-4 mr-1" /> เลือกรูป</Button>
                  {form.poster_url && (
                    <>
                      <img src={api.mediaUrl(form.poster_url)} alt="" className="h-10 w-16 rounded object-cover border border-border" />
                      <Button type="button" variant="ghost" size="sm" className="text-red-400" onClick={() => setForm({ ...form, poster_url: '' })}>ลบ</Button>
                    </>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.is_active} onCheckedChange={(c) => setForm({ ...form, is_active: c === true })} />
                เปิดใช้งาน (ปิด = จุดแทรกที่ใช้โฆษณานี้จะไม่แสดง แต่ยังไม่ลบ)
              </label>
            </div>
          )}
          <DialogFooter className="px-6 py-4 border-t border-border">
            <Button variant="outline" onClick={() => setForm(null)} disabled={saving || uploading}>ยกเลิก</Button>
            <Button onClick={handleSave} disabled={saving || uploading} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== ลบ ===== */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบโฆษณา "{deleting?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.usage_count
                ? `โฆษณานี้ใช้อยู่ใน ${deleting.usage_count} จุดแทรก — ลบแล้วจุดแทรกเหล่านั้นจะหายไป (บทเรียนยังอยู่)`
                : 'ยังไม่ได้ผูกกับบทเรียนใด'}
              {deleting?.source_type === 'file' ? ' · ไฟล์บน S3 จะถูกลบด้วย' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId != null}>เก็บไว้</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} disabled={busyId != null} className="bg-red-600 hover:bg-red-700 text-white">
              {busyId != null ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />} ยืนยันลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
