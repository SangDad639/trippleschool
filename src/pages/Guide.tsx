import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import type { Language } from '@/lib/translations';
import { api } from '@/lib/api';

type L = { th: string; en: string };

interface Step {
  text: L;
  note?: L;
  images?: string[];
}

interface SubSection {
  title: L;
  steps: Step[];
}

interface Section {
  id: string;
  title: string;
  description: L;
  /** Optional warning banner shown under the description (sunset notice, etc.). */
  warning?: L;
  color: string;
  icon: string;
  subsections: SubSection[];
}

const sections: Section[] = [
  {
    id: 'openrouter',
    title: 'OpenRouter API Key',
    description: { th: 'ใช้คิด Captions ของวิดีโอ', en: 'Used for generating video captions' },
    color: '#6366f1',
    icon: '🧠',
    subsections: [
      {
        title: { th: 'ขั้นตอนสมัคร OpenRouter', en: 'Sign up for OpenRouter' },
        steps: [
          { text: { th: 'ให้เข้ามาที่ https://openrouter.ai/', en: 'Go to https://openrouter.ai/' }, images: [] },
          { text: { th: 'กด Sign Up มุมขวาบน', en: 'Click Sign Up at top-right corner' }, images: ['/api/scheduler/channels/guide/img01.png'] },
          { text: { th: 'เลือกวิธีการ Login', en: 'Choose a login method' }, images: ['/api/scheduler/channels/guide/img02.png'] },
          { text: { th: 'กดติ๊ก I agree to the Terms of Service and Privacy Policy และกด Continue', en: 'Check "I agree to the Terms of Service and Privacy Policy" and click Continue' }, images: ['/api/scheduler/channels/guide/img03.png'] },
          { text: { th: 'กดติ๊กเลือกอันไหนก็ได้ 1 อัน แล้วก็กด Continue', en: 'Check any 1 option and click Continue' }, images: ['/api/scheduler/channels/guide/img04.png'] },
        ],
      },
      {
        title: { th: 'ขั้นตอนเติมเครดิต', en: 'Adding Credits' },
        steps: [
          { text: { th: 'กด Buy Credits', en: 'Click Buy Credits' }, images: ['/api/scheduler/channels/guide/img11.png'] },
          { text: { th: 'กด Add Credits', en: 'Click Add Credits' }, images: ['/api/scheduler/channels/guide/img12.png'] },
          {
            text: { th: 'กรอกข้อมูลให้ครบถ้วน ส่วน Country and Region เลือกเป็น Thailand', en: 'Fill in all details. For Country and Region, select Thailand' },
            note: { th: 'ถ้ากรอกครบถ้วนแล้วให้กด Complete address details to continue ได้เลย', en: 'Once all fields are filled, click "Complete address details to continue"' },
            images: ['/api/scheduler/channels/guide/img13.png'],
          },
          {
            text: { th: 'เลือกวิธีชำระเงิน แนะนำ 2 วิธี คือ\n1. จ่ายผ่านบัตรเครดิต/เดบิต\n2. จ่ายผ่านทาง GooglePay', en: 'Choose a payment method. Recommended:\n1. Credit/Debit card\n2. GooglePay' },
            images: ['/api/scheduler/channels/guide/img14.png'],
          },
          { text: { th: 'ขั้นต่ำที่สามารถเติมได้ คือ $5 (ประมาณ 160-180 บาทไทย)', en: 'Minimum top-up is $5 (approx. 160-180 THB)' }, images: ['/api/scheduler/channels/guide/img15.png'] },
          { text: { th: 'หลังจากชำระเงินเสร็จ ระบบจะเด้งเป็น $5.00', en: 'After payment, the balance will show $5.00' }, images: ['/api/scheduler/channels/guide/img16.png'] },
        ],
      },
      {
        title: { th: 'ขั้นตอนสร้าง API Key', en: 'Create API Key' },
        steps: [
          { text: { th: 'ให้กดเข้ามาที่ลิงก์ https://openrouter.ai/settings/keys', en: 'Go to https://openrouter.ai/settings/keys' }, images: [] },
          { text: { th: 'กดปุ่ม Create', en: 'Click Create button' }, images: ['/api/scheduler/channels/guide/img17.png'] },
          {
            text: {
              th: 'กรอกข้อมูล\n1. ชื่อ (ตั้งอะไรก็ได้)\n2. Credit limit (ใส่ตามจำนวนที่เราเติม เช่นเติม $5 ก็ใส่แค่เลข 5)\n3. กด Create',
              en: 'Fill in the details:\n1. Name (anything you like)\n2. Credit limit (enter the amount you topped up, e.g. 5 for $5)\n3. Click Create',
            },
            images: ['/guide/img84.png'],
          },
          { text: { th: 'Copy API Key ที่ icon วงสีแดง เก็บไว้', en: 'Copy the API Key (red circle icon) and save it' }, images: ['/api/scheduler/channels/guide/img18.png'] },
        ],
      },
      {
        title: { th: 'นำ API Key เชื่อมเข้า Triple School', en: 'Connect API Key to Triple School' },
        steps: [
          { text: { th: 'เข้ามาที่เว็บ Triple School และล็อกอินเข้าสู่ระบบให้เรียบร้อย', en: 'Go to Triple School website and log in' }, images: [] },
          { text: { th: 'กดที่ชื่อโปรไฟล์ขวาบน และกดเข้าไปที่ Settings', en: 'Click your profile name at top-right, then go to Settings' }, images: ['/api/scheduler/channels/guide/img19.png'] },
          { text: { th: 'หัวข้อ AI Provider ให้ Select Provider เป็น OpenRouter', en: 'Under AI Provider, select OpenRouter as the provider' }, images: ['/api/scheduler/channels/guide/img20.png'] },
          { text: { th: 'ใส่ API Key ที่ Copy เก็บไว้ลงไปในช่อง และทำการกดเซฟที่ icon สีเหลืองข้างๆ', en: 'Paste the API Key you copied into the field and click the yellow save icon' }, images: ['/api/scheduler/channels/guide/img21.png'] },
          { text: { th: 'ถ้าขึ้น Active แบบนี้แล้วแสดงว่าเสร็จเรียบร้อย', en: 'If it shows "Active", you\'re all set!' }, images: ['/api/scheduler/channels/guide/img22.png'] },
        ],
      },
    ],
  },
  {
    id: 'kie',
    title: 'KIE API Key',
    description: { th: 'สำหรับสร้างวิดีโอ Grok Imagine', en: 'For Grok Imagine video generation' },
    color: '#8b5cf6',
    icon: '🤖',
    subsections: [
      {
        title: { th: 'ขั้นตอนสมัคร', en: 'Sign Up' },
        steps: [
          { text: { th: 'กดเข้าลิงก์ https://kie.ai', en: 'Go to https://kie.ai' }, images: [] },
          { text: { th: 'กดปุ่ม Explore AI API สีขาว', en: 'Click the white Explore AI API button' }, images: ['/api/scheduler/channels/guide/kie_01.jpg'] },
          { text: { th: 'กดปุ่ม Login แท็บด้านล่างซ้ายมือ', en: 'Click Login tab at the bottom-left' }, images: ['/api/scheduler/channels/guide/kie_02.jpg'] },
          { text: { th: 'เลือกวิธีล็อกอิน\n- บัญชี Google หรือ Microsoft', en: 'Choose login method\n- Google or Microsoft account' }, images: ['/api/scheduler/channels/guide/kie_03.jpg'] },
        ],
      },
      {
        title: { th: 'ขั้นตอนเติมเครดิต', en: 'Adding Credits' },
        steps: [
          { text: { th: 'เข้าสู่ระบบเรียบร้อย ให้กดเข้า Billing แท็บด้านซ้ายมือ', en: 'After logging in, click Billing tab on the left side' }, images: ['/api/scheduler/channels/guide/kie_billing.jpg'] },
          { text: { th: 'เลือกจำนวนเครดิตที่ต้องการ (ขั้นต่ำ 5 USD) ประมาณ 150-180 บาท', en: 'Choose the amount of credits (minimum 5 USD, approx. 150-180 THB)' }, images: ['/api/scheduler/channels/guide/kie_addcredit.jpg'] },
          { text: { th: 'เลือกชำระเงินเป็นแบบ Card ใส่เลข Zip Code (รหัสไปรษณีย์) และ กรอกข้อมูลบัตรให้ครบถ้วน', en: 'Choose Card payment, enter Zip Code and fill in card details' }, images: ['/api/scheduler/channels/guide/kie_card.jpg'] },
          { text: { th: 'หลังจากกรอกข้อมูลบัตรครบถ้วนแล้ว ให้กด Pay', en: 'After filling in all card details, click Pay' }, images: [] },
          { text: { th: 'หรือเลือกชำระผ่าน Apple Pay (สำหรับผู้ที่ไม่มีบัตร หรือชำระผ่านบัตรไม่ผ่าน)\n※ Apple Pay ใช้ได้เฉพาะ iPhone เท่านั้น ระบบ Android ไม่รองรับ', en: 'Or pay via Apple Pay (for those without a card or if card payment fails)\n※ Apple Pay is available on iPhone only — not supported on Android' }, images: ['/api/scheduler/channels/guide/kie_applepay.jpg'] },
          { text: { th: 'Scan จ่ายเงินผ่านโทรศัพท์', en: 'Scan to pay via phone' }, images: ['/api/scheduler/channels/guide/kie_scanapple.jpg'] },
        ],
      },
      {
        title: { th: 'สร้าง API Key', en: 'Create API Key' },
        steps: [
          { text: { th: 'เข้ามาที่ https://kie.ai/api-key', en: 'Go to https://kie.ai/api-key' }, images: [] },
          { text: { th: 'กด Create API Key', en: 'Click Create API Key' }, images: ['/api/scheduler/channels/guide/kie_createapi.jpg'] },
          { text: { th: 'ตั้งชื่อ และทำการกด Create', en: 'Enter a name and click Create' }, images: ['/api/scheduler/channels/guide/kie_create.jpg'] },
          { text: { th: 'กด Copy เพื่อคัดลอก API Key', en: 'Click Copy to copy the API Key' }, images: ['/api/scheduler/channels/guide/kie_copyapi.jpg'] },
        ],
      },
      {
        title: { th: 'เชื่อม API Key เข้าเว็บ Triple School', en: 'Connect API Key to Triple School' },
        steps: [
          { text: { th: 'เข้ามาที่เว็บ Triple School', en: 'Go to Triple School' }, images: [] },
          { text: { th: 'กดที่โปรไฟล์ขวาบน → ตั้งค่า', en: 'Click profile at top-right → Settings' }, images: ['/api/scheduler/channels/guide/kie_profile.jpg'] },
          { text: { th: 'เลื่อนลงมา หาช่อง KIE API Key', en: 'Scroll down to find the KIE API Key field' }, images: ['/api/scheduler/channels/guide/kie_slot.jpg'] },
          { text: { th: 'นำ API Key ที่ Copy ไว้ มาใส่ในช่อง และทำการกด Save ปุ่มสีเหลือง', en: 'Paste the copied API Key and click the yellow Save button' }, images: ['/api/scheduler/channels/guide/kie_save.jpg'] },
        ],
      },
    ],
  },
  {
    id: 'vidgo',
    title: 'VidGo API Key',
    description: { th: 'ใช้สร้าง Video Sora2 แบบไม่มีลายน้ำ', en: 'Used for creating Sora2 videos without watermark' },
    color: '#10b981',
    icon: '🎬',
    subsections: [
      {
        title: { th: 'ขั้นตอนสมัคร', en: 'Sign Up' },
        steps: [
          { text: { th: 'กดเข้าลิงก์ https://vidgo.ai/apis', en: 'Go to https://vidgo.ai/apis' }, images: [] },
          { text: { th: 'กดปุ่ม Log In ทางด้านขวาบน', en: 'Click Log In button at top-right' }, images: ['/api/scheduler/channels/guide/img23.png'] },
          { text: { th: 'เลือกวิธี Log In (แนะนำ Sign in with Google จะสะดวกที่สุด)', en: 'Choose a login method (Sign in with Google is recommended)' }, images: ['/api/scheduler/channels/guide/img24.png'] },
        ],
      },
      {
        title: { th: 'ขั้นตอนเติมเครดิต', en: 'Adding Credits' },
        steps: [
          { text: { th: 'หลังจาก Log In เสร็จ ให้กดคลิก Billing', en: 'After logging in, click Billing' }, images: ['/api/scheduler/channels/guide/img27.png'] },
          { text: { th: 'กดเลือกราคา และจำนวนเครดิตที่ต้องการจะเติมเงิน', en: 'Select the price and number of credits you want to top up' }, images: ['/api/scheduler/channels/guide/img28.png'] },
          {
            text: { th: 'กดเลือกวิธีจ่ายเงิน (แนะนำ Credit Card) และกด Pay Now\nระบบจะพาไปหน้าจ่ายเงิน ให้ทำการกรอกข้อมูลให้ครบถ้วน', en: 'Choose payment method (Credit Card recommended) and click Pay Now\nYou\'ll be taken to the payment page — fill in all details' },
            images: ['/api/scheduler/channels/guide/img29.png'],
          },
        ],
      },
      {
        title: { th: 'สร้าง API Key', en: 'Create API Key' },
        steps: [
          { text: { th: 'ให้กดเข้ามาที่ลิงก์ https://vidgo.ai/apis/dashboard/api-key', en: 'Go to https://vidgo.ai/apis/dashboard/api-key' }, images: [] },
          { text: { th: 'กด Create API Key', en: 'Click Create API Key' }, images: ['/api/scheduler/channels/guide/img30.png'] },
          { text: { th: 'ตั้งชื่ออะไรลงไปก็ได้ จากนั้นกด Create', en: 'Enter any name, then click Create' }, images: ['/api/scheduler/channels/guide/img31.png'] },
          { text: { th: 'กด Copy API Key ที่สี่เหลี่ยม ไว้ให้', en: 'Click the copy icon to copy the API Key' }, images: ['/api/scheduler/channels/guide/img32.png'] },
        ],
      },
      {
        title: { th: 'เชื่อม API Key เข้าเว็บ Triple School', en: 'Connect API Key to Triple School' },
        steps: [
          { text: { th: 'เข้ามาที่เว็บ Triple School และล็อกอินเข้าสู่ระบบให้เรียบร้อย', en: 'Go to Triple School website and log in' }, images: [] },
          { text: { th: 'กดที่โปรไฟล์ขวาบน และกดเข้าไปที่ Settings', en: 'Click your profile at top-right, then go to Settings' }, images: ['/api/scheduler/channels/guide/img33.png'] },
          { text: { th: 'นำ API Key มาใส่ในช่อง VidGo API Key และกดปุ่มสีเหลือง', en: 'Paste the API Key in the VidGo API Key field and click the yellow save button' }, images: ['/api/scheduler/channels/guide/img34.png'] },
        ],
      },
    ],
  },
  {
    id: 'late',
    title: 'Late API Key',
    description: { th: 'สำหรับโพสต์ผ่าน zernio.com', en: 'For posting via zernio.com' },
    warning: { th: '⚠️ ขอแจ้งให้ทราบว่า ทางเราจะยกเลิกบริการโพสต์ผ่าน Late เนื่องจากพบปัญหาด้านความเสถียรในการใช้งาน จึงจะนำระบบดังกล่าวออกจากบริการภายในวันที่ 28 เมษายน 2569', en: '⚠️ Please be advised that we will discontinue the Late posting service due to stability issues. Late will be removed from the system by April 28, 2026.' },
    color: '#f97316',
    icon: '📨',
    subsections: [
      {
        title: { th: 'ขั้นตอนสมัคร Late', en: 'Sign up for Late' },
        steps: [
          { text: { th: 'เข้ามาที่ https://zernio.com/', en: 'Go to https://zernio.com/' }, images: [] },
          { text: { th: 'กด Continue with Google (ล็อกอินด้วยบัญชี Google)', en: 'Click Continue with Google (sign in with your Google account)' }, images: ['/guide/late_signup_01.png'] },
        ],
      },
      {
        title: { th: 'ขั้นตอนชำระเงิน', en: 'Payment' },
        steps: [
          { text: { th: 'กดที่รูปโปรไฟล์ทางด้านซ้ายบน', en: 'Click your profile picture at the top-left' }, images: ['/guide/late_billing_01.png'] },
          { text: { th: 'กดเลือก Billing', en: 'Click Billing' }, images: ['/guide/late_billing_02.png'] },
          {
            text: { th: 'เลือก Package ตามที่ต้องการ และกดปุ่ม Upgrade', en: 'Choose a package and click Upgrade' },
            note: { th: 'ระบบจะพาไปหน้าชำระเงิน ให้ทำการชำระเงินให้เรียบร้อย', en: 'You will be redirected to the payment page. Complete the payment.' },
            images: ['/guide/late_billing_03.png'],
          },
        ],
      },
      {
        title: { th: 'ขั้นตอนสร้าง API Key เพื่อนำไปเชื่อมเข้าเว็บ Triple School', en: 'Create API Key to connect to Triple School' },
        steps: [
          { text: { th: 'กดเลือกหัวข้อ API Keys แทบซ้ายมือ', en: 'Click API Keys on the left sidebar' }, images: [] },
          { text: { th: 'กด + Create Key ทางด้านขวาบน', en: 'Click + Create Key at the top-right' }, images: ['/guide/late_apikey_01.png'] },
          { text: { th: 'Key Name (ให้ทำการตั้งชื่ออะไรก็ได้)', en: 'Key Name (enter any name you like)' }, images: [] },
          { text: { th: 'กด Create Key', en: 'Click Create Key' }, images: ['/guide/late_apikey_02.png'] },
          { text: { th: 'ให้กด Icon Copy ที่วงสีแดงเอาไว้', en: 'Click the Copy icon (red circle) and save it' }, images: ['/guide/late_apikey_03.png'] },
          { text: { th: 'ให้เข้ามาที่เว็บ Triple School กดโปรไฟล์ขวาบน และเลือกตั้งค่า', en: 'Go to Triple School, click your profile at top-right and select Settings' }, images: ['/guide/late_apikey_04.png'] },
          { text: { th: 'หาช่อง Late API Key', en: 'Find the Late API Key section' }, images: ['/guide/late_apikey_05.png'] },
          { text: { th: 'ให้นำ API Key ที่ Copy มาลงในช่อง และกด Icon Save สีเหลือง', en: 'Paste the API Key in the field and click the yellow Save icon' }, images: ['/guide/late_apikey_06.png'] },
        ],
      },
      {
        title: { th: 'ขั้นตอนเชื่อมแพลตฟอร์มต่างๆ เพื่อนำไปโพสต์', en: 'Connect platforms for posting' },
        steps: [
          { text: { th: 'เลือกหัวข้อ Connections (ฝั่งซ้ายมือ)', en: 'Select "Connections" from the left menu' }, images: ['/api/scheduler/channels/guide/late01.png'] },
          { text: { th: 'กดปุ่ม + Connect ที่แพลตฟอร์มตามที่ต้องการ', en: 'Click "+ Connect" on the platform you want' }, images: ['/api/scheduler/channels/guide/late02.png'] },
          { text: { th: 'หลังจากกด Connect ให้ Log in เข้าแพลตฟอร์มที่เลือก ตามขั้นตอนไปจนเสร็จ', en: 'After clicking Connect, log in to the selected platform and follow the steps until complete' } },
          { text: { th: 'หากทำตามขั้นตอนที่ 2 และ 3 เสร็จแล้ว ให้กดที่ปุ่ม Icon Copy ของแพลตฟอร์มที่เชื่อม (ตรงที่วงสีแดง)', en: 'Once steps 2 and 3 are complete, click the Copy icon of the connected platform (circled in red)' }, images: ['/api/scheduler/channels/guide/late03.png'] },
          { text: { th: 'เข้ามาที่เว็บ Triple School และกดไปที่เมนู "ช่อง"', en: 'Go to Triple School and navigate to "Channels" menu' }, images: ['/api/scheduler/channels/guide/late07.png'] },
          { text: { th: 'กดเพิ่มช่อง', en: 'Click "Add Channel"' }, images: ['/api/scheduler/channels/guide/late08.png'] },
          { text: { th: 'ใส่ชื่อช่อง และเลือกบริการโพสต์เป็น Late (zernio.com)', en: 'Enter channel name and select Late (zernio.com) as posting service' }, images: ['/api/scheduler/channels/guide/late04.png'] },
          { text: { th: 'ใส่ Account ID ตามแพลตฟอร์มที่ Copy มาลงไปในช่อง', en: 'Paste the Account ID into the matching platform field' }, images: ['/api/scheduler/channels/guide/late05.png'] },
          { text: { th: 'หลังจากที่เสร็จทุกขั้นตอน สามารถกดสร้างช่องได้เลย', en: 'Once all steps are done, click "Create Channel"' }, images: ['/api/scheduler/channels/guide/late06.png'] },
        ],
      },
    ],
  },
  {
    id: 'postforme',
    title: 'Post for Me API Key',
    description: { th: 'นำคลิปไปโพสต์ให้อัตโนมัติในแต่ละแพลตฟอร์มที่เลือก', en: 'Auto-post videos to selected platforms' },
    color: '#f59e0b',
    icon: '📮',
    subsections: [
      {
        title: { th: 'ขั้นตอนการสมัคร', en: 'Sign Up' },
        steps: [
          { text: { th: 'เข้ามาที่ลิงก์ https://www.postforme.dev/', en: 'Go to https://www.postforme.dev/' }, images: [] },
          { text: { th: 'กด Get Started', en: 'Click Get Started' }, images: ['/api/scheduler/channels/guide/img35.png'] },
          { text: { th: 'กรอก Email เพื่อเข้าสู่ระบบ', en: 'Enter your email to sign in' }, images: ['/api/scheduler/channels/guide/img36.png'] },
          { text: { th: 'หลังจากใส่ Email เข้ามาแล้ว ให้ดูที่กล่องจดหมายของ Email ตัวเอง เพื่อเอารหัส OTP ล็อกอินเข้าสู่ระบบ', en: 'Check your email inbox for the OTP code and use it to log in' }, images: ['/api/scheduler/channels/guide/img37.png'] },
        ],
      },
      {
        title: { th: 'ขั้นตอนชำระเงิน', en: 'Payment' },
        steps: [
          { text: { th: 'ให้กดไปที่เมนู Billing ด้านซ้ายล่าง', en: 'Click the Billing menu at the bottom-left' }, images: ['/api/scheduler/channels/guide/img38.png'] },
          {
            text: { th: 'เลือกเป็น Pro จะตก $10/เดือน', en: 'Select Pro plan at $10/month' },
            note: {
              th: 'เงื่อนไข: สามารถโพสต์ได้ 1,000 โพสต์ต่อเดือน ไม่จำกัด Account ในการเชื่อม\nให้เรากด Get Started แล้วระบบจะพาไปหน้าชำระเงิน กรอกข้อมูลและชำระเงินให้เรียบร้อย',
              en: 'Includes 1,000 posts/month with unlimited account connections.\nClick Get Started, then complete the payment on the next page.',
            },
            images: ['/api/scheduler/channels/guide/img39.png'],
          },
        ],
      },
      {
        title: { th: 'ขั้นตอนเชื่อม Facebook', en: 'Connect Facebook' },
        steps: [
          { text: { th: 'กด icon + ตรง Projects ฝั่งซ้ายมือ', en: 'Click the + icon next to Projects on the left side' }, images: ['/api/scheduler/channels/guide/yt_01_project.jpg'] },
          { text: { th: 'ตั้งชื่อ Project Name เลือก Quickstart Project จากนั้นให้กด Create Project', en: 'Enter a Project Name, select Quickstart Project, then click Create Project' }, images: ['/api/scheduler/channels/guide/fb_01_create_project.jpg'] },
          { text: { th: 'กด Enable แพลตฟอร์ม Facebook', en: 'Click Enable on the Facebook platform' }, images: ['/api/scheduler/channels/guide/fb_02_enable_facebook.jpg'] },
          { text: { th: 'หากขึ้นเป็น Connected ปุ่มสีเขียวแบบนี้ แสดงว่าเชื่อมเสร็จเรียบร้อย', en: 'If it shows a green "Connected" badge, the connection is complete' }, images: ['/api/scheduler/channels/guide/fb_03_finish_enable.jpg'] },
        ],
      },
      {
        title: { th: 'ขั้นตอนเชื่อม Account & สร้าง Channel', en: 'Connect Account & Create Channel' },
        steps: [
          { text: { th: 'ให้มาที่เมนู Social Media Accounts อยู่ฝั่งซ้ายมือตรง Projects', en: 'Go to Social Media Accounts menu on the left under Projects' }, images: ['/api/scheduler/channels/guide/img66.png'] },
          { text: { th: 'กด Connect an account ปุ่มสีฟ้า อยู่ด้านขวามือบน', en: 'Click the blue "Connect an account" button at top-right' }, images: ['/api/scheduler/channels/guide/img67.png'] },
          { text: { th: 'กดเลือก Facebook', en: 'Select Facebook' }, images: ['/api/scheduler/channels/guide/fb_04_select_platform.jpg'] },
          { text: { th: 'หน้าต่างนี้เด้งขึ้นมา กด Connect Facebook ต่อได้เลย', en: 'A dialog appears — click Connect Facebook' }, images: ['/api/scheduler/channels/guide/fb_05_connect_facebook.jpg'] },
          { text: { th: 'ระบบจะพาเราไปที่หน้าเชื่อม Account ให้กด Edit Setting', en: 'You\'ll be taken to the account connection page — click Edit Setting' }, images: ['/api/scheduler/channels/guide/fb_06_edit_setting.jpg'] },
          { text: { th: 'กดติ๊ก Opt in to current Pages only และ เลือก Page Facebook ของเราตามความต้องการ และ ทำการกด Continue', en: 'Check "Opt in to current Pages only", select your Facebook Page(s), then click Continue' }, images: ['/api/scheduler/channels/guide/fb_12_edit_select_page.jpg'] },
          { text: { th: 'ติ๊กอันบน และกด Continue', en: 'Check the top option and click Continue' }, images: ['/api/scheduler/channels/guide/fb_08_continue.jpg'] },
          { text: { th: 'กดปุ่ม Save', en: 'Click Save' }, images: ['/api/scheduler/channels/guide/fb_09_save.jpg'] },
          { text: { th: 'กดปุ่ม Got it', en: 'Click Got it' }, images: ['/api/scheduler/channels/guide/fb_10_got_it.jpg'] },
          { text: { th: 'หลังจากกดเชื่อมเสร็จแล้ว ให้กดที่คำว่า View Accounts', en: 'After connecting, click "View Accounts"' }, images: ['/api/scheduler/channels/guide/img71.png'] },
          { text: { th: 'ให้เรามากดที่ปุ่ม 3 จุด ด้านขวาสุดของแถว', en: 'Click the 3-dot menu at the far right of the row' }, images: ['/api/scheduler/channels/guide/fb_11_dot.jpg'] },
          { text: { th: 'เลือก Copy connection ID และทำการเซฟเก็บไว้', en: 'Select "Copy connection ID" and save it' }, images: ['/api/scheduler/channels/guide/img73.png'] },
          { text: { th: 'เข้ามาที่เว็บ Triple School และกดเลือกไปที่ Channels', en: 'Go to Triple School and navigate to Channels' }, images: ['/api/scheduler/channels/guide/img74.png'] },
          { text: { th: 'กดปุ่ม Add Channel ที่ด้านมุมขวา', en: 'Click Add Channel at the top-right' }, images: ['/api/scheduler/channels/guide/img75.png'] },
          { text: { th: 'ระบบจะเด้งหน้าต่างขึ้นมา ให้ทำการตั้งชื่อ Channel ให้เรียบร้อย', en: 'A dialog appears — enter a channel name' }, images: ['/api/scheduler/channels/guide/img76.png'] },
          { text: { th: 'ให้ทำการกดติ๊กที่ Post for Me (postforme.dev)', en: 'Check "Post for Me (postforme.dev)"' }, images: ['/api/scheduler/channels/guide/img77_v2.png'] },
          { text: { th: 'เลือก Project ที่ตั้งชื่อไว้ตอนใส่ API Key', en: 'Select the Project you named when adding the API Key' }, images: ['/api/scheduler/channels/guide/img78_v2.png'] },
          {
            text: { th: 'นำ Copy connection ID มาใส่ ตามแพลตฟอร์มให้ถูกต้อง และสร้างช่อง', en: 'Paste the Connection ID into the correct platform fields and create the channel' },
            images: ['/api/scheduler/channels/guide/img84.png'],
          },
        ],
      },
      {
        title: { th: 'สร้าง API Key & เชื่อมเข้า Triple School', en: 'Create API Key & Connect to Triple School' },
        steps: [
          { text: { th: 'ให้เรากลับไปที่เว็บ https://www.postforme.dev/ และกดเลือกไปที่เมนู API Keys', en: 'Go back to https://www.postforme.dev/ and click the API Keys menu' }, images: ['/api/scheduler/channels/guide/img79.png'] },
          { text: { th: 'ให้มากดที่ปุ่มสีฟ้า Create API Key อยู่ด้านขวาบน', en: 'Click the blue "Create API Key" button at top-right' }, images: ['/api/scheduler/channels/guide/img80.png'] },
          { text: { th: 'ให้ Copy เลข API Key เก็บไว้', en: 'Copy the API Key and save it' }, images: ['/api/scheduler/channels/guide/img81.png'] },
          { text: { th: 'ให้กดเข้า Billing แถบล่างซ้ายมือของ PostForMe', en: 'Click on Billing at the bottom-left menu of PostForMe' }, images: ['/api/scheduler/channels/guide/billing.jpg'] },
          { text: { th: 'ให้ดูตรง Upcoming Invoice จะมี เดือน/วัน/ปี แสดง ให้จำในส่วนนี้ไว้', en: 'Look at the Upcoming Invoice section which shows the billing date (month/day/year). Remember this date.' }, images: ['/api/scheduler/channels/guide/date.jpg'] },
          { text: { th: 'ให้กลับมาที่เว็บ Triple School กดโปรไฟล์ด้านขวาบน และเลือก Settings', en: 'Go back to Triple School, click your profile at top-right, then Settings' }, images: ['/api/scheduler/channels/guide/img82.png'] },
          { text: { th: 'เลื่อนลงมาข้างล่างสุด จะเห็นช่องใส่ Post for Me API Key\n• ใส่ชื่อเดียวกับชื่อ Project ที่สร้างไว้ใน Post for Me\n• ให้นำ API Key ที่สร้างใส่ลงไป\n• วันหมดอายุ จากขั้นตอนที่ 5', en: 'Scroll to the bottom to find the Post for Me API Key field.\n• Enter the same name as your Project in Post for Me\n• Paste the API Key\n• Set the expiry date from step 5' }, images: ['/api/scheduler/channels/guide/info.jpg'] },
          { text: { th: 'หลังจากใส่เสร็จทั้งหมดแล้วให้กดปุ่ม Icon save สีเหลือง', en: 'After filling in all fields, click the yellow save icon button' }, images: ['/api/scheduler/channels/guide/save.jpg'] },
        ],
      },
    ],
  },
];

// Helper to pick language text
const l = (obj: L, lang: Language) => obj[lang];

// Prefix image path with API URL
const imgUrl = (path: string) => path.startsWith('/api/') ? `${api.getApiUrl()}${path}` : path;

const ImageLightbox = ({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) => {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white bg-black/50 rounded-full w-10 h-10 flex items-center justify-center text-xl font-bold"
      >
        ✕
      </button>
      <img
        src={imgUrl(src)}
        alt={alt}
        className="max-w-full max-h-[90vh] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

const Linkify = ({ text }: { text: string }) => {
  const urlRegex = /(https?:\/\/[^\s,)]+)/g;
  const parts = text.split(urlRegex);
  return (
    <>
      {parts.map((part, i) =>
        urlRegex.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-[#FFB300] hover:underline break-all">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
};

const StepItem = ({ step, index, lang }: { step: Step; index: number; lang: Language }) => {
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <div className="flex gap-3 py-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold mt-0.5">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm whitespace-pre-line"><Linkify text={l(step.text, lang)} /></p>
        {step.note && (
          <p className="text-xs text-muted-foreground mt-1 bg-muted/50 rounded px-2 py-1">
            💡 <Linkify text={l(step.note, lang)} />
          </p>
        )}
        {step.images && step.images.length > 0 && (
          <div className="mt-2">
            {step.images.map((img, i) => (
              <img
                key={i}
                src={imgUrl(img)}
                alt={`${lang === 'th' ? 'ขั้นตอนที่' : 'Step'} ${index + 1}`}
                className="rounded-lg border border-border max-w-full cursor-pointer hover:opacity-90 transition-opacity"
                style={{ maxHeight: 300 }}
                onClick={() => setLightbox(img)}
              />
            ))}
          </div>
        )}
        {lightbox && (
          <ImageLightbox src={lightbox} alt={`${lang === 'th' ? 'ขั้นตอนที่' : 'Step'} ${index + 1}`} onClose={() => setLightbox(null)} />
        )}
      </div>
    </div>
  );
};

const SubSectionBlock = ({ sub, lang }: { sub: SubSection; lang: Language }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
        <span className="font-medium text-sm">{l(sub.title, lang)}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {sub.steps.length} {lang === 'th' ? 'ขั้นตอน' : 'steps'}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 divide-y divide-border/50">
          {sub.steps.map((step, i) => (
            <StepItem key={i} step={step} index={i} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
};

const SectionCard = ({ section, lang, defaultOpen = false }: { section: Section; lang: Language; defaultOpen?: boolean }) => {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-5 flex items-center gap-4 hover:bg-muted/20 transition-colors text-left"
      >
        <div
          className="h-12 w-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
          style={{ backgroundColor: section.color + '20' }}
        >
          {section.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-base">{section.title}</h2>
          <p className="text-sm text-muted-foreground">{l(section.description, lang)}</p>
          {(section as any).warning && (
            <p className="text-xs text-amber-500 mt-1">{l((section as any).warning, lang)}</p>
          )}
        </div>
        <div className="flex-shrink-0">
          {expanded ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-3">
          {section.subsections.map((sub, i) => (
            <SubSectionBlock key={i} sub={sub} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
};

const LATE_CUTOFF = '2026-03-28T00:00:00.000Z';
const LATE_REMOVAL = '2026-04-28T00:00:00.000Z';

const Guide = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const openSection = searchParams.get('open');
  const { language, setLanguage, t } = useLanguage();
  const { user } = useAuth();
  const showLate = useMemo(() => {
    if (new Date() >= new Date(LATE_REMOVAL)) return false;
    if (!user?.createdAt) return true;
    return new Date(user.createdAt) < new Date(LATE_CUTOFF);
  }, [user?.createdAt]);

  return (
    <div className="page-wrapper">
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{t('guide.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('guide.subtitle')}</p>
        </div>
        <button
          onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-muted/50 hover:bg-muted transition-colors text-sm font-medium"
        >
          {language === 'th' ? '🇹🇭 TH' : '🇺🇸 EN'}
        </button>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-3xl space-y-6">
        <div className="bg-card p-5 rounded-xl border border-border">
          <h2 className="font-semibold mb-2">{t('guide.introTitle')}</h2>
          <p className="text-sm text-muted-foreground mb-4">{t('guide.introDesc')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {sections.filter(s => s.id !== 'late' && s.id !== 'vidgo').map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border"
              >
                <span className="text-xl">{s.icon}</span>
                <div>
                  <div className="text-sm font-medium">{s.title}</div>
                  <div className="text-xs text-muted-foreground">{l(s.description, language)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {sections.filter(s => s.id !== 'late' && s.id !== 'postforme' && s.id !== 'vidgo').map((section) => (
          <SectionCard key={section.id} section={section} lang={language} defaultOpen={openSection === section.id} />
        ))}

        {/* Post for Me only — Late and VidGo are hidden */}
        {sections.filter(s => s.id === 'postforme').map((section) => (
          <SectionCard key={section.id} section={section} lang={language} defaultOpen={openSection === section.id} />
        ))}
      </div>
    </div>
  );
};

export default Guide;
