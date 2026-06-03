/**
 * Subscription plans service.
 *
 * Backs the dynamic `subscription_plans` table. Replaces the old PRICING object
 * in config/pricing.ts. Provides a tiny in-memory cache (60s TTL) so hot paths
 * (Thunder verify, admin extend, Stripe webhook) don't re-query on every call.
 *
 * VAT is computed at read time using config/pricing.ts:VAT_RATE so the rate
 * stays in one place if Thai law changes.
 */

import pool from '../db.js';
import { VAT_RATE } from '../config/pricing.js';

/**
 * Admin-only alternate price variant for a plan.
 *
 * Used to model variants that should not show on Landing (e.g. the yearly Promo
 * ฿2,800 admin variant) but can be selected during admin extend / slip approval.
 * Stored as JSONB array on subscription_plans.admin_alt_prices.
 */
export interface AdminAltPrice {
  label: string;        // e.g. 'Promo'
  label_th?: string;    // e.g. 'โปรโมชั่น'
  subtotal: number;     // before VAT
}

export interface SubscriptionPlanRow {
  id: number;
  slug: string;
  name: string;
  name_th: string | null;
  subtotal: number;
  days: number;
  commission_percent: number | null;
  is_active: boolean;
  display_order: number;
  description: string | null;
  features: string[];
  /** Admin-only alternate price variants. Empty array when none. */
  admin_alt_prices: AdminAltPrice[];
  /** When set, buying this plan auto-promotes user to this tier. NULL = no auto-tier. */
  tier_id: number | null;
  /**
   * When true, the plan is hidden from the public Landing / Subscription pages
   * but still visible in /admin → Packages. Admin uploads slips on behalf of
   * users to grant these "secret deal" plans. Defaults to false.
   */
  admin_only: boolean;
  created_at: string;
  updated_at: string;
}

/** A vat-computed alt price variant exposed via API. */
export interface AdminAltPriceWithVat extends AdminAltPrice {
  vat: number;
  total: number;
}

export interface SubscriptionPlanWithVat extends SubscriptionPlanRow {
  /** Computed: subtotal × VAT_RATE / 100 */
  vat: number;
  /** Computed: subtotal + vat (vat-inclusive total user pays) */
  total: number;
  /** Computed: total × 100 (Stripe / commission cents) */
  centsTotal: number;
  /** Same alt prices but with vat + total computed for each variant. */
  admin_alt_prices_computed: AdminAltPriceWithVat[];
}

/** Convert a raw row to the API shape (with computed vat/total). */
export function withVatBreakdown(row: SubscriptionPlanRow): SubscriptionPlanWithVat {
  const subtotal = Number(row.subtotal);
  const vat = +(subtotal * (VAT_RATE / 100)).toFixed(2);
  const total = +(subtotal + vat).toFixed(2);
  const altRaw = Array.isArray(row.admin_alt_prices) ? row.admin_alt_prices : [];
  const altComputed: AdminAltPriceWithVat[] = altRaw.map((a) => {
    const sub = Number(a.subtotal);
    const v = +(sub * (VAT_RATE / 100)).toFixed(2);
    return {
      label: a.label,
      label_th: a.label_th,
      subtotal: sub,
      vat: v,
      total: +(sub + v).toFixed(2),
    };
  });
  return {
    ...row,
    subtotal,
    commission_percent: row.commission_percent == null ? null : Number(row.commission_percent),
    admin_alt_prices: altRaw,
    tier_id: row.tier_id == null ? null : Number(row.tier_id),
    admin_only: !!row.admin_only,
    vat,
    total,
    centsTotal: Math.round(total * 100),
    admin_alt_prices_computed: altComputed,
  };
}

/* ------------------------------------------------------------------ */
/*  Cache (in-memory, 60 s TTL, single Node process)                  */
/* ------------------------------------------------------------------ */
const CACHE_TTL_MS = 60_000;
type Cache = { at: number; rows: SubscriptionPlanRow[] } | null;
let activeCache: Cache = null;

function invalidate() {
  activeCache = null;
}

/**
 * The full SELECT column list. Centralised here so adding a column is a single
 * edit (e.g. when admin_alt_prices / tier_id were added by the
 * add-package-commission-matrix migration).
 */
const PLAN_COLUMNS = `
  id, slug, name, name_th, subtotal, days, commission_percent,
  is_active, display_order, description, features,
  COALESCE(admin_alt_prices, '[]'::jsonb) AS admin_alt_prices,
  tier_id,
  COALESCE(admin_only, false) AS admin_only,
  created_at, updated_at
`;

async function fetchActiveRowsFromDb(): Promise<SubscriptionPlanRow[]> {
  const result = await pool.query<SubscriptionPlanRow>(`
    SELECT ${PLAN_COLUMNS}
    FROM subscription_plans
    WHERE is_active = true
    ORDER BY display_order ASC, id ASC
  `);
  return result.rows;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * List active plans (cached). Includes admin-only plans — callers that serve
 * public traffic (Landing, Subscription page) should filter with
 * `.filter(p => !p.admin_only)` or use `getPublicActivePlans()` directly.
 */
export async function getActivePlans(): Promise<SubscriptionPlanWithVat[]> {
  if (activeCache && Date.now() - activeCache.at < CACHE_TTL_MS) {
    return activeCache.rows.map(withVatBreakdown);
  }
  const rows = await fetchActiveRowsFromDb();
  activeCache = { at: Date.now(), rows };
  return rows.map(withVatBreakdown);
}

/**
 * List active plans visible to public users — strips out admin-only plans.
 * Used by Landing + Subscription page (/api/subscription/plans).
 */
export async function getPublicActivePlans(): Promise<SubscriptionPlanWithVat[]> {
  const all = await getActivePlans();
  return all.filter((p) => !p.admin_only);
}

/**
 * List ALL plans (active + inactive, public + admin-only) for the /admin
 * Packages tab. Bypasses cache because admin write-side cares about freshness.
 */
export async function getAllPlansForAdmin(): Promise<SubscriptionPlanWithVat[]> {
  const result = await pool.query<SubscriptionPlanRow>(
    `SELECT ${PLAN_COLUMNS}
       FROM subscription_plans
      ORDER BY display_order ASC, id ASC`
  );
  return result.rows.map(withVatBreakdown);
}

/** Fetch a single plan by slug — also looks at inactive plans (legacy data may
 *  still reference an old slug). Returns null if not found. */
export async function getPlanBySlug(slug: string): Promise<SubscriptionPlanWithVat | null> {
  // Try cache first (only contains active rows — most common case)
  if (activeCache && Date.now() - activeCache.at < CACHE_TTL_MS) {
    const hit = activeCache.rows.find((r) => r.slug === slug);
    if (hit) return withVatBreakdown(hit);
  }
  const result = await pool.query<SubscriptionPlanRow>(
    `SELECT ${PLAN_COLUMNS}
       FROM subscription_plans
      WHERE slug = $1
      LIMIT 1`,
    [slug]
  );
  if (result.rows.length === 0) return null;
  return withVatBreakdown(result.rows[0]);
}

/** Fetch a single plan by id. */
export async function getPlanById(id: number): Promise<SubscriptionPlanWithVat | null> {
  const result = await pool.query<SubscriptionPlanRow>(
    `SELECT ${PLAN_COLUMNS}
       FROM subscription_plans
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return withVatBreakdown(result.rows[0]);
}

/** Find a plan by number of days (closest match). Used by admin extend when
 *  the FE passes raw `days` instead of a plan id. Returns null if no plan
 *  exactly matches the days count. */
export async function getPlanByDays(days: number): Promise<SubscriptionPlanWithVat | null> {
  const plans = await getActivePlans();
  return plans.find((p) => p.days === days) ?? null;
}

/* ------------------------------------------------------------------ */
/*  Admin write ops                                                    */
/* ------------------------------------------------------------------ */

export interface CreatePlanInput {
  slug: string;
  name: string;
  name_th?: string | null;
  subtotal: number;
  days: number;
  commission_percent?: number | null;
  description?: string | null;
  features?: string[];
  display_order?: number;
  admin_alt_prices?: AdminAltPrice[];
  tier_id?: number | null;
  /** When true, plan is hidden from public Landing / Subscription page. */
  admin_only?: boolean;
}

export async function createPlan(input: CreatePlanInput): Promise<SubscriptionPlanWithVat> {
  // Normalise alt prices — keep only valid items (label + finite, positive subtotal)
  const cleanedAlts: AdminAltPrice[] = (input.admin_alt_prices ?? [])
    .filter((a) => a && typeof a.label === 'string' && a.label.trim() !== '' &&
                   Number.isFinite(Number(a.subtotal)) && Number(a.subtotal) > 0)
    .map((a) => ({
      label: a.label.trim(),
      label_th: a.label_th?.trim() || undefined,
      subtotal: Number(a.subtotal),
    }));

  const result = await pool.query<SubscriptionPlanRow>(
    `INSERT INTO subscription_plans
       (slug, name, name_th, subtotal, days, commission_percent,
        description, features, display_order, admin_alt_prices, tier_id, admin_only)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12)
     RETURNING ${PLAN_COLUMNS}`,
    [
      input.slug.trim().toLowerCase(),
      input.name,
      input.name_th ?? null,
      input.subtotal,
      input.days,
      input.commission_percent ?? null,
      input.description ?? null,
      JSON.stringify(input.features ?? []),
      input.display_order ?? 0,
      JSON.stringify(cleanedAlts),
      input.tier_id ?? null,
      input.admin_only ?? false,
    ]
  );
  invalidate();
  return withVatBreakdown(result.rows[0]);
}

export interface UpdatePlanInput {
  name?: string;
  name_th?: string | null;
  subtotal?: number;
  days?: number;
  commission_percent?: number | null;
  description?: string | null;
  features?: string[];
  display_order?: number;
  is_active?: boolean;
  admin_alt_prices?: AdminAltPrice[];
  tier_id?: number | null;
  admin_only?: boolean;
}

export async function updatePlan(id: number, input: UpdatePlanInput): Promise<SubscriptionPlanWithVat | null> {
  // Build dynamic SET only for provided fields — avoids accidentally nulling
  // columns the caller didn't intend to touch.
  const sets: string[] = ['updated_at = NOW()'];
  const params: any[] = [];
  let p = 1;
  if (input.name !== undefined)               { sets.push(`name = $${p++}`); params.push(input.name); }
  if (input.name_th !== undefined)            { sets.push(`name_th = $${p++}`); params.push(input.name_th); }
  if (input.subtotal !== undefined)           { sets.push(`subtotal = $${p++}`); params.push(input.subtotal); }
  if (input.days !== undefined)               { sets.push(`days = $${p++}`); params.push(input.days); }
  if (input.commission_percent !== undefined) { sets.push(`commission_percent = $${p++}`); params.push(input.commission_percent); }
  if (input.description !== undefined)        { sets.push(`description = $${p++}`); params.push(input.description); }
  if (input.features !== undefined)           { sets.push(`features = $${p++}::jsonb`); params.push(JSON.stringify(input.features)); }
  if (input.display_order !== undefined)      { sets.push(`display_order = $${p++}`); params.push(input.display_order); }
  if (input.is_active !== undefined)          { sets.push(`is_active = $${p++}`); params.push(input.is_active); }
  if (input.admin_alt_prices !== undefined)   {
    // Same normalisation as create
    const cleaned: AdminAltPrice[] = input.admin_alt_prices
      .filter((a) => a && typeof a.label === 'string' && a.label.trim() !== '' &&
                     Number.isFinite(Number(a.subtotal)) && Number(a.subtotal) > 0)
      .map((a) => ({
        label: a.label.trim(),
        label_th: a.label_th?.trim() || undefined,
        subtotal: Number(a.subtotal),
      }));
    sets.push(`admin_alt_prices = $${p++}::jsonb`);
    params.push(JSON.stringify(cleaned));
  }
  if (input.tier_id !== undefined)            { sets.push(`tier_id = $${p++}`); params.push(input.tier_id); }
  if (input.admin_only !== undefined)         { sets.push(`admin_only = $${p++}`); params.push(input.admin_only); }
  params.push(id);

  const result = await pool.query<SubscriptionPlanRow>(
    `UPDATE subscription_plans
        SET ${sets.join(', ')}
      WHERE id = $${p}
      RETURNING ${PLAN_COLUMNS}`,
    params
  );
  invalidate();
  if (result.rows.length === 0) return null;
  return withVatBreakdown(result.rows[0]);
}

/** Soft-delete (is_active=false). Returns the updated row or null if not found. */
export async function softDeletePlan(id: number): Promise<SubscriptionPlanWithVat | null> {
  return updatePlan(id, { is_active: false });
}

/* ------------------------------------------------------------------ */
/*  Price selection                                                    */
/* ------------------------------------------------------------------ */

/**
 * The actual price variant chosen for a purchase. Either the plan's default
 * subtotal or one of its admin_alt_prices (selected by label).
 */
export interface ResolvedPlanPrice {
  plan: SubscriptionPlanWithVat;
  /** Label of the chosen variant; null = default plan price */
  altLabel: string | null;
  subtotal: number;
  vat: number;
  total: number;
  centsTotal: number;
}

/**
 * Resolve the price variant for a plan given an optional admin alt-price label.
 *
 * - `altLabel = null/undefined` → returns the default plan subtotal/total.
 * - `altLabel = 'Promo'` → looks for that label in admin_alt_prices.
 *   Throws if not found (caller should validate before calling, but this
 *   safety net prevents the silent "fall back to default" footgun where the
 *   user thinks they're getting the promo price but pays full).
 */
export function resolvePlanPrice(
  plan: SubscriptionPlanWithVat,
  altLabel?: string | null
): ResolvedPlanPrice {
  if (!altLabel) {
    return {
      plan,
      altLabel: null,
      subtotal: plan.subtotal,
      vat: plan.vat,
      total: plan.total,
      centsTotal: plan.centsTotal,
    };
  }
  const variant = plan.admin_alt_prices_computed.find(
    (a) => a.label.toLowerCase() === altLabel.toLowerCase()
  );
  if (!variant) {
    throw new Error(
      `Plan '${plan.slug}' has no admin alt-price variant labelled '${altLabel}'`
    );
  }
  return {
    plan,
    altLabel: variant.label,
    subtotal: variant.subtotal,
    vat: variant.vat,
    total: variant.total,
    centsTotal: Math.round(variant.total * 100),
  };
}

/** Test-only / explicit cache reset (e.g. invoked from a sibling service). */
export function invalidatePlansCache() { invalidate(); }
