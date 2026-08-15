/**
 * Backfill: generate card/hero webp variants for every existing course
 * thumbnail. Idempotent — skips thumbnails whose variants already exist.
 *
 * Usage (from server/):  npx tsx scripts/optimize-thumbnails.ts [--force]
 *   --force  regenerate variants even when they already exist
 */
import 'dotenv/config';
import { pool } from '../src/db';
import { getFile, uploadFile } from '../src/utils/s3';
import { makeThumbnailVariant, variantKey, THUMB_VARIANTS } from '../src/utils/imageResize';

async function bufferOf(key: string): Promise<Buffer | null> {
  try {
    const obj = await getFile(key);
    const chunks: Buffer[] = [];
    for await (const c of obj.Body as any) chunks.push(c);
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

async function exists(key: string): Promise<boolean> {
  try {
    await getFile(key);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const rows = (
    await pool.query(
      `SELECT id, name, thumbnail_url FROM courses
       WHERE thumbnail_url LIKE '/api/courses/thumbnails/%'`
    )
  ).rows as Array<{ id: number; name: string; thumbnail_url: string }>;
  console.log(`OPT|courses=${rows.length}`);

  for (const c of rows) {
    const key = c.thumbnail_url.replace('/api/courses/thumbnails/', '');
    let original: Buffer | null = null;
    const force = process.argv.includes('--force');
    for (const v of Object.keys(THUMB_VARIANTS) as Array<keyof typeof THUMB_VARIANTS>) {
      const vk = variantKey(key, v);
      if (!force && (await exists(vk))) {
        console.log(`OPT|skip|${c.name.slice(0, 30)}|${v} (already exists)`);
        continue;
      }
      original = original ?? (await bufferOf(key));
      if (!original) {
        console.log(`OPT|missing-original|${c.name.slice(0, 30)}`);
        break;
      }
      const out = await makeThumbnailVariant(original, v);
      if (!out) {
        console.log(`OPT|resize-failed|${c.name.slice(0, 30)}|${v}`);
        continue;
      }
      await uploadFile(out, vk, 'image/webp', { contentDisposition: 'inline' });
      console.log(
        `OPT|ok|${c.name.slice(0, 30)}|${v}|${(original.length / 1024).toFixed(0)}KB → ${(out.length / 1024).toFixed(0)}KB`
      );
    }
  }
  console.log('OPT|DONE');
  process.exit(0);
}
main().catch((e) => { console.error('OPT|FATAL', e); process.exit(1); });
