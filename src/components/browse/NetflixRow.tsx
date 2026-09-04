import type { ReactNode } from 'react';

interface NetflixRowProps {
  title: string;
  children: ReactNode;
  /** ตัวควบคุมขวาของหัวข้อ เช่น ปุ่ม "ดูทั้งหมด" (ไม่ส่ง = หน้าตาเดิม) */
  action?: ReactNode;
}

/**
 * A titled block of course cards that WRAPS onto new lines.
 *
 * This used to be a horizontally-scrolling rail. Cards at the edges were always
 * sliced in half — a half-card reads as a rendering bug, and anything past the
 * fold was invisible unless you knew to swipe. Wrapping shows every course in
 * full, so nothing is cut off and nothing hides off-screen.
 */
const NetflixRow = ({ title, children, action }: NetflixRowProps) => (
  <section className="mb-7 px-4 md:px-12">
    <div className="flex items-center justify-between gap-3 mb-2">
      <h2 className="text-white text-base md:text-lg font-semibold">{title}</h2>
      {action}
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-3">
      {children}
    </div>
  </section>
);

export default NetflixRow;
