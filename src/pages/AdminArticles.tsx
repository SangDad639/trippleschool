import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type ArticleDto } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { sanitizeMaterialHtml } from '@/lib/sanitizeMaterialHtml';
import { MaterialHtmlFrame } from '@/components/MaterialHtmlFrame';
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
  Newspaper,
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
  excerpt: '',
  cover_url: '',
  content_html: '',
  content_url: '',
  content_file_name: '',
  is_active: true,
};

// Admin CMS ของบทความ (/admin/articles): ลิสต์ + dialog สร้าง/แก้ไข —
// ปกใช้ upload-thumbnail ของคอร์ส (ได้ variants card/hero ฟรี), ไฟล์ HTML ใหญ่
// ใช้ upload-html (S3) แบบเดียวกับเอกสารบทเรียน
const AdminArticles = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [articles, setArticles] = useState<ArticleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ArticleDto | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingHtml, setUploadingHtml] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewRemote, setPreviewRemote] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user?.isAdmin) return;
    load();
  }, [user]);

  const load = async () => {
    try {
      setLoading(true);
      setArticles(await api.getAdminArticles());
    } catch (e: any) {
      toast.error(e?.message || 'โหลดบทความไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setSlugTouched(false);
    setShowPreview(false);
    setPreviewRemote(null);
    setDialogOpen(true);
  };

  const openEdit = async (a: ArticleDto) => {
    setEditing(a);
    // list payload ไม่มีเนื้อหา — ดึงแบบเต็มก่อนแก้ ไม่งั้นบันทึกแล้วเนื้อหาหาย
    try {
      const full = await api.getArticle(a.slug);
      setForm({
        title: full.title,
        slug: full.slug,
        excerpt: full.excerpt || '',
        cover_url: full.cover_url || '',
        content_html: full.content_html || '',
        content_url: full.content_url || '',
        content_file_name: full.content_url ? 'ไฟล์ HTML ที่แนบไว้' : '',
        is_active: full.is_active,
      });
      setSlugTouched(true);
      setShowPreview(false);
      setPreviewRemote(null);
      setDialogOpen(true);
    } catch (e: any) {
      toast.error(e?.message || 'โหลดบทความไม่สำเร็จ');
    }
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
      const { url } = await api.uploadCourseThumbnail(file);
      set({ cover_url: url });
      toast.success('อัปโหลดภาพปกสำเร็จ');
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploadingCover(false);
    }
  };

  const handleHtmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setUploadingHtml(true);
      const { url, name } = await api.uploadCourseHtml(file);
      // ไฟล์แนบแทนที่เนื้อหาที่วางไว้ (ใช้อย่างใดอย่างหนึ่ง — วางตรงชนะตอน render)
      set({ content_url: url, content_file_name: name, content_html: '' });
      setPreviewRemote(null);
      toast.success(`แนบไฟล์ ${name} แล้ว`);
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploadingHtml(false);
    }
  };

  const togglePreview = async () => {
    const next = !showPreview;
    setShowPreview(next);
    if (next && !form.content_html.trim() && form.content_url && previewRemote === null) {
      try {
        const res = await fetch(api.mediaUrl(form.content_url));
        setPreviewRemote(res.ok ? await res.text() : '');
      } catch {
        setPreviewRemote('');
      }
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) return toast.error('กรุณาใส่ชื่อบทความ');
    try {
      setSaving(true);
      const payload = {
        title: form.title,
        slug: form.slug || slugify(form.title),
        excerpt: form.excerpt,
        cover_url: form.cover_url,
        content_html: form.content_html,
        content_url: form.content_url,
        is_active: form.is_active,
      };
      if (editing) {
        await api.updateArticle(editing.id, payload);
        toast.success('บันทึกบทความแล้ว');
      } else {
        await api.createArticle(payload);
        toast.success('สร้างบทความแล้ว');
      }
      setDialogOpen(false);
      load();
    } catch (e: any) {
      toast.error(e?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (a: ArticleDto) => {
    try {
      await api.updateArticle(a.id, { is_active: !a.is_active });
      toast.success(a.is_active ? `ซ่อน "${a.title}" แล้ว` : `เผยแพร่ "${a.title}" แล้ว`);
      load();
    } catch (e: any) {
      toast.error(e?.message || 'แก้ไขไม่สำเร็จ');
    }
  };

  const handleDelete = async (a: ArticleDto) => {
    if (!confirm(`ลบบทความ "${a.title}"? ลบแล้วกู้คืนไม่ได้`)) return;
    try {
      await api.deleteArticle(a.id);
      toast.success('ลบบทความแล้ว');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'ลบไม่สำเร็จ');
    }
  };

  if (!user?.isAdmin) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึง</div>;
  }

  const previewHtml = form.content_html.trim() || previewRemote || '';
  const previewClean = sanitizeMaterialHtml(previewHtml);

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
              <Newspaper className="h-6 w-6 text-purple-400" />
              จัดการบทความ
            </h1>
            <p className="text-gray-400">บทความบนเมนู Content — ผู้ใช้ทุกคนอ่านฟรี</p>
          </div>
          <Button onClick={openCreate} className="bg-purple-600 hover:bg-purple-700">
            <Plus className="h-4 w-4 mr-2" />
            เขียนบทความใหม่
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
          </div>
        ) : articles.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Newspaper className="h-12 w-12 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400">ยังไม่มีบทความ — กด "เขียนบทความใหม่" เพื่อเริ่ม</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {articles.map((a) => (
              <Card key={a.id}>
                <CardContent className="flex items-center gap-3 py-3">
                  {a.cover_url ? (
                    <img src={api.mediaUrl(a.cover_url, 'card')} alt="" className="w-20 h-11 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-20 h-11 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                      <Newspaper className="h-5 w-5 text-gray-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{a.title}</p>
                    <p className="text-gray-500 text-xs truncate">
                      /content/{a.slug} · {new Date(a.created_at).toLocaleDateString('th-TH')}
                      {(a.content_chars || 0) > 0 && ` · ${a.content_chars!.toLocaleString()} ตัวอักษร`}
                      {a.has_content_file && ' · 📄 ไฟล์แนบ'}
                    </p>
                  </div>
                  <Badge variant={a.is_active ? 'default' : 'secondary'}>{a.is_active ? 'เผยแพร่' : 'ซ่อนอยู่'}</Badge>
                  <Button size="sm" variant="ghost" title="เปิดดูหน้าเว็บจริง" onClick={() => window.open(`/content/${a.slug}`, '_blank')}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" title={a.is_active ? 'ซ่อนบทความ' : 'เผยแพร่บทความ'} onClick={() => handleToggleActive(a)}>
                    {a.is_active ? <Eye className="h-4 w-4 text-green-400" /> : <EyeOff className="h-4 w-4 text-gray-500" />}
                  </Button>
                  <Button size="sm" variant="ghost" title="แก้ไข" onClick={() => openEdit(a)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" title="ลบ" className="text-red-400 hover:text-red-300" onClick={() => handleDelete(a)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialog สร้าง/แก้ไข — ปิดเฉพาะปุ่ม X/Esc กันงานเขียนยาวๆ หลุดเพราะคลิกพลาด */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editing ? `แก้ไข: ${editing.title}` : 'เขียนบทความใหม่'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>ชื่อบทความ *</Label>
              <Input value={form.title} onChange={(e) => handleTitleChange(e.target.value)} placeholder="เช่น 5 เทคนิคใช้ AI ช่วยตัดต่อวิดีโอ" className="mt-1.5" />
            </div>

            <div>
              <Label>ลิงก์ (slug)</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-sm text-gray-500 whitespace-nowrap">/content/</span>
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
              <Label>คำโปรย (แสดงบนการ์ดและใต้ชื่อบทความ)</Label>
              <Textarea value={form.excerpt} onChange={(e) => set({ excerpt: e.target.value })} rows={2} placeholder="สรุปสั้นๆ ว่าบทความนี้เกี่ยวกับอะไร" className="mt-1.5" />
            </div>

            {/* ภาพปก */}
            <div>
              <Label>ภาพปก (แนะนำ 16:9)</Label>
              <div className="mt-1.5 flex items-start gap-3">
                {form.cover_url ? (
                  <img src={api.mediaUrl(form.cover_url, 'card')} alt="ปก" className="w-40 aspect-video rounded object-cover border border-gray-700" />
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
                    <Button type="button" variant="ghost" size="sm" className="text-red-400 block" onClick={() => set({ cover_url: '' })}>
                      <X className="h-4 w-4 mr-1" /> ลบปก
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* เนื้อหา */}
            <div>
              <Label>เนื้อหาบทความ (HTML)</Label>
              <div className="mt-1.5 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button type="button" variant="outline" size="sm" disabled={uploadingHtml} onClick={() => htmlInputRef.current?.click()}>
                    {uploadingHtml ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <>📄 </>}
                    อัปโหลดไฟล์ HTML
                  </Button>
                  <span className="text-xs text-gray-500">หรือวางโค้ด HTML ในช่องด้านล่าง (ไฟล์ใหญ่จาก Word/Docs แนะนำอัปโหลดเป็นไฟล์)</span>
                </div>
                {form.content_url && !form.content_html.trim() && (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">แนบไฟล์แล้ว: <b>{form.content_file_name || 'ไฟล์ HTML'}</b></span>
                    <button className="ml-auto text-red-400 hover:text-red-300" title="เอาไฟล์ออก" onClick={() => set({ content_url: '', content_file_name: '' })}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <Textarea
                  value={form.content_html}
                  onChange={(e) => set({ content_html: e.target.value })}
                  rows={form.content_html.trim() ? 10 : 5}
                  placeholder="<h2>หัวข้อ</h2><p>เนื้อหา...</p>"
                  className="font-mono text-xs"
                />
                <Button type="button" variant="ghost" size="sm" className="text-purple-400" onClick={togglePreview}>
                  <Eye className="h-4 w-4 mr-1" />
                  {showPreview ? 'ซ่อนตัวอย่าง' : 'ดูตัวอย่าง (แบบที่ผู้อ่านเห็น)'}
                </Button>
                {showPreview && (
                  <div className="rounded-lg border border-gray-700 overflow-hidden">
                    {previewClean.replace(/<[^>]*>/g, '').trim() ? (
                      <MaterialHtmlFrame html={previewClean} maxHeight={420} />
                    ) : (
                      <p className="text-gray-500 text-sm text-center py-8">ยังไม่มีเนื้อหาให้แสดง</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox checked={form.is_active} onCheckedChange={(c) => set({ is_active: c === true })} id="article-active" />
              <Label htmlFor="article-active" className="cursor-pointer">เผยแพร่ทันที (ไม่ติ๊ก = เก็บเป็นฉบับร่าง ผู้ใช้ยังไม่เห็น)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? 'บันทึก' : 'สร้างบทความ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
      <input ref={htmlInputRef} type="file" accept=".html,.htm" className="hidden" onChange={handleHtmlUpload} />
    </div>
  );
};

export default AdminArticles;
