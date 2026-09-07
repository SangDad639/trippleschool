import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { loadPdfjs, pdfjsAssetBase, type PDFDocumentProxy } from '@/lib/pdfjs';

// ตัวอ่าน "ตัวอย่างจำกัดหน้า" แบบเลื่อนต่อเนื่อง — เรนเดอร์หน้า PDF ตัวอย่างเป็นรูปเรียงแนวตั้ง
// เลื่อนอ่านในหน้าเว็บได้เลย และเมื่อเลื่อนผ่านหน้าสุดท้ายจะเจอบล็อกชวนสมัครสมาชิกที่หน้า
// EbookDetail ส่งเข้ามาเป็น render-prop (รับจำนวนหน้าจริงที่เรนเดอร์ได้)
// รับ `slug` ไม่ใช่ URL → สร้าง URL จาก api.ebookPreviewUrl เองเสมอ = ไม่มีทางถูกชี้ไปไฟล์เต็ม
// component ฝั่ง Ebook แยกจาก Course โดยเจตนา

const MAX_DPR = 2;
const MAX_CANVAS_SIDE = 4096;      // iOS Safari จำกัดขนาด canvas — เกินนี้วาดไม่ออก/เมมหมด
const MIN_RENDER_WIDTH = 720;      // ความกว้าง CSS ขั้นต่ำที่ใช้เรนเดอร์ จอเล็กซูมดูยังคม
const MAX_RENDER_WIDTH = 768;      // = max-w-3xl ของคอลัมน์หน้า — กว้างกว่านี้ CSS ย่อทิ้งเปล่าๆ
const RENDER_AHEAD = '150% 0px';   // เรนเดอร์ล่วงหน้า 1.5 จอ
const RENDER_CONCURRENCY = 2;      // วาดทีละ 2 หน้า (มือถือ: canvas 12MB × 6 หน้าพร้อมกัน = เมมหมด)

interface EbookWebtoonPreviewProps {
  slug: string;
  /** เปลี่ยนเมื่อแอดมินแก้ตัวอย่าง (เช่น `${preview_pages}-${updated_at}`) — กันแคชเก่า */
  version?: string | number;
  title: string;
  /** จำนวนหน้าตัวอย่างที่ตั้งไว้ (ใช้โชว์ก่อนไฟล์โหลดเสร็จ — ของจริงนับจากไฟล์) */
  previewPages: number;
  totalPages?: number | null;
  /** บล็อกชวนสมัครท้ายตัวอย่าง — รับจำนวนหน้าจริงในไฟล์ */
  cta: (renderedPages: number) => ReactNode;
  onClose: () => void;
  /** เรนเดอร์ไม่สำเร็จ → กลับไปเปิดตัวอย่างแบบ PDF (iframe) */
  onFallback: () => void;
}

interface PageInfo {
  aspect: number;       // height / width
  url: string | null;   // object URL ของรูปที่เรนเดอร์แล้ว
  failed: boolean;
}

type Status = 'loading' | 'ready' | 'unavailable' | 'error';

export default function EbookWebtoonPreview({
  slug, version, title, previewPages, totalPages, cta, onClose, onFallback,
}: EbookWebtoonPreviewProps) {
  const src = api.ebookPreviewUrl(slug, version);
  const [status, setStatus] = useState<Status>('loading');
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const rendering = useRef<Set<number>>(new Set());
  const objectUrls = useRef<string[]>([]);
  const queue = useRef<number[]>([]);
  const active = useRef(0);

  // โหลดเอกสาร + อ่านอัตราส่วนทุกหน้า (ยังไม่วาด) → วาง placeholder สูงถูกต้องก่อน ไม่มี layout กระโดด
  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    setStatus('loading');
    setPages([]);
    setReachedEnd(false);
    setCurrentPage(1);
    rendering.current.clear();
    queue.current = [];

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return; // ถูกปิดระหว่างโหลด chunk — ห้ามสร้าง worker/ยิง fetch ทิ้งไว้
        const base = pdfjsAssetBase(pdfjs.version);
        const task = pdfjs.getDocument({
          url: src,
          cMapUrl: `${base}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${base}standard_fonts/`,
          wasmUrl: `${base}wasm/`,
        });
        loadingTask = task;
        const pdf = await task.promise;
        if (cancelled) {
          void task.destroy().catch(() => { /* ปิดไปแล้ว */ });
          return;
        }
        docRef.current = pdf;
        const infos: PageInfo[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          infos.push({ aspect: vp.height / vp.width, url: null, failed: false });
          page.cleanup();
          if (cancelled) return;
        }
        pageRefs.current = [];
        setPages(infos);
        setStatus(infos.length > 0 ? 'ready' : 'unavailable');
      } catch (e: any) {
        if (cancelled) return;
        // 404 = server ทำตัวอย่างเล่มนี้ไม่ได้ (หน้าเดียว/เข้ารหัส) → ไม่มีอะไรให้ลองใหม่ พาไปสมัครเลย
        const httpStatus = typeof e?.status === 'number' ? e.status : undefined;
        if (httpStatus === 404 || e?.name === 'MissingPDFException') {
          setStatus('unavailable');
        } else {
          console.error('[EbookWebtoonPreview] load failed', e);
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      docRef.current = null;
      loadingTask?.destroy().catch(() => { /* ปิดไปแล้ว */ });
      for (const u of objectUrls.current) URL.revokeObjectURL(u);
      objectUrls.current = [];
    };
  }, [src, attempt]);

  // วาดหน้าเดียวลง canvas → แปลงเป็น JPEG object URL แล้วทิ้ง canvas (มือถือมี canvas ค้างหลายอันแล้วเมมหมด)
  const renderPage = useCallback(async (index: number) => {
    const pdf = docRef.current;
    if (!pdf || rendering.current.has(index)) return;
    rendering.current.add(index);
    try {
      const page = await pdf.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      // วัดจากคอลัมน์หน้าจริง (ไม่ใช่ container นอกที่กว้างกว่า) และไม่เกินความกว้างที่ CSS แสดงได้
      const measured = pageRefs.current[index]?.clientWidth || containerRef.current?.clientWidth || 0;
      const cssWidth = Math.min(MAX_RENDER_WIDTH, Math.max(measured, MIN_RENDER_WIDTH));
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const scale = Math.min(
        (cssWidth * dpr) / base.width,
        MAX_CANVAS_SIDE / base.height,
        MAX_CANVAS_SIDE / base.width,
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      if (docRef.current !== pdf) return;
      if (!blob) {
        // iOS ภายใต้ memory pressure คืน null — ให้ลองใหม่ได้เมื่อหน้าเข้าจออีกครั้ง
        rendering.current.delete(index);
        setPages((prev) => prev.map((p, i) => (i === index ? { ...p, failed: true } : p)));
        return;
      }
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      setPages((prev) => prev.map((p, i) => (i === index ? { ...p, url, failed: false } : p)));
    } catch (e) {
      if (docRef.current !== pdf) return; // ถูก unmount/โหลดใหม่ระหว่างวาด — ไม่ใช่ error จริง
      console.error(`[EbookWebtoonPreview] render page ${index + 1} failed`, e);
      rendering.current.delete(index);
      setPages((prev) => prev.map((p, i) => (i === index ? { ...p, failed: true } : p)));
    }
  }, []);

  // คิวเรนเดอร์ — จำกัดจำนวนหน้าที่วาดพร้อมกัน
  const pump = useCallback(function pumpQueue() {
    while (active.current < RENDER_CONCURRENCY && queue.current.length > 0) {
      const i = queue.current.shift()!;
      active.current++;
      void renderPage(i).finally(() => {
        active.current--;
        pumpQueue();
      });
    }
  }, [renderPage]);

  // ① เข้าคิวเรนเดอร์เมื่อหน้าใกล้เข้าจอ ② หน้าปัจจุบัน = หน้าที่ทับแถบกลางจอ ③ sentinel ท้ายสุด → โชว์ CTA
  useEffect(() => {
    if (status !== 'ready') return;
    const els = pageRefs.current.filter((el): el is HTMLDivElement => !!el);
    const idx = (el: Element) => Number((el as HTMLElement).dataset.index);
    const renderObs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        renderObs.unobserve(en.target);
        queue.current.push(idx(en.target));
      }
      pump();
    }, { rootMargin: RENDER_AHEAD, threshold: 0 });
    const currentObs = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) setCurrentPage(idx(en.target) + 1);
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    els.forEach((el) => {
      renderObs.observe(el);
      currentObs.observe(el);
    });
    const endObs = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) setReachedEnd(true);
    }, { threshold: 0 });
    if (sentinelRef.current) endObs.observe(sentinelRef.current);
    return () => {
      renderObs.disconnect();
      currentObs.disconnect();
      endObs.disconnect();
    };
  }, [status, pages.length, pump]);

  // หน้าที่วาดพลาด → กดลองใหม่ได้ (เข้าคิวอีกครั้ง)
  const retryPage = (index: number) => {
    setPages((prev) => prev.map((p, i) => (i === index ? { ...p, failed: false } : p)));
    queue.current.push(index);
    pump();
  };

  const total = pages.length || previewPages;

  return (
    <div ref={containerRef} className="relative select-none" onContextMenu={(e) => e.preventDefault()}>
      {/* แถบสถานะ — ค้างใต้ header ของเว็บ (sticky top-0 สูง h-14 / lg:h-16 — หน้านี้ไม่ใช่ header แบบ overlay) */}
      <div className="sticky top-14 lg:top-16 z-10 flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-[#0d0d14]/95 backdrop-blur border-b border-gray-800 text-xs sm:text-sm">
        <span className="flex items-center gap-1.5 text-emerald-300 min-w-0">
          <BookOpen className="h-4 w-4 shrink-0" />
          <span className="truncate">
            📖 ตัวอย่างฟรี
            {status === 'ready' ? ` · หน้า ${currentPage}/${total}` : total > 0 ? ` ${total} หน้าแรก` : ''}
            {totalPages ? <span className="text-gray-500"> (เล่มเต็ม {totalPages} หน้า)</span> : null}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 text-gray-400 hover:text-white shrink-0"
        >
          <X className="h-4 w-4" />
          ซ่อนตัวอย่าง
        </button>
      </div>

      {status === 'loading' && (
        <div className="max-w-3xl mx-auto px-3 sm:px-0 py-6">
          <div className="w-full aspect-[3/4] max-h-[70vh] rounded-md bg-gray-800/60 animate-pulse flex items-center justify-center text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            กำลังโหลดตัวอย่าง…
          </div>
        </div>
      )}

      {status === 'unavailable' && (
        <div className="max-w-3xl mx-auto px-4 pt-10 pb-6 space-y-8">
          <p className="text-center text-sm text-gray-300">เล่มนี้ยังไม่มีตัวอย่างให้อ่าน — สมัครสมาชิกเพื่ออ่านเต็มเล่มได้เลย</p>
          {cta(0)}
        </div>
      )}

      {status === 'error' && (
        <div className="max-w-3xl mx-auto px-4 py-10 text-center space-y-3">
          <p className="text-sm text-gray-300">โหลดตัวอย่างไม่สำเร็จ 😢 ลองใหม่ หรือเปิดเป็นไฟล์ PDF แทน</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAttempt((n) => n + 1)}
              className="border-gray-600 text-gray-200 hover:bg-gray-800 hover:text-white"
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              ลองใหม่
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onFallback}
              className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
            >
              เปิดตัวอย่างแบบ PDF
            </Button>
          </div>
        </div>
      )}

      {status === 'ready' && (
        <div className="max-w-3xl mx-auto">
          {/* หน้าเรียงต่อกันแนวตั้ง เว้น 2px ให้พอเห็นรอยต่อหน้า · placeholder ใช้ padding-top
              (ไม่ใช่ aspect-ratio — iOS 14 ไม่รองรับแล้วกล่องยุบเป็น 0) */}
          <div className="flex flex-col gap-0.5 bg-gray-900">
            {pages.map((p, i) => (
              <div
                key={i}
                ref={(el) => { pageRefs.current[i] = el; }}
                data-index={i}
                className="relative w-full bg-gray-800/40"
                style={{ paddingTop: `${p.aspect * 100}%` }}
              >
                {p.url ? (
                  <img
                    src={p.url}
                    alt={`${title} — หน้า ${i + 1}`}
                    draggable={false}
                    decoding="async"
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />
                ) : p.failed ? (
                  <button
                    type="button"
                    onClick={() => retryPage(i)}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-gray-400 hover:text-white"
                  >
                    แสดงหน้านี้ไม่ได้
                    <span className="flex items-center gap-1 text-emerald-400"><RefreshCw className="h-3 w-3" /> ลองใหม่</span>
                  </button>
                ) : (
                  <div className="absolute inset-0 animate-pulse bg-gray-800/60" />
                )}
                {/* หน้าสุดท้ายแค่แต้มจางบางๆ ปลายหน้า — ไม่บังเนื้อหาตัวอย่าง */}
                {i === pages.length - 1 && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/5 bg-gradient-to-b from-transparent to-[#0d0d14]/60" />
                )}
              </div>
            ))}
          </div>
          {/* การไล่สีจริงอยู่ "ใต้" หน้าสุดท้าย — สื่อว่าต่อจากนี้ต้องสมัคร */}
          <div className="h-16 bg-gradient-to-b from-gray-900 to-[#0d0d14]" />
          <div ref={sentinelRef} className="h-px" />
          <div
            aria-hidden={!reachedEnd}
            className={`px-4 pt-6 transition-all duration-700 ease-out ${reachedEnd ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'}`}
            style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}
          >
            {cta(pages.length)}
          </div>
        </div>
      )}
    </div>
  );
}
