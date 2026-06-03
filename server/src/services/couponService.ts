/**
 * Coupon code service.
 *
 * Codes are pre-issued by admin and redeemed by users to extend their
 * subscription by a fixed number of days (no plan, no commission, no tier
 * change — per business decision).
 *
 * Two modes (controlled by `coupon_codes.max_uses`):
 *   - `1`    — legacy single-use (1 user globally)
 *   - `NULL` — unlimited multi-use (1 per user, no global cap)
 *   - `N>1`  — capped multi-use (up to N users, each user only once)
 *
 * Per-user uniqueness is ALWAYS enforced via `coupon_redemptions` table
 * UNIQUE(coupon_id, user_id) — independent of max_uses.
 *
 * Schema: migration 012_coupon_codes + 015_coupon_multi_use
 */

import pg from 'pg';
import crypto from 'crypto';
import pool from '../db.js';

// 32-char alphabet with no visually-confusable characters (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;
export const MAX_BULK_COUNT = 100;

/** Generate one random code. Always uppercase, never contains 0/O/1/I/L. */
export function generateCode(): string {
  const buf = crypto.randomBytes(CODE_LEN);
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

/** Normalise user-typed code: trim + uppercase + strip whitespace. */
export function normaliseCode(raw: string): string {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

export interface CreatedCoupon {
  id: number;
  code: string;
  days: number;
  created_at: string;
}

/**
 * Bulk-create N unique codes in a single transaction.
 *
 * `maxUses` controls the new redemption model:
 *   - 1      = single-use (legacy, default to preserve UX)
 *   - null   = unlimited multi-use
 *   - N (>1) = capped multi-use
 *
 * Generate exactly `remaining` distinct codes per attempt (dedupe in-batch
 * via Set). INSERT ... ON CONFLICT DO NOTHING handles the (extremely rare)
 * case where one of our random codes collides with an existing row — we
 * just retry the deficit.
 */
export async function bulkCreate(
  days: number,
  count: number,
  adminId: number,
  notes?: string | null,
  maxUses?: number | null,
): Promise<CreatedCoupon[]> {
  if (!Number.isInteger(days) || days <= 0 || days > 3650) {
    throw new Error('days must be 1..3650');
  }
  if (!Number.isInteger(count) || count <= 0 || count > MAX_BULK_COUNT) {
    throw new Error(`count must be 1..${MAX_BULK_COUNT}`);
  }
  // maxUses === undefined → default to 1 (legacy single-use); null = unlimited.
  const finalMaxUses = maxUses === undefined ? 1 : maxUses;
  if (finalMaxUses !== null && (!Number.isInteger(finalMaxUses) || finalMaxUses < 1)) {
    throw new Error('max_uses must be a positive integer or null');
  }

  const inserted: CreatedCoupon[] = [];
  for (let attempt = 0; attempt < 4 && inserted.length < count; attempt++) {
    const remaining = count - inserted.length;
    const fresh = new Set<string>();
    while (fresh.size < remaining) fresh.add(generateCode());
    const codes = Array.from(fresh);

    const r = await pool.query<{ id: number; code: string; days: number; created_at: string }>(
      `INSERT INTO coupon_codes (code, days, notes, created_by, max_uses)
       SELECT c, $1, $2, $3, $4 FROM UNNEST($5::varchar[]) AS c
       ON CONFLICT (code) DO NOTHING
       RETURNING id, code, days, created_at`,
      [days, notes ?? null, adminId, finalMaxUses, codes]
    );
    for (const row of r.rows) inserted.push(row);
  }

  if (inserted.length < count) {
    throw new Error(`Failed to generate ${count} unique codes after retries`);
  }
  return inserted;
}

export type RedeemError =
  | 'invalid'              // code not found
  | 'already_used_by_you'  // this user already redeemed this code
  | 'limit_reached'        // global max_uses cap reached
  | 'disabled';            // is_active = false

export interface RedeemSuccess {
  ok: true;
  couponId: number;
  days: number;
}
export interface RedeemFailure {
  ok: false;
  error: RedeemError;
}

/**
 * Atomic redeem. Caller MUST pass a transaction client (pg.PoolClient inside
 * BEGIN/COMMIT) so this step + subscription extend + audit log all commit
 * or rollback together.
 *
 * Per-user uniqueness comes from `coupon_redemptions` UNIQUE(coupon_id,
 * user_id) — even if the JS check races, the INSERT throws on duplicate.
 * Global cap is enforced by FOR UPDATE lock on the coupon row + COUNT(*).
 */
export async function redeem(
  client: pg.PoolClient | typeof pool,
  userId: number,
  code: string,
  ipAddr?: string
): Promise<RedeemSuccess | RedeemFailure> {
  const norm = normaliseCode(code);
  if (!norm || !/^[A-Z0-9]{4,20}$/.test(norm)) {
    return { ok: false, error: 'invalid' };
  }

  // 1. Lock the coupon row — serialises concurrent redeems on the same code.
  const couponRes = await client.query<{
    id: number;
    days: number;
    is_active: boolean;
    max_uses: number | null;
  }>(
    `SELECT id, days, is_active, max_uses
       FROM coupon_codes
      WHERE code = $1
      FOR UPDATE`,
    [norm]
  );
  if (couponRes.rowCount === 0) return { ok: false, error: 'invalid' };
  const coupon = couponRes.rows[0];
  if (!coupon.is_active) return { ok: false, error: 'disabled' };

  // 2. Already redeemed by this user?
  const dup = await client.query(
    `SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2`,
    [coupon.id, userId]
  );
  if (dup.rowCount && dup.rowCount > 0) {
    return { ok: false, error: 'already_used_by_you' };
  }

  // 3. Global cap check (skipped when max_uses=null = unlimited).
  if (coupon.max_uses != null) {
    const used = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1`,
      [coupon.id]
    );
    if ((used.rows[0]?.n ?? 0) >= coupon.max_uses) {
      return { ok: false, error: 'limit_reached' };
    }
  }

  // 4. Record redemption — UNIQUE(coupon_id, user_id) is the final safety
  // belt against any race the JS checks above missed.
  try {
    await client.query(
      `INSERT INTO coupon_redemptions (coupon_id, user_id, redeemed_ip)
       VALUES ($1, $2, $3)`,
      [coupon.id, userId, ipAddr ?? null]
    );
  } catch (err: any) {
    // 23505 = unique_violation — concurrent redeem won the race.
    if (err?.code === '23505') {
      return { ok: false, error: 'already_used_by_you' };
    }
    throw err;
  }

  // 5. Legacy compat: capture first redeemer on coupon_codes.redeemed_by
  // (admin UI still uses this column to display "first user" without
  // joining the pivot). Only set if still NULL — preserves true "first".
  await client.query(
    `UPDATE coupon_codes
        SET redeemed_by = $1, redeemed_at = NOW(), redeemed_ip = $2
      WHERE id = $3 AND redeemed_by IS NULL`,
    [userId, ipAddr ?? null, coupon.id]
  );

  return { ok: true, couponId: coupon.id, days: coupon.days };
}

/* ------------------------------------------------------------------ */
/*  Admin list / toggle                                                */
/* ------------------------------------------------------------------ */

export interface CouponListFilter {
  // 'redeemed' kept for back-compat with FE — now aliases 'exhausted'.
  status?: 'all' | 'active' | 'redeemed' | 'exhausted' | 'inactive';
  q?: string;
  limit?: number;
  offset?: number;
}

export interface CouponListRow extends CreatedCoupon {
  is_active: boolean;
  notes: string | null;
  max_uses: number | null;
  usage_count: number;
  redeemed_by: number | null;          // first redeemer (legacy display)
  redeemed_by_email: string | null;
  redeemed_at: string | null;
}

export async function listCoupons(opts: CouponListFilter): Promise<{
  rows: CouponListRow[];
  total: number;
}> {
  const status = opts.status ?? 'all';
  const q = (opts.q ?? '').trim();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  // Sub-query computing usage_count is reused by both COUNT and SELECT.
  // We could JOIN but a correlated sub-query keeps the row 1:1 with codes.
  const USAGE_SUB = `(SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = c.id)`;

  const where: string[] = [];
  const params: any[] = [];
  if (status === 'active') {
    // Active = enabled + still has room (or unlimited).
    where.push(`c.is_active = true AND (c.max_uses IS NULL OR ${USAGE_SUB} < c.max_uses)`);
  }
  if (status === 'redeemed' || status === 'exhausted') {
    // Exhausted = global cap reached.
    where.push(`c.max_uses IS NOT NULL AND ${USAGE_SUB} >= c.max_uses`);
  }
  if (status === 'inactive') where.push('c.is_active = false');
  if (q) {
    params.push(`%${q}%`);
    where.push(`(c.code ILIKE $${params.length} OR c.notes ILIKE $${params.length})`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countRes = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM coupon_codes c ${whereSql}`,
    params
  );
  const total = parseInt(countRes.rows[0].c, 10) || 0;

  params.push(limit, offset);
  const r = await pool.query<CouponListRow>(
    `SELECT c.id, c.code, c.days, c.is_active, c.notes, c.created_at,
            c.max_uses,
            ${USAGE_SUB}::int AS usage_count,
            c.redeemed_by, u.email AS redeemed_by_email, c.redeemed_at
       FROM coupon_codes c
       LEFT JOIN users u ON u.id = c.redeemed_by
       ${whereSql}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { rows: r.rows, total };
}

/**
 * Hard-delete a coupon row. Refuses if anyone has redeemed it — those
 * rows are audit records and should be deactivated instead.
 */
export async function deleteCoupon(
  id: number
): Promise<CreatedCoupon | null | 'already_redeemed'> {
  // Probe — check both legacy redeemed_by AND the pivot. Either being non-empty
  // means there's an audit trail to preserve.
  const probe = await pool.query<{ has_redemption: boolean }>(
    `SELECT EXISTS(
        SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1
      ) OR (SELECT redeemed_by IS NOT NULL FROM coupon_codes WHERE id = $1) AS has_redemption`,
    [id]
  );
  if (probe.rowCount === 0) return null;
  if (probe.rows[0].has_redemption) return 'already_redeemed';

  const r = await pool.query<CreatedCoupon>(
    `DELETE FROM coupon_codes WHERE id = $1
     RETURNING id, code, days, created_at`,
    [id]
  );
  return r.rows[0] ?? null;
}

export async function setCouponState(
  id: number,
  patch: { is_active?: boolean; notes?: string | null; max_uses?: number | null }
): Promise<CouponListRow | null> {
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.is_active !== undefined) { sets.push(`is_active = $${params.length + 1}`); params.push(patch.is_active); }
  if (patch.notes !== undefined)     { sets.push(`notes = $${params.length + 1}`);     params.push(patch.notes); }
  if (patch.max_uses !== undefined) {
    if (patch.max_uses !== null && (!Number.isInteger(patch.max_uses) || patch.max_uses < 1)) {
      throw new Error('max_uses must be a positive integer or null');
    }
    sets.push(`max_uses = $${params.length + 1}`);
    params.push(patch.max_uses);
  }
  if (sets.length === 0) return null;
  params.push(id);
  const r = await pool.query<CouponListRow>(
    `UPDATE coupon_codes SET ${sets.join(', ')}
      WHERE id = $${params.length}
      RETURNING id, code, days, is_active, notes, max_uses, created_at,
                (SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = coupon_codes.id)::int AS usage_count,
                redeemed_by,
                (SELECT email FROM users WHERE id = coupon_codes.redeemed_by) AS redeemed_by_email,
                redeemed_at`,
    params
  );
  return r.rows[0] ?? null;
}
