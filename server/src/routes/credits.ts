/**
 * Public credits endpoints.
 *
 *   GET /api/credits/balance   → { credits, totalUsed }
 *   GET /api/credits/history   → paginated ledger; optional ?type=credit_add|credit_deduct|all
 *   GET /api/credits/pricing   → server snapshot of generation + story-agent pricing
 *
 * Wraps existing creditService functions — does NOT add new business logic.
 * Mount under /api/credits in src/index.ts.
 */
import express, { Response } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { getCreditHistory } from '../services/creditService.js';
import {
  IMAGE_CREDITS,
  GROK_VIDEO_CREDIT_PER_SEC,
  GROK_EXTEND_CREDITS,
  KLING_CREDIT_PER_SEC,
  VIRAL_IDOL_IMAGE_MODEL,
  VIRAL_IDOL_IMAGE_RES,
  VIRAL_VIDEO_SECONDS,
  PROMPT_DIRECT_PLATFORM_PRICING,
} from '../config/generationPricing.js';
import * as storyAgentPricing from '../config/storyAgentPricing.js';

const router = express.Router();

/** GET /balance — current user credits */
router.get('/balance', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query<{ credits: number; total_credits_used: number }>(
      `SELECT credits, total_credits_used FROM users WHERE id = $1`,
      [req.userId!]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'user not found' });
    }
    const row = r.rows[0];
    res.json({
      credits: Number(row.credits || 0),
      totalUsed: Number(row.total_credits_used || 0),
    });
  } catch (err: any) {
    console.error('[credits:balance]', err);
    res.status(500).json({ error: err?.message || 'balance failed' });
  }
});

/**
 * GET /history?limit=50&offset=0&type=all|credit_add|credit_deduct
 *
 * `credit_add` groups admin_add + bonus + purchase + registration
 * `credit_deduct` groups deduct + admin_deduct + refund
 * `all` = no filter
 *
 * (Type grouping logic mirrors getCreditHistory in creditService.ts:518-540.)
 */
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const type = (req.query.type as string | undefined) || 'all';

    const result = await getCreditHistory(req.userId!, limit, offset, type);
    res.json({
      items: result.transactions,
      total: result.totalCount,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error('[credits:history]', err);
    res.status(500).json({ error: err?.message || 'history failed' });
  }
});

/**
 * GET /pricing — snapshot of all generation + story-agent costs.
 *
 * Read-only public-ish (still requires auth so we can attribute usage).
 * FE has its own mirror at src/lib/generationPricing.ts — this endpoint is
 * useful for debugging drift + future single-source migration.
 */
router.get('/pricing', authenticate, async (_req: AuthRequest, res: Response) => {
  res.json({
    generation: {
      imageCredits: IMAGE_CREDITS,
      grokVideoCreditPerSec: GROK_VIDEO_CREDIT_PER_SEC,
      grokExtendCredits: GROK_EXTEND_CREDITS,
      klingCreditPerSec: KLING_CREDIT_PER_SEC,
      viralIdolImageModel: VIRAL_IDOL_IMAGE_MODEL,
      viralIdolImageResolution: VIRAL_IDOL_IMAGE_RES,
      viralVideoSeconds: VIRAL_VIDEO_SECONDS,
      promptDirectPlatformPricing: PROMPT_DIRECT_PLATFORM_PRICING,
    },
    storyAgent: storyAgentPricing,
  });
});

export default router;
