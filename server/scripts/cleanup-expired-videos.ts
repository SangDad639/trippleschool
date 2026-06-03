/**
 * Cleanup Expired Video URLs
 *
 * 1. Items with dropbox_path but video_url is NOT Dropbox → re-create shared link
 * 2. Items with expired video_url (tempfile/cdn domains) and no dropbox_path → clear video_url
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { Dropbox } from 'dropbox';
dotenv.config();

const EXPIRED_DOMAINS = ['tempfile.aiquickdraw.com', 'cdn.doculator.org'];

function getDropboxClient(): Dropbox {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN;

  if (appKey && appSecret && refreshToken) {
    return new Dropbox({ clientId: appKey, clientSecret: appSecret, refreshToken });
  } else if (accessToken) {
    return new Dropbox({ accessToken });
  }
  throw new Error('Dropbox not configured');
}

async function getOrCreateSharedLink(dbx: Dropbox, path: string): Promise<string> {
  try {
    const result = await dbx.sharingCreateSharedLinkWithSettings({
      path,
      settings: { requested_visibility: { '.tag': 'public' }, audience: { '.tag': 'public' }, access: { '.tag': 'viewer' } },
    });
    return result.result.url.replace(/\?dl=0$/, '?dl=1');
  } catch (err: any) {
    if (err?.error?.error?.['.tag'] === 'shared_link_already_exists') {
      const existing = await dbx.sharingListSharedLinks({ path, direct_only: true });
      const url = existing.result.links[0]?.url || '';
      return url.replace(/\?dl=0$/, '?dl=1');
    }
    throw err;
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // === STEP 1: Fix items with dropbox_path but non-Dropbox video_url ===
  console.log('\n=== STEP 1: Fix items with dropbox_path but wrong video_url ===');
  const fixable = await pool.query(`
    SELECT id, video_url, dropbox_path FROM schedule_queue
    WHERE dropbox_path IS NOT NULL AND dropbox_path != ''
      AND video_url NOT LIKE '%dropbox%'
      AND video_url IS NOT NULL AND video_url != ''
  `);

  console.log(`Found ${fixable.rows.length} items to fix (have dropbox_path but video_url is not Dropbox)`);

  if (fixable.rows.length > 0) {
    const dbx = getDropboxClient();
    let fixed = 0, errors = 0;

    for (const row of fixable.rows) {
      try {
        const sharedUrl = await getOrCreateSharedLink(dbx, row.dropbox_path);
        await pool.query('UPDATE schedule_queue SET video_url = $1 WHERE id = $2', [sharedUrl, row.id]);
        console.log(`  ✅ #${row.id}: ${row.dropbox_path} → Dropbox link`);
        fixed++;
      } catch (err: any) {
        console.log(`  ❌ #${row.id}: ${err.message}`);
        // File might not exist in Dropbox → clear both
        await pool.query('UPDATE schedule_queue SET video_url = NULL, dropbox_path = NULL WHERE id = $1', [row.id]);
        errors++;
      }
    }
    console.log(`Fixed: ${fixed}, Errors (cleared): ${errors}`);
  }

  // === STEP 2: Clear expired video_url (no dropbox_path) ===
  console.log('\n=== STEP 2: Clear expired video URLs ===');
  const domainConditions = EXPIRED_DOMAINS.map((d, i) => `video_url LIKE $${i + 1}`).join(' OR ');
  const domainParams = EXPIRED_DOMAINS.map(d => `%${d}%`);

  const expired = await pool.query(`
    SELECT COUNT(*) as count FROM schedule_queue
    WHERE (${domainConditions})
      AND (dropbox_path IS NULL OR dropbox_path = '')
  `, domainParams);

  const expiredCount = parseInt(expired.rows[0].count);
  console.log(`Found ${expiredCount} items with expired URLs (no Dropbox backup)`);

  if (expiredCount > 0) {
    const result = await pool.query(`
      UPDATE schedule_queue SET video_url = NULL
      WHERE (${domainConditions})
        AND (dropbox_path IS NULL OR dropbox_path = '')
    `, domainParams);
    console.log(`Cleared ${result.rowCount} expired video URLs`);
  }

  // === SUMMARY ===
  console.log('\n=== FINAL SUMMARY ===');
  const summary = await pool.query(`
    SELECT
      CASE
        WHEN video_url LIKE '%dropbox%' THEN 'DROPBOX'
        WHEN video_url IS NULL OR video_url = '' THEN 'NO_VIDEO'
        ELSE 'OTHER'
      END as source,
      COUNT(*) as count
    FROM schedule_queue
    WHERE status = 'done'
    GROUP BY source
    ORDER BY count DESC
  `);
  for (const row of summary.rows) {
    console.log(`${row.source}: ${row.count}`);
  }

  await pool.end();
  console.log('\nDone!');
}

main().catch(console.error);
