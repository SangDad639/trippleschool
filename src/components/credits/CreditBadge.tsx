/**
 * CreditBadge — small pill showing the user's credit balance with a subtle
 * flash animation when the value changes (green for increase, red for
 * decrease). Adapted from sora-spark-forge's version using trippleschool's
 * Tailwind theme tokens.
 *
 * Drop this anywhere — it pulls `user.credits` from AuthContext directly
 * so callers don't need to pass props. Returns null when not logged in.
 */
import { Coins } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  /** When true → click navigates to /credits. Default true. */
  clickable?: boolean;
  /** When true → shorter padding for tight nav bars. */
  compact?: boolean;
}

export function CreditBadge({ clickable = true, compact = false }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const credits = user?.credits ?? null;
  const [prev, setPrev] = useState<number | null>(credits);
  const [change, setChange] = useState<'increase' | 'decrease' | null>(null);

  useEffect(() => {
    if (credits === null || prev === null) {
      setPrev(credits);
      return;
    }
    const diff = credits - prev;
    if (diff === 0) return;
    setChange(diff > 0 ? 'increase' : 'decrease');
    setPrev(credits);
    const handle = setTimeout(() => setChange(null), 1500);
    return () => clearTimeout(handle);
  }, [credits, prev]);

  if (credits === null) return null;

  const borderColor =
    change === 'increase'
      ? 'border-green-500 shadow-lg shadow-green-500/40'
      : change === 'decrease'
        ? 'border-red-500 shadow-lg shadow-red-500/40'
        : 'border-[#FFB300]/50 hover:border-[#FFB300]';
  const iconColor =
    change === 'increase'
      ? 'text-green-500'
      : change === 'decrease'
        ? 'text-red-500'
        : 'text-[#FFB300]';
  const textColor =
    change === 'increase'
      ? 'text-green-500'
      : change === 'decrease'
        ? 'text-red-500'
        : 'text-foreground';

  const padding = compact ? 'px-2.5 py-1' : 'px-4 py-2';
  const Wrapper = clickable ? 'button' : 'div';

  return (
    <Wrapper
      type={clickable ? 'button' : undefined}
      onClick={clickable ? () => navigate('/credits') : undefined}
      className={`relative inline-flex items-center gap-2 rounded-full bg-card/40 border transition-all duration-300 ${padding} ${borderColor} ${
        clickable ? 'cursor-pointer hover:bg-card/60' : ''
      }`}
      title={clickable ? 'ดูประวัติ + เติมเครดิต' : undefined}
    >
      <Coins className={`h-4 w-4 transition-colors duration-300 ${iconColor}`} />
      <span className={`font-semibold tabular-nums transition-colors duration-300 ${textColor}`}>
        {credits.toLocaleString()}
      </span>
      <span className="text-[10px] text-muted-foreground">credits</span>
    </Wrapper>
  );
}
