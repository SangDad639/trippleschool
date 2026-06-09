import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';
import { OAuth2Client } from 'google-auth-library';
import pool from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';
import * as couponService from '../services/couponService.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const router = express.Router();

// Generate unique refcode
function generateRefcode(): string {
  return crypto.randomUUID().slice(0, 8).toLowerCase();
}

// Register
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }),
    body('password').isLength({ min: 6 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, refcode, coupon_code } = req.body;

      // Check if user exists
      const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: 'User already exists' });
      }

      // Look up referrer by refcode
      let referrerId = null;
      if (refcode) {
        const referrerResult = await pool.query(
          'SELECT id FROM users WHERE refcode = $1',
          [refcode.toLowerCase()]
        );
        if (referrerResult.rows.length > 0) {
          referrerId = referrerResult.rows[0].id;
        }
      }

      // Get default credits from settings or use 100
      const settingsResult = await pool.query(
        'SELECT setting_value FROM system_settings WHERE setting_key = $1',
        ['default_credits']
      );
      const defaultCredits = settingsResult.rows.length > 0
        ? parseInt(settingsResult.rows[0].setting_value)
        : 100;

      // Get default commission rate for new users.
      // Preferred source: affiliate_tiers (the lowest display_order active tier).
      // Falls back to legacy affiliate_settings.tier1_percent if no tiers exist,
      // and finally to 20% as a last-resort default.
      const defaultTierRes = await pool.query(
        `SELECT commission_percent
           FROM affiliate_tiers
          WHERE is_active = true
          ORDER BY display_order ASC, id ASC
          LIMIT 1`
      );
      let commissionRate: number;
      if (defaultTierRes.rows[0]?.commission_percent != null) {
        commissionRate = parseFloat(defaultTierRes.rows[0].commission_percent);
      } else {
        const settingsRes = await pool.query(
          'SELECT tier1_percent FROM affiliate_settings WHERE id = 1'
        );
        commissionRate = parseFloat(settingsRes.rows[0]?.tier1_percent) || 20;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Generate unique refcode for new user
      const newRefcode = generateRefcode();

      // Create user (auto-approved). is_super_admin defaults to false.
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, credits, is_approved, refcode, referrer_id, commission_rate, commission_percent)
         VALUES ($1, $2, $3, true, $4, $5, $6, $6)
         RETURNING id, email, is_approved, refcode, COALESCE(is_super_admin, false) as is_super_admin`,
        [email, passwordHash, defaultCredits, newRefcode, referrerId, commissionRate]
      );

      const user = result.rows[0];

      // Optional coupon redemption — best-effort. If the code is invalid or
      // already used we report it via `coupon_error` but still let the user
      // through (so they can land on /profile and try again).
      let couponApplied: { days: number; expires_at: string } | null = null;
      let couponError: 'invalid' | 'already_used_by_you' | 'limit_reached' | 'disabled' | null = null;
      if (coupon_code) {
        try {
          const redeem = await couponService.redeem(pool, user.id, coupon_code, req.ip);
          if (redeem.ok) {
            // Extend brand-new user's subscription from NOW + days
            const newExpiry = new Date();
            newExpiry.setDate(newExpiry.getDate() + redeem.days);
            await pool.query(
              'UPDATE users SET subscription_expires_at = $1 WHERE id = $2',
              [newExpiry.toISOString(), user.id]
            );
            await pool.query(
              `INSERT INTO subscription_extension_logs
                 (user_id, admin_id, days_added, amount, approval_method, notes)
               VALUES ($1, NULL, $2, '0', 'coupon', $3)`,
              [user.id, redeem.days, `Coupon #${redeem.couponId} (register)`]
            );
            couponApplied = { days: redeem.days, expires_at: newExpiry.toISOString() };
          } else {
            couponError = redeem.error;
          }
        } catch (e) {
          // Shouldn't happen with proper input; treat as soft-fail to not block register
          console.error('[register] coupon redeem failed:', e);
          couponError = 'invalid';
        }
      }

      // Generate token immediately for auto-approved users
      const token = jwt.sign(
        { userId: user.id, email: user.email, isAdmin: false, isSuperAdmin: !!user.is_super_admin },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          credits: defaultCredits,
          isAdmin: false,
          isSuperAdmin: !!user.is_super_admin,
          isApproved: true,
          refcode: user.refcode,
        },
        coupon_applied: couponApplied,
        coupon_error: couponError,
      });
    } catch (error) {
      console.error('Register error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Login
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }),
    body('password').notEmpty(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      // Get user
      const result = await pool.query(
        `SELECT id, email, password_hash, credits, is_admin, join_date,
                is_approved, subscription_expires_at, refcode,
                COALESCE(is_super_admin, false) as is_super_admin
         FROM users WHERE email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = result.rows[0];

      // Google-only users have no password
      if (!user.password_hash) {
        return res.status(401).json({ error: 'This account uses Google login. Please sign in with Google.' });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Auto-approve user on login if not already approved
      if (!user.is_approved) {
        await pool.query('UPDATE users SET is_approved = true WHERE id = $1', [user.id]);
        user.is_approved = true;
      }

      // Generate token
      const token = jwt.sign(
        { userId: user.id, email: user.email, isAdmin: user.is_admin, isSuperAdmin: !!user.is_super_admin },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          credits: user.credits,
          isAdmin: user.is_admin,
          isSuperAdmin: !!user.is_super_admin,
          joinDate: user.join_date,
          isApproved: user.is_approved,
          subscriptionExpiresAt: user.subscription_expires_at,
          refcode: user.refcode,
          createdAt: user.join_date,
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Google OAuth Login
router.post('/google', async (req: Request, res: Response) => {
  try {
    const { credential, refcode } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google credential is required' });
    }

    // Verify Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'Invalid Google token' });
    }

    const { email, sub: googleId } = payload;

    // Check if user exists
    const existingUser = await pool.query(
      `SELECT id, email, credits, is_admin, join_date,
              is_approved, subscription_expires_at, refcode,
              COALESCE(is_super_admin, false) as is_super_admin
       FROM users WHERE email = $1`,
      [email]
    );

    let user;

    if (existingUser.rows.length > 0) {
      // Existing user - update google_id if not set and auto-approve
      user = existingUser.rows[0];
      await pool.query(
        'UPDATE users SET google_id = COALESCE(google_id, $1), is_approved = true WHERE id = $2',
        [googleId, user.id]
      );
      user.is_approved = true;
    } else {
      // New user - create account
      const settingsResult = await pool.query(
        'SELECT setting_value FROM system_settings WHERE setting_key = $1',
        ['default_credits']
      );
      const defaultCredits = settingsResult.rows.length > 0
        ? parseInt(settingsResult.rows[0].setting_value)
        : 100;

      // Default commission rate — see /register for the precedence rules.
      const defaultTierRes2 = await pool.query(
        `SELECT commission_percent
           FROM affiliate_tiers
          WHERE is_active = true
          ORDER BY display_order ASC, id ASC
          LIMIT 1`
      );
      let commissionRate: number;
      if (defaultTierRes2.rows[0]?.commission_percent != null) {
        commissionRate = parseFloat(defaultTierRes2.rows[0].commission_percent);
      } else {
        const settingsRes2 = await pool.query(
          'SELECT tier1_percent FROM affiliate_settings WHERE id = 1'
        );
        commissionRate = parseFloat(settingsRes2.rows[0]?.tier1_percent) || 20;
      }

      // Look up referrer by refcode
      let referrerId = null;
      if (refcode) {
        const referrerResult = await pool.query(
          'SELECT id FROM users WHERE refcode = $1',
          [refcode.toLowerCase()]
        );
        if (referrerResult.rows.length > 0) {
          referrerId = referrerResult.rows[0].id;
        }
      }

      const newRefcode = generateRefcode();

      const result = await pool.query(
        `INSERT INTO users (email, password_hash, google_id, credits, is_approved, refcode, referrer_id, commission_rate, commission_percent)
         VALUES ($1, NULL, $2, $3, true, $4, $5, $6, $6)
         RETURNING id, email, credits, is_admin, join_date, is_approved, subscription_expires_at, refcode,
                  COALESCE(is_super_admin, false) as is_super_admin`,
        [email, googleId, defaultCredits, newRefcode, referrerId, commissionRate]
      );
      user = result.rows[0];
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email, isAdmin: user.is_admin || false, isSuperAdmin: !!user.is_super_admin },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        credits: user.credits,
        isAdmin: user.is_admin || false,
        isSuperAdmin: !!user.is_super_admin,
        joinDate: user.join_date,
        isApproved: true,
        subscriptionExpiresAt: user.subscription_expires_at,
        refcode: user.refcode,
        createdAt: user.join_date,
      },
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

// Get current user
router.get('/me', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
    };

    const result = await pool.query(
      `SELECT id, email, credits, is_admin, join_date,
              is_approved, subscription_expires_at, openai_api_key, refcode,
              COALESCE(is_super_admin, false) as is_super_admin
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      credits: user.credits,
      isAdmin: user.is_admin,
      isSuperAdmin: !!user.is_super_admin,
      joinDate: user.join_date,
      isApproved: user.is_approved,
      subscriptionExpiresAt: user.subscription_expires_at,
      hasOpenAIKey: !!user.openai_api_key,
      refcode: user.refcode,
      createdAt: user.join_date,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Helper to mask API key
function maskApiKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length < 12) return '***';
  return key.substring(0, 7) + '...' + key.substring(key.length - 4);
}

// Get all user's API keys (masked)
router.get('/api-keys', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
    };

    const result = await pool.query(
      `SELECT openai_api_key, vidgo_api_key, kie_api_key, late_api_key,
              postforme_api_key, postforme_api_keys, openrouter_api_key,
              anthropic_api_key, elevenlabs_api_key,
              elevenlabs_voice_id_th, elevenlabs_voice_id_en,
              ai_provider, postforme_subscription_expiry
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    res.json({
      openai: {
        hasKey: !!user.openai_api_key,
        maskedKey: maskApiKey(user.openai_api_key)
      },
      vidgo: {
        hasKey: !!user.vidgo_api_key,
        maskedKey: maskApiKey(user.vidgo_api_key)
      },
      kie: {
        hasKey: !!user.kie_api_key,
        maskedKey: maskApiKey(user.kie_api_key)
      },
      late: {
        hasKey: !!user.late_api_key,
        maskedKey: maskApiKey(user.late_api_key)
      },
      postforme: {
        hasKey: !!user.postforme_api_key,
        maskedKey: maskApiKey(user.postforme_api_key)
      },
      postformeKeys: (user.postforme_api_keys || []).map((k: any) => ({
        name: k.name,
        maskedKey: maskApiKey(k.key),
        expiresAt: k.expiresAt || null,
      })),
      openrouter: {
        hasKey: !!user.openrouter_api_key,
        maskedKey: maskApiKey(user.openrouter_api_key)
      },
      anthropic: {
        hasKey: !!user.anthropic_api_key,
        maskedKey: maskApiKey(user.anthropic_api_key)
      },
      elevenlabs: {
        hasKey: !!user.elevenlabs_api_key,
        maskedKey: maskApiKey(user.elevenlabs_api_key)
      },
      elevenlabs_voice_id_th: user.elevenlabs_voice_id_th || '',
      elevenlabs_voice_id_en: user.elevenlabs_voice_id_en || '',
      ai_provider: user.ai_provider || 'openai',
      postformeSubscriptionExpiry: user.postforme_subscription_expiry || null
    });
  } catch (error) {
    console.error('Get API keys error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Get user's KIE credit balance (queries KIE with the user's own key).
// Used by the generate-confirm popup to show "ยอดคงเหลือ KIE".
router.get('/kie-credit', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };

    const result = await pool.query(
      'SELECT kie_api_key FROM users WHERE id = $1',
      [decoded.userId]
    );
    const kieKey = result.rows[0]?.kie_api_key;
    if (!kieKey) {
      return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า KIE API Key', hasKey: false });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let kieResp: globalThis.Response;
    try {
      kieResp = await fetch('https://api.kie.ai/api/v1/chat/credit', {
        headers: { Authorization: `Bearer ${kieKey}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!kieResp.ok) {
      return res.status(502).json({ error: `KIE error (HTTP ${kieResp.status})` });
    }

    const body = await kieResp.json().catch(() => null) as { code?: number; data?: number } | null;
    if (!body || body.code !== 200 || typeof body.data !== 'number') {
      return res.status(502).json({ error: 'ดึงยอด KIE ไม่สำเร็จ' });
    }

    res.json({ hasKey: true, credit: body.data });
  } catch (error) {
    console.error('Get KIE credit error:', error);
    res.status(500).json({ error: 'ดึงยอด KIE ไม่สำเร็จ' });
  }
});

// Save user's API keys (supports multiple)
router.post('/api-keys', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
    };

    const {
      openai_api_key, vidgo_api_key, kie_api_key, late_api_key,
      postforme_api_key, openrouter_api_key,
      anthropic_api_key, elevenlabs_api_key,
      elevenlabs_voice_id_th, elevenlabs_voice_id_en,
      ai_provider, postforme_subscription_expiry,
    } = req.body;

    // Validate OpenAI API key format
    if (openai_api_key && !openai_api_key.startsWith('sk-')) {
      return res.status(400).json({ error: 'Invalid OpenAI API key format (should start with sk-)' });
    }
    // Validate Anthropic API key format (skip if cleared/empty)
    if (anthropic_api_key && !anthropic_api_key.startsWith('sk-ant-')) {
      return res.status(400).json({ error: 'Invalid Anthropic API key format (should start with sk-ant-)' });
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (openai_api_key !== undefined) {
      updates.push(`openai_api_key = $${paramIndex++}`);
      values.push(openai_api_key || null);
    }

    if (vidgo_api_key !== undefined) {
      updates.push(`vidgo_api_key = $${paramIndex++}`);
      values.push(vidgo_api_key || null);
    }

    if (kie_api_key !== undefined) {
      updates.push(`kie_api_key = $${paramIndex++}`);
      values.push(kie_api_key || null);
    }

    if (late_api_key !== undefined) {
      updates.push(`late_api_key = $${paramIndex++}`);
      values.push(late_api_key || null);
    }

    if (postforme_api_key !== undefined) {
      updates.push(`postforme_api_key = $${paramIndex++}`);
      values.push(postforme_api_key || null);
    }

    if (openrouter_api_key !== undefined) {
      updates.push(`openrouter_api_key = $${paramIndex++}`);
      values.push(openrouter_api_key || null);
    }

    if (anthropic_api_key !== undefined) {
      updates.push(`anthropic_api_key = $${paramIndex++}`);
      values.push(anthropic_api_key || null);
    }

    if (elevenlabs_api_key !== undefined) {
      updates.push(`elevenlabs_api_key = $${paramIndex++}`);
      values.push(elevenlabs_api_key || null);
    }

    if (elevenlabs_voice_id_th !== undefined) {
      updates.push(`elevenlabs_voice_id_th = $${paramIndex++}`);
      values.push(elevenlabs_voice_id_th || null);
    }

    if (elevenlabs_voice_id_en !== undefined) {
      updates.push(`elevenlabs_voice_id_en = $${paramIndex++}`);
      values.push(elevenlabs_voice_id_en || null);
    }

    if (ai_provider !== undefined) {
      updates.push(`ai_provider = $${paramIndex++}`);
      values.push(ai_provider);
    }

    if (postforme_subscription_expiry !== undefined) {
      updates.push(`postforme_subscription_expiry = $${paramIndex++}`);
      values.push(postforme_subscription_expiry || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No API keys provided' });
    }

    values.push(decoded.userId);
    await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    res.json({ success: true, message: 'API keys saved successfully' });
  } catch (error) {
    console.error('Save API keys error:', error);
    res.status(500).json({ error: 'Failed to save API keys' });
  }
});

// Delete specific API key
router.delete('/api-keys/:keyType', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
    };

    const { keyType } = req.params;
    const columnMap: Record<string, string> = {
      openai: 'openai_api_key',
      vidgo: 'vidgo_api_key',
      kie: 'kie_api_key',
      late: 'late_api_key',
      postforme: 'postforme_api_key',
      openrouter: 'openrouter_api_key',
      anthropic: 'anthropic_api_key',
      elevenlabs: 'elevenlabs_api_key',
    };

    const column = columnMap[keyType];
    if (!column) {
      return res.status(400).json({ error: 'Invalid key type' });
    }

    await pool.query(
      `UPDATE users SET ${column} = NULL WHERE id = $1`,
      [decoded.userId]
    );

    res.json({ success: true, message: 'API key removed' });
  } catch (error) {
    console.error('Delete API key error:', error);
    res.status(500).json({ error: 'Failed to remove API key' });
  }
});

// Add a PostForMe API key (multiple keys support)
router.post('/api-keys/postforme', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    const { name, key, expiresAt } = req.body;

    if (!name || !key) return res.status(400).json({ error: 'Name and key are required' });

    const result = await pool.query('SELECT postforme_api_keys FROM users WHERE id = $1', [decoded.userId]);
    const existing: any[] = result.rows[0]?.postforme_api_keys || [];

    // Check duplicate name
    if (existing.some((k: any) => k.name === name)) {
      return res.status(400).json({ error: 'Key name already exists' });
    }

    existing.push({ name, key, expiresAt: expiresAt || null });

    await pool.query('UPDATE users SET postforme_api_keys = $1 WHERE id = $2', [JSON.stringify(existing), decoded.userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Add PostForMe key error:', error);
    res.status(500).json({ error: 'Failed to add key' });
  }
});

// Delete a PostForMe API key by name
router.delete('/api-keys/postforme/:name', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    const { name } = req.params;

    const result = await pool.query('SELECT postforme_api_keys FROM users WHERE id = $1', [decoded.userId]);
    const existing: any[] = result.rows[0]?.postforme_api_keys || [];

    const filtered = existing.filter((k: any) => k.name !== name);

    await pool.query('UPDATE users SET postforme_api_keys = $1 WHERE id = $2', [JSON.stringify(filtered), decoded.userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete PostForMe key error:', error);
    res.status(500).json({ error: 'Failed to delete key' });
  }
});

// Update PostForMe API key expiration date
router.patch('/api-keys/postforme/:name', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    const { name } = req.params;
    const { expiresAt } = req.body;

    const result = await pool.query('SELECT postforme_api_keys FROM users WHERE id = $1', [decoded.userId]);
    const existing: any[] = result.rows[0]?.postforme_api_keys || [];

    const updated = existing.map((k: any) => k.name === name ? { ...k, expiresAt: expiresAt || null } : k);

    await pool.query('UPDATE users SET postforme_api_keys = $1 WHERE id = $2', [JSON.stringify(updated), decoded.userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Update PostForMe key error:', error);
    res.status(500).json({ error: 'Failed to update key' });
  }
});

// Get PostForMe API keys (full keys for channel selection)
router.get('/api-keys/postforme', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };

    const result = await pool.query('SELECT postforme_api_keys FROM users WHERE id = $1', [decoded.userId]);
    const keys: any[] = result.rows[0]?.postforme_api_keys || [];

    res.json(keys.map((k: any) => ({ name: k.name, maskedKey: maskApiKey(k.key), expiresAt: k.expiresAt || null })));
  } catch (error) {
    console.error('Get PostForMe keys error:', error);
    res.status(500).json({ error: 'Failed to get keys' });
  }
});

// Legacy single key endpoints (keep for backwards compatibility)
router.get('/api-key', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
    };

    const result = await pool.query(
      'SELECT openai_api_key FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const apiKey = result.rows[0].openai_api_key;
    res.json({ hasKey: !!apiKey, maskedKey: maskApiKey(apiKey) });
  } catch (error) {
    console.error('Get API key error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.post('/api-key', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
    };

    const { openai_api_key } = req.body;

    if (openai_api_key && !openai_api_key.startsWith('sk-')) {
      return res.status(400).json({ error: 'Invalid OpenAI API key format' });
    }

    await pool.query(
      'UPDATE users SET openai_api_key = $1 WHERE id = $2',
      [openai_api_key || null, decoded.userId]
    );

    res.json({ success: true, message: 'API key saved successfully' });
  } catch (error) {
    console.error('Save API key error:', error);
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

router.delete('/api-key', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: number;
    };

    await pool.query(
      'UPDATE users SET openai_api_key = NULL WHERE id = $1',
      [decoded.userId]
    );

    res.json({ success: true, message: 'API key removed' });
  } catch (error) {
    console.error('Delete API key error:', error);
    res.status(500).json({ error: 'Failed to remove API key' });
  }
});

export default router;
