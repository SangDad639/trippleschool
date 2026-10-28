// ทดสอบ e2e: แบบสอบถามหลังซื้อ (purchase_surveys · migration 079 · routes/purchaseSurveys.ts)
//   1) สิทธิ์: ไม่มี token 401 · log ของคนอื่น 403 · log ไม่มี 404 · purchase_type แปลก 400
//   2) สมาชิก: ตอบ → กรอง course_ids (id ปลอม/ซ้ำ) · ตอบซ้ำ = upsert แถวเดิม · "ข้าม" ไม่ทับคำตอบ · /mine
//   3) คอร์สเดี่ยว: ผูก enrollment ของตัวเอง · ตัดคอร์สที่ซื้อออกจากคอร์สที่สนใจ · คอร์สฟรี 400 · ไม่มี enrollment 404
//   4) ตัดความยาว reason 500 / course_ids 20 · 5) /admin/all (403 ถ้าไม่ใช่แอดมิน) เรียงใหม่→เก่า + top_courses + totals
//   6) GET /api/courses limit/offset (picker) · 7) 079 รันซ้ำได้
// ⚠️ DB แชร์ prod — สร้าง user ทดสอบ (__test-psurvey-*) + log/enrollment ของ user นั้นเอง และลบทิ้งท้ายสคริปต์เสมอ
// Run: npx tsx scripts/test-purchase-surveys.ts  (backend :3002 ต้องรันอยู่)
import 'dotenv/config';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const API = process.env.TEST_API_URL || 'http://localhost:3002';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SECRET = process.env.JWT_SECRET!;
const __dirname = dirname(fileURLToPath(import.meta.url));

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, cond: boolean, detail?: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const hex8 = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8);
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });
const jsonH = (tok: string) => ({ ...auth(tok), 'Content-Type': 'application/json' });
const j = async (r: globalThis.Response) => ({ status: r.status, json: (await r.json().catch(() => ({}))) as any });
const post = (tok: string | null, body: unknown) =>
  fetch(`${API}/api/purchase-surveys`, { method: 'POST', headers: tok ? jsonH(tok) : { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j);
const mine = (tok: string, q: string) => fetch(`${API}/api/purchase-surveys/mine?${q}`, { headers: auth(tok) }).then(j);
const adminAll = (tok: string) => fetch(`${API}/api/purchase-surveys/admin/all`, { headers: auth(tok) }).then(j);
const courses = (q: string) => fetch(`${API}/api/courses?${q}`).then(j);

async function main() {
  const stamp = Date.now();
  const mail = (k: string) => `__test-psurvey-${stamp}-${k}@aff.test`;
  const buyer = (await pool.query(`INSERT INTO users (email, password_hash, refcode, is_approved) VALUES ($1, 'x', $2, true) RETURNING id`, [mail('buyer'), hex8()])).rows[0].id as number;
  const other = (await pool.query(`INSERT INTO users (email, password_hash, refcode, is_approved) VALUES ($1, 'x', $2, true) RETURNING id`, [mail('other'), hex8()])).rows[0].id as number;
  const admin = (await pool.query(`SELECT id, email FROM users WHERE is_admin = true ORDER BY id LIMIT 1`)).rows[0];
  const adminTok = jwt.sign({ userId: admin.id, email: admin.email, isAdmin: true }, SECRET, { expiresIn: '1h' });
  const buyerTok = jwt.sign({ userId: buyer, email: mail('buyer') }, SECRET, { expiresIn: '1h' });
  const otherTok = jwt.sign({ userId: other, email: mail('other') }, SECRET, { expiresIn: '1h' });

  try {
    // --- fixtures: log สมาชิกของ buyer + ของ other, enrollment จ่ายเงิน (buyer) + ฟรี (other) ---
    const logBuyer = (await pool.query(
      `INSERT INTO subscription_extension_logs (user_id, admin_id, days_added, amount, approval_method) VALUES ($1, NULL, 30, '0', 'admin') RETURNING id`, [buyer])).rows[0].id as number;
    const logOther = (await pool.query(
      `INSERT INTO subscription_extension_logs (user_id, admin_id, days_added, amount, approval_method) VALUES ($1, NULL, 365, '0', 'admin') RETURNING id`, [other])).rows[0].id as number;
    const paidCourses = (await pool.query(
      `SELECT id, name FROM courses WHERE is_active = true AND content_type = 'course' AND COALESCE(is_free, false) = false AND price > 0 ORDER BY created_at DESC LIMIT 4`)).rows;
    const bought = paidCourses[0];
    const interestA = paidCourses[1];
    const interestB = paidCourses[2];
    const interestC = paidCourses[3];
    const enrBuyer = (await pool.query(
      `INSERT INTO course_enrollments (user_id, course_id, status, paid_amount) VALUES ($1, $2, 'pending', 990) RETURNING id`, [buyer, bought.id])).rows[0].id as number;
    await pool.query(`INSERT INTO course_enrollments (user_id, course_id, status, paid_amount) VALUES ($1, $2, 'pending', 0)`, [other, bought.id]);

    // ===== 1) สิทธิ์ =====
    check('1.1 ไม่มี token → 401', (await post(null, { purchase_type: 'subscription', extension_log_id: logBuyer })).status === 401);
    check('1.2 log ของคนอื่น → 403', (await post(buyerTok, { purchase_type: 'subscription', extension_log_id: logOther })).status === 403);
    check('1.3 log ไม่มี → 404', (await post(buyerTok, { purchase_type: 'subscription', extension_log_id: 999999999 })).status === 404);
    check('1.4 purchase_type แปลก → 400', (await post(buyerTok, { purchase_type: 'ebook' })).status === 400);
    check('1.5 extension_log_id ไม่ใช่เลข → 400', (await post(buyerTok, { purchase_type: 'subscription', extension_log_id: 'abc' })).status === 400);

    // ===== 2) สมาชิก =====
    const r21 = await post(buyerTok, {
      purchase_type: 'subscription', extension_log_id: logBuyer, plan_slug: 'monthly',
      reason: '  อยากทำคลิปขายของเอง  ', course_ids: [interestA.id, interestB.id, interestA.id, 999999999, 'x'],
    });
    check('2.1 ตอบสมาชิก → 200 skipped=false', r21.status === 200 && r21.json.skipped === false, JSON.stringify(r21.json));
    check('2.2 course_ids กรอง id ปลอม/ซ้ำ → 2 คอร์ส', JSON.stringify([...(r21.json.course_ids || [])].sort()) === JSON.stringify([interestA.id, interestB.id].sort()));
    const row21 = (await pool.query(`SELECT * FROM purchase_surveys WHERE extension_log_id = $1`, [logBuyer])).rows;
    check('2.3 DB 1 แถว reason trim + plan_slug monthly', row21.length === 1 && row21[0].reason === 'อยากทำคลิปขายของเอง' && row21[0].plan_slug === 'monthly' && row21[0].purchase_type === 'subscription');
    const jc21 = (await pool.query(`SELECT course_id FROM purchase_survey_courses WHERE survey_id = $1 ORDER BY course_id`, [row21[0].id])).rows.map((r) => Number(r.course_id));
    check('2.4 junction = 2 คอร์ส', JSON.stringify(jc21) === JSON.stringify([interestA.id, interestB.id].sort((a, b) => a - b)));

    const r25 = await post(buyerTok, { purchase_type: 'subscription', extension_log_id: logBuyer, reason: 'แก้คำตอบ', course_ids: [interestC.id] });
    const row25 = (await pool.query(`SELECT * FROM purchase_surveys WHERE extension_log_id = $1`, [logBuyer])).rows;
    const jc25 = (await pool.query(`SELECT course_id FROM purchase_survey_courses WHERE survey_id = $1`, [row25[0].id])).rows.map((r) => Number(r.course_id));
    check('2.5 ตอบซ้ำ = upsert แถวเดิม (id เท่าเดิม, reason/junction แทนที่)', r25.status === 200 && row25.length === 1 && row25[0].id === row21[0].id && row25[0].reason === 'แก้คำตอบ' && JSON.stringify(jc25) === JSON.stringify([interestC.id]));
    check('2.6 ไม่ส่ง plan_slug → เดาจากวัน (30 วัน = monthly)', row25[0].plan_slug === 'monthly');

    const r27 = await post(buyerTok, { purchase_type: 'subscription', extension_log_id: logBuyer, skipped: true });
    const row27 = (await pool.query(`SELECT reason, skipped FROM purchase_surveys WHERE extension_log_id = $1`, [logBuyer])).rows[0];
    check('2.7 "ข้าม" หลังตอบแล้ว → unchanged ไม่ทับคำตอบ', r27.status === 200 && r27.json.unchanged === true && row27.reason === 'แก้คำตอบ' && row27.skipped === false);

    const r28 = await post(otherTok, { purchase_type: 'subscription', extension_log_id: logOther });
    const row28 = (await pool.query(`SELECT skipped, plan_slug FROM purchase_surveys WHERE extension_log_id = $1`, [logOther])).rows[0];
    check('2.8 ส่งว่างทั้งคู่ = ข้าม (skipped=true) + 365 วัน = yearly', r28.status === 200 && r28.json.skipped === true && row28?.skipped === true && row28?.plan_slug === 'yearly');
    const r29 = await post(otherTok, { purchase_type: 'subscription', extension_log_id: logOther, reason: 'ตอบทีหลัง' });
    const row29 = (await pool.query(`SELECT reason, skipped FROM purchase_surveys WHERE extension_log_id = $1`, [logOther])).rows[0];
    check('2.9 เคยข้ามแล้วตอบทีหลัง → ทับได้ skipped=false', r29.status === 200 && row29.skipped === false && row29.reason === 'ตอบทีหลัง');

    const m1 = await mine(buyerTok, `extension_log_id=${logBuyer}`);
    const m2 = await mine(otherTok, `extension_log_id=${logBuyer}`);
    check('2.10 /mine เจ้าของ → answered true eligible true · คนอื่น → eligible false', m1.json.answered === true && m1.json.eligible === true && m1.json.skipped === false && m2.json.answered === false && m2.json.eligible === false);
    check('2.11 /mine ไม่ส่งพารามิเตอร์ → 400', (await mine(buyerTok, '')).status === 400);

    // ===== 3) คอร์สเดี่ยว =====
    const r31 = await post(buyerTok, { purchase_type: 'course', course_id: bought.id, reason: 'ชอบตัวอย่าง', course_ids: [bought.id, interestA.id] });
    const row31 = (await pool.query(`SELECT * FROM purchase_surveys WHERE enrollment_id = $1`, [enrBuyer])).rows;
    check('3.1 ตอบคอร์ส → ผูก enrollment ของตัวเอง + course_id', r31.status === 200 && row31.length === 1 && row31[0].course_id === bought.id && row31[0].purchase_type === 'course', JSON.stringify(r31.json));
    check('3.2 คอร์สที่ซื้อถูกตัดออกจากคอร์สที่สนใจ', JSON.stringify(r31.json.course_ids) === JSON.stringify([interestA.id]));
    const r33 = await post(otherTok, { purchase_type: 'course', course_id: bought.id, reason: 'ฟรี' });
    check('3.3 enrollment คอร์สฟรี (paid 0) → 400 FREE_COURSE', r33.status === 400 && r33.json.errorCode === 'FREE_COURSE');
    check('3.4 ไม่มี enrollment → 404', (await post(otherTok, { purchase_type: 'course', course_id: interestA.id })).status === 404);
    check('3.5 course_id ไม่ใช่เลข → 400', (await post(buyerTok, { purchase_type: 'course', course_id: 'x' })).status === 400);
    const m3 = await mine(buyerTok, `course_id=${bought.id}`);
    check('3.6 /mine?course_id → answered true', m3.json.answered === true && m3.json.eligible === true);
    const m4 = await mine(otherTok, `course_id=${bought.id}`);
    check('3.7 /mine?course_id enrollment ฟรี → eligible false', m4.json.answered === false && m4.json.eligible === false);

    // ===== 4) ตัดความยาว =====
    const long = 'ก'.repeat(600);
    const many = Array.from({ length: 25 }, (_, i) => 100000 + i);
    const r41 = await post(buyerTok, { purchase_type: 'course', course_id: bought.id, reason: long, course_ids: many });
    const row41 = (await pool.query(`SELECT reason FROM purchase_surveys WHERE enrollment_id = $1`, [enrBuyer])).rows[0];
    check('4.1 reason ตัดที่ 500 ตัวอักษร', r41.status === 200 && row41.reason.length === 500);
    check('4.2 course_ids ที่ไม่มีจริงถูกกรองหมด (ไม่ล้ม)', Array.isArray(r41.json.course_ids) && r41.json.course_ids.length === 0);

    // ===== 5) admin/all =====
    check('5.1 /admin/all ไม่ใช่แอดมิน → 403', (await adminAll(buyerTok)).status === 403);
    const a = await adminAll(adminTok);
    const ids = (a.json.surveys || []).map((s: any) => Number(s.id));
    const ours = (await pool.query(`SELECT id FROM purchase_surveys WHERE user_id IN ($1, $2) ORDER BY created_at DESC, id DESC`, [buyer, other])).rows.map((r) => Number(r.id));
    check('5.2 /admin/all 200 มี surveys/top_courses/totals', a.status === 200 && Array.isArray(a.json.surveys) && Array.isArray(a.json.top_courses) && typeof a.json.totals?.answered === 'number');
    check('5.3 เรียงใหม่ → เก่า (fixture 3 แถวอยู่บนสุดตามลำดับ)', JSON.stringify(ids.slice(0, 3)) === JSON.stringify(ours), `top=${ids.slice(0, 3)} ours=${ours}`);
    const sortedByDate = (a.json.surveys as any[]).every((s, i, arr) => i === 0 || new Date(arr[i - 1].created_at) >= new Date(s.created_at));
    check('5.4 ทุกแถวเรียง created_at DESC', sortedByDate);
    const mineRow = (a.json.surveys as any[]).find((s) => Number(s.id) === row31[0].id);
    check('5.5 แถวคอร์ส: user_email/course_name/interested ครบ', !!mineRow && mineRow.user_email === mail('buyer') && mineRow.course_name === bought.name && Array.isArray(mineRow.interested));
    const subRow = (a.json.surveys as any[]).find((s) => Number(s.id) === row21[0].id);
    check('5.6 แถวสมาชิก: plan_slug + interested = คอร์ส C', !!subRow && subRow.plan_slug === 'monthly' && subRow.interested.length === 1 && Number(subRow.interested[0].id) === interestC.id);
    const topC = (a.json.top_courses as any[]).find((c) => Number(c.id) === interestC.id);
    check('5.7 top_courses มีคอร์ส C นับ ≥ 1', !!topC && Number(topC.n) >= 1);
    check('5.8 totals นับครบ (answered ≥ 3, subscription ≥ 2, course ≥ 1)', a.json.totals.answered >= 3 && a.json.totals.subscription >= 2 && a.json.totals.course >= 1, JSON.stringify(a.json.totals));

    // ===== 6) GET /api/courses limit/offset =====
    const p1 = await courses('sort=new&type=course&limit=8');
    const p2 = await courses('sort=new&type=course&limit=8&offset=8');
    const all = await courses('sort=new&type=course');
    const big = await courses('sort=new&type=course&limit=500');
    const ids1 = (p1.json as any[]).map((c) => c.id);
    const ids2 = (p2.json as any[]).map((c) => c.id);
    check('6.1 limit=8 → 8 ใบ เรียง created_at DESC', ids1.length === 8 && (p1.json as any[]).every((c, i, arr) => i === 0 || new Date(arr[i - 1].created_at) >= new Date(c.created_at)));
    check('6.2 offset=8 → หน้าถัดไป ไม่ซ้ำหน้าแรก = ตรงกับ all[8..16]', ids2.length > 0 && !ids2.some((id) => ids1.includes(id)) && JSON.stringify(ids2) === JSON.stringify((all.json as any[]).slice(8, 16).map((c) => c.id)));
    check('6.3 ไม่ส่ง limit → ได้ทั้งหมด (≥ 8+หน้า 2)', (all.json as any[]).length >= ids1.length + ids2.length);
    check('6.4 limit=500 ถูก clamp ≤ 50', (big.json as any[]).length <= 50 && (big.json as any[]).length === Math.min(50, (all.json as any[]).length));
    check('6.5 limit=abc ถูกเพิกเฉย (ได้ทั้งหมด)', ((await courses('sort=new&type=course&limit=abc')).json as any[]).length === (all.json as any[]).length);

    // ===== 7) 079 idempotent =====
    const sql = readFileSync(join(__dirname, '../src/migrations/sql/079_purchase_surveys.sql'), 'utf8');
    let ok = true;
    try { await pool.query(sql); } catch { ok = false; }
    check('7.1 migration 079 รันซ้ำได้', ok);
  } finally {
    // --- cleanup (ลำดับ: surveys → enrollments → logs → users) ---
    await pool.query(`DELETE FROM purchase_surveys WHERE user_id IN ($1, $2)`, [buyer, other]);
    await pool.query(`DELETE FROM course_enrollments WHERE user_id IN ($1, $2)`, [buyer, other]);
    await pool.query(`DELETE FROM subscription_extension_logs WHERE user_id IN ($1, $2)`, [buyer, other]);
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [buyer, other]);
    const left = await pool.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE $1`, [`__test-psurvey-${stamp}-%`]);
    console.log(`cleanup: users left = ${left.rows[0].n}`);
    await pool.end();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
