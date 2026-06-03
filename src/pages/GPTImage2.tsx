import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  Image as ImageIcon,
  Loader2,
  Upload,
  X,
  Download,
  Trash2,
  Plus,
  Play,
  ScrollText,
  ChevronDown,
  Eye,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScheduler } from '@/contexts/SchedulerContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useGenerateConfirm } from '@/components/common/GenerateConfirmDialog';
import { quoteImageGen, buildQuote } from '@/lib/generationPricing';

type Mode = 'text-to-image' | 'image-to-image';
type Aspect = 'auto' | '1:1' | '9:16' | '16:9' | '4:3' | '3:4';
type Resolution = '1K' | '2K' | '4K';
type TaskStatus = 'draft' | 'pending' | 'success' | 'failed';
type LogLevel = 'info' | 'success' | 'warning' | 'error';

interface ActivityLog {
  timestamp: number;
  level: LogLevel;
  message: string;
}

interface TaskDraft {
  localId: string;
  taskNumber: number; // sequential number across all groups, never resets
  mode: Mode;
  prompt: string;
  aspect: Aspect;
  resolution: Resolution;
  files: File[];
  filePreviews: string[];
  status: TaskStatus;
  serverTaskId?: string;
  serverDbId?: number;
  resultUrl?: string;
  dropboxUrl?: string;
  error?: string;
  startedAt?: number;
  logs: ActivityLog[];
}

interface TaskGroup {
  groupId: string;
  createdAt: number;
  channelId: string; // empty string = no channel
  tasks: TaskDraft[];
}

const ASPECTS: Aspect[] = ['auto', '1:1', '9:16', '16:9', '4:3', '3:4'];
const RESOLUTIONS: Resolution[] = ['1K', '2K', '4K'];
const MAX_TASKS_PER_CREATE = 10;

const newDraft = (taskNumber: number): TaskDraft => ({
  localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  taskNumber,
  mode: 'text-to-image',
  prompt: '',
  aspect: 'auto',
  resolution: '1K',
  files: [],
  filePreviews: [],
  status: 'draft',
  logs: [],
});

const aspectRatioStyle: Record<Aspect, string> = {
  'auto': '16 / 10',
  '1:1': '1 / 1',
  '9:16': '9 / 16',
  '16:9': '16 / 9',
  '4:3': '4 / 3',
  '3:4': '3 / 4',
};

const GPTImage2 = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const l = (th: string, en: string) => (language === 'th' ? th : en);
  const { requestConfirm, dialog: confirmDialog } = useGenerateConfirm();

  const { channels, fetchChannels } = useScheduler();
  const [createCount, setCreateCount] = useState(1);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [groups, setGroupsRaw] = useState<TaskGroup[]>([]);
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);

  // Re-number drafts so they fill below the highest "locked" (generated) number.
  // Generated tasks (status !== 'draft') keep their numbers; drafts get max+1, max+2, ...
  const renumberDrafts = (gs: TaskGroup[]): TaskGroup[] => {
    const generatedNums = gs.flatMap((g) =>
      g.tasks.filter((t) => t.status !== 'draft').map((t) => t.taskNumber)
    );
    const maxGenerated = generatedNums.length > 0 ? Math.max(...generatedNums) : 0;
    let nextDraft = maxGenerated + 1;
    return gs.map((g) => ({
      ...g,
      tasks: g.tasks.map((t) => (t.status === 'draft' ? { ...t, taskNumber: nextDraft++ } : t)),
    }));
  };

  const setGroups = (updater: TaskGroup[] | ((prev: TaskGroup[]) => TaskGroup[])) => {
    setGroupsRaw((prev) => {
      const next = typeof updater === 'function' ? (updater as any)(prev) : updater;
      return renumberDrafts(next);
    });
  };

  useEffect(() => {
    fetchChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load existing tasks from backend on mount, group by created_at proximity
  useEffect(() => {
    (async () => {
      try {
        const { items } = await api.gptImage2History({ limit: 200 });
        if (!items || items.length === 0) return;
        // Sort oldest → newest so taskNumber starts at 1 for the first created task
        const sorted = [...items].sort(
          (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const GROUP_GAP_MS = 5000; // tasks created within 5s of each other belong to same group
        const loadedGroups: TaskGroup[] = [];
        let currentGroup: TaskGroup | null = null;
        let lastTime = 0;
        sorted.forEach((row: any, idx: number) => {
          const ts = new Date(row.created_at).getTime();
          const updatedTs = row.updated_at ? new Date(row.updated_at).getTime() : ts;
          if (!currentGroup || ts - lastTime > GROUP_GAP_MS || (currentGroup.channelId !== String(row.channel_id || ''))) {
            currentGroup = {
              groupId: `loaded-${row.id}`,
              createdAt: ts,
              channelId: row.channel_id ? String(row.channel_id) : '',
              tasks: [],
            };
            loadedGroups.push(currentGroup);
          }
          // Reconstruct logs from persisted data so user can review history
          const logs: ActivityLog[] = [
            { timestamp: ts, level: 'info', message: `🚀 Starting task #${idx + 1}` },
          ];
          if (row.task_id) {
            logs.push({
              timestamp: ts + 1,
              level: 'info',
              message: `🔄 Task ID: ${row.task_id} — รอประมวลผล...`,
            });
          }
          if (row.status === 'success') {
            logs.push({ timestamp: updatedTs, level: 'success', message: `✅ สร้างภาพสำเร็จ` });
            logs.push({
              timestamp: updatedTs + 1,
              level: 'info',
              message: `📦 กำลังบันทึกไป Dropbox...`,
            });
            if (row.dropbox_url) {
              logs.push({
                timestamp: updatedTs + 2,
                level: 'success',
                message: `✅ บันทึกไป Dropbox สำเร็จ`,
              });
            } else {
              logs.push({
                timestamp: updatedTs + 2,
                level: 'warning',
                message: `⚠️ Dropbox ไม่พร้อม — ใช้ URL จาก KIE แทน`,
              });
            }
            logs.push({
              timestamp: updatedTs + 3,
              level: 'info',
              message: `📚 บันทึกลงประวัติแล้ว`,
            });
            logs.push({
              timestamp: updatedTs + 4,
              level: 'success',
              message: `🎉 เสร็จสมบูรณ์!`,
            });
          } else if (row.status === 'failed') {
            logs.push({
              timestamp: updatedTs,
              level: 'error',
              message: `❌ สร้างไม่สำเร็จ: ${row.error || 'unknown'}`,
            });
          } else if (row.status === 'pending') {
            logs.push({
              timestamp: updatedTs,
              level: 'info',
              message: `⏳ ยังประมวลผลอยู่...`,
            });
          }
          const draft: TaskDraft = {
            localId: `loaded-${row.id}`,
            taskNumber: idx + 1,
            mode: row.mode as Mode,
            prompt: row.prompt || '',
            aspect: (row.aspect_ratio || 'auto') as Aspect,
            resolution: (row.resolution || '1K') as Resolution,
            files: [],
            filePreviews: [],
            status: row.status as TaskStatus,
            serverTaskId: row.task_id,
            serverDbId: row.id,
            resultUrl: row.result_url || undefined,
            dropboxUrl: row.dropbox_url || undefined,
            error: row.error || undefined,
            startedAt: ts,
            logs,
          };
          currentGroup.tasks.push(draft);
          lastTime = ts;
        });
        // Newest group first (top of page)
        setGroupsRaw(loadedGroups.reverse());
      } catch (err) {
        console.error('Failed to load GPT Image 2 history:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      groups.forEach((g) => g.tasks.forEach((t) => t.filePreviews.forEach(URL.revokeObjectURL)));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-poll pending tasks across all groups
  useEffect(() => {
    const pending: { groupId: string; task: TaskDraft }[] = [];
    groups.forEach((g) =>
      g.tasks.forEach((t) => {
        if (t.status === 'pending' && t.serverTaskId) pending.push({ groupId: g.groupId, task: t });
      })
    );
    if (pending.length === 0) return;
    const tick = async () => {
      for (const { groupId, task: t } of pending) {
        try {
          const { task } = await api.gptImage2Status(t.serverTaskId!);
          const newStatus = task.status as TaskStatus;
          // Log only on status change (not every poll cycle while still pending)
          setGroups((prev) =>
            prev.map((g) => {
              if (g.groupId !== groupId) return g;
              return {
                ...g,
                tasks: g.tasks.map((p) => {
                  if (p.localId !== t.localId) return p;
                  const statusChanged = p.status !== newStatus;
                  const newLogs = [...p.logs];
                  const elapsedSec = p.startedAt
                    ? Math.round((Date.now() - p.startedAt) / 1000)
                    : 0;
                  if (statusChanged) {
                    if (newStatus === 'success') {
                      const t0 = Date.now();
                      newLogs.push({
                        timestamp: t0,
                        level: 'success',
                        message: `✅ สร้างภาพสำเร็จ`,
                      });
                      // Always show Dropbox sequence BEFORE history
                      newLogs.push({
                        timestamp: t0 + 1,
                        level: 'info',
                        message: `📦 กำลังบันทึกไป Dropbox...`,
                      });
                      if (task.dropbox_url) {
                        newLogs.push({
                          timestamp: t0 + 2,
                          level: 'success',
                          message: `✅ บันทึกไป Dropbox สำเร็จ`,
                        });
                      } else {
                        newLogs.push({
                          timestamp: t0 + 2,
                          level: 'warning',
                          message: `⚠️ Dropbox ไม่พร้อม — ใช้ URL จาก KIE แทน`,
                        });
                      }
                      // Then save to history
                      newLogs.push({
                        timestamp: t0 + 3,
                        level: 'info',
                        message: `📚 บันทึกลงประวัติแล้ว`,
                      });
                      newLogs.push({
                        timestamp: t0 + 4,
                        level: 'success',
                        message: `🎉 เสร็จสมบูรณ์!`,
                      });
                    } else if (newStatus === 'failed') {
                      newLogs.push({
                        timestamp: Date.now(),
                        level: 'error',
                        message: `❌ สร้างไม่สำเร็จ: ${task.error || 'unknown'}`,
                      });
                    }
                  } else if (newStatus === 'pending') {
                    // Periodic poll log (every cycle) with elapsed time
                    newLogs.push({
                      timestamp: Date.now(),
                      level: 'info',
                      message: `⏳ ยังประมวลผลอยู่... (${elapsedSec}s)`,
                    });
                  }
                  return {
                    ...p,
                    status: newStatus,
                    resultUrl: task.result_url || p.resultUrl,
                    dropboxUrl: task.dropbox_url || p.dropboxUrl,
                    error: task.error || p.error,
                    logs: newLogs,
                  };
                }),
              };
            })
          );
        } catch (pollErr: any) {
          appendLog(groupId, t.localId, 'warning', `⚠️ Poll error: ${pollErr?.message || 'unknown'}`);
        }
      }
    };
    tick();
    const interval = window.setInterval(tick, 5000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.map((g) => g.tasks.map((t) => `${t.localId}:${t.status}:${t.serverTaskId || ''}`).join('|')).join('||')]);

  // Add a NEW group with N empty drafts (each "+ สร้าง Tasks" click)
  const addGroup = () => {
    const n = Math.max(1, Math.min(MAX_TASKS_PER_CREATE, createCount));
    const newGroup: TaskGroup = {
      groupId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      channelId: selectedChannelId,
      // taskNumber is a placeholder (0); renumberDrafts will assign real numbers
      tasks: Array.from({ length: n }, () => newDraft(0)),
    };
    setGroups((prev) => [newGroup, ...prev]);
  };

  const deleteGroup = async (groupId: string) => {
    const target = groups.find((g) => g.groupId === groupId);
    // Delete each saved task from backend
    if (target) {
      for (const t of target.tasks) {
        if (t.serverDbId) {
          try {
            await api.gptImage2Delete(t.serverDbId);
          } catch (err: any) {
            console.error('Delete on server failed:', err?.message);
          }
        }
        t.filePreviews.forEach(URL.revokeObjectURL);
      }
    }
    setGroups((prev) => prev.filter((g) => g.groupId !== groupId));
  };

  const updateTask = (groupId: string, localId: string, patch: Partial<TaskDraft>) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId !== groupId
          ? g
          : { ...g, tasks: g.tasks.map((t) => (t.localId === localId ? { ...t, ...patch } : t)) }
      )
    );
  };

  const appendLog = (groupId: string, localId: string, level: LogLevel, message: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId !== groupId
          ? g
          : {
              ...g,
              tasks: g.tasks.map((t) =>
                t.localId === localId
                  ? { ...t, logs: [...t.logs, { timestamp: Date.now(), level, message }] }
                  : t
              ),
            }
      )
    );
  };

  const deleteTask = async (groupId: string, localId: string) => {
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    // Delete from backend if it was saved to DB
    if (t?.serverDbId) {
      try {
        await api.gptImage2Delete(t.serverDbId);
      } catch (err: any) {
        console.error('Delete on server failed:', err?.message);
      }
    }
    setGroups((prev) =>
      prev
        .map((g) => {
          if (g.groupId !== groupId) return g;
          const target = g.tasks.find((t) => t.localId === localId);
          target?.filePreviews.forEach(URL.revokeObjectURL);
          return { ...g, tasks: g.tasks.filter((t) => t.localId !== localId) };
        })
        .filter((g) => g.tasks.length > 0)
    );
  };

  const handleFiles = (groupId: string, localId: string, selected: FileList | null) => {
    if (!selected) return;
    const arr = Array.from(selected).slice(0, 16);
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    t?.filePreviews.forEach(URL.revokeObjectURL);
    updateTask(groupId, localId, {
      files: arr,
      filePreviews: arr.map((f) => URL.createObjectURL(f)),
    });
  };

  const removeFile = (groupId: string, localId: string, idx: number) => {
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    if (!t) return;
    URL.revokeObjectURL(t.filePreviews[idx]);
    updateTask(groupId, localId, {
      files: t.files.filter((_, i) => i !== idx),
      filePreviews: t.filePreviews.filter((_, i) => i !== idx),
    });
  };

  const isResolutionDisabled = (r: Resolution, aspect: Aspect) =>
    r === '4K' && (aspect === '1:1' || aspect === 'auto');

  const runGenerateOne = async (groupId: string, localId: string) => {
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    if (!t) return;
    if (!t.prompt.trim()) {
      toast.error(l('กรุณาใส่ prompt', 'Prompt is required'));
      return;
    }
    if (t.mode === 'image-to-image' && t.files.length === 0) {
      toast.error(l('กรุณาเลือกรูปอย่างน้อย 1 รูป', 'Please select at least 1 image'));
      return;
    }
    appendLog(groupId, localId, 'info', `🚀 Starting task #${t.taskNumber}`);
    updateTask(groupId, localId, { status: 'pending', startedAt: Date.now() });
    try {
      const { task } = await api.gptImage2Generate({
        prompt: t.prompt.trim(),
        mode: t.mode,
        aspect_ratio: t.aspect,
        resolution: t.resolution,
        files: t.mode === 'image-to-image' ? t.files : undefined,
        channel_id: g!.channelId || undefined,
      });
      appendLog(groupId, localId, 'info', `🔄 Task ID: ${task.task_id} — รอประมวลผล...`);
      updateTask(groupId, localId, { serverTaskId: task.task_id, serverDbId: task.id });
    } catch (err: any) {
      const msg = err?.message || 'Failed to submit';
      appendLog(groupId, localId, 'error', `❌ ส่งคำขอไม่สำเร็จ: ${msg}`);
      updateTask(groupId, localId, { status: 'failed', error: msg });
      toast.error(msg);
    }
  };

  // เปิด popup ยืนยัน 1 task ก่อนสร้าง
  const generateOne = (groupId: string, localId: string) => {
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    if (!t) return;
    const quote = buildQuote([
      quoteImageGen({ taskLabel: `Task #${t.taskNumber}`, model: 'gpt-image-2', resolution: t.resolution, count: 1 }),
    ]);
    requestConfirm(quote, () => runGenerateOne(groupId, localId));
  };

  const runGenerateAllInGroup = async (groupId: string) => {
    const g = groups.find((x) => x.groupId === groupId);
    if (!g) return;
    const drafts = g.tasks.filter((t) => t.status === 'draft');
    for (const d of drafts) {
      await runGenerateOne(groupId, d.localId);
    }
  };

  // เปิด popup ยืนยันรวมทุก draft ในกลุ่มก่อนสร้าง
  const generateAllInGroup = (groupId: string) => {
    const g = groups.find((x) => x.groupId === groupId);
    if (!g) return;
    const drafts = g.tasks.filter((t) => t.status === 'draft');
    if (drafts.length === 0) return;
    const quote = buildQuote(
      drafts.map((d) => quoteImageGen({ taskLabel: `Task #${d.taskNumber}`, model: 'gpt-image-2', resolution: d.resolution, count: 1 }))
    );
    requestConfirm(quote, () => runGenerateAllInGroup(groupId));
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Compact header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/images')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          {l('กลับ', 'Back')}
        </Button>
        <ImageIcon className="h-5 w-5 text-[#FFB300]" />
        <h1 className="text-xl md:text-2xl font-bold">GPT Image 2</h1>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#FFB300] text-black">NEW</span>
      </div>

      {/* Create new tasks card */}
      <div className="rounded-2xl border border-[#FFB300]/15 bg-card/40 shadow-lg shadow-black/20 p-5 md:p-6 mb-6">
        <h2 className="text-base font-bold mb-4">{l('สร้าง Task ใหม่', 'Create new tasks')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {l('เลือกช่อง', 'Channel')}
            </label>
            <Select
              value={selectedChannelId || 'none'}
              onValueChange={(v) => setSelectedChannelId(v === 'none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={l('เลือกช่อง', 'Select channel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{l('ไม่ระบุช่อง', 'No channel')}</SelectItem>
                {channels.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {l('จำนวนภาพ', 'Number of images')}
            </label>
            <Select value={String(createCount)} onValueChange={(v) => setCreateCount(parseInt(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: MAX_TASKS_PER_CREATE }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} {l('ภาพ', n > 1 ? 'images' : 'image')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          onClick={addGroup}
          className="bg-gradient-to-r from-[#FFB300] to-[#FF8C00] hover:from-[#FFC533] hover:to-[#FFA033] text-black font-bold shadow-lg shadow-[#FFB300]/20 h-11"
        >
          <Plus className="h-5 w-5 mr-2" />
          {l('สร้าง Tasks', 'Create Tasks')}
        </Button>
      </div>

      {/* Task groups — each click on "Create Tasks" makes a new frame */}
      <div className="space-y-4">
        {groups.map((g) => {
          const draftN = g.tasks.filter((t) => t.status === 'draft').length;
          const doneN = g.tasks.filter((t) => t.status === 'success').length;
          return (
            <div
              key={g.groupId}
              className="rounded-2xl border border-[#FFB300]/15 bg-card/40 shadow-lg shadow-black/20 p-4 md:p-5"
            >
              {/* Group header bar */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground font-medium">
                  GPT Image 2
                </span>
                <span className="text-xs text-muted-foreground">
                  • {g.tasks.length} task{g.tasks.length > 1 ? 's' : ''} • {doneN} {l('สำเร็จ', 'done')}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {draftN > 0 && (
                    <Button
                      size="sm"
                      onClick={() => generateAllInGroup(g.groupId)}
                      className="bg-gradient-to-r from-[#FFB300] to-[#FF8C00] text-black font-semibold"
                    >
                      <Play className="h-4 w-4 mr-1" />
                      {l('สร้างทั้งหมด', 'Generate all')} ({draftN})
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setGroupToDelete(g.groupId)}
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    {l('ลบทั้งหมด', 'Delete all')}
                  </Button>
                </div>
              </div>

              {/* Tasks — horizontal scroll on small, grid on large */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {g.tasks.map((t) => (
                  <TaskCard
                    key={t.localId}
                    task={t}
                    index={t.taskNumber}
                    language={language}
                    onUpdate={(patch) => updateTask(g.groupId, t.localId, patch)}
                    onDelete={() => deleteTask(g.groupId, t.localId)}
                    onGenerate={() => generateOne(g.groupId, t.localId)}
                    onPickFiles={(fl) => handleFiles(g.groupId, t.localId, fl)}
                    onRemoveFile={(i) => removeFile(g.groupId, t.localId, i)}
                    isResolutionDisabled={isResolutionDisabled}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Delete-group confirmation dialog */}
      <AlertDialog open={groupToDelete !== null} onOpenChange={(open) => !open && setGroupToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{l('ลบกรอบนี้ทั้งหมด?', 'Delete this entire group?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {l(
                'การลบจะนำ task ทั้งหมดในกรอบนี้ออกจากเครื่องและฐานข้อมูล ไม่สามารถกู้คืนได้',
                'All tasks in this group will be permanently removed from the database and your device. This cannot be undone.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{l('ยกเลิก', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (groupToDelete) deleteGroup(groupToDelete);
                setGroupToDelete(null);
              }}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {l('ลบ', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {confirmDialog}
    </div>
  );
};

// ============================================================================
// Task Card Component
// ============================================================================
interface TaskCardProps {
  task: TaskDraft;
  index: number;
  language: string;
  onUpdate: (patch: Partial<TaskDraft>) => void;
  onDelete: () => void;
  onGenerate: () => void;
  onPickFiles: (fl: FileList | null) => void;
  onRemoveFile: (idx: number) => void;
  isResolutionDisabled: (r: Resolution, aspect: Aspect) => boolean;
}

const TaskCard = ({
  task,
  index,
  language,
  onUpdate,
  onDelete,
  onGenerate,
  onPickFiles,
  onRemoveFile,
  isResolutionDisabled,
}: TaskCardProps) => {
  const l = (th: string, en: string) => (language === 'th' ? th : en);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const isDraft = task.status === 'draft';
  const isPending = task.status === 'pending';
  const isSuccess = task.status === 'success';
  const isFailed = task.status === 'failed';

  return (
    <div className="rounded-xl border border-border/60 bg-background/30 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Task #{index}</h3>
        {isPending && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-[#FFB300]/40 bg-[#FFB300]/10 text-[#FFB300]">
            <Loader2 className="h-3 w-3 animate-spin" />
            {l('กำลังสร้าง...', 'Generating...')}
          </span>
        )}
        {isSuccess && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-green-500/40 bg-green-500/10 text-green-500">
            ✓ {l('สำเร็จ', 'Done')}
          </span>
        )}
        {isFailed && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-400">
            ✕ {l('ไม่สำเร็จ', 'Failed')}
          </span>
        )}
      </div>

      {/* Step progress indicator — for success/failed only (pending shows it after inputs) */}
      {(isSuccess || isFailed) && <StepProgress task={task} language={language} />}

      {/* Result preview — frame fits the actual image natural size */}
      {isSuccess && task.resultUrl && (
        <div className="rounded-lg overflow-hidden bg-black/40">
          <img src={task.resultUrl} alt={task.prompt} className="block w-full h-auto" />
        </div>
      )}

      {/* Pending state — show inputs FIRST, then step progress (like Idol Template) */}
      {isPending && (
        <div className="space-y-2">
          {/* Mode + Aspect + Resolution chips */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {task.mode === 'text-to-image' ? 'Text → Image' : 'Image → Image'}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {task.aspect}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {task.resolution}
            </span>
          </div>

          {/* Input images thumbnails (image-to-image only) */}
          {task.mode === 'image-to-image' && task.filePreviews.length > 0 && (
            <div className="flex gap-1 overflow-x-auto">
              {task.filePreviews.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="h-16 w-auto rounded border border-zinc-700 opacity-70 shrink-0"
                />
              ))}
            </div>
          )}

          {/* Prompt readonly */}
          {task.prompt && (
            <div className="rounded-md bg-zinc-800/50 border border-zinc-700/60 p-2">
              <p className="text-[11px] text-zinc-300 leading-relaxed line-clamp-4">
                {task.prompt}
              </p>
            </div>
          )}

          {/* Step progress goes AFTER inputs (like Idol) */}
          <StepProgress task={task} language={language} />

          {/* Inline loading row */}
          <div className="flex items-center justify-center gap-2 py-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FFB300]" />
            <span>{l('1-3 นาที', '1-3 min')}</span>
          </div>
        </div>
      )}

      {/* Failed state */}
      {isFailed && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2">
          <p className="text-xs text-red-400">{task.error || l('สร้างไม่สำเร็จ', 'Failed')}</p>
        </div>
      )}

      {/* Caption — show prompt below result for success/failed (pending shows it inline) */}
      {(isSuccess || isFailed) && task.prompt && (
        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{task.prompt}</p>
      )}

      {/* Form (only for draft) */}
      {isDraft && (
        <>
          <Tabs value={task.mode} onValueChange={(v) => onUpdate({ mode: v as Mode })}>
            <TabsList className="grid grid-cols-2 w-full h-8">
              <TabsTrigger value="text-to-image" className="text-[11px]">Text → Image</TabsTrigger>
              <TabsTrigger value="image-to-image" className="text-[11px]">Image → Image</TabsTrigger>
            </TabsList>

            <TabsContent value="image-to-image" className="mt-2 space-y-1.5">
              <label className="text-[10px] font-medium block text-muted-foreground">
                {l('รูปภาพต้นฉบับ (สูงสุด 16)', 'Input images (max 16)')}
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-square border-2 border-dashed border-border rounded-lg hover:border-[#FFB300]/50 hover:bg-[#FFB300]/5 transition-colors flex flex-col items-center justify-center gap-1"
              >
                {task.filePreviews.length > 0 ? (
                  <div className="relative w-full h-full">
                    <img src={task.filePreviews[0]} alt="" className="w-full h-full object-cover rounded-md" />
                    {task.files.length > 1 && (
                      <span className="absolute top-1 right-1 text-[9px] px-1.5 py-0.5 rounded bg-black/70 text-white">
                        +{task.files.length - 1}
                      </span>
                    )}
                  </div>
                ) : (
                  <>
                    <Upload className="h-5 w-5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">{l('เลือกรูป', 'Pick image')}</span>
                  </>
                )}
              </button>
              {task.filePreviews.length > 1 && (
                <div className="grid grid-cols-4 gap-1">
                  {task.filePreviews.slice(1).map((src, i) => (
                    <div key={i} className="relative aspect-square rounded overflow-hidden border border-border">
                      <img src={src} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => onRemoveFile(i + 1)}
                        className="absolute top-0 right-0 h-4 w-4 rounded-bl bg-black/70 text-white flex items-center justify-center"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-medium text-muted-foreground">Prompt</label>
              <span className="text-[9px] text-muted-foreground">{task.prompt.length}/20000</span>
            </div>
            <Textarea
              value={task.prompt}
              onChange={(e) => onUpdate({ prompt: e.target.value })}
              placeholder={l('อธิบายภาพที่ต้องการสร้าง...', 'Describe the image...')}
              rows={3}
              maxLength={20000}
              className="resize-none text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 block">
                {l('สัดส่วน', 'Aspect')}
              </label>
              <Select value={task.aspect} onValueChange={(v) => onUpdate({ aspect: v as Aspect })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASPECTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 block">
                {l('ความละเอียด', 'Resolution')}
              </label>
              <Select value={task.resolution} onValueChange={(v) => onUpdate({ resolution: v as Resolution })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESOLUTIONS.map((r) => (
                    <SelectItem key={r} value={r} disabled={isResolutionDisabled(r, task.aspect)}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Bottom action row: small Generate + trash */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={onGenerate}
              disabled={!task.prompt.trim() || (task.mode === 'image-to-image' && task.files.length === 0)}
              size="sm"
              className="bg-gradient-to-r from-[#FFB300] to-[#FF8C00] hover:from-[#FFC533] hover:to-[#FFA033] text-black font-bold h-8 px-4"
            >
              <Play className="h-3.5 w-3.5 mr-1" />
              {l('สร้าง', 'Generate')}
            </Button>
            <button
              type="button"
              onClick={onDelete}
              className="h-8 w-8 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </>
      )}

      {/* For non-draft: View + Download (when success) on left, delete on right */}
      {!isDraft && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {isSuccess && task.resultUrl && (
              <>
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {l('ดูผลงาน', 'View')}
                </button>
                <a
                  href={task.dropboxUrl || task.resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-[#FFB300] hover:bg-[#FFB300]/10 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  {l('ดาวน์โหลด', 'Download')}
                </a>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Result detail modal — matches Idol Template style */}
      {task.resultUrl && (
        <Dialog open={lightboxOpen} onOpenChange={(v) => !v && setLightboxOpen(false)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-700">
            <DialogHeader>
              <DialogTitle className="text-base">
                Task #{index} — {task.prompt ? task.prompt.slice(0, 60) + (task.prompt.length > 60 ? '…' : '') : l('ไม่มีชื่อ', 'Untitled')}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-300">
                <ImageIcon className="h-4 w-4" />
                {l('ภาพ', 'Image')} (1 {l('ฉาก', 'scene')})
              </div>
              <div className="relative rounded-lg overflow-hidden border border-zinc-700 inline-block">
                <img
                  src={task.resultUrl}
                  alt={task.prompt || 'result'}
                  className="block w-auto h-auto max-w-full max-h-[60vh] object-contain"
                />
                <a
                  href={task.dropboxUrl || task.resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white hover:bg-[#FFB300] hover:text-black transition-colors"
                >
                  <Download className="h-4 w-4" />
                </a>
                <div className="absolute bottom-1 left-1 text-xs bg-black/70 text-white px-1.5 py-0.5 rounded">
                  {l('ฉาก', 'Scene')} 1
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Activity Log — collapsible */}
      {task.logs.length > 0 && <ActivityLogPanel logs={task.logs} />}
    </div>
  );
};

// ============================================================================
// Step Progress Indicator (3 steps for image generation)
// ============================================================================
const StepProgress = ({ task, language }: { task: TaskDraft; language: string }) => {
  const l = (th: string, en: string) => (language === 'th' ? th : en);

  type StepState = 'done' | 'active' | 'pending' | 'failed';
  let s1: StepState = 'pending';
  let s2: StepState = 'pending';
  let s3: StepState = 'pending';

  if (task.status === 'pending') {
    if (task.serverTaskId) {
      s1 = 'done';
      s2 = 'active';
    } else {
      s1 = 'active';
    }
  } else if (task.status === 'success') {
    s1 = 'done';
    s2 = 'done';
    s3 = 'done';
  } else if (task.status === 'failed') {
    if (task.serverTaskId) {
      s1 = 'done';
      s2 = 'failed';
    } else {
      s1 = 'failed';
    }
  }

  const steps: { state: StepState; label: string }[] = [
    { state: s1, label: l('AI Prompt', 'AI Prompt') },
    { state: s2, label: l('สร้างภาพ', 'Generate') },
    { state: s3, label: l('สำเร็จ', 'Done') },
  ];

  const dotClass = (st: StepState) => {
    switch (st) {
      case 'done': return 'bg-green-500 text-white';
      case 'active': return 'bg-[#FFB300] text-black';
      case 'failed': return 'bg-red-500 text-white';
      default: return 'bg-muted text-muted-foreground';
    }
  };
  const lineClass = (st: StepState) => (st === 'done' ? 'bg-green-500/50' : 'bg-border');

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-1.5 flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1 min-w-0">
            <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${dotClass(step.state)}`}>
              {step.state === 'done' ? '✓' : step.state === 'failed' ? '✕' : step.state === 'active' ? <Loader2 className="h-3 w-3 animate-spin" /> : i + 1}
            </div>
            <span className={`text-[9px] truncate ${step.state === 'pending' ? 'text-muted-foreground' : 'text-foreground/80'}`}>{step.label}</span>
          </div>
          {i < steps.length - 1 && <div className={`h-px flex-1 ${lineClass(step.state)}`} />}
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// Activity Log Panel
// ============================================================================
const ActivityLogPanel = ({ logs }: { logs: ActivityLog[] }) => {
  const [open, setOpen] = useState(false);
  const messageColor = (lvl: LogLevel) => {
    switch (lvl) {
      case 'success': return 'text-green-400';
      case 'warning': return 'text-amber-400';
      case 'error': return 'text-red-400';
      default: return 'text-zinc-500';
    }
  };

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', { hour12: false });

  return (
    <div className="rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="text-xs">Log</span>
      </button>
      {open && (
        <div className="bg-zinc-950/50 rounded-md border border-zinc-800 max-h-[180px] overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {logs.map((log, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 text-[11px] py-0.5 px-1 font-mono ${messageColor(log.level)}`}
              >
                <span className="text-zinc-600 shrink-0">{fmtTime(log.timestamp)}</span>
                <span className="break-all">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default GPTImage2;
