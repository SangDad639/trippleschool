import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Calendar, CalendarDays, Settings2, LayoutDashboard, Library, User, Users, LogOut, Globe, Film, ChevronLeft, ChevronRight, Headphones, GraduationCap } from 'lucide-react';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { SchedulerProvider, useScheduler } from '@/contexts/SchedulerContext';
import { ChannelList } from '@/components/scheduler/ChannelList';
import { ChannelForm } from '@/components/scheduler/ChannelForm';
import { ScheduleCalendar } from '@/components/scheduler/ScheduleCalendar';
import { DayDetailModal } from '@/components/scheduler/DayDetailModal';
import { DashboardTab } from '@/components/scheduler/DashboardTab';
import { ViralTemplateTab } from '@/components/viral/ViralTemplateTab';
import { IdolTemplateTab } from '@/components/idol/IdolTemplateTab';
import { ImageTemplateTab } from '@/components/image/ImageTemplateTab';
import { AiAgentTab } from '@/components/story-agent/AiAgentTab';
import HistoryTab from '@/components/scheduler/HistoryTab';
import ImageGallery from '@/components/scheduler/ImageGallery';
import VideoGallery from '@/components/scheduler/VideoGallery';
import Courses from '@/pages/Courses';
import MyCourses from '@/pages/MyCourses';
import TabMegaMenu, { MegaMenuColumn } from '@/components/scheduler/TabMegaMenu';
import type { SchedulerChannel, ScheduleSlot, Variable } from '@/types/scheduler';
import { VariableEditorModal } from '@/components/scheduler/VariableEditorModal';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import { parseVideoUrl } from '@/lib/parseVideoUrl';
import { useToast } from '@/hooks/use-toast';
// `toast` (sonner) is used for one-off notifications outside of the
// useToast() hook path — keeping both for now to match the rest of the app.
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Loader2, Star, Play, Sparkles, ArrowRight, ExternalLink, Plus, Pencil, Trash2, Search, CreditCard, Download, Upload, X, Lightbulb, History, Facebook, Instagram, Youtube, Twitter, Music2, Lock, ChevronDown, Volume2, VolumeX, Image as ImageIcon, Video } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Mega menu — clicking item navigates to feature URL
const imageMegaMenu = (lang: string, nav: (path: string) => void): MegaMenuColumn[] => {
  const th = lang === 'th';
  return [
    {
      title: th ? 'โมเดล' : 'Models',
      items: [
        {
          title: 'GPT Image 2',
          description: th ? 'ภาพ 4K พร้อมการเรนเดอร์ตัวอักษรเกือบสมบูรณ์แบบ' : '4K images with near-perfect text rendering',
          badge: 'NEW',
          onClick: () => nav('/app/images/gpt-image-2'),
        },
      ],
    },
  ];
};

const videoMegaMenu = (lang: string, nav: (path: string) => void): MegaMenuColumn[] => {
  const th = lang === 'th';
  return [
    {
      title: th ? 'โมเดล' : 'Models',
      items: [
        {
          title: 'Kling 3.0 Motion Control',
          description: th ? 'ถ่ายโอนการเคลื่อนไหวจากวิดีโอสู่ภาพ' : 'Transfer motion from video to image',
          badge: 'NEW',
          onClick: () => nav('/app/videos/kling-3-motion-control'),
        },
      ],
    },
  ];
};

interface PromptVariable {
  name: string;
  system_prompt?: string;
}

interface PromptTemplate {
  id: number;
  name: string;
  slug: string;
  description: string;
  youtube_url: string;
  sora_url: string;
  grok_url: string;
  thumbnail_url: string;
  platform: string;
  prompt_template: string;
  variables: PromptVariable[];
  is_featured: boolean;
  yearly_only: boolean;
  times_used: number;
}

// Prompts Tab Component
const PromptsTab: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { hasSubscription, subscription } = useSubscription();
  const { channels, fetchChannels } = useScheduler();
  const { t, language } = useLanguage();
  const isYearly = user?.isAdmin || subscription?.planType === 'yearly';

  const requireSubscription = (): boolean => {
    if (user?.isAdmin) return true;
    if (!hasSubscription) {
      navigate('/subscription');
      return false;
    }
    return true;
  };
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [filter, setFilter] = useState<'all' | 'sora2' | 'veo' | 'grok10s' | 'grok-extend' | 'favorite' | 'custom'>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'popular'>('latest');
  const [searchQuery, setSearchQuery] = useState('');
  // Pagination state
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const TEMPLATES_PER_PAGE = 20;
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Custom prompts
  const [customPrompts, setCustomPrompts] = useState<PromptTemplate[]>([]);
  const [customLoading, setCustomLoading] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState<PromptTemplate | null>(null);
  const [customForm, setCustomForm] = useState({ name: '', prompt_template: '', platform: 'kie_grok_imagine', description: '', youtube_url: '', grok_url: '', extend_prompt_template: '' });
  const [savingCustom, setSavingCustom] = useState(false);
  const [deletingCustomId, setDeletingCustomId] = useState<number | null>(null);

  // Custom prompt variable system
  const [customVariables, setCustomVariables] = useState<Variable[]>([]);
  const [customExtendVariables, setCustomExtendVariables] = useState<Variable[]>([]);
  const [customNewVarName, setCustomNewVarName] = useState('');
  const [customEditingVar, setCustomEditingVar] = useState<Variable | null>(null);
  const [customVarEditorOpen, setCustomVarEditorOpen] = useState(false);
  const [customVarContext, setCustomVarContext] = useState<'main' | 'extend'>('main');

  // Sora video cache
  const [soraVideos, setSoraVideos] = useState<Record<string, string>>({});
  // YouTube click-to-play state (template.id -> isPlaying)
  const [playingYouTube, setPlayingYouTube] = useState<Record<number, boolean>>({});

  // Preview dialog
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(null);

  // Apply dialog
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyTemplate, setApplyTemplate] = useState<PromptTemplate | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [applying, setApplying] = useState(false);

  // Admin edit dialog
  const [adminEditOpen, setAdminEditOpen] = useState(false);
  const [adminEditTemplate, setAdminEditTemplate] = useState<PromptTemplate | null>(null);
  const [adminEditForm, setAdminEditForm] = useState({ name: '', prompt_template: '', platform: 'sora2', description: '', youtube_url: '', sora_url: '' });
  const [adminEditVars, setAdminEditVars] = useState<Variable[]>([]);
  const [adminEditVarEditorOpen, setAdminEditVarEditorOpen] = useState(false);
  const [adminEditingVar, setAdminEditingVar] = useState<Variable | null>(null);
  const [savingAdminEdit, setSavingAdminEdit] = useState(false);

  useEffect(() => {
    loadTemplates();
    if (user) {
      loadFavorites();
      loadCustomPrompts();
      fetchChannels();
    }
  }, [user]);

  const loadTemplates = async (pageNum: number = 1, append: boolean = false) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const response = await api.getPromptTemplates({ page: pageNum, limit: TEMPLATES_PER_PAGE });

      // Handle paginated response
      const data = response.data || response;
      const pagination = response.pagination;

      if (pagination) {
        setHasMore(pagination.hasMore);
        setPage(pageNum);
      } else {
        // Fallback for non-paginated response
        setHasMore(false);
      }

      if (append) {
        setTemplates(prev => [...prev, ...data]);
      } else {
        setTemplates(data);
      }

      // Process Sora video caching for new templates
      const initialSoraVideos: Record<string, string> = {};
      const templatesNeedingFetch: { id: number; soraUrl: string }[] = [];

      data.forEach((t: PromptTemplate) => {
        const soraUrl = t.sora_url || '';
        if (soraUrl && soraUrl.includes('sora.chatgpt.com')) {
          if ((t as any).resolved_video_url) {
            initialSoraVideos[soraUrl] = (t as any).resolved_video_url;
          } else if (!soraVideos[soraUrl]) {
            templatesNeedingFetch.push({ id: t.id, soraUrl });
          }
        }
      });

      if (Object.keys(initialSoraVideos).length > 0) {
        setSoraVideos(prev => ({ ...prev, ...initialSoraVideos }));
      }

      // Fetch remaining Sora videos in background
      const BATCH_SIZE = 3;
      const fetchSoraVideo = async (item: { id: number; soraUrl: string }) => {
        try {
          const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/prompt-templates/sora-video?url=${encodeURIComponent(item.soraUrl)}&templateId=${item.id}`);
          const result = await res.json();
          if (result.videoUrl) {
            setSoraVideos(prev => ({ ...prev, [item.soraUrl]: result.videoUrl }));
          }
        } catch (err) {
          console.error('Failed to fetch Sora video:', err);
        }
      };

      (async () => {
        for (let i = 0; i < templatesNeedingFetch.length; i += BATCH_SIZE) {
          const batch = templatesNeedingFetch.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(fetchSoraVideo));
        }
      })();
    } catch (error) {
      console.error('Failed to load templates:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMoreTemplates = () => {
    if (!loadingMore && hasMore) {
      loadTemplates(page + 1, true);
    }
  };

  // Infinite scroll - auto load when scrolling to bottom
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          loadMoreTemplates();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, page]);

  const loadFavorites = async () => {
    try {
      const data = await api.getMyFavoritePrompts();
      setFavorites(data.map((t: PromptTemplate) => t.id));
    } catch (error) {
      console.error('Failed to load favorites:', error);
    }
  };

  const loadCustomPrompts = async () => {
    try {
      setCustomLoading(true);
      const data = await api.getCustomPrompts();
      setCustomPrompts(data);
    } catch (error) {
      console.error('Failed to load custom prompts:', error);
    } finally {
      setCustomLoading(false);
    }
  };

  const handleOpenCustomDialog = (template?: PromptTemplate) => {
    if (template) {
      setEditingCustom(template);
      setCustomForm({
        name: template.name,
        prompt_template: template.prompt_template,
        platform: template.platform || 'kie_grok_imagine',
        description: template.description || '',
        youtube_url: template.youtube_url || '',
        grok_url: (template as any).grok_url || '',
        extend_prompt_template: (template as any).extend_prompt_template || '',
      });
      // Load existing variables with values
      const vars = (template.variables || []).map((v: any) => ({
        name: v.name,
        system_prompt: v.system_prompt || '',
        values: v.values || [],
        loop: true,
      }));
      setCustomVariables(vars);
      // Load extend variables
      const extVars = ((template as any).extend_variables || []).map((v: any) => ({
        name: v.name,
        system_prompt: v.system_prompt || '',
        values: v.values || [],
        loop: true,
      }));
      setCustomExtendVariables(extVars);
    } else {
      setEditingCustom(null);
      setCustomForm({ name: '', prompt_template: '', platform: 'kie_grok_imagine', description: '', youtube_url: '', grok_url: '', extend_prompt_template: '' });
      setCustomVariables([]);
      setCustomExtendVariables([]);
    }
    setCustomNewVarName('');
    setCustomDialogOpen(true);
  };

  const handleSaveCustom = async () => {
    if (!customForm.name.trim() || !customForm.prompt_template.trim()) {
      toast({ title: t('common.fillAllFields'), variant: 'destructive' });
      return;
    }
    try {
      setSavingCustom(true);
      const payload = { ...customForm, variables: customVariables, extend_variables: customExtendVariables };
      if (editingCustom) {
        await api.updateCustomPrompt(editingCustom.id, payload);
        toast({ title: t('prompts.customUpdated') });
      } else {
        await api.createCustomPrompt(payload);
        toast({ title: t('prompts.customCreated') });
      }
      setCustomDialogOpen(false);
      loadCustomPrompts();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to save', variant: 'destructive' });
    } finally {
      setSavingCustom(false);
    }
  };

  const handleDeleteCustom = async (id: number) => {
    try {
      setDeletingCustomId(id);
      await api.deleteCustomPrompt(id);
      toast({ title: t('prompts.customDeleted') });
      loadCustomPrompts();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to delete', variant: 'destructive' });
    } finally {
      setDeletingCustomId(null);
    }
  };

  const handleExportCustomPrompts = () => {
    if (customPrompts.length === 0) {
      toast({ title: t('prompts.noCustom'), variant: 'destructive' });
      return;
    }
    const exportData = customPrompts.map(p => ({
      name: p.name,
      description: p.description || '',
      prompt_template: p.prompt_template,
      variables: p.variables || [],
      platform: p.platform || 'sora2',
      youtube_url: p.youtube_url || '',
      sora_url: p.sora_url || '',
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom-prompts-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: t('prompts.exportSuccess') });
  };

  const handleImportCustomPrompts = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data)) {
          toast({ title: t('prompts.importInvalidFormat'), variant: 'destructive' });
          return;
        }
        let imported = 0;
        for (const item of data) {
          if (!item.name || !item.prompt_template) continue;
          await api.createCustomPrompt({
            name: item.name,
            prompt_template: item.prompt_template,
            variables: item.variables || [],
            platform: item.platform || 'sora2',
            description: item.description || '',
            youtube_url: item.youtube_url || '',
          });
          imported++;
        }
        await loadCustomPrompts();
        toast({ title: t('prompts.importSuccess', { count: imported }) });
      } catch (error: any) {
        console.error('Import error:', error);
        toast({ title: t('prompts.importError'), variant: 'destructive' });
      }
    };
    input.click();
  };

  // Auto-detect variables from custom prompt template
  useEffect(() => {
    if (!customDialogOpen) return;
    const templateText = customForm.prompt_template || '';
    const curlyMatches = templateText.match(/\{([^}]+)\}/g) || [];
    const squareMatches = templateText.match(/\[([^\]]+)\]/g) || [];
    const allMatches = [...curlyMatches, ...squareMatches];
    const extractedNames = [...new Set(allMatches.map(m => m.replace(/[\{\}\[\]]/g, '')))];

    setCustomVariables(prev => {
      const existingNames = new Set(prev.map(v => v.name));
      const newVars = extractedNames
        .filter(name => !existingNames.has(name))
        .map(name => ({ name, system_prompt: '', values: [] as any[], loop: true }));
      const stillInTemplate = new Set(extractedNames);
      const kept = prev.filter(v => stillInTemplate.has(v.name) || (v.values && v.values.length > 0));
      if (newVars.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...newVars];
    });
  }, [customForm.prompt_template, customDialogOpen]);

  // Auto-detect extend variables
  useEffect(() => {
    if (!customDialogOpen || !customForm.extend_prompt_template) return;
    const templateText = customForm.extend_prompt_template || '';
    const curlyMatches = templateText.match(/\{([^}]+)\}/g) || [];
    const squareMatches = templateText.match(/\[([^\]]+)\]/g) || [];
    const allMatches = [...curlyMatches, ...squareMatches];
    const extractedNames = [...new Set(allMatches.map(m => m.replace(/[\{\}\[\]]/g, '')))];
    setCustomExtendVariables(prev => {
      const existingNames = new Set(prev.map(v => v.name));
      const newVars = extractedNames
        .filter(name => !existingNames.has(name))
        .map(name => ({ name, system_prompt: '', values: [] as any[], loop: true }));
      const stillInTemplate = new Set(extractedNames);
      const kept = prev.filter(v => stillInTemplate.has(v.name) || (v.values && v.values.length > 0));
      if (newVars.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...newVars];
    });
  }, [customForm.extend_prompt_template, customDialogOpen]);

  const handleAddCustomVariable = () => {
    const name = customNewVarName.trim();
    if (!name) return;
    if (customVariables.some(v => v.name === name)) {
      toast({ title: t('channel.varNameDuplicate'), variant: 'destructive' });
      return;
    }
    setCustomVariables(prev => [...prev, { name, values: [], system_prompt: '', loop: true }]);
    setCustomNewVarName('');
  };

  const handleDeleteCustomVariable = (name: string) => {
    setCustomVariables(prev => prev.filter(v => v.name !== name));
  };

  const handleSaveCustomVariable = (updated: Variable) => {
    if (customVarContext === 'extend') {
      setCustomExtendVariables(prev => prev.map(v => v.name === updated.name ? updated : v));
    } else {
      setCustomVariables(prev => prev.map(v => v.name === updated.name ? updated : v));
    }
  };

  // Admin edit handlers
  const handleOpenAdminEdit = (template: PromptTemplate) => {
    setAdminEditTemplate(template);
    setAdminEditForm({
      name: template.name,
      prompt_template: template.prompt_template,
      platform: template.platform || 'sora2',
      description: template.description || '',
      youtube_url: template.youtube_url || '',
      sora_url: template.sora_url || '',
    });
    const vars = (template.variables || []).map((v: any) => ({
      name: v.name,
      system_prompt: v.system_prompt || '',
      values: v.values || [],
      loop: true,
    }));
    setAdminEditVars(vars);
    setAdminEditOpen(true);
  };

  const handleSaveAdminEdit = async () => {
    if (!adminEditTemplate || !adminEditForm.name.trim() || !adminEditForm.prompt_template.trim()) {
      toast({ title: t('common.fillAllFields'), variant: 'destructive' });
      return;
    }
    try {
      setSavingAdminEdit(true);
      await api.updateAdminPromptTemplate(adminEditTemplate.id, {
        ...adminEditForm,
        variables: adminEditVars,
      });
      toast({ title: t('prompts.customUpdated') });
      setAdminEditOpen(false);
      loadTemplates(1, false);
} catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to save', variant: 'destructive' });
    } finally {
      setSavingAdminEdit(false);
    }
  };

  // Auto-detect variables in admin edit template
  useEffect(() => {
    if (!adminEditOpen) return;
    const templateText = adminEditForm.prompt_template || '';
    const curlyMatches = templateText.match(/\{([^}]+)\}/g) || [];
    const squareMatches = templateText.match(/\[([^\]]+)\]/g) || [];
    const allMatches = [...curlyMatches, ...squareMatches];
    const extractedNames = [...new Set(allMatches.map(m => m.replace(/[\{\}\[\]]/g, '')))];

    setAdminEditVars(prev => {
      const existingNames = new Set(prev.map(v => v.name));
      const newVars = extractedNames
        .filter(name => !existingNames.has(name))
        .map(name => ({ name, system_prompt: '', values: [] as any[], loop: true }));
      const stillInTemplate = new Set(extractedNames);
      const kept = prev.filter(v => stillInTemplate.has(v.name) || (v.values && v.values.length > 0));
      if (newVars.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...newVars];
    });
  }, [adminEditForm.prompt_template, adminEditOpen]);

  const handleToggleFavorite = async (template: PromptTemplate) => {
    if (!user) {
      toast({ title: t('common.pleaseLogin'), variant: 'destructive' });
      return;
    }
    try {
      const result = await api.togglePromptFavorite(template.id);
      if (result.favorited) {
        setFavorites(prev => [...prev, template.id]);
      } else {
        setFavorites(prev => prev.filter(id => id !== template.id));
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const handleApplyToChannel = async () => {
    if (!requireSubscription()) return;
    if (!applyTemplate || !selectedChannelId) return;
    try {
      setApplying(true);
      await api.applyPromptToChannel(applyTemplate.id, parseInt(selectedChannelId));
      toast({ title: t('common.success'), description: t('prompts.applySuccess') });
      setApplyDialogOpen(false);
      setApplyTemplate(null);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to apply prompt', variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[#FFB300]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#FFB300]" />
            {t('prompts.title')}
          </h2>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('prompts.search')}
          className="pl-9"
        />
      </div>

      {/* Sort + Filter Tabs */}
      <div className="flex gap-2 flex-wrap items-center">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'latest' | 'popular')}
          className="px-3 py-1 rounded-full text-xs font-medium border border-[#FFB300] bg-black text-[#FFB300] cursor-pointer appearance-none pr-6"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23FFB300' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
        >
          <option value="latest" className="bg-zinc-900 text-[#FFB300]">ล่าสุด</option>
          <option value="popular" className="bg-zinc-900 text-[#FFB300]">ยอดนิยม</option>
        </select>
        {([
          { key: 'all', label: t('prompts.filterAll') },
          { key: 'grok10s', label: 'Grok 10s' },
          { key: 'grok-extend', label: 'Grok Extend (20s)' },
          { key: 'sora2', label: t('prompts.filterSora2') },
          { key: 'veo', label: t('prompts.filterVeo') },
          { key: 'favorite', label: t('prompts.filterFavorite') },
          { key: 'custom', label: t('prompts.filterCustom') },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === tab.key
                ? 'bg-[#FFB300] text-black'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {tab.label}
            {tab.key === 'favorite' && favorites.length > 0 && (
              <span className="ml-1.5 text-xs opacity-70">({favorites.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Add Prompt button for Custom filter */}
      {filter === 'custom' && (
        <div className="flex justify-end gap-2">
          <Button onClick={handleImportCustomPrompts} variant="outline" size="sm" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            <Upload className="h-4 w-4 mr-1" /> {t('prompts.import')}
          </Button>
          <Button onClick={handleExportCustomPrompts} variant="outline" size="sm" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800" disabled={customPrompts.length === 0}>
            <Download className="h-4 w-4 mr-1" /> {t('prompts.export')}
          </Button>
          <Button onClick={() => handleOpenCustomDialog()} className="bg-[#FFB300] hover:bg-[#FF9500] text-black" size="sm">
            <Plus className="h-4 w-4 mr-1" /> {t('prompts.addPrompt')}
          </Button>
        </div>
      )}

      {(() => {
        const q = searchQuery.toLowerCase().trim();
        const matchesSearch = (t: PromptTemplate) => {
          if (!q) return true;
          return (t.name || '').toLowerCase().includes(q)
            || (t.description || '').toLowerCase().includes(q)
            || (t.prompt_template || '').toLowerCase().includes(q);
        };

        if (filter === 'custom') {
          if (customLoading) return (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" />
            </div>
          );

          const filteredCustom = customPrompts.filter(matchesSearch);

          if (filteredCustom.length === 0) return (
            <Card>
              <CardContent className="py-12 text-center">
                <Sparkles className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
                <p className="text-muted-foreground">{q ? t('prompts.noCustomSearch') : t('prompts.noCustom')}</p>
                {!q && <p className="text-sm text-muted-foreground mt-1">{t('prompts.addCustomHint')}</p>}
              </CardContent>
            </Card>
          );

          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {filteredCustom.map(template => (
                <Card key={template.id} className="overflow-hidden group">
                  <div className="relative aspect-[9/16] bg-zinc-900">
                    {(() => {
                      const videoUrl = template.youtube_url || template.sora_url || template.grok_url;
                      const videoInfo = videoUrl ? parseVideoUrl(videoUrl) : null;

                      // Direct video URL (videos.openai.com)
                      if (videoInfo?.type === 'direct') {
                        return (
                          <video
                            src={videoInfo.embedUrl || ''}
                            className="w-full h-full object-cover"
                            autoPlay muted loop playsInline
                          />
                        );
                      }

                      // YouTube: show thumbnail with play button
                      if (videoInfo?.type === 'youtube' && videoInfo.videoId) {
                        if (playingYouTube[template.id]) {
                          return (
                            <iframe
                              src={videoInfo.embedUrl || ''}
                              className="w-full h-full"
                              allowFullScreen
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            />
                          );
                        }
                        return (
                          <div
                            className="relative w-full h-full cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPlayingYouTube(prev => ({ ...prev, [template.id]: true }));
                            }}
                          >
                            <img
                              src={`https://img.youtube.com/vi/${videoInfo.videoId}/hqdefault.jpg`}
                              alt={template.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-14 h-14 bg-red-600 rounded-full flex items-center justify-center shadow-lg hover:bg-red-700 transition-colors">
                                <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z"/>
                                </svg>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Sora video
                      if (videoInfo?.type === 'sora') {
                        const soraVideoUrl = soraVideos[videoUrl];
                        if (soraVideoUrl) {
                          return (
                            <video
                              src={soraVideoUrl}
                              className="w-full h-full object-cover"
                              autoPlay muted loop playsInline
                            />
                          );
                        }
                        return template.thumbnail_url ? (
                          <img src={template.thumbnail_url} alt={template.name} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Sparkles className="h-8 w-8 text-[#FFB300]" />
                          </div>
                        );
                      }

                      // No video: placeholder
                      return (
                        <div className="w-full h-full flex items-center justify-center">
                          <Sparkles className="h-8 w-8 text-[#FFB300]" />
                        </div>
                      );
                    })()}
                    {/* Edit/Delete buttons - top right corner */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <button onClick={(e) => { e.stopPropagation(); handleOpenCustomDialog(template); }} className="p-1.5 rounded-full bg-black/60 hover:bg-black/80">
                        <Pencil className="h-3.5 w-3.5 text-white" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteCustom(template.id); }}
                        disabled={deletingCustomId === template.id}
                        className="p-1.5 rounded-full bg-red-500/60 hover:bg-red-500/80"
                      >
                        {deletingCustomId === template.id ? <Loader2 className="h-3.5 w-3.5 text-white animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-white" />}
                      </button>
                    </div>
                  </div>
                  <CardContent className="p-2 space-y-2">
                    <div>
                      <h3 className="font-semibold text-sm truncate">{template.name}</h3>
                      <div className="flex items-center gap-1 mt-1">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500 text-green-400">{t('prompts.custom')}</Badge>
                        {template.times_used > 0 && (
                          <span className="text-[10px] text-muted-foreground">{t('prompts.usedTimes', { count: template.times_used })}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      onClick={() => navigate(`/app/prompt-direct/${template.slug}`)}
                      className="w-full bg-[#FFB300] hover:bg-[#FF9500] text-black text-xs"
                      size="sm"
                    >
                      {t('prompts.usePrompt')} <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          );
        }

        const filtered = templates.filter(t => {
          if (!matchesSearch(t)) return false;
          if (filter === 'sora2') return t.platform === 'sora2' || t.platform === 'sora2-vidgo' || t.platform === 'sora2-grsai';
          if (filter === 'veo') return t.platform === 'veo' || t.platform === 'veo3';
          if (filter === 'grok10s') return t.platform === 'kie-grok-10s';
          if (filter === 'grok-extend') return t.platform === 'kie-grok-10s-extend';
          if (filter === 'favorite') return favorites.includes(t.id);
          return true;
        }).sort((a, b) => {
          if (sortBy === 'popular') return (b.times_used || 0) - (a.times_used || 0);
          return 0; // latest = default order from API (already sorted by created_at DESC)
        });

        if (filtered.length === 0) return (
          <Card>
            <CardContent className="py-12 text-center">
              <Sparkles className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
              <p className="text-muted-foreground">
                {filter === 'favorite' ? t('prompts.noFavorite') : t('prompts.noPrompts')}
              </p>
            </CardContent>
          </Card>
        );

        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filtered.map((template, idx) => (
            <div
              key={template.id}
              className="group cursor-pointer rounded-[7px] border border-zinc-800 bg-zinc-900 hover:border-[#FFB300]/50 transition-all relative overflow-visible"
              onClick={() => {
                if (!isYearly && template.yearly_only) {
                  toast({ title: 'ต้องสมัครรายปีเท่านั้นถึงจะใช้ได้', variant: 'destructive' });
                  return;
                }
                navigate(`/app/prompt-direct/${template.slug}`);
              }}
            >
              <div className="relative">
                {/* NEW badge */}
                {sortBy === 'latest' && idx < 5 && (
                  <img src="/new-badge.png" alt="NEW" className="absolute -top-4 -left-4 w-14 h-14 z-30 pointer-events-none" />
                )}
                <div className="aspect-[9/16] bg-zinc-800 relative flex items-center justify-center overflow-hidden rounded-t-[7px]">
                  {(() => {
                    const videoUrl = template.youtube_url || template.sora_url || template.grok_url;
                    const videoInfo = videoUrl ? parseVideoUrl(videoUrl) : null;

                    if (videoInfo?.type === 'direct') {
                      return <video src={videoInfo.embedUrl || ''} className="w-full h-full object-cover" autoPlay muted loop playsInline />;
                    }
                    if (videoInfo?.type === 'youtube' && videoInfo.videoId) {
                      if (playingYouTube[template.id]) {
                        return <iframe src={videoInfo.embedUrl || ''} className="w-full h-full pointer-events-none" allow="autoplay; encrypted-media" />;
                      }
                      return (
                        <div className="relative w-full h-full" onClick={(e) => { e.stopPropagation(); setPlayingYouTube(prev => ({ ...prev, [template.id]: true })); }}>
                          <img src={`https://img.youtube.com/vi/${videoInfo.videoId}/hqdefault.jpg`} alt={template.name} className="w-full h-full object-cover" loading="lazy" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center shadow-lg">
                              <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (videoInfo?.type === 'sora') {
                      const soraVideoUrl = soraVideos[videoUrl];
                      if (soraVideoUrl) return <video src={soraVideoUrl} className="w-full h-full object-cover" autoPlay muted loop playsInline />;
                      return template.thumbnail_url
                        ? <img src={template.thumbnail_url} alt={template.name} className="w-full h-full object-cover" loading="lazy" />
                        : <div className="w-full h-full flex items-center justify-center"><Sparkles className="h-10 w-10 text-zinc-600" /></div>;
                    }
                    return template.thumbnail_url
                      ? <img src={template.thumbnail_url} alt={template.name} className="w-full h-full object-cover" loading="lazy" />
                      : <div className="w-full h-full flex items-center justify-center"><Sparkles className="h-10 w-10 text-zinc-600" /></div>;
                  })()}

                  {/* Lock overlay */}
                  {!isYearly && template.yearly_only && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20">
                      <Lock className="h-8 w-8 text-yellow-400" />
                    </div>
                  )}
                  {/* Hover play overlay (non-video cards) */}
                  {!template.youtube_url && !template.sora_url && !template.grok_url && !((!isYearly && template.yearly_only)) && (
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-12 h-12 rounded-[7px] bg-[#FFB300]/90 flex items-center justify-center"><Play className="h-6 w-6 text-black ml-0.5" /></div>
                    </div>
                  )}
                  {/* Favorite button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isYearly && template.yearly_only) return;
                      handleToggleFavorite(template);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 transition-colors z-10"
                  >
                    <Star className={`h-4 w-4 ${favorites.includes(template.id) ? 'text-yellow-500 fill-yellow-500' : 'text-white'}`} />
                  </button>
                  {/* Admin edit button */}
                  {user?.isAdmin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleOpenAdminEdit(template); }}
                      className="absolute top-2 left-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    >
                      <Pencil className="h-3.5 w-3.5 text-white" />
                    </button>
                  )}
                </div>
              </div>
              <div className="p-3">
                <h3 className="text-sm font-medium text-zinc-200 truncate">{template.name}</h3>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-[#FFB300]/40 text-[#FFB300]">
                    {{ sora2: 'Sora2', 'sora2-vidgo': 'Sora2 Vidgo', kling: 'Kling', 'kie-grok-10s': 'Grok 10s', 'kie-grok-10s-extend': 'Grok Extend (20s)' }[template.platform] || template.platform}
                  </Badge>
                  {template.times_used > 0 && (
                    <span className="text-[10px] text-muted-foreground">{t('prompts.usedTimes', { count: template.times_used })}</span>
                  )}
                </div>
                {!isYearly && template.yearly_only && (
                  <span className="text-[10px] text-yellow-400 font-semibold">🔒 {language === 'th' ? 'สำหรับแพ็กรายปี' : 'Yearly only'}</span>
                )}
                {template.description && (
                  <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{template.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      );
      })()}

      {/* Infinite Scroll Trigger */}
      {filter !== 'custom' && filter !== 'favorite' && (
        <>
          <div ref={loadMoreRef} className="h-10" />
          {loadingMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </>
      )}

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewTemplate?.name}</DialogTitle>
            {previewTemplate?.description && (
              <DialogDescription>{previewTemplate.description}</DialogDescription>
            )}
          </DialogHeader>
          {(previewTemplate?.youtube_url || previewTemplate?.sora_url) && (() => {
            const previewUrl = previewTemplate.youtube_url || previewTemplate.sora_url;
            const videoInfo = parseVideoUrl(previewUrl);
            if (videoInfo.type === 'direct') {
              return (
                <div className="aspect-[9/16] max-h-[70vh] mx-auto rounded overflow-hidden bg-black">
                  <video
                    src={videoInfo.embedUrl || ''}
                    className="w-full h-full object-contain"
                    autoPlay
                    muted
                    loop
                    playsInline
                    controls
                  />
                </div>
              );
            } else if (videoInfo.type === 'youtube') {
              return (
                <div className="aspect-video rounded overflow-hidden bg-black">
                  <iframe src={videoInfo.embedUrl || ''} className="w-full h-full" allowFullScreen />
                </div>
              );
            } else if (videoInfo.type === 'sora') {
              const soraVideoUrl = soraVideos[previewUrl];
              if (soraVideoUrl) {
                return (
                  <div className="aspect-[9/16] max-h-[70vh] mx-auto rounded overflow-hidden bg-black">
                    <video
                      src={soraVideoUrl}
                      className="w-full h-full object-contain"
                      autoPlay
                      muted
                      loop
                      playsInline
                      controls
                    />
                  </div>
                );
              }
              return (
                <div className="flex flex-col items-center justify-center py-8 gap-4 bg-zinc-900 rounded-lg">
                  <Sparkles className="h-16 w-16 text-[#FFB300]" />
                  <p className="text-zinc-400">{t('prompts.soraNoEmbed')}</p>
                  <Button onClick={() => window.open(previewUrl, '_blank')} className="bg-[#FFB300] hover:bg-[#FF9500] text-black">
                    <ExternalLink className="h-4 w-4 mr-2" /> {t('prompts.openSoraVideo')}
                  </Button>
                </div>
              );
            }
            return null;
          })()}
          <div className="space-y-2 pt-4">
            <div className="text-sm text-muted-foreground">{t('prompts.promptPreview')}</div>
            <div className="p-3 bg-zinc-900 rounded-lg font-mono text-sm text-zinc-300 max-h-32 overflow-y-auto">
              {previewTemplate?.prompt_template}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setPreviewOpen(false); setApplyTemplate(previewTemplate); setSelectedChannelId(''); setApplyDialogOpen(true); }} className="bg-[#FFB300] hover:bg-[#FF9500] text-black">
              {t('prompts.usePrompt')} <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Dialog */}
      <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('prompts.selectChannel')}</DialogTitle>
            <DialogDescription>{t('prompts.applyDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 bg-zinc-900 rounded-lg">
              <div className="font-medium text-white mb-1">{applyTemplate?.name}</div>
              <div className="text-sm text-zinc-400 line-clamp-2">{applyTemplate?.prompt_template}</div>
            </div>
            <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
              <SelectTrigger>
                <SelectValue placeholder={t('prompts.selectChannelPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {channels.map(channel => (
                  <SelectItem key={channel.id} value={channel.id.toString()}>{channel.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleApplyToChannel} disabled={!selectedChannelId || applying} className="bg-[#FFB300] hover:bg-[#FF9500] text-black">
              {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('prompts.applyToChannel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Prompt Create/Edit Dialog */}
      <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCustom ? t('prompts.editPrompt') : t('prompts.newPrompt')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Name + Platform row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('prompts.name')} *</label>
                <Input
                  value={customForm.name}
                  onChange={e => setCustomForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('prompts.namePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('prompts.platform')}</label>
                <Select value={customForm.platform} onValueChange={v => setCustomForm(f => ({ ...f, platform: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kie_grok_imagine">[KIE] Grok Imagine 10-30s</SelectItem>
                    <SelectItem value="kie_grok_extend">[KIE] Grok 10s + Grok Extend</SelectItem>
                    <SelectItem value="kie_sora2">[KIE] Sora2 15s</SelectItem>
                    <SelectItem value="sora2_15s">[Vidgo] Sora2 15s</SelectItem>
                    <SelectItem value="veo3_1">[Vidgo] Veo 3.1 8s</SelectItem>
                    <SelectItem value="grok_imagine">[Vidgo] Grok Imagine 6s</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('prompts.description')}</label>
              <Input
                value={customForm.description}
                onChange={e => setCustomForm(f => ({ ...f, description: e.target.value }))}
                placeholder={t('prompts.descPlaceholder')}
              />
            </div>

            {/* YouTube URL */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('prompts.youtubeUrl')}</label>
              <Input
                value={customForm.youtube_url}
                onChange={e => setCustomForm(f => ({ ...f, youtube_url: e.target.value }))}
                placeholder={t('prompts.youtubeUrlPlaceholder')}
              />
            </div>

            {/* Grok URL */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Grok URL ({language === 'th' ? 'วิดีโอตัวอย่าง' : 'Preview video'})</label>
              <Input
                value={customForm.grok_url}
                onChange={e => setCustomForm(f => ({ ...f, grok_url: e.target.value }))}
                placeholder="https://..."
              />
            </div>

            {/* Prompt Template */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('prompts.promptTemplate')} *</label>
              <p className="text-xs text-muted-foreground -mt-1">
                {t('prompts.varHint')}
              </p>
              <Textarea
                value={customForm.prompt_template}
                onChange={e => setCustomForm(f => ({ ...f, prompt_template: e.target.value }))}
                placeholder={t('prompts.templatePlaceholder')}
                rows={5}
                className="font-mono text-sm"
              />
              {/* Detected variable tags */}
              {customVariables.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground">{t('channel.varDetected')}:</span>
                  {customVariables.map(v => (
                    <Badge key={v.name} variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-xs">
                      {`{${v.name}}`}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Variables Section */}
            <div className="space-y-3 border border-emerald-500/30 rounded-lg p-4 bg-emerald-500/5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-emerald-200">{t('channel.variables')} ({customVariables.length} {t('channel.varCount')})</label>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">{t('channel.varAutoDetectDesc')}</p>

              {customVariables.length > 0 && (
                <div className="space-y-2">
                  {customVariables.map(variable => {
                    const newCount = variable.values?.filter(v => v.status === 'new').length || 0;
                    const usedCount = variable.values?.filter(v => v.status === 'used').length || 0;
                    return (
                      <div key={variable.name} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-md">
                        <div className="flex items-center gap-2">
                          <code className="text-sm text-emerald-300">{`{${variable.name}}`}</code>
                          <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30 text-xs">
                            {newCount} new
                          </Badge>
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30 text-xs">
                            {usedCount} used
                          </Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => { setCustomVarContext('main'); setCustomEditingVar(variable); setCustomVarEditorOpen(true); }}
                            className="h-7 px-2 text-xs text-gray-400 hover:text-emerald-400"
                          >
                            <Settings2 className="h-3 w-3 mr-1" />
                            {t('channel.manageValues')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteCustomVariable(variable.name)}
                            className="h-7 w-7 p-0 text-gray-500 hover:text-red-400"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add new variable manually */}
              <div className="flex gap-2">
                <Input
                  value={customNewVarName}
                  onChange={e => setCustomNewVarName(e.target.value.replace(/[^a-zA-Z0-9_ก-๛]/g, ''))}
                  placeholder={t('channel.varPlaceholder')}
                  className="flex-1 bg-gray-900/50 border-gray-700 text-sm"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomVariable(); } }}
                />
                <Button
                  type="button"
                  onClick={handleAddCustomVariable}
                  disabled={!customNewVarName.trim()}
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Extend Prompt (สำหรับ Grok Extend) */}
            {customForm.platform === 'kie_grok_extend' && (
              <div className="border border-cyan-500/30 rounded-lg p-4 bg-cyan-950/10 space-y-3">
                <label className="text-sm font-medium text-cyan-300">Extend Prompt</label>
                <p className="text-xs text-muted-foreground">
                  {language === 'th'
                    ? 'Prompt สำหรับต่อวิดีโอเพิ่ม 10 วินาที (รวม ~20s) — ใส่ตัวแปรในรูปแบบ {ชื่อตัวแปร}'
                    : 'Prompt for extending video by 10s (~20s total) — use {variable} format'}
                </p>
                <Textarea
                  value={customForm.extend_prompt_template}
                  onChange={e => setCustomForm(f => ({ ...f, extend_prompt_template: e.target.value }))}
                  placeholder={language === 'th' ? 'Extend prompt...' : 'Extend prompt...'}
                  rows={4}
                  className="font-mono text-sm border-cyan-500/20"
                />

                {/* Extend Variables */}
                {customExtendVariables.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-cyan-500/20">
                    <label className="text-xs text-cyan-300">{language === 'th' ? 'ตัวแปร Extend' : 'Extend Variables'} ({customExtendVariables.length})</label>
                    {customExtendVariables.map(variable => {
                      const newCount = variable.values?.filter(v => v.status === 'new').length || 0;
                      const usedCount = variable.values?.filter(v => v.status === 'used').length || 0;
                      return (
                        <div key={variable.name} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-md">
                          <div className="flex items-center gap-2">
                            <code className="text-sm text-cyan-300">{`{${variable.name}}`}</code>
                            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30 text-xs">{newCount} new</Badge>
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30 text-xs">{usedCount} used</Badge>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => { setCustomVarContext('extend'); setCustomEditingVar(variable); setCustomVarEditorOpen(true); }}
                            className="h-7 px-2 text-xs text-gray-400 hover:text-cyan-400"
                          >
                            <Settings2 className="h-3 w-3 mr-1" />
                            {t('channel.manageValues')}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSaveCustom} disabled={savingCustom} className="bg-[#FFB300] hover:bg-[#FF9500] text-black">
              {savingCustom && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingCustom ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Variable Editor Modal for Custom Prompts */}
      <VariableEditorModal
        open={customVarEditorOpen}
        onClose={() => setCustomVarEditorOpen(false)}
        variable={customEditingVar}
        onSave={handleSaveCustomVariable}
      />

      {/* Admin Edit Prompt Dialog */}
      {user?.isAdmin && (
        <>
          <Dialog open={adminEditOpen} onOpenChange={setAdminEditOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Admin: Edit Prompt</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('prompts.name')} *</label>
                    <Input value={adminEditForm.name} onChange={e => setAdminEditForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('prompts.platform')}</label>
                    <Select value={adminEditForm.platform} onValueChange={v => setAdminEditForm(f => ({ ...f, platform: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="kie_grok_imagine">[KIE] Grok Imagine 10-30s</SelectItem>
                        <SelectItem value="kie_grok_extend">[KIE] Grok 10s + Grok Extend</SelectItem>
                        <SelectItem value="kie_sora2">[KIE] Sora2 15s</SelectItem>
                        <SelectItem value="sora2_15s">[Vidgo] Sora2 15s</SelectItem>
                        <SelectItem value="veo3_1">[Vidgo] Veo 3.1 8s</SelectItem>
                        <SelectItem value="grok_imagine">[Vidgo] Grok Imagine 6s</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('prompts.description')}</label>
                  <Input value={adminEditForm.description} onChange={e => setAdminEditForm(f => ({ ...f, description: e.target.value }))} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('prompts.youtubeUrl')}</label>
                    <Input value={adminEditForm.youtube_url} onChange={e => setAdminEditForm(f => ({ ...f, youtube_url: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Sora URL</label>
                    <Input value={adminEditForm.sora_url} onChange={e => setAdminEditForm(f => ({ ...f, sora_url: e.target.value }))} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('prompts.promptTemplate')} *</label>
                  <Textarea
                    value={adminEditForm.prompt_template}
                    onChange={e => setAdminEditForm(f => ({ ...f, prompt_template: e.target.value }))}
                    rows={5}
                    className="font-mono text-sm"
                  />
                  {adminEditVars.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs text-muted-foreground">{t('channel.varDetected')}:</span>
                      {adminEditVars.map(v => (
                        <Badge key={v.name} variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-xs">
                          {`{${v.name}}`}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Variables */}
                {adminEditVars.length > 0 && (
                  <div className="space-y-2 border border-emerald-500/30 rounded-lg p-3 bg-emerald-500/5">
                    <label className="text-sm font-medium text-emerald-200">{t('channel.variables')} ({adminEditVars.length})</label>
                    {adminEditVars.map(variable => {
                      const newCount = variable.values?.filter(v => v.status === 'new').length || 0;
                      const usedCount = variable.values?.filter(v => v.status === 'used').length || 0;
                      return (
                        <div key={variable.name} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-md">
                          <div className="flex items-center gap-2">
                            <code className="text-sm text-emerald-300">{`{${variable.name}}`}</code>
                            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30 text-xs">{newCount} new</Badge>
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30 text-xs">{usedCount} used</Badge>
                          </div>
                          <Button
                            type="button" variant="ghost" size="sm"
                            onClick={() => { setAdminEditingVar(variable); setAdminEditVarEditorOpen(true); }}
                            className="h-7 px-2 text-xs text-gray-400 hover:text-emerald-400"
                          >
                            <Settings2 className="h-3 w-3 mr-1" /> {t('channel.manageValues')}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAdminEditOpen(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleSaveAdminEdit} disabled={savingAdminEdit} className="bg-[#FFB300] hover:bg-[#FF9500] text-black">
                  {savingAdminEdit && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <VariableEditorModal
            open={adminEditVarEditorOpen}
            onClose={() => setAdminEditVarEditorOpen(false)}
            variable={adminEditingVar}
            onSave={(updated) => setAdminEditVars(prev => prev.map(v => v.name === updated.name ? updated : v))}
          />
        </>
      )}
    </div>
  );
};

const ContentSchedulerContent: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { subscription, hasSubscription, loading: subscriptionLoading } = useSubscription();
  const { t, language, setLanguage } = useLanguage();
  const {
    channels,
    currentChannel,
    setCurrentChannel,
    fetchChannels,
  } = useScheduler();

  // Fetch channels on mount (needed for URL param restore)
  useEffect(() => {
    fetchChannels();
  }, []);

  // Helper function to check subscription before actions
  const requireSubscription = (): boolean => {
    if (user?.isAdmin) return true; // Admins bypass
    if (!hasSubscription) {
      navigate('/subscription');
      return false;
    }
    return true;
  };

  const isYearly = user?.isAdmin || subscription?.planType === 'yearly';

  // Support popup
  const [supportOpen, setSupportOpen] = useState(false);

  // Fetch PostForMe subscription expiry
  const [pfmSubscriptionExpiry, setPfmSubscriptionExpiry] = useState<string | null>(null);
  const [pfmExpiryWarningOpen, setPfmExpiryWarningOpen] = useState(false);
  const [pfmExpiryDaysLeft, setPfmExpiryDaysLeft] = useState<number | null>(null);
  useEffect(() => {
    api.getApiKeys().then((result: any) => {
      if (result.postformeSubscriptionExpiry) {
        const d = new Date(result.postformeSubscriptionExpiry);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          setPfmSubscriptionExpiry(`${y}-${m}-${day}`);

          // Check if ≤ 3 days remaining, show warning once per day
          const diffDays = Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (diffDays <= 3) {
            const today = new Date().toISOString().slice(0, 10);
            const lastShown = localStorage.getItem('pfm_expiry_warning_date');
            if (lastShown !== today) {
              setPfmExpiryDaysLeft(diffDays);
              setPfmExpiryWarningOpen(true);
              localStorage.setItem('pfm_expiry_warning_date', today);
            }
          }
        }
      }
    }).catch(() => {});
  }, []);

  // URL-based tab routing
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // (Banner slider removed — trippleschool is a courses platform)

  const getActiveTab = () => {
    const path = location.pathname;
    if (path.includes('/my-courses')) return 'my-courses';
    return 'courses';
  };
  const activeTab = getActiveTab();

  const handleTabChange = (value: string) => {
    navigate(`/app/${value}`);
  };

  // Redirect /app → /app/courses
  useEffect(() => {
    if (location.pathname === '/app' || location.pathname === '/app/') {
      navigate('/app/courses', { replace: true });
    }
  }, [location.pathname, navigate]);

  const [channelFormOpen, setChannelFormOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<SchedulerChannel | null>(null);
  const [dayDetailOpen, setDayDetailOpen] = useState(false);
  const [selectedDayDate, setSelectedDayDate] = useState('');
  const [selectedDaySlots, setSelectedDaySlots] = useState<ScheduleSlot[]>([]);

  // Multi-day selection
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [showAddFormOnOpen, setShowAddFormOnOpen] = useState(false);

  // Restore modal state from URL params on mount
  useEffect(() => {
    const modalDate = searchParams.get('date');
    const modalOpen = searchParams.get('modal') === 'true';
    const channelId = searchParams.get('channel_id');

    // Skip if modal already open or params not complete
    if (dayDetailOpen) return;
    if (!modalOpen || !modalDate || !channelId || channels.length === 0) return;

    const channelFromUrl = channels.find(c => c.id === Number(channelId));
    if (!channelFromUrl) return;

    // Set channel if not already set
    if (!currentChannel) {
      setCurrentChannel(channelFromUrl);
    }

    // Open modal
    setSelectedDayDate(modalDate);
    setSelectedDates([]);
    setShowAddFormOnOpen(false);
    setDayDetailOpen(true);
  }, [searchParams, currentChannel, channels, dayDetailOpen]);
  const [showScheduleTip, setShowScheduleTip] = useState(false);
  const scheduleTipShownRef = useRef(false);
  const [showVideoReady, setShowVideoReady] = useState(false);
  const [doneVideoCount, setDoneVideoCount] = useState(0);
  const checkedChannelRef = useRef<number | null>(null);

  // Check for done videos within 2 days when entering schedule tab
  useEffect(() => {
    if (!currentChannel) return;
    if (checkedChannelRef.current === currentChannel.id) return;
    const dismissed = localStorage.getItem(`videoReadyDismissed_${currentChannel.id}`);
    if (dismissed === 'true') {
      checkedChannelRef.current = currentChannel.id;
      return;
    }

    const checkDoneVideos = async () => {
      try {
        const data = await api.getScheduleQueue({ channel_id: currentChannel.id, status: 'done' });
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const recentDone = data.items.filter((item: any) => {
          const updatedAt = new Date(item.updated_at || item.scheduled_time);
          return updatedAt >= twoDaysAgo && item.video_url;
        });
        if (recentDone.length > 0) {
          setDoneVideoCount(recentDone.length);
          // เช็ค "ไม่ต้องแสดงอีก" ก่อน (ใช้ key เดียวกับ scheduleTip เพราะ UI เดียวกัน)
          const tipDismissed = localStorage.getItem('scheduleTipDismissed');
          if (tipDismissed !== 'true') setShowVideoReady(true);
        }
      } catch (e) {
        console.error('Failed to check done videos:', e);
      }
    };
    checkedChannelRef.current = currentChannel.id;
    checkDoneVideos();
  }, [currentChannel]);

  const handleAddChannel = () => {
    if (!requireSubscription()) return;
    if (channels.length >= 50) {
      toast.error('สร้างช่องได้สูงสุด 50 ช่อง');
      return;
    }
    setEditingChannel(null);
    setChannelFormOpen(true);
  };

  const handleEditChannel = (channel: SchedulerChannel) => {
    if (!requireSubscription()) return;
    setEditingChannel(channel);
    setChannelFormOpen(true);
  };

  const handleOpenSchedule = (channel: SchedulerChannel) => {
    if (!requireSubscription()) return;
    setCurrentChannel(channel);
    handleTabChange('schedule');
    const tipDismissed = localStorage.getItem('scheduleTipDismissed');
    if (!scheduleTipShownRef.current && tipDismissed !== 'true') {
      scheduleTipShownRef.current = true;
      setShowScheduleTip(true);
    }
  };

  const handleDayClick = (dateStr: string, slots: ScheduleSlot[]) => {
    if (!requireSubscription()) return;
    setSelectedDayDate(dateStr);
    setSelectedDaySlots(slots);
    setSelectedDates([]);  // Clear multi-select
    setShowAddFormOnOpen(true);
    setDayDetailOpen(true);
    // Update URL params to preserve modal state for back navigation
    setSearchParams({ date: dateStr, modal: 'true', channel_id: String(currentChannel?.id || '') });
  };

  // Multi-day handlers
  const handleMultiDayAdd = (dates: string[]) => {
    if (!requireSubscription()) return;
    setSelectedDates(dates);
    setSelectedDayDate(dates[0] || '');
    setShowAddFormOnOpen(true);  // Open Add form immediately
    setDayDetailOpen(true);
    // Update URL params to preserve modal state for back navigation
    setSearchParams({ date: dates[0] || '', modal: 'true', channel_id: String(currentChannel?.id || '') });
  };

  const handleMultiDayView = (dates: string[]) => {
    if (!requireSubscription()) return;
    setSelectedDates(dates);
    setSelectedDayDate(dates[0] || '');
    setShowAddFormOnOpen(false);
    setDayDetailOpen(true);
    // Update URL params to preserve modal state for back navigation
    setSearchParams({ date: dates[0] || '', modal: 'true', channel_id: String(currentChannel?.id || '') });
  };

  // Show loading while checking subscription
  if (subscriptionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">{t('scheduler.signInRequired')}</h2>
            <p className="text-muted-foreground">
              {t('scheduler.signInMessage')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      {/* PostForMe expiry warning popup */}
      <Dialog open={pfmExpiryWarningOpen} onOpenChange={setPfmExpiryWarningOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className={pfmExpiryDaysLeft !== null && pfmExpiryDaysLeft < 0 ? 'text-red-400' : 'text-amber-400'}>
              {pfmExpiryDaysLeft !== null && pfmExpiryDaysLeft < 0 ? t('nav.pfmPopupTitleExpired') : t('nav.pfmPopupTitleExpiring')}
            </DialogTitle>
            <DialogDescription className="pt-2 space-y-2">
              {pfmExpiryDaysLeft !== null && pfmExpiryDaysLeft < 0 ? (
                <span>{t('nav.pfmPopupExpiredMsg')}</span>
              ) : pfmExpiryDaysLeft === 0 ? (
                <span>{t('nav.pfmPopupTodayMsg')} <strong className="text-amber-400">{t('nav.pfmPopupToday')}</strong></span>
              ) : (
                <span>{t('nav.pfmPopupDaysMsg')} <strong className="text-amber-400">{t('nav.pfmPopupDays', { days: String(pfmExpiryDaysLeft) })}</strong></span>
              )}
              {pfmSubscriptionExpiry && (
                <span className="block text-sm">{t('nav.pfmPopupValidUntil')} <strong>{new Date(pfmSubscriptionExpiry + 'T00:00:00').toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPfmExpiryWarningOpen(false)}>{t('nav.pfmPopupClose')}</Button>
            <Button size="sm" className="bg-[#FFB300] text-black hover:bg-[#FFB300]/80" onClick={() => { setPfmExpiryWarningOpen(false); navigate('/settings#postforme'); }}>{t('nav.pfmPopupGoSettings')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => navigate('/')}
        >
          <div className="h-10 w-10 min-h-[40px] min-w-[40px] rounded-[12px] flex items-center justify-center shadow-lg shrink-0" style={{ background: 'radial-gradient(circle farthest-corner at 35% 90%, #fec564, transparent 50%), radial-gradient(circle farthest-corner at 0 140%, #fec564, transparent 50%), radial-gradient(ellipse farthest-corner at 0 -25%, #5258cf, transparent 50%), radial-gradient(ellipse farthest-corner at 20% -50%, #5258cf, transparent 50%), radial-gradient(ellipse farthest-corner at 100% 0, #893dc2, transparent 50%), radial-gradient(ellipse farthest-corner at 60% -20%, #893dc2, transparent 50%), radial-gradient(ellipse farthest-corner at 100% 100%, #d9317a, transparent), linear-gradient(#6559ca, #bc318f 30%, #e33f5f 50%, #f77638 70%, #fec66d 100%)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 2L4.5 13.5H11.5L11 22L19.5 10.5H12.5L13 2Z" fill="#FFD700" stroke="#FFD700" strokeWidth="0.5" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold">Triple School</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(user?.isAdmin || ['basballcmmilk@gmail.com', 'xommon101@gmail.com'].includes(user?.email || '')) && (
            <div className="inline-flex h-10 items-center rounded-[25px] bg-muted p-1 max-w-full overflow-x-auto scrollbar-hide">
              {user?.isAdmin && (
                <button onClick={() => navigate('/admin')} className="inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-all">
                  Admin Panel
                </button>
              )}
              <button onClick={() => navigate('/admin/prompts')} className="inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-all">
                Prompt Manager
              </button>
              {user?.isAdmin && (
                <>
                  <button onClick={() => navigate('/admin/viral-templates')} className="inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-all">
                    Viral Manager
                  </button>
                  <button onClick={() => navigate('/admin/idol-templates')} className="inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-all">
                    Idol Manager
                  </button>
                  <button onClick={() => navigate('/admin/image-templates')} className="inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-all">
                    Image Manager
                  </button>
                  <button onClick={() => navigate('/admin/affiliate')} className="inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-all">
                    Affiliate
                  </button>
                </>
              )}
            </div>
          )}
          {pfmSubscriptionExpiry && (() => {
            const exp = new Date(pfmSubscriptionExpiry + 'T00:00:00');
            const diffDays = Math.floor((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            const isExpired = diffDays < 0;
            const dd = String(exp.getDate()).padStart(2, '0');
            const mm = String(exp.getMonth() + 1).padStart(2, '0');
            const yyyy = String(exp.getFullYear() + 543).slice(-2);
            return (
              <button
                onClick={() => navigate('/settings#postforme')}
                className="flex items-center gap-2.5 cursor-pointer bg-gradient-to-r from-pink-700 to-purple-900 rounded-xl px-3 py-1.5"
              >
                <span className="text-xs font-bold whitespace-nowrap text-white drop-shadow-sm">{isExpired ? t('nav.pfmExpiredLabel') : t('nav.pfmExpiryLabel')}</span>
                <div className="flex items-center gap-1.5">
                  <div className="flex flex-col items-center bg-white/20 rounded-[7px] px-2 py-1 border border-white/20">
                    <span className="text-[8px] text-white/60">วัน</span>
                    <span className="text-sm font-mono font-bold text-white">{dd}</span>
                  </div>
                  <span className="font-bold text-white/60 text-xs">:</span>
                  <div className="flex flex-col items-center bg-white/20 rounded-[7px] px-2 py-1 border border-white/20">
                    <span className="text-[8px] text-white/60">เดือน</span>
                    <span className="text-sm font-mono font-bold text-white">{mm}</span>
                  </div>
                  <span className="font-bold text-white/60 text-xs">:</span>
                  <div className="flex flex-col items-center bg-white/20 rounded-[7px] px-2 py-1 border border-white/20">
                    <span className="text-[8px] text-white/60">ปี</span>
                    <span className="text-sm font-mono font-bold text-white">{yyyy}</span>
                  </div>
                </div>
              </button>
            );
          })()}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <div className="h-5 w-5 rounded-[7px] bg-[#FFB300]/20 flex items-center justify-center">
                  <User className="h-3 w-3 text-[#FFB300]" />
                </div>
                {user?.email?.split('@')[0]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <User className="h-4 w-4 mr-2" />
                {t('nav.yourProfile')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings2 className="h-4 w-4 mr-2" />
                {t('nav.settings')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/subscription')}>
                <CreditCard className="h-4 w-4 mr-2" />
                {t('nav.subscription')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/affiliate')}>
                <Users className="h-4 w-4 mr-2" />
                {t('nav.affiliate')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSupportOpen(true)}>
                <Headphones className="h-4 w-4 mr-2" />
                {t('nav.support')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground font-normal">
                <Globe className="h-3.5 w-3.5" />
                {t('profile.language')}
              </DropdownMenuLabel>
              <div className="flex gap-1 px-2 pb-2">
                <button
                  onClick={() => setLanguage('th')}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    language === 'th'
                      ? 'bg-[#FFB300]/20 text-[#FFB300] font-medium'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  🇹🇭 ไทย
                </button>
                <button
                  onClick={() => setLanguage('en')}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    language === 'en'
                      ? 'bg-[#FFB300]/20 text-[#FFB300] font-medium'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  🇺🇸 EN
                </button>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-red-400 focus:text-red-400">
                <LogOut className="h-4 w-4 mr-2" />
                {t('nav.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex items-center gap-4 mb-6 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-max">
            <TabsTrigger value="courses" className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />
              คอร์สเรียน
            </TabsTrigger>
            <TabsTrigger value="my-courses" className="flex items-center gap-2">
              <Library className="h-4 w-4" />
              คอร์สของฉัน
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="courses" className="mt-0">
          <Courses />
        </TabsContent>

        <TabsContent value="my-courses" className="mt-0">
          <MyCourses />
        </TabsContent>

        <TabsContent value="dashboard" className="mt-0">
          <DashboardTab />
        </TabsContent>

        <TabsContent value="channels" className="mt-0">
          <ChannelList
            onAddChannel={handleAddChannel}
            onEditChannel={handleEditChannel}
            onOpenSchedule={handleOpenSchedule}
          />
        </TabsContent>

        <TabsContent value="prompts" className="mt-0">
          <PromptsTab />
        </TabsContent>

        <TabsContent value="viral-templates" className="mt-0">
          <ViralTemplateTab />
        </TabsContent>

        <TabsContent value="idol-templates" className="mt-0">
          <IdolTemplateTab />
        </TabsContent>

        <TabsContent value="image-templates" className="mt-0">
          <ImageTemplateTab />
        </TabsContent>

        <TabsContent value="ai-agent" className="mt-0">
          <AiAgentTab />
        </TabsContent>

        <TabsContent value="schedule" className="mt-0">
          {currentChannel ? (
            <div className="space-y-4">
              {/* Channel info bar */}
              <Card>
                <CardContent className="py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{currentChannel.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {currentChannel.platform === 'sora2-kie' ? t('scheduler.server1') : t('scheduler.server2')} | {currentChannel.duration}s | {currentChannel.aspect_ratio}
                      </p>
                      {/* Platform tags */}
                      {(() => {
                        const platforms: string[] = [];
                        const pfmMap: Record<number, string> = { 0: 'Facebook', 1: 'Instagram', 2: 'TikTok', 3: 'YouTube', 4: 'Twitter' };
                        if (currentChannel.late_accounts?.length) {
                          currentChannel.late_accounts.forEach(a => {
                            const name = a.platform.charAt(0).toUpperCase() + a.platform.slice(1);
                            if (!platforms.includes(name)) platforms.push(name);
                          });
                        }
                        if (currentChannel.postforme_accounts?.length) {
                          currentChannel.postforme_accounts.forEach(a => {
                            try {
                              const parsed = JSON.parse(a);
                              const idx = parsed.platform_index ?? parsed.platformIndex;
                              const name = pfmMap[idx] || `Platform ${idx}`;
                              if (!platforms.includes(name)) platforms.push(name);
                            } catch {}
                          });
                        }
                        if (platforms.length === 0) return null;
                        const platformConfig: Record<string, { icon: React.ReactNode; color: string }> = {
                          Facebook: { icon: <Facebook className="h-3 w-3" />, color: 'bg-blue-600/20 text-blue-400 border-blue-500/30' },
                          Youtube: { icon: <Youtube className="h-3 w-3" />, color: 'bg-red-600/20 text-red-400 border-red-500/30' },
                          YouTube: { icon: <Youtube className="h-3 w-3" />, color: 'bg-red-600/20 text-red-400 border-red-500/30' },
                          Tiktok: { icon: <Music2 className="h-3 w-3" />, color: 'bg-zinc-800/50 text-white border-zinc-600/30' },
                          TikTok: { icon: <Music2 className="h-3 w-3" />, color: 'bg-zinc-800/50 text-white border-zinc-600/30' },
                          Instagram: { icon: <Instagram className="h-3 w-3" />, color: 'bg-pink-600/20 text-pink-400 border-pink-500/30' },
                          Twitter: { icon: <Twitter className="h-3 w-3" />, color: 'bg-sky-500/20 text-sky-400 border-sky-500/30' },
                        };
                        return (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {platforms.map(p => {
                              const cfg = platformConfig[p];
                              return (
                                <Badge key={p} variant="outline" className={cn("text-[10px] px-2 py-0.5 flex items-center gap-1", cfg?.color || '')}>
                                  {cfg?.icon}
                                  {p}
                                </Badge>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/app/history?channel_id=${currentChannel.id}`)}
                      >
                        <History className="h-4 w-4 mr-1" />
                        {t('scheduler.history')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentChannel(null)}
                      >
                        {t('scheduler.changeChannel')}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Calendar - Full Width */}
              <Card>
                <CardContent className="pt-6">
                  <ScheduleCalendar
                    channel={currentChannel}
                    onDayClick={handleDayClick}
                    onMultiDayAdd={handleMultiDayAdd}
                    onMultiDayView={handleMultiDayView}
                  />
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">{t('scheduler.noChannelSelected')}</h3>
                <p className="text-muted-foreground mb-4">
                  {t('scheduler.selectChannelMessage')}
                </p>
                <Button onClick={() => handleTabChange('channels')}>
                  {t('scheduler.goToChannels')}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <HistoryTab />
        </TabsContent>

        <TabsContent value="images" className="mt-0">
          <ImageGallery />
        </TabsContent>

        <TabsContent value="videos" className="mt-0">
          <VideoGallery />
        </TabsContent>

      </Tabs>

      {/* Modals */}
      <ChannelForm
        open={channelFormOpen}
        onClose={() => {
          setChannelFormOpen(false);
          setEditingChannel(null);
        }}
        channel={editingChannel}
      />

      <DayDetailModal
        open={dayDetailOpen}
        onClose={() => {
          setDayDetailOpen(false);
          setSelectedDates([]);
          setShowAddFormOnOpen(false);
          // Clear URL params when modal closes
          setSearchParams({});
        }}
        dateStr={selectedDayDate}
        dates={selectedDates.length > 0 ? selectedDates : undefined}
        slots={selectedDaySlots}
        showAddFormOnOpen={showAddFormOnOpen}
      />

      {/* Schedule Tip + Video Ready Popup */}
      <Dialog open={showScheduleTip || showVideoReady} onOpenChange={(open) => {
        if (!open) {
          setShowScheduleTip(false);
          setShowVideoReady(false);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-[#FFB300]" />
              {t('scheduler.tip')}
            </DialogTitle>
            <DialogDescription className="text-base pt-2">
              {t('scheduler.tipMessage')}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                localStorage.setItem('scheduleTipDismissed', 'true');
                setShowScheduleTip(false);
                setShowVideoReady(false);
              }}
            >
              {t('scheduler.dontShowAgain')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Support Popup */}
      <Dialog open={supportOpen} onOpenChange={setSupportOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Headphones className="h-5 w-5 text-[#06C755]" />
              {t('nav.support.title')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {/* LINE ID */}
            <div className="flex items-center gap-3 w-full px-4 py-3 bg-[#06C755]/10 rounded-lg">
              <img src="/LINE_logo.svg.png" alt="LINE" className="h-8 w-8" />
              <div>
                <div className="text-xs text-muted-foreground">{t('nav.support.lineId')}</div>
                <div className="font-semibold text-base">@442dnfxt</div>
              </div>
            </div>

            {/* Add Friend Button */}
            <a
              href="https://lin.ee/Ni8jtUT"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 bg-[#06C755] hover:bg-[#05b34c] text-white font-semibold rounded-lg transition-colors"
            >
              <img src="/LINE_logo.svg.png" alt="LINE" className="h-5 w-5 brightness-0 invert" />
              {t('nav.support.addFriend')}
            </a>

            {/* QR Code */}
            <div className="text-sm text-muted-foreground">{t('nav.support.scanQr')}</div>
            <img
              src="https://qr-official.line.me/gs/M_442dnfxt_GW.png?oat_content=qr"
              alt="LINE QR Code"
              className="w-48 h-48 rounded-lg"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const ContentScheduler: React.FC = () => {
  return (
    <div className="page-wrapper">
      <SchedulerProvider>
        <ContentSchedulerContent />
      </SchedulerProvider>
    </div>
  );
};

export default ContentScheduler;
