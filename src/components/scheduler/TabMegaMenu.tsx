import { ReactNode, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface MegaMenuItem {
  icon?: ReactNode;
  title: string;
  description?: string;
  badge?: 'NEW' | 'TOP';
  onClick?: () => void;
}

export interface MegaMenuColumn {
  title: string;
  items: MegaMenuItem[];
}

interface TabMegaMenuProps {
  /** The tab trigger button (rendered as-is). Hovering this opens the menu. */
  trigger: ReactNode;
  /** Menu columns — 1 or more. */
  columns: MegaMenuColumn[];
  /** Optional className for the outer wrapper. */
  className?: string;
}

/** Corner flag badge — pinned to top-right of the parent (which must be `relative overflow-hidden`). */
const CornerRibbon = ({ kind }: { kind: 'NEW' | 'TOP' }) => (
  <span
    className={cn(
      'absolute top-0 right-0 z-10 inline-flex items-center text-[9px] font-extrabold leading-none tracking-wider px-2 py-[5px] rounded-bl-md shadow-md',
      kind === 'NEW' ? 'bg-[#FFC107] text-black' : 'bg-[#E91E63] text-white'
    )}
  >
    {kind}
  </span>
);

export const TabMegaMenu = ({ trigger, columns, className }: TabMegaMenuProps) => {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  return (
    <div
      className={cn('relative', className)}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      {trigger}

      {open && (
        <div
          className="absolute left-0 top-full z-50 pt-2"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className={cn(
            'inline-block rounded-xl border border-[#FFB300]/20 bg-popover/95 backdrop-blur-xl shadow-2xl shadow-black/50 ring-1 ring-white/5 overflow-hidden',
            columns.length >= 2
              ? 'w-[calc(100vw-1rem)] sm:w-max sm:min-w-[560px] sm:max-w-[680px]'
              : 'w-[calc(100vw-1rem)] sm:w-max sm:min-w-[260px] sm:max-w-[320px]'
          )}>
            <div className={cn('grid', columns.length >= 2 ? 'grid-cols-2 divide-x divide-[#FFB300]/10' : 'grid-cols-1')}>
              {columns.map((col, i) => (
                <div key={i} className="min-w-0 p-2">
                  <div className="px-2 pt-1 pb-2 text-[10px] font-bold text-[#FFB300]/80 tracking-[0.2em] uppercase">
                    {col.title}
                  </div>
                  {col.items.length === 0 ? (
                    <div className="px-3 py-5 text-center text-xs text-muted-foreground/60 italic">
                      เร็วๆ นี้
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {col.items.map((item, idx) => (
                        <li key={idx}>
                          <button
                            type="button"
                            onClick={() => { item.onClick?.(); setOpen(false); }}
                            className="relative w-full flex items-start gap-2.5 rounded-lg border border-border/50 bg-card/40 px-2.5 py-2 hover:border-[#FFB300]/40 hover:bg-gradient-to-br hover:from-[#FFB300]/8 hover:to-card/60 hover:shadow-md hover:shadow-[#FFB300]/5 transition-all duration-150 text-left group overflow-hidden"
                          >
                            {item.badge && <CornerRibbon kind={item.badge} />}
                            {item.icon && (
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground group-hover:bg-background">
                                {item.icon}
                              </span>
                            )}
                            <span className="min-w-0 flex-1 pr-7">
                              <span className="text-sm font-bold text-foreground truncate group-hover:text-[#FFB300] transition-colors block">
                                {item.title}
                              </span>
                              {item.description && (
                                <span className="block mt-0.5 text-[11px] text-muted-foreground/75 leading-snug line-clamp-2">
                                  {item.description}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TabMegaMenu;
