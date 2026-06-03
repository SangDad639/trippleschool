import React, { useEffect, useState } from 'react';
import { RefreshCw, Trash2, Play, AlertCircle, Clock, CheckCircle2, Loader2, Eye, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useScheduler } from '@/contexts/SchedulerContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SchedulerChannel, QueueItem } from '@/types/scheduler';
import { cn } from '@/lib/utils';

interface QueueListProps {
  channel?: SchedulerChannel | null;
}

const STATUS_ICONS = {
  pending: Clock,
  generating: Loader2,
  done: CheckCircle2,
  failed: AlertCircle,
};

const STATUS_COLORS = {
  pending: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  generating: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export const QueueList: React.FC<QueueListProps> = ({ channel }) => {
  const {
    queueItems,
    queueStats,
    loadingQueue,
    fetchQueue,
    fetchQueueStats,
    deleteQueueItem,
    retryQueueItem,
  } = useScheduler();
  const { t, language } = useLanguage();

  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const handlePreview = (item: QueueItem) => {
    setSelectedItem(item);
    setPreviewOpen(true);
  };

  useEffect(() => {
    const params: { channel_id?: number; status?: string } = {};
    if (channel) {
      params.channel_id = channel.id;
    }
    if (statusFilter !== 'all') {
      params.status = statusFilter;
    }
    fetchQueue(params);
    fetchQueueStats(channel?.id);
  }, [channel, statusFilter, fetchQueue, fetchQueueStats]);

  const handleDelete = async (id: number) => {
    if (confirm(t('dashboard.confirmDelete'))) {
      await deleteQueueItem(id);
      fetchQueueStats(channel?.id);
    }
  };

  const handleRetry = async (id: number) => {
    await retryQueueItem(id);
    fetchQueueStats(channel?.id);
  };

  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    const tz = (!channel?.timezone || channel.timezone === 'local')
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : channel.timezone;

    const today = new Date();
    const todayStr = today.toLocaleDateString('en-CA', { timeZone: tz });
    const tomorrowDate = new Date(today);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: tz });
    const dateInTz = date.toLocaleDateString('en-CA', { timeZone: tz });

    let dateStr = date.toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: tz,
    });

    if (dateInTz === todayStr) {
      dateStr = t('dashboard.today');
    } else if (dateInTz === tomorrowStr) {
      dateStr = t('dashboard.tomorrow');
    }

    const timeStr = date.toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });

    return `${dateStr} ${timeStr}`;
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      {queueStats && (
        <div className="grid grid-cols-5 gap-2">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">{t('dashboard.total')}</div>
            <div className="text-2xl font-bold">{queueStats.total}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">{t('dashboard.pending')}</div>
            <div className="text-2xl font-bold text-blue-600">{queueStats.pending}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">{t('dashboard.generating')}</div>
            <div className="text-2xl font-bold text-yellow-600">{queueStats.generating}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">{t('dashboard.done')}</div>
            <div className="text-2xl font-bold text-green-600">{queueStats.done}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">{t('dashboard.failed')}</div>
            <div className="text-2xl font-bold text-red-600">{queueStats.failed}</div>
          </Card>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t('dashboard.queueItems')}</h3>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder={t('dashboard.filterByStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('dashboard.allStatus')}</SelectItem>
            <SelectItem value="pending">{t('dashboard.pending')}</SelectItem>
            <SelectItem value="generating">{t('dashboard.generating')}</SelectItem>
            <SelectItem value="done">{t('dashboard.done')}</SelectItem>
            <SelectItem value="failed">{t('dashboard.failed')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Queue Items */}
      {loadingQueue ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : queueItems.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {t('dashboard.noItems')}
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[400px]">
          <div className="space-y-2 pr-4">
            {queueItems.map((item) => {
              const status = item.status as keyof typeof STATUS_ICONS;
              const StatusIcon = STATUS_ICONS[status] || STATUS_ICONS.pending;
              const statusColor = STATUS_COLORS[status] || STATUS_COLORS.pending;

              return (
                <Card key={item.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={cn('p-2 rounded-full', statusColor)}>
                      <StatusIcon className={cn('h-4 w-4', status === 'generating' && 'animate-spin')} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">
                          {formatDateTime(item.scheduled_time)}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {item.channel_name || `Channel ${item.channel_id}`}
                        </Badge>
                      </div>

                      <p
                        className="text-sm text-muted-foreground truncate cursor-pointer hover:text-foreground"
                        onClick={() => handlePreview(item)}
                        title={t('queue.viewPrompt')}
                      >
                        {item.prompt}
                      </p>

                      {item.error && (
                        <p className="text-xs text-red-500 mt-1">{item.error}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePreview(item)}
                        title={t('queue.viewDetails')}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {item.video_url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(item.video_url, '_blank')}
                          title={t('queue.playVideo')}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                      {item.status === 'failed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRetry(item.id)}
                          title={t('queue.retry')}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}
                      {(item.status === 'pending' || item.status === 'failed') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(item.id)}
                          title={t('queue.delete')}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Prompt Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('dashboard.queueDetails')}</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              {/* Status and time */}
              <div className="flex items-center justify-between">
                <Badge className={STATUS_COLORS[selectedItem.status as keyof typeof STATUS_COLORS]}>
                  {t(`queue.${selectedItem.status}` as any) || selectedItem.status}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {formatDateTime(selectedItem.scheduled_time)}
                </span>
              </div>

              {/* Channel */}
              <div>
                <h4 className="text-sm font-medium mb-1">{t('dashboard.channel')}</h4>
                <p className="text-sm text-muted-foreground">
                  {selectedItem.channel_name || `Channel ${selectedItem.channel_id}`}
                </p>
              </div>

              {/* Prompt */}
              <div>
                <h4 className="text-sm font-medium mb-1">{t('dashboard.prompt')}</h4>
                <p className="text-sm bg-muted/50 p-3 rounded-md whitespace-pre-wrap">
                  {selectedItem.prompt}
                </p>
              </div>

              {/* Variable Values */}
              {selectedItem.variable_values && Object.keys(selectedItem.variable_values).length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-1">{t('dashboard.variables')}</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selectedItem.variable_values).map(([key, value]) => (
                      <Badge key={key} variant="outline" className="text-xs">
                        {'{' + key + '}'}: {value}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Caption */}
              {selectedItem.caption && (
                <div>
                  <h4 className="text-sm font-medium mb-1">{t('dashboard.caption')}</h4>
                  <p className="text-sm bg-muted/50 p-3 rounded-md whitespace-pre-wrap">
                    {selectedItem.caption}
                  </p>
                </div>
              )}

              {/* Video URL */}
              {selectedItem.video_url && (
                <div>
                  <h4 className="text-sm font-medium mb-1">{t('dashboard.video')}</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(selectedItem.video_url, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t('dashboard.openVideo')}
                  </Button>
                </div>
              )}

              {/* Error */}
              {selectedItem.error && (
                <div>
                  <h4 className="text-sm font-medium mb-1 text-red-500">Error</h4>
                  <p className="text-sm bg-red-500/10 p-3 rounded-md text-red-500">
                    {selectedItem.error}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                {selectedItem.status === 'failed' && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      handleRetry(selectedItem.id);
                      setPreviewOpen(false);
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t('dashboard.retry')}
                  </Button>
                )}
                {(selectedItem.status === 'pending' || selectedItem.status === 'failed') && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      handleDelete(selectedItem.id);
                      setPreviewOpen(false);
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('common.delete')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QueueList;
