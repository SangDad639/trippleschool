import { useState } from 'react';
import { Star, StarHalf } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StarRatingProps {
  /** Numeric rating value (0–5). For display mode this can be fractional (e.g. 4.5). */
  value?: number;
  /** When true, stars become a clickable 1–5 picker. */
  editable?: boolean;
  /** Called with the picked rating (1–5) when editable. */
  onChange?: (value: number) => void;
  /** Optional review count shown after the stars in display mode. */
  count?: number;
  /** Star size in px. */
  size?: number;
  className?: string;
  /** Hide the numeric value text in display mode. */
  hideValue?: boolean;
}

/**
 * Reusable star rating widget.
 * - Display mode (default): read-only, renders full / half / empty stars for a
 *   fractional value, with optional numeric value + count text.
 * - Input mode (`editable` + `onChange`): clickable 1–5 picker with hover preview.
 */
const StarRating = ({
  value = 0,
  editable = false,
  onChange,
  count,
  size = 16,
  className,
  hideValue = false,
}: StarRatingProps) => {
  const [hover, setHover] = useState<number | null>(null);

  if (editable) {
    const active = hover ?? value;
    return (
      <div className={cn('flex items-center gap-0.5', className)} role="radiogroup" aria-label="ให้คะแนน">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} ดาว`}
            className="p-0.5 text-yellow-400 hover:scale-110 transition-transform"
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onChange?.(star)}
          >
            <Star
              style={{ width: size, height: size }}
              className={cn(star <= active ? 'fill-yellow-400 text-yellow-400' : 'text-gray-500')}
            />
          </button>
        ))}
      </div>
    );
  }

  const rounded = Math.round(value * 2) / 2; // nearest half
  return (
    <div className={cn('flex items-center gap-1', className)} aria-label={`คะแนน ${value} จาก 5`}>
      <div className="flex items-center text-yellow-400">
        {[1, 2, 3, 4, 5].map((star) => {
          if (rounded >= star) {
            return <Star key={star} style={{ width: size, height: size }} className="fill-yellow-400 text-yellow-400" />;
          }
          if (rounded >= star - 0.5) {
            return <StarHalf key={star} style={{ width: size, height: size }} className="fill-yellow-400 text-yellow-400" />;
          }
          return <Star key={star} style={{ width: size, height: size }} className="text-gray-500" />;
        })}
      </div>
      {!hideValue && value > 0 && <span className="text-yellow-400 text-xs font-medium">{value.toFixed(1)}</span>}
      {count != null && <span className="text-gray-400 text-xs">({count})</span>}
    </div>
  );
};

export default StarRating;
