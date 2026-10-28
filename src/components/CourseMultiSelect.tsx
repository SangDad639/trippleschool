import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';

/**
 * ดรอปดาวน์เลือกหลายคอร์ส (ใช้ในแบบสอบถามหลังซื้อ ข้อ 2)
 *   · เปิดครั้งแรกโหลด "คอร์สล่าสุด" pageSize (8) ใบแรก (GET /api/courses?sort=new&type=course&limit=8&offset=0)
 *   · เลื่อนถึงท้ายรายการ → โหลดเพิ่มทีละ pageSize อัตโนมัติ (IntersectionObserver ใน popover เอง) จนครบ
 *   · 8 ใบแรกอยู่ใต้หัวกลุ่ม "คอร์สล่าสุด" ที่เหลือ "คอร์สอื่น ๆ" · ตัด excludeIds (คอร์สที่เพิ่งซื้อ) ออก
 *   · คอร์สที่เลือกแล้วขึ้นเป็น chip ใต้ช่อง กดเอาออกได้ · เลือกได้สูงสุด max
 */
export interface PickerCourse {
  id: number;
  name: string;
  slug: string;
  thumbnail_url?: string | null;
  cover_rev?: string | null;
  created_at?: string;
}

interface CourseMultiSelectProps {
  value: number[];
  onChange: (ids: number[]) => void;
  /** คอร์สที่ไม่ต้องโชว์ (เช่น คอร์สที่เพิ่งซื้อ) */
  excludeIds?: number[];
  max?: number;
  pageSize?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

const fmtDay = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
};

const CourseMultiSelect = ({
  value,
  onChange,
  excludeIds = [],
  max = 20,
  pageSize = 8,
  placeholder = 'เลือกคอร์สที่สนใจ…',
  disabled = false,
  id,
}: CourseMultiSelectProps) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PickerCourse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // refs กัน closure เก่าใน observer / กันยิงซ้ำระหว่างโหลด
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const loadedOnceRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(false);
    try {
      const rows = (await api.getCourses({ sort: 'new', type: 'course', limit: pageSize, offset: offsetRef.current })) as PickerCourse[];
      const list = Array.isArray(rows) ? rows : [];
      setItems((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...list.filter((c) => !seen.has(c.id))];
      });
      offsetRef.current += list.length;
      loadedOnceRef.current = true;
      const more = list.length === pageSize;
      hasMoreRef.current = more;
      setHasMore(more);
    } catch (e) {
      console.error('CourseMultiSelect load failed:', e);
      setError(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [pageSize]);

  // เปิดครั้งแรก → โหลดหน้าแรก
  useEffect(() => {
    if (open && !loadedOnceRef.current) void loadMore();
  }, [open, loadMore]);

  // sentinel ท้ายรายการโผล่ในกรอบเลื่อน (root = รายการเอง เพราะอยู่ใน Portal) → โหลดหน้าถัดไป
  useEffect(() => {
    if (!open) return;
    const root = listRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((en) => en.isIntersecting)) void loadMore(); },
      // rootMargin 0: หน้าแรก 8 ใบสูงกว่ากรอบ (max-h-72) → หน้า 2 โหลดเมื่อผู้ใช้เลื่อนถึงท้ายจริง ๆ
      { root, threshold: 0, rootMargin: '0px' }
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, [open, items.length, hasMore, loadMore]);

  const selectedSet = new Set(value);
  const atMax = value.length >= max;
  const toggle = (cid: number) => {
    if (selectedSet.has(cid)) onChange(value.filter((v) => v !== cid));
    else if (!atMax) onChange([...value, cid]);
  };
  const nameOf = (cid: number) => items.find((c) => c.id === cid)?.name || `คอร์ส #${cid}`;
  const excluded = new Set(excludeIds);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={`w-full h-11 md:h-10 flex items-center justify-between gap-2 rounded-md border bg-gray-900/50 px-3 text-left text-base md:text-sm transition-colors disabled:opacity-50 ${open ? 'border-purple-500 ring-2 ring-purple-500/25' : 'border-gray-700 hover:border-gray-500'}`}
            data-testid="course-multi-select"
          >
            <span className={value.length ? 'text-white' : 'text-gray-500'}>
              {value.length ? `เลือกแล้ว ${value.length} / ${max} คอร์ส` : placeholder}
            </span>
            {open ? <ChevronUp className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-[280px] p-0 bg-gray-900 border-gray-700 text-white">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 text-xs text-gray-400">
            <span>เลือกแล้ว <span className="text-white font-medium">{value.length}</span> / {max}</span>
            {value.length > 0 && (
              <button type="button" className="underline underline-offset-2 hover:text-white" onClick={() => onChange([])}>ล้างที่เลือก</button>
            )}
          </div>
          <div ref={listRef} role="listbox" aria-multiselectable="true" aria-label="เลือกคอร์สที่สนใจ" className="max-h-72 overflow-y-auto overscroll-contain" data-testid="course-multi-select-list">
            {items.map((c, i) => {
              // หัวกลุ่มยึดตามลำดับจาก server (i) — ไม่ผูกกับแถว เพราะแถวแรกอาจเป็นคอร์สที่ถูกตัดออก
              const hidden = excluded.has(c.id);
              const checked = selectedSet.has(c.id);
              const blocked = !checked && atMax;
              return (
                <div key={c.id}>
                  {i === 0 && (
                    <div className="flex justify-between px-3 pt-2 pb-1 text-[11px] font-medium text-[#FFB300]" data-testid="course-group-latest">
                      <span>🆕 คอร์สล่าสุด</span><span className="text-gray-500 font-normal">{pageSize} คอร์สแรก</span>
                    </div>
                  )}
                  {i === pageSize && (
                    <div className="flex justify-between px-3 pt-2 pb-1 mt-1 border-t border-gray-800 text-[11px] font-medium text-gray-400" data-testid="course-group-rest">
                      <span>คอร์สอื่น ๆ</span><span className="text-gray-500 font-normal">โหลดเพิ่มทีละ {pageSize}</span>
                    </div>
                  )}
                  {!hidden && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    disabled={blocked}
                    onClick={() => toggle(c.id)}
                    title={blocked ? `เลือกได้สูงสุด ${max} คอร์ส` : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left min-h-[44px] transition-colors ${checked ? 'bg-purple-600/15' : 'hover:bg-white/5'} disabled:opacity-40 disabled:cursor-not-allowed`}
                    data-testid={`course-option-${c.id}`}
                  >
                    <span className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-purple-600 border-purple-600' : 'border-purple-500/60'}`} aria-hidden="true">
                      {checked && <Check className="h-3.5 w-3.5 text-white" />}
                    </span>
                    <img
                      src={api.courseCoverUrl(c, 'card')}
                      alt=""
                      loading="lazy"
                      className="w-12 h-7 rounded object-cover bg-gray-800 shrink-0"
                    />
                    <span className="flex-1 min-w-0 truncate text-sm">{c.name}</span>
                    <span className="text-xs text-gray-500 shrink-0">{fmtDay(c.created_at)}</span>
                  </button>
                  )}
                </div>
              );
            })}
            {/* ท้ายรายการ: สถานะโหลด + sentinel สำหรับ infinite load */}
            <div ref={sentinelRef} className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-gray-400" aria-live="polite" data-testid="course-multi-select-footer">
              {error ? (
                <>
                  <span className="text-red-400">โหลดคอร์สไม่สำเร็จ</span>
                  <button type="button" className="underline underline-offset-2 hover:text-white" onClick={() => { hasMoreRef.current = true; setHasMore(true); void loadMore(); }}>ลองใหม่</button>
                </>
              ) : loading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังโหลดคอร์สเพิ่ม…</>
              ) : hasMore ? (
                <span>เลื่อนลงเพื่อดูคอร์สอื่น ๆ</span>
              ) : items.length === 0 ? (
                <span>ยังไม่มีคอร์ส</span>
              ) : (
                <span>ครบทุกคอร์สแล้ว ✅</span>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="course-multi-select-chips">
          {value.map((cid) => (
            <span key={cid} className="inline-flex items-center gap-1 max-w-full rounded-full border border-purple-500/50 bg-purple-900/30 text-purple-100 pl-2.5 pr-1 py-0.5 text-xs">
              <span className="truncate max-w-[220px]">{nameOf(cid)}</span>
              <button
                type="button"
                aria-label={`เอา ${nameOf(cid)} ออก`}
                onClick={() => onChange(value.filter((v) => v !== cid))}
                className="h-5 w-5 rounded-full flex items-center justify-center hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default CourseMultiSelect;
