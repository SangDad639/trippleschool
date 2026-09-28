/**
 * Input rules for program tutorial clips (/programs/:slug), shared by the
 * route and its tests. Kept free of DB imports so the tests run without one.
 */

export const PROGRAM_VIDEO_TITLE_MAX = 255;
export const PROGRAM_VIDEO_URL_MAX = 2048;
/** One page shows these as a clip picker under the player; past this it stops being a picker. */
export const PROGRAM_VIDEOS_MAX = 20;

/** Programs live in the frontend (programsData.ts), so the server only checks the slug's shape. */
export function isProgramSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
}

const INT4_MAX = 2147483647;

/** A program_videos id (SERIAL = int4). Anything else would make Postgres throw → 500 instead of 400/404. */
export function parseVideoId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= INT4_MAX ? id : null;
}

/**
 * Trim, drop NUL (Postgres rejects 0x00 in text) and cap by code points —
 * .slice() counts UTF-16 units and would cut an emoji in half.
 */
function trimmed(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(/\u0000/g, '').trim()).slice(0, max).join('');
}

export type ProgramVideoValues = { title: string; url: string; is_active: boolean };

/** Shared body parser for create/update. Returns an error string when unusable. */
export function readProgramVideoBody(body: any): { error?: string; values?: ProgramVideoValues } {
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url) return { error: 'ต้องใส่ลิงก์คลิป' };
  if (url.length > PROGRAM_VIDEO_URL_MAX) return { error: 'ลิงก์คลิปยาวเกินไป' };
  // Stripping a NUL out of a url would silently change where it points — reject instead.
  if (url.includes('\u0000')) return { error: 'ลิงก์คลิปไม่ถูกต้อง' };
  // http(s) only — the url ends up in an iframe / <video> src / href.
  if (!/^https?:\/\//i.test(url)) return { error: 'ลิงก์คลิปต้องขึ้นต้นด้วย http:// หรือ https://' };

  return {
    values: {
      title: trimmed(body?.title, PROGRAM_VIDEO_TITLE_MAX),
      url,
      is_active: body?.is_active !== false,
    },
  };
}
