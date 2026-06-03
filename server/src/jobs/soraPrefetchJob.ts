/**
 * Sora Video Pre-fetch Job
 *
 * Pre-fetches and caches Sora video URLs in the database.
 * Runs every 4 hours using node-cron (no external dependencies).
 */

import pool from '../db.js';
import cron from 'node-cron';

const CACHE_TTL_HOURS = 4;
const RATE_LIMIT_MS = 2000; // 2 seconds between requests
const BATCH_LIMIT = 20; // Process max 20 per run

async function fetchSoraVideoUrl(soraUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(soraUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Extract direct video URL
    const videoMatch = html.match(/videos\.openai\.com[^"'\s]*?%2Fdrvs%2Fmd%2Fraw[^"'\s]*/);
    const videoFallback = html.match(/videos\.openai\.com[^"'\s]*?%2Fraw[^"'\s]*/);

    const cleanUrl = (raw: string) =>
      `https://${raw.replace(/\\$/g, '').replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\u002F/g, '/')}`;

    return videoMatch ? cleanUrl(videoMatch[0])
         : videoFallback ? cleanUrl(videoFallback[0])
         : null;
  } catch (err) {
    console.error(`[SoraPrefetch] Failed to fetch:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function prefetchSoraVideos(): Promise<void> {
  console.log(`🎬 [SoraPrefetch] Starting job at ${new Date().toISOString()}`);

  try {
    // Get templates needing refresh
    const result = await pool.query(`
      SELECT id, sora_url, name
      FROM prompt_library
      WHERE sora_url IS NOT NULL
        AND sora_url != ''
        AND is_active = true
        AND user_id IS NULL
        AND (
          video_resolved_at IS NULL
          OR video_resolved_at < NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'
        )
      ORDER BY video_resolved_at ASC NULLS FIRST
      LIMIT ${BATCH_LIMIT}
    `);

    if (result.rows.length === 0) {
      console.log('🎬 [SoraPrefetch] All templates are up to date');
      return;
    }

    console.log(`🎬 [SoraPrefetch] Found ${result.rows.length} templates to refresh`);

    let success = 0;
    let failed = 0;

    for (const template of result.rows) {
      const videoUrl = await fetchSoraVideoUrl(template.sora_url);

      if (videoUrl) {
        await pool.query(
          `UPDATE prompt_library SET resolved_video_url = $1, video_resolved_at = NOW() WHERE id = $2`,
          [videoUrl, template.id]
        );
        console.log(`🎬 [SoraPrefetch] ✓ ${template.name}`);
        success++;
      } else {
        console.log(`🎬 [SoraPrefetch] ✗ ${template.name} - no video found`);
        failed++;
      }

      // Rate limit
      await sleep(RATE_LIMIT_MS);
    }

    console.log(`🎬 [SoraPrefetch] Done: ${success} success, ${failed} failed`);
  } catch (error) {
    console.error('🎬 [SoraPrefetch] Error:', error);
  }
}

export function startSoraPrefetchJob(): void {
  console.log('📅 Sora Pre-fetch Job scheduled');
  console.log('   Schedule: Every 4 hours');
  console.log('   Action: Pre-fetch Sora video URLs and cache to DB');

  // Schedule: every 4 hours
  cron.schedule('0 */4 * * *', () => {
    prefetchSoraVideos();
  }, {
    timezone: 'Asia/Bangkok'
  });

  // Run once on startup after 30 seconds (let server fully start)
  setTimeout(() => {
    console.log('🎬 [SoraPrefetch] Running initial prefetch...');
    prefetchSoraVideos();
  }, 30000);
}

export default { startSoraPrefetchJob };
