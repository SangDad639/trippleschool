import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Film, Lock, Plus, Pencil, Trash2, Loader2, Upload, Download, Sparkles, ArrowLeft, Save, X, ChevronDown, Star, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { api } from '@/lib/api';
import { ClickToPlayVideo } from '@/components/ui/ClickToPlayVideo';
import { toast } from 'sonner';
import type { ViralTemplate, ViralCustomPrompt, TemplateVariable, FieldConfig } from '@/types/viralTemplate';

function TemplateCard({ template, navigate, isLocked, isNew, isFavorite, onToggleFavorite }: { template: ViralTemplate; navigate: (path: string) => void; isLocked: boolean; isNew?: boolean; isFavorite?: boolean; onToggleFavorite?: (slug: string) => void }) {
  const validThumbnail = template.thumbnail_url && !template.thumbnail_url.includes('thumbnail.jpg') ? template.thumbnail_url : null;

  return (
    <div
      className="group cursor-pointer rounded-[7px] border border-zinc-800 bg-zinc-900 hover:border-[#FFB300]/50 transition-all relative overflow-visible"
      onClick={() => {
        if (isLocked) {
          toast.error('ต้องสมัครรายปีเท่านั้นถึงจะใช้ได้');
          return;
        }
        navigate(`/app/viral-templates/${template.slug}`);
      }}
    >
      <div className="relative">
        {/* NEW badge - positioned on the edge of video */}
        {isNew && (
          <img src="/new-badge.png" alt="NEW" className="absolute -top-4 -left-4 w-14 h-14 z-30 pointer-events-none" />
        )}
      <div className="aspect-[9/16] bg-zinc-800 relative flex items-center justify-center overflow-hidden rounded-t-lg">
        <ClickToPlayVideo
          videoUrl={template.preview_video_url}
          thumbnailUrl={validThumbnail}
          name={template.name}
          fallback={<div className="flex flex-col items-center gap-2 text-zinc-600"><Film className="h-10 w-10" /><span className="text-xs">Template</span></div>}
        />
        {/* Favorite star — moved below to name row */}
        {/* Lock overlay for monthly users */}
        {isLocked && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20">
            <Lock className="h-8 w-8 text-yellow-400" />
          </div>
        )}
        {/* Hover overlay (only for non-video cards) */}
        {!template.preview_video_url && !isLocked && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="w-12 h-12 rounded-[7px] bg-[#FFB300]/90 flex items-center justify-center"><Play className="h-6 w-6 text-black ml-0.5" /></div>
          </div>
        )}
      </div>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-1">
          <h3 className="text-sm font-medium text-zinc-200 truncate">{template.name}</h3>
          {onToggleFavorite && (
            <button className="p-1 rounded-full hover:bg-zinc-800 transition-colors shrink-0" onClick={(e) => { e.stopPropagation(); onToggleFavorite(template.slug); }}>
              <Star className={`h-4 w-4 ${isFavorite ? 'text-yellow-500 fill-yellow-500' : 'text-zinc-500'}`} />
            </button>
          )}
        </div>
        {(template.times_used ?? 0) > 0 && (
          <span className="text-[10px] text-muted-foreground">ใช้แล้ว {template.times_used} ครั้ง</span>
        )}
        {isLocked && (
          <span className="text-[10px] text-yellow-400 font-semibold">🔒 สำหรับแพ็กรายปี</span>
        )}
      </div>
    </div>
  );
}

// ─── Default form state ────────────────────────────────────
const defaultFieldConfig: FieldConfig = { show_channel: true, show_language: true, show_scenes: true, show_videos: true };

const emptyForm = {
  name: '', description: '', youtube_url: '', thumbnail_url: '',
  prompt_text: '', fixed_scenes: null as number | null, scene_descriptions: [] as string[],
  template_slug: 'custom' as string,
};

// ─── Main Component ────────────────────────────────────────
export function ViralTemplateTab() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const isYearly = user?.isAdmin || subscription?.planType === 'yearly';
  const [templates, setTemplates] = useState<ViralTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const TEMPLATES_PER_PAGE = 20;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [filter, _setFilter] = useState<'all' | 'favorite' | 'custom'>(() => (sessionStorage.getItem('viralTemplateFilter') as 'all' | 'favorite' | 'custom') || 'all');
  const setFilter = (v: 'all' | 'favorite' | 'custom') => { _setFilter(v); sessionStorage.setItem('viralTemplateFilter', v); };
  const [sortBy, setSortBy] = useState<'latest' | 'popular'>('latest');
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);

  // Custom prompts
  const [customPrompts, setCustomPrompts] = useState<(ViralCustomPrompt & { template_name?: string })[]>([]);

  // Full-page form state
  const [showForm, setShowForm] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<ViralCustomPrompt | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [fieldConfig, setFieldConfig] = useState<FieldConfig>(defaultFieldConfig);
  const [fixedScenesEnabled, setFixedScenesEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadTemplates = useCallback(async (pageNum: number = 1, append: boolean = false) => {
    try {
      if (append) setLoadingMore(true); else setLoading(true);
      const res: any = await api.getViralTemplates({ sort: sortBy, page: pageNum, limit: TEMPLATES_PER_PAGE });
      const data: ViralTemplate[] = res?.data || res || [];
      const pag = res?.pagination;
      setHasMore(pag ? !!pag.hasMore : false);
      setPage(pageNum);
      setTemplates(prev => append ? [...prev, ...data] : data);
    } catch (err) {
      console.error('Failed to load viral templates:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sortBy]);

  useEffect(() => { loadTemplates(1, false); }, [loadTemplates]);

  // Infinite scroll — auto load when scrolling to bottom
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          loadTemplates(page + 1, true);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, page, loadTemplates]);

  useEffect(() => { api.getAllViralCustomPrompts().then(setCustomPrompts).catch(console.error); }, []);
  useEffect(() => { api.getViralFavorites().then(setFavorites).catch(console.error); }, []);

  const handleToggleFavorite = async (slug: string) => {
    try {
      const result = await api.toggleViralFavorite(slug);
      if (result.favorited) {
        setFavorites(prev => [...prev, slug]);
      } else {
        setFavorites(prev => prev.filter(s => s !== slug));
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  // ─── Form helpers ──────────────────────────
  const openCreate = () => {
    setEditingPrompt(null);
    setForm({ ...emptyForm });
    setVariables([]);
    setFieldConfig(defaultFieldConfig);
    setFixedScenesEnabled(false);
    setShowForm(true);
  };

  const openEdit = (p: ViralCustomPrompt) => {
    setEditingPrompt(p);
    setForm({
      name: p.name, description: p.description || '',
      youtube_url: p.youtube_url || '', thumbnail_url: p.thumbnail_url || '',
      prompt_text: p.prompt_text, fixed_scenes: p.fixed_scenes ?? null,
      scene_descriptions: p.scene_descriptions || [],
      // Preserve the parent template selection when editing — fall back to
      // 'custom' so a row created via the old shape (no template_slug) still
      // round-trips cleanly.
      template_slug: (p as any).template_slug || 'custom',
    });
    setVariables(p.template_variables || []);
    setFieldConfig(p.field_config || defaultFieldConfig);
    setFixedScenesEnabled(!!p.fixed_scenes);
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setEditingPrompt(null); };

  const addVariable = () => {
    setVariables(prev => [...prev, { key: `var_${Date.now()}`, label: '', placeholder: '', description: '', enabled: true, per_scene: false }]);
  };

  const removeVariable = (idx: number) => setVariables(prev => prev.filter((_, i) => i !== idx));

  const updateVariable = (idx: number, field: keyof TemplateVariable, value: any) => {
    setVariables(prev => prev.map((v, i) => i === idx ? { ...v, [field]: value } : v));
  };

  const updateSceneDescs = (count: number) => {
    setForm(prev => {
      const descs = [...(prev.scene_descriptions || [])];
      while (descs.length < count) descs.push('');
      return { ...prev, fixed_scenes: count, scene_descriptions: descs.slice(0, count) };
    });
  };

  // ─── Save ──────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim() || !form.prompt_text.trim()) {
      toast.error('กรุณากรอกชื่อและ system prompt');
      return;
    }
    setSaving(true);
    const payload = {
      ...form, template_variables: variables, field_config: fieldConfig,
      fixed_scenes: fixedScenesEnabled ? form.fixed_scenes : null,
      scene_descriptions: fixedScenesEnabled ? form.scene_descriptions : [],
    };
    try {
      if (editingPrompt) {
        const updated = await api.updateViralCustomPrompt(editingPrompt.id, payload as any);
        setCustomPrompts(prev => prev.map(p => p.id === editingPrompt.id ? { ...updated, template_name: p.template_name } : p));
        toast.success('อัพเดท prompt สำเร็จ');
      } else {
        const created = await api.createViralCustomPrompt({ template_slug: 'custom', ...payload } as any);
        const tpl = templates.find(t => t.slug === form.template_slug);
        setCustomPrompts(prev => [{ ...created, template_name: tpl?.name }, ...prev]);
        toast.success('สร้าง prompt สำเร็จ');
      }
      setShowForm(false);
      setEditingPrompt(null);
    } catch (err: any) {
      toast.error(err.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteViralCustomPrompt(id);
      setCustomPrompts(prev => prev.filter(p => p.id !== id));
      toast.success('ลบ prompt สำเร็จ');
    } catch (err: any) { toast.error(err.message || 'ลบไม่สำเร็จ'); }
  };

  const handleExport = () => {
    if (customPrompts.length === 0) { toast.error('ยังไม่มี custom prompt ให้ export'); return; }
    const data = customPrompts.map(({ id, user_id, created_at, updated_at, template_name, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'viral-custom-prompts.json'; a.click();
    toast.success(`Export ${data.length} prompts สำเร็จ`);
  };

  const handleImport = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data)) throw new Error('Invalid');
        let n = 0;
        for (const item of data) {
          if (item.template_slug && item.name && item.prompt_text) {
            const created = await api.createViralCustomPrompt(item);
            const tpl = templates.find(t => t.slug === item.template_slug);
            setCustomPrompts(prev => [...prev, { ...created, template_name: tpl?.name }]);
            n++;
          }
        }
        toast.success(`Import ${n} prompts สำเร็จ`);
      } catch { toast.error('ไฟล์ JSON ไม่ถูกต้อง'); }
    };
    input.click();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="text-zinc-500">Loading...</div></div>;

  // ─── Full-page Form (เหมือน AdminViralTemplates) ─────────
  if (showForm) {
    return (
      <div className="max-w-3xl mx-auto px-2 sm:px-0 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={cancelForm} className="text-zinc-400 hover:text-white">
            <ArrowLeft className="h-4 w-4 mr-1" /> กลับ
          </Button>
          <h2 className="text-lg font-bold">{editingPrompt ? 'แก้ไข Custom Prompt' : 'สร้าง Custom Prompt'}</h2>
        </div>

        {/* Section 1: ข้อมูลพื้นฐาน */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#FFB300] uppercase tracking-wide">ข้อมูลพื้นฐาน</h3>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">ชื่อ Prompt *</label>
              <Input className="bg-zinc-800 border-zinc-700" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="เช่น Anatomy Care AI" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">คำอธิบาย</label>
              <Input className="bg-zinc-800 border-zinc-700" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="อธิบายสั้นๆ ว่า Template นี้ทำอะไร" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">YouTube Link</label>
                <Input className="bg-zinc-800 border-zinc-700" value={form.youtube_url} onChange={e => setForm(p => ({ ...p, youtube_url: e.target.value }))} placeholder="https://www.youtube.com/watch?v=..." />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Thumbnail URL</label>
                <Input className="bg-zinc-800 border-zinc-700" value={form.thumbnail_url} onChange={e => setForm(p => ({ ...p, thumbnail_url: e.target.value }))} placeholder="/viral-templates/my-thumbnail.jpg" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: การตั้งค่า Input & ฉาก */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#FFB300] uppercase tracking-wide">การตั้งค่า Input & ฉาก</h3>

            {/* Field Config Checkboxes */}
            <p className="text-xs text-zinc-500">ช่องที่แสดงตอนสร้าง Job:</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['show_channel', 'เลือกช่อง (Channel)'],
                ['show_language', 'เลือกภาษา (Language)'],
                ['show_scenes', 'จำนวนฉากต่อ VDO'],
                ['show_videos', 'จำนวน VDO'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 bg-zinc-800/50 rounded-md px-3 py-2 cursor-pointer">
                  <Checkbox checked={fieldConfig[key]} onCheckedChange={(v) => setFieldConfig(prev => ({ ...prev, [key]: !!v }))} />
                  <span className="text-xs text-zinc-300">{label}</span>
                </label>
              ))}
            </div>

            {/* Fixed Scenes */}
            <label className="flex items-center gap-2 cursor-pointer mt-2">
              <Checkbox checked={fixedScenesEnabled} onCheckedChange={(v) => {
                setFixedScenesEnabled(!!v);
                if (v && !form.fixed_scenes) updateSceneDescs(3);
              }} />
              <span className="text-xs text-zinc-300 font-medium">ล็อคจำนวนฉาก</span>
            </label>
            {fixedScenesEnabled && (
              <div className="ml-6 space-y-2">
                <Input type="number" min={1} max={10} className="bg-zinc-800 border-zinc-700 w-20 h-8 text-sm"
                  value={form.fixed_scenes ?? 3} onChange={e => updateSceneDescs(parseInt(e.target.value) || 3)} />
                {(form.scene_descriptions || []).map((desc, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 w-12 flex-shrink-0">ฉาก {i + 1}:</span>
                    <Input className="bg-zinc-800 border-zinc-700 h-8 text-sm" value={desc}
                      onChange={e => setForm(prev => {
                        const descs = [...(prev.scene_descriptions || [])];
                        descs[i] = e.target.value;
                        return { ...prev, scene_descriptions: descs };
                      })}
                      placeholder={`คำอธิบายฉากที่ ${i + 1}`} />
                  </div>
                ))}
              </div>
            )}

            {/* แยกตัวแปรแต่ละฉาก */}
            <label className="flex items-center gap-2 bg-zinc-800/50 rounded-md px-3 py-2 cursor-pointer w-fit mt-2">
              <Checkbox checked={fieldConfig.per_scene_vars ?? false}
                onCheckedChange={c => setFieldConfig(p => ({ ...p, per_scene_vars: !!c }))} />
              <span className="text-xs text-zinc-300">แยกตัวแปรแต่ละฉาก</span>
            </label>

            {/* Template Variables */}
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-zinc-400 font-medium">ตัวแปรที่ User กรอกใน Task Card:</span>
              <Button size="sm" variant="outline" onClick={addVariable} className="border-zinc-600 text-zinc-300 h-7 text-xs">
                <Plus className="h-3 w-3 mr-1" /> เพิ่มตัวแปร
              </Button>
            </div>
            {variables.length === 0 && <p className="text-xs text-zinc-600">ยังไม่มีตัวแปร — กด "เพิ่มตัวแปร" เพื่อเพิ่ม</p>}
            {variables.map((v, i) => (
              <div key={i} className="border rounded-[7px] px-3 py-2.5 space-y-2 border-zinc-700 bg-zinc-800/50">
                <div className="flex items-center gap-3">
                  <Checkbox checked={v.enabled} onCheckedChange={(val) => updateVariable(i, 'enabled', !!val)} />
                  <Input className="bg-zinc-800 border-zinc-700 h-8 text-sm flex-1" value={v.label}
                    onChange={e => updateVariable(i, 'label', e.target.value)} placeholder="ชื่อตัวแปร เช่น Anatomy, Condition" />
                  <Button variant="ghost" size="sm" onClick={() => removeVariable(i)} className="text-red-400 h-7 w-7 p-0 flex-shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Input className="bg-zinc-800/50 border-zinc-700 h-8 text-xs ml-8 text-zinc-300" value={v.placeholder || ''}
                  onChange={e => updateVariable(i, 'placeholder', e.target.value)} placeholder="Placeholder เช่น ต้มจืดเต้าหู้หมูสับ, แกงเขียวหวาน" />
                <Input className="bg-zinc-800/50 border-zinc-700 h-8 text-xs ml-8 text-zinc-300" value={v.description}
                  onChange={e => updateVariable(i, 'description', e.target.value)} placeholder="คำอธิบาย เช่น The specific body part (e.g., Groin, Elbow, Back)" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Section 3: System Prompt */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#FFB300] uppercase tracking-wide">System Prompt *</h3>
            <Textarea className="bg-zinc-800 border-zinc-700 text-zinc-200 font-mono text-sm" rows={16}
              value={form.prompt_text} onChange={e => setForm(p => ({ ...p, prompt_text: e.target.value }))}
              placeholder="System prompt สำหรับ AI สร้าง scene prompts..." />
            <p className="text-xs text-zinc-500">Prompt นี้จะถูกส่งให้ AI เพื่อสร้าง image/video prompts — ต้องลงท้ายด้วย JSON response format</p>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving} className="bg-[#FFB300] text-black font-semibold hover:bg-[#FFC233]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {editingPrompt ? 'บันทึก' : 'สร้าง'}
          </Button>
          <Button variant="ghost" onClick={cancelForm} className="text-zinc-400">
            <X className="h-4 w-4 mr-1" /> ยกเลิก
          </Button>
        </div>
      </div>
    );
  }

  // ─── Listing View ────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="flex items-center gap-2">
        <Film className="h-5 w-5 text-[#FFB300]" />
        <h2 className="text-xl font-semibold">{t('viral.title')}</h2>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="ค้นหา Template..."
          className="pl-9 rounded-full"
        />
      </div>

      {/* Sort + Filter Tabs */}
      <div className="inline-flex h-10 items-center rounded-[25px] bg-muted p-1 text-muted-foreground">
        <div className="relative inline-flex items-center">
          <button
            onClick={() => {
              const el = document.getElementById('viral-sort-dropdown');
              if (el) el.classList.toggle('hidden');
            }}
            className="inline-flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-[20px] text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-all"
          >
            {sortBy === 'latest' ? 'ล่าสุด' : 'ยอดนิยม'}
            <ChevronDown className="h-3 w-3" />
          </button>
          <div
            id="viral-sort-dropdown"
            className="hidden absolute top-full left-0 mt-1 min-w-[120px] rounded-[16px] bg-[#18181b] shadow-lg z-50 overflow-hidden"
            onMouseLeave={(e) => e.currentTarget.classList.add('hidden')}
          >
            <button
              onClick={() => { setSortBy('latest'); document.getElementById('viral-sort-dropdown')?.classList.add('hidden'); }}
              className={`w-full text-left px-4 py-2 text-sm transition-colors ${sortBy === 'latest' ? 'text-[#FFB300] bg-zinc-800' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            >
              ล่าสุด
            </button>
            <button
              onClick={() => { setSortBy('popular'); document.getElementById('viral-sort-dropdown')?.classList.add('hidden'); }}
              className={`w-full text-left px-4 py-2 text-sm transition-colors ${sortBy === 'popular' ? 'text-[#FFB300] bg-zinc-800' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            >
              ยอดนิยม
            </button>
          </div>
        </div>
        <button onClick={() => setFilter('all')} className={`inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all ${filter === 'all' ? 'bg-background text-[#FFB300] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          ทั้งหมด
        </button>
        <button onClick={() => setFilter('favorite')} className={`inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all ${filter === 'favorite' ? 'bg-background text-[#FFB300] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          ชื่นชอบ{favorites.length > 0 ? ` (${favorites.length})` : ''}
        </button>
        <button onClick={() => setFilter('custom')} className={`inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all ${filter === 'custom' ? 'bg-background text-[#FFB300] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          กำหนดเอง
        </button>
      </div>

      {/* Action buttons for custom filter */}
      {filter === 'custom' && (
        <>
          <div
            className="rounded-xl border border-[#FFB300]/30 overflow-hidden cursor-pointer relative group"
            onClick={() => navigate('/update/how-to-custom-viral-template')}
          >
            <img
              src="/custom-viral-banner.jpg"
              alt="How to Make Custom Viral Template"
              className="w-full h-auto object-contain group-hover:brightness-75 transition-all"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={handleImport} className="border-zinc-600 text-zinc-300 hover:bg-zinc-800">
              <Upload className="h-4 w-4 mr-1" /> Import
            </Button>
            <Button size="sm" variant="outline" onClick={handleExport} className="border-zinc-600 text-zinc-300 hover:bg-zinc-800">
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button size="sm" onClick={openCreate} className="bg-[#FFB300] text-black font-semibold hover:bg-[#FFC233]">
              <Plus className="h-4 w-4 mr-1" /> เพิ่ม Prompt
            </Button>
          </div>
        </>
      )}

      {/* Content */}
      {filter !== 'custom' ? (
        <div className="space-y-4">
          {(() => {
            const q = searchQuery.toLowerCase().trim();
            const filtered = (filter === 'favorite'
              ? templates.filter(t => favorites.includes(t.slug))
              : templates
            ).filter(t => !q || t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
            return (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {filtered.map((tpl, idx) => <TemplateCard key={tpl.slug} template={tpl} navigate={navigate} isLocked={!isYearly && !!tpl.yearly_only} isNew={filter === 'all' && sortBy === 'latest' && idx < 5} isFavorite={favorites.includes(tpl.slug)} onToggleFavorite={handleToggleFavorite} />)}
                </div>
                {filtered.length === 0 && <div className="text-center py-10 text-zinc-500">{filter === 'favorite' ? 'ยังไม่มีรายการชื่นชอบ' : 'No templates available'}</div>}
                {/* Infinite scroll sentinel — only when no client-side filter active */}
                {filter !== 'favorite' && !q && hasMore && (
                  <div ref={loadMoreRef} className="h-10 flex items-center justify-center">
                    {loadingMore && <Loader2 className="h-5 w-5 animate-spin text-[#FFB300]" />}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      ) : (
        <div>
          {customPrompts.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {customPrompts.map(p => (
                <div key={p.id} className="group rounded-[7px] border border-zinc-800 bg-zinc-900 overflow-hidden hover:border-[#FFB300]/50 transition-all flex flex-col">
                  {/* Preview area */}
                  <div className="aspect-[9/16] bg-zinc-800 relative flex items-center justify-center">
                    <ClickToPlayVideo
                      videoUrl={p.youtube_url}
                      thumbnailUrl={p.thumbnail_url}
                      name={p.name}
                      fallback={<Sparkles className="h-10 w-10 text-[#FFB300]/60" />}
                    />
                    {/* Edit/Delete — visible on hover */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(p); }} className="p-1.5 rounded-[7px] bg-black/60 hover:bg-zinc-700 text-white"><Pencil className="h-3 w-3" /></button>
                      <button onClick={(e) => handleDelete(p.id, e)} className="p-1.5 rounded-[7px] bg-black/60 hover:bg-red-900 text-white hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </div>
                  {/* Info */}
                  <div className="p-3">
                    <h3 className="text-sm font-medium text-zinc-200 truncate">{p.name}</h3>
                    <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-400 border border-emerald-800">กำหนดเอง</span>
                  </div>
                  {/* Use Prompt button */}
                  <div className="px-3 pb-3 mt-auto">
                    <button
                      onClick={() => navigate(`/app/viral-templates/custom?cp=${p.id}`)}
                      className="w-full py-1.5 rounded-md bg-[#FFB300] text-black text-xs font-semibold hover:bg-[#FFC233] transition-colors flex items-center justify-center gap-1"
                    >
                      ใช้ Prompt <ArrowLeft className="h-3 w-3 rotate-180" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
              <Sparkles className="h-10 w-10 mb-4 text-zinc-700" />
              <p className="text-sm font-medium mb-1">ยังไม่มี Custom Prompt</p>
              <p className="text-xs">กดปุ่ม เพิ่ม Prompt เพื่อสร้าง Prompt ของคุณ</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
