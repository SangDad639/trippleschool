import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckSquare, Square, UserRound, UsersRound, UserRoundCheck, Film, FilmIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ViralTemplateTask } from '@/types/viralTemplate';

type Scope = 'this' | 'all' | 'select';
type SceneScope = 'this' | 'all';

interface ViralImageScopeDialogProps {
  open: boolean;
  onClose: () => void;
  pickedUrl: string;
  currentTaskId: number;
  siblings: ViralTemplateTask[];
  /** When set, the picker came from a per-scene slot. Number = current scene index (0-based). */
  pickedSceneIdx?: number | null;
  /** Total scenes for the source job (only meaningful when pickedSceneIdx != null). */
  totalScenes?: number;
  /**
   * onConfirm receives the selected task IDs and the scene indices to apply to.
   * sceneIndices = null when the picker is non-per-scene (write the plain baseKey).
   */
  onConfirm: (taskIds: number[], sceneIndices: number[] | null) => void;
}

/**
 * After picking an image from the gallery, ask the user where to apply it:
 *  • this task only
 *  • all tasks (in this job)
 *  • a specific subset of tasks (checkbox picker)
 */
export function ViralImageScopeDialog({
  open,
  onClose,
  pickedUrl,
  currentTaskId,
  siblings,
  pickedSceneIdx,
  totalScenes,
  onConfirm,
}: ViralImageScopeDialogProps) {
  const { language } = useLanguage();
  const l = (th: string, en: string) => (language === 'th' ? th : en);

  const isPerScene = pickedSceneIdx !== null && pickedSceneIdx !== undefined;
  const sceneCount = totalScenes && totalScenes > 0 ? totalScenes : 1;

  const [scope, setScope] = useState<Scope>('this');
  const [sceneScope, setSceneScope] = useState<SceneScope>('this');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) {
      setScope('this');
      setSceneScope('this');
      // Pre-select all tasks for "select" mode (user un-ticks what they don't want)
      setSelectedIds(new Set(siblings.map((s) => s.id)));
    }
  }, [open, siblings]);

  const toggleTask = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === siblings.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(siblings.map((s) => s.id)));
  };

  const handleConfirm = () => {
    let taskIds: number[];
    if (scope === 'this') {
      taskIds = [currentTaskId];
    } else if (scope === 'all') {
      taskIds = siblings.map((s) => s.id);
    } else {
      if (selectedIds.size === 0) return;
      taskIds = Array.from(selectedIds);
    }

    let sceneIndices: number[] | null;
    if (!isPerScene) {
      sceneIndices = null; // non-per-scene → write plain baseKey
    } else if (sceneScope === 'this') {
      sceneIndices = [pickedSceneIdx as number];
    } else {
      sceneIndices = Array.from({ length: sceneCount }, (_, i) => i);
    }

    onConfirm(taskIds, sceneIndices);
    onClose();
  };

  if (!open) return null;

  const currentIdx = siblings.findIndex((s) => s.id === currentTaskId);

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-[92vw] max-w-[520px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-white">
            {l('ใช้รูปนี้กับ...', 'Apply this image to...')}
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Image preview */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
          <img
            src={pickedUrl}
            alt="picked"
            className="h-16 w-16 object-cover rounded-md border border-zinc-700"
          />
          <div className="text-xs text-zinc-400 leading-relaxed">
            {l('เลือกขอบเขตที่จะนำรูปนี้ไปใช้', 'Choose how widely to apply this image')}
          </div>
        </div>

        {/* Scope options */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Scene scope (per-scene picker only) */}
          {isPerScene && sceneCount > 1 && (
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                {l('ฉาก', 'Scene')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSceneScope('this')}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-colors ${
                    sceneScope === 'this'
                      ? 'border-[#FFB300] bg-[#FFB300]/10'
                      : 'border-zinc-700 bg-zinc-800/40 hover:bg-zinc-800/70'
                  }`}
                >
                  <Film className={`h-4 w-4 shrink-0 ${sceneScope === 'this' ? 'text-[#FFB300]' : 'text-zinc-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${sceneScope === 'this' ? 'text-zinc-100' : 'text-zinc-300'}`}>
                      {l('ฉากนี้เท่านั้น', 'This scene only')}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {l(`ฉากที่ ${(pickedSceneIdx as number) + 1}`, `Scene ${(pickedSceneIdx as number) + 1}`)}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSceneScope('all')}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-colors ${
                    sceneScope === 'all'
                      ? 'border-[#FFB300] bg-[#FFB300]/10'
                      : 'border-zinc-700 bg-zinc-800/40 hover:bg-zinc-800/70'
                  }`}
                >
                  <FilmIcon className={`h-4 w-4 shrink-0 ${sceneScope === 'all' ? 'text-[#FFB300]' : 'text-zinc-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${sceneScope === 'all' ? 'text-zinc-100' : 'text-zinc-300'}`}>
                      {l('ทุกฉาก', 'All scenes')}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {l(`รวม ${sceneCount} ฉาก`, `Includes ${sceneCount} scenes`)}
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Task scope */}
          {isPerScene && sceneCount > 1 && (
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block">
              Task
            </label>
          )}
          <button
            type="button"
            onClick={() => setScope('this')}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
              scope === 'this'
                ? 'border-[#FFB300] bg-[#FFB300]/10'
                : 'border-zinc-700 bg-zinc-800/40 hover:bg-zinc-800/70'
            }`}
          >
            <UserRound className={`h-4 w-4 shrink-0 ${scope === 'this' ? 'text-[#FFB300]' : 'text-zinc-500'}`} />
            <div className="flex-1">
              <div className={`text-sm font-medium ${scope === 'this' ? 'text-zinc-100' : 'text-zinc-300'}`}>
                {l('Task นี้เท่านั้น', 'This task only')}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                Task #{currentIdx + 1}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setScope('all')}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
              scope === 'all'
                ? 'border-[#FFB300] bg-[#FFB300]/10'
                : 'border-zinc-700 bg-zinc-800/40 hover:bg-zinc-800/70'
            }`}
          >
            <UsersRound className={`h-4 w-4 shrink-0 ${scope === 'all' ? 'text-[#FFB300]' : 'text-zinc-500'}`} />
            <div className="flex-1">
              <div className={`text-sm font-medium ${scope === 'all' ? 'text-zinc-100' : 'text-zinc-300'}`}>
                {l('ทุก Task', 'All tasks')}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {l(`รวม ${siblings.length} Task`, `Includes ${siblings.length} tasks`)}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setScope('select')}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
              scope === 'select'
                ? 'border-[#FFB300] bg-[#FFB300]/10'
                : 'border-zinc-700 bg-zinc-800/40 hover:bg-zinc-800/70'
            }`}
          >
            <UserRoundCheck className={`h-4 w-4 shrink-0 ${scope === 'select' ? 'text-[#FFB300]' : 'text-zinc-500'}`} />
            <div className="flex-1">
              <div className={`text-sm font-medium ${scope === 'select' ? 'text-zinc-100' : 'text-zinc-300'}`}>
                {l('เลือก Task...', 'Select tasks...')}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {l('เลือกเฉพาะ Task ที่ต้องการ', 'Pick which tasks to apply to')}
              </div>
            </div>
          </button>

          {/* Task picker (visible when scope = 'select') */}
          {scope === 'select' && (
            <div className="ml-2 mt-3 space-y-2 border-l-2 border-[#FFB300]/40 pl-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">
                  {l(`เลือกแล้ว ${selectedIds.size}/${siblings.length}`, `Selected ${selectedIds.size}/${siblings.length}`)}
                </span>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11px] text-[#FFB300] hover:underline"
                >
                  {selectedIds.size === siblings.length
                    ? l('ยกเลิกทั้งหมด', 'Deselect all')
                    : l('เลือกทั้งหมด', 'Select all')}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                {siblings.map((t, idx) => {
                  const selected = selectedIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTask(t.id)}
                      className={`flex items-center gap-2 p-1.5 rounded-md border text-left text-xs transition-colors ${
                        selected
                          ? 'border-[#FFB300] bg-[#FFB300]/10 text-zinc-100'
                          : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800/70'
                      }`}
                    >
                      {selected ? (
                        <CheckSquare className="h-3.5 w-3.5 text-[#FFB300] shrink-0" />
                      ) : (
                        <Square className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate">
                        Task #{idx + 1}
                        {t.character_name ? ` — ${t.character_name}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-sm"
          >
            {l('ยกเลิก', 'Cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={scope === 'select' && selectedIds.size === 0}
            className="px-4 py-2 rounded-lg bg-[#FFB300] text-black font-semibold hover:bg-[#FFB300]/90 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
          >
            {l('ยืนยัน', 'Confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ViralImageScopeDialog;
