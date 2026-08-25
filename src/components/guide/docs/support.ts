import { Wrench, MessageCircle } from 'lucide-react';
import type { GuideDoc } from '../guideTypes';

// หมวด "แก้ปัญหา & ติดต่อ" — ด่านแรกก่อนทักทีมงาน
export const SUPPORT_DOCS: GuideDoc[] = [
  {
    slug: 'troubleshooting',
    category: 'help',
    icon: Wrench,
    minutes: 4,
    access: 'everyone',
    keywords: ['ปัญหา', 'แก้ไข', 'error', 'เข้าไม่ได้', 'ลืมรหัสผ่าน', 'วิดีโอ', 'ค้าง'],
    title: { th: 'ปัญหาที่พบบ่อย และวิธีแก้เอง', en: 'Common problems and self-fixes' },
    summary: {
      th: 'รวมอาการที่เจอบ่อยที่สุด พร้อมวิธีแก้ที่ทำเองได้ก่อนทักทีมงาน',
      en: 'The issues we see most often, with fixes you can try before messaging the team',
    },
    blocks: [
      {
        kind: 'para',
        body: {
          th: 'ลองไล่ตามอาการด้านล่างก่อน ส่วนใหญ่แก้ได้ในไม่กี่นาที ถ้ายังไม่หายให้ทักทีมงานพร้อมบอกอาการ อีเมลที่ใช้ และภาพหน้าจอ จะช่วยได้เร็วขึ้นมาก',
          en: 'Work down the list below — most of these clear up in a couple of minutes. If nothing helps, message the team with the symptom, the email you use, and a screenshot.',
        },
      },
      {
        kind: 'faq',
        items: [
          {
            q: { th: 'เข้าสู่ระบบไม่ได้ / รหัสผ่านไม่ถูกต้อง', en: 'I cannot sign in' },
            a: {
              th: 'ตรวจว่าใช้อีเมลเดิมที่สมัครไว้ (ถ้าเคยสมัครด้วย Google ให้กดปุ่ม Google แทนการกรอกรหัสผ่าน) ตรวจแป้น Caps Lock และภาษาแป้นพิมพ์ ถ้าลืมรหัสผ่าน ให้ทักทีมงานเพื่อขอตั้งรหัสใหม่ เพราะระบบยังไม่มีปุ่มรีเซ็ตด้วยตัวเอง',
              en: 'Check you are using the email you registered with — if you signed up with Google, use the Google button instead of a password. Watch Caps Lock and keyboard language. There is no self-serve reset yet, so message the team to have your password changed.',
            },
          },
          {
            q: { th: 'ค้างอยู่ที่หน้า "รอการอนุมัติ"', en: 'Stuck on the pending-approval screen' },
            a: {
              th: 'กดปุ่ม "ตรวจสอบสถานะ" อีกครั้ง ถ้ายังไม่ผ่านให้ออกจากระบบแล้วเข้าใหม่ ถ้ายังค้างอยู่ให้แจ้งทีมงานพร้อมอีเมลที่ใช้สมัคร',
              en: 'Press Check status again, then sign out and back in. If it still sticks, tell the team which email you registered with.',
            },
          },
          {
            q: { th: 'จ่ายเงินแล้วแต่ยังเข้าเรียนไม่ได้', en: 'I paid but still cannot watch' },
            a: {
              th: 'ถ้าสมัครสมาชิกและสลิปผ่านแล้ว ให้รีเฟรชหน้าหนึ่งครั้งหรือออกจากระบบแล้วเข้าใหม่ สิทธิ์จะอัปเดต ถ้าเป็นการซื้อคอร์สรายชิ้น ต้องรอแอดมินอนุมัติสลิปก่อน ดูสถานะได้ที่คอร์สของฉัน',
              en: 'For membership with a passed slip, refresh once or sign out and back in to pick up the new access. For a single-course purchase, an admin still needs to approve the slip — check the status in My Courses.',
            },
          },
          {
            q: { th: 'สลิปไม่ผ่านการตรวจสอบ', en: 'My slip keeps failing verification' },
            a: {
              th: 'เงื่อนไขที่พลาดบ่อยที่สุดคือสลิปเก่าเกิน 24 ชั่วโมง เคยใช้ยืนยันแล้ว หรือ QR ในภาพไม่ชัด ดูรายละเอียดทั้งหมดได้ในคู่มือสมัครสมาชิก',
              en: 'The usual causes: the slip is older than 24 hours, it was already used, or the QR is not sharp. The membership guide lists every condition.',
            },
          },
          {
            q: { th: 'ถูกเด้งไปหน้าสมัครสมาชิกเรื่อยๆ', en: 'The site keeps sending me to the subscribe page' },
            a: {
              th: 'เป็นอาการของสมาชิกหมดอายุ ต่ออายุแล้วจะกลับเข้าเรียนได้ทันที คอร์สที่ซื้อรายชิ้นไว้จะยังเข้าได้ตามเงื่อนไขวันที่ซื้อ',
              en: 'That means the membership expired. Renew and access returns immediately; courses you bought individually remain available under the terms at purchase.',
            },
          },
          {
            q: { th: 'วิดีโอไม่เล่น เล่นสะดุด หรือภาพดำ', en: 'Video will not play or stutters' },
            a: {
              th: 'รีเฟรชหนึ่งครั้ง ปิด VPN ปิดตัวบล็อกโฆษณาเฉพาะเว็บนี้ ลองสลับระหว่างไวไฟกับเน็ตมือถือ และลองเบราว์เซอร์อื่น (Chrome หรือ Safari เวอร์ชันใหม่) ถ้าเล่นบนมือถือแล้วเครื่องร้อน ให้ปิดแท็บอื่นก่อน',
              en: 'Refresh once, turn off VPN, allow this site in your ad blocker, switch between Wi-Fi and mobile data, and try another up-to-date browser. On a hot phone, close other tabs first.',
            },
          },
          {
            q: { th: 'เว็บเปลี่ยนเป็นภาษาอังกฤษเอง', en: 'The site switched itself to English' },
            a: {
              th: 'ครั้งแรกที่เข้า ระบบเดาภาษาจากประเทศที่เชื่อมต่อ กดปุ่ม TH บนแถบเมนูหนึ่งครั้ง ระบบจะจำค่าไว้ในเครื่องนี้และไม่เดาอีก',
              en: 'On a first visit the language is guessed from your connection country. Tap TH once and the choice is remembered on this device.',
            },
          },
          {
            q: { th: 'หน้าเว็บขาว หรือกดปุ่มแล้วไม่มีอะไรเกิดขึ้น', en: 'Blank page or buttons do nothing' },
            a: {
              th: 'มักเกิดจากไฟล์เวอร์ชันเก่าค้างในเครื่อง ให้รีเฟรชแบบล้างแคช (Ctrl + Shift + R บน Windows หรือ Cmd + Shift + R บน Mac) หรือลองเปิดในหน้าต่างไม่ระบุตัวตน',
              en: 'Usually a stale cached build. Do a hard refresh (Ctrl + Shift + R on Windows, Cmd + Shift + R on Mac) or open the site in a private window.',
            },
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: { th: 'ทางลัดที่ได้ผลเกือบทุกอาการ', en: 'The fix that works most often' },
        body: {
          th: 'ออกจากระบบ ปิดแท็บทั้งหมด เปิดเว็บใหม่ แล้วเข้าสู่ระบบอีกครั้ง วิธีนี้แก้อาการสิทธิ์ไม่อัปเดตและข้อมูลค้างได้เกือบทั้งหมด',
          en: 'Sign out, close every tab, reopen the site, and sign in again. That clears most stale-access and stale-data problems.',
        },
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'คู่มือสลิปและการชำระเงิน', en: 'Payment and slip guide' }, to: '/guide/subscribe-transfer' },
          { label: { th: 'วิธีติดต่อทีมงาน', en: 'How to reach the team' }, to: '/guide/contact-support' },
        ],
      },
    ],
  },
  {
    slug: 'contact-support',
    category: 'help',
    icon: MessageCircle,
    minutes: 2,
    access: 'everyone',
    keywords: ['ติดต่อ', 'แอดมิน', 'แชท', 'support', 'contact', 'ทีมงาน'],
    title: { th: 'ติดต่อทีมงาน', en: 'Contact the team' },
    summary: {
      th: 'ทักผู้ช่วยในหน้าคอร์ส และส่งต่อให้แอดมินตัวจริงเมื่อต้องการ',
      en: 'Message the in-course assistant, then escalate to a human admin when needed',
    },
    blocks: [
      {
        kind: 'para',
        body: {
          th: 'ช่องทางหลักคือแชทที่อยู่มุมขวาล่างของหน้าคอร์ส ใช้ได้ทุกคนแม้ยังไม่ได้จ่ายเงิน เริ่มจากถามผู้ช่วย AI ("น้องทริปเปิ้ล") ได้เลย ถ้าเรื่องต้องให้คนตอบ ให้กดส่งต่อให้แอดมิน',
          en: 'The main channel is the chat bubble at the bottom-right of any course page — open to everyone, paid or not. Start with the AI assistant, then escalate when a human is needed.',
        },
      },
      {
        kind: 'steps',
        items: [
          {
            title: { th: 'เปิดหน้าคอร์สอะไรก็ได้', en: 'Open any course page' },
            body: {
              th: 'แชทจะผูกกับคอร์สนั้น ทำให้ผู้ช่วยตอบเรื่องเนื้อหาคอร์สได้ตรงกว่า',
              en: 'The thread is scoped to that course, so answers about its content are more accurate.',
            },
          },
          {
            title: { th: 'กดปุ่มแชทมุมขวาล่าง', en: 'Tap the chat bubble' },
            body: {
              th: 'พิมพ์คำถามได้เลย และแนบภาพหน้าจอได้ด้วย (ไฟล์ไม่เกิน 5MB) ซึ่งช่วยเรื่องปัญหาการชำระเงินมาก',
              en: 'Type your question and attach a screenshot if useful (up to 5MB) — very handy for payment issues.',
            },
          },
          {
            title: { th: 'ต้องการคนตอบ กด "คุยกับแอดมิน"', en: 'Need a human? Escalate' },
            body: {
              th: 'ปุ่มนี้อยู่ล่างสุดของกล่องแชท กดแล้วสถานะจะเปลี่ยนเป็น "รอทีมงานตอบ" และเปลี่ยนเป็น "ทีมงานตอบแล้ว" เมื่อมีคำตอบ',
              en: 'The button sits at the bottom of the chat. The thread switches to waiting-for-team, then to answered once someone replies.',
            },
          },
          {
            title: { th: 'กลับมาดูคำตอบในแชทเดิม', en: 'Check back in the same thread' },
            body: {
              th: 'คำตอบจะอยู่ในแชทเดิม เปิดหน้าคอร์สนั้นแล้วกดปุ่มแชทเพื่ออ่านต่อได้ทุกเมื่อ',
              en: 'Replies land in that same thread — reopen the course page and the chat to read them any time.',
            },
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: { th: 'บอก 3 อย่างนี้ ได้คำตอบเร็วขึ้น', en: 'Three things that speed up a reply' },
        body: {
          th: 'อีเมลที่ใช้เข้าระบบ อาการที่เจอ (พร้อมข้อความ error ที่เห็น) และภาพหน้าจอ ถ้าเป็นเรื่องการชำระเงิน แนบสลิปและบอกวันเวลาที่โอนด้วย',
          en: 'Your sign-in email, the exact symptom or error text, and a screenshot. For payments, attach the slip and say when you transferred.',
        },
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'เปิดคอร์สเพื่อเริ่มแชท', en: 'Open a course to start a chat' }, to: '/courses' },
          { label: { th: 'ลองแก้เองก่อน', en: 'Try the self-fixes first' }, to: '/guide/troubleshooting' },
        ],
      },
    ],
  },
];
