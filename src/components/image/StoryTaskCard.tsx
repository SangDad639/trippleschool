import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ImageIcon, Play, Trash2, X, Loader2, Lock, RotateCcw, Eye, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ActivityLogPanel,
  getModelConfig,
  newDraft,
  type Aspect,
  type Resolution,
  type TaskDraft,
} from '@/components/image/ImageTaskCard';

// Story-specific task type — extends Image's TaskDraft with Story-only fields.
// Image Template's TaskDraft stays clean; Story owns its own state shape here.
export interface StoryTaskDraft extends TaskDraft {
  mainImage?: string;
  outfitImage?: string;
  outfitText?: string;
  backgroundImage?: string;
  backgroundText?: string;
  objectImage?: string;
  variables?: { name: string; value: string }[];
  videoUrl?: string;
  videoStatus?: 'pending' | 'success' | 'failed';
  currentStep?: 'image_gen' | 'video_gen' | null;
  topic?: string;
}

export interface StoryTaskGroup {
  groupId: string;
  createdAt: number;
  channelId: string;
  tasks: StoryTaskDraft[];
}

export const newStoryDraft = (taskNumber: number, model?: string): StoryTaskDraft => ({
  ...newDraft(taskNumber, model),
});

export type StoryImageSlot = 'main' | 'outfit' | 'background' | 'object';

const SLOT_LABELS: Record<StoryImageSlot, { th: string; en: string; required: boolean }> = {
  main: { th: 'รูป', en: 'Image', required: true },
  outfit: { th: 'รูปชุด', en: 'Outfit', required: false },
  background: { th: 'รูปพื้นหลัง', en: 'Background', required: false },
  object: { th: 'รูป Object', en: 'Object', required: false },
};

const SLOT_FIELD: Record<StoryImageSlot, keyof Pick<StoryTaskDraft, 'mainImage' | 'outfitImage' | 'backgroundImage' | 'objectImage'>> = {
  main: 'mainImage',
  outfit: 'outfitImage',
  background: 'backgroundImage',
  object: 'objectImage',
};

interface StoryTaskCardProps {
  task: StoryTaskDraft;
  index: number;
  language: string;
  onUpdate: (patch: Partial<StoryTaskDraft>) => void;
  onDelete: () => void;
  onGenerate: () => void;
  onPickImage: (slot: StoryImageSlot) => void;
  availableModels?: { key: string; label: string; available: boolean }[];
  isResolutionDisabled: (r: Resolution, aspect: Aspect) => boolean;
  // Wizard mode — 'image-only' shows image slots + delete; 'full' shows everything (default)
  compactMode?: 'image-only' | 'full';
}

export function StoryTaskCard({
  task,
  index,
  language,
  onUpdate,
  onDelete,
  onGenerate,
  onPickImage,
  availableModels,
  isResolutionDisabled,
  compactMode = 'full',
}: StoryTaskCardProps) {
  const l = (th: string, en: string) => (language === 'th' ? th : en);
  const cfg = getModelConfig(task.model);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const isDraft = task.status === 'draft';
  const imageSuccess = task.status === 'success';
  const imageFailed = task.status === 'failed';
  const videoFailed = task.videoStatus === 'failed';
  const videoPending = task.videoStatus === 'pending';
  const videoSuccess = task.videoStatus === 'success';
  // Pending = either image generating, OR image done but video still in progress
  const isPending = task.status === 'pending' || (imageSuccess && videoPending);
  // Success = image done + video done (full pipeline complete)
  const isSuccess = imageSuccess && videoSuccess;
  // Failed = image failed, OR image succeeded but video failed
  const isFailed = imageFailed || (imageSuccess && videoFailed);
  const updateImage = (slot: StoryImageSlot, url: string | undefined) => {
    onUpdate({ [SLOT_FIELD[slot]]: url } as Partial<StoryTaskDraft>);
  };

  const canGenerate = isDraft && !!task.mainImage;

  return (
    <div className="rounded-xl border border-border/60 bg-background/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Task #{index}</h3>
        {isPending && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-[#FFB300]/40 bg-[#FFB300]/10 text-[#FFB300]">
            <Loader2 className="h-3 w-3 animate-spin" />
            {videoPending ? l('สร้างวิดีโอ...', 'Video...') : l('สร้างภาพ...', 'Image...')}
          </span>
        )}
        {isSuccess && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-green-500/40 bg-green-500/10 text-green-500">
            ✓ {l('สำเร็จ', 'Done')}
          </span>
        )}
        {isFailed && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-400">
            ✕ {imageFailed ? l('ภาพล้มเหลว', 'Image failed') : l('วิดีโอล้มเหลว', 'Video failed')}
          </span>
        )}
      </div>

      {isDraft && (
        <>
          {availableModels && availableModels.length > 0 && (
            <div>
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 block">
                {l('Model', 'Model')}
              </label>
              <Select
                value={task.model || availableModels[0]?.key || 'gpt-image-2'}
                onValueChange={(v) => {
                  const next = getModelConfig(v);
                  onUpdate({ model: v, aspect: next.defaultAspect, resolution: next.defaultResolution });
                }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {availableModels.map((m) => (
                    <SelectItem key={m.key} value={m.key} disabled={!m.available}>
                      <span className="flex items-center gap-2">
                        {m.label}
                        {!m.available && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {l('เร็วๆ นี้', 'Coming soon')}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 4 image slots — all image-only (DO NOT TOUCH) */}
          <div className="grid grid-cols-2 gap-2">
            {(['main', 'outfit', 'background', 'object'] as StoryImageSlot[]).map((slot) => {
              const url = task[SLOT_FIELD[slot]];
              const label = SLOT_LABELS[slot];
              return (
                <div key={slot}>
                  <label className="text-[10px] text-muted-foreground block mb-1">
                    {l(label.th, label.en)}
                    {!label.required && (
                      <span className="text-[9px] text-zinc-500 ml-1">{l('(ไม่บังคับ)', '(optional)')}</span>
                    )}
                  </label>
                  <div
                    onClick={() => onPickImage(slot)}
                    className={`relative flex items-center justify-center rounded-lg border-2 border-dashed p-2 cursor-pointer transition-colors min-h-[88px] ${
                      url
                        ? 'border-green-700 bg-green-900/10'
                        : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                    }`}
                  >
                    {url ? (
                      <>
                        <img src={url} alt={label.en} className="h-16 w-auto rounded object-cover" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateImage(slot, undefined);
                          }}
                          className="absolute top-1 right-1 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"
                        >
                          <X className="h-3 w-3 text-zinc-400 hover:text-red-400" />
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <ImageIcon className="h-5 w-5 text-zinc-600" />
                        <span className="text-[10px] text-zinc-500">{l('เลือกรูป', 'Pick image')}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {compactMode === 'full' && (
            <>
              {/* 2 typing fields added below — separate from the grid above */}
              <LockableTextField
                label={l('ค่าชุด', 'Outfit value')}
                optionalLabel={l('(ไม่บังคับ)', '(optional)')}
                placeholder={l('เช่น เดรสยาวสีดำ, ชุดว่ายน้ำ, ยูนิฟอร์ม...', 'e.g. long black dress, swimsuit, uniform...')}
                value={task.outfitText || ''}
                onChange={(v) => onUpdate({ outfitText: v })}
                locked={!!task.outfitImage}
                lockedMessage={l('ไม่สามารถใส่ค่าได้\nเนื่องจากแนบรูปชุดไปแล้ว', 'Cannot type a value\noutfit image already attached')}
              />
              <LockableTextField
                label={l('ค่าพื้นหลัง', 'Background value')}
                optionalLabel={l('(ไม่บังคับ)', '(optional)')}
                placeholder={l('เช่น ชายหาด, ห้องสตูดิโอ, ป่าสน...', 'e.g. beach, studio, pine forest...')}
                value={task.backgroundText || ''}
                onChange={(v) => onUpdate({ backgroundText: v })}
                locked={!!task.backgroundImage}
                lockedMessage={l('ไม่สามารถใส่ค่าได้\nเนื่องจากแนบรูปพื้นหลังไปแล้ว', 'Cannot type a value\nbackground image already attached')}
              />

              {/* Aspect + Resolution */}
              <div className={cfg.showResolution ? 'grid grid-cols-2 gap-2' : ''}>
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 block">
                    {l('สัดส่วน', 'Aspect')}
                  </label>
                  <Select value={task.aspect} onValueChange={(v) => onUpdate({ aspect: v as Aspect })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {cfg.aspects.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {cfg.showResolution && (
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 block">
                      {l('ความละเอียด', 'Resolution')}
                    </label>
                    <Select value={task.resolution} onValueChange={(v) => onUpdate({ resolution: v as Resolution })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {cfg.resolutions.map((r) => (
                          <SelectItem key={r} value={r} disabled={isResolutionDisabled(r, task.aspect)}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Action row */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={onGenerate}
                  disabled={!canGenerate}
                  size="sm"
                  className="bg-gradient-to-r from-[#FFB300] to-[#FF8C00] hover:from-[#FFC533] hover:to-[#FFA033] text-black font-bold h-8 px-4"
                >
                  <Play className="h-3.5 w-3.5 mr-1" />
                  {l('สร้าง', 'Generate')}
                </Button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="h-8 w-8 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {!task.mainImage && (
                <p className="text-[10px] text-zinc-600 italic">
                  {l('* ต้องเลือก "รูป" ก่อนถึงจะสร้างได้', '* Pick "Image" first to enable Generate')}
                </p>
              )}
            </>
          )}

          {compactMode === 'image-only' && (
            <>
              {/* keep value inputs in image-step too — they're alternatives to outfit/background images */}
              <LockableTextField
                label={l('ค่าชุด', 'Outfit value')}
                optionalLabel={l('(ไม่บังคับ)', '(optional)')}
                placeholder={l('เช่น เดรสยาวสีดำ, ชุดว่ายน้ำ, ยูนิฟอร์ม...', 'e.g. long black dress, swimsuit, uniform...')}
                value={task.outfitText || ''}
                onChange={(v) => onUpdate({ outfitText: v })}
                locked={!!task.outfitImage}
                lockedMessage={l('ไม่สามารถใส่ค่าได้\nเนื่องจากแนบรูปชุดไปแล้ว', 'Cannot type a value\noutfit image already attached')}
              />
              <LockableTextField
                label={l('ค่าพื้นหลัง', 'Background value')}
                optionalLabel={l('(ไม่บังคับ)', '(optional)')}
                placeholder={l('เช่น ชายหาด, ห้องสตูดิโอ, ป่าสน...', 'e.g. beach, studio, pine forest...')}
                value={task.backgroundText || ''}
                onChange={(v) => onUpdate({ backgroundText: v })}
                locked={!!task.backgroundImage}
                lockedMessage={l('ไม่สามารถใส่ค่าได้\nเนื่องจากแนบรูปพื้นหลังไปแล้ว', 'Cannot type a value\nbackground image already attached')}
              />
              <div className="flex items-center justify-end pt-1">
                <button
                  type="button"
                  onClick={onDelete}
                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center"
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* Image stage spinner — only while image itself is still generating */}
      {task.status === 'pending' && !task.resultUrl && (
        <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-[#FFB300]" />
          <span>{l('กำลังสร้างภาพ...', 'Generating image...')}</span>
        </div>
      )}

      {/* Image result — show as soon as image is done, regardless of video stage */}
      {imageSuccess && task.resultUrl && (
        <div className="rounded-lg overflow-hidden bg-black/40">
          <img src={task.resultUrl} alt="result" className="block w-full h-auto" />
        </div>
      )}

      {/* Video stage progress + result */}
      {task.videoStatus === 'pending' && (
        <div className="flex items-center gap-2 rounded-lg border border-[#FFB300]/30 bg-[#FFB300]/5 p-2 text-[11px] text-[#FFB300]">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          <span>{l('🎬 กำลังสร้างวิดีโอ...', '🎬 Generating video...')}</span>
        </div>
      )}
      {task.videoStatus === 'success' && task.videoUrl && (
        <video
          src={task.videoUrl}
          controls
          className="block mx-auto max-h-[400px] w-auto rounded-lg bg-black border border-green-500/20"
        />
      )}
      {task.videoStatus === 'failed' && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2">
          <p className="text-xs text-red-400">{l('❌ วิดีโอล้มเหลว', '❌ Video failed')}{task.error ? `: ${task.error}` : ''}</p>
        </div>
      )}

      {/* Failed message */}
      {isFailed && task.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2">
          <p className="text-xs text-red-400">{task.error}</p>
        </div>
      )}

      {/* Show outfit/background text values after generation (read-only) */}
      {!isDraft && (task.outfitText || task.backgroundText) && (
        <div className="space-y-1 pt-1">
          {task.outfitText && (
            <div className="text-[11px]">
              <span className="text-zinc-500">{l('ค่าชุด:', 'Outfit:')}</span>{' '}
              <span className="text-zinc-300">{task.outfitText}</span>
            </div>
          )}
          {task.backgroundText && (
            <div className="text-[11px]">
              <span className="text-zinc-500">{l('ค่าพื้นหลัง:', 'Background:')}</span>{' '}
              <span className="text-zinc-300">{task.backgroundText}</span>
            </div>
          )}
        </div>
      )}

      {!isDraft && (
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            {isFailed && (
              <Button
                size="sm"
                onClick={onGenerate}
                className="bg-gradient-to-r from-[#FFB300] to-[#FF8C00] hover:from-[#FFC533] hover:to-[#FFA033] text-black font-bold h-7 px-3"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                {l('ลองใหม่', 'Retry')}
              </Button>
            )}
            {isSuccess && task.resultUrl && (
              <>
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {l('ดูผลงาน', 'View')}
                </button>
                <a
                  href={task.dropboxUrl || task.resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-[#FFB300] hover:bg-[#FFB300]/10 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  {l('ภาพ', 'Image')}
                </a>
                {task.videoStatus === 'success' && task.videoUrl && (
                  <a
                    href={task.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-[#FFB300] hover:bg-[#FFB300]/10 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {l('วิดีโอ', 'Video')}
                  </a>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Result detail modal — full result + downloads + scene metadata + reference images */}
      {(task.resultUrl || task.videoUrl) && (() => {
        const findVar = (key: string) => (task.variables || []).find((v) => v.name === key)?.value || '';
        const sceneName = findVar('scene_name');
        const dialogue = findVar('dialogue');
        const emotion = findVar('emotion');
        const visual = findVar('visual');
        return (
          <Dialog open={lightboxOpen} onOpenChange={(v) => !v && setLightboxOpen(false)}>
            <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto bg-zinc-950 border-zinc-800 p-0">
              {/* Header */}
              <DialogHeader className="px-6 pt-5 pb-4 border-b border-zinc-800/80 sticky top-0 bg-zinc-950/95 backdrop-blur-sm z-10">
                <DialogTitle className="text-base flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center justify-center min-w-[2.5rem] h-7 px-2 rounded-md bg-[#FFB300]/15 text-[#FFB300] text-sm font-bold">
                    #{index}
                  </span>
                  {sceneName && (
                    <span className="text-base font-semibold text-zinc-100">{sceneName}</span>
                  )}
                  {emotion && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#FFB300]/10 text-[#FFB300] border border-[#FFB300]/20 font-medium">
                      {emotion}
                    </span>
                  )}
                </DialogTitle>
              </DialogHeader>

              <div className="px-6 py-5 space-y-5">
                {/* Video result */}
                {task.videoUrl && (
                  <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60">
                      <h3 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                        <span className="text-base">🎬</span>
                        {l('วิดีโอผลลัพธ์', 'Video Result')}
                      </h3>
                      <a
                        href={task.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-[#FFB300]/10 text-[#FFB300] hover:bg-[#FFB300]/20 transition-colors font-medium"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {l('ดาวน์โหลด', 'Download')}
                      </a>
                    </div>
                    <div className="p-4 flex items-center justify-center bg-black/40">
                      <video
                        src={task.videoUrl}
                        controls
                        className="block max-h-[65vh] w-auto rounded-md bg-black"
                      />
                    </div>
                  </section>
                )}

                {/* Image result */}
                {task.resultUrl && (
                  <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60">
                      <h3 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                        <span className="text-base">🖼️</span>
                        {l('ภาพผลลัพธ์', 'Image Result')}
                      </h3>
                      <a
                        href={task.dropboxUrl || task.resultUrl}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-[#FFB300]/10 text-[#FFB300] hover:bg-[#FFB300]/20 transition-colors font-medium"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {l('ดาวน์โหลด', 'Download')}
                      </a>
                    </div>
                    <div className="p-4 flex items-center justify-center bg-black/40">
                      <img
                        src={task.resultUrl}
                        alt={task.prompt || 'result'}
                        className="block w-auto h-auto max-w-full max-h-[60vh] object-contain rounded-md"
                      />
                    </div>
                  </section>
                )}
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Activity log — collapsible (shows for any task that has logged events) */}
      {task.logs && task.logs.length > 0 && <ActivityLogPanel logs={task.logs} />}
    </div>
  );
}

export default StoryTaskCard;

interface LockableTextFieldProps {
  label: string;
  optionalLabel: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  locked: boolean;
  lockedMessage: string;
}

function LockableTextField({
  label,
  optionalLabel,
  placeholder,
  value,
  onChange,
  locked,
  lockedMessage,
}: LockableTextFieldProps) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground block mb-1">
        {label} <span className="text-[9px] text-zinc-500">{optionalLabel}</span>
      </label>
      {locked ? (
        <div
          aria-disabled="true"
          onClick={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          className="group relative flex items-start gap-2.5 min-h-9 px-3 py-2 rounded-md border border-[#FFB300]/20 bg-gradient-to-br from-[#FFB300]/[0.06] via-zinc-900/40 to-zinc-900/40 text-[#FFB300]/80 select-none overflow-hidden transition-colors hover:border-[#FFB300]/35 hover:from-[#FFB300]/[0.1] cursor-not-allowed"
        >
          <span className="shrink-0 mt-[1px] h-5 w-5 rounded-full bg-[#FFB300]/15 ring-1 ring-[#FFB300]/25 flex items-center justify-center">
            <Lock className="h-3 w-3 text-[#FFB300]" />
          </span>
          <span className="text-[11px] leading-snug break-words whitespace-pre-line text-zinc-300/85">
            {lockedMessage}
          </span>
        </div>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 text-xs"
        />
      )}
    </div>
  );
}

interface ToggleSlotProps {
  label: string;
  optionalLabel: string;
  placeholder: string;
  imageUrl: string | undefined;
  text: string | undefined;
  onPick: () => void;
  onClearImage: () => void;
  onTextChange: (v: string) => void;
  language: string;
}

function ToggleSlot({
  label,
  optionalLabel,
  placeholder,
  imageUrl,
  text,
  onPick,
  onClearImage,
  onTextChange,
  language,
}: ToggleSlotProps) {
  const l = (th: string, en: string) => (language === 'th' ? th : en);
  const [mode, setMode] = useState<'image' | 'text'>(imageUrl ? 'image' : 'text');

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] text-muted-foreground">
          {label} <span className="text-[9px] text-zinc-500">{optionalLabel}</span>
        </label>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMode('image')}
            className={`text-[9px] px-1.5 py-0.5 rounded ${mode === 'image' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}
          >
            {l('รูป', 'Image')}
          </button>
          <button
            type="button"
            onClick={() => setMode('text')}
            className={`text-[9px] px-1.5 py-0.5 rounded ${mode === 'text' ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}
          >
            {l('ข้อความ', 'Text')}
          </button>
        </div>
      </div>
      {mode === 'image' ? (
        <div
          onClick={onPick}
          className={`relative flex items-center justify-center rounded-lg border-2 border-dashed p-2 cursor-pointer transition-colors min-h-[60px] ${
            imageUrl ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
          }`}
        >
          {imageUrl ? (
            <>
              <img src={imageUrl} alt="" className="h-12 w-auto rounded object-cover" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClearImage();
                }}
                className="absolute top-1 right-1 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"
              >
                <X className="h-3 w-3 text-zinc-400 hover:text-red-400" />
              </button>
            </>
          ) : (
            <span className="text-[10px] text-zinc-500">{l('เลือกรูป', 'Pick image')}</span>
          )}
        </div>
      ) : (
        <Input
          value={text || ''}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 text-xs"
        />
      )}
    </div>
  );
}
