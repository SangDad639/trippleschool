import { useState, useEffect } from 'react';
import { Trash2, Play, Loader2, RotateCcw, Eye, ChevronDown, Download, ImageIcon, Upload, X, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ViralPipelineStatus } from './ViralPipelineStatus';
import { ViralTaskDetailModal } from './ViralTaskDetailModal';
import { IdolImageGallery } from '@/components/idol/IdolImageGallery';
import { ViralImageScopeDialog } from './ViralImageScopeDialog';
import { useViralTasks } from './ViralTasksContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { ViralTemplateTask, TemplateVariable } from '@/types/viralTemplate';

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

function buildLogEntries(task: ViralTemplateTask): LogEntry[] {
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

interface ViralTaskCardProps {
  task: ViralTemplateTask;
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
  referenceImageConfig?: { character?: boolean; outfit?: boolean; background?: boolean } | null;
  /** Preset reference images shipped with the template — auto-prefilled per scene if user hasn't picked one. */
  presetSceneRefs?: { character?: string[]; outfit?: string[]; background?: string[] };
  /** When true, picking a character image auto-applies it to every scene of this task without prompting. */
  autoApplyCharacter?: boolean;
  /** All tasks in this job — enables "apply to other tasks" scope dialog after picking an image. */
  siblingTasks?: ViralTemplateTask[];
  /** Apply (key,url) to other tasks via the parent. Called only for ids OTHER than this task. */
  onBulkImageApply?: (key: string, url: string, taskIds: number[]) => void;
  /** Hide the "สร้างภาพ" pipeline step — template skips AI image gen and feeds refs straight into video. */
  directVideoFromRef?: boolean;
  /** Hide the "ต่อ VDO" pipeline step — template produces a single scene so there's nothing to concat. */
  singleScene?: boolean;
}

export function ViralTaskCard({ task, onGenerate, onDelete, onCharacterChange, generating, inputMode, scenesPerVideo, inputLabel, inputPlaceholder, templateVariables, perSceneVars, referenceImageConfig, presetSceneRefs, autoApplyCharacter, siblingTasks, onBulkImageApply, directVideoFromRef, singleScene }: ViralTaskCardProps) {
  const { t } = useLanguage();
  const [localName, setLocalName] = useState(task.character_name);
  const [localNames, setLocalNames] = useState<string[]>(
    task.character_names && task.character_names.length > 0
      ? task.character_names
      : Array(scenesPerVideo || 1).fill('')
  );
  const [localVars, setLocalVars] = useState<Record<string, string | string[]>>(
    task.task_variables || {}
  );
  useEffect(() => {
    setLocalVars(task.task_variables || {});
  }, [task.task_variables]);

  // Pre-fill template's preset reference images (e.g. "ลิง" ships with 3 scene reference photos
  // for the background slot) so users only have to upload their own character image.
  useEffect(() => {
    if (!presetSceneRefs) return;
    const updates: Record<string, string | string[]> = {};
    let needsUpdate = false;
    const baseKeys = ['character', 'outfit', 'background'] as const;
    for (const baseKey of baseKeys) {
      const urls = presetSceneRefs[baseKey];
      if (!Array.isArray(urls)) continue;
      urls.forEach((url, sceneIdx) => {
        if (!url) return;
        const varKey = `${baseKey}_image_${sceneIdx}`;
        // Don't overwrite if user already uploaded their own
        if (typeof task.task_variables?.[varKey] === 'string' && task.task_variables[varKey]) return;
        if (typeof localVars[varKey] === 'string' && localVars[varKey]) return;
        updates[varKey] = url;
        needsUpdate = true;
      });
    }
    if (needsUpdate) {
      setLocalVars(prev => ({ ...prev, ...updates }));
      onCharacterChange(task.id, '', undefined, updates);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, JSON.stringify(presetSceneRefs)]);

  // Pre-fill default_value from template_variables once when task has no saved data yet
  useEffect(() => {
    if (!templateVariables || templateVariables.length === 0) return;
    const hasExistingData = task.task_variables && Object.keys(task.task_variables).length > 0;
    if (hasExistingData) return;
    const updates: Record<string, string | string[]> = {};
    let needsUpdate = false;
    for (const v of templateVariables) {
      if (!v.enabled || v.default_value === undefined) continue;
      if (v.per_scene && Array.isArray(v.default_value)) {
        const sliceLen = scenesPerVideo || v.default_value.length;
        updates[v.key] = v.default_value.slice(0, sliceLen);
        needsUpdate = true;
      } else if (!v.per_scene && typeof v.default_value === 'string') {
        updates[v.key] = v.default_value;
        needsUpdate = true;
      }
    }
    if (needsUpdate) {
      setLocalVars(prev => ({ ...prev, ...updates }));
      onCharacterChange(task.id, '', undefined, updates);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Dialog editor for long dialogue inputs (opened by clicking the value chip)
  const [dialogueEditor, setDialogueEditor] = useState<{
    varDef: TemplateVariable;
    sceneIdx: number | null; // null = flat, number = per_scene
    draft: string;
  } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState<'idol' | 'outfit' | 'background' | 'movie_scene' | null>(null);
  const [gallerySceneIdx, setGallerySceneIdx] = useState<number | null>(null);
  const [scopeDialog, setScopeDialog] = useState<{
    url: string;
    baseKey: string;
    sceneIdx: number | null;
    siblings: ViralTemplateTask[];
  } | null>(null);
  const refCfg = referenceImageConfig;
  const hasRefConfig = !!(refCfg && (refCfg.character || refCfg.outfit || refCfg.background || refCfg.movie_scene));
  const viralTasksCtx = useViralTasks();


  // Use new variable system if template_variables are defined
  const useNewVarSystem = templateVariables && templateVariables.length > 0;
  const enabledVars = useNewVarSystem ? templateVariables.filter(v => v.enabled) : [];

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

  const handleNameChange = (val: string) => {
    setLocalName(val);
    onCharacterChange(task.id, val);
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3 min-w-[280px] w-[280px] flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300">
          {t('viral.task')} #{task.task_index + 1}
        </span>
        <div className="flex items-center gap-1">
          {task.status === 'done' && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-900/30 text-green-400">
              {t('viral.done')}
            </span>
          )}
          {task.status === 'failed' && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-900/30 text-red-400">
              {t('viral.failed')}
            </span>
          )}
          {isActive && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-900/30 text-yellow-400 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('viral.generating')}
            </span>
          )}
        </div>
      </div>

      {/* Pipeline Status + Error (moved up so users see status/failure right under the header) */}
      {task.status !== 'pending' && (
        <ViralPipelineStatus currentStep={task.current_step} taskStatus={task.status} directVideoFromRef={directVideoFromRef} singleScene={singleScene} />
      )}
      {task.error && (
        <div className="text-xs text-red-400 bg-red-900/20 rounded p-2 break-words">
          {translateError(task.error)}
        </div>
      )}

      {/* Reference Images — โหมดปกติ (ไม่แยกฉาก) */}
      {hasRefConfig && !perSceneVars && (
        <div className="space-y-2">
          <label className="text-[10px] text-zinc-500 block">รูปอ้างอิง (ไม่บังคับ)</label>
          {refCfg?.movie_scene && (
            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">{refCfg?.labels?.movie_scene ?? 'ฉากหนัง'}</label>
              <div
                onClick={() => { if (!isActive) { setGallerySceneIdx(null); setGalleryOpen('movie_scene'); } }}
                className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-3 cursor-pointer transition-colors min-h-[120px] ${
                  localVars['movie_scene_image'] ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                }`}
              >
                {localVars['movie_scene_image'] ? (
                  <>
                    <img src={localVars['movie_scene_image'] as string} alt="Movie scene" className="h-24 w-auto max-w-full rounded object-cover" />
                    <button onClick={(e) => { e.stopPropagation(); const u = { ...localVars }; delete u['movie_scene_image']; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
                      className="absolute top-1 right-1 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"><X className="h-3 w-3 text-zinc-400 hover:text-red-400" /></button>
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-7 w-7 text-zinc-600 mb-1.5" />
                    <span className="text-[10px] text-zinc-500">{`เลือกรูป${refCfg?.labels?.movie_scene ?? 'ฉากหนัง'}`}</span>
                  </>
                )}
              </div>
            </div>
          )}
          {refCfg?.background && (
            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">{refCfg?.labels?.background ?? 'แบ็คกราวด์'}</label>
              <div
                onClick={() => { if (!isActive) { setGallerySceneIdx(null); setGalleryOpen('background'); } }}
                className={`relative flex items-center justify-center rounded-lg border-2 border-dashed p-2 cursor-pointer transition-colors h-[50px] ${
                  localVars['background_image'] ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                }`}
              >
                {localVars['background_image'] ? (
                  <>
                    <img src={localVars['background_image'] as string} alt="BG" className="h-9 w-auto rounded object-cover" />
                    <button onClick={(e) => { e.stopPropagation(); const u = { ...localVars }; delete u['background_image']; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
                      className="absolute top-1 right-1 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"><X className="h-3 w-3 text-zinc-400 hover:text-red-400" /></button>
                  </>
                ) : (
                  <span className="text-[9px] text-zinc-500">{refCfg?.labels?.background ? `เลือกรูป${refCfg.labels.background}` : 'เลือกรูป Background'}</span>
                )}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {refCfg?.character && (
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">{refCfg?.labels?.character ?? 'ตัวละคร'}</label>
                <div
                  onClick={() => { if (!isActive) { setGallerySceneIdx(null); setGalleryOpen('idol'); } }}
                  className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-2 cursor-pointer transition-colors min-h-[80px] ${
                    localVars['character_image'] ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                  }`}
                >
                  {localVars['character_image'] ? (
                    <>
                      <img src={localVars['character_image'] as string} alt="Character" className="h-14 w-auto rounded object-cover" />
                      <button onClick={(e) => { e.stopPropagation(); const u = { ...localVars }; delete u['character_image']; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
                        className="absolute top-1 right-1 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"><X className="h-3 w-3 text-zinc-400 hover:text-red-400" /></button>
                    </>
                  ) : (
                    <><ImageIcon className="h-5 w-5 text-zinc-600 mb-1" /><span className="text-[9px] text-zinc-500">เลือกรูป</span></>
                  )}
                </div>
              </div>
            )}
            {refCfg?.outfit && (
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">ชุด</label>
                <div
                  onClick={() => { if (!isActive) { setGallerySceneIdx(null); setGalleryOpen('outfit'); } }}
                  className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-2 cursor-pointer transition-colors min-h-[80px] ${
                    localVars['outfit_image'] ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                  }`}
                >
                  {localVars['outfit_image'] ? (
                    <>
                      <img src={localVars['outfit_image'] as string} alt="Outfit" className="h-14 w-auto rounded object-cover" />
                      <button onClick={(e) => { e.stopPropagation(); const u = { ...localVars }; delete u['outfit_image']; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
                        className="absolute top-1 right-1 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"><X className="h-3 w-3 text-zinc-400 hover:text-red-400" /></button>
                    </>
                  ) : (
                    <><Upload className="h-5 w-5 text-zinc-600 mb-1" /><span className="text-[9px] text-zinc-500">เลือกรูป</span></>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gallery Modal (shared) */}
      {hasRefConfig && (
        <IdolImageGallery
          open={galleryOpen !== null}
          onClose={() => setGalleryOpen(null)}
          title={
            galleryOpen === 'idol'
              ? `เลือกรูป${refCfg?.labels?.character ?? 'ตัวละคร'}`
              : galleryOpen === 'outfit'
              ? `เลือกรูป${refCfg?.labels?.outfit ?? 'ชุด'}`
              : galleryOpen === 'movie_scene'
              ? `เลือกรูป${refCfg?.labels?.movie_scene ?? 'ฉากหนัง'}`
              : refCfg?.labels?.background
              ? `เลือกรูป${refCfg.labels.background}`
              : 'เลือกรูป Background'
          }
          category={galleryOpen || undefined}
          onSelect={(url) => {
            const baseKey =
              galleryOpen === 'idol' ? 'character_image'
              : galleryOpen === 'outfit' ? 'outfit_image'
              : galleryOpen === 'movie_scene' ? 'movie_scene_image'
              : 'background_image';
            const sceneIdx = gallerySceneIdx;
            const singleKey = sceneIdx !== null ? `${baseKey}_${sceneIdx}` : baseKey;
            // Snapshot siblings from context (covers ALL jobs in the page).
            // Only include tasks that are still pending — done/failed/in-progress can't
            // (or shouldn't) accept a new reference image.
            const raw: ViralTemplateTask[] =
              viralTasksCtx?.getAllTasks() ?? siblingTasks ?? [task];
            const allSiblings = raw.filter((t) => t.status === 'pending');
            // Only one task AND not per-scene-with-multiple-scenes → apply directly without asking
            const totalScenes = scenesPerVideo || 1;
            const needsSceneChoice = sceneIdx !== null && totalScenes > 1;
            if (allSiblings.length <= 1 && !needsSceneChoice) {
              const updated = { ...localVars, [singleKey]: url };
              setLocalVars(updated);
              onCharacterChange(task.id, '', undefined, updated);
              if (viralTasksCtx) {
                viralTasksCtx.applyToTasks({
                  baseKey,
                  url,
                  taskIds: [task.id],
                  sceneIndices: sceneIdx !== null ? [sceneIdx] : undefined,
                });
              }
              return;
            }
            // Multi task or multi scene → ask scope
            setScopeDialog({ url, baseKey, sceneIdx, siblings: allSiblings });
          }}
        />
      )}

      {/* Scope dialog — appears after picking an image when there are multiple tasks/scenes */}
      {scopeDialog && (
        <ViralImageScopeDialog
          open={!!scopeDialog}
          onClose={() => setScopeDialog(null)}
          pickedUrl={scopeDialog.url}
          currentTaskId={task.id}
          siblings={scopeDialog.siblings}
          pickedSceneIdx={scopeDialog.sceneIdx}
          totalScenes={scenesPerVideo || 1}
          onConfirm={(taskIds, sceneIndices) => {
            // Compute the keys this confirmation writes (one or many)
            const keys = sceneIndices && sceneIndices.length > 0
              ? sceneIndices.map((i) => `${scopeDialog.baseKey}_${i}`)
              : [scopeDialog.baseKey];

            // Optimistic local update for current task (instant UI feedback)
            if (taskIds.includes(task.id)) {
              const updated: Record<string, any> = { ...localVars };
              for (const k of keys) updated[k] = scopeDialog.url;
              setLocalVars(updated);
              onCharacterChange(task.id, '', undefined, updated);
            }
            // Single dispatch to context — handles state + DB persist for ALL ids (cross-job).
            // Fallback to per-key local prop callback when no provider is mounted.
            if (viralTasksCtx) {
              viralTasksCtx.applyToTasks({
                baseKey: scopeDialog.baseKey,
                url: scopeDialog.url,
                taskIds,
                sceneIndices: sceneIndices ?? undefined,
              });
            } else if (onBulkImageApply) {
              const otherIds = taskIds.filter((id) => id !== task.id);
              if (otherIds.length > 0) {
                for (const k of keys) onBulkImageApply(k, scopeDialog.url, otherIds);
              }
            }
            setScopeDialog(null);
          }}
        />
      )}

      {/* Input Fields */}
      {useNewVarSystem ? (
        <div className="space-y-2">
          {perSceneVars ? (
            /* ── per_scene_vars: รูปอ้างอิง + ตัวแปร ซ้ำทุกฉาก ── */
            Array.from({ length: scenesPerVideo || 1 }).map((_, sceneIdx) => (
              <div key={sceneIdx} className="space-y-1.5">
                <label className="text-[10px] text-blue-400 font-semibold block border-t border-zinc-800 pt-1.5">
                  ฉากที่ {sceneIdx + 1}
                </label>
                {/* Reference images per scene */}
                {hasRefConfig && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {refCfg?.character && (
                      <div>
                        <label className="text-[9px] text-zinc-500 block mb-0.5">ตัวละคร</label>
                        <div
                          onClick={() => { if (!isActive) { setGallerySceneIdx(sceneIdx); setGalleryOpen('idol'); } }}
                          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-1 cursor-pointer transition-colors min-h-[60px] ${
                            localVars[`character_image_${sceneIdx}`] ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                          }`}
                        >
                          {localVars[`character_image_${sceneIdx}`] ? (
                            <>
                              <img src={localVars[`character_image_${sceneIdx}`] as string} alt="Char" className="h-10 w-auto rounded object-cover" />
                              <button onClick={(e) => { e.stopPropagation(); const u = { ...localVars }; delete u[`character_image_${sceneIdx}`]; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
                                className="absolute top-0.5 right-0.5 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"><X className="h-2.5 w-2.5 text-zinc-400 hover:text-red-400" /></button>
                            </>
                          ) : (
                            <><ImageIcon className="h-4 w-4 text-zinc-600" /><span className="text-[8px] text-zinc-500">เลือก</span></>
                          )}
                        </div>
                      </div>
                    )}
                    {refCfg?.outfit && (
                      <div>
                        <label className="text-[9px] text-zinc-500 block mb-0.5">ชุด</label>
                        <div
                          onClick={() => { if (!isActive) { setGallerySceneIdx(sceneIdx); setGalleryOpen('outfit'); } }}
                          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-1 cursor-pointer transition-colors min-h-[60px] ${
                            localVars[`outfit_image_${sceneIdx}`] ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                          }`}
                        >
                          {localVars[`outfit_image_${sceneIdx}`] ? (
                            <>
                              <img src={localVars[`outfit_image_${sceneIdx}`] as string} alt="Outfit" className="h-10 w-auto rounded object-cover" />
                              <button onClick={(e) => { e.stopPropagation(); const u = { ...localVars }; delete u[`outfit_image_${sceneIdx}`]; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
                                className="absolute top-0.5 right-0.5 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"><X className="h-2.5 w-2.5 text-zinc-400 hover:text-red-400" /></button>
                            </>
                          ) : (
                            <><Upload className="h-4 w-4 text-zinc-600" /><span className="text-[8px] text-zinc-500">เลือก</span></>
                          )}
                        </div>
                      </div>
                    )}
                    {refCfg?.background && (
                      <div>
                        <label className="text-[9px] text-zinc-500 block mb-0.5">BG</label>
                        <div
                          onClick={() => { if (!isActive) { setGallerySceneIdx(sceneIdx); setGalleryOpen('background'); } }}
                          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-1 cursor-pointer transition-colors min-h-[60px] ${
                            localVars[`background_image_${sceneIdx}`] ? 'border-green-700 bg-green-900/10' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                          }`}
                        >
                          {localVars[`background_image_${sceneIdx}`] ? (
                            <>
                              <img src={localVars[`background_image_${sceneIdx}`] as string} alt="BG" className="h-10 w-auto rounded object-cover" />
                              <button onClick={(e) => { e.stopPropagation(); const u = { ...localVars }; delete u[`background_image_${sceneIdx}`]; setLocalVars(u); onCharacterChange(task.id, '', undefined, u); }}
                                className="absolute top-0.5 right-0.5 bg-zinc-900/80 rounded-full p-0.5 hover:bg-red-900/80"><X className="h-2.5 w-2.5 text-zinc-400 hover:text-red-400" /></button>
                            </>
                          ) : (
                            <span className="text-[8px] text-zinc-500">เลือก</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {enabledVars.map(varDef => {
                  const currentVal = (Array.isArray(localVars[varDef.key]) ? (localVars[varDef.key] as string[])[sceneIdx] : '') || '';
                  const maxLen = varDef.max_length;
                  const overLimit = !!maxLen && currentVal.length > maxLen;
                  return (
                    <div key={varDef.key}>
                      {varDef.description && <label className="text-[10px] text-zinc-400 block mb-0.5">{varDef.description}</label>}
                      <button
                        type="button"
                        disabled={isActive}
                        onClick={() => setDialogueEditor({ varDef, sceneIdx, draft: currentVal })}
                        className={`w-full text-left rounded-md border bg-zinc-800/70 hover:bg-zinc-800 hover:border-zinc-600 transition-colors p-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed ${
                          overLimit ? 'border-red-700' : currentVal ? 'border-zinc-700' : 'border-zinc-700 border-dashed'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className={`flex-1 line-clamp-3 break-words ${currentVal ? 'text-zinc-200' : 'text-zinc-500 italic'}`}>
                            {currentVal || (varDef.placeholder || 'แตะเพื่อพิมพ์คำพูด...')}
                          </span>
                          <Pencil className="h-3 w-3 text-zinc-500 flex-shrink-0 mt-0.5" />
                        </div>
                        {maxLen && (
                          <div className={`text-[10px] mt-1 text-right ${overLimit ? 'text-red-400' : currentVal.length >= maxLen * 0.9 ? 'text-yellow-400' : 'text-zinc-500'}`}>
                            {currentVal.length}/{maxLen}
                          </div>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            /* ── Flat variables (ค่าเดียวทุกฉาก) ── */
            enabledVars.map(varDef => {
              const currentVal = (typeof localVars[varDef.key] === 'string' ? localVars[varDef.key] : '') as string;
              const maxLen = varDef.max_length;
              const overLimit = !!maxLen && currentVal.length > maxLen;
              // Inputs without max_length stay as a normal Input (for short values like "ตัวละคร")
              if (!maxLen) {
                return (
                  <div key={varDef.key}>
                    {varDef.description && <label className="text-[10px] text-zinc-400 block mb-0.5">{varDef.description}</label>}
                    <Input
                      value={currentVal}
                      onChange={e => {
                        const updated = { ...localVars, [varDef.key]: e.target.value };
                        setLocalVars(updated);
                        onCharacterChange(task.id, '', undefined, updated);
                      }}
                      placeholder={varDef.placeholder || varDef.description || varDef.label}
                      className="bg-zinc-800 border-zinc-700 text-sm"
                      disabled={isActive}
                    />
                  </div>
                );
              }
              // Long-text inputs (with max_length) → click to open dialog
              return (
                <div key={varDef.key}>
                  {varDef.description && <label className="text-[10px] text-zinc-400 block mb-0.5">{varDef.description}</label>}
                  <button
                    type="button"
                    disabled={isActive}
                    onClick={() => setDialogueEditor({ varDef, sceneIdx: null, draft: currentVal })}
                    className={`w-full text-left rounded-md border bg-zinc-800/70 hover:bg-zinc-800 hover:border-zinc-600 transition-colors p-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed ${
                      overLimit ? 'border-red-700' : currentVal ? 'border-zinc-700' : 'border-zinc-700 border-dashed'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`flex-1 line-clamp-3 break-words ${currentVal ? 'text-zinc-200' : 'text-zinc-500 italic'}`}>
                        {currentVal || (varDef.placeholder || 'แตะเพื่อพิมพ์...')}
                      </span>
                      <Pencil className="h-3 w-3 text-zinc-500 flex-shrink-0 mt-0.5" />
                    </div>
                    <div className={`text-[10px] mt-1 text-right ${overLimit ? 'text-red-400' : currentVal.length >= maxLen * 0.9 ? 'text-yellow-400' : 'text-zinc-500'}`}>
                      {currentVal.length}/{maxLen}
                    </div>
                  </button>
                </div>
              );
            })
          )}
        </div>
      ) : inputMode === 'multi' ? (
        /* ── Legacy multi mode ── */
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-500 block">{inputLabel || t('viral.characterName')}</label>
          {localNames.map((name, idx) => (
            <div key={idx}>
              <label className="text-[10px] text-zinc-600 mb-0.5 block">ฉาก {idx + 1}</label>
              <Input
                value={name}
                onChange={(e) => {
                  const updated = [...localNames];
                  updated[idx] = e.target.value;
                  setLocalNames(updated);
                  onCharacterChange(task.id, updated.filter(Boolean).join(', '), updated);
                }}
                placeholder={inputPlaceholder || 'เช่น ข้าวผัดกะเพรา...'}
                className="bg-zinc-800 border-zinc-700 text-sm"
                disabled={isActive}
              />
            </div>
          ))}
        </div>
      ) : (
        /* ── Legacy single mode ── */
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">{inputLabel || t('viral.characterName')}</label>
          <Input
            value={localName}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder={inputPlaceholder || 'เช่น ขวดโลออน, ส้มตำ, หมูปิ้ง...'}
            className="bg-zinc-800 border-zinc-700 text-sm"
            disabled={isActive}
          />
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
              if (useNewVarSystem) {
                onGenerate(task.id, '', undefined, localVars);
              } else if (inputMode === 'multi') {
                onGenerate(task.id, localNames.filter(Boolean).join(', '), localNames);
              } else {
                onGenerate(task.id, localName);
              }
            }}
            disabled={generating || (useNewVarSystem
              ? enabledVars.every(v => {
                  const val = localVars[v.key];
                  return !val || (typeof val === 'string' ? !val.trim() : (Array.isArray(val) && val.every(x => !x?.trim())));
                })
              : (inputMode === 'multi' ? localNames.every(n => !n.trim()) : !localName.trim()))}
            className="bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] text-black font-semibold hover:opacity-90"
          >
            {(task.status === 'failed' || hasMedia) ? (
              <><RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry</>
            ) : (
              <><Play className="h-3.5 w-3.5 mr-1" /> {t('viral.generate')}</>
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
                await api.downloadViaProxy(task.final_video_url!, `viral-${task.id}.mp4`);
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

      <ViralTaskDetailModal task={task} open={detailOpen} onClose={() => setDetailOpen(false)} />

      {/* Dialogue editor popup (long-text inputs with max_length) */}
      <Dialog open={!!dialogueEditor} onOpenChange={(o) => { if (!o) setDialogueEditor(null); }}>
        <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-base">
              {dialogueEditor?.varDef.label || 'แก้ไขคำพูด'}
              {dialogueEditor?.sceneIdx !== null && dialogueEditor?.sceneIdx !== undefined && (
                <span className="ml-2 text-sm text-blue-400">— ฉากที่ {dialogueEditor.sceneIdx + 1}</span>
              )}
            </DialogTitle>
            {dialogueEditor?.varDef.description && (
              <p className="text-xs text-zinc-400 mt-1">{dialogueEditor.varDef.description}</p>
            )}
          </DialogHeader>
          {dialogueEditor && (() => {
            const maxLen = dialogueEditor.varDef.max_length;
            const draft = dialogueEditor.draft;
            const overLimit = !!maxLen && draft.length > maxLen;
            return (
              <div className="space-y-2">
                <Textarea
                  autoFocus
                  rows={7}
                  value={draft}
                  onChange={e => {
                    const next = maxLen ? e.target.value.slice(0, maxLen) : e.target.value;
                    setDialogueEditor(prev => prev ? { ...prev, draft: next } : prev);
                  }}
                  maxLength={maxLen || undefined}
                  placeholder={dialogueEditor.varDef.placeholder || 'พิมพ์คำพูดที่นี่...'}
                  className="bg-zinc-800 border-zinc-700 text-sm"
                />
                {maxLen && (
                  <div className={`text-xs text-right ${overLimit ? 'text-red-400' : draft.length >= maxLen * 0.9 ? 'text-yellow-400' : 'text-zinc-500'}`}>
                    {draft.length}/{maxLen}
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDialogueEditor(null)} className="text-zinc-400">
              ยกเลิก
            </Button>
            <Button
              onClick={() => {
                if (!dialogueEditor) return;
                const { varDef, sceneIdx, draft } = dialogueEditor;
                let updated: Record<string, string | string[]>;
                if (sceneIdx !== null) {
                  const arr = Array.isArray(localVars[varDef.key])
                    ? [...(localVars[varDef.key] as string[])]
                    : Array(scenesPerVideo || 1).fill('');
                  arr[sceneIdx] = draft;
                  updated = { ...localVars, [varDef.key]: arr };
                } else {
                  updated = { ...localVars, [varDef.key]: draft };
                }
                setLocalVars(updated);
                onCharacterChange(task.id, '', undefined, updated);
                setDialogueEditor(null);
              }}
              className="bg-yellow-600 hover:bg-yellow-700 text-black font-semibold"
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
