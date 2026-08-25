import { UserPlus, Unlock } from 'lucide-react';
import type { GuideDoc } from '../guideTypes';

// หมวด "เริ่มต้นใช้งาน" — สองเรื่องที่คนใหม่ถามบ่อยที่สุด
export const START_DOCS: GuideDoc[] = [
  {
    slug: 'getting-started',
    category: 'start',
    icon: UserPlus,
    minutes: 3,
    access: 'everyone',
    keywords: ['สมัคร', 'ลงทะเบียน', 'login', 'register', 'google', 'เข้าสู่ระบบ'],
    title: { th: 'สมัครบัญชีและเข้าสู่ระบบ', en: 'Create an account and sign in' },
    summary: {
      th: 'สร้างบัญชีฟรีด้วยอีเมลหรือ Google — ยังไม่ต้องจ่ายเงินก็เข้าใช้งานได้',
      en: 'Create a free account with email or Google — no payment needed to get in',
    },
    blocks: [
      {
        kind: 'para',
        body: {
          th: 'บัญชี Triple School สร้างฟรีและใช้ได้ทันที ไม่ต้องสมัครแพ็กเกจก่อน มีบัญชีแล้วจะเห็นคอร์สทั้งหมด ดูบทเรียนตัวอย่าง และเก็บประวัติการเรียนของตัวเองได้',
          en: 'A Triple School account is free and works right away — no plan needed first. With an account you can browse every course, watch preview lessons, and keep your own learning history.',
        },
      },
      {
        kind: 'steps',
        items: [
          {
            title: { th: 'เปิดหน้าสมัครสมาชิก', en: 'Open the sign-up page' },
            body: {
              th: 'กดปุ่ม "สมัครสมาชิก" มุมขวาบน แล้วเลือก "สมัครสมาชิก" ใต้ฟอร์ม หรือเข้าลิงก์ /register ตรงๆ',
              en: 'Tap the top-right button, then choose Register under the form — or open /register directly.',
            },
          },
          {
            title: { th: 'กรอกอีเมลและรหัสผ่าน', en: 'Fill in email and password' },
            body: {
              th: 'ใส่รหัสผ่านให้ตรงกันทั้งสองช่อง ถ้าไม่ตรงระบบจะเตือนก่อนส่ง',
              en: 'Type the same password in both fields — the form warns you before submitting if they differ.',
            },
          },
          {
            title: { th: 'หรือใช้ Google ก็ได้', en: 'Or use Google instead' },
            body: {
              th: 'กดปุ่ม Google ใต้ฟอร์ม เร็วกว่าและไม่ต้องจำรหัสผ่านเพิ่ม อีเมล Google จะกลายเป็นบัญชีของคุณเลย',
              en: 'Use the Google button under the form — faster, and one less password to remember.',
            },
          },
          {
            title: { th: 'ถ้ามีลิงก์แนะนำจากเพื่อน', en: 'If a friend gave you a referral link' },
            body: {
              th: 'เปิดเว็บจากลิงก์ที่ลงท้ายด้วย ?ref=CODE แล้วสมัครในแท็บนั้นเลย ระบบจะผูกผู้แนะนำให้อัตโนมัติ ไม่ต้องกรอกโค้ดเอง',
              en: 'Open the link ending in ?ref=CODE and sign up in that same tab — the referrer is attached automatically.',
            },
          },
          {
            title: { th: 'เข้าสู่ระบบเสร็จ', en: 'You are in' },
            body: {
              th: 'ระบบจะพาไปหน้าคอร์สทั้งหมดทันที เลือกคอร์สที่สนใจ กดดูบทเรียนที่มีป้าย "ดูฟรี" ได้เลย',
              en: 'You land on the course catalog. Open any course and play the lessons tagged as free previews.',
            },
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: { th: 'ถ้าเจอหน้า "รอการอนุมัติ"', en: 'If you see the pending-approval screen' },
        body: {
          th: 'บัญชีใหม่ปกติใช้งานได้ทันที แต่บางบัญชี (ส่วนใหญ่เป็นบัญชีเก่า) จะขึ้นหน้ารอการอนุมัติ กดปุ่ม "ตรวจสอบสถานะ" อีกครั้ง ถ้ายังค้างอยู่ให้ทักทีมงานผ่านแชทในหน้าคอร์ส',
          en: 'New accounts are active immediately, but a few older ones land on the pending screen. Press Check status again — if it stays, message the team from the chat bubble on any course page.',
        },
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: { th: 'สลับภาษาไทย / อังกฤษ', en: 'Switch Thai / English' },
        body: {
          th: 'ปุ่ม TH / EN อยู่บนแถบเมนูด้านบน กดครั้งเดียวเปลี่ยนทั้งเว็บ และระบบจะจำค่าที่เลือกไว้ในเครื่องนี้',
          en: 'The TH / EN button sits in the top bar. One tap switches the whole site and the choice is remembered on this device.',
        },
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'ไปหน้าสมัครสมาชิก', en: 'Go to sign up' }, to: '/register' },
          { label: { th: 'เข้าสู่ระบบ', en: 'Sign in' }, to: '/login' },
        ],
      },
    ],
  },
  {
    slug: 'free-access',
    category: 'start',
    icon: Unlock,
    minutes: 2,
    access: 'everyone',
    keywords: ['ฟรี', 'free', 'ไม่จ่ายเงิน', 'ทดลอง', 'preview', 'ตัวอย่าง'],
    title: { th: 'ยังไม่จ่ายเงิน ใช้อะไรได้บ้าง', en: 'What you get without paying' },
    summary: {
      th: 'รายการทุกอย่างที่เปิดให้ใช้ฟรี และส่วนที่ต้องซื้อคอร์สหรือเป็นสมาชิกก่อน',
      en: 'Everything open for free, and the parts that need a purchase or membership',
    },
    blocks: [
      {
        kind: 'para',
        body: {
          th: 'เว็บนี้เปิดให้เดินดูได้เกือบทั้งหมดก่อนตัดสินใจจ่ายเงิน ด้านล่างคือเส้นแบ่งชัดๆ ว่าอะไรฟรี อะไรต้องมีสิทธิ์',
          en: 'Almost the entire site is browsable before you pay anything. Here is the clear line between free and paid.',
        },
      },
      {
        kind: 'list',
        tone: 'check',
        title: { th: 'ใช้ได้ฟรี ไม่ต้องเป็นสมาชิก', en: 'Free for everyone' },
        items: [
          { th: 'หน้าแรก — แถวคอร์สแนะนำ คอร์สใหม่ และคอร์สยอดนิยม', en: 'Home — recommended, new, and popular course rails' },
          { th: 'คอร์สทั้งหมด และคลัง Tip (คลิปสั้นจบในตอนเดียว)', en: 'The full course catalog and the Tip library (single-episode clips)' },
          { th: 'หน้ารายละเอียดคอร์ส — สารบัญบทเรียน สิ่งที่จะได้เรียนรู้ ผู้สอน และรีวิวจากผู้เรียน', en: 'Course detail pages — syllabus, outcomes, instructor, and learner reviews' },
          { th: 'บทเรียนที่ติดป้าย "ดูฟรี" เล่นได้เต็มบทโดยไม่ต้องจ่าย', en: 'Any lesson tagged as a free preview plays in full' },
          { th: 'ค้นหาคอร์สและ Tip จากช่องค้นหาบนแถบเมนู', en: 'Search courses and tips from the top bar' },
          { th: 'หน้าแพ็กเกจและราคา ดูเงื่อนไขทุกแบบก่อนตัดสินใจ', en: 'The pricing page with all plan terms' },
          { th: 'หน้าโปรแกรมสำหรับสมาชิก ดูรายละเอียดและภาพหน้าจอได้ (ดาวน์โหลดต้องเป็นสมาชิก)', en: 'The member programs page — details and screenshots (downloads need membership)' },
          { th: 'แชทถามผู้ช่วย AI ในหน้าคอร์ส และส่งต่อให้ทีมงานตอบ', en: 'The AI assistant chat on course pages, including escalation to a human' },
          { th: 'คู่มือทุกหน้าในศูนย์ช่วยเหลือนี้', en: 'Every article in this help center' },
        ],
      },
      {
        kind: 'list',
        tone: 'cross',
        title: { th: 'ต้องซื้อคอร์ส หรือเป็นสมาชิกก่อน', en: 'Needs a purchase or membership' },
        items: [
          { th: 'บทเรียนที่ไม่ได้ติดป้าย "ดูฟรี" — จะขึ้นไอคอนกุญแจล็อกไว้', en: 'Lessons without the free tag — they show a lock icon' },
          { th: 'เอกสารประกอบและไฟล์แนบของแต่ละบทเรียน', en: 'Lesson materials and attached files' },
          { th: 'บันทึกความคืบหน้าและปุ่ม "เรียนจบบทนี้"', en: 'Progress tracking and the mark-complete button' },
          { th: 'ดาวน์โหลดโปรแกรมสำหรับสมาชิก เช่น Triple Voice', en: 'Downloading member programs such as Triple Voice' },
          { th: 'คอร์สใหม่ที่เพิ่มเข้ามาภายหลัง (สิทธิ์ของสมาชิกรายเดือน / รายปี)', en: 'Courses added later — a monthly/yearly member benefit' },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: { th: 'วิธีลองก่อนซื้อที่คุ้มที่สุด', en: 'The smartest way to try first' },
        body: {
          th: 'เปิดหน้าคอร์สที่สนใจ เลื่อนไปส่วน "เนื้อหาคอร์ส" แล้วมองหาบทที่มีป้าย "ดูฟรี" กดเล่นได้เต็มบท ทำให้เห็นทั้งวิธีสอนและคุณภาพงานจริงก่อนจ่ายเงิน',
          en: 'Open a course, scroll to the syllabus, and look for lessons tagged as free previews. They play in full, so you can judge the teaching style and production quality before paying.',
        },
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'ดูคอร์สทั้งหมด', en: 'Browse courses' }, to: '/courses' },
          { label: { th: 'คลัง Tip', en: 'Tip library' }, to: '/tips' },
          { label: { th: 'แพ็กเกจและราคา', en: 'Plans & pricing' }, to: '/pricing' },
        ],
      },
    ],
  },
];
