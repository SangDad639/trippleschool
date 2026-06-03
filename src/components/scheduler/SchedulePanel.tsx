import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Clock,
  Sparkles,
  AlertCircle,
  Loader2,
  Check,
  Bot,
  Zap,
  Send,
  X,
  GripVertical,
  Play,
  Video,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Activity,
  Trash2,
  RefreshCw,
  Square
} from 'lucide-react';
import { useScheduler } from '@/contexts/SchedulerContext';
import type { SchedulerChannel, ScheduleQueueItem } from '@/types/scheduler';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

interface SchedulePanelProps {
  channel: SchedulerChannel;
  onGenerate: (items: Array<{
    channel_id: number;
    scheduled_time: string;
    prompt: string;
    variable_values: Record<string, string>;
  }>) => Promise<void>;
}

type VideoStatus = 'empty' | 'ready' | 'generating' | 'completed' | 'error';

interface ScheduleItem {
  id: string;
  date: string;
  dateDisplay: string;
  time: string;
  prompt: string;
  isGenerating: boolean;
  isGenerated: boolean;
  videoStatus: VideoStatus;
  selected: boolean;
  queueItemId?: number;  // Link to queue item
}

interface ActivityLog {
  id: number;
  message: string;
  log_type: 'info' | 'success' | 'warning' | 'error';
  created_at: string;
}

// Generate time slots evenly distributed throughout the day (00:00 - 23:00)
const generateTimeSlots = (count: number): string[] => {
  const slots: string[] = [];

  if (count === 1) {
    slots.push('12:00');
  } else if (count >= 24) {
    // If 24 posts, one per hour
    for (let i = 0; i < 24; i++) {
      slots.push(`${i.toString().padStart(2, '0')}:00`);
    }
  } else {
    // Distribute evenly from 00:00 to 23:00
    const interval = 24 / count;
    for (let i = 0; i < count; i++) {
      const hour = Math.floor(i * interval);
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
  }

  return slots;
};

// Hours and minutes arrays
const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

// Scroll Wheel Picker Component
const ScrollWheelPicker: React.FC<{
  values: string[];
  selectedValue: string;
  onChange: (value: string) => void;
}> = ({ values, selectedValue, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedIndex = values.indexOf(selectedValue);

  useEffect(() => {
    if (containerRef.current) {
      const itemHeight = 32;
      containerRef.current.scrollTop = selectedIndex * itemHeight;
    }
  }, [selectedIndex]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const itemHeight = 32;
    const scrollTop = container.scrollTop;
    const newIndex = Math.round(scrollTop / itemHeight);
    const clampedIndex = Math.max(0, Math.min(values.length - 1, newIndex));

    if (values[clampedIndex] !== selectedValue) {
      onChange(values[clampedIndex]);
    }
  };

  return (
    <div className="relative h-[96px] w-12 overflow-hidden">
      {/* Gradient overlays */}
      <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-zinc-900 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-zinc-900 to-transparent z-10 pointer-events-none" />

      {/* Selection highlight */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-8 bg-indigo-600 rounded-lg z-0" />

      {/* Scrollable container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto scrollbar-hide snap-y snap-mandatory"
        style={{ scrollSnapType: 'y mandatory', paddingTop: '32px', paddingBottom: '32px' }}
      >
        {values.map((value, index) => (
          <div
            key={value}
            onClick={() => onChange(value)}
            className={cn(
              "h-8 flex items-center justify-center cursor-pointer snap-center transition-all duration-150",
              value === selectedValue
                ? "text-white font-bold text-lg"
                : "text-zinc-500 text-sm hover:text-zinc-300"
            )}
          >
            {value}
          </div>
        ))}
      </div>
    </div>
  );
};

// Time Picker with scroll wheels
const ScrollTimePicker: React.FC<{
  time: string;
  onChange: (time: string) => void;
  onRemove?: () => void;
  canRemove?: boolean;
}> = ({ time, onChange, onRemove, canRemove }) => {
  const [hour, minute] = time.split(':');

  return (
    <div className="group relative bg-zinc-900 rounded-xl border border-zinc-800 hover:border-indigo-500/50 transition-all shadow-lg">
      <div className="flex items-center p-2">
        <GripVertical className="h-4 w-4 text-zinc-600 mr-1" />

        <div className="flex items-center gap-1 bg-zinc-800/50 rounded-lg p-1">
          <ScrollWheelPicker
            values={HOURS}
            selectedValue={hour}
            onChange={(h) => onChange(`${h}:${minute}`)}
          />
          <span className="text-zinc-400 text-xl font-light px-1">:</span>
          <ScrollWheelPicker
            values={MINUTES}
            selectedValue={minute}
            onChange={(m) => onChange(`${hour}:${m}`)}
          />
        </div>

        {canRemove && (
          <button
            onClick={onRemove}
            className="ml-2 w-6 h-6 rounded-full bg-zinc-800 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 flex items-center justify-center transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
};

// Simple compact time display with click to edit
const CompactTimePicker: React.FC<{
  time: string;
  onChange: (time: string) => void;
  onRemove?: () => void;
  canRemove?: boolean;
}> = ({ time, onChange, onRemove, canRemove }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hour, minute] = time.split(':');

  return (
    <div className="relative">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "group flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all",
          isOpen
            ? "bg-indigo-500/10 border-indigo-500/50"
            : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
        )}
      >
        <GripVertical className="h-4 w-4 text-zinc-600" />
        <span className="text-lg font-bold text-white tabular-nums">{time}</span>

        {canRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove?.();
            }}
            className="ml-1 w-5 h-5 rounded-full bg-zinc-800 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 z-50 bg-zinc-900 rounded-xl border border-zinc-800 shadow-2xl p-3">
          <div className="flex items-center gap-2">
            <ScrollWheelPicker
              values={HOURS}
              selectedValue={hour}
              onChange={(h) => onChange(`${h}:${minute}`)}
            />
            <span className="text-zinc-400 text-2xl font-light">:</span>
            <ScrollWheelPicker
              values={MINUTES}
              selectedValue={minute}
              onChange={(m) => onChange(`${hour}:${m}`)}
            />
          </div>
          <Button
            size="sm"
            onClick={() => setIsOpen(false)}
            className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700"
          >
            Done
          </Button>
        </div>
      )}
    </div>
  );
};

export const SchedulePanel: React.FC<SchedulePanelProps> = ({
  channel,
  onGenerate,
}) => {
  const { selectedDates, setSelectedDates, fetchQueue, queueItems, updateChannel, deleteQueueItem, retryQueueItem, stopQueueRunner } = useScheduler();
  const { t } = useLanguage();
  const [postsPerDay, setPostsPerDay] = useState(channel.posts_per_day || 3);
  const [timeSlots, setTimeSlots] = useState<string[]>(() => {
    // Use channel.time_slots if available, otherwise generate default slots
    return channel.time_slots && channel.time_slots.length > 0
      ? channel.time_slots
      : generateTimeSlots(channel.posts_per_day || 3);
  });
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  const [stoppingQueue, setStoppingQueue] = useState(false);
  // Track previous channel ID to detect channel changes
  const prevChannelId = useRef(channel.id);
  // Track if settings have been initialized (to skip first save on mount)
  const settingsInitialized = useRef(false);
  const settingsSaveTimer = useRef<NodeJS.Timeout | null>(null);
  // Ref to avoid updateChannel in effect deps (prevents infinite save loop)
  const updateChannelRef = useRef(updateChannel);
  updateChannelRef.current = updateChannel;

  // Sync state with channel when channel changes
  useEffect(() => {
    if (prevChannelId.current !== channel.id) {
      console.log(`🔄 Channel changed from ${prevChannelId.current} to ${channel.id}, syncing settings...`);
      prevChannelId.current = channel.id;
      settingsInitialized.current = false; // Reset to skip saving on channel change

      const newPostsPerDay = channel.posts_per_day || 3;
      const newTimeSlots = channel.time_slots && channel.time_slots.length > 0
        ? channel.time_slots
        : generateTimeSlots(newPostsPerDay);

      setPostsPerDay(newPostsPerDay);
      setTimeSlots(newTimeSlots);
      console.log(`✅ Synced: posts_per_day=${newPostsPerDay}, time_slots=[${newTimeSlots.join(', ')}]`);
    }
  }, [channel.id, channel.posts_per_day, channel.time_slots]);

  // Expand/Collapse state for logs
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  // Expand/Collapse state for prompts
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  const [itemLogs, setItemLogs] = useState<Record<number, ActivityLog[]>>({});
  const [loadingLogs, setLoadingLogs] = useState<Set<number>>(new Set());

  // Draft auto-save debounce ref
  const draftSaveTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  // Cache for loaded drafts to apply after scheduleItems are ready
  const loadedDraftsCache = useRef<Map<string, { prompt: string; is_ai_generated: boolean }> | null>(null);

  // Check if channel uses AI Prompt System
  const hasAISystem = channel.prompt_mode === 'ai' && !!channel.system_prompt;

  // Check if channel uses Variable System
  const isVariableMode = channel.prompt_mode === 'variable';
  const hasVariableSystem = isVariableMode && channel.prompt_template && (channel.variables?.length || 0) > 0;

  // Check if channel has any prompt system configured
  const hasPromptSystem = hasAISystem || hasVariableSystem;

  // Check if queue has active items (generating/captioning/scheduling) — lock settings while active
  // Only count items updated within last 15 min to avoid false positives from orphaned items
  const isRecentlyActive = (qi: ScheduleQueueItem) =>
    qi.channel_id === channel.id &&
    ['generating', 'captioning', 'scheduling'].includes(qi.status) &&
    (Date.now() - new Date(qi.updated_at).getTime()) < 15 * 60 * 1000;
  const queueBusy = queueItems.some(isRecentlyActive);

  // Persist updated variables back to the database
  const persistVariables = useCallback(async () => {
    if (!channel.variables?.length) return;
    try {
      await api.updateChannelVariables(channel.id, channel.variables);
    } catch (error) {
      console.error('Failed to persist variable status:', error);
    }
  }, [channel.id, channel.variables]);

  // Generate prompt from template + variables (for variable mode)
  const generateVariablePrompt = useCallback((): { prompt: string; usedValues: Record<string, string> } | null => {
    if (!channel.prompt_template || !channel.variables?.length) return null;

    let prompt = channel.prompt_template;
    const usedValues: Record<string, string> = {};

    for (const variable of channel.variables) {
      const placeholder = `{${variable.name}}`;
      if (!prompt.includes(placeholder)) continue;

      // Find an unused value
      let newValue = variable.values.find(v => v.status === 'new');

      // If no new values and loop is enabled, reset all to 'new'
      if (!newValue && variable.loop && variable.values.length > 0) {
        console.log(`[Variable] Loop enabled for {${variable.name}}, resetting all ${variable.values.length} values to 'new'`);
        variable.values.forEach(v => v.status = 'new');
        newValue = variable.values.find(v => v.status === 'new');
      }

      if (!newValue) {
        // No unused values left for this variable (loop disabled or empty)
        return null;
      }

      prompt = prompt.replace(new RegExp(`\\{${variable.name}\\}`, 'g'), newValue.value);
      usedValues[variable.name] = newValue.value;

      // Mark as used locally
      newValue.status = 'used';
    }

    return { prompt, usedValues };
  }, [channel.prompt_template, channel.variables]);

  // Get effective timezone
  const getEffectiveTimezone = useCallback(() => {
    return channel.timezone === 'local'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : channel.timezone;
  }, [channel.timezone]);

  // Extract local date and time from a queue item's scheduled_time (ISO string)
  const extractLocalDateTime = useCallback((isoString: string): { date: string; time: string } => {
    const tz = getEffectiveTimezone();
    const d = new Date(isoString);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
    const timeStr = d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }); // HH:MM
    return { date: dateStr, time: timeStr };
  }, [getEffectiveTimezone]);

  // Create scheduled_time ISO string in channel's timezone
  // dateStr: "YYYY-MM-DD", timeStr: "HH:MM"
  const createScheduledTimeISO = useCallback((dateStr: string, timeStr: string): string => {
    const tz = getEffectiveTimezone();
    const [hour, minute] = timeStr.split(':').map(Number);

    // Create a date at the specified time in the channel's timezone
    // We do this by creating a reference point and calculating the offset
    const targetDateTimeStr = `${dateStr}T${timeStr}:00`;

    // Get current offset for the channel timezone at this datetime
    // Format a date string that includes the timezone info
    const tempDate = new Date(targetDateTimeStr);

    // Use toLocaleString to get the date parts in the target timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    // Find the UTC time that corresponds to the desired local time in channel timezone
    // We do this by adjusting based on the timezone difference
    const parts = formatter.formatToParts(tempDate);
    const tzYear = parseInt(parts.find(p => p.type === 'year')?.value || '');
    const tzMonth = parseInt(parts.find(p => p.type === 'month')?.value || '');
    const tzDay = parseInt(parts.find(p => p.type === 'day')?.value || '');
    const tzHour = parseInt(parts.find(p => p.type === 'hour')?.value || '');
    const tzMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '');

    // Calculate the difference between what we want and what we got
    const wantYear = parseInt(dateStr.split('-')[0]);
    const wantMonth = parseInt(dateStr.split('-')[1]);
    const wantDay = parseInt(dateStr.split('-')[2]);

    // Calculate adjustment needed
    const wantMs = new Date(wantYear, wantMonth - 1, wantDay, hour, minute).getTime();
    const gotMs = new Date(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute).getTime();
    const diffMs = wantMs - gotMs;

    // Apply adjustment to get correct UTC time
    const correctedDate = new Date(tempDate.getTime() + diffMs);
    const isoString = correctedDate.toISOString();

    // Validate the ISO string doesn't contain 'undefined'
    if (isoString.includes('undefined') || isoString.includes('NaN')) {
      console.error(`[createScheduledTimeISO] Invalid ISO string: ${isoString}, dateStr=${dateStr}, timeStr=${timeStr}`);
      // Fallback: create simple ISO string
      return `${dateStr}T${timeStr}:00.000Z`;
    }

    return isoString;
  }, [getEffectiveTimezone]);

  // Live clock for channel timezone
  useEffect(() => {
    const updateTime = () => {
      const tz = channel.timezone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : channel.timezone;
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      setCurrentTime(timeStr);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [channel.timezone]);

  // Update time slots when posts per day changes
  useEffect(() => {
    const newTimeSlots = generateTimeSlots(postsPerDay);
    setTimeSlots(newTimeSlots);
  }, [postsPerDay]);

  // Fetch queue items when channel changes
  useEffect(() => {
    fetchQueue({ channel_id: channel.id });
  }, [channel.id, fetchQueue]);

  // Load drafts from database when channel or selected dates change
  useEffect(() => {
    // Don't load if no dates selected yet
    if (selectedDates.size === 0) {
      setDraftsLoaded(true);
      loadedDraftsCache.current = null;
      return;
    }

    const loadDrafts = async () => {
      try {
        setDraftsLoaded(false);
        const { drafts } = await api.getSchedulerDrafts(channel.id);
        console.log(`📝 Fetched ${drafts.length} drafts from database for channel ${channel.id}`);

        if (drafts.length > 0) {
          // Store drafts in cache for later use
          // Normalize date to YYYY-MM-DD format (handles "2026-01-28T00:00:00.000Z" → "2026-01-28")
          // Build the Map with an explicit tuple type so TS doesn't widen the
          // entry pairs to `(string | { ... })[]` and lose the key/value shape.
          const draftMap = new Map<string, { prompt: string; is_ai_generated: boolean }>(
            drafts.map((d): [string, { prompt: string; is_ai_generated: boolean }] => {
              const normalizedDate = d.scheduled_date.split('T')[0];
              const key = `${normalizedDate}-${d.time_slot}`;
              console.log(`📝 Draft cache key: ${key} → prompt: "${d.prompt.substring(0, 30)}..."`);
              return [key, { prompt: d.prompt, is_ai_generated: d.is_ai_generated }];
            })
          );
          loadedDraftsCache.current = draftMap;
          console.log(`📝 Cached ${draftMap.size} drafts with keys:`, Array.from(draftMap.keys()));
        } else {
          loadedDraftsCache.current = null;
        }
      } catch (error) {
        console.error('Failed to load drafts:', error);
        loadedDraftsCache.current = null;
      } finally {
        setDraftsLoaded(true);
      }
    };

    loadDrafts();
  }, [channel.id, selectedDates.size]);

  // Note: Draft application is now integrated into the scheduleItems creation effect above
  // This ensures drafts are applied when items are created, not in a separate pass

  // Cleanup draft save timers on unmount
  useEffect(() => {
    return () => {
      Object.values(draftSaveTimers.current).forEach(timer => clearTimeout(timer));
    };
  }, []);

  // Auto-save time_slots and posts_per_day to channel when changed
  useEffect(() => {
    // Skip the first run (initial values from channel)
    if (!settingsInitialized.current) {
      settingsInitialized.current = true;
      return;
    }

    // Debounce save to avoid too many API calls
    if (settingsSaveTimer.current) {
      clearTimeout(settingsSaveTimer.current);
    }

    settingsSaveTimer.current = setTimeout(async () => {
      try {
        await updateChannelRef.current(channel.id, {
          posts_per_day: postsPerDay,
          time_slots: timeSlots,
        });
      } catch (error) {
        console.error('❌ Failed to save channel settings:', error);
      }
    }, 1000);

    return () => {
      if (settingsSaveTimer.current) {
        clearTimeout(settingsSaveTimer.current);
      }
    };
  }, [postsPerDay, timeSlots, channel.id]);

  // Auto-refresh queue items every 3 seconds while there are active items
  const prevHadActive = useRef(false);
  useEffect(() => {
    const hasActiveItems = queueItems.some(qi =>
      qi.channel_id === channel.id &&
      !['done'].includes(qi.status)
    );

    // When items transition from active → all done, do one final fetch to confirm
    if (prevHadActive.current && !hasActiveItems) {
      prevHadActive.current = false;
      setTimeout(() => fetchQueue({ channel_id: channel.id }), 500);
      return;
    }
    prevHadActive.current = hasActiveItems;

    if (!hasActiveItems) return;

    const interval = setInterval(() => {
      fetchQueue({ channel_id: channel.id });
    }, 3000);

    return () => clearInterval(interval);
  }, [queueItems, channel.id, fetchQueue]);

  // Reset stoppingQueue when no more active items
  useEffect(() => {
    if (!stoppingQueue) return;
    if (!queueItems.some(isRecentlyActive)) {
      setStoppingQueue(false);
    }
  }, [queueItems, channel.id, stoppingQueue]);

  // Helper function to check if a time slot has passed for today
  const isTimePassed = (dateStr: string, timeStr: string): boolean => {
    const tz = channel.timezone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : channel.timezone;
    const now = new Date();

    // Get today's date in the channel timezone
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD format

    // Only filter for today's date
    if (dateStr !== todayStr) {
      return false;
    }

    // Get current time in channel timezone
    const currentHour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));
    const currentMinute = parseInt(now.toLocaleString('en-US', { timeZone: tz, minute: '2-digit' }));

    const [slotHour, slotMinute] = timeStr.split(':').map(Number);

    // Check if slot time has passed
    if (slotHour < currentHour) return true;
    if (slotHour === currentHour && slotMinute <= currentMinute) return true;

    return false;
  };

  // Update schedule items when time slots or dates change
  // Also restore data from queueItems and drafts if available
  useEffect(() => {
    // Get drafts from cache (if loaded)
    const draftMap = loadedDraftsCache.current;
    if (draftMap && draftMap.size > 0) {
      console.log(`📝 [scheduleItems effect] Found ${draftMap.size} cached drafts to apply`);
    }

    setScheduleItems(prev => {
      const sortedDates = Array.from(selectedDates).sort();
      const items: ScheduleItem[] = [];

      for (const dateStr of sortedDates) {
        const date = new Date(dateStr);
        const dayNames = [t('calendar.dayNamesSun'), t('calendar.dayNamesMon'), t('calendar.dayNamesTue'), t('calendar.dayNamesWed'), t('calendar.dayNamesThu'), t('calendar.dayNamesFri'), t('calendar.dayNamesSat')];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dayName = dayNames[date.getDay()];
        const monthName = monthNames[date.getMonth()];
        const dayNum = date.getDate();

        let validSlotIndex = 0;
        for (let i = 0; i < timeSlots.length; i++) {
          const time = timeSlots[i];

          // Skip time slots that have already passed for today
          if (isTimePassed(dateStr, time)) {
            continue;
          }

          // Find ALL matching queue items for this time slot (supports duplicates)
          const scheduledTimeISO = createScheduledTimeISO(dateStr, time);
          const targetTime = new Date(scheduledTimeISO).getTime();
          const matchingQueueItems = queueItems.filter(qi => {
            if (qi.channel_id !== channel.id) return false;
            try {
              let qiTime = qi.scheduled_time;
              if (typeof qiTime === 'string') {
                qiTime = qiTime.replace('.undefinedZ', '.000Z').replace('undefined', '');
              }
              if (new Date(qiTime).getTime() === targetTime) return true;
              // Fallback: match by date + time string
              const { date: qiDate, time: qiTimeStr } = extractLocalDateTime(qi.scheduled_time);
              return qiDate === dateStr && qiTimeStr === time;
            } catch {
              return false;
            }
          });

          // Check for draft from database
          const draftKey = `${dateStr}-${time}`;
          const draft = draftMap?.get(draftKey);

          // Create schedule items for existing queue items
          for (const qi of matchingQueueItems) {
            let videoStatus: VideoStatus = 'ready';
            if (qi.status === 'done') videoStatus = 'completed';
            else if (qi.status === 'generating' || qi.status === 'captioning') videoStatus = 'generating';
            else if (qi.status === 'failed') videoStatus = 'error';

            items.push({
              id: `${dateStr}-${time}-${i}-q${qi.id}`,
              date: dateStr,
              dateDisplay: `${dayName}, ${monthName} ${dayNum}`,
              time: time,
              prompt: qi.prompt || '',
              isGenerating: qi.status === 'generating' || qi.status === 'captioning',
              isGenerated: false,
              videoStatus,
              selected: false,
              queueItemId: qi.id,
            });
          }

          // Only create empty slot if there are NO queue items for this time slot
          // User must use "+ Add Task" button to add new items at existing times
          if (matchingQueueItems.length === 0) {
            const existingItem = prev.find(item => item.date === dateStr && item.time === time && !item.queueItemId);

            let prompt = '';
            let isGenerated = false;
            if (existingItem?.prompt) {
              prompt = existingItem.prompt;
              isGenerated = existingItem.isGenerated;
            } else if (draft) {
              prompt = draft.prompt;
              isGenerated = draft.is_ai_generated;
              console.log(`✅ [scheduleItems] Applied draft for ${draftKey}`);
            }

            const videoStatus: VideoStatus = prompt ? 'ready' : 'empty';

            items.push({
              id: `${dateStr}-${time}-${i}`,
              date: dateStr,
              dateDisplay: `${dayName}, ${monthName} ${dayNum}`,
              time: time,
              prompt,
              isGenerating: existingItem?.isGenerating || false,
              isGenerated,
              videoStatus,
              selected: existingItem?.selected || false,
              queueItemId: undefined,
            });
          }

          validSlotIndex++;
        }

        // Add orphaned queue items for this date (items with times not in current timeSlots)
        // These are queue items that exist but their time is not in the current Post Times
        const orphanedQueueItems = queueItems.filter(qi => {
          if (qi.channel_id !== channel.id) return false;
          const { date: qiDate } = extractLocalDateTime(qi.scheduled_time);
          if (qiDate !== dateStr) return false;
          // Check if already matched to a schedule item
          const alreadyMatched = items.some(item => item.queueItemId === qi.id);
          return !alreadyMatched;
        });

        for (const qi of orphanedQueueItems) {
          const { time: qiTime } = extractLocalDateTime(qi.scheduled_time);

          // Determine video status from queue item
          let videoStatus: VideoStatus = 'ready';
          if (qi.status === 'done') videoStatus = 'completed';
          else if (qi.status === 'generating' || qi.status === 'captioning') videoStatus = 'generating';
          else if (qi.status === 'failed') videoStatus = 'error';

          // Add as a new item (don't overwrite empty slots)
          items.push({
            id: `${dateStr}-${qiTime}-orphan-${qi.id}`,
            date: dateStr,
            dateDisplay: `${dayName}, ${monthName} ${dayNum}`,
            time: qiTime,
            prompt: qi.prompt || '',
            isGenerating: qi.status === 'generating' || qi.status === 'captioning',
            isGenerated: false,
            videoStatus,
            selected: false,
            queueItemId: qi.id,
          });
        }
      }

      // Sort items by date and time
      items.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.time.localeCompare(b.time);
      });

      // Clear draft cache after applying
      if (draftMap && draftMap.size > 0) {
        loadedDraftsCache.current = null;
        console.log(`📝 [scheduleItems] Cleared draft cache after applying`);
      }

      return items;
    });
  }, [timeSlots, selectedDates, channel.timezone, queueItems, channel.id, createScheduledTimeISO, extractLocalDateTime, draftsLoaded]);

  // Filter out past time slots for today (at render time)
  const filteredScheduleItems = useMemo(() => {
    const tz = channel.timezone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : channel.timezone;
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });
    const currentHour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));
    const currentMinute = parseInt(now.toLocaleString('en-US', { timeZone: tz, minute: '2-digit' }));

    return scheduleItems.filter(item => {
      // Keep items that are not for today
      if (item.date !== todayStr) {
        return true;
      }

      // Keep items that already have a queue item (in progress or completed)
      if (item.queueItemId) {
        return true;
      }

      // For empty slots: keep if the time is in the configured timeSlots
      // This allows adding new items at any configured time, even if past
      if (timeSlots.includes(item.time)) {
        return true;
      }

      // Filter out past time slots that are not in timeSlots (orphaned empty slots)
      const [slotHour, slotMinute] = item.time.split(':').map(Number);
      if (slotHour < currentHour) {
        return false;
      }
      if (slotHour === currentHour && slotMinute <= currentMinute) {
        return false;
      }

      return true;
    });
  }, [scheduleItems, currentTime, channel.timezone, timeSlots]);

  // Group filtered items by date
  const itemsByDate = useMemo(() => {
    const grouped: Record<string, ScheduleItem[]> = {};
    for (const item of filteredScheduleItems) {
      if (!grouped[item.date]) {
        grouped[item.date] = [];
      }
      grouped[item.date].push(item);
    }
    return grouped;
  }, [filteredScheduleItems]);

  // Calculate stats (using filtered items, excluding items already in queue)
  const newItems = filteredScheduleItems.filter(item => !item.queueItemId);
  const newSlots = newItems.length;
  const filledSlots = newItems.filter(item => item.prompt.trim()).length;
  const selectedCount = filteredScheduleItems.filter(item => item.selected && !item.queueItemId).length;
  const readyToGenerate = filteredScheduleItems.filter(item => item.prompt.trim() && item.videoStatus === 'ready').length;
  const aiGeneratedSlots = filteredScheduleItems.filter(item => item.isGenerated).length;
  const emptySlots = newSlots - filledSlots;
  const canGenerate = filledSlots === newSlots && newSlots > 0;

  // Sync status updates for items that already have queueItemId
  useEffect(() => {
    if (!queueItems.length) return;

    setScheduleItems(prev => prev.map(item => {
      // Only update items that already have a queueItemId
      if (!item.queueItemId) return item;

      const matchingQueueItem = queueItems.find(qi => qi.id === item.queueItemId);
      if (!matchingQueueItem) return item;

      // Update status from queue item
      let videoStatus: VideoStatus = item.videoStatus;
      if (matchingQueueItem.status === 'done') videoStatus = 'completed';
      else if (matchingQueueItem.status === 'generating' || matchingQueueItem.status === 'captioning') videoStatus = 'generating';
      else if (matchingQueueItem.status === 'failed') videoStatus = 'error';
      else if (matchingQueueItem.status === 'pending') videoStatus = 'ready';

      return {
        ...item,
        videoStatus,
        isGenerating: matchingQueueItem.status === 'generating' || matchingQueueItem.status === 'captioning',
      };
    }));
  }, [queueItems]);

  // Find matching queue item for a schedule item
  const findQueueItem = useCallback((dateStr: string, timeStr: string): ScheduleQueueItem | undefined => {
    if (!dateStr || !timeStr || !queueItems.length) return undefined;

    try {
      // Use channel timezone to create the scheduled time ISO string
      const scheduledTimeISO = createScheduledTimeISO(dateStr, timeStr);
      const targetTime = new Date(scheduledTimeISO).getTime();

      // Try exact match first
      let found = queueItems.find(qi => {
        if (qi.channel_id !== channel.id) return false;
        return new Date(qi.scheduled_time).getTime() === targetTime;
      });

      // If not found, try matching by date and hour (more lenient)
      if (!found) {
        found = queueItems.find(qi => {
          if (qi.channel_id !== channel.id) return false;
          try {
            // Fix malformed scheduled_time before parsing
            let scheduledTimeStr = qi.scheduled_time;
            if (typeof scheduledTimeStr === 'string') {
              scheduledTimeStr = scheduledTimeStr.replace('.undefinedZ', '.000Z').replace('undefined', '');
            }
            const qiDate = new Date(scheduledTimeStr);
            const targetDate = new Date(scheduledTimeISO);
            // Check if dates are valid
            if (isNaN(qiDate.getTime()) || isNaN(targetDate.getTime())) {
              return false;
            }
            // Match by date string (YYYY-MM-DD) and hour:minute
            const qiDateStr = qiDate.toISOString().slice(0, 10);
            const targetDateStr = targetDate.toISOString().slice(0, 10);
            const qiTimeStr = qiDate.toISOString().slice(11, 16);
            const targetTimeStr = targetDate.toISOString().slice(11, 16);
            return qiDateStr === targetDateStr && qiTimeStr === targetTimeStr;
          } catch {
            return false;
          }
        });
      }

      // Debug: log if we have queue items but couldn't find a match
      if (!found && queueItems.filter(qi => qi.channel_id === channel.id).length > 0) {
        console.log(`[findQueueItem] No match for ${dateStr} ${timeStr}. Target: ${scheduledTimeISO}. Queue items:`,
          queueItems.filter(qi => qi.channel_id === channel.id).map(qi => ({
            id: qi.id,
            scheduled_time: qi.scheduled_time,
            status: qi.status
          }))
        );
      }

      return found;
    } catch (e) {
      console.error('[findQueueItem] Error:', e);
      return undefined;
    }
  }, [queueItems, channel.id, createScheduledTimeISO]);

  // Toggle expand/collapse for an item
  const toggleExpand = useCallback(async (itemId: string, queueItemId?: number) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
        // Fetch logs if we have a queue item ID and haven't loaded yet
        if (queueItemId && !itemLogs[queueItemId]) {
          fetchLogsForItem(queueItemId);
        }
      }
      return newSet;
    });
  }, [itemLogs]);

  // Fetch logs for a queue item
  const fetchLogsForItem = useCallback(async (queueItemId: number) => {
    if (loadingLogs.has(queueItemId)) return;

    setLoadingLogs(prev => new Set(prev).add(queueItemId));
    try {
      const logs = await api.getQueueItemLogs(queueItemId);
      setItemLogs(prev => ({ ...prev, [queueItemId]: logs }));
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoadingLogs(prev => {
        const newSet = new Set(prev);
        newSet.delete(queueItemId);
        return newSet;
      });
    }
  }, [loadingLogs]);

  // Track which queue item IDs have already been auto-expanded (to avoid re-expanding after user collapses)
  const autoExpandedRef = React.useRef<Set<number>>(new Set());

  // Auto-expand active queue items only once (when they first become active)
  useEffect(() => {
    const activeItems = queueItems.filter(qi =>
      qi.channel_id === channel.id &&
      ['generating', 'captioning', 'scheduling'].includes(qi.status)
    );

    if (activeItems.length === 0) return;

    const itemIdsToExpand: string[] = [];
    for (const qi of activeItems) {
      // Skip if already auto-expanded before
      if (autoExpandedRef.current.has(qi.id)) continue;
      const matchItem = scheduleItems.find(si => si.queueItemId === qi.id);
      if (matchItem) {
        itemIdsToExpand.push(matchItem.id);
        autoExpandedRef.current.add(qi.id);
      }
    }

    if (itemIdsToExpand.length > 0) {
      setExpandedItems(prev => {
        const newSet = new Set(prev);
        itemIdsToExpand.forEach(id => newSet.add(id));
        return newSet;
      });
    }
  }, [queueItems, channel.id, scheduleItems]);

  // Auto-fetch and refresh logs for active queue items (including failed ones)
  useEffect(() => {
    // Find all active queue items for this channel (including failed - need to show error logs!)
    const activeQueueIds = queueItems
      .filter(qi =>
        qi.channel_id === channel.id &&
        ['generating', 'captioning', 'scheduling', 'failed'].includes(qi.status)
      )
      .map(qi => qi.id);

    if (activeQueueIds.length === 0) return;

    // Initial fetch for any that don't have logs yet
    activeQueueIds.forEach(id => {
      if (!itemLogs[id]) {
        fetchLogsForItem(id);
      }
    });

    // Refresh logs every 3 seconds for active items (including pending for retry)
    const refreshableIds = queueItems
      .filter(qi =>
        qi.channel_id === channel.id &&
        ['pending', 'generating', 'captioning', 'scheduling'].includes(qi.status)
      )
      .map(qi => qi.id);

    if (refreshableIds.length === 0) return;

    const interval = setInterval(() => {
      refreshableIds.forEach(id => fetchLogsForItem(id));
    }, 3000);

    return () => clearInterval(interval);
  }, [queueItems, channel.id, itemLogs, fetchLogsForItem]);

  const handleTimeChange = (slotIndex: number, value: string) => {
    setTimeSlots(prev => {
      const newSlots = [...prev];
      newSlots[slotIndex] = value;
      return newSlots;
    });
  };

  const addTimeSlot = () => {
    if (timeSlots.length < 24) {
      const lastTime = timeSlots[timeSlots.length - 1] || '12:00';
      const [h] = lastTime.split(':').map(Number);
      const newHour = Math.min(23, h + 1);
      const newTime = `${newHour.toString().padStart(2, '0')}:00`;
      setTimeSlots([...timeSlots, newTime]);
      setPostsPerDay(timeSlots.length + 1);
    }
  };

  const removeTimeSlot = (index: number) => {
    if (timeSlots.length > 1) {
      const newSlots = timeSlots.filter((_, i) => i !== index);
      setTimeSlots(newSlots);
      setPostsPerDay(newSlots.length);
    }
  };

  const handlePromptChange = (id: string, prompt: string) => {
    console.log(`📝 handlePromptChange: id=${id}, scheduleItems.length=${scheduleItems.length}`);

    // Find the item FIRST before updating state
    const item = scheduleItems.find(i => i.id === id);
    console.log(`📝 Found item: ${item ? `date=${item.date}, time=${item.time}` : 'NOT FOUND'}`);

    // Update local state immediately
    setScheduleItems(prev => prev.map(i =>
      i.id === id ? { ...i, prompt, isGenerated: false, videoStatus: prompt.trim() ? 'ready' : 'empty' } : i
    ));

    // Debounced save to database (500ms)
    if (item) {
      // Clear previous timer for this item
      if (draftSaveTimers.current[id]) {
        clearTimeout(draftSaveTimers.current[id]);
      }

      // Set new timer
      draftSaveTimers.current[id] = setTimeout(async () => {
        try {
          console.log(`💾 Saving draft: channel=${channel.id}, date=${item.date}, time=${item.time}`);
          const result = await api.saveSchedulerDraft({
            channel_id: channel.id,
            scheduled_date: item.date,
            time_slot: item.time,
            prompt: prompt.trim(),
            is_ai_generated: false,
          });
          console.log(`✅ Draft saved successfully:`, result);
        } catch (error) {
          console.error('❌ Failed to save draft:', error);
        } finally {
          delete draftSaveTimers.current[id];
        }
      }, 500);
    } else {
      console.warn(`⚠️ Could not find schedule item with id: ${id} - draft NOT saved`);
    }
  };

  const toggleItemSelection = (id: string) => {
    setScheduleItems(prev => prev.map(item =>
      item.id === id ? { ...item, selected: !item.selected } : item
    ));
  };

  const toggleDateSelection = (date: string) => {
    const dateItems = scheduleItems.filter(item => item.date === date);
    const allSelected = dateItems.every(item => item.selected);
    setScheduleItems(prev => prev.map(item =>
      item.date === date ? { ...item, selected: !allSelected } : item
    ));
  };

  const selectAll = () => {
    const allSelected = scheduleItems.every(item => item.selected);
    setScheduleItems(prev => prev.map(item => ({ ...item, selected: !allSelected })));
  };

  const handleVideoGenerate = async (itemId: string) => {
    const item = scheduleItems.find(i => i.id === itemId);
    if (!item) {
      toast.error(t('panel.itemNotFound'));
      return;
    }

    let promptToUse = item.prompt.trim();

    // Auto-generate prompt if empty
    if (!promptToUse) {
      if (isVariableMode && hasVariableSystem) {
        // Variable mode: substitute from template
        const result = generateVariablePrompt();
        if (!result) {
          toast.error(t('panel.noUnusedVars'));
          return;
        }
        promptToUse = result.prompt;
        setScheduleItems(prev => prev.map(i =>
          i.id === itemId ? { ...i, prompt: result.prompt, isGenerated: true, videoStatus: 'ready' } : i
        ));
        await persistVariables();
      } else if (hasAISystem) {
        toast.info(t('panel.generatingAI'));
        try {
          const generatedPrompt = await generatePromptForItem(itemId);
          if (!generatedPrompt) {
            toast.error(t('panel.generateFailed'));
            return;
          }
          promptToUse = generatedPrompt;
        } catch (error: any) {
          toast.error(error?.message || t('panel.generateFailed'));
          return;
        }
      } else {
        toast.error(t('panel.noPromptSystem'));
        return;
      }
    }

    setScheduleItems(prev => prev.map(i =>
      i.id === itemId ? { ...i, videoStatus: 'generating' } : i
    ));

    try {
      // Create queue item and trigger generation (use channel timezone)
      const scheduledTime = createScheduledTimeISO(item.date, item.time);

      const itemsToQueue = [{
        channel_id: channel.id,
        scheduled_time: scheduledTime,
        prompt: promptToUse,
        variable_values: {},
      }];

      await onGenerate(itemsToQueue);
      toast.success(t('panel.videoQueued'));

      // Fetch queue and use returned items immediately (now item is created)
      const freshQueueItems = await fetchQueue({ channel_id: channel.id });
      const targetTime = new Date(scheduledTime).getTime();
      let newQueueItem = freshQueueItems.find(qi =>
        qi.channel_id === channel.id &&
        new Date(qi.scheduled_time).getTime() === targetTime
      );
      // Fallback: match by local date+time
      if (!newQueueItem) {
        newQueueItem = freshQueueItems.find(qi => {
          if (qi.channel_id !== channel.id) return false;
          try {
            const { date: qiDate, time: qiTimeStr } = extractLocalDateTime(qi.scheduled_time);
            return qiDate === item.date && qiTimeStr === item.time;
          } catch { return false; }
        });
      }

      if (newQueueItem) {
        setScheduleItems(prev => prev.map(i =>
          i.id === itemId ? { ...i, queueItemId: newQueueItem.id } : i
        ));
        // Auto-expand and fetch logs for the new item
        setExpandedItems(prev => new Set(prev).add(itemId));
        fetchLogsForItem(newQueueItem.id);

        // Delete draft from database (now in queue)
        try {
          await api.deleteSchedulerDraft(channel.id, item.date, item.time);
        } catch (deleteError) {
          console.error('Failed to delete draft after queue creation:', deleteError);
        }
      }
    } catch (error: any) {
      setScheduleItems(prev => prev.map(i =>
        i.id === itemId ? { ...i, videoStatus: 'error' } : i
      ));
      toast.error(error?.message || t('panel.startFailed'));
    }
  };

  const handleBatchGenerate = async () => {
    const selectedItems = scheduleItems.filter(item => item.selected && !item.queueItemId);
    if (selectedItems.length === 0) {
      toast.error(t('panel.alreadyInCalendar'));
      return;
    }

    // Check for empty prompts in selected items
    const emptySelectedItems = selectedItems.filter(item => !item.prompt.trim());
    const generatedPrompts: Record<string, string> = {};

    // Auto-generate prompts for empty selected items
    if (emptySelectedItems.length > 0) {
      if (isVariableMode && hasVariableSystem) {
        // Variable mode: generate from template
        for (const item of emptySelectedItems) {
          const result = generateVariablePrompt();
          if (result) {
            generatedPrompts[item.id] = result.prompt;
            setScheduleItems(prev => prev.map(i =>
              i.id === item.id ? { ...i, prompt: result.prompt, isGenerated: true, videoStatus: 'ready' } : i
            ));
          } else {
            toast.error(t('panel.noUnusedVarsEnough'));
            return;
          }
        }
        await persistVariables();
      } else if (hasAISystem) {
        toast.info(t('panel.generatingBatch', { count: emptySelectedItems.length, credits: emptySelectedItems.length * 5 }));

        for (const item of emptySelectedItems) {
          try {
            const prompt = await generatePromptForItem(item.id);
            if (prompt) {
              generatedPrompts[item.id] = prompt;
            }
          } catch (error: any) {
            toast.error(t('panel.batchGenerateFailed', { error: error?.message }));
            return;
          }
        }
      } else {
        toast.error(t('panel.fillPromptsSelected'));
        return;
      }
    }

    // Mark selected items as generating
    setScheduleItems(prev => prev.map(item =>
      item.selected ? { ...item, videoStatus: 'generating' } : item
    ));

    try {
      const itemsToQueue = selectedItems.map(item => {
        // Use generated prompt if available, otherwise use existing prompt
        const prompt = generatedPrompts[item.id] || item.prompt;

        return {
          channel_id: channel.id,
          scheduled_time: createScheduledTimeISO(item.date, item.time),
          prompt,
          variable_values: {},
        };
      });

      await onGenerate(itemsToQueue);
      toast.success(t('panel.batchQueued', { count: selectedItems.length }));

      // Fetch queue and use returned items to sync queueItemIds immediately
      const freshQueueItems = await fetchQueue({ channel_id: channel.id });

      // Map the new queue items to schedule items
      setScheduleItems(prev => prev.map(item => {
        if (!item.selected) return { ...item };

        // Find matching queue item using channel timezone
        const scheduledTime = createScheduledTimeISO(item.date, item.time);
        const targetTime = new Date(scheduledTime).getTime();

        let matchingQueueItem = freshQueueItems.find(qi =>
          qi.channel_id === channel.id &&
          new Date(qi.scheduled_time).getTime() === targetTime
        );
        // Fallback: match by local date+time
        if (!matchingQueueItem) {
          matchingQueueItem = freshQueueItems.find(qi => {
            if (qi.channel_id !== channel.id) return false;
            try {
              const { date: qiDate, time: qiTimeStr } = extractLocalDateTime(qi.scheduled_time);
              return qiDate === item.date && qiTimeStr === item.time;
            } catch { return false; }
          });
        }

        return {
          ...item,
          selected: false,
          queueItemId: matchingQueueItem?.id,
        };
      }));

      // Delete drafts from database (now in queue)
      for (const item of selectedItems) {
        try {
          await api.deleteSchedulerDraft(channel.id, item.date, item.time);
        } catch (deleteError) {
          console.error('Failed to delete draft after queue creation:', deleteError);
        }
      }

      // Remove added dates from selection so items disappear from panel
      const addedDates = new Set(selectedItems.map(item => item.date));
      const remaining = new Set<string>();
      selectedDates.forEach(d => { if (!addedDates.has(d)) remaining.add(d); });
      setSelectedDates(remaining);
    } catch (error: any) {
      setScheduleItems(prev => prev.map(item =>
        item.selected ? { ...item, videoStatus: 'error' } : item
      ));
      toast.error(error?.message || t('panel.batchStartFailed'));
    }
  };

  // Generate prompt and return the value (for auto-fill use)
  const generatePromptForItem = async (itemId: string): Promise<string | null> => {
    if (!hasAISystem || !channel.example_prompts?.length) {
      return null;
    }

    const item = scheduleItems.find(i => i.id === itemId);
    if (!item) return null;

    setScheduleItems(prev => prev.map(i =>
      i.id === itemId ? { ...i, isGenerating: true } : i
    ));

    try {
      const result = await api.generateChannelInspiredPrompt(
        channel.id,
        channel.example_prompts![Math.floor(Math.random() * channel.example_prompts!.length)].id
      );

      setScheduleItems(prev => prev.map(i =>
        i.id === itemId ? {
          ...i,
          prompt: result.generated_prompt,
          isGenerating: false,
          isGenerated: true,
          videoStatus: 'ready',
        } : i
      ));

      // Save AI-generated prompt to database
      try {
        await api.saveSchedulerDraft({
          channel_id: channel.id,
          scheduled_date: item.date,
          time_slot: item.time,
          prompt: result.generated_prompt,
          is_ai_generated: true,
        });
      } catch (saveError) {
        console.error('Failed to save AI-generated draft:', saveError);
      }

      return result.generated_prompt;
    } catch (error: any) {
      setScheduleItems(prev => prev.map(i =>
        i.id === itemId ? { ...i, isGenerating: false } : i
      ));
      throw error;
    }
  };

  const handleAIGenerate = async (itemId: string) => {
    if (isVariableMode && hasVariableSystem) {
      // Variable mode: generate from template
      const result = generateVariablePrompt();
      if (!result) {
        toast.error(t('panel.noUnusedVars'));
        return;
      }
      setScheduleItems(prev => prev.map(i =>
        i.id === itemId ? { ...i, prompt: result.prompt, isGenerated: true, videoStatus: 'ready' } : i
      ));
      await persistVariables();
      toast.success(t('panel.promptFromVar'));
      return;
    }

    if (!hasAISystem) {
      toast.error(t('panel.aiNotConfigured'));
      return;
    }

    try {
      await generatePromptForItem(itemId);
      toast.success(t('panel.promptGenerated'));
    } catch (error: any) {
      toast.error(error?.message || t('panel.generateFailed'));
    }
  };

  // Retry a failed queue item
  const handleRetry = async (queueItemId: number) => {
    try {
      toast.info(t('panel.retrying'));

      // Reset item status to pending and restart queue runner via API
      await api.retryScheduleQueueItem(queueItemId);

      // Refresh queue to get updated status
      await fetchQueue({ channel_id: channel.id });

      toast.success(t('panel.retryStarted'));
    } catch (error: any) {
      toast.error(error?.message || t('panel.retryFailed'));
    }
  };

  const handleAIGenerateAll = async () => {
    if (!hasAISystem && !hasVariableSystem) {
      toast.error(t('panel.noPromptSystemAny'));
      return;
    }

    const emptyItems = scheduleItems.filter(item => !item.prompt.trim());
    if (emptyItems.length === 0) {
      toast.info(t('panel.allSlotsHavePrompts'));
      return;
    }

    for (const item of emptyItems) {
      await handleAIGenerate(item.id);
    }
  };

  const handleGenerate = async () => {
    // Only add items that are not already in the queue
    const itemsToAdd = scheduleItems.filter(item => !item.queueItemId);
    if (itemsToAdd.length === 0) {
      toast.error(t('panel.allInCalendar'));
      return;
    }

    setLoading(true);

    try {
      // Check for empty prompts and auto-generate with AI
      const emptyItems = itemsToAdd.filter(item => !item.prompt.trim());
      const generatedPrompts: Record<string, string> = {};

      if (emptyItems.length > 0) {
        if (isVariableMode && hasVariableSystem) {
          for (const item of emptyItems) {
            const result = generateVariablePrompt();
            if (result) {
              generatedPrompts[item.id] = result.prompt;
              setScheduleItems(prev => prev.map(i =>
                i.id === item.id ? { ...i, prompt: result.prompt, isGenerated: true } : i
              ));
            } else {
              toast.error(t('panel.noUnusedVarsEnough'));
              setLoading(false);
              return;
            }
          }
          await persistVariables();
        } else if (hasAISystem) {
          toast.info(t('panel.generatingAll', { count: emptyItems.length, credits: emptyItems.length * 5 }));

          for (const item of emptyItems) {
            try {
              const prompt = await generatePromptForItem(item.id);
              if (prompt) {
                generatedPrompts[item.id] = prompt;
              }
            } catch (error: any) {
              toast.error(t('panel.batchGenerateFailed', { error: error?.message }));
              setLoading(false);
              return;
            }
          }
        } else {
          toast.error(t('panel.fillAllPrompts'));
          setLoading(false);
          return;
        }
      }

      // Build items using current prompts + generated prompts (use channel timezone)
      const items = itemsToAdd.map(item => {
        // Use generated prompt if available, otherwise use existing prompt
        const prompt = generatedPrompts[item.id] || item.prompt;

        return {
          channel_id: channel.id,
          scheduled_time: createScheduledTimeISO(item.date, item.time),
          prompt,
          variable_values: {},
        };
      });

      await onGenerate(items);

      // Fetch queue and sync queueItemIds immediately
      const freshQueueItems = await fetchQueue({ channel_id: channel.id });

      // Sync queueItemIds to schedule items
      setScheduleItems(prev => prev.map(item => {
        const scheduledTime = createScheduledTimeISO(item.date, item.time);
        const targetTime = new Date(scheduledTime).getTime();

        let matchingQueueItem = freshQueueItems.find(qi =>
          qi.channel_id === channel.id &&
          new Date(qi.scheduled_time).getTime() === targetTime
        );
        // Fallback: match by local date+time
        if (!matchingQueueItem) {
          matchingQueueItem = freshQueueItems.find(qi => {
            if (qi.channel_id !== channel.id) return false;
            try {
              const { date: qiDate, time: qiTimeStr } = extractLocalDateTime(qi.scheduled_time);
              return qiDate === item.date && qiTimeStr === item.time;
            } catch { return false; }
          });
        }

        return {
          ...item,
          prompt: '',
          isGenerated: false,
          queueItemId: matchingQueueItem?.id,
        };
      }));

      // Delete all drafts for this channel (now in queue)
      try {
        await api.deleteAllSchedulerDrafts(channel.id);
      } catch (deleteError) {
        console.error('Failed to delete drafts after queue creation:', deleteError);
      }

      // Count how many pending items now exist for this channel
      const pendingNow = freshQueueItems.filter(qi => qi.channel_id === channel.id && qi.status === 'pending').length;
      toast.success(t('panel.addedToCalendar', { count: pendingNow }));

      // Remove added dates from selection so items disappear from panel
      const addedDates = new Set(scheduleItems.map(item => item.date));
      const remaining = new Set<string>();
      selectedDates.forEach(d => { if (!addedDates.has(d)) remaining.add(d); });
      setSelectedDates(remaining);
    } catch (error: any) {
      console.error('Generate error:', error);
      toast.error(error?.message || t('panel.generateScheduleFailed'));
    } finally {
      setLoading(false);
    }
  };


  if (selectedDates.size === 0) {
    return null;
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600">
            <Clock className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Schedule Content</h3>
            <p className="text-sm text-muted-foreground">
              {selectedDates.size} days selected
            </p>
          </div>
        </div>

        {/* Stats badges */}
        <div className="flex items-center gap-2">
          <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30">
            {postsPerDay} posts/day
          </Badge>
          <Badge className="bg-green-500/10 text-green-400 border-green-500/30">
            {newSlots} total
          </Badge>
          <Badge className={cn(
            filledSlots === newSlots
              ? "bg-green-500/10 text-green-400 border-green-500/30"
              : "bg-amber-500/10 text-amber-400 border-amber-500/30"
          )}>
            {filledSlots}/{newSlots} filled
          </Badge>
          {aiGeneratedSlots > 0 && (
            <Badge className="bg-[#FFB300]/10 text-[#FFB300] border-[#FFB300]/30">
              <Sparkles className="h-3 w-3 mr-1" />
              {aiGeneratedSlots} AI
            </Badge>
          )}
        </div>
      </div>

      {/* Lock warning when queue is busy */}
      {queueBusy && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
          <span>กำลัง Generate อยู่ — ไม่สามารถเปลี่ยน Posts per day / Time Slots ได้</span>
        </div>
      )}

      {/* Posts per day slider */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-muted-foreground">Posts per day</label>
          <span className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            {postsPerDay}
          </span>
        </div>
        <Slider
          value={[postsPerDay]}
          onValueChange={([value]) => setPostsPerDay(value)}
          min={1}
          max={24}
          step={1}
          className="py-2"
          disabled={queueBusy}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>1</span>
          <span>6</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </div>

      {/* Time Slots */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-muted-foreground">Post Times</label>
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <Clock className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-sm font-mono text-cyan-400">{currentTime}</span>
              <span className="text-xs text-muted-foreground">
                ({channel.timezone === 'local' ? 'Local' : channel.timezone})
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={addTimeSlot}
            disabled={timeSlots.length >= 24 || queueBusy}
            className="text-amber-400 hover:text-amber-300"
          >
            + Add Time
          </Button>
        </div>
        <div className={cn("flex gap-3 flex-wrap", queueBusy && "opacity-50 pointer-events-none")}>
          {timeSlots.map((time, index) => (
            <CompactTimePicker
              key={index}
              time={time}
              onChange={(newTime) => handleTimeChange(index, newTime)}
              onRemove={() => removeTimeSlot(index)}
              canRemove={timeSlots.length > 1}
            />
          ))}
        </div>
      </div>

      {/* Schedule Items - Grouped by Date */}
      <div className="space-y-4">
        {/* Header with actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-muted-foreground">
              Schedule Items ({scheduleItems.length})
            </label>
            {selectedCount > 0 && (
              <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30">
                {selectedCount} selected
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={selectAll}
              className="text-muted-foreground hover:text-white"
            >
              <CheckSquare className="h-4 w-4 mr-1" />
              {scheduleItems.every(i => i.selected) ? t('panel.deselectAll') : t('panel.selectAll')}
            </Button>
            {(hasAISystem || hasVariableSystem) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAIGenerateAll}
                className={isVariableMode
                  ? "text-[#FFB300] border-[#FFB300]/30 hover:bg-[#FFB300]/10"
                  : "text-[#FFB300] border-[#FFB300]/30 hover:bg-[#FFB300]/10"
                }
              >
                <Zap className="h-4 w-4 mr-1" />
                {isVariableMode ? `Fill (${emptySlots} slots)` : `AI Fill (${emptySlots * 5}c)`}
              </Button>
            )}
            {selectedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const selectedItems = scheduleItems.filter(i => i.selected);
                  let deletedCount = 0;

                  for (const item of selectedItems) {
                    const queueItem = findQueueItem(item.date, item.time);
                    if (queueItem) {
                      const success = await deleteQueueItem(queueItem.id);
                      if (success) deletedCount++;
                    }
                    // Clear prompt and draft
                    if (item.prompt.trim()) {
                      handlePromptChange(item.id, '');
                      api.deleteSchedulerDraft(channel.id, item.date, item.time).catch(() => {});
                    }
                  }

                  if (deletedCount > 0) {
                    toast.success(t('panel.deletedTasks', { count: deletedCount }));
                    fetchQueue();
                  } else {
                    toast.success(t('panel.clearedPrompts', { count: selectedItems.length }));
                  }
                }}
                className="text-red-400 border-red-500/30 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete Selected ({selectedCount})
              </Button>
            )}
          </div>
        </div>

        {/* Quick Channel Settings */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Platform</Label>
            <Select
              value={channel.platform}
              onValueChange={(value) => updateChannel(channel.id, { platform: value as any })}
            >
              <SelectTrigger className="h-7 text-xs w-[130px] bg-gray-900/50 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sora2-kie">{t('panel.server1')}</SelectItem>
                <SelectItem value="sora2-grsai">{t('panel.server2')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Duration</Label>
            <Select
              value={channel.duration}
              onValueChange={(value) => updateChannel(channel.id, { duration: value as any })}
            >
              <SelectTrigger className="h-7 text-xs w-[70px] bg-gray-900/50 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10s</SelectItem>
                <SelectItem value="15">15s</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Ratio</Label>
            <Select
              value={channel.aspect_ratio}
              onValueChange={(value) => updateChannel(channel.id, { aspect_ratio: value as any })}
            >
              <SelectTrigger className="h-7 text-xs w-[100px] bg-gray-900/50 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="portrait">{t('panel.portrait')}</SelectItem>
                <SelectItem value="landscape">{t('panel.landscape')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Auto-Retry</Label>
            <Select
              value={channel.auto_retry_hours != null ? String(channel.auto_retry_hours) : 'off'}
              onValueChange={(value) => updateChannel(channel.id, { auto_retry_hours: value === 'off' ? null : parseInt(value) })}
            >
              <SelectTrigger className="h-7 text-xs w-[100px] bg-gray-900/50 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{t('panel.off')}</SelectItem>
                <SelectItem value="1">{t('panel.hours', { n: 1 })}</SelectItem>
                <SelectItem value="2">{t('panel.hours', { n: 2 })}</SelectItem>
                <SelectItem value="3">{t('panel.hours', { n: 3 })}</SelectItem>
                <SelectItem value="6">{t('panel.hours', { n: 6 })}</SelectItem>
                <SelectItem value="12">{t('panel.hours', { n: 12 })}</SelectItem>
                <SelectItem value="24">{t('panel.hours', { n: 24 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Items grouped by date */}
        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
          {Object.entries(itemsByDate).map(([date, items]) => (
            <div key={date} className="space-y-2">
              {/* Date Header */}
              <div
                className="flex items-center gap-3 py-2 px-3 bg-zinc-800/50 rounded-lg sticky top-0 z-10 cursor-pointer hover:bg-zinc-800/70"
                onClick={() => toggleDateSelection(date)}
              >
                <Checkbox
                  checked={items.every(i => i.selected)}
                  onCheckedChange={() => toggleDateSelection(date)}
                  className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                />
                <Calendar className="h-4 w-4 text-blue-400" />
                <span className="font-medium text-blue-400">{items[0]?.dateDisplay}</span>
                <Badge variant="outline" className="text-xs">
                  {items.length} slots
                </Badge>
                <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">
                  {items.filter(i => i.prompt.trim()).length} ready
                </Badge>
              </div>

              {/* Items for this date */}
              <div className="space-y-1 pl-2">
                {items.map((item) => {
                  // Only use queueItemId from the item itself - don't search by time
                  // This ensures empty slots stay empty even when same time has queue items
                  const queueItem = item.queueItemId ? queueItems.find(qi => qi.id === item.queueItemId) : undefined;
                  const effectiveQueueItemId = item.queueItemId;
                  const logs = effectiveQueueItemId ? itemLogs[effectiveQueueItemId] : undefined;
                  const isLoadingLogs = effectiveQueueItemId ? loadingLogs.has(effectiveQueueItemId) : false;
                  const lastLogMsg = logs?.[logs.length - 1]?.message || '';
                  const isStopped = lastLogMsg.includes('Stopped') || queueItem?.error?.includes('Stopped by user');

                  // Determine status from queue item if available, otherwise use item's videoStatus
                  const actualStatus = queueItem ? queueItem.status : item.videoStatus;
                  const displayStatus = actualStatus === 'pending' ? 'ready'
                    : actualStatus === 'done' ? 'completed'
                    : actualStatus === 'failed' ? 'error'
                    : actualStatus as VideoStatus;

                  // Expanded state is now fully controlled by expandedItems set
                  // (active items are auto-added by the useEffect above)
                  const isActiveStatus = ['generating', 'captioning', 'scheduling', 'failed'].includes(actualStatus);
                  const isExpanded = expandedItems.has(item.id);

                  // Show expand button for any non-empty/non-ready status
                  const showExpandButton = effectiveQueueItemId || ['generating', 'captioning', 'scheduling', 'completed', 'error'].includes(actualStatus);

                  return (
                    <div key={item.id} className="space-y-1">
                      <div
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border transition-all",
                          item.selected
                            ? "bg-blue-500/5 border-blue-500/30"
                            : displayStatus === 'error' || actualStatus === 'failed'
                            ? "bg-red-500/5 border-red-500/30"
                            : displayStatus === 'completed'
                            ? "bg-green-500/5 border-green-500/30"
                            : ['generating', 'captioning', 'scheduling'].includes(actualStatus)
                            ? "bg-amber-500/5 border-amber-500/30"
                            : "bg-zinc-900/30 border-zinc-800 hover:border-zinc-700"
                        )}
                      >
                        {/* Expand/Collapse Button */}
                        {showExpandButton ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleExpand(item.id, effectiveQueueItemId)}
                            className="h-7 w-7 text-zinc-400 hover:text-white hover:bg-zinc-700/50"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        ) : (
                          <div className="h-7 w-7 shrink-0 flex items-center justify-center text-zinc-600">
                            <ChevronRight className="h-4 w-4" />
                          </div>
                        )}

                        {/* Checkbox */}
                        <Checkbox
                          checked={item.selected}
                          onCheckedChange={() => toggleItemSelection(item.id)}
                          className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                        />

                        {/* Time */}
                        <div className="w-14 font-mono font-bold text-amber-400">
                          {item.time}
                        </div>

                        {/* Status Badge */}
                        <Badge
                          variant="outline"
                          className={cn(
                            "w-28 justify-center text-xs",
                            displayStatus === 'empty' && "text-zinc-500 border-zinc-600",
                            displayStatus === 'ready' && "text-green-400 border-green-500/30 bg-green-500/10",
                            ['generating', 'captioning', 'scheduling'].includes(actualStatus) && "text-amber-400 border-amber-500/30 bg-amber-500/10",
                            displayStatus === 'completed' && "text-blue-400 border-blue-500/30 bg-blue-500/10",
                            displayStatus === 'error' && "text-red-400 border-red-500/30 bg-red-500/10"
                          )}
                        >
                          {displayStatus === 'empty' && 'EMPTY'}
                          {displayStatus === 'ready' && 'READY'}
                          {actualStatus === 'generating' && (
                            <><Loader2 className="h-3 w-3 animate-spin mr-1" />VIDEO...</>
                          )}
                          {actualStatus === 'captioning' && (
                            <><Loader2 className="h-3 w-3 animate-spin mr-1" />CAPTION...</>
                          )}
                          {actualStatus === 'scheduling' && (
                            <><Loader2 className="h-3 w-3 animate-spin mr-1" />POSTING...</>
                          )}
                          {displayStatus === 'completed' && (
                            <><Check className="h-3 w-3 mr-1" />DONE</>
                          )}
                          {displayStatus === 'error' && 'ERROR'}
                        </Badge>

                        {/* Auto-retry countdown for failed items */}
                        {displayStatus === 'error' && channel.auto_retry_hours && queueItem?.updated_at && (() => {
                          const failedAt = new Date(queueItem.updated_at).getTime();
                          const retryAt = failedAt + (channel.auto_retry_hours! * 60 * 60 * 1000);
                          const now = Date.now();
                          const remaining = retryAt - now;
                          if (remaining <= 0) return <span className="text-xs text-amber-400">Retrying soon...</span>;
                          const hours = Math.floor(remaining / (60 * 60 * 1000));
                          const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
                          return <span className="text-xs text-amber-400/70">Auto-retry {hours > 0 ? `${hours}h` : ''}{mins}m</span>;
                        })()}

                        {/* Prompt Input / Display */}
                        <div className="flex-1 min-w-0">
                          {queueItem ? (
                            // Queue item: clickable expandable prompt
                            <div
                              onClick={() => setExpandedPrompts(prev => {
                                const next = new Set(prev);
                                next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                                return next;
                              })}
                              className={cn(
                                "px-3 py-1.5 rounded-md border border-zinc-700/50 text-sm cursor-pointer transition-colors hover:bg-zinc-800/50",
                                expandedPrompts.has(item.id) ? "whitespace-pre-wrap break-words" : "truncate"
                              )}
                              title={expandedPrompts.has(item.id) ? "Click to collapse" : "Click to expand full prompt"}
                            >
                              {queueItem.prompt || '—'}
                            </div>
                          ) : (
                            // Editable: input with expand toggle
                            expandedPrompts.has(item.id) ? (
                              <Textarea
                                value={item.prompt}
                                onChange={(e) => handlePromptChange(item.id, e.target.value)}
                                placeholder={t('panel.enterPrompt')}
                                rows={4}
                                className="bg-transparent border-zinc-700/50 text-sm resize-none"
                                autoFocus
                                onBlur={() => setExpandedPrompts(prev => {
                                  const next = new Set(prev);
                                  next.delete(item.id);
                                  return next;
                                })}
                              />
                            ) : (
                              <Input
                                value={item.prompt}
                                onChange={(e) => handlePromptChange(item.id, e.target.value)}
                                placeholder={t('panel.enterPrompt')}
                                className="h-9 bg-transparent border-zinc-700/50 text-sm"
                                onDoubleClick={() => setExpandedPrompts(prev => new Set(prev).add(item.id))}
                                title={t('panel.doubleClickExpand')}
                              />
                            )
                          )}
                        </div>

                        {/* Clear Prompt Button */}
                        {!queueItem && item.prompt.trim() && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              handlePromptChange(item.id, '');
                              // Also delete draft from DB
                              api.deleteSchedulerDraft(channel.id, item.date, item.time).catch(() => {});
                            }}
                            className="h-9 w-9 text-zinc-500 hover:text-red-400 hover:bg-red-500/20"
                            title={t('panel.clearPrompt')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}

                        {/* Generate Prompt Button (AI or Variable) */}
                        {(hasAISystem || hasVariableSystem) && !queueItem && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleAIGenerate(item.id)}
                            disabled={item.isGenerating}
                            className={cn(
                              "h-9 w-9",
                              isVariableMode
                                ? "text-[#FFB300] hover:bg-[#FFB300]/20"
                                : "text-[#FFB300] hover:bg-[#FFB300]/20"
                            )}
                            title={isVariableMode ? "Generate from Variables" : "AI Generate Prompt (5c)"}
                          >
                            {item.isGenerating ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Bot className="h-4 w-4" />
                            )}
                          </Button>
                        )}

                        {/* Video Generate Button */}
                        {!queueItem && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleVideoGenerate(item.id)}
                            disabled={!item.prompt.trim() || item.videoStatus === 'generating' || item.videoStatus === 'completed'}
                            className={cn(
                              "h-9 w-9",
                              item.videoStatus === 'completed'
                                ? "text-green-400"
                                : item.prompt.trim()
                                ? "text-amber-400 hover:bg-amber-500/20"
                                : "text-zinc-600"
                            )}
                            title={t('panel.generateVideo')}
                          >
                            {item.videoStatus === 'generating' ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : item.videoStatus === 'completed' ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                        )}

                        {/* Retry Button (for failed items) */}
                        {queueItem && queueItem.status === 'failed' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={async () => {
                              const success = await retryQueueItem(queueItem.id);
                              if (success) {
                                toast.success(t('panel.retryStartedShort'));
                                // Clear old cached logs so fresh logs are fetched
                                setItemLogs(prev => {
                                  const next = { ...prev };
                                  delete next[queueItem.id];
                                  return next;
                                });
                                // Also reset auto-expand tracking so it auto-expands again
                                autoExpandedRef.current.delete(queueItem.id);
                                fetchQueue();
                              }
                            }}
                            className="h-9 w-9 text-zinc-500 hover:text-amber-400 hover:bg-amber-500/20"
                            title={t('panel.retry')}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}

                        {/* Delete Queue Item Button (for items with queue) */}
                        {queueItem && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={async () => {
                              const success = await deleteQueueItem(queueItem.id);
                              if (success) {
                                toast.success(t('panel.queueItemDeleted'));
                                fetchQueue();
                              }
                            }}
                            className="h-9 w-9 text-zinc-500 hover:text-red-400 hover:bg-red-500/20"
                            title={t('panel.deleteTask')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {/* Expanded Logs Section */}
                      {isExpanded && effectiveQueueItemId && (
                        <div className="ml-7 p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/50 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Activity className="h-3.5 w-3.5" />
                              <span>{t('panel.activityLogQueue', { id: effectiveQueueItemId })}</span>
                              {isLoadingLogs && <Loader2 className="h-3 w-3 animate-spin" />}
                            </div>
                            {/* Current Step Indicator */}
                            {['generating', 'captioning', 'scheduling'].includes(actualStatus) && (
                              <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30 animate-pulse">
                                {actualStatus === 'generating' && '🎬 Generating Video...'}
                                {actualStatus === 'captioning' && '✍️ Generating Caption...'}
                                {actualStatus === 'scheduling' && '📤 Posting to Social Media...'}
                              </Badge>
                            )}
                          </div>

                          {/* Progress Steps */}
                          <div className="flex items-center gap-1 text-xs">
                            <div className={cn(
                              "flex items-center gap-1 px-2 py-1 rounded",
                              actualStatus === 'generating' ? "bg-amber-500/20 text-amber-400" :
                              actualStatus === 'failed' ? "bg-red-500/20 text-red-400" :
                              ['captioning', 'scheduling', 'done'].includes(actualStatus) ? "bg-green-500/20 text-green-400" :
                              "bg-zinc-700/30 text-zinc-500"
                            )}>
                              <Video className="h-3 w-3" />
                              <span>Video</span>
                            </div>
                            <span className="text-zinc-600">→</span>
                            <div className={cn(
                              "flex items-center gap-1 px-2 py-1 rounded",
                              actualStatus === 'captioning' ? "bg-amber-500/20 text-amber-400" :
                              ['scheduling', 'done'].includes(actualStatus) ? "bg-green-500/20 text-green-400" :
                              "bg-zinc-700/30 text-zinc-500"
                            )}>
                              <Bot className="h-3 w-3" />
                              <span>Caption</span>
                            </div>
                            <span className="text-zinc-600">→</span>
                            <div className={cn(
                              "flex items-center gap-1 px-2 py-1 rounded",
                              actualStatus === 'scheduling' ? "bg-amber-500/20 text-amber-400" :
                              actualStatus === 'done' ? "bg-green-500/20 text-green-400" :
                              "bg-zinc-700/30 text-zinc-500"
                            )}>
                              <Send className="h-3 w-3" />
                              <span>Post</span>
                            </div>
                            {actualStatus === 'done' && (
                              <>
                                <span className="text-zinc-600">→</span>
                                <div className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/20 text-green-400">
                                  <Check className="h-3 w-3" />
                                  <span>{t('panel.done')}</span>
                                </div>
                              </>
                            )}
                            {actualStatus === 'failed' && (
                              <>
                                <span className="text-zinc-600">→</span>
                                <div className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 text-red-400">
                                  <AlertCircle className="h-3 w-3" />
                                  <span>{isStopped ? 'หยุดแล้ว' : 'ล้มเหลว'}</span>
                                </div>
                              </>
                            )}
                          </div>

                          {/* Error Display with Retry Button */}
                          {(actualStatus === 'failed' || queueItem?.error) && (
                            <div className="p-3 rounded space-y-2 bg-red-500/10 border border-red-500/30">
                              <div className="text-sm font-medium flex items-center gap-2 text-red-400">
                                <AlertCircle className="h-4 w-4" />
                                <span>{isStopped ? 'การสร้างถูกหยุด' : 'การสร้างล้มเหลว'}</span>
                              </div>
                              {queueItem?.error && (
                                <div className="text-red-300 text-xs bg-red-500/5 p-2 rounded">
                                  {queueItem.error}
                                </div>
                              )}
                              {effectiveQueueItemId && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleRetry(effectiveQueueItemId)}
                                  className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                                >
                                  <Play className="h-3.5 w-3.5 mr-1" />
                                  Retry Generation
                                </Button>
                              )}
                            </div>
                          )}

                          {/* Video URL */}
                          {queueItem?.video_url && (
                            <div className="p-2 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs">
                              <Check className="h-3.5 w-3.5 inline mr-1" />
                              Video ready: <a href={queueItem.video_url} target="_blank" rel="noopener noreferrer" className="underline">{queueItem.video_url.substring(0, 50)}...</a>
                            </div>
                          )}

                          {/* Logs List */}
                          <div className="space-y-1 max-h-40 overflow-y-auto border-t border-zinc-700/30 pt-2 mt-2">
                            <div className="text-xs text-muted-foreground mb-1">Detailed Logs:</div>
                            {logs && logs.length > 0 ? (
                              logs.map((log) => (
                                <div
                                  key={log.id}
                                  className={cn(
                                    "flex items-start gap-2 text-xs py-1",
                                    log.log_type === 'success' && "text-green-400",
                                    log.log_type === 'error' && "text-red-400",
                                    log.log_type === 'warning' && "text-amber-400",
                                    log.log_type === 'info' && "text-zinc-400"
                                  )}
                                >
                                  <span className="text-zinc-600 font-mono shrink-0">
                                    {new Date(log.created_at).toLocaleTimeString('en-US', { hour12: false })}
                                  </span>
                                  <span>{log.message}</span>
                                </div>
                              ))
                            ) : isLoadingLogs ? (
                              <div className="text-xs text-muted-foreground flex items-center gap-2">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading logs...
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">Waiting for activity...</div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Show loading when expanded but no queueItemId yet */}
                      {isExpanded && !effectiveQueueItemId && (
                        <div className="ml-7 p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                          <div className="flex items-center gap-2 text-xs text-amber-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Creating queue item... Please wait</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Batch Add to Calendar Button */}
      {selectedCount > 0 && (
        <Button
          onClick={handleBatchGenerate}
          disabled={loading || selectedCount === 0}
          className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 rounded-xl"
        >
          {loading ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Adding to Calendar...
            </>
          ) : (
            <>
              <Calendar className="h-5 w-5 mr-2" />
              Add {selectedCount} to Calendar
            </>
          )}
        </Button>
      )}

      {/* Create Schedule / Stop Button (if no selection) */}
      {selectedCount === 0 && (() => {
        const hasActiveItems = queueItems.some(isRecentlyActive);

        if (stoppingQueue) {
          // State 2: Stopping — clickable to force reset stuck items
          return (
            <Button
              onClick={async () => {
                await stopQueueRunner();
                toast.success(t('panel.forceResetDone'));
                fetchQueue();
                setStoppingQueue(false);
              }}
              className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-xl"
            >
              <RefreshCw className="h-5 w-5 mr-2" />
              {t('panel.forceReset')}
            </Button>
          );
        }

        if (hasActiveItems) {
          // State 1: Stop Queue (active items running, not yet stopped)
          return (
            <Button
              onClick={async () => {
                setStoppingQueue(true);
                await stopQueueRunner();
                toast.success(t('panel.queueStopped'));
                fetchQueue();
              }}
              className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-xl"
            >
              <X className="h-5 w-5 mr-2" />
              Stop Queue
            </Button>
          );
        }

        // State 3: Add to Calendar (pending only, generate later from calendar)
        return (
          <Button
            onClick={handleGenerate}
            disabled={loading || !canGenerate}
            className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 rounded-xl"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Adding to Calendar...
              </>
            ) : (
              <>
                <Calendar className="h-5 w-5 mr-2" />
                Add {newSlots} to Calendar
              </>
            )}
          </Button>
        );
      })()}
    </div>
  );
};

export default SchedulePanel;
