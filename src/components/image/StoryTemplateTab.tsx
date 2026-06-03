import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, Play, Search, Sparkles, Star, Plus, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';

type FilterKey = 'all' | 'model' | 'favorite' | 'custom';
type ModelKey = 'gpt-image-2';
type ImageAspect = 'auto' | '1:1' | '9:16' | '16:9' | '4:3' | '3:4';
type ImageResolution = '1K' | '2K' | '4K';

interface StoryTemplate {
  slug: string;
  name: string;
  nameTh: string;
  description: string;
  descriptionTh: string;
  thumbnailUrl: string;
  model: ModelKey;
  aspect: ImageAspect;
  resolution: ImageResolution;
  createdAt: string;
  uses: number;
  prompt: string;
}

const MODEL_LABELS: Record<ModelKey, string> = {
  'gpt-image-2': 'GPT Image 2',
};

const FAVORITES_KEY = 'storyTemplateFavorites';
const TEMPLATE_DRAFT_KEY = 'storyTemplateDraft';

// Templates now come from DB via /api/story-template/list (admin-managed in /admin/story-templates)
export const STORY_TEMPLATES: StoryTemplate[] = [];

// Map DB row → StoryTemplate shape used by the tab UI
function mapDbRowToTemplate(row: any): StoryTemplate {
  return {
    slug: row.slug,
    name: row.name || '',
    nameTh: row.name || '', // Story templates don't have separate TH name in DB; reuse
    description: row.description || '',
    descriptionTh: row.description || '',
    thumbnailUrl: row.thumbnail_url || '/placeholder.svg',
    model: 'gpt-image-2',
    aspect: '9:16',
    resolution: '1K',
    createdAt: row.created_at || new Date().toISOString(),
    uses: 0,
    prompt: '', // detail page will fetch system_prompt separately via by-slug
  };
}

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function StoryTemplateCard({
  template,
  displayName,
  description,
  isFavorite,
  isNew,
  onUse,
  onToggleFavorite,
}: {
  template: StoryTemplate;
  displayName: string;
  description: string;
  isFavorite: boolean;
  isNew: boolean;
  onUse: (template: StoryTemplate) => void;
  onToggleFavorite: (slug: string) => void;
}) {
  return (
    <div
      className="group cursor-pointer rounded-[7px] border border-zinc-800 bg-zinc-900 hover:border-[#FFB300]/50 transition-all relative overflow-visible flex flex-col"
      onClick={() => onUse(template)}
    >
      <div className="relative">
        {isNew && (
          <img src="/new-badge.png" alt="NEW" className="absolute -top-4 -left-4 w-14 h-14 z-30 pointer-events-none" />
        )}
        <div className="aspect-[9/16] bg-zinc-950 relative flex items-center justify-center overflow-hidden rounded-t-[7px]">
          <img
            src={template.thumbnailUrl}
            alt={displayName}
            className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
          />
          <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="w-12 h-12 rounded-[7px] bg-[#FFB300]/95 flex items-center justify-center shadow-lg shadow-black/40">
              <Play className="h-6 w-6 text-black ml-0.5" />
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-zinc-200 truncate">{displayName}</h3>
            <p className="text-[11px] text-zinc-500 line-clamp-2 mt-0.5">{description}</p>
          </div>
          <button
            type="button"
            className="p-1 rounded-full hover:bg-zinc-800 transition-colors shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(template.slug);
            }}
            aria-label="Favorite"
          >
            <Star className={`h-4 w-4 ${isFavorite ? 'text-yellow-500 fill-yellow-500' : 'text-zinc-500'}`} />
          </button>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FFB300]/10 text-[#FFB300] border border-[#FFB300]/20">
            {MODEL_LABELS[template.model]}
          </span>
          <span className="text-[10px] text-muted-foreground">{template.aspect}</span>
        </div>
      </div>
    </div>
  );
}

export function StoryTemplateTab() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const l = (th: string, en: string) => (language === 'th' ? th : en);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'latest' | 'popular'>('latest');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedModel, setSelectedModel] = useState<ModelKey>('gpt-image-2');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const favoritesCount = favorites.length;
  const [templates, setTemplates] = useState<StoryTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingTemplates(true);
    api
      .getStoryTemplatesPublic()
      .then((rows: any) => {
        if (cancelled) return;
        setTemplates(Array.isArray(rows) ? rows.map(mapDbRowToTemplate) : []);
      })
      .catch((err) => {
        console.error('Failed to load story templates:', err);
        if (!cancelled) setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const toggleFavorite = (slug: string) => {
    setFavorites((prev) => {
      const next = prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const useTemplate = (template: StoryTemplate) => {
    sessionStorage.setItem(TEMPLATE_DRAFT_KEY, JSON.stringify({
      templateSlug: template.slug,
      templateName: language === 'th' ? template.nameTh : template.name,
      prompt: template.prompt,
      aspect: template.aspect,
      resolution: template.resolution,
    }));
    navigate(`/app/stories-template/${encodeURIComponent(template.slug)}`);
  };

  const visibleTemplates = templates
    .filter((template) => {
      if (filter === 'model') return template.model === selectedModel;
      if (filter === 'favorite') return favorites.includes(template.slug);
      if (filter === 'custom') return false;
      return true;
    })
    .filter((template) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return [
        template.name,
        template.nameTh,
        template.description,
        template.descriptionTh,
        MODEL_LABELS[template.model],
      ].some((value) => value.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (sortBy === 'popular') return b.uses - a.uses;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#FFB300]" />
          Story Template
        </h2>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={l('ค้นหา Template...', 'Search Template...')}
          className="pl-9"
        />
      </div>

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

        <button
          onClick={() => setFilter('all')}
          className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors min-h-[36px] ${
            filter === 'all' ? 'bg-[#FFB300] text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          {l('ทั้งหมด', 'All')}
        </button>

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

        <button
          onClick={() => setFilter('favorite')}
          className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors min-h-[36px] ${
            filter === 'favorite' ? 'bg-[#FFB300] text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          {l('ชื่นชอบ', 'Favorite')}
          {favoritesCount > 0 && <span className="ml-1.5 text-xs opacity-70">({favoritesCount})</span>}
        </button>

        <button
          onClick={() => setFilter('custom')}
          className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors min-h-[36px] ${
            filter === 'custom' ? 'bg-[#FFB300] text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          {l('กำหนดเอง', 'Custom')}
        </button>

        {filter === 'custom' && (
          <Button
            onClick={() => navigate('/app/images/custom-prompt/new')}
            size="sm"
            className="w-full sm:w-auto sm:ml-auto bg-[#FFB300] hover:bg-[#FF9500] text-black font-semibold mt-2 sm:mt-0"
          >
            <Plus className="h-4 w-4 mr-1" />
            {l('Custom Prompt', 'Custom Prompt')}
          </Button>
        )}
      </div>

      {filter === 'custom' ? (
        <div className="text-center py-20 text-muted-foreground">
          <Sparkles className="h-10 w-10 mx-auto mb-4 text-zinc-700" />
          <p className="text-sm mb-4">{l('ยังไม่มี Custom Prompt', 'No custom prompt yet')}</p>
          <Button
            onClick={() => navigate('/app/images/custom-prompt/new')}
            size="sm"
            className="bg-[#FFB300] hover:bg-[#FF9500] text-black font-semibold"
          >
            <Plus className="h-4 w-4 mr-1" />
            {l('Custom Prompt', 'Custom Prompt')}
          </Button>
        </div>
      ) : loadingTemplates ? (
        <div className="flex items-center justify-center py-16 text-zinc-600">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : visibleTemplates.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {visibleTemplates.map((template, idx) => (
            <StoryTemplateCard
              key={template.slug}
              template={template}
              displayName={language === 'th' ? template.nameTh : template.name}
              description={language === 'th' ? template.descriptionTh : template.description}
              isFavorite={favorites.includes(template.slug)}
              isNew={sortBy === 'latest' && filter === 'all' && idx < 2}
              onUse={useTemplate}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
          <Sparkles className="h-10 w-10 mb-4 text-zinc-700" />
          <p className="text-sm font-medium mb-2">
            {filter === 'favorite'
              ? l('ยังไม่มีรายการชื่นชอบ', 'No favorite templates yet')
              : l('ยังไม่มี Story Template', 'No story templates yet')}
          </p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="inline-flex items-center gap-1 text-xs text-[#FFB300] hover:text-[#FFC233]"
          >
            {l('ดู Template ทั้งหมด', 'View all templates')}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

export default StoryTemplateTab;
