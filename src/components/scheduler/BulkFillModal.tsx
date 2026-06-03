import React, { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Clock, Plus, X, Sparkles, AlertCircle, Loader2, Check, Bot } from 'lucide-react';

// Hours for time picker (6 AM - 11 PM)
const HOURS = Array.from({ length: 18 }, (_, i) => (i + 6).toString().padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

// Simple inline time picker component
const TimePicker: React.FC<{
  value: string;
  onChange: (value: string) => void;
  className?: string;
}> = ({ value, onChange, className = '' }) => {
  const [hour, minute] = value.split(':');

  return (
    <div className={`flex gap-1 items-center ${className}`}>
      <Select value={hour} onValueChange={(h) => onChange(`${h}:${minute}`)}>
        <SelectTrigger className="w-16 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOURS.map((h) => (
            <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">:</span>
      <Select value={minute} onValueChange={(m) => onChange(`${hour}:${m}`)}>
        <SelectTrigger className="w-14 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map((m) => (
            <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useScheduler } from '@/contexts/SchedulerContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SchedulerChannel } from '@/types/scheduler';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface BulkFillModalProps {
  open: boolean;
  onClose: () => void;
  channel: SchedulerChannel;
  onGenerate: (items: Array<{
    channel_id: number;
    scheduled_time: string;
    prompt: string;
    variable_values: Record<string, string>;
  }>) => void;
}

interface ScheduleItem {
  id: string;
  date: string;
  dateDisplay: string;
  time: string;
  prompt: string;
  isGenerating: boolean;
  isGenerated: boolean;
}

// Generate time slots evenly distributed
const generateTimeSlots = (count: number): string[] => {
  const slots: string[] = [];
  const startHour = 6;
  const endHour = 22;
  const interval = Math.floor((endHour - startHour) / Math.max(count - 1, 1));

  for (let i = 0; i < count; i++) {
    const hour = Math.min(startHour + (i * interval), endHour);
    slots.push(`${hour.toString().padStart(2, '0')}:00`);
  }

  return slots;
};

export const BulkFillModal: React.FC<BulkFillModalProps> = ({
  open,
  onClose,
  channel,
  onGenerate,
}) => {
  const { selectedDates, fetchQueue } = useScheduler();
  const { t } = useLanguage();
  const [postsPerDay, setPostsPerDay] = useState(channel.posts_per_day || 3);
  const [timeSlots, setTimeSlots] = useState<string[]>(generateTimeSlots(3));
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Check if channel uses AI Prompt System
  const hasAISystem = channel.system_prompt && (channel.example_prompts?.length || 0) > 0;

  // Update time slots and schedule items when posts per day or dates change
  useEffect(() => {
    const newTimeSlots = generateTimeSlots(postsPerDay);
    setTimeSlots(newTimeSlots);

    // Generate schedule items
    const sortedDates = Array.from(selectedDates).sort();
    const items: ScheduleItem[] = [];

    for (const dateStr of sortedDates) {
      const date = new Date(dateStr);
      const dayNames = [t('calendar.dayNamesSun'), t('calendar.dayNamesMon'), t('calendar.dayNamesTue'), t('calendar.dayNamesWed'), t('calendar.dayNamesThu'), t('calendar.dayNamesFri'), t('calendar.dayNamesSat')];
      const dayName = dayNames[date.getDay()];
      const dayNum = date.getDate();

      for (const time of newTimeSlots) {
        items.push({
          id: `${dateStr}-${time}`,
          date: dateStr,
          dateDisplay: `${dayName} ${dayNum}`,
          time,
          prompt: '',
          isGenerating: false,
          isGenerated: false,
        });
      }
    }

    setScheduleItems(items);
  }, [postsPerDay, selectedDates]);

  // Calculate stats
  const totalSlots = scheduleItems.length;
  const filledSlots = scheduleItems.filter(item => item.prompt.trim()).length;
  const aiGeneratedSlots = scheduleItems.filter(item => item.isGenerated).length;
  const emptySlots = totalSlots - filledSlots;

  // Can only generate if all slots have prompts
  const canGenerate = filledSlots === totalSlots && totalSlots > 0;

  const handleTimeChange = (slotIndex: number, value: string) => {
    const newSlots = [...timeSlots];
    newSlots[slotIndex] = value;
    setTimeSlots(newSlots);

    // Update schedule items - preserve prompts by position (slotIndex within each date)
    setScheduleItems(prev => {
      const sortedDates = Array.from(selectedDates).sort();
      const items: ScheduleItem[] = [];

      for (const dateStr of sortedDates) {
        const date = new Date(dateStr);
        const dayNames = [t('calendar.dayNamesSun'), t('calendar.dayNamesMon'), t('calendar.dayNamesTue'), t('calendar.dayNamesWed'), t('calendar.dayNamesThu'), t('calendar.dayNamesFri'), t('calendar.dayNamesSat')];
        const dayName = dayNames[date.getDay()];
        const dayNum = date.getDate();

        for (let i = 0; i < newSlots.length; i++) {
          const time = newSlots[i];
          // Find existing item by date and slot index (not by time)
          const existingItemsForDate = prev.filter(item => item.date === dateStr);
          const existingItem = existingItemsForDate[i];

          items.push({
            id: `${dateStr}-${time}`,
            date: dateStr,
            dateDisplay: `${dayName} ${dayNum}`,
            time,
            prompt: existingItem?.prompt || '',
            isGenerating: existingItem?.isGenerating || false,
            isGenerated: existingItem?.isGenerated || false,
          });
        }
      }

      return items;
    });
  };

  const addTimeSlot = () => {
    if (timeSlots.length < 50) {
      setPostsPerDay(postsPerDay + 1);
    }
  };

  const removeTimeSlot = () => {
    if (timeSlots.length > 1) {
      setPostsPerDay(postsPerDay - 1);
    }
  };

  const handlePromptChange = (id: string, prompt: string) => {
    setScheduleItems(prev => prev.map(item =>
      item.id === id ? { ...item, prompt, isGenerated: false } : item
    ));
  };

  // Handle time change for individual row
  const handleRowTimeChange = (itemId: string, newTime: string) => {
    setScheduleItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, id: `${item.date}-${newTime}`, time: newTime } : item
    ));
  };

  const handleAIGenerate = async (itemId: string) => {
    if (!hasAISystem) {
      toast.error(t('bulkFill.aiNotConfigured'));
      return;
    }

    // Mark as generating
    setScheduleItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, isGenerating: true } : item
    ));

    try {
      const result = await api.generateChannelInspiredPrompt(
        channel.id,
        channel.example_prompts![Math.floor(Math.random() * channel.example_prompts!.length)].id
      );

      setScheduleItems(prev => prev.map(item =>
        item.id === itemId ? {
          ...item,
          prompt: result.generated_prompt,
          isGenerating: false,
          isGenerated: true,
        } : item
      ));

      toast.success(t('bulkFill.promptGenerated'));
    } catch (error: any) {
      setScheduleItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, isGenerating: false } : item
      ));
      toast.error(error?.message || t('bulkFill.generateFailed'));
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate) {
      toast.error(t('bulkFill.fillAllPrompts'));
      return;
    }

    setLoading(true);

    try {
      // Create queue items
      const items = scheduleItems.map(item => {
        const [hour, minute] = item.time.split(':');
        const date = new Date(item.date);
        date.setHours(parseInt(hour), parseInt(minute), 0, 0);

        return {
          channel_id: channel.id,
          scheduled_time: date.toISOString(),
          prompt: item.prompt,
          variable_values: {},
        };
      });

      onGenerate(items);
      onClose();
      toast.success(t('bulkFill.scheduled', { count: items.length }));
      // fetchQueue takes an options object — pass `channel_id` so we refresh
      // only this channel's slots, not the whole queue.
      fetchQueue({ channel_id: channel.id });
    } catch (error: any) {
      console.error('Generate error:', error);
      toast.error(error?.message || t('bulkFill.scheduleFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Schedule Content
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col space-y-4">
          {/* Stats */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
              {selectedDates.size} days
            </Badge>
            <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
              {postsPerDay} posts/day
            </Badge>
            <Badge variant="secondary" className="bg-green-500/10 text-green-400 border-green-500/30">
              {totalSlots} total
            </Badge>
            <Badge variant="secondary" className={filledSlots === totalSlots
              ? "bg-green-500/10 text-green-400 border-green-500/30"
              : "bg-red-500/10 text-red-400 border-red-500/30"
            }>
              {filledSlots}/{totalSlots} filled
            </Badge>
            {aiGeneratedSlots > 0 && (
              <Badge variant="secondary" className="bg-purple-500/10 text-purple-400 border-purple-500/30">
                <Sparkles className="h-3 w-3 mr-1" />
                {aiGeneratedSlots} AI
              </Badge>
            )}
          </div>

          {/* Posts per day slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Posts per day</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={removeTimeSlot}
                  disabled={postsPerDay <= 1}
                  className="h-7 w-7 p-0"
                >
                  -
                </Button>
                <span className="text-lg font-bold text-primary w-8 text-center">{postsPerDay}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTimeSlot}
                  disabled={postsPerDay >= 50}
                  className="h-7 w-7 p-0"
                >
                  +
                </Button>
              </div>
            </div>
            <Slider
              value={[postsPerDay]}
              onValueChange={([value]) => setPostsPerDay(value)}
              min={1}
              max={50}
              step={1}
              className="py-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1</span>
              <span>10</span>
              <span>20</span>
              <span>30</span>
              <span>40</span>
              <span>50</span>
            </div>
          </div>

          {/* Time slots editor */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Post times ({timeSlots.length} slots)</Label>
            <div className="overflow-x-auto pb-2">
              <div className="flex gap-3 min-w-max">
                {timeSlots.map((time, index) => (
                  <div key={index} className="flex items-center gap-1 bg-muted/30 rounded px-2 py-1">
                    <span className="text-xs text-muted-foreground">#{index + 1}</span>
                    <TimePicker
                      value={time}
                      onChange={(newTime) => handleTimeChange(index, newTime)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Schedule Items Table */}
          <div className="flex-1 border rounded-lg overflow-hidden flex flex-col min-h-0">
            <div className="bg-muted/50 px-3 py-2 border-b flex items-center justify-between">
              <span className="text-sm font-medium">Schedule Items</span>
              {hasAISystem && (
                <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-xs">
                  <Sparkles className="h-3 w-3 mr-1" />
                  AI Ready (5 credits/prompt)
                </Badge>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 w-16">#</th>
                    <th className="text-left px-3 py-2 w-24">Date</th>
                    <th className="text-left px-3 py-2 w-36">Time</th>
                    <th className="text-left px-3 py-2">Prompt</th>
                    {hasAISystem && (
                      <th className="text-center px-3 py-2 w-16">AI</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {scheduleItems.map((item, index) => (
                    <tr key={item.id} className="border-b hover:bg-muted/20">
                      <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                      <td className="px-3 py-2 font-medium">{item.dateDisplay}</td>
                      <td className="px-3 py-2">
                        <TimePicker
                          value={item.time}
                          onChange={(newTime) => handleRowTimeChange(item.id, newTime)}
                        />
                      </td>
                      <td className="px-3 py-1">
                        <Textarea
                          value={item.prompt}
                          onChange={(e) => handlePromptChange(item.id, e.target.value)}
                          placeholder={t('bulkFill.enterPrompt')}
                          className={`min-h-[60px] text-xs resize-none ${
                            item.isGenerated ? 'border-purple-500/50 bg-purple-500/5' : ''
                          }`}
                        />
                      </td>
                      {hasAISystem && (
                        <td className="px-3 py-2 text-center">
                          {item.isGenerating ? (
                            <Loader2 className="h-5 w-5 animate-spin text-purple-400 mx-auto" />
                          ) : item.isGenerated ? (
                            <Check className="h-5 w-5 text-green-400 mx-auto" />
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleAIGenerate(item.id)}
                              className="h-8 w-8 p-0 hover:bg-purple-500/20"
                              title={t('bulkFill.generateAI')}
                            >
                              <Bot className="h-4 w-4 text-purple-400" />
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Preview */}
          {emptySlots > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0" />
              <p className="text-sm text-amber-300">
                {emptySlots} slots still need prompts. Fill all prompts to generate.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={loading || !canGenerate}
            className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              `Create ${totalSlots} Items`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkFillModal;
