import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Loader2, ListVideo, Play, Plus, Timer, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { checkChapterText, formatChapterText, formatSec, parseChapterText, type LengthHint } from '@/lib/chapters';
import { loadYouTubeIframeApi, type YTPlayer } from '@/lib/youtubeIframeApi';
import type { ChaptersSource, LessonChapter } from '@/types/lesson';

/**
 * ส่วน "📑 บทในคลิป" ใน dialog แก้ไขบทเรียน (072) — แก้ทีละบทเป็น "แถว" (user 16 ก.ย.: แบบพิมพ์ข้อความล้วนแก้ยาก)
 *   - player ตัวเล็กอยู่บนสุด: เล่นไปถึงจุดที่ต้องการ → กด ⏱ ที่แถว = ใส่เวลาให้ · ▶ ที่แถว = กระโดดไปดูจุดนั้น
 *   - แต่ละแถว: [ภาพเฟรม] [เวลา m:ss] [⏱] [▶] [🗑] + ช่องชื่อบท · เรียงตามเวลาอัตโนมัติเมื่อออกจากช่องเวลา · แถวผิดขึ้นสีแดงบอกเหตุผล
 *   - 🪄 สร้างอัตโนมัติ (ดึงซับ + AI, ยังไม่บันทึก) · + เพิ่มบท (เวลา = ตำแหน่ง player ตอนนี้) · โหมดข้อความ (วางจาก YouTube Studio ทีเดียวหลายบท)
 * บันทึกไปกับ "บันทึกบทเรียน" (field chapters + chapters_source) — เซิร์ฟเวอร์เทียบกับของเดิม ถ้าไม่เปลี่ยนจะไม่แตะแหล่ง
 */
interface Props {
  /** null = บทใหม่ยังไม่บันทึก (🪄 ยังใช้ไม่ได้) */
  lessonId: number | null;
  /** id คลิปจากช่อง YouTube URL ของฟอร์ม (เปลี่ยนตามที่แอดมินพิมพ์) — ใช้กับ player */
  youtubeId: string | null;
  /** id คลิปที่บันทึกไว้ (เทียบว่าแอดมินเปลี่ยนคลิปหรือยัง) */
  savedYoutubeId?: string | null;
  value: LessonChapter[];
  onChange: (chapters: LessonChapter[], source: ChaptersSource) => void;
  source?: ChaptersSource | null;
  updatedAt?: string | null;
}

interface Row {
  key: number;
  /** ข้อความเวลาตามที่พิมพ์ เช่น "2:30" */
  time: string;
  title: string;
  /** ภาพเฟรมเดิม (คงไว้ถ้าเวลาไม่เปลี่ยน) */
  thumb?: string;
}

const SOURCE_LABEL: Record<ChaptersSource, { text: string; cls: string }> = {
  ai: { text: '🤖 AI สรุปจากซับ', cls: 'bg-purple-500/15 text-purple-300' },
  youtube: { text: '▶ จาก timestamp ใน YouTube', cls: 'bg-red-500/15 text-red-300' },
  manual: { text: '✏️ แก้เอง', cls: 'bg-yellow-500/15 text-yellow-300' },
};
const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
};
let keySeq = 1;
const toRows = (chapters: LessonChapter[]): Row[] => chapters.map((c) => ({ key: keySeq++, time: formatSec(c.sec), title: c.title, thumb: c.thumb }));
const rowsText = (rows: Row[]) => rows.map((r) => `${r.time.trim()} ${r.title.trim()}`).join('\n');

export function LessonChaptersEditor({ lessonId, youtubeId, savedYoutubeId, value, onChange, source, updatedAt }: Props) {
  const [rows, setRows] = useState<Row[]>(() => toRows(value));
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');
  /** ข้อความที่ตรงกับที่บันทึกไว้แล้ว — ต่างจากนี้ = "ยังไม่บันทึก" */
  const savedText = useRef(formatChapterText(value));
  const [busy, setBusy] = useState(false);
  const [length, setLength] = useState<LengthHint | null>(null);
  /** แหล่งของบทในกล่องตอนนี้: manual เมื่อแก้เอง · ai/youtube เมื่อมาจาก 🪄 และยังไม่แก้ */
  const [liveSource, setLiveSource] = useState<ChaptersSource | null | undefined>(source);
  const [playerReady, setPlayerReady] = useState(false);
  const [playSec, setPlaySec] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [startAt, setStartAt] = useState<{ sec: number; n: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const lastEmitted = useRef<string>(JSON.stringify(value.map((c) => [c.sec, c.title])));
  const titleRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const focusKey = useRef<number | null>(null);
  const videoChanged = !!savedYoutubeId && !!youtubeId && youtubeId !== savedYoutubeId;

  // ค่าจากข้างนอกเปลี่ยน (เปิดบทอื่น / ฟอร์มถูกรีเซ็ตหลัง "บันทึกและเพิ่มต่อ") → ตามให้
  useEffect(() => {
    const key = JSON.stringify(value.map((c) => [c.sec, c.title]));
    if (key === lastEmitted.current) return;
    lastEmitted.current = key;
    savedText.current = formatChapterText(value);
    setRows(toRows(value));
    setText(formatChapterText(value));
    setLiveSource(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // ความยาวคลิป (ไว้เตือน "เกินความยาว") — เฉพาะบทที่บันทึกแล้วและยังไม่เปลี่ยนคลิป
  useEffect(() => {
    if (!lessonId || videoChanged) { setLength(null); return; }
    api.getLessonChaptersStatus(lessonId)
      .then((s) => { if (s?.length_sec) setLength({ sec: s.length_sec, exact: !!s.length_exact }); })
      .catch(() => { /* ไม่มีก็ไม่เตือน */ });
  }, [lessonId, videoChanged]);

  // ตรวจสด: ใช้ตัวตรวจเดียวกับโหมดข้อความ (บรรทัด = แถว)
  const currentText = textMode ? text : rowsText(rows);
  const checks = useMemo(() => checkChapterText(currentText, length), [currentText, length]);
  const valid = useMemo(() => parseChapterText(currentText, length), [currentText, length]);
  const checkByLine = useMemo(() => new Map(checks.map((c) => [c.line, c])), [checks]);
  const dirty = formatChapterText(valid) !== savedText.current || (rows.length !== valid.length && !textMode);
  const firstNotZero = valid.length > 0 && valid[0].sec !== 0;

  // emit เฉพาะเมื่อรายการที่ใช้ได้เปลี่ยนจริง · คงภาพเฟรมของเวลาเดิมให้ (เซิร์ฟเวอร์ก็ merge อีกชั้น)
  useEffect(() => {
    const key = JSON.stringify(valid.map((c) => [c.sec, c.title]));
    if (key === lastEmitted.current) return;
    lastEmitted.current = key;
    const thumbBySec = new Map<number, string>();
    for (const v of value) if (v.thumb) thumbBySec.set(v.sec, v.thumb);
    onChange(valid.map((c) => (thumbBySec.has(c.sec) ? { ...c, thumb: thumbBySec.get(c.sec) } : c)), liveSource === 'ai' || liveSource === 'youtube' ? liveSource : 'manual');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid]);

  // โฟกัสช่องชื่อของแถวที่เพิ่งเพิ่ม
  useEffect(() => {
    if (focusKey.current == null) return;
    const el = titleRefs.current.get(focusKey.current);
    focusKey.current = null;
    el?.focus();
  }, [rows]);

  const markManual = () => setLiveSource('manual');
  const updateRow = (key: number, patch: Partial<Row>) => {
    markManual();
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, ...(patch.time !== undefined && patch.time !== r.time ? { thumb: undefined } : {}) } : r)));
  };
  const sortRows = () => setRows((prev) => {
    const sec = (r: Row) => { const c = checkChapterText(`${r.time} x`)[0]; return c && c.sec !== null ? c.sec : Number.MAX_SAFE_INTEGER; };
    return [...prev].sort((a, b) => sec(a) - sec(b));
  });
  const removeRow = (key: number) => { markManual(); setRows((prev) => prev.filter((r) => r.key !== key)); };
  const addRow = () => {
    markManual();
    const now = playerRef.current ? Math.floor(safeTime()) : null;
    const row: Row = { key: keySeq++, time: now != null && now > 0 ? formatSec(now) : rows.length === 0 ? '0:00' : '', title: '' };
    focusKey.current = row.key;
    setRows((prev) => [...prev, row]);
  };
  const clearAll = () => { markManual(); setRows([]); setText(''); };

  const enterTextMode = () => { setText(rowsText(rows)); setTextMode(true); };
  const leaveTextMode = () => {
    const parsed = parseChapterText(text, length);
    const thumbBySec = new Map(value.filter((v) => v.thumb).map((v) => [v.sec, v.thumb!]));
    setRows(parsed.map((c) => ({ key: keySeq++, time: formatSec(c.sec), title: c.title, thumb: thumbBySec.get(c.sec) })));
    setTextMode(false);
  };

  const autoGenerate = async () => {
    if (!lessonId) return;
    if (valid.length && !confirm('มีบทอยู่แล้ว — สร้างใหม่ทับทั้งหมด? (ยังไม่บันทึกจนกว่าจะกด "บันทึกบทเรียน")')) return;
    setBusy(true);
    const t = toast.loading('กำลังดึงซับจาก YouTube แล้วให้ AI แบ่งบท… (10-40 วิ)');
    try {
      const r = await api.autoLessonChapters(lessonId, false);
      setLiveSource(r.source);
      setRows(toRows(r.chapters));
      setText(formatChapterText(r.chapters));
      if (r.length_sec) setLength({ sec: r.length_sec, exact: true });
      toast.success(`ได้ ${r.chapters.length} บท (${r.source === 'youtube' ? 'จาก timestamp ใน YouTube' : 'AI สรุปจากซับ'}) — แก้ได้เลย แล้วกด "บันทึกบทเรียน"`, { id: t, duration: 7000 });
    } catch (err: any) {
      toast.error(err?.message || 'สร้างบทไม่สำเร็จ', { id: t, duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  // ---- player ตัวเล็ก (โหลดทันทีเมื่อมีคลิป — เป็นหัวใจของการแก้แบบ "เล่นแล้วกด ⏱") ----
  const safeTime = () => { try { return playerRef.current?.getCurrentTime() ?? 0; } catch { return 0; } };
  const params = new URLSearchParams({ rel: '0', enablejsapi: '1', origin: window.location.origin });
  if (startAt) { params.set('start', String(startAt.sec)); params.set('autoplay', '1'); }
  useEffect(() => {
    if (!youtubeId || !iframeRef.current) return;
    let cancelled = false;
    let poll: number | undefined;
    const stop = () => { if (poll) { window.clearInterval(poll); poll = undefined; } };
    setPlayerReady(false);
    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !iframeRef.current) return;
        playerRef.current = new YT.Player(iframeRef.current, {
          events: {
            onReady: () => setPlayerReady(true),
            onStateChange: (e) => {
              const isPlaying = e.data === YT.PlayerState.PLAYING;
              setPlaying(isPlaying);
              if (isPlaying && !poll) poll = window.setInterval(() => setPlaySec(safeTime()), 500);
              else if (!isPlaying) { stop(); setPlaySec(safeTime()); }
            },
          },
        });
      })
      .catch(() => { /* ไม่มี API: ▶ จะโหลด iframe ใหม่ด้วย ?start= แทน · ⏱ ใช้ไม่ได้ */ });
    return () => { cancelled = true; stop(); playerRef.current = null; setPlayerReady(false); };
  }, [youtubeId, startAt?.n]);
  const seek = (sec: number) => {
    const p = playerRef.current;
    if (p) { try { p.seekTo(sec, true); p.playVideo(); setPlaySec(sec); return; } catch { /* fallback */ } }
    playerRef.current = null;
    setPlaySec(sec);
    setStartAt((s) => ({ sec, n: (s?.n ?? 0) + 1 }));
  };
  const useCurrentTime = (key: number) => {
    const sec = Math.floor(safeTime());
    updateRow(key, { time: formatSec(sec) });
    toast.success(`ตั้งเวลาเป็น ${formatSec(sec)} แล้ว`, { duration: 1500 });
  };

  const srcLabel = liveSource ? SOURCE_LABEL[liveSource] : null;
  const activeKey = (() => {
    if (playSec === null) return null;
    let best: { key: number; sec: number } | null = null;
    rows.forEach((r, i) => { const c = checkByLine.get(i + 1); if (c && !c.error && c.sec !== null && c.sec <= playSec && (!best || c.sec > best.sec)) best = { key: r.key, sec: c.sec }; });
    return best?.key ?? null;
  })();

  return (
    <div className="border-t border-gray-800 pt-4" data-testid="lesson-chapters-editor">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <Label className="flex items-center gap-1.5 flex-wrap">
            <ListVideo className="h-4 w-4 text-purple-400" /> 📑 บทในคลิป
            {srcLabel ? (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${srcLabel.cls}`} data-testid="chapters-source">
                {srcLabel.text}{dirty ? ' (ยังไม่บันทึก)' : updatedAt ? ` · ${fmtDate(updatedAt)}` : ''}
              </span>
            ) : (
              <span className="rounded-full px-2 py-0.5 text-[11px] bg-white/5 text-gray-400">ยังไม่มี</span>
            )}
          </Label>
          <p className="text-xs text-gray-500 mt-0.5">
            เล่นคลิปด้านล่างไปถึงจุดที่บทเริ่ม แล้วกด ⏱ ที่แถวนั้น = ใส่เวลาให้ · แก้ชื่อได้เลย · ระบบสร้างให้เองจากซับเป็นค่าเริ่มต้น
            {length ? ` · คลิปยาว${length.exact ? '' : 'ประมาณ'} ${formatSec(length.sec)}` : ''}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Button type="button" size="sm" onClick={autoGenerate} disabled={busy || !lessonId || videoChanged} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black" title={!lessonId ? 'บันทึกบทเรียนก่อน แล้วกลับมากด' : videoChanged ? 'บันทึกลิงก์คลิปใหม่ก่อน แล้วกลับมากด' : 'ดึงซับจาก YouTube แล้วให้ AI แบ่งบท'} data-testid="chapters-auto">
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
            สร้างอัตโนมัติ
          </Button>
          {textMode ? (
            <Button type="button" size="sm" variant="outline" onClick={leaveTextMode} data-testid="chapters-text-mode">กลับเป็นแถว</Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={enterTextMode} title="วางหลายบทจาก YouTube Studio ทีเดียว (บรรทัดละ นาที:วินาที ชื่อบท)" data-testid="chapters-text-mode">
              <ClipboardList className="h-3.5 w-3.5 mr-1" /> วางเป็นข้อความ
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={clearAll} disabled={!rows.length && !text.trim()} className="text-gray-400">ล้าง</Button>
        </div>
      </div>
      {!lessonId && (
        <p className="text-[11px] text-yellow-400 mt-2">บทใหม่: บันทึกบทเรียนก่อน ระบบจะสร้างบทในคลิปให้เองเบื้องหลัง (หรือกลับมากด "สร้างอัตโนมัติ")</p>
      )}
      {videoChanged && (
        <p className="text-[11px] text-yellow-400 mt-2" data-testid="chapters-video-changed">
          เปลี่ยนคลิปแล้ว — ถ้าไม่แก้บทตรงนี้ ระบบจะล้างบทเดิมและสร้างใหม่ให้เองหลังบันทึก · ถ้าใส่บทของคลิปใหม่ไว้ที่นี่จะใช้ที่ใส่แทน
        </p>
      )}

      {/* player: เล่นไปถึงจุดที่ต้องการแล้วกด ⏱ ที่แถว */}
      {youtubeId && (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="aspect-video w-full sm:w-[300px] shrink-0 rounded-md overflow-hidden bg-black border border-gray-800">
            <iframe
              ref={iframeRef}
              key={`pv-${youtubeId}-${startAt?.n ?? 0}`}
              src={`https://www.youtube.com/embed/${youtubeId}?${params.toString()}`}
              title="พรีวิว"
              className="w-full h-full"
              allow="autoplay; encrypted-media"
              allowFullScreen
            />
          </div>
          <div className="text-xs text-gray-400 space-y-1">
            <p>ตำแหน่ง player ตอนนี้: <span className="font-mono text-white tabular-nums" data-testid="chapters-player-time">{playSec !== null ? formatSec(playSec) : '—'}</span>{playing ? ' (กำลังเล่น)' : ''}</p>
            <p>▶ ที่แถว = กระโดดไปดูจุดนั้น · ⏱ ที่แถว = ใช้เวลาตอนนี้ของ player{!playerReady ? ' (กำลังโหลด player…)' : ''}</p>
          </div>
        </div>
      )}

      {textMode ? (
        <div className="mt-3">
          <Textarea
            value={text}
            onChange={(e) => { markManual(); setText(e.target.value); }}
            rows={8}
            spellCheck={false}
            placeholder={'0:00 แนะนำคอร์ส\n2:30 ติดตั้งโปรแกรม\n7:15 ตัวอย่างการใช้งานจริง'}
            className="font-mono text-sm leading-relaxed"
            data-testid="chapters-text"
          />
          <p className="text-[11px] text-gray-500 mt-1">บรรทัดละบท <span className="font-mono">นาที:วินาที ชื่อบท</span> · ก๊อปจาก YouTube Studio มาวางได้ · กด "กลับเป็นแถว" เพื่อแก้ทีละบท</p>
          {checks.some((c) => c.error) && (
            <ul className="mt-2 text-[11px] text-red-400 list-disc pl-5">
              {checks.filter((c) => c.error).map((c) => <li key={c.line}>บรรทัด {c.line}: {c.error}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5" data-testid="chapters-rows">
          {rows.length === 0 && (
            <p className="text-gray-500 text-xs rounded-md border border-dashed border-gray-800 p-3 text-center">ยังไม่มีบท — กด "สร้างอัตโนมัติ" หรือ "เพิ่มบท"</p>
          )}
          {rows.map((r, i) => {
            const c = checkByLine.get(i + 1);
            const err = c?.error ?? (r.time.trim() || r.title.trim() ? null : null);
            const isActive = r.key === activeKey;
            return (
              <div
                key={r.key}
                data-testid="chapter-edit-row"
                className={`rounded-md border p-2 flex flex-wrap items-center gap-2 ${c?.error ? 'border-red-500/50 bg-red-500/5' : isActive ? 'border-purple-400/50 bg-purple-500/10' : 'border-gray-800 bg-gray-900/40'}`}
              >
                {r.thumb ? (
                  <img src={api.mediaUrl(r.thumb)} alt="" className="w-14 h-8 rounded object-cover bg-black/40 border border-white/10 shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <span className="w-14 h-8 rounded bg-black/30 border border-dashed border-white/10 shrink-0" title="ภาพเฟรมจะทำให้เองหลังบันทึก" />
                )}
                <Input
                  value={r.time}
                  onChange={(e) => updateRow(r.key, { time: e.target.value })}
                  onBlur={sortRows}
                  placeholder="m:ss"
                  className={`w-[76px] h-8 font-mono text-sm text-center tabular-nums ${c?.error && c.sec === null ? 'border-red-500' : ''}`}
                  aria-label="เวลาเริ่มบท"
                  data-testid="chapter-time"
                />
                <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => useCurrentTime(r.key)} disabled={!playerReady} title="ใช้เวลาตอนนี้ของ player" data-testid="chapter-use-time">
                  <Timer className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => c && c.sec !== null && seek(c.sec)} disabled={!youtubeId || !c || c.sec === null} title="ไปดูจุดนี้ใน player" data-testid="chapter-seek">
                  <Play className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 ml-auto text-red-400 hover:text-red-500" onClick={() => removeRow(r.key)} aria-label="ลบบท" data-testid="chapter-remove">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Input
                  ref={(el) => { if (el) titleRefs.current.set(r.key, el); else titleRefs.current.delete(r.key); }}
                  value={r.title}
                  onChange={(e) => updateRow(r.key, { title: e.target.value })}
                  placeholder="ชื่อบท เช่น ติดตั้งโปรแกรม"
                  className="basis-full h-9 text-sm"
                  aria-label="ชื่อบท"
                  data-testid="chapter-title"
                />
                {(c?.error || c?.warn) && (
                  <p className={`basis-full text-[11px] ${c?.error ? 'text-red-400' : 'text-yellow-500'}`}>{c?.error ?? c?.warn}</p>
                )}
                {!c?.error && err === null && !r.title.trim() && r.time.trim() && (
                  <p className="basis-full text-[11px] text-gray-500">พิมพ์ชื่อบท</p>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2 flex-wrap mt-1">
            <Button type="button" size="sm" variant="outline" onClick={addRow} data-testid="chapter-add">
              <Plus className="h-3.5 w-3.5 mr-1" /> เพิ่มบท{playerReady && playSec ? ` ที่ ${formatSec(Math.floor(playSec))}` : ''}
            </Button>
            <p className="text-[11px] text-gray-500">
              ใช้ได้ {valid.length} บท{checks.filter((c) => c.error).length ? ` · ${checks.filter((c) => c.error).length} แถวยังไม่ครบ` : ''}{firstNotZero ? ' · บทแรกควรเริ่ม 0:00' : ''} · ผู้เรียนเห็นเฉพาะแถวที่ครบ
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default LessonChaptersEditor;
