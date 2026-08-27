import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { GraduationCap, User as UserIcon, Shield, LogOut, ChevronDown, Menu, Crown, Search, X } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/tips', label: 'Tip' },
  { to: '/courses', label: 'Course' },
  { to: '/content', label: 'Content' },
  { to: '/programs', label: 'Program' },
  { to: '/pricing', label: 'Pricing' },
];

/** Whole days left on the subscription; null = none/expired. */
function subscriptionDaysLeft(expiresAt?: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

interface PublicHeaderProps {
  overlay?: boolean;
  /** Netflix-style expanding search box. Provide to show the 🔍 icon; state lives in the page. */
  search?: { query: string; onChange: (q: string) => void };
}

// Shared top navigation for the public (no-login) surface: storefront,
// course catalog, and public course detail.
// `overlay` = Netflix-style: fixed over the hero, transparent at top and
// solid once scrolled. Without it the header keeps the original sticky look.
const PublicHeader = ({ overlay = false, search }: PublicHeaderProps = {}) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(!!search?.query);

  useEffect(() => {
    if (!overlay) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overlay]);

  // Deep link (?q=...) arrives after the loading-state header already mounted
  // without the search prop — pop the box open once the query shows up.
  useEffect(() => {
    if (search?.query) setSearchOpen(true);
  }, [search?.query]);

  const searching = !!search && (searchOpen || search.query.length > 0);

  const closeSearch = () => {
    search?.onChange('');
    setSearchOpen(false);
  };

  // While the search box is in use the billboard behind may be replaced by
  // results — keep the bar solid so text stays readable.
  const headerClass = overlay
    ? `fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
        scrolled || searching
          ? 'bg-background/95 border-b border-border/60 backdrop-blur'
          : 'bg-gradient-to-b from-black/70 to-transparent border-b border-transparent'
      }`
    : 'sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60';

  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

  const daysLeft = subscriptionDaysLeft(user?.subscriptionExpiresAt);

  const searchBox = (className: string) => (
    <div className={`relative ${className}`}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
      <Input
        autoFocus
        value={search?.query ?? ''}
        onChange={(e) => search?.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') closeSearch();
        }}
        onBlur={() => {
          if (!search?.query) setSearchOpen(false);
        }}
        placeholder="ค้นหาคอร์ส, Tip..."
        className="pl-8 pr-8 h-9 bg-gray-800/70 border-gray-700 text-white text-sm w-full"
      />
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={closeSearch}
        aria-label="ปิดการค้นหา"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <header className={headerClass}>
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link to="/" className="flex items-center gap-2 font-bold text-white shrink-0">
            <GraduationCap className="h-6 w-6 text-purple-400" />
            <span className="bg-gradient-to-r from-purple-400 to-fuchsia-400 bg-clip-text text-transparent">Triple School</span>
          </Link>

          {/* Desktop nav — Netflix-style: active item white + bold */}
          <nav className="hidden md:flex items-center gap-5 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`transition-colors ${
                  isActive(item.to) ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Mobile nav — the 5 items collapse into a dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="md:hidden text-gray-300 hover:text-white px-2" aria-label="เมนู">
                <Menu className="h-5 w-5" />
                <span className="hidden sm:inline ml-1">เมนู</span>
                <ChevronDown className="hidden sm:inline h-3.5 w-3.5 ml-0.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {NAV_ITEMS.map((item) => (
                <DropdownMenuItem
                  key={item.to}
                  onClick={() => navigate(item.to)}
                  className={isActive(item.to) ? 'font-semibold text-white' : ''}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
              {!user && (
                <>
                  <DropdownMenuSeparator className="sm:hidden" />
                  <DropdownMenuItem className="sm:hidden" onClick={() => navigate('/login')}>
                    เข้าสู่ระบบ
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {search && !searchOpen && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSearchOpen(true)}
              aria-label="ค้นหา"
              className="text-gray-300 hover:text-white px-2"
            >
              <Search className="h-4 w-4" />
            </Button>
          )}
          {search && searchOpen && searchBox('hidden sm:block w-44 md:w-64 animate-in fade-in slide-in-from-right-2 duration-200')}
          <button
            onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded transition-colors"
            aria-label="Toggle language"
          >
            {language === 'th' ? 'EN' : 'TH'}
          </button>

          {user ? (
            <>
              {/* Subscription days-left chip (desktop; mobile sees it in the profile dropdown) */}
              {daysLeft !== null && (
                <button
                  onClick={() => navigate('/subscription')}
                  className={`hidden sm:inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    daysLeft <= 7
                      ? 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
                      : 'bg-[#FFB300]/15 text-[#FFB300] border-[#FFB300]/30 hover:bg-[#FFB300]/25'
                  }`}
                  title="สมาชิกคงเหลือ"
                >
                  <Crown className="h-3.5 w-3.5" /> เหลือ {daysLeft} วัน
                </button>
              )}
              <Button size="sm" onClick={() => navigate('/app/my-courses')} className="bg-purple-600 hover:bg-purple-700">
                คอร์สของฉัน
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-gray-300 hover:text-white px-2" title={user.email}>
                    <UserIcon className="h-4 w-4 md:mr-1.5" />
                    <span className="hidden md:inline max-w-[140px] truncate">{user.email}</span>
                    <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
                  {daysLeft !== null && (
                    <DropdownMenuItem
                      onClick={() => navigate('/subscription')}
                      className={`sm:hidden ${daysLeft <= 7 ? 'text-red-400 focus:text-red-400' : 'text-[#FFB300] focus:text-[#FFB300]'}`}
                    >
                      <Crown className="h-4 w-4 mr-2" /> สมาชิกเหลือ {daysLeft} วัน
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/profile')}>บัญชีของฉัน</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/app/my-courses')}>คอร์สของฉัน</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/affiliate')}>พันธมิตร (Affiliate)</DropdownMenuItem>
                  {(user.isAdmin || user.isSuperAdmin) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Shield className="h-3.5 w-3.5" /> ผู้ดูแลระบบ
                      </DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => navigate('/admin')}>แดชบอร์ดผู้ดูแล</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/courses')}>จัดการคอร์ส</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/enrollments')}>อนุมัติการลงทะเบียน</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/chats')}>แชทลูกค้า</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/affiliate')}>จ่ายค่าคอมมิชชั่น</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/banners')}>จัดการแบนเนอร์</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/articles')}>จัดการบทความ</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/guide')}>จัดการคลิปคู่มือ</DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { logout(); navigate('/'); }} className="text-red-400 focus:text-red-400">
                    <LogOut className="h-4 w-4 mr-2" /> ออกจากระบบ
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => navigate('/login')} className="hidden sm:inline-flex text-gray-300 hover:text-white">
                เข้าสู่ระบบ
              </Button>
              <Button size="sm" onClick={() => navigate('/subscription/transfer-v2')} className="bg-purple-600 hover:bg-purple-700">
                สมัครสมาชิก
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Mobile search row — the tight top bar has no room for an inline box */}
      {search && searchOpen && (
        <div className="sm:hidden px-4 pb-2 animate-in slide-in-from-top-2 fade-in duration-200">
          {searchBox('w-full')}
        </div>
      )}
    </header>
  );
};

export default PublicHeader;
