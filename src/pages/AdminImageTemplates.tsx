import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { ArrowLeft, Plus, Pencil, Trash2, Save, X, Loader2, Upload, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

// Mirror of server-side extractor — preview only (server is source of truth on save).
function previewVariables(promptTemplate: string): Array<{ name: string; label: string; default_value: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; label: string; default_value: string }> = [];
  const re = /\{\{([\s\S]+?)\}\}/g; // multiline-friendly (TH+EN can span lines)
  let m: RegExpExecArray | null;
  while ((m = re.exec(promptTemplate))) {
    const inner = m[1].trim();
    if (seen.has(inner)) continue;
    seen.add(inner);
    let label = inner;
    let defaultValue = '';
    const sepIdx = inner.indexOf(': ');
    if (sepIdx >= 0) {
      label = inner.slice(0, sepIdx).trim();
      defaultValue = inner.slice(sepIdx + 2);
    }
    out.push({ name: inner, label, default_value: defaultValue });
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Editable preview — admin can change label / default-value of each {{}} block here,
// and prompt_template is rewritten in-place so the textarea stays in sync (find-and-replace by inner text).
function PromptVariablePreview({
  prompt,
  setPrompt,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
}) {
  // Image-swap fields (those whose {{...}} ends with " | image") group at the TOP, text fields below.
  // Within each group, preserve the order they appear in the prompt template.
  const vars = useMemo(() => {
    const all = previewVariables(prompt || '');
    const isImg = (v: { default_value: string }) => / \| image\s*$/i.test(v.default_value);
    return [...all.filter(isImg), ...all.filter((v) => !isImg(v))];
  }, [prompt]);

  const updateBlock = (oldInner: string, newLabel: string, newDefault: string) => {
    const cleanLabel = newLabel.trim();
    const newInner = newDefault.length > 0 ? `${cleanLabel}: ${newDefault}` : cleanLabel;
    if (newInner === oldInner) return;
    const re = new RegExp(`\\{\\{${escapeRegExp(oldInner)}\\}\\}`, 'g');
    setPrompt(prompt.replace(re, `{{${newInner}}}`));
  };

  if (vars.length === 0) {
    return <p className="text-xs text-zinc-500 mt-2">— ยังไม่พบ <code>{'{{...}}'}</code> ใน prompt —</p>;
  }
  return (
    <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
      <p className="text-xs font-medium text-[#FFB300] mb-2">
        ✨ {vars.length} field ที่ user จะเห็น (แก้ใน 2 ช่องด้านล่างได้เลย — prompt อัปเดตอัตโนมัติ):
      </p>
      <p className="text-[10px] text-zinc-500 mb-2">
        💡 ในช่องค่าเริ่มต้น กด Enter เพื่อขึ้นบรรทัดใหม่ — รูปจะ render ตามจำนวนบรรทัดที่พิมพ์
      </p>
      <div className="space-y-1.5">
        {vars.map((v, i) => {
          const isMultiline = v.default_value.includes('\n');
          return (
            // Key by INDEX (not v.name) so editing label/default doesn't unmount the row and steal focus.
            <div key={i} className="flex items-start gap-2">
              <span className="text-xs text-zinc-500 w-6 shrink-0 pt-2">#{i + 1}</span>
              <Input
                value={v.label}
                onChange={(e) => updateBlock(v.name, e.target.value, v.default_value)}
                placeholder="Label"
                className="text-xs h-8 flex-1"
              />
              <span className="text-xs text-zinc-600 shrink-0 pt-2">=</span>
              <Textarea
                value={v.default_value}
                onChange={(e) => updateBlock(v.name, v.label, e.target.value)}
                placeholder="ค่าเริ่มต้น (กด Enter ขึ้นบรรทัดใหม่ได้)"
                rows={isMultiline ? Math.min(8, v.default_value.split('\n').length + 1) : 1}
                className="text-xs flex-[2] min-h-[32px] resize-y"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}


interface TemplateVariable {
  name: string;
  label_th: string;
  label_en: string;
  type: 'text' | 'textarea' | 'image';
  default_value?: string;
  placeholder?: string;
  order: number;
  required?: boolean;
}

interface ImageTemplateAdmin {
  id?: number;
  slug: string;
  name: string;
  name_th?: string;
  description?: string;
  description_th?: string;
  thumbnail_url?: string;
  model: string;
  aspect: string;
  resolution: string;
  prompt_template: string;
  template_variables: TemplateVariable[];
  display_order: number;
  is_active: boolean;
}

// Slugify supports any Unicode language (Thai, Lao, Chinese, etc.) — only ASCII punctuation
// is stripped; CJK / Thai characters are preserved as valid URL path components (browsers UTF-8 encode).
const slugify = (text: string) =>
  text.toLowerCase()
    .replace(/[!@#$%^&*()+={}[\]:;'",.<>?/\\|`~"'""''‘’“”]/g, '') // strip ASCII + smart punctuation
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();

const emptyTemplate: ImageTemplateAdmin = {
  slug: '',
  name: '',
  name_th: '',
  description: '',
  description_th: '',
  thumbnail_url: '',
  model: '',
  aspect: 'auto',
  resolution: '1K',
  prompt_template: '',
  template_variables: [],
  display_order: 0,
  is_active: true,
};


const AdminImageTemplates = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [templates, setTemplates] = useState<ImageTemplateAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ImageTemplateAdmin | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const thumbnailFileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const data = await api.getImageTemplatesAdmin();
      setTemplates(data || []);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTemplates(); }, []);

  if (!user?.isAdmin) {
    return (
      <div className="container mx-auto p-8">
        <p className="text-red-500">Admin access required.</p>
      </div>
    );
  }

  const handleNew = () => {
    setEditing({ ...emptyTemplate });
    setIsNew(true);
  };

  const handleEdit = (t: ImageTemplateAdmin) => {
    setEditing({
      ...t,
      template_variables: Array.isArray(t.template_variables) ? t.template_variables : [],
    });
    setIsNew(false);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.slug || !editing.name || !editing.prompt_template) {
      toast.error('Slug, Name, Prompt Template are required');
      return;
    }
    if (!editing.model || !['gpt-image-2', 'nano-banana-2'].includes(editing.model)) {
      toast.error('กรุณาเลือก Model');
      return;
    }
    try {
      setSaving(true);
      // Server auto-derives template_variables from prompt_template — don't send them
      const { template_variables: _unused, ...payload } = editing;
      if (isNew) {
        await api.createImageTemplate(payload);
        toast.success('Template created');
      } else {
        await api.updateImageTemplate(editing.slug, payload);
        toast.success('Template updated');
      }
      setEditing(null);
      await fetchTemplates();
    } catch (err: any) {
      toast.error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // In-app delete-confirm dialog (replaces native window.confirm)
  const [pendingDeleteSlug, setPendingDeleteSlug] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = (slug: string) => setPendingDeleteSlug(slug);
  const confirmDelete = async () => {
    const slug = pendingDeleteSlug;
    if (!slug) return;
    setDeleting(true);
    try {
      await api.deleteImageTemplate(slug);
      toast.success('Deleted');
      setPendingDeleteSlug(null);
      await fetchTemplates();
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/app/admin')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h1 className="text-2xl font-semibold">Image Templates</h1>
        </div>
        {!editing && (
          <Button onClick={handleNew}>
            <Plus className="h-4 w-4 mr-1" />
            New Template
          </Button>
        )}
      </div>

      {loading && (
        <div className="text-center text-muted-foreground py-12">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        </div>
      )}

      {!editing && !loading && (
        <div className="grid gap-3">
          {templates.length === 0 && (
            <p className="text-center text-muted-foreground py-12">No templates. Create your first one.</p>
          )}
          {templates.map((t) => (
            <Card key={t.slug}>
              <CardContent className="p-4 flex items-center gap-4">
                {t.thumbnail_url && (
                  <img src={t.thumbnail_url.replace(/([?&])dl=1(\b|$)/, '$1raw=1$2')} alt={t.name} className="w-16 h-16 object-cover rounded" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{t.name}</span>
                    <span className="text-xs text-muted-foreground">/{t.slug}</span>
                    {!t.is_active && <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">inactive</span>}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-1">{t.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t.model} · {t.aspect} · {t.resolution} · {(t.template_variables || []).length} fields
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleEdit(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleDelete(t.slug)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{isNew ? 'New Template' : `Edit: ${editing.name}`}</h2>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Save
                </Button>
              </div>
            </div>

            {/* Basic info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Slug *</Label>
                <Input
                  value={editing.slug}
                  onChange={(e) => setEditing({ ...editing, slug: slugify(e.target.value) })}
                  placeholder="modern-house-sale"
                  disabled={!isNew}
                />
              </div>
              <div>
                <Label>Display Order</Label>
                <Input
                  type="number"
                  value={editing.display_order}
                  onChange={(e) => setEditing({ ...editing, display_order: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <Label>Name (English) *</Label>
                <Input
                  value={editing.name}
                  onChange={(e) => {
                    const newName = e.target.value;
                    setEditing((prev) => {
                      if (!prev) return prev;
                      // Auto-update slug when typing Name (English) — only on new templates and only if
                      // current slug is empty OR was a slugified version of the previous name (we follow
                      // the typing). Once admin manually edits slug, we stop tracking.
                      const prevAutoSlug = slugify(prev.name || '');
                      const slugIsTrackingName = !prev.slug || prev.slug === prevAutoSlug;
                      const next = { ...prev, name: newName };
                      if (isNew && slugIsTrackingName) {
                        next.slug = slugify(newName);
                      }
                      return next;
                    });
                  }}
                  placeholder="Modern House Sale Poster"
                />
              </div>
              <div>
                <Label>Name (ไทย)</Label>
                <Input value={editing.name_th || ''} onChange={(e) => setEditing({ ...editing, name_th: e.target.value })} />
              </div>
              <div>
                <Label>Description (English)</Label>
                <Input value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div>
                <Label>Description (ไทย)</Label>
                <Input value={editing.description_th || ''} onChange={(e) => setEditing({ ...editing, description_th: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Thumbnail URL</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={editing.thumbnail_url || ''}
                    onChange={(e) => setEditing({ ...editing, thumbnail_url: e.target.value })}
                    placeholder="วาง URL หรือคลิกปุ่มอัปโหลด →"
                    className="flex-1"
                  />
                  <input
                    ref={thumbnailFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.currentTarget.value = '';
                      if (!f) return;
                      try {
                        setUploadingThumb(true);
                        const { url } = await api.uploadImageTemplateThumbnail(f);
                        setEditing((prev) => prev ? { ...prev, thumbnail_url: url } : prev);
                        toast.success('Uploaded');
                        // Ask AI to read the project name from the poster, then auto-fill slug/name fields.
                        try {
                          toast.info('กำลังอ่านชื่อ + รายละเอียดจากภาพ...');
                          const { name_en, name_th, description_en, description_th } = await api.extractImageTemplateName(url);
                          if (name_en || name_th || description_en || description_th) {
                            setEditing((prev) => {
                              if (!prev) return prev;
                              const next = { ...prev };
                              if (name_en) next.name = name_en;
                              if (name_th) next.name_th = name_th;
                              if (description_en) next.description = description_en;
                              if (description_th) next.description_th = description_th;
                              // For new templates, always overwrite slug from extracted name (TH or EN — slugify keeps both).
                              if (isNew) {
                                const slugSrc = name_en || name_th || next.name;
                                if (slugSrc) next.slug = slugify(slugSrc);
                              }
                              return next;
                            });
                            toast.success(`อ่านจากภาพ: ${name_en || name_th || 'รายละเอียด'}`);
                          }
                        } catch (extractErr: any) {
                          toast.error(`อ่านชื่อภาพไม่สำเร็จ: ${extractErr?.message || 'unknown'}`);
                        }
                      } catch (err: any) {
                        toast.error(err?.message || 'Upload failed');
                      } finally {
                        setUploadingThumb(false);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingThumb}
                    onClick={() => thumbnailFileInputRef.current?.click()}
                    className="shrink-0"
                  >
                    {uploadingThumb ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                    อัปโหลด
                  </Button>
                </div>
              </div>
              <div>
                <Label>Model *</Label>
                <Select value={editing.model || ''} onValueChange={(v) => setEditing({ ...editing, model: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="— เลือก Model —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-image-2">gpt-image-2</SelectItem>
                    <SelectItem value="nano-banana-2">nano-banana-2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: !!v })} />
                <Label>Active (visible on Image Templates page)</Label>
              </div>
            </div>

            {/* Prompt template — variables auto-extracted from {{Label: Default}} blocks */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <Label>Prompt Template *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={analyzing || !editing.thumbnail_url || !editing.prompt_template?.trim()}
                  onClick={async () => {
                    if (!editing.thumbnail_url || !editing.prompt_template?.trim()) return;
                    try {
                      setAnalyzing(true);
                      const { prompt_template } = await api.analyzeImageTemplateThumbnail(editing.thumbnail_url, editing.prompt_template);
                      if (prompt_template) {
                        setEditing((prev) => prev ? { ...prev, prompt_template } : prev);
                        toast.success('แปลงเป็น {{Label: text}} เรียบร้อย');
                      } else {
                        toast.error('AI ไม่ส่ง prompt กลับมา');
                      }
                    } catch (err: any) {
                      toast.error(err?.message || 'วิเคราะห์ภาพล้มเหลว');
                    } finally {
                      setAnalyzing(false);
                    }
                  }}
                  title={!editing.thumbnail_url ? 'อัปโหลด Thumbnail ก่อน' : !editing.prompt_template?.trim() ? 'ใส่ Prompt ก่อน' : 'ใช้ AI วิเคราะห์ภาพ + wrap text เป็น {{Label: text}}'}
                >
                  {analyzing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
                  แปลงเป็น {'{{Label: text}}'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                Wrap any editable text as <code className="text-[#FFB300]">{'{{Label: Default value}}'}</code> — system จะสร้าง field ให้ user แก้อัตโนมัติ
              </p>
              <Textarea
                value={editing.prompt_template}
                onChange={(e) => setEditing({ ...editing, prompt_template: e.target.value })}
                rows={14}
                className="font-mono text-xs"
                placeholder={'Create a poster with title "{{หัวเรื่อง: Modern House}}"...'}
              />
              <PromptVariablePreview
                prompt={editing.prompt_template}
                setPrompt={(v) => setEditing({ ...editing, prompt_template: v })}
              />
              {editing.thumbnail_url && (
                <div className="mt-3 flex justify-center rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                  <img
                    // Defensively rewrite ?dl=1 → ?raw=1 so old Dropbox URLs render inline.
                    src={editing.thumbnail_url.replace(/([?&])dl=1(\b|$)/, '$1raw=1$2')}
                    alt="thumbnail preview"
                    className="block w-auto h-auto max-h-[400px] max-w-full rounded-md"
                    onLoad={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'block'; }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={pendingDeleteSlug !== null} onOpenChange={(v) => { if (!v && !deleting) setPendingDeleteSlug(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบ template?</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการลบ template <span className="text-[#FFB300] font-mono">{pendingDeleteSlug}</span> ใช่หรือไม่? การลบนี้ไม่สามารถย้อนกลับได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> กำลังลบ...</> : 'ลบ'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};


export default AdminImageTemplates;
