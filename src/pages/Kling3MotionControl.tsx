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
  Video as VideoIcon,
  Image as ImageIcon,
  Loader2,
  Upload,
  X,
  Download,
  Trash2,
  Plus,
  Play,
  ChevronDown,
  Eye,
  Wand2,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScheduler } from '@/contexts/SchedulerContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useGenerateConfirm } from '@/components/common/GenerateConfirmDialog';
import { quoteKlingVideo, buildQuote } from '@/lib/generationPricing';

type Mode = '720p' | '1080p';
type Orientation = 'video' | 'image';
type BgSource = 'input_video' | 'input_image';
type TaskStatus = 'draft' | 'pending' | 'success' | 'failed';
type LogLevel = 'info' | 'success' | 'warning' | 'error';

interface ActivityLog {
  timestamp: number;
  level: LogLevel;
  message: string;
}

interface TaskDraft {
  localId: string;
  taskNumber: number;
  prompt: string;
  mode: Mode;
  orientation: Orientation;
  bgSource: BgSource;
  imageFile: File | null;
  imagePreview: string;
  videoFile: File | null;
  videoPreview: string;
  videoDuration?: number; // วินาทีของวิดีโอ motion — ใช้คิดเครดิต (Kling = 20/วิ)
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
  channelId: string;
  tasks: TaskDraft[];
}

const MAX_TASKS_PER_CREATE = 5;

const newDraft = (taskNumber: number): TaskDraft => ({
  localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  taskNumber,
  prompt: '',
  mode: '720p',
  orientation: 'video',
  bgSource: 'input_video',
  imageFile: null,
  imagePreview: '',
  videoFile: null,
  videoPreview: '',
  status: 'draft',
  logs: [],
});

const Kling3MotionControl = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const l = (th: string, en: string) => (language === 'th' ? th : en);
  const { requestConfirm, dialog: confirmDialog } = useGenerateConfirm();

  const LS_KEY = 'kling3_groups_v1';
  const { channels, fetchChannels } = useScheduler();
  const [createCount, setCreateCount] = useState(1);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);
  const [groups, setGroupsRaw] = useState<TaskGroup[]>(() => {
    // Restore from localStorage on first render (synchronous → no flicker)
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as TaskGroup[];
      // Migrate legacy mode values: 'std' → '720p', 'pro' → '1080p'
      const migrateMode = (m: any): Mode => {
        if (m === '720p' || m === '1080p') return m;
        if (m === 'std' || m === 'standard') return '720p';
        if (m === 'pro' || m === 'professional') return '1080p';
        return '720p';
      };
      // Keep persisted previews only if they're remote URLs (http/https), drop blob URLs
      const safePreview = (p: any): string => {
        if (typeof p !== 'string') return '';
        if (p.startsWith('blob:')) return '';
        return p;
      };
      return parsed.map((g) => ({
        ...g,
        tasks: g.tasks.map((t) => ({
          ...t,
          mode: migrateMode((t as any).mode),
          // Files can't be persisted, but persisted remote-URL previews can stay
          imageFile: null,
          videoFile: null,
          imagePreview: safePreview((t as any).imagePreview),
          videoPreview: safePreview((t as any).videoPreview),
        })),
      }));
    } catch {
      return [];
    }
  });

  useEffect(() => {
    fetchChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist groups to localStorage on every change (skip File objects + blob: URLs)
  useEffect(() => {
    try {
      const serializable = groups.map((g) => ({
        ...g,
        tasks: g.tasks.map((t) => {
          const { imageFile: _if, videoFile: _vf, ...rest } = t;
          // Drop blob URLs (only valid in current page session). Keep http(s) URLs from backend.
          const persistImage = t.imagePreview && !t.imagePreview.startsWith('blob:') ? t.imagePreview : '';
          const persistVideo = t.videoPreview && !t.videoPreview.startsWith('blob:') ? t.videoPreview : '';
          return {
            ...rest,
            imageFile: null,
            videoFile: null,
            imagePreview: persistImage,
            videoPreview: persistVideo,
          };
        }),
      }));
      localStorage.setItem(LS_KEY, JSON.stringify(serializable));
    } catch {}
  }, [groups]);

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

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      groups.forEach((g) =>
        g.tasks.forEach((t) => {
          if (t.imagePreview && t.imagePreview.startsWith('blob:')) URL.revokeObjectURL(t.imagePreview);
          if (t.videoPreview && t.videoPreview.startsWith('blob:')) URL.revokeObjectURL(t.videoPreview);
        })
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-load history on mount, group by created_at proximity
  useEffect(() => {
    (async () => {
      try {
        const { items } = await api.kling3MotionControlHistory({ limit: 200 });
        if (!items || items.length === 0) return;
        const sorted = [...items].sort(
          (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const GROUP_GAP_MS = 5000;
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
          // Reconstruct logs based on persisted state
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
            logs.push({ timestamp: updatedTs, level: 'success', message: `✅ สร้างวิดีโอสำเร็จ` });
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
            prompt: row.prompt || '',
            mode: (row.mode as Mode) || '720p',
            orientation: (row.character_orientation as Orientation) || 'video',
            bgSource: (row.background_source as BgSource) || 'input_video',
            imageFile: null,
            imagePreview: row.input_url || '',
            videoFile: null,
            videoPreview: row.video_url || '',
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
        // Merge with existing local state — backend wins for matching serverDbId, otherwise keep local
        setGroupsRaw((prev) => {
          const existingIds = new Set(
            prev.flatMap((g) => g.tasks.map((t) => t.serverDbId).filter(Boolean) as number[])
          );
          // Pick groups from backend that have at least one task NOT already in local
          const newGroups = loadedGroups
            .reverse()
            .map((g) => ({
              ...g,
              tasks: g.tasks.filter((t) => !t.serverDbId || !existingIds.has(t.serverDbId)),
            }))
            .filter((g) => g.tasks.length > 0);
          // Update existing local tasks with backend status (in case server progressed while user was away)
          const backendById = new Map<number, TaskDraft>();
          loadedGroups.forEach((g) => g.tasks.forEach((t) => { if (t.serverDbId) backendById.set(t.serverDbId, t); }));
          const mergedExisting = prev.map((g) => ({
            ...g,
            tasks: g.tasks.map((t) => {
              if (t.serverDbId && backendById.has(t.serverDbId)) {
                const bk = backendById.get(t.serverDbId)!;
                return {
                  ...t,
                  status: bk.status,
                  resultUrl: bk.resultUrl || t.resultUrl,
                  dropboxUrl: bk.dropboxUrl || t.dropboxUrl,
                  error: bk.error || t.error,
                  logs: t.logs.length > 0 ? t.logs : bk.logs,
                  // Restore input/video previews from backend (e.g. after refresh, blob URLs are lost)
                  imagePreview: t.imagePreview || bk.imagePreview || '',
                  videoPreview: t.videoPreview || bk.videoPreview || '',
                };
              }
              return t;
            }),
          }));
          // Sort all groups by createdAt DESC (newest first) for consistent ordering
          return [...newGroups, ...mergedExisting].sort((a, b) => b.createdAt - a.createdAt);
        });
      } catch (err) {
        console.error('Failed to load Kling 3.0 history:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-poll pending tasks
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
          const { task } = await api.kling3MotionControlStatus(t.serverTaskId!);
          const newStatus = task.status as TaskStatus;
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
                        message: `✅ สร้างวิดีโอสำเร็จ`,
                      });
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
  }, [
    groups
      .map((g) => g.tasks.map((t) => `${t.localId}:${t.status}:${t.serverTaskId || ''}`).join('|'))
      .join('||'),
  ]);

  const addGroup = () => {
    const n = Math.max(1, Math.min(MAX_TASKS_PER_CREATE, createCount));
    const newGroup: TaskGroup = {
      groupId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      channelId: selectedChannelId,
      tasks: Array.from({ length: n }, () => newDraft(0)),
    };
    setGroups((prev) => [newGroup, ...prev]);
  };

  const deleteGroup = (groupId: string) => {
    setGroups((prev) => {
      const target = prev.find((g) => g.groupId === groupId);
      target?.tasks.forEach((t) => {
        if (t.imagePreview.startsWith('blob:')) URL.revokeObjectURL(t.imagePreview);
        if (t.videoPreview.startsWith('blob:')) URL.revokeObjectURL(t.videoPreview);
      });
      return prev.filter((g) => g.groupId !== groupId);
    });
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
    if (t?.serverDbId) {
      try {
        await api.kling3MotionControlDelete(t.serverDbId);
      } catch (err: any) {
        // Silent — proceed with local removal anyway
        console.error('Delete on server failed:', err?.message);
      }
    }
    setGroups((prev) =>
      prev
        .map((g) => {
          if (g.groupId !== groupId) return g;
          const target = g.tasks.find((t) => t.localId === localId);
          if (target?.imagePreview.startsWith('blob:')) URL.revokeObjectURL(target.imagePreview);
          if (target?.videoPreview.startsWith('blob:')) URL.revokeObjectURL(target.videoPreview);
          return { ...g, tasks: g.tasks.filter((t) => t.localId !== localId) };
        })
        .filter((g) => g.tasks.length > 0)
    );
  };

  // Validate dimensions + aspect ratio per KIE doc:
  //   > 340px, aspect 2:5 (0.4) to 5:2 (2.5)
  const validateDimensions = (w: number, h: number): string | null => {
    if (w < 340 || h < 340) {
      return l(
        `ขนาดต้อง > 340px (ปัจจุบัน ${w}×${h})`,
        `Size must be > 340px (current ${w}×${h})`
      );
    }
    const aspect = w / h;
    if (aspect < 0.4 || aspect > 2.5) {
      return l(
        `สัดส่วนต้องอยู่ระหว่าง 2:5–5:2 (ปัจจุบัน ${aspect.toFixed(2)})`,
        `Aspect ratio must be 2:5–5:2 (current ${aspect.toFixed(2)})`
      );
    }
    return null;
  };

  const handleImageFile = (groupId: string, localId: string, f: File | null) => {
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    if (t?.imagePreview.startsWith('blob:')) URL.revokeObjectURL(t.imagePreview);
    if (!f) {
      updateTask(groupId, localId, { imageFile: null, imagePreview: '' });
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error(l('รูปต้องไม่เกิน 10MB', 'Image must be ≤ 10MB'));
      return;
    }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const err = validateDimensions(img.naturalWidth, img.naturalHeight);
      if (err) {
        URL.revokeObjectURL(url);
        toast.error(err);
        return;
      }
      updateTask(groupId, localId, { imageFile: f, imagePreview: url });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error(l('โหลดรูปไม่ได้', 'Cannot load image'));
    };
    img.src = url;
  };

  const handleVideoFile = (groupId: string, localId: string, f: File | null) => {
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    if (t?.videoPreview.startsWith('blob:')) URL.revokeObjectURL(t.videoPreview);
    if (!f) {
      updateTask(groupId, localId, { videoFile: null, videoPreview: '' });
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      toast.error(l('วิดีโอต้องไม่เกิน 100MB', 'Video must be ≤ 100MB'));
      return;
    }
    const url = URL.createObjectURL(f);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.onloadedmetadata = () => {
      const dimErr = validateDimensions(vid.videoWidth, vid.videoHeight);
      if (dimErr) {
        URL.revokeObjectURL(url);
        toast.error(dimErr);
        return;
      }
      const dur = vid.duration;
      if (dur < 3 || dur > 30) {
        URL.revokeObjectURL(url);
        toast.error(
          l(
            `ความยาวต้องอยู่ระหว่าง 3–30 วินาที (ปัจจุบัน ${dur.toFixed(1)}s)`,
            `Duration must be 3–30s (current ${dur.toFixed(1)}s)`
          )
        );
        return;
      }
      updateTask(groupId, localId, { videoFile: f, videoPreview: url, videoDuration: dur });
    };
    vid.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error(l('โหลดวิดีโอไม่ได้', 'Cannot load video'));
    };
    vid.src = url;
  };

  const runGenerateOne = async (groupId: string, localId: string) => {
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    if (!t) return;
    if (!t.imageFile) {
      toast.error(l('กรุณาเลือกรูปอ้างอิง', 'Please select reference image'));
      return;
    }
    if (!t.videoFile) {
      toast.error(l('กรุณาเลือกวิดีโอ motion', 'Please select motion video'));
      return;
    }
    appendLog(groupId, localId, 'info', `🚀 Starting task #${t.taskNumber}`);
    updateTask(groupId, localId, { status: 'pending', startedAt: Date.now() });
    try {
      const { task } = await api.kling3MotionControlGenerate({
        prompt: t.prompt.trim() || undefined,
        image: t.imageFile,
        video: t.videoFile,
        mode: t.mode,
        character_orientation: t.orientation,
        background_source: t.bgSource,
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

  const klingTaskQuote = (t: TaskDraft) =>
    quoteKlingVideo({ taskLabel: `Task #${t.taskNumber}`, durationSec: Math.round(t.videoDuration || 5), count: 1 });

  // เปิด popup ยืนยัน 1 task ก่อนสร้าง
  const generateOne = (groupId: string, localId: string) => {
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    if (!t) return;
    requestConfirm(buildQuote([klingTaskQuote(t)]), () => runGenerateOne(groupId, localId));
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
    requestConfirm(buildQuote(drafts.map(klingTaskQuote)), () => runGenerateAllInGroup(groupId));
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Compact header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/videos')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          {l('กลับ', 'Back')}
        </Button>
        <VideoIcon className="h-5 w-5 text-[#FFB300]" />
        <h1 className="text-xl md:text-2xl font-bold">Kling 3.0 Motion Control</h1>
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
              {l('จำนวนวิดีโอ', 'Number of videos')}
            </label>
            <Select value={String(createCount)} onValueChange={(v) => setCreateCount(parseInt(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: MAX_TASKS_PER_CREATE }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} {l('วิดีโอ', n > 1 ? 'videos' : 'video')}
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

      {/* Task groups */}
      <div className="space-y-4">
        {groups.map((g) => {
          const draftN = g.tasks.filter((t) => t.status === 'draft').length;
          const doneN = g.tasks.filter((t) => t.status === 'success').length;
          return (
            <div
              key={g.groupId}
              className="rounded-2xl border border-[#FFB300]/15 bg-card/40 shadow-lg shadow-black/20 p-4 md:p-5"
            >
              {/* Group header */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground font-medium">
                  Kling 3.0
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

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.tasks.map((t) => (
                  <TaskCard
                    key={t.localId}
                    task={t}
                    index={t.taskNumber}
                    language={language}
                    onUpdate={(patch) => updateTask(g.groupId, t.localId, patch)}
                    onDelete={() => deleteTask(g.groupId, t.localId)}
                    onGenerate={() => generateOne(g.groupId, t.localId)}
                    onPickImage={(f) => handleImageFile(g.groupId, t.localId, f)}
                    onPickVideo={(f) => handleVideoFile(g.groupId, t.localId, f)}
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
  onPickImage: (f: File | null) => void;
  onPickVideo: (f: File | null) => void;
}

const TaskCard = ({
  task,
  index,
  language,
  onUpdate,
  onDelete,
  onGenerate,
  onPickImage,
  onPickVideo,
}: TaskCardProps) => {
  const l = (th: string, en: string) => (language === 'th' ? th : en);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const isDraft = task.status === 'draft';
  const isPending = task.status === 'pending';
  const isSuccess = task.status === 'success';
  const isFailed = task.status === 'failed';

  const modeLabel = task.mode;
  const orientationLabel =
    task.orientation === 'video' ? l('Char: วิดีโอ', 'Char: video') : l('Char: รูป', 'Char: image');
  const bgLabel =
    task.bgSource === 'input_video' ? l('BG: วิดีโอ', 'BG: video') : l('BG: รูป', 'BG: image');

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

      {/* Inputs preview — shown for any non-draft state (keeps same layout across pending/success/failed) */}
      {!isDraft && (
        <div className="space-y-2">
          {/* Settings chips */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {modeLabel}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {orientationLabel}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {bgLabel}
            </span>
          </div>

          {/* Input previews (image + video thumbnails) — natural aspect ratio */}
          {(task.imagePreview || task.videoPreview) && (
            <div className="grid grid-cols-2 gap-1.5 items-start">
              {task.imagePreview && (
                <div className="relative rounded border border-zinc-700 overflow-hidden bg-black/30">
                  <img src={task.imagePreview} alt="" className="block w-full h-auto" />
                  <span className="absolute bottom-0.5 left-0.5 text-[9px] px-1 py-0 rounded bg-black/60 text-white">
                    {l('รูป', 'Image')}
                  </span>
                </div>
              )}
              {task.videoPreview && (
                <div className="relative rounded border border-zinc-700 overflow-hidden bg-black/30">
                  <video src={task.videoPreview} className="block w-full h-auto" muted preload="metadata" />
                  <span className="absolute bottom-0.5 left-0.5 text-[9px] px-1 py-0 rounded bg-black/60 text-white">
                    {l('วิดีโอ', 'Video')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Prompt readonly */}
          {task.prompt && (
            <div className="rounded-md bg-zinc-800/50 border border-zinc-700/60 p-2">
              <p className="text-[11px] text-zinc-300 leading-relaxed line-clamp-4">{task.prompt}</p>
            </div>
          )}

          {/* Step progress AFTER inputs (like Idol Template) */}
          <StepProgress task={task} language={language} />
        </div>
      )}

      {/* Result video preview (success only) */}
      {isSuccess && task.resultUrl && (
        <div className="rounded-lg overflow-hidden bg-black/40">
          <video
            src={task.resultUrl}
            className="block w-full h-auto"
            controls
            preload="metadata"
          />
        </div>
      )}

      {/* Pending — inline loading row */}
      {isPending && (
        <div className="flex items-center justify-center gap-2 py-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FFB300]" />
          <span>{l('3-10 นาที', '3-10 min')}</span>
        </div>
      )}

      {/* Failed state */}
      {isFailed && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2">
          <p className="text-xs text-red-400">{task.error || l('สร้างไม่สำเร็จ', 'Failed')}</p>
        </div>
      )}

      {/* Form (only for draft) */}
      {isDraft && (
        <>
          {/* Image upload */}
          <div>
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
              {l('รูปอ้างอิง', 'Reference image')} <span className="text-[9px]">≤10MB · &gt;340px · {l('สัดส่วน 2:5–5:2', 'aspect 2:5–5:2')}</span>
            </label>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              className="hidden"
              onChange={(e) => onPickImage(e.target.files?.[0] || null)}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => imageInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') imageInputRef.current?.click(); }}
              className={`w-full cursor-pointer border-2 border-dashed border-border rounded-lg hover:border-[#FFB300]/50 hover:bg-[#FFB300]/5 transition-colors relative overflow-hidden ${
                task.imagePreview ? '' : 'aspect-video flex flex-col items-center justify-center gap-1'
              }`}
            >
              {task.imagePreview ? (
                <>
                  <img src={task.imagePreview} alt="" className="block w-full h-auto" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onPickImage(null); }}
                    className="absolute top-1 right-1 z-10 h-6 w-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <>
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">{l('เลือกรูป', 'Pick image')}</span>
                </>
              )}
            </div>
          </div>

          {/* Video upload */}
          <div>
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
              {l('วิดีโอ Motion', 'Motion video')} <span className="text-[9px]">≤100MB · 3-30s · &gt;340px · {l('สัดส่วน 2:5–5:2', 'aspect 2:5–5:2')}</span>
            </label>
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => onPickVideo(e.target.files?.[0] || null)}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => videoInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') videoInputRef.current?.click(); }}
              className={`w-full cursor-pointer border-2 border-dashed border-border rounded-lg hover:border-[#FFB300]/50 hover:bg-[#FFB300]/5 transition-colors relative overflow-hidden ${
                task.videoPreview ? '' : 'aspect-video flex flex-col items-center justify-center gap-1'
              }`}
            >
              {task.videoPreview ? (
                <>
                  <video src={task.videoPreview} className="block w-full h-auto" muted loop autoPlay playsInline />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onPickVideo(null); }}
                    className="absolute top-1 right-1 z-10 h-6 w-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">{l('เลือกวิดีโอ', 'Pick video')}</span>
                </>
              )}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                <Wand2 className="h-3 w-3 text-[#FFB300]" />
                Prompt <span className="text-[9px]">{l('(ไม่บังคับ)', '(optional)')}</span>
              </label>
              <span className="text-[9px] text-muted-foreground">{task.prompt.length}/2500</span>
            </div>
            <Textarea
              value={task.prompt}
              onChange={(e) => onUpdate({ prompt: e.target.value })}
              placeholder={l('อธิบายเพิ่มเติม เช่น สีหน้า บรรยากาศ...', 'Describe expression, atmosphere...')}
              rows={2}
              maxLength={2500}
              className="resize-none text-xs"
            />
          </div>

          {/* Settings */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 block">
                {l('คุณภาพ', 'Quality')}
              </label>
              <Select value={task.mode} onValueChange={(v) => onUpdate({ mode: v as Mode })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 block">
                {l('ตัวละคร', 'Character')}
              </label>
              <Select value={task.orientation} onValueChange={(v) => onUpdate({ orientation: v as Orientation })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">{l('วิดีโอ', 'Video')}</SelectItem>
                  <SelectItem value="image">{l('รูป', 'Image')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 block">
                {l('ฉากหลัง', 'Background')}
              </label>
              <Select value={task.bgSource} onValueChange={(v) => onUpdate({ bgSource: v as BgSource })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="input_video">{l('วิดีโอ', 'Video')}</SelectItem>
                  <SelectItem value="input_image">{l('รูป', 'Image')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Bottom action row */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={onGenerate}
              disabled={!task.imageFile || !task.videoFile}
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

      {/* Non-draft action row: View + Download + Trash */}
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
                <VideoIcon className="h-4 w-4" />
                {l('วิดีโอ', 'Video')} (1 {l('ฉาก', 'scene')})
              </div>
              <div className="relative rounded-lg overflow-hidden border border-zinc-700 inline-block">
                <video
                  src={task.resultUrl}
                  controls
                  className="block w-auto h-auto max-w-full max-h-[60vh] object-contain bg-black"
                />
                <a
                  href={task.resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white hover:bg-[#FFB300] hover:text-black transition-colors z-10"
                >
                  <Download className="h-4 w-4" />
                </a>
                <div className="absolute bottom-1 left-1 text-xs bg-black/70 text-white px-1.5 py-0.5 rounded z-10">
                  {l('ฉาก', 'Scene')} 1
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Activity Log */}
      {task.logs.length > 0 && <ActivityLogPanel logs={task.logs} />}
    </div>
  );
};

// ============================================================================
// Step Progress Indicator (3 steps)
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
    { state: s2, label: l('สร้างวิดีโอ', 'Generate') },
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

export default Kling3MotionControl;
