import type { ReactNode } from 'react';

interface NetflixRowProps {
  title: string;
  children: ReactNode;
}

/**
 * A titled block of course cards that WRAPS onto new lines.
 *
 * This used to be a horizontally-scrolling rail. Cards at the edges were always
 * sliced in half — a half-card reads as a rendering bug, and anything past the
 * fold was invisible unless you knew to swipe. Wrapping shows every course in
 * full, so nothing is cut off and nothing hides off-screen.
 */
const NetflixRow = ({ title, children }: NetflixRowProps) => (
  <section className="mb-7 px-4 md:px-12">
    <h2 className="text-white text-base md:text-lg font-semibold mb-2">{title}</h2>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-3">
      {children}
    </div>
  </section>
);

export default NetflixRow;
