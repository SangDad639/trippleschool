/**
 * Input rules for program tutorial clips (/programs/:slug), shared by the
 * route and its tests. Kept free of DB imports so the tests run without one.
 */

export const PROGRAM_VIDEO_TITLE_MAX = 255;
export const PROGRAM_VIDEO_URL_MAX = 2048;
/** One page shows these as a clip picker under the player; past this it stops being a picker. */
export const PROGRAM_VIDEOS_MAX = 20;
/** Buttons under the player; more than a handful stops fitting on one row. Same cap as guide clips. */
export const PROGRAM_VIDEO_LINKS_MAX = 5;
export const PROGRAM_VIDEO_LINK_LABEL_MAX = 80;

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

export type ProgramVideoLink = { label: string; url: string };

export type ProgramVideoValues = {
  title: string;
  url: string;
  is_active: boolean;
  /** undefined = the caller did not send links → an update keeps the stored ones */
  links?: ProgramVideoLink[];
};

const DEFAULT_LINK_LABEL = 'คู่มือการใช้งาน';

/** http(s), or a path on this site ('/guide/...'); never '//host' (protocol-relative) or a script scheme. */
function isLinkUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url);
}

/** Manual buttons under a clip. Empty rows are dropped; a half-filled or unsafe row fails the save. */
function readLinks(raw: unknown): { error?: string; links?: ProgramVideoLink[] } {
  if (raw === undefined) return {};
  if (!Array.isArray(raw)) return { error: 'ลิงก์คู่มือต้องเป็นรายการ' };

  const links: ProgramVideoLink[] = [];
  for (const item of raw) {
    const label = trimmed((item as any)?.label, PROGRAM_VIDEO_LINK_LABEL_MAX);
    const url = typeof (item as any)?.url === 'string' ? (item as any).url.trim() : '';
    if (!label && !url) continue;
    if (!url) return { error: `ลิงก์คู่มือ "${label}" ยังไม่ได้ใส่ URL` };
    if (url.length > PROGRAM_VIDEO_URL_MAX || url.includes('\u0000') || !isLinkUrl(url)) {
      return { error: 'ลิงก์คู่มือต้องขึ้นต้นด้วย https:// (หรือ / สำหรับหน้าในเว็บนี้)' };
    }
    links.push({ label: label || DEFAULT_LINK_LABEL, url });
  }
  if (links.length > PROGRAM_VIDEO_LINKS_MAX) {
    return { error: `ใส่ลิงก์คู่มือได้สูงสุด ${PROGRAM_VIDEO_LINKS_MAX} ลิงก์ต่อคลิป` };
  }
  return { links };
}

/** Shared body parser for create/update. Returns an error string when unusable. */
export function readProgramVideoBody(body: any): { error?: string; values?: ProgramVideoValues } {
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url) return { error: 'ต้องใส่ลิงก์คลิป' };
  if (url.length > PROGRAM_VIDEO_URL_MAX) return { error: 'ลิงก์คลิปยาวเกินไป' };
  // Stripping a NUL out of a url would silently change where it points — reject instead.
  if (url.includes('\u0000')) return { error: 'ลิงก์คลิปไม่ถูกต้อง' };
  // http(s) only — the url ends up in an iframe / <video> src / href.
  if (!/^https?:\/\//i.test(url)) return { error: 'ลิงก์คลิปต้องขึ้นต้นด้วย http:// หรือ https://' };

  const { error, links } = readLinks(body?.links);
  if (error) return { error };

  return {
    values: {
      title: trimmed(body?.title, PROGRAM_VIDEO_TITLE_MAX),
      url,
      is_active: body?.is_active !== false,
      links,
    },
  };
}
