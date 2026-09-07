// โหลด pdf.js แบบ lazy ครั้งเดียว — ใช้ legacy build: build ปกติของ v6 เรียก Promise.withResolvers /
// URL.parse ซึ่ง Safari < 17.4 ไม่มี (esbuild ไม่ polyfill runtime API ให้) legacy พ่วง core-js มาแล้ว
// (ทั้งสอง build ไม่มี top-level await — ตรวจแล้ว) worker ถูก emit เป็น asset แยกผ่าน `?url`
// ⚠️ ห้าม import pdf.js แบบ static จากไฟล์อื่น — ไฟล์ ~500KB จะเข้า bundle หลัก; ให้เรียก loadPdfjs() ในจุดที่ใช้จริง
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

export function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    });
    // โหลดพลาด (เช่น chunk หาย) → เคลียร์ให้ลองใหม่ได้ ไม่ค้าง rejected promise ตลอดอายุหน้า
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

/**
 * ไฟล์ประกอบที่ pdf.js ดึงเฉพาะเมื่อเอกสารต้องใช้ (ไม่ตั้ง = รูป JPEG-2000 หายเงียบ, ฟอนต์ CJK/
 * Symbol ที่ไม่ฝังไม่ขึ้น): cmaps/ standard_fonts/ wasm/ — ชี้ CDN ที่ pin เวอร์ชันเดียวกับที่ติดตั้ง
 * จึงไม่เพิ่มขนาด bundle และไม่ต้องก๊อปโฟลเดอร์หลาย MB เข้า public/
 */
export function pdfjsAssetBase(version: string): string {
  return `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/`;
}

export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
