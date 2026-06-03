// AdminLingTemplateNew — separate admin form for creating "ลิง-style" templates.
// Clones every section of AdminViralTemplates and adds a "รูปอ้างอิงต่อฉาก" section that
// configures field_config.preset_scene_refs (character/outfit/background, one URL per scene)
// plus the auto_apply_character toggle. Saves to the same viral_templates table via the
// existing /api/viral-templates/admin endpoint — does not touch any existing template logic.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import {
  ArrowLeft, Plus, Trash2, Save, X, Loader2, Eye, EyeOff, Lock, Unlock, Upload,
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
  key: '', label: '', placeholder: '', description: '', enabled: true, per_scene: true,
};

// Pre-tuned defaults for "ลิง-style" templates: per-scene variables on, channel only,
// scenes locked at 3, character ref enabled. Admin can still adjust everything.
const lingDefaultFieldConfig: FieldConfig = {
  show_channel: true,
  show_language: false,
  show_scenes: false,
  show_videos: true,
  per_scene_vars: true,
  direct_video_from_ref: false,
  auto_apply_character: true,
  preset_scene_refs: { character: [], outfit: [], background: [] },
};

const emptyTemplate: Partial<ViralTemplateAdmin> = {
  slug: '', name: '', description: '', thumbnail_url: '', preview_video_url: '',
  input_mode: 'multi', input_label: '', input_placeholder: '',
  system_prompt: '', display_order: 0, is_active: true, yearly_only: false,
  reference_image_config: { character: true },
  template_variables: [], fixed_scenes: 3, scene_descriptions: ['', '', ''],
  field_config: lingDefaultFieldConfig,
};

type RefKind = 'character' | 'outfit' | 'background';
const REF_KINDS: { key: RefKind; label: string }[] = [
  { key: 'character', label: 'ตัวละคร' },
  { key: 'outfit', label: 'ชุด' },
  { key: 'background', label: 'แบ็คกราวด์' },
];

const AdminLingTemplateNew = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [editing, setEditing] = useState<Partial<ViralTemplateAdmin>>({ ...emptyTemplate });
  const [saving, setSaving] = useState(false);
  const [youtubeInput, setYoutubeInput] = useState('');
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [fixedScenesCount, setFixedScenesCount] = useState(3);
  const [sceneDescs, setSceneDescs] = useState<string[]>(['', '', '']);
  const [fieldConfig, setFieldConfig] = useState<FieldConfig>({ ...lingDefaultFieldConfig });
  // Per-scene per-kind preset ref URLs. Keyed by scene index, each entry is one URL string.
  const [presetRefs, setPresetRefs] = useState<{ character: string[]; outfit: string[]; background: string[] }>(
    { character: ['', '', ''], outfit: ['', '', ''], background: ['', '', ''] }
  );
  const [uploadingKey, setUploadingKey] = useState<string | null>(null); // e.g. "character-0"

  // Sync preset_refs length whenever fixedScenesCount changes — pad with empty strings or trim
  useEffect(() => {
    setPresetRefs(prev => {
      const next = { ...prev };
      for (const k of REF_KINDS) {
        const arr = [...(next[k.key] || [])];
        while (arr.length < fixedScenesCount) arr.push('');
        next[k.key] = arr.slice(0, fixedScenesCount);
      }
      return next;
    });
    setSceneDescs(prev => {
      const arr = [...prev];
      while (arr.length < fixedScenesCount) arr.push('');
      return arr.slice(0, fixedScenesCount);
    });
  }, [fixedScenesCount]);

  const addVariable = () => setVariables(prev => [...prev, { ...emptyVariable }]);
  const removeVariable = (idx: number) => setVariables(prev => prev.filter((_, i) => i !== idx));
  const updateVariable = (idx: number, field: keyof TemplateVariable, value: any) => {
    setVariables(prev => prev.map((v, i) => i === idx ? { ...v, [field]: value } : v));
  };

  const updateRefUrl = (kind: RefKind, sceneIdx: number, value: string) => {
    setPresetRefs(prev => ({
      ...prev,
      [kind]: prev[kind].map((u, i) => i === sceneIdx ? value : u),
    }));
  };

  const handleUpload = async (kind: RefKind, sceneIdx: number, file: File) => {
    const key = `${kind}-${sceneIdx}`;
    try {
      setUploadingKey(key);
      const result = await api.uploadViralTemplateSceneRef(file);
      updateRefUrl(kind, sceneIdx, result.url);
      toast.success(`อัพโหลดสำเร็จ: ${kind} ฉาก ${sceneIdx + 1}`);
    } catch (err: any) {
      toast.error(err.message || 'อัพโหลดไม่สำเร็จ');
    } finally {
      setUploadingKey(null);
    }
  };

  const handleSave = async () => {
    if (!editing.name || !editing.system_prompt) {
      toast.error('ชื่อ และ System Prompt จำเป็นต้องกรอก');
      return;
    }

    const slug = editing.slug || slugify(editing.name);

    // Drop empty arrays from preset_scene_refs so we don't send junk { character: ["","",""] }.
    // Only keep kinds that have at least one non-empty URL.
    const cleanedPresets: Record<string, string[]> = {};
    for (const k of REF_KINDS) {
      if (presetRefs[k.key].some(u => u.trim() !== '')) {
        cleanedPresets[k.key] = presetRefs[k.key];
      }
    }

    const payload = {
      ...editing,
      slug,
      preview_video_url: youtubeUrlToEmbed(youtubeInput),
      template_variables: variables,
      fixed_scenes: fixedScenesCount,
      scene_descriptions: sceneDescs.filter((_, i) => i < fixedScenesCount),
      field_config: {
        ...fieldConfig,
        preset_scene_refs: Object.keys(cleanedPresets).length > 0 ? cleanedPresets : undefined,
      },
    };

    try {
      setSaving(true);
      await api.createViralTemplate(payload);
      toast.success('สร้าง Template ลิง สำเร็จ');
      navigate('/admin/viral-templates');
    } catch (err: any) {
      toast.error(err.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
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
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin/viral-templates')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> กลับ
            </Button>
            <h1 className="text-2xl font-bold">สร้าง Template ลิง ใหม่</h1>
          </div>
        </div>

        <div className="space-y-4 mb-6">

          {/* ── Section 1: ข้อมูลพื้นฐาน ── */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5 space-y-3">
              <h3 className="text-sm font-bold text-green-400 uppercase tracking-wide">ข้อมูลพื้นฐาน</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-300 text-xs">ชื่อ Template *</Label>
                  <Input className="bg-gray-800 border-gray-700 text-white mt-1"
                    value={editing.name || ''}
                    onChange={e => {
                      const name = e.target.value;
                      setEditing(prev => ({ ...prev, name, slug: slugify(name) }));
                    }}
                    placeholder="เช่น ลิงขายน้ำแข็ง"
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
                    onClick={() => setEditing(prev => ({ ...prev, is_active: !prev.is_active }))}
                  >
                    {editing.is_active ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
                    {editing.is_active ? 'Active' : 'Inactive'}
                  </Button>
                  <Button variant="outline" size="sm"
                    className={editing.yearly_only ? 'border-yellow-600 text-yellow-400' : 'border-gray-600 text-gray-400'}
                    onClick={() => setEditing(prev => ({ ...prev, yearly_only: !prev.yearly_only }))}
                  >
                    {editing.yearly_only ? <Lock className="w-4 h-4 mr-1" /> : <Unlock className="w-4 h-4 mr-1" />}
                    {editing.yearly_only ? 'Yearly Only' : 'All Plans'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Section 2: Input & ฉาก ── */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5 space-y-4">
              <h3 className="text-sm font-bold text-green-400 uppercase tracking-wide">การตั้งค่า Input & ฉาก</h3>

              {/* Job Config Field toggles */}
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
                  <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                    <Checkbox checked={fieldConfig.show_scenes}
                      onCheckedChange={c => setFieldConfig(p => ({ ...p, show_scenes: !!c }))} />
                    <span className="text-sm text-gray-300">จำนวนฉากต่อ VDO</span>
                  </label>
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
                    <span className="text-[10px] text-gray-500">ส่งรูปที่ user แนบต่อฉากเข้า Grok เลย ไม่สร้างภาพใหม่</span>
                  </div>
                </label>
                <label className="flex items-start gap-2 bg-green-900/20 border border-green-900/50 rounded-md px-3 py-2 cursor-pointer w-fit">
                  <Checkbox checked={fieldConfig.auto_apply_character ?? false}
                    onCheckedChange={c => setFieldConfig(p => ({ ...p, auto_apply_character: !!c }))} />
                  <div className="flex flex-col">
                    <span className="text-sm text-gray-300">เลือกตัวละครครั้งเดียว apply ทุกฉาก</span>
                    <span className="text-[10px] text-gray-500">ลิง-style: user เลือกรูปตัวละครแค่ครั้งเดียว ระบบใช้ทุกฉากให้</span>
                  </div>
                </label>

                <div className="space-y-1">
                  <span className="text-xs text-gray-400">รูปอ้างอิง (Reference Images) — เลือกเปิดเฉพาะที่ต้องการ</span>
                  <div className="flex flex-wrap gap-3">
                    {REF_KINDS.map(k => (
                      <label key={k.key} className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                        <Checkbox
                          checked={(editing.reference_image_config as any)?.[k.key] ?? false}
                          onCheckedChange={c => setEditing(prev => ({
                            ...prev,
                            reference_image_config: { ...prev.reference_image_config, [k.key]: !!c },
                          }))}
                        />
                        <span className="text-sm text-gray-300">{k.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Fixed Scenes (always on for ลิง-style) */}
              <div className="border-t border-gray-800 pt-3 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-300">จำนวนฉาก (ล็อค):</span>
                  <Input type="number" min={1} max={10}
                    className="bg-gray-800 border-gray-700 text-white w-20 h-8 text-sm"
                    value={fixedScenesCount}
                    onChange={e => setFixedScenesCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  />
                </div>

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
              </div>

              {/* Template Variables */}
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
                            placeholder="ชื่อตัวแปร เช่น คำพูด"
                          />
                          <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 h-7 w-7 p-0 flex-shrink-0"
                            onClick={() => removeVariable(idx)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <Input className="bg-gray-800/50 border-gray-700 text-gray-300 h-8 text-xs ml-8"
                          value={v.description}
                          onChange={e => updateVariable(idx, 'description', e.target.value)}
                          placeholder="คำอธิบาย เช่น คำพูดของลิง (lip sync)"
                        />
                        <Input className="bg-gray-800/50 border-gray-700 text-gray-300 h-8 text-xs ml-8"
                          value={v.placeholder || ''}
                          onChange={e => updateVariable(idx, 'placeholder', e.target.value)}
                          placeholder="ตัวอย่างค่า"
                        />
                        <div className="ml-8 flex items-center gap-3">
                          <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer">
                            <Checkbox checked={v.per_scene}
                              onCheckedChange={checked => updateVariable(idx, 'per_scene', !!checked)} />
                            แยกค่าต่อฉาก (per_scene)
                          </label>
                          <Label className="text-[10px] text-gray-500 whitespace-nowrap">จำกัดตัวอักษร</Label>
                          <Input type="number" min={0}
                            className="bg-gray-800/50 border-gray-700 text-gray-300 h-7 text-xs w-24"
                            value={v.max_length ?? ''}
                            onChange={e => updateVariable(idx, 'max_length', e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value) || 0))}
                            placeholder="เช่น 180"
                          />
                          <span className="text-[10px] text-gray-600">ปล่อยว่าง = ไม่จำกัด</span>
                        </div>

                        {/* default_value — pre-filled text user sees in the task card before editing.
                            Per-scene: array indexed by scene. Else: single string. */}
                        {v.per_scene ? (
                          <div className="ml-8 space-y-1">
                            <Label className="text-[10px] text-green-400">คำพูดตั้งต้น (default_value) ต่อฉาก — pre-fill ให้ user</Label>
                            {Array.from({ length: fixedScenesCount }).map((_, sceneIdx) => {
                              const arr = Array.isArray(v.default_value) ? v.default_value : [];
                              return (
                                <div key={sceneIdx} className="flex items-start gap-2">
                                  <span className="text-[10px] text-gray-500 w-12 flex-shrink-0 mt-2">ฉาก {sceneIdx + 1}:</span>
                                  <Textarea
                                    className="bg-gray-800/50 border-gray-700 text-gray-300 text-xs flex-1 min-h-[60px]"
                                    value={arr[sceneIdx] || ''}
                                    onChange={e => {
                                      const next = [...arr];
                                      while (next.length < fixedScenesCount) next.push('');
                                      next[sceneIdx] = e.target.value;
                                      updateVariable(idx, 'default_value', next.slice(0, fixedScenesCount));
                                    }}
                                    placeholder={`ค่าตั้งต้นของฉาก ${sceneIdx + 1} (ปล่อยว่างได้)`}
                                    maxLength={v.max_length || undefined}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="ml-8 space-y-1">
                            <Label className="text-[10px] text-green-400">ค่าตั้งต้น (default_value) — pre-fill ให้ user</Label>
                            <Input
                              className="bg-gray-800/50 border-gray-700 text-gray-300 h-8 text-xs"
                              value={typeof v.default_value === 'string' ? v.default_value : ''}
                              onChange={e => updateVariable(idx, 'default_value', e.target.value)}
                              placeholder="ค่าตั้งต้น (ปล่อยว่างได้)"
                              maxLength={v.max_length || undefined}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Section 3: Preset Scene Refs (ลิง-specific) ── */}
          <Card className="bg-green-900/10 border-green-900/40">
            <CardContent className="p-5 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-green-400 uppercase tracking-wide">รูปอ้างอิงต่อฉาก (Preset Scene Refs)</h3>
                <p className="text-xs text-gray-500 mt-1">
                  รูปที่จะ pre-fill ให้ user อัตโนมัติแต่ละฉาก — กรอก URL หรือ Upload ไฟล์ก็ได้
                  (เปิดเฉพาะชนิดที่ต้องการใช้ในแถบ Reference Images ด้านบน)
                </p>
              </div>

              {REF_KINDS.map(k => {
                const enabled = (editing.reference_image_config as any)?.[k.key];
                if (!enabled) return null;
                return (
                  <div key={k.key} className="space-y-2 border-t border-green-900/30 pt-3 first:border-t-0 first:pt-0">
                    <p className="text-xs font-semibold text-green-300">{k.label}</p>
                    {Array.from({ length: fixedScenesCount }).map((_, sceneIdx) => {
                      const url = presetRefs[k.key][sceneIdx] || '';
                      const uploadKey = `${k.key}-${sceneIdx}`;
                      const isUploading = uploadingKey === uploadKey;
                      return (
                        <div key={sceneIdx} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-12 flex-shrink-0">ฉาก {sceneIdx + 1}:</span>
                          <Input
                            className="bg-gray-800 border-gray-700 text-white h-8 text-sm flex-1"
                            value={url}
                            onChange={e => updateRefUrl(k.key, sceneIdx, e.target.value)}
                            placeholder="https://... (URL หรือกด Upload)"
                          />
                          <label className="flex-shrink-0">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={isUploading}
                              onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) handleUpload(k.key, sceneIdx, f);
                                e.target.value = ''; // allow re-upload of same filename
                              }}
                            />
                            <Button asChild variant="outline" size="sm" className="h-8 px-2 cursor-pointer">
                              <span>
                                {isUploading
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <Upload className="w-3.5 h-3.5" />}
                              </span>
                            </Button>
                          </label>
                          {url && (
                            <img src={url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0"
                              onError={e => (e.currentTarget.style.display = 'none')} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {!REF_KINDS.some(k => (editing.reference_image_config as any)?.[k.key]) && (
                <p className="text-xs text-gray-500 italic">
                  ยังไม่ได้เปิดชนิดรูปอ้างอิงใดๆ — เปิดที่แถบ "รูปอ้างอิง (Reference Images)" ด้านบนก่อน
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Section 4: System Prompt ── */}
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5 space-y-3">
              <h3 className="text-sm font-bold text-green-400 uppercase tracking-wide">System Prompt *</h3>
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
            <Button onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              สร้าง Template ลิง
            </Button>
            <Button variant="ghost" onClick={() => navigate('/admin/viral-templates')}>
              <X className="w-4 h-4 mr-1" /> ยกเลิก
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminLingTemplateNew;
