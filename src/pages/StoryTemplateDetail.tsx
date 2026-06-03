import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { ArrowLeft, Image as ImageIcon, Plus, Play, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScheduler } from '@/contexts/SchedulerContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  MAX_TASKS_PER_CREATE,
  MODEL_CONFIG,
  getModelConfig,
  type Aspect,
  type LogLevel,
  type Mode,
  type Resolution,
  type ActivityLog,
  type TaskStatus,
} from '@/components/image/ImageTaskCard';
import {
  StoryTaskCard,
  newStoryDraft,
  type StoryImageSlot,
  type StoryTaskDraft,
  type StoryTaskGroup,
} from '@/components/image/StoryTaskCard';
import { StoryImagePickerModal, type StoryImageCategory } from '@/components/image/StoryImagePickerModal';

const TEMPLATE_DRAFT_KEY = 'storyTemplateDraft';

const IMAGE_MODELS: { key: string; label: string; available: boolean }[] = [
  { key: 'gpt-image-2', label: 'GPT Image 2', available: true },
  { key: 'grok-imagine', label: 'Grok Imagine', available: true },
  { key: 'nano-banana-2', label: 'Nano Banana 2', available: true },
  { key: 'nano-banana-pro', label: 'Nano Banana Pro', available: true },
];


const StoryTemplateDetail = () => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const templateSlug = slug || '';
  const [activeTemplate, setActiveTemplate] = useState<{
    slug: string;
    name: string;
    description?: string;
    thumbnailUrl?: string;
    nameTh?: string;
    prompt?: string; // legacy alias for system_prompt for type-compat
    system_prompt?: string;
  } | null>(null);

  useEffect(() => {
    if (!templateSlug) {
      setActiveTemplate(null);
      return;
    }
    let cancelled = false;
    api
      .getStoryTemplateBySlug(templateSlug)
      .then((row: any) => {
        if (cancelled) return;
        setActiveTemplate({
          slug: row.slug,
          name: row.name,
          nameTh: row.name,
          description: row.description,
          thumbnailUrl: row.thumbnail_url,
          system_prompt: row.system_prompt,
          prompt: row.system_prompt, // alias so existing checks still work
        });
      })
      .catch(() => {
        if (!cancelled) setActiveTemplate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [templateSlug]);
  const { language } = useLanguage();
  const l = (th: string, en: string) => (language === 'th' ? th : en);

  const { channels, fetchChannels } = useScheduler();
  const [sceneCount, setSceneCount] = useState(1); // จำนวนฉาก = frames in the story (1 ฉาก = 1 ภาพ; ภาพชุดนี้นำไปต่อเป็นวิดีโอ)
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('gpt-image-2');
  const [videoDuration, setVideoDuration] = useState<number>(10); // 5/10/15/20/25/30 — 10 is the safest (proven natural speech)
  const [videoResolution, setVideoResolution] = useState<string>('720p');
  // Persist state per templateSlug so refresh doesn't drop work-in-progress
  const stateKey = `storyTemplate:state:${templateSlug || 'none'}`;
  const loadPersisted = () => {
    try {
      const raw = localStorage.getItem(stateKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const persisted = typeof window !== 'undefined' ? loadPersisted() : null;
  const [groups, setGroupsRaw] = useState<StoryTaskGroup[]>(persisted?.groups || []);
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);
  // Phase 5d — group-level final video state from backend
  const [groupBackend, setGroupBackend] = useState<Record<string, { status: string; final_video_url?: string; error?: string }>>({});
  // Phase 6 — TOPIC per group (1 group = 1 story = 1 topic shared across scenes)
  const [groupTopics, setGroupTopics] = useState<Record<string, string>>(persisted?.groupTopics || {});
  // Phase 6b — AI story options state
  const [aiOptionsByGroup, setAiOptionsByGroup] = useState<Record<string, any[]>>({});
  const [aiLoadingByGroup, setAiLoadingByGroup] = useState<Record<string, boolean>>({});
  const [aiPickerGroupId, setAiPickerGroupId] = useState<string | null>(null);
  const [selectedOptionByGroup, setSelectedOptionByGroup] = useState<Record<string, number>>(persisted?.selectedOptionByGroup || {});
  const [compositeByGroup, setCompositeByGroup] = useState<Record<string, { url?: string; loading?: boolean; error?: string }>>({});
  const [pickerTarget, setPickerTarget] = useState<{
    groupId: string;
    localId: string;
    slot: StoryImageSlot;
  } | null>(null);

  const renumberDrafts = (gs: StoryTaskGroup[]): StoryTaskGroup[] => {
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

  const setGroups = (updater: StoryTaskGroup[] | ((prev: StoryTaskGroup[]) => StoryTaskGroup[])) => {
    setGroupsRaw((prev) => {
      const next = typeof updater === 'function' ? (updater as any)(prev) : updater;
      return renumberDrafts(next);
    });
  };

  // Inject template prompt as a draft when arriving from the template list
  useEffect(() => {
    if (!templateSlug) return;
    try {
      const raw = sessionStorage.getItem(TEMPLATE_DRAFT_KEY);
      if (!raw) return;

      const draft = JSON.parse(raw);
      if (draft.templateSlug && draft.templateSlug !== templateSlug) return;

      const prompt = typeof draft.prompt === 'string' ? draft.prompt.trim() : '';
      if (!prompt) return;

      const aspect = (draft.aspect as Aspect) || 'auto';
      const resolution = (draft.resolution as Resolution) || '1K';
      const templateName = draft.templateName || templateSlug;
      // Templates are authored against GPT Image 2; lock the injected draft to that model.
      const task: StoryTaskDraft = { ...newStoryDraft(0, 'gpt-image-2'), prompt, aspect, resolution };

      setGroups((prev) => {
        const alreadyLoaded = prev.some(
          (group) =>
            group.groupId.startsWith(`template-${templateSlug}`) ||
            group.tasks.some((existing) => existing.status === 'draft' && existing.prompt === prompt)
        );
        if (alreadyLoaded) return prev;
        return [
          {
            groupId: `template-${templateSlug}-${Date.now()}`,
            createdAt: Date.now(),
            channelId: selectedChannelId,
            tasks: [task],
          },
          ...prev,
        ];
      });

      sessionStorage.removeItem(TEMPLATE_DRAFT_KEY);
      toast.success(language === 'th' ? `เพิ่ม ${templateName} ลง Task แล้ว` : `${templateName} added to tasks`);
    } catch (err) {
      console.error('Failed to load image template draft:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateSlug, selectedChannelId, language]);

  useEffect(() => {
    fetchChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconstruct groups + tasks from DB on mount (Viral-style — drafts live in DB)
  useEffect(() => {
    if (!templateSlug) return;
    let cancelled = false;
    api
      .storyTemplateListGroups(templateSlug)
      .then(({ groups: dbGroups, tasks: dbTasks }) => {
        if (cancelled) return;
        const tasksByGroup: Record<string, any[]> = {};
        for (const t of dbTasks || []) {
          if (!tasksByGroup[t.group_id]) tasksByGroup[t.group_id] = [];
          tasksByGroup[t.group_id].push(t);
        }
        const restored: StoryTaskGroup[] = (dbGroups || []).map((g: any) => ({
          groupId: g.group_id,
          createdAt: new Date(g.created_at).getTime(),
          channelId: g.channel_id ? String(g.channel_id) : '',
          tasks: (tasksByGroup[g.group_id] || []).map((row: any, idx: number) => {
            const imgs = row.image_inputs || {};
            const txts = row.text_values || {};
            const ts = row.created_at ? new Date(row.created_at).getTime() : Date.now();
            const updatedTs = row.updated_at ? new Date(row.updated_at).getTime() : ts;
            // Reconstruct logs from row state (mirrors GPT Image 2 history loader)
            const logs: ActivityLog[] = [];
            if (row.status !== 'draft') {
              logs.push({ timestamp: ts, level: 'info', message: `🚀 Starting task #${row.scene_number || idx + 1}` });
              if (row.task_id) {
                logs.push({ timestamp: ts + 1, level: 'info', message: `🔄 Task ID: ${row.task_id} — รอประมวลผล...` });
              }
              if (row.status === 'success') {
                logs.push({ timestamp: updatedTs, level: 'success', message: `✅ สร้างภาพสำเร็จ` });
                if (row.dropbox_url) {
                  logs.push({ timestamp: updatedTs + 1, level: 'success', message: `📦 บันทึกภาพไป Dropbox สำเร็จ` });
                }
              } else if (row.status === 'failed') {
                logs.push({ timestamp: updatedTs, level: 'error', message: `❌ ภาพล้มเหลว: ${row.error || 'unknown'}` });
              } else if (row.status === 'pending') {
                logs.push({ timestamp: updatedTs, level: 'info', message: `⏳ ยังประมวลผลอยู่...` });
              }
              if (row.video_status === 'pending') {
                logs.push({ timestamp: updatedTs + 2, level: 'info', message: `🎬 เริ่มสร้างวิดีโอ...` });
              } else if (row.video_status === 'success') {
                logs.push({ timestamp: updatedTs + 2, level: 'success', message: `🎉 วิดีโอเสร็จ!` });
              } else if (row.video_status === 'failed') {
                logs.push({ timestamp: updatedTs + 2, level: 'error', message: `❌ วิดีโอล้มเหลว: ${row.error || 'unknown'}` });
              }
            }
            return {
              ...newStoryDraft(idx + 1, row.model || 'gpt-image-2'),
              localId: `loaded-story-${row.id}`,
              serverDbId: row.id,
              serverTaskId: row.task_id || undefined,
              prompt: row.prompt || '',
              aspect: row.aspect_ratio || 'auto',
              resolution: row.resolution || '1K',
              status: (row.status || 'draft') as TaskStatus,
              resultUrl: row.result_url || undefined,
              dropboxUrl: row.dropbox_url || undefined,
              error: row.error || undefined,
              videoUrl: row.video_url || undefined,
              videoStatus: (row.video_status as StoryTaskDraft['videoStatus']) || undefined,
              currentStep: (row.current_step as StoryTaskDraft['currentStep']) ?? null,
              mainImage: imgs.mainImage || undefined,
              outfitImage: imgs.outfitImage || undefined,
              outfitText: txts.outfitText || undefined,
              backgroundImage: imgs.backgroundImage || undefined,
              backgroundText: txts.backgroundText || undefined,
              objectImage: imgs.objectImage || undefined,
              variables: Array.isArray(row.variables)
                ? row.variables
                : row.variables && typeof row.variables === 'object'
                  ? Object.entries(row.variables).map(([name, value]) => ({ name, value: String(value ?? '') }))
                  : [],
              model: row.model || undefined,
              taskNumber: row.scene_number || idx + 1,
              startedAt: ts,
              logs,
            };
          }),
        }));
        setGroupsRaw(restored);
        const topics: Record<string, string> = {};
        const selOpts: Record<string, number> = {};
        const composites: Record<string, { url?: string; loading?: boolean; error?: string }> = {};
        for (const g of dbGroups || []) {
          if (g.topic) topics[g.group_id] = g.topic;
          if (g.selected_option_id) selOpts[g.group_id] = g.selected_option_id;
          if (g.options?.options) {
            setAiOptionsByGroup((prev) => ({ ...prev, [g.group_id]: g.options.options }));
          }
          if (g.composite_image_url) {
            composites[g.group_id] = { url: g.composite_image_url };
          }
        }
        setGroupTopics(topics);
        setSelectedOptionByGroup(selOpts);
        setCompositeByGroup(composites);
      })
      .catch((err) => console.warn('list groups failed:', err?.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateSlug]);

  // (Deprecated draft-state save removed — backend is now authoritative via /groups + /tasks PATCH endpoints)

  // (Old /history loader removed — Viral-style /groups loader above is now the single source of truth.
  // Keeping both caused duplicate "loaded-story-*" groups to appear alongside real groups.)

  useEffect(() => {
    return () => {
      groups.forEach((g) => g.tasks.forEach((t) => t.filePreviews.forEach(URL.revokeObjectURL)));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pending: { groupId: string; task: StoryTaskDraft }[] = [];
    groups.forEach((g) =>
      g.tasks.forEach((t) => {
        // Keep polling while either image OR video stage is in flight
        const imageInFlight = t.status === 'pending';
        const videoInFlight = t.status === 'success' && t.videoStatus !== 'success' && t.videoStatus !== 'failed';
        if ((imageInFlight || videoInFlight) && t.serverTaskId) {
          pending.push({ groupId: g.groupId, task: t });
        }
      })
    );
    if (pending.length === 0) return;
    const tick = async () => {
      for (const { groupId, task: t } of pending) {
        try {
          const { task } = await api.storyTemplateStatus(t.serverTaskId!);
          const newStatus = task.status as TaskStatus;
          setGroups((prev) =>
            prev.map((g) => {
              if (g.groupId !== groupId) return g;
              return {
                ...g,
                tasks: g.tasks.map((p) => {
                  if (p.localId !== t.localId) return p;
                  const statusChanged = p.status !== newStatus;
                  const videoStatusChanged = (p.videoStatus || null) !== (task.video_status || null);
                  const newLogs = [...p.logs];
                  const elapsedSec = p.startedAt ? Math.round((Date.now() - p.startedAt) / 1000) : 0;
                  if (statusChanged && newStatus === 'success') {
                    const t0 = Date.now();
                    newLogs.push({ timestamp: t0, level: 'success', message: `✅ สร้างภาพสำเร็จ` });
                    if (task.dropbox_url) {
                      newLogs.push({ timestamp: t0 + 1, level: 'success', message: `📦 บันทึกภาพไป Dropbox สำเร็จ` });
                    }
                  } else if (statusChanged && newStatus === 'failed') {
                    newLogs.push({ timestamp: Date.now(), level: 'error', message: `❌ ภาพล้มเหลว: ${task.error || 'unknown'}` });
                  }
                  if (videoStatusChanged) {
                    if (task.video_status === 'pending') {
                      newLogs.push({ timestamp: Date.now(), level: 'info', message: `🎬 เริ่มสร้างวิดีโอ...` });
                    } else if (task.video_status === 'success') {
                      newLogs.push({ timestamp: Date.now(), level: 'success', message: `🎉 วิดีโอเสร็จ!` });
                    } else if (task.video_status === 'failed') {
                      newLogs.push({ timestamp: Date.now(), level: 'error', message: `❌ วิดีโอล้มเหลว: ${task.error || 'unknown'}` });
                    }
                  }
                  if (!statusChanged && !videoStatusChanged && newStatus === 'pending') {
                    newLogs.push({ timestamp: Date.now(), level: 'info', message: `⏳ ยังประมวลผลภาพอยู่... (${elapsedSec}s)` });
                  } else if (!statusChanged && !videoStatusChanged && newStatus === 'success' && task.video_status === 'pending') {
                    newLogs.push({ timestamp: Date.now(), level: 'info', message: `🎬 ยังสร้างวิดีโออยู่... (${elapsedSec}s)` });
                  }
                  return {
                    ...p,
                    status: newStatus,
                    resultUrl: task.result_url || p.resultUrl,
                    dropboxUrl: task.dropbox_url || p.dropboxUrl,
                    error: task.error || p.error,
                    videoUrl: task.video_url || p.videoUrl,
                    videoStatus: (task.video_status as StoryTaskDraft['videoStatus']) || p.videoStatus,
                    currentStep: (task.current_step as StoryTaskDraft['currentStep']) ?? p.currentStep,
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
  }, [groups.map((g) => g.tasks.map((t) => `${t.localId}:${t.status}:${t.videoStatus || ''}:${t.serverTaskId || ''}`).join('|')).join('||')]);

  // Group-level polling: poll group endpoint for final_video_url + sync task states
  useEffect(() => {
    const watchGroups = groups.filter((g) => {
      if (!g.groupId || g.groupId.startsWith('template-')) return false;
      // Allow polling when tasks have serverDbId (composite mode tasks have empty task_id but still have DB id)
      const allTasksHaveDbId = g.tasks.length > 0 && g.tasks.every((t) => !!t.serverDbId);
      if (!allTasksHaveDbId) return false;
      const cached = groupBackend[g.groupId];
      if (cached?.status === 'done') return false;
      return true;
    });
    if (watchGroups.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      for (const g of watchGroups) {
        try {
          const resp = await api.storyTemplateGroupStatus(g.groupId);
          if (cancelled) return;
          if (resp.group) {
            setGroupBackend((prev) => ({
              ...prev,
              [g.groupId]: {
                status: resp.group.status,
                final_video_url: resp.group.final_video_url || undefined,
                error: resp.group.error || undefined,
              },
            }));
          }
          // Sync per-task statuses (composite mode has no per-task task_id, so per-task /status doesn't fire)
          if (Array.isArray(resp.tasks)) {
            setGroups((prev) =>
              prev.map((grp) => {
                if (grp.groupId !== g.groupId) return grp;
                return {
                  ...grp,
                  tasks: grp.tasks.map((p) => {
                    const dbTask = resp.tasks.find((x: any) => x.id === p.serverDbId);
                    if (!dbTask) return p;
                    const newStatus = dbTask.status as TaskStatus;
                    const newVideoStatus = dbTask.video_status as StoryTaskDraft['videoStatus'];
                    const statusChanged = p.status !== newStatus;
                    const videoStatusChanged = (p.videoStatus || null) !== (newVideoStatus || null);
                    const elapsedSec = p.startedAt ? Math.round((Date.now() - p.startedAt) / 1000) : 0;
                    const newLogs = [...p.logs];
                    if (statusChanged && newStatus === 'success' && dbTask.result_url) {
                      newLogs.push({ timestamp: Date.now(), level: 'success', message: `✅ สร้างภาพสำเร็จ (${elapsedSec}s)` });
                    } else if (statusChanged && newStatus === 'failed') {
                      newLogs.push({ timestamp: Date.now(), level: 'error', message: `❌ ภาพล้มเหลว: ${dbTask.error || 'unknown'}` });
                    }
                    if (videoStatusChanged) {
                      if (newVideoStatus === 'pending') {
                        newLogs.push({ timestamp: Date.now(), level: 'info', message: `🎬 เริ่มสร้างวิดีโอ...` });
                      } else if (newVideoStatus === 'success') {
                        newLogs.push({ timestamp: Date.now(), level: 'success', message: `🎉 วิดีโอเสร็จ! (${elapsedSec}s)` });
                      } else if (newVideoStatus === 'failed') {
                        newLogs.push({ timestamp: Date.now(), level: 'error', message: `❌ วิดีโอล้มเหลว: ${dbTask.error || 'unknown'}` });
                      }
                    }
                    // Periodic "still working" heartbeat — only when no other change this tick
                    if (!statusChanged && !videoStatusChanged) {
                      if (newStatus === 'pending') {
                        newLogs.push({ timestamp: Date.now(), level: 'info', message: `⏳ ยังประมวลผลภาพอยู่... (${elapsedSec}s)` });
                      } else if (newStatus === 'success' && newVideoStatus === 'pending') {
                        newLogs.push({ timestamp: Date.now(), level: 'info', message: `🎬 ยังสร้างวิดีโออยู่... (${elapsedSec}s)` });
                      }
                    }
                    return {
                      ...p,
                      status: newStatus,
                      resultUrl: dbTask.result_url || p.resultUrl,
                      videoStatus: newVideoStatus || p.videoStatus,
                      videoUrl: dbTask.video_url || p.videoUrl,
                      currentStep: (dbTask.current_step as StoryTaskDraft['currentStep']) ?? p.currentStep,
                      error: dbTask.error || p.error,
                      logs: newLogs,
                    };
                  }),
                };
              })
            );
          }
        } catch {
          // ignore — group not yet created on backend
        }
      }
    };
    tick();
    const interval = window.setInterval(tick, 7000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.map((g) => `${g.groupId}:${g.tasks.length}:${g.tasks.every((t) => !!t.serverDbId)}:${g.tasks.map((t) => t.serverDbId || '').join(',')}`).join('||'), groupBackend]);

  const addGroup = async () => {
    if (!templateSlug) return;
    const scenes = Math.max(1, Math.min(MAX_TASKS_PER_CREATE, sceneCount));
    const groupId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { group, tasks: serverTasks } = await api.storyTemplateCreateGroup({
        template_slug: templateSlug,
        channel_id: selectedChannelId || null,
        scene_count: scenes,
        video_resolution: videoResolution,
        duration: videoDuration,
        model: selectedModel,
        group_id: groupId,
      });
      const newGroup: StoryTaskGroup = {
        groupId: group.group_id,
        createdAt: Date.now(),
        channelId: selectedChannelId,
        tasks: (serverTasks as any[]).map((row, idx) => ({
          ...newStoryDraft(idx + 1, row.model || selectedModel),
          localId: `loaded-story-${row.id}`,
          serverDbId: row.id,
          serverTaskId: row.task_id || undefined,
          aspect: row.aspect_ratio || 'auto',
          resolution: row.resolution || '1K',
          status: (row.status || 'draft') as TaskStatus,
        })),
      };
      setGroups((prev) => [newGroup, ...prev]);
    } catch (err: any) {
      toast.error(err?.message || 'Create group failed');
    }
  };

  const deleteGroup = async (groupId: string) => {
    const target = groups.find((g) => g.groupId === groupId);
    if (target) {
      try {
        await api.storyTemplateDeleteGroup(groupId);
      } catch (err: any) {
        console.error('Delete group on server failed:', err?.message);
      }
      target.tasks.forEach((t) => t.filePreviews.forEach(URL.revokeObjectURL));
    }
    setGroups((prev) => prev.filter((g) => g.groupId !== groupId));
  };

  const updateTask = (groupId: string, localId: string, patch: Partial<StoryTaskDraft>) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId !== groupId
          ? g
          : { ...g, tasks: g.tasks.map((t) => (t.localId === localId ? { ...t, ...patch } : t)) }
      )
    );
    // Realtime PATCH backend (only fields backend tracks)
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    if (!t?.serverDbId) return;
    const backendPatch: any = {};
    if ('mainImage' in patch || 'outfitImage' in patch || 'backgroundImage' in patch || 'objectImage' in patch) {
      const next = { ...t, ...patch };
      backendPatch.image_inputs = {
        mainImage: next.mainImage,
        outfitImage: next.outfitImage,
        backgroundImage: next.backgroundImage,
        objectImage: next.objectImage,
      };
    }
    if ('outfitText' in patch || 'backgroundText' in patch) {
      const next = { ...t, ...patch };
      backendPatch.text_values = {
        outfitText: next.outfitText,
        backgroundText: next.backgroundText,
      };
    }
    if ('aspect' in patch) backendPatch.aspect_ratio = patch.aspect;
    if ('resolution' in patch) backendPatch.resolution = patch.resolution;
    if ('prompt' in patch) backendPatch.prompt = patch.prompt;
    if ('variables' in patch) backendPatch.variables = patch.variables;
    if ('model' in patch) backendPatch.model = patch.model;
    if (Object.keys(backendPatch).length === 0) return;
    api.storyTemplatePatchTask(groupId, t.serverDbId, backendPatch).catch((err) => {
      console.warn('PATCH task failed:', err?.message);
    });
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
        await api.storyTemplateDelete(t.serverDbId);
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
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    const cfg = getModelConfig(t?.model);
    const arr = Array.from(selected).slice(0, cfg.maxFiles);
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

  const handlePickImage = (groupId: string, localId: string, slot: StoryImageSlot) => {
    setPickerTarget({ groupId, localId, slot });
  };

  // Phase 6b — call AI (multimodal) to get 3 story options for this group, locking character from uploaded images
  const handleGenerateStory = async (g: StoryTaskGroup) => {
    const topic = (groupTopics[g.groupId] || '').trim();
    if (!topic) {
      toast.error(l('กรุณาใส่ "หัวข้อเรื่อง" ก่อน', 'Enter a topic first'));
      return;
    }
    // Storyboard mode — each scene has its OWN reference images (character/setting may differ across scenes)
    const sceneRefs = g.tasks.map((t, idx) => ({
      scene: idx + 1,
      main: t.mainImage,
      outfit: t.outfitImage,
      background: t.backgroundImage,
      object: t.objectImage,
    }));
    const anyImage = sceneRefs.some((s) => s.main || s.outfit || s.background || s.object);
    if (!anyImage) {
      toast.error(l('กรุณาใส่รูปอ้างอิงอย่างน้อย 1 รูปในฉากใดฉากหนึ่ง', 'Add at least one reference image to any scene'));
      return;
    }
    // Legacy flat list — kept for backend back-compat
    const refUrls = sceneRefs.flatMap((s) => [s.main, s.outfit, s.background, s.object].filter((u): u is string => !!u));
    setAiLoadingByGroup((prev) => ({ ...prev, [g.groupId]: true }));
    try {
      const { options } = await api.storyTemplateGenerateOptions({
        group_id: g.groupId,
        topic,
        template_slug: templateSlug || undefined,
        scene_count: g.tasks.length,
        channel_id: g.channelId || undefined,
        image_references: Array.from(new Set(refUrls)),
        scene_references: sceneRefs,
      });
      setAiOptionsByGroup((prev) => ({ ...prev, [g.groupId]: options || [] }));
      setAiPickerGroupId(g.groupId);
    } catch (err: any) {
      toast.error(err?.message || 'AI failed');
    } finally {
      setAiLoadingByGroup((prev) => ({ ...prev, [g.groupId]: false }));
    }
  };

  // User picks 1 of 3 options → fill task fields with AI-generated scene prompts
  const handlePickOption = (groupId: string, optionId: number) => {
    const options = aiOptionsByGroup[groupId] || [];
    const opt = options.find((o: any) => o.option_id === optionId) || options[optionId - 1];
    if (!opt?.scenes) {
      toast.error(l('option ไม่มี scenes', 'Option has no scenes'));
      return;
    }
    setSelectedOptionByGroup((prev) => ({ ...prev, [groupId]: optionId }));
    api.storyTemplatePatchGroup(groupId, { selected_option_id: optionId }).catch(() => {});

    // Build per-task patches and apply both locally + to backend (so runner can read dialogue/video_prompt)
    const targetGroup = groups.find((x) => x.groupId === groupId);
    const taskPatches: Array<{ task: StoryTaskDraft; nextPrompt: string; nextVars: { name: string; value: string }[] }> = [];
    if (targetGroup) {
      targetGroup.tasks.forEach((t, idx) => {
        const scene = opt.scenes[idx];
        if (!scene) return;
        // Multi-segment support: scene.segments[] is array of { duration, dialogue, video_prompt }
        // Legacy fallback: scene.dialogue + scene.video_prompt as a single segment
        const rawSegments: any[] = Array.isArray(scene.segments) && scene.segments.length > 0
          ? scene.segments
          : [{ duration: 10, dialogue: scene.dialogue || '', video_prompt: scene.video_prompt || '' }];
        // Concat all segment dialogues for display purposes (single "dialogue" var = whole scene speech)
        const fullDialogue = rawSegments.map((s) => s.dialogue || '').filter(Boolean).join(' ');
        const fullVideoPrompt = rawSegments.map((s) => s.video_prompt || '').filter(Boolean).join('\n---SEGMENT---\n');

        const nextVars = [
          ...(t.variables || []).filter((v) => !['scene_name', 'visual', 'dialogue', 'emotion', 'video_prompt', 'segments'].includes(v.name)),
          { name: 'scene_name', value: scene.scene_name || '' },
          { name: 'visual', value: scene.visual || '' },
          { name: 'dialogue', value: fullDialogue },
          { name: 'emotion', value: scene.emotion || '' },
          { name: 'video_prompt', value: fullVideoPrompt },
          { name: 'segments', value: JSON.stringify(rawSegments) },
        ];
        taskPatches.push({ task: t, nextPrompt: scene.image_prompt || t.prompt, nextVars });
      });
    }

    setGroups((prev) =>
      prev.map((g) => {
        if (g.groupId !== groupId) return g;
        return {
          ...g,
          tasks: g.tasks.map((t, idx) => {
            const scene = opt.scenes[idx];
            if (!scene) return t;
            const rawSegments: any[] = Array.isArray(scene.segments) && scene.segments.length > 0
              ? scene.segments
              : [{ duration: 10, dialogue: scene.dialogue || '', video_prompt: scene.video_prompt || '' }];
            const fullDialogue = rawSegments.map((s: any) => s.dialogue || '').filter(Boolean).join(' ');
            const fullVideoPrompt = rawSegments.map((s: any) => s.video_prompt || '').filter(Boolean).join('\n---SEGMENT---\n');
            return {
              ...t,
              prompt: scene.image_prompt || t.prompt,
              variables: [
                ...(t.variables || []).filter((v) => !['scene_name', 'visual', 'dialogue', 'emotion', 'video_prompt', 'segments'].includes(v.name)),
                { name: 'scene_name', value: scene.scene_name || '' },
                { name: 'visual', value: scene.visual || '' },
                { name: 'dialogue', value: fullDialogue },
                { name: 'emotion', value: scene.emotion || '' },
                { name: 'video_prompt', value: fullVideoPrompt },
                { name: 'segments', value: JSON.stringify(rawSegments) },
              ],
            };
          }),
        };
      })
    );

    // Persist to backend so runner has dialogue + video_prompt for KIE call
    for (const p of taskPatches) {
      if (!p.task.serverDbId) continue;
      api
        .storyTemplatePatchTask(groupId, p.task.serverDbId, {
          prompt: p.nextPrompt,
          variables: p.nextVars,
        })
        .catch((err) => console.warn('PATCH task on option pick failed:', err?.message));
    }

    setAiPickerGroupId(null);
    toast.success(l(`เลือก Option ${optionId} แล้ว`, `Picked Option ${optionId}`));
    // Composite is generated lazily on first "Generate all" click — no need to pre-trigger here
  };

  const triggerCompositeGenerate = async (groupId: string, force: boolean) => {
    setCompositeByGroup((prev) => ({ ...prev, [groupId]: { ...prev[groupId], loading: true, error: undefined } }));
    try {
      const r = await api.storyTemplateCompositeGenerate(groupId, force);
      setCompositeByGroup((prev) => ({ ...prev, [groupId]: { url: r.composite_image_url, loading: false } }));
      if (!r.reused) toast.success(l('สร้างภาพ composite สำเร็จ', 'Composite image ready'));
    } catch (err: any) {
      const msg = err?.message || 'composite generation failed';
      setCompositeByGroup((prev) => ({ ...prev, [groupId]: { ...prev[groupId], loading: false, error: msg } }));
      toast.error(msg);
    }
  };

  const SLOT_TO_FIELD: Record<StoryImageSlot, keyof StoryTaskDraft> = {
    main: 'mainImage',
    outfit: 'outfitImage',
    background: 'backgroundImage',
    object: 'objectImage',
  };

  const handlePickerSelect = (url: string) => {
    if (!pickerTarget) return;
    const field = SLOT_TO_FIELD[pickerTarget.slot];
    // Setting an image clears the matching text value (if any) so prompt substitution prefers the image
    const patch: Partial<StoryTaskDraft> = { [field]: url } as Partial<StoryTaskDraft>;
    if (pickerTarget.slot === 'outfit') patch.outfitText = undefined;
    if (pickerTarget.slot === 'background') patch.backgroundText = undefined;
    updateTask(pickerTarget.groupId, pickerTarget.localId, patch);
  };

  const generateOne = async (groupId: string, localId: string) => {
    const g = groups.find((x) => x.groupId === groupId);
    const t = g?.tasks.find((x) => x.localId === localId);
    if (!t) return;
    if (!t.mainImage) {
      toast.error(l('กรุณาเลือก "รูป" หลักก่อน', 'Pick the main image first'));
      return;
    }
    const groupTopic = (groupTopics[groupId] || '').trim();
    if (!groupTopic) {
      toast.error(l('กรุณาใส่ "หัวข้อเรื่อง" ของกลุ่มนี้ก่อน', 'Enter the topic for this group first'));
      return;
    }
    if (!activeTemplate?.prompt) {
      toast.error(l('Template ไม่มี prompt', 'Template has no prompt'));
      return;
    }

    // Smart resume — if image succeeded but video failed, only redo video (skip KIE image regen)
    if (
      t.serverDbId &&
      t.status === 'success' &&
      !!t.resultUrl &&
      t.videoStatus === 'failed'
    ) {
      try {
        const r = await api.storyTemplateRetry(t.serverDbId);
        if (r.mode === 'concat-only') {
          appendLog(groupId, localId, 'info', `🔄 Retry เฉพาะ concat + upload (วิดีโอทุกฉากสร้างเสร็จแล้ว)`);
          updateTask(groupId, localId, {
            videoStatus: 'pending',
            videoUrl: undefined,
            error: undefined,
            currentStep: 'image_gen',
            startedAt: Date.now(),
          });
          return;
        }
        if (r.mode === 'video-only') {
          appendLog(groupId, localId, 'info', `🔄 Retry เฉพาะวิดีโอ (รูปภาพยังใช้ของเดิม)`);
          updateTask(groupId, localId, {
            videoStatus: undefined,
            videoUrl: undefined,
            error: undefined,
            currentStep: 'image_gen',
            startedAt: Date.now(),
          });
          return;
        }
        // mode='full' → fall through to full re-gen below
      } catch (err: any) {
        console.warn('Smart retry failed, falling back to full regen:', err?.message);
      }
    }

    appendLog(groupId, localId, 'info', `🚀 Starting task #${t.taskNumber}`);
    // Clear all stale state INCLUDING serverTaskId so the polling effect doesn't race the retry:
    // it would otherwise poll /status with the old task_id while /generate is still in-flight,
    // see DB row status='failed' (not yet updated by the /generate UPDATE), and overwrite our pending state.
    updateTask(groupId, localId, {
      status: 'pending',
      startedAt: Date.now(),
      error: undefined,
      resultUrl: undefined,
      dropboxUrl: undefined,
      videoUrl: undefined,
      videoStatus: undefined,
      currentStep: 'image_gen',
      serverTaskId: undefined,
    });
    try {
      const variablesObj = (t.variables || []).reduce<Record<string, string>>((acc, v) => {
        if (v.name.trim()) acc[v.name.trim()] = v.value;
        return acc;
      }, {});

      const sceneIdx = g!.tasks.findIndex((x) => x.localId === localId);
      // Use the AI-generated scene.image_prompt (stored in t.prompt) as the actual KIE prompt.
      // Fallback to template's system_prompt only if user hasn't picked an AI option yet.
      const promptForKie = (t.prompt && t.prompt.trim().length > 0) ? t.prompt : (activeTemplate.prompt || '');
      const { task } = await api.storyTemplateGenerate({
        template_slug: templateSlug || undefined,
        model: t.model || 'gpt-image-2',
        prompt_template: promptForKie,
        // Backend uses object form for placeholder substitution; runner handles both formats.
        variables: variablesObj,
        topic: groupTopic,
        image_inputs: {
          mainImage: t.mainImage,
          outfitImage: t.outfitImage,
          backgroundImage: t.backgroundImage,
          objectImage: t.objectImage,
        },
        text_values: {
          outfitText: t.outfitText,
          backgroundText: t.backgroundText,
        },
        aspect_ratio: t.aspect,
        resolution: t.resolution,
        channel_id: g!.channelId || undefined,
        group_id: g!.groupId,
        scene_number: sceneIdx >= 0 ? sceneIdx + 1 : 1,
        scene_count: g!.tasks.length,
        existing_task_id: t.serverDbId, // attach KIE result to existing draft row instead of inserting new
        duration: videoDuration,
        video_resolution: videoResolution,
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

  const generateAllInGroup = async (groupId: string) => {
    const g = groups.find((x) => x.groupId === groupId);
    if (!g) return;
    const drafts = g.tasks.filter((t) => t.status === 'draft');
    for (const d of drafts) {
      await generateOne(groupId, d.localId);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/story-templates')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          {l('กลับ', 'Back')}
        </Button>
        <ImageIcon className="h-5 w-5 text-[#FFB300]" />
        <h1 className="text-xl md:text-2xl font-bold">
          {activeTemplate ? (language === 'th' ? activeTemplate.nameTh : activeTemplate.name) : l('ไม่พบ Template', 'Template not found')}
        </h1>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#FFB300] text-black">NEW</span>
      </div>

      {activeTemplate && (
        <div className="flex justify-center mb-6">
          <img
            src={activeTemplate.thumbnailUrl}
            alt={language === 'th' ? activeTemplate.nameTh : activeTemplate.name}
            className="block w-auto h-auto max-w-full max-h-[600px] rounded-2xl border border-[#FFB300]/15"
          />
        </div>
      )}

      <div className="rounded-2xl border border-[#FFB300]/15 bg-card/40 shadow-lg shadow-black/20 p-5 md:p-6 mb-6">
        <h2 className="text-base font-bold mb-4">{l('สร้าง Task ใหม่', 'Create new tasks')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
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
              {l('จำนวนฉาก', 'Number of scenes')}
            </label>
            <Select value={String(sceneCount)} onValueChange={(v) => setSceneCount(parseInt(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: MAX_TASKS_PER_CREATE }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} {l('ฉาก', n > 1 ? 'scenes' : 'scene')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {l('Model สร้างภาพ', 'Image Model')}
            </label>
            <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_MODELS.map((m) => (
                  <SelectItem key={m.key} value={m.key} disabled={!m.available}>
                    <span className="flex items-center gap-2">
                      {m.label}
                      {!m.available && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {l('เร็วๆ นี้', 'Coming soon')}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {l('ความละเอียดวิดีโอ', 'Video Resolution')}
            </label>
            <Select value={videoResolution} onValueChange={(v) => setVideoResolution(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['480p', '720p', '1080p'].map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {l('ความยาวต่อฉาก (Duration)', 'Duration / Scene')}
            </label>
            <Select value={String(videoDuration)} onValueChange={(v) => setVideoDuration(parseInt(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 15, 20, 25, 30].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} {l('วินาที', 'sec')}{d === 10 ? l(' ⭐ แนะนำ', ' ⭐ recommended') : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-zinc-500 mt-1">
              {videoDuration > 10
                ? l('⚠️ > 10 วินาที: เสียงพูดอาจไม่ธรรมชาติ (กระบวนการ TTS ของ grok)', '⚠️ >10 sec: speech may sound rushed or repeated')
                : l('✅ ≤ 10 วินาที: เสียงพูดธรรมชาติ', '✅ ≤10 sec: natural speech')}
            </p>
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

      <div className="space-y-4">
        {groups.map((g) => {
          const draftN = g.tasks.filter((t) => t.status === 'draft').length;
          const doneN = g.tasks.filter((t) => t.status === 'success').length;
          return (
            <div
              key={g.groupId}
              className="rounded-2xl border border-[#FFB300]/15 bg-card/40 shadow-lg shadow-black/20 p-4 md:p-5"
            >
              {(() => {
                const gb = groupBackend[g.groupId];
                if (!gb) return null;
                if (gb.status === 'done' && gb.final_video_url) {
                  return (
                    <div className="mb-3 rounded-xl border border-green-500/30 bg-green-500/5 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-green-400">
                          🎉 {l('วิดีโอ Story เสร็จสมบูรณ์', 'Story video ready')}
                        </span>
                        <a
                          href={gb.final_video_url}
                          target="_blank"
                          rel="noreferrer"
                          download
                          className="text-[11px] text-[#FFB300] hover:text-[#FFC233]"
                        >
                          {l('ดาวน์โหลด', 'Download')}
                        </a>
                      </div>
                      <video
                        src={gb.final_video_url}
                        controls
                        className="block mx-auto max-h-[70vh] w-auto rounded-lg bg-black"
                      />
                    </div>
                  );
                }
                if (gb.status === 'processing') {
                  return (
                    <div className="mb-3 rounded-xl border border-[#FFB300]/30 bg-[#FFB300]/5 p-2 text-xs text-[#FFB300]">
                      {l('🔗 กำลังต่อวิดีโอ + ใส่ watermark + อัป Dropbox...', '🔗 Concatenating + watermark + uploading...')}
                    </div>
                  );
                }
                if (gb.status === 'failed') {
                  return (
                    <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                      <p className="text-xs font-semibold text-red-400 mb-1">
                        ❌ {l('ฉากบางฉากล้มเหลว — กด Retry ที่ฉากนั้นเพื่อลองใหม่', 'Some scenes failed — click Retry on the failed scene')}
                      </p>
                      {gb.error && (
                        <p className="text-[11px] text-red-300/80 leading-relaxed mt-1">{gb.error}</p>
                      )}
                      <p className="text-[10px] text-zinc-500 italic mt-2">
                        {l('* ระบบจะรวมวิดีโอให้อัตโนมัติเมื่อทุกฉากสำเร็จ', '* Final video will be assembled automatically when all scenes succeed')}
                      </p>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground font-medium">
                  {getModelConfig(g.tasks[0]?.model).label}
                </span>
                <span className="text-xs text-muted-foreground">
                  • {g.tasks.length} task{g.tasks.length > 1 ? 's' : ''} • {doneN} {l('สำเร็จ', 'done')}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {draftN > 0 && (() => {
                    const hasOption = !!selectedOptionByGroup[g.groupId];
                    const aiLoading = !!aiLoadingByGroup[g.groupId];
                    const blocked = !hasOption;
                    const tooltip = aiLoading
                      ? l('AI กำลังคิดเรื่อง...', 'AI is thinking...')
                      : !hasOption
                        ? l('ต้องเลือก story option ก่อน (Step 2)', 'Pick a story option first (Step 2)')
                        : '';
                    return (
                      <Button
                        size="sm"
                        onClick={() => generateAllInGroup(g.groupId)}
                        disabled={blocked}
                        title={tooltip}
                        className="bg-gradient-to-r from-[#FFB300] to-[#FF8C00] text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play className="h-4 w-4 mr-1" />
                        {blocked
                          ? l('ยังสร้างไม่ได้', 'Not ready')
                          : `${l('สร้างทั้งหมด', 'Generate all')} (${draftN})`}
                      </Button>
                    );
                  })()}
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

              {(() => {
                const step1Done = !!g.tasks[0]?.mainImage;
                const step2Done = (aiOptionsByGroup[g.groupId]?.length || 0) > 0;
                const step3Active = !!selectedOptionByGroup[g.groupId];

                const StepHeader = ({ n, title, done, active }: { n: number; title: string; done: boolean; active: boolean }) => (
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-bold ${
                        done ? 'bg-green-500 text-black' : active ? 'bg-[#FFB300] text-black' : 'bg-zinc-700 text-zinc-400'
                      }`}
                    >
                      {done ? '✓' : n}
                    </span>
                    <span className={`text-sm font-bold ${done ? 'text-green-400' : active ? 'text-[#FFB300]' : 'text-zinc-400'}`}>
                      {title}
                    </span>
                  </div>
                );

                return (
                  <div className="space-y-3">
                    {/* STEP 1 — Upload reference images */}
                    <div className={`rounded-xl border p-4 ${step1Done ? 'border-green-500/25 bg-green-500/5' : 'border-[#FFB300]/30 bg-[#FFB300]/5'}`}>
                      <StepHeader n={1} title={l('อัปรูปอ้างอิง (อย่างน้อย Task #1)', 'Upload reference images (at least Task #1)')} done={step1Done} active={!step1Done} />
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {g.tasks.map((t) => (
                          <StoryTaskCard
                            key={t.localId}
                            task={t}
                            index={t.taskNumber}
                            language={language}
                            onUpdate={(patch) => updateTask(g.groupId, t.localId, patch)}
                            onDelete={() => deleteTask(g.groupId, t.localId)}
                            onGenerate={() => generateOne(g.groupId, t.localId)}
                            onPickImage={(slot) => handlePickImage(g.groupId, t.localId, slot)}
                            isResolutionDisabled={isResolutionDisabled}
                            compactMode="image-only"
                          />
                        ))}
                      </div>
                    </div>

                    {/* STEP 2 — Topic + Generate Story */}
                    <div className={`rounded-xl border p-4 ${step2Done ? 'border-green-500/25 bg-green-500/5' : step1Done ? 'border-[#FFB300]/30 bg-[#FFB300]/5' : 'border-zinc-800 bg-zinc-900/30 opacity-60'}`}>
                      <StepHeader n={2} title={l('ใส่หัวข้อเรื่อง + ให้ AI คิด 3 ตัวเลือก', 'Enter topic + let AI generate 3 options')} done={step2Done} active={step1Done && !step2Done} />
                      <Textarea
                        value={groupTopics[g.groupId] || ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setGroupTopics((prev) => ({ ...prev, [g.groupId]: v }));
                          api.storyTemplatePatchGroup(g.groupId, { topic: v }).catch(() => {});
                        }}
                        placeholder={l(
                          'เช่น "ไปคาเฟ่ครั้งแรก", "ตื่นมาเจอแมวกัด", "เจอเพื่อนเก่าหลังหายไป 10 ปี"',
                          'e.g. "first time at a cafe", "woke up to a cat bite", "running into an old friend"'
                        )}
                        rows={2}
                        className="text-xs resize-none bg-background/40 mb-2"
                        disabled={!step1Done}
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          onClick={() => handleGenerateStory(g)}
                          disabled={
                            !groupTopics[g.groupId]?.trim() ||
                            !step1Done ||
                            !!aiLoadingByGroup[g.groupId]
                          }
                          className="bg-gradient-to-r from-[#FFB300] to-[#FF8C00] text-black font-semibold h-8"
                        >
                          {aiLoadingByGroup[g.groupId] ? (
                            <>⏳ {l('AI กำลังคิด...', 'AI thinking...')}</>
                          ) : (
                            <>🎬 {l('สร้างสตอรี่', 'Generate Story')} ({g.tasks.length} {l('ฉาก', 'scenes')})</>
                          )}
                        </Button>
                        {step2Done && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAiPickerGroupId(g.groupId)}
                            className="h-8 text-xs"
                          >
                            {l('ดู 3 ตัวเลือก', 'View 3 options')}
                            {selectedOptionByGroup[g.groupId] && (
                              <span className="ml-1 text-[#FFB300]">(#{selectedOptionByGroup[g.groupId]})</span>
                            )}
                          </Button>
                        )}
                      </div>
                      {!step1Done && (
                        <p className="text-[10px] text-zinc-500 italic mt-2">
                          {l('* ทำขั้นที่ 1 ให้เสร็จก่อน', '* Complete step 1 first')}
                        </p>
                      )}
                    </div>

                    {step3Active && (
                      <div className="rounded-xl border border-[#FFB300]/30 bg-[#FFB300]/5 p-4 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-[#FFB300] mb-1">
                            ✓ {l('พร้อมสร้างแล้ว — เลือก Option ', 'Ready — Option ')}{selectedOptionByGroup[g.groupId]}
                          </p>
                          <p className="text-[11px] text-zinc-400">
                            {l('กด "สร้างทั้งหมด" ที่หัวกลุ่มเพื่อเริ่มสร้างทุกฉาก', 'Click "Generate all" in the group header to start')}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => generateAllInGroup(g.groupId)}
                          disabled={g.tasks.filter((t) => t.status === 'draft').length === 0}
                          className="bg-gradient-to-r from-[#FFB300] to-[#FF8C00] text-black font-bold"
                        >
                          <Play className="h-4 w-4 mr-1" />
                          {l('▶ สร้างทุกฉาก', 'Generate all scenes')}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <StoryImagePickerModal
        open={pickerTarget !== null}
        category={(pickerTarget?.slot as StoryImageCategory) || null}
        language={language}
        onClose={() => setPickerTarget(null)}
        onSelect={handlePickerSelect}
      />

      {/* Phase 6c — AI Story Options Picker */}
      {aiPickerGroupId && (() => {
        const opts = aiOptionsByGroup[aiPickerGroupId] || [];
        const selected = selectedOptionByGroup[aiPickerGroupId];
        return (
          <AlertDialog open={true} onOpenChange={(open) => !open && setAiPickerGroupId(null)}>
            <AlertDialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  🎬 {l('เลือก 1 ใน 3 เรื่องที่ AI คิดให้', 'Pick 1 of 3 stories AI generated')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {l(
                    'แต่ละ option มี ฉาก เท่ากับจำนวน task ใน group นี้ — เลือกแล้วระบบจะเติม prompt + บทพูด ลงในแต่ละ task ให้',
                    'Each option has scenes matching the task count — picking one fills prompts + dialogue into each task'
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-3 my-4">
                {opts.map((opt: any, idx: number) => {
                  const optId = opt.option_id ?? idx + 1;
                  const isSelected = selected === optId;
                  return (
                    <div
                      key={optId}
                      onClick={() => handlePickOption(aiPickerGroupId, optId)}
                      className={`cursor-pointer rounded-xl border p-4 transition-all ${
                        isSelected
                          ? 'border-[#FFB300] bg-[#FFB300]/10'
                          : 'border-zinc-700 bg-zinc-900 hover:border-[#FFB300]/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-base font-bold text-[#FFB300]">
                          OPTION {optId}
                        </span>
                        {isSelected && <span className="text-xs text-green-400 font-semibold">✓ {l('เลือกแล้ว', 'picked')}</span>}
                      </div>
                      {opt.story_summary && (
                        <p className="text-sm text-zinc-200 mb-3 leading-relaxed">
                          {opt.story_summary}
                        </p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {(opt.scenes || []).map((s: any, sidx: number) => {
                          const fullDialogue = Array.isArray(s.segments) && s.segments.length > 0
                            ? s.segments.map((seg: any) => seg?.dialogue || '').filter(Boolean).join(' ')
                            : (s.dialogue || '');
                          return (
                            <div key={sidx} className="text-xs bg-zinc-800/50 rounded p-2 leading-relaxed">
                              <div className="font-semibold text-zinc-100 mb-1">
                                {l('ฉาก', 'Scene')} {s.scene || sidx + 1}: {s.scene_name}
                              </div>
                              {fullDialogue && (
                                <div className="text-zinc-300 italic mb-1">
                                  "{fullDialogue}"
                                </div>
                              )}
                              {s.emotion && (
                                <span className="text-[10px] text-[#FFB300]/80 font-medium">[{s.emotion}]</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>{l('ปิด', 'Close')}</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      })()}

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
    </div>
  );
};

export default StoryTemplateDetail;
