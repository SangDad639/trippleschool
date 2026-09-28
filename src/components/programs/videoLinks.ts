import { parseVideoUrl } from '@/lib/parseVideoUrl';

const DRIVE_FILE = /drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]{20,})/;

/** id ของไฟล์ Google Drive จากลิงก์แชร์ (/file/d/<id>/view หรือ open?id=<id>) */
export const driveFileId = (url: string): string | null => url.match(DRIVE_FILE)?.[1] ?? null;

/** ลิงก์ที่ ProgramVideo ฝังเล่นในหน้าได้ — นอกนั้นจะขึ้นเป็นปุ่มเปิดลิงก์แทน */
export const isEmbeddableVideoUrl = (url: string): boolean => {
  if (driveFileId(url)) return true;
  const { type } = parseVideoUrl(url);
  return type === 'youtube' || type === 'direct';
};
