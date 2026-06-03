import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ListPlus } from 'lucide-react';
import type { TemplateVariable } from '@/types/viralTemplate';

interface BulkFillModalProps {
  open: boolean;
  onClose: () => void;
  templateVariables: TemplateVariable[];
  taskCount: number;
  scenesPerVideo: number;
  perSceneVars?: boolean;
  currentValues?: Record<string, string | string[]>[];
  onApply: (values: Record<string, string | string[]>[]) => void;
}

export function BulkFillModal({ open, onClose, templateVariables, taskCount, scenesPerVideo, perSceneVars, currentValues, onApply }: BulkFillModalProps) {
  const enabledVars = templateVariables.filter(v => v.enabled);

  // For per_scene_vars: { [varKey]: { [sceneIdx]: text } }
  // For flat vars: { [varKey]: text }
  const [texts, setTexts] = useState<Record<string, string | Record<number, string>>>({});

  // Init texts from current task values when modal opens
  useEffect(() => {
    if (!open || !currentValues || currentValues.length === 0) return;
    const init: Record<string, string | Record<number, string>> = {};
    for (const varDef of enabledVars) {
      if (perSceneVars) {
        const scenes: Record<number, string> = {};
        for (let s = 0; s < scenesPerVideo; s++) {
          const lines = currentValues.map(cv => {
            const val = cv[varDef.key];
            return Array.isArray(val) ? (val[s] || '') : '';
          });
          scenes[s] = lines.join('\n');
        }
        init[varDef.key] = scenes;
      } else {
        const lines = currentValues.map(cv => {
          const val = cv[varDef.key];
          return typeof val === 'string' ? val : '';
        });
        init[varDef.key] = lines.join('\n');
      }
    }
    setTexts(init);
  }, [open]);

  const updateText = (varKey: string, value: string, sceneIdx?: number) => {
    setTexts(prev => {
      if (sceneIdx !== undefined) {
        const scenes = (prev[varKey] as Record<number, string>) || {};
        return { ...prev, [varKey]: { ...scenes, [sceneIdx]: value } };
      }
      return { ...prev, [varKey]: value };
    });
  };

  const handleApply = () => {
    // Build task_variables for each task
    const result: Record<string, string | string[]>[] = Array.from({ length: taskCount }, () => ({}));

    for (const varDef of enabledVars) {
      if (perSceneVars) {
        // Per-scene: each textarea has lines for tasks, one textarea per scene
        const linesPerScene: string[][] = [];
        for (let s = 0; s < scenesPerVideo; s++) {
          const raw = ((texts[varDef.key] as Record<number, string>)?.[s]) || '';
          linesPerScene.push(raw.split('\n').map(l => l.trim()).filter(l => l));
        }
        // For each task, build an array [scene0val, scene1val, ...]
        for (let t = 0; t < taskCount; t++) {
          const arr = Array.from({ length: scenesPerVideo }, (_, s) => linesPerScene[s][t] || '');
          result[t][varDef.key] = arr;
        }
      } else {
        // Flat: one textarea, each line = one task
        const raw = (texts[varDef.key] as string) || '';
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
        for (let t = 0; t < taskCount; t++) {
          result[t][varDef.key] = lines[t] || '';
        }
      }
    }

    onApply(result);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-700">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <ListPlus className="h-5 w-5 text-[#FFB300]" />
            ใส่ตัวแปรทีเดียว ({taskCount} Tasks)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {enabledVars.map(varDef => {
            const example = varDef.placeholder || varDef.description || varDef.label || varDef.key;
            const examplePlaceholder = `กรอก ${taskCount} บรรทัด (1 บรรทัด = 1 Task)\nเช่น ${example}\n...`;
            return (
            <div key={varDef.key} className="space-y-2">
              <label className="text-sm font-semibold text-[#FFB300]">
                {varDef.description || varDef.label || varDef.key}
              </label>

              {perSceneVars ? (
                // Per-scene: one textarea per scene
                Array.from({ length: scenesPerVideo }).map((_, sceneIdx) => (
                  <div key={sceneIdx}>
                    <label className="text-[10px] text-blue-400 font-semibold block mb-1">
                      ฉากที่ {sceneIdx + 1}
                    </label>
                    <Textarea
                      className="bg-zinc-800 border-zinc-700 text-sm font-mono"
                      rows={Math.min(taskCount, 8)}
                      placeholder={examplePlaceholder}
                      value={((texts[varDef.key] as Record<number, string>)?.[sceneIdx]) || ''}
                      onChange={e => updateText(varDef.key, e.target.value, sceneIdx)}
                      onFocus={e => { if (!e.target.value) e.target.setSelectionRange(0, 0); }}
                    />
                  </div>
                ))
              ) : (
                // Flat: one textarea
                <Textarea
                  className="bg-zinc-800 border-zinc-700 text-sm font-mono"
                  rows={Math.min(taskCount, 8)}
                  placeholder={examplePlaceholder}
                  value={(texts[varDef.key] as string) || ''}
                  onChange={e => updateText(varDef.key, e.target.value)}
                  onFocus={e => { if (!e.target.value) e.target.setSelectionRange(0, 0); }}
                />
              )}
            </div>
            );
          })}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose} className="text-zinc-400">ยกเลิก</Button>
          <Button onClick={handleApply} className="bg-[#FFB300] text-black font-semibold hover:bg-[#FFC233]">
            ตกลง — ใส่ให้ทุก Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
