import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IdolJobSection } from '@/components/idol/IdolJobSection';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScheduler } from '@/contexts/SchedulerContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { IdolTemplate, IdolTemplateJob, IdolCustomPrompt } from '@/types/idolTemplate';

function VideoPreview({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [muted, setMuted] = useState(false);

  const iframeSrc = (() => {
    let s = url.replace('mute=1', 'mute=0').replace('controls=0', 'controls=1');
    if (!s.includes('enablejsapi=1')) s += '&enablejsapi=1';
    const origin = encodeURIComponent(window.location.origin);
    if (!s.includes('origin=')) s += `&origin=${origin}`;
    return s;
  })();

  const sendYTCommand = useCallback((func: string) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func, args: [] }),
        'https://www.youtube.com'
      );
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { sendYTCommand('unMute'); setMuted(false); }
        else { sendYTCommand('mute'); setMuted(true); }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [sendYTCommand]);

  return (
    <div ref={containerRef} className="w-full aspect-video rounded-lg overflow-hidden bg-black relative">
      <iframe ref={iframeRef} src={iframeSrc} className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
    </div>
  );
}

export default function IdolTemplateDetail() {
  const { templateSlug } = useParams<{ templateSlug: string }>();
  const [searchParams] = useSearchParams();
  const customPromptId = searchParams.get('cp');
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { channels, fetchChannels } = useScheduler();
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const isYearly = user?.isAdmin || subscription?.planType === 'yearly';

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

  const [template, setTemplate] = useState<IdolTemplate | null>(null);
  const [customPrompt, setCustomPrompt] = useState<IdolCustomPrompt | null>(null);
  const [channelId, setChannelId] = useState<string>('');
  const [language, setLanguage] = useState<string>('th');
  // Idol defaults to 1 scene, but a template/custom-prompt's `fixed_scenes` (or
  // a non-default `field_config.default_scenes`) can override that on load —
  // hence the setter.
  const [scenesPerVideo, setScenesPerVideo] = useState<number>(1);
  const [duration, setDuration] = useState<number>(10);
  const [numberOfVideos, setNumberOfVideos] = useState<number>(1);
  const [jobs, setJobs] = useState<IdolTemplateJob[]>([]);
  const [creating, setCreating] = useState(false);

  // Derive display config from custom prompt or template
  const displayName = customPrompt?.name || template?.name || '';
  const displayYoutube = customPrompt?.youtube_url || template?.preview_video_url || '';
  const fieldConfig = customPrompt?.field_config || template?.field_config;
  const fixedScenes = customPrompt?.fixed_scenes || template?.fixed_scenes;
  const templateVars = customPrompt?.template_variables || template?.template_variables;

  // Load custom prompt if cp query param exists
  useEffect(() => {
    if (!customPromptId) return;
    api.getAllIdolCustomPrompts().then((prompts: IdolCustomPrompt[]) => {
      const found = prompts.find(p => p.id === parseInt(customPromptId));
      if (found) {
        setCustomPrompt(found);
        if (found.fixed_scenes) setScenesPerVideo(found.fixed_scenes);
      }
    }).catch(console.error);
  }, [customPromptId]);

  // Load template (skip if using custom prompt with no real template)
  useEffect(() => {
    if (!templateSlug || templateSlug === 'custom') return;
    api.getIdolTemplate(templateSlug).then((t: any) => {
      setTemplate(t);
      if (!customPromptId) {
        if (t.fixed_scenes) {
          setScenesPerVideo(t.fixed_scenes);
        } else if (t.field_config?.show_scenes === false && t.field_config?.default_scenes) {
          setScenesPerVideo(t.field_config.default_scenes);
        }
      }
    }).catch(console.error);
  }, [templateSlug, customPromptId]);

  // Block monthly users from accessing yearly_only templates
  useEffect(() => {
    if (template && template.yearly_only && !isYearly) {
      toast.error('ต้องสมัครรายปีเท่านั้นถึงจะใช้ได้');
      navigate('/app');
    }
  }, [template, isYearly, navigate]);

  // Load all existing jobs for this template (filtered by custom_prompt_id if applicable)
  useEffect(() => {
    if (!templateSlug) return;
    api.getIdolJobs().then((allJobs: IdolTemplateJob[]) => {
      setJobs(allJobs.filter(j => {
        if (j.template_slug !== templateSlug) return false;
        if (customPromptId) return j.custom_prompt_id === parseInt(customPromptId);
        return !j.custom_prompt_id;
      }));
    }).catch(console.error);
  }, [templateSlug, customPromptId]);

  const handleCreateTasks = async () => {
    if (!templateSlug) return;
    setCreating(true);
    try {
      const hasVars = templateVars && templateVars.length > 0;
      const inputMode = template?.input_mode;
      const taskList = Array.from({ length: numberOfVideos }, () => ({
        character_name: '',
        ...(inputMode === 'multi' && !hasVars ? { character_names: Array(scenesPerVideo).fill('') } : {}),
        ...(hasVars ? { task_variables: {} } : {}),
      }));

      const newJob = await api.createIdolJob({
        template_slug: templateSlug,
        channel_id: channelId ? parseInt(channelId) : null,
        language,
        scenes_per_video: 1, // Idol = always 1 scene
        duration,
        tasks: taskList,
        ...(customPrompt?.prompt_text ? { custom_system_prompt: customPrompt.prompt_text } : {}),
        ...(customPromptId ? { custom_prompt_id: parseInt(customPromptId) } : {}),
      });

      setJobs(prev => [newJob, ...prev]);
      toast.success(`สร้าง ${numberOfVideos} tasks สำเร็จ`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create tasks');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteJob = (jobId: number) => {
    setJobs(prev => prev.filter(j => j.id !== jobId));
  };

  const getChannelName = (chId: number | null) => {
    if (!chId) return '-';
    return channels.find(c => c.id === chId)?.name || '-';
  };

  // Build YouTube embed URL for custom prompt
  const getPreviewUrl = () => {
    if (!displayYoutube) return '';
    // If it's already an embed URL, return as-is
    if (displayYoutube.includes('/embed/')) return displayYoutube;
    // Extract video ID and build embed URL
    const match = displayYoutube.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([^&?/]+)/);
    if (!match) return '';
    return `https://www.youtube.com/embed/${match[1]}?autoplay=1&mute=0&controls=1&enablejsapi=1`;
  };

  const previewUrl = getPreviewUrl();

  return (
    <div className="page-wrapper max-w-5xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/idol-templates')} className="text-zinc-400 hover:text-white">
          <ArrowLeft className="h-4 w-4 mr-1" />
          {t('idol.back')}
        </Button>
        {displayName && (
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-[#FFB300]" />
            <h1 className="text-xl font-bold">{displayName}</h1>
            {customPrompt && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-400 border border-emerald-800">กำหนดเอง</span>
            )}
          </div>
        )}
      </div>

      {/* Video Preview */}
      {previewUrl && <VideoPreview url={previewUrl} />}

      {/* Configuration Form */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-base">{t('idol.selectTemplate')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(fieldConfig?.show_channel !== false) && (
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">{t('idol.selectChannel')}</label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue placeholder={t('idol.selectChannel')} /></SelectTrigger>
                <SelectContent>{channels.map(ch => <SelectItem key={ch.id} value={ch.id.toString()}>{ch.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            )}

            {(fieldConfig?.show_language !== false) && (
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">{t('idol.selectLanguage')}</label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="th">{t('idol.thai')}</SelectItem>
                  <SelectItem value="en">{t('idol.english')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}

            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Duration (วินาที)</label>
              <Select value={duration.toString()} onValueChange={(v) => setDuration(parseInt(v))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 วินาที</SelectItem>
                  <SelectItem value="10">10 วินาที</SelectItem>
                  <SelectItem value="15">15 วินาที</SelectItem>
                  <SelectItem value="20">20 วินาที</SelectItem>
                  <SelectItem value="25">25 วินาที</SelectItem>
                  <SelectItem value="30">30 วินาที</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(fieldConfig?.show_videos !== false) && (
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">{t('idol.numberOfVideos')}</label>
              <Select value={numberOfVideos.toString()} onValueChange={(v) => setNumberOfVideos(parseInt(v))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: 50 }, (_, i) => i + 1).map(n => <SelectItem key={n} value={n.toString()}>{n} VDO</SelectItem>)}</SelectContent>
              </Select>
            </div>
            )}
          </div>

          <Button
            onClick={handleCreateTasks}
            disabled={creating}
            className="bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] text-black font-semibold hover:opacity-90 shadow-lg shadow-[#FFB300]/30"
          >
            {creating ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> กำลังสร้าง...</>
            ) : (
              <><Plus className="h-4 w-4 mr-2" /> {t('idol.createTasks')}</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Job Sections */}
      {jobs.map((job) => (
        <IdolJobSection
          key={job.id}
          job={job}
          channelName={getChannelName(job.channel_id)}
          onDeleteJob={handleDeleteJob}
          templateConfig={{
            input_mode: template?.input_mode,
            input_label: template?.input_label,
            input_placeholder: template?.input_placeholder,
            template_variables: templateVars,
            per_scene_vars: fieldConfig?.per_scene_vars,
          }}
        />
      ))}
    </div>
  );
}
