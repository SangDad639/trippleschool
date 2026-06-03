/**
 * Commission resolution service.
 *
 * Owns the precedence chain for "what commission % should this referrer get
 * when user X buys plan Y". The chain is designed so it works against both
 * pre-migration data (only legacy columns populated) and post-migration data
 * (new tables + new columns populated).
 *
 *   1. user_package_commissions(referrerId, planId)
 *      → admin set this user a custom rate for this specific plan
 *
 *   2. subscription_plans(planId).commission_percent
 *      → admin set a default for this package (may still be NULL — falls through)
 *
 *   3. users(referrerId).commission_percent  (legacy snapshot)
 *      → preserved so Tier 2 users (currently 25%) don't regress
 *
 *   4. affiliate_tiers(users.affiliate_tier).commission_percent
 *      → new dynamic tier source, if seeded
 *
 *   5. affiliate_settings.tier1_percent or 20
 *      → last resort
 *
 * Every step is wrapped to tolerate missing tables / columns — so the same
 * function works whether or not the migration scripts have run yet.
 */

import pool from '../db.js';

export interface CommissionResolution {
  percent: number;          // 0-100
  source: 'matrix' | 'plan' | 'user_snapshot' | 'tier' | 'settings' | 'default';
  planId: number | null;
  planSlug: string | null;
}

const DEFAULT_PERCENT = 20;

/**
 * Resolve commission % to apply when `referrerId` earns a commission on a
 * purchase by `refereeUserId` of plan identified by `planSlug` (or planId).
 *
 * Pass at least one of planSlug or planId to enable per-plan resolution.
 * If neither is passed (legacy callers), only steps 3-5 are exercised.
 */
export async function resolveCommissionPercent(opts: {
  /** The affiliate who will be credited the commission. */
  referrerId: number;
  /** Optional — when known, enables matrix + per-plan lookup. */
  planSlug?: string | null;
  planId?: number | null;
}): Promise<CommissionResolution> {
  const { referrerId } = opts;
  let planId = opts.planId ?? null;
  let planSlug = opts.planSlug ?? null;

  // Resolve planId from slug if only slug is provided. Wrapped in try because
  // subscription_plans may not exist yet on un-migrated DBs.
  if (planId == null && planSlug) {
    try {
      const r = await pool.query<{ id: number }>(
        'SELECT id FROM subscription_plans WHERE slug = $1 LIMIT 1',
        [planSlug]
      );
      if (r.rows.length > 0) planId = r.rows[0].id;
    } catch { /* table missing — ignore */ }
  }
  if (planSlug == null && planId != null) {
    try {
      const r = await pool.query<{ slug: string }>(
        'SELECT slug FROM subscription_plans WHERE id = $1 LIMIT 1',
        [planId]
      );
      if (r.rows.length > 0) planSlug = r.rows[0].slug;
    } catch { /* ignore */ }
  }

  // 1) Matrix override (user × plan)
  if (planId != null) {
    try {
      const r = await pool.query<{ commission_percent: string }>(
        `SELECT commission_percent
           FROM user_package_commissions
          WHERE user_id = $1 AND plan_id = $2
          LIMIT 1`,
        [referrerId, planId]
      );
      if (r.rows[0]?.commission_percent != null) {
        return {
          percent: parseFloat(r.rows[0].commission_percent),
          source: 'matrix', planId, planSlug,
        };
      }
    } catch { /* table missing — pre-migration — ignore */ }
  }

  // 2) Per-plan default
  if (planId != null) {
    try {
      const r = await pool.query<{ commission_percent: string | null }>(
        `SELECT commission_percent FROM subscription_plans WHERE id = $1 LIMIT 1`,
        [planId]
      );
      const v = r.rows[0]?.commission_percent;
      if (v != null) {
        return {
          percent: parseFloat(v),
          source: 'plan', planId, planSlug,
        };
      }
    } catch { /* ignore */ }
  }

  // 3) Legacy snapshot on users.commission_percent (handles Tier 2 = 25% etc.)
  try {
    const r = await pool.query<{ commission_percent: string | null }>(
      'SELECT commission_percent FROM users WHERE id = $1 LIMIT 1',
      [referrerId]
    );
    const v = r.rows[0]?.commission_percent;
    if (v != null) {
      return {
        percent: parseFloat(v),
        source: 'user_snapshot', planId, planSlug,
      };
    }
  } catch { /* ignore */ }

  // 4) Tier (new dynamic source)
  try {
    const r = await pool.query<{ commission_percent: string | null }>(
      `SELECT t.commission_percent
         FROM users u
         LEFT JOIN affiliate_tiers t ON t.id = u.affiliate_tier
        WHERE u.id = $1
        LIMIT 1`,
      [referrerId]
    );
    const v = r.rows[0]?.commission_percent;
    if (v != null) {
      return {
        percent: parseFloat(v),
        source: 'tier', planId, planSlug,
      };
    }
  } catch { /* ignore */ }

  // 5) Settings fallback
  try {
    const r = await pool.query<{ tier1_percent: string | null }>(
      'SELECT tier1_percent FROM affiliate_settings WHERE id = 1'
    );
    const v = r.rows[0]?.tier1_percent;
    if (v != null) {
      return {
        percent: parseFloat(v),
        source: 'settings', planId, planSlug,
      };
    }
  } catch { /* ignore */ }

  return {
    percent: DEFAULT_PERCENT,
    source: 'default', planId, planSlug,
  };
}

/* ------------------------------------------------------------------ */
/*  User × Package matrix CRUD                                         */
/* ------------------------------------------------------------------ */

export interface UserPackageCommission {
  id: number;
  user_id: number;
  plan_id: number;
  commission_percent: number;
  created_at: string;
  updated_at: string;
}

export async function listUserOverrides(userId: number): Promise<UserPackageCommission[]> {
  const r = await pool.query(
    `SELECT id, user_id, plan_id, commission_percent::float AS commission_percent,
            created_at, updated_at
       FROM user_package_commissions
      WHERE user_id = $1
      ORDER BY plan_id ASC`,
    [userId]
  );
  return r.rows;
}

export async function upsertUserOverride(
  userId: number,
  planId: number,
  commissionPercent: number
): Promise<UserPackageCommission> {
  const r = await pool.query(
    `INSERT INTO user_package_commissions (user_id, plan_id, commission_percent)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, plan_id) DO UPDATE
       SET commission_percent = EXCLUDED.commission_percent,
           updated_at = NOW()
     RETURNING id, user_id, plan_id, commission_percent::float AS commission_percent,
               created_at, updated_at`,
    [userId, planId, commissionPercent]
  );
  return r.rows[0];
}

export async function deleteUserOverride(userId: number, planId: number): Promise<boolean> {
  const r = await pool.query(
    'DELETE FROM user_package_commissions WHERE user_id = $1 AND plan_id = $2',
    [userId, planId]
  );
  return (r.rowCount ?? 0) > 0;
}
