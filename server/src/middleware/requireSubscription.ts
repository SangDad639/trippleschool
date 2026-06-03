import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { hasActiveSubscription } from '../services/stripeService.js';
import pool from '../db.js';

/**
 * Middleware to check if user has active subscription
 * Use this middleware to protect Content Scheduler routes
 *
 * Checks both:
 * 1. Stripe subscription (subscriptions table)
 * 2. Manual admin extension (users.subscription_expires_at)
 */
export const requireSubscription = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    // Check if user is admin (bypass subscription check)
    const userResult = await pool.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [req.userId]
    );

    if (userResult.rows.length > 0 && userResult.rows[0].is_admin === true) {
      // Admin bypass - no subscription required
      return next();
    }

    // Check for active subscription (Stripe OR manual admin extension)
    const hasSubscription = await hasActiveSubscription(req.userId);

    if (!hasSubscription) {
      // Check if user ever had a subscription
      const subResult = await pool.query(
        `SELECT subscription_expires_at FROM users WHERE id = $1`,
        [req.userId]
      );
      const hadSubscription = subResult.rows[0]?.subscription_expires_at != null;

      return res.status(403).json({
        error: hadSubscription
          ? 'สิทธิ์การใช้งานหมดอายุ กรุณาต่ออายุสมาชิก'
          : 'กรุณาสมัครสมาชิกเพื่อใช้งาน',
        code: hadSubscription ? 'SUBSCRIPTION_EXPIRED' : 'NO_SUBSCRIPTION',
        subscriptionUrl: '/subscription'
      });
    }

    next();
  } catch (error) {
    console.error('Subscription check error:', error);
    res.status(500).json({ error: 'Failed to verify subscription' });
  }
};
