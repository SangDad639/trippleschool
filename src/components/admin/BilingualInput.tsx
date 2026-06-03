import { useState, useRef, useEffect } from 'react';
import { Loader2, Languages } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

interface BilingualInputProps {
  value: { th: string; en: string };
  onChange: (v: { th: string; en: string }) => void;
  labelTh?: string;
  labelEn?: string;
  placeholderTh?: string;
  placeholderEn?: string;
  className?: string;
}

/**
 * Two text inputs (TH + EN) with auto-translate on blur:
 * - Type Thai → blur → auto-translates to English (only if English empty)
 * - Type English → blur → auto-translates to Thai (only if Thai empty)
 * - Existing values are never overwritten
 */
export function BilingualInput({
  value,
  onChange,
  labelTh = 'หัวข้อ (ไทย)',
  labelEn = 'หัวข้อ (English)',
  placeholderTh,
  placeholderEn,
  className = '',
}: BilingualInputProps) {
  const [busy, setBusy] = useState<'th' | 'en' | null>(null);
  const lastTranslatedRef = useRef<{ th: string; en: string }>({ th: '', en: '' });
  // Track which side the user is actively typing in (so we don't translate "back" on the just-translated side)
  const focusedRef = useRef<'th' | 'en' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-translate as user types (debounced) — translates the FOCUSED side to the OTHER side
  useEffect(() => {
    const source = focusedRef.current;
    if (!source) return;
    const sourceText = value[source].trim();
    if (!sourceText) return;
    if (lastTranslatedRef.current[source] === sourceText) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const target = source === 'th' ? 'en' : 'th';
      setBusy(target);
      try {
        const r = await api.translateText(sourceText, target);
        const translated = r.translation?.trim();
        if (translated) {
          lastTranslatedRef.current[source] = sourceText;
          onChange({ ...value, [target]: translated });
        }
      } catch { /* silent */ } finally {
        setBusy(null);
      }
    }, 700);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.th, value.en]);

  return (
    <div className={`grid grid-cols-2 gap-3 ${className}`}>
      <div>
        <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
          {labelTh}
          {busy === 'th' && <Loader2 className="h-3 w-3 animate-spin text-[#FFB300]" />}
        </label>
        <Input
          value={value.th}
          onFocus={() => { focusedRef.current = 'th'; }}
          onChange={e => onChange({ ...value, th: e.target.value })}
          placeholder={placeholderTh}
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
          {labelEn}
          {busy === 'en' && <Loader2 className="h-3 w-3 animate-spin text-[#FFB300]" />}
          {busy === null && (value.th || value.en) && (
            <Languages className="h-3 w-3 text-muted-foreground/50" aria-label="auto-translate active" />
          )}
        </label>
        <Input
          value={value.en}
          onFocus={() => { focusedRef.current = 'en'; }}
          onChange={e => onChange({ ...value, en: e.target.value })}
          placeholder={placeholderEn}
        />
      </div>
    </div>
  );
}

export default BilingualInput;
