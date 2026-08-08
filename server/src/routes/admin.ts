import express, { Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { authenticate, requireAdmin, requireSuperAdmin, AuthRequest } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createAffiliateCommission } from '../services/stripeService.js';
import pool from '../db.js';
import { getBucketName, uploadFile, getSignedFileUrl, getFile } from '../utils/s3.js';
import { uploadBufferToDropbox } from '../utils/dropbox.js';
import { verifySlipImage, ThunderError } from '../utils/thunderApi.js';
import { PRICING, VAT_RATE, pricingFromDays, planFromDays } from '../config/pricing.js';
import * as plansService from '../services/plansService.js';
import * as tiersService from '../services/tiersService.js';
import { maybePromoteOnPurchase } from '../services/tierAssignmentService.js';
import * as commissionService from '../services/commissionService.js';
import * as taxInvoiceService from '../services/taxInvoiceService.js';

// Multer for slip upload
const slipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// Multer for tax-invoice upload — accepts PDF + images, larger cap (10 MB)
// because PDFs can be heavier than slip JPGs.
const invoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF / JPEG / PNG / WebP files are allowed'));
  },
});

const router = express.Router();

// Throttle admin slip verification (per admin user).
const adminSlipRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyBy: (req) => (req.userId ? `admin-slip:${req.userId}` : undefined),
});

type UserStatusFilter =
  | 'all'
  | 'active'
  | 'monthly'
  | 'yearly'
  | 'no_sub'
  | 'expired'
  | 'referrers'
  | 'new_payment'
  | 'pending';

/**
 * Build SQL WHERE conditions for a given status filter and search term.
 * Returns clause array (joined with AND) plus the parameter values to bind.
 *
 * Status definitions mirror the FE status logic in the previous version:
 *   pending  = !is_approved OR (has slip AND no active sub AND no future manual sub)
 *   active   = approved AND (active stripe sub OR future manual sub)
 *   monthly  = active AND s.plan_type = 'monthly'
 *   yearly   = active AND s.plan_type = 'yearly'
 *   no_sub   = approved AND no slip AND no sub of any kind
 *   expired  = approved AND no slip AND no active sub AND has expired manual date
 *   referrers   = has at least one referee
 *   new_payment = has extension log within last 7 days
 *   all      = approved non-pending users (matches old FE: filter(u => u.status !== 'pending'))
 */
function buildUserFilter(status: UserStatusFilter, search: string, startIdx = 1) {
  const clauses: string[] = [];
  const params: any[] = [];
  let idx = startIdx;

  if (search && search.trim()) {
    clauses.push(`u.email ILIKE $${idx++}`);
    params.push(`%${search.trim()}%`);
  }

  const PENDING_PREDICATE =
    `(u.is_approved = false ` +
    `OR (u.payment_slip_url IS NOT NULL ` +
    `    AND s.status IS NULL ` +
    `    AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at <= NOW())))`;
  const ACTIVE_PREDICATE =
    `(u.is_approved = true AND (s.status = 'active' OR u.subscription_expires_at > NOW()))`;

  switch (status) {
    case 'pending':
      clauses.push(PENDING_PREDICATE);
      break;
    case 'all':
      // Exclude pending — same as old FE: filter(u => u.status !== 'pending')
      clauses.push(`NOT ${PENDING_PREDICATE}`);
      break;
    case 'active':
      clauses.push(ACTIVE_PREDICATE);
      break;
    case 'monthly':
      clauses.push(`${ACTIVE_PREDICATE} AND s.plan_type = 'monthly'`);
      break;
    case 'yearly':
      clauses.push(`${ACTIVE_PREDICATE} AND s.plan_type = 'yearly'`);
      break;
    case 'no_sub':
      clauses.push(
        `(u.is_approved = true AND u.payment_slip_url IS NULL ` +
          `AND s.status IS NULL AND u.subscription_expires_at IS NULL)`
      );
      break;
    case 'expired':
      clauses.push(
        `(u.is_approved = true AND u.payment_slip_url IS NULL ` +
          `AND s.status IS NULL AND u.subscription_expires_at IS NOT NULL ` +
          `AND u.subscription_expires_at <= NOW())`
      );
      break;
    case 'referrers':
      clauses.push(`EXISTS (SELECT 1 FROM users r WHERE r.referrer_id = u.id)`);
      break;
    case 'new_payment':
      clauses.push(
        `EXISTS (SELECT 1 FROM subscription_extension_logs l ` +
          `WHERE l.user_id = u.id AND l.created_at > NOW() - INTERVAL '7 days')`
      );
      break;
  }

  return { clauses, params, nextIdx: idx };
}

/**
 * GET /api/admin/users
 * Paginated, server-side filtered + searched user list.
 *
 * Query params:
 *   status  = all | active | monthly | yearly | no_sub | expired | referrers | new_payment | pending
 *   search  = email substring (ILIKE)
 *   page    = 1-based, default 1
 *   limit   = 1..100, default 50
 *
 * Response: { users: [...], pagination: { total, page, limit, hasMore } }
 *
 * Note: latestExtendSlipUrl is returned as a raw S3 key (no signing here) —
 *       the client must call POST /api/admin/sign-slip-urls when it actually needs to display.
 */
router.get('/users', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const status = ((req.query.status as string) || 'all') as UserStatusFilter;
    const search = (req.query.search as string) || '';
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 50, 100));
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const offset = (page - 1) * limit;

    const { clauses, params, nextIdx } = buildUserFilter(status, search, 1);
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    // Sort: new_payment → by latest log; pending → join_date DESC; others → join_date DESC
    const orderSql =
      status === 'new_payment'
        ? `ORDER BY latest_ext.created_at DESC NULLS LAST, u.join_date DESC`
        : `ORDER BY u.join_date DESC, u.id DESC`;

    const limitIdx = nextIdx;
    const offsetIdx = nextIdx + 1;
    const listSql = `
      SELECT
        u.id, u.email, u.credits, u.is_admin, u.join_date,
        u.is_approved, u.subscription_expires_at,
        u.payment_slip_url, u.payment_slip_uploaded_at, u.payment_slip_plan,
        s.status as sub_status, s.plan_type, s.current_period_end,
        u.refcode, u.commission_percent, u.wise_email,
        u.preferred_payout_method, u.affiliate_tier,
        uba.bank_name, uba.account_number, uba.account_holder,
        (SELECT COUNT(*) FROM users ref WHERE ref.referrer_id = u.id) as total_referrals,
        COALESCE((SELECT SUM(amount) FROM affiliate_commissions WHERE referrer_id = u.id AND status = 'transferred'), 0) as total_transferred,
        COALESCE((SELECT SUM(amount) FROM affiliate_commissions WHERE referrer_id = u.id AND status = 'pending'), 0) as pending_amount,
        latest_ext.slip_url        as latest_extend_slip_url,
        latest_ext.created_at      as latest_extend_slip_at,
        latest_ext.days_added      as latest_payment_days,
        latest_ext.amount          as latest_payment_amount,
        latest_ext.approval_method as latest_approval_method
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      LEFT JOIN user_bank_accounts uba ON uba.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT slip_url, created_at, days_added, amount, approval_method
        FROM subscription_extension_logs
        WHERE user_id = u.id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest_ext ON true
      ${whereSql}
      ${orderSql}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      ${whereSql}
    `;

    const [listRes, countRes] = await Promise.all([
      pool.query(listSql, [...params, limit, offset]),
      pool.query(countSql, params),
    ]);

    const total = countRes.rows[0]?.total ?? 0;

    const users = listRes.rows.map((user: any) => {
      const hasStripeSub = user.sub_status === 'active';
      const hasManualSub = user.subscription_expires_at && new Date(user.subscription_expires_at) > new Date();
      const expiresAt = hasStripeSub ? user.current_period_end : user.subscription_expires_at;

      return {
        id: user.id,
        email: user.email,
        credits: user.credits,
        isAdmin: user.is_admin,
        joinDate: user.join_date,
        isApproved: user.is_approved,
        subscriptionExpiresAt: expiresAt,
        planType: user.plan_type || null,
        status: !user.is_approved
          ? 'pending'
          : user.payment_slip_url && !hasStripeSub && !hasManualSub
          ? 'pending'
          : hasStripeSub || hasManualSub
          ? 'active'
          : user.subscription_expires_at
          ? 'expired'
          : 'no_subscription',
        paymentSlipUrl: user.payment_slip_url || null,
        paymentSlipUploadedAt: user.payment_slip_uploaded_at || null,
        paymentSlipPlan: user.payment_slip_plan || null,
        refcode: user.refcode || null,
        commissionPercent: user.commission_percent || 0,
        wiseEmail: user.wise_email || null,
        preferredPayoutMethod: user.preferred_payout_method || 'wise',
        affiliateTier: user.affiliate_tier || 1,
        bankInfo: user.bank_name
          ? {
              bankName: user.bank_name,
              accountNumber: user.account_number,
              accountHolder: user.account_holder,
            }
          : null,
        totalReferrals: parseInt(user.total_referrals) || 0,
        totalTransferred: parseFloat(user.total_transferred) || 0,
        pendingAmount: parseFloat(user.pending_amount) || 0,
        // Raw key — client signs on demand via POST /api/admin/sign-slip-urls
        latestExtendSlipUrl: user.latest_extend_slip_url || null,
        latestExtendSlipAt: user.latest_extend_slip_at || null,
        latestPaymentDays: user.latest_payment_days ? parseInt(user.latest_payment_days) : null,
        latestPaymentAmount: user.latest_payment_amount || null,
        latestPaymentAt: user.latest_extend_slip_at || null,
        latestApprovalMethod: user.latest_approval_method || null,
      };
    });

    res.json({
      users,
      pagination: {
        total,
        page,
        limit,
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

/**
 * GET /api/admin/users/counts
 * Global counts per filter — does NOT accept ?search= so the tab badges
 * show overall totals regardless of what the admin is searching for.
 *
 * Response: { counts: { all, active, monthly, yearly, no_sub, expired, referrers, new_payment, pending } }
 */
router.get('/users/counts', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const sql = `
      SELECT
        COUNT(*) FILTER (
          WHERE u.is_approved = false
             OR (u.payment_slip_url IS NOT NULL
                 AND s.status IS NULL
                 AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at <= NOW()))
        )::int AS pending,
        COUNT(*) FILTER (
          WHERE NOT (
            u.is_approved = false
            OR (u.payment_slip_url IS NOT NULL
                AND s.status IS NULL
                AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at <= NOW()))
          )
        )::int AS all_count,
        COUNT(*) FILTER (
          WHERE u.is_approved = true
            AND (s.status = 'active' OR u.subscription_expires_at > NOW())
        )::int AS active,
        COUNT(*) FILTER (
          WHERE u.is_approved = true
            AND (s.status = 'active' OR u.subscription_expires_at > NOW())
            AND s.plan_type = 'monthly'
        )::int AS monthly,
        COUNT(*) FILTER (
          WHERE u.is_approved = true
            AND (s.status = 'active' OR u.subscription_expires_at > NOW())
            AND s.plan_type = 'yearly'
        )::int AS yearly,
        COUNT(*) FILTER (
          WHERE u.is_approved = true AND u.payment_slip_url IS NULL
            AND s.status IS NULL AND u.subscription_expires_at IS NULL
        )::int AS no_sub,
        COUNT(*) FILTER (
          WHERE u.is_approved = true AND u.payment_slip_url IS NULL
            AND s.status IS NULL AND u.subscription_expires_at IS NOT NULL
            AND u.subscription_expires_at <= NOW()
        )::int AS expired,
        COUNT(*) FILTER (
          WHERE EXISTS (SELECT 1 FROM users r WHERE r.referrer_id = u.id)
        )::int AS referrers,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM subscription_extension_logs l
            WHERE l.user_id = u.id AND l.created_at > NOW() - INTERVAL '7 days'
          )
        )::int AS new_payment
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
    `;
    const result = await pool.query(sql);
    const r = result.rows[0] || {};
    res.json({
      counts: {
        all: r.all_count ?? 0,
        active: r.active ?? 0,
        monthly: r.monthly ?? 0,
        yearly: r.yearly ?? 0,
        no_sub: r.no_sub ?? 0,
        expired: r.expired ?? 0,
        referrers: r.referrers ?? 0,
        new_payment: r.new_payment ?? 0,
        pending: r.pending ?? 0,
      },
    });
  } catch (error) {
    console.error('Get user counts error:', error);
    res.status(500).json({ error: 'Failed to get user counts' });
  }
});

/**
 * POST /api/admin/sign-slip-urls
 * Batch-sign S3 keys (extend slip URLs).
 * Body: { keys: string[] } (max 100)
 * Response: { urls: { [key]: signedUrl } }
 */
router.post('/sign-slip-urls', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const keys: unknown = req.body?.keys;
    if (!Array.isArray(keys)) {
      return res.status(400).json({ error: 'keys must be an array of strings' });
    }
    const trimmed = keys
      .filter((k): k is string => typeof k === 'string' && k.length > 0)
      .slice(0, 100);

    const entries = await Promise.all(
      trimmed.map(async (key) => {
        // Only sign keys that look like S3 storage keys; pass through full URLs / local paths unchanged
        if (key.startsWith('extend-slips/') || key.startsWith('affiliate-proofs/')) {
          try {
            return [key, await getSignedFileUrl(key)] as const;
          } catch (err) {
            console.error('Failed to sign slip URL:', key, err);
            return [key, null] as const;
          }
        }
        return [key, key] as const;
      })
    );

    const urls: Record<string, string | null> = {};
    for (const [k, v] of entries) urls[k] = v;
    res.json({ urls });
  } catch (error) {
    console.error('Sign slip URLs error:', error);
    res.status(500).json({ error: 'Failed to sign slip URLs' });
  }
});

/**
 * PATCH /api/admin/users/:id/approve
 * Approve a pending user
 */
router.patch('/users/:id/approve', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.userId;

    // Capture pre-state so we only audit-log when something actually changed
    // (avoid log spam — handleApprove is called for every approve click,
    // but new users are auto-approved at register time).
    const before = await pool.query('SELECT is_approved FROM users WHERE id = $1', [id]);
    if (before.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const wasAlreadyApproved = !!before.rows[0].is_approved;

    const result = await pool.query(
      `UPDATE users SET is_approved = true WHERE id = $1
       RETURNING id, email, is_approved`,
      [id]
    );

    // Audit log only on actual transition (false → true).
    if (!wasAlreadyApproved) {
      await pool.query(
        `INSERT INTO subscription_extension_logs (user_id, admin_id, days_added, amount, slip_url, approval_method, notes)
         VALUES ($1, $2, 0, NULL, NULL, 'admin_approve', 'Manually approved account')`,
        [id, adminId]
      );
    }

    res.json({
      success: true,
      user: result.rows[0],
      message: 'User approved successfully'
    });
  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({ error: 'Failed to approve user' });
  }
});

/**
 * PATCH /api/admin/users/:id/extend
 * Extend user subscription by specified days
 * Also creates affiliate commission if user has referrer
 */
router.patch('/users/:id/extend', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { days, planType, planSlug, planId, amount, slipUrl } = req.body;

    const numDays = Number(days);
    if (!Number.isFinite(numDays) || numDays <= 0 || numDays > 3650) {
      return res.status(400).json({ error: 'Days must be a positive number (≤ 3650)' });
    }

    // Server-side guard: extending without an attached payment slip requires
    // super-admin privileges. Slips that pass through /upload-extend-slip are
    // already Thunder-verified, so any slipUrl here is treated as proof of
    // payment. The "Adjust days" + bypass-code flows have no slip → super
    // admin only.
    if (!slipUrl && !req.isSuperAdmin) {
      return res.status(403).json({
        error: 'A verified payment slip is required (or super-admin privileges).',
        errorCode: 'SLIP_REQUIRED',
      });
    }

    // Resolve plan slug. Priority:
    //   1. planSlug (new — supports admin-created custom plans)
    //   2. planId  (new — resolved to its slug via plansService)
    //   3. planType (legacy 'monthly' | 'yearly')
    //   4. derived from days (≥365 → yearly else monthly)
    let resolvedPlan: string;
    if (typeof planSlug === 'string' && planSlug.trim()) {
      resolvedPlan = planSlug.trim().toLowerCase();
    } else if (planId !== undefined && planId !== null) {
      const found = await plansService.getPlanById(Number(planId));
      resolvedPlan = found ? found.slug : (numDays >= 365 ? 'yearly' : 'monthly');
    } else if (typeof planType === 'string' && planType.trim()) {
      resolvedPlan = planType.trim().toLowerCase();
    } else {
      resolvedPlan = numDays >= 365 ? 'yearly' : 'monthly';
    }
    const plan = resolvedPlan;
    const adminId = req.userId;

    // Get current subscription expiry and referrer info
    const userResult = await pool.query(
      'SELECT subscription_expires_at, referrer_id FROM users WHERE id = $1',
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate new expiry: from current expiry (if future) or from now
    const currentExpiry = userResult.rows[0].subscription_expires_at;
    const referrerId = userResult.rows[0].referrer_id;
    const baseDate = currentExpiry && new Date(currentExpiry) > new Date()
      ? new Date(currentExpiry)
      : new Date();

    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + numDays);

    // Update users table
    const result = await pool.query(
      `UPDATE users SET subscription_expires_at = $1 WHERE id = $2
       RETURNING id, email, subscription_expires_at`,
      [newExpiry.toISOString(), id]
    );

    // Update or insert subscription record to set plan_type
    const subUpdate = await pool.query(
      `UPDATE subscriptions SET plan_type = $2, current_period_end = $3, status = 'active' WHERE user_id = $1`,
      [id, plan, newExpiry.toISOString()]
    );
    if (subUpdate.rowCount === 0) {
      await pool.query(
        `INSERT INTO subscriptions (user_id, stripe_customer_id, plan_type, status, current_period_end)
         VALUES ($1, $2, $3, 'active', $4)`,
        [id, `manual_${id}`, plan, newExpiry.toISOString()]
      );
    }

    // Compute the VAT split for the audit log. The amount we log is the
    // *vat-inclusive total* (matches what user paid). When admin sends
    // a custom amount we still split by VAT_RATE so the breakdown is
    // self-consistent. When admin sends nothing we fall back to the plan total.
    //
    // Look up the matching subscription_plan if any — used both for the default
    // amount and so the affiliate commission can apply per-plan overrides.
    const planRecord = await plansService.getPlanBySlug(plan).catch(() => null);
    const fallbackPricing = pricingFromDays(numDays); // legacy hardcoded fallback (matches seeded monthly/yearly)
    const defaultTotal = planRecord?.total ?? fallbackPricing.total;
    const totalPaid = amount ? Number(amount) : defaultTotal;
    // Split inclusively: subtotal × (1 + vat) = total
    const subtotal = +(totalPaid / (1 + VAT_RATE / 100)).toFixed(2);
    const vatAmount = +(totalPaid - subtotal).toFixed(2);

    await pool.query(
      `INSERT INTO subscription_extension_logs
         (user_id, admin_id, days_added, amount, slip_url, approval_method,
          subtotal, vat_amount, vat_rate)
       VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, $8)`,
      [id, adminId, numDays, String(totalPaid), slipUrl || null, subtotal, vatAmount, VAT_RATE]
    );

    // Create affiliate commission if user has referrer.
    //
    // 1) Commission base = pre-VAT subtotal (matches user-side autoapprove +
    //    Stripe webhook). VAT is collected for Revenue Dept, not for the
    //    affiliate. So for a ฿642 monthly payment the base is ฿600.
    //    Yearly promo (฿2,996 paid) → base ฿2,800.
    // 2) Idempotency key uses the new period_end day so an admin who clicks
    //    +30d twice within the same period only triggers ONE commission row
    //    (DB unique-constraint on (referee_id, stripe_invoice_id) blocks the
    //    second insert via ON CONFLICT DO NOTHING in createAffiliateCommission).
    // 3) Admin extend = real payment (per business decision 2026-05-14):
    //    pay commission to referrer regardless of slipUrl. The previous
    //    "skip if no slip" rule blocked admin "Adjust Days" from paying out
    //    even though the user is effectively on a subscription.
    let commissionCreated = false;
    if (referrerId) {
      try {
        // subtotal = totalPaid / (1 + VAT/100), already computed above.
        const subtotalCents = Math.round(subtotal * 100);
        const periodKey = newExpiry.toISOString().slice(0, 10); // 2026-06-06
        await createAffiliateCommission(
          parseInt(id),
          `admin_extend_${id}_${plan}_${periodKey}`,
          subtotalCents,
          'THB',
          plan  // pass slug so per-plan commission override can apply
        );
        commissionCreated = true;
      } catch (commissionError) {
        console.error('Failed to create affiliate commission:', commissionError);
      }
    }

    // Auto-tier promotion based on the plan's tier_id. Best-effort + promote-only:
    // never demotes a user who is already on a higher tier (e.g. Tier 2 user
    // doing a monthly top-up doesn't drop to Tier 1). Silent no-op on
    // unmigrated DBs.
    let tierPromotion: Awaited<ReturnType<typeof maybePromoteOnPurchase>> | null = null;
    try {
      tierPromotion = await maybePromoteOnPurchase({
        userId: parseInt(id),
        planSlug: plan,
        planId: planRecord?.id ?? null,
      });
    } catch (tierErr) {
      console.error('[admin.extend] Tier promotion failed:', tierErr);
    }

    res.json({
      success: true,
      user: {
        id: result.rows[0].id,
        email: result.rows[0].email,
        subscriptionExpiresAt: result.rows[0].subscription_expires_at,
      },
      message: `Added ${numDays} days to subscription (${plan})`,
      commissionCreated,
      tierPromotion,
    });
  } catch (error) {
    console.error('Extend subscription error:', error);
    res.status(500).json({ error: 'Failed to extend subscription' });
  }
});

/**
 * PATCH /api/admin/users/:id/reduce
 * Reduce user subscription by specified days
 * Super admin only — used by the "Adjust days" menu (reduce mode).
 */
router.patch('/users/:id/reduce', authenticate, requireAdmin, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { days } = req.body;
    const adminId = req.userId;

    const numDays = Number(days);
    if (!Number.isFinite(numDays) || numDays <= 0) {
      return res.status(400).json({ error: 'Days must be positive' });
    }

    const userResult = await pool.query(
      'SELECT subscription_expires_at FROM users WHERE id = $1',
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentExpiry = userResult.rows[0].subscription_expires_at;
    if (!currentExpiry) {
      return res.status(400).json({ error: 'User has no subscription' });
    }

    const newExpiry = new Date(currentExpiry);
    newExpiry.setDate(newExpiry.getDate() - numDays);

    await pool.query(
      'UPDATE users SET subscription_expires_at = $1 WHERE id = $2',
      [newExpiry.toISOString(), id]
    );

    // Update subscription record too
    await pool.query(
      'UPDATE subscriptions SET current_period_end = $1 WHERE user_id = $2',
      [newExpiry.toISOString(), id]
    );

    // Audit log — record who reduced and by how much. days_added is stored
    // negative so the timeline reads naturally (-7 = "removed 7 days").
    await pool.query(
      `INSERT INTO subscription_extension_logs (user_id, admin_id, days_added, amount, slip_url, approval_method, notes)
       VALUES ($1, $2, $3, NULL, NULL, 'admin_reduce', $4)`,
      [id, adminId, -numDays, `Reduced ${numDays} day${numDays === 1 ? '' : 's'}`]
    );

    res.json({ success: true, message: `Reduced ${numDays} days from subscription` });
  } catch (error) {
    console.error('Reduce subscription error:', error);
    res.status(500).json({ error: 'Failed to reduce subscription' });
  }
});

/**
 * PATCH /api/admin/users/:id/change-plan
 * Change user plan type (monthly/yearly)
 */
router.patch('/users/:id/change-plan', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { plan } = req.body;
    const adminId = req.userId;

    if (!plan || !['monthly', 'yearly'].includes(plan)) {
      return res.status(400).json({ error: 'Plan must be monthly or yearly' });
    }

    // Capture the old plan for the audit note (if any).
    const before = await pool.query(
      "SELECT plan_type FROM subscriptions WHERE user_id = $1 AND status = 'active'",
      [id]
    );
    const oldPlan = before.rows[0]?.plan_type || 'none';

    const updated = await pool.query(
      "UPDATE subscriptions SET plan_type = $1 WHERE user_id = $2 AND status = 'active' RETURNING id",
      [plan, id]
    );

    if (updated.rowCount === 0) {
      // Create subscription record if not exists
      await pool.query(
        `INSERT INTO subscriptions (user_id, stripe_customer_id, plan_type, status, current_period_end)
         VALUES ($1, $2, $3, 'active', (SELECT subscription_expires_at FROM users WHERE id = $1))`,
        [id, `manual_${id}`, plan]
      );
    }

    // Audit log — no day/amount change, just an attributable note.
    await pool.query(
      `INSERT INTO subscription_extension_logs (user_id, admin_id, days_added, amount, slip_url, approval_method, notes)
       VALUES ($1, $2, 0, NULL, NULL, 'admin_plan_change', $3)`,
      [id, adminId, `Plan: ${oldPlan} → ${plan}`]
    );

    res.json({ success: true, message: `Changed to ${plan}` });
  } catch (error) {
    console.error('Change plan error:', error);
    res.status(500).json({ error: 'Failed to change plan' });
  }
});

/**
 * PATCH /api/admin/users/:id/set-referrer
 * Set referrer for a user (fix missing referral link)
 */
router.patch('/users/:id/set-referrer', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { refcode } = req.body;
    const adminId = req.userId;

    if (!refcode) {
      return res.status(400).json({ error: 'Refcode is required' });
    }

    // Look up referrer by refcode
    const referrerResult = await pool.query(
      'SELECT id, email FROM users WHERE refcode = $1',
      [refcode.toLowerCase()]
    );

    if (referrerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Referrer not found with that refcode' });
    }

    const referrerId = referrerResult.rows[0].id;
    const referrerEmail = referrerResult.rows[0].email;

    // Prevent self-referral
    if (referrerId === parseInt(id)) {
      return res.status(400).json({ error: 'Cannot set user as their own referrer' });
    }

    const result = await pool.query(
      'UPDATE users SET referrer_id = $1 WHERE id = $2 RETURNING id, email',
      [referrerId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Audit log
    await pool.query(
      `INSERT INTO subscription_extension_logs (user_id, admin_id, days_added, amount, slip_url, approval_method, notes)
       VALUES ($1, $2, 0, NULL, NULL, 'admin_set_referrer', $3)`,
      [id, adminId, `Referrer set to ${referrerEmail} (refcode: ${refcode.toLowerCase()})`]
    );

    res.json({
      success: true,
      message: `Set referrer of ${result.rows[0].email} to ${referrerEmail}`,
    });
  } catch (error) {
    console.error('Set referrer error:', error);
    res.status(500).json({ error: 'Failed to set referrer' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete a user and their data
 */
router.delete('/users/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Delete related records first
    await pool.query('DELETE FROM subscriptions WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM scheduler_channels WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM schedule_queue WHERE channel_id IN (SELECT id FROM scheduler_channels WHERE user_id = $1)', [id]).catch(() => {});

    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING email',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, message: `Deleted user ${result.rows[0].email}` });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * GET /api/admin/revenue
 * Get revenue breakdown by period (daily, weekly, monthly)
 */
router.get('/revenue', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const period = (req.query.period as string) || 'daily';

    let groupBy: string;
    let dateFormat: string;
    let limit: number;

    switch (period) {
      case 'weekly':
        groupBy = "DATE_TRUNC('week', s.created_at)";
        dateFormat = 'YYYY-MM-DD';
        limit = 12;
        break;
      case 'monthly':
        groupBy = "DATE_TRUNC('month', s.created_at)";
        dateFormat = 'YYYY-MM';
        limit = 12;
        break;
      default: // daily
        groupBy = "DATE_TRUNC('day', s.created_at)";
        dateFormat = 'YYYY-MM-DD';
        limit = 30;
        break;
    }

    // Revenue from subscriptions table (when subscriptions were created)
    const result = await pool.query(`
      SELECT
        TO_CHAR(${groupBy}, '${dateFormat}') as period_label,
        ${groupBy} as period_start,
        COUNT(*) FILTER (WHERE s.plan_type = 'monthly') as monthly_count,
        COUNT(*) FILTER (WHERE s.plan_type = 'yearly') as yearly_count,
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN s.plan_type = 'monthly' THEN 20 WHEN s.plan_type = 'yearly' THEN 100 ELSE 0 END), 0) as revenue
      FROM subscriptions s
      WHERE s.status IN ('active', 'canceled', 'past_due')
      GROUP BY ${groupBy}
      ORDER BY ${groupBy} DESC
      LIMIT $1
    `, [limit]);

    // Also get totals
    const totalsResult = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN plan_type = 'monthly' THEN 20 WHEN plan_type = 'yearly' THEN 100 ELSE 0 END), 0) as total_revenue,
        COUNT(*) FILTER (WHERE plan_type = 'monthly') as total_monthly,
        COUNT(*) FILTER (WHERE plan_type = 'yearly') as total_yearly,
        COUNT(*) as total_subscriptions
      FROM subscriptions
      WHERE status IN ('active', 'canceled', 'past_due')
    `);

    res.json({
      period,
      data: result.rows.reverse().map(row => ({
        label: row.period_label,
        periodStart: row.period_start,
        monthlyCount: parseInt(row.monthly_count),
        yearlyCount: parseInt(row.yearly_count),
        totalCount: parseInt(row.total_count),
        revenue: parseFloat(row.revenue),
      })),
      totals: {
        totalRevenue: parseFloat(totalsResult.rows[0].total_revenue),
        totalMonthly: parseInt(totalsResult.rows[0].total_monthly),
        totalYearly: parseInt(totalsResult.rows[0].total_yearly),
        totalSubscriptions: parseInt(totalsResult.rows[0].total_subscriptions),
      }
    });
  } catch (error) {
    console.error('Get revenue error:', error);
    res.status(500).json({ error: 'Failed to get revenue data' });
  }
});

// ===================== Admin Notifications =====================

/**
 * GET /api/admin/notifications
 * Get all admin notifications
 */
router.get('/notifications', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        n.id, n.title, n.message, n.notification_type, n.target_audience,
        n.created_at, n.is_active, u.email as created_by_email,
        (SELECT COUNT(*) FROM user_notification_reads WHERE notification_id = n.id) as read_count
      FROM admin_notifications n
      LEFT JOIN users u ON u.id = n.created_by
      ORDER BY n.created_at DESC
    `);

    res.json({ notifications: result.rows });
  } catch (error) {
    console.error('Get admin notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

/**
 * POST /api/admin/notifications
 * Create a new notification
 */
router.post('/notifications', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { title, message, notificationType, targetAudience } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    const result = await pool.query(`
      INSERT INTO admin_notifications (title, message, notification_type, target_audience, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [title, message, notificationType || 'announcement', targetAudience || 'all', req.userId]);

    res.json({ success: true, notification: result.rows[0] });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

/**
 * PATCH /api/admin/notifications/:id
 * Update a notification
 */
router.patch('/notifications/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title, message, notificationType, targetAudience, isActive } = req.body;

    const result = await pool.query(`
      UPDATE admin_notifications
      SET title = COALESCE($1, title),
          message = COALESCE($2, message),
          notification_type = COALESCE($3, notification_type),
          target_audience = COALESCE($4, target_audience),
          is_active = COALESCE($5, is_active)
      WHERE id = $6
      RETURNING *
    `, [title, message, notificationType, targetAudience, isActive, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true, notification: result.rows[0] });
  } catch (error) {
    console.error('Update notification error:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

/**
 * DELETE /api/admin/notifications/:id
 * Delete a notification
 */
router.delete('/notifications/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM admin_notifications WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

/**
 * POST /api/admin/upload-extend-slip
 *
 * Upload + Thunder-verify a payment slip for an admin extension.
 *
 * Flow (mirrors POST /api/subscription/v2/verify-and-approve):
 *   1. multer parses the slip file (≤ 5 MB, image/* only)
 *   2. file is uploaded to S3 (or saved locally)
 *   3. Thunder API verifies the slip and returns parsed metadata
 *   4. We assert: not duplicate, KBank, our account, expected amount, ≤ 24h old
 *   5. On any failure return { error, errorCode } with HTTP 400
 *
 * Body (multipart): userId, days, planSlug?, slip (file)
 *   - planSlug (optional) — when provided, validation uses that plan's default
 *     subtotal + any of its admin_alt_prices variants (e.g. yearly Promo ฿2,800).
 *   - days (legacy) — when planSlug is missing we fall back to days→plan
 *     resolution (≥365 → yearly, else monthly) for backwards compatibility with
 *     existing callers that send days only.
 *   `amount` is no longer trusted from the client — we use the Thunder-parsed
 *   `amountInSlip` and the resolved plan's allowed price list.
 *
 * Response (success):
 *   {
 *     success: true,
 *     slipUrl: string,           // S3 key or local path — pass to /extend
 *     amount: string,            // verified amount (vat-inclusive total)
 *     altLabel: string | null,   // 'Promo' when admin paid an alt price; else null
 *     transRef: string,          // Thunder reference
 *   }
 */
router.post('/upload-extend-slip', authenticate, requireAdmin, adminSlipRateLimit, slipUpload.single('slip'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, days, planSlug: bodyPlanSlug } = req.body;

    if (!userId || !days) {
      return res.status(400).json({ error: 'Missing userId or days', errorCode: 'MISSING_FIELDS' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded', errorCode: 'NO_FILE' });
    }

    const numDays = Number(days);

    // Resolve the plan: explicit planSlug wins; else legacy days→slug mapping
    // (matches the seeded monthly=30d, yearly=365d behaviour).
    const resolvedSlug = typeof bodyPlanSlug === 'string' && bodyPlanSlug.trim()
      ? bodyPlanSlug.trim().toLowerCase()
      : (numDays >= 365 ? 'yearly' : 'monthly');
    const planRecord = await plansService.getPlanBySlug(resolvedSlug).catch(() => null);

    // VAT-inclusive totals are the source of truth (Thunder reports the slip
    // amount as vat-inclusive). Allowed amounts = plan default + each admin
    // alt_price variant. This is how the admin-only Promo ฿2,800 (yearly) is
    // represented: a row in subscription_plans.admin_alt_prices.
    let allowedAmounts: number[];
    if (planRecord) {
      const altTotals = planRecord.admin_alt_prices_computed.map((a) => a.total);
      allowedAmounts = [planRecord.total, ...altTotals];
    } else {
      // No DB row yet (unmigrated env / unknown slug) — fall back to legacy
      // hardcoded subtotal so old admin flows keep working.
      const legacy = pricingFromDays(numDays);
      allowedAmounts = [legacy.total];
    }
    const expectedAmount = allowedAmounts[0]; // primary (kept for the comment below)

    // 1. Upload slip first so the file is preserved even if Thunder rejects it.
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = req.file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `user-${userId}-${numDays}d-${uniqueSuffix}.${ext}`;

    let slipUrl: string;
    if (getBucketName()) {
      const key = `extend-slips/${filename}`;
      await uploadFile(req.file.buffer, key, req.file.mimetype);
      slipUrl = key; // S3 key — signing happens elsewhere
    } else {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'extend-slips');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
      slipUrl = `/uploads/extend-slips/${filename}`;
    }

    // 2. Thunder verification
    let thunderData;
    try {
      thunderData = await verifySlipImage(req.file.buffer, req.file.mimetype);
    } catch (err: any) {
      if (err instanceof ThunderError) {
        return res.status(400).json({ error: err.message, errorCode: err.code });
      }
      throw err;
    }

    // 3. Multi-level validation (same rules as user-side autoapprove flow)
    if (thunderData.isDuplicate) {
      return res.status(400).json({ error: 'Slip already used', errorCode: 'DUPLICATE_SLIP' });
    }

    // Account check via Thunder matchedAccount (no rawSlip fallback —
    // matchedAccount is populated only when Thunder successfully cross-references
    // the slip receiver against its account database).
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

    if (!allowedAmounts.some((a) => Math.abs(a - thunderData.amountInSlip) < 0.01)) {
      const expectedLabel = allowedAmounts.map((a) => `฿${a}`).join(' or ');
      return res.status(400).json({
        error: `Amount mismatch: expected ${expectedLabel}, got ฿${thunderData.amountInSlip}`,
        errorCode: 'INVALID_AMOUNT',
      });
    }
    // Use actual paid amount (vat-inclusive total) for the log + subscription record
    const paidAmount = thunderData.amountInSlip;
    void expectedAmount; // unused after the validation step (kept for clarity)

    // Identify which variant the admin actually paid for (for the response +
    // future audit). null = the plan's default subtotal.
    let matchedAltLabel: string | null = null;
    if (planRecord && paidAmount !== planRecord.total) {
      const hit = planRecord.admin_alt_prices_computed.find((a) => a.total === paidAmount);
      if (hit) matchedAltLabel = hit.label;
    }

    const slipDate = new Date(thunderData.rawSlip.date);
    const ageMs = Date.now() - slipDate.getTime();
    const maxAgeMs = 24 * 60 * 60 * 1000;
    if (ageMs > maxAgeMs) {
      return res.status(400).json({
        error: `Slip too old (${Math.floor(ageMs / 3600000)}h ago)`,
        errorCode: 'EXPIRED_SLIP',
      });
    }

    // Record transRef to block replay (shared dedup store with the user flow).
    // UNIQUE(trans_ref) → the same slip can't be verified/used twice.
    try {
      await pool.query(
        `INSERT INTO verified_slips (trans_ref, user_id, plan_slug, amount, source)
         VALUES ($1, $2, $3, $4, 'admin')`,
        [thunderData.rawSlip.transRef, Number(userId), planRecord?.slug ?? resolvedSlug, paidAmount]
      );
    } catch (dupErr: any) {
      if (dupErr?.code === '23505') {
        return res.status(400).json({ error: 'Slip already used', errorCode: 'DUPLICATE_SLIP' });
      }
      throw dupErr;
    }

    console.log(
      `[Admin] Upload+verify slip: user ${userId}, ฿${paidAmount}, ${numDays}d, transRef=${thunderData.rawSlip.transRef}`
    );

    res.json({
      success: true,
      slipUrl,
      amount: String(paidAmount),
      altLabel: matchedAltLabel,
      planSlug: planRecord?.slug ?? resolvedSlug,
      transRef: thunderData.rawSlip.transRef,
    });
  } catch (error: any) {
    console.error('Upload extend slip error:', error);
    res.status(500).json({ error: error?.message || 'Failed to process extension', errorCode: 'INTERNAL_ERROR' });
  }
});

/* ------------------------------------------------------------------ */
/*  Per-(user × package) commission overrides                          */
/* ------------------------------------------------------------------ */

/**
 * GET /api/admin/users/:id/commissions
 * List every override row for this user. Returns [] when none.
 *
 * Response shape: [{ id, user_id, plan_id, commission_percent, created_at, updated_at }, ...]
 */
router.get('/users/:id/commissions', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const rows = await commissionService.listUserOverrides(userId);
    res.json({ overrides: rows });
  } catch (err: any) {
    // Table likely missing (pre-migration). Return empty list — never break the
    // admin user-detail page just because the matrix table doesn't exist yet.
    if (err.code === '42P01') return res.json({ overrides: [] });
    console.error('[admin] list user commissions failed:', err);
    res.status(500).json({ error: 'Failed to load commissions' });
  }
});

/**
 * PUT /api/admin/users/:id/commissions/:planId
 * Upsert a per-(user × plan) commission override. Body: { commission_percent }.
 * Super admin only — affects payout math.
 */
router.put(
  '/users/:id/commissions/:planId',
  authenticate,
  requireAdmin,
  requireSuperAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = Number(req.params.id);
      const planId = Number(req.params.planId);
      const pct = Number(req.body?.commission_percent);
      if (!Number.isFinite(userId) || !Number.isFinite(planId)) {
        return res.status(400).json({ error: 'Invalid user or plan id' });
      }
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ error: 'commission_percent must be 0–100' });
      }
      const row = await commissionService.upsertUserOverride(userId, planId, pct);
      res.json({ override: row });
    } catch (err: any) {
      // FK violation if plan doesn't exist
      if (err.code === '23503') return res.status(404).json({ error: 'Plan or user not found' });
      console.error('[admin] upsert user commission failed:', err);
      res.status(500).json({ error: 'Failed to save commission override' });
    }
  }
);

/**
 * DELETE /api/admin/users/:id/commissions/:planId
 * Remove a per-(user × plan) commission override. Super admin only.
 */
router.delete(
  '/users/:id/commissions/:planId',
  authenticate,
  requireAdmin,
  requireSuperAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = Number(req.params.id);
      const planId = Number(req.params.planId);
      if (!Number.isFinite(userId) || !Number.isFinite(planId)) {
        return res.status(400).json({ error: 'Invalid user or plan id' });
      }
      const removed = await commissionService.deleteUserOverride(userId, planId);
      res.json({ removed });
    } catch (err: any) {
      console.error('[admin] delete user commission failed:', err);
      res.status(500).json({ error: 'Failed to delete commission override' });
    }
  }
);

/**
 * GET /api/admin/users/:id/extension-history
 *
 * Full audit timeline for a user — returns *every* row in
 * subscription_extension_logs including non-revenue actions (reduce,
 * plan-change, approve, set-referrer). Includes approver email so the UI
 * can show "อนุมัติโดย: ...".
 */
router.get('/users/:id/extension-history', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT
         sel.id, sel.days_added, sel.amount, sel.slip_url, sel.created_at,
         sel.approval_method, sel.notes,
         sel.admin_id, a.email AS admin_email,
         a.is_super_admin AS admin_is_super
       FROM subscription_extension_logs sel
       LEFT JOIN users a ON a.id = sel.admin_id
       WHERE sel.user_id = $1
       ORDER BY sel.created_at DESC`,
      [id]
    );

    // Generate signed URLs for slip images
    const historyWithSignedUrls = await Promise.all(
      result.rows.map(async (row) => {
        let slipSignedUrl = null;
        if (row.slip_url && row.slip_url.startsWith('extend-slips/')) {
          try {
            slipSignedUrl = await getSignedFileUrl(row.slip_url);
          } catch (err) {
            console.error('Failed to get signed URL for slip:', row.slip_url, err);
          }
        }
        return {
          ...row,
          slip_url: slipSignedUrl || row.slip_url,
          admin_is_super: !!row.admin_is_super,
        };
      })
    );

    res.json({ history: historyWithSignedUrls });
  } catch (error) {
    console.error('Get extension history error:', error);
    res.status(500).json({ error: 'Failed to get extension history' });
  }
});

/**
 * GET /api/admin/revenue-report
 * Revenue report with source breakdown (admin, autoapprove, stripe)
 * range: today, yesterday, 7d, 30d, 90d, 1y
 *
 * Timezone strategy:
 *   - DB session TZ is UTC (see db.ts -c timezone=UTC).
 *   - subscription_extension_logs.created_at is TIMESTAMP without TZ, but its
 *     values are *UTC wall-clock* (because session TZ was UTC at INSERT time).
 *   - All boundaries (start/end), all GROUP BY buckets, and all labels are
 *     computed in **Asia/Bangkok** so the report aligns with what the admin
 *     sees on their wall clock. A transaction at 00:30 Bangkok 6-May
 *     correctly appears under "6 พ.ค." rather than "5 พ.ค." (which would
 *     be its UTC date).
 *
 * Range boundaries (calendar-anchored, not rolling):
 *   today      = [00:00 Bangkok today, NOW()]
 *   yesterday  = [00:00 Bangkok yesterday, 00:00 Bangkok today)
 *   7d         = [00:00 Bangkok 6 days ago, NOW()]    -> 7 calendar days incl. today
 *   30d        = [00:00 Bangkok 29 days ago, NOW()]   -> 30 calendar days incl. today
 *   90d        = [00:00 Bangkok 89 days ago, NOW()]   -> 90 calendar days incl. today
 *   1y         = [00:00 Bangkok 1st of (current month - 11), NOW()] -> 12 months incl. current
 */
router.get('/revenue-report', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  // Use a single connection + REPEATABLE READ so the 3 read queries see the
  // exact same DB snapshot (otherwise a row inserted between queries can make
  // the period rows, summary, and transaction list disagree).
  const client = await pool.connect();
  try {
    const range = (req.query.range as string) || '7d';

    // SQL expressions for boundary + grouping. Values are SQL-safe (only
    // come from a hardcoded switch statement).
    let startExpr: string;
    let endExpr: string = 'NOW()';
    let groupByExpr: string;
    let labelFormat: string;

    const TZ = 'Asia/Bangkok';
    // Start of today in Bangkok, expressed as timestamptz.
    const TODAY_BKK = `(DATE_TRUNC('day', NOW() AT TIME ZONE '${TZ}')) AT TIME ZONE '${TZ}'`;
    // Convert a timestamp-without-tz column to Bangkok wall clock (used in GROUP BY).
    const BKK_LOCAL = `(sel.created_at AT TIME ZONE 'UTC' AT TIME ZONE '${TZ}')`;

    // NOTE about subtraction: TODAY_BKK is already a timestamptz, so
    // `TODAY_BKK - INTERVAL '...'` returns timestamptz directly. We must NOT
    // append `::timestamptz` here — `::` cast binds to the right-most token
    // (`'Asia/Bangkok'`), which would attempt to cast the literal string and
    // fail with "invalid input syntax for type timestamp with time zone".
    switch (range) {
      case 'today':
        startExpr = TODAY_BKK;
        groupByExpr = `DATE_TRUNC('hour', ${BKK_LOCAL})`;
        labelFormat = 'HH24":00"';
        break;
      case 'yesterday':
        startExpr = `(${TODAY_BKK} - INTERVAL '1 day')`;
        endExpr = TODAY_BKK;
        groupByExpr = `DATE_TRUNC('hour', ${BKK_LOCAL})`;
        labelFormat = 'HH24":00"';
        break;
      case '30d':
        startExpr = `(${TODAY_BKK} - INTERVAL '29 days')`;
        groupByExpr = `DATE_TRUNC('day', ${BKK_LOCAL})`;
        labelFormat = 'YYYY-MM-DD';
        break;
      case '90d':
        startExpr = `(${TODAY_BKK} - INTERVAL '89 days')`;
        groupByExpr = `DATE_TRUNC('week', ${BKK_LOCAL})`;
        labelFormat = 'YYYY-MM-DD';
        break;
      case '1y':
        // 12 months including current month (start = 1st of (current - 11 months) Bangkok).
        startExpr = `((DATE_TRUNC('month', NOW() AT TIME ZONE '${TZ}') - INTERVAL '11 months') AT TIME ZONE '${TZ}')`;
        groupByExpr = `DATE_TRUNC('month', ${BKK_LOCAL})`;
        labelFormat = 'YYYY-MM';
        break;
      case '7d':
      default:
        startExpr = `(${TODAY_BKK} - INTERVAL '6 days')`;
        groupByExpr = `DATE_TRUNC('day', ${BKK_LOCAL})`;
        labelFormat = 'YYYY-MM-DD';
        break;
    }

    // periodStart returned as timestamptz (Bangkok-anchored bucket converted
    // back to UTC instant) so `new Date(periodStart)` on the client yields
    // the correct moment regardless of the browser's TZ.
    const periodStartExpr = `((${groupByExpr}) AT TIME ZONE '${TZ}')`;

    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    // Revenue-bearing approval_methods. Audit-only entries (admin_reduce,
    // admin_plan_change, admin_approve, admin_set_referrer) are excluded
    // from revenue stats — they have NULL/0 amounts and would skew counts.
    const REVENUE_FILTER = `sel.approval_method IN ('admin', 'autoapprove', 'stripe')`;

    // 1) Period rows
    const result = await client.query(`
      SELECT
        TO_CHAR(${groupByExpr}, '${labelFormat}') as period_label,
        ${periodStartExpr} as period_start,
        COUNT(*) FILTER (WHERE sel.approval_method = 'admin') as admin_count,
        COUNT(*) FILTER (WHERE sel.approval_method = 'autoapprove' AND u.referrer_id IS NULL) as web_direct_count,
        COUNT(*) FILTER (WHERE sel.approval_method = 'autoapprove' AND u.referrer_id IS NOT NULL) as web_aff_count,
        COUNT(*) FILTER (WHERE sel.approval_method = 'stripe') as stripe_count,
        COUNT(*) FILTER (WHERE sel.days_added < 365) as monthly_count,
        COUNT(*) FILTER (WHERE sel.days_added >= 365) as yearly_count,
        COALESCE(SUM(CASE WHEN sel.approval_method = 'admin' THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as admin_revenue,
        COALESCE(SUM(CASE WHEN sel.approval_method = 'autoapprove' AND u.referrer_id IS NULL THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as web_direct_revenue,
        COALESCE(SUM(CASE WHEN sel.approval_method = 'autoapprove' AND u.referrer_id IS NOT NULL THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as web_aff_revenue,
        COALESCE(SUM(CASE WHEN sel.approval_method = 'stripe' THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as stripe_revenue,
        COALESCE(SUM(CAST(NULLIF(sel.amount, '') AS NUMERIC)), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN sel.days_added < 365 THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as monthly_revenue,
        COALESCE(SUM(CASE WHEN sel.days_added >= 365 THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as yearly_revenue
      FROM subscription_extension_logs sel
      LEFT JOIN users u ON u.id = sel.user_id
      WHERE sel.created_at >= ${startExpr}
        AND sel.created_at <  ${endExpr}
        AND ${REVENUE_FILTER}
      GROUP BY ${groupByExpr}
      ORDER BY ${groupByExpr} ASC
    `);

    // 2) Summary for the selected range
    const summaryResult = await client.query(`
      SELECT
        COUNT(*) as total_transactions,
        COUNT(*) FILTER (WHERE sel.approval_method = 'admin') as total_admin,
        COUNT(*) FILTER (WHERE sel.approval_method = 'autoapprove' AND u.referrer_id IS NULL) as total_web_direct,
        COUNT(*) FILTER (WHERE sel.approval_method = 'autoapprove' AND u.referrer_id IS NOT NULL) as total_web_aff,
        COUNT(*) FILTER (WHERE sel.approval_method = 'stripe') as total_stripe,
        COUNT(*) FILTER (WHERE sel.days_added < 365) as total_monthly,
        COUNT(*) FILTER (WHERE sel.days_added >= 365) as total_yearly,
        COALESCE(SUM(CAST(NULLIF(sel.amount, '') AS NUMERIC)), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN sel.approval_method = 'admin' THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as total_admin_revenue,
        COALESCE(SUM(CASE WHEN sel.approval_method = 'autoapprove' AND u.referrer_id IS NULL THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as total_web_direct_revenue,
        COALESCE(SUM(CASE WHEN sel.approval_method = 'autoapprove' AND u.referrer_id IS NOT NULL THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as total_web_aff_revenue,
        COALESCE(SUM(CASE WHEN sel.approval_method = 'stripe' THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as total_stripe_revenue,
        COALESCE(SUM(CASE WHEN sel.days_added < 365 THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as total_monthly_revenue,
        COALESCE(SUM(CASE WHEN sel.days_added >= 365 THEN CAST(NULLIF(sel.amount, '') AS NUMERIC) ELSE 0 END), 0) as total_yearly_revenue
      FROM subscription_extension_logs sel
      LEFT JOIN users u ON u.id = sel.user_id
      WHERE sel.created_at >= ${startExpr}
        AND sel.created_at <  ${endExpr}
        AND ${REVENUE_FILTER}
    `);

    // 3) Individual transactions with email & slip — also include the
    //    admin who approved (for 'admin' rows) so the UI can attribute revenue.
    const txResult = await client.query(`
      SELECT
        sel.id, sel.user_id, u.email, sel.days_added, sel.amount,
        sel.slip_url, sel.approval_method, sel.created_at,
        sel.admin_id, a.email AS admin_email, a.is_super_admin AS admin_is_super,
        CASE WHEN u.referrer_id IS NOT NULL THEN true ELSE false END as from_affiliate,
        (SELECT ru.email FROM users ru WHERE ru.id = u.referrer_id) as referrer_email
      FROM subscription_extension_logs sel
      LEFT JOIN users u ON u.id = sel.user_id
      LEFT JOIN users a ON a.id = sel.admin_id
      WHERE sel.created_at >= ${startExpr}
        AND sel.created_at <  ${endExpr}
        AND ${REVENUE_FILTER}
      ORDER BY sel.created_at DESC
    `);

    await client.query('COMMIT');

    // Generate signed URLs for slips
    const transactions = await Promise.all(txResult.rows.map(async (row) => {
      let slipSignedUrl = null;
      if (row.slip_url) {
        if (row.slip_url.startsWith('extend-slips/')) {
          try {
            slipSignedUrl = await getSignedFileUrl(row.slip_url);
          } catch (err) {
            console.error('Failed to get signed URL:', row.slip_url);
          }
        } else {
          slipSignedUrl = row.slip_url;
        }
      }
      return {
        id: row.id,
        email: row.email,
        daysAdded: row.days_added,
        amount: row.amount,
        slipUrl: slipSignedUrl,
        source: row.approval_method || 'admin',
        createdAt: row.created_at,
        fromAffiliate: row.from_affiliate,
        referrerEmail: row.referrer_email || null,
        adminId: row.admin_id || null,
        adminEmail: row.admin_email || null,
        adminIsSuper: !!row.admin_is_super,
      };
    }));

    const s = summaryResult.rows[0];

    res.json({
      range,
      transactions,
      data: result.rows.map(row => ({
        label: row.period_label,
        periodStart: row.period_start,
        adminCount: parseInt(row.admin_count),
        webDirectCount: parseInt(row.web_direct_count),
        webAffCount: parseInt(row.web_aff_count),
        stripeCount: parseInt(row.stripe_count),
        monthlyCount: parseInt(row.monthly_count),
        yearlyCount: parseInt(row.yearly_count),
        adminRevenue: parseFloat(row.admin_revenue),
        webDirectRevenue: parseFloat(row.web_direct_revenue),
        webAffRevenue: parseFloat(row.web_aff_revenue),
        stripeRevenue: parseFloat(row.stripe_revenue),
        totalRevenue: parseFloat(row.total_revenue),
        monthlyRevenue: parseFloat(row.monthly_revenue),
        yearlyRevenue: parseFloat(row.yearly_revenue),
      })),
      summary: {
        totalTransactions: parseInt(s.total_transactions),
        totalAdmin: parseInt(s.total_admin),
        totalWebDirect: parseInt(s.total_web_direct),
        totalWebAff: parseInt(s.total_web_aff),
        totalStripe: parseInt(s.total_stripe),
        totalMonthly: parseInt(s.total_monthly),
        totalYearly: parseInt(s.total_yearly),
        totalRevenue: parseFloat(s.total_revenue),
        totalAdminRevenue: parseFloat(s.total_admin_revenue),
        totalWebDirectRevenue: parseFloat(s.total_web_direct_revenue),
        totalWebAffRevenue: parseFloat(s.total_web_aff_revenue),
        totalStripeRevenue: parseFloat(s.total_stripe_revenue),
        totalMonthlyRevenue: parseFloat(s.total_monthly_revenue),
        totalYearlyRevenue: parseFloat(s.total_yearly_revenue),
      },
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Get revenue report error:', error);
    res.status(500).json({ error: 'Failed to get revenue report' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/backfill-extension-logs
 * Find admin-created subscriptions that have no extension log and create missing logs
 */
router.post('/backfill-extension-logs', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Find subscriptions created by admin (manual_*) that don't have ANY extension log
    const missingResult = await pool.query(`
      SELECT
        s.user_id, u.email, s.plan_type, s.current_period_end, s.created_at,
        s.stripe_customer_id
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.stripe_customer_id LIKE 'manual_%'
        AND NOT EXISTS (
          SELECT 1 FROM subscription_extension_logs sel
          WHERE sel.user_id = s.user_id
          AND sel.approval_method = 'admin'
        )
      ORDER BY s.created_at DESC
    `);

    if (req.body.dryRun !== false) {
      // Dry run - just show what would be backfilled
      return res.json({
        dryRun: true,
        count: missingResult.rows.length,
        users: missingResult.rows.map(r => ({
          userId: r.user_id,
          email: r.email,
          planType: r.plan_type,
          createdAt: r.created_at,
        })),
      });
    }

    // Actually backfill
    let created = 0;
    for (const row of missingResult.rows) {
      const days = row.plan_type === 'yearly' ? 365 : 30;
      const amount = row.plan_type === 'yearly' ? '3000' : '600';

      await pool.query(
        `INSERT INTO subscription_extension_logs (user_id, admin_id, days_added, amount, approval_method, created_at)
         VALUES ($1, $2, $3, $4, 'admin', $5)`,
        [row.user_id, req.userId, days, amount, row.created_at]
      );
      created++;
    }

    res.json({
      dryRun: false,
      created,
      message: `Backfilled ${created} missing extension logs`,
    });
  } catch (error) {
    console.error('Backfill error:', error);
    res.status(500).json({ error: 'Failed to backfill' });
  }
});

// ============================================
// Update Banners — admin-managed banner cards (rendered on /update page)
// ============================================

const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// GET /api/admin/banners — list all banners (admin)
router.get('/banners', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT * FROM update_banners ORDER BY display_order ASC, id ASC`
    );
    res.json(r.rows);
  } catch (err: any) {
    console.error('[admin/banners GET] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to load banners' });
  }
});

// POST /api/admin/banners — create
router.post('/banners', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const {
      slug,
      date_th = '',
      date_en = '',
      title_th = '',
      title_en = '',
      detail_title_th = '',
      detail_title_en = '',
      banner = '',
      video_url = '',
      details: rawDetails,
      links: rawLinks,
      prompts: rawPrompts,
      display_order = 0,
      is_active = true,
    } = req.body || {};

    if (!slug || (!title_th && !title_en)) {
      return res.status(400).json({ error: 'slug and at least one title (th or en) are required' });
    }

    // Auto-seed FULL ready-made template if admin didn't provide content — mirrors the
    // existing IDOL Template page so admin opens the editor to a complete sample they
    // only need to tweak (not blank fields).
    const details = (Array.isArray(rawDetails) && rawDetails.length > 0) ? rawDetails : [
      {
        text: { th: 'คู่มือการใช้งาน Idol Template', en: 'How to Use Idol Template' },
        videoUrl: 'https://www.youtube.com/watch?v=uXiK24GiadU',
      },
      {
        text: { th: 'วิธีสร้าง Custom Idol Template', en: 'How to Create Custom Idol Template' },
        videoUrl: 'https://www.youtube.com/embed/yKCh8UfAnxY',
      },
    ];
    const links = (Array.isArray(rawLinks) && rawLinks.length > 0) ? rawLinks : [];
    const prompts = (Array.isArray(rawPrompts) && rawPrompts.length > 0) ? rawPrompts : [
      {
        label: 'Image Prompt',
        text: `amateur smartphone photo, realistic casual snapshot taken with iPhone, candid portrait,

voluptuous young woman with very large breasts and massive cleavage,
arms raised behind head exposing thick dark hairy armpits,

inspired by the woman in the attached reference image 1,
wearing clothing and accessories from the attached reference image 2,
with background from the attached reference image 3,

soft indoor natural light, slight lens flare,

shot on smartphone, 26mm lens, f/1.8, slight depth of field, soft bokeh,
mild digital noise and film grain, natural color grading,
unedited raw phone photo style, authentic everyday mobile photo,
highly photorealistic, indistinguishable from real iPhone photo`,
      },
      {
        label: 'VDO Prompt',
        text: `arms raised behind head, slow stretching motion, slowly and teasingly sticking out tongue, wet glossy tongue licking lips sensually, eye contact with camera, subtle body sway, deep breathing, natural movement of armpit hair, seductive and erotic atmosphere, smooth cinematic slow motion`,
      },
    ];

    const r = await pool.query(
      `INSERT INTO update_banners (slug, date_th, date_en, title_th, title_en, detail_title_th, detail_title_en, banner, video_url, details, links, prompts, display_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14)
       RETURNING *`,
      [slug, date_th, date_en, title_th, title_en, detail_title_th, detail_title_en, banner, video_url, JSON.stringify(details), JSON.stringify(links), JSON.stringify(prompts), display_order, is_active]
    );
    res.json(r.rows[0]);
  } catch (err: any) {
    console.error('[admin/banners POST] Error:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'slug ซ้ำ' });
    res.status(500).json({ error: err.message || 'Failed to create banner' });
  }
});

// PUT /api/admin/banners/:id — update
router.put('/banners/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const fields = [
      'slug', 'date_th', 'date_en', 'title_th', 'title_en',
      'detail_title_th', 'detail_title_en', 'banner', 'video_url',
      'display_order', 'is_active',
    ] as const;
    const jsonbFields = ['details', 'links', 'prompts'] as const;

    const sets: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let idx = 1;

    for (const f of fields) {
      if (req.body?.[f] !== undefined) {
        sets.push(`${f} = $${idx++}`);
        values.push(req.body[f]);
      }
    }
    for (const f of jsonbFields) {
      if (req.body?.[f] !== undefined) {
        sets.push(`${f} = $${idx++}::jsonb`);
        values.push(JSON.stringify(req.body[f]));
      }
    }

    if (sets.length === 1) return res.status(400).json({ error: 'Nothing to update' });

    values.push(id);
    const r = await pool.query(
      `UPDATE update_banners SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Banner not found' });
    res.json(r.rows[0]);
  } catch (err: any) {
    console.error('[admin/banners PUT] Error:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'slug ซ้ำ' });
    res.status(500).json({ error: err.message || 'Failed to update banner' });
  }
});

// DELETE /api/admin/banners/:id
router.delete('/banners/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const r = await pool.query(`DELETE FROM update_banners WHERE id = $1 RETURNING id`, [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Banner not found' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[admin/banners DELETE] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to delete banner' });
  }
});

// POST /api/admin/banners/reorder — update display_order for many at once
// Body: { ids: number[] }  (in desired order)
router.post('/banners/reorder', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: any) => typeof x === 'number') : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ids.length; i++) {
        await client.query(`UPDATE update_banners SET display_order = $1, updated_at = NOW() WHERE id = $2`, [i, ids[i]]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true, count: ids.length });
  } catch (err: any) {
    console.error('[admin/banners reorder] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to reorder' });
  }
});

// POST /api/admin/banners/upload-image — upload to Dropbox, return shared link
router.post('/banners/upload-image', authenticate, requireAdmin, bannerUpload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No image uploaded' });
    const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const dropboxPath = `/trippleviral/banners/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const { sharedUrl } = await uploadBufferToDropbox(file.buffer, dropboxPath);
    res.json({ key: dropboxPath, url: sharedUrl });
  } catch (err: any) {
    console.error('[admin/banners upload] Error:', err.message);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// POST /api/admin/image-templates/upload-thumbnail — upload to S3, return signed URL (24h preview)
router.post('/image-templates/upload-thumbnail', authenticate, requireAdmin, bannerUpload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No image uploaded' });
    const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `image-templates/thumbnails/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    await uploadFile(file.buffer, key, file.mimetype || 'image/jpeg');
    const url = await getSignedFileUrl(key, 86400);
    res.json({ key, url });
  } catch (err: any) {
    console.error('[admin/image-templates upload] Error:', err.message);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// POST /api/admin/image-templates/analyze-thumbnail — vision: wrap admin's prompt text values that appear on the reference image as {{Label: text}}
router.post('/image-templates/analyze-thumbnail', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const imageUrl = String(req.body?.image_url || '').trim();
    const promptTemplateRaw = String(req.body?.prompt_template || '').trim();
    if (!imageUrl) return res.status(400).json({ error: 'image_url required' });
    if (!promptTemplateRaw) return res.status(400).json({ error: 'prompt_template required' });

    // Strip any existing {{Label: value}} placeholders from a previous analyze pass —
    // collapse them back to just the value text. This prevents Pass 2 from preserving
    // stale labels that conflict with the new schema (e.g. old "headline" label persisting
    // when the schema wants "คำโปรโมท").
    const promptTemplate = promptTemplateRaw.replace(/\{\{[^{}]+?\}\}/g, (_m) => {
      const inner = _m.slice(2, -2).trim();
      const sepIdx = inner.indexOf(':');
      if (sepIdx < 0) return ''; // {{Label}} without value → drop
      const valuePart = inner.slice(sepIdx + 1).trim();
      // Format may be `Label: english | thai | image` (image-swap) → use thai (part 2) as inline value
      // Or `Label: text` → use text directly
      const parts = valuePart.split(' | ');
      if (parts.length >= 3 && /\bimage\b/i.test(parts[2])) {
        return parts[1] || parts[0] || ''; // prefer Thai description
      }
      return parts[0] || '';
    });

    const u = await pool.query(`SELECT openai_api_key, openrouter_api_key, ai_provider FROM users WHERE id = $1`, [userId]);
    const user = u.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    const provider = user.ai_provider || 'openai';
    const apiKey = provider === 'openrouter' ? user.openrouter_api_key : user.openai_api_key;
    if (!apiKey) return res.status(400).json({ error: 'กรุณาตั้งค่า API key ใน Settings ก่อน' });
    const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
    // Pass 1 (vision + structured JSON output) needs quality — use full gpt-4o.
    // Pass 2 (pure text wrapping, no image) can use the cheaper/faster mini.
    const visionModel = provider === 'openrouter' ? 'openai/gpt-4o' : 'gpt-4o';
    const textModel = provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';

    // Download image once, share between both passes (avoid OpenAI fetch timeout from S3).
    let imageDataUrl = imageUrl;
    try {
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
      const arrayBuf = await imgResp.arrayBuffer();
      const mime = imgResp.headers.get('content-type') || 'image/jpeg';
      const b64 = Buffer.from(arrayBuf).toString('base64');
      imageDataUrl = `data:${mime};base64,${b64}`;
    } catch (e: any) {
      return res.status(500).json({ error: `ดาวน์โหลดภาพไม่สำเร็จ: ${e?.message || 'unknown'}` });
    }

    // ─── SINGLE-PASS: Schema + Wrapped prompt in ONE call ─────────────────────────
    // AI sees image + admin's prompt and returns BOTH the schema AND the wrapped prompt
    // in one JSON response. This avoids coordination problems between two passes.
    const sys = [
      'You analyze a poster image and an admin-written prompt, then output BOTH a placeholder schema AND the wrapped prompt — in a single JSON response. The two outputs MUST be consistent: every label in the schema must appear as a {{...}} placeholder in the wrapped prompt, and vice versa.',
      '',
      'Output ONLY valid JSON (response_format=json_object) with this shape:',
      '{',
      '  "schema": {',
      '    "domain": "<2-4 words describing poster type>",',
      '    "image_fields": [',
      '      { "label": "<thai or english noun>", "english_description": "<short English>", "thai_description": "<short Thai>", "role": "person|food|background|setting|product|prop|logo|gallery|interior|vehicle|building|other", "primary": true|false }',
      '    ],',
      '    "text_fields": [',
      '      { "label": "<short descriptive label>", "actual_text": "<EXACT text from image>", "role": "headline|subheadline|tagline|description|cta|contact|specs|hashtag|promo|other" }',
      '    ]',
      '  },',
      '  "wrapped_prompt": "<the admin prompt with {{...}} placeholders inserted around the right values>"',
      '}',
      '',
      'MANDATORY VISUAL CHECKLIST — scan the image AND read the admin\'s prompt. Add an image_field for each visible/mentioned subject:',
      '  ☐ Person/Model (any human) → "คน" or specific noun',
      '  ☐ Food/Dish/Drink (food on table, BBQ, dishes, sauces, vegetables, raw meat, ingredients) → "อาหาร", "หมูกระทะ", "ตะกร้าผัก", "น้ำจิ้ม", "จานเนื้อ" — list each distinct food element separately',
      '  ☐ Building/Structure → "บ้าน", "ตึก", "ร้าน", "สถานที่"',
      '  ☐ Vehicle → "รถ"',
      '  ☐ Product → "สินค้า"',
      '  ☐ Background/Setting → "ฉาก" or "พื้นหลัง"',
      '  ☐ Props/Decor (baskets, plates, accessories) → specific noun',
      '  ☐ Gallery thumbnails → "ภาพภายใน 1", "ภาพภายใน 2", ... or "เมนู 1" etc.',
      '  ☐ Logo → "โลโก้"',
      '',
      'Required: at least one image_field with "primary": true.',
      '',
      'image_fields rules:',
      '- Use Thai noun for the actual subject (not generic "Hero", "Main", "Image1").',
      '- DO NOT split a single subject (one person = one field).',
      '- DO NOT skip subjects mentioned in the prompt OR shown in the image — every distinct subject gets ONE field.',
      '',
      'text_fields rules:',
      '- actual_text MUST be the LITERAL text shown on the image. NEVER invent text. NEVER use positional descriptions.',
      '- TH+EN of the SAME value on adjacent lines → combine into ONE entry separated by newline.',
      '- Group repeated row items (e.g. "3 ห้องนอน · 2 ห้องน้ำ", "ธรรมชาติ · วัฒนธรรม · อาหาร") into ONE field.',
      '- Each distinct text element gets EXACTLY ONE entry. NO DUPLICATE labels. NO duplicate actual_text.',
      '- Skip decorative ornaments and parenthetical section labels.',
      '- Cover EVERY editable text — headlines, prices, CTAs, body paragraphs, contact lines, hashtags, badges, captions, footer.',
      '',
      'wrapped_prompt rules:',
      '- Take the admin\'s prompt as the base. Preserve overall structure (sections, layout cues, lighting/style notes), but you MUST REPLACE every descriptive phrase or sentence about a swappable subject with the placeholder for that subject.',
      '- For each image_field in the schema, INSERT a placeholder as: {{<label>: <english_description> | <thai_description> | image}}',
      '  CRITICAL: REPLACE the ENTIRE descriptive phrase/sentence about that subject — adjectives, materials, colors, props, actions, atmosphere — with the single placeholder. Do NOT keep stale subject-specific prose around the placeholder.',
      '  Example BAD (do NOT do): "ด้านหน้ามีเตาหมูกระทะขนาดใหญ่บนโต๊ะไม้ มีเนื้อหมูย่างบนกระทะทองเหลือง ควันลอยขึ้น {{หมูกระทะ: ...|image}} รอบๆ มีผักสด"',
      '    → Problem: if user changes หมูกระทะ to ก๋วยเตี๋ยว, the surrounding prose (เตา, กระทะทองเหลือง, เนื้อหมูย่าง, ควัน) still tells the model to draw หมูกระทะ.',
      '  Example GOOD: "ด้านหน้ามี {{หมูกระทะ: ...|image}} รอบๆ มีผักสด"',
      '    → The descriptive prose belongs INSIDE the placeholder\'s description fields, not outside.',
      '  Move all subject-specific details (size/material/color/state/action) INTO the english_description and thai_description of the placeholder. Keep ONLY composition/position cues outside (e.g. "ด้านหน้า", "ตรงกลาง", "ใต้ headline").',
      '  If the prompt does not mention an element at all, insert the placeholder near the relevant composition description.',
      '',
      'SCENE/BACKGROUND fields are the MOST OFTEN BOTCHED. Be ruthless about replacement here:',
      '  Example BAD (do NOT do): "ฉากเป็น {{ฉาก: night market...|...|image}} มีเงาวัดไทยอยู่ไกลๆ ท้องฟ้าสีน้ำเงินเข้มช่วงหัวค่ำ บรรยากาศอบอุ่นมีโคมไฟ"',
      '    → Problem: if user changes ฉาก to "ห้างสรรพสินค้า", the surrounding prose (วัดไทย, ท้องฟ้าหัวค่ำ, โคมไฟ) still forces a temple/night-market look.',
      '  Example GOOD: "ฉากเป็น {{ฉาก: night market with warm lights, temple silhouettes, deep blue evening sky | ตลาดกลางคืนแสงอบอุ่น เงาวัด ท้องฟ้าสีน้ำเงินช่วงหัวค่ำ | image}}"',
      '    → All scene atmosphere (sky color, time of day, ambient lights, surrounding architecture, mood) goes INSIDE the placeholder description. Outside the placeholder, only "ฉากเป็น" remains.',
      '  Apply the same logic to PERSON/CHARACTER fields: age, hairstyle, clothing, expression, action — all go INSIDE the placeholder description, not in surrounding prose.',
      '',
      'SELF-VALIDATION (mandatory before responding):',
      '  After drafting wrapped_prompt, re-scan it. For each {{placeholder}}, look at the SAME paragraph and the next 2 sentences. Are there leftover phrases describing the SAME subject? (e.g. another sentence about the scene\'s lighting/buildings/sky after a {{ฉาก}} placeholder, or another phrase about the person\'s clothes/age after a {{คน}} placeholder?)',
      '  If yes → MERGE those phrases into the placeholder\'s english_description and thai_description, and DELETE them from the prose. Repeat until no orphaned subject-specific prose remains around any placeholder.',
      '- For each text_field in the schema, INSERT a placeholder where the admin\'s prompt mentions that text: {{<label>: <actual_text>}} (NO " | " separator)',
      '  If the admin\'s prompt has positional words like "headline ด้านซ้าย" or "caption ล่าง", REPLACE that positional phrase with the placeholder.',
      '  REPLACE the literal text in the prompt (e.g. "ก๋วยเตี๋ยวริมทาง") with the placeholder. Do NOT keep the literal text duplicated outside the placeholder.',
      '- EVERY field in the schema MUST appear as a placeholder in the wrapped_prompt. EVERY {{...}} in the wrapped_prompt MUST correspond to an entry in the schema.',
      '- Newlines in actual_text must be REAL newlines (not literal backslash-n).',
      '- REMOVE hardcoded counts/quantities when the items are represented by a placeholder. Examples:',
      '  • "4 icons of categories" → "icons of categories" (let placeholder content control count)',
      '  • "row of three buttons" → "row of buttons"',
      '  • "two CTAs at the bottom" → "CTAs at the bottom"',
      '  • "3 ห้องนอน · 2 ห้องน้ำ" inside a placeholder is fine (it IS the actual_text), but standalone count adjectives in surrounding prose must be stripped.',
      '  Rule of thumb: if a number adjective (one/two/three/four/หนึ่ง/สอง/สาม/สี่/2/3/4 …) appears next to a noun that has a {{placeholder}} for it, DELETE the number so the user controls quantity through what they type.',
      '- Output the wrapped_prompt with placeholders inserted but otherwise identical to the admin\'s input.',
      '',
      'You MUST respond with a single valid JSON object {schema, wrapped_prompt}. No markdown fence, no commentary.',
    ].join('\n');

    const userContent = [
      { type: 'text', text: `Analyze this poster image AND read the admin's prompt below. Output the JSON response.\n\nADMIN'S PROMPT:\n---\n${promptTemplate}\n---` },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ];

    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: visionModel,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userContent },
        ],
        temperature: 0,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: `AI error: ${err.slice(0, 200)}` });
    }
    const d: any = await r.json();
    const rawJson = (d.choices?.[0]?.message?.content || '').trim();
    let response: any;
    try {
      response = JSON.parse(rawJson);
    } catch (e: any) {
      return res.status(500).json({ error: `AI returned invalid JSON: ${e?.message || 'parse error'}` });
    }
    let schema = response.schema;
    let wrapped = String(response.wrapped_prompt || '').trim();

    // ─── VALIDATION + AUTO-ADD missing subjects ───────────────────────────────────
    if (!schema || typeof schema !== 'object') schema = {};
    if (!Array.isArray(schema.image_fields)) schema.image_fields = [];
    if (!Array.isArray(schema.text_fields)) schema.text_fields = [];

    const subjectSignals: Array<{ pattern: RegExp; suggestedLabel: string; en: string; th: string }> = [
      { pattern: /หมูกระทะ|moo\s*ka\s*ta|bbq\s*pot|bbq\s*hotpot|หมูย่างบนกระทะ|กระทะทองเหลือง/i, suggestedLabel: 'หมูกระทะ', en: 'Thai BBQ hotpot with grilled pork on brass pan', th: 'หมูกระทะไทย กระทะทองเหลือง' },
      { pattern: /อาหาร(?!เสริม)|จานอาหาร|food|dish|cuisine|เมนู/i, suggestedLabel: 'อาหาร', en: 'food / dish on the table', th: 'อาหารบนโต๊ะ' },
      { pattern: /ตะกร้า.{0,5}ผัก|ผัก.{0,5}ตะกร้า|vegetable\s*basket|ผักสด/i, suggestedLabel: 'ตะกร้าผัก', en: 'fresh vegetable basket', th: 'ตะกร้าผักสด' },
      { pattern: /น้ำจิ้ม|dipping\s*sauce|sauce\s*bowl/i, suggestedLabel: 'น้ำจิ้ม', en: 'dipping sauce bowls', th: 'ถ้วยน้ำจิ้ม' },
      { pattern: /จานเนื้อ|raw\s*meat|sliced\s*meat|เนื้อสไลด์|เนื้อหมูสไลด์/i, suggestedLabel: 'จานเนื้อ', en: 'plate of sliced raw meat', th: 'จานเนื้อสไลด์' },
      { pattern: /บ้าน(?!เกิด)|house|residence|villa/i, suggestedLabel: 'บ้าน', en: 'house exterior', th: 'บ้าน' },
      { pattern: /ตึก|condo|condominium|building/i, suggestedLabel: 'ตึก', en: 'condominium building', th: 'ตึกคอนโด' },
      { pattern: /\bรถ\b|car|vehicle/i, suggestedLabel: 'รถ', en: 'vehicle', th: 'รถ' },
      { pattern: /โลโก้|logo/i, suggestedLabel: 'โลโก้', en: 'brand logo', th: 'โลโก้' },
    ];
    const existingLabels = new Set<string>(schema.image_fields.map((f: any) => String(f?.label || '').toLowerCase().trim()));
    const autoAdded: Array<{ label: string; placeholder: string }> = [];
    for (const s of subjectSignals) {
      if (s.pattern.test(promptTemplate) && !existingLabels.has(s.suggestedLabel.toLowerCase().trim())) {
        schema.image_fields.push({ label: s.suggestedLabel, english_description: s.en, thai_description: s.th, role: 'auto-added', primary: false });
        autoAdded.push({ label: s.suggestedLabel, placeholder: `{{${s.suggestedLabel}: ${s.en} | ${s.th} | image}}` });
      }
    }
    if (autoAdded.length > 0) {
      console.log(`[analyze-thumbnail] auto-added missing subjects: ${autoAdded.map((x) => x.label).join(', ')}`);
      // Inject the auto-added placeholders at the END of wrapped_prompt so user sees them in the field list.
      const inject = autoAdded.map((x) => x.placeholder).join(' ');
      wrapped += `\n\n${inject}`;
    }

    // Dedup image_fields by label
    {
      const seen = new Set<string>();
      schema.image_fields = schema.image_fields.filter((f: any) => {
        const k = String(f?.label || '').toLowerCase().trim();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    // Dedup text_fields by label AND actual_text
    {
      const seenLabels = new Set<string>();
      const seenTexts = new Set<string>();
      schema.text_fields = schema.text_fields.filter((f: any) => {
        const labelKey = String(f?.label || '').toLowerCase().trim();
        const textKey = String(f?.actual_text || '').trim();
        if (!labelKey || !textKey) return false;
        if (seenLabels.has(labelKey) || seenTexts.has(textKey)) return false;
        seenLabels.add(labelKey);
        seenTexts.add(textKey);
        return true;
      });
    }
    // Ensure exactly one primary
    if (schema.image_fields.length > 0 && !schema.image_fields.some((f: any) => f?.primary === true)) {
      schema.image_fields[0].primary = true;
    }

    // Normalize literal "\n" → real newline
    wrapped = wrapped.replace(/\\n/g, '\n');

    res.json({ prompt_template: wrapped, schema });
  } catch (err: any) {
    console.error('[admin/image-templates analyze] Error:', err.message);
    res.status(500).json({ error: err.message || 'Analyze failed' });
  }
});

// POST /api/admin/image-templates/extract-name — vision: read the project/brand name from a poster thumbnail
router.post('/image-templates/extract-name', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const imageUrl = String(req.body?.image_url || '').trim();
    if (!imageUrl) return res.status(400).json({ error: 'image_url required' });

    const u = await pool.query(`SELECT openai_api_key, openrouter_api_key, ai_provider FROM users WHERE id = $1`, [userId]);
    const user = u.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    const provider = user.ai_provider || 'openai';
    const apiKey = provider === 'openrouter' ? user.openrouter_api_key : user.openai_api_key;
    if (!apiKey) return res.status(400).json({ error: 'กรุณาตั้งค่า API key ใน Settings ก่อน' });
    const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
    const model = provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';

    // Download + base64 (avoid OpenAI fetch timeout from S3)
    let imageDataUrl = imageUrl;
    try {
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
      const arrayBuf = await imgResp.arrayBuffer();
      const mime = imgResp.headers.get('content-type') || 'image/jpeg';
      const b64 = Buffer.from(arrayBuf).toString('base64');
      imageDataUrl = `data:${mime};base64,${b64}`;
    } catch (e: any) {
      return res.status(500).json({ error: `ดาวน์โหลดภาพไม่สำเร็จ: ${e?.message || 'unknown'}` });
    }

    const sys = `You analyze any poster / advertisement image (real-estate, food, event, product, fashion, education, travel, etc.) and extract metadata as JSON.

Return ONLY a JSON object (no markdown fence, no explanation) with these keys:
{
  "name_en": "<the main brand/title/subject name in English>",
  "name_th": "<the main brand/title/subject name in Thai if visible, else empty>",
  "description_en": "<one-sentence English summary describing the poster's style, type, and key visuals — for admin's template catalog>",
  "description_th": "<one-sentence Thai summary, same content as description_en>"
}

Rules:
- "Main name" = the most prominent identifying title on the poster. The brand/project/event/product/restaurant/destination — whatever the poster is about. NOT a category word (e.g. NOT just "House"), NOT a tagline, NOT a price.
  Examples: "Move-in Ready Condo" (real estate), "Pizza Palace" (food), "Tech Conference 2025" (event), "Apple Watch Pro" (product), "Phuket Beach Resort" (travel).
- If you cannot identify a clear main name, return empty strings for name_en / name_th.
- Preserve exact spelling and casing of names as shown on the poster.
- description_en / description_th = SHORT (≤ 80 chars), describe the poster style + type briefly so admin can identify the template in a list.
  Examples (EN): "Luxury black-gold real estate poster with interior gallery", "Vibrant food menu poster with photo grid", "Modern event poster with date and venue details", "Premium product showcase poster with feature highlights".
  Examples (TH): "เทมเพลตโปสเตอร์อสังหาฯ โทนดำทอง พร้อมแกลเลอรีภาพ", "โปสเตอร์เมนูอาหาร โทนสดใส", "โปสเตอร์งานอีเวนต์ โมเดิร์น", "โปสเตอร์โชว์สินค้า โทนพรีเมียม"
- If the image is unreadable, return empty strings for all fields.`;

    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: [
            { type: 'text', text: 'Identify the main project name from this poster.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ]},
        ],
        temperature: 0,
        max_tokens: 200,
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: `AI error: ${err.slice(0, 200)}` });
    }
    const data: any = await r.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    let parsed: any = {};
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {}
    res.json({
      name_en: String(parsed.name_en || '').trim(),
      name_th: String(parsed.name_th || '').trim(),
      description_en: String(parsed.description_en || '').trim(),
      description_th: String(parsed.description_th || '').trim(),
    });
  } catch (err: any) {
    console.error('[admin/image-templates extract-name] Error:', err.message);
    res.status(500).json({ error: err.message || 'Extract failed' });
  }
});

// POST /api/admin/translate — quick translation helper for admin forms
// Body: { text, target: 'th' | 'en' }
router.post('/translate', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const text = String(req.body?.text || '').trim();
    const target = req.body?.target === 'en' ? 'en' : 'th';
    if (!text) return res.json({ translation: '' });

    const u = await pool.query(`SELECT openai_api_key, openrouter_api_key, ai_provider FROM users WHERE id = $1`, [userId]);
    const user = u.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    const provider = user.ai_provider || 'openai';
    const apiKey = provider === 'openrouter' ? user.openrouter_api_key : user.openai_api_key;
    if (!apiKey) return res.status(400).json({ error: 'กรุณาตั้งค่า API key ใน Settings ก่อน' });
    const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
    const model = provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';

    const targetLang = target === 'en' ? 'English' : 'Thai';
    const sys = `You are a translator. Translate the user's text to ${targetLang}. Output ONLY the translation, no quotes, no explanation, no extra text. Preserve proper nouns and brand names.`;

    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: text }],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: `AI error: ${err.slice(0, 200)}` });
    }
    const data: any = await r.json();
    const translation = (data.choices?.[0]?.message?.content || '').trim();
    res.json({ translation });
  } catch (err: any) {
    console.error('[admin/translate] Error:', err.message);
    res.status(500).json({ error: err.message || 'Translate failed' });
  }
});

// GET /api/admin/banners/public — anyone authed can read active banners (used by /update page)
router.get('/banners/public', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT id, slug, date_th, date_en, title_th, title_en, detail_title_th, detail_title_en,
              banner, video_url, details, links, prompts
       FROM update_banners
       WHERE is_active = TRUE
       ORDER BY display_order ASC, id ASC`
    );
    res.json(r.rows);
  } catch (err: any) {
    console.error('[admin/banners public] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to load banners' });
  }
});

// =============================================================================
// SUBSCRIPTION PACKAGES — CRUD
// =============================================================================
//
// Backed by services/plansService.ts. Read endpoints are open to any admin;
// write endpoints are restricted to super admin (pricing changes affect
// everyone who signs up afterwards).
//
// Validation:
//   - subtotal must be a non-negative finite number
//   - days must be a positive integer ≤ 3650
//   - commission_percent (optional) must be 0–100 when present
//   - slug must be a-z0-9_- only, unique
//
// DELETE is implemented as a soft-delete (is_active = false) because past
// subscriptions in `subscriptions.plan_type` may still reference the slug.

function validatePackageInput(body: any, isUpdate = false): string | null {
  if (!isUpdate || body.slug !== undefined) {
    if (typeof body.slug !== 'string' || !/^[a-z0-9_-]+$/.test(body.slug)) {
      return 'slug must be lowercase a-z, 0-9, underscore or hyphen';
    }
  }
  if (!isUpdate || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return 'name is required';
  }
  if (!isUpdate || body.subtotal !== undefined) {
    const n = Number(body.subtotal);
    if (!Number.isFinite(n) || n < 0) return 'subtotal must be ≥ 0';
  }
  if (!isUpdate || body.days !== undefined) {
    const d = Number(body.days);
    if (!Number.isInteger(d) || d <= 0 || d > 3650) return 'days must be a positive integer ≤ 3650';
  }
  if (body.commission_percent !== undefined && body.commission_percent !== null) {
    const c = Number(body.commission_percent);
    if (!Number.isFinite(c) || c < 0 || c > 100) return 'commission_percent must be between 0 and 100';
  }
  return null;
}

/** GET /api/admin/packages — list ALL packages (active + inactive + admin-only).
 *  Delegates to plansService so admin sees the same shape as the public endpoint
 *  (including admin_alt_prices_computed, tier_id, admin_only). */
router.get('/packages', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const packages = await plansService.getAllPlansForAdmin();
    res.json({ packages });
  } catch (error: any) {
    console.error('Get packages error:', error);
    res.status(500).json({ error: 'Failed to load packages' });
  }
});

/** POST /api/admin/packages — create new package */
router.post('/packages', authenticate, requireAdmin, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const err = validatePackageInput(req.body, false);
    if (err) return res.status(400).json({ error: err });

    const created = await plansService.createPlan({
      slug: req.body.slug,
      name: req.body.name,
      name_th: req.body.name_th ?? null,
      subtotal: Number(req.body.subtotal),
      days: Number(req.body.days),
      commission_percent: req.body.commission_percent === '' || req.body.commission_percent == null
        ? null
        : Number(req.body.commission_percent),
      description: req.body.description ?? null,
      features: Array.isArray(req.body.features) ? req.body.features : [],
      display_order: Number(req.body.display_order ?? 0),
      admin_alt_prices: Array.isArray(req.body.admin_alt_prices) ? req.body.admin_alt_prices : undefined,
      tier_id: req.body.tier_id === '' || req.body.tier_id == null ? null : Number(req.body.tier_id),
      admin_only: req.body.admin_only === true,
    });
    res.json({ success: true, package: created });
  } catch (error: any) {
    // Postgres unique violation
    if (error.code === '23505') {
      return res.status(409).json({ error: 'slug already exists' });
    }
    console.error('Create package error:', error);
    res.status(500).json({ error: error.message || 'Failed to create package' });
  }
});

/** PUT /api/admin/packages/:id — update package */
router.put('/packages/:id', authenticate, requireAdmin, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const err = validatePackageInput(req.body, true);
    if (err) return res.status(400).json({ error: err });

    const updated = await plansService.updatePlan(id, {
      name: req.body.name,
      name_th: req.body.name_th,
      subtotal: req.body.subtotal !== undefined ? Number(req.body.subtotal) : undefined,
      days: req.body.days !== undefined ? Number(req.body.days) : undefined,
      commission_percent: req.body.commission_percent === '' || req.body.commission_percent === null
        ? null
        : req.body.commission_percent !== undefined
        ? Number(req.body.commission_percent)
        : undefined,
      description: req.body.description,
      features: req.body.features,
      display_order: req.body.display_order !== undefined ? Number(req.body.display_order) : undefined,
      is_active: req.body.is_active,
      admin_alt_prices: Array.isArray(req.body.admin_alt_prices) ? req.body.admin_alt_prices : undefined,
      tier_id: req.body.tier_id === undefined
        ? undefined
        : req.body.tier_id === '' || req.body.tier_id === null
          ? null
          : Number(req.body.tier_id),
      admin_only: typeof req.body.admin_only === 'boolean' ? req.body.admin_only : undefined,
    });
    if (!updated) return res.status(404).json({ error: 'package not found' });
    res.json({ success: true, package: updated });
  } catch (error: any) {
    console.error('Update package error:', error);
    res.status(500).json({ error: error.message || 'Failed to update package' });
  }
});

/** DELETE /api/admin/packages/:id — soft delete (is_active=false) */
router.delete('/packages/:id', authenticate, requireAdmin, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const updated = await plansService.softDeletePlan(id);
    if (!updated) return res.status(404).json({ error: 'package not found' });
    res.json({ success: true, package: updated });
  } catch (error: any) {
    console.error('Delete package error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete package' });
  }
});

// =============================================================================
// AFFILIATE TIERS — CRUD
// =============================================================================
//
// /tiers-v2 (instead of /tiers) to avoid colliding with the legacy
// /api/affiliate/admin/tiers endpoint that returns the old tier1/tier2 shape.

function validateTierInput(body: any, isUpdate = false): string | null {
  if (!isUpdate || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return 'name is required';
  }
  if (!isUpdate || body.commission_percent !== undefined) {
    const c = Number(body.commission_percent);
    if (!Number.isFinite(c) || c < 0 || c > 100) return 'commission_percent must be between 0 and 100';
  }
  return null;
}

/** GET /api/admin/tiers-v2 — list all tiers (active + inactive) + user counts */
router.get('/tiers-v2', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const tiers = await tiersService.getAllTiers();
    // Join in user counts so admin sees who's in each tier before deleting
    const counts = await pool.query<{ affiliate_tier: number; c: string }>(
      `SELECT affiliate_tier, COUNT(*)::text AS c
         FROM users
        WHERE affiliate_tier IS NOT NULL
        GROUP BY affiliate_tier`
    );
    const countMap = new Map(counts.rows.map((r) => [r.affiliate_tier, parseInt(r.c, 10)]));
    res.json({
      tiers: tiers.map((t) => ({ ...t, user_count: countMap.get(t.id) || 0 })),
    });
  } catch (error: any) {
    console.error('Get tiers error:', error);
    res.status(500).json({ error: 'Failed to load tiers' });
  }
});

/** POST /api/admin/tiers-v2 — create new tier */
router.post('/tiers-v2', authenticate, requireAdmin, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const err = validateTierInput(req.body, false);
    if (err) return res.status(400).json({ error: err });
    const created = await tiersService.createTier({
      name: req.body.name,
      name_th: req.body.name_th ?? null,
      commission_percent: Number(req.body.commission_percent),
      description: req.body.description ?? null,
      display_order: Number(req.body.display_order ?? 0),
      badge_color: req.body.badge_color ?? 'gray',
    });
    res.json({ success: true, tier: created });
  } catch (error: any) {
    console.error('Create tier error:', error);
    res.status(500).json({ error: error.message || 'Failed to create tier' });
  }
});

/** PUT /api/admin/tiers-v2/:id — update tier (incl. is_active toggle) */
router.put('/tiers-v2/:id', authenticate, requireAdmin, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const err = validateTierInput(req.body, true);
    if (err) return res.status(400).json({ error: err });

    const updated = await tiersService.updateTier(id, {
      name: req.body.name,
      name_th: req.body.name_th,
      commission_percent: req.body.commission_percent !== undefined ? Number(req.body.commission_percent) : undefined,
      description: req.body.description,
      display_order: req.body.display_order !== undefined ? Number(req.body.display_order) : undefined,
      badge_color: req.body.badge_color,
      is_active: req.body.is_active,
    });
    if (!updated) return res.status(404).json({ error: 'tier not found' });
    res.json({ success: true, tier: updated });
  } catch (error: any) {
    console.error('Update tier error:', error);
    res.status(500).json({ error: error.message || 'Failed to update tier' });
  }
});

/** DELETE /api/admin/tiers-v2/:id — hard delete, rejected if users are assigned */
router.delete('/tiers-v2/:id', authenticate, requireAdmin, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const userCount = await tiersService.countUsersInTier(id);
    if (userCount > 0) {
      return res.status(409).json({
        error: `Cannot delete tier — ${userCount} user(s) still assigned. Re-assign them first.`,
        errorCode: 'TIER_IN_USE',
        userCount,
      });
    }
    const ok = await tiersService.deleteTier(id);
    if (!ok) return res.status(404).json({ error: 'tier not found' });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete tier error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete tier' });
  }
});

/* ================================================================== */
/*  Tax Invoice Requests (admin side)                                   */
/*  Schema: migration 013_tax_invoice_requests                          */
/* ================================================================== */

/**
 * GET /api/admin/tax-invoices
 * Query: status=all|pending|issued|rejected, q (email search), limit, offset
 *
 * List paginated requests with user info + extension log + tax info snapshot
 * (from user_bank_accounts JOIN — what admin needs to type up the invoice).
 */
router.get('/tax-invoices', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const status = (req.query.status as any) || 'all';
    const q = (req.query.q as string) || '';
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await taxInvoiceService.listForAdmin({ status, q, limit, offset });
    res.json({ requests: result.rows, total: result.total, limit, offset });
  } catch (err: any) {
    console.error('[admin/tax-invoices] list failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to list invoice requests' });
  }
});

/**
 * POST /api/admin/tax-invoices/:id/upload
 * Multipart file ('file'). PDF/JPG/PNG/WebP ≤ 10MB. Sets status='issued'.
 * Same-key overwrite when admin re-uploads to fix a typo (1-invoice-per-
 * request rule is preserved — we just refresh the file, not the row).
 */
router.post(
  '/tax-invoices/:id/upload',
  authenticate,
  requireAdmin,
  invoiceUpload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const existing = await taxInvoiceService.getRequest(id);
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const result = await taxInvoiceService.uploadInvoice(
        id,
        req.userId!,
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );
      res.json({ success: true, invoice_url: result.invoice_url, status: 'issued' });
    } catch (err: any) {
      console.error('[admin/tax-invoices] upload failed:', err);
      res.status(500).json({ error: err?.message || 'Failed to upload invoice' });
    }
  }
);

/**
 * POST /api/admin/tax-invoices/:id/reject
 * Body: { notes }
 * Refuses to reject an already-issued request (admin must not silently
 * "undo" a previously delivered invoice).
 */
router.post(
  '/tax-invoices/:id/reject',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
      const notes = String(req.body?.notes ?? '').trim();
      if (!notes) return res.status(400).json({ error: 'notes is required for rejection' });

      const result = await taxInvoiceService.rejectInvoice(id, req.userId!, notes);
      if (!result.ok) {
        if (result.error === 'already_issued') return res.status(409).json({ error: result.error });
        return res.status(404).json({ error: result.error });
      }
      res.json({ success: true, status: 'rejected' });
    } catch (err: any) {
      console.error('[admin/tax-invoices] reject failed:', err);
      res.status(500).json({ error: err?.message || 'Failed to reject invoice' });
    }
  }
);

/* ================================================================== */
/*  Welcome Popup Banners (admin-managed swap library)                  */
/*  Schema: migration 014_welcome_banners                               */
/* ================================================================== */

/**
 * GET /api/admin/welcome-banners
 * List all welcome popup banners (active + inactive). Used by the
 * /admin/banners → "Welcome popup" tab.
 */
router.get('/welcome-banners', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT id, image_url, link_url, label, is_active, display_order,
              created_by, created_at, updated_at
         FROM welcome_banners
        ORDER BY is_active DESC, display_order ASC, id DESC`
    );
    res.json({ banners: r.rows });
  } catch (err: any) {
    console.error('[admin/welcome-banners] list failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to list welcome banners' });
  }
});

/**
 * POST /api/admin/welcome-banners
 * Body: { image_url, link_url?, label?, display_order? }
 * Always created inactive — admin uses /activate to swap which one shows.
 */
router.post('/welcome-banners', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const image_url = String(req.body?.image_url ?? '').trim();
    if (!image_url) return res.status(400).json({ error: 'image_url is required' });
    // link_url is optional — empty / whitespace / null all map to SQL NULL
    // (the FE WelcomePopup treats null as "no navigation on click", just dismiss).
    const rawLink = req.body?.link_url;
    const link_url = (typeof rawLink === 'string' && rawLink.trim()) ? rawLink.trim() : null;
    const label = req.body?.label ? String(req.body.label).trim() : null;
    const display_order = Number(req.body?.display_order ?? 0) || 0;

    const r = await pool.query(
      `INSERT INTO welcome_banners (image_url, link_url, label, display_order, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, image_url, link_url, label, is_active, display_order, created_at, updated_at`,
      [image_url, link_url, label, display_order, req.userId]
    );
    res.status(201).json({ banner: r.rows[0] });
  } catch (err: any) {
    console.error('[admin/welcome-banners] create failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to create welcome banner' });
  }
});

/**
 * PUT /api/admin/welcome-banners/:id
 * Body: { image_url?, link_url?, label?, display_order? } — partial update.
 * Does NOT toggle is_active here; use /activate instead so the
 * one-active-at-a-time invariant stays atomic.
 */
router.put('/welcome-banners/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, val: any) => { sets.push(`${col} = $${params.length + 1}`); params.push(val); };
    if (req.body?.image_url !== undefined) push('image_url', String(req.body.image_url).trim());
    if (req.body?.link_url !== undefined) {
      // Optional — empty string / whitespace / null all clear the field to NULL
      const raw = req.body.link_url;
      push('link_url', (typeof raw === 'string' && raw.trim()) ? raw.trim() : null);
    }
    if (req.body?.label !== undefined) push('label', req.body.label ? String(req.body.label).trim() : null);
    if (req.body?.display_order !== undefined) push('display_order', Number(req.body.display_order) || 0);
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    sets.push(`updated_at = NOW()`);
    params.push(id);

    const r = await pool.query(
      `UPDATE welcome_banners SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, image_url, link_url, label, is_active, display_order, created_at, updated_at`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ banner: r.rows[0] });
  } catch (err: any) {
    console.error('[admin/welcome-banners] update failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to update welcome banner' });
  }
});

/**
 * POST /api/admin/welcome-banners/:id/activate
 * Atomic swap: deactivate every other row, set this one active.
 * The partial unique index makes the "deactivate-then-activate" sequence
 * safe even under concurrent calls — second caller's UPDATE would fail
 * with 23505 if we didn't deactivate first.
 */
router.post('/welcome-banners/:id/activate', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    await client.query('BEGIN');
    // Verify target exists FIRST so we don't deactivate everything on a bad id
    const exists = await client.query('SELECT 1 FROM welcome_banners WHERE id = $1', [id]);
    if (exists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    await client.query(`UPDATE welcome_banners SET is_active = false, updated_at = NOW() WHERE is_active = true`);
    const r = await client.query(
      `UPDATE welcome_banners SET is_active = true, updated_at = NOW() WHERE id = $1
       RETURNING id, image_url, link_url, label, is_active, display_order, created_at, updated_at`,
      [id]
    );
    await client.query('COMMIT');
    res.json({ banner: r.rows[0] });
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[admin/welcome-banners] activate failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to activate welcome banner' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/admin/welcome-banners/:id
 * Refuses to delete the currently active banner — admin must activate
 * another row first to avoid leaving the popup with no banner.
 */
router.delete('/welcome-banners/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const probe = await pool.query<{ is_active: boolean }>(
      'SELECT is_active FROM welcome_banners WHERE id = $1',
      [id]
    );
    if (probe.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    if (probe.rows[0].is_active) {
      return res.status(409).json({
        error: 'cannot_delete_active',
        message: 'Activate another banner first, then delete this one.',
      });
    }
    await pool.query('DELETE FROM welcome_banners WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[admin/welcome-banners] delete failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete welcome banner' });
  }
});

/**
 * GET /api/admin/tax-invoices/:id/file
 * Admin proxy stream — preview the uploaded invoice file. Same headers as
 * the user-side proxy in subscription.ts (inline by default, attachment via
 * ?download=1). No ownership check — any admin can view.
 */
router.get(
  '/tax-invoices/:id/file',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

      const row = await taxInvoiceService.getRequest(id);
      if (!row) return res.status(404).json({ error: 'not_found' });
      if (!row.invoice_url) return res.status(404).json({ error: 'No invoice file uploaded yet' });

      const download = req.query.download === '1' || req.query.download === 'true';
      const dispositionHeader = download
        ? `attachment; filename="invoice-${id}.pdf"`
        : 'inline';

      // Local-dev local-file branch
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

      if (!getBucketName()) return res.status(500).json({ error: 'S3 not configured' });
      const fileStream = await getFile(row.invoice_url);
      res.setHeader('Content-Type', fileStream.ContentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', dispositionHeader);
      res.setHeader('Cache-Control', 'no-store');
      (fileStream.Body as any)?.pipe(res);
    } catch (err: any) {
      console.error('[admin/tax-invoices file] failed:', err);
      res.status(500).json({ error: err?.message || 'Failed to stream invoice' });
    }
  }
);

export default router;
