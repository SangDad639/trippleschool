import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';

type FilterKey = 'all' | 'model' | 'favorite';
type ModelKey = 'gpt-image-2';

interface ImageModel {
  slug: string;
  name: string;
  description: { th: string; en: string };
  badge?: string;
  videoSrc: string;
  modelKey: ModelKey; // for the Model dropdown filter
  navigateTo: string;
}

const MODELS: ImageModel[] = [
  {
    slug: 'gpt-image-2',
    name: 'GPT Image 2',
    description: {
      th: 'ภาพ 4K พร้อมการเรนเดอร์ตัวอักษรเกือบสมบูรณ์แบบ',
      en: '4K images with near-perfect text rendering',
    },
    badge: 'NEW',
    videoSrc: '/gpt-image-2-demo.mp4',
    modelKey: 'gpt-image-2',
    navigateTo: '/app/images/gpt-image-2',
  },
];

const ImageGallery = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const l = (th: string, en: string) => (language === 'th' ? th : en);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'latest' | 'popular'>('latest');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedModel, setSelectedModel] = useState<ModelKey>('gpt-image-2');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  // Close model menu on outside click
  useEffect(() => {
    if (!showModelMenu) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModelMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModelMenu]);

  const MODEL_LABELS: Record<ModelKey, string> = {
    'gpt-image-2': 'GPT Image 2',
  };

  // Apply filter + search
  let filtered = [...MODELS];
  if (filter === 'model') {
    filtered = filtered.filter((m) => m.modelKey === selectedModel);
  } else if (filter === 'favorite') {
    filtered = []; // No favorites yet
  }
  const q = searchQuery.toLowerCase().trim();
  if (q) {
    filtered = filtered.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.description[language as 'th' | 'en'].toLowerCase().includes(q)
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">{l('รูปภาพ', 'Images')}</h2>
        <p className="text-sm text-muted-foreground">
          {l('คลังรูปภาพของคุณ', 'Your image library')}
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={l('ค้นหา model...', 'Search models...')}
          className="pl-9"
        />
      </div>

      {/* Sort + Filter Tabs (matches Prompt Library style) — Custom Prompt button on the right of same row */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'latest' | 'popular')}
          className="px-3 py-1.5 sm:py-1 rounded-full text-xs font-medium border border-[#FFB300] bg-black text-[#FFB300] cursor-pointer appearance-none pr-6 min-h-[32px]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23FFB300' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
          }}
        >
          <option value="latest" className="bg-zinc-900 text-[#FFB300]">{l('ล่าสุด', 'Latest')}</option>
          <option value="popular" className="bg-zinc-900 text-[#FFB300]">{l('ยอดนิยม', 'Popular')}</option>
        </select>

        {/* All filter */}
        <button
          onClick={() => setFilter('all')}
          className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors min-h-[36px] ${
            filter === 'all' ? 'bg-[#FFB300] text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          {l('ทั้งหมด', 'All')}
        </button>

        {/* Model dropdown — clicking opens menu only; filter applies after picking an item */}
        <div className="relative" ref={modelMenuRef}>
          <button
            onClick={() => setShowModelMenu((v) => !v)}
            className={`inline-flex items-center gap-1 px-3 sm:px-4 py-2 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors min-h-[36px] ${
              filter === 'model' ? 'bg-[#FFB300] text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {filter === 'model' ? MODEL_LABELS[selectedModel] : 'Model'}
            <ChevronDown className={`h-3 w-3 transition-transform ${showModelMenu ? 'rotate-180' : ''}`} />
          </button>
          {showModelMenu && (
            <div className="absolute top-full left-0 mt-1.5 min-w-[160px] rounded-xl bg-background border border-border shadow-xl py-1 z-30">
              {(Object.entries(MODEL_LABELS) as [ModelKey, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    setSelectedModel(key);
                    setFilter('model');
                    setShowModelMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    filter === 'model' && selectedModel === key
                      ? 'text-[#FFB300] font-medium bg-[#FFB300]/10'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Favorite filter */}
        <button
          onClick={() => setFilter('favorite')}
          className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors min-h-[36px] ${
            filter === 'favorite' ? 'bg-[#FFB300] text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          {l('ชื่นชอบ', 'Favorite')}
        </button>
      </div>

      {/* Cards grid — original style preserved */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {filtered.map((m) => (
          <button
            key={m.slug}
            type="button"
            onClick={() => navigate(m.navigateTo)}
            className="group relative overflow-hidden rounded-2xl border border-border bg-card text-left transition-all hover:border-[#FFB300]/50 hover:shadow-xl hover:shadow-[#FFB300]/10 hover:-translate-y-0.5"
          >
            {m.badge && (
              <span className="absolute right-3 top-3 z-10 inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-[#FFB300] text-black shadow">
                {m.badge}
              </span>
            )}

            <div className="relative aspect-[3/4] overflow-hidden bg-black">
              <video
                src={m.videoSrc}
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
            </div>

            <div className="p-3">
              <div className="text-sm font-bold text-foreground truncate">{m.name}</div>
              <div className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {l(m.description.th, m.description.en)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ImageGallery;
