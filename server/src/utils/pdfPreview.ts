/**
 * ตัด PDF เหลือ N หน้าแรกด้วย pdf-lib (JavaScript ล้วน — ไม่มี native binary,
 * เครื่อง dev ที่เป็น node 32-bit ใช้ได้) สำหรับ "อ่านตัวอย่าง" ของ Ebook
 * เล่มสมาชิก/เล่มขาย: คนยังไม่มีสิทธิ์จะได้ไฟล์ที่มีแค่หน้าตัวอย่างจริงๆ
 * ไม่ใช่ไฟล์เต็มที่ซ่อนด้วย UI
 */
import { PDFDocument } from 'pdf-lib';

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
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, Array.from({ length: take }, (_, i) => i));
    for (const p of copied) out.addPage(p);
    return Buffer.from(await out.save());
  } catch {
    return null;
  }
}
