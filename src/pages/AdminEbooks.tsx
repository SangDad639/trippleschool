import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type EbookDto } from '@/lib/api';
import EbookSamplesEditor, { type EbookMediaSample } from '@/components/ebooks/EbookSamplesEditor';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Plus,
  Loader2,
  BookMarked,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Upload,
  X,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';

// สร้าง slug จากชื่อ (อนุญาตไทย/อังกฤษ/ตัวเลข/ขีด — ตรงกับ sanitizeSlug ฝั่ง server)
const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9฀-๿-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);

const emptyForm = {
  title: '',
  slug: '',
  description: '',
  cover_url: '',
  file_url: '',
  file_name: '',
  is_active: true,
  allow_download: true,
  // โหมดการเข้าถึง (radio ทางเดียว): free = ใครก็ได้ · members = สมาชิกเท่านั้น ·
  // sale = ขายรายเล่ม (ต้องตั้งราคา) — แปลงเป็น members_only + price ตอนบันทึก
  access: 'free' as 'free' | 'members' | 'sale',
  price: '',
  pages: '',
  author_name: '',
  author_avatar_url: '',
  hook: '',
  highlights: [] as string[],
  samples: [] as EbookMediaSample[],
  // แนวภาพปก — detect อัตโนมัติตอนอัปโหลด สลับเองได้ (การ์ดหน้า /ebooks ปรับทรงตามค่านี้)
  cover_orientation: 'landscape' as 'landscape' | 'portrait',
  // อ่านตัวอย่างจำกัดหน้า (เฉพาะเล่มสมาชิก/เล่มขาย): 0 = ปิด · ไฟล์ตัวอย่างอัพเอง = override
  preview_pages: '',
  preview_file_url: '',
  preview_file_name: '',
};

// Admin CMS ของ Ebook (/admin/ebooks): ลิสต์ + dialog สร้าง/แก้ไข —
// ปกใช้ upload-thumbnail ของคอร์ส (ได้ variants card/hero ฟรี), ไฟล์ PDF
// ใช้ upload-material (S3) แบบเดียวกับเอกสารบทเรียน — สาธารณะ/ดาวน์โหลดได้เป็นค่าเริ่มต้น
// แต่แอดมินปิดดาวน์โหลด (view-only) หรือจำกัดเฉพาะสมาชิกได้ต่อเล่ม (บังคับจริงฝั่ง server)
const AdminEbooks = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ebooks, setEbooks] = useState<EbookDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EbookDto | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingPreview, setUploadingPreview] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const previewFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user?.isAdmin) return;
    load();
  }, [user]);

  const load = async () => {
    try {
      setLoading(true);
      setEbooks(await api.getAdminEbooks());
    } catch (e: any) {
      toast.error(e?.message || 'โหลด Ebook ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setSlugTouched(false);
    setDialogOpen(true);
  };

  const openEdit = (e: EbookDto) => {
    setEditing(e);
    setForm({
      title: e.title,
      slug: e.slug,
      description: e.description || '',
      cover_url: e.cover_url || '',
      file_url: e.file_url || '',
      file_name: e.file_name || '',
      is_active: e.is_active,
      allow_download: e.allow_download,
      access: e.members_only ? 'members' : Number(e.price) > 0 ? 'sale' : 'free',
      price: Number(e.price) > 0 ? String(Number(e.price)) : '',
      pages: e.pages ? String(e.pages) : '',
      author_name: e.author_name || '',
      author_avatar_url: e.author_avatar_url || '',
      hook: e.hook || '',
      highlights: Array.isArray(e.highlights) ? e.highlights : [],
      samples: (Array.isArray(e.samples) ? e.samples : []).map((s) => ({ ...s, title: s.title || '' })),
      cover_orientation: e.cover_orientation === 'portrait' ? 'portrait' : 'landscape',
      preview_pages: e.preview_pages && Number(e.preview_pages) > 0 ? String(e.preview_pages) : '',
      preview_file_url: e.preview_file_url || '',
      preview_file_name: e.preview_file_url ? 'ไฟล์ตัวอย่างที่อัพไว้' : '',
    });
    setSlugTouched(true);
    setDialogOpen(true);
  };

  const set = (patch: Partial<typeof emptyForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleTitleChange = (title: string) => {
    set({ title });
    if (!slugTouched) set({ slug: slugify(title) });
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('รองรับเฉพาะไฟล์รูปภาพ');
    if (file.size > 15 * 1024 * 1024) return toast.error('ไฟล์ต้องไม่เกิน 15MB');
    try {
      setUploadingCover(true);
      // อ่านแนวปกจากขนาดรูปจริง (เหมือน samples) — การ์ดหน้า /ebooks จะได้ทรงถูกทันที
      const orientation = await new Promise<'landscape' | 'portrait'>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalHeight > img.naturalWidth ? 'portrait' : 'landscape');
        img.onerror = () => resolve('landscape');
        img.src = URL.createObjectURL(file);
      });
      const { url } = await api.uploadCourseThumbnail(file);
      set({ cover_url: url, cover_orientation: orientation });
      toast.success(`อัปโหลดภาพปกสำเร็จ (${orientation === 'portrait' ? 'แนวตั้ง' : 'แนวนอน'})`);
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploadingCover(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('รองรับเฉพาะไฟล์รูปภาพ');
    if (file.size > 15 * 1024 * 1024) return toast.error('ไฟล์ต้องไม่เกิน 15MB');
    try {
      setUploadingAvatar(true);
      const { url } = await api.uploadCourseThumbnail(file);
      set({ author_avatar_url: url });
      toast.success('อัปโหลดรูปผู้เขียนสำเร็จ');
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setUploadingFile(true);
      const { url, name } = await api.uploadCourseMaterial(file);
      set({ file_url: url, file_name: name });
      toast.success(`แนบไฟล์ ${name} แล้ว`);
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploadingFile(false);
    }
  };

  const handlePreviewFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setUploadingPreview(true);
      const { url, name } = await api.uploadCourseMaterial(file);
      set({ preview_file_url: url, preview_file_name: name });
      toast.success(`แนบไฟล์ตัวอย่าง ${name} แล้ว`);
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploadingPreview(false);
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) return toast.error('กรุณาใส่ชื่อ Ebook');
    const priceNum = Number(form.price);
    if (form.access === 'sale' && (!Number.isFinite(priceNum) || priceNum <= 0)) {
      return toast.error('โหมดขายรายเล่มต้องตั้งราคามากกว่า 0');
    }
    try {
      setSaving(true);
      const payload = {
        title: form.title,
        slug: form.slug || slugify(form.title),
        description: form.description,
        cover_url: form.cover_url,
        file_url: form.file_url,
        file_name: form.file_name,
        is_active: form.is_active,
        allow_download: form.allow_download,
        members_only: form.access === 'members',
        price: form.access === 'sale' ? priceNum : 0,
        pages: form.pages.trim() === '' ? null : Number(form.pages),
        author_name: form.author_name,
        author_avatar_url: form.author_avatar_url,
        hook: form.hook,
        highlights: form.highlights,
        samples: form.samples,
        cover_orientation: form.cover_orientation,
        preview_pages: form.preview_pages.trim() === '' ? 0 : Number(form.preview_pages),
        preview_file_url: form.preview_file_url,
      };
      if (editing) {
        await api.updateEbook(editing.id, payload);
        toast.success('บันทึก Ebook แล้ว');
      } else {
        await api.createEbook(payload);
        toast.success('สร้าง Ebook แล้ว');
      }
      setDialogOpen(false);
      load();
    } catch (e: any) {
      toast.error(e?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (e: EbookDto) => {
    try {
      await api.updateEbook(e.id, { is_active: !e.is_active });
      toast.success(e.is_active ? `ซ่อน "${e.title}" แล้ว` : `เผยแพร่ "${e.title}" แล้ว`);
      load();
    } catch (err: any) {
      toast.error(err?.message || 'แก้ไขไม่สำเร็จ');
    }
  };

  const handleDelete = async (e: EbookDto) => {
    if (!confirm(`ลบ Ebook "${e.title}"? ลบแล้วกู้คืนไม่ได้`)) return;
    try {
      await api.deleteEbook(e.id);
      toast.success('ลบ Ebook แล้ว');
      load();
    } catch (err: any) {
      toast.error(err?.message || 'ลบไม่สำเร็จ');
    }
  };

  if (!user?.isAdmin) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึง</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <Button variant="ghost" onClick={() => navigate('/admin')} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          กลับ
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <BookMarked className="h-6 w-6 text-emerald-400" />
              จัดการ Ebook
            </h1>
            <p className="text-gray-400">Ebook บนเมนู Ebook — ตั้งได้ต่อเล่ม: ฟรี / สมาชิกเท่านั้น / ขายรายเล่ม</p>
          </div>
          <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="h-4 w-4 mr-2" />
            เพิ่ม Ebook ใหม่
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          </div>
        ) : ebooks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BookMarked className="h-12 w-12 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400">ยังไม่มี Ebook — กด "เพิ่ม Ebook ใหม่" เพื่อเริ่ม</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {ebooks.map((e) => (
              <Card key={e.id}>
                <CardContent className="flex items-center gap-3 py-3">
                  {e.cover_url ? (
                    <img src={api.mediaUrl(e.cover_url, 'card')} alt="" className="w-20 h-11 rounded object-contain bg-gray-800 flex-shrink-0" />
                  ) : (
                    <div className="w-20 h-11 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                      <BookMarked className="h-5 w-5 text-gray-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{e.title}</p>
                    <p className="text-gray-500 text-xs truncate">
                      /ebooks/{e.slug} · {new Date(e.created_at).toLocaleDateString('th-TH')}
                      {e.file_name && ` · 📄 ${e.file_name}`}
                    </p>
                  </div>
                  {e.members_only && <Badge className="bg-[#FFB300]/15 text-[#FFB300] border border-[#FFB300]/30">สมาชิกเท่านั้น</Badge>}
                  {!e.members_only && Number(e.price) > 0 && (
                    <Badge className="bg-[#FFB300] text-black font-bold">฿{Number(e.price).toLocaleString()}</Badge>
                  )}
                  {!e.allow_download && <Badge variant="secondary">อ่านอย่างเดียว</Badge>}
                  <Badge variant={e.is_active ? 'default' : 'secondary'}>{e.is_active ? 'เผยแพร่' : 'ซ่อนอยู่'}</Badge>
                  <Button size="sm" variant="ghost" title="เปิดดูหน้าเว็บจริง" onClick={() => window.open(`/ebooks/${e.slug}`, '_blank')}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" title={e.is_active ? 'ซ่อน' : 'เผยแพร่'} onClick={() => handleToggleActive(e)}>
                    {e.is_active ? <Eye className="h-4 w-4 text-green-400" /> : <EyeOff className="h-4 w-4 text-gray-500" />}
                  </Button>
                  <Button size="sm" variant="ghost" title="แก้ไข" onClick={() => openEdit(e)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" title="ลบ" className="text-red-400 hover:text-red-300" onClick={() => handleDelete(e)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialog สร้าง/แก้ไข — ปิดเฉพาะปุ่ม X/Esc กันคลิกพลาดหลุด */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editing ? `แก้ไข: ${editing.title}` : 'เพิ่ม Ebook ใหม่'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>ชื่อ Ebook *</Label>
              <Input value={form.title} onChange={(e) => handleTitleChange(e.target.value)} placeholder="เช่น คู่มือเริ่มต้นตัดต่อวิดีโอด้วย AI" className="mt-1.5" />
            </div>

            <div>
              <Label>ลิงก์ (slug)</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-sm text-gray-500 whitespace-nowrap">/ebooks/</span>
                <Input
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set({ slug: slugify(e.target.value) });
                  }}
                  placeholder="สร้างจากชื่ออัตโนมัติ"
                />
              </div>
            </div>

            <div>
              <Label>คำอธิบายสั้นๆ (ไม่บังคับ)</Label>
              <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={3} placeholder="สรุปสั้นๆ ว่า Ebook เล่มนี้เกี่ยวกับอะไร" className="mt-1.5" />
            </div>

            {/* ภาพปก — รองรับทั้งแนวนอน 16:9 และปกหนังสือแนวตั้ง (หน้าเว็บโชว์เต็มใบ ไม่ crop) */}
            <div>
              <Label>ภาพปก (แนวนอน 16:9 หรือปกหนังสือแนวตั้งก็ได้)</Label>
              <div className="mt-1.5 flex items-start gap-3">
                {form.cover_url ? (
                  <img
                    src={api.mediaUrl(form.cover_url, 'card')}
                    alt="ปก"
                    className={`rounded object-contain bg-gray-900 border border-gray-700 ${
                      form.cover_orientation === 'portrait' ? 'w-24 aspect-[3/4]' : 'w-40 aspect-video'
                    }`}
                  />
                ) : (
                  <div className="w-40 aspect-video rounded bg-gray-800 border border-dashed border-gray-700 flex items-center justify-center text-gray-500 text-xs">
                    ยังไม่มีปก
                  </div>
                )}
                <div className="space-y-2">
                  <Button type="button" variant="outline" size="sm" disabled={uploadingCover} onClick={() => coverInputRef.current?.click()}>
                    {uploadingCover ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
                    อัปโหลดปก
                  </Button>
                  {form.cover_url && (
                    <>
                      {/* แนวถูก detect จากรูปตอนอัป — ปุ่มนี้ไว้สลับมือเผื่ออ่านพลาด */}
                      <Button
                        type="button" variant="outline" size="sm" className="block"
                        title="สลับแนวปก (มีผลกับทรงการ์ดหน้า /ebooks)"
                        onClick={() => set({ cover_orientation: form.cover_orientation === 'portrait' ? 'landscape' : 'portrait' })}
                      >
                        {form.cover_orientation === 'portrait' ? '↕ ปกแนวตั้ง' : '↔ ปกแนวนอน'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="text-red-400 block" onClick={() => set({ cover_url: '' })}>
                        <X className="h-4 w-4 mr-1" /> ลบปก
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ไฟล์ Ebook */}
            <div>
              <Label>ไฟล์ Ebook (PDF)</Label>
              <div className="mt-1.5 space-y-2">
                <Button type="button" variant="outline" size="sm" disabled={uploadingFile} onClick={() => fileInputRef.current?.click()}>
                  {uploadingFile ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
                  อัปโหลดไฟล์ PDF
                </Button>
                {form.file_url && (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">แนบไฟล์แล้ว: <b>{form.file_name || 'ไฟล์ Ebook'}</b></span>
                    <button className="ml-auto text-red-400 hover:text-red-300" title="เอาไฟล์ออก" onClick={() => set({ file_url: '', file_name: '' })}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* โหมดการเข้าถึง — ทางเดียวจาก 3 ทาง (server บังคับซ้ำ: members_only + ราคา ตั้งพร้อมกันไม่ได้) */}
            <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
              <p className="text-sm font-medium text-white">การเข้าถึง</p>
              {(
                [
                  { value: 'free', label: '🆓 ฟรี — ใครก็ดาวน์โหลด/อ่านได้ ไม่ต้องล็อกอิน' },
                  { value: 'members', label: '👑 สมาชิกเท่านั้น — ต้องมีแพ็กเกจรายเดือน/รายปี' },
                  { value: 'sale', label: '💰 ขายรายเล่ม — ตั้งราคา ซื้อด้วยสลิปโอนเหมือนคอร์ส (สมาชิกอ่านได้เลยไม่ต้องซื้อ)' },
                ] as const
              ).map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm text-gray-200">
                  <input
                    type="radio"
                    name="ebook-access"
                    className="accent-[#FFB300]"
                    checked={form.access === opt.value}
                    onChange={() => set({ access: opt.value })}
                  />
                  {opt.label}
                </label>
              ))}
              {form.access === 'sale' && (
                <div className="flex items-center gap-2 pl-6 pt-1">
                  <Label className="whitespace-nowrap">ราคา (บาท) *</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.price}
                    onChange={(e) => set({ price: e.target.value })}
                    placeholder="เช่น 349"
                    className="w-32"
                  />
                </div>
              )}
              {/* อ่านตัวอย่างจำกัดหน้า — เฉพาะเล่มที่ล็อกสิทธิ์ (เล่มฟรีอ่านเต็มได้อยู่แล้ว) */}
              {form.access !== 'free' && (
                <div className="space-y-2 border-t border-gray-800 pt-2 mt-1">
                  <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap">📖 อ่านตัวอย่างฟรีได้กี่หน้า</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.preview_pages}
                      onChange={(e) => set({ preview_pages: e.target.value })}
                      placeholder="0 = ปิด"
                      className="w-28"
                    />
                    <span className="text-xs text-gray-500">ระบบตัดจากไฟล์เต็มให้อัตโนมัติ</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-0">
                    <Button type="button" variant="outline" size="sm" disabled={uploadingPreview} onClick={() => previewFileInputRef.current?.click()}>
                      {uploadingPreview ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
                      ไฟล์ตัวอย่างอัพเอง (ไม่บังคับ)
                    </Button>
                    {form.preview_file_url ? (
                      <span className="flex items-center gap-1.5 text-xs text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {form.preview_file_name || 'แนบแล้ว'}
                        <button type="button" className="text-red-400 hover:text-red-300" title="เอาไฟล์ตัวอย่างออก" onClick={() => set({ preview_file_url: '', preview_file_name: '' })}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">ถ้าอัพไว้ จะใช้ไฟล์นี้แทนการตัดอัตโนมัติ</span>
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 border-t border-gray-800 pt-2 mt-1">
                <Checkbox
                  checked={form.allow_download}
                  onCheckedChange={(c) => set({ allow_download: c === true })}
                  id="ebook-allow-download"
                />
                <Label htmlFor="ebook-allow-download" className="cursor-pointer">
                  อนุญาตให้ดาวน์โหลด (ไม่ติ๊ก = อ่านในเว็บได้อย่างเดียว ดาวน์โหลดไม่ได้)
                </Label>
              </div>
            </div>

            {/* ข้อมูลหน้า detail (สไตล์ fuzionhub) */}
            <div className="space-y-4 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
              <p className="text-sm font-medium text-white">📖 ข้อมูลหน้า Ebook (ไม่บังคับ)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>จำนวนหน้า</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.pages}
                    onChange={(e) => set({ pages: e.target.value })}
                    placeholder="เช่น 56"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>ชื่อผู้เขียน</Label>
                  <Input value={form.author_name} onChange={(e) => set({ author_name: e.target.value })} placeholder="เช่น Triple Next" className="mt-1.5" />
                </div>
              </div>
              <div>
                <Label>รูปผู้เขียน (แสดงเป็นวงกลมเล็กข้างชื่อ)</Label>
                <div className="mt-1.5 flex items-center gap-3">
                  {form.author_avatar_url ? (
                    <img src={api.mediaUrl(form.author_avatar_url, 'card')} alt="ผู้เขียน" className="h-10 w-10 rounded-full object-cover border border-gray-700" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-gray-800 border border-dashed border-gray-700" />
                  )}
                  <Button type="button" variant="outline" size="sm" disabled={uploadingAvatar} onClick={() => avatarInputRef.current?.click()}>
                    {uploadingAvatar ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
                    อัปโหลดรูป
                  </Button>
                  {form.author_avatar_url && (
                    <Button type="button" variant="ghost" size="sm" className="text-red-400" onClick={() => set({ author_avatar_url: '' })}>
                      <X className="h-4 w-4 mr-1" /> ลบ
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label>ประโยคขาย (ตัวหนาใต้ชื่อเล่ม)</Label>
                <Textarea
                  value={form.hook}
                  onChange={(e) => set({ hook: e.target.value })}
                  rows={2}
                  placeholder='เช่น "นี่ไม่ใช่หนังสือสอนตั้งแต่ 0 แต่จะพาคุณดูการทำงานจริงทั้งเบื้องหลัง"'
                  className="mt-1.5"
                />
              </div>
              <EbookSamplesEditor items={form.samples} onChange={(samples) => set({ samples })} />
              <div>
                <Label>ข้างในมีอะไร (bullet โชว์หน้า Ebook — สูงสุด 20 ข้อ)</Label>
                <div className="mt-1.5 space-y-2">
                  {form.highlights.map((h, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={h}
                        onChange={(e) =>
                          set({ highlights: form.highlights.map((x, j) => (j === i ? e.target.value : x)) })
                        }
                        placeholder="เช่น เจาะเบื้องหลัง Prompt และไอเดียของงานจริง"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-400 flex-shrink-0"
                        onClick={() => set({ highlights: form.highlights.filter((_, j) => j !== i) })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {form.highlights.length < 20 && (
                    <Button type="button" variant="outline" size="sm" onClick={() => set({ highlights: [...form.highlights, ''] })}>
                      <Plus className="h-4 w-4 mr-1.5" />
                      เพิ่มรายการ
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox checked={form.is_active} onCheckedChange={(c) => set({ is_active: c === true })} id="ebook-active" />
              <Label htmlFor="ebook-active" className="cursor-pointer">เผยแพร่ทันที (ไม่ติ๊ก = เก็บเป็นฉบับร่าง ผู้ใช้ยังไม่เห็น)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? 'บันทึก' : 'สร้าง Ebook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
      <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
      <input ref={previewFileInputRef} type="file" accept=".pdf" className="hidden" onChange={handlePreviewFileUpload} />
    </div>
  );
};

export default AdminEbooks;
