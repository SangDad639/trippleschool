import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PublicHeader from '@/components/PublicHeader';
import GuideBlockView from './GuideBlocks';
import {
  GUIDE_DOCS,
  GUIDE_QUICK_START,
  getGuide,
  guideHeadings,
  guideNeighbors,
  guidesInCategory,
  searchGuides,
  usedCategories,
} from './guideData';
import {
  ACCESS_LABELS,
  GUIDE_CATEGORIES,
  type GuideAccess,
  type GuideCategoryId,
  type GuideDoc,
} from './guideTypes';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Search, X, Clock, ArrowLeft, ArrowRight, ChevronRight, LifeBuoy, BookOpen } from 'lucide-react';

/**
 * ⚠️ ยังไม่ได้ใช้งาน — เจ้าของสั่งให้ /guide เป็นหน้าเปล่าไว้ก่อน (24 ส.ค. 2569)
 * โค้ดหน้าคู่มือฉบับเต็มเก็บไว้ที่ไฟล์นี้ ไม่ได้ถูก import จากที่ไหน จึงไม่ถูกรวมใน bundle
 * จะเปิดใช้อีกครั้ง: ให้ src/pages/Guide.tsx re-export ไฟล์นี้ แล้วเปิด route /guide/:slug ใน App.tsx
 *
 * ศูนย์ช่วยเหลือ /guide — หน้าคู่มือรวมของ Triple School
 *
 * ตั้งใจให้เป็นหน้า "ซ่อน": ไม่มีในแถบเมนู (NAV_ITEMS ของ PublicHeader)
 * เข้าถึงได้ทุกคนผ่านลิงก์ตรง — ไม่เช็ค login, ไม่เช็คสมาชิก, ไม่ยิง API
 * เนื้อหาอยู่ใน src/components/guide/docs/*.ts
 */

type Lang = 'th' | 'en';

const ACCESS_STYLES: Record<GuideAccess, string> = {
  everyone: 'bg-green-500/12 text-green-400 border-green-500/25',
  login: 'bg-sky-500/12 text-sky-300 border-sky-500/25',
  member: 'bg-[#FFB300]/12 text-[#FFB300] border-[#FFB300]/25',
};

const AccessChip = ({ access, lang }: { access: GuideAccess; lang: Lang }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ACCESS_STYLES[access]}`}>
    {ACCESS_LABELS[access][lang]}
  </span>
);

const GuideCard = ({ doc, lang, number }: { doc: GuideDoc; lang: Lang; number: number }) => {
  const Icon = doc.icon;
  return (
    <Link
      to={`/guide/${doc.slug}`}
      className="group relative flex gap-4 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 transition-colors hover:border-[#FFB300]/50 hover:bg-zinc-900/70"
    >
      <span className="pointer-events-none absolute -right-1 top-1 select-none font-mono text-4xl font-bold text-white/[0.04] transition-colors group-hover:text-[#FFB300]/10">
        {String(number).padStart(2, '0')}
      </span>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFB300]/12 text-[#FFB300] transition-transform group-hover:scale-105">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-white">{doc.title[lang]}</span>
        <span className="mt-1 block text-sm leading-relaxed text-zinc-400">{doc.summary[lang]}</span>
        <span className="mt-3 flex flex-wrap items-center gap-2">
          <AccessChip access={doc.access} lang={lang} />
          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
            <Clock className="h-3 w-3" />
            {doc.minutes} {lang === 'th' ? 'นาที' : 'min'}
          </span>
          <ArrowRight className="ml-auto h-4 w-4 text-zinc-600 transition-all group-hover:translate-x-0.5 group-hover:text-[#FFB300]" />
        </span>
      </span>
    </Link>
  );
};

/** แถบ "ยังไม่เจอคำตอบ" — ปิดท้ายทั้งหน้ารวมและหน้าบทความ */
const HelpFooterStrip = ({ lang }: { lang: Lang }) => (
  <div className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-[#FFB300]/[0.04] px-6 py-6 text-center sm:flex-row sm:text-left">
    <LifeBuoy className="h-6 w-6 shrink-0 text-[#FFB300]" />
    <p className="flex-1 text-sm text-zinc-300">
      {lang === 'th'
        ? 'ยังไม่เจอคำตอบ ทักทีมงานได้จากปุ่มแชทมุมขวาล่างในหน้าคอร์ส ใช้ได้ทุกคนแม้ยังไม่ได้จ่ายเงิน'
        : 'Still stuck? Use the chat bubble on any course page — it is open to everyone, paid or not.'}
    </p>
    <Link
      to="/guide/contact-support"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#FFB300] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
    >
      {lang === 'th' ? 'วิธีติดต่อทีมงาน' : 'How to reach us'}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  </div>
);

// ─────────────────────────── หน้ารวม /guide ───────────────────────────
const GuideCenter = () => {
  const { language } = useLanguage();
  const lang = language as Lang;
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<GuideCategoryId | 'all'>('all');

  const searching = query.trim().length > 0;
  const results = useMemo(() => (searching ? searchGuides(query) : []), [query, searching]);
  const categories = useMemo(() => usedCategories(), []);
  const quickStart = GUIDE_QUICK_START.map(getGuide).filter((doc): doc is GuideDoc => !!doc);

  const visibleCategories =
    activeCategory === 'all' ? categories : categories.filter((cat) => cat.id === activeCategory);

  return (
    <>
      <PublicHeader />
      <div className="page-wrapper">
        <div className="mx-auto max-w-5xl px-4 pb-20 pt-10 md:px-6">
          {/* ── หัวหน้า: บอกชัดว่าอ่านฟรีทุกคน ── */}
          <header className="border-b border-zinc-800 pb-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#FFB300]">
              Triple School · {lang === 'th' ? 'ศูนย์ช่วยเหลือ' : 'Help center'}
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-white md:text-5xl">
              {lang === 'th' ? 'คู่มือ' : 'The'}{' '}
              <span className="bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FF9800] bg-clip-text text-transparent">
                {lang === 'th' ? 'การใช้งาน' : 'user manual'}
              </span>
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-zinc-400">
              {lang === 'th'
                ? 'ทุกอย่างที่ต้องรู้ ตั้งแต่สมัครบัญชี ชำระเงิน เข้าเรียน จนถึงแก้ปัญหาที่เจอบ่อย — เปิดอ่านฟรีทุกคน ไม่ต้องเข้าสู่ระบบ และไม่ต้องเป็นสมาชิก'
                : 'Everything from creating an account to payment, learning, and fixing common issues — free for everyone, no sign-in and no membership required.'}
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={lang === 'th' ? 'ค้นหา เช่น สลิป, ต่ออายุ, วิดีโอไม่เล่น' : 'Search: slip, renew, video not playing'}
                  className="h-11 border-zinc-700 bg-zinc-900/70 pl-9 pr-9 text-sm text-white"
                />
                {searching && (
                  <button
                    onClick={() => setQuery('')}
                    aria-label={lang === 'th' ? 'ล้างคำค้นหา' : 'Clear search'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="shrink-0 text-xs text-zinc-500">
                {GUIDE_DOCS.length} {lang === 'th' ? 'คู่มือ' : 'articles'}
              </p>
            </div>
          </header>

          {searching ? (
            /* ── ผลการค้นหา ── */
            <section className="pt-8">
              <p className="mb-4 text-sm text-zinc-400">
                {lang === 'th'
                  ? `พบ ${results.length} คู่มือสำหรับ "${query.trim()}"`
                  : `${results.length} result(s) for "${query.trim()}"`}
              </p>
              {results.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-700 px-6 py-12 text-center">
                  <p className="text-sm text-zinc-400">
                    {lang === 'th'
                      ? 'ไม่พบคู่มือที่ตรงกับคำค้นนี้ ลองคำสั้นลง หรือทักทีมงานได้เลย'
                      : 'No article matched. Try a shorter keyword, or message the team.'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {results.map((doc, i) => (
                    <GuideCard key={doc.slug} doc={doc} lang={lang} number={i + 1} />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <>
              {/* ── เริ่มที่นี่: 3 ก้าวแรกแบบเรียงลำดับ ── */}
              {quickStart.length > 0 && (
                <section className="pt-8">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    {lang === 'th' ? 'เพิ่งเข้ามาครั้งแรก เริ่มที่นี่' : 'New here? Start here'}
                  </h2>
                  <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-stretch">
                    {quickStart.map((doc, i) => (
                      <div key={doc.slug} className="flex flex-1 items-center gap-2">
                        <Link
                          to={`/guide/${doc.slug}`}
                          className="group flex flex-1 items-center gap-3 rounded-xl border border-[#FFB300]/20 bg-gradient-to-br from-[#FFB300]/[0.09] to-transparent px-4 py-3 transition-colors hover:border-[#FFB300]/50"
                        >
                          <span className="font-mono text-lg font-bold text-[#FFB300]/70">{i + 1}</span>
                          <span className="text-sm font-medium leading-snug text-white">{doc.title[lang]}</span>
                        </Link>
                        {i < quickStart.length - 1 && (
                          <ChevronRight className="hidden h-4 w-4 shrink-0 text-zinc-600 md:block" />
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── ตัวกรองหมวด ── */}
              <nav className="scrollbar-hide -mx-4 mt-10 flex gap-2 overflow-x-auto px-4 pb-1">
                <button
                  onClick={() => setActiveCategory('all')}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    activeCategory === 'all'
                      ? 'border-[#FFB300] bg-[#FFB300] text-black'
                      : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
                  }`}
                >
                  {lang === 'th' ? 'ทั้งหมด' : 'All'}
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      activeCategory === cat.id
                        ? 'border-[#FFB300] bg-[#FFB300] text-black'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
                    }`}
                  >
                    {cat.label[lang]}
                  </button>
                ))}
              </nav>

              {/* ── คู่มือแยกตามหมวด ── */}
              {visibleCategories.map((cat) => {
                const docs = guidesInCategory(cat.id);
                const CatIcon = cat.icon;
                return (
                  <section key={cat.id} className="pt-10">
                    <div className="mb-4 flex items-center gap-3">
                      <CatIcon className="h-4 w-4 shrink-0 text-[#FFB300]" />
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-white">{cat.label[lang]}</h2>
                        <p className="text-xs text-zinc-500">{cat.blurb[lang]}</p>
                      </div>
                      <span className="ml-auto shrink-0 text-xs text-zinc-600">
                        {docs.length} {lang === 'th' ? 'เรื่อง' : 'articles'}
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {docs.map((doc, i) => (
                        <GuideCard key={doc.slug} doc={doc} lang={lang} number={i + 1} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </>
          )}

          <HelpFooterStrip lang={lang} />
        </div>
      </div>
    </>
  );
};

// ───────────────────── หน้าบทความ /guide/:slug ─────────────────────
export const GuideArticle = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const lang = language as Lang;

  const doc = getGuide(slug);
  const headings = useMemo(() => (doc ? guideHeadings(doc) : []), [doc]);
  const { prev, next } = guideNeighbors(slug || '');
  const [activeHeading, setActiveHeading] = useState<string | null>(null);

  // เปลี่ยนบทความ = เริ่มอ่านจากด้านบนเสมอ
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [slug]);

  // ไฮไลต์หัวข้อที่กำลังอ่านในสารบัญด้านขวา
  // ใช้ตำแหน่งจริงของหัวข้อ (ไม่ใช่ IntersectionObserver) เพราะการกดลิงก์สารบัญ
  // หรือเลื่อนเร็วๆ จะกระโดดข้ามช่วงตรวจจับ ทำให้ไม่มีหัวข้อไหนถูกไฮไลต์เลย
  useEffect(() => {
    if (headings.length === 0) return;
    const OFFSET = 140; // ความสูงของ header + แถบนำทางย่อย เผื่อระยะอ่าน
    let frame = 0;

    const update = () => {
      frame = 0;
      let current = headings[0].id;
      for (const heading of headings) {
        const el = document.getElementById(heading.id);
        if (el && el.getBoundingClientRect().top <= OFFSET) current = heading.id;
      }
      setActiveHeading(current);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [headings, slug]);

  if (!doc) {
    return (
      <>
        <PublicHeader />
        <div className="page-wrapper flex items-center justify-center px-4">
          <div className="space-y-4 py-24 text-center">
            <p className="text-zinc-400">{lang === 'th' ? 'ไม่พบคู่มือนี้' : 'Guide not found'}</p>
            <Link
              to="/guide"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#FFB300] px-4 py-2 text-sm font-semibold text-black"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {lang === 'th' ? 'กลับหน้าคู่มือ' : 'Back to the manual'}
            </Link>
          </div>
        </div>
      </>
    );
  }

  const category = GUIDE_CATEGORIES.find((cat) => cat.id === doc.category);
  const DocIcon = doc.icon;

  return (
    <>
      <PublicHeader />
      <div className="page-wrapper">
        {/* หมายเหตุ: ห่อ div ชั้นนี้ไว้เพราะ `.page-wrapper > *` ใน index.css
            บังคับ position: relative ให้ลูกชั้นแรก ซึ่งจะทับ sticky ของแถบด้านล่าง */}
        <div>
        {/* แถบนำทางย่อย — ติดใต้ header หลัก (h-14) */}
        <div className="sticky top-14 z-40 border-b border-zinc-800 bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5 md:px-6">
            <button
              onClick={() => navigate('/guide')}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {lang === 'th' ? 'คู่มือทั้งหมด' : 'All guides'}
            </button>
            <span className="text-zinc-700">/</span>
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{doc.title[lang]}</span>
            <span className="hidden shrink-0 items-center gap-1 text-[11px] text-zinc-500 sm:inline-flex">
              <Clock className="h-3 w-3" />
              {doc.minutes} {lang === 'th' ? 'นาที' : 'min'}
            </span>
          </div>
        </div>

        <div className="mx-auto max-w-5xl gap-10 px-4 pb-20 pt-8 md:px-6 xl:flex">
          <article className={`min-w-0 flex-1 ${headings.length > 0 ? 'xl:max-w-2xl' : ''}`}>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <DocIcon className="h-3.5 w-3.5 text-[#FFB300]" />
              {category && <span>{category.label[lang]}</span>}
            </div>
            <h1 className="mt-3 text-2xl font-bold leading-snug text-white md:text-3xl">{doc.title[lang]}</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">{doc.summary[lang]}</p>
            <div className="mt-4 flex items-center gap-2 border-b border-zinc-800 pb-6">
              <AccessChip access={doc.access} lang={lang} />
              <span className="text-[11px] text-zinc-500">
                {lang === 'th' ? 'คู่มือนี้อ่านได้ฟรีทุกคน' : 'Free to read for everyone'}
              </span>
            </div>

            <div className="space-y-5 pt-7">
              {doc.blocks.map((block, i) => (
                <GuideBlockView key={i} block={block} index={i} />
              ))}
            </div>

            {/* คู่มือก่อนหน้า / ถัดไป */}
            <nav className="mt-12 grid gap-3 border-t border-zinc-800 pt-6 sm:grid-cols-2">
              {prev ? (
                <Link
                  to={`/guide/${prev.slug}`}
                  className="group rounded-xl border border-zinc-800 p-4 transition-colors hover:border-[#FFB300]/40"
                >
                  <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <ArrowLeft className="h-3 w-3" />
                    {lang === 'th' ? 'ก่อนหน้า' : 'Previous'}
                  </span>
                  <span className="mt-1 block text-sm font-medium text-white group-hover:text-[#FFB300]">
                    {prev.title[lang]}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  to={`/guide/${next.slug}`}
                  className="group rounded-xl border border-zinc-800 p-4 text-right transition-colors hover:border-[#FFB300]/40 sm:col-start-2"
                >
                  <span className="flex items-center justify-end gap-1.5 text-[11px] text-zinc-500">
                    {lang === 'th' ? 'ถัดไป' : 'Next'}
                    <ArrowRight className="h-3 w-3" />
                  </span>
                  <span className="mt-1 block text-sm font-medium text-white group-hover:text-[#FFB300]">
                    {next.title[lang]}
                  </span>
                </Link>
              )}
            </nav>

            <HelpFooterStrip lang={lang} />
          </article>

          {/* สารบัญ — โชว์เฉพาะจอกว้าง และเฉพาะบทความที่มีหัวข้อย่อย */}
          {headings.length > 0 && (
            <aside className="hidden w-56 shrink-0 xl:block">
              <div className="sticky top-32">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  <BookOpen className="h-3 w-3" />
                  {lang === 'th' ? 'ในหน้านี้' : 'On this page'}
                </p>
                <ul className="mt-3 space-y-1 border-l border-zinc-800">
                  {headings.map((heading) => (
                    <li key={heading.id}>
                      <a
                        href={`#${heading.id}`}
                        className={`-ml-px block border-l py-1.5 pl-3 text-xs transition-colors ${
                          activeHeading === heading.id
                            ? 'border-[#FFB300] font-medium text-[#FFB300]'
                            : 'border-transparent text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {heading.text[lang]}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          )}
        </div>
        </div>
      </div>
    </>
  );
};

export default GuideCenter;
