import { toast } from 'sonner';

/** โดเมนจริงสำหรับลิงก์ที่แชร์ออกไป — dev ตกไปใช้ origin ที่เปิดอยู่ */
export const SITE_URL =
  (import.meta.env.VITE_SITE_URL as string | undefined) ||
  (typeof window !== 'undefined' ? window.location.origin : '');

/**
 * แชร์ลิงก์แบบไอคอนเดียวจบ ไม่มี dialog:
 *   มือถือ (จอสัมผัส + มี navigator.share) → share sheet ของเครื่อง
 *   เดสก์ท็อป → คัดลอกเข้าคลิปบอร์ด + toast
 *
 * เช็ค pointer:coarse ด้วย — Chrome บน Windows ก็มี navigator.share แต่เปิดแผงแชร์
 * ของ Windows ที่ใช้ไม่ได้จริง สู้คัดลอกให้เลยไม่ได้ (เหตุผลเดียวกับปุ่มแชร์คอร์ส)
 *
 * @returns 'copied' เมื่อคัดลอกสำเร็จ (ให้ผู้เรียกสลับไอคอนเป็นติ๊ก) · 'shared' เมื่อออก
 *          share sheet · 'failed' เมื่อทำอะไรไม่ได้เลย
 */
export async function shareLink(url: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  if (isTouch && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch {
      /* ผู้ใช้กดยกเลิก / เครื่องไม่รองรับจริง → ตกไปคัดลอกแทน */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success('คัดลอกลิงก์แล้ว');
    return 'copied';
  } catch {
    toast.error('คัดลอกไม่สำเร็จ');
    return 'failed';
  }
}
