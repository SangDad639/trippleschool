import { useState, useEffect, useRef } from 'react';
import { Loader2, RotateCcw, Download, Trash2, Play, ChevronDown, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PromptDirectPipelineStatus } from './PromptDirectPipelineStatus';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useGenerateConfirm } from '@/components/common/GenerateConfirmDialog';
import { quotePromptDirectTask, buildQuote } from '@/lib/generationPricing';

// Translate technical error → friendly Thai message
function translateError(error: string): string {
  const lower = error.toLowerCase();
  if ((lower.includes('violated') || lower.includes('violating') || lower.includes('flagged')) && lower.includes('polic')) {
    return 'ถูกบล็อกเพราะผิด Content Policy ลองเปลี่ยน Prompt';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'หมดเวลา กรุณาลองใหม่';
  }
  if (lower.includes('credit') && (lower.includes('insufficient') || lower.includes('หมด') || lower.includes('not enough'))) {
    return '💳 KIE Credit หมด — กรุณาเติม Credit ที่ kie.ai';
  }
  if (lower.includes('api key')) {
    return 'API key ไม่ได้ตั้งค่า — กรุณาไปตั้งค่าใน Settings';
  }
  if (lower === 'task failed' || lower === 'failed' || lower.includes('generation failed')) {
    return 'การสร้างล้มเหลว กรุณาลองใหม่';
  }
  return error;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

async function handleProxyDownload(url: string, filename: string) {
  try {
    await api.downloadViaProxy(url, filename);
  } catch (err: any) {
    toast.error(err?.message || 'Download failed');
  }
}

interface PromptDirectTaskCardProps {
  task: any;
  jobId: number;
  platform?: string;
  variables: Array<{ name: string; values?: any[]; system_prompt?: string }>;
  onTaskUpdate: () => void;
  onDeleteTask: (taskId: number) => void;
}

export function PromptDirectTaskCard({ task, jobId, platform, variables, onTaskUpdate, onDeleteTask }: PromptDirectTaskCardProps) {
  const { language } = useLanguage();
  const l = (th: string, en: string) => language === 'th' ? th : en;
  const [logOpen, setLogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [localVars, setLocalVars] = useState<Record<string, string>>(task.variables_used || {});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { requestConfirm, dialog: confirmDialog } = useGenerateConfirm();

  useEffect(() => {
    setLocalVars(task.variables_used || {});
  }, [task.variables_used]);

  // Clear pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const isActive = task.status === 'generating';
  const isDone = task.status === 'done';
  const isFailed = task.status === 'failed';

  // Empty vars check — disable Generate if any required var is empty
  const hasEmptyVars = variables.length > 0 && variables.some(v => {
    const val = localVars[v.name];
    return !val || !String(val).trim();
  });

  const handleVarChange = (name: string, value: string) => {
    const updated = { ...localVars, [name]: value };
    setLocalVars(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await api.updatePromptDirectTaskVariables(jobId, task.id, updated);
      } catch (err: any) {
        toast.error(err.message || 'Update failed');
      }
    }, 600);
  };

  const runGenerate = async () => {
    setGenerating(true);
    try {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        await api.updatePromptDirectTaskVariables(jobId, task.id, localVars);
      }
      await api.generatePromptDirectTask(jobId, task.id);
      onTaskUpdate();
    } catch (err: any) {
      toast.error(err.message || 'Failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = () => {
    const quote = buildQuote([
      quotePromptDirectTask({
        taskLabel: `Task #${(task.task_index ?? 0) + 1}`,
        platform,
        hasExtendPrompt: !!task.extend_prompt,
      }),
    ]);
    requestConfirm(quote, runGenerate);
  };

  const handleDelete = () => {
    onDeleteTask(task.id);
  };

  // Build terminal-style log entries (timestamp + emoji + message)
  const logEntries = (task.logs || []).map((log: any) => ({
    time: log.time ? fmtTime(log.time) : '',
    emoji: log.emoji || '•',
    text: log.message || '',
    color: log.emoji === '❌' || log.emoji === '💥' ? 'text-red-400'
         : log.emoji === '✅' || log.emoji === '🎉' ? 'text-green-400'
         : log.emoji === '⚠️' ? 'text-yellow-400'
         : 'text-zinc-300',
  }));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3 min-w-[280px] w-[280px] flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300">
          {l('Task', 'Task')} #{task.task_index + 1}
        </span>
        <div className="flex items-center gap-1">
          {isDone && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-900/30 text-green-400">
              {l('สำเร็จ', 'Done')}
            </span>
          )}
          {isFailed && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-900/30 text-red-400">
              {l('ล้มเหลว', 'Failed')}
            </span>
          )}
          {isActive && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-900/30 text-yellow-400 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {l('กำลังสร้าง', 'Generating')}
            </span>
          )}
        </div>
      </div>

      {/* Variable inputs — always visible (disabled when done/generating) */}
      {variables.length > 0 && (
        <div className="space-y-2">
          {variables.map((v) => (
            <div key={v.name}>
              {v.system_prompt && (
                <label className="text-[10px] text-zinc-400 block mb-0.5">{v.system_prompt}</label>
              )}
              {!v.system_prompt && (
                <label className="text-[10px] text-zinc-500 block mb-0.5">{v.name}</label>
              )}
              <Input
                value={localVars[v.name] || ''}
                onChange={(e) => handleVarChange(v.name, e.target.value)}
                placeholder={v.name}
                className="bg-zinc-800 border-zinc-700 text-sm"
                disabled={isActive || isDone}
              />
            </div>
          ))}
        </div>
      )}

      {/* Pipeline Status — hide when pending (เหมือน Viral) */}
      {task.status !== 'pending' && (
        <PromptDirectPipelineStatus task={task} />
      )}

      {/* Error Message */}
      {task.error && (
        <div className="text-xs text-red-400 bg-red-900/20 rounded p-2 break-words">
          {translateError(task.error)}
        </div>
      )}

      {/* Video Preview (when done) — wrapped with border */}
      {task.video_url && isDone && (
        <div className="rounded-lg overflow-hidden border border-zinc-700">
          <video
            src={task.video_url}
            controls
            className="w-full aspect-[9/16] max-h-[300px] object-contain bg-black"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {!isDone && !isActive && (
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generating || hasEmptyVars}
            className="bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] text-black font-semibold hover:opacity-90"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : isFailed ? (
              <><RotateCcw className="h-3.5 w-3.5 mr-1" /> {l('ลองใหม่', 'Retry')}</>
            ) : (
              <><Play className="h-3.5 w-3.5 mr-1" /> {l('สร้าง', 'Generate')}</>
            )}
          </Button>
        )}
        {isDone && task.video_url && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDetailOpen(true)}
              className="text-zinc-400 hover:text-[#FFB300]"
            >
              <Eye className="h-3.5 w-3.5 mr-1" /> {l('ดูผลงาน', 'View')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleProxyDownload(task.video_url, `prompt-${task.id}.mp4`)}
              className="text-zinc-400 hover:text-[#FFB300]"
            >
              <Download className="h-3.5 w-3.5 mr-1" /> {l('ดาวน์โหลด', 'Download')}
            </Button>
          </>
        )}
        {!isActive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            className="text-zinc-500 hover:text-red-400 hover:bg-red-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Terminal-style Log (collapsible — show in all states with logs) */}
      {logEntries.length > 0 && (
        <div>
          <button
            onClick={() => setLogOpen(!logOpen)}
            className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${logOpen ? 'rotate-180' : ''}`} />
            Log
          </button>
          {logOpen && (
            <div className="mt-1.5 bg-[#0d1117] rounded border border-zinc-800 p-2 overflow-y-auto max-h-[250px]">
              {logEntries.map((entry: any, i: number) => (
                <div key={i} className="flex items-start gap-1.5 py-[2px] font-mono text-[11px] leading-relaxed">
                  {entry.time && <span className="text-zinc-600 flex-shrink-0 whitespace-nowrap">{entry.time}</span>}
                  <span className="flex-shrink-0 w-4 text-center">{entry.emoji}</span>
                  <span className={entry.color}>{entry.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail Modal (View work) */}
      <Dialog open={detailOpen} onOpenChange={(v) => !v && setDetailOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-zinc-900 border-zinc-700">
          <DialogHeader>
            <DialogTitle className="text-base">
              Task #{task.task_index + 1}
            </DialogTitle>
          </DialogHeader>
          {task.video_url ? (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden border border-zinc-700">
                <video src={task.video_url} controls className="w-full max-h-[500px] object-contain bg-black" />
              </div>
              <Button
                onClick={() => handleProxyDownload(task.video_url, `prompt-${task.id}.mp4`)}
                className="bg-[#FFB300] hover:bg-[#FF9D00] text-black"
              >
                <Download className="h-4 w-4 mr-1" /> {l('ดาวน์โหลด', 'Download')}
              </Button>
            </div>
          ) : (
            <div className="text-center py-8 text-zinc-500 text-sm">
              {l('ยังไม่มีวิดีโอ', 'No video yet')}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
