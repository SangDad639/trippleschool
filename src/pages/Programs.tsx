import { useNavigate } from 'react-router-dom';
import PublicHeader from '@/components/PublicHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Crown,
  ArrowRight,
  CheckCircle2,
  Monitor,
  Apple,
  Download,
  WifiOff,
  Mic,
  Languages,
  Infinity as InfinityIcon,
} from 'lucide-react';

// ── ลิงก์ดาวน์โหลดตัวติดตั้ง ──────────────────────────────────────────────
// วางลิงก์ไฟล์ติดตั้งตรง `url` ด้านล่างได้เลย (หรือจะตั้งค่าเป็น env var
// VITE_TRIPLE_VOICE_WIN_URL / VITE_TRIPLE_VOICE_MAC_URL ตอน build ก็ได้)
// ถ้าเว้นว่างไว้ ปุ่มจะขึ้นสถานะ "เร็วๆ นี้" เหมือนเดิม
type DownloadTarget = {
  key: string;
  label: string;
  icon: typeof Monitor;
  url: string;
};

const DOWNLOADS: DownloadTarget[] = [
  {
    key: 'windows',
    label: 'ดาวน์โหลดสำหรับ Windows',
    icon: Monitor,
    url:
      import.meta.env.VITE_TRIPLE_VOICE_WIN_URL ||
      'https://www.mediafire.com/file/cgeolv2l9ves9xi/Triple_Voice.exe/file',
  },
  {
    key: 'macos',
    label: 'ดาวน์โหลดสำหรับ macOS',
    icon: Apple,
    url: import.meta.env.VITE_TRIPLE_VOICE_MAC_URL || '',
  },
];

// ลิงก์ที่ชี้ไป "ตัวไฟล์" ตรงๆ (ลงท้าย .exe/.msi/.dmg/.pkg/.zip) → กดแล้วโหลดทันที
// ส่วนลิงก์หน้าเว็บฝากไฟล์ (MediaFire/Drive) ชี้ไปหน้า HTML ไม่ใช่ไฟล์ ถ้าเปิดในแท็บเดิม
// ผู้ใช้จะหลุดออกจากเว็บเราไปเลย → ต้องเปิดแท็บใหม่แทน
// หมายเหตุ: MediaFire อย่าง `.../Triple_Voice.exe/file` ลงท้ายด้วย /file ไม่ใช่ .exe
// จึงถูกจัดเป็นลิงก์หน้าเว็บอย่างถูกต้อง
const isDirectFileUrl = (url: string) => /\.(exe|msi|dmg|pkg|zip)(\?|$)/i.test(url);

const FEATURES = [
  { icon: Languages, text: 'สร้างเสียงพูดจากข้อความ (Text-to-Speech) ทั้งภาษาไทยและอังกฤษ หลายเสียง ชาย-หญิง' },
  { icon: Mic, text: 'โคลนเสียงของคุณเอง — อัดเสียงตัวอย่างแล้วให้ AI พูดแทนด้วยน้ำเสียงของคุณ' },
  { icon: WifiOff, text: 'ทำงานออฟไลน์ 100% บนเครื่องของคุณ — ข้อมูลไม่ถูกส่งขึ้นเน็ต ปลอดภัยเต็มที่' },
  { icon: InfinityIcon, text: 'ใช้งานได้ไม่จำกัดจำนวนครั้ง ไม่มีค่าใช้จ่ายรายเดือนเพิ่ม — สิทธิ์สมาชิก Triple School' },
];

// Program library for members. First title: Triple Voice (desktop TTS app).
const Programs = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      {/* Page header */}
      <div className="max-w-6xl mx-auto px-4 pt-10 pb-6 text-center">
        <Badge className="bg-[#FFB300]/15 text-[#FFB300] border border-[#FFB300]/30 mb-3">
          <Crown className="h-3.5 w-3.5 mr-1" /> สิทธิพิเศษสมาชิกรายเดือน / รายปี
        </Badge>
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Program สำหรับสมาชิก</h1>
        <p className="text-gray-400">แอปและเครื่องมือพิเศษ ดาวน์โหลดใช้ได้ฟรีสำหรับสมาชิก Triple School</p>
      </div>

      {/* Triple Voice */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden">
          <div className="grid lg:grid-cols-2 gap-0">
            {/* Screenshots */}
            <div className="relative bg-[#0d0d14] p-4 lg:p-6 flex flex-col justify-center gap-3">
              <img
                src="/programs/triple-voice-app.png"
                alt="หน้าจอสร้างเสียงของโปรแกรม Triple Voice"
                loading="lazy"
                className="w-full rounded-lg border border-gray-800 shadow-2xl shadow-black/50"
              />
              <img
                src="/programs/triple-voice-voices.png"
                alt="คลังเสียงไทยในโปรแกรม Triple Voice"
                loading="lazy"
                className="w-full rounded-lg border border-gray-800 opacity-90"
              />
            </div>

            {/* Info */}
            <div className="p-6 lg:p-8 flex flex-col">
              <div className="flex items-center gap-3 mb-3">
                <img src="/programs/triple-voice-mark.svg" alt="" className="h-12 w-auto" />
                <div>
                  <h2 className="text-2xl font-bold text-white leading-tight">Triple Voice</h2>
                  <p className="text-gray-500 text-xs">โปรแกรมพากย์เสียง AI บนเครื่องของคุณ · v1.0.0</p>
                </div>
              </div>

              <p className="text-gray-300 text-sm leading-relaxed mb-5">
                โปรแกรมสร้างเสียงพากย์ด้วย AI สำหรับครีเอเตอร์ — พิมพ์ข้อความแล้วได้ไฟล์เสียงคุณภาพสูงทันที
                ใช้พากย์คลิป ทำคอนเทนต์ ละครสั้น หรือวิดีโอรีวิวสินค้า โดยไม่ต้องอัดเสียงเอง
                และไม่ต้องจ่ายค่าบริการ TTS รายครั้งอีกต่อไป
              </p>

              <ul className="space-y-3 mb-6">
                {FEATURES.map((f) => (
                  <li key={f.text} className="flex items-start gap-2.5 text-sm text-gray-300">
                    <f.icon className="h-4 w-4 text-[#FFB300] mt-0.5 shrink-0" />
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>

              {/* Download buttons */}
              <div className="mt-auto">
                <div className="flex flex-col sm:flex-row gap-3">
                  {DOWNLOADS.map((d) =>
                    d.url ? (
                      <Button
                        key={d.key}
                        asChild
                        className="flex-1 h-11 bg-purple-600 hover:bg-purple-700"
                      >
                        {isDirectFileUrl(d.url) ? (
                          // ลิงก์ไฟล์ตรง: กดแล้วดาวน์โหลดทันที ไม่เด้งออกจากหน้าเว็บ
                          <a href={d.url} download>
                            <d.icon className="h-4 w-4 mr-2" />
                            {d.label}
                            <Download className="h-4 w-4 ml-2" />
                          </a>
                        ) : (
                          // ลิงก์หน้าเว็บฝากไฟล์ (MediaFire): ต้องเปิดแท็บใหม่ ไม่งั้นผู้ใช้
                          // จะถูกพาออกจากเว็บเราไปเลย — หน้าตาปุ่มเหมือนกันทุกอย่าง
                          <a href={d.url} target="_blank" rel="noopener noreferrer">
                            <d.icon className="h-4 w-4 mr-2" />
                            {d.label}
                            <Download className="h-4 w-4 ml-2" />
                          </a>
                        )}
                      </Button>
                    ) : (
                      <Button
                        key={d.key}
                        disabled
                        className="flex-1 h-11 bg-purple-600 disabled:opacity-60"
                      >
                        <d.icon className="h-4 w-4 mr-2" />
                        {d.label}
                        <Download className="h-4 w-4 ml-2" />
                      </Button>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Member gate strip */}
          <div className="border-t border-gray-800 bg-[#FFB300]/5 px-6 py-4 flex flex-col sm:flex-row items-center gap-3">
            <p className="flex-1 text-sm text-yellow-200/90 text-center sm:text-left">
              <Crown className="inline h-4 w-4 mr-1.5 text-[#FFB300]" />
              โปรแกรมนี้แจกเฉพาะสมาชิกรายเดือนและรายปีเท่านั้น — สมัครวันนี้ เข้าเรียนได้ทุกคอร์สพร้อมรับโปรแกรมฟรี
            </p>
            <Button size="sm" onClick={() => navigate('/pricing')} className="bg-purple-600 hover:bg-purple-700 shrink-0">
              ดูแพ็กเกจสมาชิก
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>

        {/* Highlights row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          {[
            { label: 'เสียงไทย + อังกฤษ', sub: 'หลายเสียงให้เลือก' },
            { label: 'โคลนเสียงตัวเอง', sub: 'Voice Cloning ในตัว' },
            { label: 'ออฟไลน์ 100%', sub: 'ไม่ต้องต่ออินเทอร์เน็ต' },
            { label: 'ไม่จำกัดการใช้งาน', sub: 'ไม่มีค่าใช้จ่ายรายครั้ง' },
          ].map((h) => (
            <div key={h.label} className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 text-center">
              <p className="text-sm font-semibold text-white flex items-center justify-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-400" /> {h.label}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{h.sub}</p>
            </div>
          ))}
        </div>

        <p className="text-center text-gray-500 text-sm mt-10">โปรแกรมอื่นๆ สำหรับสมาชิกกำลังตามมาเร็วๆ นี้ 🚧</p>
      </div>
    </div>
  );
};

export default Programs;
