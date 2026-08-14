/**
 * CLI: sync YouTube auto-subtitles for a course into lesson_subtitles.
 * Same logic as POST /api/agent-chat/admin/course/:id/sync-subtitles.
 *
 * Usage (from server/):  npx tsx scripts/sync-subtitles.ts <courseId>
 */
import { pool } from '../src/db';
import { fetchAutoCaptions } from '../src/utils/youtubeCaptions';

async function main() {
  const courseId = Number(process.argv[2]);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    console.error('Usage: npx tsx scripts/sync-subtitles.ts <courseId>');
    process.exit(1);
  }
  const lessons = (
    await pool.query(
      `SELECT id, title, youtube_id FROM lessons
       WHERE course_id = $1 AND is_active = true AND youtube_id IS NOT NULL AND youtube_id <> ''
       ORDER BY lesson_order`,
      [courseId]
    )
  ).rows as Array<{ id: number; title: string; youtube_id: string }>;
  console.log(`SYNC|lessons=${lessons.length}`);
  let ok = 0;
  for (const l of lessons) {
    const cap = await fetchAutoCaptions(l.youtube_id);
    if (cap) {
      await pool.query(
        `INSERT INTO lesson_subtitles (lesson_id, course_id, language, content, fetched_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (lesson_id) DO UPDATE
           SET course_id = EXCLUDED.course_id, language = EXCLUDED.language,
               content = EXCLUDED.content, fetched_at = NOW()`,
        [l.id, courseId, cap.language, cap.text]
      );
      ok++;
      console.log(`SYNC|ok|${l.title.slice(0, 40)}|${cap.text.length} chars`);
    } else {
      console.log(`SYNC|no_captions|${l.title.slice(0, 40)}`);
    }
  }
  const total = (
    await pool.query(
      `SELECT COUNT(*)::int AS n, SUM(LENGTH(content))::int AS chars FROM lesson_subtitles WHERE course_id = $1`,
      [courseId]
    )
  ).rows[0];
  console.log(`SYNC|DONE|ok=${ok}/${lessons.length}|db_rows=${total.n}|total_chars=${total.chars}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('SYNC|FATAL|', e);
  process.exit(1);
});
