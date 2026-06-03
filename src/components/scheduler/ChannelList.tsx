import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Plus, Settings, Trash2, Calendar, Clock, Facebook, Instagram, Youtube, Video, Type, Bot, ChevronDown, ChevronUp, ChevronRight, Pencil, Check, X, Columns3, GripVertical, Loader2, Activity, RefreshCw, Play, Download, Square, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useScheduler } from '@/contexts/SchedulerContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { SchedulerChannel, ChannelStockInfo, PageIds, Variable } from '@/types/scheduler';

// Helper: resolve variables in a prompt, cycling through values
const resolvePromptVariables = (
  prompt: string,
  variables: Variable[],
  valueIndex: number // offset within unused values (0 = first unused from end, 1 = second, etc.)
): string => {
  console.log('[resolvePromptVariables] variables count:', variables?.length, 'valueIndex:', valueIndex);
  if (!prompt || !variables || variables.length === 0) return prompt;

  let resolved = prompt;
  for (const variable of variables) {
    const allValues = variable.values || [];
    console.log(`[resolvePromptVariables] var "${variable.name}" has ${allValues.length} values:`, allValues.slice(0, 3).map(v => v.value?.substring(0, 20)));
    if (allValues.length === 0) continue;

    const curlyPattern = `{${variable.name}}`;
    const squarePattern = `[${variable.name}]`;
    if (!resolved.includes(curlyPattern) && !resolved.includes(squarePattern)) continue;

    // Pick from unused values first (matching backend logic)
    const unusedValues = allValues.filter(v => v.status === 'new' || !v.status);
    const pool = unusedValues.length > 0 ? unusedValues : allValues;
    // Pick from the beginning of the pool (first values added are used first)
    const pickIdx = valueIndex % pool.length;
    const pickedValue = pool[pickIdx];
    console.log(`[resolvePromptVariables] Picking "${variable.name}" pickIdx=${pickIdx} from pool of ${pool.length}, picked: "${pickedValue?.value?.substring(0, 30)}"`);

    resolved = resolved.replace(new RegExp(`\\{${variable.name}\\}`, 'g'), pickedValue.value);
    resolved = resolved.replace(new RegExp(`\\[${variable.name}\\]`, 'g'), pickedValue.value);
    console.log(`[resolvePromptVariables] After replace, resolved contains: "${resolved.substring(0, 100)}..."`);
  }
  return resolved;
};

// Count how many values have been "used" in a variable's values array
const countUsedValues = (variables: Variable[]): number => {
  if (!variables || variables.length === 0) return 0;
  // Use the first variable's used count as reference
  const firstVar = variables[0];
  if (!firstVar?.values || firstVar.values.length === 0) return 0;
  return firstVar.values.filter(v => v.status === 'used').length;
};

// Column definitions
type ColumnKey = 'schedule' | 'generateVideo' | 'history' | 'processing' | 'success' | 'failed' | 'channel' | 'concept' | 'aiModel' | 'duration' | 'platforms' | 'facebookAdmin' | 'page' | 'postsPerDay' | 'timezone' | 'prompt';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  required?: boolean; // Cannot be hidden
}

const getAllColumns = (t: (key: string) => string): ColumnDef[] => [
  { key: 'schedule', label: t('channelList.schedulePost'), required: true },
  { key: 'generateVideo', label: t('channelList.generateVideo'), required: true },
  { key: 'history', label: t('scheduler.history'), required: true },
  { key: 'processing', label: t('channelList.processing') },
  { key: 'success', label: t('channelList.success') },
  { key: 'failed', label: t('channelList.failed') },
  { key: 'channel', label: t('dashboard.channel'), required: true },
  { key: 'concept', label: t('channelList.concept') },
  { key: 'aiModel', label: t('channelList.aiModel') },
  { key: 'duration', label: 'Duration' },
  { key: 'platforms', label: t('channelList.platforms') },
  { key: 'facebookAdmin', label: t('channelList.fbAdmin') },
  { key: 'page', label: t('channelList.page') },
  { key: 'postsPerDay', label: t('channelList.postsPerDay') },
  { key: 'timezone', label: t('channelList.timeZone') },
  { key: 'prompt', label: t('channelList.promptMode') },
];

const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = ['channel', 'generateVideo', 'schedule', 'history', 'processing', 'success', 'failed', 'platforms', 'facebookAdmin', 'page', 'postsPerDay', 'prompt'];
const DEFAULT_COLUMN_ORDER: ColumnKey[] = ['channel', 'generateVideo', 'schedule', 'history', 'processing', 'success', 'failed', 'platforms', 'facebookAdmin', 'page', 'postsPerDay', 'prompt', 'concept', 'aiModel', 'duration', 'timezone'];

const STORAGE_KEY = 'channelList_visibleColumns';
const ORDER_STORAGE_KEY = 'channelList_columnOrder';
const ROW_ORDER_STORAGE_KEY = 'channelList_rowOrder';
const WIDTH_STORAGE_KEY = 'channelList_columnWidths';

const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  channel: 130,
  generateVideo: 110,
  schedule: 110,
  history: 110,
  processing: 80,
  success: 80,
  failed: 80,
  platforms: 70,
  facebookAdmin: 100,
  page: 70,
  postsPerDay: 70,
  prompt: 90,
  concept: 180,
  aiModel: 80,
  duration: 60,
  timezone: 100,
};

// Platform icons
const TikTokIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-.88-.07A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
  </svg>
);

const XIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

interface ChannelListProps {
  onAddChannel: () => void;
  onEditChannel: (channel: SchedulerChannel) => void;
  onOpenSchedule: (channel: SchedulerChannel) => void;
}

type SortField = 'name' | 'platform' | 'mode' | 'pending' | 'days';
type SortOrder = 'asc' | 'desc';

// Countdown component — ใช้ local time จำตอนเห็น log ครั้งแรก ไม่พึ่ง server timestamp
const RetryCountdown: React.FC<{ logId: string; delaySec: number; retryNum: string }> = ({ logId, delaySec, retryNum }) => {
  const firstSeenRef = useRef<{ id: string; time: number }>({ id: logId, time: Date.now() });
  if (firstSeenRef.current.id !== logId) {
    firstSeenRef.current = { id: logId, time: Date.now() };
  }
  const [remaining, setRemaining] = useState(delaySec);
  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - firstSeenRef.current.time) / 1000);
      const r = Math.max(0, delaySec - elapsed);
      setRemaining(r);
      if (r <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [logId, delaySec]);
  return (
    <span className="text-amber-400">
      {remaining > 0
        ? `สร้างไม่สำเร็จ ลองใหม่ครั้งที่ ${retryNum} (อีก ${remaining} วินาที)`
        : `กำลังลองใหม่ครั้งที่ ${retryNum}...`}
    </span>
  );
};

export const ChannelList: React.FC<ChannelListProps> = ({
  onAddChannel,
  onEditChannel,
  onOpenSchedule,
}) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { channels, loadingChannels, fetchChannels, deleteChannel, getChannelStock, updateChannel, stopQueueRunner } = useScheduler();
  const ALL_COLUMNS = getAllColumns(t);
  const [stockInfo, setStockInfo] = useState<Record<number, ChannelStockInfo>>({});
  const [queueStatsMap, setQueueStatsMap] = useState<Record<number, any>>(() => {
    // Stale-while-revalidate: hydrate from last-known stats so first paint shows real numbers
    try {
      const cached = localStorage.getItem('channelList_queueStats');
      if (cached) return JSON.parse(cached);
    } catch {}
    return {};
  });

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [channelToDelete, setChannelToDelete] = useState<SchedulerChannel | null>(null);

  useEffect(() => {
    const el = document.getElementById('channel-table-container');
    if (!el) return;

    // Shadcn's <Table> wraps content in its own "div.overflow-auto" — that's the real scroll container
    const scrollEl = (el.querySelector(':scope > div') as HTMLElement) || el;

    // Hide the native scrollbar on Shadcn's inner div (we replace it with our floating one)
    const styleId = 'ch-scrollbar-hide-style';
    document.getElementById(styleId)?.remove();
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #channel-table-container > div::-webkit-scrollbar { display: none; }
      #channel-table-container > div { -ms-overflow-style: none; scrollbar-width: none; }
    `;
    document.head.appendChild(style);

    const floaterId = 'ch-float-scrollbar';
    document.getElementById(floaterId)?.remove();

    const floater = document.createElement('div');
    floater.id = floaterId;
    Object.assign(floater.style, {
      position: 'fixed', bottom: '0',
      overflowX: 'scroll', overflowY: 'hidden',
      zIndex: '60', height: '14px', display: 'none',
    });
    const inner = document.createElement('div');
    inner.style.height = '1px';
    floater.appendChild(inner);
    document.body.appendChild(floater);

    const update = () => {
      const rect = el.getBoundingClientRect(); // outer div for positioning
      inner.style.width = scrollEl.scrollWidth + 'px'; // inner div for content width
      const hasOverflow = scrollEl.scrollWidth > scrollEl.clientWidth;
      const tableVisible = rect.top < window.innerHeight && rect.bottom > 0;
      if (hasOverflow && tableVisible) {
        floater.style.left = rect.left + 'px';
        floater.style.width = rect.width + 'px';
        floater.style.display = 'block';
      } else {
        floater.style.display = 'none';
      }
    };

    let syncing = false;
    const onFloaterScroll = () => { if (!syncing) { syncing = true; scrollEl.scrollLeft = floater.scrollLeft; syncing = false; } };
    const onScrollElScroll = () => { if (!syncing) { syncing = true; floater.scrollLeft = scrollEl.scrollLeft; syncing = false; } update(); };

    floater.addEventListener('scroll', onFloaterScroll, { passive: true });
    scrollEl.addEventListener('scroll', onScrollElScroll, { passive: true });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);
    update();

    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      floater.removeEventListener('scroll', onFloaterScroll);
      scrollEl.removeEventListener('scroll', onScrollElScroll);
      floater.remove();
      document.getElementById(styleId)?.remove();
    };
  }, [channels]);

  // Generate to history dialog — open immediately if open_gen param exists
  const openGenParam = searchParams.get('open_gen');
  const openGenChannel = openGenParam ? channels.find(c => c.id === Number(openGenParam)) || null : null;
  const [genDialogOpen, setGenDialogOpen] = useState(!!openGenChannel);
  const [genChannel, setGenChannel] = useState<SchedulerChannel | null>(openGenChannel);
  const [genLoading, setGenLoading] = useState(false);
  const [genShowAssignment, setGenShowAssignment] = useState(!!openGenChannel);
  const [genTasksPerChannel, setGenTasksPerChannel] = useState<Record<number, { templateId: string; customPrompt: string; customExtendPrompt?: string; ai_model?: string }[]>>({}); // channel_id -> tasks
  const [genTasksLoading, setGenTasksLoading] = useState(false);
  const [genAddCount, setGenAddCount] = useState(1); // จำนวน task ที่จะเพิ่ม
  const [genTemplateMode, setGenTemplateMode] = useState<'mixed' | string>('mixed'); // 'mixed' = round-robin, or template ID for all-same
  const [genEditingIdx, setGenEditingIdx] = useState<number | null>(null); // index of task being edited
  const genSaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Helper to get/set tasks for current channel
  const genTasks = genChannel ? (genTasksPerChannel[genChannel.id] || []) : [];
  const setGenTasks = (updater: { templateId: string; customPrompt: string; customExtendPrompt?: string; ai_model?: string }[] | ((prev: { templateId: string; customPrompt: string; customExtendPrompt?: string; ai_model?: string }[]) => { templateId: string; customPrompt: string; customExtendPrompt?: string; ai_model?: string }[])) => {
    if (!genChannel) return;
    const channelId = genChannel.id;
    setGenTasksPerChannel(prev => {
      const newTasks = typeof updater === 'function' ? updater(prev[channelId] || []) : updater;
      const newState = { ...prev, [channelId]: newTasks };

      // Debounced save to server
      if (genSaveTimeoutRef.current) clearTimeout(genSaveTimeoutRef.current);
      genSaveTimeoutRef.current = setTimeout(() => {
        api.saveGenTaskDrafts(channelId, newTasks).catch(console.error);
      }, 500);

      return newState;
    });
  };

  // Load gen tasks from server when dialog opens
  const loadGenTasks = async (channelId: number) => {
    if (genTasksPerChannel[channelId]) return; // Already loaded
    setGenTasksLoading(true);
    try {
      const data = await api.getGenTaskDrafts(channelId);
      const tasks = data.tasks.map(t => ({ templateId: t.template_id, customPrompt: t.custom_prompt, ai_model: (t as any).ai_model }));
      setGenTasksPerChannel(prev => ({ ...prev, [channelId]: tasks }));
    } catch (error) {
      console.error('Failed to load gen tasks:', error);
    }
    setGenTasksLoading(false);
  };
  const [genPendingLogsOpen, setGenPendingLogsOpen] = useState<Set<number>>(new Set()); // toggle logs for pending tasks
  const [genShowLogs, setGenShowLogs] = useState<Set<number>>(new Set());
  const [genAutoOpenedLogs, setGenAutoOpenedLogs] = useState<Set<number>>(new Set());
  const logUserScrolledRef = useRef<Set<number>>(new Set()); // track which log boxes user has scrolled up

  // Per-channel active generation tracking
  const [activeGens, setActiveGens] = useState<Record<number, { ids: number[]; statuses: Record<number, string>; logs: Record<number, any[]>; items: Record<number, any> }>>({});
  const genPollingRefs = React.useRef<Record<number, NodeJS.Timeout>>({});
  const dismissedGenIds = React.useRef<Set<number>>(new Set());

  const getActiveGen = (channelId: number) => activeGens[channelId];
  const isChannelGenerating = (channelId: number) => {
    const gen = activeGens[channelId];
    if (!gen) return false;
    return Object.values(gen.statuses).some(s => !['done', 'failed'].includes(s));
  };

  const pollGenTasks = (channelId: number, newIds: number[]) => {
    // Only use new IDs - don't carry over old ones
    const allIds = newIds.filter(id => !dismissedGenIds.current.has(id));

    if (genPollingRefs.current[channelId]) clearInterval(genPollingRefs.current[channelId]);
    genPollingRefs.current[channelId] = setInterval(async () => {
      try {
        // Only poll ids that are still running and not dismissed
        let idsToFetch: number[] = [];
        setActiveGens(prev => {
          const gen = prev[channelId];
          if (gen) {
            idsToFetch = gen.ids.filter(id => !['done', 'failed'].includes(gen.statuses[id] || '') && !dismissedGenIds.current.has(id));
          } else {
            idsToFetch = allIds.filter(id => !dismissedGenIds.current.has(id));
          }
          return prev; // no change, just reading
        });

        if (idsToFetch.length === 0) {
          clearInterval(genPollingRefs.current[channelId]);
          delete genPollingRefs.current[channelId];
          // Keep in localStorage until user explicitly dismisses
          return;
        }

        const data = await api.getQueueItemsByIds(idsToFetch);
        const statusMap: Record<number, string> = {};
        const itemsMap: Record<number, any> = {};
        let allDone = true;
        for (const item of data.items) {
          statusMap[item.id] = item.status;
          itemsMap[item.id] = item;
          if (!['done', 'failed'].includes(item.status)) allDone = false;
        }

        // Fetch logs for running tasks only
        const logsMap: Record<number, any[]> = {};
        await Promise.all(idsToFetch.map(async (id) => {
          try {
            const logData = await api.getQueueItemLogs(id);
            logsMap[id] = Array.isArray(logData) ? logData : (logData.logs || []);
          } catch { logsMap[id] = []; }
        }));

        setActiveGens(prev => {
          const existing = prev[channelId];
          if (existing) {
            return {
              ...prev,
              [channelId]: {
                ids: existing.ids,
                statuses: { ...existing.statuses, ...statusMap },
                logs: { ...existing.logs, ...logsMap },
                items: { ...existing.items, ...itemsMap },
              },
            };
          }
          return { ...prev, [channelId]: { ids: idsToFetch, statuses: statusMap, logs: logsMap, items: itemsMap } };
        });

        // Do not auto-open logs - user must click to expand
        setGenShowLogs(prev => {
          return prev;
        });

        if (allDone) {
          clearInterval(genPollingRefs.current[channelId]);
          delete genPollingRefs.current[channelId];
          // Keep in localStorage until user explicitly dismisses
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }, 2000);
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      Object.values(genPollingRefs.current).forEach(t => clearInterval(t));
    };
  }, []);

  // Load active gens from server when dialog opens
  const loadActiveGens = async (channelId: number) => {
    try {
      const data = await api.getActiveGens(channelId);
      if (data.items && data.items.length > 0) {
        const filteredItems = data.items.filter((item: any) => !dismissedGenIds.current.has(item.id));
        if (filteredItems.length === 0) return;
        const ids = filteredItems.map((item: any) => item.id);
        const statuses: Record<number, string> = {};
        const items: Record<number, any> = {};
        filteredItems.forEach((item: any) => {
          statuses[item.id] = item.status;
          items[item.id] = item;
        });
        // Fetch logs for all items (including done) so they display on reopen
        const logs: Record<number, any[]> = {};
        await Promise.all(ids.map(async (id: number) => {
          try {
            const logData = await api.getQueueItemLogs(id);
            logs[id] = Array.isArray(logData) ? logData : (logData.logs || []);
          } catch { logs[id] = []; }
        }));
        setActiveGens(prev => ({
          ...prev,
          [channelId]: { ids, statuses, logs, items },
        }));
        // Start polling for items that are still running
        const runningIds = ids.filter((id: number) => !['done', 'failed'].includes(statuses[id]));
        if (runningIds.length > 0) {
          pollGenTasks(channelId, runningIds);
        }
      }
    } catch (error) {
      console.error('Failed to load active gens:', error);
    }
  };

  // Open gen dialog via open_gen param (handles both first mount & re-navigation)
  useEffect(() => {
    if (openGenParam && channels.length > 0) {
      const ch = channels.find(c => c.id === Number(openGenParam));
      if (ch) {
        setGenChannel(ch);
        setGenShowAssignment(true);
        setGenDialogOpen(true);
        loadGenTasks(ch.id);
        loadActiveGens(ch.id);
        // Clean up URL param
        searchParams.delete('open_gen');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [openGenParam]);

  // Restore scroll to channel row when coming back from history tab
  useEffect(() => {
    if (location.pathname.includes('/channels')) {
      const scrollToChannelId = sessionStorage.getItem('channels_scroll_to');
      if (scrollToChannelId) {
        sessionStorage.removeItem('channels_scroll_to');
        const doScroll = () => {
          const rows = document.querySelectorAll('tr');
          for (const row of rows) {
            if (row.getAttribute('data-channel-id') === scrollToChannelId) {
              row.scrollIntoView({ behavior: 'instant', block: 'center' });
              return true;
            }
          }
          return false;
        };
        // Try multiple times to handle tab transition delay
        setTimeout(doScroll, 50);
        setTimeout(doScroll, 200);
        setTimeout(doScroll, 500);
      }
    }
  }, [location.pathname]);

  // Generate specific tasks (single index or all)
  const genInProgressRef = React.useRef(false);
  const handleGenToHistory = async (taskIdx?: number) => {
    // Guard against double-clicks / concurrent calls
    if (genInProgressRef.current) {
      console.log('[handleGenToHistory] Already in progress, skipping');
      return;
    }
    if (!genChannel || genTasks.length === 0) return;
    const tasksToGen = taskIdx !== undefined ? [genTasks[taskIdx]] : genTasks;
    if (tasksToGen.length === 0) return;
    genInProgressRef.current = true;
    setGenLoading(true);
    try {
      // Build prompts and template IDs
      // Let backend handle variable resolution (it has proper DB locking for status tracking)
      const prompts: (string | null)[] = tasksToGen.map(task => {
        if (task.customPrompt) return task.customPrompt;
        if (task.templateId === '__default__') return genChannel.prompt_template || null;
        const _allTmpls = (genChannel.ai_model === 'kie_viral_template' && genChannel.ai_prompt_templates?.length > 0) ? genChannel.ai_prompt_templates : genChannel.prompt_templates;
        const tmpl = _allTmpls?.find(t => t.id === task.templateId);
        return tmpl?.prompt_template || null;
      });

      // Always send templateId so backend can find template for extend_prompt
      const templateIds: (string | null)[] = tasksToGen.map(task => {
        return task.templateId || null;
      });

      // Build extend prompts (for Grok Extend model)
      const extendPrompts: (string | null)[] = tasksToGen.map(task => {
        // Use custom extend prompt if already resolved
        if (task.customExtendPrompt) return task.customExtendPrompt;
        // Try to resolve from template
        if (task.templateId && task.templateId !== '__default__') {
          const _allTmpls2 = (genChannel.ai_model === 'kie_viral_template' && genChannel.ai_prompt_templates?.length > 0) ? genChannel.ai_prompt_templates : genChannel.prompt_templates;
          const tmpl = _allTmpls2?.find(t => t.id === task.templateId);
          if (tmpl?.extend_prompt_template) {
            return tmpl.extend_prompt_template; // Let backend resolve variables
          }
        }
        return null;
      });

      // Generate unique request ID to prevent duplicate processing
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      console.log('[handleGenToHistory] Generating', tasksToGen.length, 'tasks, prompts:', prompts.length, 'templateIds:', templateIds.length, 'extendPrompts:', extendPrompts.length, 'taskIdx:', taskIdx, 'genTasks.length:', genTasks.length, 'requestId:', requestId);
      console.log('[handleGenToHistory] Sending count:', tasksToGen.length, 'prompts:', prompts, 'templateIds:', templateIds, 'extendPrompts:', extendPrompts);
      const result = await api.generateToHistory(genChannel.id, tasksToGen.length, undefined, 'varied', prompts, templateIds, extendPrompts, requestId);
      console.log('[handleGenToHistory] API returned ids:', result.ids, 'count:', result.count);
      const ids: number[] = result.ids;
      const initialStatuses: Record<number, string> = {};
      ids.forEach(id => { initialStatuses[id] = 'pending'; });
      setActiveGens(prev => {
        const existing = prev[genChannel.id];
        if (existing) {
          // Merge with existing active gens, but exclude dismissed IDs
          const keptIds = existing.ids.filter(id => !dismissedGenIds.current.has(id));
          const keptStatuses: Record<number, string> = {};
          const keptLogs: Record<number, any[]> = {};
          const keptItems: Record<number, any> = {};
          keptIds.forEach(id => {
            if (existing.statuses[id]) keptStatuses[id] = existing.statuses[id];
            if (existing.logs[id]) keptLogs[id] = existing.logs[id];
            if (existing.items[id]) keptItems[id] = existing.items[id];
          });
          return {
            ...prev,
            [genChannel.id]: {
              ids: [...keptIds, ...ids],
              statuses: { ...keptStatuses, ...initialStatuses },
              logs: { ...keptLogs },
              items: { ...keptItems },
            },
          };
        }
        return { ...prev, [genChannel.id]: { ids, statuses: initialStatuses, logs: {}, items: {} } };
      });

      // Remove generated tasks from list (keep assignment UI visible)
      if (taskIdx !== undefined) {
        setGenTasks(prev => prev.filter((_, i) => i !== taskIdx));
        // Adjust editing index when a task is removed to prevent wrong task entering edit mode
        setGenEditingIdx(prev => {
          if (prev === null) return null;
          if (prev === taskIdx) return null;
          if (prev > taskIdx) return prev - 1;
          return prev;
        });
      } else {
        setGenTasks([]);
        setGenEditingIdx(null);
      }
      setGenLoading(false);
      genInProgressRef.current = false;
      pollGenTasks(genChannel.id, ids);
    } catch (error: any) {
      console.error('Failed to generate:', error);
      // Silently handle duplicate request (already processed)
      if (!error?.duplicate) {
        toast.error('Failed to generate');
      } else {
        console.log('[handleGenToHistory] Duplicate request blocked by server');
      }
      setGenLoading(false);
      genInProgressRef.current = false;
    }
  };
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [editingConceptId, setEditingConceptId] = useState<number | null>(null);
  const [editingConceptValue, setEditingConceptValue] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: ColumnKey[] = JSON.parse(saved);
        // Ensure required columns are always visible
        const requiredKeys = ALL_COLUMNS.filter(c => c.required).map(c => c.key);
        const missing = requiredKeys.filter(k => !parsed.includes(k));
        if (missing.length > 0) {
          const updated = [...missing, ...parsed];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          return updated;
        }
        return parsed;
      }
    } catch (e) {
      console.error('Failed to load column settings:', e);
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });

  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => {
    try {
      const saved = localStorage.getItem(ORDER_STORAGE_KEY);
      if (saved) {
        const parsed: ColumnKey[] = JSON.parse(saved);
        // Add any new columns that aren't in the saved order, placing them after their predecessor in DEFAULT_COLUMN_ORDER
        const allKeys = ALL_COLUMNS.map(c => c.key);
        const missing = allKeys.filter(k => !parsed.includes(k));
        if (missing.length > 0) {
          let updated = [...parsed];
          for (const key of missing) {
            const defaultIdx = DEFAULT_COLUMN_ORDER.indexOf(key);
            // Find the predecessor in default order that exists in updated
            let insertIdx = updated.length;
            if (defaultIdx > 0) {
              const predecessor = DEFAULT_COLUMN_ORDER[defaultIdx - 1];
              const predIdx = updated.indexOf(predecessor);
              if (predIdx !== -1) insertIdx = predIdx + 1;
            }
            updated.splice(insertIdx, 0, key);
          }
          localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(updated));
          return updated;
        }
        return parsed;
      }
    } catch (e) {
      console.error('Failed to load column order:', e);
    }
    return DEFAULT_COLUMN_ORDER;
  });

  const [draggedColumn, setDraggedColumn] = useState<ColumnKey | null>(null);

  // Row drag reorder
  const [rowOrder, setRowOrder] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(ROW_ORDER_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });
  const [draggedRowId, setDraggedRowId] = useState<number | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<number | null>(null);

  // Column resize
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(WIDTH_STORAGE_KEY);
      if (saved) return { ...DEFAULT_COLUMN_WIDTHS, ...JSON.parse(saved) };
    } catch (e) {}
    return { ...DEFAULT_COLUMN_WIDTHS };
  });
  const resizingRef = React.useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const handleResizeStart = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnWidths[key] || DEFAULT_COLUMN_WIDTHS[key] || 100;
    resizingRef.current = { key, startX, startWidth };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(40, resizingRef.current.startWidth + diff);
      setColumnWidths(prev => {
        const updated = { ...prev, [resizingRef.current!.key]: newWidth };
        localStorage.setItem(WIDTH_STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    };

    const handleMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const toggleColumn = (key: ColumnKey) => {
    const column = ALL_COLUMNS.find(c => c.key === key);
    if (column?.required) return;

    setVisibleColumns(prev => {
      const newColumns = prev.includes(key)
        ? prev.filter(k => k !== key)
        : [...prev, key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newColumns));
      return newColumns;
    });
  };

  // Ensure required columns are always visible (covers cases where localStorage was stale)
  useEffect(() => {
    const requiredKeys = ALL_COLUMNS.filter(c => c.required).map(c => c.key);
    const missing = requiredKeys.filter(k => !visibleColumns.includes(k));
    if (missing.length > 0) {
      const updated = [...missing, ...visibleColumns];
      setVisibleColumns(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  }, []);

  const isColumnVisible = (key: ColumnKey) => visibleColumns.includes(key);

  const handleDragStart = (e: React.DragEvent, key: ColumnKey) => {
    setDraggedColumn(key);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, key: ColumnKey) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === key) return;

    const newOrder = [...columnOrder];
    const draggedIdx = newOrder.indexOf(draggedColumn);
    const targetIdx = newOrder.indexOf(key);

    if (draggedIdx !== -1 && targetIdx !== -1) {
      newOrder.splice(draggedIdx, 1);
      newOrder.splice(targetIdx, 0, draggedColumn);
      setColumnOrder(newOrder);
      localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(newOrder));
    }
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
  };

  // Get columns in order
  const getOrderedColumns = () => {
    return columnOrder
      .map(key => ALL_COLUMNS.find(c => c.key === key)!)
      .filter(Boolean);
  };

  // Get visible columns in order
  const getVisibleOrderedColumns = () => {
    return columnOrder.filter(key => isColumnVisible(key));
  };

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Load active gens for all channels on mount
  useEffect(() => {
    if (channels.length > 0) {
      channels.forEach(channel => loadActiveGens(channel.id));
    }
  }, [channels.length]);

  // Fetch queue stats for ALL channels in a single batch request (avoids flash-of-zero)
  useEffect(() => {
    if (channels.length === 0) return;
    let cancelled = false;
    api.getScheduleQueueStatsByChannel()
      .then((map) => {
        if (cancelled) return;
        // API returns keys as strings; convert to numeric-keyed map to match render lookup
        const numericMap: Record<number, any> = {};
        for (const [k, v] of Object.entries(map || {})) {
          numericMap[Number(k)] = v;
        }
        setQueueStatsMap(numericMap);
        try { localStorage.setItem('channelList_queueStats', JSON.stringify(numericMap)); } catch {}
      })
      .catch((e) => {
        console.error('Failed to load queue stats by channel:', e);
      });
    return () => { cancelled = true; };
  }, [channels.length]);

  // Fetch stock info per-channel in parallel (independent of stats)
  useEffect(() => {
    if (channels.length === 0) return;
    let cancelled = false;
    Promise.all(
      channels.map((ch) =>
        getChannelStock(ch.id).then((info) => [ch.id, info] as const).catch(() => [ch.id, null] as const)
      )
    ).then((pairs) => {
      if (cancelled) return;
      const stockData: Record<number, ChannelStockInfo> = {};
      for (const [id, info] of pairs) {
        if (info) stockData[id] = info as ChannelStockInfo;
      }
      setStockInfo(stockData);
    });
    return () => { cancelled = true; };
  }, [channels, getChannelStock]);


  const handleDeleteClick = (channel: SchedulerChannel, e: React.MouseEvent) => {
    e.stopPropagation();
    setChannelToDelete(channel);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (channelToDelete) {
      await deleteChannel(channelToDelete.id);
      setDeleteDialogOpen(false);
      setChannelToDelete(null);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const getSortedChannels = () => {
    const sorted = [...channels].sort((a, b) => {
      // Apply custom row order first (if no sort field active)
      if (sortField === 'name' || sortField === 'platform' || sortField === 'mode' || sortField === 'pending' || sortField === 'days') {
        let aValue: any;
        let bValue: any;

        switch (sortField) {
          case 'name':
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
            break;
          case 'platform':
            aValue = a.platform;
            bValue = b.platform;
            break;
          case 'mode':
            aValue = a.prompt_mode;
            bValue = b.prompt_mode;
            break;
          case 'pending':
            aValue = stockInfo[a.id]?.pendingInQueue || 0;
            bValue = stockInfo[b.id]?.pendingInQueue || 0;
            break;
          case 'days':
            aValue = stockInfo[a.id]?.daysOfContent || 0;
            bValue = stockInfo[b.id]?.daysOfContent || 0;
            break;
          default:
            return 0;
        }

        if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      }
      return 0;
    });

    // Apply custom row order if saved
    if (rowOrder.length > 0) {
      sorted.sort((a, b) => {
        const aIdx = rowOrder.indexOf(a.id);
        const bIdx = rowOrder.indexOf(b.id);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return 1;
        return aIdx - bIdx;
      });
    }

    return sorted;
  };

  const handleRowDragStart = (e: React.DragEvent, channelId: number) => {
    setDraggedRowId(channelId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', channelId.toString());
  };

  const handleRowDragOver = (e: React.DragEvent, channelId: number) => {
    e.preventDefault();
    if (draggedRowId !== channelId) {
      setDragOverRowId(channelId);
    }
  };

  const handleRowDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedRowId === null || draggedRowId === targetId) return;

    const currentList = getSortedChannels().map(c => c.id);
    const fromIdx = currentList.indexOf(draggedRowId);
    const toIdx = currentList.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const newOrder = [...currentList];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedRowId);

    setRowOrder(newOrder);
    localStorage.setItem(ROW_ORDER_STORAGE_KEY, JSON.stringify(newOrder));
    setDraggedRowId(null);
    setDragOverRowId(null);
  };

  const handleRowDragEnd = () => {
    setDraggedRowId(null);
    setDragOverRowId(null);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />;
  };

  const getAiModelDisplay = (channel: SchedulerChannel) => {
    const model = channel.ai_model || 'sora2_15s';
    switch (model) {
      case 'kie_viral_template':
        return { label: 'Viral Template', color: 'text-[#FFB300]', isKie: true };
      case 'kie_idol_template':
        return { label: 'Idol Template', color: 'text-[#FFB300]', isKie: true };
      case 'kie_sora2':
        return { label: 'KIE · Sora2', color: 'text-[#FFB300]', isKie: true };
      case 'kie_grok_imagine':
        return { label: 'KIE · Grok 10-30s', color: 'text-[#FFB300]', isKie: true };
      case 'kie_grok_extend':
        return { label: 'KIE · Grok Extend', color: 'text-[#FFB300]', isKie: true };
      case 'grok_imagine':
        return { label: 'Vidgo · Grok 10s', color: 'text-[#FFB300]', isKie: false };
      case 'veo3_1':
        return { label: 'Vidgo · Veo 3.1', color: 'text-[#FFB300]', isKie: false };
      case 'sora2_15s':
      default:
        return { label: 'Vidgo · Sora2 15s', color: 'text-[#FFB300]', isKie: false };
    }
  };

  const getItemModelDisplay = (item: any) => {
    const model = item?.ai_model || '';
    const duration = item?.duration || '';
    switch (model) {
      case 'kie_viral_template':
        return { label: 'Viral Template', isKie: true };
      case 'kie_idol_template':
        return { label: 'Idol Template', isKie: true };
      case 'kie_sora2':
        return { label: `KIE · Sora2 ${duration}s`, isKie: true };
      case 'kie_grok_imagine':
        return { label: `KIE · Grok ${duration}s`, isKie: true };
      case 'kie_grok_extend':
        return { label: `KIE · Grok Extend`, isKie: true };
      case 'grok_imagine':
        return { label: `Vidgo · Grok ${duration}s`, isKie: false };
      case 'veo3_1':
        return { label: `Vidgo · Veo 3.1 ${duration}s`, isKie: false };
      case 'sora2_15s':
        return { label: `Vidgo · Sora2 ${duration}s`, isKie: false };
      default: {
        // Fallback to platform for old items without ai_model
        const platform = item?.platform || '';
        if (platform === 'sora2-kie') return { label: `KIE · ${duration}s`, isKie: true };
        if (platform === 'sora2-vidgo') return { label: `Vidgo · ${duration}s`, isKie: false };
        return { label: platform || 'Unknown', isKie: false };
      }
    }
  };

  if (loadingChannels) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-[calc(100vw-2rem)] -ml-[calc((100vw-2rem-100%)/2)]">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t('channelList.title')} ({channels.length})</h2>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="h-4 w-4 mr-2" />
                {t('channelList.columns')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{t('channelList.toggleColumns')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="p-2 space-y-1">
                {getOrderedColumns().map(column => (
                  <div
                    key={column.key}
                    draggable
                    onDragStart={(e) => handleDragStart(e, column.key)}
                    onDragOver={(e) => handleDragOver(e, column.key)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 text-sm p-1 rounded cursor-move ${
                      draggedColumn === column.key ? 'opacity-50 bg-muted' : 'hover:bg-muted/50'
                    } ${column.required ? 'opacity-60' : ''}`}
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <Checkbox
                      checked={isColumnVisible(column.key)}
                      onCheckedChange={() => toggleColumn(column.key)}
                      disabled={column.required}
                    />
                    <span className="flex-1">{column.label}</span>
                    {column.required && <span className="text-[10px] text-muted-foreground">{t('channelList.required')}</span>}
                  </div>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={onAddChannel} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            {t('channel.addChannel')}
          </Button>
        </div>
      </div>

      {channels.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">{t('channelList.noChannels')}</p>
            <Button onClick={onAddChannel}>
              <Plus className="h-4 w-4 mr-2" />
              {t('channel.createChannel')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto" id="channel-table-container">
            <Table className="text-xs w-full min-w-[1100px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent h-8">
                  <TableHead className="whitespace-nowrap text-center py-1" style={{ width: 40 }}>#</TableHead>
                  {getVisibleOrderedColumns().map(key => {
                    const w = columnWidths[key] || DEFAULT_COLUMN_WIDTHS[key] || 100;
                    const columnLabels: Record<string, string> = {
                      schedule: t('channelList.schedulePost'),
                      generateVideo: t('channelList.generateVideo'),
                      history: t('scheduler.history'),
                      processing: t('channelList.processing'),
                      success: t('channelList.success'),
                      failed: t('channelList.failed'),
                      channel: t('dashboard.channel'),
                      concept: t('channelList.concept'),
                      aiModel: t('channelList.aiModel'),
                      duration: 'Duration',
                      platforms: t('channelList.platforms'),
                      facebookAdmin: t('channelList.fbAdmin'),
                      page: t('channelList.page'),
                      postsPerDay: t('channelList.postsPerDay'),
                      timezone: t('channelList.timeZone'),
                      prompt: t('channelList.promptMode'),
                    };
                    const sortable = key === 'channel' ? 'name' : key === 'prompt' ? 'mode' : null;
                    return (
                      <TableHead
                        key={key}
                        className={`whitespace-nowrap py-1 relative overflow-hidden ${sortable ? 'cursor-pointer select-none' : ''}`}
                        style={{ width: w }}
                        onClick={sortable ? () => handleSort(sortable as SortField) : undefined}
                      >
                        <div className={`flex items-center truncate pr-2 ${key === 'aiModel' || key === 'duration' || key === 'platforms' ? 'justify-center' : ''}`}>
                          {columnLabels[key] || key}
                          {sortable && <SortIcon field={sortable as SortField} />}
                        </div>
                        <div
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-amber-500/40 active:bg-amber-500/60"
                          onMouseDown={(e) => handleResizeStart(e, key)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableHead>
                    );
                  })}
                  <TableHead className="whitespace-nowrap text-center py-1" style={{ width: 60 }}>{t('channelList.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {getSortedChannels().map((channel, index) => {
                  const pageIds: PageIds = channel.page_ids || { facebook: '', instagram: '', tiktok: '', twitter: '', youtube: '' };

                  // Get active platforms based on posting_service
                  const getActivePlatforms = (): string[] => {
                    switch (channel.posting_service) {
                      case 'late':
                        return channel.late_accounts?.map(acc => acc.platform) || [];
                      case 'blotato':
                        return Object.entries(pageIds).filter(([_, v]) => v).map(([k]) => k);
                      case 'postforme': {
                        const pfmPlatforms = ['facebook', 'instagram', 'tiktok', 'youtube', 'twitter'];
                        return (channel.postforme_accounts || [])
                          .map((acc: string, i: number) => acc && acc.trim() ? pfmPlatforms[i] : null)
                          .filter(Boolean) as string[];
                      }
                      case 'none':
                      default:
                        return [];
                    }
                  };
                  const activePlatforms = getActivePlatforms();
                  const postformeCount = channel.posting_service === 'postforme' ? (channel.postforme_accounts?.filter((a: string) => a && a.trim()).length || 0) : 0;

                  return (
                    <TableRow
                      key={channel.id}
                      data-channel-id={String(channel.id)}
                      className={`cursor-pointer hover:bg-muted/50 transition-colors h-10 ${dragOverRowId === channel.id ? 'border-t-2 border-cyan-500' : ''} ${draggedRowId === channel.id ? 'opacity-40' : ''}`}
                      onClick={() => onOpenSchedule(channel)}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); handleRowDragStart(e, channel.id); }}
                      onDragOver={(e) => handleRowDragOver(e, channel.id)}
                      onDrop={(e) => handleRowDrop(e, channel.id)}
                      onDragEnd={handleRowDragEnd}
                    >
                      {/* Row Number + Drag Handle */}
                      <TableCell className="text-center text-muted-foreground">
                        <div className="flex items-center justify-center gap-1">
                          <GripVertical className="h-3 w-3 text-muted-foreground/50 cursor-grab" />
                          {index + 1}
                        </div>
                      </TableCell>

                      {/* Dynamic Columns */}
                      {getVisibleOrderedColumns().map(key => {
                        switch (key) {
                          case 'schedule':
                            return (
                              <TableCell key={key}>
                                <Button variant="default" size="sm" className="h-6 w-[110px] px-2 text-[10px] flex items-center justify-center gap-1" onClick={(e) => { e.stopPropagation(); onOpenSchedule(channel); }}>
                                  <Calendar className="h-3 w-3 flex-shrink-0" /><span>{t('channelList.schedulePost')}</span>
                                </Button>
                              </TableCell>
                            );
                          case 'generateVideo':
                            return (
                              <TableCell key={key}>
                                <Button
                                  variant="default"
                                  size="sm"
                                  className={`h-6 w-[110px] px-2 text-[10px] flex items-center justify-center gap-1 ${isChannelGenerating(channel.id) ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                                  onClick={(e) => { e.stopPropagation(); setGenChannel(channel); setGenShowAssignment(true); setGenDialogOpen(true); loadGenTasks(channel.id); loadActiveGens(channel.id); }}
                                >
                                  {isChannelGenerating(channel.id) ? <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" /> : <Video className="h-3 w-3 flex-shrink-0" />}
                                  <span>{isChannelGenerating(channel.id) ? t('history.generating') : t('channelList.generateVideo')}</span>
                                </Button>
                              </TableCell>
                            );
                          case 'history':
                            return (
                              <TableCell key={key}>
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="h-6 w-[110px] px-2 text-[10px] flex items-center justify-center gap-1"
                                  onClick={(e) => { e.stopPropagation(); sessionStorage.setItem('channels_scroll_to', String(channel.id)); navigate(`/app/history?channel_id=${channel.id}`); }}
                                >
                                  <History className="h-3 w-3 flex-shrink-0" />
                                  <span>{t('scheduler.history')}</span>
                                </Button>
                              </TableCell>
                            );
                          case 'processing': {
                            const stats = queueStatsMap[channel.id];
                            const processingCount = stats ? (stats.pending || 0) + (stats.queued || 0) + (stats.generating || 0) + (stats.captioning || 0) + (stats.scheduling || 0) : null;
                            return (
                              <TableCell key={key} className="text-center font-medium text-amber-500">
                                {processingCount === null ? <span className="text-muted-foreground/40">—</span> : processingCount}
                              </TableCell>
                            );
                          }
                          case 'success': {
                            const stats = queueStatsMap[channel.id];
                            const successCount = stats ? (stats.done || 0) : null;
                            return (
                              <TableCell key={key} className="text-center font-medium text-emerald-500">
                                {successCount === null ? <span className="text-muted-foreground/40">—</span> : successCount}
                              </TableCell>
                            );
                          }
                          case 'failed': {
                            const stats = queueStatsMap[channel.id];
                            const failedCount = stats ? (stats.failed || 0) : null;
                            return (
                              <TableCell key={key} className="text-center font-medium text-red-500">
                                {failedCount === null ? <span className="text-muted-foreground/40">—</span> : failedCount}
                              </TableCell>
                            );
                          }
                          case 'channel':
                            return (
                              <TableCell key={key} className="font-medium py-1">
                                <span className="truncate block max-w-[140px]">{channel.name}</span>
                              </TableCell>
                            );
                          case 'concept':
                            return (
                              <TableCell key={key} onClick={(e) => e.stopPropagation()}>
                                {editingConceptId === channel.id ? (
                                  <div className="flex items-center gap-1">
                                    <Input value={editingConceptValue} onChange={(e) => setEditingConceptValue(e.target.value)} className="h-7 text-xs w-[180px]" autoFocus
                                      onKeyDown={async (e) => {
                                        if (e.key === 'Enter') {
                                          await updateChannel(channel.id, { channel_concept: editingConceptValue });
                                          setEditingConceptId(null);
                                        } else if (e.key === 'Escape') { setEditingConceptId(null); }
                                      }}
                                    />
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={async () => { await updateChannel(channel.id, { channel_concept: editingConceptValue }); setEditingConceptId(null); }}>
                                      <Check className="h-3 w-3 text-green-500" />
                                    </Button>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditingConceptId(null)}>
                                      <X className="h-3 w-3 text-red-500" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded" onClick={() => { setEditingConceptId(channel.id); setEditingConceptValue(channel.channel_concept || ''); }} title={channel.channel_concept || ''}>
                                    <span className="text-xs truncate max-w-[140px]">{channel.channel_concept || '-'}</span>
                                    <Pencil className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                  </div>
                                )}
                              </TableCell>
                            );
                          case 'aiModel':
                            return (
                              <TableCell key={key}>
                                <div className="flex justify-center">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#FFB300]/10 border border-[#FFB300]/20 text-[#FFB300] text-[9px] font-medium whitespace-nowrap" title={getAiModelDisplay(channel).label}>
                                    {getAiModelDisplay(channel).label}
                                  </span>
                                </div>
                              </TableCell>
                            );
                          case 'duration':
                            return (
                              <TableCell key={key}>
                                <div className="flex justify-center">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[9px] font-medium whitespace-nowrap">
                                    {channel.ai_model === 'kie_grok_extend' ? '10s+10s' : `${channel.duration || '10'}s`}
                                  </span>
                                </div>
                              </TableCell>
                            );
                          case 'platforms':
                            return (
                              <TableCell key={key}>
                                {activePlatforms.length > 0 ? (
                                  <div className="flex items-center justify-center gap-1.5">
                                    {activePlatforms.includes('facebook') && <Facebook className="h-3.5 w-3.5 text-blue-500" />}
                                    {activePlatforms.includes('instagram') && <Instagram className="h-3.5 w-3.5 text-pink-500" />}
                                    {activePlatforms.includes('tiktok') && <TikTokIcon />}
                                    {activePlatforms.includes('twitter') && <XIcon />}
                                    {activePlatforms.includes('youtube') && <Youtube className="h-3.5 w-3.5 text-red-500" />}
                                  </div>
                                ) : postformeCount > 0 ? (
                                  <span className="text-xs text-green-400">{postformeCount} accounts</span>
                                ) : (
                                  <span className="text-muted-foreground text-xs">-</span>
                                )}
                              </TableCell>
                            );
                          case 'facebookAdmin':
                            const fbName = (channel as any).fb_admin_name;
                            const fbAvatar = (channel as any).fb_admin_avatar;
                            return (
                              <TableCell key={key}>
                                {fbName ? (
                                  <div className="flex items-center gap-2 max-w-[140px]">
                                    {fbAvatar ? (
                                      <img
                                        src={fbAvatar}
                                        alt=""
                                        className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                                      />
                                    ) : (
                                      <div className="w-5 h-5 rounded-full bg-orange-500/30 flex items-center justify-center text-[10px] flex-shrink-0">
                                        {fbName.charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                    <span className="text-xs truncate">{fbName}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            );
                          case 'page':
                            return (
                              <TableCell key={key}>
                                <span className="text-xs text-muted-foreground">{channel.late_accounts?.length ? `${channel.late_accounts.length} pages` : '-'}</span>
                              </TableCell>
                            );
                          case 'postsPerDay':
                            return (
                              <TableCell key={key}>
                                <div className="flex items-center gap-1 text-xs">
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <span>{channel.posts_per_day || 3}</span>
                                </div>
                                {channel.time_slots && channel.time_slots.length > 0 && (
                                  <div className="text-[10px] text-muted-foreground mt-0.5">
                                    {channel.time_slots.join(', ')}
                                  </div>
                                )}
                              </TableCell>
                            );
                          case 'timezone':
                            return (
                              <TableCell key={key} className="py-1">
                                <span className="text-[10px] text-muted-foreground">{(channel.timezone || 'local').replace(/^.*\//, '')}</span>
                              </TableCell>
                            );
                          case 'prompt':
                            return (
                              <TableCell key={key}>
                                {channel.prompt_mode === 'variable' ? (
                                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                    <Type className="h-3 w-3 mr-1" />{t('channelList.variable')}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/30">
                                    <Bot className="h-3 w-3 mr-1" />{t('channelList.system')}
                                  </Badge>
                                )}
                              </TableCell>
                            );
                          default:
                            return null;
                        }
                      })}

                      {/* Actions */}
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditChannel(channel);
                            }}
                          >
                            <Settings className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => handleDeleteClick(channel, e)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('channelList.deleteChannel')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('channelList.deleteConfirm', { name: channelToDelete?.name || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generate to History Dialog */}
      <Dialog open={genDialogOpen} onOpenChange={setGenDialogOpen}>
        <DialogContent className="p-0 gap-0 border-zinc-700" style={{ maxWidth: '900px', width: '95vw', maxHeight: '90vh' }}>
          <div className="px-6 py-4 border-b border-zinc-700/50">
            <DialogHeader className="p-0 space-y-0">
              <DialogTitle>{t('dayDetail.genToHistoryTitle')}</DialogTitle>
              {genChannel && <p className="text-sm text-muted-foreground">{genChannel.name}</p>}
            </DialogHeader>
          </div>
          <div className="px-6 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
            {/* Template mode selector + Generate All - always at top */}
            {genShowAssignment && genChannel && (
              <div className="flex items-center gap-2 flex-wrap">
                {(() => { const _t = (genChannel.ai_model === 'kie_viral_template' && genChannel.ai_prompt_templates?.length > 0) ? genChannel.ai_prompt_templates : genChannel.prompt_templates; return _t && _t.length > 0; })() && (
                  <>
                    <span className="text-xs text-zinc-500">ใช้ Template:</span>
                    <Select
                      value={genTemplateMode}
                      onValueChange={(val) => {
                        setGenTemplateMode(val);
                      }}
                    >
                      <SelectTrigger className="w-auto h-7 px-3 bg-amber-500/20 border-amber-500/30 text-amber-400 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mixed">สลับกัน</SelectItem>
                        {((genChannel.ai_model === 'kie_viral_template' && genChannel.ai_prompt_templates?.length > 0) ? genChannel.ai_prompt_templates : genChannel.prompt_templates)?.map((tmpl) => (
                          <SelectItem key={tmpl.id} value={tmpl.id}>{tmpl.label || tmpl.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
                <div className="flex-1" />
                {(genTasks.length > 0 || (genChannel && activeGens[genChannel.id] && activeGens[genChannel.id].ids.length > 0)) && (() => {
                  const gen = genChannel ? activeGens[genChannel.id] : null;
                  if (!gen) return genTasks.length > 0 ? genTasks.length : null;
                  // นับเฉพาะงานที่ลบได้ (done/failed และ pending ที่ไม่ได้ retry)
                  const deletableCount = gen.ids.filter(tid => {
                    const s = gen.statuses[tid];
                    if (!s) return false;
                    if (['done', 'failed'].includes(s)) return true;
                    if (['generating', 'captioning', 'scheduling', 'queued'].includes(s)) return false;
                    // pending — เช็ค log ว่ากำลัง retry อยู่หรือเปล่า
                    if (s === 'pending') {
                      const taskLogs = gen.logs[tid] || [];
                      const lastLogMsg = taskLogs[taskLogs.length - 1]?.message || '';
                      const isRetrying = lastLogMsg.includes('Retry') || lastLogMsg.includes('Still generating') || lastLogMsg.includes('Sending prompt') || lastLogMsg.includes('Task created') || lastLogMsg.includes('Resuming');
                      return !isRetrying;
                    }
                    return true;
                  }).length + genTasks.length;
                  if (deletableCount === 0) return null;
                  return deletableCount;
                })() && (() => {
                  const gen = genChannel ? activeGens[genChannel.id] : null;
                  const deletableCount = (() => {
                    if (!gen) return genTasks.length;
                    return gen.ids.filter(tid => {
                      const s = gen.statuses[tid];
                      if (!s) return false;
                      if (['done', 'failed'].includes(s)) return true;
                      if (['generating', 'captioning', 'scheduling', 'queued'].includes(s)) return false;
                      if (s === 'pending') {
                        const taskLogs = gen.logs[tid] || [];
                        const lastLogMsg = taskLogs[taskLogs.length - 1]?.message || '';
                        return !(lastLogMsg.includes('Retry') || lastLogMsg.includes('Still generating') || lastLogMsg.includes('Sending prompt') || lastLogMsg.includes('Task created') || lastLogMsg.includes('Resuming'));
                      }
                      return true;
                    }).length + genTasks.length;
                  })();
                  return (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
                    onClick={async () => {
                      if (genChannel) {
                        const gen2 = activeGens[genChannel.id];
                        if (gen2) {
                          // ลบเฉพาะงานที่ไม่ active (done/failed/pending ที่ไม่ได้ retry)
                          const remainingIds: number[] = [];
                          for (const taskId of gen2.ids) {
                            const s = gen2.statuses[taskId];
                            const taskLogs = gen2.logs[taskId] || [];
                            const lastLog = taskLogs[taskLogs.length - 1]?.message || '';
                            const taskRetrying = lastLog.includes('Retry') || lastLog.includes('Still generating') || lastLog.includes('Sending prompt') || lastLog.includes('Task created') || lastLog.includes('Resuming');
                            const taskActive = s && (['generating', 'captioning', 'scheduling', 'queued'].includes(s) || (s === 'pending' && taskRetrying));
                            if (taskActive) {
                              remainingIds.push(taskId);
                            } else {
                              try { await api.deleteScheduleQueueItem(taskId); } catch {}
                            }
                          }
                          // อัปเดต state เหลือเฉพาะงาน active
                          if (remainingIds.length === 0) {
                            if (genPollingRefs.current[genChannel.id]) {
                              clearInterval(genPollingRefs.current[genChannel.id]);
                              delete genPollingRefs.current[genChannel.id];
                            }
                            setActiveGens(prev => {
                              const n = { ...prev };
                              delete n[genChannel.id];
                              return n;
                            });
                          } else {
                            setActiveGens(prev => {
                              const n = { ...prev };
                              const g = n[genChannel.id];
                              if (g) {
                                n[genChannel.id] = {
                                  ...g,
                                  ids: remainingIds,
                                };
                              }
                              return n;
                            });
                          }
                        }
                        setGenTasks([]);
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" /> ลบทั้งหมด ({deletableCount})
                  </Button>
                  );
                })()}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-xs gap-1.5 text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                  onClick={() => { setGenDialogOpen(false); navigate(`/app/history?channel_id=${genChannel!.id}&from=gen`); }}
                >
                  <History className="h-3 w-3" /> {t('scheduler.history')}
                </Button>
                {genTasks.length > 0 && (
                  <Button
                    size="sm"
                    className="h-9 px-6 bg-[#FFB300] hover:bg-[#FFC233] text-black text-sm font-medium gap-2 rounded-full"
                    disabled={genLoading}
                    onClick={(e) => { e.stopPropagation(); handleGenToHistory(); }}
                  >
                    {genLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    สร้างทั้งหมด ({genTasks.length})
                  </Button>
                )}
              </div>
            )}

            {/* Active generating tasks */}
            {genChannel && activeGens[genChannel.id] && (() => {
                const gen = activeGens[genChannel.id];
                if (!gen) return null;
                const allFinished = Object.values(gen.statuses).every(s => ['done', 'failed'].includes(s));
                return (
                  <div className="space-y-4">
                    {gen.ids.map((id, idx) => {
                      const status = gen.statuses[id] || 'pending';
                      const logs = gen.logs[id] || [];
                      const itemData = gen.items[id];
                      const statusCfg: Record<string, { label: string; color: string; bg: string; border: string }> = {
                        pending: { label: 'PENDING', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
                        generating: { label: 'VIDEO...', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
                        captioning: { label: 'CAPTION', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
                        scheduling: { label: 'POST', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
                        posting_retry: { label: 'รอลองใหม่', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
                        done: { label: 'DONE', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' },
                        failed: { label: 'FAILED', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
                        stopped: { label: 'หยุดแล้ว', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
                      };
                      const lastLogMsg: string = (logs[logs.length - 1]?.message || '');
                      const isStopped = lastLogMsg.includes('Stopped');
                      const isRetrying = !isStopped && (lastLogMsg.includes('Retry') || lastLogMsg.includes('Still generating') || lastLogMsg.includes('Still extending') || lastLogMsg.includes('Phase 1 complete') || lastLogMsg.includes('Phase 2') || lastLogMsg.includes('Phase 1:') || lastLogMsg.includes('Sending prompt') || lastLogMsg.includes('Task created') || lastLogMsg.includes('Resuming') || lastLogMsg.includes('Recovery'));
                      const _errLower = (itemData?.error || '').toLowerCase();
                      const isCreditError = _errLower.includes('credit') && /insufficient|not enough|exhausted|no credit|balance|หมด/.test(_errLower);
                      // ถ้า log บอก Stopped → แสดง หยุดแล้ว ไม่ว่า DB status จะเป็นอะไร
                      // ถ้ากำลัง retry อยู่ → แสดง VIDEO...
                      const displayStatus = isStopped ? 'stopped' : (status === 'pending' && isRetrying) ? 'generating' : status;
                      // Custom status config for credit error
                      const sc = isCreditError
                        ? { label: 'เครดิตหมด', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' }
                        : (statusCfg[displayStatus] || statusCfg.pending);
                      const isActive = !isStopped && (['generating', 'captioning', 'scheduling', 'queued'].includes(status) || (status === 'pending' && isRetrying));
                      const logsVisible = genShowLogs.has(id);
                      const prompt = itemData?.prompt;
                      return (
                        <div key={id} className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 overflow-hidden">
                          <div className="flex items-center gap-2 px-4 py-3 bg-zinc-800/40 flex-wrap">
                            <span className="font-mono font-bold text-amber-400 text-lg shrink-0">งาน {idx + 1}</span>
                            <Badge variant="outline" className={`text-xs shrink-0 px-2.5 py-0.5 ${sc.color} ${sc.bg} ${sc.border}`}>
                              {isActive && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                              {status === 'done' && <Check className="h-3 w-3 mr-1" />}
                              {status === 'failed' && <X className="h-3 w-3 mr-1" />}
                              {sc.label}
                            </Badge>
                            {(() => {
                              const md = itemData ? getItemModelDisplay(itemData) : (genChannel ? getAiModelDisplay(genChannel) : null);
                              if (!md) return null;
                              return (
                                <a href={md.isKie ? 'https://kie.ai/api-key' : 'https://vidgo.ai/apis/dashboard/history'} target="_blank" rel="noopener noreferrer">
                                  <Badge variant="outline" className="text-[10px] shrink-0 px-2 py-0.5 text-[#FFB300] bg-[#FFB300]/10 border-[#FFB300]/30 hover:bg-[#FFB300]/20 cursor-pointer">
                                    {md.label}
                                  </Badge>
                                </a>
                              );
                            })()}
                            <div className="flex items-center gap-1 text-[10px] shrink-0">
                              <Video className={`h-3 w-3 ${status === 'generating' ? 'text-amber-400' : ['captioning', 'scheduling', 'done'].includes(status) ? 'text-green-500' : 'text-zinc-600'}`} />
                              <span className="text-zinc-600">→</span>
                              <Bot className={`h-3 w-3 ${status === 'captioning' ? 'text-amber-400' : ['scheduling', 'done'].includes(status) ? 'text-green-500' : 'text-zinc-600'}`} />
                              <span className="text-zinc-600">→</span>
                              {status === 'done' ? <Check className="h-3 w-3 text-green-500" /> :
                               status === 'failed' ? <X className="h-3 w-3 text-red-500" /> :
                               <Clock className="h-3 w-3 text-zinc-600" />}
                            </div>
                            <div className="flex-1 text-xs px-2 truncate">
                              {(() => {
                                const lastLog = logs[logs.length - 1];
                                const lastMsg: string = (lastLog?.message || '');
                                const lastLogAge = lastLog ? (Date.now() - new Date(lastLog.created_at).getTime()) / 1000 : 0;
                                const isStale = lastLogAge > 120 && (status === 'generating' || status === 'pending');
                                if (isStale && !lastMsg.includes('Stopped')) return <span className="text-amber-400">รอนานกว่าปกติ ระบบกำลังลองใหม่อัตโนมัติ...</span>;
                                if (lastMsg.includes('Stopped')) return <span className="text-red-400">{isCreditError ? 'เครดิตหมด' : 'หยุดแล้ว'}</span>;
                                if (status === 'generating' || status === 'pending') {
                                  if (lastMsg.includes('Retry')) {
                                    const m = lastMsg.match(/Retry #(\d+) in (\d+)s/);
                                    const lastLog = logs[logs.length - 1];
                                    return <RetryCountdown logId={`${id}-${lastLog?.created_at}`} delaySec={parseInt(m?.[2] || '60')} retryNum={m?.[1] || '?'} />;
                                  }
                                  if (lastMsg.includes('Recovery: Video found')) {
                                    return <span className="text-green-400">พบวิดีโอแล้ว กำลังดำเนินการต่อ...</span>;
                                  }
                                  if (lastMsg.includes('Still extending')) {
                                    const m = lastMsg.match(/\((\d+)s elapsed\)/);
                                    if (m) {
                                      const secs = parseInt(m[1]);
                                      const elapsed = secs >= 60 ? `${Math.floor(secs / 60)} นาที` : `${secs} วินาที`;
                                      return <span className="text-cyan-400">กำลังต่อคลิป... ({elapsed})</span>;
                                    }
                                  }
                                  if (lastMsg.includes('Phase 1 complete') || lastMsg.includes('Phase 2')) {
                                    return <span className="text-cyan-400">กำลังต่อคลิป...</span>;
                                  }
                                  if (lastMsg.includes('Still generating')) {
                                    const m = lastMsg.match(/\((\d+)s elapsed\)/);
                                    if (m) {
                                      const secs = parseInt(m[1]);
                                      const elapsed = secs >= 60 ? `${Math.floor(secs / 60)} นาที` : `${secs} วินาที`;
                                      return <span className="text-amber-400">AI กำลังสร้างวิดีโอ... ({elapsed})</span>;
                                    }
                                  }
                                  if (lastMsg.includes('Sending prompt')) return <span className="text-amber-400">กำลังส่งคำสั่งไป AI...</span>;
                                  if (lastMsg.includes('Task created')) return <span className="text-amber-400">AI รับงานแล้ว รอสร้างวิดีโอ...</span>;
                                  if (lastMsg.includes('Resuming')) return <span className="text-amber-400">กำลังดึงวิดีโอที่ค้างไว้...</span>;
                                  if (lastMsg.includes('failed') || lastMsg.includes('Failed')) return <span className="text-amber-400">เกิดข้อผิดพลาด รอลองใหม่...</span>;
                                  if (status === 'generating') return <span className="text-amber-400">AI กำลังสร้างวิดีโอ...</span>;
                                  return <span className="text-zinc-500">รอคิวสร้างวิดีโอ...</span>;
                                }
                                if (status === 'captioning') return <span className="text-amber-400">AI กำลังเขียนคำบรรยาย...</span>;
                                if (status === 'scheduling') return <span className="text-amber-400">กำลังโพสต์ลง Facebook...</span>;
                                if (status === 'queued') return <span className="text-zinc-500">อยู่ในคิว รอสร้างวิดีโอ...</span>;
                                if (status === 'done') {
                                  return <span className="text-green-400">สร้างวิดีโอเสร็จแล้ว</span>;
                                }
                                if (status === 'failed') return <span className="text-red-400">{isCreditError ? 'เครดิตหมด' : 'หยุดแล้ว'}</span>;
                                return null;
                              })()}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isActive && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-3 text-xs gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
                                  onClick={async () => {
                                    try {
                                      await api.stopItemRetry(id);
                                    } catch {}
                                  }}
                                  disabled={false}
                                >
                                  <Square className="h-3 w-3" /> {t('dayDetail.stop')}
                                </Button>
                              )}
                              {!isActive && (displayStatus === 'failed' || displayStatus === 'stopped' || status === 'failed') && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-3 text-xs gap-1.5 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                                  onClick={async () => {
                                    try {
                                      await api.generateSingleQueueItem(id, true);
                                      // อัพเดท status ทันทีในUI + เริ่ม polling
                                      const channelId = genChannel!.id;
                                      setActiveGens(prev => {
                                        const existing = prev[channelId];
                                        if (!existing) return prev;
                                        return { ...prev, [channelId]: { ...existing, statuses: { ...existing.statuses, [id]: 'generating' }, logs: { ...existing.logs, [id]: [] } } };
                                      });
                                      pollGenTasks(channelId, [id]);
                                    } catch {}
                                  }}
                                >
                                  <RefreshCw className="h-3 w-3" /> ลองอีกครั้ง
                                </Button>
                              )}
                              {!isActive && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-3 text-xs gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
                                onClick={async () => {
                                  try { await api.deleteScheduleQueueItem(id); } catch {}
                                  const channelId = genChannel!.id;
                                  setActiveGens(prev => {
                                    const existing = prev[channelId];
                                    if (!existing) return prev;
                                    const newIds = existing.ids.filter(i => i !== id);
                                    if (newIds.length === 0) {
                                      const n = { ...prev };
                                      delete n[channelId];
                                      return n;
                                    }
                                    const newStatuses = { ...existing.statuses };
                                    const newLogs = { ...existing.logs };
                                    const newItems = { ...existing.items };
                                    delete newStatuses[id];
                                    delete newLogs[id];
                                    delete newItems[id];
                                    return { ...prev, [channelId]: { ...existing, ids: newIds, statuses: newStatuses, logs: newLogs, items: newItems } };
                                  });
                                }}
                              >
                                <Trash2 className="h-3 w-3" /> ลบ
                              </Button>
                              )}
                            </div>
                          </div>
                          {prompt && (
                            <div className="px-4 py-3 border-t border-zinc-700/30">
                              <p className="text-sm text-amber-400/80">{prompt.slice(0, 200)}{prompt.length > 200 ? ' ...' : ''}</p>
                            </div>
                          )}
                          {/* Video player when done */}
                          {status === 'done' && itemData?.video_url && (
                            <div className="px-4 pb-3 border-t border-zinc-700/30 pt-3">
                              <div className="rounded-lg overflow-hidden border border-zinc-700/50 bg-black relative group">
                                <video
                                  src={itemData.video_url}
                                  controls
                                  className="w-full max-h-[280px] object-contain"
                                  preload="auto"
                                />
                              </div>
                            </div>
                          )}
                          <div className="border-t border-zinc-700/30">
                            <button
                              onClick={() => setGenShowLogs(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                              className="w-full flex items-center gap-2 px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors"
                            >
                              {logsVisible ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              <Activity className="h-3 w-3" />
                              <span>ประวัติกิจกรรม - คิว - คิว #{id}</span>
                            </button>
                            {logsVisible && (
                              <div className="px-4 pb-3">
                                <div
                                  className="bg-zinc-950/50 rounded-md border border-zinc-800 max-h-[180px] overflow-y-auto overscroll-contain"
                                  ref={(el) => {
                                    if (!el) return;
                                    if (!logUserScrolledRef.current.has(id)) {
                                      el.scrollTop = el.scrollHeight;
                                    }
                                  }}
                                  onScroll={(e) => {
                                    const el = e.currentTarget;
                                    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                                    if (isNearBottom) {
                                      logUserScrolledRef.current.delete(id);
                                    } else {
                                      logUserScrolledRef.current.add(id);
                                    }
                                  }}
                                >
                                  {logs.length > 0 ? (
                                    <div className="p-2 space-y-0.5">
                                      {logs.map((log: any, i: number) => (
                                        <div key={i} className="flex items-start gap-2 text-[11px] py-0.5 px-1 font-mono">
                                          <span className="text-zinc-600 shrink-0">
                                            {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                          </span>
                                          <span className={
                                            log.log_type === 'error' ? 'text-red-400' :
                                            log.log_type === 'success' ? 'text-green-400' :
                                            log.log_type === 'warning' ? 'text-amber-400' :
                                            'text-zinc-400'
                                          }>
                                            {log.message}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="p-3 text-xs text-zinc-600">{t('dayDetail.noLogs')}</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
            })()}

            {/* Task List UI - always visible when in assignment mode */}
            {genShowAssignment && genChannel ? (
                <div className="space-y-3">
                  {genTasksLoading && (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
                    </div>
                  )}
                  {/* Task cards */}
                  {!genTasksLoading && genTasks.map((task, idx) => {
                    const activeGenCount = (genChannel && activeGens[genChannel.id]) ? activeGens[genChannel.id].ids.length : 0;
                    const allTemplates = (genChannel.ai_model === 'kie_viral_template' && genChannel.ai_prompt_templates?.length > 0)
                      ? genChannel.ai_prompt_templates : genChannel.prompt_templates;
                    const tmpl = allTemplates?.find(t => t.id === task.templateId);
                    const basePrompt = tmpl?.prompt_template || genChannel.prompt_template || '';
                    const prompt = task.customPrompt || basePrompt;
                    const baseExtendPrompt = tmpl?.extend_prompt_template || '';
                    const extendPrompt = task.customExtendPrompt || baseExtendPrompt;
                    const taskNum = activeGenCount + idx + 1;
                    return (
                      <div key={idx} className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-3 bg-zinc-800/40 flex-wrap">
                          <span className="font-mono font-bold text-amber-400 text-lg shrink-0">งาน {taskNum}</span>
                          <Badge variant="outline" className="text-xs shrink-0 px-2.5 py-0.5 text-yellow-400 bg-yellow-500/10 border-yellow-500/30">
                            PENDING
                          </Badge>
                          {(() => {
                            const md = task.ai_model
                              ? getAiModelDisplay({ ai_model: task.ai_model } as any)
                              : (genChannel ? getAiModelDisplay(genChannel) : null);
                            if (!md) return null;
                            return (
                              <a href={md.isKie ? 'https://kie.ai/api-key' : 'https://vidgo.ai/apis/dashboard/history'} target="_blank" rel="noopener noreferrer">
                                <Badge variant="outline" className="text-[10px] shrink-0 px-2 py-0.5 text-[#FFB300] bg-[#FFB300]/10 border-[#FFB300]/30 hover:bg-[#FFB300]/20 cursor-pointer">
                                  {md.label}
                                </Badge>
                              </a>
                            );
                          })()}
                          <div className="flex items-center gap-1 text-[10px] shrink-0">
                            <Video className="h-3 w-3 text-zinc-600" />
                            <span className="text-zinc-600">→</span>
                            <Bot className="h-3 w-3 text-zinc-600" />
                            <span className="text-zinc-600">→</span>
                            <Clock className="h-3 w-3 text-zinc-600" />
                          </div>

                          <div className="flex-1" />

                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              size="sm"
                              className="h-7 px-3 bg-[#FFB300] hover:bg-[#FFC233] text-black text-xs gap-1.5 rounded-md"
                              disabled={genLoading}
                              onClick={(e) => { e.stopPropagation(); handleGenToHistory(idx); }}
                            >
                              {genLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                              {t('dayDetail.generate')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                              onClick={() => {
                                setGenTasks(prev => prev.filter((_, i) => i !== idx));
                                setGenEditingIdx(prev => {
                                  if (prev === null) return null;
                                  if (prev === idx) return null;
                                  if (prev > idx) return prev - 1;
                                  return prev;
                                });
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        {/* Prompt Selection */}
                        <div className="px-4 py-3 border-t border-zinc-700/30">
                          {!task.templateId || task.templateId === '' ? (
                            /* No template selected - show dropdown to select */
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-zinc-500 italic">ยังไม่ได้เลือก Prompt</span>
                              {((genChannel.ai_model === 'kie_viral_template' ? genChannel.ai_prompt_templates : genChannel.prompt_templates) || []).length > 0 ? (
                                <Select
                                  value=""
                                  onValueChange={(val) => {
                                    setGenTasks(prev => {
                                      const newTasks = [...prev];
                                      const allTmpls = (genChannel?.ai_model === 'kie_viral_template' && genChannel?.ai_prompt_templates?.length > 0) ? genChannel.ai_prompt_templates : genChannel?.prompt_templates;
                                      const tmpl = allTmpls?.find(t => t.id === val);
                                      const prompt = tmpl?.prompt_template || '';
                                      const variables = tmpl?.variables || [];
                                      const baseOffset = variables.length > 0 ? countUsedValues(variables) : 0;
                                      const resolvedPrompt = resolvePromptVariables(prompt, variables, baseOffset + idx);
                                      // Also resolve extend_prompt separately
                                      let resolvedExtend = '';
                                      if (tmpl?.extend_prompt_template && tmpl?.extend_variables) {
                                        const extendBaseOffset = countUsedValues(tmpl.extend_variables);
                                        resolvedExtend = resolvePromptVariables(tmpl.extend_prompt_template, tmpl.extend_variables, extendBaseOffset + idx);
                                      }
                                      newTasks[idx] = { ...newTasks[idx], templateId: val, customPrompt: '', customExtendPrompt: resolvedExtend || undefined };
                                      return newTasks;
                                    });
                                  }}
                                >
                                  <SelectTrigger className="w-auto h-7 px-3 bg-amber-500/20 border-amber-500/30 text-amber-400 text-xs">
                                    เลือก Prompt Template
                                  </SelectTrigger>
                                  <SelectContent>
                                    {((genChannel.ai_model === 'kie_viral_template' && genChannel.ai_prompt_templates?.length > 0) ? genChannel.ai_prompt_templates : genChannel.prompt_templates)?.map((t) => (
                                      <SelectItem key={t.id} value={t.id}>
                                        {t.label || t.id}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : genChannel.prompt_template ? (
                                <Button
                                  size="sm"
                                  className="h-7 px-3 bg-amber-500 hover:bg-amber-600 text-black text-xs font-medium"
                                  onClick={() => {
                                    setGenTasks(prev => {
                                      const newTasks = [...prev];
                                      newTasks[idx] = { ...newTasks[idx], templateId: '__default__', customPrompt: '' };
                                      return newTasks;
                                    });
                                  }}
                                >
                                  ใช้ Prompt ของช่อง
                                </Button>
                              ) : null}
                            </div>
                          ) : genEditingIdx === idx ? (
                            /* Editing mode - show textarea for both prompts */
                            <div className="space-y-3">
                              {/* Main Prompt */}
                              <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-amber-500/15 text-amber-400 border-amber-500/30">
                                    Main Prompt
                                  </Badge>
                                </div>
                                <textarea
                                  className="w-full h-32 p-2 text-sm bg-zinc-900 border border-amber-500/30 rounded-md text-amber-400/90 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500"
                                  value={task.customPrompt || basePrompt}
                                  onChange={(e) => {
                                    setGenTasks(prev => {
                                      const newTasks = [...prev];
                                      newTasks[idx] = { ...newTasks[idx], customPrompt: e.target.value };
                                      return newTasks;
                                    });
                                  }}
                                  placeholder="แก้ไข Main Prompt..."
                                />
                              </div>
                              {/* Extend Prompt (only for kie_grok_extend model) */}
                              {baseExtendPrompt && task.ai_model === 'kie_grok_extend' && (
                                <div>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-cyan-500/15 text-cyan-400 border-cyan-500/30">
                                      Extend Prompt
                                    </Badge>
                                  </div>
                                  <textarea
                                    className="w-full h-32 p-2 text-sm bg-zinc-900 border border-cyan-500/30 rounded-md text-cyan-400/90 resize-none focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                    value={task.customExtendPrompt || baseExtendPrompt}
                                    onChange={(e) => {
                                      setGenTasks(prev => {
                                        const newTasks = [...prev];
                                        newTasks[idx] = { ...newTasks[idx], customExtendPrompt: e.target.value };
                                        return newTasks;
                                      });
                                    }}
                                    placeholder="แก้ไข Extend Prompt..."
                                  />
                                </div>
                              )}
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-3 text-xs"
                                  onClick={() => {
                                    setGenTasks(prev => {
                                      const newTasks = [...prev];
                                      newTasks[idx] = { ...newTasks[idx], customPrompt: '', customExtendPrompt: undefined };
                                      return newTasks;
                                    });
                                    setGenEditingIdx(null);
                                  }}
                                >
                                  รีเซ็ต
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 px-3 bg-amber-500 hover:bg-amber-600 text-black text-xs"
                                  onClick={() => setGenEditingIdx(null)}
                                >
                                  <Check className="h-3 w-3 mr-1" />
                                  บันทึก
                                </Button>
                              </div>
                            </div>
                          ) : (
                            /* Template selected - show template label + prompt */
                            <div>
                              {/* Template label + switcher */}
                              <div className="flex items-center gap-2 mb-1.5">
                                <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-amber-500/15 text-amber-400 border-amber-500/30">
                                  {tmpl?.label || (task.templateId === '__default__' ? 'Default' : task.templateId)}
                                </Badge>
                                {(() => { const _t = (genChannel.ai_model === 'kie_viral_template' && genChannel.ai_prompt_templates?.length > 0) ? genChannel.ai_prompt_templates : genChannel.prompt_templates; return _t && _t.length > 0; })() && (
                                  <Select
                                    value={task.templateId}
                                    onValueChange={(val) => {
                                      setGenTasks(prev => {
                                        const newTasks = [...prev];
                                        const _allTmpls = (genChannel?.ai_model === 'kie_viral_template' && genChannel?.ai_prompt_templates?.length > 0) ? genChannel.ai_prompt_templates : genChannel?.prompt_templates;
                                        const tmpl = _allTmpls?.find(t => t.id === val);
                                        const prompt = tmpl?.prompt_template || '';
                                        const variables = tmpl?.variables || [];
                                        const baseOffset = variables.length > 0 ? countUsedValues(variables) : 0;
                                        const resolvedPrompt = resolvePromptVariables(prompt, variables, baseOffset + idx);
                                        // Also resolve extend_prompt separately
                                        let resolvedExtend = '';
                                        if (tmpl?.extend_prompt_template && tmpl?.extend_variables) {
                                          const extendBaseOffset = countUsedValues(tmpl.extend_variables);
                                          resolvedExtend = resolvePromptVariables(tmpl.extend_prompt_template, tmpl.extend_variables, extendBaseOffset + idx);
                                        }
                                        newTasks[idx] = { ...newTasks[idx], templateId: val, customPrompt: '', customExtendPrompt: resolvedExtend || undefined };
                                        return newTasks;
                                      });
                                    }}
                                  >
                                    <SelectTrigger className="w-auto h-6 px-2 bg-transparent border-0 text-zinc-500 hover:text-zinc-300 text-[10px]">
                                      <RefreshCw className="h-3 w-3" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {((genChannel.ai_model === 'kie_viral_template' && genChannel.ai_prompt_templates?.length > 0) ? genChannel.ai_prompt_templates : genChannel.prompt_templates)?.map((t) => (
                                        <SelectItem key={t.id} value={t.id}>
                                          {t.label || t.id}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>
                              {/* Main Prompt */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-sm text-amber-400/80 flex-1">
                                  {prompt ? prompt.slice(0, 150) + (prompt.length > 150 ? '...' : '') : 'ไม่มี Prompt'}
                                </div>
                                <button
                                  className="text-zinc-500 hover:text-amber-400 transition-colors p-1 shrink-0"
                                  onClick={() => setGenEditingIdx(idx)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {/* Extend Prompt (only for kie_grok_extend model) */}
                              {extendPrompt && task.ai_model === 'kie_grok_extend' && (
                                <div className="mt-3 pt-3 border-t border-cyan-500/20">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-cyan-500/15 text-cyan-400 border-cyan-500/30">
                                      Extend Prompt
                                    </Badge>
                                  </div>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="text-sm text-cyan-400/80 flex-1">
                                      {extendPrompt.slice(0, 150) + (extendPrompt.length > 150 ? '...' : '')}
                                    </div>
                                    <button
                                      className="text-zinc-500 hover:text-cyan-400 transition-colors p-1 shrink-0"
                                      onClick={() => setGenEditingIdx(idx)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Activity Logs Toggle */}
                        <div className="border-t border-zinc-700/30">
                          <button
                            onClick={() => setGenPendingLogsOpen(prev => {
                              const next = new Set(prev);
                              if (next.has(idx)) next.delete(idx); else next.add(idx);
                              return next;
                            })}
                            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors"
                          >
                            {genPendingLogsOpen.has(idx) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            <Activity className="h-3 w-3" />
                            <span>ประวัติกิจกรรม - งาน {taskNum}</span>
                          </button>

                          {genPendingLogsOpen.has(idx) && (
                            <div className="px-4 pb-3">
                              <div className="bg-zinc-950/50 rounded-md border border-zinc-800 p-3">
                                <p className="text-xs text-zinc-500 italic">ยังไม่มีประวัติกิจกรรม</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Add Task Controls */}
                  {!genTasksLoading && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-sm text-zinc-500">{genTasks.length} งานจะถูกเพิ่ม</span>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center border border-zinc-700 rounded-md overflow-hidden">
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-none hover:bg-zinc-800" onClick={() => setGenAddCount(prev => Math.max(1, prev - 1))}>-</Button>
                        <span className="w-8 text-center text-sm">{genAddCount}</span>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-none hover:bg-zinc-800" onClick={() => setGenAddCount(prev => Math.min(50, prev + 1))}>+</Button>
                      </div>

                      <Button
                        className="h-9 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white gap-2"
                        onClick={() => {
                          const templates = (genChannel?.ai_model === 'kie_viral_template' && genChannel?.ai_prompt_templates?.length > 0)
                            ? genChannel.ai_prompt_templates
                            : (genChannel?.prompt_templates || []);
                          setGenTasks(prev => {
                            const existingCount = prev.length;
                            const newTasks = Array(genAddCount).fill(null).map((_, i) => {
                              if (templates.length > 0) {
                                // Pick template based on mode
                                const tmpl = genTemplateMode === 'mixed'
                                  ? templates[(existingCount + i) % templates.length]
                                  : templates.find(t => t.id === genTemplateMode) || templates[0];
                                const prompt = tmpl.prompt_template || '';
                                const variables = tmpl.variables || [];
                                const baseOffset = countUsedValues(variables);
                                const resolvedPrompt = resolvePromptVariables(prompt, variables, baseOffset + existingCount + i);
                                // Also resolve extend_prompt separately
                                let resolvedExtend = '';
                                if (tmpl.extend_prompt_template && tmpl.extend_variables) {
                                  const extendBaseOffset = countUsedValues(tmpl.extend_variables);
                                  resolvedExtend = resolvePromptVariables(tmpl.extend_prompt_template, tmpl.extend_variables, extendBaseOffset + existingCount + i);
                                }
                                return { templateId: tmpl.id, customPrompt: '', customExtendPrompt: resolvedExtend || undefined, ai_model: genChannel?.ai_model };
                              } else if (genChannel?.prompt_template) {
                                const prompt = genChannel.prompt_template;
                                const variables = genChannel.variables || [];
                                const baseOffset = countUsedValues(variables);
                                const resolvedPrompt = resolvePromptVariables(prompt, variables, baseOffset + existingCount + i);
                                return { templateId: '__default__', customPrompt: '', ai_model: genChannel?.ai_model };
                              }
                              return { templateId: '', customPrompt: '', ai_model: genChannel?.ai_model };
                            });
                            return [...prev, ...newTasks];
                          });
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        เพิ่ม {genAddCount}
                      </Button>
                    </div>
                  </div>
                  )}
                </div>
              ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChannelList;
