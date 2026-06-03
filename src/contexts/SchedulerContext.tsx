import React, { createContext, useContext, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import type {
  SchedulerChannel,
  ScheduleQueueItem,
  TimePreset,
  ScheduleSlot,
  QueueStats,
  ChannelStockInfo
} from '@/types/scheduler';

export type ServerType = 'sora2-vidgo';

interface SchedulerContextType {
  channels: SchedulerChannel[];
  currentChannel: SchedulerChannel | null;
  loadingChannels: boolean;
  queueItems: ScheduleQueueItem[];
  queueStats: QueueStats | null;
  loadingQueue: boolean;
  timePresets: TimePreset[];
  loadingPresets: boolean;
  currentMonth: Date;
  selectedDates: Set<string>;
  masterTimeSlots: string[];
  scheduleSlots: ScheduleSlot[];

  fetchChannels: () => Promise<void>;
  fetchChannel: (id: number) => Promise<SchedulerChannel | null>;
  createChannel: (data: Partial<SchedulerChannel>) => Promise<SchedulerChannel | null>;
  updateChannel: (id: number, data: Partial<SchedulerChannel>) => Promise<SchedulerChannel | null>;
  deleteChannel: (id: number) => Promise<boolean>;
  setCurrentChannel: (channel: SchedulerChannel | null) => void;
  getChannelStock: (id: number) => Promise<ChannelStockInfo | null>;

  fetchQueue: (params?: { channel_id?: number; status?: string }) => Promise<ScheduleQueueItem[]>;
  fetchQueueStats: (channelId?: number) => Promise<void>;
  createQueueItems: (items: Array<{
    channel_id: number;
    scheduled_time: string;
    prompt: string;
    variable_values?: Record<string, string>;
  }>) => Promise<{ success: boolean; created: number; skipped: number }>;
  deleteQueueItem: (id: number) => Promise<boolean>;
  retryQueueItem: (id: number) => Promise<boolean>;
  startQueueRunner: (channelId?: number, dates?: string[], timezone?: string, templateId?: string, templateMode?: string, generateOnly?: boolean, requestId?: string, extendPrompts?: Record<number, string>) => Promise<boolean>;
  stopQueueRunner: () => Promise<boolean>;

  fetchTimePresets: () => Promise<void>;
  createTimePreset: (name: string, times: string[]) => Promise<TimePreset | null>;
  deleteTimePreset: (id: number) => Promise<boolean>;

  setCurrentMonth: (date: Date) => void;
  setSelectedDates: (dates: Set<string>) => void;
  toggleDateSelection: (dateStr: string) => void;
  selectDateRange: (startStr: string, endStr: string) => void;
  clearSelection: () => void;
  selectAllDaysInMonth: () => void;
  setMasterTimeSlots: (slots: string[]) => void;
  setScheduleSlots: (slots: ScheduleSlot[]) => void;
}

const SchedulerContext = createContext<SchedulerContextType | undefined>(undefined);

export const useScheduler = () => {
  const context = useContext(SchedulerContext);
  if (!context) {
    throw new Error('useScheduler must be used within a SchedulerProvider');
  }
  return context;
};

export const SchedulerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [channels, setChannels] = useState<SchedulerChannel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<SchedulerChannel | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);

  const [queueItems, setQueueItems] = useState<ScheduleQueueItem[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(false);

  const [timePresets, setTimePresets] = useState<TimePreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);

  const [currentMonth, setCurrentMonth] = useState(new Date());

  const [selectedDates, setSelectedDatesState] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('scheduler_selectedDates');
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load selectedDates from localStorage:', e);
    }
    return new Set();
  });

  const setSelectedDates = useCallback((dates: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setSelectedDatesState(prev => {
      const newDates = typeof dates === 'function' ? dates(prev) : dates;
      try {
        localStorage.setItem('scheduler_selectedDates', JSON.stringify([...newDates]));
      } catch (e) {
        console.error('Failed to save selectedDates to localStorage:', e);
      }
      return newDates;
    });
  }, []);

  const [masterTimeSlots, setMasterTimeSlots] = useState<string[]>(['10:00', '14:00', '18:00']);
  const [scheduleSlots, setScheduleSlots] = useState<ScheduleSlot[]>([]);

  const fetchChannels = useCallback(async () => {
    setLoadingChannels(true);
    try {
      const data = await api.getSchedulerChannels();
      setChannels(data);
    } catch (error) {
      console.error('Failed to fetch channels:', error);
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  const fetchChannel = useCallback(async (id: number): Promise<SchedulerChannel | null> => {
    try {
      const data = await api.getSchedulerChannel(id);
      return data;
    } catch (error) {
      console.error('Failed to fetch channel:', error);
      return null;
    }
  }, []);

  const createChannel = useCallback(async (data: Partial<SchedulerChannel>): Promise<SchedulerChannel | null> => {
    try {
      const newChannel = await api.createSchedulerChannel(data as any);
      setChannels(prev => [newChannel, ...prev]);
      return newChannel;
    } catch (error) {
      console.error('Failed to create channel:', error);
      return null;
    }
  }, []);

  const updateChannel = useCallback(async (id: number, data: Partial<SchedulerChannel>): Promise<SchedulerChannel | null> => {
    try {
      const updated = await api.updateSchedulerChannel(id, data as any);
      setChannels(prev => prev.map(ch => ch.id === id ? updated : ch));
      if (currentChannel?.id === id) {
        setCurrentChannel(updated);
      }
      return updated;
    } catch (error: any) {
      console.error('Failed to update channel:', error);
      throw error;
    }
  }, [currentChannel]);

  const deleteChannel = useCallback(async (id: number): Promise<boolean> => {
    try {
      await api.deleteSchedulerChannel(id);
      setChannels(prev => prev.filter(ch => ch.id !== id));
      if (currentChannel?.id === id) {
        setCurrentChannel(null);
      }
      return true;
    } catch (error) {
      console.error('Failed to delete channel:', error);
      return false;
    }
  }, [currentChannel]);

  const getChannelStock = useCallback(async (id: number): Promise<ChannelStockInfo | null> => {
    try {
      return await api.getChannelStock(id);
    } catch (error) {
      console.error('Failed to get channel stock:', error);
      return null;
    }
  }, []);

  const fetchQueue = useCallback(async (params?: { channel_id?: number; status?: string }): Promise<ScheduleQueueItem[]> => {
    setLoadingQueue(true);
    try {
      const data = await api.getScheduleQueue(params);
      setQueueItems(data.items);
      return data.items;
    } catch (error) {
      console.error('Failed to fetch queue:', error);
      return [];
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  const fetchQueueStats = useCallback(async (channelId?: number) => {
    try {
      const stats = await api.getScheduleQueueStats(channelId);
      setQueueStats(stats);
    } catch (error) {
      console.error('Failed to fetch queue stats:', error);
    }
  }, []);

  const createQueueItems = useCallback(async (items: Array<{
    channel_id: number;
    scheduled_time: string;
    prompt: string;
    variable_values?: Record<string, string>;
  }>): Promise<{ success: boolean; created: number; skipped: number }> => {
    try {
      const result = await api.createScheduleQueueItems(items);
      await fetchQueue({ channel_id: items[0]?.channel_id });
      await fetchQueueStats(items[0]?.channel_id);
      return { success: result.created > 0 || result.skipped > 0, created: result.created || 0, skipped: result.skipped || 0 };
    } catch (error) {
      console.error('Failed to create queue items:', error);
      return { success: false, created: 0, skipped: 0 };
    }
  }, [fetchQueue, fetchQueueStats]);

  const deleteQueueItem = useCallback(async (id: number): Promise<boolean> => {
    try {
      await api.deleteScheduleQueueItem(id);
      setQueueItems(prev => prev.filter(item => item.id !== id));
      return true;
    } catch (error) {
      console.error('Failed to delete queue item:', error);
      return false;
    }
  }, []);

  const retryQueueItem = useCallback(async (id: number): Promise<boolean> => {
    try {
      const response = await api.retryScheduleQueueItem(id);
      const retryItem = response.item || response;
      setQueueItems(prev => prev.map(item => item.id === id ? retryItem : item));
      return true;
    } catch (error) {
      console.error('Failed to retry queue item:', error);
      return false;
    }
  }, []);

  const startQueueRunner = useCallback(async (channelId?: number, dates?: string[], timezone?: string, templateId?: string, templateMode?: string, generateOnly?: boolean, requestId?: string, extendPrompts?: Record<number, string>): Promise<boolean> => {
    try {
      // force=false to avoid stopping existing running tasks
      const response = await api.startSchedulerQueue(false, channelId, dates, timezone, templateId, templateMode, generateOnly, requestId, extendPrompts);
      return response?.success !== false;
    } catch (error) {
      console.error('Failed to start queue runner:', error);
      return false;
    }
  }, []);

  const stopQueueRunner = useCallback(async (): Promise<boolean> => {
    try {
      await api.stopSchedulerQueue();
      return true;
    } catch (error) {
      console.error('Failed to stop queue runner:', error);
      return false;
    }
  }, []);

  const fetchTimePresets = useCallback(async () => {
    setLoadingPresets(true);
    try {
      const data = await api.getTimePresets();
      setTimePresets(data);
    } catch (error) {
      console.error('Failed to fetch time presets:', error);
    } finally {
      setLoadingPresets(false);
    }
  }, []);

  const createTimePreset = useCallback(async (name: string, times: string[]): Promise<TimePreset | null> => {
    try {
      const preset = await api.createTimePreset(name, times);
      setTimePresets(prev => [...prev, preset]);
      return preset;
    } catch (error) {
      console.error('Failed to create time preset:', error);
      return null;
    }
  }, []);

  const deleteTimePreset = useCallback(async (id: number): Promise<boolean> => {
    try {
      await api.deleteTimePreset(id);
      setTimePresets(prev => prev.filter(p => p.id !== id));
      return true;
    } catch (error) {
      console.error('Failed to delete time preset:', error);
      return false;
    }
  }, []);

  const toggleDateSelection = useCallback((dateStr: string) => {
    setSelectedDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dateStr)) {
        newSet.delete(dateStr);
      } else {
        newSet.add(dateStr);
      }
      return newSet;
    });
  }, []);

  const getEffectiveTimezone = useCallback(() => {
    if (!currentChannel || currentChannel.timezone === 'local') {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    return currentChannel.timezone;
  }, [currentChannel]);

  const getDateStrInTimezone = useCallback((date: Date) => {
    const tz = getEffectiveTimezone();
    return date.toLocaleDateString('en-CA', { timeZone: tz });
  }, [getEffectiveTimezone]);

  const selectDateRange = useCallback((startStr: string, endStr: string) => {
    const start = new Date(startStr + 'T00:00:00');
    const end = new Date(endStr + 'T00:00:00');
    const [rangeStart, rangeEnd] = start <= end ? [start, end] : [end, start];
    const todayStr = getDateStrInTimezone(new Date());

    const newSelected = new Set<string>();
    const current = new Date(rangeStart);

    while (current <= rangeEnd) {
      const dateStr = current.toLocaleDateString('en-CA');
      if (dateStr >= todayStr) {
        newSelected.add(dateStr);
      }
      current.setDate(current.getDate() + 1);
    }

    setSelectedDates(newSelected);
  }, [getDateStrInTimezone]);

  const clearSelection = useCallback(() => {
    setSelectedDates(new Set());
  }, []);

  const selectAllDaysInMonth = useCallback(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = getDateStrInTimezone(new Date());

    const newSelected = new Set<string>();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = date.toLocaleDateString('en-CA');
      if (dateStr >= todayStr) {
        newSelected.add(dateStr);
      }
    }

    setSelectedDates(newSelected);
  }, [currentMonth, getDateStrInTimezone]);

  return (
    <SchedulerContext.Provider value={{
      channels,
      currentChannel,
      loadingChannels,
      queueItems,
      queueStats,
      loadingQueue,
      timePresets,
      loadingPresets,
      currentMonth,
      selectedDates,
      masterTimeSlots,
      scheduleSlots,

      fetchChannels,
      fetchChannel,
      createChannel,
      updateChannel,
      deleteChannel,
      setCurrentChannel,
      getChannelStock,

      fetchQueue,
      fetchQueueStats,
      createQueueItems,
      deleteQueueItem,
      retryQueueItem,
      startQueueRunner,
      stopQueueRunner,

      fetchTimePresets,
      createTimePreset,
      deleteTimePreset,

      setCurrentMonth,
      setSelectedDates,
      toggleDateSelection,
      selectDateRange,
      clearSelection,
      selectAllDaysInMonth,
      setMasterTimeSlots,
      setScheduleSlots,
    }}>
      {children}
    </SchedulerContext.Provider>
  );
};
