/**
 * SkillsSidebar — left rail of the AI Agent tab.
 *
 * Shows the user's skills with checkboxes (active in current chat), starter
 * templates that can be forked, and quick buttons to create / edit / delete.
 */
import { useEffect, useState } from 'react';
import { Plus, Trash2, Edit3, Sparkles, FileCode2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { api, type UserSkillDto, type SkillTemplateDto } from '@/lib/api';

interface Props {
  activeSkillIds: number[];
  onActiveSkillsChange: (ids: number[]) => void;
  onEditSkill: (skill: UserSkillDto) => void;
  onCreateSkill: () => void;
  refreshKey: number;
}

export function SkillsSidebar({
  activeSkillIds,
  onActiveSkillsChange,
  onEditSkill,
  onCreateSkill,
  refreshKey,
}: Props) {
  const [skills, setSkills] = useState<UserSkillDto[]>([]);
  const [templates, setTemplates] = useState<SkillTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([api.skillsList(), api.skillsListTemplates()]);
      setSkills(a.items);
      setTemplates(b.items);
    } catch (err: any) {
      toast.error(err?.message || 'โหลด skills ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Auto-show templates panel when user has no skills yet
  useEffect(() => {
    if (!loading && skills.length === 0 && templates.length > 0) {
      setShowTemplates(true);
    }
  }, [loading, skills.length, templates.length]);

  const toggleActive = (id: number) => {
    const set = new Set(activeSkillIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onActiveSkillsChange(Array.from(set));
  };

  const handleFork = async (templateId: number) => {
    try {
      const { skill } = await api.skillsForkTemplate(templateId);
      toast.success(`Fork "${skill.name}" สำเร็จ`);
      // Auto-activate the newly forked skill
      onActiveSkillsChange([...activeSkillIds, skill.id]);
      await reload();
    } catch (err: any) {
      toast.error(err?.message || 'Fork ไม่สำเร็จ');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`ลบ skill "${name}" ?`)) return;
    try {
      await api.skillsDelete(id);
      toast.success('ลบสำเร็จ');
      onActiveSkillsChange(activeSkillIds.filter((x) => x !== id));
      await reload();
    } catch (err: any) {
      toast.error(err?.message || 'ลบไม่สำเร็จ');
    }
  };

  return (
    <div className="w-72 shrink-0 flex flex-col gap-3 h-full overflow-y-auto pr-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#FFB300] flex items-center gap-1.5">
          <Sparkles className="h-4 w-4" /> My Skills
        </h3>
        <Button size="sm" variant="ghost" onClick={onCreateSkill} className="h-7 px-2">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">กำลังโหลด...</div>
      ) : skills.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">
          ยังไม่มี skill — fork จาก template ด้านล่าง
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {skills.map((s) => {
            const isActive = activeSkillIds.includes(s.id);
            return (
              <Card
                key={s.id}
                className={`p-2 border ${isActive ? 'border-[#FFB300]/60 bg-[#FFB300]/5' : 'border-border'}`}
              >
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={isActive}
                    onCheckedChange={() => toggleActive(s.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-medium truncate">{s.name}</span>
                      {s.is_default && (
                        <Star className="h-3 w-3 text-[#FFB300] shrink-0" fill="currentColor" />
                      )}
                    </div>
                    {s.description && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                        {s.description}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => onEditSkill(s)}
                      className="text-muted-foreground hover:text-[#FFB300] transition"
                      title="แก้ไข"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id, s.name)}
                      className="text-muted-foreground hover:text-red-500 transition"
                      title="ลบ"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-border">
        <button
          onClick={() => setShowTemplates((x) => !x)}
          className="text-xs text-muted-foreground hover:text-[#FFB300] flex items-center gap-1 w-full"
        >
          <FileCode2 className="h-3.5 w-3.5" />
          {showTemplates ? 'ซ่อน Templates' : `Templates (${templates.length})`}
        </button>

        {showTemplates && (
          <div className="flex flex-col gap-1.5 mt-2">
            {templates.map((t) => (
              <Card key={t.id} className="p-2 border-dashed border-border/70">
                <div className="flex items-center gap-1.5 mb-1">
                  <FileCode2 className="h-3.5 w-3.5 text-[#FFB300]" />
                  <span className="text-sm font-medium truncate">{t.name}</span>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2 mb-1.5">
                  {t.description}
                </p>
                <Button size="sm" variant="outline" className="h-6 text-xs w-full" onClick={() => handleFork(t.id)}>
                  Fork to my skills
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
