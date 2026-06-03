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
  ArrowLeft, Plus, Pencil, Trash2, Save, X, Loader2, Eye, EyeOff, Lock, Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import type { StoryTemplateAdmin, StoryTemplateVariable, StoryFieldConfig } from '@/types/storyTemplate';

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

const emptyVariable: StoryTemplateVariable = {
  key: '', label: '', placeholder: '', description: '', enabled: true, per_scene: false,
};

const defaultFieldConfig: StoryFieldConfig = { show_channel: true, show_scenes: true, show_videos: true };

const emptyTemplate: Partial<StoryTemplateAdmin> = {
  slug: '', name: '', description: '', thumbnail_url: '', preview_video_url: '',
  system_prompt: '',
  display_order: 0, is_active: true, yearly_only: false, gender: null,
  template_variables: [], fixed_scenes: null, scene_descriptions: [],
  field_config: { ...defaultFieldConfig },
};

const AdminStoryTemplates = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [templates, setTemplates] = useState<StoryTemplateAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<StoryTemplateAdmin> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [youtubeInput, setYoutubeInput] = useState('');
  const [variables, setVariables] = useState<StoryTemplateVariable[]>([]);
  const [fixedScenesEnabled, setFixedScenesEnabled] = useState(false);
  const [fixedScenesCount, setFixedScenesCount] = useState(3);
  const [sceneDescs, setSceneDescs] = useState<string[]>([]);
  const [fieldConfig, setFieldConfig] = useState<StoryFieldConfig>({ ...defaultFieldConfig });

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const data = (await api.getStoryTemplatesAdmin()) as StoryTemplateAdmin[];
      setTemplates(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTemplates(); }, []);

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

  const handleEdit = (t: StoryTemplateAdmin) => {
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
        await api.createStoryTemplate(payload);
        toast.success('สร้าง Template สำเร็จ');
      } else {
        const originalSlug = templates.find((t) => t.id === editing.id)?.slug;
        await api.updateStoryTemplate(originalSlug || slug, payload);
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
      await api.deleteStoryTemplate(slug);
      toast.success('ลบ Template สำเร็จ');
      await fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || 'ลบไม่สำเร็จ');
    }
  };

  const addVariable = () => setVariables((prev) => [...prev, { ...emptyVariable }]);
  const removeVariable = (idx: number) => setVariables((prev) => prev.filter((_, i) => i !== idx));
  const updateVariable = (idx: number, field: keyof StoryTemplateVariable, value: any) => {
    setVariables((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v)));
  };

  const updateSceneDescs = (count: number) => {
    setFixedScenesCount(count);
    setSceneDescs((prev) => {
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
            <Button variant="ghost" size="sm" onClick={() => navigate('/app/story-templates')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> กลับ
            </Button>
            <h1 className="text-2xl font-bold">Story Template Manager</h1>
          </div>
          {!editing && (
            <Button onClick={handleNew} className="bg-yellow-600 hover:bg-yellow-700">
              <Plus className="w-4 h-4 mr-1" /> สร้าง Template ใหม่
            </Button>
          )}
        </div>

        {editing && (
          <div className="space-y-4 mb-6">
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-5 space-y-3">
                <h3 className="text-sm font-bold text-yellow-400 uppercase tracking-wide">ข้อมูลพื้นฐาน</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300 text-xs">ชื่อ Template *</Label>
                    <Input
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                      value={editing.name || ''}
                      onChange={(e) => {
                        const name = e.target.value;
                        setEditing((prev) => ({ ...prev, name, slug: isNew ? slugify(name) : prev?.slug }));
                      }}
                      placeholder="เช่น Beach Story"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 text-xs">Slug (URL)</Label>
                    <Input
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                      value={editing.slug || ''}
                      onChange={(e) => setEditing((prev) => ({ ...prev, slug: e.target.value }))}
                      placeholder="auto-generated"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-gray-300 text-xs">คำอธิบาย</Label>
                  <Input
                    className="bg-gray-800 border-gray-700 text-white mt-1"
                    value={editing.description || ''}
                    onChange={(e) => setEditing((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="อธิบายสั้นๆ ว่า Template นี้ทำอะไร"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300 text-xs">YouTube Link</Label>
                    <Input
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                      value={youtubeInput}
                      onChange={(e) => setYoutubeInput(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 text-xs">Thumbnail URL</Label>
                    <Input
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                      value={editing.thumbnail_url || ''}
                      onChange={(e) => setEditing((prev) => ({ ...prev, thumbnail_url: e.target.value }))}
                      placeholder="/story-templates/my-thumbnail.jpg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-gray-300 text-xs">ลำดับแสดง</Label>
                    <Input
                      type="number"
                      className="bg-gray-800 border-gray-700 text-white mt-1"
                      value={editing.display_order ?? 0}
                      onChange={(e) => setEditing((prev) => ({ ...prev, display_order: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="flex items-end pb-1 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className={editing.is_active ? 'border-green-600 text-green-400' : 'border-gray-600 text-gray-400'}
                      onClick={() => setEditing((prev) => ({ ...prev, is_active: !prev?.is_active }))}
                    >
                      {editing.is_active ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
                      {editing.is_active ? 'Active' : 'Inactive'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={editing.yearly_only ? 'border-yellow-600 text-yellow-400' : 'border-gray-600 text-gray-400'}
                      onClick={() => setEditing((prev) => ({ ...prev, yearly_only: !prev?.yearly_only }))}
                    >
                      {editing.yearly_only ? <Lock className="w-4 h-4 mr-1" /> : <Unlock className="w-4 h-4 mr-1" />}
                      {editing.yearly_only ? 'Yearly Only' : 'All Plans'}
                    </Button>
                  </div>
                  <div className="flex items-end pb-1 gap-1">
                    <Label className="text-gray-300 text-xs mr-1 mb-1">เพศ:</Label>
                    {(
                      [
                        { value: null, label: 'ไม่ระบุ' },
                        { value: 'male', label: 'ชาย' },
                        { value: 'female', label: 'หญิง' },
                      ] as { value: string | null; label: string }[]
                    ).map((opt) => (
                      <Button
                        key={String(opt.value)}
                        variant="outline"
                        size="sm"
                        className={editing.gender === opt.value ? 'border-yellow-600 text-yellow-400' : 'border-gray-600 text-gray-400'}
                        onClick={() => setEditing((prev) => ({ ...prev, gender: opt.value as any }))}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-5 space-y-4">
                <h3 className="text-sm font-bold text-yellow-400 uppercase tracking-wide">การตั้งค่า</h3>

                <div className="space-y-2">
                  <p className="text-xs text-gray-400 font-medium">ช่องที่แสดงตอนสร้าง Job:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                      <Checkbox
                        checked={fieldConfig.show_channel}
                        onCheckedChange={(c) => setFieldConfig((p) => ({ ...p, show_channel: !!c }))}
                      />
                      <span className="text-sm text-gray-300">เลือกช่อง (Channel)</span>
                    </label>
                    <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                      <Checkbox
                        checked={fieldConfig.show_scenes}
                        onCheckedChange={(c) => setFieldConfig((p) => ({ ...p, show_scenes: !!c }))}
                      />
                      <span className="text-sm text-gray-300">จำนวนฉาก</span>
                    </label>
                    <label className="flex items-center gap-2 bg-gray-800/50 rounded-md px-3 py-2 cursor-pointer">
                      <Checkbox
                        checked={fieldConfig.show_videos}
                        onCheckedChange={(c) => setFieldConfig((p) => ({ ...p, show_videos: !!c }))}
                      />
                      <span className="text-sm text-gray-300">จำนวน VDO</span>
                    </label>
                  </div>
                </div>

                <div className="border-t border-gray-800 pt-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={fixedScenesEnabled}
                      onCheckedChange={(c) => setFixedScenesEnabled(!!c)}
                    />
                    <span className="text-sm text-gray-300">ล็อคจำนวนฉาก</span>
                    {fixedScenesEnabled && (
                      <Input
                        type="number"
                        className="bg-gray-800 border-gray-700 text-white w-20"
                        value={fixedScenesCount}
                        min={1}
                        onChange={(e) => updateSceneDescs(parseInt(e.target.value) || 1)}
                      />
                    )}
                  </div>
                  {fixedScenesEnabled && (
                    <div className="space-y-2">
                      {Array.from({ length: fixedScenesCount }).map((_, i) => (
                        <div key={i}>
                          <Label className="text-gray-400 text-xs">ฉาก {i + 1}</Label>
                          <Input
                            className="bg-gray-800 border-gray-700 text-white mt-1"
                            value={sceneDescs[i] || ''}
                            onChange={(e) => {
                              const next = [...sceneDescs];
                              next[i] = e.target.value;
                              setSceneDescs(next);
                            }}
                            placeholder={`คำอธิบายฉาก ${i + 1}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-800 pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-400 font-medium">ตัวแปร Template:</p>
                    <Button size="sm" variant="ghost" onClick={addVariable} className="text-yellow-400">
                      <Plus className="w-3 h-3 mr-1" /> เพิ่มตัวแปร
                    </Button>
                  </div>
                  {variables.length === 0 ? (
                    <p className="text-xs text-gray-600 italic">ยังไม่มีตัวแปร</p>
                  ) : (
                    <div className="space-y-2">
                      {variables.map((v, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-gray-800/40 rounded-md p-2">
                          <Input
                            className="col-span-3 bg-gray-800 border-gray-700 text-white text-xs"
                            value={v.key}
                            onChange={(e) => updateVariable(idx, 'key', e.target.value)}
                            placeholder="key"
                          />
                          <Input
                            className="col-span-3 bg-gray-800 border-gray-700 text-white text-xs"
                            value={v.label}
                            onChange={(e) => updateVariable(idx, 'label', e.target.value)}
                            placeholder="Label"
                          />
                          <Input
                            className="col-span-5 bg-gray-800 border-gray-700 text-white text-xs"
                            value={v.placeholder}
                            onChange={(e) => updateVariable(idx, 'placeholder', e.target.value)}
                            placeholder="Placeholder example"
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="col-span-1 text-red-400 hover:text-red-300"
                            onClick={() => removeVariable(idx)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-800 pt-3 space-y-2">
                  <p className="text-xs text-gray-400 font-medium">
                    Story Template: User เลือกรูป (รูป/รูปชุด/รูปพื้นหลัง/Object) + กรอกค่า → สร้างภาพ → สร้าง VDO → ต่อ VDO เป็น final
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-5 space-y-3">
                <h3 className="text-sm font-bold text-yellow-400 uppercase tracking-wide">System Prompt *</h3>
                <Textarea
                  className="bg-gray-800 border-gray-700 text-white font-mono text-sm"
                  rows={20}
                  value={editing.system_prompt || ''}
                  onChange={(e) => setEditing((prev) => ({ ...prev, system_prompt: e.target.value }))}
                  placeholder={`คำสั่ง AI orchestrator (Multi-step) — เช่น:\n\nคุณคือ AI สำหรับสร้างคอนเทนต์วิดีโอไวรัล...\n\nINPUT จากผู้ใช้: TOPIC, SCENE_COUNT, IMAGE_REFERENCE\n\nกฎสำคัญ:\n- ตัวละครจาก IMAGE_REFERENCE 100%\n- เพศคงที่ทุกฉาก\n- 9:16 แนวตั้ง 15 วินาที\n- บ่นตลก ภาษาพูด\n- ห้ามมีตัวหนังสือในภาพ\n\nSTEP 1: สร้าง 3 OPTIONS ให้เลือก\nSTEP 2: รอผู้ใช้เลือก\nSTEP 3: สร้าง STORYBOARD\nSTEP 4: STORYBOARD GRID\nSTEP 5: สร้างทีละฉาก (image_prompt + video_prompt)\n\n...`}
                />
                <p className="text-xs text-gray-500">
                  System Prompt นี้จะถูกใช้โดย AI orchestrator (เช่น OpenAI / Claude) เพื่อสร้าง image_prompt + video_prompt ต่อฉาก ตามรูปที่ user แนบและตัวแปรที่กรอก
                </p>
              </CardContent>
            </Card>

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
            {templates.map((t) => (
              <Card key={t.id} className={`bg-gray-900 border-gray-800 ${!t.is_active ? 'opacity-50' : ''}`}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    {t.thumbnail_url && (
                      <img
                        src={t.thumbnail_url}
                        alt={t.name}
                        className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                        onError={(e) => (e.currentTarget.style.display = 'none')}
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
                        {(t.template_variables?.length ?? 0) > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {t.template_variables!.filter((v) => v.enabled).length} ตัวแปร
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:text-red-300"
                      onClick={() => handleDelete(t.slug)}
                    >
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

export default AdminStoryTemplates;
