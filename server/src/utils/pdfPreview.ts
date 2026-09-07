/**
 * ตัด PDF เหลือ N หน้าแรกด้วย pdf-lib (JavaScript ล้วน — ไม่มี native binary,
 * เครื่อง dev ที่เป็น node 32-bit ใช้ได้) สำหรับ "อ่านตัวอย่าง" ของ Ebook
 * เล่มสมาชิก: คนยังไม่มีสิทธิ์จะได้ไฟล์ที่มีแค่หน้าตัวอย่างจริงๆ ไม่ใช่ไฟล์เต็มที่ซ่อนด้วย UI
 */
import { PDFDocument, PDFName } from 'pdf-lib';

/**
 * คืนไฟล์ PDF ใหม่ที่มีเฉพาะหน้าแรกๆ หรือ null เมื่อทำไม่ได้
 * (ไฟล์เข้ารหัส/เสีย หรือทั้งเล่มมีหน้าเดียว — ตัดแล้วเท่ากับแจกทั้งเล่ม)
 * กันแจกทั้งเล่ม: จำนวนหน้าที่ตัดจริง = min(pages, totalPages - 1)
 */
export async function makePreviewPdf(original: Buffer, pages: number): Promise<Buffer | null> {
  if (!Number.isInteger(pages) || pages <= 0) return null;
  try {
    const src = await PDFDocument.load(original, { ignoreEncryption: false });
    const total = src.getPageCount();
    const take = Math.min(pages, total - 1);
    if (take <= 0) return null;
    // copyPages คัดลอก object ทุกตัวที่หน้าอ้างถึง — link annotation (สารบัญคลิกได้/ปุ่มหน้าถัดไป)
    // ชี้ไปหน้าอื่นทำให้เนื้อหาหน้าที่ไม่ใช่ตัวอย่างติดไปในไฟล์ (มองไม่เห็นแต่ดึงออกได้ด้วย qpdf)
    // → ถอด /Annots /B /AA ออกจากหน้าต้นทาง (ในหน่วยความจำเท่านั้น ไฟล์เต็มบน S3 ไม่ถูกแตะ)
    for (let i = 0; i < take; i++) {
      const node = src.getPage(i).node;
      node.delete(PDFName.of('Annots'));
      node.delete(PDFName.of('B'));
      node.delete(PDFName.of('AA'));
    }
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, Array.from({ length: take }, (_, i) => i));
    for (const p of copied) out.addPage(p);
    if (out.getPageCount() !== take) return null;
    return Buffer.from(await out.save());
  } catch {
    return null;
  }
}

/** จำนวนหน้าของ PDF หรือ null ถ้าอ่านไม่ได้ (ไม่ใช่ PDF / เสีย) */
export async function countPdfPages(buf: Buffer): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return null;
  }
}
