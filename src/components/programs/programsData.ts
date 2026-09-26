import {
  Monitor,
  Apple,
  WifiOff,
  Mic,
  Languages,
  Music,
  Clock,
  Cpu,
  Library,
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
  /** กล่อง "เครื่องที่ใช้ได้" ในหน้ารายละเอียด (ไม่ใส่ = ไม่แสดง) */
  requirements?: string[];
  /** หมายเหตุใต้ปุ่มดาวน์โหลด เช่น มีเฉพาะ Windows */
  downloadNote?: string;
};

// ลิงก์ macOS ของ Triple Music — MediaFire ที่ user ให้ (26 ก.ย. 2026) เป็นหน้าเว็บ ไม่ใช่ไฟล์ตรง → เปิดแท็บใหม่
// ถ้าเว้นว่าง ปุ่มจะขึ้นแบบกดไม่ได้ + มีโน้ต "macOS เร็วๆ นี้" ใต้ปุ่ม (โน้ตหายเองเมื่อมีลิงก์)
const TRIPLE_MUSIC_MAC_URL =
  import.meta.env.VITE_TRIPLE_MUSIC_MAC_URL ||
  'https://www.mediafire.com/file/yqutomc45ggmnl3/TripleMusic-2.2.0-macOS-arm64.dmg/file';

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
  {
    // Triple Music (โปรเจกต์ yue-lab) — แอป Windows สร้างเพลงจากเนื้อร้องด้วย YuE2 · เพิ่ม 25 ก.ย. 2026
    slug: 'triple-music',
    name: 'Triple Music',
    tagline: 'โปรแกรมสร้างเพลง AI จากเนื้อร้องของคุณ',
    version: 'v2.1.0',
    logo: '/programs/triple-music-mark.svg',
    thumbnail: '/programs/triple-music-cover.png',
    // 👇 วางลิงก์วิดีโอตัวอย่างตรงนี้ได้เลย (YouTube / .mp4 / .webm / .mov)
    videoUrl: import.meta.env.VITE_TRIPLE_MUSIC_VIDEO_URL || '',
    screenshots: [
      { src: '/programs/triple-music-create.png', alt: 'หน้าสร้างเพลงของโปรแกรม Triple Music — เนื้อร้อง แนวเพลง ความยาว' },
      { src: '/programs/triple-music-settings.png', alt: 'หน้าตั้งค่าการประมวลผลของ Triple Music — เครื่องนี้ หรือ GPU บน Runpod' },
    ],
    summary:
      'พิมพ์เนื้อร้องกับแนวเพลงที่อยากได้ แล้วให้ AI แต่งทำนอง ร้อง และเรียบเรียงออกมาเป็นเพลงเต็มเพลงในไฟล์ MP3 ' +
      'ประมวลผลบนเครื่องของคุณเอง หรือใช้ GPU บน Runpod เมื่อเครื่องไม่แรงพอ ไม่ต้องติดตั้ง ComfyUI ไม่ต้องรู้เรื่อง Python ' +
      '— เหมาะกับทำเพลงประกอบคลิป เพลงโฆษณา หรือเพลงของตัวเอง',
    features: [
      { icon: Music, text: 'เขียนเนื้อร้องแบ่งท่อน [Verse] [Chorus] บอกแนวเพลง เครื่องดนตรี อารมณ์ → ได้เพลงพร้อมเสียงร้องเป็น MP3' },
      { icon: Clock, text: 'เลือกความยาว 1 / 2 / 3 นาที มี preset แนวเพลง (Acoustic pop, Lo-fi, Cinematic, Indie rock) และตั้งค่าขั้นสูงได้ (Seed, โน้ต ABC) สำหรับคนอยากคุมเอง' },
      { icon: Cpu, text: 'ประมวลผลบนเครื่อง (Auto / CPU / การ์ดจอ NVIDIA) หรือต่อ GPU บน Runpod — คอมไม่มีการ์ดจอก็ทำเพลงได้' },
      { icon: Library, text: 'คลังเพลงส่วนตัว ฟัง ค้นหา ดาวน์โหลด มีเครื่องเล่นในตัว และเห็นสถานะงานที่กำลังสร้างครบทุกขั้น' },
      { icon: InfinityIcon, text: 'ใช้ได้ไม่จำกัดจำนวนเพลง ไม่มีค่าใช้จ่ายรายครั้ง — Login ด้วยบัญชี Triple School ที่เป็นสมาชิก' },
    ],
    highlights: [
      { label: 'เพลงเต็ม 1–3 นาที', sub: 'พร้อมเสียงร้อง ไม่ใช่แค่ดนตรี' },
      { label: 'เครื่องคุณ หรือ Runpod', sub: 'เลือกที่ประมวลผลได้' },
      { label: 'ส่งออก MP3', sub: 'เอาไปใช้ในคลิปได้ทันที' },
      { label: 'ไม่จำกัดจำนวนเพลง', sub: 'ไม่มีค่าใช้จ่ายรายครั้ง' },
    ],
    requirements: [
      'Windows 10 / 11 แบบ 64-bit · ตัวติดตั้ง 30 MB ไม่ต้องลง Python เอง',
      // ไฟล์ .dmg เป็น arm64 → รันบน Mac รุ่น Intel ไม่ได้
      'macOS: เฉพาะ Mac ชิป Apple Silicon (M1 ขึ้นไป) · Mac รุ่น Intel ใช้ไม่ได้',
      'สร้างบนเครื่อง: การ์ดจอ NVIDIA ที่รองรับ BF16 (RTX 30 ซีรีส์ขึ้นไป) หรือใช้ CPU ได้แต่ช้ามาก · ครั้งแรกดาวน์โหลดโมเดลประมาณ 7.8 GB (เผื่อพื้นที่ราว 10 GB)',
      'ไม่มีการ์ดจอ: เช่า GPU บน Runpod แล้วใส่ URL ของ Pod ในแอป (ค่าเช่าคิดกับ Runpod แยกต่างหาก)',
    ],
    downloadNote: TRIPLE_MUSIC_MAC_URL ? undefined : 'ตอนนี้ดาวน์โหลดได้เฉพาะ Windows · macOS เร็วๆ นี้',
    downloads: [
      {
        key: 'windows',
        label: 'ดาวน์โหลด Windows',
        platform: 'Windows',
        icon: Monitor,
        // โฟลเดอร์ Google Drive ที่ user ให้ (25 ก.ย. 2026) — เป็นหน้าเว็บ ไม่ใช่ไฟล์ตรง → เปิดแท็บใหม่
        // (ตัด /u/0/ ออก เพื่อให้ลิงก์ไม่ผูกกับบัญชี Google ของคนเปิด)
        url:
          import.meta.env.VITE_TRIPLE_MUSIC_WIN_URL ||
          'https://drive.google.com/drive/folders/1BpFDS0fPPULKq1LtXkTrjF93H4Kn_0Yq',
      },
      {
        key: 'macos',
        label: 'ดาวน์โหลด macOS',
        platform: 'macOS',
        icon: Apple,
        url: TRIPLE_MUSIC_MAC_URL,
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
