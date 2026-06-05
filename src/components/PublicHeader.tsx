import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowRight } from 'lucide-react';

// Shared public top navigation. Used by the public Storefront (`/`), the
// relocated marketing page (`/about` → Landing) and the public course detail
// (`/courses/:slug`). The right-hand actions switch on auth state: logged-out
// visitors see Login + Get Started, logged-in users see an "open app" button.
//
// `ฟีเจอร์`/`ราคา` are anchors into the marketing page sections (which now live
// at `/about`), so they point at `/about#features` / `/about#pricing`. The other
// items target standalone routes that already exist.
const PublicHeader = () => {
  const navigate = useNavigate();
  const { language, setLanguage, t } = useLanguage();
  const { user } = useAuth();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => navigate('/')}
        >
          <div
            className="h-10 w-10 rounded-[12px] flex items-center justify-center shadow-lg"
            style={{ background: 'radial-gradient(circle farthest-corner at 35% 90%, #fec564, transparent 50%), radial-gradient(circle farthest-corner at 0 140%, #fec564, transparent 50%), radial-gradient(ellipse farthest-corner at 0 -25%, #5258cf, transparent 50%), radial-gradient(ellipse farthest-corner at 20% -50%, #5258cf, transparent 50%), radial-gradient(ellipse farthest-corner at 100% 0, #893dc2, transparent 50%), radial-gradient(ellipse farthest-corner at 60% -20%, #893dc2, transparent 50%), radial-gradient(ellipse farthest-corner at 100% 100%, #d9317a, transparent), linear-gradient(#6559ca, #bc318f 30%, #e33f5f 50%, #f77638 70%, #fec66d 100%)' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 2L4.5 13.5H11.5L11 22L19.5 10.5H12.5L13 2Z" fill="#FFD700" stroke="#FFD700" strokeWidth="0.5" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="text-xl font-bold">Triple School</span>
        </div>

        <div className="hidden md:flex items-center gap-8">
          <a href="/about#features" className="text-muted-foreground hover:text-foreground transition-colors">
            {t('landing.features')}
          </a>
          <a href="/tutorials" className="text-muted-foreground hover:text-foreground transition-colors">
            {language === 'th' ? 'เรียน' : 'Learn'}
          </a>
          <a href="/affiliate-info" className="text-muted-foreground hover:text-foreground transition-colors">
            {language === 'th' ? 'ตัวแทนจำหน่าย' : 'Reseller'}
          </a>
          <a href="/about#pricing" className="text-muted-foreground hover:text-foreground transition-colors">
            {t('landing.pricing')}
          </a>
          <a href="/update" className="text-muted-foreground hover:text-foreground transition-colors">
            {language === 'th' ? 'อัปเดต' : 'Updates'}
          </a>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
            className="px-2 py-1 text-sm rounded-md border border-border hover:bg-muted transition-colors"
          >
            {language === 'th' ? '🇹🇭 TH' : '🇺🇸 EN'}
          </button>

          {user ? (
            <Button onClick={() => navigate('/app')} className="gap-2">
              {language === 'th' ? 'เข้าใช้งาน' : 'Open App'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => navigate('/login')}>
                {t('landing.login')}
              </Button>
              <Button onClick={() => navigate('/register')} className="gap-2">
                {t('landing.getStarted')}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default PublicHeader;
