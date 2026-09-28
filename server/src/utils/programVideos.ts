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

function trimmed(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export type ProgramVideoValues = { title: string; url: string; is_active: boolean };

/** Shared body parser for create/update. Returns an error string when unusable. */
export function readProgramVideoBody(body: any): { error?: string; values?: ProgramVideoValues } {
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url) return { error: 'ต้องใส่ลิงก์คลิป' };
  if (url.length > PROGRAM_VIDEO_URL_MAX) return { error: 'ลิงก์คลิปยาวเกินไป' };
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
