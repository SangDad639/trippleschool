import {
  Rocket,
  CreditCard,
  GraduationCap,
  Gift,
  UserCog,
  LifeBuoy,
  type LucideIcon,
} from 'lucide-react';

// ── โครงสร้างข้อมูลของ "คู่มือการใช้งาน" (/guide) ─────────────────────────
// หน้านี้เป็นหน้าสาธารณะ 100% — ไม่มี tab ในเมนู, ไม่เช็ค login, ไม่เช็คสมาชิก
// ใครเปิดลิงก์ก็อ่านได้ทั้งหมด เนื้อหาทั้งหมดเป็น static (ไม่ยิง API)
// อยากเพิ่ม/แก้คู่มือ → แก้ไฟล์ใน src/components/guide/docs/*.ts

/** ข้อความสองภาษา — ใช้คู่กับ `l()` เหมือนหน้าอื่นในเว็บ */
export type Localized = { th: string; en: string };

/** ใครทำสิ่งที่คู่มือนี้อธิบายได้ (ตัวคู่มือเองอ่านฟรีทุกคน) */
export type GuideAccess = 'everyone' | 'login' | 'member';

/** บล็อกเนื้อหาในคู่มือ 1 หน้า — เรนเดอร์โดย GuideBlocks.tsx */
export type GuideBlock =
  /** ย่อหน้าธรรมดา */
  | { kind: 'para'; body: Localized }
  /** หัวข้อย่อย — จะถูกเก็บเป็นสารบัญ (TOC) ด้านขวาอัตโนมัติ */
  | { kind: 'heading'; body: Localized }
  /** ขั้นตอน 1-2-3 แสดงเป็นไทม์ไลน์ */
  | { kind: 'steps'; items: { title: Localized; body?: Localized }[] }
  /** รายการ — check = ได้/ทำได้, cross = ไม่ได้, dot = กลางๆ */
  | { kind: 'list'; tone?: 'check' | 'cross' | 'dot'; title?: Localized; items: Localized[] }
  /** กล่องเน้น — info = ข้อมูล, warn = ต้องระวัง, tip = เคล็ดลับ */
  | { kind: 'callout'; tone: 'info' | 'warn' | 'tip'; title?: Localized; body: Localized }
  /** ตารางเปรียบเทียบ (คอลัมน์แรกคือหัวแถว) */
  | { kind: 'table'; cols: Localized[]; rows: Localized[][] }
  /** คำถาม-คำตอบ แบบพับเก็บได้ */
  | { kind: 'faq'; items: { q: Localized; a: Localized }[] }
  /** วิดีโอ YouTube — กดที่ภาพปกแล้วค่อยโหลด iframe */
  | { kind: 'video'; title: Localized; url: string }
  /** ปุ่มลิงก์ — `to` = ลิงก์ในเว็บ, `href` = ลิงก์ภายนอก (เปิดแท็บใหม่) */
  | { kind: 'links'; items: { label: Localized; to?: string; href?: string }[] };

export const GUIDE_CATEGORIES = [
  {
    id: 'start',
    icon: Rocket,
    label: { th: 'เริ่มต้นใช้งาน', en: 'Getting started' },
    blurb: { th: 'สมัครบัญชี และดูว่าอะไรใช้ได้ฟรี', en: 'Create an account and see what is free' },
  },
  {
    id: 'payment',
    icon: CreditCard,
    label: { th: 'แพ็กเกจ & ชำระเงิน', en: 'Plans & payment' },
    blurb: { th: 'เลือกแพ็กเกจ โอนเงิน อัปโหลดสลิป', en: 'Pick a plan, transfer, upload the slip' },
  },
  {
    id: 'learn',
    icon: GraduationCap,
    label: { th: 'การเรียน', en: 'Learning' },
    blurb: { th: 'ห้องเรียน ความคืบหน้า เอกสารประกอบ', en: 'Classroom, progress, materials' },
  },
  {
    id: 'perks',
    icon: Gift,
    label: { th: 'สิทธิ์สมาชิก', en: 'Member perks' },
    blurb: { th: 'โปรแกรมแจกฟรี และเนื้อหาอัปเดต', en: 'Free programs and update drops' },
  },
  {
    id: 'account',
    icon: UserCog,
    label: { th: 'บัญชี & รายได้', en: 'Account & payouts' },
    blurb: { th: 'อายุสมาชิก เอกสาร ค่าคอมมิชชั่น', en: 'Membership, documents, commission' },
  },
  {
    id: 'help',
    icon: LifeBuoy,
    label: { th: 'แก้ปัญหา & ติดต่อ', en: 'Troubleshooting & contact' },
    blurb: { th: 'ติดขัดตรงไหน เริ่มหาคำตอบที่นี่', en: 'Stuck? Start here' },
  },
] as const;

export type GuideCategoryId = (typeof GUIDE_CATEGORIES)[number]['id'];

export type GuideDoc = {
  /** ใช้เป็น URL: /guide/<slug> */
  slug: string;
  category: GuideCategoryId;
  icon: LucideIcon;
  title: Localized;
  /** 1-2 บรรทัดบนการ์ดในหน้ารวม */
  summary: Localized;
  /** เวลาอ่านโดยประมาณ (นาที) */
  minutes: number;
  access: GuideAccess;
  /** คำค้นเพิ่มเติม (สะกดผิดบ่อย / คำอังกฤษ) ให้ช่องค้นหาหาเจอ */
  keywords?: string[];
  blocks: GuideBlock[];
};

export const ACCESS_LABELS: Record<GuideAccess, Localized> = {
  everyone: { th: 'ทำได้ทุกคน', en: 'Anyone' },
  login: { th: 'ต้องเข้าสู่ระบบ', en: 'Sign-in required' },
  member: { th: 'สำหรับผู้มีสิทธิ์เรียน', en: 'Members & buyers' },
};
