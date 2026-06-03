import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, Play, RefreshCw, Trash2, Clock, AlertCircle, ChevronDown, ChevronRight, Loader2, Activity, Video, Bot, Send, Check, Pencil, Plus, Save, X, Bookmark, Maximize2, Facebook, Instagram, Youtube, Square, History, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useScheduler } from '@/contexts/SchedulerContext';
import type { ScheduleSlot, TimePreset, PostForMeProviderResult } from '@/types/scheduler';
import { PostStatusDialog } from './PostStatusDialog';
import { cn } from '@/lib/utils';
import LazyVideo from '@/components/ui/LazyVideo';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { useGenerateConfirm } from '@/components/common/GenerateConfirmDialog';
import { quoteSchedulerItem, buildQuote } from '@/lib/generationPricing';

// Helper: Get next hour as default time slot (avoids past time error)
// Accepts optional timezone - if not provided, uses browser local time
function getNextHourTimeSlot(timezone?: string): string {
  const now = new Date();
  if (timezone) {
    const tzNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const nextHour = (tzNow.getHours() + 1) % 24;
    return `${nextHour.toString().padStart(2, '0')}:00`;
  }
  const nextHour = (now.getHours() + 1) % 24;
  return `${nextHour.toString().padStart(2, '0')}:00`;
}

// Helper: Convert a date string and time to UTC, interpreting in the given timezone
function toUTCInTimezone(dateStr: string, time: string, timezone: string): string {
  // Create a date-time string like "2026-02-09T20:00:00"
  const localDateTimeStr = `${dateStr}T${time.padStart(5, '0')}:00`;

  // Parse as local date first (browser timezone)
  const localDate = new Date(localDateTimeStr);

  // Get the offset difference between browser timezone and target timezone
  const browserTzDate = new Date(localDate.toLocaleString('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  const targetTzDate = new Date(localDate.toLocaleString('en-US', { timeZone: timezone }));
  const offsetDiff = browserTzDate.getTime() - targetTzDate.getTime();

  // Adjust the date by the offset difference
  const utcDate = new Date(localDate.getTime() + offsetDiff);

  return utcDate.toISOString();
}

interface DayDetailModalProps {
  open: boolean;
  onClose: () => void;
  dateStr: string;
  dates?: string[];  // Optional: for multi-day selection
  slots: ScheduleSlot[];
  showAddFormOnOpen?: boolean;  // Optional: open Add Task form immediately
}

export const DayDetailModal: React.FC<DayDetailModalProps> = ({
  open,
  onClose,
  dateStr,
  dates,  // Array of dates for multi-day mode
  slots: _slots, // kept for interface compatibility
  showAddFormOnOpen = false,
}) => {
  const { t } = useLanguage();

  // Determine if we're in multi-day mode
  const isMultiDay = dates && dates.length > 1;
  // Memoize effectiveDates to prevent infinite re-renders
  const effectiveDates = useMemo(() => {
    return dates && dates.length > 0 ? dates : [dateStr];
  }, [dates, dateStr]);
  const { deleteQueueItem, retryQueueItem, fetchQueue, currentChannel, queueItems, startQueueRunner } = useScheduler();
  const { requestConfirm, dialog: confirmDialog } = useGenerateConfirm();

  // ราคา (ประมาณ) ของคิว scheduler — อิง ai_model + scenes + duration ของ channel
  const buildSchedulerQuote = useCallback((count: number, durationOverride?: number, hasExtend?: boolean) => {
    const ch: any = currentChannel || {};
    const aiModel = ch.ai_model as string | undefined;
    const scenes = ch.viral_scenes_per_video ?? ch.idol_scenes_per_video ?? 3;
    const durationSec = durationOverride ?? (parseInt(String(ch.duration)) || 10);
    const tasks = Array.from({ length: Math.max(1, count) }).map((_, i) =>
      quoteSchedulerItem({
        taskLabel: `${t('calendar.generate')} #${i + 1}`,
        aiModel,
        scenes,
        durationSec,
        hasExtendPrompt: hasExtend ?? !!ch.extend_prompt,
      })
    );
    return buildQuote(tasks);
  }, [currentChannel, t]);

  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [itemLogs, setItemLogs] = useState<Record<number, any[]>>({});
  const [loadingLogs, setLoadingLogs] = useState<Set<number>>(new Set());
  const [showLogs, setShowLogs] = useState<Set<number>>(new Set());
  const [editingTimeId, setEditingTimeId] = useState<number | null>(null);
  const [editTimeValue, setEditTimeValue] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTaskPrompt, setNewTaskPrompt] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<number | null>(null);
  const [editPromptValue, setEditPromptValue] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  // Time slots and presets
  const [timeSlots, setTimeSlots] = useState<string[]>(() => [getNextHourTimeSlot()]);
  const [presets, setPresets] = useState<TimePreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [isSavingPreset, setIsSavingPreset] = useState(false);

  // Track items we've requested generation for (to force polling even if status is still 'pending')
  const [pendingGenerationIds, setPendingGenerationIds] = useState<Set<number>>(new Set());
  // Item id whose Postforme post-status popup is currently open (null = closed).
  const [statusDialogItemId, setStatusDialogItemId] = useState<number | null>(null);
  // Ref for synchronous access (avoids closure issues)
  const pendingGenerationIdsRef = useRef<Set<number>>(new Set());

  // Prevent double-clicking Generate button
  const [isStartingQueue, setIsStartingQueue] = useState(false);
  // Template selection for multi-template channels
  const [selectedTemplateMode, setSelectedTemplateMode] = useState<string>('all-round-robin');

  // Track which item is being stopped from retrying
  const [stoppingRetryId, setStoppingRetryId] = useState<number | null>(null);

  // Items for this day (fetched directly)
  const [dayItems, setDayItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Realtime clock for channel timezone
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');

  // Expanded video modal
  const [expandedVideoUrl, setExpandedVideoUrl] = useState<string | null>(null);

  // Generate to history dialog
  const [showGenToHistory, setShowGenToHistory] = useState(false);
  const [genToHistoryCount, setGenToHistoryCount] = useState(1);
  const [isGenToHistory, setIsGenToHistory] = useState(false);

  // Add task counter (like ChannelList)
  const [addCount, setAddCount] = useState(1);

  // Pull from history popup
  const [showHistoryPopup, setShowHistoryPopup] = useState(false);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historySelectedVideo, setHistorySelectedVideo] = useState<any | null>(null);
  const [historyTargetItemId, setHistoryTargetItemId] = useState<number | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'final' | 'scene' | 'image'>('all');
  const historyCacheRef = useRef<{ channelId: number; filter: string; items: any[]; hasMore: boolean; ts: number } | null>(null);
  const HISTORY_LIMIT = 20;

  // Get effective timezone
  const effectiveTimezone = useMemo(() => {
    if (!currentChannel || currentChannel.timezone === 'local') {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    return currentChannel.timezone;
  }, [currentChannel]);


  // Helper function to get AI Model display name
  const getAiModelDisplay = (model?: string): { label: string; color: string; borderColor: string } => {
    switch (model) {
      case 'kie_viral_template':
        return { label: 'Viral Template', color: 'text-[#FFB300]', borderColor: 'border-[#FFB300]/30' };
      case 'kie_idol_template':
        return { label: 'Idol Template', color: 'text-[#E040FB]', borderColor: 'border-[#E040FB]/30' };
      case 'kie_sora2':
        return { label: '[KIE] Sora2', color: 'text-[#FFB300]', borderColor: 'border-[#FFB300]/30' };
      case 'kie_grok_imagine':
        return { label: '[KIE] Grok Imagine', color: 'text-[#FFB300]', borderColor: 'border-[#FFB300]/30' };
      case 'kie_grok_extend':
        return { label: '[KIE] Grok + Extend', color: 'text-[#FFB300]', borderColor: 'border-[#FFB300]/30' };
      case 'grok_imagine':
        return { label: '[Vidgo] Grok Imagine', color: 'text-[#FFB300]', borderColor: 'border-[#FFB300]/30' };
      case 'veo3_1':
        return { label: '[Vidgo] Veo 3.1', color: 'text-[#FFB300]', borderColor: 'border-[#FFB300]/30' };
      case 'sora2_15s':
      default:
        return { label: '[Vidgo] Sora2', color: 'text-green-400', borderColor: 'border-green-500/30' };
    }
  };

  // Helper functions for Blotato status
  const hasBlotato = (item: any): boolean => {
    return item.blotato_post_ids && Array.isArray(item.blotato_post_ids) && item.blotato_post_ids.length > 0;
  };

  const isBlotatoSuccess = (item: any): boolean => {
    if (!hasBlotato(item)) return false;
    return item.blotato_post_ids.every((p: any) => p.status === 'success');
  };

  const hasBlotatoFailure = (item: any): boolean => {
    if (!hasBlotato(item)) return false;
    return item.blotato_post_ids.some((p: any) => p.status === 'failed');
  };

  // Update clock every second
  useEffect(() => {
    if (!open) return;

    const updateTime = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-GB', {
        timeZone: effectiveTimezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const dateStr = now.toLocaleDateString('en-US', {
        timeZone: effectiveTimezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      setCurrentTime(timeStr);
      setCurrentDate(dateStr);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [open, effectiveTimezone]);

  // Fetch items for selected date(s)
  const fetchDayItems = useCallback(async (silent = false) => {
    if (!currentChannel || effectiveDates.length === 0) return;
    if (!silent) setLoadingItems(true);
    try {
      // Get date range for API call
      const sortedDates = [...effectiveDates].sort();
      const startDate = sortedDates[0];
      const endDate = sortedDates[sortedDates.length - 1];

      console.log(`[Modal] Fetching items: dates=${effectiveDates.join(',')}, start=${startDate}, end=${endDate}, tz=${effectiveTimezone}`);
      const data = await api.getScheduleQueueByDate({
        channel_id: currentChannel.id,
        start_date: startDate,
        end_date: endDate,
        timezone: effectiveTimezone,  // Use channel timezone for correct date grouping
      });
      console.log(`[Modal] Received data keys:`, Object.keys(data), 'looking for:', effectiveDates);

      // Collect items from all selected dates (with date info)
      const allItems: any[] = [];
      for (const d of effectiveDates) {
        const items = data[d] || [];
        items.forEach((item: any) => {
          allItems.push({ ...item, _date: d });
        });
      }

      // Sort by date then time
      allItems.sort((a, b) => {
        if (a._date !== b._date) return a._date.localeCompare(b._date);
        return new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime();
      });

      // Only update if data actually changed (prevents flickering)
      // Also preserve optimistic status for items we're waiting on
      setDayItems(prev => {
        // Use ref for synchronous access (avoids closure issues)
        const trackingIds = pendingGenerationIdsRef.current;

        // Merge: if item is being tracked AND server says pending, force to 'queued'
        // Don't depend on prevItem - ref is the source of truth
        const mergedItems = allItems.map(item => {
          if (trackingIds.has(item.id) && item.status === 'pending') {
            return { ...item, status: 'queued' };
          }
          return item;
        });

        const prevJson = JSON.stringify(prev.map(i => ({ id: i.id, status: i.status, prompt: i.prompt, video_url: i.video_url, platform: i.platform, external_task_id: i.external_task_id })));
        const newJson = JSON.stringify(mergedItems.map(i => ({ id: i.id, status: i.status, prompt: i.prompt, video_url: i.video_url, platform: i.platform, external_task_id: i.external_task_id })));
        if (prevJson === newJson) return prev;
        console.log('📅 Day items updated:', effectiveDates, mergedItems.length);
        return mergedItems;
      });
    } catch (e) {
      console.error('Failed to fetch day items:', e);
    } finally {
      if (!silent) setLoadingItems(false);
    }
  }, [currentChannel, effectiveDates, effectiveTimezone]);

  // Fetch on open
  useEffect(() => {
    if (open) {
      fetchDayItems();
    }
  }, [open, fetchDayItems]);

  // Silent refresh when queueItems change (to prevent flickering)
  const prevQueueItemsRef = React.useRef(queueItems);
  useEffect(() => {
    // Only trigger silent refresh if modal is open AND queueItems actually changed
    if (open && prevQueueItemsRef.current !== queueItems) {
      prevQueueItemsRef.current = queueItems;
      fetchDayItems(true); // Silent mode - no loading state
    }
  }, [open, queueItems, fetchDayItems]);

  // Auto-refresh when there are active items OR items we're waiting on
  useEffect(() => {
    if (!open) return;

    // Check if any items are currently being processed
    const hasActive = dayItems.some(item =>
      ['generating', 'captioning', 'scheduling', 'queued', 'viral_pending', 'viral_running', 'idol_pending', 'idol_running', 'image_generating'].includes(item.status)
    );

    // Also check if we have items we clicked Generate on (might still show 'pending' in stale data)
    const hasWaitingItems = pendingGenerationIds.size > 0;

    if (!hasActive && !hasWaitingItems) return;

    const interval = setInterval(() => {
      fetchDayItems(true); // silent refresh - no loading state, no flicker
    }, 2000); // Refresh every 2 seconds

    return () => clearInterval(interval);
  }, [open, dayItems, pendingGenerationIds, fetchDayItems]);

  // Clear pendingGenerationIds when items are no longer pending
  useEffect(() => {
    if (pendingGenerationIds.size === 0) return;

    const stillPending = new Set<number>();
    dayItems.forEach(item => {
      if (pendingGenerationIds.has(item.id) && item.status === 'pending') {
        stillPending.add(item.id);
      }
    });

    // If some items changed status, update both state and ref
    if (stillPending.size !== pendingGenerationIds.size) {
      pendingGenerationIdsRef.current = stillPending;
      setPendingGenerationIds(stillPending);
    }
  }, [dayItems, pendingGenerationIds]);

  // Fetch presets on mount
  useEffect(() => {
    const loadPresets = async () => {
      try {
        const data = await api.getTimePresets();
        setPresets(data);
      } catch (e) {
        console.error('Failed to load presets:', e);
      }
    };
    if (open) loadPresets();
  }, [open]);

  // Reset form state when modal closes
  useEffect(() => {
    if (!open) {
      setShowAddForm(false);
      setNewTaskPrompt('');
      setSelectedPresetId('');
    }
  }, [open]);

  // Show Add form on open if requested (for multi-day add / double-click)
  // Also reset time slots to channel presets when modal opens
  useEffect(() => {
    if (open) {
      // Use channel's saved time_slots if available, otherwise fallback to next hour
      if (currentChannel?.time_slots && currentChannel.time_slots.length > 0) {
        setTimeSlots([...currentChannel.time_slots]);
      } else {
        setTimeSlots([getNextHourTimeSlot(effectiveTimezone)]);
      }
      if (showAddFormOnOpen) {
        setShowAddForm(true);
      }
    }
  }, [open, showAddFormOnOpen, effectiveTimezone, currentChannel]);

  // Use dayItems instead of slots prop
  const activeSlots = useMemo(() => {
    return dayItems.map(item => ({
      id: item.id.toString(),
      date: dateStr,
      dayName: new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' }),
      time: (() => {
        try {
          const tz = currentChannel?.timezone === 'local'
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : currentChannel?.timezone || 'UTC';
          const d = new Date(item.scheduled_time);
          return d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
        } catch {
          return '--:--';
        }
      })(),
      scheduledTime: item.scheduled_time,
      variableValues: item.variable_values,
      status: 'exists' as const,
      existingItem: item,
    }));
  }, [dayItems, dateStr, currentChannel]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const fetchLogsForItem = useCallback(async (queueItemId: number) => {
    if (loadingLogs.has(queueItemId)) return;
    setLoadingLogs(prev => new Set(prev).add(queueItemId));
    try {
      const logs = await api.getQueueItemLogs(queueItemId);
      setItemLogs(prev => ({ ...prev, [queueItemId]: logs }));
    } catch (e) {
      console.error('Failed to fetch logs:', e);
    } finally {
      setLoadingLogs(prev => { const n = new Set(prev); n.delete(queueItemId); return n; });
    }
  }, [loadingLogs]);

  const toggleExpand = useCallback((itemId: number) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
        if (!itemLogs[itemId]) {
          fetchLogsForItem(itemId);
        }
      }
      return next;
    });
  }, [itemLogs, fetchLogsForItem]);

  const toggleLogs = useCallback((itemId: number) => {
    setShowLogs(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
        if (!itemLogs[itemId]) {
          fetchLogsForItem(itemId);
        }
      }
      return next;
    });
  }, [itemLogs, fetchLogsForItem]);

  // Auto-fetch and auto-expand logs for active items (like SchedulePanel)
  const fetchLogsRef = useRef(fetchLogsForItem);
  fetchLogsRef.current = fetchLogsForItem;

  const activeStatuses = ['pending', 'generating', 'captioning', 'scheduling', 'viral_pending', 'viral_running', 'idol_pending', 'idol_running', 'image_generating'];

  useEffect(() => {
    if (!open) return; // Don't poll logs when modal closed (was leaking interval)
    const activeIds: number[] = [];
    const activeAndDoneIds: number[] = [];
    activeSlots.forEach(slot => {
      const item = slot.existingItem;
      if (!item) return;
      if (activeStatuses.includes(item.status)) {
        activeIds.push(item.id);
        activeAndDoneIds.push(item.id);
      } else if (['done', 'failed'].includes(item.status)) {
        activeAndDoneIds.push(item.id);
      }
    });

    // Auto-expand logs for active items
    if (activeIds.length > 0) {
      setShowLogs(prev => {
        const next = new Set(prev);
        let changed = false;
        activeIds.forEach(id => { if (!next.has(id)) { next.add(id); changed = true; } });
        return changed ? next : prev;
      });
    }

    // Initial fetch for items that don't have logs yet
    activeAndDoneIds.forEach(id => {
      if (!itemLogs[id]) {
        fetchLogsRef.current(id);
      }
    });

    if (activeIds.length === 0) return;

    // Refresh logs every 3s for active items
    const interval = setInterval(() => {
      activeIds.forEach(id => fetchLogsRef.current(id));
    }, 3000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlots, open]);

  // Re-fetch logs when status changes to done/failed (final fetch)
  const statusKey = activeSlots.map(s => `${s.existingItem?.id}:${s.existingItem?.status}`).join(',');
  useEffect(() => {
    activeSlots.forEach(slot => {
      const item = slot.existingItem;
      if (!item) return;
      if (['done', 'failed'].includes(item.status)) {
        fetchLogsRef.current(item.id);
        // Auto-open logs for completed/failed items too
        setShowLogs(prev => {
          if (prev.has(item.id)) return prev;
          const next = new Set(prev);
          next.add(item.id);
          return next;
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);

  const handleDelete = async (id: number) => {
    if (confirm(t('dashboard.confirmDelete'))) {
      try {
        const success = await deleteQueueItem(id);
        if (success) {
          toast.success(t('dayDetail.itemDeleted'));
        }
        if (currentChannel) await fetchQueue({ channel_id: currentChannel.id });
      } catch (error: any) {
        toast.error(error?.message || t('dayDetail.failedToDelete'));
      }
    }
  };

  const handleRetry = async (id: number) => {
    // Check if this is a viral template item — retry viral task directly
    const item = activeSlots.find(s => s.existingItem?.id === id)?.existingItem;
    if (item?.external_task_id && String(item.external_task_id).startsWith('viral-')) {
      try {
        // Reset viral task to pending so viralRunnerJob picks it up
        const match = String(item.external_task_id).match(/^viral-(\d+)-(\d+)$/);
        if (match) {
          const viralTaskId = match[2];
          await api.retryViralTask(viralTaskId);
          await api.updateScheduleQueueItem(id, { status: 'viral_pending', error: null } as any);
          toast.success('Viral task retry started');
          setItemLogs(prev => { const next = { ...prev }; delete next[id]; return next; });
          setPendingGenerationIds(prev => new Set(prev).add(id));
          await fetchDayItems(true);
          if (currentChannel) await fetchQueue({ channel_id: currentChannel.id });
          return;
        }
      } catch (e) {
        console.error('Viral retry failed:', e);
      }
    }

    // Check if this is an idol template item — retry idol task directly
    if (item?.external_task_id && String(item.external_task_id).startsWith('idol-')) {
      try {
        // Reset idol task to pending so idolRunnerJob picks it up
        const match = String(item.external_task_id).match(/^idol-(\d+)-(\d+)$/);
        if (match) {
          const idolTaskId = match[2];
          await api.retryIdolTask(idolTaskId);
          await api.updateScheduleQueueItem(id, { status: 'idol_pending', error: null } as any);
          toast.success('Idol task retry started');
          setItemLogs(prev => { const next = { ...prev }; delete next[id]; return next; });
          setPendingGenerationIds(prev => new Set(prev).add(id));
          await fetchDayItems(true);
          if (currentChannel) await fetchQueue({ channel_id: currentChannel.id });
          return;
        }
      } catch (e) {
        console.error('Idol retry failed:', e);
      }
    }

    try {
      // Update platform based on channel's AI model
      const platform = currentChannel?.ai_model?.startsWith('kie_') ? 'sora2-kie' : 'sora2-vidgo';
      await api.updateScheduleQueueItem(id, { platform });
    } catch (e) {
      console.error('Failed to update platform:', e);
    }

    const success = await retryQueueItem(id);
    if (success) {
      toast.success(t('dayDetail.retryStarted'));
      setItemLogs(prev => { const next = { ...prev }; delete next[id]; return next; });
      setPendingGenerationIds(prev => new Set(prev).add(id));
      await fetchDayItems(true);
      if (currentChannel) await fetchQueue({ channel_id: currentChannel.id });
    }
  };

  const handleStopRetry = async (id: number) => {
    setStoppingRetryId(id);
    try {
      await api.stopItemRetry(id);
      toast.success(t('dayDetail.stopped'));

      // Update item status locally immediately (no flicker, no scroll jump)
      setDayItems(prev => prev.map(item =>
        item.id === id ? { ...item, status: 'failed', error: 'Stopped by user' } : item
      ));

      // Refresh logs for this item only
      await fetchLogsForItem(id);

      // Silent background refresh (no flicker)
      fetchDayItems(true);
      if (currentChannel) fetchQueue({ channel_id: currentChannel.id });
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.failedToStop'));
    } finally {
      setStoppingRetryId(null);
    }
  };

  const handleGenerate = (generateOnly?: boolean) => {
    if (isStartingQueue) return; // Prevent double-click
    const pendingIds = pendingSlots.map(s => s.existingItem?.id).filter((id): id is number => id !== undefined);
    requestConfirm(buildSchedulerQuote(pendingIds.length || 1), () => runGenerate(generateOnly));
  };

  const runGenerate = async (generateOnly?: boolean) => {
    if (isStartingQueue) return; // Prevent double-click

    setIsStartingQueue(true);
    try {
      // Track all pending items so we keep polling until their status changes
      const pendingIds = pendingSlots.map(s => s.existingItem?.id).filter((id): id is number => id !== undefined);

      // Update ref SYNCHRONOUSLY (before any async operations)
      pendingIds.forEach(id => pendingGenerationIdsRef.current.add(id));

      setPendingGenerationIds(prev => {
        const next = new Set(prev);
        pendingIds.forEach(id => next.add(id));
        return next;
      });

      // Update all pending items to 'queued' locally (no flicker)
      setDayItems(prev => prev.map(item =>
        pendingIds.includes(item.id) ? { ...item, status: 'queued' } : item
      ));

      // Parse template selection
      let templateId: string | undefined;
      let templateMode: string | undefined;
      if (selectedTemplateMode === 'all-round-robin') {
        templateMode = 'round-robin';
      } else if (selectedTemplateMode === 'all-random') {
        templateMode = 'random';
      } else if (selectedTemplateMode.startsWith('template-')) {
        templateId = selectedTemplateMode.replace('template-', '');
      }

      // Multi-day: don't filter by date so all pending items for this channel get processed
      // Single day: pass date to only generate items for this specific day
      const requestId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const started = isMultiDay
        ? await startQueueRunner(currentChannel?.id, undefined, undefined, templateId, templateMode, generateOnly, requestId)
        : await startQueueRunner(currentChannel?.id, [dateStr], effectiveTimezone, templateId, templateMode, generateOnly, requestId);
      if (started) toast.success(generateOnly ? t('dayDetail.generatingOnly') : t('dayDetail.processing'));

      // Don't call fetchDayItems or fetchQueue here - let polling handle it
      // This prevents race condition where pendingGenerationIds isn't updated yet
    } finally {
      setIsStartingQueue(false);
    }
  };

  // Generate clips to history (no posting, no schedule)
  const handleGenToHistory = async () => {
    if (!currentChannel || isGenToHistory) return;
    setIsGenToHistory(true);
    try {
      await api.generateToHistory(currentChannel.id, genToHistoryCount);
      toast.success(t('dayDetail.genToHistoryStarted', { count: genToHistoryCount }));
      setShowGenToHistory(false);
      setTimeout(() => { fetchDayItems(); fetchQueue(); }, 1000);
    } catch (error: any) {
      toast.error(error?.message || 'Failed');
    } finally {
      setIsGenToHistory(false);
    }
  };

  // Fetch history items for pull-from-history popup. Filter tab decides what's shown:
  //   'all'   → all video sources (default)
  //   'final' → viral_final_video only
  //   'scene' → viral_scene_video only
  //   'image' → images only (gpt_image_2, viral_image, idol_image)
  const fetchHistoryItems = async (reset = true, filterOverride?: 'all' | 'final' | 'scene' | 'image') => {
    if (!currentChannel) return;
    const activeFilter = filterOverride ?? historyFilter;
    const offset = reset ? 0 : historyItems.length;
    if (reset) {
      setHistoryLoading(true);
    } else {
      setHistoryLoadingMore(true);
    }
    try {
      const apiType: 'image' | 'video' = activeFilter === 'image' ? 'image' : 'video';
      // Image Template filter narrows to source='image_template' — only images generated via the
      // Image Template feature (template_slug IS NOT NULL on the underlying gpt_image_2 row).
      // Excludes direct /image/gpt-image-2 generations and viral/idol pipeline images.
      const sourceParam = activeFilter === 'final' ? 'viral_final_video' as const
        : activeFilter === 'scene' ? 'viral_scene_video' as const
        : activeFilter === 'image' ? 'image_template' as const
        : undefined;

      // Image Template generations from /admin/image-templates aren't tied to a scheduler
      // channel — skip channel_id filter for that tab so user sees all their image templates.
      const channelIdParam = activeFilter === 'image' ? undefined : currentChannel.id;

      const data = await api.getContentHistory({
        type: apiType,
        source: sourceParam,
        channel_id: channelIdParam,
        limit: HISTORY_LIMIT,
        offset,
        skip_count: true,
      });
      const mapped = data.items.map((item: any) => ({
        ...item,
        video_url: item.url,
        updated_at: item.created_at,
      }));
      const hasMore = mapped.length === HISTORY_LIMIT;
      if (reset) {
        setHistoryItems(mapped);
      } else {
        setHistoryItems(prev => [...prev, ...mapped]);
      }
      setHistoryHasMore(hasMore);
      // Update cache (keyed by channel + filter)
      const allItems = reset ? mapped : [...historyItems, ...mapped];
      historyCacheRef.current = {
        channelId: currentChannel.id,
        filter: activeFilter,
        items: allItems,
        hasMore,
        ts: Date.now(),
      };
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }
    setHistoryLoading(false);
    setHistoryLoadingMore(false);
  };

  const openHistoryPopup = (targetItemId: number) => {
    setHistoryTargetItemId(targetItemId);
    setShowHistoryPopup(true);
    // Use cache if same channel + filter and <60s old
    const cache = historyCacheRef.current;
    if (cache && currentChannel && cache.channelId === currentChannel.id && cache.filter === historyFilter && Date.now() - cache.ts < 60_000) {
      setHistoryItems(cache.items);
      setHistoryHasMore(cache.hasMore);
      return;
    }
    fetchHistoryItems(true);
  };

  const handlePullClipFromHistory = async (historyItem: any) => {
    if (!historyTargetItemId || !historyItem.video_url) return;
    try {
      // Copy video_url to target item, set pending so queue runner posts it at scheduled time
      const updateData: any = {
        video_url: historyItem.video_url,
        status: 'pending',
      };
      if (historyItem.dropbox_path) updateData.dropbox_path = historyItem.dropbox_path;
      if (historyItem.prompt) updateData.prompt = historyItem.prompt;
      await api.updateScheduleQueueItem(historyTargetItemId, updateData);
      setShowHistoryPopup(false);
      historyCacheRef.current = null; // Invalidate cache
      toast.success(t('dayDetail.clipPulled'));
      fetchDayItems(true);
    } catch (error) {
      console.error('Failed to pull clip from history:', error);
      toast.error(t('dayDetail.pullClipFailed'));
    }
  };

  // Post a completed item that was generated without posting
  const handlePostSingle = async (itemId: number) => {
    // Remember current status to restore on error
    const currentItem = dayItems.find(i => i.id === itemId);
    const prevStatus = currentItem?.status || 'pending';
    try {
      pendingGenerationIdsRef.current.add(itemId);
      setPendingGenerationIds(prev => new Set(prev).add(itemId));
      setDayItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, status: 'scheduling' } : item
      ));
      await api.postQueueItem(itemId);
      toast.success(t('dayDetail.postingStarted'));
    } catch (error: any) {
      pendingGenerationIdsRef.current.delete(itemId);
      setPendingGenerationIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
      setDayItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, status: prevStatus } : item
      ));
      toast.error(error?.message || 'Failed to post');
    }
  };

  // Post all ready items at once
  const handlePostAll = async () => {
    if (readyToPostItems.length === 0) return;
    setIsPostingAll(true);
    try {
      let posted = 0;
      for (const item of readyToPostItems) {
        try {
          pendingGenerationIdsRef.current.add(item.id);
          setPendingGenerationIds(prev => new Set(prev).add(item.id));
          setDayItems(prev => prev.map(d =>
            d.id === item.id ? { ...d, status: 'scheduling' } : d
          ));
          await api.postQueueItem(item.id);
          posted++;
        } catch (error) {
          console.error(`Failed to post item ${item.id}:`, error);
          pendingGenerationIdsRef.current.delete(item.id);
          setPendingGenerationIds(prev => { const next = new Set(prev); next.delete(item.id); return next; });
          setDayItems(prev => prev.map(d =>
            d.id === item.id ? { ...d, status: 'pending' } : d
          ));
        }
      }
      if (posted > 0) {
        toast.success(`${t('dayDetail.postAllStarted')} (${posted})`);
      }
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.postAllFailed'));
    } finally {
      setIsPostingAll(false);
    }
  };

  // Generate single item (not all pending) — show credit confirm popup first
  const handleGenerateSingle = (itemId: number) => {
    const item = dayItems.find(i => i.id === itemId);
    const durationOverride = item?.duration ? parseInt(String(item.duration)) || undefined : undefined;
    const quote = buildSchedulerQuote(1, durationOverride, !!item?.extend_prompt);
    requestConfirm(quote, () => runGenerateSingle(itemId));
  };

  const runGenerateSingle = async (itemId: number) => {
    try {
      // Update ref SYNCHRONOUSLY (before any async operations)
      pendingGenerationIdsRef.current.add(itemId);

      // Track this item so we keep polling until status changes
      setPendingGenerationIds(prev => new Set(prev).add(itemId));

      // Update status locally immediately (no flicker)
      setDayItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, status: 'generating' } : item
      ));

      // Pass extend_prompt if item has one (generateOnly=false → โพสต์ด้วย)
      const item = dayItems.find(i => i.id === itemId);
      await api.generateSingleQueueItem(itemId, false, item?.extend_prompt);

      // Don't call fetchDayItems or fetchQueue here - let polling handle it
      // This prevents race condition where pendingGenerationIds isn't updated yet
    } catch (error: any) {
      // Remove from tracking if failed
      pendingGenerationIdsRef.current.delete(itemId);
      setPendingGenerationIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      // Revert status on error
      setDayItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, status: 'pending' } : item
      ));
      toast.error(error?.message || t('dayDetail.failedToStartGeneration'));
    }
  };

  const handleEditTime = (itemId: number, currentTime: string) => {
    setEditingTimeId(itemId);
    setEditTimeValue(currentTime);
  };

  const handleSaveTime = async (itemId: number) => {
    if (!editTimeValue) return;
    try {
      // Parse the date and new time to create ISO string
      const parts = editTimeValue.split(':').map(Number);
      const hours = parts[0] ?? 0;
      const minutes = parts[1] ?? 0;
      // Parse dateStr as local date (YYYY-MM-DD) - split to avoid UTC parsing
      const [year, month, day] = dateStr.split('-').map(Number);
      const newDate = new Date(year!, month! - 1, day!, hours, minutes, 0, 0);

      await api.updateScheduleQueueItem(itemId, {
        scheduled_time: newDate.toISOString(),
      });
      toast.success(t('dayDetail.timeUpdated'));
      setEditingTimeId(null);
      if (currentChannel) await fetchQueue({ channel_id: currentChannel.id });
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.failedToUpdateTime'));
    }
  };

  const handleCancelEdit = () => {
    setEditingTimeId(null);
    setEditTimeValue('');
  };

  const handleEditPrompt = (itemId: number, currentPrompt: string) => {
    setEditingPromptId(itemId);
    setEditPromptValue(currentPrompt || '');
  };

  const handleSavePrompt = async (itemId: number) => {
    setIsSavingPrompt(true);
    try {
      await api.updateScheduleQueueItem(itemId, {
        prompt: editPromptValue,
      });
      toast.success(t('dayDetail.promptUpdated'));
      setEditingPromptId(null);
      setEditPromptValue('');
      if (currentChannel) await fetchQueue({ channel_id: currentChannel.id });
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.failedToUpdatePrompt'));
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleCancelPromptEdit = () => {
    setEditingPromptId(null);
    setEditPromptValue('');
  };

  // Add multiple tasks from time slots (to all selected dates)
  const handleAddTasks = async () => {
    if (timeSlots.length === 0 || !currentChannel) return;
    setIsAdding(true);
    try {
      // Use platform based on channel's AI model
      const platformToUse = currentChannel.ai_model?.startsWith('kie_') ? 'sora2-kie' : 'sora2-vidgo';

      // Get channel timezone for correct date conversion
      const channelTz = currentChannel.timezone === 'local'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : currentChannel.timezone;

      // Create tasks for ALL selected dates (skip past times)
      const items: any[] = [];
      const now = new Date();
      let skippedCount = 0;
      let isFirstItem = true;
      for (const d of effectiveDates) {
        for (const time of timeSlots) {
          // Convert date/time to UTC using channel's timezone
          const scheduledTimeUTC = toUTCInTimezone(d, time, channelTz);
          const scheduledDate = new Date(scheduledTimeUTC);

          // Skip past times (already passed)
          if (scheduledDate <= now) {
            skippedCount++;
            continue;
          }

          items.push({
            channel_id: currentChannel.id,
            scheduled_time: scheduledTimeUTC,
            // Only set prompt for first task (if provided), others will use AI/template
            prompt: (isFirstItem && newTaskPrompt) ? newTaskPrompt : '',
            platform: platformToUse,
            duration: currentChannel.duration,
            aspect_ratio: currentChannel.aspect_ratio,
          });
          isFirstItem = false;
        }
      }

      // Check if all items were skipped (all times are in the past)
      if (items.length === 0) {
        if (skippedCount > 0) {
          toast.error(t('dayDetail.allTimeSlotsInPast', { count: skippedCount }));
        } else {
          toast.error(t('dayDetail.noTimeSlotsSelected'));
        }
        return;
      }

      // Don't auto-generate - let user manually trigger
      await api.createScheduleQueueItems(items, { autoStart: false });

      const daysText = effectiveDates.length > 1 ? ` ${t('dayDetail.across')} ${effectiveDates.length} ${t('dayDetail.days')}` : '';
      const skippedText = skippedCount > 0 ? ` ${t('dayDetail.pastTimesSkipped', { count: skippedCount })}` : '';
      toast.success(`${items.length} ${t('dayDetail.addTask')}${daysText}${skippedText}`);
      setTimeSlots([getNextHourTimeSlot(effectiveTimezone)]);
      setNewTaskPrompt('');
      setSelectedPresetId('');
      // Refresh both context and local data
      await fetchQueue({ channel_id: currentChannel.id });
      // Small delay to ensure DB commit
      await new Promise(resolve => setTimeout(resolve, 300));
      await fetchDayItems();
      setShowAddForm(false);
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.failedToAddTasks'));
    } finally {
      setIsAdding(false);
    }
  };

  // Add task and start immediately (Post Now)
  const [isAddingNow, setIsAddingNow] = useState(false);
  const handleAddNow = async () => {
    if (!currentChannel) return;
    setIsAddingNow(true);
    try {
      // Schedule for 2 minutes from now
      const now = new Date();
      now.setMinutes(now.getMinutes() + 2);
      const scheduledTimeUTC = now.toISOString();

      const item = {
        channel_id: currentChannel.id,
        scheduled_time: scheduledTimeUTC,
        prompt: '',
        platform: currentChannel.ai_model?.startsWith('kie_') ? 'sora2-kie' : 'sora2-vidgo',
        duration: currentChannel.duration,
        aspect_ratio: currentChannel.aspect_ratio,
      };

      // Create and auto-start
      const created = await api.createScheduleQueueItems([item], { autoStart: true });
      toast.success(t('dayDetail.creatingAndStarting'));

      // Add to tracking for polling
      if (created && created[0]) {
        setPendingGenerationIds(prev => new Set(prev).add(created[0].id));
        pendingGenerationIdsRef.current.add(created[0].id);
      }

      // Refresh
      await fetchQueue({ channel_id: currentChannel.id });
      await fetchDayItems();
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.failedToAddTask'));
    } finally {
      setIsAddingNow(false);
    }
  };

  // Time slot management
  const addTimeSlot = () => {
    const lastTime = timeSlots[timeSlots.length - 1] || '12:00';
    const [h, m] = lastTime.split(':').map(Number);
    const newHour = ((h ?? 12) + 2) % 24;
    setTimeSlots([...timeSlots, `${newHour.toString().padStart(2, '0')}:${(m ?? 0).toString().padStart(2, '0')}`]);
  };

  const removeTimeSlot = (index: number) => {
    if (timeSlots.length <= 1) return;
    setTimeSlots(timeSlots.filter((_, i) => i !== index));
  };

  const updateTimeSlot = (index: number, value: string) => {
    const newSlots = [...timeSlots];
    newSlots[index] = value;
    setTimeSlots(newSlots);
  };

  // Preset management
  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = presets.find(p => p.id.toString() === presetId);
    if (preset) {
      console.log('[Preset] Selected preset:', preset.name, 'times:', preset.times);
      console.log('[Preset] effectiveDates:', effectiveDates);

      // Filter out past times using CHANNEL timezone
      const now = new Date();

      // Get current time in channel timezone
      const channelNow = new Date(now.toLocaleString('en-US', { timeZone: effectiveTimezone }));
      const currentHour = channelNow.getHours();
      const currentMinute = channelNow.getMinutes();

      // Get today's date in channel timezone
      const today = now.toLocaleDateString('en-CA', { timeZone: effectiveTimezone }); // en-CA gives YYYY-MM-DD
      const isToday = effectiveDates.some(d => d === today);

      console.log('[Preset] today:', today, 'isToday:', isToday, 'currentTime:', `${currentHour}:${currentMinute}`);

      if (isToday) {
        // Filter out times that are in the past (in channel timezone)
        const futureTimes = preset.times.filter(time => {
          const [h, m] = time.split(':').map(Number);
          return (h! > currentHour) || (h! === currentHour && m! > currentMinute);
        });

        console.log('[Preset] futureTimes:', futureTimes);

        if (futureTimes.length > 0) {
          setTimeSlots(futureTimes);
          if (futureTimes.length < preset.times.length) {
            const skipped = preset.times.length - futureTimes.length;
            toast.info(t('dayDetail.presetLoadedSkipped', { name: preset.name, skipped }));
          }
        } else {
          // All times are in past, use next hour
          setTimeSlots([getNextHourTimeSlot(effectiveTimezone)]);
          toast.warning(t('dayDetail.presetTimesExpired', { name: preset.name }));
        }
      } else {
        // Not today, use all preset times
        setTimeSlots([...preset.times]);
        toast.success(t('dayDetail.presetLoaded', { name: preset.name, count: preset.times.length }));
      }
    }
  };

  const handleSavePreset = async () => {
    if (!newPresetName.trim() || timeSlots.length === 0) return;
    setIsSavingPreset(true);
    try {
      const newPreset = await api.createTimePreset(newPresetName.trim(), timeSlots);
      setPresets([...presets, newPreset]);
      toast.success(t('dayDetail.presetSaved'));
      setShowSavePreset(false);
      setNewPresetName('');
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.failedToSavePreset'));
    } finally {
      setIsSavingPreset(false);
    }
  };

  const handleDeletePreset = async (presetId: number) => {
    if (!confirm(t('dayDetail.deletePresetConfirm'))) return;
    try {
      await api.deleteTimePreset(presetId);
      setPresets(presets.filter(p => p.id !== presetId));
      if (selectedPresetId === presetId.toString()) {
        setSelectedPresetId('');
      }
      toast.success(t('dayDetail.presetDeleted'));
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.failedToDeletePreset'));
    }
  };

  // Include 'queued' items too — they may be stuck from a previous run and need re-processing
  // Exclude items that already have a video_url (e.g. pulled from history) — they don't need generation
  const pendingSlots = activeSlots.filter(s =>
    (s.existingItem?.status === 'pending' || s.existingItem?.status === 'queued') && !s.existingItem?.video_url
  );

  // Calculate status counts for display
  const statusCounts = useMemo(() => {
    const counts = {
      pending: 0,
      queued: 0,
      processing: 0, // generating + captioning + scheduling
      done: 0,
      failed: 0,
    };
    activeSlots.forEach(s => {
      const status = s.existingItem?.status;
      if (status === 'pending') counts.pending++;
      else if (status === 'queued') counts.queued++;
      else if (['generating', 'captioning', 'scheduling'].includes(status || '')) counts.processing++;
      else if (status === 'done') counts.done++;
      else if (status === 'failed') counts.failed++;
    });
    return counts;
  }, [activeSlots]);

  // Check if any items are currently being processed
  const hasActiveItems = activeSlots.some(s =>
    ['generating', 'captioning', 'scheduling'].includes(s.existingItem?.status || '')
  );

  // Delete all items for this day
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const handleDeleteAll = async () => {
    if (activeSlots.length === 0) return;
    if (!confirm(t('dayDetail.deleteAllConfirm', { count: activeSlots.length }))) return;

    setIsDeletingAll(true);
    try {
      let deleted = 0;
      for (const slot of activeSlots) {
        if (slot.existingItem) {
          await deleteQueueItem(slot.existingItem.id);
          deleted++;
        }
      }
      toast.success(`${deleted} ${t('dayDetail.itemDeleted')}`);
      if (currentChannel) await fetchQueue({ channel_id: currentChannel.id });
      await fetchDayItems();
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.failedToDeleteItems'));
    } finally {
      setIsDeletingAll(false);
    }
  };

  // Post all ready items
  const [isPostingAll, setIsPostingAll] = useState(false);
  const readyToPostItems = useMemo(() => dayItems.filter(item => {
    if (!item.video_url) return false;
    const service = item.posting_service || currentChannel?.posting_service;
    if (!service || service === 'none') return false;
    if (item.blotato_post_ids?.length || item.late_post_ids?.length || item.postforme_post_ids?.length) return false;
    if (['generating', 'captioning', 'scheduling', 'queued'].includes(item.status)) return false;
    return true;
  }), [dayItems, currentChannel]);

  // Retry all failed items
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const failedItems = useMemo(() => dayItems.filter(item => item.status === 'failed'), [dayItems]);

  const handleRetryAllFailed = async () => {
    if (failedItems.length === 0) return;

    setIsRetryingAll(true);
    try {
      let retried = 0;
      const platform = currentChannel?.ai_model?.startsWith('kie_') ? 'sora2-kie' : 'sora2-vidgo';
      for (const item of failedItems) {
        // Update platform based on channel's AI model
        try {
          await api.updateScheduleQueueItem(item.id, { platform });
        } catch (e) {
          console.error('Failed to update platform:', e);
        }

        const success = await retryQueueItem(item.id);
        if (success) {
          setPendingGenerationIds(prev => new Set(prev).add(item.id));
          retried++;
        }
      }
      toast.success(t('dayDetail.retryingFailed', { count: retried }));
      await fetchDayItems(true);
      if (currentChannel) await fetchQueue({ channel_id: currentChannel.id });
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.failedToRetryItems'));
    } finally {
      setIsRetryingAll(false);
    }
  };

  // 24-hour time options
  const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
  const MINUTES = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));

  const statusConfig: Record<string, { label: string; color: string; bg: string; border: string }> = {
    pending: { label: 'PENDING', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
    queued: { label: 'QUEUED', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
    viral_pending: { label: 'VIRAL...', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
    viral_running: { label: 'VIRAL...', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
    idol_pending: { label: 'IDOL...', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
    idol_running: { label: 'IDOL...', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
    image_generating: { label: 'IMAGE...', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
    generating: { label: 'VIDEO...', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
    captioning: { label: 'CAPTION', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
    scheduling: { label: 'POST', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
    posting_retry: { label: 'รอลองใหม่', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
    done: { label: 'DONE', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' },
    failed: { label: 'FAILED', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
    stopped: { label: 'หยุดแล้ว', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
    postingFailed: { label: 'โพสต์ล้มเหลว', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(open) => { if (!open && !historySelectedVideo) onClose(); }}>
      <DialogContent
        className="p-0 gap-0 border-zinc-700"
        style={{ maxWidth: '900px', width: '95vw', maxHeight: '90vh' }}
        onPointerDownOutside={(e) => { if (historySelectedVideo) e.preventDefault(); }}
        onInteractOutside={(e) => { if (historySelectedVideo) e.preventDefault(); }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-700/50 space-y-3">
          {/* Row 1: Title & Info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <DialogHeader className="p-0 space-y-0">
                <DialogTitle className="text-lg">
                  {isMultiDay
                    ? `${effectiveDates.length} ${t('dayDetail.daysSelected')}`
                    : formatDate(dateStr)
                  }
                </DialogTitle>
              </DialogHeader>
              {isMultiDay && (
                <span className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                  {effectiveDates[0]} — {effectiveDates[effectiveDates.length - 1]}
                </span>
              )}
              {/* Status counts breakdown */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-zinc-500">{activeSlots.length}</span>
                <span className="text-zinc-600">|</span>
                {statusCounts.pending > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                    {statusCounts.pending} รอ
                  </span>
                )}
                {statusCounts.processing > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    {statusCounts.processing} กำลังทำ
                  </span>
                )}
                {statusCounts.done > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 flex items-center gap-1">
                    <Check className="h-2.5 w-2.5" />
                    {statusCounts.done} เสร็จ
                  </span>
                )}
                {statusCounts.failed > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1">
                    <AlertCircle className="h-2.5 w-2.5" />
                    {statusCounts.failed} ล้มเหลว
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <Clock className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-amber-400 font-mono font-medium">{currentTime}</span>
              <span className="text-zinc-500 text-xs">{currentDate}</span>
              <span className="text-zinc-600 text-xs">({effectiveTimezone})</span>
            </div>
          </div>

          {/* Row 2: Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {pendingSlots.length > 0 && (
              <>
                {/* Template selection dropdown */}
                {(() => {
                  const rawSource = currentChannel?.prompt_mode === 'ai'
                    ? ((currentChannel as any)?.ai_prompt_templates && (currentChannel as any).ai_prompt_templates.length > 0
                        ? (currentChannel as any).ai_prompt_templates
                        : undefined)
                    : currentChannel?.prompt_templates;
                  // Dedup by label to avoid duplicates from legacy data
                  const templatesSource = rawSource ? rawSource.filter((tmpl: any, idx: number, arr: any[]) => arr.findIndex((t: any) => t.label === tmpl.label) === idx) : undefined;
                  if (!templatesSource || templatesSource.length === 0) return null;
                  return (
                    <Select value={selectedTemplateMode} onValueChange={setSelectedTemplateMode}>
                      <SelectTrigger className="h-8 w-auto min-w-[180px] text-xs bg-gray-900/50 border-gray-700">
                        <SelectValue placeholder={currentChannel?.prompt_mode === 'ai' ? 'เลือก Prompt' : t('calendar.selectTemplate')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-round-robin">{t('calendar.useAllRoundRobin')}</SelectItem>
                        <SelectItem value="all-random">{t('calendar.useAllRandom')}</SelectItem>
                        {templatesSource.map((tmpl: any) => (
                          <SelectItem key={tmpl.id} value={`template-${tmpl.id}`}>
                            {tmpl.label || tmpl.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })()}
              </>
            )}
            {hasActiveItems ? (
              <Button
                size="sm"
                disabled
                className="bg-[#FFB300] text-black font-medium opacity-50"
              >
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                {t('dayDetail.processing')}
              </Button>
            ) : activeSlots.length > 0 ? (
              <Button
                size="sm"
                disabled={isStartingQueue || pendingSlots.length === 0}
                onClick={() => handleGenerate()}
                className="bg-[#FFB300] hover:bg-[#FFA000] text-black font-medium disabled:opacity-50"
              >
                {isStartingQueue ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                {t('dayDetail.generate')} ({pendingSlots.length})
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => { setTimeSlots([getNextHourTimeSlot(effectiveTimezone)]); setShowAddForm(true); }} className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10">
              <Plus className="h-4 w-4 mr-1" />
              {t('dayDetail.addTask')}
            </Button>
            {failedItems.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetryAllFailed}
                disabled={isRetryingAll}
                className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
              >
                {isRetryingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                {t('dayDetail.retry')} ({failedItems.length})
              </Button>
            )}
            {readyToPostItems.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handlePostAll}
                disabled={isPostingAll}
                className="text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
              >
                {isPostingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Send className="h-4 w-4 mr-1" />
                )}
                {t('dayDetail.postAll')} ({readyToPostItems.length})
              </Button>
            )}
            {activeSlots.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleDeleteAll}
                disabled={isDeletingAll}
                className="text-red-400 border-red-500/30 hover:bg-red-500/10"
              >
                {isDeletingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                {t('dayDetail.deleteAll')}
              </Button>
            )}
          </div>
        </div>

        {/* Items List */}
        <ScrollArea className="py-2" style={{ maxHeight: 'calc(90vh - 90px)' }}>
          <div className="px-6 space-y-4 pb-4">
            {/* Add Task Form */}
            {showAddForm && (
              <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-indigo-400 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {t('dayDetail.addNewTasks')}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => { setShowAddForm(false); setNewTaskPrompt(''); setTimeSlots([getNextHourTimeSlot(effectiveTimezone)]); setSelectedPresetId(''); }} className="h-7 w-7 p-0 text-zinc-500 hover:text-zinc-300">
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* Time slots loaded from channel settings */}

                {/* Time Slots */}
                <div className="space-y-2">
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">{t('dayDetail.timeSlots')}</div>
                  <div className="flex flex-wrap gap-2">
                    {timeSlots.map((time, index) => {
                      const [hour, minute] = time.split(':');
                      return (
                      <div key={index} className="flex items-center gap-1 bg-zinc-800 rounded-lg border border-zinc-700 px-2 py-1.5">
                        <select
                          value={hour}
                          onChange={(e) => updateTimeSlot(index, `${e.target.value}:${minute}`)}
                          className="font-mono text-sm bg-transparent border-none text-amber-400 outline-none cursor-pointer appearance-none"
                        >
                          {HOURS.map(h => <option key={h} value={h} className="bg-zinc-800">{h}</option>)}
                        </select>
                        <span className="text-zinc-500">:</span>
                        <select
                          value={minute}
                          onChange={(e) => updateTimeSlot(index, `${hour}:${e.target.value}`)}
                          className="font-mono text-sm bg-transparent border-none text-amber-400 outline-none cursor-pointer appearance-none"
                        >
                          {MINUTES.map(m => <option key={m} value={m} className="bg-zinc-800">{m}</option>)}
                        </select>
                        {timeSlots.length > 1 && (
                          <button
                            onClick={() => removeTimeSlot(index)}
                            className="w-5 h-5 rounded-full hover:bg-red-500/20 text-zinc-500 hover:text-red-400 flex items-center justify-center transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );})}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={addTimeSlot}
                      className="h-9 px-3 border border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {t('dayDetail.addTime')}
                    </Button>
                  </div>
                </div>

                {/* Save as Preset */}
                {!showSavePreset ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowSavePreset(true)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    <Save className="h-3 w-3 mr-1" />
                    {t('dayDetail.saveAsPreset')}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 bg-zinc-800/50 rounded-lg p-2">
                    <Input
                      value={newPresetName}
                      onChange={(e) => setNewPresetName(e.target.value)}
                      placeholder={t('dayDetail.presetNamePlaceholder')}
                      className="h-8 bg-zinc-700 border-zinc-600 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={handleSavePreset}
                      disabled={isSavingPreset || !newPresetName.trim()}
                      className="h-8 bg-indigo-500 hover:bg-indigo-600 text-white"
                    >
                      {isSavingPreset ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setShowSavePreset(false); setNewPresetName(''); }}
                      className="h-8 text-zinc-500"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {/* Actions - styled like ChannelList */}
                <div className="flex items-center justify-between pt-2 border-t border-zinc-700/50">
                  <span className="text-sm text-zinc-500">
                    {timeSlots.length * effectiveDates.length} {t('dayDetail.willBeAdded')}
                    {isMultiDay && (
                      <span className="text-blue-400 ml-1">
                        ({timeSlots.length} × {effectiveDates.length} {t('dayDetail.days')})
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {/* +/- Counter */}
                    <div className="flex items-center border border-zinc-700 rounded-md overflow-hidden">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 rounded-none hover:bg-zinc-800"
                        onClick={() => {
                          if (timeSlots.length > 1) removeTimeSlot(timeSlots.length - 1);
                        }}
                        disabled={timeSlots.length <= 1}
                      >
                        -
                      </Button>
                      <span className="w-8 text-center text-sm">{timeSlots.length}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 rounded-none hover:bg-zinc-800"
                        onClick={addTimeSlot}
                      >
                        +
                      </Button>
                    </div>
                    <Button
                      onClick={handleAddTasks}
                      disabled={isAdding || timeSlots.length === 0}
                      className="h-9 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white gap-2"
                    >
                      {isAdding ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      {t('dayDetail.add')} {timeSlots.length}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {loadingItems ? (
              <div className="text-center py-12 text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t('common.loading')}
              </div>
            ) : activeSlots.length === 0 && !showAddForm ? (
              <div className="text-center py-12 text-muted-foreground">{t('dayDetail.noScheduledItems')}</div>
            ) : (() => {
              // Group slots by date for multi-day view
              const slotsByDate = new Map<string, typeof activeSlots>();
              activeSlots.forEach(slot => {
                const itemDate = slot.existingItem?._date || dateStr;
                if (!slotsByDate.has(itemDate)) {
                  slotsByDate.set(itemDate, []);
                }
                slotsByDate.get(itemDate)!.push(slot);
              });

              // Sort dates
              const sortedDates = Array.from(slotsByDate.keys()).sort();

              return sortedDates.map((groupDate, groupIndex) => {
                const groupSlots = slotsByDate.get(groupDate) || [];
                const groupPendingCount = groupSlots.filter(s => s.existingItem?.status === 'pending').length;

                return (
                  <div key={groupDate} className={cn(groupIndex > 0 && "mt-6")}>
                    {/* Date Header - only show in multi-day mode */}
                    {isMultiDay && (
                      <div className="flex items-center gap-3 mb-3">
                        <div className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2">
                          <Clock className="h-4 w-4 text-blue-400" />
                          <span className="font-medium text-zinc-200">
                            {new Date(groupDate).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                          <span className="text-zinc-500 text-sm">
                            ({groupSlots.length} {t('channel.items')})
                          </span>
                        </div>
                        {groupPendingCount > 0 && (
                          <Badge variant="outline" className="text-xs text-amber-400 bg-amber-500/10 border-amber-500/30">
                            {groupPendingCount} {t('dayDetail.pending')}
                          </Badge>
                        )}
                        <div className="flex-1 border-t border-zinc-700/40" />
                      </div>
                    )}

                    {/* Items for this date */}
                    <div className="space-y-4">
                      {groupSlots.map((slot) => {
              const item = slot.existingItem;
              if (!item) return null;

              const status = item.status;
              const isExpanded = expandedItems.has(item.id);
              const logs = itemLogs[item.id];
              const isLoadingLog = loadingLogs.has(item.id);
              const logsVisible = showLogs.has(item.id);

              // Check logs to determine actual display status (like ChannelList)
              const itemLogsArr = logs || [];
              const lastLog = itemLogsArr[itemLogsArr.length - 1];
              const lastLogMsg: string = (lastLog?.message || '');
              const isStopped = lastLogMsg.includes('Stopped');
              const isRetrying = !isStopped && (lastLogMsg.includes('Retry') || lastLogMsg.includes('Still generating') || lastLogMsg.includes('Sending prompt') || lastLogMsg.includes('Task created') || lastLogMsg.includes('Resuming'));
              const _errLower = (item.error || '').toLowerCase();
              const isCreditError = _errLower.includes('credit') && /insufficient|not enough|exhausted|no credit|balance|หมด/.test(_errLower);
              const displayStatus = isStopped ? 'stopped' : (status === 'pending' && isRetrying) ? 'generating' : status;
              const isActive = !isStopped && (['generating', 'captioning', 'scheduling', 'queued'].includes(status) || (status === 'pending' && isRetrying));
              // Custom status config for credit error
              const sc = isCreditError
                ? { label: 'เครดิตหมด', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' }
                : (statusConfig[displayStatus] || { label: 'PENDING', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' });

              return (
                <div key={slot.id} className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 overflow-hidden">
                  {/* === Header Bar === */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800/40">
                    {/* Time - Editable */}
                    {editingTimeId === item.id ? (
                      (() => {
                        const [editHour, editMinute] = editTimeValue.split(':');
                        return (
                      <div className="flex items-center gap-1 shrink-0 bg-zinc-700 rounded px-2 py-1">
                        <select
                          value={editHour}
                          onChange={(e) => setEditTimeValue(`${e.target.value}:${editMinute}`)}
                          className="font-mono text-sm bg-transparent border-none text-amber-400 outline-none cursor-pointer appearance-none"
                          autoFocus
                        >
                          {HOURS.map(h => <option key={h} value={h} className="bg-zinc-800">{h}</option>)}
                        </select>
                        <span className="text-zinc-500">:</span>
                        <select
                          value={editMinute}
                          onChange={(e) => setEditTimeValue(`${editHour}:${e.target.value}`)}
                          className="font-mono text-sm bg-transparent border-none text-amber-400 outline-none cursor-pointer appearance-none"
                        >
                          {MINUTES.map(m => <option key={m} value={m} className="bg-zinc-800">{m}</option>)}
                        </select>
                        <Button size="sm" variant="ghost" onClick={() => handleSaveTime(item.id)} className="h-7 w-7 p-0 text-green-400 hover:text-green-300 hover:bg-green-500/10">
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={handleCancelEdit} className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-500/10">
                          <AlertCircle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                        );
                      })()
                    ) : (
                      <div
                        className="font-mono font-bold text-amber-400 text-base shrink-0 flex items-center gap-1"
                      >
                        {slot.time}
                        {(() => {
                          const tz = currentChannel?.timezone && currentChannel.timezone !== 'local' ? currentChannel.timezone : null;
                          const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                          if (!tz || tz === browserTz) return null;
                          if (slot.scheduledTime) {
                            const localTime = new Date(slot.scheduledTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: browserTz });
                            return <span className="text-[10px] text-zinc-500 font-normal ml-1">({localTime} {browserTz})</span>;
                          }
                          return null;
                        })()}
                      </div>
                    )}

                    {/* Status */}
                    {(() => {
                      const hasPosted = status === 'done' && (
                        (item.blotato_post_ids?.length > 0) ||
                        (item.late_post_ids?.length > 0) ||
                        (item.postforme_post_ids?.length > 0)
                      );
                      const doneNotPosted = status === 'done' && !hasPosted && item.video_url;
                      // วิดีโอสร้างสำเร็จ (มี video_url) แต่ status เป็น failed = โพสต์ล้มเหลว
                      const isPostingFailed = displayStatus === 'failed' && item.video_url;
                      const postingFailedConfig = statusConfig['postingFailed'];

                      let badgeColor = sc.color;
                      let badgeBg = sc.bg;
                      let badgeBorder = sc.border;
                      let badgeLabel = sc.label;

                      if (doneNotPosted) {
                        badgeColor = 'text-blue-400';
                        badgeBg = 'bg-blue-500/10';
                        badgeBorder = 'border-blue-500/30';
                        badgeLabel = t('dayDetail.createdNotPosted');
                      } else if (isPostingFailed) {
                        badgeColor = postingFailedConfig.color;
                        badgeBg = postingFailedConfig.bg;
                        badgeBorder = postingFailedConfig.border;
                        badgeLabel = postingFailedConfig.label;
                      }

                      return (
                        <Badge variant="outline" className={cn("text-xs shrink-0 px-2.5 py-0.5", badgeColor, badgeBg, badgeBorder)}>
                          {isActive && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                          {status === 'done' && hasPosted && <Check className="h-3 w-3 mr-1" />}
                          {doneNotPosted && <Video className="h-3 w-3 mr-1" />}
                          {isPostingFailed && <AlertCircle className="h-3 w-3 mr-1" />}
                          {badgeLabel}
                        </Badge>
                      );
                    })()}

                    {/* Server/Platform Badge - hidden for cleaner UI */}

                    {/* Progress Pipeline */}
                    <div className="flex items-center gap-1 text-[10px] shrink-0">
                      {/* Image step (Viral Template เท่านั้น) */}
                      {item.external_task_id?.startsWith('viral-') && (
                        <>
                          <ImageIcon className={cn("h-3 w-3",
                            ['viral_pending', 'viral_running', 'image_generating'].includes(status) ? "text-amber-400" :
                            ['generating', 'captioning', 'scheduling', 'done'].includes(status) ? "text-green-500" :
                            "text-zinc-700"
                          )} />
                          <span className="text-zinc-700">→</span>
                        </>
                      )}
                      {/* Image step (Idol Template) */}
                      {item.external_task_id?.startsWith('idol-') && (
                        <>
                          <ImageIcon className={cn("h-3 w-3",
                            ['idol_pending', 'idol_running', 'image_generating'].includes(status) ? "text-amber-400" :
                            ['generating', 'captioning', 'scheduling', 'done'].includes(status) ? "text-green-500" :
                            "text-zinc-700"
                          )} />
                          <span className="text-zinc-700">→</span>
                        </>
                      )}
                      {/* Video (generating) step */}
                      <Video className={cn("h-3 w-3",
                        status === 'generating' ? "text-amber-400" :
                        ['captioning', 'scheduling', 'done'].includes(status) ? "text-green-500" :
                        "text-zinc-700"
                      )} />
                      <span className="text-zinc-700">→</span>
                      {/* Bot (captioning) step */}
                      <Bot className={cn("h-3 w-3",
                        status === 'captioning' ? "text-amber-400" :
                        ['scheduling', 'done'].includes(status) ? "text-green-500" :
                        "text-zinc-700"
                      )} />
                      <span className="text-zinc-700">→</span>
                      {/* Send (Blotato) step - with special coloring */}
                      <Send className={cn("h-3 w-3",
                        status === 'scheduling' ? "text-amber-400" :
                        status === 'done' && hasBlotato(item) ? (
                          isBlotatoSuccess(item) ? "text-green-500" : "text-red-500"
                        ) :
                        status === 'done' ? "text-zinc-500" :
                        "text-zinc-700"
                      )} />
                      <span className="text-zinc-700">→</span>
                      {status === 'done' ? <Check className="h-3 w-3 text-green-500" /> :
                       status === 'failed' ? <AlertCircle className="h-3 w-3 text-red-500" /> :
                       <Clock className="h-3 w-3 text-zinc-700" />}
                    </div>

                    {/* Social Media Target Icons */}
                    {(() => {
                      const service = item.posting_service || currentChannel?.posting_service || 'none';

                      // ---- Postforme per-provider branch (Option B) ----
                      // When the backend status-poller has populated postforme_post_results,
                      // show the real per-provider state: clickable URL on success, red+tooltip on
                      // failure, spinner on pending. Falls through to the legacy branch if the
                      // results haven't arrived yet (postforme_post_results = null/empty).
                      const innerResults: PostForMeProviderResult[] | undefined =
                        service === 'postforme' ? item.postforme_post_results : undefined;

                      if (service === 'postforme' && innerResults && innerResults.length > 0) {
                        const byPlatform = new Map<string, PostForMeProviderResult>();
                        for (const r of innerResults) byPlatform.set((r.platform || '').toLowerCase(), r);

                        const renderProvider = (
                          keys: string[],
                          successColor: string,
                          renderIcon: (className: string) => React.ReactNode
                        ): React.ReactNode => {
                          let p: PostForMeProviderResult | undefined;
                          for (const k of keys) { p = byPlatform.get(k); if (p) break; }
                          if (!p) return null;

                          const colorClass =
                            p.status === 'success' ? successColor :
                            p.status === 'failed' ? 'text-red-500' :
                            'text-amber-400';

                          const tooltip =
                            p.status === 'failed' ? `${p.platform}: ${p.error || 'Failed to post'}` :
                            p.status === 'pending' ? `${p.platform}: still pending — checking status...` :
                            `${p.platform}: posted successfully`;

                          const inner = p.status === 'pending'
                            ? <Loader2 className={cn('h-3.5 w-3.5 animate-spin', colorClass)} />
                            : renderIcon(cn('h-3.5 w-3.5', colorClass));

                          if (p.status === 'success' && p.platform_url) {
                            return (
                              <a
                                key={keys[0]}
                                href={p.platform_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title={tooltip}
                                className="inline-flex items-center hover:opacity-80 transition-opacity"
                              >
                                {inner}
                              </a>
                            );
                          }
                          return (
                            <span key={keys[0]} title={tooltip} className="inline-flex items-center">
                              {inner}
                            </span>
                          );
                        };

                        return (
                          <div className="flex items-center gap-1 shrink-0 ml-1">
                            {renderProvider(['facebook'], 'text-blue-500', (c) => <Facebook className={c} />)}
                            {renderProvider(['instagram'], 'text-pink-500', (c) => <Instagram className={c} />)}
                            {renderProvider(['tiktok'], 'text-cyan-400', (c) => (
                              <svg className={c} viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-.88-.07A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
                              </svg>
                            ))}
                            {renderProvider(['twitter', 'x'], 'text-white', (c) => (
                              <svg className={c} viewBox="0 0 24 24" fill="currentColor">
                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                              </svg>
                            ))}
                            {renderProvider(['youtube'], 'text-red-500', (c) => <Youtube className={c} />)}
                          </div>
                        );
                      }

                      // ---- Legacy branch: blotato / late / postforme-without-inner-data ----
                      // Get post results from the correct source
                      const postResults: any[] =
                        service === 'late' ? (item.late_post_ids || []) :
                        service === 'postforme' ? (item.postforme_post_ids || []) :
                        (item.blotato_post_ids || []);
                      // Determine which platforms to show icons for
                      const platforms: string[] =
                        service === 'late' ? (currentChannel?.late_accounts || []).filter((a: any) => a.accountId).map((a: any) => a.platform) :
                        service === 'postforme' ? (currentChannel?.postforme_accounts || []).map((a: any) => typeof a === 'string' ? '' : a).filter(Boolean) :
                        service === 'blotato' ? Object.entries(currentChannel?.page_ids || {}).filter(([_, v]) => !!v).map(([k]) => k) :
                        [];
                      // For done items, also include platforms from actual results
                      if (status === 'done' && postResults.length > 0) {
                        for (const r of postResults) {
                          if (r.platform && !platforms.includes(r.platform)) platforms.push(r.platform);
                        }
                      }
                      const getStatus = (platform: string) => postResults.find((p: any) => p.platform === platform)?.status;
                      const iconColor = (platform: string, successColor: string) => {
                        const s = getStatus(platform);
                        return status === 'done' && s === 'success' ? successColor :
                               status === 'done' && s === 'failed' ? "text-red-500" :
                               "text-zinc-500";
                      };
                      if (platforms.length === 0) return null;
                      return (
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {platforms.includes('facebook') && (
                            <span title="Facebook" className="inline-flex items-center">
                              <Facebook className={cn("h-3.5 w-3.5", iconColor('facebook', 'text-blue-500'))} />
                            </span>
                          )}
                          {platforms.includes('instagram') && (
                            <span title="Instagram" className="inline-flex items-center">
                              <Instagram className={cn("h-3.5 w-3.5", iconColor('instagram', 'text-pink-500'))} />
                            </span>
                          )}
                          {platforms.includes('tiktok') && (
                            <span title="TikTok" className="inline-flex items-center">
                              <svg className={cn("h-3.5 w-3.5", iconColor('tiktok', 'text-cyan-400'))} viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-.88-.07A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
                              </svg>
                            </span>
                          )}
                          {platforms.includes('twitter') && (
                            <span title="X (Twitter)" className="inline-flex items-center">
                              <svg className={cn("h-3.5 w-3.5", iconColor('twitter', 'text-white'))} viewBox="0 0 24 24" fill="currentColor">
                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                              </svg>
                            </span>
                          )}
                          {platforms.includes('youtube') && (
                            <span title="YouTube" className="inline-flex items-center">
                              <Youtube className={cn("h-3.5 w-3.5", iconColor('youtube', 'text-red-500'))} />
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Status Text from Logs */}
                    <div className="flex-1 text-xs px-2 truncate">
                      {(() => {
                        const itemLogsArr = itemLogs[item.id] || [];
                        const lastLog = itemLogsArr[itemLogsArr.length - 1];
                        const lastMsg: string = (lastLog?.message || '');
                        const lastLogAge = lastLog ? (Date.now() - new Date(lastLog.created_at).getTime()) / 1000 : 0;
                        const isStale = lastLogAge > 120 && (status === 'generating' || status === 'pending');
                        if (isStale && !lastMsg.includes('Stopped')) return <span className="text-amber-400">รอนานกว่าปกติ ระบบกำลังลองใหม่อัตโนมัติ...</span>;
                        if (lastMsg.includes('Stopped')) return <span className="text-red-400">หยุดแล้ว</span>;
                        if (status === 'generating' || status === 'pending') {
                          if (lastMsg.includes('Retry')) {
                            const m = lastMsg.match(/Retry #(\d+) in (\d+)s/);
                            return <span className="text-amber-400">ลองใหม่ครั้งที่ {m?.[1] || '?'}... ({m?.[2] || '?'}s)</span>;
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
                        if (status === 'scheduling') return <span className="text-amber-400">กำลังโพสต์ลง Social Media...</span>;
                        if (status === 'queued') return <span className="text-zinc-500">อยู่ในคิว รอสร้างวิดีโอ...</span>;
                        if (status === 'done' && item.video_url && !item.blotato_post_ids?.length && !item.late_post_ids?.length && !item.postforme_post_ids?.length) {
                          return <span className="text-blue-400">สร้างวิดีโอเสร็จแล้ว (ยังไม่โพสต์)</span>;
                        }
                        if (displayStatus === 'done') return <span className="text-green-400">โพสต์เรียบร้อยแล้ว</span>;
                        if (displayStatus === 'failed' && item.video_url) return <span className="text-red-400">โพสต์ล้มเหลว</span>;
                        if (displayStatus === 'failed' && isCreditError) return <span className="text-red-400">เครดิตหมด</span>;
                        if (displayStatus === 'failed') return <span className="text-red-400">ล้มเหลว</span>;
                        if (displayStatus === 'stopped') return <span className="text-red-400">หยุดแล้ว</span>;
                        return null;
                      })()}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {status === 'pending' && !item.video_url && (() => {
                        const modelDisplay = getAiModelDisplay(currentChannel?.ai_model);
                        return (
                        <div className="flex items-center gap-1">
                          <span className={`h-7 px-2 text-xs rounded-md border bg-zinc-800 flex items-center ${modelDisplay.color} ${modelDisplay.borderColor}`}>
                            {modelDisplay.label}
                          </span>
                          <Button
                            size="sm"
                            onClick={() => handleGenerateSingle(item.id)}
                            className="h-7 px-3 bg-[#FFB300] hover:bg-[#FFA000] text-black text-xs font-medium gap-1.5 rounded-md"
                          >
                            <Play className="h-3 w-3" />
                            {t('dayDetail.generate')}
                          </Button>
                        </div>
                        );
                      })()}
                      {/* Stop button for generating/retrying items - only show when active (not stopped) */}
                      {isActive && (
                        <div className="flex items-center gap-1.5">
                          {item.retry_count > 0 && (
                            <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                              retry #{item.retry_count}
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStopRetry(item.id)}
                            disabled={stoppingRetryId === item.id}
                            className="h-7 px-3 text-red-400 border-red-500/30 hover:bg-red-500/10 text-xs gap-1.5 rounded-md"
                          >
                            {stoppingRetryId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Square className="h-3 w-3" />
                            )}
                            {t('dayDetail.stop')}
                          </Button>
                        </div>
                      )}
                      {/* View Postforme post status — popup with Post ID, status, Post At, per-provider results */}
                      {item.posting_service === 'postforme' && !!item.postforme_post_ids?.length && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-3 text-purple-400 border-purple-500/30 hover:bg-purple-500/10 text-xs gap-1.5 rounded-md"
                          onClick={(e) => { e.stopPropagation(); setStatusDialogItemId(item.id); }}
                        >
                          <Activity className="h-3 w-3" /> สถานะโพสต์
                        </Button>
                      )}
                      {item.video_url && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-3 text-blue-400 border-blue-500/30 hover:bg-blue-500/10 text-xs gap-1.5 rounded-md"
                          onClick={async () => {
                            try {
                              await api.downloadViaProxy(item.video_url!, `video_${item.id}.mp4`);
                            } catch (err: any) {
                              toast.error(err?.message || 'Download failed');
                            }
                          }}
                        >
                          <Download className="h-3 w-3" /> {t('dayDetail.download')}
                        </Button>
                      )}
                      {/* Post button for items with video that haven't been posted yet */}
                      {item.video_url && (item.posting_service || currentChannel?.posting_service) && (item.posting_service || currentChannel?.posting_service) !== 'none' &&
                        !item.blotato_post_ids?.length && !item.late_post_ids?.length && !item.postforme_post_ids?.length && (
                        <Button
                          size="sm"
                          onClick={() => handlePostSingle(item.id)}
                          className="h-7 px-3 bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5 rounded-md"
                        >
                          <Send className="h-3 w-3" /> {t('dayDetail.postNow')}
                        </Button>
                      )}
                      {/* Retry Failed button for done items with partial posting failure */}
                      {status === 'done' && (
                        (item.blotato_post_ids && item.blotato_post_ids.some((p: any) => p.status === 'failed')) ||
                        (item.late_post_ids && item.late_post_ids.some((p: any) => p.status === 'failed')) ||
                        (item.postforme_post_ids && item.postforme_post_ids.some((p: any) => p.status === 'failed'))
                      ) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRetry(item.id)}
                          className="h-7 px-3 text-amber-400 border-amber-500/30 hover:bg-amber-500/10 text-xs gap-1.5 rounded-md"
                        >
                          <RefreshCw className="h-3 w-3" /> {t('dayDetail.retryFailed')}
                        </Button>
                      )}
                      {/* Failed/Stopped items - show Generate button to restart */}
                      {!isActive && (displayStatus === 'failed' || displayStatus === 'stopped') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRetry(item.id)}
                          className="h-7 px-3 text-[#FFB300] border-[#FFB300]/30 hover:bg-[#FFB300]/10 text-xs gap-1.5 rounded-md"
                        >
                          <RefreshCw className="h-3 w-3" /> {t('dayDetail.retry')}
                        </Button>
                      )}
                      {status === 'pending' && currentChannel && (
                        <Button
                          size="sm"
                          onClick={() => openHistoryPopup(item.id)}
                          className="h-7 px-3 bg-[#FFB300] hover:bg-[#FFA000] text-black text-xs font-medium gap-1.5 rounded-md"
                        >
                          <History className="h-3 w-3" /> {t('dayDetail.history')}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(item.id)} disabled={['generating', 'captioning', 'scheduling', 'queued'].includes(item.status)} className="h-7 w-7 p-0 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-md disabled:opacity-30 disabled:pointer-events-none">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* === Prompt (always visible) === */}
                  <div className="px-4 py-3 border-t border-zinc-700/30">
                    {editingPromptId === item.id ? (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-zinc-500 flex items-center gap-2">
                          <Pencil className="h-3 w-3" /> {t('dayDetail.editPrompt')}
                        </div>
                        <textarea
                          value={editPromptValue}
                          onChange={(e) => setEditPromptValue(e.target.value)}
                          rows={4}
                          className="w-full text-sm bg-zinc-700 border border-zinc-600 rounded px-3 py-2 text-zinc-300 resize-none"
                          autoFocus
                        />
                        <div className="flex items-center gap-2 justify-end">
                          <Button size="sm" variant="ghost" onClick={handleCancelPromptEdit} className="text-zinc-400 h-7">
                            {t('common.cancel')}
                          </Button>
                          <Button size="sm" onClick={() => handleSavePrompt(item.id)} disabled={isSavingPrompt} className="bg-green-500 hover:bg-green-600 text-white h-7">
                            {isSavingPrompt ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                            {t('common.save')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <div
                          className="flex-1 text-sm text-zinc-300 cursor-pointer"
                          onClick={() => toggleExpand(item.id)}
                        >
                          {item.prompt ? (
                            isExpanded ? (
                              <div className="whitespace-pre-wrap break-words">{item.prompt}</div>
                            ) : (
                              <div className="line-clamp-2">{item.prompt}</div>
                            )
                          ) : (
                            <div className="text-zinc-500 italic">{t('dayDetail.noPrompt')}</div>
                          )}
                          {item.prompt && (
                            <span className="text-[10px] text-zinc-600 mt-1 block">
                              {isExpanded ? t('dayDetail.clickToCollapse') : t('dayDetail.clickToExpand')}
                            </span>
                          )}
                        </div>
                        {status === 'pending' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEditPrompt(item.id, item.prompt || '')}
                            className="h-7 px-2 text-zinc-500 hover:text-zinc-300 shrink-0"
                            title={t('dayDetail.editPromptTitle')}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* === Generated Caption === */}
                  {item.caption && (
                    <div className="px-4 pb-3">
                      <div className="text-xs font-medium text-zinc-500 mb-1">{t('dayDetail.generatedCaption')}</div>
                      <div className="text-sm text-zinc-300 bg-zinc-800/50 border border-zinc-700/40 rounded-md p-3 whitespace-pre-wrap break-words">
                        {item.caption}
                      </div>
                    </div>
                  )}

                  {/* === Media Result (image or video based on URL extension) === */}
                  {item.video_url && (() => {
                    // Detect by URL extension — video_url field can hold either video or image URL
                    // (image URLs end up here when user pulls from Image Template history into a slot).
                    const isImageMedia = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(item.video_url);
                    return (
                      <div className="px-4 pb-3">
                        <div className="rounded-lg overflow-hidden border border-zinc-700/50 bg-black relative group">
                          {isImageMedia ? (
                            <img
                              src={item.video_url}
                              alt="Generated image"
                              className="w-full max-h-[280px] object-contain"
                            />
                          ) : (
                            <video
                              src={item.video_url}
                              controls
                              className="w-full max-h-[280px] object-contain"
                              preload="auto"
                            />
                          )}
                          {/* Expand button */}
                          <button
                            onClick={() => setExpandedVideoUrl(item.video_url)}
                            className="absolute top-2 right-2 p-1.5 rounded-md bg-black/70 hover:bg-black/90 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            title={t('dayDetail.expandVideo')}
                          >
                            <Maximize2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Video expiry countdown — hidden, shown only in History page */}

                  {status === 'done' && !item.video_url && (
                    <div className="px-4 pb-3">
                      <div className="p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 shrink-0" /> {t('dayDetail.videoNotAvailable')}
                      </div>
                    </div>
                  )}

                  {/* === Error (if failed) === */}
                  {(status === 'failed' || item.error) && (() => {
                    const errorMsg = item.error || '';
                    const isPostformeAccountError = errorMsg.includes('postforme') && errorMsg.includes('invalid social accounts');
                    const isBlotatoError = errorMsg.includes('blotato');
                    const isLateError = errorMsg.includes('late') && (errorMsg.includes('API') || errorMsg.includes('error'));
                    const _eLower = errorMsg.toLowerCase();
                    const isKieCreditError = _eLower.includes('credit') && /insufficient|not enough|exhausted|no credit|balance|หมด/.test(_eLower);
                    const isPostingError = isPostformeAccountError || isBlotatoError || isLateError;

                    // Determine error title
                    const isStoppedByUser = errorMsg.includes('Stopped by user');
                    let errorTitle = t('dayDetail.generationFailed');
                    if (isStoppedByUser) errorTitle = '🛑 หยุดโดยผู้ใช้';
                    else if (isPostingError) errorTitle = 'การโพสต์ล้มเหลว';
                    else if (isKieCreditError) errorTitle = '💳 KIE Credit หมด';

                    return (
                    <div className="px-4 pb-3">
                      <div className="p-3 rounded-md bg-red-500/10 border-red-500/20 border">
                        <div className="text-red-400 text-sm font-medium flex items-center gap-2 mb-1">
                          <AlertCircle className="h-4 w-4" /> {errorTitle}
                        </div>
                        {isKieCreditError ? (
                          <div className="mt-2 space-y-2">
                            <p className="text-red-300 text-xs">กรุณาเติม Credit ที่ KIE แล้วกด "สร้าง" ใหม่</p>
                            <a
                              href="https://kie.ai/billing"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-md transition-colors"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              เติม Credit ที่ kie.ai
                            </a>
                          </div>
                        ) : isPostformeAccountError ? (
                          <div className="mt-2 space-y-2">
                            <p className="text-red-300 text-xs">บัญชี Social Media ที่เชื่อมต่อไว้มีปัญหา กรุณาตรวจสอบการเชื่อมต่อที่ Post for Me</p>
                            <button
                              onClick={() => { onClose(); window.location.href = '/settings#postforme'; }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-md transition-colors"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                              ไปตั้งค่า Post for Me
                            </button>
                          </div>
                        ) : isBlotatoError ? (
                          <div className="mt-2 space-y-2">
                            <p className="text-red-300 text-xs">เกิดข้อผิดพลาดกับ Blotato กรุณาตรวจสอบการเชื่อมต่อ</p>
                            <a
                              href="https://blotato.com/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-md transition-colors"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              ไปตั้งค่า Blotato
                            </a>
                          </div>
                        ) : isLateError ? (
                          <div className="mt-2 space-y-2">
                            <p className="text-red-300 text-xs">เกิดข้อผิดพลาดกับ Late กรุณาตรวจสอบ API Key</p>
                            <button
                              onClick={() => { onClose(); window.location.href = '/settings#late'; }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-md transition-colors"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                              ไปตั้งค่า Late
                            </button>
                          </div>
                        ) : item.error ? (
                          <div className="text-red-300 text-xs mt-1">{item.error}</div>
                        ) : null}
                      </div>
                    </div>
                    );
                  })()}

                  {/* === Activity Logs Toggle === */}
                  <div className="border-t border-zinc-700/30">
                    <button
                      onClick={() => toggleLogs(item.id)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors"
                    >
                      {logsVisible ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <Activity className="h-3 w-3" />
                      <span>{t('dayDetail.activityLogs')} #{item.id}</span>
                      {isLoadingLog && <Loader2 className="h-3 w-3 animate-spin" />}
                      {/* Current Step Badge */}
                      {['generating', 'captioning', 'scheduling', 'viral_pending', 'viral_running', 'idol_pending', 'idol_running', 'image_generating'].includes(item.status) && (
                        <Badge variant="outline" className="ml-auto text-[10px] text-amber-400 border-amber-500/30 animate-pulse">
                          {(item.status === 'generating' || item.status === 'viral_pending' || item.status === 'viral_running' || item.status === 'idol_pending' || item.status === 'idol_running' || item.status === 'image_generating') && '🎬 กำลังสร้างวิดีโอ...'}
                          {item.status === 'captioning' && '✍️ กำลังสร้าง Caption...'}
                          {item.status === 'scheduling' && '📤 กำลังโพสต์...'}
                        </Badge>
                      )}
                    </button>

                    {logsVisible && (
                      <div className="px-4 pb-3 space-y-2">
                        {/* Progress Steps */}
                        <div className="flex items-center gap-1 text-xs flex-wrap">
                          <div className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded",
                            ['generating', 'viral_pending', 'viral_running', 'idol_pending', 'idol_running', 'image_generating'].includes(item.status) ? "bg-amber-500/20 text-amber-400" :
                            item.status === 'failed' ? "bg-red-500/20 text-red-400" :
                            ['captioning', 'scheduling', 'done'].includes(item.status) ? "bg-green-500/20 text-green-400" :
                            "bg-zinc-700/30 text-zinc-500"
                          )}>
                            <Video className="h-3 w-3" />
                            <span>Video</span>
                          </div>
                          <span className="text-zinc-600">→</span>
                          <div className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded",
                            item.status === 'captioning' ? "bg-amber-500/20 text-amber-400" :
                            ['scheduling', 'done'].includes(item.status) ? "bg-green-500/20 text-green-400" :
                            "bg-zinc-700/30 text-zinc-500"
                          )}>
                            <Bot className="h-3 w-3" />
                            <span>Caption</span>
                          </div>
                          <span className="text-zinc-600">→</span>
                          <div className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded",
                            item.status === 'scheduling' ? "bg-amber-500/20 text-amber-400" :
                            item.status === 'done' ? "bg-green-500/20 text-green-400" :
                            "bg-zinc-700/30 text-zinc-500"
                          )}>
                            <Send className="h-3 w-3" />
                            <span>Post</span>
                          </div>
                          {item.status === 'done' && (
                            <>
                              <span className="text-zinc-600">→</span>
                              <div className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/20 text-green-400">
                                <Check className="h-3 w-3" />
                                <span>เสร็จ</span>
                              </div>
                            </>
                          )}
                          {item.status === 'failed' && (
                            <>
                              <span className="text-zinc-600">→</span>
                              <div className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 text-red-400">
                                <AlertCircle className="h-3 w-3" />
                                <span>หยุดแล้ว</span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Logs List */}
                        <div className="bg-zinc-950/50 rounded-md border border-zinc-800 max-h-[180px] overflow-y-auto">
                          {logs && logs.length > 0 ? (
                            <div className="p-2 space-y-0.5">
                              {logs.map((log: any) => {
                                // Parse friendly error messages
                                let displayMsg = log.message;
                                if (log.log_type === 'error') {
                                  if (log.message.includes('postforme') && log.message.includes('invalid social accounts')) {
                                    displayMsg = 'Post for Me: บัญชี Social ที่เชื่อมต่อมีปัญหา กรุณาตรวจสอบการเชื่อมต่อ';
                                  } else if (log.message.includes('blotato') && log.message.includes('error')) {
                                    displayMsg = 'Blotato: เกิดข้อผิดพลาด กรุณาตรวจสอบการเชื่อมต่อ';
                                  }
                                }
                                return (
                                <div key={log.id} className={cn(
                                  "flex items-start gap-2 text-[11px] py-0.5 px-1 font-mono",
                                  log.log_type === 'success' && "text-green-400",
                                  log.log_type === 'error' && "text-red-400",
                                  log.log_type === 'warning' && "text-amber-400",
                                  log.log_type === 'info' && "text-zinc-500"
                                )}>
                                  <span className="text-zinc-600 shrink-0">
                                    {new Date(log.created_at).toLocaleTimeString('en-US', { hour12: false })}
                                  </span>
                                  <span className="break-all">{displayMsg}</span>
                                </div>
                                );
                              })}
                            </div>
                          ) : isLoadingLog ? (
                            <div className="p-3 text-xs text-zinc-500 flex items-center gap-2">
                              <Loader2 className="h-3 w-3 animate-spin" /> {t('dayDetail.loadingLogs')}
                            </div>
                          ) : (
                            <div className="p-3 text-xs text-zinc-600">{t('dayDetail.noLogs')}</div>
                          )}
                        </div>
                        <div className="mt-1 flex justify-end">
                          <Button size="sm" variant="ghost" onClick={() => fetchLogsForItem(item.id)} className="h-6 px-2 text-[10px] text-zinc-600 hover:text-zinc-300 gap-1">
                            <RefreshCw className="h-2.5 w-2.5" /> {t('dayDetail.refresh')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </ScrollArea>
      </DialogContent>

    </Dialog>

      {/* Expanded Video Modal - Rendered outside Dialog to prevent close propagation */}
      {expandedVideoUrl && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation();
            setExpandedVideoUrl(null);
          }}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(expandedVideoUrl) ? (
              <img
                src={expandedVideoUrl}
                alt="Generated image"
                className="max-w-full max-h-[85vh] rounded-lg"
              />
            ) : (
              <video
                src={expandedVideoUrl}
                controls
                autoPlay
                className="max-w-full max-h-[85vh] rounded-lg"
              />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpandedVideoUrl(null);
              }}
              className="absolute -top-10 right-0 p-2 text-white hover:text-zinc-300 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await api.downloadViaProxy(expandedVideoUrl!, `video_${Date.now()}.mp4`);
                } catch (err: any) {
                  toast.error(err?.message || 'Download failed');
                }
              }}
              className="absolute -top-10 right-12 p-2 text-white hover:text-zinc-300 transition-colors"
              title={t('dayDetail.downloadVideo')}
            >
              <Download className="h-6 w-6" />
            </button>
          </div>
        </div>
      )}

      {/* Generate to History Dialog */}
      <Dialog open={showGenToHistory} onOpenChange={setShowGenToHistory}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('dayDetail.genToHistoryTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm font-medium">{t('dayDetail.howManyClips')}</p>
              <div className="flex items-center gap-2 mt-2">
                {[1, 3, 5, 10].map(n => (
                  <Button
                    key={n}
                    size="sm"
                    variant={genToHistoryCount === n ? 'default' : 'outline'}
                    className={genToHistoryCount === n ? 'bg-blue-500 hover:bg-blue-600 text-white' : ''}
                    onClick={() => setGenToHistoryCount(n)}
                  >
                    {n}
                  </Button>
                ))}
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={genToHistoryCount}
                  onChange={e => setGenToHistoryCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="w-20 h-8"
                />
              </div>
            </div>
            <Button
              onClick={handleGenToHistory}
              disabled={isGenToHistory}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white"
            >
              {isGenToHistory ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Video className="h-4 w-4 mr-2" />
              )}
              {t('dayDetail.startGenToHistory', { count: genToHistoryCount })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pull from History Popup */}
      <Dialog open={showHistoryPopup} onOpenChange={(open) => { if (!historySelectedVideo) setShowHistoryPopup(open); }}>
        <DialogContent
          className="max-w-2xl max-h-[80vh] flex flex-col"
          onPointerDownOutside={(e) => { if (historySelectedVideo) e.preventDefault(); }}
          onInteractOutside={(e) => { if (historySelectedVideo) e.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle>{t('dayDetail.pullFromHistory')}</DialogTitle>
            {currentChannel && <p className="text-sm text-muted-foreground">{currentChannel.name}</p>}
          </DialogHeader>
          {/* Retention notice */}
          <div className="flex items-start gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-xs text-amber-200">
            <span>⚠️</span>
            <span>ไฟล์ทั้งหมดจะถูกจัดเก็บไว้ 30 วัน หลังจากนั้นจะถูกลบออกโดยอัตโนมัติ<br />กรุณาดาวน์โหลดไฟล์ที่ต้องการเก็บไว้ก่อนหมดอายุ</span>
          </div>
          {/* Filter buttons — choose what to pull from history (videos by sub-type or images) */}
          {!historyLoading && (
            <div className="flex items-center gap-2 pb-2">
              {([
                { key: 'all' as const, label: t('historyTab.filterAll') },
                { key: 'final' as const, label: t('historyTab.sourceViralFinal') },
                { key: 'scene' as const, label: 'VDO Scene' },
                { key: 'image' as const, label: 'Image Template' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    if (historyFilter === key) return;
                    setHistoryFilter(key);
                    fetchHistoryItems(true, key);
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    historyFilter === key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {(() => {
            const filtered = historyItems; // Server-side filtered via source param
            if (historyLoading) return (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            );
            if (filtered.length === 0) return (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {t('history.empty')}
              </div>
            );
            return (
            <div className="overflow-y-auto flex-1 pr-1">
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {filtered.map((item: any) => {
                  // Render as image ONLY when the user is on the Image Template filter tab.
                  // Other filters always render as video (matches per-tab content type).
                  const isImage = historyFilter === 'image';
                  return (
                  <div
                    key={item.id}
                    className="rounded-lg overflow-hidden border border-zinc-700/50 hover:border-[#FFB300]/50 transition-colors cursor-pointer group"
                    onClick={() => handlePullClipFromHistory(item)}
                  >
                    <div className="relative aspect-[9/16] bg-zinc-900">
                      {isImage ? (
                        <img
                          src={item.thumbnail_url || item.video_url}
                          alt="History item"
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <>
                          <LazyVideo src={item.video_url} thumbnailUrl={item.thumbnail_url} autoCapture />
                          <button
                            className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => { e.stopPropagation(); setHistorySelectedVideo(item); }}
                          >
                            <Play className="h-6 w-6 text-white fill-white" />
                          </button>
                        </>
                      )}
                    </div>
                    <div className="p-2 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs text-zinc-400 truncate">
                          {new Date(item.updated_at || item.scheduled_time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}{' '}
                          {new Date(item.updated_at || item.scheduled_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-[#FFB300] border-[#FFB300]/30 hover:bg-[#FFB300]/10 shrink-0">
                          {isImage ? 'ใช้ภาพนี้' : t('dayDetail.useClip')}
                        </Button>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {item.posted && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                            {t('dayDetail.alreadyPosted')}
                          </span>
                        )}
                        {item.source && item.source !== 'schedule_queue' && (() => {
                          // Prettify source name (model tag)
                          const sourceLabels: Record<string, string> = {
                            viral_final_video: 'Viral',
                            viral_scene_video: 'Viral Scene',
                            viral_image: 'Viral Image',
                            idol_final_video: 'Idol',
                            idol_scene_video: 'Idol Scene',
                            idol_image: 'Idol Image',
                            gpt_image_2: 'GPT Image 2',
                            image_template: 'Image Template',
                            nano_banana_2: 'Nano Banana 2',
                            nano_banana_pro: 'Nano Banana Pro',
                            grok_imagine: 'Grok Imagine',
                            kling_3_motion_control: 'Kling 3 Motion',
                          };
                          const label = sourceLabels[item.source] || item.source;
                          return (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#FFB300]/15 text-[#FFB300] border border-[#FFB300]/20">
                              {label}
                            </span>
                          );
                        })()}
                      </div>
                      {item.character_name && (
                        <p className="text-[10px] text-zinc-500 truncate">{item.character_name}</p>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
              {historyHasMore && (
                <div className="flex justify-center py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); fetchHistoryItems(false); }}
                    disabled={historyLoadingMore}
                    className="text-xs"
                  >
                    {historyLoadingMore ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    {t('history.loadMore')}
                  </Button>
                </div>
              )}
            </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* History Video Playback - portaled to body to escape Dialog event handling */}
      {historySelectedVideo && historySelectedVideo.video_url && createPortal(
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4 pointer-events-auto"
          style={{ pointerEvents: 'auto' }}
          onClick={() => setHistorySelectedVideo(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
            onClick={() => setHistorySelectedVideo(null)}
          >
            <X className="h-6 w-6" />
          </button>
          <video
            src={historySelectedVideo.video_url}
            className={`${
              historySelectedVideo.aspect_ratio === 'portrait'
                ? 'h-[85vh] max-w-[48vh]'
                : 'w-[90vw] max-w-4xl max-h-[85vh]'
            } rounded-lg`}
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}

      {/* Post status popup — opened by the per-row "ดูสถานะ" button */}
      {(() => {
        if (statusDialogItemId === null) return null;
        const item = dayItems.find((it: any) => it.id === statusDialogItemId);
        if (!item) return null;
        const spId: string = item.postforme_post_ids?.[0]?.postId || '';

        // Format the queue item's scheduled_time using the same MM/DD/YYYY HH:mm pattern
        // the activity log uses (matches Postforme dashboard's "Post At" column).
        let postAt: string | null = null;
        if (item.scheduled_time) {
          try {
            const d = new Date(item.scheduled_time);
            if (!isNaN(d.getTime())) {
              const fmt = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Bangkok',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hour12: false,
              });
              const parts = fmt.formatToParts(d);
              const get = (t: string) => parts.find(p => p.type === t)?.value || '';
              postAt = `${get('month')}/${get('day')}/${get('year')} ${get('hour')}:${get('minute')}`;
            }
          } catch { /* fall back to null */ }
        }

        return (
          <PostStatusDialog
            open={true}
            onOpenChange={(o) => { if (!o) setStatusDialogItemId(null); }}
            postId={spId}
            postAt={postAt}
            results={item.postforme_post_results}
          />
        );
      })()}

      {confirmDialog}
    </>
  );
};

export default DayDetailModal;
