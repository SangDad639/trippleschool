import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { BrowseCourse } from '@/components/browse/browseRows';
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
import { GraduationCap, User as UserIcon, Shield, LogOut, ChevronDown, Menu, Crown, Search, X } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/tips', label: 'Tip' },
  { to: '/courses', label: 'Course' },
  { to: '/content', label: 'Content' },
  { to: '/ebooks', label: 'Ebook' },
  { to: '/programs', label: 'Program' },
  { to: '/pricing', label: 'Pricing' },
];

// Tip กับ Course มีเมนูย่อยตอน hover: ลิสต์ทุกตัวด้วยชื่อย่อ (tag)
const HOVER_MENUS: Record<string, 'course' | 'tip'> = { '/courses': 'course', '/tips': 'tip' };

// แคชระดับ module — ทุกหน้าใช้ header ร่วมกัน fetch ครั้งแรกที่ hover ครั้งเดียวพอ
let coursesCache: BrowseCourse[] | null = null;
let coursesCachePromise: Promise<BrowseCourse[]> | null = null;
function fetchCoursesOnce(): Promise<BrowseCourse[]> {
  if (coursesCache) return Promise.resolve(coursesCache);
  if (!coursesCachePromise) {
    coursesCachePromise = api
      .getCourses()
      .then((rows: BrowseCourse[]) => {
        coursesCache = rows;
        return rows;
      })
      .catch(() => {
        coursesCachePromise = null; // ล้มเหลว → hover ครั้งหน้าลองใหม่
        return [];
      });
  }
  return coursesCachePromise;
}

/** ป้ายในเมนูย่อย: Tip ใช้ tag_name ของตัวเองก่อน (สั้นสุด) → tag (link) → title ตัดสั้น */
function menuLabel(c: BrowseCourse): string {
  if (c.tag_name) return c.tag_name;
  if (c.tag) return c.tag;
  return c.name.length > 26 ? `${c.name.slice(0, 26)}…` : c.name;
}

/** มีวิดีโอใหม่ภายใน 7 วัน (นับจากเวลา admin เพิ่มบทเรียน) → ขึ้นป้าย Update */
const UPDATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
function hasRecentUpdate(c: BrowseCourse): boolean {
  if (!c.last_lesson_at) return false;
  const ms = Date.now() - new Date(c.last_lesson_at).getTime();
  return ms >= 0 && ms < UPDATE_WINDOW_MS;
}

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
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(!!search?.query);
  // เมนูย่อย hover ของ Tip/Course
  const [hoverMenu, setHoverMenu] = useState<'course' | 'tip' | null>(null);
  const [menuCourses, setMenuCourses] = useState<BrowseCourse[]>(coursesCache || []);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openHoverMenu = (kind: 'course' | 'tip') => {
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    setHoverMenu(kind);
    fetchCoursesOnce().then(setMenuCourses);
  };
  // หน่วงปิดเล็กน้อย — เมาส์เลื่อนจากตัวเมนูลงแผงย่อยต้องไม่หลุด
  const closeHoverMenuSoon = () => {
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = setTimeout(() => setHoverMenu(null), 150);
  };
  useEffect(() => () => {
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
  }, []);

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
      <div className="max-w-6xl mx-auto px-4 h-14 lg:h-16 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link to="/" className="flex items-center gap-2 font-bold text-white shrink-0">
            <GraduationCap className="h-6 w-6 lg:h-7 lg:w-7 xl:h-8 xl:w-8 text-purple-400" />
            <span className="text-base lg:text-lg xl:text-xl bg-gradient-to-r from-purple-400 to-fuchsia-400 bg-clip-text text-transparent">Triple School</span>
          </Link>

          {/* Desktop nav — Netflix-style: active item white + bold.
              7 ลิงก์ (Home/Tip/Course/Content/Ebook/Program/Pricing) + ชิป/ปุ่มฝั่งขวา
              เบียดกันเกินไปถ้าโชว์ตั้งแต่ md (768) จึงเลื่อนไปโชว์เต็มที่ lg (1024) ขึ้นไป
              และลดระยะห่าง/ขนาดตัวอักษรลงหนึ่งขั้นจากเดิม กันล้นชนชิป "เหลือ N วัน" ฝั่งขวา
              Tip/Course มีเมนูย่อยตอน hover: ลิสต์ทุกตัวด้วยชื่อย่อ (tag) */}
          <nav className="hidden lg:flex items-center gap-4 xl:gap-6 text-sm xl:text-base">
            {NAV_ITEMS.map((item) => {
              const hoverKind = HOVER_MENUS[item.to];
              const link = (
                <Link
                  key={hoverKind ? undefined : item.to}
                  to={item.to}
                  className={`transition-colors ${
                    isActive(item.to) ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              );
              if (!hoverKind) return link;
              const items = menuCourses.filter(
                (c) => (c.content_type === 'tip' ? 'tip' : 'course') === hoverKind
              );
              // tip ที่ไม่มี tag_name ของตัวเองแต่ link tag ซ้ำกัน — เติม title กันแยกไม่ออก
              const tagCounts: Record<string, number> = {};
              for (const c of items) if (!c.tag_name && c.tag) tagCounts[c.tag] = (tagCounts[c.tag] || 0) + 1;
              const labelFor = (c: BrowseCourse) =>
                !c.tag_name && c.tag && tagCounts[c.tag] > 1 ? `${c.tag} — ${c.name.slice(0, 18)}…` : menuLabel(c);
              return (
                <div
                  key={item.to}
                  className="relative"
                  onMouseEnter={() => openHoverMenu(hoverKind)}
                  onMouseLeave={closeHoverMenuSoon}
                >
                  {link}
                  {hoverMenu === hoverKind && items.length > 0 && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full pt-3 z-50">
                      <div className="min-w-[180px] max-w-[260px] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-background/95 backdrop-blur shadow-2xl py-2 animate-in fade-in slide-in-from-top-1 duration-150">
                        {items.map((c) => (
                          <Link
                            key={c.id}
                            to={`/courses/${c.slug}`}
                            onClick={() => setHoverMenu(null)}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
                            title={c.name}
                          >
                            <span className="truncate">{labelFor(c)}</span>
                            {hasRecentUpdate(c) && (
                              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-1 py-px">
                                Update
                              </span>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Mobile/tablet nav — items collapse into a dropdown below lg (see nav breakpoint above) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="lg:hidden text-gray-300 hover:text-white px-2" aria-label="เมนู">
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
                      <DropdownMenuItem onClick={() => navigate('/admin/guide')}>จัดการคลิปคู่มือ</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/enrollments')}>อนุมัติการลงทะเบียน</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/chats')}>แชทลูกค้า</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/affiliate')}>จ่ายค่าคอมมิชชั่น</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/banners')}>จัดการแบนเนอร์</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/articles')}>จัดการบทความ</DropdownMenuItem>
                    </>
                  )}
                  {!user.isAdmin && !user.isSuperAdmin && user.isGuideAdmin && (
                    <>
                      <DropdownMenuSeparator />
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
            /* ปุ่มเดียวพอ — ในหน้า login มีทางไปสมัครสมาชิกอยู่แล้ว */
            <Button size="sm" onClick={() => navigate('/login')} className="bg-purple-600 hover:bg-purple-700">
              เข้าสู่ระบบ
            </Button>
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
