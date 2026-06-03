import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ListPlus } from 'lucide-react';

interface PromptDirectBulkFillModalProps {
  open: boolean;
  onClose: () => void;
  variables: Array<{ name: string; values?: any[]; system_prompt?: string }>;
  taskCount: number;
  currentValues?: Record<string, string>[];
  onApply: (values: Record<string, string>[]) => void;
}

/**
 * Bulk Fill Modal — กรอกค่าทีเดียวสำหรับทุก task
 * Each variable มี Textarea — ใส่ค่าทีละบรรทัด (1 บรรทัด = 1 task)
 * ถ้าจำนวนบรรทัด < taskCount → repeat ค่าสุดท้าย
 */
export function PromptDirectBulkFillModal({
  open,
  onClose,
  variables,
  taskCount,
  currentValues,
  onApply,
}: PromptDirectBulkFillModalProps) {
  const [texts, setTexts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !currentValues || currentValues.length === 0) return;
    const init: Record<string, string> = {};
    for (const v of variables) {
      const lines = currentValues.map(cv => cv[v.name] || '');
      init[v.name] = lines.join('\n');
    }
    setTexts(init);
  }, [open]);

  const handleApply = () => {
    // Build per-task values
    const result: Record<string, string>[] = Array.from({ length: taskCount }, () => ({}));
    for (const v of variables) {
      const lines = (texts[v.name] || '').split('\n').map(l => l.trim()).filter(Boolean);
      for (let i = 0; i < taskCount; i++) {
        // Use line at index i, or last line if not enough
        result[i][v.name] = lines[i] !== undefined ? lines[i] : (lines[lines.length - 1] || '');
      }
    }
    onApply(result);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListPlus className="h-5 w-5 text-[#FFB300]" />
            ใส่ตัวแปรทีเดียว ({taskCount} tasks)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-zinc-400">
            ใส่ค่าตัวแปรทีละบรรทัด (1 บรรทัด = 1 task) — ถ้าน้อยกว่า {taskCount} บรรทัด จะ repeat ค่าสุดท้าย
          </p>

          {variables.map((v) => (
            <div key={v.name} className="space-y-1">
              <label className="text-sm font-medium text-zinc-300">{v.name}</label>
              {v.system_prompt && (
                <p className="text-[10px] text-zinc-500">{v.system_prompt}</p>
              )}
              <Textarea
                value={texts[v.name] || ''}
                onChange={(e) => setTexts(prev => ({ ...prev, [v.name]: e.target.value }))}
                rows={Math.min(taskCount, 6)}
                placeholder={Array.from({ length: Math.min(taskCount, 3) }, (_, i) => `ค่าสำหรับ task ${i + 1}`).join('\n')}
                className="bg-zinc-800 border-zinc-700 font-mono text-sm"
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={handleApply} className="bg-[#FFB300] text-black hover:bg-[#FFC233]">
            <ListPlus className="h-4 w-4 mr-1" />
            ใส่ค่าให้ {taskCount} tasks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
