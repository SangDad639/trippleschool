import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Trash2, Play, RotateCcw, ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { PromptDirectTaskCard } from './PromptDirectTaskCard';
import { PromptDirectBulkFillModal } from './PromptDirectBulkFillModal';
import { useGenerateConfirm } from '@/components/common/GenerateConfirmDialog';
import { quotePromptDirectTask, buildQuote } from '@/lib/generationPricing';

interface PromptDirectJobSectionProps {
  job: any;
  channelName: string;
  variables: Array<{ name: string; values?: any[]; system_prompt?: string }>;
  onDeleteJob: (jobId: number) => void;
}

export function PromptDirectJobSection({ job, channelName, variables, onDeleteJob }: PromptDirectJobSectionProps) {
  const { language } = useLanguage();
  const l = (th: string, en: string) => language === 'th' ? th : en;
  const [tasks, setTasks] = useState<any[]>(job.tasks || []);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bulkFillOpen, setBulkFillOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { requestConfirm, dialog: confirmDialog } = useGenerateConfirm();

  const hasActiveTasks = tasks.some(t => t.status === 'generating');

  // Polling — fetch latest task statuses
  const pollStatus = useCallback(async () => {
    try {
      const data = await api.getPromptDirectJobStatus(job.id);
      if (data?.tasks) {
        setTasks(data.tasks);
        const stillActive = data.tasks.some((t: any) => t.status === 'generating');
        if (!stillActive && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch (err) {
      console.error('[PromptDirect] Poll error:', err);
    }
  }, [job.id]);

  useEffect(() => {
    if (hasActiveTasks && !pollRef.current) {
      pollRef.current = setInterval(pollStatus, 3000);
    }
    if (!hasActiveTasks && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [hasActiveTasks, pollStatus]);

  const runGenerateAll = async () => {
    setGeneratingAll(true);
    try {
      await api.generateAllPromptDirectTasks(job.id);
      // Optimistically mark as generating so polling starts immediately
      setTasks(prev => prev.map(t => (t.status === 'pending' || t.status === 'failed') ? { ...t, status: 'generating' } : t));
      toast.success(l('เริ่มสร้างทั้งหมด', 'Generating all'));
      // Force poll after 2s to fetch real state
      setTimeout(pollStatus, 2000);
    } catch (err: any) {
      toast.error(err.message || 'Failed');
    } finally {
      setGeneratingAll(false);
    }
  };

  const handleGenerateAll = () => {
    const targets = tasks.filter(t => t.status === 'pending' || t.status === 'failed');
    const quote = buildQuote(
      targets.map((tk, i) => quotePromptDirectTask({
        taskLabel: `Task #${(tk.task_index ?? i) + 1}`,
        platform: job.platform,
        hasExtendPrompt: !!tk.extend_prompt,
      }))
    );
    requestConfirm(quote, runGenerateAll);
  };

  const handleDeleteAll = async () => {
    if (!confirm(l('ลบ tasks ทั้งหมดในงานนี้?', 'Delete all tasks in this job?'))) return;
    setDeleting(true);
    try {
      await api.deletePromptDirectJob(job.id);
      onDeleteJob(job.id);
    } catch (err: any) {
      toast.error(err.message || 'Failed');
    } finally {
      setDeleting(false);
    }
  };

  const handleTaskUpdate = async () => {
    try {
      const result = await api.getPromptDirectJobStatus(job.id);
      if (result?.tasks) setTasks(result.tasks);
    } catch {}
  };

  const handleDeleteTask = (taskId: number) => {
    // Optimistic — remove from local state (backend doesn't have per-task delete yet, will skip on next poll)
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  const handleBulkFillApply = async (values: Record<string, string>[]) => {
    try {
      // Update each task's variables
      await Promise.all(tasks.map((task, i) => {
        const taskVars = values[i] || {};
        return api.updatePromptDirectTaskVariables(job.id, task.id, taskVars);
      }));
      // Refresh
      await handleTaskUpdate();
      toast.success(l('อัปเดตตัวแปรสำเร็จ', 'Variables updated'));
    } catch (err: any) {
      toast.error(err.message || 'Bulk fill failed');
    }
  };

  const doneCount = tasks.filter(t => t.status === 'done').length;
  const pendingOrFailedCount = tasks.filter(t => t.status === 'pending' || t.status === 'failed').length;
  const hasAnyFailed = tasks.some(t => t.status === 'failed');

  // Validate: any pending/failed task with empty variables?
  const hasEmptyVars = variables.length > 0 && tasks
    .filter(t => t.status === 'pending' || t.status === 'failed')
    .some(t => {
      const used = t.variables_used || {};
      return variables.some(v => !used[v.name] || !String(used[v.name]).trim());
    });

  if (tasks.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      {/* Job Info */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span className="px-2 py-1 rounded bg-zinc-800">{channelName || '-'}</span>
        <span className="px-2 py-1 rounded bg-zinc-800">{job.language === 'th' ? 'ไทย' : 'English'}</span>
        {job.platform && (
          <span className="px-2 py-1 rounded bg-zinc-800 uppercase text-[10px]">{job.platform}</span>
        )}
        <span className="text-zinc-500">•</span>
        <span>{tasks.length} task(s) • {doneCount} done</span>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          {variables.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkFillOpen(true)}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white"
            >
              <ListPlus className="h-3.5 w-3.5 mr-1" />
              {l('ใส่ตัวแปรทีเดียว', 'Bulk Fill')}
            </Button>
          )}
          {pendingOrFailedCount > 0 && (
            <Button
              size="sm"
              onClick={handleGenerateAll}
              disabled={generatingAll || hasActiveTasks || hasEmptyVars}
              className="bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] text-black font-semibold hover:opacity-90"
            >
              {generatingAll ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> {l('กำลังสร้าง...', 'Starting...')}</>
              ) : (
                hasAnyFailed
                  ? <><RotateCcw className="h-3.5 w-3.5 mr-1" /> {l('Retry ทั้งหมด', 'Retry All')} ({pendingOrFailedCount})</>
                  : <><Play className="h-3.5 w-3.5 mr-1" /> {l('สร้างทั้งหมด', 'Generate All')} ({pendingOrFailedCount})</>
              )}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDeleteAll}
            disabled={hasActiveTasks || deleting}
            className="border-red-800 text-red-400 hover:bg-red-900/20 hover:text-red-300"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
            {l('ลบทั้งหมด', 'Delete All')}
          </Button>
        </div>
      </div>

      {/* Task Cards — horizontal scroll */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {tasks.map((task) => (
          <PromptDirectTaskCard
            key={task.id}
            task={task}
            jobId={job.id}
            platform={job.platform}
            variables={variables}
            onTaskUpdate={handleTaskUpdate}
            onDeleteTask={handleDeleteTask}
          />
        ))}
      </div>

      {/* Bulk Fill Modal */}
      {variables.length > 0 && (
        <PromptDirectBulkFillModal
          open={bulkFillOpen}
          onClose={() => setBulkFillOpen(false)}
          variables={variables}
          taskCount={tasks.length}
          currentValues={tasks.map(t => t.variables_used || {})}
          onApply={handleBulkFillApply}
        />
      )}

      {confirmDialog}
    </div>
  );
}
