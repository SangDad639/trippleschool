/**
 * เลื่อนหน้าจอไปหา element โดยคุมอนิเมชันเอง
 *
 * ทำไมไม่ใช้ `scrollIntoView({ behavior: 'smooth' })`:
 * ตอนเข้าหน้ารายละเอียดคอร์สพร้อม ?ep=latest เบราว์เซอร์กำลังยุ่งกับการ render
 * หน้าใหม่ + ยิง API + decode รูป (วัดจริงได้ 4 เฟรมใน 3.5 วินาที) พอไม่มีเฟรมว่าง
 * ให้อนิเมต Chrome ก็ตัดจบด้วยการกระโดดถึงปลายทางทันที — ผู้ใช้ตามไม่ทันว่าถูกพาไปไหน
 *
 * ที่นี่จึงรอให้หน้า "นิ่ง" ก่อนแล้วค่อยเลื่อนเองทีละเฟรม จะได้คุมทั้งจังหวะเริ่มและความเร็ว
 */

type Options = {
  /** ระยะห่างจากขอบบนจอเมื่อถึงที่ (ไม่ใส่ = จัดกึ่งกลางจอ) */
  offsetTop?: number;
  /** ให้รอหน้านิ่งนานสุดเท่าไหร่ ก่อนเลิกรอ */
  waitTimeoutMs?: number;
  /** เรียกเมื่อเลื่อนถึงที่แล้ว (ไม่เรียกถ้าถูกยกเลิก/หาไม่เจอ) */
  onArrive?: () => void;
};

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * @returns cancel() — เรียกเพื่อหยุดทุกอย่าง (ใช้ใน cleanup ของ useEffect)
 */
export function smoothScrollToElement(elementId: string, options: Options = {}) {
  const { offsetTop, waitTimeoutMs = 2500, onArrive } = options;

  let cancelled = false;
  let raf = 0;
  let detachUserScrollGuard: (() => void) | null = null;

  const cancel = () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    detachUserScrollGuard?.();
  };

  if (typeof window === 'undefined') return cancel;

  /** ปลายทางของ scrollY คำนวณสดทุกเฟรม — มีอะไรมาแทรกกลางทางก็ไถลตามไปเอง */
  const targetScrollY = (el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const docTop = box.top + window.scrollY;
    const y = offsetTop != null
      ? docTop - offsetTop
      : docTop - (window.innerHeight - box.height) / 2;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return Math.max(0, Math.min(y, max));
  };

  const animate = (el: HTMLElement) => {
    const from = window.scrollY;
    const distance = Math.abs(targetScrollY(el) - from);
    if (distance < 2) { onArrive?.(); return; }

    if (prefersReducedMotion()) {
      window.scrollTo(0, targetScrollY(el));
      onArrive?.();
      return;
    }

    // ใกล้ก็ไม่อืด ไกลก็ไม่วืด — ตัวคูณนี้คือปุ่มปรับความเร็วจุดเดียวของทั้งฟีเจอร์
    const duration = Math.min(1100, Math.max(500, distance * 0.6));

    // ผู้ใช้ลงมือเลื่อนเองเมื่อไหร่ ต้องชนะเราเสมอ — ปล่อยมือทันที ไม่ดึงกลับ
    const onUserScroll = () => cancel();
    const events = ['wheel', 'touchstart', 'keydown'] as const;
    events.forEach((e) => window.addEventListener(e, onUserScroll, { passive: true }));
    detachUserScrollGuard = () =>
      events.forEach((e) => window.removeEventListener(e, onUserScroll));

    const start = performance.now();
    const step = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / duration);
      const to = targetScrollY(el);
      window.scrollTo(0, from + (to - from) * easeInOutCubic(t));
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        detachUserScrollGuard?.();
        onArrive?.();
      }
    };
    raf = requestAnimationFrame(step);
  };

  // เฟส 1: รอจน element โผล่ + ความสูงหน้านิ่ง 2 เฟรมติด
  // เช็คความสูงแทนการไปผูกกับ fetch ทีละตัว เพราะครอบคลุมทุกอย่างที่โผล่ทีหลัง
  // ในคราวเดียว (แท็บ Tip ที่แทรกเหนือรายการบท, แถบสถิติใน hero ที่รอผลรีวิว, รูปที่เพิ่งโหลด)
  const deadline = performance.now() + waitTimeoutMs;
  let lastHeight = -1;
  const waitUntilSettled = () => {
    if (cancelled) return;
    const el = document.getElementById(elementId);
    const height = document.documentElement.scrollHeight;
    if (el && height === lastHeight) { animate(el); return; }
    lastHeight = height;
    if (performance.now() > deadline) {
      // หมดเวลารอแล้ว: ถ้าเจอ element ก็เลื่อนไปเลยทั้งที่หน้ายังไม่นิ่ง (เน็ตช้า รูปทยอยโหลด
      // จนความสูงขยับไม่หยุด) — ไปไม่ตรงเป๊ะดีกว่าไม่พาไปเลย และอนิเมชันคำนวณเป้าใหม่ทุกเฟรม
      // อยู่แล้วจึงไถลตามได้ · หาไม่เจอจริง (เช่นบทอยู่ในแท็บที่ยังไม่ mount) ก็เลิกเงียบๆ
      if (el) animate(el);
      return;
    }
    raf = requestAnimationFrame(waitUntilSettled);
  };
  raf = requestAnimationFrame(waitUntilSettled);

  return cancel;
}
