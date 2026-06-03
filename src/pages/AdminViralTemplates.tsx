import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import {
  ArrowLeft, Plus, Pencil, Trash2, Save, X, Loader2, Eye, EyeOff, Lock, Unlock
} from 'lucide-react';
import { toast } from 'sonner';
import type { ViralTemplateAdmin, TemplateVariable, FieldConfig } from '@/types/viralTemplate';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function youtubeUrlToEmbed(url: string): string {
  if (!url) return '';
  if (url.includes('/embed/')) return url;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))([^&?/]+)/);
  if (match) {
    const videoId = match[1];
    return `https://www.youtube.com/embed/${videoId}?modestbranding=1&rel=0&controls=0&loop=1&autoplay=1&mute=1&playlist=${videoId}&disablekb=1&fs=0&iv_load_policy=3`;
  }
  return url;
}

const emptyVariable: TemplateVariable = {
  key: '', label: '', placeholder: '', description: '', enabled: true, per_scene: false,
};

const emptyTemplate: Partial<ViralTemplateAdmin> = {
  slug: '', name: '', description: '', thumbnail_url: '', preview_video_url: '',
  input_mode: 'single', input_label: '', input_placeholder: '',
  system_prompt: '', display_order: 0, is_active: true, yearly_only: false,
  reference_image_config: null,
  template_variables: [], fixed_scenes: null, scene_descriptions: [],
  field_config: { show_channel: true, show_language: true, show_scenes: true, show_videos: true },
};

const AdminViralTemplates = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [templates, setTemplates] = useState<ViralTemplateAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<ViralTemplateAdmin> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [youtubeInput, setYoutubeInput] = useState('');
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [fixedScenesEnabled, setFixedScenesEnabled] = useState(false);
  const [fixedScenesCount, setFixedScenesCount] = useState(3);
  const [sceneDescs, setSceneDescs] = useState<string[]>([]);
  const [fieldConfig, setFieldConfig] = useState<FieldConfig>({ show_channel: true, show_language: true, show_scenes: true, show_videos: true });

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const data = await api.getViralTemplatesAdmin();
      setTemplates(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTemplates(); }, []);

  const defaultFieldConfig: FieldConfig = { show_channel: true, show_language: true, show_scenes: true, show_videos: true };

  const handleNew = () => {
    setEditing({ ...emptyTemplate });
    setIsNew(true);
    setYoutubeInput('');
    setVariables([]);
    setFixedScenesEnabled(false);
    setFixedScenesCount(3);
    setSceneDescs([]);
    setFieldConfig({ ...defaultFieldConfig });
  };

  const handleEdit = (t: ViralTemplateAdmin) => {
    setEditing({ ...t });
    setIsNew(false);
    setYoutubeInput(t.preview_video_url || '');
    setVariables(t.template_variables || []);
    setFixedScenesEnabled(t.fixed_scenes != null);
    setFixedScenesCount(t.fixed_scenes || 3);
    setSceneDescs(t.scene_descriptions || []);
    setFieldConfig(t.field_config || { ...defaultFieldConfig });
  };

  const handleCancel = () => {
    setEditing(null);
    setIsNew(false);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name || !editing.system_prompt) {
      toast.error('ชื่อ และ System Prompt จำเป็นต้องกรอก');
      return;
    }

    const slug = editing.slug || slugify(editing.name);
    const payload = {
      ...editing,
      slug,
      preview_video_url: youtubeUrlToEmbed(youtubeInput),
      template_variables: variables,
      fixed_scenes: fixedScenesEnabled ? fixedScenesCount : null,
      scene_descriptions: sceneDescs.filter(Boolean),
      field_config: fieldConfig,
    };

    try {
      setSaving(true);
      if (isNew) {
        await api.createViralTemplate(payload);
        toast.success('สร้าง Template สำเร็จ');
      } else {
        const originalSlug = templates.find(t => t.id === editing.id)?.slug;
        await api.updateViralTemplate(originalSlug || slug, payload);
        toast.success('อัพเดท Template สำเร็จ');
      }
      setEditing(null);
      setIsNew(false);
      await fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (slug: string) => {
    if (!confirm('ลบ Template นี้จริงๆ หรือ?')) return;
    try {
      await api.deleteViralTemplate(slug);
      toast.success('ลบ Template สำเร็จ');
      await fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || 'ลบไม่สำเร็จ');
    }
  };

  // Variable helpers
  const addVariable = () => setVariables(prev => [...prev, { ...emptyVariable }]);
  const removeVariable = (idx: number) => setVariables(prev => prev.filter((_, i) => i !== idx));
  const updateVariable = (idx: number, field: keyof TemplateVariable, value: any) => {
    setVariables(prev => prev.map((v, i) => i === idx ? { ...v, [field]: value } : v));
  };

  // Scene description helpers
  const updateSceneDescs = (count: number) => {
    setFixedScenesCount(count);
    setSceneDescs(prev => {
      const newDescs = [...prev];
      while (newDescs.length < count) newDescs.push('');
      return newDescs.slice(0, count);
    });
  };

  if (!user?.isAdmin) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
        <p>Admin access required</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/app/viral-templates')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> กลับ
            </Button>
            <h1 className="text-2xl font-bold">Viral Template Manager</h1>
          </div>
          {!editing && (
            <div className="flex gap-2">
              <Button onClick={handleNew} className="bg-yellow-600 hover:bg-yellow-700">
                <Plus className="w-4 h-4 mr-1" /> สร้าง Template ใหม่
              </Button>
              <Button onClick={() => navigate('/admin/viral-templates/ling/new')} className="bg-green-600 hover:bg-green-700">
                <Plus className="w-4 h-4 mr-1" /> สร้าง Template ลิง
              </Button>
            </div>
          )}
        </div>

        {/* ==================== EDIT FORM ==================== */}
        {editing && (
          <div className="space-y-4 mb-6">

            {/* ── Section 1: ข้อมูลพื้นฐาน ── */}
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-5 space-y-3">
                <h3 className="text-sm font-bold text-yellow-400 uppercase tracking-wide">ข้อมูลพื้นฐาน</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300 text-xs">ชื่อ Template *</Label>
                    <Input className="bg-gray-800 border-gray-700 text-white mt-1"
                      value={editing.name || ''}
                      onChange={e => {
                        const name = e.target.value;
                        setEditing(prev => ({ ...prev, name, slug: isNew ? slugify(name) : prev?.slug }));
                      }}
                      placeholder="เช่น Anatomy Care AI"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 text-xs">Slug (URL)</Label>
                    <Input className="bg-gray-800 border-gray-700 text-white mt-1"
                      value={editing.slug || ''}
                      onChange={e => setEditing(prev => ({ ...prev, slug: e.target.value }))}
                      placeholder="auto-generated"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-gray-300 text-xs">คำอธิบาย</Label>
                  <Input className="bg-gray-800 border-gray-700 text-white mt-1"
                    value={editing.description || ''}
                    onChange={e => setEditing(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="อธิบายสั้นๆ ว่า Template นี้ทำอะไร"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300 text-xs">YouTube Link</Label>
                    <Input className="bg-gray-800 border-gray-700 text-white mt-1"
                      value={youtubeInput}
                      onChange={e => setYoutubeInput(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 text-xs">Thumbnail URL</Label>
                    <Input className="bg-gray-800 border-gray-700 text-white mt-1"
                      value={editing.thumbnail_url || ''}
                      onChange={e => setEditing(prev => ({ ...prev, thumbnail_url: e.target.value }))}
                      placeholder="/viral-templates/my-thumbnail.jpg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-gray-300 text-xs">ลำดับแสดง</Label>
                    <Input type="number" className="bg-gray-800 border-gray-700 text-white mt-1"
                      value={editing.display_order ?? 0}
                      onChange={e => setEditing(prev => ({ ...prev, display_order: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="flex items-end pb-1 gap-2">
                    <Button variant="outline" size="sm"
                      className={editing.is_active ? 'border-green-600 text-green-400' : 'border-gray-600 text-gray-400'}
                      onClick={() => setEditing(prev => ({ ...prev, is_active: !prev?.is_active }))}
                    >
                      {editing.is_active ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
                      {editing.is_active ? 'Active' : 'Inactive'}
                    </Button>
                    <Button variant="outline" size="sm"
                      className={editing.yearly_only ? 'border-yellow-600 text-yellow-400' : 'border-gray-600 text-gray-400'}
                      onClick={() => setEditing(prev => ({ ...prev, yearly_only: !prev?.yearly_only }))}
                    >
                      {editing.yearly_only ? <Lock className="w-4 h-4 mr-1" /> : <Unlock className="w-4 h-4 mr-1" />}
                      {editing.yearly_only ? 'Yearly Only' : 'All Plans'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Section 2: ช่องแสดง + ตัวแปร Input + ฉาก ── */}
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-5 space-y-4">
                <h3 className="text-sm font-bold text-yellow-400 uppercase tracking-wide">การตั้งค่า Input & ฉาก</h3>

                {/* ─ Part A: Job Config Fields (checkbox toggle) ─ */}
                <div className="space-y-2">
                  <p className="text-xs text-gray-400 font-medium">ช่องที่แสดงตอนสร้าง Job:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                      <Checkbox checked={fieldConfig.show_channel}
                        onCheckedChange={c => setFieldConfig(p => ({ ...p, show_channel: !!c }))} />
                      <span className="text-sm text-gray-300">เลือกช่อง (Channel)</span>
                    </label>
                    <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                      <Checkbox checked={fieldConfig.show_language}
                        onCheckedChange={c => setFieldConfig(p => ({ ...p, show_language: !!c }))} />
                      <span className="text-sm text-gray-300">เลือกภาษา (Language)</span>
                    </label>
                    <div className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2">
                      <label className="flex items-center gap-2 cursor-pointer flex-1">
                        <Checkbox checked={fieldConfig.show_scenes}
                          onCheckedChange={c => setFieldConfig(p => ({ ...p, show_scenes: !!c }))} />
                        <span className="text-sm text-gray-300">จำนวนฉากต่อ VDO</span>
                      </label>
                      {!fieldConfig.show_scenes && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[10px] text-yellow-400">ค่าเริ่มต้น:</span>
                          <Input type="number" min={1} max={10}
                            className="bg-gray-800 border-gray-700 text-white w-16 h-7 text-sm"
                            value={fieldConfig.default_scenes ?? 3}
                            onChange={e => setFieldConfig(p => ({ ...p, default_scenes: Math.max(1, Math.min(10, parseInt(e.target.value) || 3)) }))}
                          />
                        </div>
                      )}
                    </div>
                    <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                      <Checkbox checked={fieldConfig.show_videos}
                        onCheckedChange={c => setFieldConfig(p => ({ ...p, show_videos: !!c }))} />
                      <span className="text-sm text-gray-300">จำนวน VDO</span>
                    </label>
                  </div>
                  <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer w-fit">
                    <Checkbox checked={fieldConfig.per_scene_vars ?? false}
                      onCheckedChange={c => setFieldConfig(p => ({ ...p, per_scene_vars: !!c }))} />
                    <span className="text-sm text-gray-300">แยกตัวแปรแต่ละฉาก</span>
                  </label>
                  <label className="flex items-start gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer w-fit">
                    <Checkbox checked={fieldConfig.direct_video_from_ref ?? false}
                      onCheckedChange={c => setFieldConfig(p => ({ ...p, direct_video_from_ref: !!c }))} />
                    <div className="flex flex-col">
                      <span className="text-sm text-gray-300">ใช้รูปแนบเป็น input ตรงๆ (Skip image gen)</span>
                      <span className="text-[10px] text-gray-500">ส่งรูปที่ user แนบต่อฉาก (character_image_N) เข้า Grok เลย ไม่ต้องสร้างภาพใหม่</span>
                    </div>
                  </label>
                  <div className="space-y-1">
                    <span className="text-xs text-gray-400">รูปอ้างอิง (Reference Images) — เลือกเปิดเฉพาะที่ต้องการ</span>
                    <div className="flex flex-wrap gap-3">
                      <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                        <Checkbox checked={editing?.reference_image_config?.character ?? false}
                          onCheckedChange={c => setEditing(prev => prev ? { ...prev, reference_image_config: { ...prev.reference_image_config, character: !!c } } : prev)} />
                        <span className="text-sm text-gray-300">ตัวละคร</span>
                      </label>
                      <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                        <Checkbox checked={editing?.reference_image_config?.outfit ?? false}
                          onCheckedChange={c => setEditing(prev => prev ? { ...prev, reference_image_config: { ...prev.reference_image_config, outfit: !!c } } : prev)} />
                        <span className="text-sm text-gray-300">ชุด</span>
                      </label>
                      <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                        <Checkbox checked={editing?.reference_image_config?.background ?? false}
                          onCheckedChange={c => setEditing(prev => prev ? { ...prev, reference_image_config: { ...prev.reference_image_config, background: !!c } } : prev)} />
                        <span className="text-sm text-gray-300">แบ็คกราวด์</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* ─ Part B: Fixed Scenes (ล็อคฉาก) ─ */}
                <div className="border-t border-gray-800 pt-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={fixedScenesEnabled}
                      onCheckedChange={checked => {
                        setFixedScenesEnabled(!!checked);
                        if (checked) {
                          updateSceneDescs(fixedScenesCount);
                          setFieldConfig(p => ({ ...p, show_scenes: false }));
                        }
                      }}
                    />
                    <span className="text-sm text-gray-300">ล็อคจำนวนฉาก</span>
                    {fixedScenesEnabled && (
                      <Input type="number" min={1} max={10}
                        className="bg-gray-800 border-gray-700 text-white w-20 h-8 text-sm"
                        value={fixedScenesCount}
                        onChange={e => updateSceneDescs(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                      />
                    )}
                  </div>

                  {fixedScenesEnabled && (
                    <div className="space-y-1.5 ml-7">
                      <Label className="text-gray-400 text-[10px]">คำอธิบายฉาก (optional)</Label>
                      {Array.from({ length: fixedScenesCount }).map((_, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-12 flex-shrink-0">ฉาก {i + 1}:</span>
                          <Input className="bg-gray-800 border-gray-700 text-white h-8 text-sm"
                            value={sceneDescs[i] || ''}
                            onChange={e => {
                              const updated = [...sceneDescs];
                              updated[i] = e.target.value;
                              setSceneDescs(updated);
                            }}
                            placeholder={`คำอธิบายฉากที่ ${i + 1}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ─ Part C: Template Variables (ตัวแปร Task) ─ */}
                <div className="border-t border-gray-800 pt-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-400 font-medium">ตัวแปรที่ User กรอกใน Task Card:</p>
                    <Button variant="outline" size="sm" onClick={addVariable}>
                      <Plus className="w-3 h-3 mr-1" /> เพิ่มตัวแปร
                    </Button>
                  </div>

                  {variables.length === 0 ? (
                    <p className="text-xs text-gray-500">ยังไม่มีตัวแปร — กด "เพิ่มตัวแปร" เพื่อกำหนดช่องที่ user ต้องกรอก</p>
                  ) : (
                    <div className="space-y-2">
                      {variables.map((v, idx) => (
                        <div key={idx} className={`border rounded-lg px-3 py-2.5 space-y-2 ${v.enabled ? 'border-gray-700 bg-gray-800/50' : 'border-gray-800 bg-gray-900/50 opacity-60'}`}>
                          <div className="flex items-center gap-3">
                            <Checkbox checked={v.enabled}
                              onCheckedChange={checked => updateVariable(idx, 'enabled', !!checked)} />
                            <Input className="bg-gray-800 border-gray-700 text-white h-8 text-sm flex-1"
                              value={v.label}
                              onChange={e => {
                                updateVariable(idx, 'label', e.target.value);
                                updateVariable(idx, 'key', slugify(e.target.value) || `var_${idx}`);
                              }}
                              placeholder="ชื่อตัวแปร เช่น Anatomy, Condition"
                            />
                            <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 h-7 w-7 p-0 flex-shrink-0"
                              onClick={() => removeVariable(idx)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          <Input className="bg-gray-800/50 border-gray-700 text-gray-300 h-8 text-xs ml-8"
                            value={v.description}
                            onChange={e => updateVariable(idx, 'description', e.target.value)}
                            placeholder="คำอธิบาย เช่น The specific body part (e.g., Groin, Elbow, Back)"
                          />
                          <Input className="bg-gray-800/50 border-gray-700 text-gray-300 h-8 text-xs ml-8"
                            value={v.placeholder || ''}
                            onChange={e => updateVariable(idx, 'placeholder', e.target.value)}
                            placeholder="ตัวอย่างค่า เช่น ต้มจืดเต้าหู้หมูสับ, แกงเขียวหวาน"
                          />
                          <div className="ml-8 flex items-center gap-2">
                            <Label className="text-[10px] text-gray-500 whitespace-nowrap">จำกัดตัวอักษร (optional)</Label>
                            <Input type="number" min={0}
                              className="bg-gray-800/50 border-gray-700 text-gray-300 h-7 text-xs w-24"
                              value={v.max_length ?? ''}
                              onChange={e => updateVariable(idx, 'max_length', e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value) || 0))}
                              placeholder="เช่น 180"
                            />
                            <span className="text-[10px] text-gray-600">ปล่อยว่าง = ไม่จำกัด</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ── Section 4: System Prompt ── */}
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-5 space-y-3">
                <h3 className="text-sm font-bold text-yellow-400 uppercase tracking-wide">System Prompt *</h3>
                <Textarea
                  className="bg-gray-800 border-gray-700 text-white font-mono text-sm"
                  rows={16}
                  value={editing.system_prompt || ''}
                  onChange={e => setEditing(prev => ({ ...prev, system_prompt: e.target.value }))}
                  placeholder="System prompt สำหรับ AI สร้าง scene prompts..."
                />
                <p className="text-xs text-gray-500">
                  Prompt นี้จะถูกส่งให้ AI เพื่อสร้าง image/video prompts — ต้องลงท้ายด้วย JSON response format
                </p>
              </CardContent>
            </Card>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="bg-yellow-600 hover:bg-yellow-700">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                {isNew ? 'สร้าง' : 'บันทึก'}
              </Button>
              <Button variant="ghost" onClick={handleCancel}>
                <X className="w-4 h-4 mr-1" /> ยกเลิก
              </Button>
            </div>
          </div>
        )}

        {/* ==================== TEMPLATE LIST ==================== */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            ยังไม่มี Template — กดปุ่ม "สร้าง Template ใหม่" เพื่อเริ่มต้น
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map(t => (
              <Card key={t.id} className={`bg-gray-900 border-gray-800 ${!t.is_active ? 'opacity-50' : ''}`}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    {t.thumbnail_url && (
                      <img src={t.thumbnail_url} alt={t.name}
                        className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                        onError={e => (e.currentTarget.style.display = 'none')}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-white truncate">{t.name}</h3>
                        <Badge variant={t.is_active ? 'default' : 'secondary'} className="text-xs">
                          {t.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        {t.yearly_only && (
                          <Badge className="text-xs bg-yellow-900 text-yellow-300">
                            <Lock className="w-3 h-3 mr-1" /> Yearly Only
                          </Badge>
                        )}
                        {(t.template_variables?.length ?? 0) > 0 ? (
                          <Badge variant="outline" className="text-xs">
                            {t.template_variables!.filter(v => v.enabled).length} ตัวแปร
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {t.input_mode === 'multi' ? 'Multi' : 'Single'}
                          </Badge>
                        )}
                        {t.fixed_scenes && (
                          <Badge variant="outline" className="text-xs text-blue-400 border-blue-800">
                            {t.fixed_scenes} ฉาก (ล็อค)
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 truncate">{t.description}</p>
                      <p className="text-xs text-gray-600 font-mono">slug: {t.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(t)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => handleDelete(t.slug)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminViralTemplates;
