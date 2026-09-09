import { useEffect, useRef, useState } from 'react';
import { Plus, X, Clapperboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { LessonPromoSlot, PromoAdmin } from '@/types/promo';

/**
 * ส่วน "🎬 โฆษณาแทรก" ใน dialog แก้ไขบทเรียน — จุดแทรกหลายจุดต่อบท
 *   แถวละ [ตำแหน่ง: ก่อนเริ่ม / นาทีที่ mm:ss] [เลือกโฆษณา] [ลบ]
 *   emit เป็น {promo_id, offset_sec}[] (offset 0 = ก่อนเริ่ม, ≥ 5 = กลางคลิป) — server ตรวจซ้ำอีกชั้น
 * รายการโฆษณาโหลดจาก /api/promos/admin/all (cache 60 วิ) — จัดการไฟล์ที่ /admin/promos
 */
interface Props {
  value: LessonPromoSlot[];
  onChange: (v: LessonPromoSlot[]) => void;
  /** ความยาวบท (นาที) — ใช้เตือนถ้าจุดแทรกเกินความยาว */
  durationMinutes?: number;
}

interface Row { key: number; position: 'pre' | 'mid'; min: string; sec: string; promo_id: number | null }

let promoCache: { at: number; promise: Promise<PromoAdmin[]> } | null = null;
function loadPromos(force = false): Promise<PromoAdmin[]> {
  if (!force && promoCache && Date.now() - promoCache.at < 60_000) return promoCache.promise;
  const promise = api.listPromosAdmin().then((r) => r.promos).catch(() => [] as PromoAdmin[]);
  promoCache = { at: Date.now(), promise };
  return promise;
}
/** ให้หน้า /admin/promos เรียกหลังแก้ไข เพื่อให้ dropdown ในบทเรียนเห็นค่าใหม่ทันที */
export function invalidatePromoCache() { promoCache = null; }

let keySeq = 1;
const fromValue = (v: LessonPromoSlot[]): Row[] =>
  v.map((s) => ({
    key: keySeq++,
    position: s.offset_sec === 0 ? 'pre' : 'mid',
    min: String(Math.floor(s.offset_sec / 60)),
    sec: String(s.offset_sec % 60),
    promo_id: s.promo_id,
  }));
const rowOffset = (r: Row) => (r.position === 'pre' ? 0 : (Number(r.min) || 0) * 60 + (Number(r.sec) || 0));
const toValue = (rows: Row[]): LessonPromoSlot[] => rows.map((r) => ({ promo_id: r.promo_id ?? 0, offset_sec: rowOffset(r) }));
const sameValue = (a: LessonPromoSlot[], b: LessonPromoSlot[]) =>
  a.length === b.length && a.every((x, i) => x.promo_id === b[i].promo_id && x.offset_sec === b[i].offset_sec);

export function LessonPromosEditor({ value, onChange, durationMinutes }: Props) {
  const [rows, setRows] = useState<Row[]>(() => fromValue(value));
  const [promos, setPromos] = useState<PromoAdmin[] | null>(null);
  const lastEmitted = useRef<LessonPromoSlot[]>(value);

  // parent reset (เปิดบทอื่น / "บันทึกแล้วเพิ่มบทต่อไป") → เริ่มแถวใหม่จาก value
  useEffect(() => {
    if (value !== lastEmitted.current && !sameValue(value, lastEmitted.current)) {
      lastEmitted.current = value;
      setRows(fromValue(value));
    }
  }, [value]);

  useEffect(() => {
    let alive = true;
    loadPromos().then((list) => { if (alive) setPromos(list); });
    return () => { alive = false; };
  }, []);

  const emit = (next: Row[]) => {
    setRows(next);
    const v = toValue(next);
    lastEmitted.current = v;
    onChange(v);
  };
  const update = (key: number, patch: Partial<Row>) => emit(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => emit(rows.filter((r) => r.key !== key));
  const add = () => {
    const hasPre = rows.some((r) => r.position === 'pre');
    emit([...rows, { key: keySeq++, position: hasPre ? 'mid' : 'pre', min: '0', sec: hasPre ? '30' : '0', promo_id: promos?.[0]?.id ?? null }]);
  };

  const maxSec = durationMinutes && durationMinutes > 0 ? durationMinutes * 60 : null;
  const offsets = rows.map(rowOffset);
  const rowError = (r: Row, i: number): string | null => {
    const off = offsets[i];
    if (r.promo_id == null) return 'เลือกโฆษณา';
    if (r.position === 'pre' && rows.filter((x) => x.position === 'pre').length > 1) return 'ก่อนเริ่มมีได้จุดเดียว';
    if (r.position === 'mid' && off < 5) return 'กลางคลิปต้องหลังวินาทีที่ 5';
    if (offsets.filter((o) => o === off).length > 1) return 'เวลาซ้ำกับจุดอื่น';
    if (maxSec && off > maxSec) return `เกินความยาวบท (${durationMinutes} นาที)`;
    return null;
  };

  return (
    <div className="border-t border-gray-800 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="flex items-center gap-1.5"><Clapperboard className="h-4 w-4 text-yellow-400" /> 🎬 โฆษณาแทรก</Label>
          <p className="text-xs text-gray-500 mt-0.5">
            เล่นก่อนเริ่มบท และ/หรือแทรกกลางคลิปตามนาทีที่ตั้ง · โฆษณาแต่ละตัวแสดงต่อผู้เรียน 1 คนได้ครั้งเดียวต่อ 7 วัน · จัดการคลิปโฆษณาที่หน้า "🎬 โฆษณา" ในแอดมิน
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={promos !== null && promos.length === 0}>
          <Plus className="h-3.5 w-3.5 mr-1" /> เพิ่มจุดแทรก
        </Button>
      </div>

      {promos !== null && promos.length === 0 && (
        <p className="text-xs text-yellow-400 mt-2">ยังไม่มีคลิปโฆษณาในระบบ — เพิ่มที่หน้า "🎬 โฆษณา" ก่อน</p>
      )}
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 italic mt-2">ไม่มีโฆษณาในบทนี้</p>
      ) : (
        <div className="space-y-2 mt-2">
          {rows.map((r, i) => {
            const err = rowError(r, i);
            return (
              <div key={r.key} className="rounded-lg border border-gray-800 bg-gray-900/40 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={r.position}
                    onChange={(e) => update(r.key, e.target.value === 'pre' ? { position: 'pre', min: '0', sec: '0' } : { position: 'mid', min: r.min, sec: rowOffset(r) < 5 ? '30' : r.sec })}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="pre">ก่อนเริ่มบท</option>
                    <option value="mid">กลางคลิป นาทีที่</option>
                  </select>
                  {r.position === 'mid' && (
                    <div className="flex items-center gap-1">
                      <Input type="number" min={0} value={r.min} onChange={(e) => update(r.key, { min: e.target.value })} className="h-9 w-16 text-center" aria-label="นาที" />
                      <span className="text-gray-500">:</span>
                      <Input type="number" min={0} max={59} value={r.sec} onChange={(e) => update(r.key, { sec: e.target.value })} className="h-9 w-16 text-center" aria-label="วินาที" />
                    </div>
                  )}
                  <select
                    value={r.promo_id ?? ''}
                    onChange={(e) => update(r.key, { promo_id: e.target.value ? Number(e.target.value) : null })}
                    className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">— เลือกโฆษณา —</option>
                    {(promos ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}{p.source_type === 'youtube' ? ' (YouTube)' : ' (ไฟล์)'}{p.is_active ? '' : ' — ปิดอยู่'}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0 text-red-400 hover:text-red-500" onClick={() => remove(r.key)} aria-label="ลบจุดแทรก">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {err && <p className="text-[11px] text-red-400 mt-1">⚠ {err}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default LessonPromosEditor;
