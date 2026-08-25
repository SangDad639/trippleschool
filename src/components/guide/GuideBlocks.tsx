import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Check, X, Info, AlertTriangle, Lightbulb, Play, ArrowUpRight, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { GuideBlock, Localized } from './guideTypes';

type Lang = 'th' | 'en';
const pick = (value: Localized, lang: Lang) => value[lang] || value.th;

// ── โทนของกล่องเน้น ───────────────────────────────────────────────────────
const CALLOUT_TONES = {
  info: { icon: Info, bar: 'bg-sky-400', text: 'text-sky-300', wrap: 'bg-sky-500/[0.07] border-sky-500/25' },
  warn: { icon: AlertTriangle, bar: 'bg-red-400', text: 'text-red-300', wrap: 'bg-red-500/[0.07] border-red-500/25' },
  tip: { icon: Lightbulb, bar: 'bg-[#FFB300]', text: 'text-[#FFB300]', wrap: 'bg-[#FFB300]/[0.07] border-[#FFB300]/25' },
} as const;

/** วิดีโอ YouTube แบบกดก่อนโหลด — ประหยัดเน็ตและหน่วยความจำบนมือถือ */
function GuideVideo({ url, title }: { url: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  const id = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];

  if (!id) return null;

  if (playing) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1&autoplay=1`}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title={title}
      />
    );
  }

  return (
    <button type="button" onClick={() => setPlaying(true)} className="group relative block w-full h-full" aria-label={title}>
      <img
        src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
        alt=""
        className="w-full h-full object-cover"
        loading="lazy"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/40">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600/90 shadow-2xl transition-transform group-hover:scale-110">
          <Play className="ml-0.5 h-6 w-6 fill-white text-white" />
        </span>
      </span>
    </button>
  );
}

/** ปุ่มลิงก์ท้ายบล็อก — ลิงก์ในเว็บใช้ Link, ลิงก์นอกเปิดแท็บใหม่ */
function GuideLink({ label, to, href }: { label: string; to?: string; href?: string }) {
  const className =
    'group inline-flex items-center gap-1.5 rounded-full border border-[#FFB300]/30 bg-[#FFB300]/10 px-4 py-2 text-sm font-medium text-[#FFB300] transition-colors hover:bg-[#FFB300]/20';

  if (to) {
    return (
      <Link to={to} className={className}>
        {label}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
      <ArrowUpRight className="h-3.5 w-3.5" />
    </a>
  );
}

interface GuideBlockViewProps {
  block: GuideBlock;
  /** ลำดับบล็อกในบทความ — ใช้เป็น anchor id ของหัวข้อ (ให้ตรงกับ guideHeadings) */
  index: number;
}

/** เรนเดอร์บล็อกเนื้อหา 1 ชิ้นของคู่มือ */
const GuideBlockView = ({ block, index }: GuideBlockViewProps) => {
  const { language } = useLanguage();
  const lang = language as Lang;
  const l = (value: Localized) => pick(value, lang);

  switch (block.kind) {
    case 'para':
      return <p className="text-[15px] leading-relaxed text-zinc-300">{l(block.body)}</p>;

    case 'heading':
      return (
        <h2 id={`s${index}`} className="scroll-mt-32 pt-4 text-lg font-bold text-white">
          <span className="mr-2 text-[#FFB300]">/</span>
          {l(block.body)}
        </h2>
      );

    case 'steps':
      return (
        <ol className="relative space-y-5 border-l border-dashed border-zinc-700/80 pl-7">
          {block.items.map((item, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[38px] flex h-6 w-6 items-center justify-center rounded-full bg-[#FFB300] text-[11px] font-bold text-black">
                {i + 1}
              </span>
              <p className="text-[15px] font-semibold text-white">{l(item.title)}</p>
              {item.body && <p className="mt-1 text-sm leading-relaxed text-zinc-400">{l(item.body)}</p>}
            </li>
          ))}
        </ol>
      );

    case 'list': {
      const tone = block.tone || 'dot';
      return (
        <div className="space-y-2.5">
          {block.title && (
            <p
              className={`text-xs font-semibold uppercase tracking-wide ${
                tone === 'check' ? 'text-green-400' : tone === 'cross' ? 'text-red-400/90' : 'text-zinc-400'
              }`}
            >
              {l(block.title)}
            </p>
          )}
          <ul className="space-y-2">
            {block.items.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-zinc-300">
                {tone === 'check' && <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />}
                {tone === 'cross' && <X className="mt-0.5 h-4 w-4 shrink-0 text-red-400/80" />}
                {tone === 'dot' && <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#FFB300]" />}
                <span>{l(item)}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    case 'callout': {
      const tone = CALLOUT_TONES[block.tone];
      const Icon = tone.icon;
      return (
        <div className={`relative overflow-hidden rounded-xl border pl-5 pr-4 py-4 ${tone.wrap}`}>
          <span className={`absolute left-0 top-0 h-full w-1 ${tone.bar}`} />
          <div className="flex gap-3">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.text}`} />
            <div className="space-y-1">
              {block.title && <p className={`text-sm font-semibold ${tone.text}`}>{l(block.title)}</p>}
              <p className="text-sm leading-relaxed text-zinc-300">{l(block.body)}</p>
            </div>
          </div>
        </div>
      );
    }

    case 'table':
      return (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-[#FFB300]/10">
                {block.cols.map((col, i) => (
                  <th
                    key={i}
                    className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide ${
                      i === 0 ? 'text-zinc-400' : 'text-[#FFB300]'
                    }`}
                  >
                    {l(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-t border-zinc-800/80 align-top">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-4 py-3 ${j === 0 ? 'font-medium text-white' : 'text-zinc-400'}`}
                    >
                      {l(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'faq':
      return (
        <Accordion type="single" collapsible className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          {block.items.map((item, i) => (
            <AccordionItem key={i} value={`q${i}`} className="border-b-0 px-4">
              <AccordionTrigger className="text-left text-sm font-medium text-white hover:no-underline">
                {l(item.q)}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-zinc-400">{l(item.a)}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      );

    case 'video':
      return (
        <figure className="space-y-2">
          <div className="aspect-video overflow-hidden rounded-xl border border-zinc-800 bg-black">
            <GuideVideo url={block.url} title={l(block.title)} />
          </div>
          <figcaption className="text-xs text-zinc-500">{l(block.title)}</figcaption>
        </figure>
      );

    case 'links':
      return (
        <div className="flex flex-wrap gap-2.5 pt-1">
          {block.items.map((item, i) => (
            <GuideLink key={i} label={l(item.label)} to={item.to} href={item.href} />
          ))}
        </div>
      );

    default:
      return null;
  }
};

export default GuideBlockView;
