import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogFooter } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScheduler } from '@/contexts/SchedulerContext';
import { Loader2, Play, Image as ImageIcon, Film, Calendar, X, Download, CheckSquare, Square, ArrowLeft, Trash2, Tv, ChevronRight, FolderInput } from 'lucide-react';
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
import LazyVideo from '@/components/ui/LazyVideo';
import { toast } from 'sonner';
import type { ContentHistoryItem } from '@/types/scheduler';

const LIMIT = 50;

interface HistoryTabProps {
  defaultType?: 'all' | 'image' | 'video';
}

const HistoryTab = ({ defaultType = 'all' }: HistoryTabProps = {}) => {
  const { t, language } = useLanguage();
  const l = (th: string, en: string) => language === 'th' ? th : en;
  const { channels, setCurrentChannel } = useScheduler();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  // Read channel_id from URL params (e.g. /app/history?channel_id=5)
  const urlChannelId = searchParams.get('channel_id');
  const isActive = location.pathname.includes('/history') || location.pathname.includes('/images') || location.pathname.includes('/videos');

  const [items, setItems] = useState<ContentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0); // ref so fetchHistory doesn't need offset as dep

  // Filters — init channelFilter from URL param if present
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video'>(defaultType);
  const [sourceFilter, setSourceFilter] = useState<
    | 'all'
    | 'viral_image'
    | 'viral_scene_video'
    | 'viral_final_video'
    | 'idol_image'
    | 'idol_scene_video'
    | 'idol_final_video'
    | 'gpt_image_2'
    | 'kling_3_motion_control'
  >('all');
  const [channelFilter, setChannelFilter] = useState<number | undefined>(
    urlChannelId ? Number(urlChannelId) : undefined
  );
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveTargetChannelId, setMoveTargetChannelId] = useState<number | ''>('');

  // Preview
  const [previewItem, setPreviewItem] = useState<ContentHistoryItem | null>(null);
  const [showVideoMenu, setShowVideoMenu] = useState(false);
  const videoMenuRef = useRef<HTMLDivElement>(null);
  const [showImageMenu, setShowImageMenu] = useState(false);
  const imageMenuRef = useRef<HTMLDivElement>(null);

  const fetchHistory = useCallback(async (reset = false) => {
    // Use ref for offset to avoid stale closure without adding offset to deps
    const newOffset = reset ? 0 : offsetRef.current;
    if (reset) setLoading(true); else setLoadingMore(true);

    try {
      const data = await api.getContentHistory({
        type: typeFilter === 'all' ? undefined : typeFilter,
        source: sourceFilter === 'all' ? undefined : sourceFilter,
        channel_id: channelFilter,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: LIMIT,
        offset: newOffset,
      });
      if (reset) {
        setItems(data.items);
        offsetRef.current = data.items.length;
        setOffset(data.items.length);
        setSelectedIds(new Set());
      } else {
        setItems(prev => [...prev, ...data.items]);
        offsetRef.current = newOffset + data.items.length;
        setOffset(newOffset + data.items.length);
      }
      setTotal(data.total);
    } catch (error) {
      console.error('Failed to fetch content history:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [typeFilter, sourceFilter, channelFilter, dateFrom, dateTo]); // offset removed — handled via offsetRef

  // Close video menu on click outside
  useEffect(() => {
    if (!showVideoMenu) return;
    const handler = (e: MouseEvent) => {
      if (videoMenuRef.current && !videoMenuRef.current.contains(e.target as Node)) {
        setShowVideoMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showVideoMenu]);

  // Close image menu on click outside
  useEffect(() => {
    if (!showImageMenu) return;
    const handler = (e: MouseEvent) => {
      if (imageMenuRef.current && !imageMenuRef.current.contains(e.target as Node)) {
        setShowImageMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showImageMenu]);

  // Scroll to content & sync filter when entering history tab or channel changes
  useEffect(() => {
    if (isActive) {
      if (urlChannelId) {
        setChannelFilter(Number(urlChannelId));
      }
      setTimeout(() => {
        containerRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
      }, 100);
    }
  }, [isActive, location.search]);

  // Re-fetch on filter change
  useEffect(() => {
    fetchHistory(true);
  }, [typeFilter, sourceFilter, channelFilter, dateFrom, dateTo]);

  const loadMore = () => {
    fetchHistory(false);
  };

  const hasMore = offset < total;

  // Selection handlers
  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
      return newSet;
    });
  };

  const selectAll = () => {
    if (selectedIds.size > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };

  // Download a single item
  const downloadItem = async (item: ContentHistoryItem, e?: React.MouseEvent, silent = false) => {
    if (e) e.stopPropagation();
    try {
      const ext = item.type === 'image' ? 'png' : 'mp4';
      const name = item.character_name || item.source;
      const filename = `${name}_${item.id}.${ext}`;
      if (!silent) toast.loading(l('กำลังดาวน์โหลด...', 'Downloading...'), { id: `dl-${item.id}`, duration: 30000 });
      await api.downloadViaProxy(item.url, filename);
      if (!silent) toast.success(l('ดาวน์โหลดสำเร็จ', 'Download complete'), { id: `dl-${item.id}` });
    } catch (error: any) {
      console.error('Download failed:', error);
      toast.error(error?.message || l('ดาวน์โหลดล้มเหลว', 'Download failed'), { id: `dl-${item.id}` });
      throw error;
    }
  };

  // Click Download button → if multiple, show confirm dialog first
  const downloadSelected = () => {
    const selected = items.filter(i => selectedIds.has(i.id));
    if (selected.length === 0) return;
    if (selected.length === 1) {
      // Single file → download directly, no prompt needed
      startBatchDownload();
    } else {
      setShowDownloadConfirm(true);
    }
  };

  // Actually start the batch download (called after confirm dialog)
  const startBatchDownload = async () => {
    const selected = items.filter(i => selectedIds.has(i.id));
    if (selected.length === 0) return;
    setShowDownloadConfirm(false);
    setDownloading(true);
    let success = 0;
    let failed = 0;
    const toastId = 'batch-dl';
    toast.loading(l(`กำลังดาวน์โหลด 0/${selected.length}...`, `Downloading 0/${selected.length}...`), { id: toastId, duration: 60000 });
    for (let i = 0; i < selected.length; i++) {
      try {
        await downloadItem(selected[i], undefined, true);
        success++;
      } catch {
        failed++;
      }
      toast.loading(l(`กำลังดาวน์โหลด ${i + 1}/${selected.length}...`, `Downloading ${i + 1}/${selected.length}...`), { id: toastId, duration: 60000 });
      if (i < selected.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    if (failed === 0) {
      toast.success(l(`ดาวน์โหลดสำเร็จ ${success} ไฟล์`, `Downloaded ${success} files`), { id: toastId });
    } else {
      toast.warning(l(`ดาวน์โหลดสำเร็จ ${success} ไฟล์, ล้มเหลว ${failed} ไฟล์`, `Downloaded ${success} files, ${failed} failed`), { id: toastId });
    }
    setDownloading(false);
  };

  // Confirm move
  const handleMoveSelected = async () => {
    if (typeof moveTargetChannelId !== 'number') {
      toast.error(l('กรุณาเลือกช่องปลายทาง', 'Please select a target channel'));
      return;
    }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setMoving(true);
    try {
      const result = await api.moveContentHistory(ids, moveTargetChannelId);
      toast.success(l(`ย้ายสำเร็จ ${result.moved} รายการ`, `Moved ${result.moved} items`));
      setShowMoveDialog(false);
      setMoveTargetChannelId('');
      setSelectedIds(new Set());
      await fetchHistory(true);
    } catch (error: any) {
      toast.error(error?.message || l('ย้ายไม่สำเร็จ', 'Move failed'));
    } finally {
      setMoving(false);
    }
  };

  // Confirm delete
  const handleDeleteSelected = async () => {
    setShowDeleteConfirm(false);
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const result = await api.deleteContentHistory(ids);
      toast.success(l(`ลบสำเร็จ ${result.deleted} รายการ`, `Deleted ${result.deleted} items`));
      setSelectedIds(new Set());
      await fetchHistory(true);
    } catch (error: any) {
      toast.error(error?.message || l('ลบไม่สำเร็จ', 'Delete failed'));
    } finally {
      setDeleting(false);
    }
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'viral_image': return t('historyTab.sourceViralImage');
      case 'viral_scene_video': return t('historyTab.sourceViralVideo');
      case 'viral_final_video': return t('historyTab.sourceViralFinal');
      case 'schedule_queue': return t('historyTab.sourceSchedule');
      case 'gpt_image_2': return 'GPT Image 2';
      case 'kling_3_motion_control': return 'Kling 3.0';
      default: return source;
    }
  };

  const getSourceColor = (source: string) => {
    // 3 group palettes — all warm/gold-aligned to fit the brand theme:
    //   IMAGES  → yellow/amber spectrum (cool-warm, lighter)
    //   VIDEOS  → orange/red-amber spectrum (hot-warm, deeper)
    //   POSTED  → signature brand gold #FFB300 (the "shipped" badge)
    switch (source) {
      // ─── IMAGES (yellow / amber) ───────────────────────────────
      case 'viral_image':
        // Soft yellow
        return 'bg-gradient-to-r from-yellow-400/25 to-yellow-300/25 text-yellow-100 border border-yellow-300/40 shadow-[0_0_8px_rgba(250,204,21,0.25)]';
      case 'idol_image':
        // Warm amber
        return 'bg-gradient-to-r from-amber-400/30 to-yellow-400/25 text-amber-50 border border-amber-300/40 shadow-[0_0_8px_rgba(251,191,36,0.25)]';
      case 'gpt_image_2':
        // Bright honey-gold (signature image AI tool)
        return 'bg-gradient-to-r from-yellow-300/35 to-amber-400/35 text-yellow-50 border border-yellow-300/55 shadow-[0_0_10px_rgba(253,224,71,0.35)]';

      // ─── VIDEOS (orange / red-amber) ──────────────────────────
      case 'viral_scene_video':
        // Soft orange
        return 'bg-gradient-to-r from-orange-400/25 to-orange-300/25 text-orange-100 border border-orange-300/40 shadow-[0_0_8px_rgba(251,146,60,0.25)]';
      case 'viral_final_video':
        // Deep orange (final = stronger)
        return 'bg-gradient-to-r from-orange-500/35 to-orange-400/30 text-orange-50 border border-orange-400/55 shadow-[0_0_10px_rgba(249,115,22,0.35)]';
      case 'idol_scene_video':
        // Warm red-orange
        return 'bg-gradient-to-r from-orange-500/30 to-red-400/25 text-orange-100 border border-orange-400/45 shadow-[0_0_8px_rgba(249,115,22,0.3)]';
      case 'idol_final_video':
        // Deeper red-orange (final)
        return 'bg-gradient-to-r from-red-500/30 to-orange-500/35 text-orange-50 border border-red-400/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]';
      case 'kling_3_motion_control':
        // Vivid orange-amber (signature video AI tool)
        return 'bg-gradient-to-r from-[#FF8C00]/40 to-orange-400/35 text-orange-50 border border-[#FF8C00]/60 shadow-[0_0_10px_rgba(255,140,0,0.4)]';

      // ─── POSTED (brand gold) ──────────────────────────────────
      case 'schedule_queue':
        return 'bg-gradient-to-r from-[#FFB300]/45 to-[#FF8C00]/40 text-[#FFE3A3] border border-[#FFB300]/70 shadow-[0_0_12px_rgba(255,179,0,0.5)]';

      default:
        return 'bg-amber-500/15 text-amber-100/80 border border-amber-400/20';
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const clearDateFilters = () => {
    setDateFrom('');
    setDateTo('');
  };

  // Find channel name when filtered by URL param
  const filteredChannelName = urlChannelId
    ? channels.find(c => c.id === Number(urlChannelId))?.name || `Channel #${urlChannelId}`
    : null;

  const fromGen = searchParams.get('from') === 'gen';

  const handleBackToChannels = () => {
    if (fromGen && urlChannelId) {
      navigate(`/app/channels?open_gen=${urlChannelId}`, { replace: true });
    } else {
      navigate(-1);
    }
  };

  const handleClearChannelFilter = () => {
    setChannelFilter(undefined);
    navigate('/app/history', { replace: true });
  };

  return (
    <div ref={containerRef} className="space-y-4 scroll-mt-4">
      {/* Back bar — shown when navigated from a channel */}
      {urlChannelId && filteredChannelName && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
          <Button variant="ghost" size="sm" onClick={handleBackToChannels} className="gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {t('viral.back')}
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="flex-1">
            <span className="text-sm font-medium">{filteredChannelName}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleClearChannelFilter} className="text-xs text-muted-foreground hover:text-foreground gap-1">
            <X className="h-3.5 w-3.5" />
            {t('historyTab.filterAll')}
          </Button>
        </div>
      )}

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold">{t('historyTab.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('historyTab.subtitle')}</p>
      </div>

      {/* Retention notice */}
      <div className="flex items-start gap-2 rounded-[25px] border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        <span>⚠️</span>
        <span>ไฟล์ทั้งหมดจะถูกจัดเก็บไว้ 30 วัน หลังจากนั้นจะถูกลบออกโดยอัตโนมัติ กรุณาดาวน์โหลดไฟล์ที่ต้องการเก็บไว้ก่อนหมดอายุ</span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Type filter — same style as main nav TabsList */}
        <div className="inline-flex h-10 items-center rounded-[25px] bg-muted border border-border p-1">
          <button
            onClick={() => { setTypeFilter('all'); setSourceFilter('all'); }}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all ${
              typeFilter === 'all'
                ? 'bg-background text-[#FFB300] shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('historyTab.filterAll')}
          </button>
          <div className="relative" ref={imageMenuRef}>
            <button
              onClick={() => setShowImageMenu(v => !v)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all cursor-pointer ${
                typeFilter === 'image'
                  ? 'bg-background text-[#FFB300] shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {typeFilter === 'image' && sourceFilter === 'viral_image' ? 'Viral'
                : typeFilter === 'image' && sourceFilter === 'idol_image' ? 'Idol'
                : typeFilter === 'image' && sourceFilter === 'gpt_image_2' ? 'GPT Image 2'
                : t('historyTab.filterImages')}
              <svg className={`h-3 w-3 transition-transform ${showImageMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showImageMenu && (
              <div className="absolute top-full left-0 mt-1.5 min-w-[160px] rounded-xl bg-background border border-border shadow-xl py-1 z-30">
                {([
                  { key: 'all' as const, label: t('historyTab.filterAll') },
                  { key: 'viral_image' as const, label: 'Viral' },
                  { key: 'idol_image' as const, label: 'Idol' },
                  { key: 'gpt_image_2' as const, label: 'GPT Image 2' },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setTypeFilter('image');
                      setSourceFilter(key);
                      setShowImageMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      typeFilter === 'image' && sourceFilter === key
                        ? 'text-[#FFB300] font-medium bg-[#FFB300]/10'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative" ref={videoMenuRef}>
            <button
              onClick={() => setShowVideoMenu(v => !v)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all cursor-pointer ${
                typeFilter === 'video'
                  ? 'bg-background text-[#FFB300] shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              {typeFilter === 'video' && sourceFilter === 'viral_final_video' ? t('historyTab.sourceViralFinal')
                : typeFilter === 'video' && sourceFilter === 'viral_scene_video' ? 'Viral - VDO Scene'
                : typeFilter === 'video' && sourceFilter === 'idol_final_video' ? 'Idol - ต่อแล้ว'
                : typeFilter === 'video' && sourceFilter === 'idol_scene_video' ? 'Idol - VDO Scene'
                : typeFilter === 'video' && sourceFilter === 'kling_3_motion_control' ? 'Kling 3.0'
                : t('historyTab.filterVideos')}
              <svg className={`h-3 w-3 transition-transform ${showVideoMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showVideoMenu && (
              <div className="absolute top-full left-0 mt-1.5 min-w-[180px] rounded-xl bg-background border border-border shadow-xl py-1 z-30">
                {([
                  { key: 'all' as const, label: t('historyTab.filterAll') },
                  { key: 'viral_final_video' as const, label: 'Viral - ต่อแล้ว' },
                  { key: 'viral_scene_video' as const, label: 'Viral - VDO Scene' },
                  { key: 'idol_final_video' as const, label: 'Idol - ต่อแล้ว' },
                  { key: 'idol_scene_video' as const, label: 'Idol - VDO Scene' },
                  { key: 'kling_3_motion_control' as const, label: 'Kling 3.0' },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setTypeFilter('video');
                      setSourceFilter(key);
                      setShowVideoMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      typeFilter === 'video' && sourceFilter === key
                        ? 'text-[#FFB300] font-medium bg-[#FFB300]/10'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Channel filter */}
        <select
          value={channelFilter ?? ''}
          onChange={(e) => setChannelFilter(e.target.value ? Number(e.target.value) : undefined)}
          className="h-8 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
        >
          <option value="">{t('historyTab.allChannels')}</option>
          {channels.map((ch) => (
            <option key={ch.id} value={ch.id}>{ch.name}</option>
          ))}
        </select>

        {/* Date filters */}
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
            placeholder={t('historyTab.dateFrom')}
          />
          <span className="text-muted-foreground text-xs">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
          />
          {(dateFrom || dateTo) && (
            <button onClick={clearDateFilters} className="p-1 rounded hover:bg-muted">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Toolbar: count + selection actions */}
      {!loading && items.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total} {t('historyTab.items')}
            {selectedIds.size > 0 && ` — ${t('history.selected')} ${selectedIds.size}`}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={selectAll}>
              {selectedIds.size > 0 ? <CheckSquare className="h-4 w-4 mr-1" /> : <Square className="h-4 w-4 mr-1" />}
              {selectedIds.size > 0 ? t('history.deselectAll') : t('history.selectAll')}
            </Button>
            {selectedIds.size > 0 && (
              <>
                <Button size="sm" onClick={downloadSelected} disabled={downloading || deleting || moving}>
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
                  {t('history.download')} ({selectedIds.size})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setMoveTargetChannelId(''); setShowMoveDialog(true); }}
                  disabled={downloading || deleting || moving}
                  className="text-[#FFB300] border-[#FFB300]/40 hover:bg-[#FFB300]/10"
                >
                  {moving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FolderInput className="h-4 w-4 mr-1" />}
                  {l('ย้ายไปช่องอื่น', 'Move to channel')} ({selectedIds.size})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={downloading || deleting || moving}
                  className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                  {l('ลบ', 'Delete')} ({selectedIds.size})
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <Film className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium text-muted-foreground">{t('historyTab.empty')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('historyTab.emptyDesc')}</p>
        </div>
      ) : (
        <>
          <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 space-y-3">
            {items.map((item) => {
              const isImage = item.type === 'image';
              const isKling3 = item.source === 'kling_3_motion_control';
              const isPortrait =
                item.aspect_ratio === 'portrait' ||
                item.aspect_ratio === '9:16' ||
                item.aspect_ratio === '3:4';
              const isSelected = selectedIds.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`relative break-inside-avoid mb-3 rounded-lg overflow-hidden bg-muted cursor-pointer group ${
                    !isImage && !isKling3 ? (isPortrait ? 'aspect-[9/16]' : 'aspect-video') : ''
                  } ${isSelected ? 'ring-2 ring-primary' : ''}`}
                  onClick={() => setPreviewItem(item)}
                >
                  {isImage ? (
                    <img
                      src={item.url}
                      alt={item.character_name || ''}
                      className="block w-full h-auto"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const placeholder = e.currentTarget.nextElementSibling as HTMLElement;
                        if (placeholder) placeholder.style.display = 'flex';
                      }}
                    />
                  ) : isKling3 ? (
                    <video
                      src={item.url}
                      className="block w-full h-auto"
                      muted
                      playsInline
                      preload="metadata"
                      onError={(e) => {
                        (e.currentTarget as HTMLVideoElement).style.display = 'none';
                        const placeholder = (e.currentTarget as HTMLVideoElement).nextElementSibling as HTMLElement;
                        if (placeholder) placeholder.style.display = 'flex';
                      }}
                    />
                  ) : (
                    <LazyVideo
                      src={item.url}
                      thumbnailUrl={item.thumbnail_url}
                      onError={(e) => {
                        (e.currentTarget as HTMLVideoElement).style.display = 'none';
                        const placeholder = (e.currentTarget as HTMLVideoElement).parentElement?.nextElementSibling as HTMLElement;
                        if (placeholder) placeholder.style.display = 'flex';
                      }}
                    />
                  )}
                  {/* Placeholder for expired URLs */}
                  <div className="absolute inset-0 items-center justify-center bg-muted text-muted-foreground text-xs" style={{ display: 'none' }}>
                    {isImage ? 'Image expired' : 'Video expired'}
                  </div>

                  {/* Hover overlay for videos */}
                  {!isImage && (
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <div className="p-2 rounded-full bg-white/20">
                        <Play className="h-6 w-6 text-white fill-white" />
                      </div>
                    </div>
                  )}

                  {/* Select checkbox (top-left) */}
                  <div className="absolute top-1.5 left-1.5 z-10" onClick={(e) => toggleSelect(item.id, e)}>
                    {isSelected ? (
                      <CheckSquare className="h-5 w-5 text-primary drop-shadow" />
                    ) : (
                      <Square className="h-5 w-5 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity drop-shadow cursor-pointer" />
                    )}
                  </div>

                  {/* Download button (top-left, next to checkbox) */}
                  <button
                    className="absolute top-1.5 left-8 z-10 p-0.5 rounded bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                    onClick={(e) => downloadItem(item, e)}
                    title={t('history.download')}
                  >
                    <Download className="h-4 w-4 text-white" />
                  </button>

                  {/* Source badge (top-right) — themed gradient pill */}
                  <div className="absolute top-1.5 right-1.5 z-10">
                    <span
                      className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full backdrop-blur-sm ${getSourceColor(item.source)}`}
                    >
                      {getSourceLabel(item.source)}
                    </span>
                  </div>

                  {/* Bottom info */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2.5 pt-7">
                    <p className="text-[10px] font-medium text-white/70 drop-shadow-md pointer-events-none">
                      {formatDate(item.created_at)}
                    </p>
                    {item.channel_name && item.channel_id ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const channel = channels.find((c) => c.id === item.channel_id);
                          if (channel) {
                            setCurrentChannel(channel);
                            navigate('/app/schedule');
                          }
                        }}
                        className="group/ch w-full flex items-center gap-1 text-left rounded-md px-1.5 py-1 -mx-1 hover:bg-[#FFB300]/15 transition-colors cursor-pointer"
                        title={`ดูช่อง ${item.channel_name}`}
                      >
                        <Tv className="h-3 w-3 text-[#FFB300] shrink-0" />
                        <span className="text-[12px] font-bold text-white truncate group-hover/ch:text-[#FFB300] transition-colors drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] flex-1">
                          {item.channel_name}
                        </span>
                        <ChevronRight className="h-3 w-3 text-white/50 group-hover/ch:text-[#FFB300] group-hover/ch:translate-x-0.5 transition-all shrink-0" />
                      </button>
                    ) : item.channel_name ? (
                      <p className="flex items-center gap-1 text-[12px] font-bold text-white truncate drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] pointer-events-none">
                        <Tv className="h-3 w-3 text-white/60 shrink-0" />
                        <span className="truncate">{item.channel_name}</span>
                      </p>
                    ) : null}
                    {item.character_name && (
                      <p className="text-[10px] text-gray-400 truncate pointer-events-none">{item.character_name}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Infinite scroll trigger */}
          {hasMore && (
            <InfiniteScrollTrigger onVisible={loadMore} loading={loadingMore} />
          )}
        </>
      )}

      {/* Download Confirm Dialog */}
      <Dialog open={showDownloadConfirm} onOpenChange={setShowDownloadConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{l('ดาวน์โหลดหลายไฟล์', 'Download Multiple Files')}</DialogTitle>
            <DialogDescription>
              {l(`กำลังจะดาวน์โหลด ${selectedIds.size} ไฟล์`, `Downloading ${selectedIds.size} files`)}
            </DialogDescription>
          </DialogHeader>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-300">
            <p className="font-medium mb-1">⚠️ {l('กรุณาอ่านก่อนเริ่ม', 'Please read before starting')}</p>
            <p className="text-xs text-amber-200/80 leading-relaxed">
              {l(
                'เบราเซอร์จะขออนุญาตให้ดาวน์โหลดหลายไฟล์ กรุณากดปุ่ม "Allow" หรือ "อนุญาต" ที่เบราเซอร์ถาม มิฉะนั้นไฟล์จะถูกดาวน์โหลดเพียงไฟล์เดียว',
                'Your browser will ask permission to download multiple files. Please click "Allow" when prompted, otherwise only one file will be downloaded.'
              )}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDownloadConfirm(false)}>
              {l('ยกเลิก', 'Cancel')}
            </Button>
            <Button onClick={startBatchDownload} className="bg-[#FFB300] text-black hover:bg-[#FFB300]/90">
              <Download className="h-4 w-4 mr-1" />
              {l('เริ่มดาวน์โหลด', 'Start Download')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{l('ลบรายการที่เลือก', 'Delete Selected Items')}</AlertDialogTitle>
            <AlertDialogDescription>
              {l(
                `ต้องการลบ ${selectedIds.size} รายการที่เลือก? การกระทำนี้ไม่สามารถย้อนกลับได้`,
                `Delete ${selectedIds.size} selected items? This action cannot be undone.`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{l('ยกเลิก', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteSelected(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
              {l('ลบ', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move Dialog */}
      <Dialog open={showMoveDialog} onOpenChange={(open) => { if (!moving) setShowMoveDialog(open); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{l('ย้ายคลิปไปช่องอื่น', 'Move Clips to Another Channel')}</DialogTitle>
            <DialogDescription>
              {l(
                `กำลังจะย้าย ${selectedIds.size} รายการไปช่องที่เลือก`,
                `Moving ${selectedIds.size} items to the selected channel`
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Target channel select */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                {l('ช่องปลายทาง', 'Target Channel')}
              </label>
              <select
                value={moveTargetChannelId}
                onChange={(e) => setMoveTargetChannelId(e.target.value ? Number(e.target.value) : '')}
                disabled={moving}
                className="w-full h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
              >
                <option value="">{l('— เลือกช่อง —', '— Select channel —')}</option>
                {channels
                  .filter((ch) => ch.id !== channelFilter)
                  .map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
              </select>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200/90 leading-relaxed">
              {l(
                'หลังย้าย คลิปจะหายจากช่องเดิมและไปแสดงในช่องปลายทาง — คลิปอื่นในงานเดียวกันไม่ได้รับผลกระทบ',
                'After moving, clips will disappear from the source channel and appear in the target — sibling clips in the same task are not affected.'
              )}
            </div>

            {/* Selected clip preview — placed at bottom, grid layout */}
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">
                {l(`คลิปที่จะย้าย (${selectedIds.size})`, `Clips to move (${selectedIds.size})`)}
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[420px] overflow-y-auto pr-1">
                {items.filter((it) => selectedIds.has(it.id)).map((it) => {
                  const isImage = it.type === 'image';
                  const thumb = it.thumbnail_url || it.url;
                  return (
                    <div
                      key={it.id}
                      className="relative aspect-[3/4] rounded-lg overflow-hidden bg-muted border border-border group"
                      title={it.character_name || it.source}
                    >
                      {isImage ? (
                        <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <video
                          src={it.url}
                          className="w-full h-full object-cover"
                          autoPlay
                          loop
                          muted
                          playsInline
                          preload="metadata"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            next.delete(it.id);
                            return next;
                          });
                        }}
                        disabled={moving}
                        className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/70 hover:bg-red-500/90 text-white opacity-0 group-hover:opacity-100 transition-opacity z-10"
                        title={l('เอาออก', 'Remove')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-2 pt-6 pb-2">
                        <p className="text-xs text-white truncate font-medium drop-shadow-md">
                          {it.character_name || getSourceLabel(it.source)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowMoveDialog(false)} disabled={moving}>
              {l('ยกเลิก', 'Cancel')}
            </Button>
            <Button
              onClick={handleMoveSelected}
              disabled={moving || typeof moveTargetChannelId !== 'number' || selectedIds.size === 0}
              className="bg-[#FFB300] text-black hover:bg-[#FFB300]/90"
            >
              {moving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FolderInput className="h-4 w-4 mr-1" />}
              {l('ย้าย', 'Move')} ({selectedIds.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewItem} onOpenChange={(open) => { if (!open) setPreviewItem(null); }}>
        <DialogContent className={`p-0 border-none bg-black/95 ${
          previewItem?.type === 'image'
            ? 'max-w-3xl'
            : previewItem?.source === 'kling_3_motion_control'
              ? 'max-w-[480px]'
              : previewItem?.aspect_ratio === 'portrait'
                ? 'max-w-[360px]'
                : 'max-w-4xl'
        }`}>
          <DialogTitle className="sr-only">Preview</DialogTitle>
          {previewItem?.type === 'image' ? (
            <img
              src={previewItem.url}
              alt={previewItem.character_name || ''}
              className="w-full max-h-[85vh] object-contain rounded-lg"
            />
          ) : previewItem?.url ? (
            <video
              src={previewItem.url}
              className="w-full max-h-[85vh] object-contain rounded-lg"
              controls
              autoPlay
              playsInline
              preload="metadata"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Infinite scroll trigger using IntersectionObserver
function InfiniteScrollTrigger({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (loading || !ref.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) onVisible();
    }, { rootMargin: '200px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [loading, onVisible]);
  return (
    <div ref={ref} className="flex justify-center py-6">
      {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
    </div>
  );
}

export default HistoryTab;
