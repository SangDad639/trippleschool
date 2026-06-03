/**
 * Affiliate tiers service.
 *
 * Backs the `affiliate_tiers` table. Replaces the two columns
 * `affiliate_settings.tier1_percent / tier2_percent`. Supports N tiers — admin
 * can create Tier 3, 4, 5, … with arbitrary names and commission rates.
 *
 * users.affiliate_tier (INTEGER) now references affiliate_tiers.id (FK).
 * Existing values (1 and 2) match the seeded rows so no data migration needed.
 */

import pool from '../db.js';

export interface AffiliateTierRow {
  id: number;
  name: string;
  name_th: string | null;
  commission_percent: number;
  is_active: boolean;
  display_order: number;
  description: string | null;
  badge_color: string;
  created_at: string;
  updated_at: string;
}

function normalize(row: AffiliateTierRow): AffiliateTierRow {
  return { ...row, commission_percent: Number(row.commission_percent) };
}

/* ------------------------------------------------------------------ */
/*  Cache (60 s)                                                       */
/* ------------------------------------------------------------------ */
const CACHE_TTL_MS = 60_000;
let activeCache: { at: number; rows: AffiliateTierRow[] } | null = null;
function invalidate() { activeCache = null; }

async function fetchActiveFromDb(): Promise<AffiliateTierRow[]> {
  const r = await pool.query<AffiliateTierRow>(`
    SELECT id, name, name_th, commission_percent, is_active, display_order,
           description, badge_color, created_at, updated_at
    FROM affiliate_tiers
    WHERE is_active = true
    ORDER BY display_order ASC, id ASC
  `);
  return r.rows.map(normalize);
}

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getActiveTiers(): Promise<AffiliateTierRow[]> {
  if (activeCache && Date.now() - activeCache.at < CACHE_TTL_MS) return activeCache.rows;
  const rows = await fetchActiveFromDb();
  activeCache = { at: Date.now(), rows };
  return rows;
}

/** Return ALL tiers (including inactive) — used by the admin tab. */
export async function getAllTiers(): Promise<AffiliateTierRow[]> {
  const r = await pool.query<AffiliateTierRow>(`
    SELECT id, name, name_th, commission_percent, is_active, display_order,
           description, badge_color, created_at, updated_at
    FROM affiliate_tiers
    ORDER BY display_order ASC, id ASC
  `);
  return r.rows.map(normalize);
}

export async function getTierById(id: number): Promise<AffiliateTierRow | null> {
  const r = await pool.query<AffiliateTierRow>(
    `SELECT id, name, name_th, commission_percent, is_active, display_order,
            description, badge_color, created_at, updated_at
       FROM affiliate_tiers
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  return r.rows.length ? normalize(r.rows[0]) : null;
}

/** Return the active tier with the lowest display_order — used as the default
 *  tier for new users created via /register. Falls back to id=1 if no active
 *  tiers exist (shouldn't happen post-migration, but be defensive). */
export async function getDefaultTier(): Promise<AffiliateTierRow | null> {
  const tiers = await getActiveTiers();
  return tiers[0] ?? null;
}

/** Count users assigned to a tier — used by DELETE to reject if non-zero. */
export async function countUsersInTier(tierId: number): Promise<number> {
  const r = await pool.query<{ c: string }>(
    'SELECT COUNT(*)::text AS c FROM users WHERE affiliate_tier = $1',
    [tierId]
  );
  return parseInt(r.rows[0]?.c || '0', 10);
}

/* ------------------------------------------------------------------ */
/*  Writes (admin)                                                     */
/* ------------------------------------------------------------------ */

export interface CreateTierInput {
  name: string;
  name_th?: string | null;
  commission_percent: number;
  description?: string | null;
  display_order?: number;
  badge_color?: string;
}

export async function createTier(input: CreateTierInput): Promise<AffiliateTierRow> {
  const r = await pool.query<AffiliateTierRow>(
    `INSERT INTO affiliate_tiers
       (name, name_th, commission_percent, description, display_order, badge_color)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, name_th, commission_percent, is_active, display_order,
               description, badge_color, created_at, updated_at`,
    [
      input.name,
      input.name_th ?? null,
      input.commission_percent,
      input.description ?? null,
      input.display_order ?? 0,
      input.badge_color ?? 'gray',
    ]
  );
  invalidate();
  return normalize(r.rows[0]);
}

export interface UpdateTierInput {
  name?: string;
  name_th?: string | null;
  commission_percent?: number;
  description?: string | null;
  display_order?: number;
  badge_color?: string;
  is_active?: boolean;
}

export async function updateTier(id: number, input: UpdateTierInput): Promise<AffiliateTierRow | null> {
  const sets: string[] = ['updated_at = NOW()'];
  const params: any[] = [];
  let p = 1;
  if (input.name !== undefined)               { sets.push(`name = $${p++}`); params.push(input.name); }
  if (input.name_th !== undefined)            { sets.push(`name_th = $${p++}`); params.push(input.name_th); }
  if (input.commission_percent !== undefined) { sets.push(`commission_percent = $${p++}`); params.push(input.commission_percent); }
  if (input.description !== undefined)        { sets.push(`description = $${p++}`); params.push(input.description); }
  if (input.display_order !== undefined)      { sets.push(`display_order = $${p++}`); params.push(input.display_order); }
  if (input.badge_color !== undefined)        { sets.push(`badge_color = $${p++}`); params.push(input.badge_color); }
  if (input.is_active !== undefined)          { sets.push(`is_active = $${p++}`); params.push(input.is_active); }
  params.push(id);

  const r = await pool.query<AffiliateTierRow>(
    `UPDATE affiliate_tiers
        SET ${sets.join(', ')}
      WHERE id = $${p}
      RETURNING id, name, name_th, commission_percent, is_active, display_order,
                description, badge_color, created_at, updated_at`,
    params
  );
  invalidate();
  return r.rows.length ? normalize(r.rows[0]) : null;
}

/**
 * Hard delete a tier. Caller MUST first verify no users are assigned
 * (use countUsersInTier()). Returns true if deleted.
 */
export async function deleteTier(id: number): Promise<boolean> {
  const r = await pool.query('DELETE FROM affiliate_tiers WHERE id = $1', [id]);
  invalidate();
  return (r.rowCount ?? 0) > 0;
}

export function invalidateTiersCache() { invalidate(); }
