import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Trash2, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IdolTaskCard } from './IdolTaskCard';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { IdolTemplateJob, IdolTemplateTask, TemplateVariable } from '@/types/idolTemplate';
import { useGenerateConfirm } from '@/components/common/GenerateConfirmDialog';
import { quoteIdolTask, buildQuote } from '@/lib/generationPricing';

interface IdolJobSectionProps {
  job: IdolTemplateJob;
  channelName: string;
  onDeleteJob: (jobId: number) => void;
  templateConfig?: {
    input_mode?: 'single' | 'multi';
    input_label?: string;
    input_placeholder?: string;
    template_variables?: TemplateVariable[];
    per_scene_vars?: boolean;
  };
}

export function IdolJobSection({ job, channelName, onDeleteJob, templateConfig }: IdolJobSectionProps) {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<IdolTemplateTask[]>(job.tasks || []);
  const [generatingAll, setGeneratingAll] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { requestConfirm, dialog: confirmDialog } = useGenerateConfirm();
  const videoDurationSec = (job as any).duration || 10;

  // Sync tasks when job prop updates
  useEffect(() => {
    setTasks(job.tasks || []);
  }, [job.tasks]);

  const hasActiveTasks = tasks.some(t =>
    ['prompt_generating', 'image_generating', 'video_generating', 'concatenating'].includes(t.status)
  );

  const pendingOrFailedCount = tasks.filter(t => t.status === 'pending' || t.status === 'failed').length;
  const failedCount = tasks.filter(t => t.status === 'failed').length;
  const hasMediaTasks = tasks.filter(t =>
    (t.status === 'pending' || t.status === 'failed') &&
    (t.image_tasks?.some((it: any) => it.image_url) || t.video_tasks?.some((vt: any) => vt.video_url) || !!t.final_video_url)
  ).length;
  const hasAnyFailed = failedCount > 0 || hasMediaTasks > 0;

  // Polling
  const pollStatus = useCallback(async () => {
    try {
      const data = await api.getIdolJobStatus(job.id);
      if (data.tasks) {
        setTasks(data.tasks);
        // Stop polling immediately if no more active tasks
        const stillActive = data.tasks.some((t: any) =>
          ['prompt_generating', 'image_generating', 'video_generating', 'concatenating'].includes(t.status)
        );
        if (!stillActive && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch (err) {
      console.error('Poll error:', err);
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

  // Generate single task (runs after confirm popup)
  const runGenerate = async (taskId: number, characterName: string, characterNames?: string[], taskVariables?: Record<string, any>) => {
    try {
      await api.generateIdolTask(job.id, taskId, characterName, characterNames, taskVariables);
      toast.success('เริ่มสร้าง VDO...');
      setTimeout(pollStatus, 1000);
    } catch (err: any) {
      toast.error(err.message || 'Failed to start generation');
    }
  };

  const handleGenerate = (taskId: number, characterName: string, characterNames?: string[], taskVariables?: Record<string, any>) => {
    const task = tasks.find(t => t.id === taskId);
    const quote = buildQuote([
      quoteIdolTask({
        taskLabel: `${t('idol.task')} #${(task?.task_index ?? 0) + 1}`,
        scenes: job.scenes_per_video,
        durationSec: videoDurationSec,
      }),
    ]);
    requestConfirm(quote, () => runGenerate(taskId, characterName, characterNames, taskVariables));
  };

  // Generate all (runs after confirm popup)
  const runGenerateAll = async () => {
    setGeneratingAll(true);
    try {
      const taskUpdates = tasks
        .filter(t => t.status === 'pending' || t.status === 'failed')
        .map(t => ({ id: t.id, character_name: t.character_name, character_names: t.character_names || undefined, task_variables: t.task_variables || undefined }));

      await api.generateAllIdolTasks(job.id, taskUpdates);
      toast.success('เริ่มสร้าง VDO ทั้งหมด...');
      // Mark tasks as generating locally so polling starts immediately
      setTasks(prev => prev.map(t =>
        (t.status === 'pending' || t.status === 'failed') ? { ...t, status: 'prompt_generating' } : t
      ));
      setTimeout(pollStatus, 2000);
    } catch (err: any) {
      toast.error(err.message || 'Failed to start generation');
    } finally {
      setGeneratingAll(false);
    }
  };

  const handleGenerateAll = () => {
    const targets = tasks.filter(t => t.status === 'pending' || t.status === 'failed');
    const quote = buildQuote(
      targets.map(tk => quoteIdolTask({
        taskLabel: tk.character_name || `${t('idol.task')} #${tk.task_index + 1}`,
        scenes: job.scenes_per_video,
        durationSec: videoDurationSec,
      }))
    );
    requestConfirm(quote, runGenerateAll);
  };

  // Delete single task
  const handleDeleteTask = async (taskId: number) => {
    try {
      await api.deleteIdolTask(job.id, taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      toast.success('ลบ task สำเร็จ');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete task');
    }
  };

  // Delete job
  const handleDeleteAll = async () => {
    if (!confirm(t('idol.confirmDeleteAll'))) return;
    try {
      await api.deleteIdolJob(job.id);
      onDeleteJob(job.id);
      toast.success('ลบทั้งหมดสำเร็จ');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete job');
    }
  };

  // Character name change — update local tasks state so generate-all picks it up
  const handleCharacterChange = (taskId: number, name: string, characterNames?: string[], taskVariables?: Record<string, any>) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? {
        ...t,
        character_name: name || t.character_name,
        character_names: characterNames || t.character_names,
        task_variables: taskVariables || t.task_variables,
      } : t
    ));
  };


  if (tasks.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      {/* Job Info */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span className="px-2 py-1 rounded bg-zinc-800">{channelName || '-'}</span>
        <span className="px-2 py-1 rounded bg-zinc-800">{job.language === 'th' ? 'ไทย' : 'English'}</span>
        <span className="px-2 py-1 rounded bg-zinc-800">{(job as any).duration || 10}s VDO</span>
        <span className="text-zinc-500">•</span>
        <span>{tasks.length} task(s) • {tasks.filter(t => t.status === 'done').length} done</span>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          {pendingOrFailedCount > 0 && (
            <Button
              size="sm"
              onClick={handleGenerateAll}
              disabled={generatingAll || hasActiveTasks}
              className="bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] text-black font-semibold hover:opacity-90"
            >
              {generatingAll ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> กำลังสร้าง...</>
              ) : (
                hasAnyFailed
                  ? <><RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry ทั้งหมด ({pendingOrFailedCount})</>
                  : <><Play className="h-3.5 w-3.5 mr-1" /> {t('idol.generateAll')} ({pendingOrFailedCount})</>
              )}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDeleteAll}
            disabled={hasActiveTasks}
            className="border-red-800 text-red-400 hover:bg-red-900/20 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {t('idol.deleteAll')}
          </Button>
        </div>
      </div>

      {/* Task Cards - Horizontal Scroll */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {tasks.map((task) => (
          <IdolTaskCard
            key={task.id}
            task={task}
            onGenerate={handleGenerate}
            onDelete={handleDeleteTask}
            onCharacterChange={handleCharacterChange}
            generating={['prompt_generating', 'image_generating', 'video_generating', 'concatenating'].includes(task.status)}
            inputMode={templateConfig?.input_mode}
            scenesPerVideo={job.scenes_per_video}
            inputLabel={templateConfig?.input_label}
            inputPlaceholder={templateConfig?.input_placeholder}
            templateVariables={templateConfig?.template_variables}
            perSceneVars={templateConfig?.per_scene_vars}
          />
        ))}
      </div>

      {confirmDialog}
    </div>
  );
}
