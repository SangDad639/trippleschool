import express, { Response } from 'express';
import { authenticate, requireAdmin, requireSuperAdmin, AuthRequest } from '../middleware/auth.js';
import pool from '../db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getBucketName, uploadFile, getSignedFileUrl, getFile } from '../utils/s3.js';
import * as tiersService from '../services/tiersService.js';

// Configure multer for payment proof upload (images + PDF)
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only images (JPEG, PNG, WebP) and PDF files are allowed'));
    }
  }
});

const router = express.Router();

// ============================================
// User Endpoints
// ============================================

/**
 * GET /api/affiliate/announcement
 * Get affiliate program announcement
 */
router.get('/announcement', async (req, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT announcement FROM affiliate_settings WHERE id = 1'
    );
    res.json({ announcement: result.rows[0]?.announcement || '' });
  } catch (error) {
    console.error('Get announcement error:', error);
    res.status(500).json({ error: 'Failed to get announcement' });
  }
});

/**
 * GET /api/affiliate/my-stats
 * Get user's affiliate statistics including Wise email and Thai bank info
 */
router.get('/my-stats', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    // Get user's affiliate profile + JOIN affiliate_tiers so the FE can display
    // the tier *name* (e.g. "VIP", "Diamond") rather than a bare integer.
    const userResult = await pool.query(
      `SELECT u.refcode, u.commission_percent, u.affiliate_tier,
              u.wise_email, u.preferred_payout_method,
              t.name           AS tier_name,
              t.name_th        AS tier_name_th,
              t.commission_percent AS tier_commission_percent,
              t.badge_color    AS tier_badge_color,
              t.description    AS tier_description
         FROM users u
         LEFT JOIN affiliate_tiers t ON t.id = u.affiliate_tier
        WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const {
      refcode, commission_percent, affiliate_tier, wise_email, preferred_payout_method,
      tier_name, tier_name_th, tier_commission_percent, tier_badge_color, tier_description,
    } = userResult.rows[0];

    // Get Thai bank account info + tax info (mig 008 added entity_type;
    // mig 010 added structured address + title_prefix + tax_branch for ภงด.3/53 export).
    const bankResult = await pool.query(
      `SELECT bank_name, branch, account_number, account_holder, phone,
              tax_id, tax_name, tax_address, entity_type,
              title_prefix, address_line, subdistrict, district, province,
              postal_code, tax_branch,
              id_card_url, id_card_uploaded_at
       FROM user_bank_accounts WHERE user_id = $1`,
      [userId]
    );
    const bankInfo = bankResult.rows[0] || null;
    // Signed URL for ID card preview (1-hour TTL) — only when uploaded and
    // OBS is configured. Local-dev path keeps the relative `/uploads/...`
    // URL which the FE can hit directly.
    let idCardSignedUrl: string | null = null;
    if (bankInfo?.id_card_url && getBucketName() && !bankInfo.id_card_url.startsWith('/uploads/')) {
      // inline=true → render in <iframe>/<img>, not download
      try { idCardSignedUrl = await getSignedFileUrl(bankInfo.id_card_url, 3600, { inline: true }); } catch { /* ignore */ }
    }

    // Count total referrals
    const referralsResult = await pool.query(`
      SELECT COUNT(*) as total_count
      FROM users
      WHERE referrer_id = $1
    `, [userId]);

    // Count transfers by status, including WHT breakdown for new rows.
    // For legacy rows wht_amount/net_amount are NULL — we COALESCE so:
    //   gross = amount (always)
    //   wht   = wht_amount or 0
    //   net   = net_amount or amount (legacy: pretend full amount was net)
    const transfersResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'transferred') as completed_count,
        COUNT(*) FILTER (WHERE status = 'pending')     as pending_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'transferred'), 0)                              as gross_earned,
        COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)                                  as pending_gross,
        COALESCE(SUM(COALESCE(wht_amount, 0)) FILTER (WHERE status = 'transferred'), 0)             as wht_earned,
        COALESCE(SUM(COALESCE(wht_amount, 0)) FILTER (WHERE status = 'pending'), 0)                 as pending_wht,
        COALESCE(SUM(COALESCE(net_amount, amount)) FILTER (WHERE status = 'transferred'), 0)        as net_earned,
        COALESCE(SUM(COALESCE(net_amount, amount)) FILTER (WHERE status = 'pending'), 0)            as pending_net
      FROM affiliate_commissions
      WHERE referrer_id = $1
    `, [userId]);

    const t = transfersResult.rows[0];

    // Resolve the tier card the FE renders. If the user already has a row
    // joined from affiliate_tiers, use that. Otherwise (affiliate_tier IS NULL —
    // typical for newly registered users) fall back to the *default tier* — the
    // active tier with the lowest display_order — so the Profile card never
    // shows "Tier 1 — 0%" for a user who is effectively on Tier 1.
    let tierPayload: {
      id: number | null;
      name: string;
      name_th: string | null;
      commission_percent: number | null;
      badge_color: string;
      description: string | null;
    } | null = null;

    if (tier_name) {
      tierPayload = {
        id: affiliate_tier,
        name: tier_name,
        name_th: tier_name_th,
        commission_percent: tier_commission_percent != null ? parseFloat(tier_commission_percent) : null,
        badge_color: tier_badge_color || 'gray',
        description: tier_description,
      };
    } else {
      // No tier assigned in DB — synthesise from the default tier row so the
      // displayed % matches what BE actually pays out on the next sale.
      try {
        const def = await tiersService.getDefaultTier();
        if (def) {
          tierPayload = {
            id: def.id,
            name: def.name,
            name_th: def.name_th ?? null,
            commission_percent: def.commission_percent,
            badge_color: def.badge_color ?? 'gray',
            description: def.description ?? null,
          };
        }
      } catch { /* tiers table missing on un-migrated DB — leave tierPayload null */ }
    }

    res.json({
      refcode: refcode || '',
      commission_percent: commission_percent || 10,
      // Legacy field — keep returning number so old FE code (Profile Tier card
      // resolution to Tier 1 vs Tier 2) still works during migration.
      affiliate_tier: affiliate_tier || tierPayload?.id || 1,
      // New fields from affiliate_tiers — either the joined row (assigned)
      // or the resolved default tier (unassigned user).
      tier: tierPayload,
      total_referrals: parseInt(referralsResult.rows[0].total_count) || 0,
      pending_transfers: parseInt(t.pending_count) || 0,
      completed_transfers: parseInt(t.completed_count) || 0,
      // Legacy field names — kept for backward compat (now reflect NET, what user receives).
      total_earnings: parseFloat(t.net_earned) || 0,
      pending_amount: parseFloat(t.pending_net) || 0,
      // Explicit breakdown — FE prefers these new fields.
      pending_gross: parseFloat(t.pending_gross) || 0,
      pending_wht: parseFloat(t.pending_wht) || 0,
      pending_net: parseFloat(t.pending_net) || 0,
      gross_earned: parseFloat(t.gross_earned) || 0,
      wht_earned: parseFloat(t.wht_earned) || 0,
      net_earned: parseFloat(t.net_earned) || 0,
      wise_email: wise_email || null,
      preferred_payout_method: preferred_payout_method || 'wise',
      thai_bank_info: bankInfo ? {
        bank_name: bankInfo.bank_name,
        branch: bankInfo.branch,
        account_number: bankInfo.account_number,
        account_holder: bankInfo.account_holder,
        phone: bankInfo.phone,
        tax_id: bankInfo.tax_id,
        tax_name: bankInfo.tax_name,
        tax_address: bankInfo.tax_address,
        entity_type: bankInfo.entity_type || 'individual',
        // structured tax address (mig 010) — used by FE TaxInfoSection + export to ภงด.3/53
        title_prefix: bankInfo.title_prefix,
        address_line: bankInfo.address_line,
        subdistrict: bankInfo.subdistrict,
        district: bankInfo.district,
        province: bankInfo.province,
        postal_code: bankInfo.postal_code,
        tax_branch: bankInfo.tax_branch,
        // ID card upload (mig 011) — optional
        id_card_url: bankInfo.id_card_url,
        id_card_uploaded_at: bankInfo.id_card_uploaded_at,
        // BE proxy path for previewing. FE fetches with Authorization header
        // → blob URL → <iframe>/<img>. Bypasses HWC OBS attachment quirk.
        // `?v=<uploaded_at>` busts browser cache when user uploads a new file
        // (same path, new timestamp → new URL → fresh fetch).
        id_card_preview_path: bankInfo.id_card_url ? `/api/affiliate/id-card/${userId}` : null,
        // Kept for backward-compat with existing FE callers, but the inline
        // override doesn't work on HWC OBS — prefer `id_card_preview_path`.
        id_card_signed_url: idCardSignedUrl,
      } : null,
    });
  } catch (error) {
    console.error('Get my stats error:', error);
    res.status(500).json({ error: 'Failed to get affiliate stats' });
  }
});

/**
 * GET /api/affiliate/referees
 * Get list of user's referred users
 */
router.get('/referees', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    const result = await pool.query(`
      SELECT
        u.id, u.email, u.join_date as registered_at,
        u.subscription_expires_at,
        CASE
          WHEN u.subscription_expires_at IS NOT NULL AND u.subscription_expires_at > NOW() THEN true
          ELSE false
        END as has_subscription,
        ac.status as commission_status,
        ac.amount as commission_amount
      FROM users u
      LEFT JOIN affiliate_commissions ac ON ac.referee_id = u.id AND ac.referrer_id = $1
      WHERE u.referrer_id = $1
      ORDER BY u.join_date DESC
    `, [userId]);

    res.json({
      referees: result.rows.map(row => ({
        id: row.id,
        email: row.email,
        registered_at: row.registered_at,
        has_subscription: row.has_subscription,
        commission_status: row.commission_status || null,
        commission_amount: row.commission_amount || null,
      }))
    });
  } catch (error) {
    console.error('Get referees error:', error);
    res.status(500).json({ error: 'Failed to get referees' });
  }
});

/**
 * GET /api/affiliate/transfers
 * Get user's transfer/payout history
 */
router.get('/transfers', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    const result = await pool.query(`
      SELECT
        ac.id, ac.amount, ac.status, ac.payment_reference, ac.admin_notes,
        ac.created_at, ac.transferred_at, ac.proof_url, ac.wht_cert_url,
        ac.payment_amount, ac.gxvg_tokens, ac.commission_percent,
        ac.wht_rate, ac.wht_amount, ac.net_amount,
        u.email as referee_email
      FROM affiliate_commissions ac
      JOIN users u ON u.id = ac.referee_id
      WHERE ac.referrer_id = $1
      ORDER BY ac.created_at DESC
    `, [userId]);

    // Return proxy URLs (not OBS signed URLs) — HWC OBS forces
    // `Content-Disposition: attachment` on signed GETs regardless of
    // object metadata, which breaks <iframe>/<img> preview. Proxy through
    // backend so we can set inline ourselves.
    const transfers = result.rows.map(row => {
      const proofProxyUrl = row.proof_url && row.proof_url.startsWith('affiliate-proofs/')
        ? `/api/affiliate/proofs/${row.proof_url}`
        : null;
      const whtCertProxyUrl = row.wht_cert_url && row.wht_cert_url.startsWith('affiliate-proofs/')
        ? `/api/affiliate/proofs/${row.wht_cert_url}`
        : null;
      return {
        id: row.id,
        referee_email: row.referee_email,
        amount: row.amount,
        status: row.status,
        payment_reference: row.payment_reference,
        admin_notes: row.admin_notes,
        created_at: row.created_at,
        transferred_at: row.transferred_at,
        proof_url: row.proof_url || null,
        proof_signed_url: proofProxyUrl,
        wht_cert_url: row.wht_cert_url || null,
        wht_cert_signed_url: whtCertProxyUrl,
        sale_amount: row.payment_amount ? parseFloat(row.payment_amount) : null,
        gxvg_tokens: row.gxvg_tokens || null,
        commission_percent: row.commission_percent ? parseFloat(row.commission_percent) : null,
        wht_rate: row.wht_rate != null ? parseFloat(row.wht_rate) : null,
        wht_amount: row.wht_amount != null ? parseFloat(row.wht_amount) : null,
        net_amount: row.net_amount != null ? parseFloat(row.net_amount) : null,
      };
    });

    res.json({ transfers });
  } catch (error) {
    console.error('Get transfers error:', error);
    res.status(500).json({ error: 'Failed to get transfers' });
  }
});

// ============================================
// Wise Email Endpoint
// ============================================

/**
 * PUT /api/affiliate/wise-email
 * Save/update user's Wise email for receiving payouts
 */
router.put('/wise-email', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    await pool.query('UPDATE users SET wise_email = $1 WHERE id = $2', [email, userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Update Wise email error:', error);
    res.status(500).json({ error: 'Failed to update Wise email' });
  }
});

/**
 * PUT /api/affiliate/bank-account
 * Save/update user's Thai bank account for receiving payouts
 */
router.put('/bank-account', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { bank_name, branch, account_number, account_holder, phone, tax_id, tax_name, tax_address } = req.body;

    // Validate required fields
    if (!bank_name || !account_number || !account_holder) {
      return res.status(400).json({ error: 'Bank name, account number, and account holder are required' });
    }

    // Upsert bank account (including tax info for withholding tax)
    await pool.query(`
      INSERT INTO user_bank_accounts (user_id, bank_name, branch, account_number, account_holder, phone, tax_id, tax_name, tax_address, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        bank_name = EXCLUDED.bank_name,
        branch = EXCLUDED.branch,
        account_number = EXCLUDED.account_number,
        account_holder = EXCLUDED.account_holder,
        phone = EXCLUDED.phone,
        tax_id = EXCLUDED.tax_id,
        tax_name = EXCLUDED.tax_name,
        tax_address = EXCLUDED.tax_address,
        updated_at = NOW()
    `, [userId, bank_name, branch || null, account_number, account_holder, phone || null, tax_id || null, tax_name || null, tax_address || null]);

    res.json({ success: true });
  } catch (error) {
    console.error('Update bank account error:', error);
    res.status(500).json({ error: 'Failed to update bank account' });
  }
});

/**
 * PUT /api/affiliate/tax-info
 *
 * Save/update **tax** info on `user_bank_accounts` — independent of the bank
 * account fields. Used by the Profile → TaxInfoSection form so user can fill
 * in WHT recipient info (ภงด.3 / ภงด.53) without touching their bank account.
 *
 * Tax info is stored on the same row as bank info (1:1 with users.id) because
 * the row represents "this user's payout profile" — both bank receiving AND
 * tax filing reference the same person/entity.
 *
 * Body (all optional — partial update allowed):
 *   entity_type     'individual' | 'juristic'
 *   title_prefix    'นาย' | 'นาง' | 'นางสาว' | 'บริษัท' | 'หจก.' | etc.
 *   tax_name        legal name (person OR company)
 *   tax_id          13-digit national ID (individual) OR tax registration ID (juristic)
 *   address_line    house number + soi + road
 *   subdistrict     ตำบล / แขวง
 *   district        อำเภอ / เขต
 *   province        จังหวัด
 *   postal_code     5 digits
 *   tax_branch      สาขาภาษี — '00000' = สำนักงานใหญ่ (juristic only)
 */
router.put('/tax-info', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const {
      entity_type, title_prefix, tax_name, tax_id,
      address_line, subdistrict, district, province, postal_code, tax_branch,
    } = req.body ?? {};

    // Validate the fields that are present — empty/missing → store NULL (partial update).
    if (entity_type && entity_type !== 'individual' && entity_type !== 'juristic') {
      return res.status(400).json({ error: 'entity_type must be individual or juristic' });
    }
    if (tax_id && !/^\d{13}$/.test(String(tax_id))) {
      return res.status(400).json({ error: 'tax_id must be 13 digits' });
    }
    if (postal_code && !/^\d{5}$/.test(String(postal_code))) {
      return res.status(400).json({ error: 'postal_code must be 5 digits' });
    }

    // Upsert — ใช้ INSERT ... ON CONFLICT (user_id) เพราะ user_bank_accounts ใช้ user_id เป็น PK
    // (รองรับกรณี user ที่ยังไม่เคยตั้ง bank info — สร้าง row ใหม่จาก tax-info ได้)
    // bank_name/account_number/account_holder ใส่ '' ใน INSERT path เพราะ schema NOT NULL —
    // user จะกรอกที่ /affiliate ภายหลัง.
    await pool.query(`
      INSERT INTO user_bank_accounts (
        user_id, bank_name, account_number, account_holder,
        entity_type, title_prefix, tax_name, tax_id,
        address_line, subdistrict, district, province, postal_code, tax_branch,
        updated_at
      )
      VALUES ($1, '', '', '',
              $2, $3, $4, $5,
              $6, $7, $8, $9, $10, $11,
              NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        entity_type   = COALESCE(EXCLUDED.entity_type,   user_bank_accounts.entity_type),
        title_prefix  = EXCLUDED.title_prefix,
        tax_name      = EXCLUDED.tax_name,
        tax_id        = EXCLUDED.tax_id,
        address_line  = EXCLUDED.address_line,
        subdistrict   = EXCLUDED.subdistrict,
        district      = EXCLUDED.district,
        province      = EXCLUDED.province,
        postal_code   = EXCLUDED.postal_code,
        tax_branch    = EXCLUDED.tax_branch,
        updated_at    = NOW()
    `, [
      userId,
      entity_type || 'individual',
      title_prefix || null,
      tax_name || null,
      tax_id || null,
      address_line || null,
      subdistrict || null,
      district || null,
      province || null,
      postal_code || null,
      tax_branch || null,
    ]);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Update tax info error:', error);
    res.status(500).json({ error: 'Failed to update tax info' });
  }
});

/**
 * PUT /api/affiliate/payout-method
 * Set user's preferred payout method (wise or thai_bank)
 */
router.put('/payout-method', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { method } = req.body;

    if (!['wise', 'thai_bank'].includes(method)) {
      return res.status(400).json({ error: 'Invalid payout method. Must be "wise" or "thai_bank"' });
    }

    await pool.query('UPDATE users SET preferred_payout_method = $1 WHERE id = $2', [method, userId]);

    res.json({ success: true, method });
  } catch (error) {
    console.error('Update payout method error:', error);
    res.status(500).json({ error: 'Failed to update payout method' });
  }
});

// ============================================
// Admin Endpoints
// ============================================

/**
 * PUT /api/affiliate/admin/announcement
 * Update affiliate program announcement
 */
router.put('/admin/announcement', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { announcement } = req.body;

    await pool.query(
      'UPDATE affiliate_settings SET announcement = $1, updated_at = NOW() WHERE id = 1',
      [announcement]
    );

    res.json({ announcement });
  } catch (error) {
    console.error('Update announcement error:', error);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

/**
 * GET /api/affiliate/admin/default-commission
 * Get default commission percentage (Tier 1)
 */
router.get('/admin/default-commission', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT tier1_percent FROM affiliate_settings WHERE id = 1'
    );

    res.json({ default_commission: result.rows[0]?.tier1_percent || 20 });
  } catch (error) {
    console.error('Get default commission error:', error);
    res.status(500).json({ error: 'Failed to get default commission' });
  }
});

/**
 * PUT /api/affiliate/admin/default-commission
 * Update default commission percentage (Tier 1).
 * Super admin only — re-prices every Tier 1 affiliate at once.
 */
router.put('/admin/default-commission', authenticate, requireAdmin, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { default_commission } = req.body;

    if (typeof default_commission !== 'number' || default_commission < 0 || default_commission > 100) {
      return res.status(400).json({ error: 'Invalid commission percentage (0-100)' });
    }

    // Update settings
    await pool.query(
      'UPDATE affiliate_settings SET tier1_percent = $1, updated_at = NOW() WHERE id = 1',
      [default_commission]
    );

    // Update Tier 1 users' commission percentages
    const updateResult = await pool.query(
      'UPDATE users SET commission_percent = $1 WHERE affiliate_tier = 1 OR affiliate_tier IS NULL',
      [default_commission]
    );

    res.json({
      message: 'Commission percentage updated',
      default_commission,
      updated_count: updateResult.rowCount,
    });
  } catch (error) {
    console.error('Update default commission error:', error);
    res.status(500).json({ error: 'Failed to update default commission' });
  }
});

/**
 * GET /api/affiliate/admin/tiers
 * Get commission tier percentages
 */
router.get('/admin/tiers', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT tier1_percent, tier2_percent FROM affiliate_settings WHERE id = 1'
    );

    const settings = result.rows[0] || {};
    res.json({
      tier1_percent: settings.tier1_percent || 20,
      tier2_percent: settings.tier2_percent || 25,
    });
  } catch (error) {
    console.error('Get tiers error:', error);
    res.status(500).json({ error: 'Failed to get tiers' });
  }
});

/**
 * PUT /api/affiliate/admin/tiers
 * Update commission tier percentages
 */
// Bulk tier rate update affects every user — restrict to super admin to
// prevent regular admins from accidentally re-pricing the affiliate program.
router.put('/admin/tiers', authenticate, requireAdmin, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { tier1_percent, tier2_percent } = req.body;

    if (typeof tier1_percent !== 'number' || tier1_percent < 0 || tier1_percent > 100) {
      return res.status(400).json({ error: 'Invalid Tier 1 percentage (0-100)' });
    }
    if (typeof tier2_percent !== 'number' || tier2_percent < 0 || tier2_percent > 100) {
      return res.status(400).json({ error: 'Invalid Tier 2 percentage (0-100)' });
    }

    // Update settings
    await pool.query(
      `UPDATE affiliate_settings
       SET tier1_percent = $1, tier2_percent = $2, updated_at = NOW()
       WHERE id = 1`,
      [tier1_percent, tier2_percent]
    );

    // Update Tier 1 users
    const tier1Result = await pool.query(
      'UPDATE users SET commission_percent = $1 WHERE affiliate_tier = 1 OR affiliate_tier IS NULL',
      [tier1_percent]
    );

    // Update Tier 2 users
    const tier2Result = await pool.query(
      'UPDATE users SET commission_percent = $1 WHERE affiliate_tier = 2',
      [tier2_percent]
    );

    res.json({
      message: 'Tiers updated',
      tier1_percent,
      tier2_percent,
      tier1_updated: tier1Result.rowCount,
      tier2_updated: tier2Result.rowCount,
    });
  } catch (error) {
    console.error('Update tiers error:', error);
    res.status(500).json({ error: 'Failed to update tiers' });
  }
});

/**
 * PUT /api/affiliate/admin/user-tier/:userId
 * Change a user's affiliate tier — promotion / demotion of an individual.
 * Super admin only.
 */
router.put('/admin/user-tier/:userId', authenticate, requireAdmin, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    // Accept either `tier` (legacy 1|2) or `tier_id` (new — any id from affiliate_tiers)
    const rawTier = req.body.tier_id ?? req.body.tier;
    const tierId = Number(rawTier);

    if (!Number.isInteger(tierId) || tierId <= 0) {
      return res.status(400).json({ error: 'Invalid tier id' });
    }

    // Look up the tier from affiliate_tiers — supports N tiers, not just 1/2
    const tierResult = await pool.query(
      `SELECT id, name, commission_percent, is_active
         FROM affiliate_tiers WHERE id = $1`,
      [tierId]
    );
    if (tierResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tier not found' });
    }
    const tier = tierResult.rows[0];
    if (!tier.is_active) {
      return res.status(400).json({ error: 'Cannot assign user to an inactive tier' });
    }
    const newPercent = parseFloat(tier.commission_percent);

    // Update user's tier (FK to affiliate_tiers.id) and snapshot commission %
    const result = await pool.query(
      'UPDATE users SET affiliate_tier = $1, commission_percent = $2 WHERE id = $3 RETURNING email',
      [tierId, newPercent, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user_id: parseInt(userId),
      tier_id: tierId,
      tier_name: tier.name,
      commission_percent: newPercent,
      email: result.rows[0].email,
    });
  } catch (error) {
    console.error('Update user tier error:', error);
    res.status(500).json({ error: 'Failed to update user tier' });
  }
});

/**
 * GET /api/affiliate/admin/referrers
 * Get all referrers with their Wise email, Thai bank info, tier, and stats
 */
router.get('/admin/referrers', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Use subqueries to avoid cartesian product between referees and commissions
    const result = await pool.query(`
      SELECT
        u.id as user_id,
        u.email,
        u.refcode,
        u.wise_email,
        u.preferred_payout_method,
        u.affiliate_tier,
        u.commission_percent,
        uba.bank_name,
        uba.branch,
        uba.account_number,
        uba.account_holder,
        uba.phone as bank_phone,
        uba.tax_id,
        uba.tax_name,
        uba.tax_address,
        uba.entity_type,
        uba.title_prefix,
        uba.address_line,
        uba.subdistrict,
        uba.district,
        uba.province,
        uba.postal_code,
        uba.tax_branch,
        uba.id_card_url,
        uba.id_card_uploaded_at,
        (SELECT COUNT(*) FROM users ref WHERE ref.referrer_id = u.id) as total_referrals,
        COALESCE((SELECT SUM(amount) FROM affiliate_commissions WHERE referrer_id = u.id AND status = 'transferred'), 0) as total_transferred,
        COALESCE((SELECT SUM(amount) FROM affiliate_commissions WHERE referrer_id = u.id AND status = 'pending'), 0) as pending_amount
      FROM users u
      LEFT JOIN user_bank_accounts uba ON uba.user_id = u.id
      WHERE EXISTS (SELECT 1 FROM users r WHERE r.referrer_id = u.id)
      ORDER BY total_referrals DESC
    `);

    // Build signed URLs for ID card previews in bulk (1-hour TTL each).
    // Skip when no OBS bucket configured (local-dev path stores `/uploads/...`
    // relative URL which the FE can hit directly).
    const idCardSignedUrls: Record<number, string> = {};
    if (getBucketName()) {
      await Promise.all(result.rows.map(async (row) => {
        if (row.id_card_url && !row.id_card_url.startsWith('/uploads/')) {
          try { idCardSignedUrls[row.user_id] = await getSignedFileUrl(row.id_card_url, 3600, { inline: true }); }
          catch { /* ignore — leave undefined */ }
        }
      }));
    }

    res.json({
      referrers: result.rows.map(row => ({
        user_id: row.user_id,
        email: row.email,
        refcode: row.refcode,
        wise_email: row.wise_email || null,
        preferred_payout_method: row.preferred_payout_method || 'wise',
        affiliate_tier: row.affiliate_tier || 1,
        commission_percent: row.commission_percent || 10,
        thai_bank_info: row.bank_name ? {
          bank_name: row.bank_name,
          branch: row.branch,
          account_number: row.account_number,
          account_holder: row.account_holder,
          phone: row.bank_phone,
          tax_id: row.tax_id,
          tax_name: row.tax_name,
          tax_address: row.tax_address,
          entity_type: row.entity_type || 'individual',
          title_prefix: row.title_prefix,
          address_line: row.address_line,
          subdistrict: row.subdistrict,
          district: row.district,
          province: row.province,
          postal_code: row.postal_code,
          tax_branch: row.tax_branch,
          id_card_url: row.id_card_url,
          id_card_uploaded_at: row.id_card_uploaded_at,
          id_card_preview_path: row.id_card_url ? `/api/affiliate/id-card/${row.user_id}` : null,
          id_card_signed_url: idCardSignedUrls[row.user_id] || null,
        } : null,
        total_referrals: parseInt(row.total_referrals) || 0,
        total_transferred: parseFloat(row.total_transferred) || 0,
        pending_amount: parseFloat(row.pending_amount) || 0,
      }))
    });
  } catch (error) {
    console.error('Get referrers error:', error);
    res.status(500).json({ error: 'Failed to get referrers' });
  }
});

/**
 * GET /api/affiliate/admin/transfers
 * Get all commission transfers
 */
router.get('/admin/transfers', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string;

    let query = `
      SELECT
        ac.id, ac.amount, ac.status, ac.payment_reference, ac.admin_notes,
        ac.created_at, ac.transferred_at, ac.proof_url, ac.wht_cert_url,
        ac.payment_amount, ac.gxvg_tokens,
        ac.wht_rate, ac.wht_amount, ac.net_amount,
        r.email as referrer_email,
        ref.email as referee_email
      FROM affiliate_commissions ac
      JOIN users r ON r.id = ac.referrer_id
      JOIN users ref ON ref.id = ac.referee_id
    `;

    const params: any[] = [];
    if (status) {
      query += ' WHERE ac.status = $1';
      params.push(status);
    }

    query += ' ORDER BY ac.created_at DESC LIMIT 100';

    const result = await pool.query(query, params);

    // Return proxy URLs (same reason as user side — OBS signed URLs force
    // Content-Disposition: attachment which breaks iframe preview).
    const transfers = result.rows.map(row => {
      const proofProxyUrl = row.proof_url && row.proof_url.startsWith('affiliate-proofs/')
        ? `/api/affiliate/proofs/${row.proof_url}`
        : null;
      const whtCertProxyUrl = row.wht_cert_url && row.wht_cert_url.startsWith('affiliate-proofs/')
        ? `/api/affiliate/proofs/${row.wht_cert_url}`
        : null;
      return {
        id: row.id,
        referrer_email: row.referrer_email,
        referee_email: row.referee_email,
        amount: row.amount,
        status: row.status,
        payment_reference: row.payment_reference,
        admin_notes: row.admin_notes,
        created_at: row.created_at,
        transferred_at: row.transferred_at,
        proof_url: row.proof_url,
        proof_signed_url: proofProxyUrl,
        wht_cert_url: row.wht_cert_url || null,
        wht_cert_signed_url: whtCertProxyUrl,
        sale_amount: row.payment_amount ? parseFloat(row.payment_amount) : null,
        gxvg_tokens: row.gxvg_tokens || null,
        // WHT breakdown — null for legacy records (rows created before this column was added).
        wht_rate: row.wht_rate != null ? parseFloat(row.wht_rate) : null,
        wht_amount: row.wht_amount != null ? parseFloat(row.wht_amount) : null,
        net_amount: row.net_amount != null ? parseFloat(row.net_amount) : null,
      };
    });

    res.json({ transfers });
  } catch (error) {
    console.error('Get admin transfers error:', error);
    res.status(500).json({ error: 'Failed to get transfers' });
  }
});


/**
 * GET /api/affiliate/admin/pending
 * Get pending commissions grouped by referrer (with bank info for Thai users)
 */
router.get('/admin/pending', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // ?status= pending (default) | transferred. Transfers tab reuses this
    // grouped-by-referrer shape so the FE card is identical, just different
    // status. Whitelist to avoid SQL injection.
    const statusFilter = req.query.status === 'transferred' ? 'transferred' : 'pending';
    const isTransferred = statusFilter === 'transferred';
    // Pending = group ALL unpaid commissions per referrer (one payout to make).
    // Transferred = group per PAYOUT EVENT (referrer + transferred_at +
    // payment_reference) so each historical Mark-as-Paid shows separately —
    // NOT a lifetime aggregate per referrer.
    const payoutCols = isTransferred
      ? `, ac.transferred_at, ac.payment_reference, ac.admin_notes`
      : ``;
    const payoutGroupBy = isTransferred
      ? `, ac.transferred_at, ac.payment_reference, ac.admin_notes`
      : ``;
    // Get grouped data by referrer.
    //   pending_gross  = sum of commissions before WHT
    //   pending_wht    = sum of withheld amounts
    //   pending_net    = sum of what admin actually pays  (gross - wht)
    // Legacy rows (created before WHT columns existed) have wht_amount/net_amount=NULL,
    // so we COALESCE them: net = amount, wht = 0. The "ยอดที่ต้องจ่าย" totals stay
    // correct whether the rows are old or new.
    const result = await pool.query(`
      SELECT
        u.id as referrer_id,
        u.email as referrer_email,
        u.wise_email,
        u.preferred_payout_method,
        uba.bank_name,
        uba.branch,
        uba.account_number,
        uba.account_holder,
        uba.phone as bank_phone,
        uba.tax_id,
        uba.tax_name,
        uba.tax_address,
        uba.entity_type,
        uba.title_prefix,
        uba.address_line,
        uba.subdistrict,
        uba.district,
        uba.province,
        uba.postal_code,
        uba.tax_branch,
        uba.id_card_url,
        uba.id_card_uploaded_at,
        COUNT(ac.id) as pending_count,
        COALESCE(SUM(ac.amount), 0)                            as pending_gross,
        COALESCE(SUM(COALESCE(ac.wht_amount, 0)), 0)           as pending_wht,
        COALESCE(SUM(COALESCE(ac.net_amount, ac.amount)), 0)   as pending_net,
        ARRAY_AGG(ac.id) as commission_ids${payoutCols}
      FROM affiliate_commissions ac
      JOIN users u ON u.id = ac.referrer_id
      LEFT JOIN user_bank_accounts uba ON uba.user_id = u.id
      WHERE ac.status = $1
      GROUP BY u.id, u.email, u.wise_email, u.preferred_payout_method,
               uba.bank_name, uba.branch, uba.account_number, uba.account_holder,
               uba.phone, uba.tax_id, uba.tax_name, uba.tax_address, uba.entity_type,
               uba.title_prefix, uba.address_line, uba.subdistrict, uba.district,
               uba.province, uba.postal_code, uba.tax_branch,
               uba.id_card_url, uba.id_card_uploaded_at${payoutGroupBy}
      ORDER BY ${isTransferred ? 'MAX(ac.transferred_at) DESC' : 'pending_net DESC'}
    `, [statusFilter]);

    // Get individual commission details (with WHT breakdown)
    const detailsResult = await pool.query(`
      SELECT
        ac.id, ac.referrer_id, ac.amount, ac.payment_amount, ac.gxvg_tokens, ac.created_at,
        ac.wht_rate, ac.wht_amount, ac.net_amount,
        ac.transferred_at, ac.payment_reference,
        ref.email as referee_email
      FROM affiliate_commissions ac
      JOIN users ref ON ref.id = ac.referee_id
      WHERE ac.status = $1
      ORDER BY ac.created_at DESC
    `, [statusFilter]);

    // Group key: per-referrer for pending; per-payout-event for transferred
    // (same key the main query groups by).
    const groupKeyOf = (r: any) =>
      isTransferred
        ? `${r.referrer_id}|${r.transferred_at ? new Date(r.transferred_at).toISOString() : ''}|${r.payment_reference || ''}`
        : String(r.referrer_id);

    const detailsByGroup: Record<string, any[]> = {};
    for (const detail of detailsResult.rows) {
      const gk = groupKeyOf(detail);
      if (!detailsByGroup[gk]) {
        detailsByGroup[gk] = [];
      }
      detailsByGroup[gk].push({
        id: detail.id,
        referee_email: detail.referee_email,
        amount: parseFloat(detail.amount),
        sale_amount: detail.payment_amount ? parseFloat(detail.payment_amount) : null,
        gxvg_tokens: detail.gxvg_tokens || null,
        created_at: detail.created_at,
        wht_rate: detail.wht_rate != null ? parseFloat(detail.wht_rate) : null,
        wht_amount: detail.wht_amount != null ? parseFloat(detail.wht_amount) : null,
        net_amount: detail.net_amount != null ? parseFloat(detail.net_amount) : null,
      });
    }

    // Pre-compute signed URLs for ID cards in one batch (TTL 1h each).
    const pendingIdCardUrls: Record<number, string> = {};
    if (getBucketName()) {
      await Promise.all(result.rows.map(async (row) => {
        if (row.id_card_url && !row.id_card_url.startsWith('/uploads/')) {
          try { pendingIdCardUrls[row.referrer_id] = await getSignedFileUrl(row.id_card_url, 3600, { inline: true }); }
          catch { /* ignore */ }
        }
      }));
    }

    res.json({
      pending_payouts: result.rows.map(row => ({
        referrer_id: row.referrer_id,
        referrer_email: row.referrer_email,
        wise_email: row.wise_email || null,
        preferred_payout_method: row.preferred_payout_method || 'wise',
        thai_bank_info: row.bank_name ? {
          bank_name: row.bank_name,
          branch: row.branch,
          account_number: row.account_number,
          account_holder: row.account_holder,
          phone: row.bank_phone,
          tax_id: row.tax_id,
          tax_name: row.tax_name,
          tax_address: row.tax_address,
          entity_type: row.entity_type || 'individual',
          title_prefix: row.title_prefix,
          address_line: row.address_line,
          subdistrict: row.subdistrict,
          district: row.district,
          province: row.province,
          postal_code: row.postal_code,
          tax_branch: row.tax_branch,
          id_card_url: row.id_card_url,
          id_card_uploaded_at: row.id_card_uploaded_at,
          id_card_preview_path: row.id_card_url ? `/api/affiliate/id-card/${row.referrer_id}` : null,
          id_card_signed_url: pendingIdCardUrls[row.referrer_id] || null,
        } : null,
        pending_count: parseInt(row.pending_count) || 0,
        // pending_amount kept for backward compatibility (== gross sum).
        // FE should prefer pending_net (what we actually pay).
        pending_amount: parseFloat(row.pending_gross) || 0,
        pending_gross: parseFloat(row.pending_gross) || 0,
        pending_wht: parseFloat(row.pending_wht) || 0,
        pending_net: parseFloat(row.pending_net) || 0,
        commission_ids: row.commission_ids || [],
        details: detailsByGroup[groupKeyOf(row)] || [],
        // Payout-event meta (transferred mode only). Unique key per card so
        // a referrer with N past payouts shows N separate cards.
        group_key: groupKeyOf(row),
        transferred_at: isTransferred ? (row.transferred_at || null) : null,
        payment_reference: isTransferred ? (row.payment_reference || null) : null,
        admin_notes: isTransferred ? (row.admin_notes || null) : null,
      }))
    });
  } catch (error) {
    console.error('Get pending payouts error:', error);
    res.status(500).json({ error: 'Failed to get pending payouts' });
  }
});

/**
 * POST /api/affiliate/admin/upload-proof
 * Upload payment proof (image or PDF) to S3 or local storage
 */
router.post('/admin/upload-proof', authenticate, requireAdmin, proofUpload.single('proof'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `proof-${uniqueSuffix}${ext}`;
    let proofUrl: string;

    let signedUrl: string | null = null;

    if (getBucketName()) {
      // Upload to S3
      const key = `affiliate-proofs/${filename}`;
      // Note: contentDisposition='inline' is set on the object so any direct
      // OBS access honours it — but in practice we never expose signed OBS
      // URLs to browsers (HWC OBS overrides disposition to attachment on
      // signed GETs). Frontend uses /api/affiliate/proofs/{key} proxy below.
      await uploadFile(req.file.buffer, key, req.file.mimetype, { contentDisposition: 'inline' });
      proofUrl = key; // Store S3 key for database
      signedUrl = `/api/affiliate/proofs/${key}`; // Proxy URL — browser-friendly
    } else {
      // Save locally
      const uploadsDir = path.join(process.cwd(), 'uploads', 'affiliate-proofs');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, req.file.buffer);
      proofUrl = `/uploads/affiliate-proofs/${filename}`;
    }

    res.json({ url: proofUrl, signed_url: signedUrl, filename: req.file.originalname });
  } catch (error: any) {
    console.error('Upload proof error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

/**
 * POST /api/affiliate/upload-id-card
 *
 * Optional ID card upload — user submit สำเนาบัตรประชาชน เก็บไว้ที่ OBS
 * (private, admin ดูผ่าน signed URL). ใช้เป็นหลักฐาน identity verify ตอน
 * admin โอน commission.
 *
 * Storage strategy — **fixed key per user**:
 *   `identity/{user_id}/id-card`  (no extension; Content-Type ใน OBS metadata)
 * → upload ใหม่ทับ object เก่าโดยอัตโนมัติ (S3/OBS same-key overwrite semantics).
 * → ไม่สะสมไฟล์ขยะ, ไม่ต้องเรียก delete API.
 *
 * Idempotent: ทุก call จะทับไฟล์เดิม + update `id_card_uploaded_at`.
 *
 * Body (multipart): `file` (image/* or application/pdf, ≤ 5MB — proofUpload limits).
 */
router.post('/upload-id-card', authenticate, proofUpload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let idCardUrl: string;
    let signedUrl: string | null = null;

    if (getBucketName()) {
      // Fixed key per user — same-key overwrite. No extension so we can swap
      // image format (JPG → PNG → PDF) without leaving orphaned objects.
      const key = `identity/${userId}/id-card`;
      // contentDisposition: 'inline' is required for HWC OBS — it ignores
      // ResponseContentDisposition at signed-URL request time, so the only
      // way to get browsers to render the file is to bake the disposition
      // into the object metadata.
      await uploadFile(req.file.buffer, key, req.file.mimetype, { contentDisposition: 'inline' });
      idCardUrl = key;
      signedUrl = await getSignedFileUrl(key, 3600, { inline: true });
    } else {
      // Local fallback for dev without OBS — also fixed filename, overwrites.
      const uploadsDir = path.join(process.cwd(), 'uploads', 'identity', String(userId));
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const ext = path.extname(req.file.originalname).toLowerCase() || '.bin';
      // Always strip the user's old file before writing the new one (covers
      // ext changes; OBS branch above doesn't need this because same key wins).
      for (const f of fs.readdirSync(uploadsDir)) {
        if (f.startsWith('id-card')) fs.unlinkSync(path.join(uploadsDir, f));
      }
      const filename = `id-card${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
      idCardUrl = `/uploads/identity/${userId}/${filename}`;
    }

    // Persist on the user's bank account row. UPSERT because a user that has
    // never set bank info should still be able to upload (we just create the
    // skeleton row — empty bank fields are filled later via /bank-account).
    await pool.query(`
      INSERT INTO user_bank_accounts (
        user_id, bank_name, account_number, account_holder,
        id_card_url, id_card_uploaded_at, updated_at
      )
      VALUES ($1, '', '', '', $2, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        id_card_url         = EXCLUDED.id_card_url,
        id_card_uploaded_at = EXCLUDED.id_card_uploaded_at,
        updated_at          = NOW()
    `, [userId, idCardUrl]);

    res.json({
      success: true,
      url: idCardUrl,
      signed_url: signedUrl,
      uploaded_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Upload id-card error:', error);
    res.status(500).json({ error: error?.message || 'Upload failed' });
  }
});

/**
 * GET /api/affiliate/id-card/:userId
 *
 * Auth proxy for ID card preview. Streams the file from OBS with
 * `Content-Disposition: inline` so browsers render image/PDF in
 * `<iframe>`/`<img>` instead of triggering a download.
 *
 * Why a proxy: HWC OBS forces `attachment` disposition on objects whose key
 * lacks a recognised extension (we use the fixed `id-card` key with no
 * extension by design, to support format swaps JPG ↔ PNG ↔ PDF). Existing
 * `/proofs/*` and `/api/subscription/slips/*` use the same proxy pattern.
 *
 * Auth: the caller must be the file owner OR an admin. FE fetches with the
 * Authorization header, then turns the blob into a URL for `<iframe>`/`<img>`.
 */
router.get('/id-card/:userId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    // Only owner or admin can view
    if (req.userId !== targetUserId && !req.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const r = await pool.query<{ id_card_url: string | null }>(
      'SELECT id_card_url FROM user_bank_accounts WHERE user_id = $1',
      [targetUserId]
    );
    const key = r.rows[0]?.id_card_url;
    if (!key) return res.status(404).json({ error: 'No ID card uploaded' });

    // Local-dev fallback: file lives under /uploads/identity/{userId}/
    if (key.startsWith('/uploads/')) {
      const abs = path.join(process.cwd(), key.replace(/^\//, ''));
      if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
      res.setHeader('Content-Disposition', 'inline');
      return res.sendFile(abs);
    }

    // OBS path — stream with explicit headers we control end-to-end.
    const obs = await getFile(key);
    if (obs.ContentType) res.setHeader('Content-Type', obs.ContentType);
    if (obs.ContentLength != null) res.setHeader('Content-Length', String(obs.ContentLength));
    res.setHeader('Content-Disposition', 'inline');
    // Always fetch fresh — file may have been replaced (fixed-key overwrite).
    // Bandwidth cost is tiny (≤ 5 MB) vs. the headache of caching a stale
    // preview after user re-uploads.
    res.setHeader('Cache-Control', 'no-store');
    const stream = obs.Body as any;
    stream.pipe(res);
  } catch (err: any) {
    console.error('[id-card proxy] failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to stream' });
  }
});

/**
 * GET /api/affiliate/proofs/*
 * Proxy payment proof / WHT cert from OBS with `Content-Disposition: inline`
 * so browsers render PDFs/images directly in <iframe>/<img> (HWC OBS signed
 * URLs always serve with `attachment` disposition regardless of object
 * metadata or ResponseContentDisposition param — verified empirically).
 *
 * No auth: keys are unguessable timestamps, treated as bearer-of-link tokens.
 * Used by both admin (after upload) and user (Transfer History) sides.
 */
router.get('/proofs/*', async (req, res: Response) => {
  try {
    const key = (req.params as any)[0];
    const response = await getFile(key);

    if (response.ContentType) {
      res.setHeader('Content-Type', response.ContentType);
    }
    if (response.ContentLength != null) {
      res.setHeader('Content-Length', String(response.ContentLength));
    }
    // Inline so browser renders inline (matches the object's stored
    // disposition; OBS signed URLs ignore that metadata for GETs).
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const stream = response.Body as any;
    stream.pipe(res);
  } catch (error: any) {
    console.error('Proof proxy error:', error.message);
    res.status(404).json({ error: 'Not found' });
  }
});

/**
 * POST /api/affiliate/admin/mark-paid/:referrerId
 * Mark all pending commissions as paid (Wise manual payout)
 */
router.post('/admin/mark-paid/:referrerId', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { referrerId } = req.params;
    const { payment_reference, notes, proof_url, wht_cert_url } = req.body;

    // Get all pending commissions for this referrer
    const pendingResult = await pool.query(
      `SELECT id, amount FROM affiliate_commissions
       WHERE referrer_id = $1 AND status = 'pending'`,
      [referrerId]
    );

    if (pendingResult.rows.length === 0) {
      return res.status(400).json({ error: 'No pending commissions for this referrer' });
    }

    const totalAmount = pendingResult.rows.reduce((sum, c) => sum + parseFloat(c.amount), 0);
    const commissionIds = pendingResult.rows.map(c => c.id);

    // Mark all commissions as transferred — all metadata fields optional
    // (payment_reference + proof_url + wht_cert_url + admin_notes).
    await pool.query(`
      UPDATE affiliate_commissions
      SET status = 'transferred',
          payment_reference = $1,
          admin_notes = $2,
          proof_url = $3,
          wht_cert_url = $4,
          transferred_at = NOW()
      WHERE id = ANY($5)
    `, [payment_reference?.trim() || null, notes || null, proof_url || null, wht_cert_url || null, commissionIds]);

    console.log(`[Admin Mark Paid] Marked ${commissionIds.length} commissions as paid for referrer ${referrerId}, total: $${totalAmount}`);

    res.json({
      success: true,
      amount: totalAmount,
      commission_count: commissionIds.length,
    });
  } catch (error) {
    console.error('Admin mark-paid error:', error);
    res.status(500).json({ error: 'Failed to mark as paid' });
  }
});

export default router;
