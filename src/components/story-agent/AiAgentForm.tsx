/**
 * AI Agent tab — user-facing surface for the 8-stage Reels pipeline.
 *
 * User types a topic + picks duration/tone/language → backend orchestrator
 * walks the job through idea → script → voice → storyboard → scene_image
 * → scene_video → assemble → post.
 *
 * UI auto-polls the active job's status every 5s and shows per-stage progress
 * plus a per-scene grid (image/video/voice status).
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, Video, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Language = 'th' | 'en';

interface Job {
  id: number;
  topic: string;
  duration_sec: number;
  tone: string | null;
  language: string;
  scene_count: number;
  current_stage: string;
  status: string;
  final_video_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface Scene {
  id: number;
  scene_number: number;
  script_text: string;
  panel_desc_th: string | null;
  voice_url: string | null;
  voice_duration: number | null;
  image_url: string | null;
  image_status: string;
  video_url: string | null;
  video_status: string;
  error: string | null;
}

const STAGE_LABELS: Record<string, { th: string; en: string }> = {
  idea: { th: '💡 คิดไอเดีย', en: '💡 Brainstorming' },
  script: { th: '✍️ เขียนบท', en: '✍️ Writing script' },
  voice: { th: '🎙️ พากย์เสียง', en: '🎙️ Generating voice' },
  storyboard: { th: '🎨 ออกแบบสตอรีบอร์ด', en: '🎨 Storyboarding' },
  scene_image: { th: '🖼️ สร้างภาพรายฉาก', en: '🖼️ Scene images' },
  scene_video: { th: '🎬 สร้างวิดีโอรายฉาก', en: '🎬 Scene videos' },
  assemble: { th: '🎞️ ประกอบคลิป', en: '🎞️ Assembling clip' },
  post: { th: '📝 โพสต์', en: '📝 Publishing' },
  done: { th: '✅ เสร็จสมบูรณ์', en: '✅ Done' },
  failed: { th: '❌ ล้มเหลว', en: '❌ Failed' },
};

const TONES_TH = [
  { value: 'dramatic', label: 'ระทึก/ดราม่า' },
  { value: 'inspirational', label: 'สร้างแรงบันดาลใจ' },
  { value: 'mystical', label: 'ลึกลับ/ขลัง' },
  { value: 'humorous', label: 'ตลก/สนุก' },
  { value: 'documentary', label: 'สารคดี/บรรยาย' },
  { value: 'horror', label: 'สยองขวัญ' },
];
const TONES_EN = [
  { value: 'dramatic', label: 'Dramatic' },
  { value: 'inspirational', label: 'Inspirational' },
  { value: 'mystical', label: 'Mystical' },
  { value: 'humorous', label: 'Humorous' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'horror', label: 'Horror' },
];

export function AiAgentForm() {
  const { language } = useLanguage();
  const isTh = language === 'th';

  // Form state
  const [topic, setTopic] = useState('');
  const [durationSec, setDurationSec] = useState(60);
  const [tone, setTone] = useState<string>('dramatic');
  const [clipLanguage, setClipLanguage] = useState<Language>('th');
  const [submitting, setSubmitting] = useState(false);

  // Jobs list
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [activeScenes, setActiveScenes] = useState<Scene[]>([]);

  const sceneCount = useMemo(() => {
    const n = Math.round(durationSec / 6);
    return Math.max(5, Math.min(30, n));
  }, [durationSec]);

  // ----- load history -----
  const loadJobs = async () => {
    setLoadingJobs(true);
    try {
      const res = await api.storyAgentHistory({ limit: 30 });
      setJobs(res.items);
    } catch (err: any) {
      toast.error(err?.message || 'load failed');
    } finally {
      setLoadingJobs(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  // ----- poll active job -----
  useEffect(() => {
    if (!activeJobId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await api.storyAgentStatus(activeJobId);
        if (stopped) return;
        setActiveScenes(res.scenes || []);
        setJobs((prev) =>
          prev.map((j) => (j.id === activeJobId ? { ...j, ...res.job } : j))
        );
        // Stop polling once terminal
        if (res.job.status === 'success' || res.job.status === 'failed') {
          stopped = true;
        }
      } catch {
        /* ignore transient */
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [activeJobId]);

  // ----- submit -----
  const handleSubmit = async () => {
    if (!topic.trim()) {
      toast.error(isTh ? 'กรุณากรอกหัวข้อ' : 'Please enter a topic');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.storyAgentCreate({
        topic: topic.trim(),
        duration_sec: durationSec,
        tone,
        language: clipLanguage,
      });
      toast.success(isTh ? 'เริ่มสร้างคลิปแล้ว' : 'Clip generation started');
      setActiveJobId(res.job.id);
      setTopic('');
      await loadJobs();
    } catch (err: any) {
      toast.error(err?.message || 'submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(isTh ? 'ลบงานนี้?' : 'Delete this job?')) return;
    try {
      await api.storyAgentDelete(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
      if (activeJobId === id) {
        setActiveJobId(null);
        setActiveScenes([]);
      }
    } catch (err: any) {
      toast.error(err?.message || 'delete failed');
    }
  };

  const stageLabel = (stage: string) =>
    STAGE_LABELS[stage]?.[isTh ? 'th' : 'en'] || stage;

  const tones = isTh ? TONES_TH : TONES_EN;

  return (
    <div className="space-y-6">
      {/* Form */}
      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#FFB300]" />
            <h2 className="text-lg font-semibold">
              {isTh ? 'AI Agent — สร้างคลิป Reels อัตโนมัติ 8 ขั้น' : 'AI Agent — Auto Reels Pipeline (8 stages)'}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {isTh
              ? 'พิมพ์หัวข้อ → AI คิดบท + พากย์ + สร้างภาพ + วิดีโอ + ประกอบคลิป + โพสต์ให้อัตโนมัติ'
              : 'Enter a topic → AI writes the script, narrates, generates scene images & videos, assembles, and posts.'}
          </p>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              {isTh ? 'หัวข้อเรื่อง' : 'Topic'}
            </label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={isTh ? 'เช่น ตำนานพระสมเด็จ วัดระฆัง' : 'e.g. The mystery of the Egyptian pyramids'}
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {isTh ? 'ความยาวคลิป' : 'Clip duration'}: <span className="text-[#FFB300]">{durationSec}s</span>{' '}
                <span className="text-xs text-muted-foreground">({sceneCount} {isTh ? 'ฉาก' : 'scenes'})</span>
              </label>
              <Slider
                min={30}
                max={180}
                step={6}
                value={[durationSec]}
                onValueChange={(v) => setDurationSec(v[0])}
                disabled={submitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                {isTh ? 'โทนอารมณ์' : 'Tone'}
              </label>
              <Select value={tone} onValueChange={setTone} disabled={submitting}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tones.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                {isTh ? 'ภาษาคลิป' : 'Clip language'}
              </label>
              <Select
                value={clipLanguage}
                onValueChange={(v) => setClipLanguage(v as Language)}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="th">🇹🇭 ไทย</SelectItem>
                  <SelectItem value="en">🇺🇸 English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleSubmit} disabled={submitting} className="w-full sm:w-auto">
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isTh ? 'กำลังส่ง...' : 'Submitting...'}
              </>
            ) : (
              <>
                <Video className="h-4 w-4 mr-2" />
                {isTh ? 'สร้างคลิป' : 'Generate clip'}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Jobs list */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">
          {isTh ? 'งานล่าสุด' : 'Recent jobs'}
        </h3>
        <Button variant="ghost" size="sm" onClick={loadJobs} disabled={loadingJobs}>
          <RefreshCw className={`h-4 w-4 ${loadingJobs ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {jobs.length === 0 && !loadingJobs ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            {isTh ? 'ยังไม่มีงาน — สร้างคลิปแรกของคุณด้านบน' : 'No jobs yet — create your first clip above'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Card key={job.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setActiveJobId(activeJobId === job.id ? null : job.id)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{job.topic}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-muted">
                        {job.duration_sec}s · {job.scene_count} {isTh ? 'ฉาก' : 'scenes'}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          job.status === 'success'
                            ? 'bg-green-500/20 text-green-400'
                            : job.status === 'failed'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {stageLabel(job.current_stage)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(job.created_at).toLocaleString()}
                    </div>
                    {job.error && (
                      <div className="text-xs text-red-400 mt-1 line-clamp-2">{job.error}</div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(job.id)}
                    className="shrink-0"
                    aria-label="delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Expanded view */}
                {activeJobId === job.id && (
                  <div className="mt-4 space-y-3">
                    {job.final_video_url && (
                      <video
                        controls
                        src={job.final_video_url}
                        className="w-full max-w-md rounded border border-border"
                      />
                    )}

                    {activeScenes.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                        {activeScenes.map((s) => (
                          <div
                            key={s.id}
                            className="border border-border rounded p-2 text-xs space-y-1 bg-muted/30"
                          >
                            <div className="font-mono opacity-60">#{s.scene_number}</div>
                            {s.image_url ? (
                              <img
                                src={s.image_url}
                                alt={`scene ${s.scene_number}`}
                                className="w-full aspect-[9/16] object-cover rounded"
                              />
                            ) : (
                              <div className="w-full aspect-[9/16] bg-muted rounded flex items-center justify-center">
                                <span className="text-[10px] opacity-50">
                                  {statusEmoji(s.image_status)}
                                </span>
                              </div>
                            )}
                            <div className="line-clamp-2 leading-tight">{s.script_text}</div>
                            <div className="flex gap-1 text-[10px]">
                              <span title="voice">{s.voice_url ? '🎙️' : '·'}</span>
                              <span title="image">{statusEmoji(s.image_status)}</span>
                              <span title="video">{statusEmoji(s.video_status)}</span>
                              {s.voice_duration ? (
                                <span className="opacity-60">{s.voice_duration.toFixed(1)}s</span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'success':
      return '✅';
    case 'failed':
      return '❌';
    case 'running':
      return '⏳';
    default:
      return '·';
  }
}
