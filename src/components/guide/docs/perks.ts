import { Download } from 'lucide-react';
import type { GuideDoc } from '../guideTypes';

// หมวด "สิทธิ์สมาชิก" — คลังโปรแกรมที่แจกให้สมาชิก
export const PERKS_DOCS: GuideDoc[] = [
  {
    slug: 'member-programs',
    category: 'perks',
    icon: Download,
    minutes: 3,
    access: 'member',
    keywords: ['โปรแกรม', 'program', 'ดาวน์โหลด', 'download', 'triple voice', 'พากย์เสียง', 'tts'],
    title: { th: 'ดาวน์โหลดโปรแกรมสำหรับสมาชิก', en: 'Download the member programs' },
    summary: {
      th: 'คลังโปรแกรมที่แจกฟรีให้สมาชิก เช่น Triple Voice สำหรับพากย์เสียง AI บนเครื่องตัวเอง',
      en: 'Tools included with membership, such as Triple Voice for on-device AI narration',
    },
    blocks: [
      {
        kind: 'para',
        body: {
          th: 'หน้าโปรแกรมเปิดให้ทุกคนเข้าไปดูรายละเอียด ภาพหน้าจอ และคลิปตัวอย่างได้ แต่ปุ่มดาวน์โหลดสงวนไว้สำหรับสมาชิกรายเดือนและรายปี',
          en: 'Anyone can open the programs page to read details, screenshots, and demo clips — the download buttons are reserved for monthly and yearly members.',
        },
      },
      {
        kind: 'steps',
        items: [
          {
            title: { th: 'เปิดหน้าโปรแกรม', en: 'Open the programs page' },
            body: {
              th: 'กดเมนู Program บนแถบด้านบน จะเห็นการ์ดโปรแกรมทั้งหมดที่แจกอยู่ตอนนี้',
              en: 'Use the Program menu in the top bar to see every tool currently offered.',
            },
          },
          {
            title: { th: 'กดการ์ดเพื่อดูรายละเอียด', en: 'Tap a card for details' },
            body: {
              th: 'หน้ารายละเอียดจะบอกความสามารถ ภาพหน้าจอ เวอร์ชัน และคลิปตัวอย่างการใช้งาน (ถ้ามี)',
              en: 'The detail page lists capabilities, screenshots, the version, and a demo clip when available.',
            },
          },
          {
            title: { th: 'เลือกปุ่มดาวน์โหลดตามระบบปฏิบัติการ', en: 'Pick the download for your OS' },
            body: {
              th: 'มีแยกสำหรับ Windows และ macOS กดปุ่มให้ตรงกับเครื่องที่จะติดตั้ง',
              en: 'Windows and macOS have separate buttons — pick the one matching the machine you will install on.',
            },
          },
          {
            title: { th: 'ติดตั้งและใช้งาน', en: 'Install and run' },
            body: {
              th: 'ไฟล์ติดตั้งมีขนาดใหญ่ ปล่อยให้โหลดจนจบก่อนเปิดไฟล์ ถ้า Windows หรือ macOS เตือนเรื่องผู้พัฒนา ให้เลือกอนุญาตให้รันต่อ',
              en: 'The installers are large, so let the download finish before opening it. If Windows or macOS warns about the developer, choose to allow it to run.',
            },
          },
        ],
      },
      { kind: 'heading', body: { th: 'Triple Voice ทำอะไรได้', en: 'What Triple Voice does' } },
      {
        kind: 'list',
        tone: 'check',
        items: [
          { th: 'สร้างเสียงพูดจากข้อความทั้งไทยและอังกฤษ มีเสียงชาย-หญิงหลายแบบ', en: 'Text-to-speech in Thai and English with several male and female voices' },
          { th: 'โคลนเสียงตัวเอง — อัดเสียงตัวอย่างแล้วให้ AI พูดด้วยน้ำเสียงของคุณ', en: 'Voice cloning — record a sample and let the AI speak in your voice' },
          { th: 'ทำงานออฟไลน์บนเครื่องของคุณ ข้อมูลไม่ถูกส่งขึ้นเน็ต', en: 'Runs offline on your machine — nothing is uploaded' },
          { th: 'ใช้ได้ไม่จำกัดจำนวนครั้ง ไม่มีค่าบริการรายครั้งเพิ่ม', en: 'Unlimited use with no per-use fees' },
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: { th: 'ลิงก์ดาวน์โหลดเปิดแท็บใหม่', en: 'Downloads open in a new tab' },
        body: {
          th: 'บางโปรแกรมฝากไฟล์ไว้บนบริการภายนอก ปุ่มจึงเปิดแท็บใหม่ให้ อย่าปิดแท็บนั้นจนกว่าไฟล์จะโหลดเสร็จ',
          en: 'Some installers are hosted externally, so the button opens a new tab. Leave that tab open until the file finishes downloading.',
        },
      },
      {
        kind: 'callout',
        tone: 'warn',
        title: { th: 'สิทธิ์นี้สำหรับสมาชิกเท่านั้น', en: 'Members only' },
        body: {
          th: 'โปรแกรมในหน้านี้แจกให้สมาชิกรายเดือนและรายปี ผู้ที่ซื้อคอร์สรายชิ้นจะยังไม่ได้รับสิทธิ์นี้',
          en: 'These tools ship with monthly and yearly membership. Single-course purchases do not include them.',
        },
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'ดูโปรแกรมทั้งหมด', en: 'See all programs' }, to: '/programs' },
          { label: { th: 'สมัครสมาชิก', en: 'Become a member' }, to: '/pricing' },
        ],
      },
    ],
  },
];
