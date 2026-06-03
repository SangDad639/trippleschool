/**
 * SkillEditorModal — markdown editor for creating or editing a user skill.
 *
 * MVP uses a plain textarea with hint text. A real Monaco editor + frontmatter
 * linter is Phase 3 polish.
 */
import { useEffect, useState } from 'react';
import { Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { api, type UserSkillDto } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: UserSkillDto | null;
}

const DEFAULT_TEMPLATE = `---
name: my-new-skill
description: ใส่คำอธิบายสั้นๆ
trigger_keywords: []

scene_count: 10
scene_duration_sec: 6
language: th

stages:
  voice:
    timing_gate_max_sec: 6
  scene_image:
    style: cinematic
    resolution: 1K
  scene_video:
    duration_sec: 6
---

# คำแนะนำการเขียนบท

(เขียน rules / structure ของคลิปสไตล์นี้ ที่นี่)
`;

export function SkillEditorModal({ open, onClose, onSaved, editing }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [contentMd, setContentMd] = useState(DEFAULT_TEMPLATE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setDescription(editing.description || '');
      setContentMd(editing.content_md);
    } else {
      setName('');
      setDescription('');
      setContentMd(DEFAULT_TEMPLATE);
    }
  }, [editing, open]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('ต้องกรอกชื่อ skill');
      return;
    }
    if (!contentMd.trim()) {
      toast.error('ต้องมีเนื้อหา markdown');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.skillsUpdate(editing.id, {
          name: name.trim(),
          description: description.trim() || null,
          content_md: contentMd,
        });
        toast.success(`อัปเดต "${name.trim()}" สำเร็จ`);
      } else {
        await api.skillsCreate({
          name: name.trim(),
          description: description.trim() || null,
          content_md: contentMd,
        });
        toast.success(`สร้าง "${name.trim()}" สำเร็จ`);
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{editing ? `แก้ไข: ${editing.name}` : 'สร้าง Skill ใหม่'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 px-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="skill-name" className="text-xs">ชื่อ</Label>
              <Input
                id="skill-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. มหาพุทธคุณ-style"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="skill-desc" className="text-xs">คำอธิบาย (สั้น)</Label>
              <Input
                id="skill-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="คลิป 90 วินาที Hook 3 ชั้น..."
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="skill-md" className="text-xs">
              Markdown (frontmatter + body)
            </Label>
            <textarea
              id="skill-md"
              value={contentMd}
              onChange={(e) => setContentMd(e.target.value)}
              spellCheck={false}
              className="mt-1 w-full h-[55vh] p-3 text-xs font-mono bg-muted/40 border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-[#FFB300]/50"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Frontmatter ระหว่าง <code>---</code> สอง bar — คุม pipeline params เช่น scene_count, language, stages. Body ด้านล่างเป็นคำแนะนำให้ LLM อ่านเป็น system prompt
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4 mr-1" /> ยกเลิก
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#FFB300] hover:bg-[#FFB300]/80 text-black"
          >
            <Save className="h-4 w-4 mr-1" /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
