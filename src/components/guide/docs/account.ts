import { Users, IdCard } from 'lucide-react';
import type { GuideDoc } from '../guideTypes';

// หมวด "บัญชี & รายได้" — ระบบแนะนำเพื่อน และการจัดการบัญชี/เอกสาร
export const ACCOUNT_DOCS: GuideDoc[] = [
  {
    slug: 'affiliate-basics',
    category: 'account',
    icon: Users,
    minutes: 4,
    access: 'login',
    keywords: ['affiliate', 'พันธมิตร', 'ค่าคอม', 'คอมมิชชั่น', 'แนะนำเพื่อน', 'refcode', 'ถอนเงิน'],
    title: { th: 'แนะนำเพื่อน รับค่าคอมมิชชั่น', en: 'Refer friends and earn commission' },
    summary: {
      th: 'คัดลอกลิงก์แนะนำ ติดตามยอด และกรอกข้อมูลให้ครบเพื่อให้ทีมงานโอนเงินได้',
      en: 'Copy your referral link, watch the numbers, and complete your payout details',
    },
    blocks: [
      {
        kind: 'para',
        body: {
          th: 'ทุกบัญชีมีลิงก์แนะนำของตัวเองอยู่แล้ว ไม่ต้องสมัครอะไรเพิ่ม เมื่อมีคนเปิดเว็บจากลิงก์ของคุณแล้วสมัครและชำระเงิน ค่าคอมมิชชั่นจะถูกบันทึกเข้าบัญชีของคุณตามอัตราของระดับที่คุณอยู่',
          en: 'Every account already has a referral link — nothing extra to sign up for. When someone opens the site through your link and pays, commission is recorded at your tier rate.',
        },
      },
      {
        kind: 'steps',
        items: [
          {
            title: { th: 'เปิดหน้าพันธมิตร', en: 'Open the affiliate page' },
            body: {
              th: 'กดเมนูโปรไฟล์มุมขวาบน แล้วเลือก "พันธมิตร (Affiliate)"',
              en: 'Use the profile menu in the top-right and choose Affiliate.',
            },
          },
          {
            title: { th: 'คัดลอกลิงก์แนะนำ', en: 'Copy your referral link' },
            body: {
              th: 'ลิงก์อยู่ในกล่องด้านบน กดปุ่มคัดลอกแล้วนำไปแชร์ได้เลย ใครเปิดจากลิงก์นี้จะถูกผูกกับคุณอัตโนมัติ',
              en: 'The link sits in the top card. Copy and share it — anyone who opens it is attached to you automatically.',
            },
          },
          {
            title: { th: 'กรอกวิธีรับเงิน', en: 'Fill in your payout method' },
            body: {
              th: 'ไปแท็บ "วิธีรับเงินค่าคอมมิชชั่น" กรอกธนาคาร เลขบัญชี ชื่อบัญชี เลขบัตรประชาชน 13 หลัก และที่อยู่สำหรับออกเอกสารภาษี',
              en: 'Open the payout tab and fill in bank, account number, account name, your 13-digit national ID, and the address used for tax documents.',
            },
          },
          {
            title: { th: 'ติดตามยอดและรอโอน', en: 'Track and wait for the transfer' },
            body: {
              th: 'ดูรายชื่อคนที่คุณแนะนำได้ในแท็บ "รายการผู้แนะนำ" และดูรอบที่โอนแล้วในแท็บ "ประวัติการโอนเงิน"',
              en: 'See who you referred in the referees tab, and completed payouts in the transfer history tab.',
            },
          },
        ],
      },
      { kind: 'heading', body: { th: 'สี่แท็บในหน้าพันธมิตร', en: 'The four tabs' } },
      {
        kind: 'list',
        tone: 'dot',
        items: [
          { th: 'รายการผู้แนะนำ — ใครสมัครผ่านลิงก์ของคุณแล้วบ้าง', en: 'Referees — everyone who signed up through your link' },
          { th: 'ประวัติการโอนเงิน — รอบที่โอนแล้ว พร้อมหลักฐานการโอนและเอกสาร 50 ทวิ ให้ดาวน์โหลด', en: 'Transfer history — completed payouts with transfer proof and the withholding-tax certificate' },
          { th: 'วิธีรับเงินค่าคอมมิชชั่น — บัญชีธนาคารและข้อมูลผู้รับเงิน', en: 'Payout method — your bank account and recipient details' },
          { th: 'ข้อมูลภาษี — ข้อมูลสำหรับออกเอกสารทางภาษี', en: 'Tax info — the details used on tax paperwork' },
        ],
      },
      {
        kind: 'callout',
        tone: 'warn',
        title: { th: 'กรอกไม่ครบ = โอนไม่ได้', en: 'Incomplete details block payouts' },
        body: {
          th: 'ทีมงานจะโอนค่าคอมมิชชั่นได้เมื่อข้อมูลบัญชีธนาคารและเอกสารภาษีครบถ้วน หน้าเว็บจะขึ้นแถบเตือนสีเหลืองถ้ายังขาด และค่าคอมมิชชั่นทุกรายการจะถูกหักภาษี ณ ที่จ่าย 3% ตามกฎหมาย',
          en: 'The team can only transfer once your bank and tax details are complete — a yellow banner flags anything missing. All commission is subject to 3% withholding tax.',
        },
      },
      {
        kind: 'callout',
        tone: 'info',
        title: { th: 'อัตราค่าคอมมิชชั่นดูที่ไหน', en: 'Where to see your rate' },
        body: {
          th: 'กล่อง "ระดับผู้แนะนำ" ด้านบนของหน้าพันธมิตรจะบอกระดับปัจจุบันและเปอร์เซ็นต์ที่คุณได้ต่อยอดขาย (คิดจากยอดก่อนภาษีมูลค่าเพิ่ม)',
          en: 'The tier card at the top of the affiliate page shows your current tier and the percentage you earn per sale, calculated on the pre-VAT amount.',
        },
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'รายละเอียดโปรแกรมพันธมิตร', en: 'About the affiliate program' }, to: '/affiliate-info' },
          { label: { th: 'ไปหน้าพันธมิตรของฉัน', en: 'Go to my affiliate page' }, to: '/affiliate' },
        ],
      },
    ],
  },
  {
    slug: 'account-and-billing',
    category: 'account',
    icon: IdCard,
    minutes: 3,
    access: 'login',
    keywords: ['ต่ออายุ', 'หมดอายุ', 'ใบกำกับภาษี', 'โปรไฟล์', 'renew', 'invoice', 'vat'],
    title: { th: 'อายุสมาชิก การต่ออายุ และใบกำกับภาษี', en: 'Membership, renewals, and tax invoices' },
    summary: {
      th: 'ดูวันคงเหลือ ต่ออายุก่อนหมด และขอเอกสารทางภาษีจากทีมงาน',
      en: 'Check days left, renew before expiry, and request tax paperwork',
    },
    blocks: [
      { kind: 'heading', body: { th: 'เหลืออีกกี่วัน', en: 'How many days are left' } },
      {
        kind: 'para',
        body: {
          th: 'เมื่อเป็นสมาชิกอยู่ จะมีชิปสีทองบนแถบเมนูบอกว่า "เหลือ X วัน" กดที่ชิปเพื่อไปหน้าต่ออายุได้ทันที ถ้าเหลือ 7 วันหรือน้อยกว่า ชิปจะเปลี่ยนเป็นสีแดงเพื่อเตือน บนมือถือให้ดูในเมนูโปรไฟล์',
          en: 'While your membership is active a gold chip in the top bar shows the days remaining — tap it to go straight to renewal. At 7 days or fewer it turns red. On mobile it lives in the profile menu.',
        },
      },
      { kind: 'heading', body: { th: 'ต่ออายุ', en: 'Renewing' } },
      {
        kind: 'list',
        tone: 'dot',
        items: [
          { th: 'ต่ออายุใช้ขั้นตอนเดียวกับการสมัครครั้งแรก — โอนแล้วอัปโหลดสลิปใบใหม่', en: 'Renewal works exactly like the first purchase — transfer, then upload a fresh slip' },
          { th: 'ต่อก่อนหมดอายุได้ ไม่ต้องรอให้ขาด', en: 'You can renew before the current period ends' },
          { th: 'ถ้าหมดอายุแล้ว เปิดหน้าที่ต้องมีสิทธิ์จะถูกพาไปหน้าต่ออายุอัตโนมัติ', en: 'Once expired, opening a members-only page redirects you to renewal' },
          { th: 'ความคืบหน้าการเรียนเดิมยังอยู่ครบหลังต่ออายุ', en: 'Your learning progress is still there after you renew' },
        ],
      },
      { kind: 'heading', body: { th: 'ใบกำกับภาษีและเอกสาร', en: 'Tax invoices and documents' } },
      {
        kind: 'para',
        body: {
          th: 'ใบกำกับภาษีออกให้โดยทีมงาน ไม่ได้กดออกเองจากหน้าเว็บ ทักแอดมินผ่านแชทแล้วแจ้ง 3 อย่าง: ชื่อผู้เสียภาษี ที่อยู่ตามที่จดทะเบียน และเลขประจำตัวผู้เสียภาษี พร้อมบอกว่าเป็นการชำระรอบไหน',
          en: 'Tax invoices are issued by the team, not self-served. Message an admin with three things — tax name, registered address, and tax ID — and mention which payment it is for.',
        },
      },
      {
        kind: 'callout',
        tone: 'info',
        title: { th: 'บัญชีของฉัน', en: 'Your account page' },
        body: {
          th: 'หน้า "บัญชีของฉัน" ในเมนูโปรไฟล์ใช้ดูอีเมลที่ใช้เข้าระบบ รหัสแนะนำของคุณ และประวัติการชำระเงิน',
          en: 'The account page in the profile menu shows your sign-in email, your referral code, and your payment history.',
        },
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'บัญชีของฉัน', en: 'My account' }, to: '/profile' },
          { label: { th: 'ต่ออายุสมาชิก', en: 'Renew membership' }, to: '/subscription/transfer-v2' },
        ],
      },
    ],
  },
];
