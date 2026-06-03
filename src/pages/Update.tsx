import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, Copy, Check, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';

// Extract YouTube video ID
function youtubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?&]+)/,
    /youtube\.com\/embed\/([^?&]+)/,
    /youtube-nocookie\.com\/embed\/([^?&]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}
function youtubeThumb(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/maxresdefault.jpg` : null;
}

// Click-to-play: shows clean YouTube thumbnail with play button (no chrome)
// → click → swap to actual iframe with autoplay (chrome unavoidable on YouTube's side after play)
function YouTubePreview({ url, title }: { url: string; title?: string }) {
  const [playing, setPlaying] = useState(false);
  const thumb = youtubeThumb(url);
  if (playing) {
    return (
      <iframe
        src={youtubeEmbed(url) + '&autoplay=1'}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title={title}
      />
    );
  }
  if (thumb) {
    return (
      <button type="button" onClick={() => setPlaying(true)} className="relative w-full h-full block group" aria-label="Play video">
        <img src={thumb} alt={title || ''} className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).src = thumb.replace('maxresdefault', 'hqdefault'); }} />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
          <div className="w-16 h-16 rounded-full bg-red-600/90 flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
            <Play className="h-7 w-7 text-white fill-white ml-1" />
          </div>
        </div>
      </button>
    );
  }
  return (
    <iframe
      src={youtubeEmbed(url)}
      className="w-full h-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      title={title}
    />
  );
}

// Build a YouTube embed URL with branding stripped (privacy-enhanced + minimal chrome)
function youtubeEmbed(url: string): string {
  if (!url) return '';
  const QS = '?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3';
  let base: string;
  if (url.includes('youtube-nocookie.com/embed/')) base = url.split('?')[0];
  else if (url.includes('embed/')) base = url.split('?')[0].replace('youtube.com', 'youtube-nocookie.com');
  else if (url.includes('playlist')) {
    try {
      const list = new URL(url).searchParams.get('list');
      return list ? `https://www.youtube-nocookie.com/embed/videoseries${QS}&list=${list}` : url;
    } catch { return url; }
  }
  else if (url.includes('youtu.be/')) base = `https://www.youtube-nocookie.com/embed/${url.split('youtu.be/')[1].split('?')[0]}`;
  else if (url.includes('watch?v=')) base = url.replace('watch?v=', 'embed/').replace('youtube.com', 'youtube-nocookie.com').split('?')[0];
  else return url;
  return base + QS;
}

// Map API row (snake_case) → UpdateEntry component shape
function mapApiBanner(row: any): UpdateEntry {
  return {
    id: row.slug,
    date: { th: row.date_th || '', en: row.date_en || '' },
    title: { th: row.title_th || '', en: row.title_en || '' },
    detailTitle: row.detail_title_th || row.detail_title_en
      ? { th: row.detail_title_th || '', en: row.detail_title_en || '' }
      : undefined,
    banner: row.banner || undefined,
    videoUrl: row.video_url || undefined,
    details: Array.isArray(row.details) ? row.details : [],
    links: Array.isArray(row.links) ? row.links : [],
    prompts: Array.isArray(row.prompts) ? row.prompts : [],
  };
}

interface DetailItem {
  text: { th: string; en: string };
  videoUrl?: string;
  isHeading?: boolean;
  children?: { text: { th: string; en: string }; videoUrl?: string }[];
}

interface PromptBlock {
  label: string;
  text: string;
}

interface UpdateEntry {
  id: string;
  date: { th: string; en: string };
  title: { th: string; en: string };
  detailTitle?: { th: string; en: string };
  banner?: string;
  videoUrl?: string;
  details?: DetailItem[];
  links?: { label: { th: string; en: string }; url: string }[];
  prompts?: PromptBlock[];
}

// เพิ่ม update ใหม่ที่นี่ — อันล่าสุดอยู่บนสุด (จะแสดงเป็นช่องที่ 1 เสมอ)
export const updates: UpdateEntry[] = [
  {
    id: 'how-to-idol-template',
    date: { th: '25 เม.ย. 2569', en: 'Apr 25, 2026' },
    title: { th: 'วิธีใช้งาน Idol Template', en: 'How to Use Idol Template' },
    detailTitle: { th: 'คู่มือใช้งาน โหมด Idol Template', en: 'Guide to Using Idol Template Mode' },
    banner: '/ChatGPT Image Apr 25, 2026, 10_53_04 AM.png',
    details: [
      {
        text: { th: 'คู่มือการใช้งาน Idol Template', en: 'How to Use Idol Template' },
        videoUrl: 'https://www.youtube.com/watch?v=uXiK24GiadU',
      },
      {
        text: { th: 'วิธีสร้าง Custom Idol Template', en: 'How to Create Custom Idol Template' },
        videoUrl: 'https://www.youtube.com/embed/yKCh8UfAnxY',
      },
    ],
    prompts: [
      {
        label: 'Image Prompt',
        text: `amateur smartphone photo, realistic casual snapshot taken with iPhone, candid portrait,

voluptuous young woman with very large breasts and massive cleavage,
arms raised behind head exposing thick dark hairy armpits,

inspired by the woman in the attached reference image 1,
wearing clothing and accessories from the attached reference image 2,
with background from the attached reference image 3,

soft indoor natural light, slight lens flare,

shot on smartphone, 26mm lens, f/1.8, slight depth of field, soft bokeh,
mild digital noise and film grain, natural color grading,
unedited raw phone photo style, authentic everyday mobile photo,
highly photorealistic, indistinguishable from real iPhone photo`,
      },
      {
        label: 'VDO Prompt',
        text: `arms raised behind head, slow stretching motion, slowly and teasingly sticking out tongue, wet glossy tongue licking lips sensually, eye contact with camera, subtle body sway, deep breathing, natural movement of armpit hair, seductive and erotic atmosphere, smooth cinematic slow motion`,
      },
    ],
  },
  {
    id: 'how-to-custom-viral-template',
    date: { th: '10 เม.ย. 2569', en: 'Apr 10, 2026' },
    title: { th: 'วิธีสร้าง Custom Viral Template', en: 'How to Make Custom Viral Template' },
    detailTitle: { th: 'วิธีสร้าง Custom Viral Template', en: 'How to Make Custom Viral Template' },
    banner: '/Create_viral_YouTube_202604101128.jpeg',
    details: [
      {
        text: { th: 'เริ่มต้นใช้งาน', en: 'Getting Started' },
        videoUrl: 'https://youtu.be/llPhOpz4SAw',
      },
    ],
    links: [
      { label: { th: 'ไฟล์แนบ', en: 'Attachment' }, url: 'https://docs.google.com/document/d/14ArosG22Oi4SfdyrWbV78GHpNmot5bfzwITXudbwIxo/edit?usp=sharing' },
    ],
  },
  {
    id: 'how-to-triple-viral',
    date: { th: '9 เม.ย. 2569', en: 'Apr 9, 2026' },
    title: { th: 'วิธีใช้งาน Triple Viral', en: 'How to Triple Viral' },
    detailTitle: { th: 'คู่มือการใช้งาน Triple Viral แบบ Step-by-Step', en: 'How to Triple Viral - Step-by-Step Guide' },
    banner: '/Person_pointing_at_202604091357.jpeg',
    details: [
      {
        text: { th: 'เริ่มต้นใช้งาน', en: 'Getting Started' },
        videoUrl: 'https://www.youtube.com/watch?v=q9d9Bp1Fyp8',
      },
    ],
  },
  {
    id: 'postforme-setup',
    date: { th: '28 มี.ค. 2569', en: 'Mar 28, 2026' },
    title: { th: 'วิธีการสร้าง API และ เชื่อมแพลตฟอร์มต่างๆ', en: 'How to Create API & Connect Platforms' },
    detailTitle: { th: 'คลิปสอนชำระเงิน และ สร้าง API Key เพื่อนำไปเชื่อมกับเว็บ Triple Viral', en: 'Tutorial: Payment & Create API Key to Connect with Triple Viral' },
    banner: '/banner1.jpg',
    details: [
      {
        text: { th: 'การชำระเงิน และ สร้าง API Key', en: 'Payment & API Key Creation' },
        videoUrl: 'https://www.youtube.com/playlist?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH',
      },
      {
        text: { th: 'วิธีสร้าง Social Account สำหรับใช้เชื่อมเข้ากับแพลตฟอร์มต่างๆ', en: 'How to create Social Accounts to connect with platforms' },
        isHeading: true,
        children: [
          { text: { th: 'Facebook', en: 'Facebook' }, videoUrl: 'https://www.youtube.com/embed/-iQY_NEZjFY?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH' },
          { text: { th: 'YouTube', en: 'YouTube' }, videoUrl: 'https://www.youtube.com/embed/NLcQahund3U?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH' },
          { text: { th: 'Instagram', en: 'Instagram' }, videoUrl: 'https://www.youtube.com/embed/zg0JKat1ydg?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH' },
          { text: { th: 'TikTok', en: 'TikTok' }, videoUrl: 'https://www.youtube.com/embed/DAIyO1xQulg?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH' },
        ],
      },
    ],
  },
];

// หน้ารวม /update — grid card ทั้งหมด (API-driven, fallback ไป hardcoded list)
const Update = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const l = (obj: { th: string; en: string }) => obj[language] || obj.th;

  const [items, setItems] = useState<UpdateEntry[]>(updates);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPublicBanners()
      .then((rows: any[]) => {
        if (Array.isArray(rows) && rows.length > 0) setItems(rows.map(mapApiBanner));
      })
      .catch(() => { /* fallback to hardcoded */ })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-wrapper">
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="container mx-auto px-4 max-w-7xl py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">{language === 'th' ? 'อัปเดตล่าสุด' : 'Latest Updates'}</h1>
            <p className="text-xs text-muted-foreground">{language === 'th' ? 'ประวัติการอัปเดตระบบ' : 'System update history'}</p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {items.map((update) => (
            <div
              key={update.id}
              className="glass-card rounded-xl overflow-hidden hover:border-[#FFB300]/60 transition-colors group cursor-pointer"
              onClick={() => navigate(`/update/${update.id}`)}
            >
              <div className="aspect-video overflow-hidden bg-gray-900">
                {update.banner ? (
                  <img src={update.banner} alt={l(update.title)} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    {l(update.title)}
                  </div>
                )}
              </div>
              <div className="p-3 space-y-2">
                <span className="text-[10px] text-[#FFB300]">{l(update.date)}</span>
                <p className="text-xs font-medium text-foreground line-clamp-2">{l(update.title)}</p>
                <span className="w-full inline-flex items-center justify-center py-1.5 rounded-md border border-[#FFB300]/30 text-[10px] text-[#FFB300] font-medium mt-1">
                  {language === 'th' ? 'คลิกเพื่อดูรายละเอียด' : 'Click for details'}
                </span>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
};

const CopyablePrompt = ({ label, text }: { label: string; text: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold text-white">
        {label}
        {label === 'Image Prompt' && (
          <span className="ml-2 text-sm font-normal text-red-400">* หมายเหตุ: ข้อความสีแดงห้ามเปลี่ยน</span>
        )}
      </h3>
      <div className="relative rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <span className="text-xs text-zinc-500">prompt</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="whitespace-pre-wrap text-sm text-zinc-300 font-mono leading-relaxed pr-24">
          {text.split('\n').map((line, i) => (
            <span key={i}>
              {/reference image \d/.test(line)
                ? <span className="text-red-400">{line}</span>
                : line}
              {i < text.split('\n').length - 1 ? '\n' : ''}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
};

// หน้าเฉพาะ /update/:id — แสดง detail ของ update นั้น (API-first, fallback hardcoded)
export const UpdateDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { language } = useLanguage();
  const l = (obj: { th: string; en: string }) => obj[language] || obj.th;

  const [update, setUpdate] = useState<UpdateEntry | undefined>(() => updates.find((u) => u.id === id));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPublicBanners()
      .then((rows: any[]) => {
        if (Array.isArray(rows)) {
          const found = rows.map(mapApiBanner).find(u => u.id === id);
          if (found) setUpdate(found);
        }
      })
      .catch(() => { /* keep hardcoded fallback */ })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading && !update) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!update) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">{language === 'th' ? 'ไม่พบอัปเดตนี้' : 'Update not found'}</p>
          <Button onClick={() => navigate('/update')}>
            {language === 'th' ? 'กลับหน้าอัปเดต' : 'Back to Updates'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="container mx-auto px-4 max-w-3xl py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold line-clamp-1">{l(update.title)}</h1>
            <p className="text-xs text-muted-foreground">{l(update.date)}</p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-3xl space-y-6">
        {update.banner && (
          <div className="rounded-xl overflow-hidden border border-[#FFB300]/30">
            <img src={update.banner} alt={l(update.title)} className="w-full object-cover" />
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full bg-[#FFB300]/20 text-[#FFB300] text-xs font-semibold">
              {l(update.date)}
            </span>
          </div>
          <h2 className="text-xl font-bold text-[#FFB300]">{l(update.detailTitle || update.title)}</h2>

          {update.details && update.details.length > 0 && (
            <div className="space-y-6">
              {update.details.map((item, j) => (
                <div key={j} className="space-y-3">
                  {item.isHeading ? (
                    <h2 className="text-xl font-bold text-[#FFB300]">{l(item.text)}</h2>
                  ) : item.videoUrl ? (
                    <div className="glass-card rounded-2xl p-4">
                      <div className="flex items-center gap-3 mb-4 px-2">
                        <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                          <Play className="h-4 w-4 text-primary" />
                        </div>
                        <h3 className="text-base md:text-lg font-semibold text-white">{l(item.text)}</h3>
                      </div>
                      <div className="aspect-video rounded-xl overflow-hidden">
                        <YouTubePreview url={item.videoUrl} title={l(item.text)} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FFB300]/10 border border-[#FFB300]/30">
                      <Play className="h-4 w-4 text-[#FFB300] shrink-0 fill-[#FFB300]" />
                      <span className="text-sm font-semibold text-[#FFB300]">{l(item.text)}</span>
                    </div>
                  )}
                  {item.children && (
                    <div className="space-y-5">
                      {item.children.map((child, k) => (
                        <div key={k} className="glass-card rounded-2xl p-4">
                          <div className="flex items-center gap-3 mb-4 px-2">
                            <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                              <Play className="h-4 w-4 text-primary" />
                            </div>
                            <h3 className="text-base md:text-lg font-semibold text-white">{l(child.text)}</h3>
                          </div>
                          {child.videoUrl && (
                            <div className="aspect-video rounded-xl overflow-hidden">
                              <YouTubePreview url={child.videoUrl} title={l(child.text)} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {update.links && update.links.length > 0 && (
            <div className="flex flex-wrap gap-3 pt-2">
              {update.links.map((link, i) => (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer">
                  <Button className="bg-[#FFB300] hover:bg-[#FFB300]/80 text-black font-semibold">
                    {l(link.label)}
                  </Button>
                </a>
              ))}
            </div>
          )}

          {update.prompts && update.prompts.length > 0 && (
            <div className="space-y-6 pt-4">
              <h2 className="text-xl font-bold text-[#FFB300]">
                {language === 'th' ? 'ตัวอย่าง Prompt' : 'Example Prompts'}
              </h2>
              {update.prompts.map((prompt, i) => (
                <CopyablePrompt key={i} label={prompt.label} text={prompt.text} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Update;
