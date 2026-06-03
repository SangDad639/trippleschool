import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowLeft, Loader2, Play, Download, CheckSquare, Square, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ScheduleQueueItem } from '@/types/scheduler';
import LazyVideo from '@/components/ui/LazyVideo';

const History = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useLanguage();

  const channelId = searchParams.get('channel_id');
  const channelName = searchParams.get('channel_name') || `Channel #${channelId}`;

  const [items, setItems] = useState<ScheduleQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedVideo, setSelectedVideo] = useState<ScheduleQueueItem | null>(null);
  const [downloading, setDownloading] = useState(false);
  const PAGE_SIZE = 50;

  const fetchItems = async (loadMore = false) => {
    try {
      if (loadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setOffset(0);
      }
      const currentOffset = loadMore ? offset : 0;
      const params: any = { status: 'done', limit: PAGE_SIZE, offset: currentOffset, include_generate_only: true };
      if (channelId) params.channel_id = Number(channelId);
      const data = await api.getScheduleQueue(params);
      if (loadMore) {
        setItems(prev => [...prev, ...data.items]);
      } else {
        setItems(data.items);
      }
      setTotal(data.total);
      setOffset(currentOffset + data.items.length);
      setHasMore(currentOffset + data.items.length < data.total);
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Infinite scroll
  const loaderRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (loadingMore || !hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        fetchItems(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    if (node) observer.observe(node);
  }, [loadingMore, hasMore, offset]);

  useEffect(() => {
    fetchItems();
  }, [channelId]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    if (selectedIds.size > 0) {
      setSelectedIds(new Set());
    } else {
      const withVideo = items.filter(i => i.video_url).map(i => i.id);
      setSelectedIds(new Set(withVideo));
    }
  };

  const downloadSelected = async () => {
    const selected = items.filter(i => selectedIds.has(i.id) && i.video_url);
    if (selected.length === 0) return;
    setDownloading(true);
    try {
      if (selected.length === 1) {
        // Single file: download directly
        const item = selected[0];
        const downloadUrl = `${api.getApiUrl()}/api/scheduler/queue/download/${item.id}`;
        const response = await fetch(downloadUrl, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        });
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date(item.scheduled_time).toISOString().slice(0, 10);
        a.download = `${channelName}_${date}_${item.id}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // Multiple files: download as zip
        const response = await fetch(`${api.getApiUrl()}/api/scheduler/queue/download-zip`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids: selected.map(i => i.id) }),
        });
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${channelName}_videos.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Failed to download:', error);
    }
    setDownloading(false);
  };

  const [deleting, setDeleting] = useState(false);
  const deleteSelected = async () => {
    const selected = Array.from(selectedIds);
    if (selected.length === 0) return;
    if (!confirm(t('history.deleteConfirm', { count: selected.length }))) return;
    setDeleting(true);
    try {
      await Promise.all(selected.map(id => api.deleteScheduleQueueItem(id)));
      setItems(prev => prev.filter(i => !selectedIds.has(i.id)));
      setSelectedIds(new Set());
      toast.success(t('history.deleted', { count: selected.length }));
    } catch (error) {
      console.error('Failed to delete:', error);
      toast.error('Failed to delete');
    }
    setDeleting(false);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTimeRemaining = (dateStr: string) => {
    const completedAt = new Date(dateStr);
    const expiresAt = new Date(completedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    if (diffMs <= 0) return null;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainHours = hours % 24;
      return { text: `${days}d ${remainHours}h`, urgent: false };
    }
    if (hours > 0) return { text: `${hours}h ${minutes}m`, urgent: hours < 6 };
    return { text: `${minutes}m`, urgent: true };
  };

  const allWithVideo = items.filter(i => i.video_url && getTimeRemaining(i.updated_at || i.scheduled_time) !== null).length;
  const isAllSelected = allWithVideo > 0 && selectedIds.size === allWithVideo;

  return (
    <div className="page-wrapper">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{channelName}</h1>
              <p className="text-muted-foreground">
                {t('history.subtitle')}
              </p>
            </div>
          </div>

          {/* Video retention notice */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[#FFB300]/10 border border-[#FFB300]/20">
            <Download className="h-5 w-5 text-[#FFB300] shrink-0" />
            <div className="flex-1 text-sm">
              <span className="text-[#FFB300] font-medium">{t('scheduler.videoReadyMessage1')}</span>
              <span className="text-muted-foreground ml-1">{t('scheduler.videoReadyMessage2')}</span>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {t('history.empty')}
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {total} {t('history.videos')}
                  {selectedIds.size > 0 && ` — ${t('history.selected')} ${selectedIds.size}`}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAll}
                  >
                    {selectedIds.size > 0 ? <CheckSquare className="h-4 w-4 mr-1" /> : <Square className="h-4 w-4 mr-1" />}
                    {selectedIds.size > 0 ? t('history.deselectAll') : t('history.selectAll')}
                  </Button>
                  {selectedIds.size > 0 && (<>
                    <Button
                      size="sm"
                      onClick={downloadSelected}
                      disabled={downloading}
                    >
                      {downloading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
                      {t('history.download')} ({selectedIds.size})
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={deleteSelected}
                      disabled={deleting}
                      className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                    >
                      {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                      {t('history.delete')} ({selectedIds.size})
                    </Button>
                  </>)}
                </div>
              </div>

              {/* Masonry layout via CSS columns — items stack tightly within each column,
                  no row-alignment gaps from mixed aspect ratios (portrait vs landscape).
                  Order is column-first (col 1 fills top→bottom, then col 2). */}
              <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3">
                {items.map((item) => {
                  const isPortrait = item.aspect_ratio === 'portrait';
                  return (
                    <div
                      key={item.id}
                      className={`relative rounded-lg overflow-hidden bg-muted cursor-pointer group mb-3 break-inside-avoid ${
                        isPortrait ? 'aspect-[9/16]' : 'aspect-video'
                      } ${selectedIds.has(item.id) ? 'ring-2 ring-primary' : ''}`}
                      onClick={() => toggleSelect(item.id)}
                    >
                      {item.video_url ? (
                        <>
                          <LazyVideo
                            src={item.video_url}
                            thumbnailUrl={item.thumbnail_url}
                            className="w-full h-full object-cover"
                            onError={() => {}}
                          />
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                            <button
                              className="p-3 rounded-full bg-white/20 hover:bg-white/30 transition-colors pointer-events-auto"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVideo(item);
                              }}
                            >
                              <Play className="h-8 w-8 text-white fill-white" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Play className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      {/* Select checkbox */}
                      <div className="absolute top-1 left-1">
                        {selectedIds.has(item.id) ? (
                          <CheckSquare className="h-5 w-5 text-primary drop-shadow" />
                        ) : (
                          <Square className="h-5 w-5 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                        )}
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2.5 pt-6 pointer-events-none">
                        <p className="text-xs font-medium text-white drop-shadow-md">{formatDate(item.scheduled_time)}</p>
                        {(() => {
                          const remaining = getTimeRemaining(item.updated_at || item.scheduled_time);
                          if (!remaining) return null;
                          return (
                            <p className={`text-[11px] font-medium mt-0.5 drop-shadow-md ${remaining.urgent ? 'text-red-400' : 'text-yellow-300'}`}>
                              ⏳ {t('history.expiresIn')} {remaining.text}
                            </p>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Infinite scroll trigger */}
              {hasMore && (
                <div ref={loadMoreRef} className="flex justify-center py-6">
                  {loadingMore && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Video Player Dialog */}
      <Dialog open={!!selectedVideo} onOpenChange={(open) => { if (!open) setSelectedVideo(null); }}>
        <DialogContent className={`p-0 border-none bg-black/95 ${
          selectedVideo?.aspect_ratio === 'portrait' ? 'max-w-[360px]' : 'max-w-4xl'
        }`}>
          {selectedVideo?.video_url && (
            <video
              src={selectedVideo.video_url}
              className="w-full rounded-lg"
              controls
              autoPlay
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default History;
