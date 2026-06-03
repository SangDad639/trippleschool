/**
 * Coupon redemption routes (user-facing).
 *
 * Admin-side endpoints (list/create/toggle) live in `admin.ts` under
 * `/api/admin/coupons/*` — they require admin auth and aren't mounted here.
 */
import express, { Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import pool from '../db.js';
import * as couponService from '../services/couponService.js';

const router = express.Router();

/**
 * POST /api/coupons/redeem
 *
 * Body: { code }
 *
 * Redeems the coupon (atomic) and extends the caller's subscription by
 * `coupon.days` days. Failure cases return 4xx with `errorCode`:
 *   - invalid              404 — code doesn't exist or wrong format
 *   - already_used_by_you  409 — this user already redeemed this code
 *   - limit_reached        409 — global usage cap reached (multi-use codes)
 *   - disabled             409 — admin deactivated the code
 *
 * Both steps (mark redeemed + extend subscription) run in a single
 * transaction; if extension fails the redeem is rolled back so the code
 * stays redeemable.
 */
router.post('/redeem', authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const { code } = req.body ?? {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing code', errorCode: 'missing_code' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Atomic redeem
    const result = await couponService.redeem(client, userId, code, req.ip);
    if (!result.ok) {
      await client.query('ROLLBACK');
      const status = result.error === 'invalid' ? 404 : 409;
      return res.status(status).json({
        error: result.error,
        errorCode: result.error,
      });
    }

    // 2) Extend subscription — same logic as autoapprove / admin extend.
    //    Extends from max(NOW, currentExpiry) so already-active subs add on top.
    const userRes = await client.query<{ subscription_expires_at: Date | null }>(
      'SELECT subscription_expires_at FROM users WHERE id = $1',
      [userId]
    );
    const cur = userRes.rows[0]?.subscription_expires_at;
    const baseDate = cur && new Date(cur) > new Date() ? new Date(cur) : new Date();
    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + result.days);

    await client.query(
      'UPDATE users SET subscription_expires_at = $1 WHERE id = $2',
      [newExpiry.toISOString(), userId]
    );

    // 3) Audit log entry — approval_method='coupon', amount='0'.
    await client.query(
      `INSERT INTO subscription_extension_logs
         (user_id, admin_id, days_added, amount, approval_method, notes)
       VALUES ($1, NULL, $2, '0', 'coupon', $3)`,
      [userId, result.days, `Coupon #${result.couponId}`]
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      days: result.days,
      expires_at: newExpiry.toISOString(),
    });
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('[coupons/redeem] failed:', err);
    res.status(500).json({ error: err?.message || 'Internal error' });
  } finally {
    client.release();
  }
});

export default router;
