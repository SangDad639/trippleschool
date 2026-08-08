import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Lightweight in-memory fixed-window rate limiter (no external dependency).
 * Suitable for a single-node deploy; state resets on process restart. Used to
 * throttle the payment slip-verification endpoints (per authenticated user, or
 * per IP as a fallback) so Thunder quota can't be burned and slips can't be
 * brute-forced. Returns 429 with a Thai message + Retry-After when exceeded.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyBy?: (req: AuthRequest) => string | undefined;
  message?: string;
}) {
  const { windowMs, max, keyBy, message } = opts;
  const store = new Map<string, Bucket>();

  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const key = (keyBy ? keyBy(req) : undefined) || req.ip || 'anon';
    const now = Date.now();
    const bucket = store.get(key);

    if (!bucket || now >= bucket.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      // Opportunistic cleanup so the Map can't grow unbounded on a busy node.
      if (store.size > 5000) {
        for (const [k, b] of store) if (now >= b.resetAt) store.delete(k);
      }
      return next();
    }

    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: message || 'คำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
        errorCode: 'RATE_LIMITED',
        retryAfter,
      });
    }

    bucket.count++;
    next();
  };
}
