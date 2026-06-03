
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, Plus, Eye, X, RotateCcw, ChevronDown, Video, Send, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';
import { useScheduler } from '@/contexts/SchedulerContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SchedulerChannel, ScheduleQueueItem, ScheduleSlot } from '@/types/scheduler';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useGenerateConfirm } from '@/components/common/GenerateConfirmDialog';
import { quoteSchedulerItem, buildQuote } from '@/lib/generationPricing';

interface ScheduleCalendarProps {
  channel: SchedulerChannel;
  onDayClick?: (dateStr: string, slots: ScheduleSlot[]) => void;
  onMultiDayAdd?: (dates: string[]) => void;
  onMultiDayView?: (dates: string[]) => void;
}

export const ScheduleCalendar: React.FC<ScheduleCalendarProps> = ({
  channel,
  onDayClick,
  onMultiDayAdd,
  onMultiDayView,
}) => {
  const { t, language } = useLanguage();

  const DAYS = language === 'th'
    ? ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const MONTHS = language === 'th'
    ? ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const {
    currentMonth,
    setCurrentMonth,
    queueItems,
    startQueueRunner,
    deleteQueueItem,
  } = useScheduler();

  const [existingItems, setExistingItems] = useState<Record<string, ScheduleQueueItem[]>>({});
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [selectedTemplateMode, setSelectedTemplateMode] = useState<string>('all-round-robin');
  const { requestConfirm, dialog: confirmDialog } = useGenerateConfirm();

  // ราคา (ประมาณ) ต่อ 1 คิว ของ channel นี้ — ใช้ ai_model + scenes + duration ของ channel
  const buildChannelQuote = useCallback((count: number) => {
    const aiModel = (channel as any).ai_model as string | undefined;
    const scenes = (channel as any).viral_scenes_per_video ?? (channel as any).idol_scenes_per_video ?? 3;
    const durationSec = parseInt(String(channel.duration)) || 10;
    const tasks = Array.from({ length: Math.max(1, count) }).map((_, i) =>
      quoteSchedulerItem({
        taskLabel: `${t('calendar.generate')} #${i + 1}`,
        aiModel,
        scenes,
        durationSec,
        hasExtendPrompt: !!(channel as any).extend_prompt,
      })
    );
    return buildQuote(tasks);
  }, [channel, t]);

  // Drag selection state - use refs for immediate updates (global events fire before React events)
  const isDraggingRef = useRef(false);
  const dragStartDateRef = useRef<string | null>(null);

  // Skip fetch after retry to prevent overwriting optimistic update
  const skipNextFetchRef = useRef(false);

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedDates(new Set());
  }, []);

  // Get all dates between two dates (inclusive)
  const getDatesBetween = useCallback((start: string, end: string): string[] => {
    const dates: string[] = [];
    const startDate = new Date(start);
    const endDate = new Date(end);

    // Swap if start > end
    const [from, to] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];

    const current = new Date(from);
    while (current <= to) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }, []);

  const pendingCount = useMemo(() => {
    // Include 'queued' items too — they may be stuck from a previous run
    // Exclude items that already have a video_url (e.g. pulled from history)
    const isPending = (item: ScheduleQueueItem) =>
      (item.status === 'pending' || item.status === 'queued') && !item.video_url;
    if (selectedDates.size > 0) {
      // Only count items for selected dates
      const count = Array.from(selectedDates).reduce((sum, date) => {
        const items = existingItems[date] || [];
        return sum + items.filter(isPending).length;
      }, 0);
      return count;
    }
    const count = Object.values(existingItems).flat().filter(isPending).length;
    return count;
  }, [existingItems, selectedDates]);

  const queuedCount = useMemo(() => {
    const count = Object.values(existingItems).flat().filter(item => item.status === 'queued').length;
    return count;
  }, [existingItems]);

  const failedItems = useMemo(() => {
    const items = Object.values(existingItems).flat().filter(item => item.status === 'failed');
    return items;
  }, [existingItems]);

  const readyToPostItems = useMemo(() => {
    const allItems = selectedDates.size > 0
      ? Array.from(selectedDates).flatMap(date => existingItems[date] || [])
      : Object.values(existingItems).flat();
    return allItems.filter(item => {
      if (!item.video_url) return false;
      const service = item.posting_service || channel?.posting_service;
      if (!service || service === 'none') return false;
      if (item.blotato_post_ids?.length || item.late_post_ids?.length || item.postforme_post_ids?.length) return false;
      if (['generating', 'captioning', 'scheduling', 'queued'].includes(item.status)) return false;
      return true;
    });
  }, [existingItems, selectedDates, channel]);

  const [retryingAll, setRetryingAll] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPostingAll, setIsPostingAll] = useState(false);

  const handlePostAll = async () => {
    if (readyToPostItems.length === 0) return;
    setIsPostingAll(true);
    try {
      let posted = 0;
      for (const item of readyToPostItems) {
        try {
          await api.postQueueItem(item.id);
          posted++;
        } catch (error) {
          console.error(`Failed to post item ${item.id}:`, error);
        }
      }
      if (posted > 0) {
        toast.success(`${t('dayDetail.postAllStarted')} (${posted})`);
        setTimeout(() => fetchExistingItems(), 500);
      }
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.postAllFailed'));
    } finally {
      setIsPostingAll(false);
    }
  };

  const handleRetryAllFailed = async () => {
    if (failedItems.length === 0) return;

    setRetryingAll(true);
    console.log('[RETRY] Starting retry, failed items:', failedItems.length);

    try {
      // Use bulk retry API - resets all failed to pending without auto-processing
      const result = await api.retryAllFailedItems(channel.id);
      console.log('[RETRY] API result:', result);

      if (result.success && result.count > 0) {
        toast.success(t('calendar.queuedForRegeneration', { count: result.count }));

        console.log('[RETRY] Before state update, existingItems dates:', Object.keys(existingItems));

        // Update local state immediately - change all failed items to pending
        setExistingItems(prev => {
          console.log('[RETRY] Inside setExistingItems, prev dates:', Object.keys(prev));
          const updated: Record<string, ScheduleQueueItem[]> = {};
          let changedCount = 0;
          Object.entries(prev).forEach(([date, items]) => {
            updated[date] = items.map(item => {
              if (item.status === 'failed') {
                changedCount++;
                return { ...item, status: 'pending' as const, error: undefined };
              }
              return item;
            });
          });
          console.log('[RETRY] Changed', changedCount, 'items to pending');
          console.log('[RETRY] Returning updated state with dates:', Object.keys(updated));
          return updated;
        });

        console.log('[RETRY] setExistingItems called');

        // Skip next fetch to prevent overwriting our optimistic update
        skipNextFetchRef.current = true;

        // Lock generate button while runner processes the retried items
        setIsGenerating(true);

        // Start queue runner to process all pending items
        await startQueueRunner(channel.id);

        // Reset skip flag after a delay
        setTimeout(() => {
          skipNextFetchRef.current = false;
        }, 2000);
      } else if (result.count === 0) {
        toast.info(t('calendar.noFailedItems'));
      }
    } catch (error) {
      console.error('Failed to retry all:', error);
      toast.error(t('calendar.retryItemsFailed'));
    } finally {
      setRetryingAll(false);
    }
  };

  // Helper to extract local time from ISO string using channel timezone
  const getLocalTime = (isoString: string): string => {
    try {
      const tz = channel.timezone === 'local'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : channel.timezone;
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '--:--';
      return d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '--:--';
    }
  };

  // Fetch existing queue items for the visible date range
  const fetchExistingItems = useCallback(async () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    // Get start and end of visible calendar (including overflow days)
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Adjust to include overflow days
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - lastDay.getDay()));

    // Format dates in local time (not UTC) to avoid off-by-one from toISOString()
    const formatLocal = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Get channel timezone for consistent date grouping
    const channelTz = channel.timezone === 'local'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : channel.timezone;

    try {
      const data = await api.getScheduleQueueByDate({
        channel_id: channel.id,
        start_date: formatLocal(startDate),
        end_date: formatLocal(endDate),
        timezone: channelTz,  // Use channel timezone for date grouping
      });
      // Always update - status changes need to reflect immediately
      setExistingItems(data);
    } catch (error) {
      console.error('Failed to fetch existing items:', error);
    }
  }, [channel.id, channel.timezone, currentMonth]);

  // Re-fetch when queueItems changes (e.g., after delete)
  useEffect(() => {
    // Skip if we just did a retry (to prevent overwriting optimistic update)
    if (skipNextFetchRef.current) {
      return;
    }
    fetchExistingItems();
  }, [fetchExistingItems, queueItems]);

  // Auto-refresh when there are any items (to catch status changes from modal/other sources)
  useEffect(() => {
    const allItems = Object.values(existingItems).flat();
    const hasActive = allItems.some(item =>
      ['generating', 'captioning', 'scheduling', 'viral_pending', 'viral_running', 'idol_pending', 'idol_running', 'image_generating'].includes(item.status)
    );
    const hasQueued = allItems.some(item => item.status === 'queued');
    const hasPending = allItems.some(item => item.status === 'pending');
    const hasFailed = allItems.some(item => item.status === 'failed');

    // Reset isGenerating only when no active, no queued, AND no pending items
    if (!hasActive && !hasQueued && !hasPending && isGenerating) {
      setIsGenerating(false);
    }

    // Keep refreshing if there are ANY non-done items (active, queued, pending, or failed)
    // This ensures calendar stays in sync with modal which may start generation
    if (!hasActive && !hasQueued && !hasPending && !hasFailed && !isGenerating) return;

    const interval = setInterval(() => {
      // Skip if we're in the middle of optimistic update
      if (skipNextFetchRef.current) return;
      fetchExistingItems();
    }, 3000); // Refresh every 3 seconds

    return () => clearInterval(interval);
  }, [existingItems, fetchExistingItems, isGenerating]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    // Get effective timezone (channel timezone or local)
    const tz = channel.timezone === 'local'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : channel.timezone;

    // Helper to format date string directly (YYYY-MM-DD) - NO timezone conversion
    // This ensures clicking on "28" gives you "2026-01-28", not converted
    const formatDateStr = (y: number, m: number, d: number) => {
      return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };

    // Get "today" in channel's timezone (this DOES need timezone conversion)
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    // Max date: today + 30 days
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 30);
    const maxDateStr = maxDate.toLocaleDateString('en-CA', { timeZone: tz });

    const days: Array<{
      date: Date;
      dateStr: string;
      dayNum: number;
      outsideMonth: boolean;
      isPast: boolean;
      isBeyondLimit: boolean;
      isToday: boolean;
      existingItems: ScheduleQueueItem[];
    }> = [];

    // Previous month's days
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const date = new Date(prevYear, prevMonth, dayNum);
      const dateStr = formatDateStr(prevYear, prevMonth, dayNum);
      days.push({
        date,
        dateStr,
        dayNum,
        outsideMonth: true,
        isPast: dateStr < todayStr,
        isBeyondLimit: dateStr > maxDateStr,
        isToday: false,
        existingItems: existingItems[dateStr] || [],
      });
    }

    // Current month's days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = formatDateStr(year, month, day);
      days.push({
        date,
        dateStr,
        dayNum: day,
        outsideMonth: false,
        isPast: dateStr < todayStr,
        isBeyondLimit: dateStr > maxDateStr,
        isToday: dateStr === todayStr,
        existingItems: existingItems[dateStr] || [],
      });
    }

    // Next month's days
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const minRows = Math.ceil(days.length / 7);
    const remainingDays = (minRows * 7) - days.length; // Fill to complete last row
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(nextYear, nextMonth, day);
      const dateStr = formatDateStr(nextYear, nextMonth, day);
      days.push({
        date,
        dateStr,
        dayNum: day,
        outsideMonth: true,
        isPast: false,
        isBeyondLimit: dateStr > maxDateStr,
        isToday: false,
        existingItems: existingItems[dateStr] || [],
      });
    }

    return days;
  }, [currentMonth, existingItems, channel.timezone]);

  // Get today's date string helper
  const getTodayStr = useCallback(() => {
    const tz = channel.timezone === 'local'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : channel.timezone;
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  }, [channel.timezone]);

  // Max selectable date: today + 30 days
  const getMaxDateStr = useCallback(() => {
    const tz = channel.timezone === 'local'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : channel.timezone;
    const now = new Date();
    const max = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return max.toLocaleDateString('en-CA', { timeZone: tz });
  }, [channel.timezone]);

  // Mouse down - start potential drag (or single click for past/beyond-limit days)
  const handleDayMouseDown = (dateStr: string, e: React.MouseEvent, isPast?: boolean, isBeyondLimit?: boolean) => {
    e.preventDefault();
    if (isBeyondLimit) return; // Block completely
    if (isPast) {
      // For past days, just mark for single-click view (no dragging)
      dragStartDateRef.current = dateStr;
      return;
    }
    isDraggingRef.current = true;
    dragStartDateRef.current = dateStr;
    setSelectedDates(new Set([dateStr]));
  };

  // Mouse enter - extend selection if dragging
  const handleDayMouseEnter = (dateStr: string) => {
    if (!isDraggingRef.current || !dragStartDateRef.current) return;
    if (dateStr < getTodayStr()) return;
    if (dateStr > getMaxDateStr()) return; // Don't extend beyond 30-day limit

    // Select all dates between dragStart and current
    const datesToSelect = getDatesBetween(dragStartDateRef.current, dateStr);
    // Filter out past dates and beyond-limit dates
    const todayStr = getTodayStr();
    const maxStr = getMaxDateStr();
    const validDates = datesToSelect.filter(d => d >= todayStr && d <= maxStr);
    setSelectedDates(new Set(validDates));
  };

  // Helper to build slots from items
  const buildSlots = (dateStr: string, items: ScheduleQueueItem[]): ScheduleSlot[] => {
    const dayIndex = new Date(dateStr).getDay();
    return items.map(item => ({
      id: item.id.toString(),
      date: dateStr,
      dayName: DAYS[dayIndex] || 'Sun',
      time: getLocalTime(item.scheduled_time),
      scheduledTime: item.scheduled_time,
      variableValues: item.variable_values,
      status: 'exists' as const,
      existingItem: item,
    }));
  };

  // Mouse up - end drag (or view for past/beyond-limit days)
  const handleDayMouseUp = (dateStr: string, items: ScheduleQueueItem[], isPast?: boolean, isBeyondLimit?: boolean) => {
    // For beyond-limit days: block completely
    if (isBeyondLimit) {
      dragStartDateRef.current = null;
      return;
    }
    // For past days: open modal to view only (no selection)
    if (isPast) {
      if (dragStartDateRef.current === dateStr && onDayClick) {
        dragStartDateRef.current = null;
        onDayClick(dateStr, buildSlots(dateStr, items));
      }
      return;
    }

    if (!isDraggingRef.current) return;

    const wasSingleClick = selectedDates.size === 1 && dragStartDateRef.current === dateStr;

    isDraggingRef.current = false;
    dragStartDateRef.current = null;

    // If only one date selected (no drag), open modal
    if (wasSingleClick) {
      setSelectedDates(new Set()); // Clear selection
      if (onDayClick) {
        onDayClick(dateStr, buildSlots(dateStr, items));
      }
    }
  };

  // Global mouse up to handle drag ending outside calendar
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        dragStartDateRef.current = null;
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // Handle multi-day actions
  const handleAddToSelected = () => {
    if (selectedDates.size === 0) return;
    const sortedDates = Array.from(selectedDates).sort();
    if (onMultiDayAdd) {
      onMultiDayAdd(sortedDates);
    }
  };

  const handleViewSelected = () => {
    if (selectedDates.size === 0) return;
    const sortedDates = Array.from(selectedDates).sort();
    if (onMultiDayView) {
      onMultiDayView(sortedDates);
    }
  };

  // Items in selected dates that are safe to delete (skip in-flight items)
  const deletableSelectedItems = useMemo(() => {
    if (selectedDates.size === 0) return [] as ScheduleQueueItem[];
    const busyStatuses = new Set(['generating', 'captioning', 'scheduling', 'queued']);
    return Array.from(selectedDates).flatMap(date =>
      (existingItems[date] || []).filter(item => !busyStatuses.has(item.status))
    );
  }, [selectedDates, existingItems]);

  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDeleteSelected = () => {
    if (selectedDates.size === 0) return;
    if (deletableSelectedItems.length === 0) {
      toast.error(t('calendar.noDeletableItems'));
      return;
    }
    setDeleteDialogOpen(true);
  };

  const confirmDeleteSelected = async () => {
    setDeleteDialogOpen(false);
    setIsDeletingSelected(true);
    try {
      let deleted = 0;
      for (const item of deletableSelectedItems) {
        try {
          const ok = await deleteQueueItem(item.id);
          if (ok) deleted++;
        } catch (err) {
          console.error(`Failed to delete item ${item.id}:`, err);
        }
      }
      if (deleted > 0) {
        toast.success(t('calendar.itemsDeleted', { count: deleted }));
      }
      clearSelection();
      await fetchExistingItems();
    } catch (error: any) {
      toast.error(error?.message || t('dayDetail.failedToDeleteItems'));
    } finally {
      setIsDeletingSelected(false);
    }
  };


  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  // Check if next month button should be disabled (all days would be beyond limit)
  const isNextMonthDisabled = (() => {
    const nextMonthFirst = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    const nextMonthFirstStr = nextMonthFirst.toLocaleDateString('en-CA');
    return nextMonthFirstStr > getMaxDateStr();
  })();

  const goToToday = () => {
    setCurrentMonth(new Date());
  };

  return (
    <div className="space-y-4">
      {/* Calendar Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-base sm:text-lg font-semibold min-w-[140px] sm:min-w-[180px] text-center">
            {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </h3>
          <Button variant="outline" size="icon" onClick={nextMonth} disabled={isNextMonthDisabled}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToToday}>
            {t('calendar.today')}
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {failedItems.length > 0 && (
            <Button
              size="sm"
              onClick={handleRetryAllFailed}
              disabled={retryingAll}
              className="bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white"
            >
              <RotateCcw className={cn("h-4 w-4 mr-1", retryingAll && "animate-spin")} />
              {retryingAll ? t('calendar.retrying') : `${t('calendar.retryFailed')} (${failedItems.length})`}
            </Button>
          )}

          {/* Show queued count while generating */}
          {queuedCount > 0 && (
            <Badge variant="secondary" className="bg-purple-500/20 text-purple-400 border-purple-500/30">
              📋 {queuedCount} {t('calendar.queued')}
            </Badge>
          )}

          {(pendingCount > 0 || isGenerating) && (
            <>
              {/* Template selection dropdown - only show when channel has multi-templates */}
              {(() => {
                const rawTemplates = channel.prompt_mode === 'ai'
                  ? (channel.ai_prompt_templates && channel.ai_prompt_templates.length > 0 ? channel.ai_prompt_templates : undefined)
                  : channel.prompt_templates;
                // Dedup by label to avoid duplicates from legacy data
                const templates = rawTemplates ? rawTemplates.filter((tmpl, idx, arr) => arr.findIndex(t => t.label === tmpl.label) === idx) : undefined;
                return templates && templates.length > 0 ? (
                <Select value={selectedTemplateMode} onValueChange={setSelectedTemplateMode}>
                  <SelectTrigger className="h-8 w-auto min-w-[180px] text-xs bg-gray-900/50 border-gray-700">
                    <SelectValue placeholder={t('calendar.selectTemplate')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all-round-robin">{t('calendar.useAllRoundRobin')}</SelectItem>
                    <SelectItem value="all-random">{t('calendar.useAllRandom')}</SelectItem>
                    {templates.map((tmpl) => (
                      <SelectItem key={tmpl.id} value={`template-${tmpl.id}`}>
                        {tmpl.label || tmpl.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                ) : null;
              })()}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    disabled={isGenerating || pendingCount === 0}
                    className="bg-[#FFB300] hover:bg-[#FFA000] text-black font-medium"
                  >
                    <Play className={cn("h-4 w-4 mr-1", isGenerating && "animate-pulse")} />
                    {isGenerating && pendingCount === 0 ? t('calendar.processing') : `${t('calendar.generate')} (${pendingCount})`}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-green-400" onClick={() => {
                    if (isGenerating || pendingCount === 0) return;
                    const count = pendingCount;
                    requestConfirm(buildChannelQuote(count), async () => {
                      setIsGenerating(true);
                      const dates = selectedDates.size > 0 ? Array.from(selectedDates) : undefined;
                      let templateId: string | undefined;
                      let templateMode: string | undefined;
                      if (selectedTemplateMode === 'all-round-robin') { templateMode = 'round-robin'; }
                      else if (selectedTemplateMode === 'all-random') { templateMode = 'random'; }
                      else if (selectedTemplateMode.startsWith('template-')) { templateId = selectedTemplateMode.replace('template-', ''); }
                      const started = await startQueueRunner(channel.id, dates, undefined, templateId, templateMode);
                      if (started) { toast.success(t('calendar.startedGenerating', { count })); setTimeout(() => fetchExistingItems(), 500); }
                    });
                  }}>
                    <Play className="h-4 w-4 mr-2" />
                    {t('dayDetail.generateAndPost')}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-blue-400" onClick={() => {
                    if (isGenerating || pendingCount === 0) return;
                    requestConfirm(buildChannelQuote(pendingCount), async () => {
                      setIsGenerating(true);
                      const dates = selectedDates.size > 0 ? Array.from(selectedDates) : undefined;
                      let templateId: string | undefined;
                      let templateMode: string | undefined;
                      if (selectedTemplateMode === 'all-round-robin') { templateMode = 'round-robin'; }
                      else if (selectedTemplateMode === 'all-random') { templateMode = 'random'; }
                      else if (selectedTemplateMode.startsWith('template-')) { templateId = selectedTemplateMode.replace('template-', ''); }
                      const started = await startQueueRunner(channel.id, dates, undefined, templateId, templateMode, true);
                      if (started) { toast.success(t('dayDetail.generatingOnly')); setTimeout(() => fetchExistingItems(), 500); }
                    });
                  }}>
                    <Video className="h-4 w-4 mr-2" />
                    {t('dayDetail.generateOnly')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {readyToPostItems.length > 0 && (
            <Button
              size="sm"
              disabled={isPostingAll}
              onClick={handlePostAll}
              className="bg-purple-600 hover:bg-purple-700 text-white font-medium disabled:opacity-50"
            >
              {isPostingAll ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              {t('dayDetail.postAll')} ({readyToPostItems.length})
            </Button>
          )}
        </div>
      </div>

      {/* Selection Bar - reserved space to prevent layout shift */}
      <div className={cn(
        "flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border transition-all",
        selectedDates.size > 0
          ? "bg-blue-500/10 border-blue-500/30"
          : "border-transparent invisible"
      )}>
        <span className="text-sm text-blue-400 font-medium">
          {selectedDates.size > 0 ? `${selectedDates.size} ${t('calendar.daysSelected')}` : '\u00A0'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddToSelected}
            className="h-8 text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('calendar.addTasks')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleViewSelected}
            className="h-8 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            {t('calendar.view')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDeleteSelected}
            disabled={isDeletingSelected || deletableSelectedItems.length === 0}
            className="h-8 text-red-400 border-red-500/30 hover:bg-red-500/10 disabled:opacity-40"
          >
            {isDeletingSelected ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-1" />
            )}
            {t('calendar.delete')}
            {deletableSelectedItems.length > 0 && ` (${deletableSelectedItems.length})`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={clearSelection}
            className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Status legend — colors match the badges shown on each calendar day */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-muted-foreground font-medium pr-1">
          {t('calendar.statusLegend')}:
        </span>
        <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-medium">
          ⏳ {t('calendar.pending')}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">
          📋 {t('calendar.queued')}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
          🔄 {t('calendar.processing').replace(/\.{3}$/, '')}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">
          ✅ {t('calendar.done')}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
          ❌ {t('calendar.failed')}
        </span>
      </div>

      {/* Calendar Grid */}
      <div className="border rounded-lg overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 bg-muted/50">
          {DAYS.map(day => (
            <div key={day} className="px-2 py-2 text-center text-sm font-medium text-muted-foreground">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar days */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, index) => {
            const isSelected = selectedDates.has(day.dateStr);
            return (
            <div
              key={index}
              className={cn(
                'min-h-[100px] p-2 border-t border-l cursor-pointer transition-all select-none',
                day.outsideMonth && 'bg-muted/30 text-muted-foreground',
                day.isPast && 'bg-muted/20 opacity-70',
                day.isBeyondLimit && 'bg-muted/20 opacity-50',
                day.isToday && 'bg-primary/5',
                !day.isPast && !day.isBeyondLimit && 'hover:bg-muted/50',
                index % 7 === 0 && 'border-l-0',
                // Selected state (only for selectable days)
                isSelected && !day.isPast && !day.isBeyondLimit && 'ring-2 ring-blue-500 ring-inset bg-blue-500/10'
              )}
              onMouseDown={(e) => handleDayMouseDown(day.dateStr, e, day.isPast, day.isBeyondLimit)}
              onMouseEnter={() => !day.isPast && !day.isBeyondLimit && handleDayMouseEnter(day.dateStr)}
              onMouseUp={() => handleDayMouseUp(day.dateStr, day.existingItems, day.isPast, day.isBeyondLimit)}
            >
              <div className="flex items-start justify-between">
                <span className={cn(
                  'text-sm font-medium',
                  day.isToday && 'bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center'
                )}>
                  {day.dayNum}
                </span>

                {day.existingItems.length > 0 && (() => {
                  // Calculate status counts for this day
                  const counts = { pending: 0, queued: 0, processing: 0, done: 0, failed: 0 };
                  day.existingItems.forEach(item => {
                    if (item.status === 'pending') counts.pending++;
                    else if (item.status === 'queued') counts.queued++;
                    else if (['generating', 'captioning', 'scheduling'].includes(item.status)) counts.processing++;
                    else if (item.status === 'done') counts.done++;
                    else if (item.status === 'failed') counts.failed++;
                  });
                  return (
                    <div className="flex items-center gap-0.5 text-[9px] font-medium">
                      {counts.pending > 0 && (
                        <span className="px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400" title={t('calendar.pending')}>
                          ⏳{counts.pending}
                        </span>
                      )}
                      {counts.queued > 0 && (
                        <span className="px-1 py-0.5 rounded bg-purple-500/20 text-purple-400" title={t('calendar.queued')}>
                          📋{counts.queued}
                        </span>
                      )}
                      {counts.processing > 0 && (
                        <span className="px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 animate-pulse" title={t('calendar.processing')}>
                          🔄{counts.processing}
                        </span>
                      )}
                      {counts.done > 0 && (
                        <span className="px-1 py-0.5 rounded bg-green-500/20 text-green-400" title={t('calendar.done')}>
                          ✅{counts.done}
                        </span>
                      )}
                      {counts.failed > 0 && (
                        <span className="px-1 py-0.5 rounded bg-red-500/20 text-red-400" title={t('calendar.failed')}>
                          ❌{counts.failed}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Show all queue items with status-based colors */}
              {(() => {
                const items = day.existingItems;
                if (items.length === 0) return null;
                console.log(`[CAL-DEBUG] Rendering ${items.length} items for ${day.dateStr}, isPast=${day.isPast}`);

                // Status colors: yellow=pending, purple=queued, amber=viral, blue=processing, green=done, red=failed
                const getStatusStyle = (item: ScheduleQueueItem) => {
                  switch (item.status) {
                    case 'pending':
                      return 'bg-yellow-500/20 text-yellow-400 border-l-2 border-yellow-500';
                    case 'queued':
                      return 'bg-purple-500/20 text-purple-400 border-l-2 border-purple-500';
                    case 'viral_pending':
                    case 'viral_running':
                    case 'idol_pending':
                    case 'idol_running':
                    case 'image_generating':
                    case 'generating':
                    case 'captioning':
                    case 'scheduling':
                      return 'bg-blue-500/20 text-blue-400 border-l-2 border-blue-500';
                    case 'done':
                      return 'bg-green-500/20 text-green-400 border-l-2 border-green-500';
                    case 'failed':
                      return 'bg-red-500/20 text-red-400 border-l-2 border-red-500';
                    default:
                      return 'bg-zinc-500/20 text-zinc-400';
                  }
                };

                const getStatusIcon = (item: ScheduleQueueItem) => {
                  switch (item.status) {
                    case 'pending': return '⏳';
                    case 'queued': return '📋';
                    case 'viral_pending':
                    case 'viral_running':
                    case 'idol_pending':
                    case 'idol_running':
                    case 'image_generating': return '🖼️';
                    case 'generating': return '🎬';
                    case 'captioning': return '📝';
                    case 'scheduling': return '📤';
                    case 'done': return '✅';
                    case 'failed': return '❌';
                    default: return '•';
                  }
                };

                return (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className={cn('text-[10px] px-1.5 py-0.5 rounded truncate', getStatusStyle(item))}
                        title={item.status}
                      >
                        {getStatusIcon(item)} {getLocalTime(item.scheduled_time)}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          );
          })}
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('calendar.delete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('calendar.deleteMultiConfirm', {
                count: deletableSelectedItems.length,
                days: selectedDates.size,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteSelected}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {confirmDialog}
    </div>
  );
};

export default ScheduleCalendar;
