import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2 } from 'lucide-react';

/** ตัวอย่างผลงานของ Ebook (แกลเลอรีรูป/คลิป YouTube แนวนอน-แนวตั้ง)
 *  orientation อ่านจากไฟล์/ลิงก์อัตโนมัติ (Shorts = แนวตั้ง) แต่แอดมินสลับเองได้ */
export interface EbookMediaSample {
  type: 'image' | 'youtube';
  url?: string;
  youtube_id?: string;
  orientation: 'landscape' | 'portrait';
  title: string;
}

/** ดึง id จากลิงก์ YouTube ทุกทรง (watch?v= / youtu.be / shorts / embed / live) */
export function ytIdFromUrl(raw: string): string | null {
  const m = raw.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,20})/);
  return m ? m[1] : null;
}

// ตัวแก้ไขตัวอย่างผลงานของ Ebook — แยก component จากฝั่งคอร์สตามที่ user สั่ง
// (โครงเริ่มจากตัวคอร์ส แต่ต่อจากนี้ปรับฝั่งไหนไม่กระทบอีกฝั่ง)
// รูป: อัปโหลดแล้วอ่านแนวนอน/แนวตั้งจากขนาดไฟล์เอง · วิดีโอ: แปะลิงก์ YouTube
// (Shorts = แนวตั้งอัตโนมัติ) · รูปยังอัปขึ้น prefix course-sample/ ร่วมกับคอร์ส
// เพราะ sanitize ฝั่ง server ล็อก prefix นี้ไว้ทางเดียว
const EbookSamplesEditor = ({
  label = '🎞️ ตัวอย่างผลงาน (แกลเลอรีบนหน้า Ebook)',
  hint = 'รูปอ่านแนวนอน/แนวตั้งจากไฟล์อัตโนมัติ · วิดีโอแปะลิงก์ YouTube (Shorts = แนวตั้ง) · ไม่ใส่ = ไม่มี section ตัวอย่าง',
  items,
  onChange,
}: {
  label?: string;
  hint?: string;
  items: EbookMediaSample[];
  onChange: (items: EbookMediaSample[]) => void;
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [ytUrl, setYtUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (idx: number, patch: Partial<EbookMediaSample>) =>
    onChange(items.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('รูปต้องไม่เกิน 10MB'); return; }
    try {
      setBusy(true);
      // อ่านแนวจากขนาดรูปจริง — แอดมินไม่ต้องเลือกเอง
      const orientation = await new Promise<'landscape' | 'portrait'>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalHeight > img.naturalWidth ? 'portrait' : 'landscape');
        img.onerror = () => resolve('landscape');
        img.src = URL.createObjectURL(file);
      });
      const r = await api.uploadCourseSample(file);
      onChange([...items, { type: 'image', url: r.url, orientation, title: '' }]);
      toast.success('เพิ่มรูปตัวอย่างแล้ว');
    } catch (err: any) {
      toast.error(err?.message || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addYoutube = () => {
    const id = ytIdFromUrl(ytUrl.trim());
    if (!id) { toast.error('ลิงก์ YouTube ไม่ถูกต้อง'); return; }
    const orientation = /\/shorts\//.test(ytUrl) ? 'portrait' : 'landscape';
    onChange([...items, { type: 'youtube', youtube_id: id, orientation, title: '' }]);
    setYtUrl('');
  };

  return (
    <div>
      <Label>{label}</Label>
      <p className="text-gray-500 text-xs mt-0.5">{hint}</p>
      <div className="mt-2 space-y-2">
        {items.map((sample, idx) => (
          <div key={idx} className="flex items-center gap-2 rounded-md border border-gray-800 p-2">
            <div className={`flex-none rounded overflow-hidden bg-gray-800 ${sample.orientation === 'portrait' ? 'w-8 h-14' : 'w-16 h-9'}`}>
              <img
                src={sample.type === 'youtube'
                  ? `https://i.ytimg.com/vi/${sample.youtube_id}/mqdefault.jpg`
                  : api.mediaUrl(sample.url)}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
            <span className="text-[10px] text-gray-500 flex-none w-12 text-center">
              {sample.type === 'youtube' ? '🎬 YT' : '🖼 รูป'}
            </span>
            <Input
              value={sample.title}
              onChange={(e) => update(idx, { title: e.target.value.slice(0, 120) })}
              placeholder="คำบรรยาย (ไม่บังคับ)"
              className="flex-1 h-9 text-sm"
            />
            <Button
              type="button" size="sm" variant="outline" className="h-9 px-2 text-xs shrink-0"
              title="สลับแนวนอน/แนวตั้ง"
              onClick={() => update(idx, { orientation: sample.orientation === 'portrait' ? 'landscape' : 'portrait' })}
            >
              {sample.orientation === 'portrait' ? '↕ ตั้ง' : '↔ นอน'}
            </Button>
            <div className="flex flex-col shrink-0">
              <button type="button" className="text-gray-500 hover:text-white text-xs leading-none py-0.5 px-1" onClick={() => move(idx, -1)}>▲</button>
              <button type="button" className="text-gray-500 hover:text-white text-xs leading-none py-0.5 px-1" onClick={() => move(idx, 1)}>▼</button>
            </div>
            <Button type="button" size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-9 px-2 shrink-0" onClick={() => remove(idx)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            อัปโหลดรูป
          </Button>
          <div className="flex gap-2 flex-1">
            <Input
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="วางลิงก์ YouTube / Shorts..."
              className="h-9 text-sm flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addYoutube(); } }}
            />
            <Button type="button" size="sm" variant="outline" disabled={!ytUrl.trim()} onClick={addYoutube}>
              <Plus className="h-3.5 w-3.5 mr-1" />YouTube
            </Button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
};

export default EbookSamplesEditor;
