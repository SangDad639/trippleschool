import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, GripVertical, Upload, Loader2, Save, X, ChevronUp, ChevronDown, Eye, EyeOff, FileText, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { BilingualInput } from '@/components/admin/BilingualInput';
import WelcomeBannersPanel from '@/components/admin/WelcomeBannersPanel';

type BannerTab = 'update' | 'welcome';

// Thai short month names (Buddhist Era)
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatThaiDate(d: Date): string {
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}
function formatEnglishDate(d: Date): string {
  return `${EN_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

type DetailItem = {
  text: { th: string; en: string };
  videoUrl?: string;
  isHeading?: boolean;
  children?: { text: { th: string; en: string }; videoUrl?: string }[];
};
type Link = { label: { th: string; en: string }; url: string };
type Prompt = { label: string; text: string };

interface Banner {
  id: number;
  slug: string;
  date_th: string;
  date_en: string;
  title_th: string;
  title_en: string;
  detail_title_th: string;
  detail_title_en: string;
  banner: string;
  video_url: string;
  details: DetailItem[];
  links: Link[];
  prompts: Prompt[];
  display_order: number;
  is_active: boolean;
}

const empty = (): Omit<Banner, 'id'> => ({
  slug: '',
  date_th: '',
  date_en: '',
  title_th: '',
  title_en: '',
  detail_title_th: '',
  detail_title_en: '',
  banner: '',
  video_url: '',
  details: [],
  links: [],
  prompts: [],
  display_order: 0,
  is_active: true,
});

/**
 * AdminBanners page — wraps the legacy /update banners admin UI (this file)
 * and the new Welcome popup admin UI (WelcomeBannersPanel) under a single
 * top-level tab toggle. Path stays `/admin/banners`.
 */
export default function AdminBanners() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<BannerTab>('update');

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      {/* Header with back button + tabs */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">จัดการ Banner</h1>
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setTab('update')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
            tab === 'update'
              ? 'bg-[#FFB300]/10 text-[#FFB300] border-b-2 border-[#FFB300]'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <FileText className="h-4 w-4" />
          Update banners
        </button>
        <button
          onClick={() => setTab('welcome')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
            tab === 'welcome'
              ? 'bg-[#FFB300]/10 text-[#FFB300] border-b-2 border-[#FFB300]'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <ImageIcon className="h-4 w-4" />
          Welcome popup
        </button>
      </div>

      {tab === 'update' ? <UpdateBannersInner /> : <WelcomeBannersPanel />}
    </div>
  );
}

/**
 * The original /update banners admin UI — list, drag/drop reorder, full
 * BannerEditor for title/date/details/links/prompts. Lives as a sub-component
 * now so the parent AdminBanners can switch between this and the lighter
 * Welcome popup panel via tabs.
 */
function UpdateBannersInner() {
  const navigate = useNavigate();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Banner | (Omit<Banner, 'id'> & { id?: number }) | null>(null);
  const [saving, setSaving] = useState(false);
  const dragId = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getAdminBanners();
      setBanners(r);
    } catch (err: any) {
      toast.error(err.message || 'โหลด banner ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('ลบ banner นี้?')) return;
    try {
      await api.deleteBanner(id);
      setBanners(prev => prev.filter(b => b.id !== id));
      toast.success('ลบแล้ว');
    } catch (err: any) {
      toast.error(err.message || 'ลบไม่สำเร็จ');
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.slug || (!editing.title_th && !editing.title_en)) {
      toast.error('กรุณาใส่ slug และ ชื่อ (ไทยหรืออังกฤษอย่างน้อย 1 ภาษา)');
      return;
    }
    setSaving(true);
    try {
      if ((editing as Banner).id) {
        const updated = await api.updateBanner((editing as Banner).id, editing);
        setBanners(prev => prev.map(b => b.id === updated.id ? updated : b));
        toast.success('บันทึกแล้ว');
      } else {
        const created = await api.createBanner(editing);
        setBanners(prev => [...prev, created]);
        toast.success('สร้างแล้ว');
      }
      setEditing(null);
    } catch (err: any) {
      toast.error(err.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const moveOrder = async (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= banners.length) return;
    const next = [...banners];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setBanners(next);
    try {
      await api.reorderBanners(next.map(b => b.id));
    } catch (err: any) {
      toast.error('Reorder ไม่สำเร็จ');
      load();
    }
  };

  // Drag & drop reorder
  const handleDragStart = (id: number) => { dragId.current = id; };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = async (targetId: number) => {
    const srcId = dragId.current;
    dragId.current = null;
    if (srcId === null || srcId === targetId) return;
    const srcIdx = banners.findIndex(b => b.id === srcId);
    const tgtIdx = banners.findIndex(b => b.id === targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;
    const next = [...banners];
    const [moved] = next.splice(srcIdx, 1);
    next.splice(tgtIdx, 0, moved);
    setBanners(next);
    try { await api.reorderBanners(next.map(b => b.id)); } catch { toast.error('Reorder ไม่สำเร็จ'); load(); }
  };

  return (
    <div className="space-y-4">
      {/* Header was moved to the parent AdminBanners wrapper (tabs sit above).
          Keep just the per-tab title + create button here. */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Update banners</h2>
          <p className="text-xs text-muted-foreground">เพิ่ม / แก้ไข / เรียงลำดับ banner ในหน้า /update</p>
        </div>
        <Button onClick={() => setEditing(empty())} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
          <Plus className="h-4 w-4 mr-1" /> เพิ่ม Banner
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : banners.length === 0 ? (
        <p className="text-center py-12 text-muted-foreground">ยังไม่มี banner</p>
      ) : (
        <div className="space-y-2">
          {banners.map((b, idx) => (
            <div
              key={b.id}
              draggable
              onDragStart={() => handleDragStart(b.id)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(b.id)}
              className={`flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-[#FFB300]/40 transition-colors ${b.is_active ? '' : 'opacity-50'}`}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />
              <div className="flex flex-col">
                <button onClick={() => moveOrder(idx, -1)} disabled={idx === 0} className="p-0.5 disabled:opacity-30 hover:text-[#FFB300]"><ChevronUp className="h-3 w-3" /></button>
                <button onClick={() => moveOrder(idx, 1)} disabled={idx === banners.length - 1} className="p-0.5 disabled:opacity-30 hover:text-[#FFB300]"><ChevronDown className="h-3 w-3" /></button>
              </div>
              <div className="w-32 h-16 rounded overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                {b.banner ? (
                  <img src={b.banner} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">no image</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{b.title_th}</div>
                <div className="text-xs text-muted-foreground truncate">/{b.slug} • {b.date_th}</div>
              </div>
              <button onClick={() => api.updateBanner(b.id, { is_active: !b.is_active }).then(() => setBanners(prev => prev.map(x => x.id === b.id ? { ...x, is_active: !x.is_active } : x))).catch(() => toast.error('สลับสถานะไม่สำเร็จ'))} className="p-2 hover:bg-muted rounded">
                {b.is_active ? <Eye className="h-4 w-4 text-green-400" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
              </button>
              <Button variant="outline" size="sm" onClick={() => setEditing(b)}>Basic</Button>
              <Button size="sm" onClick={() => navigate(`/admin/banners/${b.id}/edit`)} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
                เนื้อหา →
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleDelete(b.id)} className="text-red-400 border-red-500/30 hover:bg-red-500/10">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <BannerEditor
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}

// ============ Editor Modal ============

function BannerEditor({ value, onChange, onClose, onSave, saving }: {
  value: any;
  onChange: (v: any) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // ESC key closes the modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const set = (patch: any) => onChange({ ...value, ...patch });

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const r = await api.uploadBannerImage(file);
      set({ banner: r.url });
      toast.success('อัปโหลดสำเร็จ');
    } catch (err: any) {
      toast.error(err.message || 'อัปโหลดล้มเหลว');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[95vw] max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="font-semibold">{value.id ? 'แก้ไข Banner' : 'เพิ่ม Banner'}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            กรอกข้อมูลพื้นฐานสำหรับการ์ด banner ก่อน — เนื้อหาหน้า detail (วิดีโอ/Prompt/Link) แก้ได้ตอนกดเข้าไปในการ์ดที่บันทึกแล้ว
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Slug (URL) *</label>
              <Input value={value.slug} onChange={e => set({ slug: e.target.value })} placeholder="how-to-xxx" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Active</label>
              <select value={value.is_active ? '1' : '0'} onChange={e => set({ is_active: e.target.value === '1' })} className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm">
                <option value="1">เปิด</option>
                <option value="0">ปิด</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">วันที่</label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  className="w-auto"
                  onChange={e => {
                    const v = e.target.value;
                    if (!v) return;
                    const d = new Date(v + 'T00:00:00');
                    set({ date_th: formatThaiDate(d), date_en: formatEnglishDate(d) });
                  }}
                />
                <Input value={value.date_th} onChange={e => set({ date_th: e.target.value })} placeholder="25 เม.ย. 2569" />
                <Input value={value.date_en} onChange={e => set({ date_en: e.target.value })} placeholder="Apr 25, 2026" />
              </div>
            </div>

            <div className="col-span-2">
              <BilingualInput
                value={{ th: value.title_th, en: value.title_en }}
                onChange={v => set({ title_th: v.th, title_en: v.en })}
              />
              <p className="text-[10px] text-muted-foreground mt-1">* ใส่อย่างน้อย 1 ภาษา — อีกภาษาแปลให้อัตโนมัติ</p>
            </div>
          </div>

          {/* Banner image */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Banner Image <span className="text-[10px] opacity-70">— ใช้ขนาด <b>1200×675 px (16:9)</b> เพื่อให้พอดีกรอบเป๊ะ ไม่โดนตัด</span>
            </label>
            <div className="flex items-center gap-3">
              <div className="w-40 h-24 rounded border border-zinc-700 bg-zinc-800 overflow-hidden flex items-center justify-center">
                {value.banner ? (
                  <img src={value.banner} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs text-muted-foreground">ไม่มีรูป</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); }} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                  อัปโหลด (Dropbox)
                </Button>
                <Input value={value.banner} onChange={e => set({ banner: e.target.value })} placeholder="หรือใส่ URL ตรงๆ" className="text-xs" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800">
          <Button variant="outline" onClick={onClose} disabled={saving}>ยกเลิก</Button>
          <Button onClick={onSave} disabled={saving} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailsEditor({ value, onChange }: { value: DetailItem[]; onChange: (v: DetailItem[]) => void }) {
  const add = () => onChange([...value, { text: { th: '', en: '' }, videoUrl: '' }]);
  const addHeading = () => onChange([...value, { text: { th: '', en: '' }, isHeading: true, children: [] }]);
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const update = (i: number, patch: Partial<DetailItem>) => onChange(value.map((x, j) => j === i ? { ...x, ...patch } : x));

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[#FFB300]">รายการ Detail (วิดีโอ / หัวข้อย่อย)</label>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" onClick={add}><Plus className="h-3 w-3 mr-1" />Item</Button>
          <Button type="button" size="sm" variant="outline" onClick={addHeading}><Plus className="h-3 w-3 mr-1" />Heading + Children</Button>
        </div>
      </div>
      {value.length === 0 && <p className="text-xs text-muted-foreground">ยังไม่มี</p>}
      {value.map((d, i) => (
        <div key={i} className="border border-zinc-700 rounded p-2 space-y-2 bg-zinc-800/30">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{d.isHeading ? 'Heading' : 'Item'} #{i + 1}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} className="ml-auto text-red-400 h-6"><Trash2 className="h-3 w-3" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="ข้อความ (ไทย)" value={d.text.th} onChange={e => update(i, { text: { ...d.text, th: e.target.value } })} />
            <Input placeholder="Text (English)" value={d.text.en} onChange={e => update(i, { text: { ...d.text, en: e.target.value } })} />
          </div>
          {!d.isHeading && (
            <Input placeholder="Video URL" value={d.videoUrl || ''} onChange={e => update(i, { videoUrl: e.target.value })} />
          )}
          {d.isHeading && (
            <ChildrenEditor value={d.children || []} onChange={v => update(i, { children: v })} />
          )}
        </div>
      ))}
    </div>
  );
}

function ChildrenEditor({ value, onChange }: { value: { text: { th: string; en: string }; videoUrl?: string }[]; onChange: (v: any[]) => void }) {
  const add = () => onChange([...value, { text: { th: '', en: '' }, videoUrl: '' }]);
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const update = (i: number, patch: any) => onChange(value.map((x, j) => j === i ? { ...x, ...patch } : x));

  return (
    <div className="ml-3 pl-2 border-l-2 border-[#FFB300]/30 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Children</span>
        <Button type="button" size="sm" variant="ghost" onClick={add} className="h-6 text-[11px]"><Plus className="h-3 w-3 mr-1" />Child</Button>
      </div>
      {value.map((c, i) => (
        <div key={i} className="grid grid-cols-2 gap-1.5 items-center">
          <Input placeholder="ข้อความ (ไทย)" value={c.text.th} onChange={e => update(i, { text: { ...c.text, th: e.target.value } })} className="h-8 text-xs" />
          <div className="flex gap-1">
            <Input placeholder="Video URL" value={c.videoUrl || ''} onChange={e => update(i, { videoUrl: e.target.value })} className="h-8 text-xs" />
            <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} className="text-red-400 h-8 px-2"><Trash2 className="h-3 w-3" /></Button>
          </div>
          <Input placeholder="Text (EN)" value={c.text.en} onChange={e => update(i, { text: { ...c.text, en: e.target.value } })} className="h-8 text-xs col-span-2" />
        </div>
      ))}
    </div>
  );
}

function LinksEditor({ value, onChange }: { value: Link[]; onChange: (v: Link[]) => void }) {
  const add = () => onChange([...value, { label: { th: '', en: '' }, url: '' }]);
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const update = (i: number, patch: any) => onChange(value.map((x, j) => j === i ? { ...x, ...patch } : x));

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[#FFB300]">Links</label>
        <Button type="button" size="sm" variant="outline" onClick={add}><Plus className="h-3 w-3 mr-1" />Link</Button>
      </div>
      {value.length === 0 && <p className="text-xs text-muted-foreground">ยังไม่มี</p>}
      {value.map((l, i) => (
        <div key={i} className="grid grid-cols-3 gap-2 items-center">
          <Input placeholder="Label (ไทย)" value={l.label.th} onChange={e => update(i, { label: { ...l.label, th: e.target.value } })} className="text-xs" />
          <Input placeholder="Label (EN)" value={l.label.en} onChange={e => update(i, { label: { ...l.label, en: e.target.value } })} className="text-xs" />
          <div className="flex gap-1">
            <Input placeholder="URL" value={l.url} onChange={e => update(i, { url: e.target.value })} className="text-xs" />
            <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} className="text-red-400"><Trash2 className="h-3 w-3" /></Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PromptsEditor({ value, onChange }: { value: Prompt[]; onChange: (v: Prompt[]) => void }) {
  const add = () => onChange([...value, { label: '', text: '' }]);
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const update = (i: number, patch: any) => onChange(value.map((x, j) => j === i ? { ...x, ...patch } : x));

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[#FFB300]">Prompts</label>
        <Button type="button" size="sm" variant="outline" onClick={add}><Plus className="h-3 w-3 mr-1" />Prompt</Button>
      </div>
      {value.length === 0 && <p className="text-xs text-muted-foreground">ยังไม่มี</p>}
      {value.map((p, i) => (
        <div key={i} className="border border-zinc-700 rounded p-2 space-y-1.5 bg-zinc-800/30">
          <div className="flex gap-2">
            <Input placeholder="Label (e.g. Image Prompt)" value={p.label} onChange={e => update(i, { label: e.target.value })} className="flex-1" />
            <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} className="text-red-400"><Trash2 className="h-3 w-3" /></Button>
          </div>
          <Textarea rows={5} placeholder="Prompt text" value={p.text} onChange={e => update(i, { text: e.target.value })} className="text-xs font-mono" />
        </div>
      ))}
    </div>
  );
}
