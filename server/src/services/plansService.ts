/**
 * Subscription plans service.
 *
 * Backs the dynamic `subscription_plans` table. Replaces the old PRICING object
 * in config/pricing.ts. Provides a tiny in-memory cache (60s TTL) so hot paths
 * (Thunder verify, admin extend, Stripe webhook) don't re-query on every call.
 *
 * VAT is computed at read time using config/pricing.ts:VAT_RATE so the rate
 * stays in one place if Thai law changes.
 *
 * ตั้งเวลาเปลี่ยนราคา (migration 064, docs/PLAN-SCHEDULED-PRICE-CHANGE.md):
 *   - `subscription_plans.subtotal` คือราคาจริงเสมอ — ตาราง
 *     `subscription_plan_price_schedules` เก็บ "ราคาใหม่ + เวลามีผล" แล้วถูก
 *     materialize ลงคอลัมน์นั้นตอนอ่านครั้งแรกหลังถึงเวลา (`applyDueSchedules`,
 *     1 statement atomic + FOR UPDATE SKIP LOCKED → ปลอดภัยหลาย replica ไม่พึ่ง cron)
 *   - ทุกจุดอ่านผ่าน `ensureCache()` ซึ่งเรียก applyDueSchedules ก่อนเสมอ และแคช
 *     หมดอายุที่ min(now+60s, effective_at ถัดไป) → ราคาสลับตรงเวลา ไม่ต้องรอ TTL
 *   - ไม่มีช่วงรับราคาเก่า (user เคาะ 8 ก.ย. 2026) — ราคาที่รับได้ = total ปัจจุบันเท่านั้น
 */

import pool from '../db.js';
import type { Pool, PoolClient } from 'pg';
import { VAT_RATE } from '../config/pricing.js';

type Queryable = Pool | PoolClient;

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

/** แถวดิบของตาราง subscription_plan_price_schedules (เวลาเป็น ISO string เสมอ) */
export interface PlanPriceScheduleRow {
  id: number;
  plan_id: number;
  subtotal: number;
  effective_at: string;
  note: string | null;
  previous_subtotal: number | null;
  applied_at: string | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
  created_by: number | null;
  created_at: string;
}

/** schedule ถัดไปที่รอมีผลของแพ็กเกจ (แนบให้แอดมินเท่านั้น) */
export interface PendingSchedule {
  id: number;
  subtotal: number;
  vat: number;
  total: number;
  effective_at: string;
  note: string | null;
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
  /** เวลาที่ schedule ล่าสุดถูก apply (ราคาปัจจุบันเริ่มมีผล) — null = ไม่เคยตั้งเวลา */
  price_effective_at: string | null;
  /** schedule ถัดไปที่รอมีผล — แอดมินเท่านั้น (ถูกถอดใน toPublicPlan) */
  pending_schedule: PendingSchedule | null;
}

/** รูปที่ส่งออก endpoint สาธารณะ — ไม่มีราคาอนาคต และไม่มีราคาพิเศษของแอดมิน */
export type PublicSubscriptionPlan = Omit<
  SubscriptionPlanWithVat,
  'admin_alt_prices' | 'admin_alt_prices_computed' | 'pending_schedule' | 'price_effective_at'
>;

/** ข้อผิดพลาดเชิงกติกาจาก service — route แปลงเป็น HTTP status + errorCode ตรงๆ */
export class PlansServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PlansServiceError';
  }
}

const vatOf = (subtotal: number) => +(subtotal * (VAT_RATE / 100)).toFixed(2);
const totalOf = (subtotal: number) => +(subtotal + vatOf(subtotal)).toFixed(2);

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeSchedule(r: any): PlanPriceScheduleRow {
  return {
    id: Number(r.id),
    plan_id: Number(r.plan_id),
    subtotal: Number(r.subtotal),
    effective_at: toIso(r.effective_at)!,
    note: r.note ?? null,
    previous_subtotal: r.previous_subtotal == null ? null : Number(r.previous_subtotal),
    applied_at: toIso(r.applied_at),
    cancelled_at: toIso(r.cancelled_at),
    cancelled_by: r.cancelled_by == null ? null : Number(r.cancelled_by),
    created_by: r.created_by == null ? null : Number(r.created_by),
    created_at: toIso(r.created_at)!,
  };
}

/**
 * Convert a raw row to the API shape (with computed vat/total).
 * `schedules` = แถว schedule ของทุกแพ็กเกจ (กรองด้วย plan_id ข้างใน) — ไม่ส่ง = ไม่แนบข้อมูลเวลา
 */
export function withVatBreakdown(
  row: SubscriptionPlanRow,
  schedules: PlanPriceScheduleRow[] = [],
  now: number = Date.now(),
): SubscriptionPlanWithVat {
  const subtotal = Number(row.subtotal);
  const vat = vatOf(subtotal);
  const total = +(subtotal + vat).toFixed(2);
  const altRaw = Array.isArray(row.admin_alt_prices) ? row.admin_alt_prices : [];
  const altComputed: AdminAltPriceWithVat[] = altRaw.map((a) => {
    const sub = Number(a.subtotal);
    const v = vatOf(sub);
    return {
      label: a.label,
      label_th: a.label_th,
      subtotal: sub,
      vat: v,
      total: +(sub + v).toFixed(2),
    };
  });

  const mine = schedules.filter((s) => s.plan_id === Number(row.id) && !s.cancelled_at);
  const applied = mine
    .filter((s) => s.applied_at)
    .sort((a, b) => new Date(b.effective_at).getTime() - new Date(a.effective_at).getTime() || b.id - a.id)[0];
  const pending = mine
    .filter((s) => !s.applied_at && new Date(s.effective_at).getTime() > now)
    .sort((a, b) => new Date(a.effective_at).getTime() - new Date(b.effective_at).getTime() || a.id - b.id)[0];

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
    price_effective_at: applied ? applied.effective_at : null,
    pending_schedule: pending
      ? {
          id: pending.id,
          subtotal: pending.subtotal,
          vat: vatOf(pending.subtotal),
          total: totalOf(pending.subtotal),
          effective_at: pending.effective_at,
          note: pending.note,
        }
      : null,
  };
}

/** ถอดข้อมูลที่ห้ามออกสาธารณะ: ราคาพิเศษแอดมิน + schedule ที่รอ (ไม่ประกาศราคาล่วงหน้า) */
export function toPublicPlan(plan: SubscriptionPlanWithVat): PublicSubscriptionPlan {
  const {
    admin_alt_prices: _a,
    admin_alt_prices_computed: _b,
    pending_schedule: _c,
    price_effective_at: _d,
    ...pub
  } = plan;
  return pub;
}

/* ------------------------------------------------------------------ */
/*  Cache (in-memory, 60 s TTL, single Node process)                  */
/* ------------------------------------------------------------------ */
export const CACHE_TTL_MS = 60_000;

/**
 * เวลาล่วงหน้าขั้นต่ำที่อนุญาตให้ตั้ง schedule — ต้อง ≥ TTL ของแคช เพราะ replica อื่น
 * ที่แคชไว้ก่อน schedule ถูกสร้าง จะรู้จักมันก็ต่อเมื่อแคชหมดอายุ (≤ 60 วิ) แล้วโหลดใหม่
 * ทดสอบ override ด้วย env PRICE_SCHEDULE_MIN_LEAD_MS
 */
export const PRICE_SCHEDULE_MIN_LEAD_MS =
  Number(process.env.PRICE_SCHEDULE_MIN_LEAD_MS) > 0
    ? Number(process.env.PRICE_SCHEDULE_MIN_LEAD_MS)
    : CACHE_TTL_MS + 5_000;

type Cache = {
  at: number;
  expiresAt: number;
  rows: SubscriptionPlanRow[];
  schedules: PlanPriceScheduleRow[];
};
let activeCache: Cache | null = null;
let loadingCache: Promise<Cache> | null = null;

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

const SCHEDULE_COLUMNS = `
  id, plan_id, subtotal, effective_at, note, previous_subtotal,
  applied_at, cancelled_at, cancelled_by, created_by, created_at
`;

async function fetchActiveRowsFromDb(db: Queryable = pool): Promise<SubscriptionPlanRow[]> {
  const result = await db.query<SubscriptionPlanRow>(`
    SELECT ${PLAN_COLUMNS}
    FROM subscription_plans
    WHERE is_active = true
    ORDER BY display_order ASC, id ASC
  `);
  return result.rows;
}

/** schedule ทุกแพ็กเกจที่ยังไม่ยกเลิก (ตารางเล็กมาก — โหลดทั้งหมดใน 1 query) */
async function fetchLiveSchedules(db: Queryable = pool): Promise<PlanPriceScheduleRow[]> {
  const result = await db.query(`
    SELECT ${SCHEDULE_COLUMNS}
      FROM subscription_plan_price_schedules
     WHERE cancelled_at IS NULL
     ORDER BY effective_at DESC, id DESC
  `);
  return result.rows.map(normalizeSchedule);
}

/**
 * แคชหมดอายุที่ min(now + TTL, effective_at ถัดไปที่ยังไม่ apply)
 * ถ้ามี schedule ที่ถึงเวลาแล้วแต่ยังไม่ apply (replica อื่นกำลัง claim อยู่ → เรา SKIP LOCKED)
 * ให้หมดอายุเร็วมาก จะได้โหลดราคาใหม่ทันทีที่อีกฝั่ง commit
 */
function computeExpiry(now: number, schedules: PlanPriceScheduleRow[]): number {
  let exp = now + CACHE_TTL_MS;
  for (const s of schedules) {
    if (s.applied_at || s.cancelled_at) continue;
    const t = new Date(s.effective_at).getTime();
    if (t <= now) return now + 2_000;
    if (t < exp) exp = t;
  }
  return exp;
}

async function loadCache(): Promise<Cache> {
  if (loadingCache) return loadingCache;
  loadingCache = (async () => {
    try {
      await applyDueSchedules();
      const [rows, schedules] = await Promise.all([fetchActiveRowsFromDb(), fetchLiveSchedules()]);
      const now = Date.now();
      const c: Cache = { at: now, expiresAt: computeExpiry(now, schedules), rows, schedules };
      activeCache = c;
      return c;
    } finally {
      loadingCache = null;
    }
  })();
  return loadingCache;
}

async function ensureCache(): Promise<Cache> {
  if (activeCache && Date.now() < activeCache.expiresAt) return activeCache;
  return loadCache();
}

/* ------------------------------------------------------------------ */
/*  Scheduled price change — materialize                               */
/* ------------------------------------------------------------------ */

/**
 * เขียน schedule ที่ถึงเวลาแล้วลง subscription_plans.subtotal (1 statement, atomic):
 *   locked → แถวที่ครบกำหนด (FOR UPDATE SKIP LOCKED: replica ที่ชนะเท่านั้นที่ทำต่อ)
 *   cand   → จัดลำดับต่อ plan (ล่าสุด = rn 1; ที่เก่ากว่าและยังไม่เคย apply = superseded)
 *   due    → mark applied_at + snapshot previous_subtotal (ค่าก่อนเขียน) + note [superseded]
 *   upd    → เขียนราคาของ rn 1 ลงคอลัมน์
 * คืนจำนวนแถวที่ claim ได้ — > 0 = ราคาเปลี่ยน → ล้างแคช
 */
export async function applyDueSchedules(planId?: number | null, db: Queryable = pool): Promise<number> {
  const result = await db.query<{ claimed: number; updated: { id: number; slug: string; subtotal: number }[] }>(
    `
    WITH locked AS (
      SELECT id
        FROM subscription_plan_price_schedules
       WHERE applied_at IS NULL
         AND cancelled_at IS NULL
         AND effective_at <= NOW()
         AND ($1::int IS NULL OR plan_id = $1::int)
       FOR UPDATE SKIP LOCKED
    ),
    cand AS (
      SELECT sc.id, sc.plan_id, sc.subtotal,
             ROW_NUMBER() OVER (PARTITION BY sc.plan_id ORDER BY sc.effective_at DESC, sc.id DESC) AS rn
        FROM subscription_plan_price_schedules sc
        JOIN locked l ON l.id = sc.id
    ),
    due AS (
      UPDATE subscription_plan_price_schedules sc
         SET applied_at = NOW(),
             previous_subtotal = p.subtotal,
             note = CASE WHEN c.rn > 1 THEN CONCAT_WS(' ', sc.note, '[superseded]') ELSE sc.note END
        FROM cand c
        JOIN subscription_plans p ON p.id = c.plan_id
       WHERE sc.id = c.id
      RETURNING sc.id, sc.plan_id, sc.subtotal, c.rn
    ),
    upd AS (
      UPDATE subscription_plans p
         SET subtotal = d.subtotal, updated_at = NOW()
        FROM due d
       WHERE p.id = d.plan_id AND d.rn = 1
      RETURNING p.id, p.slug, p.subtotal
    )
    SELECT (SELECT COUNT(*)::int FROM due) AS claimed,
           COALESCE((SELECT json_agg(json_build_object('id', u.id, 'slug', u.slug, 'subtotal', u.subtotal)) FROM upd u), '[]'::json) AS updated
    `,
    [planId ?? null],
  );
  const claimed = Number(result.rows[0]?.claimed ?? 0);
  if (claimed > 0) {
    for (const u of result.rows[0].updated ?? []) {
      console.log(`[Packages][AUDIT] scheduled price applied plan=${u.slug} (#${u.id}) subtotal=${u.subtotal}`);
    }
    invalidate();
  }
  return claimed;
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
  const c = await ensureCache();
  const now = Date.now();
  return c.rows.map((r) => withVatBreakdown(r, c.schedules, now));
}

/**
 * List active plans visible to public users — strips out admin-only plans and
 * admin-only fields (alt prices, pending schedule). Used by Landing +
 * Subscription page (/api/subscription/plans) and the agent chat context.
 */
export async function getPublicActivePlans(): Promise<PublicSubscriptionPlan[]> {
  const all = await getActivePlans();
  return all.filter((p) => !p.admin_only).map(toPublicPlan);
}

/**
 * List ALL plans (active + inactive, public + admin-only) for the /admin
 * Packages tab. Bypasses cache because admin write-side cares about freshness
 * (but still materializes due schedules first so the column is current).
 */
export async function getAllPlansForAdmin(): Promise<SubscriptionPlanWithVat[]> {
  await applyDueSchedules();
  const [result, schedules] = await Promise.all([
    pool.query<SubscriptionPlanRow>(
      `SELECT ${PLAN_COLUMNS}
         FROM subscription_plans
        ORDER BY display_order ASC, id ASC`
    ),
    fetchLiveSchedules(),
  ]);
  const now = Date.now();
  return result.rows.map((r) => withVatBreakdown(r, schedules, now));
}

/** Fetch a single plan by slug — also looks at inactive plans (legacy data may
 *  still reference an old slug). Returns null if not found. */
export async function getPlanBySlug(slug: string): Promise<SubscriptionPlanWithVat | null> {
  // Cache first (contains active rows — the common case). ensureCache() has
  // already materialized any due schedule, so the row's subtotal is current.
  const c = await ensureCache();
  const now = Date.now();
  const hit = c.rows.find((r) => r.slug === slug);
  if (hit) return withVatBreakdown(hit, c.schedules, now);
  const result = await pool.query<SubscriptionPlanRow>(
    `SELECT ${PLAN_COLUMNS}
       FROM subscription_plans
      WHERE slug = $1
      LIMIT 1`,
    [slug]
  );
  if (result.rows.length === 0) return null;
  return withVatBreakdown(result.rows[0], c.schedules, now);
}

/** Fetch a single plan by id. */
export async function getPlanById(id: number): Promise<SubscriptionPlanWithVat | null> {
  const c = await ensureCache();
  const now = Date.now();
  const hit = c.rows.find((r) => Number(r.id) === id);
  if (hit) return withVatBreakdown(hit, c.schedules, now);
  const result = await pool.query<SubscriptionPlanRow>(
    `SELECT ${PLAN_COLUMNS}
       FROM subscription_plans
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return withVatBreakdown(result.rows[0], c.schedules, now);
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

function cleanAltPrices(list: AdminAltPrice[] | undefined): AdminAltPrice[] {
  return (list ?? [])
    .filter((a) => a && typeof a.label === 'string' && a.label.trim() !== '' &&
                   Number.isFinite(Number(a.subtotal)) && Number(a.subtotal) > 0)
    .map((a) => ({
      label: a.label.trim(),
      label_th: a.label_th?.trim() || undefined,
      subtotal: Number(a.subtotal),
    }));
}

export async function createPlan(input: CreatePlanInput): Promise<SubscriptionPlanWithVat> {
  // Normalise alt prices — keep only valid items (label + finite, positive subtotal)
  const cleanedAlts = cleanAltPrices(input.admin_alt_prices);

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

export interface UpdatePlanOptions {
  /**
   * Optimistic check: ราคาที่ผู้เรียกเห็นตอนเปิดฟอร์ม — ถ้าไม่ตรงคอลัมน์ปัจจุบัน
   * (เช่น schedule มีผลไประหว่างเปิด dialog ค้าง) → PlansServiceError PRICE_CHANGED (409)
   */
  expectedSubtotal?: number;
}

export async function updatePlan(
  id: number,
  input: UpdatePlanInput,
  opts: UpdatePlanOptions = {},
): Promise<SubscriptionPlanWithVat | null> {
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
    sets.push(`admin_alt_prices = $${p++}::jsonb`);
    params.push(JSON.stringify(cleanAltPrices(input.admin_alt_prices)));
  }
  if (input.tier_id !== undefined)            { sets.push(`tier_id = $${p++}`); params.push(input.tier_id); }
  if (input.admin_only !== undefined)         { sets.push(`admin_only = $${p++}`); params.push(input.admin_only); }
  params.push(id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // schedule ที่ถึงเวลาแล้วต้องลงคอลัมน์ก่อน — ไม่งั้นการแก้ของแอดมินรอบนี้จะถูกมันเขียนทับทีหลัง
    await applyDueSchedules(id, client);
    if (opts.expectedSubtotal !== undefined) {
      const cur = await client.query<{ subtotal: number }>(
        `SELECT subtotal FROM subscription_plans WHERE id = $1 FOR UPDATE`, [id]
      );
      if (cur.rows.length === 0) { await client.query('ROLLBACK'); return null; }
      const current = Number(cur.rows[0].subtotal);
      if (Math.abs(current - Number(opts.expectedSubtotal)) > 0.001) {
        await client.query('ROLLBACK');
        throw new PlansServiceError(
          'PRICE_CHANGED', 409,
          `ราคาของแพ็กเกจนี้เปลี่ยนไปแล้ว (ตอนนี้ ฿${current}) กรุณาโหลดใหม่ก่อนบันทึก`,
          { current_subtotal: current },
        );
      }
    }
    const result = await client.query<SubscriptionPlanRow>(
      `UPDATE subscription_plans
          SET ${sets.join(', ')}
        WHERE id = $${p}
        RETURNING ${PLAN_COLUMNS}`,
      params
    );
    await client.query('COMMIT');
    invalidate();
    if (result.rows.length === 0) return null;
    const schedules = await fetchLiveSchedules();
    return withVatBreakdown(result.rows[0], schedules);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Soft-delete (is_active=false). Returns the updated row or null if not found. */
export async function softDeletePlan(id: number): Promise<SubscriptionPlanWithVat | null> {
  return updatePlan(id, { is_active: false });
}

/* ------------------------------------------------------------------ */
/*  Scheduled price change — admin CRUD                                */
/* ------------------------------------------------------------------ */

export type PriceScheduleStatus = 'pending' | 'applied' | 'superseded' | 'cancelled';

/** แถว schedule พร้อมข้อมูลประกอบสำหรับหน้าแอดมิน */
export interface PriceScheduleView extends PlanPriceScheduleRow {
  vat: number;
  total: number;
  previous_total: number | null;
  status: PriceScheduleStatus;
  plan_slug: string;
  plan_name: string;
  plan_name_th: string | null;
  created_by_email: string | null;
  cancelled_by_email: string | null;
}

function scheduleStatus(s: PlanPriceScheduleRow): PriceScheduleStatus {
  if (s.cancelled_at) return 'cancelled';
  if (s.applied_at) return s.note?.includes('[superseded]') ? 'superseded' : 'applied';
  return 'pending';
}

async function queryScheduleViews(db: Queryable, where: string, params: unknown[]): Promise<PriceScheduleView[]> {
  const result = await db.query(
    `SELECT sc.id, sc.plan_id, sc.subtotal, sc.effective_at, sc.note, sc.previous_subtotal,
            sc.applied_at, sc.cancelled_at, sc.cancelled_by, sc.created_by, sc.created_at,
            p.slug AS plan_slug, p.name AS plan_name, p.name_th AS plan_name_th,
            cu.email AS created_by_email, xu.email AS cancelled_by_email
       FROM subscription_plan_price_schedules sc
       JOIN subscription_plans p ON p.id = sc.plan_id
       LEFT JOIN users cu ON cu.id = sc.created_by
       LEFT JOIN users xu ON xu.id = sc.cancelled_by
      ${where}
      ORDER BY sc.effective_at DESC, sc.id DESC
      LIMIT 200`,
    params,
  );
  return result.rows.map((r: any) => {
    const base = normalizeSchedule(r);
    return {
      ...base,
      vat: vatOf(base.subtotal),
      total: totalOf(base.subtotal),
      previous_total: base.previous_subtotal == null ? null : totalOf(base.previous_subtotal),
      status: scheduleStatus(base),
      plan_slug: r.plan_slug,
      plan_name: r.plan_name,
      plan_name_th: r.plan_name_th ?? null,
      created_by_email: r.created_by_email ?? null,
      cancelled_by_email: r.cancelled_by_email ?? null,
    };
  });
}

/** ทุกรายการ (รอ / มีผลแล้ว / ถูกแทนที่ / ยกเลิก) ล่าสุดก่อน — materialize ก่อนอ่านให้สถานะตรง */
export async function listPriceSchedules(): Promise<PriceScheduleView[]> {
  await applyDueSchedules();
  return queryScheduleViews(pool, '', []);
}

export interface CreatePriceSchedulesInput {
  /** ISO 8601 (มี timezone) — แอดมินกรอกเวลาไทย FE ต่อ +07:00 ให้ */
  effective_at: string;
  note?: string | null;
  items: { plan_id: number; subtotal: number }[];
  created_by: number | null;
}

/**
 * ตั้งเวลาหลายแพ็กเกจในครั้งเดียว (transaction เดียว — ล้มข้อใดข้อหนึ่ง = ไม่สร้างเลย)
 * กติกา: effective_at ≥ now + MIN_LEAD · subtotal ≥ 0 · ราคาเท่าปัจจุบัน = NO_CHANGE ·
 * ซ้ำเวลาเดิมของแพ็กเกจเดียว = SCHEDULE_EXISTS (unique partial index จาก 064)
 */
export async function createPriceSchedules(input: CreatePriceSchedulesInput): Promise<PriceScheduleView[]> {
  const eff = new Date(String(input.effective_at ?? ''));
  if (Number.isNaN(eff.getTime())) {
    throw new PlansServiceError('INVALID_EFFECTIVE_AT', 400, 'รูปแบบวัน-เวลาไม่ถูกต้อง');
  }
  if (eff.getTime() < Date.now() + PRICE_SCHEDULE_MIN_LEAD_MS) {
    throw new PlansServiceError(
      'PAST_EFFECTIVE_AT', 400,
      `เวลาที่มีผลต้องเป็นอนาคตอย่างน้อย ${Math.ceil(PRICE_SCHEDULE_MIN_LEAD_MS / 1000)} วินาที`,
      { min_lead_ms: PRICE_SCHEDULE_MIN_LEAD_MS },
    );
  }
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    throw new PlansServiceError('INVALID_ITEMS', 400, 'ต้องระบุแพ็กเกจอย่างน้อย 1 รายการ');
  }
  const seen = new Set<number>();
  for (const it of items) {
    const pid = Number(it?.plan_id);
    const sub = Number(it?.subtotal);
    if (!Number.isInteger(pid) || pid <= 0) throw new PlansServiceError('INVALID_ITEMS', 400, 'plan_id ไม่ถูกต้อง');
    if (!Number.isFinite(sub) || sub < 0) throw new PlansServiceError('INVALID_ITEMS', 400, 'subtotal ต้องเป็นตัวเลข ≥ 0', { plan_id: pid });
    if (seen.has(pid)) throw new PlansServiceError('INVALID_ITEMS', 400, 'ระบุแพ็กเกจเดียวกันซ้ำ', { plan_id: pid });
    seen.add(pid);
  }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyDueSchedules(null, client);
    const ids: number[] = [];
    for (const it of items) {
      const pid = Number(it.plan_id);
      const sub = +Number(it.subtotal).toFixed(2);
      const cur = await client.query<{ id: number; slug: string; subtotal: number }>(
        `SELECT id, slug, subtotal FROM subscription_plans WHERE id = $1 FOR UPDATE`, [pid]
      );
      if (cur.rows.length === 0) {
        throw new PlansServiceError('PLAN_NOT_FOUND', 404, `ไม่พบแพ็กเกจ #${pid}`, { plan_id: pid });
      }
      const current = Number(cur.rows[0].subtotal);
      if (Math.abs(current - sub) < 0.001) {
        throw new PlansServiceError(
          'NO_CHANGE', 400,
          `แพ็กเกจ ${cur.rows[0].slug} ราคาใหม่เท่ากับราคาปัจจุบัน (฿${current})`,
          { plan_id: pid, slug: cur.rows[0].slug },
        );
      }
      try {
        const ins = await client.query<{ id: number }>(
          `INSERT INTO subscription_plan_price_schedules (plan_id, subtotal, effective_at, note, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [pid, sub, eff.toISOString(), note, input.created_by ?? null],
        );
        ids.push(ins.rows[0].id);
      } catch (e: any) {
        if (e?.code === '23505') {
          throw new PlansServiceError(
            'SCHEDULE_EXISTS', 409,
            `แพ็กเกจ ${cur.rows[0].slug} มีรายการตั้งเวลา ณ เวลานี้อยู่แล้ว — ยกเลิกรายการเดิมก่อน`,
            { plan_id: pid, slug: cur.rows[0].slug },
          );
        }
        throw e;
      }
    }
    const views = await queryScheduleViews(client, 'WHERE sc.id = ANY($1::int[])', [ids]);
    await client.query('COMMIT');
    invalidate();
    for (const v of views) {
      console.log(
        `[Packages][AUDIT] price schedule #${v.id} plan=${v.plan_slug} subtotal=${v.subtotal} effective=${v.effective_at} by user#${input.created_by ?? '-'}${note ? ` note="${note}"` : ''}`
      );
    }
    return views;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
}

/** ยกเลิกเฉพาะรายการที่ยังไม่มีผล — ที่มีผลแล้วเป็นประวัติ (ตั้งรอบใหม่แทน) */
export async function cancelPriceSchedule(id: number, byUserId: number | null): Promise<PriceScheduleView> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pre = await client.query<{ plan_id: number }>(
      `SELECT plan_id FROM subscription_plan_price_schedules WHERE id = $1`, [id]
    );
    if (pre.rows.length === 0) throw new PlansServiceError('SCHEDULE_NOT_FOUND', 404, 'ไม่พบรายการตั้งเวลา');
    // ถ้าเพิ่งถึงเวลาพอดี ให้ materialize ก่อน — จะได้ไม่ยกเลิกสิ่งที่ควรมีผลไปแล้ว
    await applyDueSchedules(Number(pre.rows[0].plan_id), client);
    const cur = await client.query(
      `SELECT ${SCHEDULE_COLUMNS} FROM subscription_plan_price_schedules WHERE id = $1 FOR UPDATE`, [id]
    );
    const row = normalizeSchedule(cur.rows[0]);
    if (row.cancelled_at) throw new PlansServiceError('ALREADY_CANCELLED', 400, 'รายการนี้ถูกยกเลิกไปแล้ว');
    if (row.applied_at) {
      throw new PlansServiceError('ALREADY_APPLIED', 400, 'รายการนี้มีผลไปแล้ว ยกเลิกไม่ได้ — ตั้งเวลารอบใหม่แทน');
    }
    await client.query(
      `UPDATE subscription_plan_price_schedules SET cancelled_at = NOW(), cancelled_by = $2 WHERE id = $1`,
      [id, byUserId],
    );
    const [view] = await queryScheduleViews(client, 'WHERE sc.id = $1', [id]);
    await client.query('COMMIT');
    invalidate();
    console.log(`[Packages][AUDIT] price schedule #${id} plan=${view.plan_slug} CANCELLED by user#${byUserId ?? '-'}`);
    return view;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
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

/**
 * ยอดโอน (รวม VAT) ที่ระบบรับได้สำหรับแพ็กเกจนี้ตอนนี้ — ราคาปัจจุบัน + ราคาพิเศษของแอดมิน
 * (ใช้ทั้งข้อความ error INVALID_AMOUNT และด่านตรวจ amount ของ admin extend)
 * ไม่มีช่วงรับราคาเก่า: ราคาที่ถูกแทนที่แล้วไม่อยู่ในรายการนี้
 */
export interface AcceptedPrice {
  subtotal: number;
  vat: number;
  total: number;
  label: 'current' | string;
}
export function getAcceptedPrices(plan: SubscriptionPlanWithVat, includeAlt = true): AcceptedPrice[] {
  const list: AcceptedPrice[] = [{ subtotal: plan.subtotal, vat: plan.vat, total: plan.total, label: 'current' }];
  if (includeAlt) {
    for (const a of plan.admin_alt_prices_computed) {
      if (list.some((x) => Math.abs(x.total - a.total) < 0.01)) continue;
      list.push({ subtotal: a.subtotal, vat: a.vat, total: a.total, label: a.label });
    }
  }
  return list;
}

/** Test-only / explicit cache reset (e.g. invoked from a sibling service). */
export function invalidatePlansCache() { invalidate(); }
