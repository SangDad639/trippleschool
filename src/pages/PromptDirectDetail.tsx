import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PromptDirectJobSection } from '@/components/prompt-direct/PromptDirectJobSection';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScheduler } from '@/contexts/SchedulerContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// Parse video URL into type + embed URL (เหมือน ContentScheduler)
function parseVideoUrl(url: string): { type: 'youtube' | 'sora' | 'direct' | null; embedUrl: string | null; videoId: string | null } {
  if (!url) return { type: null, embedUrl: null, videoId: null };
  if (url.includes('videos.openai.com')) return { type: 'direct', embedUrl: url, videoId: null };
  if (url.includes('imagine-public.x.ai')) return { type: 'direct', embedUrl: url, videoId: null };
  const grokMatch = url.match(/grok\.com\/imagine\/post\/([a-f0-9-]+)/);
  if (grokMatch) return { type: 'direct', embedUrl: `https://imagine-public.x.ai/imagine-public/share-videos/${grokMatch[1]}.mp4`, videoId: null };
  const soraMatch = url.match(/sora\.chatgpt\.com\/p\/(s_[a-zA-Z0-9]+)/);
  if (soraMatch) return { type: 'sora', embedUrl: url, videoId: null };
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#]+)/);
  if (ytMatch) {
    const videoId = ytMatch[1];
    return { type: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&controls=1&enablejsapi=1`, videoId };
  }
  return { type: null, embedUrl: null, videoId: null };
}

// Big video preview — supports YouTube + Direct video (Grok/Sora) + auto-mute
function VideoPreview({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const info = parseVideoUrl(url);

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
        if (info.type === 'youtube') {
          if (entry.isIntersecting) sendYTCommand('unMute');
          else sendYTCommand('mute');
        } else if (videoRef.current) {
          videoRef.current.muted = !entry.isIntersecting;
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [sendYTCommand, info.type]);

  if (!info.embedUrl) return null;

  return (
    <div ref={containerRef} className="w-full aspect-video rounded-lg overflow-hidden bg-black relative">
      {info.type === 'youtube' ? (
        <iframe ref={iframeRef} src={info.embedUrl} className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      ) : info.type === 'direct' ? (
        <video ref={videoRef} src={info.embedUrl} className="w-full h-full object-contain" autoPlay loop controls muted={false} playsInline />
      ) : info.type === 'sora' ? (
        <a href={info.embedUrl} target="_blank" rel="noopener noreferrer" className="w-full h-full flex items-center justify-center text-zinc-400 hover:text-[#FFB300]">
          เปิดวิดีโอใน Sora
        </a>
      ) : null}
    </div>
  );
}

export default function PromptDirectDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { channels, fetchChannels } = useScheduler();
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const isYearly = user?.isAdmin || subscription?.planType === 'yearly';

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

  const [prompt, setPrompt] = useState<any>(null);
  const [channelId, setChannelId] = useState<string>('');
  const [language, setLanguage] = useState<string>('th');
  const [numberOfVideos, setNumberOfVideos] = useState<number>(1);
  const [jobs, setJobs] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  // Load prompt
  useEffect(() => {
    if (!slug) return;
    api.getPromptTemplate(slug).then((p: any) => setPrompt(p)).catch(() => toast.error('Prompt not found'));
  }, [slug]);

  // Block yearly-only
  useEffect(() => {
    if (prompt && prompt.yearly_only && !isYearly) {
      toast.error('ต้องสมัครรายปีเท่านั้นถึงจะใช้ได้');
      navigate('/app');
    }
  }, [prompt, isYearly, navigate]);

  // Load existing jobs
  useEffect(() => {
    if (!prompt?.id) return;
    api.getPromptDirectJobs(prompt.id).then((allJobs: any) => {
      setJobs(Array.isArray(allJobs) ? allJobs : []);
    }).catch(console.error);
  }, [prompt?.id]);

  const handleCreateTasks = async () => {
    if (!prompt) return;
    setCreating(true);
    try {
      const newJob = await api.createPromptDirectJob({
        prompt_library_id: prompt.id,
        channel_id: channelId ? parseInt(channelId) : null,
        number_of_videos: numberOfVideos,
        language,
      });
      setJobs(prev => [newJob, ...prev]);
      toast.success(`สร้าง ${numberOfVideos} tasks สำเร็จ`);
    } catch (err: any) {
      toast.error(err.message || 'Failed');
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

  // Combine variables + extend_variables (unique by name)
  const promptVariables = (() => {
    if (!prompt) return [];
    const main = prompt.variables || [];
    const extend = prompt.extend_variables || [];
    const merged: any[] = [...main];
    for (const ev of extend) {
      if (!merged.some((m) => m.name === ev.name)) merged.push(ev);
    }
    return merged;
  })();

  // Pass raw URL — VideoPreview parses it (YouTube/Grok/Sora/Direct)
  const previewUrl = prompt ? (prompt.youtube_url || prompt.sora_url || prompt.grok_url || '') : '';
  const hasExtend = !!(prompt?.extend_prompt_template?.trim());

  return (
    <div className="page-wrapper max-w-5xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/prompts')} className="text-zinc-400 hover:text-white">
          <ArrowLeft className="h-4 w-4 mr-1" />
          {t('viral.back')}
        </Button>
        {prompt && (
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-[#FFB300]" />
            <h1 className="text-xl font-bold">{prompt.name}</h1>
            {prompt.platform && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase">
                {prompt.platform}
              </span>
            )}
            {hasExtend && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-400 border border-purple-800">
                Extend
              </span>
            )}
          </div>
        )}
      </div>

      {/* Big Video Preview */}
      {previewUrl && <VideoPreview url={previewUrl} />}

      {/* Configuration Form */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-base">{t('viral.selectTemplate')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">{t('viral.selectChannel')}</label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue placeholder={t('viral.selectChannel')} />
                </SelectTrigger>
                <SelectContent>
                  {channels.map(ch => <SelectItem key={ch.id} value={ch.id.toString()}>{ch.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-zinc-500 mb-1 block">{t('viral.selectLanguage')}</label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="th">{t('viral.thai')}</SelectItem>
                  <SelectItem value="en">{t('viral.english')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-zinc-500 mb-1 block">{t('viral.numberOfVideos')}</label>
              <Select value={numberOfVideos.toString()} onValueChange={(v) => setNumberOfVideos(parseInt(v))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 50 }, (_, i) => i + 1).map(n => (
                    <SelectItem key={n} value={n.toString()}>{n} VDO</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleCreateTasks}
            disabled={creating}
            className="bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] text-black font-semibold hover:opacity-90 shadow-lg shadow-[#FFB300]/30"
          >
            {creating ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> กำลังสร้าง...</>
            ) : (
              <><Plus className="h-4 w-4 mr-2" /> {t('viral.createTasks')}</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Job Sections */}
      {jobs.map((job) => (
        <PromptDirectJobSection
          key={job.id}
          job={job}
          channelName={getChannelName(job.channel_id)}
          variables={promptVariables}
          onDeleteJob={handleDeleteJob}
        />
      ))}
    </div>
  );
}
