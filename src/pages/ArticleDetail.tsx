import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type ArticleDto } from '@/lib/api';
import PublicHeader from '@/components/PublicHeader';
import { sanitizeMaterialHtml } from '@/lib/sanitizeMaterialHtml';
import { MaterialHtmlFrame } from '@/components/MaterialHtmlFrame';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, CalendarDays } from 'lucide-react';

// Reading page (/content/:slug). The body arrives either inline (content_html)
// or as an HTML file on S3 (content_url) — both render through the same
// sanitize + iframe pipeline the lesson documents use.
const ArticleDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<ArticleDto | null>(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setBody('');
    (async () => {
      try {
        const a = await api.getArticle(slug);
        if (cancelled) return;
        setArticle(a);
        if (a.content_html?.trim()) {
          setBody(a.content_html);
        } else if (a.content_url) {
          const res = await fetch(api.mediaUrl(a.content_url));
          if (!cancelled && res.ok) setBody(await res.text());
        }
      } catch (e) {
        console.error('Failed to load article:', e);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (notFound || !article) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader />
        <div className="flex flex-col items-center justify-center gap-4 px-4 py-24 text-center">
          <p className="text-lg font-semibold">ไม่พบบทความนี้</p>
          <Button asChild variant="outline">
            <Link to="/content">
              <ArrowLeft className="h-4 w-4 mr-2" />
              กลับหน้าบทความ
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const clean = sanitizeMaterialHtml(body || '');
  const hasVisibleText = clean.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <PublicHeader />

      <article className="max-w-4xl mx-auto px-4 md:px-8 pt-6 pb-16">
        <Link to="/content" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" />
          บทความทั้งหมด
        </Link>

        <h1 className="text-2xl md:text-4xl font-bold mt-4 leading-snug">{article.title}</h1>
        <div className="flex items-center gap-2 mt-3 text-sm text-gray-400">
          <CalendarDays className="h-4 w-4" />
          {new Date(article.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
          {!article.is_active && (
            <span className="rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 text-yellow-300 text-xs">
              ฉบับร่าง — มองเห็นเฉพาะแอดมิน
            </span>
          )}
        </div>
        {article.excerpt && <p className="text-gray-300 mt-4 text-base leading-relaxed">{article.excerpt}</p>}

        {article.cover_url && (
          <img
            src={api.mediaUrl(article.cover_url, 'hero')}
            alt={article.title}
            className="w-full aspect-video object-cover rounded-xl mt-6"
          />
        )}

        <div className="mt-8">
          {hasVisibleText ? (
            <div className="rounded-xl overflow-hidden border border-gray-800">
              <MaterialHtmlFrame html={clean} maxHeight={20000} />
            </div>
          ) : (
            <p className="text-gray-400 text-center py-16">บทความนี้ยังไม่มีเนื้อหา</p>
          )}
        </div>
      </article>
    </div>
  );
};

export default ArticleDetail;
