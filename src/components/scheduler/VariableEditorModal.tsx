import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2, Sparkles, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Variable, VariableValue } from '@/types/scheduler';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';

interface VariableEditorModalProps {
  open: boolean;
  onClose: () => void;
  variable: Variable | null;
  onSave: (variable: Variable) => void | Promise<void>;
  hideAiGenerate?: boolean;
  // Extra context for AI Generate (used by Idol Template outfit/background):
  // passes image + template info to backend so generated values match the subject.
  aiGenerateContext?: {
    imageUrl?: string;
    templateContext?: string;
    defaultSystemPrompt?: string;
  };
  // Label overrides — when values are NOT conceptually "variables" (e.g. Idol outfit/background,
  // used directly without placeholder substitution). Keeps familiar UX but drops "ตัวแปร" wording.
  labelOverrides?: {
    title?: string;
    systemPromptLabel?: string;
    currentValuesLabel?: string;
  };
}

export const VariableEditorModal: React.FC<VariableEditorModalProps> = ({
  open,
  onClose,
  variable,
  onSave,
  hideAiGenerate = false,
  aiGenerateContext,
  labelOverrides,
}) => {
  const { t } = useLanguage();
  const [values, setValues] = useState<VariableValue[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [generateCount, setGenerateCount] = useState(50);
  const [generating, setGenerating] = useState(false);
  const [newValue, setNewValue] = useState('');

  useEffect(() => {
    if (variable) {
      console.log('[VariableEditorModal] Opening for variable:', variable.name, 'values:', variable.values?.length || 0);
      setValues(variable.values || []);
      const fallback = aiGenerateContext?.defaultSystemPrompt
        || `Generate a diverse list of "${variable.name}" values. Each value should be unique and creative. Output only the values, one per line.`;
      setSystemPrompt(variable.system_prompt || fallback);
    } else {
      setValues([]);
      setSystemPrompt('');
    }
  }, [variable, open, aiGenerateContext?.defaultSystemPrompt]);

  const handleGenerate = async () => {
    if (!systemPrompt.trim()) {
      toast.error(t('varEditor.systemPromptRequired'));
      return;
    }

    if (!variable) return;

    setGenerating(true);
    try {
      const result = await api.generateVariableValues(systemPrompt, variable.name, generateCount, {
        image_url: aiGenerateContext?.imageUrl,
        template_context: aiGenerateContext?.templateContext,
      });

      if (result.values && result.values.length > 0) {
        const newItems: VariableValue[] = result.values.map(value => ({
          id: uuidv4(),
          value: value.trim(),
          status: 'new',
        }));

        setValues(prev => [...prev, ...newItems]);
        toast.success(t('varEditor.generated', { count: newItems.length }));
      } else {
        toast.error(t('varEditor.generateFailed'));
      }
    } catch (error: any) {
      toast.error(error?.message || t('varEditor.generateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const handleRemoveValue = (id: string) => {
    setValues(prev => prev.filter(v => v.id !== id));
  };

  const handleClearAll = () => {
    setValues([]);
    toast.success(t('varEditor.clearedAll'));
  };

  const handleAddSingle = () => {
    if (!newValue.trim()) return;
    setValues(prev => [...prev, { id: uuidv4(), value: newValue.trim(), status: 'new' }]);
    setNewValue('');
  };

  const handleAddMultiple = () => {
    if (!newValue.trim()) return;
    const lines = newValue.split(/\n/).map(s => s.trim()).filter(Boolean);
    const newItems: VariableValue[] = lines.map(v => ({ id: uuidv4(), value: v, status: 'new' }));
    setValues(prev => [...prev, ...newItems]);
    setNewValue('');
    toast.success(`เพิ่ม ${newItems.length} ค่า`);
  };

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!variable) return;
    setSaving(true);
    try {
      await onSave({
        ...variable,
        values,
        system_prompt: systemPrompt,
      });
      toast.success(t('channel.varSaved'));
      onClose();
    } catch (err) {
      console.error('Save failed:', err);
      toast.error(t('channel.varSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const newCount = values.filter(v => v.status === 'new').length;
  const usedCount = values.filter(v => v.status === 'used').length;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="text-lg">
            {labelOverrides?.title || variable?.name || ''}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-5">
          {/* Stats Row */}
          <div className="flex items-center gap-3 pb-3 border-b border-gray-700">
            <Badge variant="outline" className="bg-[#FFB300]/10 text-[#FFB300] border-[#FFB300]/30 px-3 py-1">
              {newCount} {t('varEditor.new')}
            </Badge>
            <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30 px-3 py-1">
              {usedCount} {t('varEditor.used')}
            </Badge>
            <Badge variant="outline" className="px-3 py-1">
              {values.length} {t('varEditor.total')}
            </Badge>
          </div>

          {/* AI Generate Section — hidden for AI Prompt System */}
          {!hideAiGenerate && (
            <div className="border border-[#FFB300]/30 rounded-lg p-4 bg-[#FFB300]/5 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#FFB300]" />
                <Label className="text-[#FFB300] font-medium text-sm">{labelOverrides?.systemPromptLabel || t('varEditor.systemPromptLabel')}</Label>
              </div>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('varEditor.systemPromptPlaceholder')}
                rows={3}
                className="bg-gray-900/50 border-gray-700 text-sm resize-none"
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-gray-400">{t('varEditor.count')}</Label>
                  <Input
                    type="number"
                    value={generateCount}
                    onChange={(e) => setGenerateCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                    min={1}
                    max={100}
                    className="w-20 h-9 bg-gray-900/50 border-gray-700 text-sm text-center"
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !systemPrompt.trim()}
                  className="bg-[#FFB300] text-black hover:bg-[#FFC233]"
                  size="default"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('varEditor.generating')}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      {t('varEditor.generate')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Current Values */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{labelOverrides?.currentValuesLabel || t('varEditor.currentValues')} ({values.length})</Label>
              {values.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  {t('varEditor.clearAll')}
                </Button>
              )}
            </div>

            {/* Add values — above the list */}
            <div className="flex gap-2">
              <Textarea
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                placeholder="วาง 1 ค่าต่อ 1 บรรทัด"
                rows={2}
                className="bg-gray-900/50 border-gray-700 text-sm flex-1 resize-none"
              />
              <Button type="button" size="sm" onClick={handleAddMultiple} disabled={!newValue.trim()} className="h-auto px-3 self-stretch">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="h-[180px] border border-gray-700 rounded-lg p-2 bg-gray-900/30 overflow-hidden">
              {values.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  {t('varEditor.emptyHint')}
                </div>
              ) : (
                <div className="space-y-1 pr-2 overflow-hidden">
                  {values.map((value) => (
                    <div
                      key={value.id}
                      className="flex items-start gap-2 p-2 bg-muted/30 rounded group hover:bg-muted/50 min-w-0"
                    >
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                          value.status === 'new' ? 'bg-[#FFB300]' : 'bg-gray-500'
                        }`}
                        title={value.status === 'new' ? t('varEditor.new') : t('varEditor.used')}
                      />
                      <span className="flex-1 text-sm min-w-0 break-words">{value.value}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveValue(value.id)}
                        className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0 flex-shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

          </div>

        </div>

        {/* Actions — fixed at bottom */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-700 bg-background">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving} className="bg-[#FFB300] text-black hover:bg-[#FFC233]">
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {t('varEditor.saveChanges')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VariableEditorModal;
