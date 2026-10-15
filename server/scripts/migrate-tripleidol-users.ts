// ย้ายผู้ใช้ Triple Idol จาก backend เดิม (sora-creator-suite · ตาราง accounts + app_access app_key='tripleidol')
// มาเป็นบัญชี Triple School (ตาราง users) — ย้ายมาเฉย ๆ: ไม่ให้ subscription ใด ๆ ของ school
//
// รันจาก server/:
//   SORA_DATABASE_URL=postgres://... npx tsx scripts/migrate-tripleidol-users.ts            # dry-run (อ่านอย่างเดียว)
//   SORA_DATABASE_URL=postgres://... npx tsx scripts/migrate-tripleidol-users.ts --apply    # เขียนจริง
//   เพิ่ม --copy-password-into-google-accounts เมื่อยอมให้บัญชี school ที่สมัครด้วย Google (ไม่มีรหัสผ่าน)
//   รับรหัสผ่านจากฝั่ง sora มาใช้ — ปิดไว้เป็นค่าเริ่มต้น เพราะอีเมลฝั่ง sora ไม่เคยถูกยืนยัน
//   (คนที่พิมพ์อีเมลคนอื่นตอนสมัคร Triple Idol จะได้รหัสเข้าบัญชี school ของเจ้าของอีเมลจริง)
//
// กติกาต่อบัญชี (idempotent — รันซ้ำได้):
//   • อีเมลยังไม่มีใน school → INSERT users (email, password_hash เดิมของ sora — bcryptjs ทั้งคู่, is_approved,
//     credits/refcode/commission เหมือนสมัครใหม่ที่เว็บ, join_date = วันสมัครเดิม) + desktop_app_access imported_from='sora'
//   • อีเมลมีใน school แล้ว + มีรหัสผ่าน → ไม่แตะบัญชี (ผู้ใช้ล็อกอินแอปด้วยรหัสของ school) แค่สร้างแถว desktop_app_access ถ้ายังไม่มี
//   • อีเมลมีใน school แล้วแต่ไม่มีรหัสผ่าน (Google) → รายงาน "ต้องตัดสินใจ" · ก๊อปรหัสให้เฉพาะเมื่อส่ง flag
//   • cardLimit ที่แอดมิน sora เคยตั้ง > 1 → ใส่ card_limit_override (ค่า 1 = ฟรีอยู่แล้ว ไม่ต้อง override)
//   • ต้องรัน migration 078 (desktop_app_access) ก่อน — สคริปต์เช็กให้และหยุดถ้ายังไม่มี
import 'dotenv/config';
import crypto from 'crypto';
import pg from 'pg';

const APP_KEY = 'tripleidol';
const APPLY = process.argv.includes('--apply');
const COPY_PASSWORD = process.argv.includes('--copy-password-into-google-accounts');

interface SoraRow {
  id: number;
  email: string;
  password_hash: string;
  created_at: Date | string;
  feature_permissions: { cardLimit?: unknown } | null;
}

interface SchoolUser {
  id: number;
  email: string;
  has_password: boolean;
  has_access: boolean;
}

type Outcome =
  | 'created'
  | 'exists-linked'
  | 'exists-already-linked'
  | 'google-only-skipped'
  | 'google-only-password-copied'
  | 'bad-hash-skipped';

function ssl(url: string) {
  return url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false };
}

function connect(url: string) {
  return new pg.Pool({ connectionString: url, ssl: ssl(url), max: 2 });
}

function overrideFor(perm: SoraRow['feature_permissions']): number | null {
  const v = perm && typeof perm === 'object' ? perm.cardLimit : undefined;
  return typeof v === 'number' && Number.isInteger(v) && v > 1 ? v : null;
}

async function readSora(sora: pg.Pool): Promise<SoraRow[]> {
  const r = await sora.query<SoraRow>(
    `SELECT a.id, LOWER(a.email) AS email, a.password_hash, a.created_at, aa.feature_permissions
       FROM accounts a
       JOIN app_access aa ON aa.account_id = a.id AND aa.app_key = $1 AND aa.allowed = true
      ORDER BY a.id`,
    [APP_KEY]
  );
  return r.rows;
}

async function readSchool(school: pg.Pool, emails: string[], has078: boolean): Promise<Map<string, SchoolUser>> {
  const accessSql = has078
    ? `EXISTS (SELECT 1 FROM desktop_app_access d WHERE d.user_id = u.id AND d.app_key = $2)`
    : `false`;
  const r = await school.query<SchoolUser>(
    `SELECT u.id, LOWER(u.email) AS email, u.password_hash IS NOT NULL AS has_password,
            ${accessSql} AS has_access
       FROM users u
      WHERE LOWER(u.email) = ANY($1)`,
    has078 ? [emails, APP_KEY] : [emails]
  );
  return new Map(r.rows.map((u) => [u.email, u]));
}

/** ค่าเริ่มต้นแบบเดียวกับ POST /api/auth/register (routes/auth.ts) */
async function registerDefaults(school: pg.Pool): Promise<{ credits: number; commission: number }> {
  const s = await school.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'default_credits'`);
  const credits = s.rows[0] ? parseInt(s.rows[0].setting_value, 10) : 100;
  const t = await school.query(
    `SELECT commission_percent FROM affiliate_tiers WHERE is_active = true ORDER BY display_order ASC, id ASC LIMIT 1`
  );
  let commission: number;
  if (t.rows[0]?.commission_percent != null) {
    commission = parseFloat(t.rows[0].commission_percent);
  } else {
    const a = await school.query(`SELECT tier1_percent FROM affiliate_settings WHERE id = 1`);
    commission = parseFloat(a.rows[0]?.tier1_percent) || 20;
  }
  return { credits: Number.isFinite(credits) ? credits : 100, commission };
}

async function createUser(client: pg.PoolClient, row: SoraRow, defaults: { credits: number; commission: number }) {
  // refcode 8 ตัวแบบเดียวกับเว็บ — ชนก็สุ่มใหม่
  for (let attempt = 0; attempt < 5; attempt++) {
    const refcode = crypto.randomUUID().slice(0, 8).toLowerCase();
    try {
      const r = await client.query(
        `INSERT INTO users (email, password_hash, credits, is_approved, refcode, referrer_id,
                            commission_rate, commission_percent, join_date)
         VALUES ($1, $2, $3, true, $4, NULL, $5, $5, $6)
         RETURNING id`,
        [row.email, row.password_hash, defaults.credits, refcode, defaults.commission, row.created_at]
      );
      return r.rows[0].id as number;
    } catch (e: any) {
      if (e?.code === '23505' && String(e.constraint || '').includes('refcode')) continue;
      throw e;
    }
  }
  throw new Error('refcode collision x5 for ' + row.email);
}

async function linkAccess(client: pg.PoolClient, userId: number, override: number | null, imported: boolean) {
  await client.query(
    `INSERT INTO desktop_app_access (user_id, app_key, card_limit_override, imported_from)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, app_key) DO UPDATE SET
       card_limit_override = COALESCE(desktop_app_access.card_limit_override, EXCLUDED.card_limit_override),
       updated_at = NOW()`,
    [userId, APP_KEY, override, imported ? 'sora' : null]
  );
}

async function main() {
  const soraUrl = process.env.SORA_DATABASE_URL;
  const schoolUrl = process.env.DATABASE_URL;
  if (!soraUrl) throw new Error('SORA_DATABASE_URL not set');
  if (!schoolUrl) throw new Error('DATABASE_URL not set (school)');
  if (soraUrl === schoolUrl) throw new Error('SORA_DATABASE_URL ชี้ DB เดียวกับ school — ผิดแน่');

  const sora = connect(soraUrl);
  const school = connect(schoolUrl);
  try {
    const has078 = await school.query(`SELECT to_regclass('desktop_app_access') AS t`);
    if (!has078.rows[0]?.t) {
      if (APPLY) throw new Error('ยังไม่มีตาราง desktop_app_access — รัน migration 078 ก่อน (npm run migrate:dev)');
      console.warn('⚠ ยังไม่มีตาราง desktop_app_access (migration 078) — dry-run ต่อได้ แต่ --apply จะหยุด');
    }

    const rows = await readSora(sora);
    const existing = await readSchool(school, rows.map((r) => r.email), !!has078.rows[0]?.t);
    const defaults = await registerDefaults(school);
    console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} · sora tripleidol accounts: ${rows.length} · school defaults:`, defaults);

    const plan: Array<{ email: string; outcome: Outcome; note: string }> = [];
    for (const row of rows) {
      const hashOk = typeof row.password_hash === 'string' && /^\$2[aby]\$\d\d\$/.test(row.password_hash);
      const over = overrideFor(row.feature_permissions);
      const hit = existing.get(row.email);
      if (!hit) {
        plan.push({
          email: row.email,
          outcome: hashOk ? 'created' : 'bad-hash-skipped',
          note: hashOk ? (over ? `override ${over}` : '') : 'password_hash ไม่ใช่ bcrypt',
        });
        continue;
      }
      if (hit.has_password) {
        plan.push({ email: row.email, outcome: hit.has_access ? 'exists-already-linked' : 'exists-linked', note: `school id ${hit.id}` });
        continue;
      }
      plan.push({
        email: row.email,
        outcome: COPY_PASSWORD && hashOk ? 'google-only-password-copied' : 'google-only-skipped',
        note: `school id ${hit.id} สมัครด้วย Google ไม่มีรหัสผ่าน${COPY_PASSWORD ? '' : ' — ใส่ --copy-password-into-google-accounts ถ้าจะให้ใช้รหัส sora'}`,
      });
    }
    console.table(plan);
    const counts = plan.reduce<Record<string, number>>((acc, p) => ((acc[p.outcome] = (acc[p.outcome] || 0) + 1), acc), {});
    console.log('summary:', counts);

    if (!APPLY) {
      console.log('\n(dry-run — ไม่ได้เขียนอะไร · ใส่ --apply เพื่อย้ายจริง)');
      return;
    }

    const client = await school.connect();
    try {
      for (const row of rows) {
        const item = plan.find((p) => p.email === row.email)!;
        const hit = existing.get(row.email);
        const over = overrideFor(row.feature_permissions);
        await client.query('BEGIN');
        try {
          if (item.outcome === 'created') {
            const id = await createUser(client, row, defaults);
            await linkAccess(client, id, over, true);
            console.log(`  + created ${row.email} → school id ${id}`);
          } else if (item.outcome === 'exists-linked' || item.outcome === 'exists-already-linked') {
            await linkAccess(client, hit!.id, over, false);
            console.log(`  = linked ${row.email} (school id ${hit!.id})`);
          } else if (item.outcome === 'google-only-password-copied') {
            await client.query(`UPDATE users SET password_hash = $2 WHERE id = $1 AND password_hash IS NULL`, [hit!.id, row.password_hash]);
            await linkAccess(client, hit!.id, over, false);
            console.log(`  ~ password copied into Google account ${row.email} (school id ${hit!.id})`);
          } else {
            console.log(`  - skipped ${row.email} (${item.outcome})`);
          }
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      }
    } finally {
      client.release();
    }
    console.log('\n✅ done');
  } finally {
    await Promise.all([sora.end(), school.end()]);
  }
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
