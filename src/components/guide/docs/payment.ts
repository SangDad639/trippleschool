import { Scale, Landmark, ShoppingCart } from 'lucide-react';
import type { GuideDoc } from '../guideTypes';

// หมวด "แพ็กเกจ & ชำระเงิน"
// หมายเหตุ: ตั้งใจไม่ใส่ตัวเลขราคาลงในคู่มือ เพราะราคาจริงดึงจากฐานข้อมูล
// (หน้า /pricing และหน้าสมัคร) ถ้าเขียนตัวเลขไว้ที่นี่จะเพี้ยนทันทีที่ปรับราคา
export const PAYMENT_DOCS: GuideDoc[] = [
  {
    slug: 'choose-plan',
    category: 'payment',
    icon: Scale,
    minutes: 3,
    access: 'everyone',
    keywords: ['แพ็กเกจ', 'ราคา', 'pricing', 'รายเดือน', 'รายปี', 'รายชิ้น', 'plan'],
    title: { th: 'เลือกแพ็กเกจให้ถูกแบบ', en: 'Pick the right plan' },
    summary: {
      th: 'ซื้อรายชิ้น สมาชิกรายเดือน หรือรายปี — ต่างกันตรงไหน และข้อควรรู้ก่อนจ่าย',
      en: 'Single course, monthly, or yearly — how they differ and what to know first',
    },
    blocks: [
      {
        kind: 'para',
        body: {
          th: 'Triple School มี 3 รูปแบบให้เลือก ทุกยอดที่แสดงเป็นยอดรวมภาษีมูลค่าเพิ่ม 7% แล้ว ราคาปัจจุบันดูได้ที่หน้าแพ็กเกจและราคา เพราะมีโปรโมชั่นเปลี่ยนเป็นช่วงๆ',
          en: 'There are three ways to pay. Every amount shown includes 7% VAT. Check the pricing page for current numbers — promotions change from time to time.',
        },
      },
      {
        kind: 'table',
        cols: [
          { th: 'เปรียบเทียบ', en: 'Compare' },
          { th: 'ซื้อรายชิ้น', en: 'Single course' },
          { th: 'สมาชิกรายเดือน', en: 'Monthly' },
          { th: 'สมาชิกรายปี', en: 'Yearly' },
        ],
        rows: [
          [
            { th: 'เข้าเรียนได้', en: 'Access' },
            { th: 'เฉพาะคอร์สที่ซื้อ', en: 'Only the course you bought' },
            { th: 'ทุกคอร์สที่เปิดอยู่', en: 'Every published course' },
            { th: 'ทุกคอร์สที่เปิดอยู่', en: 'Every published course' },
          ],
          [
            { th: 'คอร์สใหม่ที่เพิ่มภายหลัง', en: 'Courses added later' },
            { th: 'ไม่รวม', en: 'Not included' },
            { th: 'รวม ตลอดอายุสมาชิก', en: 'Included while active' },
            { th: 'รวม ตลอด 1 ปี', en: 'Included for a full year' },
          ],
          [
            { th: 'โปรแกรมสำหรับสมาชิก', en: 'Member programs' },
            { th: 'ไม่รวม', en: 'Not included' },
            { th: 'รวม', en: 'Included' },
            { th: 'รวม', en: 'Included' },
          ],
          [
            { th: 'เปิดใช้งาน', en: 'Activation' },
            { th: 'แอดมินตรวจสลิปก่อน', en: 'Admin reviews your slip' },
            { th: 'อัตโนมัติหลังตรวจสลิปผ่าน', en: 'Automatic once the slip passes' },
            { th: 'อัตโนมัติหลังตรวจสลิปผ่าน', en: 'Automatic once the slip passes' },
          ],
          [
            { th: 'หมดอายุแล้ว', en: 'After expiry' },
            { th: 'ยังเข้าคอร์สที่ซื้อได้ตามเงื่อนไขวันที่ซื้อ', en: 'Keeps the course under the terms at purchase' },
            { th: 'สิทธิ์เข้าเรียนสิ้นสุด ต้องต่ออายุ', en: 'Access ends until you renew' },
            { th: 'สิทธิ์เข้าเรียนสิ้นสุด ต้องต่ออายุ', en: 'Access ends until you renew' },
          ],
        ],
      },
      {
        kind: 'callout',
        tone: 'warn',
        title: { th: 'ตัดสินใจก่อนจ่าย', en: 'Decide before you pay' },
        body: {
          th: 'ยอดที่จ่ายซื้อคอร์สรายชิ้น ไม่สามารถนำไปหักเป็นส่วนลดค่าสมาชิกรายเดือนหรือรายปีได้ภายหลัง ถ้าคิดว่าจะเรียนมากกว่า 2 คอร์ส สมัครสมาชิกคุ้มกว่าตั้งแต่แรก',
          en: 'Money spent on a single course cannot be credited toward a monthly or yearly plan later. If you expect to take more than two courses, membership is the better start.',
        },
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: { th: 'ยังไม่แน่ใจ', en: 'Still unsure' },
        body: {
          th: 'ดูบทเรียนที่ติดป้าย "ดูฟรี" ในคอร์สที่สนใจ 2-3 คอร์สก่อน ถ้าถูกใจมากกว่า 1 คอร์ส แปลว่าสมาชิกคุ้มกว่าแน่นอน',
          en: 'Watch the free preview lessons in two or three courses first. If more than one grabs you, membership already pays off.',
        },
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'ดูราคาปัจจุบัน', en: 'See current pricing' }, to: '/pricing' },
          { label: { th: 'คู่มือสมัครสมาชิก', en: 'Membership guide' }, to: '/guide/subscribe-transfer' },
        ],
      },
    ],
  },
  {
    slug: 'subscribe-transfer',
    category: 'payment',
    icon: Landmark,
    minutes: 5,
    access: 'login',
    keywords: ['สลิป', 'slip', 'โอนเงิน', 'สมัครสมาชิก', 'ชำระเงิน', 'kbank', 'กสิกร', 'qr'],
    title: { th: 'สมัครสมาชิก: โอนเงินและอัปโหลดสลิป', en: 'Subscribe: transfer and upload your slip' },
    summary: {
      th: 'ระบบตรวจสลิปอัตโนมัติและเปิดสิทธิ์ให้ในไม่กี่วินาที — พร้อมเงื่อนไขสลิปที่ผ่าน',
      en: 'The slip is verified automatically and access opens within seconds — plus what makes a slip pass',
    },
    blocks: [
      {
        kind: 'para',
        body: {
          th: 'การสมัครสมาชิกใช้วิธีโอนเงินเข้าบัญชีบริษัทแล้วอัปโหลดสลิป ระบบจะอ่าน QR บนสลิปและตรวจกับธนาคารให้อัตโนมัติ ถ้าผ่าน สิทธิ์สมาชิกจะเปิดให้ทันทีโดยไม่ต้องรอแอดมิน',
          en: 'Membership is paid by bank transfer plus a slip upload. The system reads the QR on your slip and verifies it with the bank automatically — when it passes, access opens immediately with no admin wait.',
        },
      },
      { kind: 'heading', body: { th: 'ขั้นตอนทีละข้อ', en: 'Step by step' } },
      {
        kind: 'steps',
        items: [
          {
            title: { th: 'เข้าสู่ระบบก่อน', en: 'Sign in first' },
            body: {
              th: 'หน้าสมัครสมาชิกต้องเข้าสู่ระบบ เพราะสิทธิ์จะถูกผูกกับอีเมลของคุณ (อีเมลที่ใช้จะแสดงอยู่ล่างสุดของหน้า ตรวจให้ถูกบัญชีก่อนโอน)',
              en: 'The subscribe page requires a login because access is attached to your email. The email in use is shown at the bottom of that page — double-check it before transferring.',
            },
          },
          {
            title: { th: 'เลือกรายเดือนหรือรายปี', en: 'Choose monthly or yearly' },
            body: {
              th: 'กดแท็บด้านบนเพื่อสลับ ยอดรวมจะเปลี่ยนตามแพ็กเกจที่เลือกทันที',
              en: 'Use the tabs at the top — the total updates as you switch.',
            },
          },
          {
            title: { th: 'โอนเข้าบัญชีที่ระบุ', en: 'Transfer to the account shown' },
            body: {
              th: 'บัญชีธนาคารกสิกรไทย ชื่อบัญชี บจก. ทริปเปิล สปาร์ค เทค กดปุ่มคัดลอกข้างเลขบัญชีและข้างยอดเงินได้เลย เพื่อไม่ให้พิมพ์ผิด',
              en: 'A Kasikorn Bank (KBank) account in the name of Triple Spark Tech Co., Ltd. Use the copy buttons next to the account number and the amount so nothing gets mistyped.',
            },
          },
          {
            title: { th: 'โอนยอด "ยอดรวม" ให้ตรงเป๊ะ', en: 'Transfer the exact total' },
            body: {
              th: 'ยอดรวมคือยอดที่รวมภาษีมูลค่าเพิ่ม 7% แล้ว (หน้าเว็บแยกให้เห็นทั้งยอดก่อนภาษีและภาษี) ต้องโอนเท่ายอดรวม ไม่ปัดขึ้นหรือลง',
              en: 'The total already includes 7% VAT (the page itemises subtotal and VAT separately). Send exactly that total — do not round up or down.',
            },
          },
          {
            title: { th: 'อัปโหลดสลิป', en: 'Upload the slip' },
            body: {
              th: 'กดกรอบ "คลิกเพื่อเลือกไฟล์สลิป" เลือกภาพสลิปจากธนาคาร ไฟล์ต้องเป็น JPEG, PNG หรือ WebP และไม่เกิน 5MB',
              en: 'Tap the upload box and pick your bank slip image — JPEG, PNG, or WebP, up to 5MB.',
            },
          },
          {
            title: { th: 'กด "ตรวจสอบและสมัครสมาชิก"', en: 'Press Verify & Subscribe' },
            body: {
              th: 'รอสักครู่ ระบบจะตรวจสลิปกับธนาคาร ถ้าผ่านจะเปิดใช้งานภายในไม่กี่วินาทีและพาไปหน้ายืนยัน ถ้าไม่ผ่านจะขึ้นข้อความบอกสาเหตุตรงๆ',
              en: 'The system checks the slip against the bank. On success, access opens within seconds and you are taken to a confirmation page. On failure, the exact reason is shown.',
            },
          },
        ],
      },
      { kind: 'heading', body: { th: 'สลิปแบบไหนที่ผ่าน', en: 'What makes a slip pass' } },
      {
        kind: 'list',
        tone: 'check',
        items: [
          { th: 'เป็นสลิปการโอนเข้าบัญชีธนาคารกสิกรไทยตามที่ระบุในหน้าสมัคร', en: 'It is a transfer into the KBank account shown on the subscribe page' },
          { th: 'โอนมาแล้วไม่เกิน 24 ชั่วโมง', en: 'The transfer happened within the last 24 hours' },
          { th: 'ยังไม่เคยถูกใช้ยืนยันในระบบ (สลิปหนึ่งใบใช้ได้ครั้งเดียว)', en: 'It has never been used before — one slip, one activation' },
          { th: 'เห็น QR Code บนสลิปชัดเจน ไม่เบลอ ไม่ถูกครอบตัดทิ้ง', en: 'The QR code on the slip is sharp and not cropped off' },
          { th: 'เป็นภาพสลิปเต็มใบ ไม่ใช่ภาพถ่ายหน้าจอที่ตัดเฉพาะยอดเงิน', en: 'It shows the full slip, not a screenshot cropped to just the amount' },
        ],
      },
      {
        kind: 'callout',
        tone: 'warn',
        title: { th: 'ธนาคารกรุงเทพโอนช้ากว่าปกติ', en: 'Bangkok Bank slips settle slower' },
        body: {
          th: 'ถ้าโอนจากธนาคารกรุงเทพแล้วระบบแจ้งว่า "ยังรอดำเนินการ" ให้รอประมาณ 5 นาทีแล้วกดตรวจสอบใหม่ ไม่ต้องโอนซ้ำ',
          en: 'If a Bangkok Bank transfer comes back as still pending, wait about five minutes and verify again — do not transfer twice.',
        },
      },
      {
        kind: 'faq',
        items: [
          {
            q: { th: 'ขึ้นว่า "สลิปหมดอายุแล้ว" ทำอย่างไร', en: 'It says the slip has expired' },
            a: {
              th: 'สลิปที่เก่ากว่า 24 ชั่วโมงใช้ยืนยันไม่ได้ ต้องโอนใหม่แล้วอัปโหลดสลิปใบล่าสุด ถ้าโอนไปแล้วและเงินออกจากบัญชีจริง ให้ทักทีมงานพร้อมแนบสลิปเดิมเพื่อตรวจสอบให้',
              en: 'Slips older than 24 hours cannot be verified. Transfer again and upload the newest slip. If money already left your account, message the team with that slip so they can check it manually.',
            },
          },
          {
            q: { th: 'ขึ้นว่า "สลิปนี้เคยถูกใช้ยืนยันแล้ว"', en: 'It says this slip was already used' },
            a: {
              th: 'สลิปหนึ่งใบใช้เปิดสิทธิ์ได้ครั้งเดียว ถ้าจะต่ออายุหรือสมัครเพิ่ม ต้องโอนใหม่และใช้สลิปใบใหม่',
              en: 'Each slip activates once. To renew or add time, make a new transfer and use the new slip.',
            },
          },
          {
            q: { th: 'ขึ้นว่าไม่ใช่การโอนเข้าธนาคารกสิกรไทย', en: 'It says the transfer was not to KBank' },
            a: {
              th: 'ระบบรับเฉพาะสลิปที่โอนเข้าบัญชีกสิกรไทยที่แสดงในหน้าสมัคร ถ้าโอนผิดบัญชี ให้ติดต่อทีมงานทันทีพร้อมแนบสลิป',
              en: 'Only transfers into the KBank account shown on the page are accepted. If you paid the wrong account, contact the team right away with the slip attached.',
            },
          },
          {
            q: { th: 'ขึ้นว่าไม่พบ QR Code ในรูปสลิป', en: 'It says no QR code was found' },
            a: {
              th: 'ถ่ายหรือบันทึกภาพสลิปใหม่ให้เห็น QR ครบทั้งอัน อย่าครอบตัด อย่าย่อจนเบลอ และหลีกเลี่ยงการถ่ายจากจอที่มีแสงสะท้อน',
              en: 'Re-capture the slip so the whole QR is visible — no cropping, no heavy downscaling, and avoid glare when photographing a screen.',
            },
          },
          {
            q: { th: 'ขึ้นว่ารูปภาพใหญ่เกินไป', en: 'It says the image is too large' },
            a: {
              th: 'ย่อขนาดไฟล์ให้เล็กลง (ไม่เกิน 5MB และควรต่ำกว่า 4MB) โดยบันทึกเป็น JPEG หรือใช้ฟีเจอร์ย่อรูปในมือถือ',
              en: 'Shrink the file (under 5MB, ideally under 4MB) by saving as JPEG or using your phone resize option.',
            },
          },
          {
            q: { th: 'กดตรวจสอบหลายครั้งแล้วขึ้นว่าถี่เกินไป', en: 'It says I am verifying too often' },
            a: {
              th: 'ระบบจำกัดจำนวนครั้งเพื่อกันการยิงซ้ำ รอสักครู่แล้วลองใหม่อีกครั้งเดียว ไม่ต้องกดรัวๆ',
              en: 'There is a rate limit to stop repeat submissions. Wait a moment and try once more — no need to hammer the button.',
            },
          },
          {
            q: { th: 'ต้องการใบกำกับภาษี', en: 'I need a tax invoice' },
            a: {
              th: 'ใบกำกับภาษีออกให้โดยทีมงาน แจ้งแอดมินผ่านแชทพร้อมชื่อ-ที่อยู่ผู้เสียภาษีและเลขประจำตัวผู้เสียภาษี',
              en: 'Tax invoices are issued by the team. Message an admin with the tax name, address, and tax ID.',
            },
          },
        ],
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'ไปหน้าสมัครสมาชิก', en: 'Go to subscribe' }, to: '/subscription/transfer-v2' },
          { label: { th: 'เทียบแพ็กเกจก่อน', en: 'Compare plans first' }, to: '/guide/choose-plan' },
        ],
      },
    ],
  },
  {
    slug: 'buy-single-course',
    category: 'payment',
    icon: ShoppingCart,
    minutes: 3,
    access: 'login',
    keywords: ['ซื้อคอร์ส', 'รายชิ้น', 'สลิป', 'รออนุมัติ', 'ถูกปฏิเสธ', 'enroll'],
    title: { th: 'ซื้อคอร์สรายชิ้นและสถานะการอนุมัติ', en: 'Buy one course and track approval' },
    summary: {
      th: 'โอนแล้วแนบสลิปในหน้าคอร์ส รอแอดมินอนุมัติ แล้วดูสถานะได้ที่คอร์สของฉัน',
      en: 'Transfer, attach the slip on the course page, wait for approval, then track it in My Courses',
    },
    blocks: [
      {
        kind: 'para',
        body: {
          th: 'การซื้อคอร์สรายชิ้นต่างจากการสมัครสมาชิกตรงที่แอดมินเป็นคนตรวจสลิปให้ ไม่ใช่ระบบอัตโนมัติ จึงมีช่วง "รออนุมัติ" ก่อนเข้าเรียนได้',
          en: 'Buying a single course differs from membership in one way: an admin reviews the slip instead of the automatic checker, so there is a short pending stage before access opens.',
        },
      },
      {
        kind: 'steps',
        items: [
          {
            title: { th: 'เปิดหน้าคอร์สที่ต้องการ', en: 'Open the course page' },
            body: {
              th: 'กดปุ่ม "ซื้อคอร์สนี้" พร้อมยอดเงินที่แสดงบนปุ่ม ถ้าคอร์สนั้นฟรี ปุ่มจะเป็น "ลงทะเบียนเรียนฟรี" กดแล้วเข้าเรียนได้ทันที',
              en: 'Press the buy button — the price is printed on it. Free courses show an enrol button instead and open instantly.',
            },
          },
          {
            title: { th: 'โอนเงินตามยอดที่แจ้ง', en: 'Transfer the stated amount' },
            body: {
              th: 'หน้าต่างยืนยันจะบอกยอดที่ต้องโอนอีกครั้ง โอนให้ตรงยอดเพื่อให้แอดมินจับคู่รายการได้เร็ว',
              en: 'The confirmation dialog restates the amount. Match it exactly so the admin can reconcile it quickly.',
            },
          },
          {
            title: { th: 'อัปโหลดสลิปการโอนเงิน', en: 'Upload the transfer slip' },
            body: {
              th: 'เลือกไฟล์รูปสลิป ขนาดไม่เกิน 10MB แล้วกด "ยืนยัน" ระบบจะขึ้นข้อความว่าส่งคำขอแล้ว รอแอดมินอนุมัติ',
              en: 'Pick a slip image up to 10MB and press confirm. You will see that the request was sent for review.',
            },
          },
          {
            title: { th: 'ติดตามสถานะที่ "คอร์สของฉัน"', en: 'Track it in My Courses' },
            body: {
              th: 'คอร์สที่รออนุมัติจะอยู่ในกล่อง "รออนุมัติสลิป" ด้านบนสุด กดที่การ์ดเพื่อดูรายละเอียดหรืออัปเดตสลิปใหม่ได้',
              en: 'Pending purchases sit in a section at the top. Tap the card to see details or replace the slip.',
            },
          },
        ],
      },
      {
        kind: 'list',
        tone: 'dot',
        title: { th: 'สถานะที่คุณจะเห็น', en: 'The statuses you will see' },
        items: [
          { th: 'รออนุมัติ — แอดมินกำลังตรวจสลิป ยังเข้าเรียนไม่ได้ แต่แก้ไข/อัปเดตสลิปได้', en: 'Pending — an admin is reviewing; no access yet, but you can update the slip' },
          { th: 'ถูกปฏิเสธ — สลิปไม่ผ่าน กดที่การ์ดเพื่อดูเหตุผลและกด "ซื้อใหม่" พร้อมสลิปที่ถูกต้อง', en: 'Rejected — the slip did not pass; open the card for the reason and buy again with a valid slip' },
          { th: 'เข้าเรียนได้ — ปุ่มจะเปลี่ยนเป็น "เริ่มเรียน" หรือ "เรียนต่อ" และมีแถบความคืบหน้า', en: 'Approved — the button becomes Start or Continue and a progress bar appears' },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: { th: 'อยากได้เร็วกว่านี้', en: 'Want it faster' },
        body: {
          th: 'การสมัครสมาชิกรายเดือน/รายปีใช้ระบบตรวจสลิปอัตโนมัติ เปิดสิทธิ์ให้ในไม่กี่วินาที และครอบคลุมทุกคอร์สในเว็บ',
          en: 'Monthly and yearly membership uses the automatic slip checker — access in seconds, and it covers every course on the site.',
        },
      },
      {
        kind: 'links',
        items: [
          { label: { th: 'ดูคอร์สทั้งหมด', en: 'Browse courses' }, to: '/courses' },
          { label: { th: 'คอร์สของฉัน', en: 'My courses' }, to: '/app/my-courses' },
        ],
      },
    ],
  },
];
