import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { flushSync } from 'react-dom';
import { Sparkles, Plus, X, Loader2, Settings2, Bot, Type, Star, Upload, Clock, BookOpen, Trash2, Play, Check, ImageIcon, ChevronDown, Volume2, VolumeX, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
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
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { SchedulerChannel, PageIds, ChannelExamplePrompt, Variable, PromptTemplate, PostingService, LateAccountMapping } from '@/types/scheduler';
import { VariableEditorModal } from './VariableEditorModal';
import { IdolImageGallery } from '@/components/idol/IdolImageGallery';
import { ChannelSceneScopeDialog } from './ChannelSceneScopeDialog';
import { TimezoneSelector } from '@/components/ui/timezone-selector';
import LazyYouTubeIframe, { type LazyYouTubeIframeHandle } from '@/components/ui/LazyYouTubeIframe';
import { toast } from 'sonner';
import { Facebook, Instagram, Youtube, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { v4 as uuidv4 } from 'uuid';

// Video preview component for Prompt Library - autoplay muted with mute/unmute toggle
const LibraryVideoPreview: React.FC<{ videoUrl: string; ytId: string | null; thumbSrc: string | null; name: string }> = ({ videoUrl, ytId, thumbSrc, name }) => {
  const ytRef = React.useRef<LazyYouTubeIframeHandle>(null);
  const [unmuted, setUnmuted] = React.useState(false);

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (unmuted) { ytRef.current?.postMessage('mute'); setUnmuted(false); }
    else { ytRef.current?.postMessage('unMute'); setUnmuted(true); }
  };

  return (
    <div className="relative aspect-[9/16] bg-zinc-900 overflow-hidden rounded-t-lg">
      {ytId ? (
        <LazyYouTubeIframe ref={ytRef} url={`https://www.youtube.com/embed/${ytId}`} thumbnailUrl={thumbSrc} />
      ) : videoUrl ? (
        <video src={videoUrl} className="w-full h-full object-cover" autoPlay muted loop playsInline preload="none" poster={thumbSrc || undefined} />
      ) : thumbSrc ? (
        <img src={thumbSrc} alt={name} className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-zinc-700" />
        </div>
      )}
      {(ytId || videoUrl) && (
        <button
          type="button"
          onClick={toggleMute}
          className={`absolute top-2 right-2 p-1.5 rounded-full transition-colors z-10 ${unmuted ? 'bg-[#FFB300] text-black' : 'bg-black/60 text-white hover:bg-black/80'}`}
        >
          {unmuted ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
};

interface ChannelFormProps {
  open: boolean;
  onClose: () => void;
  channel?: SchedulerChannel | null;
}

// Inline comma-separated multi-value input (used by Idol Template only).
// User types "a, b, c" → stored as variable values with round-robin loop.
// Preserves 'used' status for values that remained the same between edits.
const InlineMultiValueInput: React.FC<{
  varName: string;
  placeholder?: string;
  aiVariables: Variable[];
  setAiVariables: React.Dispatch<React.SetStateAction<Variable[]>>;
}> = ({ varName, placeholder, aiVariables, setAiVariables }) => {
  const matched = aiVariables.find(v => v.name === varName);
  const externalText = (matched?.values || []).map(v => v.value).join(', ');
  const [local, setLocal] = useState(externalText);
  const lastSyncedRef = useRef(externalText);

  // Sync local ↔ external when external changes from outside (e.g. template switch)
  useEffect(() => {
    if (externalText !== lastSyncedRef.current) {
      setLocal(externalText);
      lastSyncedRef.current = externalText;
    }
  }, [externalText]);

  const commit = () => {
    const parts = local.split(',').map(s => s.trim()).filter(Boolean);
    const prevValues = matched?.values || [];
    const nextValues = parts.map(value => {
      const existing = prevValues.find(v => v.value === value);
      // VariableValue requires an `id`. Reuse the prior row's id when the value
      // already exists; otherwise mint a short local id — the BE assigns the
      // real id on persist, so any non-empty string works as a key for now.
      return existing || {
        id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        value,
        status: 'new' as const,
      };
    });
    lastSyncedRef.current = parts.join(', ');
    setAiVariables(prev => {
      const exists = prev.some(v => v.name === varName);
      if (exists) {
        return prev.map(v => v.name === varName ? { ...v, values: nextValues, loop: true } : v);
      }
      return [...prev, { name: varName, values: nextValues, loop: true }];
    });
  };

  return (
    <input
      type="text"
      className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-[#FFB300]/50"
      placeholder={placeholder || 'พิมพ์หลายค่าคั่นด้วย , (comma)'}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
    />
  );
};

// Single Idol image picker per template (for Idol Template ai_model).
// Outfit/Background are handled by the normal variables system.
const IdolImageField: React.FC<{
  value: string;
  onChange: (url: string) => void;
}> = ({ value, onChange }) => {
  const [galleryOpen, setGalleryOpen] = useState(false);
  return (
    <div className="space-y-2 pt-2 border-t border-gray-700">
      <Label className="text-[#FFB300]">รูป Idol</Label>
      {value ? (
        <div className="flex justify-center">
          <div
            onClick={() => setGalleryOpen(true)}
            className="relative rounded-lg border-2 border-dashed border-green-700 bg-green-900/10 p-1.5 cursor-pointer transition-colors"
          >
            <img src={value} alt="Idol" className="h-40 w-auto rounded object-cover block" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="absolute top-1 right-1 bg-zinc-900/80 rounded-full p-1 hover:bg-red-900/80"
            >
              <X className="h-3.5 w-3.5 text-zinc-400 hover:text-red-400" />
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => setGalleryOpen(true)}
          className="relative w-full flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-3 cursor-pointer transition-colors min-h-[120px] border-zinc-700 bg-zinc-800/50 hover:border-zinc-500"
        >
          <ImageIcon className="h-8 w-8 text-zinc-600 mb-1" />
          <span className="text-xs text-zinc-500">เลือกรูป Idol</span>
        </div>
      )}
      <IdolImageGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        title="เลือกรูป Idol"
        category="idol"
        onSelect={(url) => { onChange(url); setGalleryOpen(false); }}
      />
    </div>
  );
};

export const ChannelForm: React.FC<ChannelFormProps> = ({
  open,
  onClose,
  channel,
}) => {
  const { createChannel, updateChannel, fetchChannels, timePresets, fetchTimePresets } = useScheduler();
  const { t, language } = useLanguage();
  const { subscription } = useSubscription();
  const { user } = useAuth();
  const LATE_CUTOFF = '2026-03-28T00:00:00.000Z';
  const LATE_REMOVAL = '2026-04-28T00:00:00.000Z';
  const showLateOption = useMemo(() => {
    if (new Date() >= new Date(LATE_REMOVAL)) return false;
    if (!user?.createdAt) return true;
    return new Date(user.createdAt) < new Date(LATE_CUTOFF);
  }, [user?.createdAt]);
  const isYearly = subscription?.planType === 'yearly';
  const [loading, setLoading] = useState(false);
  const [timeSlots, setTimeSlots] = useState<string[]>(['10:00', '14:00', '18:00']);
  const [newPresetName, setNewPresetName] = useState('');
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [showPostformeGuide, setShowPostformeGuide] = useState(false);
  const [postformeKeysList, setPostformeKeysList] = useState<{ name: string; maskedKey: string }[]>([]);
  const [showLateGuide, setShowLateGuide] = useState(false);
  const [spcError, setSpcError] = useState(false);
  const [promptError, setPromptError] = useState(false);
  const [guideLightbox, setGuideLightbox] = useState<string | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const autoSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFormInitialized = React.useRef(false);

  const defaultPageIds: PageIds = {
    facebook: '',
    instagram: '',
    tiktok: '',
    twitter: '',
    youtube: '',
  };

  const [formData, setFormData] = useState({
    name: '',
    platform: 'sora2-grsai' as 'sora2-kie' | 'sora2-grsai' | 'sora2-vidgo',
    duration: '15' as '6' | '8' | '10' | '15' | '20' | '30',
    aspect_ratio: 'portrait' as 'portrait' | 'landscape',
    prompt_mode: 'variable' as 'ai' | 'variable',
    caption_language: 'en' as 'en' | 'th',
    custom_hashtags: '#viral\n#trending\n#shorts',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    posts_per_day: 3,
    posting_service: 'none' as 'blotato' | 'late' | 'postforme' | 'none',
    blotato_account_id: '',
    blotato_api_key: '',
    page_ids: defaultPageIds,
    late_api_key: '',
    late_profile_id: '',
    late_accounts: [] as Array<{ platform: string; accountId: string }>,
    fb_admin_profile_id: '',
    postforme_api_key: '',
    postforme_accounts: [] as string[],
    channel_highlight: '',
    channel_concept: '',
    ai_model: 'sora2_15s' as 'sora2_15s' | 'veo3_1' | 'grok_imagine' | 'kie_sora2' | 'kie_grok_imagine' | 'kie_grok_extend' | 'kie_viral_template' | 'kie_idol_template',
    auto_retry_hours: null as number | null,
    prompt_temperature: 0.5,
    prompt_template: '',
    // Watermark
    watermark_enabled: false,
    watermark_type: 'text' as 'text' | 'image' | 'both',
    watermark_text: '',
    watermark_image_url: null as string | null,
    watermark_image_path: null as string | null,
    watermark_position: 'bottom-right' as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
    watermark_opacity: 50,
    watermark_image_size: 'medium' as 'small' | 'medium' | 'large',
    watermark_circular: false,
  });

  // Variable system state
  const [variables, setVariables] = useState<Variable[]>([]);
  const [editingVariable, setEditingVariable] = useState<Variable | null>(null);

  // Extend prompt for single-template mode
  const [extendPromptText, setExtendPromptText] = useState('');
  const [extendVariables, setExtendVariables] = useState<Variable[]>([]);

  // Track which context (main or extend) is editing a variable
  // 'main' = the main prompt's variables, 'extend' = the extend prompt's variables,
  // 'ai' = the AI prompt system's separate variable list. All three editor flows
  // share the same dialog component, switching the context tells the save handler
  // where to commit.
  const [editingVariableContext, setEditingVariableContext] = useState<'main' | 'extend' | 'ai'>('main');
  const [variableEditorOpen, setVariableEditorOpen] = useState(false);
  const [newVarName, setNewVarName] = useState('');

  // Per-template per-scene reference image picker (matches ViralTaskCard UI)
  const [refImageGallery, setRefImageGallery] = useState<{
    spIdx: number;
    sceneIdx: number;
    mode: 'idol' | 'outfit' | 'background';
  } | null>(null);
  // After picking from gallery, open scope dialog to choose which scenes the URL applies to
  const [refScopeDialog, setRefScopeDialog] = useState<{
    spIdx: number;
    sceneIdx: number;
    mode: 'idol' | 'outfit' | 'background';
    url: string;
    totalScenes: number;
  } | null>(null);

  // Multi-template state
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [templateSelectionMode, setTemplateSelectionMode] = useState<'round-robin' | 'random'>('round-robin');
  // Example prompts state
  const [examplePrompts, setExamplePrompts] = useState<ChannelExamplePrompt[]>([]);
  const [newPromptText, setNewPromptText] = useState('');
  const [addingPrompt, setAddingPrompt] = useState(false);

  // System prompt state
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [viralCustomPromptsList, setViralCustomPromptsList] = useState<any[]>([]);
  const [showViralPromptPicker, setShowViralPromptPicker] = useState(false);
  const [viralPromptFilter, setViralPromptFilter] = useState<'all' | 'template' | 'custom' | 'male' | 'female'>('all');
  const [viralPromptSortBy, setViralPromptSortBy] = useState<'latest' | 'popular'>('latest');
  const [selectedViralPrompts, setSelectedViralPrompts] = useState<Array<{ id: string; name: string; video: string; config: any; prompt_text: string; tasks: Array<{ id: string; values: Record<string, string[]> }> }>>([]);
  const [taskVarInput, setTaskVarInput] = useState<Record<string, string>>({});
  const [addingPromptIndex, setAddingPromptIndex] = useState<number>(-1);
  const [activeViralPromptIdx, setActiveViralPromptIdx] = useState<number>(0);
  const [selectedViralPromptName, setSelectedViralPromptName] = useState<string>('');
  const [selectedViralPromptVideo, setSelectedViralPromptVideo] = useState<string>('');
  const [selectedViralPromptConfig, setSelectedViralPromptConfig] = useState<any>(null);
  const [showViralScenesSelector, setShowViralScenesSelector] = useState(false);
  const [viralTasks, setViralTasks] = useState<Array<{ id: string; character_name: string }>>([
    { id: '1', character_name: '' }
  ]);
  const [aiVariables, setAiVariables] = useState<Variable[]>([]);
  const [aiNewVarName, setAiNewVarName] = useState('');
  const [aiPromptTemplates, setAiPromptTemplates] = useState<Array<{ id: string; label: string; prompt: string; variables: Variable[]; scenes_per_video?: number; idol_image?: string; duration?: number; slug?: string; reference_images?: Record<string, string>; image_prompt_template?: string; video_prompt_template?: string }>>([
    { id: '1', label: 'Template 1', prompt: '', variables: [] }
  ]);
  const [activeAiTemplateId, setActiveAiTemplateId] = useState('1');

  // Stash template picker state per ai_model so switching models doesn't wipe settings.
  // Key = ai_model string; value = snapshot of template-related state.
  type TemplateStash = {
    selectedViralPrompts: typeof selectedViralPrompts;
    aiPromptTemplates: typeof aiPromptTemplates;
    aiVariables: Variable[];
    activeViralPromptIdx: number;
    systemPrompt: string;
  };
  const templateStashRef = useRef<Record<string, TemplateStash>>({});

  // Auto-detect variables from system prompt [VarName] or {VarName}
  // Skip during initial form load to prevent overriding saved values
  const aiVarsInitialized = useRef(false);
  useEffect(() => {
    if (!systemPrompt) return;
    // Skip first run (initial load) to let saved variables load first
    if (!aiVarsInitialized.current) {
      aiVarsInitialized.current = true;
      return;
    }
    const matches = new Set<string>();
    const regex = /\[([A-Za-z_][\w ]*)\]|\{([A-Za-z_][\w ]*)\}/g;
    let m;
    while ((m = regex.exec(systemPrompt)) !== null) {
      const name = m[1] ?? m[2];
      if (name && name !== 'undefined') matches.add(name);
    }
    setAiVariables(prev => {
      // Keep all existing variables (including per_scene ones with values)
      const existingMap = new Map(prev.map(v => [v.name, v] as const));
      // Also check active template's stored variables
      const activeTmpl = aiPromptTemplates.find(t => t.id === activeAiTemplateId);
      const storedVars = activeTmpl?.variables || [];
      for (const v of storedVars) {
        if (!existingMap.has(v.name)) existingMap.set(v.name, v);
      }
      // Merge detected variables with existing (preserve values)
      const detected = Array.from(matches).map(name => existingMap.get(name) || { name, values: [], loop: true });
      // Keep per_scene and other variables that aren't detected by regex but have values
      const extraVars = prev.filter(v => v.values && v.values.length > 0 && !matches.has(v.name));
      const merged = [...detected, ...extraVars];
      if (merged.length === 0 && prev.length > 0) return prev;
      return merged;
    });
  }, [systemPrompt]);

  // Import from favorites state
  const [favoritePrompts, setFavoritePrompts] = useState<any[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [loadingFavorites, setLoadingFavorites] = useState(false);

  // Prompt Library state
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [promptLibraryTemplates, setPromptLibraryTemplates] = useState<any[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'sora2' | 'veo' | 'grok10s' | 'grok-extend' | 'favorite' | 'custom'>('all');
  const [libraryFavorites, setLibraryFavorites] = useState<any[]>([]);
  const [libraryCustom, setLibraryCustom] = useState<any[]>([]);

  // Saved Late Profiles state
  const [savedLateProfiles, setSavedLateProfiles] = useState<Array<{
    id: number;
    profile_id: string;
    display_name: string;
    avatar_url?: string;
  }>>([]);
  const [addLateProfileDialogOpen, setAddLateProfileDialogOpen] = useState(false);
  const [newLateProfile, setNewLateProfile] = useState({
    profile_id: '',
    display_name: '',
    avatar_url: '',
  });
  const [savingLateProfile, setSavingLateProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('channelForm.fileTooLarge'));
      return;
    }

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);

      const response = await fetch(`${api.getApiUrl()}/api/scheduler/channels/upload-avatar`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${api.getToken()}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      setNewLateProfile(prev => ({ ...prev, avatar_url: `${api.getApiUrl()}${data.url}` }));
      toast.success(t('channelForm.uploadSuccess'));
    } catch (err: any) {
      toast.error(err.message || t('channelForm.uploadFailed'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  // Fetch saved Late profiles
  useEffect(() => {
    if (open) {
      api.getSavedLateProfiles().then(profiles => {
        setSavedLateProfiles(profiles || []);
      }).catch(err => {
        console.error('Failed to fetch saved late profiles:', err);
      });
      api.getPostformeKeys().then((keys: any) => {
        setPostformeKeysList(keys || []);
      }).catch(() => {});
    }
  }, [open]);

  const handleSaveLateProfile = async () => {
    if (!newLateProfile.display_name.trim()) {
      toast.error(t('channelForm.nameRequired'));
      return;
    }
    setSavingLateProfile(true);
    try {
      // Use entered Late ID if provided, otherwise generate UUID
      const profileId = newLateProfile.profile_id.trim() || uuidv4();
      const saved = await api.createSavedLateProfile({
        profile_id: profileId,
        display_name: newLateProfile.display_name.trim(),
        avatar_url: newLateProfile.avatar_url.trim() || undefined,
      });
      setSavedLateProfiles(prev => {
        // Update if exists (same profile_id)
        const exists = prev.find(p => p.profile_id === saved.profile_id);
        if (exists) {
          return prev.map(p => p.profile_id === saved.profile_id ? saved : p);
        }
        return [...prev, saved];
      });
      setAddLateProfileDialogOpen(false);
      setNewLateProfile({ profile_id: '', display_name: '', avatar_url: '' });
      toast.success(t('channelForm.profileSaved'));
    } catch (err: any) {
      toast.error(err.message || t('channelForm.profileSaveFailed'));
    } finally {
      setSavingLateProfile(false);
    }
  };

  useEffect(() => {
    if (channel) {
      setFormData({
        name: channel.name,
        platform: channel.platform,
        duration: channel.duration,
        aspect_ratio: channel.aspect_ratio,
        prompt_mode: channel.prompt_mode || 'variable',
        caption_language: channel.caption_language,
        custom_hashtags: channel.custom_hashtags || '#viral\n#trending\n#shorts',
        timezone: channel.timezone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : channel.timezone,
        posts_per_day: channel.posts_per_day || 3,
        posting_service: channel.posting_service || 'none',
        blotato_account_id: channel.blotato_account_id || '',
        blotato_api_key: channel.blotato_api_key || '',
        page_ids: channel.page_ids || defaultPageIds,
        late_api_key: channel.late_api_key || '',
        late_profile_id: channel.late_profile_id || '',
        late_accounts: channel.late_accounts || [],
        fb_admin_profile_id: channel.fb_admin_profile_id || '',
        postforme_api_key: channel.postforme_api_key || '',
        postforme_accounts: channel.postforme_accounts || [],
        channel_highlight: channel.channel_highlight || '',
        channel_concept: channel.channel_concept || '',
        ai_model: channel.ai_model || 'sora2_15s',
        auto_retry_hours: channel.auto_retry_hours ?? null,
        prompt_temperature: channel.prompt_temperature ?? 0.5,
        prompt_template: channel.prompt_template || '',
        watermark_enabled: !!channel.watermark_enabled,
        watermark_type: channel.watermark_type || 'text',
        watermark_text: channel.watermark_text || '',
        watermark_image_url: channel.watermark_image_url || null,
        watermark_image_path: channel.watermark_image_path || null,
        watermark_position: channel.watermark_position || 'bottom-right',
        watermark_opacity: channel.watermark_opacity ?? 50,
        watermark_image_size: channel.watermark_image_size || 'medium',
        watermark_circular: !!channel.watermark_circular,
        viral_scenes_per_video: (channel as any).viral_scenes_per_video ?? 3,
      } as any);
      // Load existing variables and auto-extract any missing from prompt template
      const existingVars = (channel.variables || []).map(v => ({
        ...v,
        values: v.values || [],
        loop: true,
      }));
      const existingNames = new Set(existingVars.map(v => v.name));
      const templateText = channel.prompt_template || '';
      // Support both {VAR} and [VAR] formats
      const curlyMatches = templateText.match(/\{([^}]+)\}/g) || [];
      const squareMatches = templateText.match(/\[([^\]]+)\]/g) || [];
      const allMatches = [...curlyMatches, ...squareMatches];
      const extractedNames = [...new Set(allMatches.map(m => m.replace(/[\{\}\[\]]/g, '')))];
      const missingVars = extractedNames
        .filter(name => !existingNames.has(name))
        .map(name => ({ name, system_prompt: '', values: [] as any[], loop: true }));
      setVariables([...existingVars, ...missingVars]);

      // Load multi-template state (variable mode only — AI mode uses ai_prompt_templates below)
      if (channel.prompt_mode !== 'ai' && channel.prompt_templates && channel.prompt_templates.length > 0) {
        console.log('[ChannelForm] RAW templates from backend:', JSON.stringify(channel.prompt_templates[0]?.variables?.map((v: any) => ({ name: v.name, valuesCount: v.values?.length }))));
        // Auto-extract variables and merge values from legacy channel variables
        const legacyVars = channel.variables || [];
        const loadedTemplates = channel.prompt_templates.map((tmpl: PromptTemplate) => {
          const curlyMatches = (tmpl.prompt_template || '').match(/\{([^}]+)\}/g) || [];
          const squareMatches = (tmpl.prompt_template || '').match(/\[([^\]]+)\]/g) || [];
          const allMatches = [...curlyMatches, ...squareMatches];
          const varNames = [...new Set(allMatches.map((m: string) => m.replace(/[\{\}\[\]]/g, '')))];
          console.log('[ChannelForm] Extracted varNames from prompt:', varNames);
          console.log('[ChannelForm] tmpl.variables from backend:', tmpl.variables?.map((v: any) => ({ name: v.name, valuesCount: v.values?.length })));

          const tmplVarMap = new Map((tmpl.variables || []).map((v: Variable) => [v.name, v]));
          const finalVars = varNames.map(name => {
            const tmplVar = tmplVarMap.get(name);
            const legacyVar = legacyVars.find((v: Variable) => v.name === name);
            console.log(`[ChannelForm] Looking for "${name}": tmplVar=${tmplVar ? `found with ${tmplVar.values?.length} values` : 'NOT FOUND'}`);
            // If template var has values, use it; otherwise always pull from legacy
            if (tmplVar && tmplVar.values && tmplVar.values.length > 0) {
              return tmplVar;
            }
            if (legacyVar && legacyVar.values && legacyVar.values.length > 0) {
              return { ...legacyVar };
            }
            return tmplVar || { name, system_prompt: '', values: [] as any[], loop: true };
          });
          // Keep any saved variables with values that aren't in prompt text (prevent data loss)
          const finalVarNames = new Set(varNames);
          const extraVars = (tmpl.variables || []).filter((v: Variable) =>
            !finalVarNames.has(v.name) && v.values && v.values.length > 0
          );
          if (extraVars.length > 0) {
            console.log(`[ChannelForm] Keeping extra main vars with values:`, extraVars.map((v: Variable) => v.name));
            finalVars.push(...extraVars);
          }

          // Also process extend_variables if present
          const extCurlyMatches = (tmpl.extend_prompt_template || '').match(/\{([^}]+)\}/g) || [];
          const extSquareMatches = (tmpl.extend_prompt_template || '').match(/\[([^\]]+)\]/g) || [];
          const extAllMatches = [...extCurlyMatches, ...extSquareMatches];
          const extVarNames = [...new Set(extAllMatches.map((m: string) => m.replace(/[\{\}\[\]]/g, '')))];
          const extVarMap = new Map((tmpl.extend_variables || []).map((v: Variable) => [v.name, v]));
          const finalExtVars = extVarNames.map(name => {
            return extVarMap.get(name) || { name, system_prompt: '', values: [] as any[], loop: true };
          });
          // Keep any saved extend variables with values that aren't in extend prompt text
          const finalExtVarNames = new Set(extVarNames);
          const extraExtVars = (tmpl.extend_variables || []).filter((v: Variable) =>
            !finalExtVarNames.has(v.name) && v.values && v.values.length > 0
          );
          if (extraExtVars.length > 0) {
            console.log(`[ChannelForm] Keeping extra extend vars with values:`, extraExtVars.map((v: Variable) => v.name));
            finalExtVars.push(...extraExtVars);
          }

          console.log('[ChannelForm] extend_variables from backend:', tmpl.extend_variables?.map((v: any) => ({ name: v.name, valuesCount: v.values?.length })));
          console.log('[ChannelForm] finalExtVars after processing:', finalExtVars.map((v: any) => ({ name: v.name, valuesCount: v.values?.length })));
          return { ...tmpl, variables: finalVars, extend_variables: finalExtVars.length > 0 ? finalExtVars : tmpl.extend_variables };
        });
        console.log('[ChannelForm] After processing, first template variables:', loadedTemplates[0]?.variables?.map((v: any) => ({ name: v.name, valuesCount: v.values?.length })));
        console.log('[ChannelForm] After processing, first template extend_variables:', loadedTemplates[0]?.extend_variables?.map((v: any) => ({ name: v.name, valuesCount: v.values?.length })));
        setPromptTemplates(loadedTemplates);
        setActiveTemplateId(loadedTemplates[0].id);
        setTemplateSelectionMode(channel.template_selection_mode || 'round-robin');
      }

      // Load single-template extend prompt
      if (channel.extend_prompt) {
        setExtendPromptText(channel.extend_prompt);
        // Extract variables from extend prompt (support spaces in variable names)
        const extCurlyMatches = (channel.extend_prompt || '').match(/\{([^}]+)\}/g) || [];
        const extSquareMatches = (channel.extend_prompt || '').match(/\[([^\]]+)\]/g) || [];
        const extAllMatches = [...extCurlyMatches, ...extSquareMatches];
        const extVarNames = [...new Set(extAllMatches.map((m: string) => m.replace(/[\{\}\[\]]/g, '')))];
        const extVars = extVarNames.map(name => ({ name, system_prompt: '', values: [] as any[], loop: true }));
        // Merge with saved extend_variables if available
        if (channel.extend_variables && channel.extend_variables.length > 0) {
          const savedMap = new Map((channel.extend_variables as Variable[]).map(v => [v.name, v]));
          const merged = extVarNames.map(name => savedMap.get(name) || { name, system_prompt: '', values: [] as any[], loop: true });
          setExtendVariables(merged);
        } else {
          setExtendVariables(extVars);
        }
      }

      setExamplePrompts(channel.example_prompts || []);
      setSystemPrompt(channel.system_prompt || '');
      setTimeSlots(channel.time_slots || ['10:00', '14:00', '18:00']);

      // Load AI Prompt System data from saved ai_prompt_templates (when ai mode)
      // Fallback to prompt_templates for legacy channels that still have AI data in the old field
      if (channel.prompt_mode === 'ai') {
        const aiSource = (channel.ai_prompt_templates && channel.ai_prompt_templates.length > 0)
          ? channel.ai_prompt_templates
          : (channel.prompt_templates && channel.prompt_templates.length > 0 ? channel.prompt_templates : null);
        if (aiSource) {
          const seenIds = new Set<string>();
          const fallbackScenes = (channel as any).viral_scenes_per_video ?? 3;
          const loadedAiTemplates = aiSource.map((t: any, i: number) => {
            let id = t.id || `${Date.now()}_${i}`;
            if (seenIds.has(id)) id = `${id}_${i}`;
            seenIds.add(id);
            return {
              id,
              label: t.label || `Template ${i + 1}`,
              prompt: t.prompt_template || '',
              variables: t.variables || [],
              scenes_per_video: t.scenes_per_video ?? fallbackScenes,
              idol_image: typeof t.idol_image === 'string' ? t.idol_image : '',
              duration: typeof t.duration === 'number' ? t.duration : 10,
              slug: typeof t.slug === 'string' ? t.slug : undefined,
              reference_images: t.reference_images && typeof t.reference_images === 'object' ? t.reference_images : {},
              image_prompt_template: typeof t.image_prompt_template === 'string' ? t.image_prompt_template : undefined,
              video_prompt_template: typeof t.video_prompt_template === 'string' ? t.video_prompt_template : undefined,
            };
          });
          setAiPromptTemplates(loadedAiTemplates);
          setActiveAiTemplateId(loadedAiTemplates[0]?.id || '1');
          // Restore selectedViralPrompts from saved data
          if (channel.selected_viral_prompts && channel.selected_viral_prompts.length > 0) {
            setSelectedViralPrompts(channel.selected_viral_prompts);
          } else {
            // Fallback: reconstruct from aiPromptTemplates
            setSelectedViralPrompts(loadedAiTemplates.map((t: any) => ({
              id: t.id,
              name: t.label,
              video: '',
              config: {},
              prompt_text: t.prompt,
              tasks: [{ id: '1', values: {} as Record<string, string[]> }],
            })));
          }
          setActiveViralPromptIdx(0);
          // Set systemPrompt to first template's prompt (not channel.system_prompt)
          setSystemPrompt(loadedAiTemplates[0]?.prompt || channel.system_prompt || '');
          // Load AI variables from first template or channel variables
          const loadedVars = aiSource[0]?.variables || channel.variables || [];
          setAiVariables(loadedVars);
        }
      }
    } else {
      setFormData({
        name: '',
        platform: 'sora2-grsai',
        duration: '15',
        aspect_ratio: 'portrait',
        prompt_mode: 'variable',
        caption_language: 'en',
        custom_hashtags: '#viral\n#trending\n#shorts',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        posts_per_day: 3,
        posting_service: 'none',
        blotato_account_id: '',
        blotato_api_key: '',
        page_ids: defaultPageIds,
        late_api_key: '',
        late_profile_id: '',
        late_accounts: [],
        fb_admin_profile_id: '',
        postforme_api_key: '',
        postforme_accounts: [],
        channel_highlight: '',
        channel_concept: '',
        ai_model: 'sora2_15s',
        auto_retry_hours: null,
        prompt_temperature: 0.5,
        prompt_template: '',
        watermark_enabled: false,
        watermark_type: 'text',
        watermark_text: '',
        watermark_image_url: null,
        watermark_image_path: null,
        watermark_position: 'bottom-right',
        watermark_opacity: 50,
        watermark_image_size: 'medium',
        watermark_circular: false,
      });
      setVariables([]);
      setExamplePrompts([]);
      setSystemPrompt('');
      setTimeSlots(['10:00', '14:00', '18:00']);
    }
    setNewPromptText('');
    setNewVarName('');
    setSpcError(false);
    isFormInitialized.current = false;
    if (open) fetchTimePresets();
  }, [channel, open]);

  // Auto-detect variables from prompt template in real-time
  useEffect(() => {
    if (formData.prompt_mode !== 'variable') return;
    const templateText = formData.prompt_template || '';
    const curlyMatches = templateText.match(/\{([^}]+)\}/g) || [];
    const squareMatches = templateText.match(/\[([^\]]+)\]/g) || [];
    const allMatches = [...curlyMatches, ...squareMatches];
    const extractedNames = [...new Set(allMatches.map(m => m.replace(/[\{\}\[\]]/g, '')))];

    setVariables(prev => {
      const existingNames = new Set(prev.map(v => v.name));
      const newVarNames = extractedNames.filter(name => !existingNames.has(name));
      const newVars = newVarNames
        .map(name => ({ name, system_prompt: '', values: [] as any[], loop: true }));

      // Also remove variables that are no longer in the template (unless they have values)
      const stillInTemplate = new Set(extractedNames);
      const kept = prev.filter(v => stillInTemplate.has(v.name) || (v.values && v.values.length > 0));
      if (newVars.length === 0 && kept.length === prev.length) return prev; // no change
      return [...kept, ...newVars];
    });
  }, [formData.prompt_template, formData.prompt_mode]);

  // ========== Auto-save for existing channels (debounced) ==========
  useEffect(() => {
    // Mark form as initialized after first render with data
    if (!isFormInitialized.current) {
      // Wait a tick so initial load doesn't trigger auto-save
      const t = setTimeout(() => { isFormInitialized.current = true; }, 1000);
      return () => clearTimeout(t);
    }
    if (!channel || !open) return;
    if (!formData.name.trim()) return;

    // Debounce: wait 1.5s after last change
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaving(true);
      try {
        const { auto_retry_hours, ...restFormData } = formData;
        // In multi-template mode, don't send single-template variables to avoid overwriting
        const isMultiTemplate = promptTemplates.length > 0;
        // AI mode: convert aiPromptTemplates to prompt_templates format + save aiVariables
        const isAiMode = formData.prompt_mode === 'ai';
        // Save current aiVariables into active template before building save payload
        let aiTemplatesForSave: any = undefined;
        if (isAiMode) {
          // Always emit an array (even empty) so backend COALESCE overwrites stale data
          // from previous ai_model — prevents viral prompts leaking into idol mode, etc.
          if (aiPromptTemplates.length > 0) {
            const updatedTemplates = aiPromptTemplates.map((t, i) => i === activeViralPromptIdx ? { ...t, variables: [...aiVariables] } : t);
            const filtered = selectedViralPrompts.length > 0 ? updatedTemplates.filter(t => selectedViralPrompts.some(sp => sp.name === t.label)) : updatedTemplates;
            aiTemplatesForSave = filtered.map(t => ({ id: t.id, label: t.label, prompt_template: t.prompt, variables: t.variables || [], scenes_per_video: t.scenes_per_video ?? 3, idol_image: t.idol_image || '', duration: t.duration ?? 10, slug: t.slug || undefined, reference_images: t.reference_images || {}, image_prompt_template: t.image_prompt_template || undefined, video_prompt_template: t.video_prompt_template || undefined }));
          } else {
            aiTemplatesForSave = [];
          }
        }
        const data = {
          ...restFormData,
          prompt_mode: formData.prompt_mode,
          prompt_template: isAiMode ? undefined : formData.prompt_template,
          variables: isAiMode ? aiVariables : (isMultiTemplate ? undefined : variables),
          prompt_templates: isAiMode ? [] : (isMultiTemplate ? promptTemplates : undefined),
          ai_prompt_templates: isAiMode ? aiTemplatesForSave : undefined,
          selected_viral_prompts: isAiMode ? selectedViralPrompts : undefined,
          viral_scenes_per_video: isAiMode ? ((formData as any).viral_scenes_per_video ?? 3) : undefined,
          template_selection_mode: isAiMode ? undefined : (isMultiTemplate ? templateSelectionMode : undefined),
          channel_highlight: formData.channel_highlight,
          system_prompt: systemPrompt,
          time_slots: timeSlots,
        };
        if (isMultiTemplate) {
          console.log(`[auto-save] multi-template mode, templates:`, promptTemplates.map(t => `${t.id}(vars:${t.variables?.length})`).join(', '));
        } else {
          console.log(`[auto-save] single-template, variables:`, variables.map(v => `${v.name}(${v.values?.length || 0})`).join(', '));
        }
        await updateChannel(channel.id, data);
        await fetchChannels();
      } catch (err) {
        console.error('Auto-save failed:', err);
      } finally {
        setAutoSaving(false);
      }
    }, 1500);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [formData, variables, timeSlots, systemPrompt, promptTemplates, templateSelectionMode, aiPromptTemplates, aiVariables]);

  // Reset initialized flag when form opens/closes
  useEffect(() => {
    if (open) {
      isFormInitialized.current = false;
    }
  }, [open, channel]);

  // ========== Variable System Handlers ==========
  const handleAddVariable = () => {
    const name = newVarName.trim();
    if (!name) {
      toast.error(t('channel.varNameRequired'));
      return;
    }
    if (variables.some(v => v.name === name)) {
      toast.error(t('channel.varNameDuplicate'));
      return;
    }
    setVariables(prev => [...prev, { name, values: [] }]);
    setNewVarName('');
    toast.success(t('channel.varAdded', { name: `{${name}}` }));
  };

  const handleDeleteVariable = (name: string) => {
    setVariables(prev => prev.filter(v => v.name !== name));
  };

  const handleEditVariable = (variable: Variable) => {
    setEditingVariable(variable);
    setEditingVariableContext('main');
    setVariableEditorOpen(true);
  };

  // Keep editingVariable in sync with variables (e.g. when auto-generate updates values)
  useEffect(() => {
    if (editingVariable && variableEditorOpen) {
      let updated: Variable | undefined;

      // In multi-template mode, look in the active template
      if (activeTemplateId && promptTemplates.length > 0) {
        const activeTemplate = promptTemplates.find(t => t.id === activeTemplateId);
        if (editingVariableContext === 'extend') {
          updated = activeTemplate?.extend_variables?.find(v => v.name === editingVariable.name);
        } else {
          updated = activeTemplate?.variables?.find(v => v.name === editingVariable.name);
        }
      } else if (editingVariableContext === 'ai') {
        updated = aiVariables.find(v => v.name === editingVariable.name);
      } else {
        // Single-template mode
        if (editingVariableContext === 'extend') {
          updated = extendVariables.find(v => v.name === editingVariable.name);
        } else {
          updated = variables.find(v => v.name === editingVariable.name);
        }
      }

      if (updated && updated !== editingVariable && updated.values.length !== editingVariable.values.length) {
        setEditingVariable(updated);
      }
    }
  }, [variables, extendVariables, aiVariables, promptTemplates, activeTemplateId, editingVariableContext, editingVariable, variableEditorOpen]);

  const handleSaveVariable = async (updated: Variable) => {
    // Cancel any pending auto-save to prevent stale data from overwriting this save
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    console.log('[handleSaveVariable] Called with:', {
      name: updated.name,
      valuesCount: updated.values?.length,
      context: editingVariableContext,
      hasTemplates: promptTemplates.length > 0,
      activeTemplateId
    });
    // AI Prompt System variable
    if (editingVariableContext === 'ai') {
      const newAiVars = aiVariables.map(v => v.name === updated.name ? updated : v);
      setAiVariables(newAiVars);
      // Also update the active template's variables (use index, not id)
      setAiPromptTemplates(prev => prev.map((tmpl, i) => i === activeViralPromptIdx ? { ...tmpl, variables: newAiVars } : tmpl));
      if (channel) {
        try {
          const templatesForSave = aiPromptTemplates.map((tmpl, i) => ({
            id: tmpl.id, label: tmpl.label, prompt_template: tmpl.prompt,
            variables: i === activeViralPromptIdx ? newAiVars : (tmpl.variables || [])
          }));
          await api.updateSchedulerChannel(channel.id, { variables: newAiVars, ai_prompt_templates: templatesForSave } as any);
          toast.success(t('channel.varSaved'));
        } catch (error) {
          console.error('Failed to persist AI variables:', error);
          toast.error(t('channel.varSaveFailed'));
        }
      }
      return;
    }

    // Single-template extend variable
    if (editingVariableContext === 'extend' && promptTemplates.length === 0) {
      const newExtVars = extendVariables.map(v => v.name === updated.name ? updated : v);
      setExtendVariables(newExtVars);
      if (channel) {
        try {
          await api.updateSchedulerChannel(channel.id, { extend_variables: newExtVars } as any);
          toast.success(t('channel.varSaved'));
        } catch (error) {
          console.error('Failed to persist extend variables:', error);
          toast.error(t('channel.varSaveFailed'));
        }
      }
    // Multi-template extend variable (stored inside prompt template's extend_variables)
    } else if (editingVariableContext === 'extend' && activeTemplateId && promptTemplates.length > 0) {
      // Fix: compute updatedTemplates FIRST before setState to avoid stale closure
      const updatedTemplates = promptTemplates.map(tmpl => {
        if (tmpl.id !== activeTemplateId) return tmpl;
        const extVars = tmpl.extend_variables || [];
        const exists = extVars.some(v => v.name === updated.name);
        const newExtVars = exists
          ? extVars.map(v => v.name === updated.name ? updated : v)
          : [...extVars, updated]; // Add if doesn't exist
        return { ...tmpl, extend_variables: newExtVars };
      });
      setPromptTemplates(updatedTemplates);
      if (channel) {
        try {
          console.log('[handleSaveVariable] Saving EXTEND templates, var:', updated.name, 'values:', updated.values?.length);
          await api.updateSchedulerChannel(channel.id, { prompt_templates: updatedTemplates } as any);
          toast.success(t('channel.varSaved'));
        } catch (error) {
          console.error('Failed to persist extend template variables:', error);
          toast.error(t('channel.varSaveFailed'));
        }
      }
    } else if (activeTemplateId && promptTemplates.length > 0) {
      // Check if editing a multi-template variable - compute new templates FIRST
      // Auto-detect if variable is in main or extend_variables based on where it exists
      const activeTemplate = promptTemplates.find(t => t.id === activeTemplateId);
      const isInExtend = activeTemplate?.extend_variables?.some(v => v.name === updated.name);
      const isInMain = activeTemplate?.variables?.some(v => v.name === updated.name);

      // If variable exists in extend_variables, always save to extend (prioritize extend)
      const saveToExtend = isInExtend;
      console.log('[handleSaveVariable] Auto-detect location:', { name: updated.name, isInExtend, isInMain, saveToExtend });

      const updatedTemplates = promptTemplates.map(tmpl => {
        if (tmpl.id !== activeTemplateId) return tmpl;

        if (saveToExtend) {
          // Save to extend_variables
          const extVars = tmpl.extend_variables || [];
          const newExtVars = extVars.map(v => v.name === updated.name ? updated : v);
          return { ...tmpl, extend_variables: newExtVars };
        } else {
          // Save to main variables
          const vars = tmpl.variables || [];
          const exists = vars.some(v => v.name === updated.name);
          const newVars = exists
            ? vars.map(v => v.name === updated.name ? updated : v)
            : [...vars, updated]; // Add if doesn't exist
          return { ...tmpl, variables: newVars };
        }
      });
      setPromptTemplates(updatedTemplates);
      // Persist prompt_templates to DB
      if (channel) {
        try {
          console.log('[handleSaveVariable] Saving templates, var:', updated.name, 'values:', updated.values?.length);
          await api.updateSchedulerChannel(channel.id, { prompt_templates: updatedTemplates } as any);
          toast.success(t('channel.varSaved'));
        } catch (error) {
          console.error('Failed to persist template variables:', error);
          toast.error(t('channel.varSaveFailed'));
        }
      }
    } else {
      const newVariables = variables.map(v => v.name === updated.name ? updated : v);
      setVariables(newVariables);

      // Persist to DB immediately if editing existing channel
      if (channel) {
        try {
          console.log(`[handleSaveVariable] Saving var "${updated.name}" with ${updated.values?.length || 0} values to channel ${channel.id}`);
          await api.updateChannelVariables(channel.id, newVariables);
          console.log(`[handleSaveVariable] Save success`);
          toast.success(t('channel.varSaved'));
        } catch (error) {
          console.error('Failed to persist variables:', error);
          toast.error(t('channel.varSaveFailed'));
        }
      }
    }
  };

  const handleInsertVariable = (varName: string) => {
    setFormData(prev => ({
      ...prev,
      prompt_template: prev.prompt_template + `{${varName}}`,
    }));
  };

  // ========== Import from Favorites ==========
  const loadFavoritePrompts = async () => {
    try {
      setLoadingFavorites(true);
      const data = await api.getMyFavoritePrompts();
      setFavoritePrompts(data);
    } catch (error) {
      console.error('Failed to load favorites:', error);
      toast.error(t('channel.loadFavoritesFailed'));
    } finally {
      setLoadingFavorites(false);
    }
  };

  const handleImportFromFavorite = (template: any) => {
    // Prepare variables first
    const channelVariables: Variable[] = (template.variables || []).map((v: any) => ({
      name: v.name,
      values: v.values || [],
      system_prompt: v.system_prompt || '',
      loop: true,
    }));
    const channelExtendVariables: Variable[] = (template.extend_variables || []).map((v: any) => ({
      name: v.name,
      values: v.values || [],
      system_prompt: v.system_prompt || '',
      loop: true,
    }));

    // Close dialog first, then force sync state updates
    setImportDialogOpen(false);
    flushSync(() => {
      setVariables(channelVariables);
      setFormData(prev => ({
        ...prev,
        prompt_mode: 'variable',
        prompt_template: template.prompt_template || '',
        ...(template.extend_prompt_template ? { extend_prompt_template: template.extend_prompt_template } : {}),
      }));
      if (channelExtendVariables.length > 0) {
        setExtendVariables(channelExtendVariables);
      }
    });
    toast.success(t('channel.imported', { name: template.name }));
  };

  // ========== Import from Prompt Library ==========
  const loadPromptLibrary = async () => {
    try {
      setLoadingLibrary(true);
      const [templatesRes, favRes, customRes] = await Promise.all([
        api.getPromptTemplates({ limit: 100 }),
        api.getMyFavoritePrompts().catch(() => []),
        api.getCustomPrompts().catch(() => []),
      ]);
      setPromptLibraryTemplates(templatesRes.data || templatesRes || []);
      setLibraryFavorites(favRes || []);
      setLibraryCustom(customRes || []);
    } catch (error) {
      console.error('Failed to load prompt library:', error);
      toast.error('ไม่สามารถโหลด Prompt Library ได้');
    } finally {
      setLoadingLibrary(false);
    }
  };

  const handleImportFromLibrary = (template: any) => {
    // Prepare variables first
    const channelVariables: Variable[] = (template.variables || []).map((v: any) => ({
      name: v.name,
      values: v.values || [],
      system_prompt: v.system_prompt || '',
      loop: true,
    }));

    // Close dialog first, then force sync state updates
    setPromptLibraryOpen(false);
    setLibrarySearch('');

    // Prepare extend variables if available
    const channelExtendVariables: Variable[] = (template.extend_variables || []).map((v: any) => ({
      name: v.name,
      values: v.values || [],
      system_prompt: v.system_prompt || '',
      loop: true,
    }));

    // If in multi-template mode and a template is active, import into that template
    if (activeTemplateId && promptTemplates.length > 0) {
      flushSync(() => {
        setPromptTemplates(prev => prev.map(tmpl =>
          tmpl.id === activeTemplateId
            ? {
                ...tmpl,
                prompt_template: template.prompt_template || '',
                variables: channelVariables,
                ...(template.extend_prompt_template ? {
                  extend_prompt_template: template.extend_prompt_template,
                  extend_variables: channelExtendVariables,
                } : {}),
              }
            : tmpl
        ));
        setFormData(prev => ({ ...prev, prompt_mode: 'variable' }));
      });
    } else {
      flushSync(() => {
        setVariables(channelVariables);
        setFormData(prev => ({
          ...prev,
          prompt_mode: 'variable',
          prompt_template: template.prompt_template || '',
          ...(template.extend_prompt_template ? { extend_prompt_template: template.extend_prompt_template } : {}),
        }));
        if (channelExtendVariables.length > 0) {
          setExtendVariables(channelExtendVariables);
        }
      });
    }
    toast.success(`นำเข้า "${template.name}" สำเร็จ`);
  };

  // ========== AI System Handlers ==========
  const handleAddExample = async () => {
    if (!newPromptText.trim()) {
      toast.error(t('channel.exampleRequired'));
      return;
    }

    if (channel) {
      setAddingPrompt(true);
      try {
        const result = await api.addChannelExample(channel.id, newPromptText);
        setExamplePrompts(prev => [...prev, result]);
        setNewPromptText('');
        toast.success(t('channel.exampleAdded'));
      } catch (error) {
        toast.error(t('channel.exampleAddFailed'));
      } finally {
        setAddingPrompt(false);
      }
    } else {
      const newExample: ChannelExamplePrompt = {
        id: Date.now(),
        channel_id: 0,
        prompt_text: newPromptText,
        display_order: examplePrompts.length,
        times_used: 0,
        created_at: new Date().toISOString(),
      };
      setExamplePrompts(prev => [...prev, newExample]);
      setNewPromptText('');
    }
  };

  const handleDeleteExample = async (exampleId: number) => {
    if (channel) {
      try {
        await api.deleteChannelExample(channel.id, exampleId);
        setExamplePrompts(prev => prev.filter(e => e.id !== exampleId));
        toast.success(t('channel.exampleDeleted'));
      } catch (error) {
        toast.error(t('channel.exampleDeleteFailed'));
      }
    } else {
      setExamplePrompts(prev => prev.filter(e => e.id !== exampleId));
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error(t('channel.nameRequired'));
      return;
    }

    // Validate PostForMe account IDs must start with spc_
    if (formData.posting_service === 'postforme') {
      const invalidAccounts = formData.postforme_accounts.filter(a => a.trim() !== '' && !a.trim().startsWith('spc_'));
      if (invalidAccounts.length > 0) {
        // ล้างค่าที่ไม่ถูกต้องออก
        setFormData(prev => ({
          ...prev,
          postforme_accounts: prev.postforme_accounts.map(a => a.trim() !== '' && !a.trim().startsWith('spc_') ? '' : a),
        }));
        setSpcError(true);
        return;
      }
    }
    setSpcError(false);

    // Validate prompt template and variables (only when updating existing channel)
    if (channel && formData.prompt_mode === 'variable') {
      if (promptTemplates.length > 0) {
        // Multi-template: validate each template
        const hasInvalid = promptTemplates.some(t => !t.prompt_template.trim());
        if (hasInvalid) {
          setPromptError(true);
          return;
        }
      } else {
        const hasPrompt = formData.prompt_template.trim().length > 0;
        const hasVariables = variables.length > 0 && variables.some(v => v.values && v.values.length > 0);
        if (!hasPrompt || !hasVariables) {
          setPromptError(true);
          return;
        }
      }
    }
    setPromptError(false);

    setLoading(true);

    try {
      const { auto_retry_hours, ...restFormData } = formData;
      const isAiMode = formData.prompt_mode === 'ai';
      // Save current aiVariables into active template before building save payload
      // Always emit an array in AI mode (even empty) so backend COALESCE overwrites stale
      // data from previous ai_model — prevents viral prompts leaking into idol mode, etc.
      var aiTemplatesForSave: any = undefined;
      if (isAiMode) {
        if (aiPromptTemplates.length > 0) {
          const updatedTemplates = aiPromptTemplates.map((t, i) => i === activeViralPromptIdx ? { ...t, variables: [...aiVariables] } : t);
          const filtered = selectedViralPrompts.length > 0 ? updatedTemplates.filter(t => selectedViralPrompts.some(sp => sp.name === t.label)) : updatedTemplates;
          aiTemplatesForSave = filtered.map(t => ({ id: t.id, label: t.label, prompt_template: t.prompt, variables: t.variables || [], scenes_per_video: t.scenes_per_video ?? 3, idol_image: t.idol_image || '', duration: t.duration ?? 10, slug: t.slug || undefined, reference_images: t.reference_images || {}, image_prompt_template: t.image_prompt_template || undefined, video_prompt_template: t.video_prompt_template || undefined }));
        } else {
          aiTemplatesForSave = [];
        }
      }
      const data = {
        ...restFormData,
        ...(channel ? {} : { auto_retry_hours }),
        prompt_mode: formData.prompt_mode,
        prompt_template: isAiMode ? undefined : formData.prompt_template,
        variables: isAiMode ? aiVariables : variables,
        prompt_templates: isAiMode ? [] : promptTemplates,
        ai_prompt_templates: isAiMode ? aiTemplatesForSave : undefined,
        selected_viral_prompts: isAiMode ? selectedViralPrompts : undefined,
        viral_scenes_per_video: isAiMode ? ((formData as any).viral_scenes_per_video ?? 3) : undefined,
        template_selection_mode: isAiMode ? undefined : templateSelectionMode,
        channel_highlight: formData.channel_highlight,
        system_prompt: systemPrompt,
        // Write side accepts `string[]` of prompt_text — BE upserts each into
        // its own ChannelExamplePrompt row. The type on SchedulerChannel is
        // the read shape (rich rows), hence the cast.
        example_prompts: (channel ? undefined : examplePrompts.map(e => e.prompt_text)) as unknown as ChannelExamplePrompt[] | undefined,
        time_slots: timeSlots,
        // Single-template extend prompt
        ...(!isAiMode && promptTemplates.length === 0 && formData.ai_model === 'kie_grok_extend' ? {
          extend_prompt: extendPromptText,
          extend_variables: extendVariables,
        } : {}),
      };

      if (channel) {
        try {
          const result = await updateChannel(channel.id, data);
          if (!result) {
            toast.error(t('channel.updateFailed'));
            return;
          }
        } catch (updateError: any) {
          toast.error(`${t('channel.updateFailed')}: ${updateError?.message || 'Unknown error'}`);
          return;
        }
        toast.success(t('channel.updateSuccess'));
      } else {
        const result = await createChannel(data);
        if (!result) {
          toast.error(t('channel.createFailed'));
          return;
        }
        toast.success(t('channel.createSuccess'));
      }

      await fetchChannels();
      onClose();
    } catch (error) {
      console.error('Save channel error:', error);
      toast.error(t('channel.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Guide steps for "Connect Account & Create Channel"
  const postformeGuideSteps = [
    { text: { th: 'ให้มาที่เมนู Social Media Accounts อยู่ฝั่งซ้ายมือตรง Projects', en: 'Go to Social Media Accounts menu on the left under Projects' }, images: ['/api/scheduler/channels/guide/img66.png'] },
    { text: { th: 'กด Connect an account ปุ่มสีฟ้า อยู่ด้านขวามือบน', en: 'Click the blue "Connect an account" button at top-right' }, images: ['/api/scheduler/channels/guide/img67.png'] },
    { text: { th: 'กดเลือกแพลตฟอร์มที่สร้างไว้', en: 'Select the platform you created' }, images: ['/api/scheduler/channels/guide/img68.png'] },
    { text: { th: 'กด Connect', en: 'Click Connect' }, images: ['/api/scheduler/channels/guide/img69.png'] },
    { text: { th: 'ระบบจะพาเราไปที่หน้าเชื่อม Account', en: 'You\'ll be taken to the account connection page' }, note: { th: 'แนะนำให้เชื่อมกับ account ที่เราต้องการจะโพสต์ลง YouTube', en: 'Recommended: connect the account you want to post to on YouTube' }, images: ['/api/scheduler/channels/guide/img70.png'] },
    { text: { th: 'หลังจากกดเชื่อมเสร็จแล้ว ให้กดที่คำว่า View Accounts', en: 'After connecting, click "View Accounts"' }, images: ['/api/scheduler/channels/guide/img71.png'] },
    { text: { th: 'ให้เรามากดที่ปุ่ม 3 จุด ด้านขวาสุดของแถว', en: 'Click the 3-dot menu at the far right of the row' }, images: ['/api/scheduler/channels/guide/img72.png'] },
    { text: { th: 'เลือก Copy connection ID และทำการเซฟเก็บไว้', en: 'Select "Copy connection ID" and save it' }, images: ['/api/scheduler/channels/guide/img73.png'] },
    { text: { th: 'เข้ามาที่เว็บ Triple School และกดเลือกไปที่ Channels', en: 'Go to Triple School and navigate to Channels' }, images: ['/api/scheduler/channels/guide/img74.png'] },
    { text: { th: 'กดปุ่ม Add Channel ที่ด้านมุมขวา', en: 'Click Add Channel at the top-right' }, images: ['/api/scheduler/channels/guide/img75.png'] },
    { text: { th: 'ระบบจะเด้งหน้าต่างขึ้นมา ให้ทำการตั้งชื่อ Channel ให้เรียบร้อย', en: 'A dialog appears — enter a channel name' }, images: ['/api/scheduler/channels/guide/img76.png'] },
    { text: { th: 'ให้ทำการกดติ๊กที่ Post for Me (postforme.dev)', en: 'Check "Post for Me (postforme.dev)"' }, images: ['/api/scheduler/channels/guide/img77.png'] },
    { text: { th: 'ให้นำ Connection ID ที่ copy ไว้จากขั้นตอนที่ 8 มาใส่', en: 'Paste the Connection ID you copied from step 8' }, note: { th: 'หลังจากใส่เสร็จ ให้กดสร้าง Channel ได้เลย', en: 'After pasting, click Create Channel' }, images: ['/api/scheduler/channels/guide/img78.png'] },
  ];

  // Late guide step shape. `note` and `images` are optional — the dialog
  // renders the note line + image gallery only when present.
  type GuideStep = {
    text: { th: string; en: string };
    images?: string[];
    note?: { th: string; en: string };
  };
  const lateGuideSteps: GuideStep[] = [
    { text: { th: 'เลือกหัวข้อ Connections (ฝั่งซ้ายมือ)', en: 'Select "Connections" from the left menu' }, images: ['/api/scheduler/channels/guide/late01.png'] },
    { text: { th: 'กดปุ่ม + Connect ที่แพลตฟอร์มตามที่ต้องการ', en: 'Click "+ Connect" on the platform you want' }, images: ['/api/scheduler/channels/guide/late02.png'] },
    { text: { th: 'หลังจากกด Connect ให้ Log in เข้าแพลตฟอร์มที่เลือก', en: 'After clicking Connect, log in to the selected platform' } },
    { text: { th: 'หลังจาก Log in เสร็จแล้ว ให้กดที่ปุ่ม Copy ของแพลตฟอร์มที่เชื่อม', en: 'After logging in, click the Copy button of the connected platform' }, images: ['/api/scheduler/channels/guide/late03.png'] },
    { text: { th: 'เข้ามาที่เว็บ Triple School และกดไปที่เมนู "ช่อง"', en: 'Go to Triple School and navigate to "Channels" menu' }, images: ['/api/scheduler/channels/guide/late07.png'] },
    { text: { th: 'กดเพิ่มช่อง', en: 'Click "Add Channel"' }, images: ['/api/scheduler/channels/guide/late08.png'] },
    { text: { th: 'ใส่ชื่อช่อง และเลือกบริการโพสต์เป็น Late (zernio.com)', en: 'Enter channel name and select Late (zernio.com) as posting service' }, images: ['/api/scheduler/channels/guide/late04.png'] },
    { text: { th: 'ใส่ Account ID ตามแพลตฟอร์มที่ Copy มาลงไปในช่อง', en: 'Paste the Account ID into the matching platform field' }, images: ['/api/scheduler/channels/guide/late05.png'] },
    { text: { th: 'หลังจากที่เสร็จทุกขั้นตอน สามารถกดสร้างช่องได้เลย', en: 'Once all steps are done, click "Create Channel"' }, images: ['/api/scheduler/channels/guide/late06.png'] },
  ];

  const guideImgUrl = (path: string) => `${api.getApiUrl()}${path}`;

  const handleGuideKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (guideLightbox) setGuideLightbox(null);
      else {
        setShowPostformeGuide(false);
        setShowLateGuide(false);
      }
    }
  }, [guideLightbox]);

  useEffect(() => {
    if (showPostformeGuide || showLateGuide) {
      window.addEventListener('keydown', handleGuideKeyDown);
      return () => {
        window.removeEventListener('keydown', handleGuideKeyDown);
      };
    }
  }, [showPostformeGuide, showLateGuide, handleGuideKeyDown]);

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => {
          // Don't close the channel form when interacting with the per-scene image
          // gallery / scope dialog — both render via portal to body, which Radix
          // treats as "outside".
          if (refImageGallery || refScopeDialog) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (refImageGallery || refScopeDialog) e.preventDefault();
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle>{channel ? t('channel.editChannel') : t('channel.addChannel')}</DialogTitle>
            {channel && autoSaving && (
              <span className="flex items-center gap-1.5 text-xs text-gray-400 animate-pulse">
                <Loader2 className="h-3 w-3 animate-spin" />
                Auto-saving...
              </span>
            )}
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Channel Name */}
          <div>
            <Label htmlFor="name">{t('channel.nameLabel')}</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder={t('channel.namePlaceholder')}
            />
          </div>

          {channel && (<>
          {/* Channel Concept */}
          <div className="space-y-2">
            <Label htmlFor="channel_concept">{t('channelForm.concept')}</Label>
            <Input
              id="channel_concept"
              value={formData.channel_concept}
              onChange={(e) => setFormData(prev => ({ ...prev, channel_concept: e.target.value }))}
              placeholder={t('channelForm.topicsPlaceholder')}
            />
            <p className="text-xs text-gray-400">{t('channelForm.conceptDesc')}</p>
          </div>

          {/* AI Model */}
          <div className="space-y-2">
            <Label>{t('channelForm.aiModel')}</Label>
            <Select
              value={formData.ai_model}
              onValueChange={(value: 'sora2_15s' | 'veo3_1' | 'grok_imagine' | 'kie_sora2' | 'kie_grok_imagine' | 'kie_grok_extend' | 'kie_viral_template' | 'kie_idol_template') => {
                const platform = (value === 'kie_sora2' || value === 'kie_grok_imagine' || value === 'kie_grok_extend' || value === 'kie_viral_template' || value === 'kie_idol_template') ? 'sora2-kie' : 'sora2-vidgo';
                const duration = value === 'kie_grok_imagine' ? (formData.duration === '20' || formData.duration === '30' ? formData.duration : '10')
                  : value === 'sora2_15s' || value === 'kie_sora2' ? '15'
                  : value === 'grok_imagine' ? '6'
                  : value === 'kie_viral_template' ? '10'
                  : value === 'kie_idol_template' ? '10'
                  : '10';
                const promptMode = (value === 'kie_viral_template' || value === 'kie_idol_template') ? 'ai' : 'variable';
                // Stash current template picker state under the OLD model key, then restore
                // the stash for the NEW model (or empty if first time) — so switching models
                // keeps each model's settings intact.
                if (value !== formData.ai_model) {
                  templateStashRef.current[formData.ai_model] = {
                    selectedViralPrompts,
                    aiPromptTemplates,
                    aiVariables,
                    activeViralPromptIdx,
                    systemPrompt,
                  };
                  const restored = templateStashRef.current[value];
                  if (restored) {
                    setSelectedViralPrompts(restored.selectedViralPrompts);
                    setAiPromptTemplates(restored.aiPromptTemplates);
                    setAiVariables(restored.aiVariables);
                    setActiveViralPromptIdx(restored.activeViralPromptIdx);
                    setSystemPrompt(restored.systemPrompt);
                  } else {
                    setSelectedViralPrompts([]);
                    setAiPromptTemplates([]);
                    setAiVariables([]);
                    setActiveViralPromptIdx(0);
                    setSystemPrompt('');
                  }
                }
                setFormData(prev => ({ ...prev, ai_model: value, platform, duration, prompt_mode: promptMode }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kie_viral_template">Viral Template</SelectItem>
                <SelectItem value="kie_idol_template">Idol Template</SelectItem>
                <SelectItem value="kie_grok_imagine">[KIE] Grok Imagine 10-30s</SelectItem>
                <SelectItem value="kie_grok_extend">[KIE] Grok 10s + Grok Extend</SelectItem>
                <SelectItem value="kie_sora2">[KIE] Sora2 15s</SelectItem>
                {showLateOption && <SelectItem value="sora2_15s">[Vidgo] Sora2 15s</SelectItem>}
                {showLateOption && <SelectItem value="veo3_1">[Vidgo] Veo 3.1 8s</SelectItem>}
                {showLateOption && <SelectItem value="grok_imagine">[Vidgo] Grok Imagine 6s</SelectItem>}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">{t('channelForm.aiModelDesc')}</p>
          </div>

          {/* Duration selector for kie_grok_imagine */}
          {formData.ai_model === 'kie_grok_imagine' && (
            <div className="space-y-2">
              <Label>Duration</Label>
              <Select
                value={formData.duration}
                onValueChange={(value: '10' | '20' | '30') => {
                  setFormData(prev => ({ ...prev, duration: value }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 วินาที</SelectItem>
                  <SelectItem value="20">20 วินาที</SelectItem>
                  <SelectItem value="30">30 วินาที</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ========== Prompt Mode Selector ========== */}
          <div className="space-y-3">
            <div>
              <Label className="text-base font-semibold">{t('channel.promptMode')}</Label>
              <p className="text-xs text-gray-400 mt-0.5">
                {formData.ai_model === 'kie_viral_template'
                  ? 'Viral Template ใช้ AI Prompt System เท่านั้น'
                  : formData.ai_model === 'kie_idol_template'
                  ? 'Idol Template ใช้ AI Prompt System เท่านั้น'
                  : t('channel.promptModeDesc')}
              </p>
            </div>
            <div className="space-y-2">
              {/* Option: AI Prompt System — only show for Viral/Idol Template model */}
              {(formData.ai_model === 'kie_viral_template' || formData.ai_model === 'kie_idol_template') && (
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, prompt_mode: 'ai' }))}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${
                  formData.prompt_mode === 'ai'
                    ? 'border-[#FFB300] bg-[#FFB300]/10'
                    : 'border-gray-700 bg-transparent hover:border-gray-600 hover:bg-gray-800/50'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  formData.prompt_mode === 'ai' ? 'border-[#FFB300]' : 'border-gray-600'
                }`}>
                  {formData.prompt_mode === 'ai' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#FFB300]" />
                  )}
                </div>
                <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${
                  formData.prompt_mode === 'ai' ? 'bg-[#FFB300]/20' : 'bg-gray-800'
                }`}>
                  <Sparkles className={`h-4 w-4 ${formData.prompt_mode === 'ai' ? 'text-[#FFB300]' : 'text-gray-500'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold text-sm ${formData.prompt_mode === 'ai' ? 'text-[#FFB300]' : 'text-gray-400'}`}>
                    {t('channelForm.aiPromptSystem')}
                  </div>
                  <div className="text-[11px] text-gray-500">{t('channel.aiGenerate')}</div>
                </div>
              </button>)}

              {/* Option: Variable System — hide for Viral/Idol Template model */}
              {formData.ai_model !== 'kie_viral_template' && formData.ai_model !== 'kie_idol_template' && (<button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, prompt_mode: 'variable' }))}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${
                  formData.prompt_mode === 'variable'
                    ? 'border-[#FFB300] bg-[#FFB300]/10'
                    : 'border-gray-700 bg-transparent hover:border-gray-600 hover:bg-gray-800/50'
                }`}
              >
                {/* Radio circle */}
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  formData.prompt_mode === 'variable'
                    ? 'border-[#FFB300]'
                    : 'border-gray-600'
                }`}>
                  {formData.prompt_mode === 'variable' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#FFB300]" />
                  )}
                </div>
                {/* Icon */}
                <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${
                  formData.prompt_mode === 'variable'
                    ? 'bg-[#FFB300]/20'
                    : 'bg-gray-800'
                }`}>
                  <Type className={`h-4 w-4 ${formData.prompt_mode === 'variable' ? 'text-[#FFB300]' : 'text-gray-500'}`} />
                </div>
                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold text-sm ${formData.prompt_mode === 'variable' ? 'text-[#FFB300]' : 'text-gray-400'}`}>
                    {t('channel.variableSystem')}
                  </div>
                  <div className="text-[11px] text-gray-500">{t('channel.variableSystemDesc')}</div>
                </div>
              </button>)}
            </div>
          </div>

          {/* ========== Viral Template Prompt Picker (shown when mode = ai) ========== */}
          {formData.prompt_mode === 'ai' && (
            <div className="border border-[#FFB300]/30 rounded-lg p-4 bg-[#FFB300]/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-[#FFB300]" />
                  <h3 className="font-semibold text-[#FFB300]">Prompt</h3>
                </div>
                <Button type="button" variant="outline" size="sm"
                  onClick={async () => {
                    try {
                      const prompts = formData.ai_model === 'kie_idol_template'
                        ? await api.getAllIdolPrompts(viralPromptSortBy)
                        : await api.getAllViralPrompts();
                      setViralCustomPromptsList(prompts);
                      setAddingPromptIndex(-1);
                      setShowViralPromptPicker(true);
                    } catch { /* ignore */ }
                  }}
                  className="border-[#FFB300]/30 text-[#FFB300] hover:bg-[#FFB300]/10 h-7 text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" /> {selectedViralPrompts.length === 0 ? 'เลือก Template' : 'เพิ่ม Template'}
                </Button>
              </div>

              {/* Prompt tabs */}
              {selectedViralPrompts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedViralPrompts.map((sp, spIdx) => (
                    <div key={sp.id} className="relative group">
                      <Button type="button" variant={activeViralPromptIdx === spIdx ? 'default' : 'outline'} size="sm"
                        onClick={() => {
                          // Save ALL current variables (including per_scene) to current template before switching
                          setAiPromptTemplates(prev => prev.map((t, i) => i === activeViralPromptIdx ? { ...t, variables: [...aiVariables] } : t));
                          setActiveViralPromptIdx(spIdx);
                          // Load new prompt's variables and systemPrompt
                          const tpl = aiPromptTemplates[spIdx];
                          if (tpl) {
                            setAiVariables(tpl.variables || []);
                            // Don't change systemPrompt here to avoid useEffect overwriting variables
                            setTimeout(() => setSystemPrompt(tpl.prompt), 0);
                          }
                        }}
                        className={`text-xs pr-6 ${activeViralPromptIdx === spIdx ? 'bg-[#FFB300] text-black' : 'border-gray-600'}`}
                      >
                        {sp.name}
                      </Button>
                      <button type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedViralPrompts(prev => prev.filter((_, i) => i !== spIdx));
                            setAiPromptTemplates(prev => prev.filter((_, i) => i !== spIdx));
                            if (activeViralPromptIdx >= selectedViralPrompts.length - 1) setActiveViralPromptIdx(Math.max(0, selectedViralPrompts.length - 2));
                          }}
                          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-red-500/30 text-red-500 hover:text-red-300"
                        >
                          <X className="h-3 w-3" />
                        </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Active prompt content */}
              {selectedViralPrompts.length > 0 && (() => {
                const sp = selectedViralPrompts[activeViralPromptIdx] || selectedViralPrompts[0];
                if (!sp) return null;
                const spIdx = selectedViralPrompts.indexOf(sp);
                const vtYtId = sp.video?.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([^&?/]+)/)?.[1];
                const vtEmbedSrc = vtYtId ? `https://www.youtube.com/embed/${vtYtId}?autoplay=0&controls=1&modestbranding=1` : null;
                const vpc = sp.config;
                const tplVars: any[] = vpc?.template_variables || [];
                const enabledVars = tplVars.filter((tv: any) => typeof tv === 'string' || tv.enabled !== false);
                const hasVars = enabledVars.length > 0;
                const perSceneVars = vpc?.field_config?.per_scene_vars || vpc?.per_scene_vars || false;
                // scenes_per_video เก็บแยกต่อ template (ไม่ share ระหว่าง template)
                const activeTmplForScenes = aiPromptTemplates[spIdx];
                const scenesPerVideo = activeTmplForScenes?.scenes_per_video ?? 3;
                const placeholder = vpc?.input_placeholder || 'เช่น ขวดโลออน, ส้มตำ, หมูปิ้ง...';
                const inputLabel = vpc?.input_label || '';
                const showInput = vpc?.field_config?.show_input !== false;
                return (
                  <div className="border border-zinc-700 rounded-lg p-3 bg-zinc-900/30 space-y-3">
                    <Input
                      value={sp.name}
                      onChange={(e) => {
                        setSelectedViralPrompts(prev => prev.map((p, i) => i === spIdx ? { ...p, name: e.target.value } : p));
                        setAiPromptTemplates(prev => prev.map((t, i) => i === spIdx ? { ...t, label: e.target.value } : t));
                      }}
                      className="bg-gray-900/50 border-gray-700 text-sm h-8"
                      placeholder="ชื่อ Prompt"
                    />

                    {vtEmbedSrc && (
                      <div className="aspect-video rounded-lg overflow-hidden bg-black">
                        <iframe src={vtEmbedSrc} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                      </div>
                    )}

                    <div>
                      {formData.ai_model === 'kie_idol_template' ? (
                        <>
                          <label className="text-xs text-zinc-500 mb-1 block">Duration (วินาที)</label>
                          <Select
                            value={String(aiPromptTemplates[spIdx]?.duration ?? 10)}
                            onValueChange={(v) => {
                              const n = parseInt(v);
                              setAiPromptTemplates(prev => prev.map((t, i) => i === spIdx ? { ...t, duration: n } : t));
                            }}
                          >
                            <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {[6, 10, 15, 20, 25, 30].map(n => (
                                <SelectItem key={n} value={n.toString()}>{n} วินาที</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      ) : (
                        <>
                          <label className="text-xs text-zinc-500 mb-1 block">จำนวนฉากต่อ VDO</label>
                          <Select
                            value={scenesPerVideo.toString()}
                            onValueChange={(v) => {
                              const n = parseInt(v);
                              setAiPromptTemplates(prev => prev.map((t, i) => i === spIdx ? { ...t, scenes_per_video: n } : t));
                            }}
                          >
                            <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {[1, 2, 3, 4, 5].map(n => (
                                <SelectItem key={n} value={n.toString()}>{n} ฉาก</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      )}
                    </div>

                    {/* Idol Template: รูป Idol (1 รูปต่อ template) */}
                    {formData.ai_model === 'kie_idol_template' && (
                      <IdolImageField
                        value={aiPromptTemplates[spIdx]?.idol_image || ''}
                        onChange={(url) => {
                          setAiPromptTemplates(prev => prev.map((t, i) => i === spIdx ? { ...t, idol_image: url } : t));
                        }}
                      />
                    )}

                    {/* ตัวแปร — จัดการค่าผ่าน modal ตาม template_variables */}
                    <div className="space-y-2 pt-2 border-t border-gray-700">
                      <Label className="text-[#FFB300]">
                        {formData.ai_model === 'kie_idol_template'
                          ? `ชุดและฉากหลัง (${(aiVariables.find(v => v.name === 'outfit')?.values?.length || 0) + (aiVariables.find(v => v.name === 'background')?.values?.length || 0)} รายการ)`
                          : `${t('channel.variablesLabel')} (${enabledVars.length} ${t('channel.items')})`}
                      </Label>

                      {formData.ai_model === 'kie_idol_template' ? (
                        /* Idol Template: 2 ปุ่ม fixed — ชุด, Background (กดเปิด VariableEditorModal) */
                        <>
                          {[
                            { key: 'outfit', label: 'ชุด', ph: 'กดเพื่อใส่ชุด' },
                            { key: 'background', label: 'ฉากหลัง', ph: 'กดเพื่อใส่ฉากหลัง' },
                          ].map(({ key, label, ph }) => {
                            const matchedVar = aiVariables.find(v => v.name === key);
                            const newCount = matchedVar?.values?.filter(val => val.status === 'new').length || 0;
                            const usedCount = matchedVar?.values?.filter(val => val.status === 'used').length || 0;
                            const totalCount = newCount + usedCount;
                            return (
                              <div key={key} className="space-y-1">
                                <label className="text-xs text-zinc-400">{label}</label>
                                <div
                                  className="flex items-center justify-between p-2 bg-zinc-800 border border-zinc-700 rounded-md cursor-pointer hover:border-[#FFB300]/50 transition-colors"
                                  onClick={() => {
                                    if (matchedVar) {
                                      setEditingVariable(matchedVar);
                                    } else {
                                      const newVar: Variable = { name: key, values: [], loop: true };
                                      setAiVariables(prev => [...prev, newVar]);
                                      setEditingVariable(newVar);
                                    }
                                    setEditingVariableContext('ai' as any);
                                    setVariableEditorOpen(true);
                                  }}
                                >
                                  <span className="text-sm text-zinc-500">{totalCount > 0 ? `${totalCount} ค่า` : ph}</span>
                                  <div className="flex items-center gap-2">
                                    {totalCount > 0 && (
                                      <>
                                        <Badge variant="outline" className="bg-[#FFB300]/10 text-[#FFB300] border-[#FFB300]/30 text-xs">{newCount} new</Badge>
                                        <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30 text-xs">{usedCount} used</Badge>
                                      </>
                                    )}
                                    <Settings2 className="h-3.5 w-3.5 text-zinc-500" />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      ) : perSceneVars ? (
                        /* per_scene_vars: แยกจัดการค่าตามฉาก */
                        Array.from({ length: scenesPerVideo }).map((_, sceneIdx) => {
                          const refCfg = vpc?.reference_image_config;
                          const hasRefCfg = !!(refCfg && (refCfg.character || refCfg.outfit || refCfg.background));
                          const refImages: Record<string, string> = aiPromptTemplates[spIdx]?.reference_images || {};
                          const setRefImage = (key: string, url: string | null) => {
                            setAiPromptTemplates(prev => prev.map((t, i) => {
                              if (i !== spIdx) return t;
                              const next = { ...(t.reference_images || {}) };
                              if (url === null) delete next[key]; else next[key] = url;
                              return { ...t, reference_images: next };
                            }));
                          };
                          return (
                          <div key={sceneIdx} className="space-y-1.5">
                            <label className="text-[10px] text-blue-400 font-semibold block border-t border-zinc-700 pt-1.5">
                              ฉากที่ {sceneIdx + 1}
                            </label>
                            {/* Reference images per scene — same UI as ViralTaskCard */}
                            {hasRefCfg && (
                              <div className="grid grid-cols-3 gap-1.5">
                                {refCfg?.character && (() => {
                                  const k = `character_image_${sceneIdx}`;
                                  const filled = !!refImages[k];
                                  return (
                                    <div>
                                      <label className="text-[9px] text-zinc-500 block mb-0.5">ตัวละคร</label>
                                      <div
                                        onClick={() => setRefImageGallery({ spIdx, sceneIdx, mode: 'idol' })}
                                        className={`relative rounded-lg overflow-hidden cursor-pointer transition-colors aspect-square ${
                                          filled
                                            ? 'border-2 border-green-700/70 bg-black hover:border-green-500'
                                            : 'border-2 border-dashed border-zinc-700 bg-zinc-800/50 hover:border-zinc-500 flex flex-col items-center justify-center'
                                        }`}
                                      >
                                        {filled ? (
                                          <>
                                            <img src={refImages[k]} alt="Char" className="absolute inset-0 w-full h-full object-cover" />
                                            <button type="button" onClick={(e) => { e.stopPropagation(); setRefImage(k, null); }}
                                              className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5 hover:bg-red-900/90 z-10"><X className="h-3 w-3 text-white" /></button>
                                          </>
                                        ) : (
                                          <><ImageIcon className="h-5 w-5 text-zinc-600" /><span className="text-[10px] text-zinc-500 mt-0.5">เลือก</span></>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                                {refCfg?.outfit && (() => {
                                  const k = `outfit_image_${sceneIdx}`;
                                  const filled = !!refImages[k];
                                  return (
                                    <div>
                                      <label className="text-[9px] text-zinc-500 block mb-0.5">ชุด</label>
                                      <div
                                        onClick={() => setRefImageGallery({ spIdx, sceneIdx, mode: 'outfit' })}
                                        className={`relative rounded-lg overflow-hidden cursor-pointer transition-colors aspect-square ${
                                          filled
                                            ? 'border-2 border-green-700/70 bg-black hover:border-green-500'
                                            : 'border-2 border-dashed border-zinc-700 bg-zinc-800/50 hover:border-zinc-500 flex flex-col items-center justify-center'
                                        }`}
                                      >
                                        {filled ? (
                                          <>
                                            <img src={refImages[k]} alt="Outfit" className="absolute inset-0 w-full h-full object-cover" />
                                            <button type="button" onClick={(e) => { e.stopPropagation(); setRefImage(k, null); }}
                                              className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5 hover:bg-red-900/90 z-10"><X className="h-3 w-3 text-white" /></button>
                                          </>
                                        ) : (
                                          <><ImageIcon className="h-5 w-5 text-zinc-600" /><span className="text-[10px] text-zinc-500 mt-0.5">เลือก</span></>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                                {refCfg?.background && (() => {
                                  const k = `background_image_${sceneIdx}`;
                                  const filled = !!refImages[k];
                                  return (
                                    <div>
                                      <label className="text-[9px] text-zinc-500 block mb-0.5">BG</label>
                                      <div
                                        onClick={() => setRefImageGallery({ spIdx, sceneIdx, mode: 'background' })}
                                        className={`relative rounded-lg overflow-hidden cursor-pointer transition-colors aspect-square ${
                                          filled
                                            ? 'border-2 border-green-700/70 bg-black hover:border-green-500'
                                            : 'border-2 border-dashed border-zinc-700 bg-zinc-800/50 hover:border-zinc-500 flex flex-col items-center justify-center'
                                        }`}
                                      >
                                        {filled ? (
                                          <>
                                            <img src={refImages[k]} alt="BG" className="absolute inset-0 w-full h-full object-cover" />
                                            <button type="button" onClick={(e) => { e.stopPropagation(); setRefImage(k, null); }}
                                              className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5 hover:bg-red-900/90 z-10"><X className="h-3 w-3 text-white" /></button>
                                          </>
                                        ) : (
                                          <><ImageIcon className="h-5 w-5 text-zinc-600" /><span className="text-[10px] text-zinc-500 mt-0.5">เลือก</span></>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                            {enabledVars.map((tv: any) => {
                              const varKey = typeof tv === 'string' ? tv : tv.key || tv.name || tv.label || '';
                              const varLabel = typeof tv === 'string' ? tv : tv.label || tv.name || '';
                              const varPlaceholder = typeof tv === 'string' ? '' : tv.placeholder || tv.description || varLabel;
                              const sceneVarName = `${varKey}_scene${sceneIdx + 1}`;
                              const matchedVar = aiVariables.find(v => v.name === sceneVarName);
                              const newCount = matchedVar?.values?.filter(val => val.status === 'new').length || 0;
                              const usedCount = matchedVar?.values?.filter(val => val.status === 'used').length || 0;
                              const totalCount = newCount + usedCount;
                              return (
                                <div key={varKey}>
                                  <label className="text-xs text-zinc-400">{varLabel}</label>
                                  <div
                                    className="flex items-center justify-between p-2 bg-zinc-800 border border-zinc-700 rounded-md cursor-pointer hover:border-[#FFB300]/50 transition-colors"
                                    onClick={() => {
                                      if (matchedVar) {
                                        setEditingVariable(matchedVar);
                                      } else {
                                        const newVar: Variable = { name: sceneVarName, values: [], loop: false };
                                        setAiVariables(prev => [...prev, newVar]);
                                        setEditingVariable(newVar);
                                      }
                                      setEditingVariableContext('ai' as any);
                                      setVariableEditorOpen(true);
                                    }}
                                  >
                                    <span className="text-sm text-zinc-500">{totalCount > 0 ? `${totalCount} ค่า` : varPlaceholder || 'คลิกเพื่อจัดการค่า'}</span>
                                    <div className="flex items-center gap-2">
                                      {totalCount > 0 && (
                                        <>
                                          <Badge variant="outline" className="bg-[#FFB300]/10 text-[#FFB300] border-[#FFB300]/30 text-xs">{newCount} new</Badge>
                                          <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30 text-xs">{usedCount} used</Badge>
                                        </>
                                      )}
                                      <Settings2 className="h-3.5 w-3.5 text-zinc-500" />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          );
                        })
                      ) : (
                        /* Flat variables: จัดการค่ารวม */
                        enabledVars.map((tv: any) => {
                          const varKey = typeof tv === 'string' ? tv : tv.key || tv.name || tv.label || '';
                          const varLabel = typeof tv === 'string' ? tv : tv.label || tv.name || '';
                          const varPlaceholder = typeof tv === 'string' ? '' : tv.placeholder || tv.description || varLabel;
                          const matchedVar = aiVariables.find(v => v.name === varKey || v.name === varLabel);
                          const newCount = matchedVar?.values?.filter(val => val.status === 'new').length || 0;
                          const usedCount = matchedVar?.values?.filter(val => val.status === 'used').length || 0;
                          const totalCount = newCount + usedCount;
                          return (
                            <div key={varKey} className="space-y-1">
                              <label className="text-xs text-zinc-400">{varLabel}</label>
                              <div
                                className="flex items-center justify-between p-2 bg-zinc-800 border border-zinc-700 rounded-md cursor-pointer hover:border-[#FFB300]/50 transition-colors"
                                onClick={() => {
                                  if (matchedVar) {
                                    setEditingVariable(matchedVar);
                                  } else {
                                    const newVar: Variable = { name: varKey, values: [], loop: false };
                                    setAiVariables(prev => [...prev, newVar]);
                                    setEditingVariable(newVar);
                                  }
                                  setEditingVariableContext('ai' as any);
                                  setVariableEditorOpen(true);
                                }}
                              >
                                <span className="text-sm text-zinc-500">{totalCount > 0 ? `${totalCount} ค่า` : varPlaceholder || 'คลิกเพื่อจัดการค่า'}</span>
                                <div className="flex items-center gap-2">
                                  {totalCount > 0 && (
                                    <>
                                      <Badge variant="outline" className="bg-[#FFB300]/10 text-[#FFB300] border-[#FFB300]/30 text-xs">{newCount} new</Badge>
                                      <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30 text-xs">{usedCount} used</Badge>
                                    </>
                                  )}
                                  <Settings2 className="h-3.5 w-3.5 text-zinc-500" />
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}

                      {enabledVars.length === 0 && formData.ai_model !== 'kie_idol_template' && (
                        <p className="text-xs text-gray-600">ยังไม่มีตัวแปร</p>
                      )}
                    </div>


                    <Button type="button" variant="ghost" size="sm"
                      onClick={async () => {
                        try {
                          const prompts = formData.ai_model === 'kie_idol_template'
                            ? await api.getAllIdolPrompts(viralPromptSortBy)
                            : await api.getAllViralPrompts();
                          setViralCustomPromptsList(prompts);
                          setAddingPromptIndex(spIdx);
                          setShowViralPromptPicker(true);
                        } catch { /* ignore */ }
                      }}
                      className="text-zinc-400 hover:text-[#FFB300] text-xs"
                    >
                      <BookOpen className="h-3 w-3 mr-1" /> เปลี่ยน Prompt
                    </Button>
                  </div>
                );
              })()}


              {/* Viral Template Prompt Dialog */}
              <Dialog open={showViralPromptPicker} onOpenChange={setShowViralPromptPicker}>
                <DialogContent className="bg-zinc-900 border-zinc-700 max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
                  <DialogHeader>
                    <DialogTitle>
                      {formData.ai_model === 'kie_idol_template'
                        ? 'เลือก Prompt จาก Idol Template'
                        : 'เลือก Prompt จาก Viral Template'}
                    </DialogTitle>
                  </DialogHeader>
                  {formData.ai_model === 'kie_idol_template' ? (
                    <div className="inline-flex h-10 items-center rounded-[25px] bg-muted p-1 text-muted-foreground mt-2">
                      <div className="relative inline-flex items-center">
                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById('modal-sort-dropdown');
                            if (el) el.classList.toggle('hidden');
                          }}
                          className="inline-flex items-center justify-center gap-1 min-w-[90px] pl-3 pr-2 py-1.5 rounded-[20px] text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-all"
                        >
                          {viralPromptSortBy === 'latest' ? 'ล่าสุด' : 'ยอดนิยม'}
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        <div
                          id="modal-sort-dropdown"
                          className="hidden absolute top-full left-0 mt-1 min-w-[120px] rounded-[16px] bg-[#18181b] shadow-lg z-50 overflow-hidden"
                          onMouseLeave={(e) => e.currentTarget.classList.add('hidden')}
                        >
                          <button type="button"
                            onClick={async () => { setViralPromptSortBy('latest'); document.getElementById('modal-sort-dropdown')?.classList.add('hidden'); try { setViralCustomPromptsList(await api.getAllIdolPrompts('latest')); } catch {} }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${viralPromptSortBy === 'latest' ? 'text-[#FFB300] bg-zinc-800' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                          >
                            ล่าสุด
                          </button>
                          <button type="button"
                            onClick={async () => { setViralPromptSortBy('popular'); document.getElementById('modal-sort-dropdown')?.classList.add('hidden'); try { setViralCustomPromptsList(await api.getAllIdolPrompts('popular')); } catch {} }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${viralPromptSortBy === 'popular' ? 'text-[#FFB300] bg-zinc-800' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                          >
                            ยอดนิยม
                          </button>
                        </div>
                      </div>
                      <button type="button" onClick={() => setViralPromptFilter('all')} className={`inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all ${viralPromptFilter === 'all' ? 'bg-background text-[#FFB300] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                        ทั้งหมด
                      </button>
                      <div className="relative inline-flex items-center">
                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById('modal-gender-dropdown');
                            if (el) el.classList.toggle('hidden');
                          }}
                          className={`inline-flex items-center justify-center gap-1 min-w-[70px] rounded-[20px] px-3 py-1.5 text-sm font-medium cursor-pointer transition-all ${viralPromptFilter === 'male' || viralPromptFilter === 'female' ? 'bg-background text-[#FFB300] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                          {viralPromptFilter === 'male' ? 'ชาย' : viralPromptFilter === 'female' ? 'หญิง' : 'เพศ'}
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        <div
                          id="modal-gender-dropdown"
                          className="hidden absolute top-full left-0 mt-1 min-w-[100px] rounded-[16px] bg-[#18181b] shadow-lg z-50 overflow-hidden"
                          onMouseLeave={(e) => e.currentTarget.classList.add('hidden')}
                        >
                          <button type="button"
                            onClick={() => { setViralPromptFilter('all'); document.getElementById('modal-gender-dropdown')?.classList.add('hidden'); }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${viralPromptFilter === 'all' ? 'text-[#FFB300] bg-zinc-800' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                          >
                            ไม่ระบุ
                          </button>
                          <button type="button"
                            onClick={() => { setViralPromptFilter('male'); document.getElementById('modal-gender-dropdown')?.classList.add('hidden'); }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${viralPromptFilter === 'male' ? 'text-[#FFB300] bg-zinc-800' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                          >
                            ชาย
                          </button>
                          <button type="button"
                            onClick={() => { setViralPromptFilter('female'); document.getElementById('modal-gender-dropdown')?.classList.add('hidden'); }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${viralPromptFilter === 'female' ? 'text-[#FFB300] bg-zinc-800' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                          >
                            หญิง
                          </button>
                        </div>
                      </div>
                      <button type="button" onClick={() => setViralPromptFilter('custom')} className={`inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all ${viralPromptFilter === 'custom' ? 'bg-background text-[#FFB300] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                        กำหนดเอง
                      </button>
                    </div>
                  ) : (
                    <div className="inline-flex h-10 items-center rounded-[25px] bg-muted p-1 text-muted-foreground mt-2">
                      {(['all', 'template', 'custom'] as const).map(f => (
                        <button key={f} type="button" onClick={() => setViralPromptFilter(f)}
                          className={`inline-flex items-center justify-center whitespace-nowrap rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all ${viralPromptFilter === f ? 'bg-background text-[#FFB300] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                          {f === 'all' ? 'ทั้งหมด' : f === 'template' ? 'Template' : 'กำหนดเอง'}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="overflow-y-auto flex-1 mt-3">
                    {(() => {
                      const filtered = viralCustomPromptsList.filter((vp: any) => {
                        if (viralPromptFilter === 'all') return true;
                        if (viralPromptFilter === 'male' || viralPromptFilter === 'female') return vp.gender === viralPromptFilter;
                        return vp.source === viralPromptFilter;
                      });
                      return filtered.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                          {filtered.map((vp: any, i: number) => {
                            const videoUrl = vp.preview_video_url || vp.youtube_url || '';
                            return (
                              <button key={`${vp.source}-${vp.id || vp.slug}-${i}`} type="button"
                                onClick={() => {
                                  const newPrompt = { id: String(Date.now()), name: vp.name, video: vp.preview_video_url || vp.youtube_url || '', config: vp, prompt_text: vp.prompt_text, tasks: [{ id: '1', values: {} as Record<string, string[]> }] };
                                  if (addingPromptIndex >= 0) {
                                    setSelectedViralPrompts(prev => prev.map((p, i) => i === addingPromptIndex ? newPrompt : p));
                                  } else {
                                    setSelectedViralPrompts(prev => [...prev, newPrompt]);
                                  }
                                  // Convert template_variables → Variable[] for this prompt
                                  const tvars: any[] = vp.template_variables || [];
                                  const convertedVars: Variable[] = tvars
                                    .filter((tv: any) => typeof tv === 'string' || tv.enabled !== false)
                                    .map((tv: any) => {
                                      const name = typeof tv === 'string' ? tv : tv.name || tv.label || '';
                                      const existing = aiVariables.find(v => v.name === name);
                                      return existing || { name, values: [], loop: true };
                                    }).filter(v => v.name);
                                  setAiPromptTemplates(prev => {
                                    if (addingPromptIndex >= 0 && prev[addingPromptIndex]) {
                                      return prev.map((t, i) => i === addingPromptIndex ? {
                                        ...t,
                                        prompt: vp.prompt_text,
                                        label: vp.name,
                                        variables: convertedVars,
                                        slug: vp.slug,
                                        image_prompt_template: vp.image_prompt_template || undefined,
                                        video_prompt_template: vp.video_prompt_template || undefined,
                                      } : t);
                                    }
                                    return [...prev, {
                                      id: String(Date.now()),
                                      label: vp.name,
                                      prompt: vp.prompt_text,
                                      variables: convertedVars,
                                      slug: vp.slug,
                                      image_prompt_template: vp.image_prompt_template || undefined,
                                      video_prompt_template: vp.video_prompt_template || undefined,
                                    }];
                                  });
                                  setAiVariables(convertedVars);
                                  setSystemPrompt(vp.prompt_text);
                                  setSelectedViralPromptName(vp.name);
                                  setSelectedViralPromptVideo(vp.preview_video_url || vp.youtube_url || '');
                                  setSelectedViralPromptConfig(vp);
                                  if (vp.fixed_scenes) setFormData(prev => ({ ...prev, viral_scenes_per_video: vp.fixed_scenes }));
                                  setShowViralScenesSelector(true);
                                  if (addingPromptIndex < 0) {
                                    setActiveViralPromptIdx(selectedViralPrompts.length);
                                  }
                                  setAddingPromptIndex(-1);
                                  setShowViralPromptPicker(false);
                                }}
                                className={`rounded-lg border overflow-hidden hover:border-[#FFB300]/50 transition-all text-left ${vp.prompt_text === systemPrompt ? 'border-[#FFB300] ring-1 ring-[#FFB300]/50' : 'border-zinc-800 bg-zinc-900'}`}
                              >
                                <div className="aspect-[9/16] bg-zinc-800 relative flex items-center justify-center">
                                  {videoUrl ? (
                                    <LazyYouTubeIframe url={videoUrl} thumbnailUrl={vp.thumbnail_url && vp.thumbnail_url.startsWith('http') ? vp.thumbnail_url : null} />
                                  ) : (vp.thumbnail_url && vp.thumbnail_url.startsWith('http')) ? (
                                    <img src={vp.thumbnail_url} alt={vp.name} className="w-full h-full object-cover" loading="lazy" />
                                  ) : (
                                    <Sparkles className="h-8 w-8 text-zinc-600" />
                                  )}
                                  {vp.prompt_text === systemPrompt && (
                                    <div className="absolute top-1 right-1 bg-[#FFB300] text-black rounded-full p-0.5">
                                      <Check className="h-3 w-3" />
                                    </div>
                                  )}
                                </div>
                                <div className="p-2">
                                  <p className="text-xs font-medium text-zinc-200 truncate">{vp.name}</p>
                                  <span className={`inline-block mt-1 text-[9px] px-1 py-0.5 rounded ${vp.source === 'template' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-[#FFB300]/10 text-[#FFB300]'}`}>
                                    {vp.source === 'template' ? 'Template' : 'กำหนดเอง'}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
                          <Sparkles className="h-8 w-8 mb-3 text-zinc-700" />
                          <p className="text-sm">ยังไม่มี Prompt</p>
                        </div>
                      );
                    })()}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* ========== Variable System (shown when mode = variable) ========== */}
          {formData.prompt_mode === 'variable' && (
            <div className="border border-[#FFB300]/30 rounded-lg p-4 bg-[#FFB300]/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Type className="h-5 w-5 text-[#FFB300]" />
                  <h3 className="font-semibold text-[#FFB300]">{t('channel.variableSystem')}</h3>
                </div>
                <div className="flex gap-2">
                  {/* Reset Button */}
                  {(formData.prompt_template || variables.length > 0 || promptTemplates.length > 0) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFormData(prev => ({ ...prev, prompt_template: '' }));
                        setVariables([]);
                        setPromptTemplates([]);
                        setActiveTemplateId(null);
                        toast.success(t('channel.resetDone'));
                      }}
                      className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <X className="h-3 w-3 mr-1" />
                      {t('varEditor.reset')}
                    </Button>
                  )}
                  {/* Import from Favorites */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      loadFavoritePrompts();
                      setImportDialogOpen(true);
                    }}
                    className="text-xs border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                  >
                    <Star className="h-3 w-3 mr-1" />
                    {t('channel.importFavorites')}
                  </Button>
                  {/* Prompt Library - available to all subscribers */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      loadPromptLibrary();
                      setPromptLibraryOpen(true);
                    }}
                    className="text-xs border-[#FFB300]/30 text-[#FFB300] hover:bg-[#FFB300]/10"
                  >
                    <BookOpen className="h-3 w-3 mr-1" />
                    Prompts Template
                  </Button>
                </div>
              </div>

              {/* Multi-template tabs - yearly or users who already have templates */}
              {(isYearly || promptTemplates.length > 0) && promptTemplates.length > 0 && (
                <div className="space-y-3">
                  {/* Selection mode */}
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-gray-400">{t('channel.templateMode')}:</Label>
                    <select
                      value={templateSelectionMode}
                      onChange={(e) => setTemplateSelectionMode(e.target.value as 'round-robin' | 'random')}
                      className="text-xs bg-gray-900/50 border border-gray-700 rounded px-2 py-1 text-gray-300"
                    >
                      <option value="round-robin">{t('channel.roundRobin')}</option>
                      <option value="random">{t('channel.random')}</option>
                    </select>
                  </div>

                  {/* Template tabs */}
                  <div className="flex flex-wrap gap-1">
                    {promptTemplates.map((tmpl, idx) => (
                      <div key={tmpl.id} className="relative group">
                        <Button
                          type="button"
                          variant={activeTemplateId === tmpl.id ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setActiveTemplateId(tmpl.id)}
                          className={`text-xs pr-6 ${activeTemplateId === tmpl.id ? 'bg-[#FFB300]' : 'border-gray-600'}`}
                        >
                          {tmpl.label || `Template ${idx + 1}`}
                        </Button>
                        {promptTemplates.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPromptTemplates(prev => prev.filter(p => p.id !== tmpl.id));
                              if (activeTemplateId === tmpl.id) {
                                const remaining = promptTemplates.filter(p => p.id !== tmpl.id);
                                setActiveTemplateId(remaining[0]?.id || null);
                              }
                            }}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-red-500/30 text-red-500 hover:text-red-300"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const newId = uuidv4();
                        const newTemplate: PromptTemplate = {
                          id: newId,
                          label: `Template ${promptTemplates.length + 1}`,
                          prompt_template: '',
                          variables: [],
                        };
                        setPromptTemplates(prev => [...prev, newTemplate]);
                        setActiveTemplateId(newId);
                      }}
                      className="text-xs border-dashed border-[#FFB300]/30 text-[#FFB300]"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {t('channel.addTemplate')}
                    </Button>
                  </div>

                  {/* Active template editor */}
                  {(() => {
                    const activeIdx = promptTemplates.findIndex(tmpl => tmpl.id === activeTemplateId);
                    if (activeIdx < 0) return null;
                    const activeTmpl = promptTemplates[activeIdx];
                    const activeVars = activeTmpl.variables || [];

                    const updateTemplate = (updates: Partial<PromptTemplate>) => {
                      setPromptTemplates(prev => prev.map(tmpl => tmpl.id === activeTemplateId ? { ...tmpl, ...updates } : tmpl));
                    };

                    return (
                      <div className="space-y-3 border border-gray-700 rounded-lg p-3 bg-gray-900/30">
                        {/* Template label */}
                        <div className="flex items-center gap-2">
                          <Input
                            value={activeTmpl.label}
                            onChange={(e) => updateTemplate({ label: e.target.value })}
                            className="flex-1 bg-gray-900/50 border-gray-700 text-sm h-8"
                            placeholder="Template name"
                          />
                        </div>

                        {/* Prompt Template */}
                        <Textarea
                          value={activeTmpl.prompt_template}
                          onChange={(e) => {
                            const newPrompt = e.target.value;
                            const curlyMatches = newPrompt.match(/\{([^}]+)\}/g) || [];
                            const squareMatches = newPrompt.match(/\[([^\]]+)\]/g) || [];
                            const allMatches = [...curlyMatches, ...squareMatches];
                            const varNames = [...new Set(allMatches.map(m => m.replace(/[\{\}\[\]]/g, '')))];
                            const existingVars = (activeTmpl.variables || []).filter(v => varNames.includes(v.name));
                            const existingNames = new Set(existingVars.map(v => v.name));
                            const newVarNames = varNames.filter(name => !existingNames.has(name));
                            const newVars = newVarNames.map(name => ({ name, system_prompt: '', values: [] as any[], loop: true }));
                            const updatedVars = [...existingVars, ...newVars];
                            updateTemplate({ prompt_template: newPrompt, variables: updatedVars });
                          }}
                          placeholder={`เช่น: A cinematic scene of {character} walking through {location}...`}
                          rows={4}
                          className="bg-gray-900/50 border-gray-700 font-mono text-sm"
                        />

                        {/* Quick insert variable buttons */}
                        {activeVars.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            <span className="text-xs text-gray-500 mr-1 self-center">{t('channel.insertVar')}</span>
                            {activeVars.map(v => (
                              <Button
                                key={v.name}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  updateTemplate({ prompt_template: activeTmpl.prompt_template + `{${v.name}}` });
                                }}
                                className="h-6 text-xs px-2 border-[#FFB300]/30 text-[#FFB300] hover:bg-[#FFB300]/10"
                              >
                                {`{${v.name}}`}
                              </Button>
                            ))}
                          </div>
                        )}

                        {/* Variables for this template */}
                        <div className="space-y-2 pt-2 border-t border-gray-700">
                          <Label className="text-[#FFB300] text-xs">{t('channel.variablesLabel')} ({activeVars.length})</Label>
                          {activeVars.map(variable => {
                            const newCount = variable.values.filter(v => v.status === 'new').length;
                            const usedCount = variable.values.filter(v => v.status === 'used').length;
                            return (
                              <div key={variable.name} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-md">
                                <div className="flex items-center gap-2">
                                  <code className="text-sm text-[#FFB300]">{`{${variable.name}}`}</code>
                                  <Badge variant="outline" className="bg-[#FFB300]/10 text-[#FFB300] border-[#FFB300]/30 text-xs">{newCount} new</Badge>
                                  <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30 text-xs">{usedCount} used</Badge>
                                </div>
                                <div className="flex gap-1">
                                  <Button type="button" variant="ghost" size="sm"
                                    onClick={() => {
                                      setEditingVariable(variable);
                                      setEditingVariableContext('main');
                                      setVariableEditorOpen(true);
                                    }}
                                    className="h-7 px-2 text-xs text-gray-400 hover:text-[#FFB300]"
                                  >
                                    <Settings2 className="h-3 w-3 mr-1" />
                                    {t('channel.manageValues')}
                                  </Button>
                                  <Button type="button" variant="ghost" size="sm"
                                    onClick={() => {
                                      updateTemplate({ variables: activeVars.filter(v => v.name !== variable.name) });
                                    }}
                                    className="h-7 w-7 p-0 text-gray-500 hover:text-red-400"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                          {/* Add variable to this template */}
                          <div className="flex gap-2">
                            <Input
                              value={newVarName}
                              onChange={(e) => setNewVarName(e.target.value.replace(/[^a-zA-Z0-9_ก-๛]/g, ''))}
                              placeholder={t('channel.varPlaceholder')}
                              className="flex-1 bg-gray-900/50 border-gray-700 text-sm"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (newVarName.trim()) {
                                    updateTemplate({
                                      variables: [...activeVars, { name: newVarName.trim(), values: [], system_prompt: '', loop: true }],
                                    });
                                    setNewVarName('');
                                  }
                                }
                              }}
                            />
                            <Button type="button" size="sm" className="bg-[#FFB300] hover:bg-[#FFC233]"
                              disabled={!newVarName.trim()}
                              onClick={() => {
                                if (newVarName.trim()) {
                                  updateTemplate({
                                    variables: [...activeVars, { name: newVarName.trim(), values: [], system_prompt: '', loop: true }],
                                  });
                                  setNewVarName('');
                                }
                              }}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        {/* ========== Extend Prompt (paired with this template) ========== */}
                        {formData.ai_model === 'kie_grok_extend' && (
                          <div className="space-y-3 pt-3 border-t border-[#FFB300]/30">
                            <Label className="text-sm font-semibold text-[#FFB300]">Extend Prompt</Label>
                            <p className="text-xs text-gray-400 -mt-2">Prompt สำหรับต่อวิดีโอเพิ่ม 10 วินาที (รวม ~20s)</p>

                            {/* Extend Prompt Textarea */}
                            <Textarea
                              value={activeTmpl.extend_prompt_template || ''}
                              onChange={(e) => {
                                const newPrompt = e.target.value;
                                const curlyMatches = newPrompt.match(/\{([^}]+)\}/g) || [];
                                const squareMatches = newPrompt.match(/\[([^\]]+)\]/g) || [];
                                const allMatches = [...curlyMatches, ...squareMatches];
                                const varNames = [...new Set(allMatches.map(m => m.replace(/[\{\}\[\]]/g, '')))];
                                const existingVars = (activeTmpl.extend_variables || []).filter(v => varNames.includes(v.name));
                                const existingNames = new Set(existingVars.map(v => v.name));
                                const newVarNames = varNames.filter(name => !existingNames.has(name));
                                const newVars = newVarNames.map(name => ({ name, system_prompt: '', values: [] as any[], loop: true }));
                                updateTemplate({ extend_prompt_template: newPrompt, extend_variables: [...existingVars, ...newVars] });
                              }}
                              placeholder="เช่น: Continue the scene smoothly, {character} walks further into {location}..."
                              rows={3}
                              className="bg-gray-900/50 border-[#FFB300]/20 font-mono text-sm"
                            />

                            {/* Quick insert variable buttons for extend */}
                            {(() => {
                              const extVars = activeTmpl.extend_variables || [];
                              return extVars.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  <span className="text-xs text-gray-500 mr-1 self-center">{t('channel.insertVar')}</span>
                                  {extVars.map(v => (
                                    <Button
                                      key={v.name}
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => updateTemplate({ extend_prompt_template: (activeTmpl.extend_prompt_template || '') + `{${v.name}}` })}
                                      className="h-6 text-xs px-2 border-[#FFB300]/30 text-[#FFB300] hover:bg-[#FFB300]/10"
                                    >
                                      {`{${v.name}}`}
                                    </Button>
                                  ))}
                                </div>
                              ) : null;
                            })()}

                            {/* Extend Variables list */}
                            {(() => {
                              const extVars = activeTmpl.extend_variables || [];
                              return extVars.length > 0 ? (
                                <div className="space-y-2 pt-2 border-t border-gray-700">
                                  <Label className="text-[#FFB300] text-xs">{t('channel.variablesLabel')} ({extVars.length})</Label>
                                  {extVars.map(variable => {
                                    const newCount = variable.values.filter(v => v.status === 'new').length;
                                    const usedCount = variable.values.filter(v => v.status === 'used').length;
                                    return (
                                      <div key={variable.name} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-md">
                                        <div className="flex items-center gap-2">
                                          <code className="text-sm text-[#FFB300]">{`{${variable.name}}`}</code>
                                          <Badge variant="outline" className="bg-[#FFB300]/10 text-[#FFB300] border-[#FFB300]/30 text-xs">{newCount} new</Badge>
                                          <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30 text-xs">{usedCount} used</Badge>
                                        </div>
                                        <div className="flex gap-1">
                                          <Button type="button" variant="ghost" size="sm"
                                            onClick={() => {
                                              setEditingVariable(variable);
                                              setEditingVariableContext('extend');
                                              setVariableEditorOpen(true);
                                            }}
                                            className="h-7 px-2 text-xs text-gray-400 hover:text-[#FFB300]"
                                          >
                                            <Settings2 className="h-3 w-3 mr-1" />
                                            {t('channel.manageValues')}
                                          </Button>
                                          <Button type="button" variant="ghost" size="sm"
                                            onClick={() => updateTemplate({ extend_variables: extVars.filter(v => v.name !== variable.name) })}
                                            className="h-7 w-7 p-0 text-gray-500 hover:text-red-400"
                                          >
                                            <X className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null;
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Add first template button (when no templates yet) */}
              {promptTemplates.length === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const newId = uuidv4();
                    // Migrate existing single template to multi-template (including extend prompt)
                    const firstTemplate: PromptTemplate = {
                      id: newId,
                      label: 'Template 1',
                      prompt_template: formData.prompt_template || '',
                      variables: variables.length > 0 ? [...variables] : [],
                      ...(extendPromptText ? { extend_prompt_template: extendPromptText, extend_variables: extendVariables } : {}),
                    };
                    setPromptTemplates([firstTemplate]);
                    setActiveTemplateId(newId);
                  }}
                  className="text-xs border-dashed border-[#FFB300]/30 text-[#FFB300] w-full"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t('channel.addTemplate')}
                </Button>
              )}

              {/* Single template mode (legacy - shown when no multi-templates) */}
              {promptTemplates.length === 0 && (
              <>
              {/* Prompt Template */}
              <div className="space-y-2">
                <Label className="text-[#FFB300]">{t('channel.promptTemplateLabel')}</Label>
                <p className="text-xs text-gray-400">
                  {t('channel.promptTemplateDesc')}
                </p>
                <Textarea
                  value={formData.prompt_template}
                  onChange={(e) => setFormData(prev => ({ ...prev, prompt_template: e.target.value }))}
                  placeholder={`เช่น: A cinematic scene of {character} walking through {location} at sunset...`}
                  rows={5}
                  className="bg-gray-900/50 border-gray-700 font-mono text-sm"
                />
                {/* Quick insert variable buttons */}
                {variables.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-gray-500 mr-1 self-center">{t('channel.insertVar')}</span>
                    {variables.map(v => (
                      <Button
                        key={v.name}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleInsertVariable(v.name)}
                        className="h-6 text-xs px-2 border-[#FFB300]/30 text-[#FFB300] hover:bg-[#FFB300]/10"
                      >
                        {`{${v.name}}`}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {/* Variables Management */}
              <div className="space-y-2 pt-2 border-t border-gray-700">
                <Label className="text-[#FFB300]">{t('channel.variablesLabel')} ({variables.length} {t('channel.items')})</Label>
                <p className="text-xs text-gray-400">
                  {t('channel.variablesDesc')}
                </p>

                {/* List of variables */}
                {variables.length > 0 && (
                  <div className="space-y-2">
                    {variables.map(variable => {
                      const newCount = variable.values.filter(v => v.status === 'new').length;
                      const usedCount = variable.values.filter(v => v.status === 'used').length;
                      return (
                        <div
                          key={variable.name}
                          className="flex items-center justify-between p-2 bg-gray-800/50 rounded-md"
                        >
                          <div className="flex items-center gap-2">
                            <code className="text-sm text-[#FFB300]">{`{${variable.name}}`}</code>
                            <Badge variant="outline" className="bg-[#FFB300]/10 text-[#FFB300] border-[#FFB300]/30 text-xs">
                              {newCount} new
                            </Badge>
                            <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30 text-xs">
                              {usedCount} used
                            </Badge>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditVariable(variable)}
                              className="h-7 px-2 text-xs text-gray-400 hover:text-[#FFB300]"
                            >
                              <Settings2 className="h-3 w-3 mr-1" />
                              {t('channel.manageValues')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteVariable(variable.name)}
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

                {/* Add new variable */}
                <div className="flex gap-2">
                  <Input
                    value={newVarName}
                    onChange={(e) => setNewVarName(e.target.value.replace(/[^a-zA-Z0-9_ก-๛]/g, ''))}
                    placeholder={t('channel.varPlaceholder')}
                    className="flex-1 bg-gray-900/50 border-gray-700 text-sm"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddVariable(); } }}
                  />
                  <Button
                    type="button"
                    onClick={handleAddVariable}
                    disabled={!newVarName.trim()}
                    size="sm"
                    className="bg-[#FFB300] hover:bg-[#FFC233]"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* ========== Extend Prompt (single-template mode) ========== */}
              {formData.ai_model === 'kie_grok_extend' && (
                <div className="space-y-3 pt-3 border-t border-[#FFB300]/30">
                  <Label className="text-sm font-semibold text-[#FFB300]">Extend Prompt</Label>
                  <p className="text-xs text-gray-400 -mt-2">Prompt สำหรับต่อวิดีโอเพิ่ม 10 วินาที (รวม ~20s)</p>

                  <Textarea
                    value={extendPromptText}
                    onChange={(e) => {
                      const newPrompt = e.target.value;
                      setExtendPromptText(newPrompt);
                      const curlyMatches = newPrompt.match(/\{([^}]+)\}/g) || [];
                      const squareMatches = newPrompt.match(/\[([^\]]+)\]/g) || [];
                      const allMatches = [...curlyMatches, ...squareMatches];
                      const varNames = [...new Set(allMatches.map(m => m.replace(/[\{\}\[\]]/g, '')))];
                      const existingVars = extendVariables.filter(v => varNames.includes(v.name));
                      const existingNames = new Set(existingVars.map(v => v.name));
                      const newVarNames = varNames.filter(name => !existingNames.has(name));
                      const newVars = newVarNames.map(name => ({ name, system_prompt: '', values: [] as any[], loop: true }));
                      setExtendVariables([...existingVars, ...newVars]);
                    }}
                    placeholder="เช่น: Continue the scene smoothly, {character} walks further into {location}..."
                    rows={3}
                    className="bg-gray-900/50 border-[#FFB300]/20 font-mono text-sm"
                  />

                  {/* Quick insert variable buttons */}
                  {extendVariables.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      <span className="text-xs text-gray-500 mr-1 self-center">{t('channel.insertVar')}</span>
                      {extendVariables.map(v => (
                        <Button
                          key={v.name}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setExtendPromptText(prev => prev + `{${v.name}}`)}
                          className="h-6 text-xs px-2 border-[#FFB300]/30 text-[#FFB300] hover:bg-[#FFB300]/10"
                        >
                          {`{${v.name}}`}
                        </Button>
                      ))}
                    </div>
                  )}

                  {/* Extend Variables list */}
                  {extendVariables.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-gray-700">
                      <Label className="text-[#FFB300] text-xs">{t('channel.variablesLabel')} ({extendVariables.length})</Label>
                      {extendVariables.map(variable => {
                        const newCount = variable.values.filter(v => v.status === 'new').length;
                        const usedCount = variable.values.filter(v => v.status === 'used').length;
                        return (
                          <div key={variable.name} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-md">
                            <div className="flex items-center gap-2">
                              <code className="text-sm text-[#FFB300]">{`{${variable.name}}`}</code>
                              <Badge variant="outline" className="bg-[#FFB300]/10 text-[#FFB300] border-[#FFB300]/30 text-xs">{newCount} new</Badge>
                              <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30 text-xs">{usedCount} used</Badge>
                            </div>
                            <div className="flex gap-1">
                              <Button type="button" variant="ghost" size="sm"
                                onClick={() => {
                                  setEditingVariable(variable);
                                  setEditingVariableContext('extend');
                                  setVariableEditorOpen(true);
                                }}
                                className="h-7 px-2 text-xs text-gray-400 hover:text-[#FFB300]"
                              >
                                <Settings2 className="h-3 w-3 mr-1" />
                                {t('channel.manageValues')}
                              </Button>
                              <Button type="button" variant="ghost" size="sm"
                                onClick={() => setExtendVariables(prev => prev.filter(v => v.name !== variable.name))}
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
                </div>
              )}
              </>
              )}


            </div>
          )}

          {/* ========== Caption Settings ========== */}
          <div className="space-y-4">
            <h3 className="font-medium">{t('channel.captionSettings')}</h3>

            <div>
              <Label>{t('channel.captionLanguage')}</Label>
              <Select
                value={formData.caption_language}
                onValueChange={(value) => setFormData(prev => ({ ...prev, caption_language: value as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t('channelForm.langEnglish')}</SelectItem>
                  <SelectItem value="th">{t('channelForm.langThai')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="custom_hashtags">
                {t('channel.customHashtags')} <span className="text-muted-foreground text-xs">(max 5, one per line)</span>
              </Label>
              <Textarea
                id="custom_hashtags"
                value={formData.custom_hashtags}
                onChange={(e) => setFormData(prev => ({ ...prev, custom_hashtags: e.target.value }))}
                placeholder="#viral&#10;#trending&#10;#shorts"
                rows={3}
              />
              <p className="text-xs text-[#FFB300] mt-1">{t('channel.hashtagsHint')}</p>
            </div>
          </div>
          </>)}

          {channel && (<>
          {/* Target Timezone — only show in edit mode */}
          <div>
            <Label>{t('channel.targetTimezone')}</Label>
            <TimezoneSelector
              value={formData.timezone}
              onChange={(value) => setFormData(prev => ({ ...prev, timezone: value }))}
            />
            {formData.timezone && (
              <p className="text-xs text-muted-foreground mt-1">
                🕐 ตอนนี้เวลา {formData.timezone.split('/').pop()?.replace(/_/g, ' ')}:{' '}
                {new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: formData.timezone })}
              </p>
            )}
          </div>
          {/* Time Preset / Posting Schedule */}
          <div className="border border-[#FFB300]/20 rounded-lg p-4 bg-[#FFB300]/5 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#FFB300]" />
              <span className="font-medium text-sm">{t('channelForm.postingSchedule')}</span>
            </div>

            {/* เลือก Preset ที่มีอยู่ */}
            {timePresets.length > 0 && (() => {
              const selectedPresetId = (() => {
                const key = JSON.stringify([...timeSlots].sort());
                return timePresets.find(p =>
                  JSON.stringify([...(p.times || [])].sort()) === key
                )?.id.toString() || '';
              })();
              return (
              <div>
                <Label className="text-xs">{t('channelForm.loadFromPreset')}</Label>
                <Select
                  value={selectedPresetId}
                  onValueChange={(val) => {
                    const preset = timePresets.find(p => p.id.toString() === val);
                    if (preset) {
                      setTimeSlots(preset.times);
                      setFormData(prev => ({ ...prev, posts_per_day: preset.times.length }));
                    }
                  }}
                >
                  <SelectTrigger className="bg-gray-900/50 border-gray-700">
                    <SelectValue placeholder={t('channelForm.selectPreset')} />
                  </SelectTrigger>
                  <SelectContent>
                    {timePresets.map(preset => (
                      <SelectItem key={preset.id} value={preset.id.toString()}>
                        {preset.name} ({preset.times.join(', ')})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              );
            })()}

            {/* Time Slots — picker เหมือน DayDetailModal */}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">{t('channelForm.timeSlots')}</div>
              <div className="flex flex-wrap gap-2">
                {timeSlots.map((time, index) => {
                  const [hour, minute] = time.split(':');
                  return (
                    <div key={index} className="flex items-center gap-1 bg-gray-900/50 rounded-lg border border-gray-700 px-2 py-1.5">
                      <select
                        value={hour}
                        onChange={(e) => {
                          const newSlots = [...timeSlots];
                          newSlots[index] = `${e.target.value}:${minute}`;
                          setTimeSlots(newSlots);
                          setFormData(prev => ({ ...prev, posts_per_day: newSlots.length }));
                        }}
                        className="font-mono text-sm bg-transparent border-none text-[#FFB300] outline-none cursor-pointer appearance-none"
                      >
                        {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map(h => (
                          <option key={h} value={h} className="bg-gray-900">{h}</option>
                        ))}
                      </select>
                      <span className="text-muted-foreground">:</span>
                      <select
                        value={minute}
                        onChange={(e) => {
                          const newSlots = [...timeSlots];
                          newSlots[index] = `${hour}:${e.target.value}`;
                          setTimeSlots(newSlots);
                          setFormData(prev => ({ ...prev, posts_per_day: newSlots.length }));
                        }}
                        className="font-mono text-sm bg-transparent border-none text-[#FFB300] outline-none cursor-pointer appearance-none"
                      >
                        {Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0')).map(m => (
                          <option key={m} value={m} className="bg-gray-900">{m}</option>
                        ))}
                      </select>
                      {timeSlots.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const newSlots = timeSlots.filter((_, i) => i !== index);
                            setTimeSlots(newSlots);
                            setFormData(prev => ({ ...prev, posts_per_day: newSlots.length }));
                          }}
                          className="w-5 h-5 rounded-full hover:bg-red-500/20 text-muted-foreground hover:text-red-400 flex items-center justify-center transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const lastTime = timeSlots[timeSlots.length - 1] || '12:00';
                    const [h, m] = lastTime.split(':').map(Number);
                    const newHour = ((h ?? 12) + 2) % 24;
                    const newSlots = [...timeSlots, `${newHour.toString().padStart(2, '0')}:${(m ?? 0).toString().padStart(2, '0')}`];
                    setTimeSlots(newSlots);
                    setFormData(prev => ({ ...prev, posts_per_day: newSlots.length }));
                  }}
                  className="h-9 px-3 border border-dashed border-gray-700 text-muted-foreground hover:text-[#FFB300] hover:border-[#FFB300]/50"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {t('channelForm.addTime')}
                </Button>
              </div>
            </div>

            {/* Save as Preset */}
            {!showSavePreset ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowSavePreset(true)}
                className="text-xs text-muted-foreground hover:text-[#FFB300]"
              >
                <Star className="h-3 w-3 mr-1" />
                {t('channelForm.saveAsPreset')}
              </Button>
            ) : (
              <div className="flex items-center gap-2 bg-gray-900/50 rounded-lg p-2">
                <Input
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder={t('channelForm.presetNamePlaceholder')}
                  className="h-8 bg-gray-800 border-gray-700 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={async () => {
                    if (!newPresetName.trim() || timeSlots.length === 0) return;
                    setSavingPreset(true);
                    try {
                      await api.createTimePreset(newPresetName.trim(), timeSlots);
                      await fetchTimePresets();
                      setNewPresetName('');
                      setShowSavePreset(false);
                      toast.success(t('channelForm.presetSaved'));
                    } catch (err: any) {
                      toast.error(err?.message || t('channelForm.presetSaveFailed'));
                    } finally {
                      setSavingPreset(false);
                    }
                  }}
                  disabled={savingPreset || !newPresetName.trim()}
                  className="h-8 bg-[#FFB300] hover:bg-[#FFC233] text-white"
                >
                  {savingPreset ? <Loader2 className="h-3 w-3 animate-spin" /> : t('common.save')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => { setShowSavePreset(false); setNewPresetName(''); }}
                  className="h-8 text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              {t('channelForm.postsPerDay')}: {timeSlots.length}
            </div>
          </div>

          {/* ========== Facebook Admin Profile (dropdown) ========== */}
          <div className="border border-[#FFB300]/20 rounded-lg p-4 bg-[#FFB300]/5 space-y-3">
            <div className="flex items-center gap-2">
              <Facebook className="h-4 w-4 text-blue-400" />
              <span className="font-medium text-sm">{t('channelForm.fbAdminProfile')}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('channelForm.fbAdminDesc')}
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Select
                  value={formData.fb_admin_profile_id || '_none'}
                  onValueChange={(val) => setFormData(prev => ({ ...prev, fb_admin_profile_id: val === '_none' ? '' : val }))}
                >
                  <SelectTrigger className="bg-gray-900/50 border-gray-700">
                    <SelectValue placeholder={t('channelForm.selectAdmin')}>
                      {formData.fb_admin_profile_id ? (
                        (() => {
                          const profile = savedLateProfiles.find(p => p.profile_id === formData.fb_admin_profile_id);
                          if (profile) {
                            return (
                              <div className="flex items-center gap-2">
                                {profile.avatar_url ? (
                                  <img src={profile.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-blue-500/30 flex items-center justify-center text-[10px]">
                                    {profile.display_name.charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <span>{profile.display_name}</span>
                              </div>
                            );
                          }
                          // savedLateProfiles ยังโหลดไม่เสร็จ → แสดง loading แทน "ไม่พบ"
                          if (savedLateProfiles.length === 0) {
                            return <span className="text-muted-foreground text-xs">กำลังโหลด...</span>;
                          }
                          return <span className="text-muted-foreground text-xs">ID: {formData.fb_admin_profile_id}</span>;
                        })()
                      ) : (
                        <span className="text-muted-foreground">-- ไม่ระบุ --</span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">-- ไม่ระบุ --</SelectItem>
                    {savedLateProfiles.map(profile => (
                      <SelectItem key={profile.id} value={profile.profile_id}>
                        <div className="flex items-center gap-2">
                          {profile.avatar_url ? (
                            <img src={profile.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-blue-500/30 flex items-center justify-center text-[10px]">
                              {profile.display_name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span>{profile.display_name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {formData.fb_admin_profile_id && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const profile = savedLateProfiles.find(p => p.profile_id === formData.fb_admin_profile_id);
                    if (profile) {
                      try {
                        await api.deleteSavedLateProfile(profile.id);
                        setSavedLateProfiles(prev => prev.filter(p => p.id !== profile.id));
                        setFormData(prev => ({ ...prev, fb_admin_profile_id: '' }));
                        toast.success(t('channelForm.presetDeleted'));
                      } catch (err: any) {
                        toast.error(err.message || t('channelForm.presetDeleteFailed'));
                      }
                    }
                  }}
                  className="h-9 w-9 p-0 text-gray-500 hover:text-red-400"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setNewLateProfile({ profile_id: '', display_name: '', avatar_url: '' });
                  setAddLateProfileDialogOpen(true);
                }}
                className="h-9 text-xs"
              >
                <Plus className="h-3 w-3 mr-1" />
                {t('channelForm.add')}
              </Button>
            </div>
          </div>
          </>)}

          {/* ========== Posting Service Selection ========== */}
          {(<>
          <div className="space-y-3">
            <div>
              <Label className="text-base font-semibold">{t('channel.postingService')}</Label>
              <p className="text-xs text-gray-400 mt-0.5">{t('channel.postingServiceDesc')}</p>
            </div>
            <div className="space-y-2">
              {/* Option: None */}
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, posting_service: 'none' as const }))}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${
                  formData.posting_service === 'none'
                    ? 'border-gray-500 bg-gray-500/10'
                    : 'border-gray-700 bg-transparent hover:border-gray-600 hover:bg-gray-800/50'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  formData.posting_service === 'none' ? 'border-gray-500' : 'border-gray-600'
                }`}>
                  {formData.posting_service === 'none' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-gray-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold text-sm ${formData.posting_service === 'none' ? 'text-gray-300' : 'text-gray-400'}`}>
                    {t('channel.noPostGenOnly')}
                  </div>
                  <div className="text-[11px] text-gray-500">{t('channel.noPostDesc')}</div>
                </div>
              </button>

              {/* Option: Late - hidden for users registered after 2026-03-28 */}
              {showLateOption && (
              <button
                type="button"
                onClick={() => { setFormData(prev => ({ ...prev, posting_service: 'late' as const })); setShowLateGuide(true); }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${
                  formData.posting_service === 'late'
                    ? 'border-[#FFB300] bg-[#FFB300]/10'
                    : 'border-gray-700 bg-transparent hover:border-gray-600 hover:bg-gray-800/50'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  formData.posting_service === 'late' ? 'border-[#FFB300]' : 'border-gray-600'
                }`}>
                  {formData.posting_service === 'late' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#FFB300]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold text-sm ${formData.posting_service === 'late' ? 'text-[#FFB300]' : 'text-gray-400'}`}>
                    Late (zernio.com)
                  </div>
                  <div className="text-[11px] text-gray-500">{t('channel.lateDesc')}</div>
                  <div className="flex gap-1 mt-1 text-[11px] text-amber-500">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    <div>
                      <span>{t('settings.lateWarning1')}</span>{' '}
                      <span className="font-semibold">{t('settings.lateWarning2')}</span>
                    </div>
                  </div>
                </div>
              </button>
              )}

              {/* Option: Post for Me */}
              <button
                type="button"
                onClick={() => { setFormData(prev => ({ ...prev, posting_service: 'postforme' as const })); setShowPostformeGuide(true); }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${
                  formData.posting_service === 'postforme'
                    ? 'border-[#FFB300] bg-[#FFB300]/10'
                    : 'border-gray-700 bg-transparent hover:border-gray-600 hover:bg-gray-800/50'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  formData.posting_service === 'postforme' ? 'border-[#FFB300]' : 'border-gray-600'
                }`}>
                  {formData.posting_service === 'postforme' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#FFB300]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold text-sm ${formData.posting_service === 'postforme' ? 'text-[#FFB300]' : 'text-gray-400'}`}>
                    Post for Me (postforme.dev)
                  </div>
                  <div className="text-[11px] text-gray-500">{t('channel.postformeDesc')}</div>
                </div>
              </button>
            </div>
          </div>

          {/* ========== Blotato Config ========== */}
          {formData.posting_service === 'blotato' && (
            <div className="border border-[#FFB300]/30 rounded-lg p-4 bg-[#FFB300]/5 space-y-4">
              <h3 className="font-semibold text-[#FFB300]">{t('channelForm.blotatoSettings')}</h3>

              <div>
                <Label htmlFor="blotato_api_key">
                  API Key <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="blotato_api_key"
                  type="password"
                  value={formData.blotato_api_key || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, blotato_api_key: e.target.value }))}
                  placeholder={t('channelForm.blotatoApiKeyPlaceholder')}
                  className="bg-gray-900/50 border-gray-700"
                />
                <p className="text-xs text-muted-foreground mt-1">{t('channelForm.blotatoApiKeyHint')}</p>
              </div>

              <div>
                <Label htmlFor="blotato_account_id">
                  Facebook Account ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="blotato_account_id"
                  value={formData.blotato_account_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, blotato_account_id: e.target.value }))}
                  placeholder="e.g., 17701"
                  className="bg-gray-900/50 border-gray-700"
                />
                <p className="text-xs text-muted-foreground mt-1">{t('channelForm.fbAccountIdHint')}</p>
              </div>

              {formData.blotato_api_key && (
                <div className="space-y-3 pt-3 border-t border-gray-700">
                  <Label className="text-sm text-[#FFB300]">{t('channelForm.platformIds')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('channelForm.platformIdsHint')}
                  </p>
                  <div className="grid gap-3">
                    <div className="flex items-center gap-2">
                      <Facebook className="h-4 w-4 text-blue-500 flex-shrink-0" />
                      <Input placeholder="Facebook Page ID" value={formData.page_ids.facebook}
                        onChange={(e) => setFormData(prev => ({ ...prev, page_ids: { ...prev.page_ids, facebook: e.target.value } }))}
                        className="bg-gray-900/50 border-gray-700" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Instagram className="h-4 w-4 text-pink-500 flex-shrink-0" />
                      <Input placeholder={t('channelForm.igPlaceholder')} value={formData.page_ids.instagram}
                        onChange={(e) => setFormData(prev => ({ ...prev, page_ids: { ...prev.page_ids, instagram: e.target.value } }))}
                        className="bg-gray-900/50 border-gray-700" disabled />
                    </div>
                    <div className="flex items-center gap-2">
                      <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-.88-.07A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
                      </svg>
                      <Input placeholder="TikTok Account ID" value={formData.page_ids.tiktok}
                        onChange={(e) => setFormData(prev => ({ ...prev, page_ids: { ...prev.page_ids, tiktok: e.target.value } }))}
                        className="bg-gray-900/50 border-gray-700" />
                    </div>
                    <div className="flex items-center gap-2">
                      <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                      <Input placeholder="X (Twitter) Account ID" value={formData.page_ids.twitter}
                        onChange={(e) => setFormData(prev => ({ ...prev, page_ids: { ...prev.page_ids, twitter: e.target.value } }))}
                        className="bg-gray-900/50 border-gray-700" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Youtube className="h-4 w-4 text-red-500 flex-shrink-0" />
                      <Input placeholder="YouTube Account ID" value={formData.page_ids.youtube}
                        onChange={(e) => setFormData(prev => ({ ...prev, page_ids: { ...prev.page_ids, youtube: e.target.value } }))}
                        className="bg-gray-900/50 border-gray-700" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========== Late Config ========== */}
          {formData.posting_service === 'late' && (
            <div className="border border-[#FFB300]/30 rounded-lg p-4 bg-[#FFB300]/5 space-y-4">
              <h3 className="font-semibold text-[#FFB300]">{t('channelForm.lateSettings')}</h3>

              <div className="bg-[#FFB300]/10 p-3 rounded-md">
                <p className="text-xs text-orange-200">
                  {t('channelForm.lateApiWarning')}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t('channelForm.lateProfileId')} <span className="text-muted-foreground text-xs">({t('channelForm.lateProfileIdFrom')})</span></Label>
                <Input
                  value={formData.late_profile_id || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, late_profile_id: e.target.value }))}
                  placeholder="69ab9032aa99c02566b92a16"
                  className="bg-gray-900/50 border-gray-700 font-mono text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                  {t('channelForm.lateProfileIdHint')}
                </p>
              </div>

              {/* Account IDs section - always visible */}
              <div className="space-y-3 pt-3 border-t border-gray-700">
                  <Label className="text-sm text-orange-200">{t('channelForm.accountIdsPerPlatform')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('channelForm.accountIdsHint')}
                  </p>
                  <div className="grid gap-3">
                    {[
                      { platform: 'facebook', icon: <Facebook className="h-4 w-4 text-blue-500" />, label: 'Facebook' },
                      { platform: 'instagram', icon: <Instagram className="h-4 w-4 text-pink-500" />, label: 'Instagram' },
                      { platform: 'tiktok', icon: (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-.88-.07A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>
                      ), label: 'TikTok' },
                      { platform: 'twitter', icon: (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                      ), label: 'X (Twitter)' },
                      { platform: 'youtube', icon: <Youtube className="h-4 w-4 text-red-500" />, label: 'YouTube' },
                    ].map(({ platform, icon, label }) => {
                      const existing = formData.late_accounts.find(a => a.platform === platform);
                      return (
                        <div key={platform} className="flex items-center gap-2">
                          <span className="flex-shrink-0">{icon}</span>
                          <Input
                            placeholder={`${label} Account ID (acc_...)`}
                            value={existing?.accountId || ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              setFormData(prev => {
                                const accounts = prev.late_accounts.filter(a => a.platform !== platform);
                                if (value.trim()) {
                                  accounts.push({ platform, accountId: value });
                                }
                                return { ...prev, late_accounts: accounts };
                              });
                            }}
                            className="bg-gray-900/50 border-gray-700"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

              <button
                type="button"
                onClick={() => setShowLateGuide(true)}
                className="flex items-center gap-2 text-sm text-[#FFB300] hover:text-[#FFB300] mt-2 transition-colors"
              >
                <BookOpen className="h-4 w-4" />
                {language === 'th' ? 'ดูขั้นตอนเชื่อม Late' : 'Late Connection Guide'}
              </button>
            </div>
          )}

          {/* ========== Post for Me Config ========== */}
          {formData.posting_service === 'postforme' && (
            <div className="border border-[#FFB300]/30 rounded-lg p-4 bg-[#FFB300]/5 space-y-4">
              <h3 className="font-semibold text-[#FFB300]">{t('channelForm.pfmSettings')}</h3>

              {postformeKeysList.length === 0 && (
                <p className="text-xs text-amber-400">
                  {language === 'th' ? '⚠️ ยังไม่มี API Key กรุณาเพิ่มใน ตั้งค่า → Post for Me API Key' : '⚠️ No API keys found. Please add one in Settings → Post for Me API Key'}
                </p>
              )}

              <div className="space-y-3">
                <Label className="text-sm text-[#FFB300]">{language === 'th' ? 'Account IDs ของแต่ละแพลตฟอร์ม' : 'Account IDs for each platform'}</Label>
                <p className="text-xs text-muted-foreground">
                  {language === 'th' ? 'ใส่ Social Account ID (spc_...) จาก Post for Me Dashboard → Social Media Accounts' : 'Enter Social Account ID (spc_...) from Post for Me Dashboard → Social Media Accounts'}
                </p>
                {[
                  { icon: <Facebook className="h-4 w-4 text-blue-400" />, label: 'Facebook', index: 0 },
                  { icon: <Instagram className="h-4 w-4 text-pink-400" />, label: 'Instagram', index: 1 },
                  { icon: <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.8a8.16 8.16 0 0 0 4.77 1.53v-3.5a4.82 4.82 0 0 1-1.01-.14Z"/></svg>, label: 'TikTok', index: 2 },
                  { icon: <Youtube className="h-4 w-4 text-red-400" />, label: 'YouTube', index: 3 },
                  { icon: <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>, label: 'X (Twitter)', index: 4 },
                ].map(({ icon, label, index }) => (
                  <div key={label} className="flex items-center gap-2">
                    {icon}
                    <Input
                      placeholder={`${label} Account ID (spc_...)`}
                      value={formData.postforme_accounts[index] || ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSpcError(false);
                        setFormData(prev => {
                          const accounts = [...prev.postforme_accounts];
                          while (accounts.length <= index) accounts.push('');
                          accounts[index] = value;
                          return { ...prev, postforme_accounts: accounts };
                        });
                      }}
                      className="bg-gray-900/50 border-gray-700"
                    />
                  </div>
                ))}
                <Dialog open={spcError} onOpenChange={(open) => {
                  if (!open) {
                    setSpcError(false);
                    setShowPostformeGuide(true);
                  }
                }}>
                  <DialogContent className="bg-zinc-900 border-red-500/50 max-w-xs">
                    <div className="flex flex-col items-center gap-5 py-3 text-center">
                      <div className="text-4xl">⚠️</div>
                      <div className="space-y-1">
                        <p className="text-white font-semibold text-sm">{language === 'th' ? 'กรุณาใส่ Connection ID' : 'Please enter Connection ID'}</p>
                        <p className="text-zinc-400 text-sm">{language === 'th' ? 'จาก Post for Me' : 'from Post for Me'}</p>
                      </div>
                      <div className="flex gap-2 w-full">
                        <Button
                          onClick={() => setSpcError(false)}
                          variant="outline"
                          className="flex-1 text-sm"
                        >
                          {language === 'th' ? 'ตกลง' : 'OK'}
                        </Button>
                        <Button
                          onClick={() => {
                            setSpcError(false);
                            setShowPostformeGuide(true);
                          }}
                          className="flex-1 bg-yellow-600 hover:bg-yellow-500 text-black font-semibold text-sm"
                        >
                          {language === 'th' ? 'ดูวิธีเชื่อม' : 'Connection Guide'}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <button
                type="button"
                onClick={() => setShowPostformeGuide(true)}
                className="flex items-center gap-2 text-sm text-[#FFB300] hover:text-[#FFB300] mt-2 transition-colors"
              >
                <BookOpen className="h-4 w-4" />
                {language === 'th' ? 'ดูขั้นตอนเชื่อม Account & สร้าง Channel' : 'Connect Account & Create Channel Guide'}
              </button>
            </div>
          )}
          </>)}

          {/* Watermark Settings */}
          {channel && (
            <div className="border border-zinc-700 rounded-lg p-4 space-y-3 bg-zinc-900/30">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base flex items-center gap-2">
                    💧 {language === 'th' ? 'ลายน้ำ (Watermark)' : 'Watermark'}
                  </Label>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {language === 'th'
                      ? 'ใส่ลายน้ำลงในวิดีโอสุดท้ายก่อนบันทึก'
                      : 'Apply watermark to final video before saving'}
                  </p>
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={formData.watermark_enabled}
                    onChange={(e) => setFormData(prev => ({ ...prev, watermark_enabled: e.target.checked }))}
                  />
                  <div className="relative w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:bg-[#FFB300] after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                </label>
              </div>

              {formData.watermark_enabled && (
                <div className="space-y-3 pt-2">
                  {/* Type */}
                  <div>
                    <Label className="text-sm">{language === 'th' ? 'ประเภท' : 'Type'}</Label>
                    <Select
                      value={formData.watermark_type}
                      onValueChange={(v) => setFormData(prev => ({ ...prev, watermark_type: v as any }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">📝 {language === 'th' ? 'ข้อความ' : 'Text'}</SelectItem>
                        <SelectItem value="image">🖼️ {language === 'th' ? 'รูปภาพ' : 'Image'}</SelectItem>
                        <SelectItem value="both">📝🖼️ {language === 'th' ? 'ข้อความ + รูปภาพ' : 'Text + Image'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Text input */}
                  {(formData.watermark_type === 'text' || formData.watermark_type === 'both') && (
                    <div>
                      <Label className="text-sm">{language === 'th' ? 'ข้อความ' : 'Text'}</Label>
                      <Input
                        value={formData.watermark_text}
                        onChange={(e) => setFormData(prev => ({ ...prev, watermark_text: e.target.value }))}
                        placeholder={language === 'th' ? 'เช่น @mychannel' : 'e.g. @mychannel'}
                        maxLength={100}
                      />
                    </div>
                  )}

                  {/* Image upload */}
                  {(formData.watermark_type === 'image' || formData.watermark_type === 'both') && (
                    <div>
                      <Label className="text-sm">{language === 'th' ? 'รูปภาพ' : 'Image'}</Label>
                      <div className="flex items-center gap-3 mt-1">
                        {formData.watermark_image_url && (
                          <div className={`relative bg-black ${formData.watermark_circular ? 'rounded-full overflow-hidden' : 'rounded'} w-16 h-16 shrink-0`}>
                            <img
                              src={formData.watermark_image_url}
                              alt="watermark"
                              className="w-full h-full object-contain"
                            />
                          </div>
                        )}
                        <div className="flex-1 flex gap-2">
                          <input
                            type="file"
                            id="wm-image-upload"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (file.size > 2 * 1024 * 1024) {
                                toast.error(language === 'th' ? 'ไฟล์ต้องไม่เกิน 2MB' : 'File must be under 2MB');
                                return;
                              }
                              try {
                                const result = await api.uploadWatermarkImage(channel.id, file);
                                setFormData(prev => ({
                                  ...prev,
                                  watermark_image_url: result.imageUrl,
                                  watermark_image_path: result.imagePath,
                                }));
                                toast.success(language === 'th' ? 'อัปโหลดสำเร็จ' : 'Uploaded');
                              } catch (err: any) {
                                toast.error(err?.message || 'Upload failed');
                              } finally {
                                e.target.value = '';
                              }
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => document.getElementById('wm-image-upload')?.click()}
                          >
                            <Upload className="h-3 w-3 mr-1" />
                            {formData.watermark_image_url
                              ? (language === 'th' ? 'เปลี่ยน' : 'Change')
                              : (language === 'th' ? 'อัปโหลด' : 'Upload')}
                          </Button>
                          {formData.watermark_image_url && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                try {
                                  await api.deleteWatermarkImage(channel.id);
                                  setFormData(prev => ({
                                    ...prev,
                                    watermark_image_url: null,
                                    watermark_image_path: null,
                                  }));
                                  toast.success(language === 'th' ? 'ลบแล้ว' : 'Removed');
                                } catch (err: any) {
                                  toast.error(err?.message || 'Delete failed');
                                }
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">
                        PNG/JPG/WebP, max 2MB
                      </p>
                    </div>
                  )}

                  {/* Image size + circular */}
                  {(formData.watermark_type === 'image' || formData.watermark_type === 'both') && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm">{language === 'th' ? 'ขนาด' : 'Size'}</Label>
                        <Select
                          value={formData.watermark_image_size}
                          onValueChange={(v) => setFormData(prev => ({ ...prev, watermark_image_size: v as any }))}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="small">{language === 'th' ? 'เล็ก' : 'Small'} (64px)</SelectItem>
                            <SelectItem value="medium">{language === 'th' ? 'กลาง' : 'Medium'} (120px)</SelectItem>
                            <SelectItem value="large">{language === 'th' ? 'ใหญ่' : 'Large'} (200px)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end">
                        <label className="inline-flex items-center gap-2 cursor-pointer pb-2">
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={formData.watermark_circular}
                            onChange={(e) => setFormData(prev => ({ ...prev, watermark_circular: e.target.checked }))}
                          />
                          <span className="text-sm">⭕ {language === 'th' ? 'ครอปเป็นวงกลม' : 'Circular crop'}</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Position */}
                  <div>
                    <Label className="text-sm">{language === 'th' ? 'ตำแหน่ง' : 'Position'}</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {([
                        ['top-left', language === 'th' ? '↖ ซ้ายบน' : '↖ Top Left'],
                        ['top-right', language === 'th' ? '↗ ขวาบน' : '↗ Top Right'],
                        ['bottom-left', language === 'th' ? '↙ ซ้ายล่าง' : '↙ Bottom Left'],
                        ['bottom-right', language === 'th' ? '↘ ขวาล่าง' : '↘ Bottom Right'],
                      ] as const).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, watermark_position: val as any }))}
                          className={`py-2 px-3 rounded text-sm border ${
                            formData.watermark_position === val
                              ? 'bg-[#FFB300]/20 border-[#FFB300] text-[#FFB300]'
                              : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Opacity */}
                  <div>
                    <Label className="text-sm flex justify-between">
                      <span>{language === 'th' ? 'ความโปร่งใส' : 'Opacity'}</span>
                      <span className="text-[#FFB300]">{formData.watermark_opacity}%</span>
                    </Label>
                    <Slider
                      value={[formData.watermark_opacity]}
                      onValueChange={([v]) => setFormData(prev => ({ ...prev, watermark_opacity: v }))}
                      min={1}
                      max={100}
                      step={1}
                      className="mt-2"
                    />
                  </div>

                  {/* Preview */}
                  <div>
                    <Label className="text-sm mb-1.5 block">{language === 'th' ? 'ตัวอย่าง' : 'Preview'}</Label>
                    <div className="flex justify-center">
                      <div className="relative rounded-lg overflow-hidden border border-[#FFB300]/20 bg-black" style={{ aspectRatio: '9/16', height: 300 }}>
                        {/* Simulated video background */}
                        <div className="absolute inset-0 bg-gradient-to-b from-[#FFB300]/5 to-black" />

                        {/* Watermark overlay */}
                        {(() => {
                          const pos = formData.watermark_position;
                          const opac = formData.watermark_opacity / 100;
                          const hasImg = (formData.watermark_type === 'image' || formData.watermark_type === 'both') && formData.watermark_image_url;
                          const hasTxt = (formData.watermark_type === 'text' || formData.watermark_type === 'both') && formData.watermark_text;
                          const sizeMap: Record<string, number> = { small: 28, medium: 44, large: 64 };
                          const imgSize = sizeMap[formData.watermark_image_size] || 44;
                          const posStyle: React.CSSProperties = {
                            position: 'absolute',
                            ...(pos.includes('top') ? { top: 12 } : { bottom: 12 }),
                            ...(pos.includes('left') ? { left: 12 } : { right: 12 }),
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: pos.includes('left') ? 'flex-start' : 'flex-end',
                            gap: 3,
                            opacity: opac,
                            transition: 'all 0.3s ease',
                          };
                          return (
                            <div style={posStyle}>
                              {hasImg && (
                                <img
                                  src={formData.watermark_image_url!}
                                  alt="wm"
                                  style={{ width: imgSize, height: imgSize, objectFit: 'cover' }}
                                  className={formData.watermark_circular ? 'rounded-full' : 'rounded-sm'}
                                />
                              )}
                              {hasTxt && (
                                <span className="text-white text-[9px] font-semibold drop-shadow-lg whitespace-nowrap px-1">
                                  {formData.watermark_text}
                                </span>
                              )}
                            </div>
                          );
                        })()}

                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t('channel.saving') : channel ? t('channel.updateChannel') : t('channel.createChannel')}
            </Button>
          </div>
        </form>
      </DialogContent>

      {/* Post for Me Guide — as a separate Radix Dialog so scroll works */}
      {/* Prompt & Variable validation popup */}
      <Dialog open={promptError} onOpenChange={setPromptError}>
        <DialogContent className="bg-zinc-900 border-yellow-500/50 max-w-sm">
          <div className="flex flex-col items-center gap-5 py-3 text-center">
            <div className="text-4xl">📝</div>
            <div className="space-y-2">
              <p className="text-white font-semibold text-base">
                {language === 'th' ? 'ยังไม่ได้ตั้งค่า Prompt' : 'Prompt not configured'}
              </p>
              <p className="text-zinc-400 text-sm">
                {language === 'th'
                  ? 'กรุณาตั้งค่า Prompt กับ ตัวแปร ก่อนกดอัพเดทช่อง'
                  : 'Please set up Prompt and Variables before updating'}
              </p>
            </div>
            <Button
              onClick={() => setPromptError(false)}
              className="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-semibold text-sm"
            >
              {language === 'th' ? 'ตกลง' : 'OK'}
            </Button>
          </div>
          <DialogTitle className="sr-only">Prompt validation</DialogTitle>
        </DialogContent>
      </Dialog>

      <Dialog open={showPostformeGuide} onOpenChange={setShowPostformeGuide}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 border-[#FFB300]/30">
          {/* Header */}
          <div className="flex-shrink-0 bg-gray-900 border-b border-[#FFB300]/20 px-6 py-4 flex items-center justify-between">
            <DialogTitle className="text-lg font-bold text-[#FFB300] flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              {language === 'th' ? 'ขั้นตอนเชื่อม Account & สร้าง Channel' : 'Connect Account & Create Channel'}
            </DialogTitle>
          </div>

          {/* Steps — scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            <p className="text-sm text-gray-400">
              {language === 'th' ? `${postformeGuideSteps.length} ขั้นตอน` : `${postformeGuideSteps.length} steps`}
            </p>
            {postformeGuideSteps.map((step, i) => (
              <div key={i} className="space-y-2">
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#FFB300]/20 text-[#FFB300] flex items-center justify-center text-sm font-bold">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-gray-200">{step.text[language]}</p>
                    {step.note && (
                      <p className="text-xs text-yellow-400/80 mt-1">* {step.note[language]}</p>
                    )}
                  </div>
                </div>
                {step.images && step.images.map((img, j) => (
                  <img
                    key={j}
                    src={guideImgUrl(img)}
                    alt={`Step ${i + 1}`}
                    className="rounded-lg border border-gray-700 cursor-pointer hover:border-[#FFB300]/50 transition-colors ml-10 max-w-[90%]"
                    onClick={() => setGuideLightbox(guideImgUrl(img))}
                  />
                ))}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Late Guide Dialog */}
      <Dialog open={showLateGuide} onOpenChange={setShowLateGuide}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 border-[#FFB300]/30">
          {/* Header */}
          <div className="flex-shrink-0 bg-gray-900 border-b border-[#FFB300]/20 px-6 py-4 flex items-center justify-between">
            <DialogTitle className="text-lg font-bold text-[#FFB300] flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              {language === 'th' ? 'ขั้นตอนเชื่อม Late (zernio.com)' : 'How to Connect Late (zernio.com)'}
            </DialogTitle>
          </div>

          {/* Steps — scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            <p className="text-sm text-gray-400">
              {language === 'th' ? `${lateGuideSteps.length} ขั้นตอน` : `${lateGuideSteps.length} steps`}
            </p>
            {lateGuideSteps.map((step, i) => (
              <div key={i} className="space-y-2">
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#FFB300]/20 text-[#FFB300] flex items-center justify-center text-sm font-bold">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-gray-200">{step.text[language]}</p>
                    {step.note && (
                      <p className="text-xs text-yellow-400/80 mt-1">* {step.note[language]}</p>
                    )}
                  </div>
                </div>
                {step.images && step.images.map((img, j) => (
                  <img
                    key={j}
                    src={guideImgUrl(img)}
                    alt={`Step ${i + 1}`}
                    className="rounded-lg border border-gray-700 cursor-pointer hover:border-[#FFB300]/50 transition-colors ml-10 max-w-[90%]"
                    onClick={() => setGuideLightbox(guideImgUrl(img))}
                  />
                ))}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Guide image lightbox */}
      <Dialog open={!!guideLightbox} onOpenChange={(o) => !o && setGuideLightbox(null)}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] p-2 bg-transparent border-none shadow-none flex items-center justify-center">
          <DialogTitle className="sr-only">Guide Image</DialogTitle>
          <img src={guideLightbox || ''} alt="Guide" className="max-w-full max-h-[85vh] object-contain rounded-lg" />
        </DialogContent>
      </Dialog>

      {/* Variable Editor Modal */}
      {(() => {
        // Idol Template outfit/background — enable AI Generate with image + template context
        const isIdolVar = formData.ai_model === 'kie_idol_template'
          && editingVariable
          && (editingVariable.name === 'outfit' || editingVariable.name === 'background');
        const activeIdolTpl = isIdolVar ? aiPromptTemplates[activeViralPromptIdx] : undefined;
        const idolImageUrl = activeIdolTpl?.idol_image || '';
        const templateCtx = activeIdolTpl
          ? `Template name: ${activeIdolTpl.label}\nPrompt: ${(activeIdolTpl.prompt || '').slice(0, 600)}`
          : undefined;
        const defaultSysPrompt = isIdolVar && editingVariable
          ? (editingVariable.name === 'outfit'
              ? 'You are a fashion stylist. Based on the provided idol image and template context, generate outfit descriptions that match the idol\'s style, body, and the mood of the template. Each value should be a short outfit description (e.g. "white linen summer dress", "black leather jacket with ripped jeans"). Output only the values.'
              : 'You are a creative director. Based on the provided idol image and template context, generate background/scene descriptions that complement the idol and match the template mood. Each value should be a short scene description (e.g. "sunlit beach at golden hour", "cozy coffee shop interior"). Output only the values.')
          : undefined;
        const idolTitle = isIdolVar
          ? (editingVariable?.name === 'outfit' ? 'ชุด' : 'ฉากหลัง')
          : undefined;
        return (
          <VariableEditorModal
            open={variableEditorOpen}
            onClose={() => setVariableEditorOpen(false)}
            variable={editingVariable}
            onSave={handleSaveVariable}
            hideAiGenerate={editingVariableContext === 'ai' && !isIdolVar}
            aiGenerateContext={isIdolVar ? {
              imageUrl: idolImageUrl || undefined,
              templateContext: templateCtx,
              defaultSystemPrompt: defaultSysPrompt,
            } : undefined}
            labelOverrides={isIdolVar ? {
              title: idolTitle,
              systemPromptLabel: 'บอก AI ให้คิดให้',
              currentValuesLabel: 'รายการที่ใส่ไว้',
            } : undefined}
          />
        );
      })()}

      {/* Import from Favorites Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              {t('channel.importFavoritesTitle')}
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-gray-400">
            {t('channel.importFavoritesDesc')}
          </p>

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {loadingFavorites ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : favoritePrompts.length === 0 ? (
              <div className="text-center py-8 text-zinc-500">
                <Star className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{t('channel.noFavorites')}</p>
                <p className="text-sm">{t('channel.noFavoritesHint')}</p>
              </div>
            ) : (
              favoritePrompts.map(template => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleImportFromFavorite(template)}
                  className="w-full p-3 text-left rounded-lg border border-zinc-700 hover:border-yellow-500/50 hover:bg-zinc-800/50 transition-all"
                >
                  <div className="font-medium text-white">{template.name}</div>
                  {template.description && (
                    <div className="text-sm text-zinc-400 line-clamp-1 mt-0.5">{template.description}</div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">
                      {{ sora2: 'Sora2', 'sora2-vidgo': 'Sora2 Vidgo', kling: 'Kling', 'kie-grok-10s': 'Grok 10s', 'kie-grok-10s-extend': 'Grok Extend (20s)' }[template.platform] || template.platform}
                    </Badge>
                    {template.variables?.length > 0 && (
                      <Badge variant="outline" className="text-xs text-[#FFB300] border-[#FFB300]/30">
                        {template.variables.length} {t('channel.variablesLabel')}
                      </Badge>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Prompt Library Dialog */}
      <Dialog open={promptLibraryOpen} onOpenChange={(open) => { setPromptLibraryOpen(open); if (!open) { setLibrarySearch(''); setLibraryFilter('all'); } }}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0">
          <div className="p-4 pb-3 border-b border-zinc-800 space-y-3">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[#FFB300]" />
                Prompt Library
              </DialogTitle>
            </DialogHeader>
            <Input
              placeholder="ค้นหา Prompt..."
              value={librarySearch}
              onChange={(e) => setLibrarySearch(e.target.value)}
              className="bg-gray-900/50 border-gray-700"
            />
            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
              {([
                { key: 'all', label: 'ทั้งหมด' },
                { key: 'grok10s', label: 'Grok 10s' },
                { key: 'grok-extend', label: 'Grok Extend (20s)' },
                { key: 'sora2', label: 'Sora2' },
                { key: 'veo', label: 'Veo' },
                { key: 'favorite', label: `ชื่นชอบ (${libraryFavorites.length})` },
                { key: 'custom', label: 'กำหนดเอง' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setLibraryFilter(key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    libraryFilter === key
                      ? 'bg-[#FFB300] text-black border-[#FFB300]'
                      : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-y-auto flex-1 p-4">
            {loadingLibrary ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (() => {
              const sourceList = libraryFilter === 'favorite'
                ? libraryFavorites
                : libraryFilter === 'custom'
                  ? libraryCustom
                  : promptLibraryTemplates;
              const filtered = sourceList.filter(t => {
                const matchSearch = !librarySearch ||
                  t.name?.toLowerCase().includes(librarySearch.toLowerCase()) ||
                  t.description?.toLowerCase().includes(librarySearch.toLowerCase());
                const matchFilter = libraryFilter === 'all' || libraryFilter === 'favorite' || libraryFilter === 'custom' ||
                  (libraryFilter === 'sora2' && (t.platform === 'sora2' || t.platform === 'sora2-vidgo' || t.platform === 'sora2-grsai')) ||
                  (libraryFilter === 'veo' && (t.platform === 'veo' || t.platform === 'veo3')) ||
                  (libraryFilter === 'grok10s' && t.platform === 'kie-grok-10s') ||
                  (libraryFilter === 'grok-extend' && t.platform === 'kie-grok-10s-extend');
                return matchSearch && matchFilter;
              });
              if (filtered.length === 0) {
                return (
                  <div className="text-center py-12 text-zinc-500">
                    <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>ไม่พบ template</p>
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {filtered.map(template => {
                    let thumbSrc: string | null = null;
                    let videoUrl = template.youtube_url || template.sora_url || template.grok_url || '';
                    // Convert Grok URL to direct video
                    const grokMatch = videoUrl.match(/grok\.com\/imagine\/post\/([a-f0-9-]+)/);
                    if (grokMatch) videoUrl = `https://imagine-public.x.ai/imagine-public/share-videos/${grokMatch[1]}.mp4`;
                    const ytMatch = videoUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^?&\s]+)/);
                    if (ytMatch?.[1]) {
                      thumbSrc = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
                    }
                    if (!thumbSrc) {
                      thumbSrc = template.thumbnail_url?.trim() || null;
                    }

                    const locked = !isYearly && !!template.yearly_only;
                    return (
                      <div
                        key={template.id}
                        className="text-left rounded-lg border border-zinc-700 overflow-hidden hover:border-[#FFB300]/50 hover:shadow-lg hover:shadow-[#FFB300]/10 transition-all group relative"
                      >
                        {/* Video Preview */}
                        <div className="relative">
                          <LibraryVideoPreview videoUrl={videoUrl} ytId={ytMatch?.[1] || null} thumbSrc={thumbSrc} name={template.name} />
                          {locked && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20 pointer-events-none">
                              <Lock className="h-7 w-7 text-yellow-400" />
                            </div>
                          )}
                        </div>
                        {/* Info */}
                        <div className="p-2 space-y-1.5">
                          <h3 className="font-semibold text-xs truncate">{template.name}</h3>
                          <div className="flex items-center gap-1 flex-wrap">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-[#FFB300]/40 text-[#FFB300]">
                              {{ sora2: 'Sora2', 'sora2-vidgo': 'Sora2 Vidgo', kling: 'Kling', 'kie-grok-10s': 'Grok 10s', 'kie-grok-10s-extend': 'Grok Extend (20s)' }[template.platform] || template.platform}
                            </Badge>
                            {template.times_used > 0 && (
                              <span className="text-[10px] text-muted-foreground">ใช้แล้ว {template.times_used} ครั้ง</span>
                            )}
                          </div>
                          {locked && (
                            <span className="text-[10px] text-yellow-400 font-semibold">🔒 สำหรับแพ็กรายปี</span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (locked) {
                                toast.error('ต้องสมัครรายปีเท่านั้นถึงจะใช้ได้');
                                return;
                              }
                              handleImportFromLibrary(template);
                            }}
                            disabled={locked}
                            className={`w-full text-center py-1 rounded text-[11px] font-semibold transition-colors ${
                              locked
                                ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                                : 'bg-[#FFB300] group-hover:bg-[#FF9500] text-black cursor-pointer'
                            }`}
                          >
                            {locked ? 'ล็อค' : 'ใช้ Prompt →'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Late Profile Dialog */}
      <Dialog open={addLateProfileDialogOpen} onOpenChange={setAddLateProfileDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Facebook className="h-5 w-5 text-blue-500" />
              {t('channelForm.addFbAdmin')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new_display_name">{t('channelForm.nameLabel')}</Label>
              <Input
                id="new_display_name"
                value={newLateProfile.display_name}
                onChange={(e) => setNewLateProfile(prev => ({ ...prev, display_name: e.target.value }))}
                placeholder={t('channelForm.nameExample')}
                className="bg-gray-900/50 border-gray-700"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('channelForm.profilePic')}</Label>
              <div className="flex items-center gap-3">
                {newLateProfile.avatar_url ? (
                  <img
                    src={newLateProfile.avatar_url}
                    alt="Preview"
                    className="w-16 h-16 rounded-full object-cover border-2 border-gray-700"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gray-800 border-2 border-dashed border-gray-600 flex items-center justify-center">
                    <Upload className="h-6 w-6 text-gray-500" />
                  </div>
                )}
                <div className="flex-1 space-y-2">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                      disabled={uploadingAvatar}
                    />
                    <div className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-md border border-gray-600 transition-colors">
                      {uploadingAvatar ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t('channelForm.uploading')}
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" />
                          {t('channelForm.selectImage')}
                        </>
                      )}
                    </div>
                  </label>
                  <p className="text-[10px] text-muted-foreground">{t('channelForm.imageHint')}</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddLateProfileDialogOpen(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                onClick={handleSaveLateProfile}
                disabled={savingLateProfile || !newLateProfile.display_name.trim()}
                className="bg-[#FFB300] hover:bg-[#FFC233] text-black"
              >
                {savingLateProfile ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t('channelForm.saving')}
                  </>
                ) : (
                  t('common.save')
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Per-scene reference image gallery (Viral Template ref images in Channel form) */}
      {refImageGallery && (
        <IdolImageGallery
          open={!!refImageGallery}
          onClose={() => setRefImageGallery(null)}
          title={
            refImageGallery.mode === 'idol'
              ? 'เลือกรูปตัวละคร'
              : refImageGallery.mode === 'outfit'
                ? 'เลือกรูปชุด'
                : 'เลือกรูป Background'
          }
          category={refImageGallery.mode}
          onSelect={(url) => {
            const { spIdx, sceneIdx, mode } = refImageGallery;
            const totalScenes = aiPromptTemplates[spIdx]?.scenes_per_video ?? 3;
            setRefImageGallery(null);
            // 1 ฉาก → save ตรงๆ ไม่ต้องถาม
            if (totalScenes <= 1) {
              const baseKey = mode === 'idol' ? 'character_image' : mode === 'outfit' ? 'outfit_image' : 'background_image';
              const key = `${baseKey}_${sceneIdx}`;
              setAiPromptTemplates(prev => prev.map((t, i) => {
                if (i !== spIdx) return t;
                return { ...t, reference_images: { ...(t.reference_images || {}), [key]: url } };
              }));
              return;
            }
            // หลายฉาก → ถาม scope ก่อน
            setRefScopeDialog({ spIdx, sceneIdx, mode, url, totalScenes });
          }}
        />
      )}

      {/* Scope dialog — ถามว่าใช้รูปนี้กับฉากไหนบ้าง */}
      {refScopeDialog && (
        <ChannelSceneScopeDialog
          open={!!refScopeDialog}
          onClose={() => setRefScopeDialog(null)}
          pickedUrl={refScopeDialog.url}
          pickedSceneIdx={refScopeDialog.sceneIdx}
          totalScenes={refScopeDialog.totalScenes}
          onConfirm={(sceneIndices) => {
            const { spIdx, mode, url } = refScopeDialog;
            const baseKey = mode === 'idol' ? 'character_image' : mode === 'outfit' ? 'outfit_image' : 'background_image';
            setAiPromptTemplates(prev => prev.map((t, i) => {
              if (i !== spIdx) return t;
              const next = { ...(t.reference_images || {}) };
              for (const idx of sceneIndices) next[`${baseKey}_${idx}`] = url;
              return { ...t, reference_images: next };
            }));
            setRefScopeDialog(null);
          }}
        />
      )}
    </Dialog>
  );
};

export default ChannelForm;
