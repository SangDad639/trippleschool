import {
  Monitor,
  Apple,
  WifiOff,
  Mic,
  Languages,
  Infinity as InfinityIcon,
  type LucideIcon,
} from 'lucide-react';

// ── ลิงก์ดาวน์โหลดตัวติดตั้ง ──────────────────────────────────────────────
// วางลิงก์ไฟล์ติดตั้งตรง `url` ด้านล่างได้เลย (หรือจะตั้งค่าเป็น env var
// VITE_TRIPLE_VOICE_WIN_URL / VITE_TRIPLE_VOICE_MAC_URL ตอน build ก็ได้)
// ถ้าเว้นว่างไว้ ปุ่มจะขึ้นสถานะปิดใช้งานเหมือนเดิม

export type ProgramDownload = {
  key: string;
  label: string;
  /** ชื่อสั้นๆ ไว้โชว์เป็นชิปแพลตฟอร์มบนการ์ด */
  platform: string;
  icon: LucideIcon;
  url: string;
};

export type ProgramFeature = { icon: LucideIcon; text: string };

export type ProgramHighlight = { label: string; sub: string };

export type Program = {
  slug: string;
  name: string;
  /** บรรทัดสั้นใต้ชื่อโปรแกรม */
  tagline: string;
  version: string;
  logo: string;
  /** ภาพหน้าปกบนการ์ดในหน้า /programs */
  thumbnail: string;
  /**
   * วิดีโอตัวอย่างการใช้งาน — วางลิงก์ YouTube หรือไฟล์ .mp4/.webm/.mov ตรงๆ ก็ได้
   * เว้นว่างไว้ = หน้ารายละเอียดจะโชว์แค่ภาพหน้าจอเหมือนเดิม
   */
  videoUrl?: string;
  /** ภาพประกอบในหน้ารายละเอียด */
  screenshots: { src: string; alt: string }[];
  /** ย่อหน้าอธิบายเต็มในหน้ารายละเอียด */
  summary: string;
  features: ProgramFeature[];
  highlights: ProgramHighlight[];
  downloads: ProgramDownload[];
};

export const PROGRAMS: Program[] = [
  {
    slug: 'triple-voice',
    name: 'Triple Voice',
    tagline: 'โปรแกรมพากย์เสียง AI บนเครื่องของคุณ',
    version: 'v1.0.0',
    logo: '/programs/triple-voice-mark.svg',
    thumbnail: '/programs/triple-voice-app.png',
    // 👇 วางลิงก์วิดีโอตัวอย่างตรงนี้ได้เลย (YouTube / .mp4 / .webm / .mov)
    videoUrl: import.meta.env.VITE_TRIPLE_VOICE_VIDEO_URL || '',
    screenshots: [
      { src: '/programs/triple-voice-app.png', alt: 'หน้าจอสร้างเสียงของโปรแกรม Triple Voice' },
      { src: '/programs/triple-voice-voices.png', alt: 'คลังเสียงไทยในโปรแกรม Triple Voice' },
    ],
    summary:
      'โปรแกรมสร้างเสียงพากย์ด้วย AI สำหรับครีเอเตอร์ — พิมพ์ข้อความแล้วได้ไฟล์เสียงคุณภาพสูงทันที ' +
      'ใช้พากย์คลิป ทำคอนเทนต์ ละครสั้น หรือวิดีโอรีวิวสินค้า โดยไม่ต้องอัดเสียงเอง ' +
      'และไม่ต้องจ่ายค่าบริการ TTS รายครั้งอีกต่อไป',
    features: [
      { icon: Languages, text: 'สร้างเสียงพูดจากข้อความ (Text-to-Speech) ทั้งภาษาไทยและอังกฤษ หลายเสียง ชาย-หญิง' },
      { icon: Mic, text: 'โคลนเสียงของคุณเอง — อัดเสียงตัวอย่างแล้วให้ AI พูดแทนด้วยน้ำเสียงของคุณ' },
      { icon: WifiOff, text: 'ทำงานออฟไลน์ 100% บนเครื่องของคุณ — ข้อมูลไม่ถูกส่งขึ้นเน็ต ปลอดภัยเต็มที่' },
      { icon: InfinityIcon, text: 'ใช้งานได้ไม่จำกัดจำนวนครั้ง ไม่มีค่าใช้จ่ายรายเดือนเพิ่ม — สิทธิ์สมาชิก Triple School' },
    ],
    highlights: [
      { label: 'เสียงไทย + อังกฤษ', sub: 'หลายเสียงให้เลือก' },
      { label: 'โคลนเสียงตัวเอง', sub: 'Voice Cloning ในตัว' },
      { label: 'ออฟไลน์ 100%', sub: 'ไม่ต้องต่ออินเทอร์เน็ต' },
      { label: 'ไม่จำกัดการใช้งาน', sub: 'ไม่มีค่าใช้จ่ายรายครั้ง' },
    ],
    downloads: [
      {
        key: 'windows',
        label: 'ดาวน์โหลด Windows',
        platform: 'Windows',
        icon: Monitor,
        url:
          import.meta.env.VITE_TRIPLE_VOICE_WIN_URL ||
          'https://www.mediafire.com/file/cgeolv2l9ves9xi/Triple_Voice.exe/file',
      },
      {
        key: 'macos',
        label: 'ดาวน์โหลด macOS',
        platform: 'macOS',
        icon: Apple,
        url:
          import.meta.env.VITE_TRIPLE_VOICE_MAC_URL ||
          'https://www.mediafire.com/file/wb7z1kyeoxujl2n/Triple_Voice.dmg/file',
      },
    ],
  },
];

export const getProgram = (slug?: string): Program | undefined =>
  PROGRAMS.find((p) => p.slug === slug);

// ลิงก์ที่ชี้ไป "ตัวไฟล์" ตรงๆ (ลงท้าย .exe/.msi/.dmg/.pkg/.zip) → กดแล้วโหลดทันที
// ส่วนลิงก์หน้าเว็บฝากไฟล์ (MediaFire/Drive) ชี้ไปหน้า HTML ไม่ใช่ไฟล์ ถ้าเปิดในแท็บเดิม
// ผู้ใช้จะหลุดออกจากเว็บเราไปเลย → ต้องเปิดแท็บใหม่แทน
// หมายเหตุ: MediaFire อย่าง `.../Triple_Voice.exe/file` ลงท้ายด้วย /file ไม่ใช่ .exe
// จึงถูกจัดเป็นลิงก์หน้าเว็บอย่างถูกต้อง
export const isDirectFileUrl = (url: string) => /\.(exe|msi|dmg|pkg|zip)(\?|$)/i.test(url);
