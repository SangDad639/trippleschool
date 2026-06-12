import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { GraduationCap, User as UserIcon } from 'lucide-react';

// Shared top navigation for the public (no-login) surface: storefront,
// course catalog, and public course detail.
const PublicHeader = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { language, setLanguage } = useLanguage();

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-white">
          <GraduationCap className="h-6 w-6 text-purple-400" />
          <span className="bg-gradient-to-r from-purple-400 to-fuchsia-400 bg-clip-text text-transparent">Triple School</span>
        </Link>

        <nav className="hidden sm:flex items-center gap-6 text-sm text-gray-300">
          <Link to="/courses" className="hover:text-white transition-colors">คอร์สทั้งหมด</Link>
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate('/profile')}
                className="text-gray-300 hover:text-white px-2"
                title={`บัญชีของฉัน: ${user.email}`}
              >
                <UserIcon className="h-4 w-4 md:mr-1.5" />
                <span className="hidden md:inline max-w-[140px] truncate">{user.email}</span>
              </Button>
              <Button size="sm" onClick={() => navigate('/app/my-courses')} className="bg-purple-600 hover:bg-purple-700">
                คอร์สของฉัน
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { logout(); navigate('/'); }}
                className="text-gray-300 hover:text-white"
              >
                ออกจากระบบ
              </Button>
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
