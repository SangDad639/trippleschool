// Repoint a lesson's video to a different YouTube URL.
//   npx tsx scripts/fix-lesson-video-url.ts <lessonId> <youtubeUrl>
// Defaults fix lesson 94 ("บท 01: เลือกผู้ช่วย 1 ตัว") whose embed returned a
// YouTube playback error because the stored youtube_id no longer resolves.
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_LESSON_ID = 94;
const DEFAULT_URL = 'https://www.youtube.com/watch?v=F46dMCmotV4';

// Same patterns as extractYoutubeId() in server/src/routes/courses.ts
function extractYoutubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const patterns = [
    /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function main() {
  const lessonId = Number(process.argv[2] || DEFAULT_LESSON_ID);
  const youtubeUrl = process.argv[3] || DEFAULT_URL;

  if (!Number.isInteger(lessonId) || lessonId <= 0) {
    throw new Error(`Invalid lesson id: ${process.argv[2]}`);
  }
  const youtubeId = extractYoutubeId(youtubeUrl);
  if (!youtubeId) throw new Error(`Cannot extract a YouTube id from: ${youtubeUrl}`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const before = await pool.query(
    `SELECT id, course_id, title, youtube_url, youtube_id, is_active FROM lessons WHERE id = $1`,
    [lessonId]
  );
  if (before.rowCount === 0) {
    await pool.end();
    throw new Error(`Lesson ${lessonId} not found`);
  }
  console.log('BEFORE:', before.rows[0]);

  const after = await pool.query(
    `UPDATE lessons
        SET youtube_url = $2, youtube_id = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, title, youtube_url, youtube_id`,
    [lessonId, youtubeUrl, youtubeId]
  );
  console.log('AFTER: ', after.rows[0]);
  console.log(`Embed URL: https://www.youtube.com/embed/${youtubeId}?rel=0`);

  await pool.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
