import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';
import { OAuth2Client } from 'google-auth-library';
import pool from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';

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

      const { email, password, refcode } = req.body;

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

export default router;
