import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
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
import { GraduationCap, User as UserIcon, Shield, LogOut, ChevronDown } from 'lucide-react';

// Shared top navigation for the public (no-login) surface: storefront,
// course catalog, and public course detail.
// `overlay` = Netflix-style: fixed over the hero, transparent at top and
// solid once scrolled. Without it the header keeps the original sticky look.
const PublicHeader = ({ overlay = false }: { overlay?: boolean } = {}) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!overlay) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overlay]);

  const headerClass = overlay
    ? `fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
        scrolled
          ? 'bg-background/95 border-b border-border/60 backdrop-blur'
          : 'bg-gradient-to-b from-black/70 to-transparent border-b border-transparent'
      }`
    : 'sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60';

  return (
    <header className={headerClass}>
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-white">
          <GraduationCap className="h-6 w-6 text-purple-400" />
          <span className="bg-gradient-to-r from-purple-400 to-fuchsia-400 bg-clip-text text-transparent">Triple School</span>
        </Link>

        <nav className="hidden sm:flex items-center gap-6 text-sm text-gray-300">
          <Link to="/courses" className="hover:text-white transition-colors">คอร์สทั้งหมด</Link>
          <Link to="/pricing" className="hover:text-white transition-colors">ราคา</Link>
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded transition-colors"
            aria-label="Toggle language"
          >
            {language === 'th' ? 'EN' : 'TH'}
          </button>

          {user ? (
            <>
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
                      <DropdownMenuItem onClick={() => navigate('/admin/affiliate')}>จ่ายค่าคอมมิชชั่น</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/admin/banners')}>จัดการแบนเนอร์</DropdownMenuItem>
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
              <Button size="sm" variant="ghost" onClick={() => navigate('/login')} className="text-gray-300 hover:text-white">
                เข้าสู่ระบบ
              </Button>
              <Button size="sm" onClick={() => navigate('/subscription/transfer-v2')} className="bg-purple-600 hover:bg-purple-700">
                สมัครสมาชิก
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default PublicHeader;
