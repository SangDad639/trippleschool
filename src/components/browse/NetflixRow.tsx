import { useRef, useState, useEffect, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface NetflixRowProps {
  title: string;
  children: ReactNode;
}

// Horizontal Netflix rail: title + snap-scrolling strip with hover chevrons.
// Touch devices swipe natively (chevrons hidden below md).
const NetflixRow = ({ title, children }: NetflixRowProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  useEffect(() => {
    updateArrows();
    const el = trackRef.current;
    if (!el) return;
    const onScroll = () => updateArrows();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', updateArrows);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  const scrollBy = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <section className="mb-7">
      <h2 className="text-white text-base md:text-lg font-semibold mb-2 px-4 md:px-12">{title}</h2>
      <div className="relative group/row">
        <div
          ref={trackRef}
          className="flex gap-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory pl-4 md:pl-12 pr-4 md:pr-12 py-1"
        >
          {children}
        </div>

        {canLeft && (
          <button
            aria-label="เลื่อนซ้าย"
            onClick={() => scrollBy(-1)}
            className="hidden md:flex absolute left-0 inset-y-0 w-12 items-center justify-center bg-gradient-to-r from-background/90 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity z-20"
          >
            <ChevronLeft className="h-8 w-8 text-white" />
          </button>
        )}
        {canRight && (
          <button
            aria-label="เลื่อนขวา"
            onClick={() => scrollBy(1)}
            className="hidden md:flex absolute right-0 inset-y-0 w-12 items-center justify-center bg-gradient-to-l from-background/90 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity z-20"
          >
            <ChevronRight className="h-8 w-8 text-white" />
          </button>
        )}
      </div>
    </section>
  );
};

export default NetflixRow;
