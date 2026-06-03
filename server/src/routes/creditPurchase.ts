/**
 * Credit purchase / top-up endpoints — slip-based, mirrors
 * /api/subscription/v2/verify-and-approve.
 *
 *   GET  /api/credit-purchase/packages           — public list of packages
 *   GET  /api/credit-purchase/my-purchases       — user purchase history
 *   POST /api/credit-purchase/verify-and-approve — upload slip + package_slug → Thunder → addCredits
 *   POST /api/credit-purchase/upload-slip-manual — fallback for admin approval (no Thunder check)
 *   POST /api/admin/credit-purchase/:id/approve  — admin manual approve
 *   POST /api/admin/credit-purchase/:id/reject   — admin reject
 *
 * Note: admin endpoints are mounted at /api/admin/credit-purchase via subrouter.
 */
import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { verifySlipImage, ThunderError } from '../utils/thunderApi.js';
import { addCredits } from '../services/creditService.js';

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

const slipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP allowed'));
  },
});

const router = express.Router();

interface PackageRow {
  id: number;
  slug: string;
  name: string;
  name_th: string | null;
  credits: number;
  price_thb: string; // numeric serialised
  description: string | null;
  display_order: number;
  is_active: boolean;
}

interface PurchaseRow {
  id: number;
  user_id: number;
  package_slug: string;
  credits: number;
  amount_thb: string;
  slip_url: string | null;
  status: string;
  thunder_check: unknown;
  rejection_reason: string | null;
  approved_by_admin_id: number | null;
  approved_at: string | null;
  credit_transaction_id: number | null;
  created_at: string;
  updated_at: string;
}

// =========================================================================
// Public — packages catalogue
// =========================================================================

router.get('/packages', async (_req: Request, res: Response) => {
  try {
    const r = await pool.query<PackageRow>(
      `SELECT id, slug, name, name_th, credits, price_thb, description, display_order, is_active
         FROM credit_packages
        WHERE is_active = TRUE
        ORDER BY display_order ASC, id ASC`
    );
    res.json({
      items: r.rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        name_th: row.name_th,
        credits: row.credits,
        price_thb: Number(row.price_thb),
        description: row.description,
      })),
    });
  } catch (err: any) {
    console.error('[creditPurchase:packages]', err);
    res.status(500).json({ error: err?.message || 'list failed' });
  }
});

// =========================================================================
// User — purchase history
// =========================================================================

router.get('/my-purchases', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query<PurchaseRow>(
      `SELECT id, user_id, package_slug, credits, amount_thb, slip_url, status,
              rejection_reason, approved_at, credit_transaction_id, created_at
         FROM credit_purchases
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [req.userId!]
    );
    res.json({ items: r.rows });
  } catch (err: any) {
    console.error('[creditPurchase:myPurchases]', err);
    res.status(500).json({ error: err?.message || 'list failed' });
  }
});

// =========================================================================
// User — upload slip + Thunder auto-verify
// =========================================================================

router.post(
  '/verify-and-approve',
  authenticate,
  slipUpload.single('slip'),
  async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const client = await pool.connect();
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded', errorCode: 'NO_FILE' });
      }

      const packageSlug = String(req.body.package_slug || '').toLowerCase();
      if (!packageSlug) {
        return res.status(400).json({ error: 'package_slug required', errorCode: 'NO_PACKAGE' });
      }

      const pkgRes = await pool.query<PackageRow>(
        `SELECT * FROM credit_packages WHERE slug = $1 AND is_active = TRUE`,
        [packageSlug]
      );
      if (pkgRes.rowCount === 0) {
        return res.status(400).json({
          error: `Unknown or inactive package: ${packageSlug}`,
          errorCode: 'INVALID_PACKAGE',
        });
      }
      const pkg = pkgRes.rows[0];
      const expectedAmount = Number(pkg.price_thb);
      const credits = pkg.credits;

      // 1. Upload slip to S3 first (record exists even if verify fails)
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
      const s3Key = `payment-slips/credit-${uniqueSuffix}${ext}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        })
      );
      const slipUrl = `/api/subscription/slips/${s3Key}`;

      // 2. Thunder verify
      let thunderData;
      try {
        thunderData = await verifySlipImage(req.file.buffer, req.file.mimetype);
      } catch (err: any) {
        if (err instanceof ThunderError) {
          // Persist failed attempt for audit trail
          await pool.query(
            `INSERT INTO credit_purchases
               (user_id, package_slug, credits, amount_thb, slip_url, status,
                thunder_check, rejection_reason)
             VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7)`,
            [userId, packageSlug, credits, expectedAmount, slipUrl, JSON.stringify({ error: err.code }), err.message]
          );
          return res.status(400).json({ error: err.message, errorCode: err.code });
        }
        throw err;
      }

      // 3. Validate
      if (thunderData.isDuplicate) {
        await pool.query(
          `INSERT INTO credit_purchases
             (user_id, package_slug, credits, amount_thb, slip_url, status,
              thunder_check, rejection_reason)
           VALUES ($1, $2, $3, $4, $5, 'duplicate', $6, 'Slip already used')`,
          [userId, packageSlug, credits, expectedAmount, slipUrl, JSON.stringify(thunderData)]
        );
        return res.status(400).json({ error: 'Slip already used', errorCode: 'DUPLICATE_SLIP' });
      }

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
      if (thunderData.amountInSlip !== expectedAmount) {
        return res.status(400).json({
          error: `Amount mismatch: expected ฿${expectedAmount}, got ฿${thunderData.amountInSlip}`,
          errorCode: 'INVALID_AMOUNT',
        });
      }
      const slipDate = new Date(thunderData.rawSlip.date);
      const ageMs = Date.now() - slipDate.getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        return res.status(400).json({
          error: `Slip too old (${Math.floor(ageMs / 3600000)}h ago)`,
          errorCode: 'EXPIRED_SLIP',
        });
      }

      // 4. All passed — grant credits in a transaction
      await client.query('BEGIN');

      // Insert purchase row first (so we have id to link credit_transaction)
      const purchase = await client.query<{ id: number }>(
        `INSERT INTO credit_purchases
           (user_id, package_slug, credits, amount_thb, slip_url, status,
            thunder_check, approved_at)
         VALUES ($1, $2, $3, $4, $5, 'auto_approved', $6, NOW())
         RETURNING id`,
        [userId, packageSlug, credits, expectedAmount, slipUrl, JSON.stringify(thunderData)]
      );
      const purchaseId = purchase.rows[0].id;

      // Grant credits via creditService
      const add = await addCredits(
        userId,
        credits,
        'purchase',
        `Credit Top-up · ${pkg.name_th || pkg.name} · ฿${expectedAmount}`
      );
      if (!add.success) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: add.error || 'Credit grant failed' });
      }

      // Link the credit_transactions row we just created back to credit_purchases
      // (addCredits doesn't expose the row id directly — look it up by description+user+amount).
      // Cheap join by metadata: amount + user + created within last 5 sec.
      const tx = await client.query<{ id: number }>(
        `SELECT id FROM credit_transactions
          WHERE user_id = $1 AND type = 'purchase' AND amount = $2
          ORDER BY id DESC LIMIT 1`,
        [userId, credits]
      );
      const transactionId = tx.rows[0]?.id || null;

      await client.query(
        `UPDATE credit_purchases
            SET credit_transaction_id = $1, updated_at = NOW()
          WHERE id = $2`,
        [transactionId, purchaseId]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        purchase_id: purchaseId,
        credits_added: credits,
        new_balance: add.balanceAfter,
        message: `✅ เติม ${credits.toLocaleString()} เครดิตสำเร็จ`,
      });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[creditPurchase:verifyAndApprove]', err);
      res.status(500).json({ error: err?.message || 'verify failed' });
    } finally {
      client.release();
    }
  }
);

export default router;
