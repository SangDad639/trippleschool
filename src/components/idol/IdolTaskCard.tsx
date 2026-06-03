import { useState, useEffect } from 'react';
import { Trash2, Play, Loader2, RotateCcw, Eye, ChevronDown, Download, Upload, X, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IdolPipelineStatus } from './IdolPipelineStatus';
import { IdolTaskDetailModal } from './IdolTaskDetailModal';
import { IdolImageGallery } from './IdolImageGallery';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { IdolTemplateTask, TemplateVariable } from '@/types/idolTemplate';

function translateError(error: string): string {
  const lower = error.toLowerCase();
  if ((lower.includes('violated') || lower.includes('violating') || lower.includes('flagged')) && lower.includes('polic')) {
    return 'ถูกบล็อกเพราะผิด Content Policy ลองเปลี่ยนตัวละครหรือ Prompt';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'หมดเวลา กรุณาลองใหม่';
  }
  if (lower.includes('ffmpeg') || lower.includes('concat')) {
    return 'ต่อวิดีโอล้มเหลว กรุณาลองใหม่';
  }
  const imgMatch = error.match(/Image generation failed for (\d+) scene/i);
  if (imgMatch) {
    const isPolicyErr = lower.includes('flagged') || lower.includes('violat') || lower.includes('polic');
    const isCreditErr = lower.includes('credit') && (lower.includes('insufficient') || lower.includes('หมด') || lower.includes('not enough'));
    const suffix = isPolicyErr ? ' (ผิด Content Policy)' : isCreditErr ? ' (KIE Credit หมด)' : '';
    return `สร้างภาพล้มเหลว ${imgMatch[1]} ฉาก${suffix}`;
  }
  const vidMatch = error.match(/Video generation failed for (\d+) scene/i);
  if (vidMatch) {
    const isPolicyErr = lower.includes('flagged') || lower.includes('violat') || lower.includes('polic');
    const isCreditErr = lower.includes('credit') && (lower.includes('insufficient') || lower.includes('หมด') || lower.includes('not enough'));
    const suffix = isPolicyErr ? ' (ผิด Content Policy)' : isCreditErr ? ' (KIE Credit หมด)' : '';
    return `สร้างวิดีโอล้มเหลว ${vidMatch[1]} ฉาก${suffix}`;
  }
  if (lower === 'task failed' || lower === 'failed') {
    return 'การสร้างล้มเหลว กรุณาลองใหม่';
  }
  return `ข้อผิดพลาด: ${error}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

type LogEntry = { time: string; emoji: string; text: string; color: string };

function buildLogEntries(task: IdolTemplateTask): LogEntry[] {
  const entries: LogEntry[] = [];
  if (task.status === 'pending') return entries;

  const startTime = fmtTime(task.created_at);
  const lastTime = fmtTime(task.updated_at);

  // Starting
  entries.push({ time: startTime, emoji: '🚀', text: `Starting: ${task.character_name || 'Task'}`, color: 'text-zinc-300' });

  // AI Prompt
  if (task.ai_prompts && task.ai_prompts.length > 0) {
    entries.push({ time: lastTime, emoji: '✅', text: `AI Prompt สำเร็จ (${task.ai_prompts.length} ฉาก)`, color: 'text-green-400' });
  } else if (task.current_step === 'ai_prompt') {
    entries.push({ time: lastTime, emoji: '🔄', text: 'กำลังสร้าง AI Prompt...', color: 'text-yellow-400' });
  }

  // Images
  for (const img of (task.image_tasks || [])) {
    if (img.status === 'done' && img.image_url) {
      entries.push({ time: lastTime, emoji: '🖼️', text: `ฉาก ${img.scene} สร้างภาพสำเร็จ`, color: 'text-green-400' });
    } else if (img.status === 'failed') {
      const isPolicyErr = task.error && (task.error.toLowerCase().includes('flagged') || task.error.toLowerCase().includes('violat') || task.error.toLowerCase().includes('polic'));
      entries.push({ time: lastTime, emoji: '❌', text: `ฉาก ${img.scene} ภาพล้มเหลว${isPolicyErr ? ': ผิด Content Policy' : ''}`, color: 'text-red-400' });
    } else if (task.current_step === 'image_gen' && img.status === 'pending') {
      entries.push({ time: lastTime, emoji: '🔄', text: `ฉาก ${img.scene} กำลังสร้างภาพ...`, color: 'text-yellow-400' });
    }
  }

  // Videos
  for (const vid of (task.video_tasks || [])) {
    if (vid.status === 'done' && vid.video_url) {
      entries.push({ time: lastTime, emoji: '🎬', text: `ฉาก ${vid.scene} สร้าง VDO สำเร็จ`, color: 'text-green-400' });
    } else if (vid.status === 'failed') {
      const isPolicyErr = task.error && (task.error.toLowerCase().includes('flagged') || task.error.toLowerCase().includes('violat') || task.error.toLowerCase().includes('polic'));
      entries.push({ time: lastTime, emoji: '❌', text: `ฉาก ${vid.scene} VDO ล้มเหลว${isPolicyErr ? ': ผิด Content Policy' : ''}`, color: 'text-red-400' });
    } else if (task.current_step === 'video_gen' && vid.status === 'pending') {
      entries.push({ time: lastTime, emoji: '🔄', text: `ฉาก ${vid.scene} กำลังสร้าง VDO...`, color: 'text-yellow-400' });
    }
  }

  // Concat
  if (task.final_video_url) {
    entries.push({ time: lastTime, emoji: '✅', text: 'ต่อ VDO สำเร็จ', color: 'text-green-400' });
  } else if (task.current_step === 'concat') {
    entries.push({ time: lastTime, emoji: '🔄', text: 'กำลังต่อ VDO...', color: 'text-yellow-400' });
  }

  // Final status
  if (task.status === 'done') {
    entries.push({ time: lastTime, emoji: '🎉', text: 'เสร็จสมบูรณ์!', color: 'text-green-300' });
  } else if (task.status === 'failed' && task.error) {
    entries.push({ time: lastTime, emoji: '💥', text: translateError(task.error), color: 'text-red-400' });
  }

  return entries;
}

interface IdolTaskCardProps {
  task: IdolTemplateTask;
  onGenerate: (taskId: number, characterName: string, characterNames?: string[], taskVariables?: Record<string, any>) => void;
  onDelete: (taskId: number) => void;
  onCharacterChange: (taskId: number, name: string, characterNames?: string[], taskVariables?: Record<string, any>) => void;
  generating: boolean;
  inputMode?: 'single' | 'multi';
  scenesPerVideo?: number;
  inputLabel?: string;
  inputPlaceholder?: string;
  templateVariables?: TemplateVariable[];
  perSceneVars?: boolean;
}

export function IdolTaskCard({ task, onGenerate, onDelete, onCharacterChange, generating, inputMode, scenesPerVideo, inputLabel, inputPlaceholder, templateVariables, perSceneVars }: IdolTaskCardProps) {
  const { t } = useLanguage();
  const [localVars, setLocalVars] = useState<Record<string, string | string[]>>(
    task.task_variables || {}
  );
  useEffect(() => {
    setLocalVars(task.task_variables || {});
  }, [task.task_variables]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState<'idol' | 'outfit' | 'background' | null>(null);
  const [bgMode, setBgMode] = useState<'image' | 'text'>(
    (task.task_variables?.['background_image']) ? 'image' : 'text'
  );

  const isActive = ['prompt_generating', 'image_generating', 'video_generating', 'concatenating'].includes(task.status);
  const hasMedia = (task.image_tasks?.some(t => t.image_url)) || (task.video_tasks?.some(t => t.video_url)) || !!task.final_video_url;
  const canGenerate = task.status === 'pending' || task.status === 'failed';

  // Use real logs from DB
  const logEntries = (task.logs || []).map(log => ({
    time: fmtTime(log.time),
    emoji: log.emoji,
    text: log.text,
    color: log.emoji === '✅' || log.emoji === '🎬' || log.emoji === '🎉' ? 'text-green-400' :
           log.emoji === '❌' || log.emoji === '💥' ? 'text-red-400' :
           log.emoji === '🔄' ? 'text-yellow-400' :
           log.emoji === '⏭️' ? 'text-blue-400' : 'text-zinc-300'
  }));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3 min-w-[280px] w-[280px] flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300">
          {t('idol.task')} #{task.task_index + 1}
        </span>
        <div className="flex items-center gap-1">
          {task.status === 'done' && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-900/30 text-green-400">
              {t('idol.done')}
            </span>
          )}
          {task.status === 'failed' && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-900/30 text-red-400">
              {t('idol.failed')}
            </span>
          )}
          {isActive && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-900/30 text-yellow-400 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('idol.generating')}
            </span>
          )}
        </div>
      </div>

      {/* Image Selection Fields — click to open Gallery */}
      <div className="grid grid-cols-2 gap-2">
        {/* Field 1: รูป Idol */}
        <div>
          <label className="text-[10px] text-zinc-400 block mb-1">รูป Idol</label>
          <div
            onClick={() => !isActive && setGalleryOpen('idol')}
            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-2 cursor-pointer transition-colors min-h-[100px] ${
              localVars['idol_image'] ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
            }`}
          >
            {localVars['idol_image'] ? (
              <>
                <img src={localVars['idol_image'] as string} alt="Idol" className="h-16 w-auto rounded object-cover" />
                <button onClick={(e) => { e.stopPropagation(); const u = { ...localVars }; delete u['idol_image']; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
                  className="absolute top-1 right-1 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"><X className="h-3 w-3 text-zinc-400 hover:text-red-400" /></button>
              </>
            ) : (
              <><ImageIcon className="h-6 w-6 text-zinc-600 mb-1" /><span className="text-[10px] text-zinc-500">เลือกรูป</span></>
            )}
          </div>
        </div>

        {/* Field 2: รูปชุด (Outfit) */}
        <div>
          <label className="text-[10px] text-zinc-400 block mb-1">รูปชุด (Outfit - ไม่บังคับ)</label>
          <div
            onClick={() => !isActive && setGalleryOpen('outfit')}
            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-2 cursor-pointer transition-colors min-h-[100px] ${
              localVars['outfit_image'] ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
            }`}
          >
            {localVars['outfit_image'] ? (
              <>
                <img src={localVars['outfit_image'] as string} alt="Outfit" className="h-16 w-auto rounded object-cover" />
                <button onClick={(e) => { e.stopPropagation(); const u = { ...localVars }; delete u['outfit_image']; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
                  className="absolute top-1 right-1 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"><X className="h-3 w-3 text-zinc-400 hover:text-red-400" /></button>
              </>
            ) : (
              <><Upload className="h-6 w-6 text-zinc-600 mb-1" /><span className="text-[10px] text-zinc-500">เลือกรูป</span></>
            )}
          </div>
        </div>
      </div>

      {/* Background Field (optional) */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-zinc-400">Background (ไม่บังคับ)</label>
          <div className="flex gap-1">
            <button onClick={() => setBgMode('image')}
              className={`text-[9px] px-1.5 py-0.5 rounded ${bgMode === 'image' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>รูป</button>
            <button onClick={() => setBgMode('text')}
              className={`text-[9px] px-1.5 py-0.5 rounded ${bgMode === 'text' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>ข้อความ</button>
          </div>
        </div>
        {bgMode === 'image' ? (
          <div
            onClick={() => !isActive && setGalleryOpen('background')}
            className={`relative flex items-center justify-center rounded-lg border-2 border-dashed p-2 cursor-pointer transition-colors h-[60px] ${
              localVars['background_image'] ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
            }`}
          >
            {localVars['background_image'] ? (
              <>
                <img src={localVars['background_image'] as string} alt="BG" className="h-10 w-auto rounded object-cover" />
                <button onClick={(e) => { e.stopPropagation(); const u = { ...localVars }; delete u['background_image']; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
                  className="absolute top-1 right-1 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"><X className="h-3 w-3 text-zinc-400 hover:text-red-400" /></button>
              </>
            ) : (
              <span className="text-[10px] text-zinc-500">เลือกรูป Background</span>
            )}
          </div>
        ) : (
          <input type="text"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
            placeholder="เช่น ชายหาด, ห้องสตูดิโอ, ป่าสน..."
            value={(localVars['background_text'] as string) || ''}
            disabled={isActive}
            onChange={(e) => { const u = { ...localVars, background_text: e.target.value }; delete u['background_image']; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
          />
        )}
      </div>

      {/* Gallery Modal */}
      <IdolImageGallery
        open={galleryOpen !== null}
        onClose={() => setGalleryOpen(null)}
        title={galleryOpen === 'idol' ? 'เลือกรูป Idol' : galleryOpen === 'outfit' ? 'เลือกรูปชุด' : 'เลือกรูป Background'}
        category={galleryOpen || undefined}
        onSelect={(url) => {
          const key = galleryOpen === 'idol' ? 'idol_image' : galleryOpen === 'outfit' ? 'outfit_image' : 'background_image';
          const updated = { ...localVars, [key]: url };
          if (key === 'background_image') delete updated['background_text'];
          setLocalVars(updated);
          onCharacterChange(task.id, '', undefined, updated);
        }}
      />

      {/* Pipeline Status */}
      {task.status !== 'pending' && (
        <IdolPipelineStatus currentStep={task.current_step} taskStatus={task.status} />
      )}

      {/* Error Message */}
      {task.error && (
        <div className="text-xs text-red-400 bg-red-900/20 rounded p-2 break-words">
          {translateError(task.error)}
        </div>
      )}

      {/* Video Preview */}
      {task.final_video_url && (
        <div className="rounded-lg overflow-hidden border border-zinc-700">
          <video
            src={task.final_video_url}
            controls
            className="w-full aspect-[9/16] max-h-[300px] object-contain bg-black"
          />
        </div>
      )}

      {/* Image previews from scenes */}
      {task.image_tasks && task.image_tasks.length > 0 && task.image_tasks.some(it => it.image_url) && !task.final_video_url && (
        <div className="flex gap-1 overflow-x-auto">
          {task.image_tasks.filter(it => it.image_url).map((it, i) => (
            <img
              key={i}
              src={it.image_url!}
              alt={`Scene ${it.scene}`}
              className="h-16 w-auto rounded border border-zinc-700"
            />
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {canGenerate && (
          <Button
            size="sm"
            onClick={() => {
              onGenerate(task.id, '', undefined, localVars);
            }}
            disabled={generating || !localVars['idol_image']}
            className="bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] text-black font-semibold hover:opacity-90"
          >
            {(task.status === 'failed' || hasMedia) ? (
              <><RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry</>
            ) : (
              <><Play className="h-3.5 w-3.5 mr-1" /> {t('idol.generate')}</>
            )}
          </Button>
        )}
        {hasMedia && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDetailOpen(true)}
            className="text-zinc-400 hover:text-[#FFB300]"
          >
            <Eye className="h-3.5 w-3.5 mr-1" /> ดูผลงาน
          </Button>
        )}
        {task.final_video_url && (
          <Button
            size="sm"
            variant="ghost"
            className="text-zinc-400 hover:text-[#FFB300]"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await api.downloadViaProxy(task.final_video_url!, `idol-${task.id}.mp4`);
              } catch (err: any) {
                toast.error(err?.message || 'Download failed');
              }
            }}
          >
            <Download className="h-3.5 w-3.5 mr-1" /> ดาวน์โหลด
          </Button>
        )}
        {!isActive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDelete(task.id)}
            className="text-zinc-500 hover:text-red-400 hover:bg-red-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Terminal-style Log (below actions) */}
      {logEntries.length > 0 && (
        <div>
          <button
            onClick={() => setLogOpen(!logOpen)}
            className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${logOpen ? 'rotate-180' : ''}`} />
            Log
          </button>
          {logOpen && (
            <div className="mt-1.5 bg-[#0d1117] rounded border border-zinc-800 p-2 overflow-y-auto max-h-[250px]">
              {logEntries.map((entry, i) => (
                <div key={i} className="flex items-start gap-1.5 py-[2px] font-mono text-[11px] leading-relaxed">
                  <span className="text-zinc-600 flex-shrink-0 whitespace-nowrap">{entry.time}</span>
                  <span className="flex-shrink-0 w-4 text-center">{entry.emoji}</span>
                  <span className={entry.color}>{entry.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <IdolTaskDetailModal task={task} open={detailOpen} onClose={() => setDetailOpen(false)} />
    </div>
  );
}
