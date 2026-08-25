import { PlayCircle, Compass } from 'lucide-react';
import type { GuideDoc } from '../guideTypes';

// หมวด "การเรียน" — ใช้งานห้องเรียน และหาเนื้อหาใหม่
export const LEARNING_DOCS: GuideDoc[] = [
  {
    slug: 'learn-course',
    category: 'learn',
    icon: PlayCircle,
    minutes: 4,
    access: 'member',
    keywords: ['เข้าเรียน', 'ห้องเรียน', 'ความคืบหน้า', 'progress', 'เอกสาร', 'material', 'บทเรียน'],
    title: { th: 'เข้าเรียนและติดตามความคืบหน้า', en: 'Watch lessons and track progress' },
    summary: {
      th: 'เริ่มเรียนจากคอร์สของฉัน กดจบบทเพื่อเก็บความคืบหน้า และดาวน์โหลดเอกสารประกอบ',
      en: 'Start from My Courses, mark lessons complete, and grab the lesson materials',
    },
    blocks: [
      {
        kind: 'para',
        body: {
          th: 'เมื่อมีสิทธิ์เข้าเรียนแล้ว (สมัครสมาชิก หรือซื้อคอร์สนั้นและได้รับอนุมัติ) บทเรียนทุกบทจะปลดล็อก และระบบจะเริ่มเก็บความคืบหน้าให้อัตโนมัติ',
          en: 'Once you have access — through membership or an approved course purchase — every lesson unlocks and your progress starts being saved automatically.',
        },
      },
      {
        kind: 'steps',
        items: [
          {
            title: { th: 'เปิด "คอร์สของฉัน"', en: 'Open My Courses' },
            body: {
              th: 'กดปุ่มคอร์สของฉันบนแถบเมนู จะเห็นแท็บ "กำลังเรียน" และ "เรียนจบ" พร้อมตัวเลขสรุปด้านบน',
              en: 'Use the My Courses button in the top bar. You get In-progress and Completed tabs with a summary row above them.',
            },
          },
          {
            title: { th: 'กดการ์ดคอร์สเพื่อเข้าห้องเรียน', en: 'Tap a course card to enter' },
            body: {
              th: 'ถ้าเคยเรียนไว้แล้ว ระบบจะพากลับไปบทเรียนล่าสุดที่ค้างไว้ทันที',
              en: 'If you have watched before, you are dropped straight back into the last lesson you left off at.',
            },
          },
          {
            title: { th: 'ดูวิดีโอ แล้วกด "เรียนจบบทนี้"', en: 'Watch, then mark the lesson complete' },
            body: {
              th: 'ปุ่มนี้อยู่ใต้ชื่อบทเรียน กดแล้วแถบความคืบหน้าด้านบนจะขยับ และบทนั้นจะมีเครื่องหมายถูกในสารบัญ',
              en: 'The button sits under the lesson title. Pressing it moves the progress bar and ticks the lesson in the syllabus.',
            },
          },
          {
            title: { th: 'ไปบทถัดไป', en: 'Move to the next lesson' },
            body: {
              th: 'ใช้ปุ่ม "บทถัดไป" ด้านล่างวิดีโอ หรือกดเลือกบทจากสารบัญด้านข้างก็ได้',
              en: 'Use the next-lesson button below the player, or pick any lesson from the sidebar.',
            },
          },
        ],
      },
      { kind: 'heading', body: { th: 'ของที่มีในห้องเรียน', en: 'What is in the classroom' } },
      {
        kind: 'list',
        tone: 'dot',
        items: [
          { th: 'สารบัญด้านข้าง — บางคอร์สแยกเป็นแท็บ "พื้นฐาน" และ "อัพเดท" ให้เนื้อหาใหม่ไม่ปนกับบทหลัก', en: 'A sidebar syllabus — some courses split it into Basics and Updates tabs so new drops stay separate' },
          { th: 'เอกสารประกอบ — กดดาวน์โหลดไฟล์ หรือเปิดโฟลเดอร์เอกสาร บางบทเป็นเอกสารอ่านในหน้าเว็บได้เลย', en: 'Lesson materials — download files, open a document folder, or read inline docs right on the page' },
          { th: 'แถบความคืบหน้าของคอร์ส บอกเปอร์เซ็นต์ที่เรียนไปแล้ว', en: 'A course progress bar showing how far you are' },
          { th: 'แถว "เรียนต่อของฉัน" บนหน้าแรก พาไปบทที่ค้างไว้ในคลิกเดียว', en: 'A Continue rail on the home page that jumps back to where you stopped' },
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: { th: 'ดูตัวอย่างอยู่ ความคืบหน้าจะไม่ถูกบันทึก', en: 'Preview mode does not save progress' },
        body: {
          th: 'ถ้ายังไม่มีสิทธิ์เข้าเรียน หน้าห้องเรียนจะขึ้นแถบสีเหลืองว่ากำลังดูตัวอย่างคอร์ส เล่นได้เฉพาะบทที่เปิดให้ดูฟรี และจะไม่มีปุ่มเก็บความคืบหน้า',
          en: 'Without access the classroom shows a yellow preview notice: only free lessons play and there is no progress button.',
        },
      },
      {
        kind: 'faq',
        items: [
          {
            q: { th: 'วิดีโอหมุนค้าง เล่นไม่ขึ้น', en: 'The video spins and never plays' },
            a: {
              th: 'ลองรีเฟรชหน้าหนึ่งครั้ง ถ้ายังไม่ขึ้นให้สลับเครือข่าย (มือถือ/ไวไฟ) ปิด VPN และปิดตัวบล็อกโฆษณาเฉพาะเว็บนี้ วิดีโอบางบทเล่นผ่านผู้ให้บริการภายนอกที่อาจถูกบล็อก',
              en: 'Refresh once. If it persists, switch network (mobile data vs Wi-Fi), turn off VPN, and allow this site in your ad blocker — some lessons stream through an external provider that blockers catch.',
            },
          },
          {
            q: { th: 'กดจบบทแล้วแต่ความคืบหน้าไม่ขยับ', en: 'I marked it complete but progress did not move' },
            a: {
              th: 'ตรวจว่าคุณยังเข้าสู่ระบบอยู่ (ถ้าทิ้งหน้าไว้นานอาจหลุด) รีเฟรชแล้วเข้าใหม่ ถ้ายังไม่ขยับ ให้ทักทีมงานพร้อมบอกชื่อคอร์สและบทเรียน',
              en: 'Check you are still signed in — a long-idle tab can drop the session. Refresh and try again; if it still sticks, message the team with the course and lesson name.',
            },
          },
          {
            q: { th: 'ทำไมเปิดบทเรียนแล้วเด้งไปหน้าสมัครสมาชิก', en: 'Why do I get bounced to the subscribe page' },
            a: {
              th: 'แปลว่าอายุสมาชิกหมดแล้ว ต่ออายุอีกครั้งเพื่อเข้าเรียนต่อ ความคืบหน้าที่เก็บไว้ไม่หายไปไหน',
              en: 'Your membership has expired. Renew to continue — your saved progress stays intact.',
            },
          },
        ],
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'คอร์สของฉัน', en: 'My courses' }, to: '/app/my-courses' },
          { label: { th: 'ดูคอร์สทั้งหมด', en: 'Browse courses' }, to: '/courses' },
        ],
      },
    ],
  },
  {
    slug: 'find-new-content',
    category: 'learn',
    icon: Compass,
    minutes: 2,
    access: 'everyone',
    keywords: ['อัปเดต', 'update', 'tip', 'ของใหม่', 'ค้นหา', 'search'],
    title: { th: 'หาเนื้อหาใหม่และคลิปสอนได้ที่ไหน', en: 'Where to find new content' },
    summary: {
      th: 'สี่ที่ที่ของใหม่ลง — หน้าแรก คลัง Tip หน้าอัปเดต และแท็บอัพเดทในคอร์ส',
      en: 'The four places new material lands — home, tips, updates, and the Updates tab in a course',
    },
    blocks: [
      {
        kind: 'list',
        tone: 'dot',
        items: [
          { th: 'หน้าแรก — แถว "มาใหม่" และคอร์สแนะนำ อัปเดตตามของที่เพิ่งเปิด', en: 'Home — the newest rail and recommendations track whatever just launched' },
          { th: 'คลัง Tip — คลิปสั้นจบในตอนเดียว เหมาะกับการเก็บเทคนิคเร็วๆ', en: 'Tip library — single-episode clips for quick techniques' },
          { th: 'หน้าอัปเดต (/update) — คู่มือและคลิปสอนที่ทีมงานทยอยลง เรียงใหม่สุดไว้บนสุด', en: 'The updates page (/update) — guides and tutorial clips, newest first' },
          { th: 'ในคอร์สที่มีแท็บ "อัพเดท" — บทเรียนใหม่ของคอร์สนั้นจะถูกแยกไว้ในแท็บนี้', en: 'Inside a course with an Updates tab — fresh lessons for that course land there' },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: { th: 'ค้นหาเร็วกว่าไล่ดู', en: 'Search beats scrolling' },
        body: {
          th: 'กดไอคอนแว่นขยายบนแถบเมนู พิมพ์คำเดียวก็ได้ ระบบค้นทั้งชื่อคอร์ส คำอธิบาย และชื่อผู้สอนพร้อมกัน',
          en: 'Tap the magnifier in the top bar — one keyword searches course names, descriptions, and instructors at once.',
        },
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'หน้าอัปเดตล่าสุด', en: 'Latest updates' }, to: '/update' },
          { label: { th: 'คลัง Tip', en: 'Tip library' }, to: '/tips' },
        ],
      },
    ],
  },
];
