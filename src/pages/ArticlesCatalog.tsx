import { useEffect, useState } from 'react';
import { api, type ArticleDto } from '@/lib/api';
import PublicHeader from '@/components/PublicHeader';
import ArticleCard from '@/components/articles/ArticleCard';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Newspaper } from 'lucide-react';

// Article catalog (/content): free-to-read articles, same grid rhythm as the
// Tip and Course catalogs so the whole site reads as one system.
const ArticlesCatalog = () => {
  const [articles, setArticles] = useState<ArticleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    api
      .getArticles()
      .then(setArticles)
      .catch((e) => console.error('Failed to load articles:', e))
      .finally(() => setLoading(false));
  }, []);

  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? articles.filter(
        (a) => a.title.toLowerCase().includes(query) || a.excerpt?.toLowerCase().includes(query)
      )
    : articles;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <PublicHeader />

      <div className="px-4 md:px-12 pt-8 pb-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Newspaper className="h-7 w-7 text-primary" />
            บทความ
          </h1>
          <p className="text-gray-400 text-sm mt-1">ความรู้ เทคนิค และอัปเดตวงการ AI</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาบทความ..."
            className="pl-10 bg-gray-800/50 border-gray-700 text-white h-11 md:h-9"
          />
        </div>
      </div>

      <div className="px-4 md:px-12 pb-16">
        {loading ? (
          <div className="flex items-center justify-center min-h-[40vh]">
            <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-center text-gray-400 py-20">
            {query ? 'ไม่พบบทความที่ค้นหา' : 'ยังไม่มีบทความในตอนนี้ — กลับมาดูใหม่เร็วๆ นี้ 📰'}
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {visible.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ArticlesCatalog;
