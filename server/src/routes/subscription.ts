import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { createAffiliateCommission } from '../services/stripeService.js';
import pool from '../db.js';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { verifySlipImage, ThunderError } from '../utils/thunderApi.js';
import { PRICING, VAT_RATE, pricingFromPlan } from '../config/pricing.js';
import * as plansService from '../services/plansService.js';
import { maybePromoteOnPurchase } from '../services/tierAssignmentService.js';
import * as taxInvoiceService from '../services/taxInvoiceService.js';
import { getBucketName, getFile } from '../utils/s3.js';

// Configure S3 client for payment slip uploads (HWC OBS — virtual-host style)
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: false,
});

const S3_BUCKET = process.env.S3_BUCKET || '';

// Configure multer for payment slip upload (memory storage for S3)
const slipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP images allowed'));
  },
});

const router = express.Router();

/**
 * GET /api/subscription/pricing
 * @deprecated — kept for backward compatibility. Use /api/subscription/plans
 * which supports the new dynamic subscription_plans table (admin-managed).
 *
 * Returns the two hardcoded plans (monthly/yearly) from config/pricing.ts as
 * a fallback for callers that haven't migrated yet.
 */
router.get('/pricing', (_req: Request, res: Response) => {
  res.json({
    vatRate: VAT_RATE,
    monthly: PRICING.monthly,
    yearly: PRICING.yearly,
  });
});

/**
 * GET /api/subscription/plans
 * Public — returns every active subscription plan (admin-managed via
 * /api/admin/packages). Includes VAT/total breakdown computed at read time.
 *
 * Order: display_order ASC, id ASC.
 */
router.get('/plans', async (_req: Request, res: Response) => {
  try {
    // Public endpoint — strip admin-only plans (e.g. "secret deal" Premium
    // ฿18,900 that only admin can grant via upload-extend-slip).
    const plans = await plansService.getPublicActivePlans();
    res.json({ vatRate: VAT_RATE, plans });
  } catch (error: any) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

/**
 * GET /api/subscription
 * Get current user's subscription status
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Membership is driven solely by users.subscription_expires_at (set when a
    // bank-transfer slip is verified or an admin extends). No Stripe.
    const userResult = await pool.query(
      'SELECT subscription_expires_at FROM users WHERE id = $1',
      [req.userId]
    );
    const expiresAt = userResult.rows[0]?.subscription_expires_at;
    if (expiresAt && new Date(expiresAt) > new Date()) {
      const daysLeft = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      const planType = daysLeft > 60 ? 'yearly' : 'monthly';
      return res.json({
        hasSubscription: true,
        subscription: {
          planType,
          status: 'active',
          currentPeriodEnd: expiresAt,
          cancelAtPeriodEnd: false,
        }
      });
    }
    return res.json({ hasSubscription: false, subscription: null });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

/**
 * GET /api/subscription/notifications
 * Get user's subscription expiration notifications (unread)
 */
router.get('/notifications', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, notification_type, expires_at, sent_at, read_at
      FROM subscription_notifications
      WHERE user_id = $1 AND read_at IS NULL
      ORDER BY sent_at DESC
      LIMIT 10
    `, [req.userId]);

    res.json({ notifications: result.rows });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

/**
 * PATCH /api/subscription/notifications/:id/read
 * Mark a notification as read
 */
router.patch('/notifications/:id/read', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await pool.query(`
      UPDATE subscription_notifications
      SET read_at = NOW()
      WHERE id = $1 AND user_id = $2
    `, [id, req.userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

/**
 * POST /api/subscription/notifications/read-all
 * Mark all notifications as read
 */
router.post('/notifications/read-all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query(`
      UPDATE subscription_notifications
      SET read_at = NOW()
      WHERE user_id = $1 AND read_at IS NULL
    `, [req.userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// ===================== Admin Notifications (User-facing) =====================

/**
 * GET /api/subscription/admin-notifications
 * Get active admin notifications for the current user (unread)
 */
router.get('/admin-notifications', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Get user's subscription status for target_audience filtering
    const userResult = await pool.query(`
      SELECT
        CASE
          WHEN s.status = 'active' THEN 'active'
          WHEN u.subscription_expires_at > NOW() THEN 'active'
          WHEN u.subscription_expires_at IS NOT NULL THEN 'expired'
          ELSE 'no_subscription'
        END as status
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      WHERE u.id = $1
    `, [req.userId]);

    const userStatus = userResult.rows[0]?.status || 'no_subscription';

    // Get active notifications not yet read by this user
    const result = await pool.query(`
      SELECT n.id, n.title, n.message, n.notification_type, n.created_at
      FROM admin_notifications n
      WHERE n.is_active = true
        AND (n.target_audience = 'all' OR n.target_audience = $1)
        AND NOT EXISTS (
          SELECT 1 FROM user_notification_reads r
          WHERE r.notification_id = n.id AND r.user_id = $2
        )
      ORDER BY n.created_at DESC
    `, [userStatus, req.userId]);

    res.json({ notifications: result.rows });
  } catch (error) {
    console.error('Get admin notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

/**
 * POST /api/subscription/admin-notifications/:id/read
 * Mark an admin notification as read
 */
router.post('/admin-notifications/:id/read', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await pool.query(`
      INSERT INTO user_notification_reads (notification_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (notification_id, user_id) DO NOTHING
    `, [id, req.userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Mark admin notification read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

/**
 * GET /api/subscription/payment-slip
 * Get current user's uploaded payment slip info
 */
router.get('/payment-slip', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT payment_slip_url, payment_slip_uploaded_at, payment_slip_plan FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { payment_slip_url, payment_slip_uploaded_at, payment_slip_plan } = result.rows[0];

    res.json({
      slipUrl: payment_slip_url || null,
      uploadedAt: payment_slip_uploaded_at || null,
      plan: payment_slip_plan || null,
    });
  } catch (error) {
    console.error('Get payment slip error:', error);
    res.status(500).json({ error: 'Failed to get payment slip' });
  }
});

/**
 * POST /api/subscription/upload-slip
 * Upload payment slip image to S3
 */
router.post('/upload-slip', authenticate, slipUpload.single('slip'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const plan = req.body.plan || 'monthly';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const key = `payment-slips/slip-${uniqueSuffix}${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    // Store proxy URL (served through our backend)
    const slipUrl = `/api/subscription/slips/${key}`;

    await pool.query(
      `UPDATE users SET payment_slip_url = $1, payment_slip_uploaded_at = NOW(), payment_slip_plan = $2 WHERE id = $3`,
      [slipUrl, plan, req.userId]
    );

    res.json({ success: true, url: slipUrl });
  } catch (error) {
    console.error('Upload slip error:', error);
    res.status(500).json({ error: 'Failed to upload slip' });
  }
});

/**
 * GET /api/subscription/slips/*
 * Proxy payment slip from S3
 */
router.get('/slips/*', async (req, res: Response) => {
  try {
    const key = (req.params as any)[0];
    const response = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }));

    if (response.ContentType) {
      res.setHeader('Content-Type', response.ContentType);
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const stream = response.Body as any;
    stream.pipe(res);
  } catch (error: any) {
    console.error('Slip proxy error:', error.message);
    res.status(404).json({ error: 'Not found' });
  }
});

/**
 * POST /api/subscription/v2/verify-and-approve
 * Auto-approve subscription via Thunder API slip verification.
 * Replaces the manual admin approval flow for bank transfers.
 */
router.post('/v2/verify-and-approve', authenticate, slipUpload.single('slip'), async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const client = await pool.connect();

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded', errorCode: 'NO_FILE' });
    }

    // Accept either the legacy `plan: 'monthly' | 'yearly'` field or the new
    // `plan_slug` (any slug from subscription_plans). New custom plans created
    // by admin only flow through plan_slug.
    const rawSlug: string = String(req.body.plan_slug || req.body.plan || 'monthly').toLowerCase();
    const planRecord = await plansService.getPlanBySlug(rawSlug);

    if (!planRecord || !planRecord.is_active) {
      return res.status(400).json({
        error: `Unknown or inactive plan: ${rawSlug}`,
        errorCode: 'INVALID_PLAN',
      });
    }

    const plan = planRecord.slug; // canonical slug stored on the row
    const expectedAmount = planRecord.total; // vat-inclusive total (e.g. 642, 3210)
    const days = planRecord.days;

    // 1. Upload slip to S3 first (so we have a record even if verify fails)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const s3Key = `payment-slips/auto-${uniqueSuffix}${ext}`;
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));
    const slipUrl = `/api/subscription/slips/${s3Key}`;

    // 2. Call Thunder API to verify
    let thunderData;
    try {
      thunderData = await verifySlipImage(req.file.buffer, req.file.mimetype);
    } catch (err: any) {
      if (err instanceof ThunderError) {
        // Pass Thunder error code directly (e.g. duplicate_slip, slip_not_found, qrcode_not_found)
        return res.status(400).json({ error: err.message, errorCode: err.code });
      }
      throw err;
    }

    // 3. Validate slip data
    // 3a. Duplicate check (Thunder tracks this)
    if (thunderData.isDuplicate) {
      return res.status(400).json({ error: 'Slip already used', errorCode: 'DUPLICATE_SLIP' });
    }

    // 3b. Account check via Thunder matchedAccount (no rawSlip fallback)
    // matchedAccount is populated only when matchAccount=true in the request and
    // Thunder successfully cross-references the receiver against its database.
    // We only check the account number (not bank code) — simpler, and Thunder
    // already only matches against accounts we registered at the dashboard.
    // PAYMENT_BANK_ACCOUNT supports comma-separated list — slip is valid if it
    // matches ANY listed receiver account (e.g. company + legacy personal).
    const expectedAccounts = (process.env.PAYMENT_BANK_ACCOUNT || '2313088165')
      .split(',')
      .map((a) => a.replace(/\D/g, ''))
      .filter(Boolean);
    const matched = thunderData.matchedAccount;

    if (!matched) {
      // Thunder could not match the slip receiver — reject (no fallback)
      return res.status(400).json({
        error: 'Could not verify recipient account from slip',
        errorCode: 'INVALID_ACCOUNT',
      });
    }

    const matchedNumber = (matched.bankNumber || '').replace(/[-\s]/g, '');
    if (!expectedAccounts.includes(matchedNumber)) {
      return res.status(400).json({
        error: `Receiver account does not match (got ${matched.bankNumber})`,
        errorCode: 'INVALID_ACCOUNT',
      });
    }

    // 3d. Amount check
    if (thunderData.amountInSlip !== expectedAmount) {
      return res.status(400).json({
        error: `Amount mismatch: expected ฿${expectedAmount}, got ฿${thunderData.amountInSlip}`,
        errorCode: 'INVALID_AMOUNT',
      });
    }

    // 3e. Date check (within 24h)
    const slipDate = new Date(thunderData.rawSlip.date);
    const now = new Date();
    const ageMs = now.getTime() - slipDate.getTime();
    const maxAgeMs = 24 * 60 * 60 * 1000;
    if (ageMs > maxAgeMs) {
      return res.status(400).json({
        error: `Slip too old (${Math.floor(ageMs / 3600000)}h ago)`,
        errorCode: 'EXPIRED_SLIP',
      });
    }

    // 4. All validations passed - approve subscription in transaction
    await client.query('BEGIN');

    // Get current subscription expiry + referrer
    const userResult = await client.query(
      'SELECT subscription_expires_at, referrer_id FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const currentExpiry = userResult.rows[0].subscription_expires_at;
    const referrerId = userResult.rows[0].referrer_id;
    const baseDate = currentExpiry && new Date(currentExpiry) > new Date()
      ? new Date(currentExpiry)
      : new Date();
    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + days);

    // Update users.subscription_expires_at
    await client.query(
      `UPDATE users SET subscription_expires_at = $1 WHERE id = $2`,
      [newExpiry.toISOString(), userId]
    );

    // UPSERT subscriptions
    const subUpdate = await client.query(
      `UPDATE subscriptions SET plan_type = $2, current_period_end = $3, status = 'active' WHERE user_id = $1`,
      [userId, plan, newExpiry.toISOString()]
    );
    if (subUpdate.rowCount === 0) {
      await client.query(
        `INSERT INTO subscriptions (user_id, stripe_customer_id, plan_type, status, current_period_end)
         VALUES ($1, $2, $3, 'active', $4)`,
        [userId, `autoapprove_${userId}`, plan, newExpiry.toISOString()]
      );
    }

    // INSERT extension log with approval_method='autoapprove'
    // amount = vat-inclusive total user paid (legacy semantic preserved)
    // subtotal/vat_amount/vat_rate = breakdown for accounting / tax invoice
    await client.query(
      `INSERT INTO subscription_extension_logs
         (user_id, admin_id, days_added, amount, slip_url, approval_method,
          subtotal, vat_amount, vat_rate)
       VALUES ($1, NULL, $2, $3, $4, 'autoapprove', $5, $6, $7)`,
      [
        userId,
        days,
        String(planRecord.total),
        slipUrl,
        planRecord.subtotal,
        planRecord.vat,
        VAT_RATE,
      ]
    );

    await client.query('COMMIT');

    // Create affiliate commission outside transaction (best-effort).
    // Commission base = pre-VAT subtotal (e.g. ฿600/฿3,000), per business
    // decision. The user paid the vat-inclusive total but the commission is
    // calculated on the goods price only (VAT is remitted to Revenue Dept,
    // not paid out as commission).
    let commissionCreated = false;
    if (referrerId) {
      try {
        const subtotalCents = Math.round(planRecord.subtotal * 100);
        await createAffiliateCommission(
          userId,
          // slip_id is unique-per-payment so timestamp suffix is fine here
          `autoapprove_${userId}_${Date.now()}`,
          subtotalCents,
          'THB',
          planRecord.slug  // enables per-plan commission override
        );
        commissionCreated = true;
      } catch (commissionError) {
        console.error('[autoapprove] Failed to create affiliate commission:', commissionError);
      }
    }

    // Auto-tier promotion based on the plan's tier_id (promote-only, safe).
    // Best-effort; never blocks the response. Silent no-op on unmigrated DBs.
    let tierPromotion: Awaited<ReturnType<typeof maybePromoteOnPurchase>> | null = null;
    try {
      tierPromotion = await maybePromoteOnPurchase({
        userId,
        planId: planRecord.id,
        planSlug: planRecord.slug,
      });
    } catch (tierErr) {
      console.error('[autoapprove] Tier promotion failed:', tierErr);
    }

    res.json({
      success: true,
      expiresAt: newExpiry.toISOString(),
      plan,
      commissionCreated,
      tierPromotion,
      transRef: thunderData.rawSlip.transRef,
    });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[autoapprove] Error:', error);
    res.status(500).json({ error: error.message || 'Internal error', errorCode: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

/* ================================================================== */
/*  Payment History + Tax Invoice Requests (user side)                  */
/*  Schema: migration 013_tax_invoice_requests                          */
/* ================================================================== */

/**
 * GET /api/subscription/extension-history
 * Returns the caller's paid subscription extensions with invoice-request join.
 * Filtered to real payments only (approval_method ∈ {admin, autoapprove,
 * stripe} AND amount > 0). Coupon redemptions and admin promo grants are
 * intentionally excluded — no money exchanged means no invoice eligibility.
 */
router.get('/extension-history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const history = await taxInvoiceService.listForUser(req.userId!);
    res.json({ history });
  } catch (err: any) {
    console.error('[extension-history] failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to load history' });
  }
});

/**
 * POST /api/subscription/extension-history/:logId/request-invoice
 * Idempotent: UNIQUE constraint on extension_log_id blocks duplicate requests
 * → returns 409. User can only request invoice for their OWN extensions
 * (checked in service via `user_id` match).
 */
router.post(
  '/extension-history/:logId/request-invoice',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const logId = Number(req.params.logId);
      if (!Number.isInteger(logId)) return res.status(400).json({ error: 'Invalid log id' });

      const result = await taxInvoiceService.requestInvoice(req.userId!, logId);
      if (!result.ok) {
        if (result.error === 'already_requested') return res.status(409).json({ error: result.error });
        if (result.error === 'not_eligible') return res.status(400).json({ error: result.error });
        return res.status(404).json({ error: result.error });
      }
      res.status(201).json({ success: true, request: result.request });
    } catch (err: any) {
      console.error('[request-invoice] failed:', err);
      res.status(500).json({ error: err?.message || 'Failed to request invoice' });
    }
  }
);

/**
 * GET /api/subscription/tax-invoice/:requestId/file
 * Auth proxy — owner only. Streams the invoice file (PDF/image) from OBS
 * with `Content-Disposition: inline` (default) or `attachment` when the
 * client passes `?download=1`. Mirrors the id-card proxy pattern in
 * affiliate.ts — bypasses HWC OBS's forced-attachment behaviour on
 * extensionless keys.
 */
router.get('/tax-invoice/:requestId/file', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const requestId = Number(req.params.requestId);
    if (!Number.isInteger(requestId)) return res.status(400).json({ error: 'Invalid request id' });

    const row = await taxInvoiceService.getRequest(requestId);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (row.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });
    if (!row.invoice_url) return res.status(404).json({ error: 'No invoice file uploaded yet' });

    const download = req.query.download === '1' || req.query.download === 'true';
    const dispositionHeader = download
      ? `attachment; filename="invoice-${requestId}.pdf"`
      : 'inline';

    // Local-dev: invoice_url starts with /uploads/...
    if (row.invoice_url.startsWith('/uploads/')) {
      const localPath = path.join(process.cwd(), row.invoice_url.replace(/^\//, ''));
      if (!fs.existsSync(localPath)) return res.status(404).json({ error: 'File missing' });
      const ext = path.extname(localPath).toLowerCase();
      const mime = ext === '.pdf' ? 'application/pdf'
        : ext === '.png' ? 'image/png'
        : ext === '.webp' ? 'image/webp'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', dispositionHeader);
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(localPath).pipe(res);
      return;
    }

    // S3/OBS path
    if (!getBucketName()) return res.status(500).json({ error: 'S3 not configured' });
    const fileStream = await getFile(row.invoice_url);
    res.setHeader('Content-Type', fileStream.ContentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', dispositionHeader);
    res.setHeader('Cache-Control', 'no-store');
    (fileStream.Body as any)?.pipe(res);
  } catch (err: any) {
    console.error('[tax-invoice file] failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to stream invoice' });
  }
});

/* ================================================================== */
/*  Welcome Banner — public read of the currently-active banner         */
/*  Schema: migration 014_welcome_banners                               */
/* ================================================================== */

/**
 * GET /api/subscription/welcome-banner/active
 * Returns the active welcome banner `{ id, image_url, link_url }` or null.
 * Authenticated because the WelcomePopup only renders for logged-in users.
 * Routed via subscription.ts purely as a co-location convenience — it
 * doesn't actually touch subscription data. The path is /api/subscription/...
 * because of the mount point in server/src/index.ts.
 */
router.get('/welcome-banner/active', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query<{ id: number; image_url: string; link_url: string }>(
      `SELECT id, image_url, link_url
         FROM welcome_banners
        WHERE is_active = true
        LIMIT 1`
    );
    res.json({ banner: r.rows[0] ?? null });
  } catch (err: any) {
    console.error('[welcome-banner/active] failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to load welcome banner' });
  }
});

export default router;
