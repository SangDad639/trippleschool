/**
 * Auto-tier assignment on package purchase.
 *
 * When a user successfully buys a subscription_plan (via autoapprove or admin
 * extend), they should be auto-assigned to the package's linked tier — BUT
 * only if it's a *promotion* (their current tier has lower display_order).
 *
 * "promote only, never demote" — so a Tier 2 user buying a monthly package
 * (linked to Tier 1) does NOT get downgraded.
 *
 * Wrapped to tolerate missing tables / columns so the function does nothing
 * (and never throws) when called against a DB that hasn't been migrated.
 */

import pool from '../db.js';

export interface PromoteResult {
  changed: boolean;
  previousTierId: number | null;
  newTierId: number | null;
  reason: 'no_plan_tier' | 'no_change' | 'demote_blocked' | 'promoted' | 'unmigrated' | 'error';
}

/**
 * Maybe promote `userId`'s tier based on the tier_id attached to the plan
 * they just purchased. Idempotent + safe.
 *
 * Called by: subscription /v2/verify-and-approve, admin /users/:id/extend.
 */
export async function maybePromoteOnPurchase(opts: {
  userId: number;
  /** Either planSlug or planId must be provided. */
  planSlug?: string | null;
  planId?: number | null;
}): Promise<PromoteResult> {
  try {
    // 1. Look up the plan's tier_id + the linked tier's display_order
    let planRow: { id: number; tier_id: number | null } | null = null;
    if (opts.planId != null) {
      const r = await pool.query<{ id: number; tier_id: number | null }>(
        'SELECT id, tier_id FROM subscription_plans WHERE id = $1 LIMIT 1',
        [opts.planId]
      );
      planRow = r.rows[0] || null;
    } else if (opts.planSlug) {
      const r = await pool.query<{ id: number; tier_id: number | null }>(
        'SELECT id, tier_id FROM subscription_plans WHERE slug = $1 LIMIT 1',
        [opts.planSlug]
      );
      planRow = r.rows[0] || null;
    }
    if (!planRow || planRow.tier_id == null) {
      return { changed: false, previousTierId: null, newTierId: null, reason: 'no_plan_tier' };
    }
    const targetTierId = planRow.tier_id;

    // 2. Fetch user's current tier + the linked tier's display_order
    const userRes = await pool.query<{ affiliate_tier: number | null; current_order: number | null }>(
      `SELECT u.affiliate_tier,
              t.display_order AS current_order
         FROM users u
         LEFT JOIN affiliate_tiers t ON t.id = u.affiliate_tier
        WHERE u.id = $1
        LIMIT 1`,
      [opts.userId]
    );
    const userRow = userRes.rows[0];
    if (!userRow) {
      return { changed: false, previousTierId: null, newTierId: null, reason: 'error' };
    }

    // 3. Fetch the target tier's display_order + commission to compare + snapshot
    const targetRes = await pool.query<{ display_order: number; commission_percent: string }>(
      'SELECT display_order, commission_percent FROM affiliate_tiers WHERE id = $1 LIMIT 1',
      [targetTierId]
    );
    if (targetRes.rows.length === 0) {
      return { changed: false, previousTierId: userRow.affiliate_tier, newTierId: null, reason: 'error' };
    }
    const targetOrder = targetRes.rows[0].display_order;
    const targetCommission = parseFloat(targetRes.rows[0].commission_percent);

    // 4. Promote only — if user already has same/higher tier, do nothing
    const currentOrder = userRow.current_order;
    if (currentOrder != null && currentOrder >= targetOrder) {
      return {
        changed: false,
        previousTierId: userRow.affiliate_tier,
        newTierId: userRow.affiliate_tier,
        reason: userRow.affiliate_tier === targetTierId ? 'no_change' : 'demote_blocked',
      };
    }

    // 5. Apply promotion (set tier + refresh commission snapshot)
    await pool.query(
      'UPDATE users SET affiliate_tier = $1, commission_percent = $2 WHERE id = $3',
      [targetTierId, targetCommission, opts.userId]
    );

    console.log(
      `[TierAssign] user ${opts.userId} promoted: ` +
      `${userRow.affiliate_tier ?? 'none'} → tier ${targetTierId} (${targetCommission}%)`
    );

    return {
      changed: true,
      previousTierId: userRow.affiliate_tier,
      newTierId: targetTierId,
      reason: 'promoted',
    };
  } catch (err: any) {
    // Most likely cause: tables missing on un-migrated DB. Silently no-op so
    // legacy flows aren't blocked by this side-effect.
    if (err.code === '42P01' /* undefined_table */) {
      return { changed: false, previousTierId: null, newTierId: null, reason: 'unmigrated' };
    }
    console.error('[TierAssign] failed:', err.message || err);
    return { changed: false, previousTierId: null, newTierId: null, reason: 'error' };
  }
}
