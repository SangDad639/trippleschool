import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Upload, Loader2, Play, Save, Check, X, ChevronUp, ChevronDown, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from 'sonner';

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
  is_active: boolean;
}

export default function AdminBannerEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [banner, setBanner] = useState<Banner | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load
  useEffect(() => {
    api.getAdminBanners()
      .then((rows: any[]) => {
        const b = rows.find(r => r.id === Number(id));
        if (!b) { toast.error('ไม่พบ banner'); navigate('/admin/banners'); return; }
        const details = Array.isArray(b.details) ? b.details : [];
        const links = Array.isArray(b.links) ? b.links : [];
        const prompts = Array.isArray(b.prompts) ? b.prompts : [];
        // Auto-fill ready-made template for blank banners (was created before backend seed existed)
        const needsSeed = details.length === 0 && prompts.length === 0;
        const loaded: Banner = needsSeed
          ? { ...b, details: defaultDetails(), links, prompts: defaultPrompts() }
          : { ...b, details, links, prompts };
        setBanner(loaded);
        // If we filled in defaults, push them up to the server right away
        if (needsSeed) scheduleAutoSave(loaded);
      })
      .catch(err => toast.error(err.message || 'โหลดไม่สำเร็จ'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate]);

  // Debounced auto-save
  const scheduleAutoSave = useCallback((next: Banner) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.updateBanner(next.id, next);
        setSavedAt(Date.now());
      } catch (err: any) {
        toast.error(err.message || 'บันทึกอัตโนมัติล้มเหลว');
      } finally {
        setSaving(false);
      }
    }, 800);
  }, []);

  const update = (patch: Partial<Banner>) => {
    setBanner(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      scheduleAutoSave(next);
      return next;
    });
  };

  const updateDetails = (details: DetailItem[]) => update({ details });
  const updateLinks = (links: Link[]) => update({ links });
  const updatePrompts = (prompts: Prompt[]) => update({ prompts });

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!banner) return null;

  return (
    <div className="page-wrapper">
      <div className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="container mx-auto px-4 max-w-4xl py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin/banners')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold truncate">แก้ไขเนื้อหา: {banner.title_th}</h1>
            <p className="text-[11px] text-muted-foreground">/{banner.slug} • คลิกข้อความ/รูป/วิดีโอ เพื่อแก้ในหน้า • บันทึกอัตโนมัติ</p>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            {saving ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> กำลังบันทึก...</>
            ) : savedAt ? (
              <><Check className="h-3 w-3 text-green-400" /> บันทึกแล้ว</>
            ) : null}
          </div>
          <Button variant="outline" size="sm" onClick={() => window.open(`/update/${banner.slug}`, '_blank')}>
            <Eye className="h-3.5 w-3.5 mr-1" /> Preview
          </Button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-3xl space-y-6">
        {/* Banner image — click to upload */}
        <BannerImageEdit value={banner.banner} onChange={url => update({ banner: url })} />

        {/* Date + detailTitle */}
        <div className="space-y-3">
          <DateEdit
            dateTh={banner.date_th}
            dateEn={banner.date_en}
            onChange={(date_th, date_en) => update({ date_th, date_en })}
          />
          <h2 className="text-xl font-bold text-[#FFB300]">
            <InlineText
              value={banner.detail_title_th}
              onChange={v => update({ detail_title_th: v })}
              placeholder="หัวข้อหน้า detail (ไทย) — คลิกเพื่อใส่"
              autoTranslate={{ source: 'th', otherSide: banner.detail_title_en, setOther: v => update({ detail_title_en: v }) }}
            />
          </h2>
          <div className="text-sm text-muted-foreground">
            EN:{' '}
            <InlineText
              value={banner.detail_title_en}
              onChange={v => update({ detail_title_en: v })}
              placeholder="Detail title (English) — click to add"
              autoTranslate={{ source: 'en', otherSide: banner.detail_title_th, setOther: v => update({ detail_title_th: v }) }}
            />
          </div>
        </div>

        {/* Details list */}
        <DetailsList items={banner.details} onChange={updateDetails} />

        {/* Links */}
        {banner.links.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-zinc-300 border-t border-border pt-4">ลิงก์เพิ่มเติม</h3>
            <LinksList items={banner.links} onChange={updateLinks} />
          </div>
        )}
        {banner.links.length === 0 && <LinksList items={banner.links} onChange={updateLinks} />}

        {/* Prompts — section like the published page */}
        {banner.prompts.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-border">
            <h2 className="text-xl font-bold text-[#FFB300]">ตัวอย่าง Prompt</h2>
            <PromptsList items={banner.prompts} onChange={updatePrompts} />
          </div>
        )}
        {banner.prompts.length === 0 && <PromptsList items={banner.prompts} onChange={updatePrompts} />}
      </div>
    </div>
  );
}

// ============ Reusable inline-edit primitives ============

function InlineText({ value, onChange, placeholder, className = '', multiline = false, autoTranslate }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  /** When set, on blur translate this value to the other language and call autoTranslate.set with the result (only if otherSide is empty). */
  autoTranslate?: { source: 'th' | 'en'; otherSide: string; setOther: (translation: string) => void };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const triggerTranslate = async (text: string) => {
    if (!autoTranslate) return;
    if (!text.trim()) return;
    const target = autoTranslate.source === 'th' ? 'en' : 'th';
    try {
      const r = await api.translateText(text.trim(), target);
      const t = r.translation?.trim();
      if (t) autoTranslate.setOther(t);
    } catch { /* silent */ }
  };

  if (editing) {
    const commit = () => {
      setEditing(false);
      if (draft !== value) {
        onChange(draft);
        triggerTranslate(draft);
      }
    };
    if (multiline) {
      return (
        <textarea
          autoFocus
          rows={6}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          className={`w-full bg-zinc-800 border border-[#FFB300]/60 rounded px-2 py-1 outline-none text-sm font-mono ${className}`}
        />
      );
    }
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
        className={`bg-zinc-800 border border-[#FFB300]/60 rounded px-2 py-0.5 outline-none ${className}`}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-text inline-block hover:bg-[#FFB300]/10 hover:outline hover:outline-1 hover:outline-[#FFB300]/40 rounded px-1 -mx-1 transition-colors ${className}`}
    >
      {value || <span className="text-muted-foreground italic">{placeholder || 'คลิกเพื่อแก้'}</span>}
    </span>
  );
}

function BannerImageEdit({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const r = await api.uploadBannerImage(file);
      onChange(r.url);
      toast.success('อัปโหลดสำเร็จ');
    } catch (err: any) {
      toast.error(err.message || 'อัปโหลดล้มเหลว');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-[#FFB300]/30 group cursor-pointer"
      onClick={() => fileRef.current?.click()}
    >
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      {value ? (
        <img src={value} alt="" className="w-full object-cover" />
      ) : (
        <div className="aspect-video flex items-center justify-center bg-zinc-800 text-muted-foreground text-sm">คลิกเพื่ออัปโหลด banner</div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
        {uploading ? <Loader2 className="h-6 w-6 animate-spin text-white" /> : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/70 text-white text-sm">
            <Upload className="h-4 w-4" /> เปลี่ยนรูป
          </div>
        )}
      </div>
    </div>
  );
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatThaiDate(d: Date): string { return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`; }
function formatEnglishDate(d: Date): string { return `${EN_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }

function DateEdit({ dateTh, dateEn, onChange }: { dateTh: string; dateEn: string; onChange: (th: string, en: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="date"
          autoFocus
          onChange={e => {
            const v = e.target.value;
            if (v) {
              const d = new Date(v + 'T00:00:00');
              onChange(formatThaiDate(d), formatEnglishDate(d));
            }
          }}
          onBlur={() => setEditing(false)}
          className="bg-zinc-800 border border-[#FFB300]/60 rounded px-2 py-1 text-sm"
        />
      </div>
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className="inline-block px-3 py-1 rounded-full bg-[#FFB300]/20 text-[#FFB300] text-xs font-semibold cursor-pointer hover:ring-2 hover:ring-[#FFB300]/40"
    >
      {dateTh || 'คลิกเลือกวันที่'} • {dateEn}
    </span>
  );
}

// ============ Block lists ============

function BlockWrap({ onMoveUp, onMoveDown, onDelete, onAddBelow, children }: {
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete?: () => void;
  onAddBelow?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative group">
      {children}
      <div className="absolute -right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1 bg-zinc-900/90 border border-zinc-700 rounded-lg p-1 z-10">
        {onMoveUp && <button onClick={onMoveUp} className="p-1 hover:bg-muted rounded" title="ขึ้น"><ChevronUp className="h-3 w-3" /></button>}
        {onMoveDown && <button onClick={onMoveDown} className="p-1 hover:bg-muted rounded" title="ลง"><ChevronDown className="h-3 w-3" /></button>}
        {onDelete && <button onClick={onDelete} className="p-1 hover:bg-red-500/20 rounded text-red-400" title="ลบ"><Trash2 className="h-3 w-3" /></button>}
      </div>
      {onAddBelow && (
        <div className="flex justify-center py-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onAddBelow} className="text-[10px] text-muted-foreground hover:text-[#FFB300] inline-flex items-center gap-1">
            <Plus className="h-3 w-3" /> เพิ่ม block ด้านล่าง
          </button>
        </div>
      )}
    </div>
  );
}

function AddBlockBar({ onAdd }: { onAdd: (type: 'video' | 'heading' | 'link' | 'prompt') => void }) {
  return (
    <div className="flex flex-wrap gap-2 p-3 rounded-lg border border-dashed border-[#FFB300]/30 bg-[#FFB300]/5">
      <span className="text-xs text-muted-foreground self-center mr-1">เพิ่ม:</span>
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd('video')}><Plus className="h-3 w-3 mr-1" /> Video</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd('heading')}><Plus className="h-3 w-3 mr-1" /> Heading + Children</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd('link')}><Plus className="h-3 w-3 mr-1" /> Link</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd('prompt')}><Plus className="h-3 w-3 mr-1" /> Prompt</Button>
    </div>
  );
}

// Group flat items into "sections" by heading position.
// Items before the first heading go into an "intro" section (no heading).
// Each subsequent heading starts a new section claiming items until the next heading.
function groupIntoSections(items: DetailItem[]): Array<{ headingIdx: number | null; itemIndices: number[] }> {
  const sections: Array<{ headingIdx: number | null; itemIndices: number[] }> = [];
  let current: { headingIdx: number | null; itemIndices: number[] } | null = null;
  items.forEach((item, idx) => {
    if (item.isHeading) {
      current = { headingIdx: idx, itemIndices: [] };
      sections.push(current);
    } else {
      if (!current) { current = { headingIdx: null, itemIndices: [] }; sections.push(current); }
      current.itemIndices.push(idx);
    }
  });
  return sections;
}

function DetailsList({ items, onChange }: { items: DetailItem[]; onChange: (v: DetailItem[]) => void }) {
  const update = (i: number, patch: Partial<DetailItem>) => onChange(items.map((x, j) => j === i ? { ...x, ...patch } : x));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  // Insert a new video right after the given index (last item in section)
  const addVideoAfter = (afterIdx: number) => {
    const next = [...items];
    next.splice(afterIdx + 1, 0, { text: { th: 'ชื่อวิดีโอ', en: 'Video title' }, videoUrl: '' });
    onChange(next);
  };
  const addHeadingAtEnd = () => {
    onChange([...items, { text: { th: 'หัวข้อใหม่', en: 'New heading' }, isHeading: true, children: [] }]);
  };
  // Move an entire section (heading + its items) up or down past the previous/next section
  const moveSection = (sectionIdx: number, dir: -1 | 1, sections: ReturnType<typeof groupIntoSections>) => {
    const target = sectionIdx + dir;
    if (target < 0 || target >= sections.length) return;
    const a = sections[sectionIdx];
    const b = sections[target];
    const aIndices = (a.headingIdx !== null ? [a.headingIdx, ...a.itemIndices] : a.itemIndices).sort((x, y) => x - y);
    const bIndices = (b.headingIdx !== null ? [b.headingIdx, ...b.itemIndices] : b.itemIndices).sort((x, y) => x - y);
    const aBlocks = aIndices.map(idx => items[idx]);
    const bBlocks = bIndices.map(idx => items[idx]);
    const otherIndices = new Set([...aIndices, ...bIndices]);
    const others = items.map((it, idx) => ({ it, idx })).filter(({ idx }) => !otherIndices.has(idx));
    const start = Math.min(aIndices[0] ?? 0, bIndices[0] ?? 0);
    const newOrder: DetailItem[] = [];
    others.filter(({ idx }) => idx < start).forEach(({ it }) => newOrder.push(it));
    if (dir === 1) { newOrder.push(...bBlocks); newOrder.push(...aBlocks); }
    else { newOrder.push(...aBlocks); newOrder.push(...bBlocks); /* swap visually */ }
    // Above logic for dir === -1 puts a then b, but we want b then a (swap). Fix:
    if (dir === -1) {
      newOrder.length = 0;
      others.filter(({ idx }) => idx < start).forEach(({ it }) => newOrder.push(it));
      newOrder.push(...aBlocks); // current goes UP first
      newOrder.push(...bBlocks); // previous goes after
    }
    others.filter(({ idx }) => idx > Math.max(...aIndices, ...bIndices)).forEach(({ it }) => newOrder.push(it));
    onChange(newOrder);
  };

  const sections = groupIntoSections(items);

  return (
    <div className="space-y-6">
      {sections.length === 0 && (
        <p className="text-sm text-muted-foreground italic">ยังไม่มี section — กดปุ่มด้านล่างเพื่อเพิ่ม</p>
      )}
      {sections.map((section, sectionIdx) => {
        const heading = section.headingIdx !== null ? items[section.headingIdx] : null;
        const sectionLabel = heading ? `Section ${sectionIdx + (sections[0].headingIdx === null ? 0 : 1)}` : 'Intro';
        return (
          <div key={`s-${sectionIdx}`} className="border-2 border-zinc-800 rounded-2xl p-4 bg-zinc-900/30 relative">
            {/* Section header */}
            <div className="flex items-center justify-between mb-3 -mt-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{sectionLabel}</span>
              {heading && (
                <div className="flex gap-1">
                  <button onClick={() => moveSection(sectionIdx, -1, sections)} disabled={sectionIdx === 0} className="p-1 hover:bg-muted rounded disabled:opacity-30" title="ย้าย section ขึ้น"><ChevronUp className="h-3 w-3" /></button>
                  <button onClick={() => moveSection(sectionIdx, 1, sections)} disabled={sectionIdx === sections.length - 1} className="p-1 hover:bg-muted rounded disabled:opacity-30" title="ย้าย section ลง"><ChevronDown className="h-3 w-3" /></button>
                  <button onClick={() => remove(section.headingIdx!)} className="p-1 hover:bg-red-500/20 rounded text-red-400" title="ลบทั้ง section"><Trash2 className="h-3 w-3" /></button>
                </div>
              )}
            </div>

            {/* Heading title (editable) */}
            {heading && (
              <div className="mb-4 pb-3 border-b border-zinc-800">
                <h2 className="text-xl font-bold text-[#FFB300]">
                  <InlineText
                    value={heading.text.th}
                    onChange={v => update(section.headingIdx!, { text: { ...heading.text, th: v } })}
                    placeholder="หัวข้อ section (ไทย)"
                    autoTranslate={{ source: 'th', otherSide: heading.text.en, setOther: v => update(section.headingIdx!, { text: { ...heading.text, en: v } }) }}
                  />
                </h2>
                <div className="text-xs text-muted-foreground mt-1">
                  EN: <InlineText
                    value={heading.text.en}
                    onChange={v => update(section.headingIdx!, { text: { ...heading.text, en: v } })}
                    placeholder="Section heading (English)"
                    autoTranslate={{ source: 'en', otherSide: heading.text.th, setOther: v => update(section.headingIdx!, { text: { ...heading.text, th: v } }) }}
                  />
                </div>
              </div>
            )}

            {/* Items in this section */}
            <div className="space-y-3">
              {section.itemIndices.map((i) => {
                const item = items[i];
                return (
                  <BlockWrap
                    key={i}
                    onMoveUp={() => move(i, -1)}
                    onMoveDown={() => move(i, 1)}
                    onDelete={() => remove(i)}
                  >
                    <VideoBlock item={item} update={(patch) => update(i, patch)} />
                  </BlockWrap>
                );
              })}
              {section.itemIndices.length === 0 && (
                <p className="text-xs text-muted-foreground italic px-2">ยังไม่มี video ใน section นี้</p>
              )}
            </div>

            {/* Add video to this section */}
            <div className="mt-3 pt-3 border-t border-zinc-800/60">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => addVideoAfter(section.itemIndices.length > 0 ? section.itemIndices[section.itemIndices.length - 1] : (section.headingIdx ?? -1))}
                className="text-xs text-muted-foreground hover:text-[#FFB300]"
              >
                <Plus className="h-3 w-3 mr-1" /> เพิ่ม Video ใน section นี้
              </Button>
            </div>
          </div>
        );
      })}

      {/* Add new section */}
      <div className="flex justify-center">
        <Button type="button" size="sm" variant="outline" onClick={addHeadingAtEnd} className="border-dashed">
          <Plus className="h-4 w-4 mr-1" /> เพิ่ม Section ใหม่
        </Button>
      </div>
    </div>
  );
}

// Extracted Video block (used inside a Section)
function VideoBlock({ item, update }: { item: DetailItem; update: (patch: Partial<DetailItem>) => void }) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-3 mb-4 px-2">
        <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center"><Play className="h-4 w-4 text-primary" /></div>
        <h3 className="text-base md:text-lg font-semibold text-white flex-1">
          <InlineText
            value={item.text.th}
            onChange={v => update({ text: { ...item.text, th: v } })}
            placeholder="ชื่อวิดีโอ (ไทย)"
            autoTranslate={{ source: 'th', otherSide: item.text.en, setOther: v => update({ text: { ...item.text, en: v } }) }}
          />
        </h3>
      </div>
      <div className="text-xs text-muted-foreground mb-2 px-2">
        EN: <InlineText
          value={item.text.en}
          onChange={v => update({ text: { ...item.text, en: v } })}
          placeholder="Video title (English)"
          autoTranslate={{ source: 'en', otherSide: item.text.th, setOther: v => update({ text: { ...item.text, th: v } }) }}
        />
      </div>
      {item.videoUrl ? (
        <div className="aspect-video rounded-xl overflow-hidden bg-zinc-900">
          <YouTubePreview url={item.videoUrl} />
        </div>
      ) : (
        <input
          type="text"
          value={item.videoUrl || ''}
          onChange={e => update({ videoUrl: e.target.value })}
          placeholder="วาง YouTube URL ที่นี่ — https://youtu.be/... หรือ https://www.youtube.com/watch?v=..."
          className="w-full bg-zinc-800 border border-dashed border-zinc-700 rounded px-3 py-3 text-xs font-mono outline-none focus:border-[#FFB300]/60"
        />
      )}
      {item.videoUrl && <UrlEditToggle url={item.videoUrl} onChange={v => update({ videoUrl: v })} />}
    </div>
  );
}

function ChildrenList({ items, onChange }: { items: { text: { th: string; en: string }; videoUrl?: string }[]; onChange: (v: any[]) => void }) {
  const update = (i: number, patch: any) => onChange(items.map((x, j) => j === i ? { ...x, ...patch } : x));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const add = () => onChange([...items, { text: { th: 'ชื่อวิดีโอ', en: 'Video title' }, videoUrl: '' }]);

  return (
    <div className="space-y-3">
      {items.map((c, i) => (
        <BlockWrap key={i} onDelete={() => remove(i)}>
          <div className="glass-card rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-4 px-2">
              <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center"><Play className="h-4 w-4 text-primary" /></div>
              <h3 className="text-base md:text-lg font-semibold text-white flex-1">
                <InlineText
                  value={c.text.th}
                  onChange={v => update(i, { text: { ...c.text, th: v } })}
                  placeholder="ชื่อ (ไทย)"
                  autoTranslate={{ source: 'th', otherSide: c.text.en, setOther: v => update(i, { text: { ...c.text, en: v } }) }}
                />
              </h3>
            </div>
            <div className="text-xs text-muted-foreground mb-2 px-2">
              EN: <InlineText
                value={c.text.en}
                onChange={v => update(i, { text: { ...c.text, en: v } })}
                placeholder="Title (EN)"
                autoTranslate={{ source: 'en', otherSide: c.text.th, setOther: v => update(i, { text: { ...c.text, th: v } }) }}
              />
            </div>
            {c.videoUrl ? (
              <div className="aspect-video rounded-xl overflow-hidden bg-zinc-900">
                <YouTubePreview url={c.videoUrl} />
              </div>
            ) : null}
            <div className="text-xs text-muted-foreground mt-2 px-2">
              URL: <InlineText value={c.videoUrl || ''} onChange={v => update(i, { videoUrl: v })} placeholder="Video URL" className="font-mono" />
            </div>
          </div>
        </BlockWrap>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={add} className="text-xs"><Plus className="h-3 w-3 mr-1" /> เพิ่ม Child</Button>
    </div>
  );
}

function LinksList({ items, onChange }: { items: Link[]; onChange: (v: Link[]) => void }) {
  const update = (i: number, patch: any) => onChange(items.map((x, j) => j === i ? { ...x, ...patch } : x));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const add = () => onChange([...items, { label: { th: 'ไฟล์แนบ', en: 'Link' }, url: '' }]);
  if (items.length === 0) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={add} className="text-xs"><Plus className="h-3 w-3 mr-1" /> เพิ่ม Link</Button>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((l, i) => (
        <BlockWrap key={i} onDelete={() => remove(i)}>
          <a
            href={l.url || '#'}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.preventDefault()}
            className="block px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 hover:border-[#FFB300]/40"
          >
            <div className="text-sm">
              <InlineText
                value={l.label.th}
                onChange={v => update(i, { label: { ...l.label, th: v } })}
                placeholder="Label (ไทย)"
                autoTranslate={{ source: 'th', otherSide: l.label.en, setOther: v => update(i, { label: { ...l.label, en: v } }) }}
              />
              {' / '}
              <InlineText
                value={l.label.en}
                onChange={v => update(i, { label: { ...l.label, en: v } })}
                placeholder="Label (EN)"
                autoTranslate={{ source: 'en', otherSide: l.label.th, setOther: v => update(i, { label: { ...l.label, th: v } }) }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              URL: <InlineText value={l.url} onChange={v => update(i, { url: v })} placeholder="https://..." className="font-mono" />
            </div>
          </a>
        </BlockWrap>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={add} className="text-xs"><Plus className="h-3 w-3 mr-1" /> เพิ่ม Link</Button>
    </div>
  );
}

function PromptsList({ items, onChange }: { items: Prompt[]; onChange: (v: Prompt[]) => void }) {
  const update = (i: number, patch: any) => onChange(items.map((x, j) => j === i ? { ...x, ...patch } : x));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const add = () => onChange([...items, { label: 'New Prompt', text: '' }]);
  if (items.length === 0) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={add} className="text-xs"><Plus className="h-3 w-3 mr-1" /> เพิ่ม Prompt</Button>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((p, i) => (
        <BlockWrap key={i} onDelete={() => remove(i)}>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-white">
              <InlineText value={p.label} onChange={v => update(i, { label: v })} placeholder="Prompt label" />
            </h3>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
              <InlineText
                value={p.text}
                onChange={v => update(i, { text: v })}
                placeholder="Prompt text"
                className="text-sm text-zinc-300 font-mono whitespace-pre-wrap block"
                multiline
              />
            </div>
          </div>
        </BlockWrap>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={add} className="text-xs"><Plus className="h-3 w-3 mr-1" /> เพิ่ม Prompt</Button>
    </div>
  );
}

// Tiny toggle for editing a video URL after it's been set. Hidden by default to
// keep the editor visually clean (mirrors the published page).
function UrlEditToggle({ url, onChange }: { url: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-[10px] text-muted-foreground hover:text-[#FFB300] inline-flex items-center gap-1 px-2"
      >
        🔗 แก้ URL
      </button>
    );
  }
  return (
    <div className="mt-2 px-2 flex gap-2">
      <input
        type="text"
        value={url}
        onChange={e => onChange(e.target.value)}
        autoFocus
        onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setOpen(false); }}
        className="flex-1 bg-zinc-800 border border-[#FFB300]/60 rounded px-2 py-1 text-xs font-mono outline-none"
      />
    </div>
  );
}

// Ready-made template skeleton — used when admin opens an empty banner so they
// see a full draft to edit (mirrors the backend seed in admin.ts POST /banners).
function defaultDetails(): DetailItem[] {
  return [
    { text: { th: 'คู่มือการใช้งาน Idol Template', en: 'How to Use Idol Template' }, videoUrl: 'https://www.youtube.com/watch?v=uXiK24GiadU' },
    { text: { th: 'วิธีสร้าง Custom Idol Template', en: 'How to Create Custom Idol Template' }, videoUrl: 'https://www.youtube.com/embed/yKCh8UfAnxY' },
  ];
}
function defaultPrompts(): Prompt[] {
  return [
    {
      label: 'Image Prompt',
      text: `amateur smartphone photo, realistic casual snapshot taken with iPhone, candid portrait,

voluptuous young woman with very large breasts and massive cleavage,
arms raised behind head exposing thick dark hairy armpits,

inspired by the woman in the attached reference image 1,
wearing clothing and accessories from the attached reference image 2,
with background from the attached reference image 3,

soft indoor natural light, slight lens flare,

shot on smartphone, 26mm lens, f/1.8, slight depth of field, soft bokeh,
mild digital noise and film grain, natural color grading,
unedited raw phone photo style, authentic everyday mobile photo,
highly photorealistic, indistinguishable from real iPhone photo`,
    },
    {
      label: 'VDO Prompt',
      text: `arms raised behind head, slow stretching motion, slowly and teasingly sticking out tongue, wet glossy tongue licking lips sensually, eye contact with camera, subtle body sway, deep breathing, natural movement of armpit hair, seductive and erotic atmosphere, smooth cinematic slow motion`,
    },
  ];
}

// Extract YouTube video ID from various URL formats
function youtubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?&]+)/,
    /youtube\.com\/embed\/([^?&]+)/,
    /youtube-nocookie\.com\/embed\/([^?&]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}
function youtubeThumb(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/maxresdefault.jpg` : null;
}

function YouTubePreview({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const thumb = youtubeThumb(url);
  if (playing) {
    return (
      <iframe
        src={youtubeEmbed(url) + '&autoplay=1'}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }
  if (thumb) {
    return (
      <button
        type="button"
        onClick={() => setPlaying(true)}
        className="relative w-full h-full block group"
      >
        <img src={thumb} alt="" className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).src = thumb.replace('maxresdefault', 'hqdefault'); }} />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
          <div className="w-16 h-16 rounded-full bg-red-600/90 flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
            <Play className="h-7 w-7 text-white fill-white ml-1" />
          </div>
        </div>
      </button>
    );
  }
  return (
    <iframe
      src={youtubeEmbed(url)}
      className="w-full h-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}

function youtubeEmbed(url: string): string {
  if (!url) return '';
  // Use privacy-enhanced domain (no-cookie) which removes "Watch on YouTube" overlay
  // Params: rel=0 (no related videos at end), modestbranding=1 (minimize YT logo),
  //         playsinline=1, iv_load_policy=3 (hide annotations)
  const QS = '?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3';
  let base: string;
  if (url.includes('youtube-nocookie.com/embed/')) base = url.split('?')[0];
  else if (url.includes('embed/')) base = url.split('?')[0].replace('youtube.com', 'youtube-nocookie.com');
  else if (url.includes('playlist')) {
    try {
      const list = new URL(url).searchParams.get('list');
      return list ? `https://www.youtube-nocookie.com/embed/videoseries${QS}&list=${list}` : url;
    } catch { return url; }
  }
  else if (url.includes('youtu.be/')) base = `https://www.youtube-nocookie.com/embed/${url.split('youtu.be/')[1].split('?')[0]}`;
  else if (url.includes('watch?v=')) base = url.replace('watch?v=', 'embed/').replace('youtube.com', 'youtube-nocookie.com').split('?')[0];
  else return url;
  return base + QS;
}
