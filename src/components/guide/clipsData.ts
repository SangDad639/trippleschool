// ── คลิปบนหน้า /guide ─────────────────────────────────────────────────────
//
// วิธีใส่คลิป: เอาลิงก์ YouTube มาวางในช่อง `url` ของสล็อตที่ต้องการ แล้วใส่ชื่อคลิป
// ที่ `title` — ช่องที่ยังว่างจะแสดงเป็นกรอบประ "รอใส่คลิป" ไว้ก่อน
//
//   {
//     id: 'clip-1',
//     title: 'วิธีใช้งาน Triple School',
//     url: 'https://youtu.be/q9d9Bp1Fyp8',
//     links: [{ label: 'ไฟล์แนบ', url: 'https://docs.google.com/...' }],   // ปุ่มใต้การ์ด ไม่ใส่ก็ได้
//   },
//
// ลิงก์ YouTube ใส่ได้ทุกแบบ: watch?v=... / youtu.be/... / embed/... / shorts/...
// ภาพปกดึงจาก YouTube ให้อัตโนมัติ (อยากใช้ภาพเอง ใส่ `thumbnail: '/ชื่อไฟล์.jpg'`)
// อยากได้กี่ช่อง เพิ่ม/ลบบรรทัดใน CLIPS ได้เลย ลำดับในอาร์เรย์ = ลำดับที่แสดงบนหน้า

export type GuideClip = {
  /** ใช้เป็น key ของการ์ด ต้องไม่ซ้ำกัน */
  id: string;
  /** ชื่อคลิป — เว้นว่างได้ถ้ายังไม่ใส่คลิป */
  title?: string;
  /** บรรทัดเล็กใต้ชื่อคลิป (ไม่ใส่ก็ได้) */
  subtitle?: string;
  /** ลิงก์ YouTube — เว้นว่าง = ช่องว่างรอใส่คลิป */
  url?: string;
  /** ใส่เพื่อทับภาพปกที่ดึงมาจาก YouTube */
  thumbnail?: string;
  /** ปุ่มลิงก์ใต้การ์ด — กดแล้วเปิดแท็บใหม่ ใส่กี่ปุ่มก็ได้ (ไม่ใส่ = ไม่มีปุ่ม) */
  links?: { label: string; url: string }[];
};

export const CLIPS: GuideClip[] = [
  // ── ตัวอย่างการวางคลิป: ใส่ title + url แค่นี้พอ ที่เหลือระบบจัดการเอง ──
  {
    id: 'clip-1',
    title: 'Ep 6. คู่มือการเชื่อมต่อ YouTube',
    subtitle: 'Triple Next Guide',
    url: 'https://www.youtube.com/watch?v=I_e7yTGM9Qk',
    links: [{ label: 'ดูบน YouTube', url: 'https://www.youtube.com/watch?v=I_e7yTGM9Qk' }],
  },
  { id: 'clip-2', title: '', url: '' },
  { id: 'clip-3', title: '', url: '' },
  { id: 'clip-4', title: '', url: '' },
  { id: 'clip-5', title: '', url: '' },
  { id: 'clip-6', title: '', url: '' },
  { id: 'clip-7', title: '', url: '' },
  { id: 'clip-8', title: '', url: '' },
];

/** ช่องนี้ใส่คลิปแล้วหรือยัง */
export const hasClip = (clip: GuideClip): boolean => !!clip.url?.trim();

/** ดึง video id 11 ตัวจากลิงก์ YouTube ทุกรูปแบบ — คืน null ถ้าไม่ใช่ลิงก์ YouTube */
export function youtubeId(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/** ภาพปกความละเอียดสูง (ถ้าคลิปไม่มี maxres จะถอยไป hqdefault ตอน onError) */
export function clipThumbnail(clip: GuideClip): string | null {
  if (clip.thumbnail) return clip.thumbnail;
  const id = youtubeId(clip.url);
  return id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : null;
}

/** ลิงก์ embed แบบไม่เก็บคุกกี้ + ตัดแบรนด์ YouTube ออกให้มากที่สุด */
export function clipEmbedUrl(clip: GuideClip, autoplay = true): string {
  const id = youtubeId(clip.url);
  if (!id) return clip.url || '';
  const params = `rel=0&modestbranding=1&playsinline=1&iv_load_policy=3${autoplay ? '&autoplay=1' : ''}`;
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}
