import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Image as ImageIcon,
  Loader2,
  Upload,
  X,
  Download,
  Trash2,
  Play,
  ChevronDown,
  Eye,
  RotateCcw,
} from 'lucide-react';

export type Mode = 'text-to-image' | 'image-to-image';
// Aspect is a free-form string so different models can advertise their own list
export type Aspect = string;
export type Resolution = string;
export type TaskStatus = 'draft' | 'pending' | 'success' | 'failed';
export type LogLevel = 'info' | 'success' | 'warning' | 'error';
export type ImageModelKey = 'gpt-image-2' | 'grok-imagine' | 'nano-banana-2' | 'nano-banana-pro';

export interface ImageModelConfig {
  label: string;
  aspects: string[];
  defaultAspect: string;
  showResolution: boolean;
  resolutions: string[];
  defaultResolution: string;
  promptMaxLength: number;
  maxFiles: number;
}

export const MODEL_CONFIG: Record<string, ImageModelConfig> = {
  'gpt-image-2': {
    label: 'GPT Image 2',
    aspects: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4'],
    defaultAspect: 'auto',
    showResolution: true,
    resolutions: ['1K', '2K', '4K'],
    defaultResolution: '1K',
    promptMaxLength: 20000,
    maxFiles: 16,
  },
  'grok-imagine': {
    label: 'Grok Imagine',
    aspects: ['2:3', '3:2', '1:1', '16:9', '9:16'],
    defaultAspect: '1:1',
    showResolution: false,
    resolutions: [],
    defaultResolution: '',
    promptMaxLength: 20000,
    maxFiles: 1,
  },
  'nano-banana-2': {
    label: 'Nano Banana 2',
    aspects: ['auto', '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
    defaultAspect: 'auto',
    showResolution: true,
    resolutions: ['1K', '2K', '4K'],
    defaultResolution: '1K',
    promptMaxLength: 20000,
    maxFiles: 14,
  },
  'nano-banana-pro': {
    label: 'Nano Banana Pro',
    aspects: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    defaultAspect: '1:1',
    showResolution: true,
    resolutions: ['1K', '2K', '4K'],
    defaultResolution: '1K',
    promptMaxLength: 10000,
    maxFiles: 8,
  },
};

export const getModelConfig = (model?: string): ImageModelConfig =>
  MODEL_CONFIG[model || 'gpt-image-2'] || MODEL_CONFIG['gpt-image-2'];

export interface ActivityLog {
  timestamp: number;
  level: LogLevel;
  message: string;
}

export interface TaskDraft {
  localId: string;
  taskNumber: number;
  mode: Mode;
  prompt: string;
  aspect: Aspect;
  resolution: Resolution;
  files: File[];
  filePreviews: string[];
  status: TaskStatus;
  serverTaskId?: string;
  serverDbId?: number;
  resultUrl?: string;
  dropboxUrl?: string;
  error?: string;
  startedAt?: number;
  logs: ActivityLog[];
  model?: string;
}

export interface TaskGroup {
  groupId: string;
  createdAt: number;
  channelId: string;
  tasks: TaskDraft[];
}

export const ASPECTS: Aspect[] = ['auto', '1:1', '9:16', '16:9', '4:3', '3:4'];
export const RESOLUTIONS: Resolution[] = ['1K', '2K', '4K'];
export const MAX_TASKS_PER_CREATE = 10;

export const newDraft = (taskNumber: number, model?: string): TaskDraft => {
  const cfg = getModelConfig(model);
  return {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskNumber,
    mode: 'text-to-image',
    prompt: '',
    aspect: cfg.defaultAspect,
    resolution: cfg.defaultResolution,
    files: [],
    filePreviews: [],
    status: 'draft',
    logs: [],
    model,
  };
};

interface TaskCardProps {
  task: TaskDraft;
  index: number;
  language: string;
  onUpdate: (patch: Partial<TaskDraft>) => void;
  onDelete: () => void;
  onGenerate: () => void;
  onPickFiles: (fl: FileList | null) => void;
  onRemoveFile: (idx: number) => void;
  isResolutionDisabled: (r: Resolution, aspect: Aspect) => boolean;
  // Optional per-task model picker. When provided, a Model select renders at the top of the draft form
  // and switching model resets aspect/resolution to that model's defaults.
  availableModels?: { key: string; label: string; available: boolean }[];
}

export const TaskCard = ({
  task,
  index,
  language,
  onUpdate,
  onDelete,
  onGenerate,
  onPickFiles,
  onRemoveFile,
  isResolutionDisabled,
  availableModels,
}: TaskCardProps) => {
  const l = (th: string, en: string) => (language === 'th' ? th : en);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const cfg = getModelConfig(task.model);
  const isDraft = task.status === 'draft';
  const isPending = task.status === 'pending';
  const isSuccess = task.status === 'success';
  const isFailed = task.status === 'failed';

  return (
    <div className="rounded-xl border border-border/60 bg-background/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Task #{index}</h3>
        {isPending && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-[#FFB300]/40 bg-[#FFB300]/10 text-[#FFB300]">
            <Loader2 className="h-3 w-3 animate-spin" />
            {l('กำลังสร้าง...', 'Generating...')}
          </span>
        )}
        {isSuccess && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-green-500/40 bg-green-500/10 text-green-500">
            ✓ {l('สำเร็จ', 'Done')}
          </span>
        )}
        {isFailed && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-400">
            ✕ {l('ไม่สำเร็จ', 'Failed')}
          </span>
        )}
      </div>

      {(isSuccess || isFailed) && <StepProgress task={task} language={language} />}

      {isSuccess && task.resultUrl && (
        <div className="rounded-lg overflow-hidden bg-black/40">
          <img src={task.resultUrl} alt={task.prompt} className="block w-full h-auto" />
        </div>
      )}

      {isPending && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {task.mode === 'text-to-image' ? 'Text → Image' : 'Image → Image'}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {task.aspect}
            </span>
            {cfg.showResolution && task.resolution && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                {task.resolution}
              </span>
            )}
          </div>

          {task.mode === 'image-to-image' && task.filePreviews.length > 0 && (
            <div className="flex gap-1 overflow-x-auto">
              {task.filePreviews.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="h-16 w-auto rounded border border-zinc-700 opacity-70 shrink-0"
                />
              ))}
            </div>
          )}

          {task.prompt && (
            <div className="rounded-md bg-zinc-800/50 border border-zinc-700/60 p-2">
              <p className="text-[11px] text-zinc-300 leading-relaxed line-clamp-4">
                {task.prompt}
              </p>
            </div>
          )}

          <StepProgress task={task} language={language} />

          <div className="flex items-center justify-center gap-2 py-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FFB300]" />
            <span>{l('1-3 นาที', '1-3 min')}</span>
          </div>
        </div>
      )}

      {isFailed && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2">
          <p className="text-xs text-red-400">{task.error || l('สร้างไม่สำเร็จ', 'Failed')}</p>
        </div>
      )}

      {(isSuccess || isFailed) && task.prompt && (
        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{task.prompt}</p>
      )}

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
          <Tabs value={task.mode} onValueChange={(v) => onUpdate({ mode: v as Mode })}>
            <TabsList className="grid grid-cols-2 w-full h-8">
              <TabsTrigger value="text-to-image" className="text-[11px]">Text → Image</TabsTrigger>
              <TabsTrigger value="image-to-image" className="text-[11px]">Image → Image</TabsTrigger>
            </TabsList>

            <TabsContent value="image-to-image" className="mt-2 space-y-1.5">
              <label className="text-[10px] font-medium block text-muted-foreground">
                {l(`รูปภาพต้นฉบับ (สูงสุด ${cfg.maxFiles})`, `Input images (max ${cfg.maxFiles})`)}
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple={cfg.maxFiles > 1}
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-square border-2 border-dashed border-border rounded-lg hover:border-[#FFB300]/50 hover:bg-[#FFB300]/5 transition-colors flex flex-col items-center justify-center gap-1"
              >
                {task.filePreviews.length > 0 ? (
                  <div className="relative w-full h-full">
                    <img src={task.filePreviews[0]} alt="" className="w-full h-full object-cover rounded-md" />
                    {task.files.length > 1 && (
                      <span className="absolute top-1 right-1 text-[9px] px-1.5 py-0.5 rounded bg-black/70 text-white">
                        +{task.files.length - 1}
                      </span>
                    )}
                  </div>
                ) : (
                  <>
                    <Upload className="h-5 w-5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">{l('เลือกรูป', 'Pick image')}</span>
                  </>
                )}
              </button>
              {task.filePreviews.length > 1 && (
                <div className="grid grid-cols-4 gap-1">
                  {task.filePreviews.slice(1).map((src, i) => (
                    <div key={i} className="relative aspect-square rounded overflow-hidden border border-border">
                      <img src={src} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => onRemoveFile(i + 1)}
                        className="absolute top-0 right-0 h-4 w-4 rounded-bl bg-black/70 text-white flex items-center justify-center"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-medium text-muted-foreground">Prompt</label>
              <span className="text-[9px] text-muted-foreground">{task.prompt.length}/{cfg.promptMaxLength}</span>
            </div>
            <Textarea
              value={task.prompt}
              onChange={(e) => onUpdate({ prompt: e.target.value })}
              placeholder={l('อธิบายภาพที่ต้องการสร้าง...', 'Describe the image...')}
              rows={3}
              maxLength={cfg.promptMaxLength}
              className="resize-none text-xs"
            />
          </div>

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

          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={onGenerate}
              disabled={!task.prompt.trim() || (task.mode === 'image-to-image' && task.files.length === 0)}
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
        </>
      )}

      {!isDraft && (
        <div className="flex items-center justify-between">
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
                  {l('ดาวน์โหลด', 'Download')}
                </a>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {task.resultUrl && (
        <Dialog open={lightboxOpen} onOpenChange={(v) => !v && setLightboxOpen(false)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-700">
            <DialogHeader>
              <DialogTitle className="text-base">
                Task #{index} — {task.prompt ? task.prompt.slice(0, 60) + (task.prompt.length > 60 ? '…' : '') : l('ไม่มีชื่อ', 'Untitled')}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-300">
                <ImageIcon className="h-4 w-4" />
                {l('ภาพ', 'Image')} (1 {l('ฉาก', 'scene')})
              </div>
              <div className="relative rounded-lg overflow-hidden border border-zinc-700 inline-block">
                <img
                  src={task.resultUrl}
                  alt={task.prompt || 'result'}
                  className="block w-auto h-auto max-w-full max-h-[60vh] object-contain"
                />
                <a
                  href={task.dropboxUrl || task.resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white hover:bg-[#FFB300] hover:text-black transition-colors"
                >
                  <Download className="h-4 w-4" />
                </a>
                <div className="absolute bottom-1 left-1 text-xs bg-black/70 text-white px-1.5 py-0.5 rounded">
                  {l('ฉาก', 'Scene')} 1
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {task.logs.length > 0 && <ActivityLogPanel logs={task.logs} />}
    </div>
  );
};

export const StepProgress = ({ task, language }: { task: TaskDraft; language: string }) => {
  const l = (th: string, en: string) => (language === 'th' ? th : en);

  type StepState = 'done' | 'active' | 'pending' | 'failed';
  let s1: StepState = 'pending';
  let s2: StepState = 'pending';
  let s3: StepState = 'pending';

  if (task.status === 'pending') {
    if (task.serverTaskId) {
      s1 = 'done';
      s2 = 'active';
    } else {
      s1 = 'active';
    }
  } else if (task.status === 'success') {
    s1 = 'done';
    s2 = 'done';
    s3 = 'done';
  } else if (task.status === 'failed') {
    if (task.serverTaskId) {
      s1 = 'done';
      s2 = 'failed';
    } else {
      s1 = 'failed';
    }
  }

  const steps: { state: StepState; label: string }[] = [
    { state: s1, label: l('AI Prompt', 'AI Prompt') },
    { state: s2, label: l('สร้างภาพ', 'Generate') },
    { state: s3, label: l('สำเร็จ', 'Done') },
  ];

  const dotClass = (st: StepState) => {
    switch (st) {
      case 'done': return 'bg-green-500 text-white';
      case 'active': return 'bg-[#FFB300] text-black';
      case 'failed': return 'bg-red-500 text-white';
      default: return 'bg-muted text-muted-foreground';
    }
  };
  const lineClass = (st: StepState) => (st === 'done' ? 'bg-green-500/50' : 'bg-border');

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-1.5 flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1 min-w-0">
            <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${dotClass(step.state)}`}>
              {step.state === 'done' ? '✓' : step.state === 'failed' ? '✕' : step.state === 'active' ? <Loader2 className="h-3 w-3 animate-spin" /> : i + 1}
            </div>
            <span className={`text-[9px] truncate ${step.state === 'pending' ? 'text-muted-foreground' : 'text-foreground/80'}`}>{step.label}</span>
          </div>
          {i < steps.length - 1 && <div className={`h-px flex-1 ${lineClass(step.state)}`} />}
        </div>
      ))}
    </div>
  );
};

export const ActivityLogPanel = ({ logs }: { logs: ActivityLog[] }) => {
  const [open, setOpen] = useState(false);
  const messageColor = (lvl: LogLevel) => {
    switch (lvl) {
      case 'success': return 'text-green-400';
      case 'warning': return 'text-amber-400';
      case 'error': return 'text-red-400';
      default: return 'text-zinc-500';
    }
  };

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', { hour12: false });

  return (
    <div className="rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="text-xs">Log</span>
      </button>
      {open && (
        <div className="bg-zinc-950/50 rounded-md border border-zinc-800 max-h-[180px] overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {logs.length === 0 ? (
              <div className="text-[11px] text-zinc-600 italic px-1 py-2 text-center">
                ยังไม่มีบันทึก / No log entries yet
              </div>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 text-[11px] py-0.5 px-1 font-mono ${messageColor(log.level)}`}
                >
                  <span className="text-zinc-600 shrink-0">{fmtTime(log.timestamp)}</span>
                  <span className="break-all">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
