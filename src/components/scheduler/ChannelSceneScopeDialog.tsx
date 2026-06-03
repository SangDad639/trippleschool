import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckSquare, Square, Film, FilmIcon, ListChecks } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

type Scope = 'this' | 'all' | 'select';

interface ChannelSceneScopeDialogProps {
  open: boolean;
  onClose: () => void;
  pickedUrl: string;
  pickedSceneIdx: number;
  totalScenes: number;
  /** Callback receives the scene indices to apply the picked URL to. */
  onConfirm: (sceneIndices: number[]) => void;
}

/**
 * After picking a reference image in the Channel form, ask which scenes the image
 * should apply to. Channel form is a template (no tasks yet) so this only asks
 * about scene scope, not task scope.
 */
export function ChannelSceneScopeDialog({
  open,
  onClose,
  pickedUrl,
  pickedSceneIdx,
  totalScenes,
  onConfirm,
}: ChannelSceneScopeDialogProps) {
  const { language } = useLanguage();
  const l = (th: string, en: string) => (language === 'th' ? th : en);

  const [scope, setScope] = useState<Scope>('this');
  const [selectedScenes, setSelectedScenes] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) {
      setScope('this');
      setSelectedScenes(new Set(Array.from({ length: totalScenes }, (_, i) => i)));
    }
  }, [open, totalScenes]);

  const toggleScene = (idx: number) => {
    setSelectedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedScenes.size === totalScenes) setSelectedScenes(new Set());
    else setSelectedScenes(new Set(Array.from({ length: totalScenes }, (_, i) => i)));
  };

  const handleConfirm = () => {
    let scenes: number[];
    if (scope === 'this') {
      scenes = [pickedSceneIdx];
    } else if (scope === 'all') {
      scenes = Array.from({ length: totalScenes }, (_, i) => i);
    } else {
      if (selectedScenes.size === 0) return;
      scenes = Array.from(selectedScenes).sort((a, b) => a - b);
    }
    onConfirm(scenes);
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-sm pointer-events-auto"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-[92vw] max-w-[480px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-white">
            {l('ใช้รูปนี้กับฉาก...', 'Apply image to scene...')}
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
            {l('เลือกฉากที่จะนำรูปนี้ไปใช้', 'Choose which scene(s) to apply this image to')}
          </div>
        </div>

        {/* Scope options */}
        <div className="p-4 space-y-2 overflow-y-auto">
          <button
            type="button"
            onClick={() => setScope('this')}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
              scope === 'this'
                ? 'border-[#FFB300] bg-[#FFB300]/10'
                : 'border-zinc-700 bg-zinc-800/40 hover:bg-zinc-800/70'
            }`}
          >
            <Film className={`h-4 w-4 shrink-0 ${scope === 'this' ? 'text-[#FFB300]' : 'text-zinc-500'}`} />
            <div className="flex-1">
              <div className={`text-sm font-medium ${scope === 'this' ? 'text-zinc-100' : 'text-zinc-300'}`}>
                {l('ฉากนี้เท่านั้น', 'This scene only')}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {l(`ฉากที่ ${pickedSceneIdx + 1}`, `Scene ${pickedSceneIdx + 1}`)}
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
            <FilmIcon className={`h-4 w-4 shrink-0 ${scope === 'all' ? 'text-[#FFB300]' : 'text-zinc-500'}`} />
            <div className="flex-1">
              <div className={`text-sm font-medium ${scope === 'all' ? 'text-zinc-100' : 'text-zinc-300'}`}>
                {l('ทุกฉาก', 'All scenes')}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {l(`รวม ${totalScenes} ฉาก`, `Includes ${totalScenes} scenes`)}
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
            <ListChecks className={`h-4 w-4 shrink-0 ${scope === 'select' ? 'text-[#FFB300]' : 'text-zinc-500'}`} />
            <div className="flex-1">
              <div className={`text-sm font-medium ${scope === 'select' ? 'text-zinc-100' : 'text-zinc-300'}`}>
                {l('เลือกฉาก...', 'Select scenes...')}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {l('เลือกเฉพาะฉากที่ต้องการ', 'Pick which scenes to apply to')}
              </div>
            </div>
          </button>

          {scope === 'select' && (
            <div className="ml-2 mt-3 space-y-2 border-l-2 border-[#FFB300]/40 pl-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">
                  {l(`เลือกแล้ว ${selectedScenes.size}/${totalScenes}`, `Selected ${selectedScenes.size}/${totalScenes}`)}
                </span>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11px] text-[#FFB300] hover:underline"
                >
                  {selectedScenes.size === totalScenes
                    ? l('ยกเลิกทั้งหมด', 'Deselect all')
                    : l('เลือกทั้งหมด', 'Select all')}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                {Array.from({ length: totalScenes }, (_, idx) => idx).map((idx) => {
                  const selected = selectedScenes.has(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleScene(idx)}
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
                        {l(`ฉากที่ ${idx + 1}`, `Scene ${idx + 1}`)}
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
            disabled={scope === 'select' && selectedScenes.size === 0}
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

export default ChannelSceneScopeDialog;
